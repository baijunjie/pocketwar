import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mountedModel, rigModel } from '../../../src/render/models/gltf';
import { M } from '../../../src/render/models/builders';
import { parseManifest, type Manifest, type MountedSpec, type RigSpec } from '../../../src/render/models/manifest';
import type { UnitModel } from '../../../src/render/rig';

const store = vi.hoisted(() => new Map<string, unknown>());
vi.mock('../../../src/render/assets', async importOriginal => ({
  ...await importOriginal<typeof import('../../../src/render/assets')>(),
  asset: (p: string) => {
    const g = store.get(p);
    if (!g) throw new Error(`模型未加载：${p}`);
    return g;
  },
}));

/** 动作：子骨骼的 y 从 0 匀速升到 1，时长 seconds（线性插值，所以贴图里各帧的位移与姿势时刻成正比） */
function anim(name: string, seconds: number): THREE.AnimationClip {
  return new THREE.AnimationClip(name, seconds, [new THREE.VectorKeyframeTrack('arm.position', [0, seconds], [0, 0, 0, 0, 1, 0])]);
}

/** 假 glTF：根骨骼（root）下挂 arm（和可选 saddle），一个蒙在 root 上的小三角形 */
function fakeGltf(animations: THREE.AnimationClip[], extra: string[] = []): { scene: THREE.Group; animations: THREE.AnimationClip[] } {
  const root = new THREE.Bone(), arm = new THREE.Bone();
  root.name = 'root';
  arm.name = 'arm';
  root.add(arm);
  const bones = [root, arm];
  for (const n of extra) {
    const b = new THREE.Bone();
    b.name = n;
    b.position.set(0, 1, 0);
    root.add(b);
    bones.push(b);
  }
  root.updateMatrixWorld(true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 0.5, 0, 0, 0, 0.5, 0]), 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Array(12).fill(0), 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  const mesh = new THREE.SkinnedMesh(g, new THREE.MeshStandardMaterial());
  const scene = new THREE.Group();
  scene.add(root, mesh);
  mesh.bind(new THREE.Skeleton(bones, bones.map(b => new THREE.Matrix4().copy(b.matrixWorld).invert())), new THREE.Matrix4());
  return { scene, animations };
}

function manifest(models: Record<string, unknown>): Manifest {
  return parseManifest({ libraries: { lib: 'lib.glb', horse: 'horse-lib.glb' }, models });
}

const ROW_ARM = (m: UnitModel, row: number, col = 1): number => {
  // 第 row 行里第 col 列骨骼（缺省是 arm）的位移长度
  const data = m.bones.image.data as unknown as Float32Array;
  const o = row * m.bones.image.width * 4 + col * 16;
  return Math.hypot(data[o + 12], data[o + 13], data[o + 14]);
};
const distinctStarts = (m: UnitModel): number => new Set(Object.values(m.clips).map(c => c.start)).size;
const rows = (m: UnitModel): number => m.bones.image.height;

beforeEach(() => store.clear());

