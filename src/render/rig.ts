/**
 * 骨骼动画烘焙：把若干带骨骼的模型与刚性挂件合并成一个几何体，
 * 再把每个动画帧的骨骼矩阵写进一张浮点贴图。绘制时每个实例只需给出「第几行」，
 * 顶点着色器按行取矩阵，上千单位即可一次实例化绘制。
 */
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Recolor, coloredGeometry, mergeGeometries, recolor } from './assets';

export interface Clip {
  /** 骨骼贴图里第一帧的行号 */
  start: number;
  /** 帧数；贴图里另存了第 n 帧（循环动作等于第 0 帧，其余是末帧），帧间插值时取得到 */
  n: number;
  /** 时长（秒） */
  seconds: number;
}
/**
 * 队伍色标记：要染队伍色的部位用这个颜色（乘上明度）建模，build() 把它们换成灰度并在 aTeam 里记 1，
 * 绘制时按实例的队伍色上色。标记是「绿正好为 0、红蓝相等」的颜色；素材里碰巧是这种颜色的非队伍色部位，
 * 读入时已把绿分量抬到一个极小的正数（assets.ts 的 coloredGeometry），不会被误认。
 * 代码建模只能用 TEAM_MARK 乘一个系数（明度），不能与别的颜色混合。
 */
export const TEAM_MARK = new THREE.Color(1, 0, 1);

export interface UnitModel {
  /** 顶点属性：position、normal、color、aBone、aWeight、aTeam（1 = 染队伍色的部位） */
  geometry: THREE.BufferGeometry;
  bones: THREE.DataTexture;
  clips: Record<string, Clip>;
  /** 每个顶点受几根骨骼影响（1 或 2） */
  influences: number;
  /** 模型高度（世界单位），用于血条与选取 */
  height: number;
  /** 移动类动作一个循环前进多少世界像素（动作名 → 步幅），用来让脚步与位移对上 */
  strides: Record<string, number>;
}

/** 按标准动作名取动作，缺了就按 fallback 表退到相近的 */
export function clipOf(m: { clips: Record<string, Clip> }, name: string, fallback: Record<string, string[]>): Clip {
  const c = m.clips[name];
  if (c) return c;
  for (const f of fallback[name] ?? []) if (m.clips[f]) return m.clips[f];
  return m.clips.idle ?? Object.values(m.clips)[0];
}

export interface Layer {
  clip: string;
  /** 秒；超出时长则循环 */
  t: number;
  only?: RegExp;
  except?: RegExp;
}

/** 一个可摆姿势的骨骼模型实例 */
export class Puppet {
  readonly scene: THREE.Object3D;
  private readonly rest: { o: THREE.Object3D; p: THREE.Vector3; q: THREE.Quaternion; s: THREE.Vector3 }[] = [];
  private readonly tracks = new Map<string, { node: THREE.Object3D; name: string; prop: string; ip: THREE.Interpolant }[]>();
  readonly durations = new Map<string, number>();

  /** @param libs 动作库：按骨骼名把库里的动作套到这副骨架上；同名动作以 src 自带的为准 */
  constructor(src: GLTF, libs: GLTF[] = []) {
    this.scene = cloneSkinned(src.scene);
    this.scene.traverse(o => {
      // 根节点留给调用方摆放，不参与复位
      if (o !== this.scene) this.rest.push({ o, p: o.position.clone(), q: o.quaternion.clone(), s: o.scale.clone() });
    });
    for (const clip of [...src.animations, ...libs.flatMap(l => l.animations)]) {
      // 名字带「|」的是带 AnimalArmature| 前缀的重复动画
      if (clip.name.includes('|') || this.tracks.has(clip.name)) continue;
      const list = [];
      for (const tr of clip.tracks) {
        const parsed = THREE.PropertyBinding.parseTrackName(tr.name);
        const node = this.scene.getObjectByName(parsed.nodeName);
        if (!node) continue;
        list.push({ node, name: node.name, prop: parsed.propertyName, ip: tr.createInterpolant() });
      }
      this.tracks.set(clip.name, list);
      this.durations.set(clip.name, clip.duration);
    }
  }

  node(name: string): THREE.Object3D {
    const n = this.scene.getObjectByName(name);
    if (!n) throw new Error(`找不到骨骼：${name}`);
    return n;
  }

