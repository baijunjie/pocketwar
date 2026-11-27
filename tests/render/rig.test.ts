import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { luma } from '../../src/render/assets';
import { RigBuilder, TEAM_MARK, markTeam } from '../../src/render/rig';

function colored(colors: [number, number, number][]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors.flat()), 3));
  return g;
}

describe('markTeam', () => {
  it('品红标记（g = 0、r = b > 0）记为队伍色部位，颜色换成灰度 r', () => {
    const g = colored([[0.5, 0, 0.5], [1, 0, 1], [0.25, 0, 0.25]]);
    markTeam(g);
    const team = g.getAttribute('aTeam'), col = g.getAttribute('color');
    expect(team.itemSize).toBe(1);
    expect(team.count).toBe(3);
    for (let i = 0; i < 3; i++) expect(team.getX(i)).toBe(1);
    const grays = [0.5, 1, 0.25];
    grays.forEach((v, i) => {
      expect(col.getX(i)).toBeCloseTo(v, 6);
      expect(col.getY(i)).toBeCloseTo(v, 6);
      expect(col.getZ(i)).toBeCloseTo(v, 6);
    });
  });

  it('明度极小的标记（刚好大于 0）也算', () => {
    const g = colored([[1e-4, 0, 1e-4]]);
    markTeam(g);
    expect(g.getAttribute('aTeam').getX(0)).toBe(1);
    expect(g.getAttribute('color').getY(0)).toBeCloseTo(1e-4, 8);
  });

  it('真实颜色不标记、颜色不变', () => {
    const real: [number, number, number][] = [
      [0, 0, 0], [1, 0, 0], [0, 0, 1], [0.5, 0.1, 0.5], [0.5, 0, 0.4], [0.3, 0.3, 0.3], [0, 1, 0], [0.8, 0.5, 0.2],
    ];
    const g = colored(real);
    markTeam(g);
    const team = g.getAttribute('aTeam'), col = g.getAttribute('color');
    real.forEach((c, i) => {
      expect(team.getX(i), `${c}`).toBe(0);
      expect(col.getX(i)).toBeCloseTo(c[0], 6);
      expect(col.getY(i)).toBeCloseTo(c[1], 6);
      expect(col.getZ(i)).toBeCloseTo(c[2], 6);
    });
  });

  it('混合时逐顶点判断', () => {
    const g = colored([[0.8, 0.5, 0.2], [0.4, 0, 0.4], [0, 0, 0]]);
    markTeam(g);
    const team = g.getAttribute('aTeam');
    expect([team.getX(0), team.getX(1), team.getX(2)]).toEqual([0, 1, 0]);
  });

  it('TEAM_MARK 是纯品红，能被识别；luma 按线性明度权重', () => {
    expect([TEAM_MARK.r, TEAM_MARK.g, TEAM_MARK.b]).toEqual([1, 0, 1]);
    const g = colored([[TEAM_MARK.r, TEAM_MARK.g, TEAM_MARK.b]]);
    markTeam(g);
    expect(g.getAttribute('aTeam').getX(0)).toBe(1);
    expect(luma(new THREE.Color(1, 1, 1))).toBeCloseTo(1, 6);
    expect(luma(new THREE.Color(0, 0, 0))).toBe(0);
    expect(luma(new THREE.Color(1, 0, 0))).toBeCloseTo(0.2126, 6);
    expect(luma(new THREE.Color(0, 1, 0))).toBeCloseTo(0.7152, 6);
  });
});

/** 一根两节骨骼（root → child，child 在 y = 1）加上若干网格，挂在 builder 的根下 */
function makeRig(rb: RigBuilder) {
  const root = new THREE.Bone(), child = new THREE.Bone();
  root.name = 'root';
  child.name = 'child';
  child.position.set(0, 1, 0);
  root.add(child);
  root.updateMatrixWorld(true);
  const bones = [root, child];
  const inverses = bones.map(b => new THREE.Matrix4().copy(b.matrixWorld).invert());
  const scene = new THREE.Group();
  scene.add(root);
  rb.root.add(scene);

  /** 一个三角形网格：全部顶点跟随 bone，坐标整体偏移 dx 以便区分 */
  const tri = (bone: 0 | 1, dx: number, mat: THREE.MeshStandardMaterial, skeleton?: THREE.Skeleton, inv = inverses): THREE.SkinnedMesh => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([dx, 0, 0, dx + 0.5, 0, 0, dx, 0.5, 0]), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Array(12).fill(0).map((_, i) => (i % 4 === 0 ? bone : 0)), 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Array(12).fill(0).map((_, i) => (i % 4 === 0 ? 1 : 0)), 4));
    const m = new THREE.SkinnedMesh(g, mat);
    scene.add(m);
    m.bind(skeleton ?? new THREE.Skeleton(bones, inv), new THREE.Matrix4());
    return m;
  };
  return { root, child, bones, inverses, scene, tri };
}

const material = (name: string, r: number, g: number, b: number): THREE.MeshStandardMaterial => {
  const m = new THREE.MeshStandardMaterial();
  m.name = name;
  m.color.setRGB(r, g, b);
  return m;
};

