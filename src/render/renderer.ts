/** three.js 渲染器：立体地形、透视镜头、实例化的单位与建筑、贴地标记与粒子 */
import * as THREE from 'three';
import {
  BK_KEEP, BK_MAIN, BK_TOWER, BK_WALL, BUILDINGS, DT, PROJ_ARC, P_BALL, P_BIGBOLT, P_BOLT, P_BULLET, P_JAVELIN, P_ROCKET, P_STONE, P_TORCH,
  RULES, SITE_HQ, SITE_INFO, TILE, T_BRIDGE, UNITS,
} from '../sim/defs';
import { CHUNK } from '../sim/map';
import {
  Building, FX_ARROW_HIT, FX_BUILT, FX_COLLAPSE, FX_DEATH, FX_EXPLODE, FX_FIRE, FX_HIT, FX_IMPACT, FX_LEVEL, FX_SMOKE, FX_UPGRADE,
  MAX_CORPSE, MAX_UNITS, S_BRACE, S_CHARGE, S_ROUT, S_SHIELD, S_TORCH, S_WALL, VIS_CELL, World,
} from '../sim/world';
import { bridgeGeo, buildingGeo, flagHeight, hasUpgradeLook, propGeo, rubbleGeo, wallGeo } from './buildings';
import { litMaterial, shared } from './materials';
import { box, cone, cyl, join } from './prims';
import { Atlas, Q_AXIS, Q_BILLBOARD, Q_GROUND, Q_SCREEN, Quads, Sprite } from './quads';
import { Terrain, WATER_Y } from './terrain';
import { CLIP_FALLBACK, TWIST_CLIPS, buildUnitModel } from './models/spec';
import { Clip, clipOf } from './rig';
import { UnitBatch } from './units';

const MAXP = 3000;
const FOV = 30;
const TAN = Math.tan((FOV / 2) * (Math.PI / 180));
const DULL = new THREE.Color(0.42, 0.45, 0.48);
const PALE = new THREE.Color(0.78, 0.81, 0.86);

export interface Marker {
  x: number;
  y: number;
  /** 已存在的秒数 */
  t: number;
  r: number;
  g: number;
  b: number;
  /** 插不插令旗 */
  flag: boolean;
}

/** 有风时箭的弯曲程度：中途横向鼓出 射程 × 这个比例 × 风力 */
const WIND_BEND = 0.12;

/** 令旗在落点停留的秒数 */
const MARKER_LIFE = 2.4;
const MAX_CMD_FLAGS = 24;

/** 令旗：细杆 + 三角旗面（颜色随号令种类变化） */
function pennantGeo(): THREE.BufferGeometry {
  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0.5, 24, 0, 0.5, 14, 0, 15, 19, 0]), 3));
  tri.computeVertexNormals();
  tri.setAttribute('color', new THREE.BufferAttribute(new Float32Array(9).fill(1), 3));
  return join(cyl(0.45, 0.6, 25, 0x2e2620, 0, 12.5, 0, 4), cone(1, 2.4, 0xc9a227, 0, 26, 0, 4), tri);
}

/** 同一种模型的建筑合成一批绘制；对局中途会有新建筑、新模型（箭塔、升级后的样子），所以容量按需增长 */
interface InstGroup {
  mesh: THREE.InstancedMesh;
  geo: THREE.BufferGeometry;
  cap: number;
  n: number;
  /** 这一轮要画几个（先数一遍，容量不够就先扩） */
  want: number;
}

/** 一栋建筑用哪个模型：分组键（不含等级）、按等级生成几何体、倒塌后用哪种废墟 */
interface BldKind {
  key: string;
  geo: (lv: number) => THREE.BufferGeometry;
  lvLook: boolean;
  rubble: string;
}

export class Renderer {
  readonly three: THREE.WebGLRenderer;
  /** 镜头：x, y 为注视点（世界坐标），zoom 越大越近，yaw 为水平转角，pitch 为俯角 */
  readonly cam = { x: 0, y: 0, zoom: 1, yaw: 0, pitch: 0.8 };
  viewW = 1;
  viewH = 1;
  readonly terrain: Terrain;
  /** [队伍] 颜色 0..1 */
  readonly teamColor: [number, number, number][];
  readonly teamRgb: [number, number, number][];
  markers: Marker[] = [];
  /** 正在拖动指定的队列朝向：从落点指向鼠标（世界坐标），没有则为 null */
  arrow: { x0: number; y0: number; x1: number; y1: number } | null = null;
  /** 玩家选中的据点（-1 = 没有）：画一圈高亮，资源点另标出空着的箭塔位 */
  selSite = -1;
  drawn = 0;

  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(FOV, 1, 10, 30000);
  private readonly sun = new THREE.DirectionalLight(0xfff0d6, 2.4);
  private readonly sky = new THREE.HemisphereLight(0xcfe0ff, 0x6e6548, 1.35);
  private readonly batches: (UnitBatch | null)[][] = [[], [], []];
  /** [队伍][兵种] 各标准动作解析后的结果（缺的动作已按回退表补上） */
  private readonly clips: (Record<string, Clip> | null)[][] = [[], [], []];
  private readonly ground: Quads;
  private readonly sprites: Quads;
  private readonly overlay: Quads;
  /** 贴在桥面、墙顶上的标记（要做深度测试，不然会被模型盖住） */
  private readonly raised: Quads;
  private readonly routIcon: Sprite;
  private readonly cmdFlags: THREE.InstancedMesh;
  private readonly atlas = new Atlas(1024);
  private readonly white: Sprite;
  private readonly soft: Sprite;
  private readonly ring: Sprite;
  private readonly circle: Sprite;
  private readonly labels: Sprite[] = [];
  /** 对局中途搭起来的临时据点共用一张名牌 */
  private readonly outpostLabel: Sprite;
  private readonly star: Sprite;
  /** 倒塌后重建中、还不能放箭的防御建筑头顶的标记：一支被斜杠划掉的箭 */
  private readonly noShoot: Sprite;
  private readonly bldGroups = new Map<string, InstGroup>();
  private readonly bldKinds: BldKind[] = [];
  private readonly bldMat: THREE.Material;
  private bldSig = new Int32Array(0);
  /** 地面积雪 0..1：下雪时慢慢积起来，雪停后慢慢化掉 */
  private snowCover = 0;
  private readonly flags: THREE.InstancedMesh;
  private readonly siteFlags: THREE.InstancedMesh;
  private readonly disposables: { dispose(): void }[] = [];
  private time = 0;
  private readonly maxTop = Math.max(...Object.values(BUILDINGS).map(b => b.top));
  private readonly ray = new THREE.Raycaster();
  private readonly v = new THREE.Vector3();
  private readonly m4 = new THREE.Matrix4();
  private readonly col = new THREE.Color();
  private readonly teamLin: THREE.Color[];
  /** 镜头在地面上看到的范围（包围盒），用于剔除 */
  private vx0 = 0;
  private vx1 = 0;
  private vy0 = 0;
  private vy1 = 0;

  // 粒子：x y z vx vy vz life life0 size grow r g b a
  private pn = 0;
  private readonly pp = new Float32Array(MAXP * 14);
  /** 单位上下城墙时的高度过渡 */
  private readonly lift = new Float32Array(MAX_UNITS);