  /** 回到绑定姿势后依次叠加各层动画 */
  pose(layers: Layer[]): void {
    for (const r of this.rest) {
      r.o.position.copy(r.p);
      r.o.quaternion.copy(r.q);
      r.o.scale.copy(r.s);
    }
    for (const l of layers) {
      const list = this.tracks.get(l.clip);
      if (!list) throw new Error(`没有动画：${l.clip}`);
      const dur = this.durations.get(l.clip)!;
      const t = dur > 0 ? ((l.t % dur) + dur) % dur : 0;
      for (const tr of list) {
        if (l.only && !l.only.test(tr.name)) continue;
        if (l.except && l.except.test(tr.name)) continue;
        const v = tr.ip.evaluate(t) as ArrayLike<number>;
        if (tr.prop === 'quaternion') tr.node.quaternion.fromArray(v as number[]);
        else if (tr.prop === 'position') tr.node.position.fromArray(v as number[]);
        else if (tr.prop === 'scale') tr.node.scale.fromArray(v as number[]);
      }
    }
  }
}

const FPS = 30;

/** 换色函数把颜色的 r 设为负数表示「删掉这个面」 */
function dropMarked(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = src.getIndex() ? src.toNonIndexed() : src;
  const col = g.getAttribute('color');
  const keep: number[] = [];
  for (let i = 0; i < col.count; i += 3) {
    if (col.getX(i) >= 0 && col.getX(i + 1) >= 0 && col.getX(i + 2) >= 0) keep.push(i, i + 1, i + 2);
  }
  if (keep.length === col.count) return g;
  const out = new THREE.BufferGeometry();
  for (const name of Object.keys(g.attributes)) {
    const a = g.getAttribute(name);
    const arr = new Float32Array(keep.length * a.itemSize);
    keep.forEach((v, k) => {
      for (let c = 0; c < a.itemSize; c++) arr[k * a.itemSize + c] = a.getComponent(v, c);
    });
    out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
  }
  return out;
}

export class RigBuilder {
  /** 模型根节点：模型前方为 +X，脚踩 y=0，单位为世界像素 */
  readonly root = new THREE.Group();
  private readonly cols: { bone: THREE.Object3D; inv: THREE.Matrix4 | null }[] = [];
  private readonly parts: THREE.BufferGeometry[] = [];
  private readonly frames: Float32Array[] = [];
  private readonly clips: Record<string, Clip> = {};
  private influences = 1;

  /** 骨骼（连同逆绑定矩阵）在骨骼贴图里的列，已有相同的就复用 */
  private colFor(bone: THREE.Object3D, inv: THREE.Matrix4): number {
    const k = this.cols.findIndex(c => c.bone === bone && c.inv !== null && c.inv.equals(inv));
    if (k >= 0) return k;
    this.cols.push({ bone, inv });
    return this.cols.length - 1;
  }