/** 模型里每个顶点的 [位置, 骨骼列] */
function vertices(geometry: THREE.BufferGeometry): { pos: THREE.Vector3; col: number; i: number }[] {
  const pos = geometry.getAttribute('position'), ab = geometry.getAttribute('aBone');
  return Array.from({ length: pos.count }, (_, i) => ({ pos: new THREE.Vector3().fromBufferAttribute(pos, i), col: ab.getX(i), i }));
}

/** 贴图第 row 行、第 col 列骨骼的平移 */
function translation(tex: THREE.DataTexture, row: number, col: number): THREE.Vector3 {
  const data = tex.image.data as unknown as Float32Array;
  const o = (row * tex.image.width * 4) + col * 16;
  return new THREE.Vector3(data[o + 12], data[o + 13], data[o + 14]);
}

describe('RigBuilder.clip', () => {
  it('帧数 = 秒数 × fps，多录一帧（第 n 帧），后一段紧接在前一段的多录帧之后', () => {
    const rb = new RigBuilder();
    const { child, tri, scene } = makeRig(rb);
    tri(1, 0, material('a', 0.5, 0.5, 0.5));
    rb.addSkinned(scene);
    const calls: [number, number][] = [];
    rb.clip('a', 1, (t, k) => { calls.push([t, k]); child.position.y = 1 + t; }, 10);
    rb.clip('b', 0.5, () => {}, 10);
    const m = rb.build();
    expect(m.clips.a).toEqual({ start: 0, n: 10, seconds: 1 });
    expect(m.clips.b).toEqual({ start: 11, n: 5, seconds: 0.5 });
    expect(calls.length).toBe(11);
    expect(calls[0]).toEqual([0, 0]);
    expect(calls[10][0]).toBeCloseTo(1, 9);
    expect(calls[10][1]).toBeCloseTo(1, 9);
    expect(m.bones.image.height).toBe(11 + 6);
  });

  it('很短的动作至少 1 帧', () => {
    const rb = new RigBuilder();
    const { tri, scene } = makeRig(rb);
    tri(0, 0, material('a', 0.5, 0.5, 0.5));
    rb.addSkinned(scene);
    rb.clip('blink', 0.001, () => {}, 30);
    const m = rb.build();
    expect(m.clips.blink.n).toBe(1);
    expect(m.bones.image.height).toBe(2);
  });

  it('贴图里第 n 行记的是第 seconds 秒的姿势', () => {
    const rb = new RigBuilder();
    const { child, tri, scene } = makeRig(rb);
    tri(1, 0, material('a', 0.5, 0.5, 0.5));
    rb.addSkinned(scene);
    // 子骨骼上抬 t 米；绑定姿势在 y = 1，逆绑定矩阵抵消，所以贴图里的平移就是 t
    rb.clip('lift', 1, t => { child.position.y = 1 + t; }, 4);
    const m = rb.build();
    const v = vertices(m.geometry)[0];
    const clip = m.clips.lift;
    expect(clip.n).toBe(4);
    for (let f = 0; f <= clip.n; f++) {
      expect(translation(m.bones, clip.start + f, v.col).y).toBeCloseTo(f / clip.n, 5);
    }
  });
});

describe('RigBuilder.alias', () => {
  function recorded(): RigBuilder {
    const rb = new RigBuilder();
    const { tri, scene } = makeRig(rb);
    tri(0, 0, material('a', 0.5, 0.5, 0.5));
    rb.addSkinned(scene);
    return rb;
  }

  it('新名字指向已录好的动作（同一个 Clip），不多占贴图的行', () => {
    const rb = recorded();
    rb.clip('walk', 0.5, () => {}, 10);
    rb.alias('guardWalk', 'walk');
    rb.clip('run', 0.3, () => {}, 10);
    const m = rb.build();
    expect(m.clips.guardWalk).toBe(m.clips.walk);
    expect(m.clips.guardWalk.start).toBe(0);
    expect(m.clips.run.start).toBe(6);
    expect(m.bones.image.height).toBe(6 + 4);
  });
});