describe('rigModel', () => {
  const lib = (): THREE.AnimationClip[] => [anim('s.idle', 1), anim('s.walk', 1), anim('s.attack', 0.8), anim('s.die', 1.2)];
  const spec = (extra: Record<string, unknown> = {}): RigSpec =>
    ({ kind: 'rig', src: 'm.glb', anims: 'lib', set: 's', ...extra }) as RigSpec;
  const load = (animations = lib()): void => {
    store.set('m.glb', fakeGltf([]));
    store.set('lib.glb', fakeGltf(animations));
  };
  const build = (extra: Record<string, unknown> = {}): UnitModel => rigModel(manifest({ x: spec(extra) }), spec(extra));

  it('素材里有的动作各录一段，时长取素材时长', () => {
    load();
    const m = build();
    expect(m.clips.idle.seconds).toBeCloseTo(1, 6);
    expect(m.clips.walk.seconds).toBeCloseTo(1, 6);
    expect(m.clips.attack.seconds).toBeCloseTo(0.8, 6);
    expect(m.clips.die.seconds).toBeCloseTo(1.2, 6);
  });

  it('每个标准动作都有（缺的按姿态内的退路找到素材）', () => {
    load();
    const m = build();
    for (const a of ['idle', 'ready', 'walk', 'run', 'attack', 'attack2', 'attack3', 'attack4', 'attackMove', 'attackMoveL', 'attackMoveR', 'attackMoveBL',
      'attackMoveBR', 'die', 'charge', 'brace', 'guard', 'guardWalk']) expect(m.clips[a], a).toBeDefined();
  });

  it('同一段素材（同名、同时长、同样循环与否）只录一次，其余标准动作名指向它', () => {
    load();
    const m = build();
    // 没有 attack2/3/4 的素材：都指向 attack
    for (const a of ['attack2', 'attack3', 'attack4']) expect(m.clips[a], a).toEqual(m.clips.attack);
    // 指向待命：ready、brace、guard；指向行走：run、charge、guardWalk；指向出手：四个回身射击
    for (const a of ['ready', 'brace', 'guard']) expect(m.clips[a], a).toEqual(m.clips.idle);
    for (const a of ['run', 'charge', 'guardWalk']) expect(m.clips[a], a).toEqual(m.clips.walk);
    for (const a of ['attackMoveL', 'attackMoveR', 'attackMoveBL', 'attackMoveBR']) expect(m.clips[a], a).toEqual(m.clips.attack);
    // 边跑边打是循环动作，同一段素材不能与非循环的出手共用
    expect(m.clips.attackMove.start).not.toBe(m.clips.attack.start);
    expect(distinctStarts(m)).toBe(5);
  });

  it('素材有自己的 attack2：单独录一段（也是播一遍就停），attack3、attack4 仍指向 attack', () => {
    load([...lib(), anim('s.attack2', 0.9)]);
    const m = build();
    expect(m.clips.attack2.start).not.toBe(m.clips.attack.start);
    expect(m.clips.attack2.seconds).toBeCloseTo(0.9, 6);
    expect(m.clips.attack3).toEqual(m.clips.attack);
    expect(m.clips.attack4).toEqual(m.clips.attack);
    const c = m.clips.attack2;
    const a0 = ROW_ARM(m, c.start), half = ROW_ARM(m, c.start + c.n / 2), end = ROW_ARM(m, c.start + c.n);
    expect((end - a0) / (half - a0)).toBeGreaterThan(1.98);
    expect(distinctStarts(m)).toBe(6);
  });

  it('同一段素材分给两个变体（clips 指定）只录一次', () => {
    load([...lib(), anim('s.attack2', 0.9)]);
    const m = build({ clips: { attack3: 's.attack2' } });
    expect(m.clips.attack3).toEqual(m.clips.attack2);
    expect(m.clips.attack4).toEqual(m.clips.attack);
  });

  it('只录不同的几段，骨骼贴图不为别名多占行', () => {
    load();
    const m = build();
    const distinct = new Map(Object.values(m.clips).map(c => [c.start, c.n]));
    let total = 0;
    for (const n of distinct.values()) total += n + 1;
    expect(rows(m)).toBe(total);
  });

  it('循环动作首尾相接：多录的第 n 帧回到第 0 帧', () => {
    load();
    const m = build();
    const c = m.clips.walk;
    expect(ROW_ARM(m, c.start + c.n)).toBeCloseTo(ROW_ARM(m, c.start), 4);
    expect(ROW_ARM(m, c.start + Math.floor(c.n / 2))).not.toBeCloseTo(ROW_ARM(m, c.start), 2);
  });

  it('非循环动作（阵亡、出手）停在素材末尾而不是绕回第 0 帧', () => {
    load();
    const m = build();
    for (const name of ['die', 'attack']) {
      const c = m.clips[name];
      const a0 = ROW_ARM(m, c.start), half = ROW_ARM(m, c.start + c.n / 2), end = ROW_ARM(m, c.start + c.n);
      expect(end - a0, name).toBeGreaterThan(0);
      // 位移与时刻成正比：末帧约是中点的两倍（取到素材时长的 0.999 为止，不会取模回 0）
      expect((end - a0) / (half - a0), name).toBeGreaterThan(1.98);
      expect((end - a0) / (half - a0), name).toBeLessThanOrEqual(2.0001);
    }
  });

  it('clips 给了 seconds 就按它截取，且不短于 0.1 秒', () => {
    load();
    expect(build({ clips: { attack: { name: 's.attack', seconds: 0.4 } } }).clips.attack.seconds).toBeCloseTo(0.4, 6);
    expect(build({ clips: { attack: { name: 's.attack', seconds: 0.01 } } }).clips.attack.seconds).toBeCloseTo(0.1, 6);
  });

  it('时长不同的同名素材动作不合并', () => {
    load();
    const m = build({ clips: { attack: { name: 's.attack', seconds: 0.4 } } });
    // attackMoveL 等仍按 s.attack 原时长，与被截短的 attack 不是同一段
    expect(m.clips.attackMoveL.start).not.toBe(m.clips.attack.start);
    expect(m.clips.attackMoveL.seconds).toBeCloseTo(0.8, 6);
  });

  it('clips 指到素材里没有的动作时抛错，指出该动作与可用的动作', () => {
    load();
    expect(() => build({ clips: { attack: 'nope' } })).toThrow(/nope.*s\.idle/);
  });

  it('一个标准动作都找不到时抛错', () => {
    load([anim('other.dance', 1)]);
    expect(() => build()).toThrow(/没有任何标准动作.*other\.dance/);
  });

  it('模型自带的动作也能用，同名时以模型自带的为准', () => {
    store.set('m.glb', fakeGltf([anim('idle', 2)]));
    store.set('lib.glb', fakeGltf([anim('idle', 5), anim('walk', 1)]));
    const m = rigModel(manifest({ x: { kind: 'rig', src: 'm.glb', anims: 'lib' } }), { kind: 'rig', src: 'm.glb', anims: 'lib' });
    expect(m.clips.idle.seconds).toBeCloseTo(2, 6);
    expect(m.clips.walk.seconds).toBeCloseTo(1, 6);
  });

  it('不带 anims 时只用模型自带的动作', () => {
    store.set('m.glb', fakeGltf([anim('idle', 1), anim('walk', 1)]));
    const s: RigSpec = { kind: 'rig', src: 'm.glb' };
    const m = rigModel(manifest({ x: s }), s);
    expect(m.clips.idle).toBeDefined();
    expect(m.clips.attack).toBeUndefined();
  });

  it('步幅：清单给了按清单（米 → 世界像素），没给用默认', () => {
    load();
    const d = build();
    expect(d.strides).toEqual({ walk: 1.4 * M, guardWalk: 1.4 * M, run: 2.8 * M, charge: 2.8 * M });
    const g = build({ stride: { walk: 1.2, run: 3 } });
    expect(g.strides).toEqual({ walk: 1.2 * M, guardWalk: 1.2 * M, run: 3 * M, charge: 3 * M });
    expect(build({ stride: { walk: 1.2 } }).strides.run).toBe(2.8 * M);
  });

  it('尺寸：素材按米做，换成世界像素；scale 整体缩放；height 等比缩放到指定高度', () => {
    load();
    const base = build().height;
    expect(base).toBeCloseTo(0.5 * M, 4);
    expect(build({ scale: 2 }).height).toBeCloseTo(base * 2, 4);
    expect(build({ height: 1 }).height).toBeCloseTo(1 * M, 3);
  });

  it('朝向：模型局部的 +Z 转到 +X（缺省转 π/2），yaw 可改', () => {
    load();
    // 把局部坐标里 +X 方向最远的顶点按第 0 帧的骨骼矩阵摆到世界里
    const placed = (m: UnitModel): THREE.Vector3 => {
      const pos = m.geometry.getAttribute('position'), ab = m.geometry.getAttribute('aBone');
      let k = 0;
      for (let i = 1; i < pos.count; i++) if (pos.getX(i) > pos.getX(k)) k = i;
      const data = m.bones.image.data as unknown as Float32Array;
      return new THREE.Vector3().fromBufferAttribute(pos, k).applyMatrix4(new THREE.Matrix4().fromArray(data, ab.getX(k) * 16));
    };
    // 绕 +Y 转 π/2：局部 +X 落到世界 -Z；转 0 则仍是 +X；转 π 则落到 -X
    const east = placed(build({ yaw: 0 })), north = placed(build()), west = placed(build({ yaw: Math.PI }));
    expect([east.x, east.z]).toEqual([expect.closeTo(0.5 * M, 4), expect.closeTo(0, 4)]);
    expect([north.x, north.z]).toEqual([expect.closeTo(0, 4), expect.closeTo(-0.5 * M, 4)]);
    expect([west.x, west.z]).toEqual([expect.closeTo(-0.5 * M, 4), expect.closeTo(0, 4)]);
  });
});