  /** 加入一个骨骼模型（须已挂到 root 之下） */
  addSkinned(scene: THREE.Object3D, paint?: (boneOf: () => string) => Recolor): void {
    const rigid: THREE.Mesh[] = [];
    scene.traverse(o => {
      const m = o as THREE.SkinnedMesh;
      // 不蒙皮的网格（挂在骨骼下的兵器、盾牌）整块跟着自己的节点走
      if ((o as THREE.Mesh).isMesh && !m.isSkinnedMesh) rigid.push(o as THREE.Mesh);
      if (!m.isSkinnedMesh) return;
      const g = coloredGeometry(m);
      g.applyMatrix4(m.bindMatrix);
      // 同一副骨架拆成多个网格（每种材质一个）时，同一根骨骼与逆绑定矩阵只占一列，骨骼贴图不随网格数翻倍
      const colOf = m.skeleton.bones.map((bone, j) => this.colFor(bone, m.skeleton.boneInverses[j]));
      const si = g.getAttribute('skinIndex'), sw = g.getAttribute('skinWeight');
      const n = si.count;
      const bone = new Float32Array(n * 4), weight = new Float32Array(n * 4);
      const names: string[] = [];
      for (let i = 0; i < n; i++) {
        // 只保留权重最大的两根骨骼，顶点着色器少取一半矩阵
        let a = 0, b = -1;
        for (let k = 1; k < 4; k++) if (sw.getComponent(i, k) > sw.getComponent(i, a)) a = k;
        for (let k = 0; k < 4; k++) if (k !== a && (b < 0 || sw.getComponent(i, k) > sw.getComponent(i, b))) b = k;
        const wa = sw.getComponent(i, a), wb = sw.getComponent(i, b);
        names.push(m.skeleton.bones[si.getComponent(i, a)].name);
        bone[i * 4] = colOf[si.getComponent(i, a)];
        weight[i * 4] = wa + wb > 0 ? wa / (wa + wb) : 1;
        if (wb > 0.02) {
          this.influences = 2;
          bone[i * 4 + 1] = colOf[si.getComponent(i, b)];
          weight[i * 4 + 1] = wb / (wa + wb);
        } else weight[i * 4] = 1;
      }
      g.deleteAttribute('skinIndex');
      g.deleteAttribute('skinWeight');
      g.setAttribute('aBone', new THREE.BufferAttribute(bone, 4));
      g.setAttribute('aWeight', new THREE.BufferAttribute(weight, 4));
      if (paint) {
        // 顶点色改写时提供「该顶点主要跟随哪根骨骼」
        let cursor = 0;
        const fn = paint(() => names[cursor]);
        recolor(g, (c, x, y, z) => {
          fn(c, x, y, z);
          cursor++;
        });
      }
      this.parts.push(dropMarked(g));
    });
    for (const m of rigid) this.addRigid(coloredGeometry(m), m);
  }

  /** 加入一个刚性部件：几何体位于 parent 的局部坐标系，随 parent 运动 */
  addRigid(geom: THREE.BufferGeometry, parent: THREE.Object3D): void {
    const g = geom.getIndex() ? geom.toNonIndexed() : geom.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') g.deleteAttribute(k);
    const n = g.getAttribute('position').count;
    const bone = new Float32Array(n * 4), weight = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      bone[i * 4] = this.cols.length;
      weight[i * 4] = 1;
    }
    g.setAttribute('aBone', new THREE.BufferAttribute(bone, 4));
    g.setAttribute('aWeight', new THREE.BufferAttribute(weight, 4));
    this.cols.push({ bone: parent, inv: null });
    this.parts.push(g);
  }

  /** 录制一段动画：pose(t) 负责把各模型摆到第 t 秒的姿势 */
  clip(name: string, seconds: number, pose: (t: number, k: number) => void, fps = FPS): void {
    const n = Math.max(1, Math.round(seconds * fps));
    this.clips[name] = { start: this.frames.length, n, seconds };
    const m = new THREE.Matrix4();
    // 多录一帧（第 n 帧 = 第 seconds 秒）：循环动作回到第 0 帧，其余停在末帧，帧间插值不越界
    for (let f = 0; f <= n; f++) {
      pose((f / n) * seconds, f / n);
      this.root.updateMatrixWorld(true);
      const row = new Float32Array(this.cols.length * 16);
      this.cols.forEach((c, j) => {
        if (c.inv) m.multiplyMatrices(c.bone.matrixWorld, c.inv);
        else m.copy(c.bone.matrixWorld);
        m.toArray(row, j * 16);
      });
      this.frames.push(row);
    }
  }

  /** 让另一个动作名直接用已录好的动作（不重复占骨骼贴图的行；渲染层见到同一段动作也不做过渡） */
  alias(name: string, from: string): void {
    this.clips[name] = this.clips[from];
  }

  build(strides: Record<string, number> = {}): UnitModel {
    const w = this.cols.length * 4, h = this.frames.length;
    const data = new Float32Array(w * h * 4);
    this.frames.forEach((row, f) => data.set(row.subarray(0, w * 4), f * w * 4));
    const bones = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType);
    bones.minFilter = bones.magFilter = THREE.NearestFilter;
    bones.generateMipmaps = false;
    bones.needsUpdate = true;
    const merged = mergeGeometries(this.parts);
    markTeam(merged);
    const geometry = mergeVertices(merged, 1e-3);
    // 用第一帧估算高度
    let height = 0;
    const pos = geometry.getAttribute('position'), ab = geometry.getAttribute('aBone');
    const v = new THREE.Vector3(), m = new THREE.Matrix4();
    for (let i = 0; i < pos.count; i++) {
      m.fromArray(this.frames[0], ab.getX(i) * 16);
      v.fromBufferAttribute(pos, i).applyMatrix4(m);
      if (v.y > height) height = v.y;
    }
    return { geometry, bones, clips: this.clips, influences: this.influences, height, strides };
  }
}