  constructor(readonly canvas: HTMLCanvasElement, readonly world: World) {
    const r = (this.three = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    const f1 = world.factions[1]!, f2 = world.factions[2]!;
    this.teamRgb = [[190, 190, 182], f1.color, f1.id === f2.id ? f2.altColor : f2.color];
    this.teamColor = this.teamRgb.map(c => [c[0] / 255, c[1] / 255, c[2] / 255] as [number, number, number]);
    this.teamLin = this.teamColor.map(c => new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace));

    const scene = this.scene;
    scene.background = new THREE.Color(0x9db4c4);
    scene.fog = new THREE.Fog(0x9db4c4, 6000, 22000);
    scene.add(this.sky);
    const sun = this.sun;
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.6;
    scene.add(sun, sun.target);

    // ---- 地形 ----
    this.terrain = new Terrain(world.map, world.vw, world.vh,
      world.buildings.map(b => ({ tx: b.tx, ty: b.ty, w: b.w, h: b.h })));
    scene.add(this.terrain.mesh, this.terrain.water);
    this.terrain.mesh.renderOrder = -2;

    // ---- 贴图集 ----
    const at = this.atlas;
    this.white = at.add(8, 8, 1, c => {
      c.fillStyle = '#fff';
      c.fillRect(0, 0, 8, 8);
    });
    const wu = (this.white.u1 - this.white.u0) / 4, wv = (this.white.v1 - this.white.v0) / 4;
    this.white.u0 += wu;
    this.white.u1 -= wu;
    this.white.v0 += wv;
    this.white.v1 -= wv;
    this.soft = at.add(32, 32, 2, c => {
      const g = c.createRadialGradient(16, 16, 0, 16, 16, 16);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.5, 'rgba(255,255,255,0.55)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, 32, 32);
    });
    this.ring = at.add(48, 48, 2, c => {
      c.strokeStyle = '#fff';
      c.lineWidth = 3.4;
      c.beginPath();
      c.arc(24, 24, 20, 0, Math.PI * 2);
      c.stroke();
    });
    this.circle = at.add(256, 256, 1, c => {
      c.strokeStyle = '#fff';
      c.lineWidth = 3;
      c.setLineDash([14, 9]);
      c.beginPath();
      c.arc(128, 128, 124, 0, Math.PI * 2);
      c.stroke();
      c.fillStyle = 'rgba(255,255,255,0.07)';
      c.fill();
    });
    // 溃逃标识：一面小白旗
    this.routIcon = at.add(16, 16, 3, c => {
      c.lineJoin = 'round';
      c.strokeStyle = 'rgba(20,16,12,0.95)';
      c.lineWidth = 2.6;
      c.beginPath();
      c.moveTo(4, 15);
      c.lineTo(4, 2);
      c.lineTo(14, 5);
      c.lineTo(4, 9);
      c.stroke();
      c.fillStyle = '#fff';
      c.beginPath();
      c.moveTo(4, 2);
      c.lineTo(14, 5);
      c.lineTo(4, 9);
      c.closePath();
      c.fill();
      c.strokeStyle = '#fff';
      c.lineWidth = 1.2;
      c.beginPath();
      c.moveTo(4, 15);
      c.lineTo(4, 2);
      c.stroke();
    });
    const label = (name: string): Sprite => {
      const w = name.length * 14 + 14;
      return at.add(w, 22, 2, c => {
        c.font = '600 13px "PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.lineJoin = 'round';
        c.strokeStyle = 'rgba(15,12,8,0.9)';
        c.lineWidth = 4;
        c.strokeText(name, w / 2, 11);
        c.fillStyle = '#fff';
        c.fillText(name, w / 2, 11);
      });
    };
    for (const s of world.sites) this.labels.push(label(s.name));
    this.outpostLabel = label(SITE_INFO[SITE_INFO.length - 1].label);
    // 已升级的据点：名牌旁一颗星
    this.star = at.add(18, 18, 2, c => {
      c.beginPath();
      for (let k = 0; k < 10; k++) {
        const a = -Math.PI / 2 + (k * Math.PI) / 5, r = k & 1 ? 3.6 : 8;
        c.lineTo(9 + Math.cos(a) * r, 9 + Math.sin(a) * r);
      }
      c.closePath();
      c.lineJoin = 'round';
      c.strokeStyle = 'rgba(15,12,8,0.9)';
      c.lineWidth = 2.5;
      c.stroke();
      c.fillStyle = '#fff';
      c.fill();
    });
    this.noShoot = at.add(26, 26, 2, c => {
      c.beginPath();
      c.arc(13, 13, 11, 0, Math.PI * 2);
      c.fillStyle = 'rgba(20,16,12,0.85)';
      c.fill();
      c.lineCap = 'round';
      c.strokeStyle = '#fff';
      c.lineWidth = 2.2;
      c.beginPath();
      c.moveTo(7, 19); c.lineTo(19, 7); c.moveTo(19, 7); c.lineTo(13.5, 8); c.moveTo(19, 7); c.lineTo(18, 12.5);
      c.stroke();
      c.strokeStyle = '#ff5a3c';
      c.lineWidth = 2.6;
      c.beginPath();
      c.arc(13, 13, 10, 0, Math.PI * 2);
      c.moveTo(6, 6); c.lineTo(20, 20);
      c.stroke();
    });
    const tex = at.finish();
    this.ground = new Quads(tex, { ground: true });
    this.sprites = new Quads(tex, {}, 4096);
    this.overlay = new Quads(tex, { overlay: true }, 256);
    this.raised = new Quads(tex, { lift: true }, 256);
    scene.add(this.ground.mesh, this.sprites.mesh, this.overlay.mesh, this.raised.mesh);
    this.disposables.push(tex, this.ground, this.sprites, this.overlay, this.raised, this.terrain);

    // ---- 单位 ----
    for (let tm = 1; tm <= 2; tm++) {
      const fac = world.factions[tm]!;
      for (const d of UNITS) {
        if (d.faction !== fac.id) continue;
        const b = new UnitBatch(buildUnitModel(d.model, this.teamRgb[tm]));
        this.batches[tm][d.idx] = b;
        const set: Record<string, Clip> = {};
        for (const name of ['idle', 'walk', 'run', 'attack', 'attackMove', 'die', 'charge', 'brace', 'guard', 'guardWalk', ...TWIST_CLIPS.map(t => t[0])]) {
          set[name] = clipOf(b.model, name, CLIP_FALLBACK);
        }
        this.clips[tm][d.idx] = set;
        scene.add(b.mesh);
        this.disposables.push(b);
      }
    }

    // ---- 建筑 ----
    const mat = (this.bldMat = litMaterial());
    this.disposables.push(mat);
    const blds = world.buildings;
    this.registerBuildings();

    // 旗帜：旗杆 + 旗面，颜色随归属变化
    const flagGeo = join(cyl(0.5, 0.6, 22, 0x3a3028, 0, 11, 0, 4), box(13, 8, 0.5, 0xffffff, 6.8, 17.5, 0));
    const flagMat = litMaterial({ side: THREE.DoubleSide });
    // 留出对局中途新建的箭塔、行营的余量
    this.flags = new THREE.InstancedMesh(flagGeo, flagMat, blds.length + 128);
    this.siteFlags = new THREE.InstancedMesh(flagGeo, flagMat, world.sites.length + 24);
    for (const f of [this.flags, this.siteFlags]) {
      f.frustumCulled = false;
      f.castShadow = true;
      f.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(f);
    }
    const pg = pennantGeo();
    this.cmdFlags = new THREE.InstancedMesh(pg, flagMat, MAX_CMD_FLAGS);
    this.cmdFlags.frustumCulled = false;
    this.cmdFlags.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.cmdFlags.count = 0;
    scene.add(this.cmdFlags);
    this.disposables.push(flagGeo, flagMat, this.flags, this.siteFlags, pg, this.cmdFlags);

    this.buildProps(mat);
    this.resize();
  }