describe('RigBuilder.addSkinned', () => {
  const FRAME_CLIP = (rb: RigBuilder): void => rb.clip('idle', 0.1, () => {}, 10);

  it('同一副骨架拆成多个网格（同一个 Skeleton）时骨骼贴图列数不随网格数增加', () => {
    const rb = new RigBuilder();
    const { bones, inverses, tri, scene } = makeRig(rb);
    const sk = new THREE.Skeleton(bones, inverses);
    tri(0, 0, material('cloth', 0.2, 0.3, 0.4), sk);
    tri(1, 2, material('metal', 0.5, 0.5, 0.5), sk);
    tri(1, 4, material('skin', 0.8, 0.6, 0.5), sk);
    rb.addSkinned(scene);
    FRAME_CLIP(rb);
    const m = rb.build();
    expect(m.bones.image.width).toBe(2 * 4);
    expect(Math.max(...vertices(m.geometry).map(v => v.col))).toBe(1);
  });

  it('各网格各有一个 Skeleton，但骨骼与逆绑定矩阵都相同，也共用列', () => {
    const rb = new RigBuilder();
    const { tri, scene } = makeRig(rb);
    tri(0, 0, material('cloth', 0.2, 0.3, 0.4));
    tri(1, 2, material('metal', 0.5, 0.5, 0.5));
    tri(1, 4, material('skin', 0.8, 0.6, 0.5));
    rb.addSkinned(scene);
    FRAME_CLIP(rb);
    const m = rb.build();
    expect(m.bones.image.width).toBe(2 * 4);
    expect(vertices(m.geometry).length).toBe(9);
  });

  it('同一根骨骼但逆绑定矩阵不同，不能共用列', () => {
    const rb = new RigBuilder();
    const { bones, inverses, tri, scene } = makeRig(rb);
    tri(1, 0, material('a', 0.5, 0.5, 0.5));
    const shifted = inverses.map(m => new THREE.Matrix4().copy(m).premultiply(new THREE.Matrix4().makeTranslation(0, 0, 3)));
    tri(1, 2, material('b', 0.5, 0.5, 0.5), new THREE.Skeleton(bones, shifted));
    rb.addSkinned(scene);
    FRAME_CLIP(rb);
    const m = rb.build();
    // 第二个 Skeleton 的两根骨骼逆绑定矩阵都不同，各占一列
    expect(m.bones.image.width).toBe(4 * 4);
    const cols = new Set(vertices(m.geometry).map(v => v.col));
    expect(cols.size).toBe(2);
  });

  it('共用列后每个顶点仍取到自己骨骼的矩阵', () => {
    const rb = new RigBuilder();
    const { child, tri, scene } = makeRig(rb);
    tri(0, 0, material('a', 0.5, 0.5, 0.5));
    tri(1, 2, material('b', 0.5, 0.5, 0.5));
    rb.addSkinned(scene);
    rb.clip('lift', 1, t => { child.position.y = 1 + t; }, 2);
    const m = rb.build();
    const vs = vertices(m.geometry);
    const onRoot = vs.find(v => v.pos.x === 0 && v.pos.y === 0)!;
    const onChild = vs.find(v => v.pos.x === 2 && v.pos.y === 0)!;
    expect(translation(m.bones, 2, onRoot.col).y).toBeCloseTo(0, 6);
    expect(translation(m.bones, 2, onChild.col).y).toBeCloseTo(1, 6);
  });

  it('team 开头的材质染队伍色：灰度 = 明度、aTeam = 1，其余材质保持原色、aTeam = 0', () => {
    const rb = new RigBuilder();
    const { tri, scene } = makeRig(rb);
    const cloth = material('team_cloth', 0.8, 0.2, 0.2), metal = material('metal', 0.5, 0.6, 0.7);
    tri(0, 0, cloth);
    tri(1, 2, metal);
    rb.addSkinned(scene);
    FRAME_CLIP(rb);
    const m = rb.build();
    const team = m.geometry.getAttribute('aTeam'), col = m.geometry.getAttribute('color');
    const l = luma(cloth.color);
    for (const v of vertices(m.geometry)) {
      if (v.pos.x < 1) {
        expect(team.getX(v.i)).toBe(1);
        for (const c of [col.getX(v.i), col.getY(v.i), col.getZ(v.i)]) expect(c).toBeCloseTo(l, 5);
      } else {
        expect(team.getX(v.i)).toBe(0);
        expect(col.getX(v.i)).toBeCloseTo(0.5, 5);
        expect(col.getY(v.i)).toBeCloseTo(0.6, 5);
        expect(col.getZ(v.i)).toBeCloseTo(0.7, 5);
      }
    }
  });

  it('骨骼下不蒙皮的网格（兵器）作为刚性部件跟着自己的节点走', () => {
    const rb = new RigBuilder();
    const { child, tri, scene } = makeRig(rb);
    tri(0, -3, material('body', 0.5, 0.5, 0.5));
    const weapon = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), material('metal', 0.7, 0.7, 0.7));
    weapon.position.set(5, 0, 0);
    child.add(weapon);
    rb.addSkinned(scene);
    rb.clip('lift', 1, t => { child.position.y = 1 + t; }, 2);
    const m = rb.build();
    // 兵器的顶点在它自己节点的局部坐标里（围着原点）；贴图给的是该节点的世界矩阵：第 2 行（t = 1）时平移 (5, 2, 0)
    const w = vertices(m.geometry).filter(v => Math.abs(v.pos.x) <= 0.06);
    expect(w.length).toBeGreaterThan(0);
    for (const v of w) {
      expect(translation(m.bones, 2, v.col).x).toBeCloseTo(5, 6);
      expect(translation(m.bones, 2, v.col).y).toBeCloseTo(2, 6);
    }
    const body = vertices(m.geometry).find(v => v.pos.x < -2)!;
    expect(translation(m.bones, 2, body.col).y).toBeCloseTo(0, 6);
  });
});