/** 把 TEAM_MARK 标出的顶点换成灰度（明度），并写出 aTeam 属性 */
export function markTeam(g: THREE.BufferGeometry): void {
  const col = g.getAttribute('color');
  const team = new Float32Array(col.count);
  for (let i = 0; i < col.count; i++) {
    const r = col.getX(i), gg = col.getY(i), b = col.getZ(i);
    if (gg === 0 && r > 0 && Math.abs(r - b) < 1e-5) {
      team[i] = 1;
      col.setXYZ(i, r, r, r);
    }
  }
  g.setAttribute('aTeam', new THREE.BufferAttribute(team, 1));
}

/** 骨骼模型在当前姿势下的世界包围盒（按每个顶点的主骨骼估算）。马的 glTF 骨架与网格节点各带 100 倍缩放，直接取包围盒不可信 */
export function skinnedBox(scene: THREE.Object3D): THREE.Box3 {
  scene.updateMatrixWorld(true);
  const bx = new THREE.Box3();
  const v = new THREE.Vector3(), m = new THREE.Matrix4();
  scene.traverse(o => {
    const sm = o as THREE.SkinnedMesh;
    if (!sm.isSkinnedMesh) return;
    const pos = sm.geometry.getAttribute('position'), si = sm.geometry.getAttribute('skinIndex');
    const mats = sm.skeleton.bones.map((b, j) => new THREE.Matrix4().multiplyMatrices(b.matrixWorld, sm.skeleton.boneInverses[j]).multiply(sm.bindMatrix));
    for (let i = 0; i < pos.count; i++) {
      m.copy(mats[si.getX(i)]);
      bx.expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(m));
    }
  });
  return bx;
}

/**
 * 给材质打补丁的着色器片段：按实例属性取骨骼矩阵并摆放到世界中。
 * aAnim.x 是带小数的帧行号，在相邻两帧之间插值；aBlend 给出上一个动作冻结时的帧行与它的权重，换动作时淡出。
 * 定义 UNIT_COARSE 时两样都不做（阴影深度那一遍用，省一半以上的取贴图）。
 */
export const UNIT_VERT_PARS = `
attribute vec4 aBone;
attribute vec4 aWeight;
attribute float aTeam;
attribute vec4 aInst; // x, y, z, 朝向角
attribute vec4 aAnim; // 动画行（带小数）, 闪白, 缩放, 明暗
attribute vec3 aTint; // 队伍色（线性）
attribute vec2 aBlend; // 上一个动作的帧行, 它的权重
uniform sampler2D uBones;
varying float vFlash;
varying float vShade;
mat4 boneAt(float b, int y){
  int x = int(b + 0.5) * 4;
  return mat4(texelFetch(uBones, ivec2(x, y), 0), texelFetch(uBones, ivec2(x + 1, y), 0),
    texelFetch(uBones, ivec2(x + 2, y), 0), texelFetch(uBones, ivec2(x + 3, y), 0));
}
mat4 skinAt(int y){
#ifdef INFLUENCES_2
  return boneAt(aBone.x, y) * aWeight.x + boneAt(aBone.y, y) * aWeight.y;
#else
  return boneAt(aBone.x, y);
#endif
}
mat4 skinRow(float row){
  float f = floor(row);
  float t = row - f;
  mat4 m = skinAt(int(f));
#ifndef UNIT_COARSE
  if (t > 0.01) m += (skinAt(int(f) + 1) - m) * t;
#endif
  return m;
}
mat4 unitMatrix(){
  mat4 bm = skinRow(aAnim.x);
#ifndef UNIT_COARSE
  if (aBlend.y > 0.001) bm += (skinRow(aBlend.x) - bm) * aBlend.y;
#endif
  float c = cos(aInst.w), s = sin(aInst.w), k = aAnim.z;
  mat4 place = mat4(c * k, 0.0, s * k, 0.0, 0.0, k, 0.0, 0.0, -s * k, 0.0, c * k, 0.0, aInst.x, aInst.y, aInst.z, 1.0);
  return place * bm;
}
`;