  /** 树木、山石与桥：按区域分组实例化，交给视锥剔除 */
  private buildProps(mat: THREE.Material): void {
    const map = this.world.map, props = map.props;
    const REG = 4; // 每组 4×4 个区块
    const geos: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 8; k++) geos.push(propGeo(k));
    this.disposables.push(...geos);
    const rw = Math.ceil(map.chunkW / REG), rh = Math.ceil(map.chunkH / REG);
    const buckets = new Map<number, number[]>();
    for (let cy = 0; cy < map.chunkH; cy++) for (let cx = 0; cx < map.chunkW; cx++) {
      const ci = cy * map.chunkW + cx;
      const reg = ((cy / REG) | 0) * rw + ((cx / REG) | 0);
      for (let k = map.propChunk[ci]; k < map.propChunk[ci + 1]; k++) {
        const key = reg * 8 + props[k * 4 + 2];
        let l = buckets.get(key);
        if (!l) buckets.set(key, (l = []));
        l.push(k);
      }
    }
    void rh;
    const m = this.m4, q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    for (const [key, list] of buckets) {
      const kind = key % 8;
      const mesh = new THREE.InstancedMesh(geos[kind], mat, list.length);
      list.forEach((k, i) => {
        const x = props[k * 4], z = props[k * 4 + 1], sc = props[k * 4 + 3];
        // 用位置做伪随机，让同一种树朝向、高矮各不相同
        const h = Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1;
        q.setFromAxisAngle(up, h * 6.28);
        const k2 = kind < 5 ? 1.15 * sc * (0.85 + h * 0.4) : sc * 1.2;
        s.set(k2, k2 * (kind < 5 ? 0.9 + h * 0.35 : 1), k2);
        p.set(x, this.terrain.heightAt(x, z) - 0.5, z);
        mesh.setMatrixAt(i, m.compose(p, q, s));
      });
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      this.scene.add(mesh);
      this.disposables.push(mesh);
    }
    // 桥
    const cells: number[] = [];
    for (let i = 0; i < map.terrain.length; i++) if (map.terrain[i] === T_BRIDGE) cells.push(i);
    if (cells.length) {
      const g = bridgeGeo();
      const mesh = new THREE.InstancedMesh(g, mat, cells.length);
      cells.forEach((c, i) => {
        mesh.setMatrixAt(i, m.makeTranslation(((c % map.w) + 0.5) * TILE, 0.4, (((c / map.w) | 0) + 0.5) * TILE));
      });
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      this.disposables.push(g, mesh);
    }
  }

  /** 给还没登记过的建筑（开局的全部，以及后来新建的）定下用哪个模型 */
  private registerBuildings(): void {
    const w = this.world, nav = w.nav, mw = w.map.w, blds = w.buildings;
    const wallLike = (c: number): number => {
      const id = nav.bld[c];
      return id >= 0 && blds[id].def.kind <= 2 ? 1 : 0;
    };
    for (let i = this.bldKinds.length; i < blds.length; i++) {
      const b = blds[i], def = b.def;
      let key: string, geo: (lv: number) => THREE.BufferGeometry;
      if (def.kind === BK_WALL) {
        const c = b.ty * mw + b.tx;
        const mask = wallLike(c - mw) | (wallLike(c + 1) << 1) | (wallLike(c + mw) << 2) | (wallLike(c - 1) << 3);
        // 朝城外的边：隔壁既不是墙，也不是城内的地面
        const outer = (c2: number): number => (!wallLike(c2) && !nav.inner[c2] ? 1 : 0);
        const out = outer(c - mw) | (outer(c + 1) << 1) | (outer(c + mw) << 2) | (outer(c - 1) << 3);
        key = `${def.key}:${mask}:${out}`;
        geo = lv => wallGeo(mask, def.wood, out, lv);
      } else {
        const variants = def.key === 'house' || def.key === 'tent' ? 4 : def.key === 'farmhouse' ? 2 : 1;
        const v = b.variant % variants, st = def.kind === BK_KEEP ? b.style : '';
        key = `${def.key}:${st}:${v}`;
        geo = lv => buildingGeo(def.key, st, v, lv);
      }
      this.bldKinds.push({ key, geo, lvLook: hasUpgradeLook(def.key), rubble: `${def.w}x${def.h}:${def.wood ? 1 : 0}` });
    }
    if (this.bldSig.length < blds.length) {
      const sig = new Int32Array(blds.length + 64).fill(-1);
      sig.set(this.bldSig);
      this.bldSig = sig;
    }
  }

  /** 取（没有就建）某个模型的绘制批次，容量不够时换一个更大的 */
  private bldGroup(key: string, geo: () => THREE.BufferGeometry, shadow: boolean, need: number): InstGroup {
    let g = this.bldGroups.get(key);
    if (g && g.cap >= need) return g;
    const cap = Math.max(need, g ? g.cap * 2 : 4);
    const geom = g ? g.geo : geo();
    if (g) {
      this.scene.remove(g.mesh);
      g.mesh.dispose();
    }
    const mesh = new THREE.InstancedMesh(geom, this.bldMat, cap);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(mesh);
    g = { mesh, geo: geom, cap, n: 0, want: g ? g.want : 0 };
    this.bldGroups.set(key, g);
    return g;
  }

  dispose(): void {
    for (const g of this.bldGroups.values()) {
      g.geo.dispose();
      g.mesh.dispose();
    }
    for (const d of this.disposables) d.dispose();
    this.three.dispose();
    this.three.forceContextLoss();
  }

  resize(): void {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (w === 0 || h === 0) return;
    if (w !== this.viewW || h !== this.viewH) {
      this.viewW = w;
      this.viewH = h;
      this.three.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      this.three.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
  }

  /** 单位脚下的高度：桥面抬到水面以上，浅滩里只没到小腿 */
  groundY(x: number, z: number): number {
    const map = this.world.map;
    const tx = (x / TILE) | 0, tz = (z / TILE) | 0;
    if (tx >= 0 && tz >= 0 && tx < map.w && tz < map.h && map.terrain[tz * map.w + tx] === T_BRIDGE) return 1.6;
    const h = this.terrain.heightAt(x, z);
    return h < WATER_Y - 2.2 ? WATER_Y - 2.2 : h;
  }

  /** 脚下是墙顶 / 楼顶时返回它的高度（世界 Y），否则返回 NaN */
  deckY(x: number, z: number): number {
    const w = this.world, map = w.map;
    const tx = (x / TILE) | 0, tz = (z / TILE) | 0;
    if (tx < 0 || tz < 0 || tx >= map.w || tz >= map.h) return NaN;
    const id = w.nav.bld[tz * map.w + tx];
    if (id < 0) return NaN;
    const b = w.buildings[id];
    return b.def.top > 0 ? this.terrain.heightAt(b.cx, b.cy) - 0.4 + b.def.top : NaN;
  }

  /** 能站人的表面高度：墙顶、桥面或地面 */
  surfaceY(x: number, z: number): number {
    const d = this.deckY(x, z);
    return d === d ? d : this.groundY(x, z);
  }

  /** 贴地标记：在桥面、墙顶上改用做深度测试的那一层，免得被模型盖住 */
  /** 边跑边打的动作：骑射手按目标在马头的哪一侧挑骑手扭身的角度（模型绕 +Y 转 a = 模拟里的方位角减 a） */
  private moveShot(i: number, cl: Record<string, Clip>): Clip {
    const w = this.world, t = w.target[i];
    let tx: number, ty: number;
    if (t >= 0) { tx = w.x[t]; ty = w.y[t]; }
    else if (t < -1 && w.buildings[-t - 2]) { const b = w.buildings[-t - 2]; tx = b.cx; ty = b.cy; }
    else return cl.attackMove;
    let rel = Math.atan2(ty - w.y[i], tx - w.x[i]) - w.dir[i];
    rel -= Math.round(rel / (Math.PI * 2)) * Math.PI * 2;
    const want = -rel;
    let best = cl.attackMove, gap = Math.abs(want);
    for (const [name, a] of TWIST_CLIPS) {
      const g = Math.abs(want - a);
      if (g < gap && cl[name]) {
        gap = g;
        best = cl[name];
      }
    }
    return best;
  }

  private flat(s: Sprite, x: number, y: number, z: number, w: number, h: number, r: number, g: number, b: number, a: number): void {
    const map = this.world.map;
    const tx = (x / TILE) | 0, tz = (z / TILE) | 0;
    const c = tx >= 0 && tz >= 0 && tx < map.w && tz < map.h ? tz * map.w + tx : -1;
    if (c >= 0 && (map.terrain[c] === T_BRIDGE || this.world.nav.bld[c] >= 0)) this.raised.add(Q_GROUND, s, x, y + 0.5, z, w, h, r, g, b, a);
    else this.ground.add(Q_GROUND, s, x, y, z, w, h, r, g, b, a);
  }

  private get dist(): number {
    return 1500 / this.cam.zoom;
  }

  /** 屏幕上每个世界像素约占多少屏幕像素（按注视点处的距离估算） */
  get pxPerUnit(): number {
    return this.viewH / (2 * TAN * this.dist);
  }

  /** 把镜头参数写进 three.js 相机 */
  updateCamera(): void {
    const c = this.cam, d = this.dist;
    const ty = this.groundY(c.x, c.y);
    const cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
    this.camera.position.set(c.x + Math.sin(c.yaw) * cp * d, ty + sp * d, c.y + Math.cos(c.yaw) * cp * d);
    this.camera.near = Math.max(5, d * 0.05);
    this.camera.far = d * 8 + 4000;
    this.camera.lookAt(c.x, ty, c.y);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }

  /** 屏幕像素 → 地面上的世界坐标（与地形求交） */
  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    this.updateCamera();
    this.v.set((sx / this.viewW) * 2 - 1, -(sy / this.viewH) * 2 + 1, 0.5).unproject(this.camera);
    const o = this.camera.position;
    const dx = this.v.x - o.x, dy = this.v.y - o.y, dz = this.v.z - o.z;
    let gy = 0, x = 0, z = 0;
    for (let k = 0; k < 5; k++) {
      // 视线几乎水平或朝上时，取远处的一点
      const t = dy < -1e-4 ? Math.min((gy - o.y) / dy, 60000 / Math.hypot(dx, dy, dz)) : 60000 / Math.hypot(dx, dy, dz);
      x = o.x + dx * t;
      z = o.z + dz * t;
      gy = Math.max(WATER_Y, this.terrain.heightAt(x, z));
    }
    // 视线在落地之前先碰到墙顶 / 楼顶：落点算在墙上
    const len = Math.hypot(dx, dy, dz);
    if (dy < -1e-4) {
      const tg = (gy - o.y) / dy;
      const back = (this.maxTop + 8) / -dy;
      const stepT = 6 / len;
      for (let t = Math.max(0, tg - back); t < tg; t += stepT) {
        const px = o.x + dx * t, pz = o.z + dz * t;
        const top = this.deckY(px, pz);
        if (top === top && o.y + dy * t <= top + 0.5) return { x: px, y: pz };
      }
    }
    return { x, y: z };
  }

  /** 世界坐标（可带离地高度）→ 屏幕像素；镜头后方的点返回 null */
  worldToScreen(x: number, y: number, h = 0): { x: number; y: number } | null {
    this.v.set(x, this.groundY(x, y) + h, y).project(this.camera);
    if (this.v.z > 1 || this.v.z < -1) return null;
    return { x: (this.v.x + 1) * 0.5 * this.viewW, y: (1 - this.v.y) * 0.5 * this.viewH };
  }

  /** 屏幕四角落在地面上的位置（小地图画视野框用） */
  viewQuad(): { x: number; y: number }[] {
    return [this.screenToWorld(0, 0), this.screenToWorld(this.viewW, 0), this.screenToWorld(this.viewW, this.viewH),
      this.screenToWorld(0, this.viewH)];
  }

  /** 沿屏幕方向平移镜头（dx 向右、dy 向下，单位为世界像素） */
  moveCam(dx: number, dy: number): void {
    const c = this.cam, cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
    c.x += dx * cs + dy * sn;
    c.y += -dx * sn + dy * cs;
    this.clampCam();
  }

  clampCam(): void {
    const c = this.cam, w = this.world;
    c.zoom = Math.max(0.25, Math.min(3.2, c.zoom));
    c.pitch = Math.max(0.45, Math.min(1.4, c.pitch));
    c.x = Math.max(0, Math.min(w.W, c.x));
    c.y = Math.max(0, Math.min(w.H, c.y));
  }

  /** @param flag 是否插令旗：集结点本身就有一面常驻的旗，再插一面就成了两面 */
  addMarker(x: number, y: number, r: number, g: number, b: number, flag = true): void {
    this.markers.push({ x, y, t: 0, r, g, b, flag });
  }

  private spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, grow: number,
    r: number, g: number, b: number, a: number): void {
    if (this.pn >= MAXP) return;
    const p = this.pp, o = this.pn++ * 14;
    p[o] = x;
    p[o + 1] = y;
    p[o + 2] = z;
    p[o + 3] = vx;
    p[o + 4] = vy;
    p[o + 5] = vz;
    p[o + 6] = life;
    p[o + 7] = life;
    p[o + 8] = size;
    p[o + 9] = grow;
    p[o + 10] = r;
    p[o + 11] = g;
    p[o + 12] = b;
    p[o + 13] = a;
  }

  private inView(x: number, y: number, pad = 0): boolean {
    return x >= this.vx0 - pad && x <= this.vx1 + pad && y >= this.vy0 - pad && y <= this.vy1 + pad;
  }

  /** 建筑的实例矩阵与明暗：只在状态变化时重写 */
  private syncBuildings(fog: boolean): void {
    const w = this.world, blds = w.buildings, tick = w.tickCount;
    let dirty = false;
    if (blds.length > this.bldKinds.length) this.registerBuildings();
    for (let i = 0; i < blds.length; i++) {
      const b = blds[i];
      const known = !fog || w.explored[((b.cy / VIS_CELL) | 0) * w.vw + ((b.cx / VIS_CELL) | 0)] === 1;
      const sig = (b.alive ? 1 : 0) | (known ? 2 : 0) | (b.owner << 2) | (((b.hp / b.maxHp) * 6) | 0) << 4 | (tick - b.hitTick < 3 ? 128 : 0)
        | (b.lv << 8);
      if (sig !== this.bldSig[i]) {
        this.bldSig[i] = sig;
        dirty = true;
      }
    }
    if (!dirty) return;
    const m = this.m4, col = this.col;
    // 先数出每种模型要画几个（升级、倒塌、重建都会让建筑换到另一批里），再逐个写入
    const keyOf = (b: Building): string => {
      const kd = this.bldKinds[b.id];
      return !b.alive ? `rubble:${kd.rubble}` : kd.lvLook ? `${kd.key}:${b.lv}` : kd.key;
    };
    for (const g of this.bldGroups.values()) g.want = g.n = 0;
    const keys: string[] = new Array(blds.length);
    for (const b of blds) {
      if (!(this.bldSig[b.id] & 2)) continue;
      const key = (keys[b.id] = keyOf(b));
      const g = this.bldGroups.get(key);
      if (g) g.want++;
      else this.bldGroup(key, () => (b.alive ? this.bldKinds[b.id].geo(b.lv) : rubbleGeo(b.def.w, b.def.h, b.def.wood)), b.alive, 1).want = 1;
    }
    for (const [key, g] of this.bldGroups) if (g.want > g.cap) this.bldGroup(key, () => g.geo, g.mesh.castShadow, g.want);
    for (const b of blds) {
      const key = keys[b.id];
      if (!key) continue;
      const g = this.bldGroups.get(key)!;
      m.makeTranslation(b.cx, this.terrain.heightAt(b.cx, b.cy) - 0.4, b.cy);
      g.mesh.setMatrixAt(g.n, m);
      const k = b.alive ? 0.5 + 0.5 * (b.hp / b.maxHp) : 0.8;
      const fl = b.alive && this.bldSig[b.id] & 128 ? 0.35 : 0;
      g.mesh.setColorAt(g.n++, col.setRGB(k + fl, k * 0.97 + fl, k * 0.94 + fl));
    }
    for (const g of this.bldGroups.values()) {
      g.mesh.count = g.n;
      g.mesh.visible = g.n > 0;
      g.mesh.instanceMatrix.needsUpdate = true;
      if (g.mesh.instanceColor) g.mesh.instanceColor.needsUpdate = true;
    }
    let n = 0;
    for (const b of blds) {
      if (!b.alive || !b.owner || !(this.bldSig[b.id] & 2)) continue;
      const fh = flagHeight(b.def.key, b.style, b.lv);
      if (!fh) continue;
      m.makeTranslation(b.cx, this.terrain.heightAt(b.cx, b.cy) + fh - 22, b.cy);
      if (b.def.kind === BK_KEEP) m.scale(this.v.set(1.6, 1.6, 1.6));
      this.flags.setMatrixAt(n, m);
      this.flags.setColorAt(n++, this.teamLin[b.owner]);
    }
    this.flags.count = n;
    this.flags.instanceMatrix.needsUpdate = true;
    if (this.flags.instanceColor) this.flags.instanceColor.needsUpdate = true;
  }

  /** 昼夜与天气的画面表现：天光强弱与颜色、天空与雾色 */
  private applyEnvironment(): void {
    const env = this.world.env;
    // 雪天和雨天一样阴沉，只是天色发白
    const L = env.light, wet = Math.max(env.rain, env.snow * 0.8);
    const c = this.col;
    // 夜里改成偏蓝的月光；下雨时整体压暗、发灰
    this.sun.intensity = (0.32 + 2.08 * L) * (1 - wet * 0.45);
    this.sun.color.setRGB(0.56 + 0.44 * L, 0.66 + 0.28 * L, 1 - 0.16 * L);
    this.sky.intensity = (0.42 + 0.93 * L) * (1 - wet * 0.2);
    this.sky.color.setRGB(0.5 + 0.31 * L, 0.6 + 0.28 * L, 1);
    c.setRGB(0.05 + 0.57 * L, 0.07 + 0.64 * L, 0.13 + 0.64 * L).lerp(DULL, wet * 0.55 * (0.25 + 0.75 * L))
      .lerp(PALE, env.snow * 0.45 * (0.2 + 0.8 * L));
    (this.scene.background as THREE.Color).copy(c);
    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(c);
    fog.near = 6000 - wet * 3200;
    fog.far = 22000 - wet * 9000;
  }

  /** 雨丝：每帧在视野里随机撒一批斜线 */
  private drawRain(S: Quads): void {
    const wet = this.world.env.rain;
    if (wet <= 0.01) return;
    const n = Math.round(wet * 420);
    const sx = this.vx1 - this.vx0, sz = this.vy1 - this.vy0;
    const len = Math.max(22, this.dist * 0.035), wd = Math.max(0.5, this.dist * 0.0009);
    const top = this.dist * 0.55;
    for (let k = 0; k < n; k++) {
      const x = this.vx0 + Math.random() * sx, z = this.vy0 + Math.random() * sz;
      S.add(Q_AXIS, this.white, x, this.terrain.heightAt(x, z) + Math.random() * top, z, len, wd, 0.78, 0.84, 0.95, 0.28, 0.5, 0.5, 0.16, -1, 0.06);
    }
  }

  /** 雪花：一片固定在世界里、随时间下落的雪花场（不能每帧随机撒，会闪） */
  private drawSnow(S: Quads): void {
    const snow = this.world.env.snow;
    if (snow <= 0.01) return;
    const n = Math.round(snow * 520);
    const sx = this.vx1 - this.vx0, sz = this.vy1 - this.vy0;
    const top = this.dist * 0.5, size = Math.max(1.3, this.dist * 0.0028);
    const t = this.time;
    for (let k = 0; k < n; k++) {
      // 每片雪花有自己的落点、下落速度与飘摆相位；落点按视野范围取模，镜头移动时雪花留在原地
      const hx = Math.abs(Math.sin(k * 12.9898) * 43758.5453) % 1, hz = Math.abs(Math.sin(k * 78.233) * 24634.6345) % 1;
      const hp = Math.abs(Math.sin(k * 39.425) * 17231.137) % 1;
      const x = this.vx0 + ((((hx * 4096 + Math.sin(t * 0.7 + k) * 14 - this.vx0) % sx) + sx) % sx);
      const z = this.vy0 + ((((hz * 4096 + Math.cos(t * 0.5 + k * 1.7) * 14 - this.vy0) % sz) + sz) % sz);
      const fall = 1 - ((t * (0.05 + hp * 0.04) + hp * 7) % 1);
      S.add(Q_BILLBOARD, this.soft, x, this.terrain.heightAt(x, z) + fall * top, z, size, size, 1, 1, 1, 0.75 * Math.min(1, fall * 6));
    }
  }

  /** 夜里据点自动升起火把：塔楼、门楼顶上和主建筑门前各一处火光（废墟不点） */
  private drawSiteTorches(S: Quads, G: Quads, fog: boolean): void {
    const w = this.world;
    const dark = 1 - w.env.light;
    // 雨雪天火把点不着（随雨雪渐大熄灭）
    const wet = Math.min(1, Math.max(w.env.rain, w.env.snow) * 1.5);
    if (dark < 0.35 || wet >= 1) return;
    const k = Math.min(1, (dark - 0.35) / 0.3) * (1 - wet);
    const near = this.dist < 3200;
    for (const s of w.sites) {
      if (s.gone || s.disabled || !this.inView(s.x, s.y, 600)) continue;
      if (fog && w.explored[((s.y / VIS_CELL) | 0) * w.vw + ((s.x / VIS_CELL) | 0)] !== 1) continue;
      let i = 0;
      const flame = (x: number, y: number, z: number, size: number): void => {
        const fl = size * (1 + Math.sin(this.time * 15 + (i++) * 2.3 + s.id) * 0.22);
        S.add(Q_BILLBOARD, this.soft, x, y, z, fl * 2.1, fl * 2.6, 1, 0.5, 0.12, 0.85 * k);
        S.add(Q_BILLBOARD, this.soft, x, y - 0.5, z, fl, fl * 1.4, 1, 0.9, 0.55, k);
      };
      for (const id of s.buildings) {
        const b = w.buildings[id], kind = b.def.kind;
        if (!b.alive || !(this.bldSig[id] & 2)) continue;
        const main = id === s.main || kind === BK_KEEP || kind === BK_MAIN;
        if (kind !== BK_TOWER && !b.gate && !main) continue;
        const gy = this.terrain.heightAt(b.cx, b.cy);
        if (main) {
          // 主建筑：门前一左一右两个火盆
          for (const sx of [-1, 1]) flame(b.cx + sx * 13, gy + 9, b.y1 + 6, 8);
          if (near) G.add(Q_GROUND, this.soft, b.cx, gy, b.y1 + 18, 240, 200, 1, 0.62, 0.25, 0.3 * k);
        } else if (b.def.wood) {
          // 望楼、箭塔、营门：护栏边挑出一支火把
          flame(b.cx + 11, gy + (b.gate ? 30 : 36), b.cy + 11, 7);
          if (near) G.add(Q_GROUND, this.soft, b.cx + 11, gy, b.cy + 14, 190, 190, 1, 0.62, 0.25, 0.26 * k);
        } else {
          // 角楼、门楼：垛口四角各插一支
          const hx = (b.w * TILE) / 2 - 3, hz = (b.h * TILE) / 2 - 3;
          for (const sx of [-1, 1]) for (const sz of [-1, 1]) flame(b.cx + sx * hx, gy + 50, b.cy + sz * hz, 6.5);
          if (near) G.add(Q_GROUND, this.soft, b.cx, gy, b.cy, 330, 330, 1, 0.62, 0.25, 0.22 * k);
        }
      }
      // 旗下也点一堆篝火
      if (s.radius > 0 && SITE_INFO[s.type].captureTime > 0) {
        const gy = this.groundY(s.x, s.y);
        flame(s.x + 16, gy + 6, s.y + 9, 9);
        G.add(Q_GROUND, this.soft, s.x + 16, gy, s.y + 9, 260, 260, 1, 0.62, 0.25, 0.32 * k);
      }
    }
  }

  /** @param fewSel 选中数量较少时，为每个选中单位都画血条；否则只画受伤的 */
  render(alpha: number, dt: number, sel: Uint8Array, fewSel = true): void {
    this.resize();
    const w = this.world, cam = this.cam;
    this.time += dt;
    shared.uTime.value = this.time;
    // 积雪：下雪约半分钟铺满，雪停后化得慢一些
    const real0 = dt || 0;
    this.snowCover = Math.max(0, Math.min(1, this.snowCover + (w.env.snowing ? real0 / 28 : -real0 / 55)));
    shared.uSnow.value = this.snowCover;
    this.updateCamera();
    const d = this.dist;
    // 视野包围盒
    const q = this.viewQuad();
    this.vx0 = Math.min(q[0].x, q[1].x, q[2].x, q[3].x) - 60;
    this.vx1 = Math.max(q[0].x, q[1].x, q[2].x, q[3].x) + 60;
    this.vy0 = Math.min(q[0].y, q[1].y, q[2].y, q[3].y) - 60;
    this.vy1 = Math.max(q[0].y, q[1].y, q[2].y, q[3].y) + 120;

    const G = this.ground, S = this.sprites, O = this.overlay;
    G.begin();
    this.raised.begin();
    S.begin();
    O.begin();
    const fog = w.fog && w.humanTeam !== 0;
    const human = w.humanTeam;
    const vis = w.vis, expl = w.explored, vw = w.vw;
    const tick = w.tickCount;
    const white = this.white, soft = this.soft, ring = this.ring;
    const tc = this.teamColor;
    const near = d < 2600;
    const gy = (x: number, z: number): number => this.groundY(x, z);

    this.terrain.updateFog(fog, vis, expl, dt || 0.016);
    this.syncBuildings(fog);

    // ---------------- 特效事件 → 粒子 ----------------
    for (let k = 0; k < w.fxN; k++) {
      const o = k * 4;
      const kind = w.fx[o], fx = w.fx[o + 1], fz = w.fx[o + 2], a = w.fx[o + 3];
      if (!this.inView(fx, fz)) continue;
      if (fog && !vis[((fz / VIS_CELL) | 0) * vw + ((fx / VIS_CELL) | 0)]) continue;
      const R = Math.random;
      const y = gy(fx, fz);
      switch (kind) {
        case FX_HIT:
          if (near) this.spawn(fx, y + 11, fz, 0, 0, 0, 0.14, 3, 5, 1, 0.95, 0.7, 0.9);
          break;
        case FX_ARROW_HIT:
          this.spawn(fx, y + 2, fz, 0, 6, 0, 0.3, 2.5, 3, 0.8, 0.75, 0.6, 0.6);
          break;
        case FX_EXPLODE:
          this.spawn(fx, y + 5, fz, 0, 0, 0, 0.18, a * 1.1, a * 0.6, 1, 0.85, 0.5, 0.85);
          for (let j = 0; j < 7; j++) {
            const an = R() * 6.28, sp = 20 + R() * 55;
            this.spawn(fx, y + 3, fz, Math.cos(an) * sp, 14 + R() * 30, Math.sin(an) * sp, 0.5 + R() * 0.6, 5, 12, 0.56, 0.49, 0.38, 0.7);
          }
          this.spawn(fx, y + 8, fz, 0, 18, 0, 1.3, 9, 16, 0.3, 0.29, 0.28, 0.5);
          break;
        case FX_SMOKE:
          for (let j = 0; j < 3; j++) this.spawn(fx + R() * 4, y + 13, fz + R() * 4, (R() - 0.5) * 14, 8 + R() * 10, (R() - 0.5) * 14, 0.8 + R() * 0.7, 3.5 * a, 8 * a, 0.92, 0.92, 0.9, 0.5);
          break;
        case FX_DEATH:
          this.spawn(fx, y + 3, fz, (R() - 0.5) * 16, 6, (R() - 0.5) * 16, 0.5, a * 0.7, 6, 0.6, 0.54, 0.44, 0.5);
          break;
        case FX_LEVEL:
          // 升级：一圈金光
          if (near) {
            this.spawn(fx, y + 16, fz, 0, 26, 0, 0.7, 5, 9, 1, 0.85, 0.3, 0.9);
            this.spawn(fx, y + 4, fz, 0, 8, 0, 0.5, 9, 14, 1, 0.9, 0.5, 0.45);
          }
          break;
        case FX_IMPACT:
          for (let j = 0; j < 4; j++) {
            const an = R() * 6.28;
            this.spawn(fx, y + 6, fz, Math.cos(an) * 30, 12 + R() * 14, Math.sin(an) * 30, 0.45, a * 0.5, 9, 0.72, 0.66, 0.54, 0.6);
          }
          break;
        case FX_FIRE:
          // 火把砸中：一团火苗加黑烟
          this.spawn(fx, y + 10, fz, (R() - 0.5) * 8, 22, (R() - 0.5) * 8, 0.6, 5, -3, 1, 0.6, 0.15, 0.9);
          this.spawn(fx, y + 14, fz, 4, 16, 2, 1.2, 4, 10, 0.2, 0.19, 0.18, 0.4);
          break;
        case FX_UPGRADE:
          // 升为高级形态：脚下一圈金光，几点金星往上飘
          this.spawn(fx, y + 3, fz, 0, 4, 0, 0.6, a * 1.2, 16, 1, 0.84, 0.3, 0.55);
          if (near) for (let j = 0; j < 3; j++) this.spawn(fx + (R() - 0.5) * 8, y + 6 + R() * 8, fz + (R() - 0.5) * 8, 0, 22 + R() * 14, 0, 0.7 + R() * 0.3, 2.2, -1.5, 1, 0.92, 0.55, 0.95);
          break;
        case FX_BUILT:
          // 建筑落成 / 据点升级：一圈扬尘加金光
          for (let j = 0; j < 10 * a; j++) {
            const an = R() * 6.28, sp = 18 + R() * 30;
            this.spawn(fx + Math.cos(an) * a * 16, y + 2, fz + Math.sin(an) * a * 16, Math.cos(an) * sp, 10 + R() * 12, Math.sin(an) * sp, 0.9 + R() * 0.6, 7, 16, 0.72, 0.66, 0.54, 0.55);
          }
          for (let j = 0; j < 4 * a; j++) this.spawn(fx + (R() - 0.5) * a * 40, y + 10 + R() * 30, fz + (R() - 0.5) * a * 40, 0, 26, 0, 1.1, 4, 6, 1, 0.86, 0.35, 0.8);
          break;
        case FX_COLLAPSE:
          for (let j = 0; j < 8 * a; j++) {
            this.spawn(fx + (R() - 0.5) * a * 30, y + R() * 20, fz + (R() - 0.5) * a * 26, (R() - 0.5) * 30, 8 + R() * 16, (R() - 0.5) * 30, 1 + R() * 1.2, 8, 22, 0.62, 0.58, 0.52, 0.7);
          }
          break;
      }
    }
    w.fxN = 0;

    // ---------------- 据点：占领圈、旗帜、名称 ----------------
    let nf = 0;
    const m = this.m4;
    const wave = Math.sin(this.time * 3) * 0.12;
    for (const s of w.sites) {
      if (s.gone || !this.inView(s.x, s.y, 400)) continue;
      const known = !fog || expl[((s.y / VIS_CELL) | 0) * vw + ((s.x / VIS_CELL) | 0)] === 1;
      if (!known) continue;
      const c = tc[s.owner];
      const y = gy(s.x, s.y);
      const info = SITE_INFO[s.type];
      if (s.id === this.selSite) {
        // 选中的据点：一圈亮环；资源点另标出还空着的箭塔位
        const r = (s.radius > 0 ? s.radius : RULES.site.hqRadius) * 2 + 16 + Math.sin(this.time * 4) * 5;
        G.add(Q_GROUND, this.circle, s.x, y, s.y, r, r, 0.45, 1, 0.5, 1);
        for (const sl of s.slots) {
          if (sl.bld >= 0 && w.buildings[sl.bld].alive) continue;
          const px = (sl.tx + 0.5) * TILE, pz = (sl.ty + 0.5) * TILE;
          G.add(Q_GROUND, ring, px, gy(px, pz), pz, 34, 34, 1, 0.85, 0.35, 0.9);
        }
      }
      if (info.captureTime <= 0 && s.radius > 0) {
        // 临时据点：只画休整范围，没有可争夺的旗帜
        G.add(Q_GROUND, this.circle, s.x, y, s.y, s.radius * 2, s.radius * 2, c[0], c[1], c[2], 0.4);
      } else if (s.radius > 0) {
        G.add(Q_GROUND, this.circle, s.x, y, s.y, s.radius * 2, s.radius * 2, c[0], c[1], c[2], 0.55);
        // 旗帜区：进攻方要站进这个小圈才开始读秒；读秒进度从小圈向外扩到整个占领圈
        const fr = RULES.capture.flagRadius * 2;
        G.add(Q_GROUND, ring, s.x, y, s.y, fr * 1.17, fr * 1.17, 1, 1, 1, 0.35);
        if (s.capTeam) {
          const cc = tc[s.capTeam];
          const rr = fr + (s.radius * 2 - fr) * s.cap;
          G.add(Q_GROUND, this.circle, s.x, y, s.y, rr, rr, cc[0], cc[1], cc[2], 0.9);
        }
        m.makeRotationY(wave).scale(this.v.set(2.2, 2.2, 2.2)).setPosition(s.x, y, s.y);
        this.siteFlags.setMatrixAt(nf, m);
        this.siteFlags.setColorAt(nf++, this.teamLin[s.owner]);
      }
      const lb = this.labels[s.id] ?? this.outpostLabel;
      const dim = s.disabled ? 0.5 : 1;
      const ly = y + (s.type === SITE_HQ ? 150 : 62);
      O.add(Q_SCREEN, lb, s.x, ly, s.y, lb.w, lb.h, dim, dim, dim, 1, 0.5, 1);
      if (s.level) O.add(Q_SCREEN, this.star, s.x, ly, s.y, 15, 15, 1, 0.82, 0.25, 1, -(lb.w / 2 + 2) / 15, 1.23);
      O.add(Q_SCREEN, white, s.x, ly, s.y, 36, 4, 0.05, 0.05, 0.05, 0.75, 0.5, -0.5);
      O.add(Q_SCREEN, white, s.x, ly, s.y, 34, 2.4, c[0], c[1], c[2], 1, 0.5, -1.2);
      if (s.cap > 0 && s.capTeam) {
        const cc = tc[s.capTeam];
        O.add(Q_SCREEN, white, s.x, ly, s.y, 34 * s.cap, 2.4, cc[0], cc[1], cc[2], 1, 0.5 / s.cap, -1.2);
      }
    }
    // 倒塌后正在重建、修满之前不放箭的防御建筑：头顶一个禁射标记
    for (const b of w.buildings) {
      if (!b.down || !b.alive || !b.tower || !(this.bldSig[b.id] & 2) || !this.inView(b.cx, b.cy)) continue;
      O.add(Q_SCREEN, this.noShoot, b.cx, gy(b.cx, b.cy) + b.def.tall + 16, b.cy, 28, 28, 1, 1, 1, 0.95, 0.5, 0.5);
    }
    // 已下令、还没搭起来的临时据点：工地上一圈跳动的黄环
    for (const p of w.builds) {
      if (p.team !== human || !this.inView(p.x, p.y)) continue;
      const y = gy(p.x, p.y), r = 70 + Math.sin(this.time * 5) * 6;
      G.add(Q_GROUND, this.circle, p.x, y, p.y, r, r, 1, 0.85, 0.35, 0.9);
      G.add(Q_GROUND, ring, p.x, y, p.y, 30, 30, 1, 0.85, 0.35, 0.8);
    }
    // 集结点
    if (human) {
      const r = w.rally[human];
      if (this.inView(r.x, r.y)) {
        const y = gy(r.x, r.y);
        G.add(Q_GROUND, ring, r.x, y, r.y, 30, 30, 1, 0.9, 0.3, 0.8);
        m.makeRotationY(wave).scale(this.v.set(1.3, 1.3, 1.3)).setPosition(r.x, y, r.y);
        this.siteFlags.setMatrixAt(nf, m);
        this.siteFlags.setColorAt(nf++, this.teamLin[human]);
      }
    }
    this.siteFlags.count = nf;
    this.siteFlags.instanceMatrix.needsUpdate = true;
    if (this.siteFlags.instanceColor) this.siteFlags.instanceColor.needsUpdate = true;

    // ---------------- 单位 ----------------
    // 拉远后单位的影子小到看不清，省掉这一遍绘制
    const unitShadows = d < 2400;
    for (let tm = 1; tm <= 2; tm++) for (const b of this.batches[tm]) {
      if (!b) continue;
      b.begin();
      b.mesh.castShadow = unitShadows;
    }
    // 尸体
    const nc = Math.min(w.corpseN, MAX_CORPSE);
    const CORPSE_LIFE = 30 * 40;
    for (let c = 0; c < nc; c++) {
      const age = tick - w.cTick[c];
      if (age > CORPSE_LIFE) continue;
      const x = w.cX[c], z = w.cY[c];
      if (!this.inView(x, z)) continue;
      if (fog && !vis[((z / VIS_CELL) | 0) * vw + ((x / VIS_CELL) | 0)]) continue;
      const b = this.batches[w.cTeam[c]][w.cType[c]];
      if (!b) continue;
      const clip = this.clips[w.cTeam[c]][w.cType[c]]!.die;
      // 最后几秒沉入地面
      const sink = Math.max(0, (age - (CORPSE_LIFE - 150)) / 150);
      b.add(x, gy(x, z) - sink * 6, z, w.cDir[c], clip, (age + alpha) / (clip.n * 1.0), 0, 1, 0.72);
    }
    const showBars = d < 1900;
    const hbit = 1 << human;
    const dark = 1 - w.env.light;
    const n = w.n;
    let drawn = 0;
    for (let i = 0; i < n; i++) {
      if (!w.alive[i]) continue;
      const x = w.px[i] + (w.x[i] - w.px[i]) * alpha, z = w.py[i] + (w.y[i] - w.py[i]) * alpha;
      if (!this.inView(x, z)) continue;
      const tm = w.team[i];
      // 敌军要被己方看见才画（包括远处打着火把的）
      if (fog && tm !== human && !(w.seen[i] & hbit)) continue;
      const b = this.batches[tm][w.type[i]]!;
      const cl = this.clips[tm][w.type[i]]!;
      const def = UNITS[w.type[i]];
      const st = w.state[i];
      // 站上城墙的单位抬到墙顶，上下墙时平滑过渡
      const g0 = gy(x, z);
      const dky = st & S_WALL ? this.deckY(x, z) : NaN;
      const up = dky === dky ? dky - g0 : 0;
      let lf = this.lift[i];
      if (lf !== up) lf = this.lift[i] = Math.abs(up - lf) < 0.5 ? up : lf + (up - lf) * Math.min(1, (dt || 0.016) * 9);
      const y = g0 + lf;
      const aa = w.atkAnim[i];
      const sp2 = w.vx[i] * w.vx[i] + w.vy[i] * w.vy[i];
      let clip: Clip, ph: number;
      if (aa > 0) {
        clip = sp2 > 900 ? this.moveShot(i, cl) : cl.attack;
        ph = 1 - aa / 0.3;
      } else if (sp2 > 30) {
        // 走还是跑看实际速度；步幅与行进距离挂钩，脚下不打滑
        let name = sp2 > def.walk * def.walk * 1.3 ? 'run' : 'walk';
        if (st & S_CHARGE) name = 'charge';
        else if (st & S_SHIELD && !(st & S_ROUT)) name = 'guardWalk';
        clip = cl[name];
        ph = (w.odo[i] / (b.model.strides[name] ?? b.model.strides.walk ?? 28)) % 1;
      } else {
        clip = st & S_BRACE ? cl.brace : st & S_SHIELD ? cl.guard : cl.idle;
        ph = (this.time * 0.4 + i * 0.37) % 1;
      }
      const torch = (st & S_TORCH) !== 0;
      // 夜里打火把的被火光照亮
      b.add(x, y, z, w.dir[i], clip, ph, w.flash[i] > 0 ? 0.25 : 0, 1, torch ? 1 + dark * 0.9 : 1);
      if (torch) {
        const fl = 4.5 + Math.sin(this.time * 17 + i) * 1.2;
        const fy = y + Math.min(b.model.height, 26) + 3;
        S.add(Q_BILLBOARD, soft, x, fy, z, fl * 1.9, fl * 2.3, 1, 0.5, 0.12, 0.85);
        S.add(Q_BILLBOARD, soft, x, fy - 0.5, z, fl, fl * 1.3, 1, 0.9, 0.55, 1);
        if (near) G.add(Q_GROUND, soft, x, y, z, 70, 70, 1, 0.62, 0.25, 0.1 + dark * 0.12);
      }
      drawn++;
      const hr = w.hp[i] / w.maxHp[i];
      const top = b.model.height + 3;
      const lv = w.level[i];
      if (lv > 0 && showBars) {
        // 等级：头顶一排金色小点
        for (let k = 0; k < lv; k++) S.add(Q_BILLBOARD, white, x, y + top + 3.2, z, 1.7, 1.7, 1, 0.82, 0.25, 1, 0.5 - (k - (lv - 1) / 2) * 1.4, 0.5);
      }
      if (st & S_ROUT) {
        // 溃兵保持本队颜色，头顶插一面小白旗
        const sz = Math.max(8, d * 0.0075);
        S.add(Q_BILLBOARD, this.routIcon, x, y + top + 2, z, sz, sz, 1, 1, 1, 1, 0.5, 1);
      }
      if (sel[i]) {
        const r = def.radius * 2.6 + 5;
        this.flat(ring, x, y, z, r, r, 0.35, 1, 0.4, 0.95);
      }
      if (sel[i] && (fewSel || hr < 0.999)) {
        const bw = 10 + def.radius;
        S.add(Q_BILLBOARD, white, x, y + top, z, bw + 1.2, 2.6, 0, 0, 0, 0.75);
        S.add(Q_BILLBOARD, white, x, y + top, z, bw * hr, 1.6, 1 - hr, 0.35 + hr * 0.6, 0.2, 1, bw / 2 / (bw * hr || 1), 0.5);
      } else if (showBars && hr < 0.999) {
        const bw = 9 + def.radius * 0.6;
        S.add(Q_BILLBOARD, white, x, y + top, z, bw, 1.6, 0, 0, 0, 0.55);
        if (tm === human || !human) S.add(Q_BILLBOARD, white, x, y + top, z, bw * hr, 1.6, 0.3, 0.9, 0.3, 0.9, bw / 2 / (bw * hr || 1), 0.5);
        else S.add(Q_BILLBOARD, white, x, y + top, z, bw * hr, 1.6, 0.95, 0.3, 0.25, 0.9, bw / 2 / (bw * hr || 1), 0.5);
      }
    }
    for (let tm = 1; tm <= 2; tm++) for (const b of this.batches[tm]) b?.end();
    this.drawn = drawn;

    // ---------------- 建筑：血条与烟火 ----------------
    for (const b of w.buildings) {
      if (!b.alive || !this.inView(b.cx, b.cy, 100)) continue;
      if (!(this.bldSig[b.id] & 2)) continue;
      const def = b.def;
      const ratio = b.hp / b.maxHp;
      if (ratio >= 1) continue;
      const y = this.terrain.heightAt(b.cx, b.cy);
      const tall = def.tall * 1.3 + 14;
      if (ratio < 0.6 && Math.random() < (0.6 - ratio) * 0.25 * def.w) {
        const px = b.x0 + Math.random() * def.w * TILE, pz = b.y0 + Math.random() * def.h * TILE, py = y + tall * (0.5 + Math.random() * 0.5);
        if (ratio < 0.35) this.spawn(px, py, pz, (Math.random() - 0.5) * 8, 30, 0, 0.5, 6, -4, 1, 0.55, 0.15, 0.85);
        this.spawn(px, py + 4, pz, 6 + Math.random() * 6, 18, 3, 1.6, 6, 16, 0.22, 0.21, 0.2, 0.45);
      }
      if (tick - b.hitTick < 240) {
        const bw = Math.min(60, def.w * TILE * 0.8);
        S.add(Q_BILLBOARD, white, b.cx, y + tall + 8, b.cy, bw + 2, 5, 0, 0, 0, 0.7);
        S.add(Q_BILLBOARD, white, b.cx, y + tall + 8, b.cy, bw * ratio, 3, 1 - ratio, 0.3 + ratio * 0.6, 0.2, 1, bw / 2 / (bw * ratio || 1), 0.5);
      }
    }

    // ---------------- 投射物 ----------------
    const windOn = w.env.wind > 0, windX = Math.cos(w.env.windDir), windZ = Math.sin(w.env.windDir);
    for (let p = 0; p < w.pn; p++) {
      const t = Math.min(1, (w.pT[p] + alpha * DT) / w.pDur[p]);
      const sx = w.pSx[p], sz = w.pSy[p], dx = w.pTx[p] - sx, dz = w.pTy[p] - sz;
      // 有风时轻的投射物（箭、弩、标枪、火箭）半路被吹弯：中途顺风鼓出去一截，落点不变
      const type0 = w.pType[p];
      const bend = windOn && type0 !== P_STONE && type0 !== P_BALL && type0 !== P_BULLET && type0 !== P_TORCH
        ? Math.sqrt(dx * dx + dz * dz) * WIND_BEND * w.env.wind : 0;
      const bt = 4 * t * (1 - t);
      const x = sx + dx * t + windX * bend * bt, z = sz + dz * t + windZ * bend * bt;
      if (!this.inView(x, z)) continue;
      if (fog && !vis[((z / VIS_CELL) | 0) * vw + ((x / VIS_CELL) | 0)]) continue;
      const type = w.pType[p];
      const len = Math.sqrt(dx * dx + dz * dz) || 1;
      const arc = PROJ_ARC[type] * len;
      const y = gy(x, z) + arc * 4 * t * (1 - t) + 11;
      // 切线方向（含被风吹弯的那部分）
      const bd = bend * 4 * (1 - 2 * t);
      const ax = dx + windX * bd, ay = arc * 4 * (1 - 2 * t), az = dz + windZ * bd;
      if (type === P_TORCH) {
        S.add(Q_BILLBOARD, soft, x, y, z, 9, 11, 1, 0.5, 0.12, 0.9);
        S.add(Q_BILLBOARD, soft, x, y, z, 4.5, 6, 1, 0.9, 0.55, 1);
        if (Math.random() < 0.5) this.spawn(x, y, z, 0, 5, 0, 0.4, 2, 4, 0.3, 0.28, 0.26, 0.35);
      } else if (type === P_STONE || type === P_BALL) {
        const r = type === P_STONE ? 7 : 5;
        S.add(Q_BILLBOARD, soft, x, y, z, r * 1.6, r * 1.6, 0.16, 0.15, 0.14, 1);
        S.add(Q_BILLBOARD, soft, x, y, z, r, r, 0.42, 0.4, 0.38, 1);
        G.add(Q_GROUND, soft, x, gy(x, z), z, 14, 14, 0, 0, 0, 0.35);
      } else if (type === P_BULLET) {
        S.add(Q_AXIS, white, x, y, z, 16, 1.1, 1, 0.93, 0.7, 0.85, 0.5, 0.5, ax, ay, az);
      } else {
        const L = type === P_JAVELIN ? 15 : type === P_BIGBOLT ? 20 : type === P_ROCKET ? 13 : type === P_BOLT ? 8 : 10;
        const wd = type === P_BIGBOLT ? 1.6 : type === P_JAVELIN ? 1.2 : 0.9;
        S.add(Q_AXIS, white, x, y, z, L, wd, 0.36, 0.27, 0.17, 1, 0.5, 0.5, ax, ay, az);
        S.add(Q_AXIS, white, x, y, z, 2.6, wd * 1.5, 0.82, 0.84, 0.86, 1, -L / 5.2 + 0.5, 0.5, ax, ay, az);
        if (type === P_ROCKET && Math.random() < 0.6) this.spawn(x, y, z, 0, 4, 0, 0.5, 2.5, 5, 0.85, 0.82, 0.78, 0.45);
      }
    }

    // ---------------- 粒子 ----------------
    const pp = this.pp;
    for (let k = 0; k < this.pn; k++) {
      const o = k * 14;
      pp[o + 6] -= dt;
      if (pp[o + 6] <= 0) {
        const qo = --this.pn * 14;
        for (let j = 0; j < 14; j++) pp[o + j] = pp[qo + j];
        k--;
        continue;
      }
      pp[o] += pp[o + 3] * dt;
      pp[o + 1] += pp[o + 4] * dt;
      pp[o + 2] += pp[o + 5] * dt;
      const damp = 1 - dt * 1.5;
      pp[o + 3] *= damp;
      pp[o + 4] *= damp;
      pp[o + 5] *= damp;
      const life = pp[o + 6] / pp[o + 7];
      const size = Math.max(0.5, pp[o + 8] + pp[o + 9] * (1 - life)) * 2;
      S.add(Q_BILLBOARD, soft, pp[o], pp[o + 1], pp[o + 2], size, size, pp[o + 10], pp[o + 11], pp[o + 12], pp[o + 13] * Math.min(1, life * 1.6));
    }

    // ---------------- 指令标记 ----------------
    // 每道号令的落点：一圈扩散的光环 + 一面令旗（停留片刻后收起）
    let ncf = 0;
    const real = dt || 0.016;
    for (let k = this.markers.length - 1; k >= 0; k--) {
      const mk = this.markers[k];
      mk.t += real;
      if (mk.t >= MARKER_LIFE) {
        this.markers.splice(k, 1);
        continue;
      }
      const y = this.surfaceY(mk.x, mk.y);
      const zoomK = Math.max(0.8, d / 1500);
      const rt = mk.t / 0.5;
      if (rt < 1) {
        const sz = (18 + 26 * rt) * zoomK;
        this.flat(ring, mk.x, y, mk.y, sz * 1.7, sz * 1.7, mk.r, mk.g, mk.b, 1 - rt);
        this.flat(ring, mk.x, y, mk.y, sz * 0.9, sz * 0.9, mk.r, mk.g, mk.b, (1 - rt) * 0.8);
      }
      this.flat(ring, mk.x, y, mk.y, 16 * zoomK, 16 * zoomK, mk.r, mk.g, mk.b, 0.7 * Math.min(1, (MARKER_LIFE - mk.t) / 0.4));
      if (mk.flag && ncf < MAX_CMD_FLAGS) {
        // 插下去时弹一下，收起时缩回地里
        const pop = mk.t < 0.18 ? mk.t / 0.18 * 1.15 : mk.t < 0.26 ? 1.15 - (mk.t - 0.18) / 0.08 * 0.15 : Math.min(1, (MARKER_LIFE - mk.t) / 0.3);
        const sc = pop * zoomK * 1.25;
        m.makeRotationY(cam.yaw + wave * 0.5).scale(this.v.set(sc, sc, sc)).setPosition(mk.x, y, mk.y);
        this.cmdFlags.setMatrixAt(ncf, m);
        this.cmdFlags.setColorAt(ncf++, this.col.setRGB(mk.r, mk.g, mk.b, THREE.SRGBColorSpace));
      }
    }
    this.cmdFlags.count = ncf;
    this.cmdFlags.instanceMatrix.needsUpdate = true;
    if (this.cmdFlags.instanceColor) this.cmdFlags.instanceColor.needsUpdate = true;
    // 拖动指定队列朝向时的箭头
    const ar = this.arrow;
    if (ar) {
      const ax = ar.x1 - ar.x0, az = ar.y1 - ar.y0;
      const al = Math.hypot(ax, az);
      if (al > 4) {
        const ux = ax / al, uz = az / al;
        const y0 = this.surfaceY(ar.x0, ar.y0) + 2.5;
        const wd = Math.max(2.4, d * 0.0022), hd = wd * 4.5;
        S.add(Q_AXIS, white, ar.x0 + ax / 2, y0, ar.y0 + az / 2, al, wd, 1, 0.92, 0.45, 0.95, 0.5, 0.5, ax, 0, az);
        for (const s of [-1, 1]) {
          // 箭头两翼
          const bx = -ux * 0.8 + -uz * s * 0.6, bz = -uz * 0.8 + ux * s * 0.6;
          S.add(Q_AXIS, white, ar.x1 + bx * hd / 2, y0, ar.y1 + bz * hd / 2, hd, wd, 1, 0.92, 0.45, 0.95, 0.5, 0.5, bx, 0, bz);
        }
      }
    }
    this.drawRain(S);
    this.drawSnow(S);
    this.drawSiteTorches(S, G, fog);
    this.raised.end(this.viewW, this.viewH);
    G.end(this.viewW, this.viewH);
    S.end(this.viewW, this.viewH);
    O.end(this.viewW, this.viewH);

    // ---------------- 阳光与阴影范围 ----------------
    const ext = Math.min(2600, Math.max(260, d * 0.62));
    const ty = this.groundY(cam.x, cam.y);
    // 阴影范围的中心放在视野中心稍偏远处
    const cs = Math.cos(cam.yaw), sn = Math.sin(cam.yaw);
    const fwd = d * Math.cos(cam.pitch) * 0.25;
    const cx = cam.x - sn * fwd, cz = cam.y - cs * fwd;
    this.sun.target.position.set(cx, ty, cz);
    this.sun.position.set(cx - 0.55 * 3000, ty + 0.75 * 3000, cz + 0.42 * 3000);
    this.applyEnvironment();
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -ext;
    sc.right = sc.top = ext;
    sc.near = 100;
    sc.far = 7000;
    sc.updateProjectionMatrix();
    this.sun.target.updateMatrixWorld();

    this.three.render(this.scene, this.camera);
  }
}