describe('mountedModel', () => {
  const rider = (): THREE.AnimationClip[] => [
    anim('ride.idle', 3), anim('ride.walk', 1.5), anim('ride.run', 1), anim('ride.attack', 0.8), anim('ride.die', 1.2)];
  const horse = (): THREE.AnimationClip[] => [anim('idle', 2), anim('walk', 1), anim('run', 0.6), anim('die', 2)];
  const spec: MountedSpec = {
    kind: 'mounted',
    rider: { src: 'rider.glb', anims: 'lib', set: 'ride' },
    mount: { src: 'horse.glb' },
  };
  const load = (h = horse(), r = rider(), mountBones: string[] = ['saddle']): void => {
    store.set('rider.glb', fakeGltf([]));
    store.set('lib.glb', fakeGltf(r));
    store.set('horse.glb', fakeGltf(h, mountBones));
  };
  const build = (s: MountedSpec = spec): UnitModel => mountedModel(manifest({ x: s }), s);

  it('每个标准动作都有，相同的「骑手动作 + 马的动作」组合只录一次', () => {
    load();
    const m = build();
    expect(Object.keys(m.clips).length).toBe(18);
    // 待命、戒备、拒马、举盾：骑手待命 + 马待命
    for (const a of ['ready', 'brace', 'guard']) expect(m.clips[a], a).toEqual(m.clips.idle);
    // 举盾行进：骑手行走 + 马行走；冲锋：骑手奔跑 + 马奔跑
    expect(m.clips.guardWalk).toEqual(m.clips.walk);
    expect(m.clips.charge).toEqual(m.clips.run);
    // 四个回身射击：骑手出手 + 马奔跑
    for (const a of ['attackMoveR', 'attackMoveBL', 'attackMoveBR']) expect(m.clips[a], a).toEqual(m.clips.attackMoveL);
    // 没有 attack2/3/4 的骑手素材：与出手是同一组合（骑手出手 + 马待命）
    for (const a of ['attack2', 'attack3', 'attack4']) expect(m.clips[a], a).toEqual(m.clips.attack);
    // 出手时马站着（骑手出手 + 马待命），与边跑边打不是同一组合
    expect(m.clips.attack.start).not.toBe(m.clips.attackMoveL.start);
    expect(m.clips.attackMove.start).not.toBe(m.clips.attackMoveL.start);
    expect(distinctStarts(m)).toBe(7);
  });

  it('时长：移动类以马的步子为一个循环，原地的以骑手为准，阵亡取两者较长，出手以骑手为准', () => {
    load();
    const m = build();
    expect(m.clips.walk.seconds).toBeCloseTo(1, 6);
    expect(m.clips.run.seconds).toBeCloseTo(0.6, 6);
    expect(m.clips.idle.seconds).toBeCloseTo(3, 6);
    expect(m.clips.die.seconds).toBeCloseTo(2, 6);
    expect(m.clips.attack.seconds).toBeCloseTo(0.8, 6);
  });

  describe('马的动作停在末帧还是循环', () => {
    // 贴图列：先加入马（root、arm、saddle），再加入骑手（root、arm）；arm 的位移与动作进度成正比
    const HORSE_ARM = 1, RIDER_ARM = 4;
    // 骑手的根跟着 saddle（在马根上方 1 米），所以骑手 arm 的位移里带着 1 个满行程的座位偏移
    const SEAT = 1;
    const frac = (m: UnitModel, name: string, f: number, col: number, full: number): number =>
      ROW_ARM(m, m.clips[name].start + f, col) / full;

    it('阵亡：马停在自己动作的末尾，不绕回开头', () => {
      load();
      const m = build();
      const c = m.clips.die;
      const end = ROW_ARM(m, c.start + c.n, HORSE_ARM), mid = ROW_ARM(m, c.start + c.n / 2, HORSE_ARM);
      // 位移与时刻成正比：马的 die 比骑手长，取到 0.999 倍时长，末帧约是中点的两倍
      expect(end / mid).toBeGreaterThan(1.98);
      expect(end / mid).toBeLessThanOrEqual(2.0001);
    });

    it('骑手回身射击（只播一遍）配马奔跑：马不停在末帧，按时刻循环（骑手仍停在末尾）', () => {
      load();
      const m = build();
      const die = m.clips.die;
      // 马 die 末帧 ≈ 0.999 倍满行程，借它量出满行程
      const full = ROW_ARM(m, die.start + die.n, HORSE_ARM) / 0.999;
      for (const name of ['attackMoveL', 'attackMoveR', 'attackMoveBL', 'attackMoveBR']) {
        const c = m.clips[name];
        expect(c.seconds).toBeCloseTo(0.8, 6);
        // 马的 run 一圈 0.6 秒：第 0.8 秒时在 (0.8 mod 0.6) / 0.6 = 1/3 处，第 0.4 秒时在 2/3 处
        expect(frac(m, name, c.n, HORSE_ARM, full), name).toBeCloseTo(1 / 3, 2);
        expect(frac(m, name, c.n / 2, HORSE_ARM, full), name).toBeCloseTo(2 / 3, 2);
        expect(frac(m, name, c.n, RIDER_ARM, full) - SEAT, name).toBeCloseTo(0.999, 2);
      }
    });

    it('坐骑的动作被 seconds 截短时，回身射击里马按截取的时长循环', () => {
      load();
      const sp: MountedSpec = { ...spec, mount: { src: 'horse.glb', clips: { run: { name: 'run', seconds: 0.5 } } } };
      const m = build(sp);
      expect(m.clips.run.seconds).toBeCloseTo(0.5, 6);
      const die = m.clips.die;
      const full = ROW_ARM(m, die.start + die.n, HORSE_ARM) / 0.999;
      const c = m.clips.attackMoveL;
      // 马的 run 素材 0.6 秒、截成 0.5 秒一圈：第 0.8 秒在 0.8 mod 0.5 = 0.3 秒处（素材的一半），第 0.4 秒在 0.4 秒处（2/3）
      expect(frac(m, 'attackMoveL', c.n, HORSE_ARM, full)).toBeCloseTo(0.5, 2);
      expect(frac(m, 'attackMoveL', c.n / 2, HORSE_ARM, full)).toBeCloseTo(2 / 3, 2);
    });

    it('骑手出手（马待命，只播一遍）：马按时刻走，骑手停在末尾', () => {
      load();
      const m = build();
      const die = m.clips.die;
      const full = ROW_ARM(m, die.start + die.n, HORSE_ARM) / 0.999;
      const c = m.clips.attack;
      // 马的待命 2 秒一圈；出手 0.8 秒时走到 0.4
      expect(frac(m, 'attack', c.n, HORSE_ARM, full)).toBeCloseTo(0.4, 2);
      expect(frac(m, 'attack', c.n, RIDER_ARM, full) - SEAT).toBeCloseTo(0.999, 2);
    });

    it('移动类循环动作首尾相接：末帧回到第 0 帧（马与骑手都是）', () => {
      load();
      const m = build();
      for (const name of ['walk', 'run']) {
        const c = m.clips[name];
        for (const col of [HORSE_ARM, RIDER_ARM]) expect(ROW_ARM(m, c.start + c.n, col), `${name}/${col}`).toBeCloseTo(ROW_ARM(m, c.start, col), 4);
      }
    });
  });

  it('骑手有自己的 attack2：单独录一段，马待命；其余变体仍指向 attack', () => {
    load(horse(), [...rider(), anim('ride.attack2', 0.7)]);
    const m = build();
    expect(m.clips.attack2.start).not.toBe(m.clips.attack.start);
    expect(m.clips.attack2.seconds).toBeCloseTo(0.7, 6);
    expect(m.clips.attack3).toEqual(m.clips.attack);
    expect(distinctStarts(m)).toBe(8);
  });

  it('马缺某个动作（如阵亡）时退到待命', () => {
    load([anim('idle', 2), anim('walk', 1), anim('run', 0.6)]);
    const m = build();
    expect(m.clips.die).toBeDefined();
    expect(m.clips.die.seconds).toBeCloseTo(2, 6);
  });

  it('马连待命都没有时抛错', () => {
    load([anim('run', 0.6)]);
    expect(() => build()).toThrow(/horse\.glb/);
  });

  it('马的骨架里没有 saddle（或 seat 指定的骨骼）时抛错', () => {
    load(horse(), rider(), []);
    expect(() => build()).toThrow(/saddle/);
    load(horse(), rider(), ['seat2']);
    expect(() => build({ ...spec, mount: { ...spec.mount, seat: 'seat2' } })).not.toThrow();
  });

  it('骑手一个标准动作都没有时抛错', () => {
    load(horse(), [anim('other.dance', 1)]);
    expect(() => build()).toThrow(/rider\.glb/);
  });

  it('步幅有默认值（骑兵比步兵快），清单可改', () => {
    load();
    expect(build().strides.walk).toBe(2.0 * M);
    expect(build().strides.run).toBe(4.0 * M);
    expect(build({ ...spec, stride: { walk: 1.8, run: 4.2 } }).strides).toMatchObject({ walk: 1.8 * M, run: 4.2 * M });
  });

  it('骑手与马共用一个烘焙结果，贴图行数 = 各不同动作的帧数之和', () => {
    load();
    const m = build();
    const distinct = new Map(Object.values(m.clips).map(c => [c.start, c.n]));
    let total = 0;
    for (const n of distinct.values()) total += n + 1;
    expect(rows(m)).toBe(total);
  });
});
