import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STD_ACTIONS, type StdAction } from '../../../src/render/models/actions';
import {
  entryAssets, manifestAssets, manifestEntry, parseManifest, resolveClip, withoutAssets,
  type AssetSpec, type Manifest, type RigPart,
} from '../../../src/render/models/manifest';

const LIBS = { human: 'units/anims/human.glb' };

function rig(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { kind: 'rig', src: 'units/rome/legion.glb', anims: 'human', set: 'sword_shield', ...extra };
}

function parse(models: Record<string, unknown>, libraries: Record<string, unknown> = LIBS): Manifest {
  return parseManifest({ version: 1, libraries, models });
}

describe('parseManifest', () => {
  it('合法清单原样取出', () => {
    const m = parse({
      legion: rig({ clips: { attack: 'sword_shield.thrust' }, stride: { walk: 1.3, run: 2.5 } }),
      onager: { kind: 'rig', src: 'units/rome/onager.glb' },
      equites: {
        kind: 'mounted',
        rider: { src: 'units/rome/equites.glb', anims: 'human', set: 'ride_lance' },
        mount: { src: 'units/anims/horse.glb' },
      },
    });
    expect(m.libraries).toEqual(LIBS);
    expect(Object.keys(m.models)).toEqual(['legion', 'onager', 'equites']);
    expect(m.models.legion).toMatchObject({ kind: 'rig', src: 'units/rome/legion.glb', set: 'sword_shield' });
    expect(m.models.equites.kind).toBe('mounted');
  });

  it('没写 libraries、models 时按空处理', () => {
    expect(parseManifest({ version: 1 })).toEqual({ libraries: {}, models: {} });
  });

  it('不带 anims 的模型（只用自带动作）合法', () => {
    expect(() => parse({ onager: { kind: 'rig', src: 'a.glb' } }, {})).not.toThrow();
  });

  it.each([null, undefined, 3, 'x', []])('整份清单不是 JSON 对象时抛错：%j', bad => {
    expect(() => parseManifest(bad)).toThrow();
  });

  it('libraries 不是对象或值不是路径字符串时抛错', () => {
    expect(() => parseManifest({ libraries: [], models: {} })).toThrow(/libraries/);
    expect(() => parseManifest({ libraries: 'x', models: {} })).toThrow(/libraries/);
    expect(() => parseManifest({ libraries: { human: 3 }, models: {} })).toThrow(/libraries/);
  });

  it('models 不是对象时抛错', () => {
    expect(() => parseManifest({ libraries: {}, models: [] })).toThrow(/models/);
    expect(() => parseManifest({ libraries: {}, models: 'x' })).toThrow(/models/);
  });

  it('某个模型的规格不是对象时，错误里带模型 id', () => {
    expect(() => parse({ legion: 5 })).toThrow(/legion/);
    expect(() => parse({ legion: null })).toThrow(/legion/);
  });

  it('kind 缺失或不是 rig / mounted 时，错误里带模型 id', () => {
    expect(() => parse({ legion: { src: 'a.glb' } })).toThrow(/legion/);
    expect(() => parse({ legion: { kind: 'static', src: 'a.glb' } })).toThrow(/legion/);
  });

  it('rig 缺 src 或 src 为空时抛错，带模型 id 与 src', () => {
    expect(() => parse({ legion: { kind: 'rig' } })).toThrow(/legion.*src/);
    expect(() => parse({ legion: { kind: 'rig', src: '' } })).toThrow(/legion.*src/);
    expect(() => parse({ legion: { kind: 'rig', src: 7 } })).toThrow(/legion.*src/);
  });

  it('mounted 的 rider、mount 各自校验，错误指出是哪一部分', () => {
    const ok = { src: 'a.glb' };
    expect(() => parse({ eq: { kind: 'mounted', mount: ok } })).toThrow(/eq.*rider/);
    expect(() => parse({ eq: { kind: 'mounted', rider: ok } })).toThrow(/eq.*mount/);
    expect(() => parse({ eq: { kind: 'mounted', rider: ok, mount: { anims: 'human' } } })).toThrow(/eq.*mount.*src/);
    expect(() => parse({ eq: { kind: 'mounted', rider: { src: '' }, mount: ok } })).toThrow(/eq.*rider.*src/);
  });

  it('anims 必须是 libraries 里的名字，错误里带模型 id 与该名字', () => {
    expect(() => parse({ legion: rig({ anims: 'elf' }) })).toThrow(/legion.*elf/);
    expect(() => parse({ legion: rig({ anims: 3 }) })).toThrow(/legion/);
    expect(() => parse({ eq: { kind: 'mounted', rider: { src: 'a', anims: 'elf' }, mount: { src: 'b' } } })).toThrow(/eq.*rider.*elf/);
    expect(() => parse({ eq: { kind: 'mounted', rider: { src: 'a' }, mount: { src: 'b', anims: 'elf' } } })).toThrow(/eq.*mount.*elf/);
  });

  it('libraries 为空时任何 anims 都不合法', () => {
    expect(() => parse({ legion: rig() }, {})).toThrow(/legion.*human/);
  });

  it('set 不是字符串时抛错', () => {
    expect(() => parse({ legion: rig({ set: 3 }) })).toThrow(/legion.*set/);
  });

  it('clips 不是对象时抛错', () => {
    expect(() => parse({ legion: rig({ clips: 'x' }) })).toThrow(/legion.*clips/);
    expect(() => parse({ legion: rig({ clips: [] }) })).toThrow(/legion.*clips/);
  });

  it('clips 的键必须是标准动作名，错误里带模型 id 与该键', () => {
    expect(() => parse({ legion: rig({ clips: { dance: 'x' } }) })).toThrow(/legion.*dance/);
    expect(() => parse({
      eq: { kind: 'mounted', rider: { src: 'a', clips: { fly: 'x' } }, mount: { src: 'b' } },
    })).toThrow(/eq.*rider.*fly/);
  });

  it('clips 的值要是非空字符串，或 { name, seconds? }（seconds 为正数）', () => {
    for (const bad of ['', 3, null, [], {}, { name: 3 }, { name: 'x', seconds: 0 }, { name: 'x', seconds: -1 }, { name: 'x', seconds: '1' }]) {
      expect(() => parse({ legion: rig({ clips: { attack: bad } }) }), JSON.stringify(bad)).toThrow(/legion.*attack/);
    }
    expect(() => parse({ legion: rig({ clips: { attack: { name: 'x' } } }) })).not.toThrow();
    expect(() => parse({ legion: rig({ clips: { attack: { name: 'x', seconds: 0.5 } } }) })).not.toThrow();
    expect(() => parse({
      eq: { kind: 'mounted', rider: { src: 'a', clips: { die: 7 } }, mount: { src: 'b' } },
    })).toThrow(/eq.*rider.*die/);
  });

  it('scale、height、portrait 要是正数', () => {
    for (const k of ['scale', 'height', 'portrait']) {
      for (const bad of [0, -1, '2', null, Infinity]) {
        expect(() => parse({ legion: rig({ [k]: bad }) }), `${k}=${String(bad)}`).toThrow(new RegExp(`legion.*${k}`));
      }
      expect(() => parse({ legion: rig({ [k]: 1.5 }) })).not.toThrow();
    }
    expect(() => parse({
      eq: { kind: 'mounted', scale: 0, rider: { src: 'a' }, mount: { src: 'b' } },
    })).toThrow(/eq.*scale/);
  });

  it('yaw 要是数字（0 与负数合法）', () => {
    expect(() => parse({ legion: rig({ yaw: '90' }) })).toThrow(/legion.*yaw/);
    expect(() => parse({ legion: rig({ yaw: null }) })).toThrow(/legion.*yaw/);
    expect(() => parse({ legion: rig({ yaw: 0 }) })).not.toThrow();
    expect(() => parse({ legion: rig({ yaw: -1.57 }) })).not.toThrow();
  });

  it('stride 要是对象，walk、run 为正数，可只写其一', () => {
    expect(() => parse({ legion: rig({ stride: 3 }) })).toThrow(/legion.*stride/);
    expect(() => parse({ legion: rig({ stride: [] }) })).toThrow(/legion.*stride/);
    expect(() => parse({ legion: rig({ stride: { walk: 0 } }) })).toThrow(/legion.*walk/);
    expect(() => parse({ legion: rig({ stride: { run: -2 } }) })).toThrow(/legion.*run/);
    expect(() => parse({ legion: rig({ stride: { run: '2' } }) })).toThrow(/legion.*run/);
    expect(() => parse({ legion: rig({ stride: { walk: 1.2 } }) })).not.toThrow();
    expect(() => parse({ legion: rig({ stride: {} }) })).not.toThrow();
  });

  it('mount 的 seat 要是字符串', () => {
    const mounted = (seat: unknown) => ({ eq: { kind: 'mounted', rider: { src: 'a' }, mount: { src: 'b', seat } } });
    expect(() => parse(mounted(3))).toThrow(/eq.*mount.*seat/);
    expect(() => parse(mounted('saddle2'))).not.toThrow();
  });

  it('每个标准动作名都能当 clips 的键，值可以是字符串或带时长的对象', () => {
    const clips = Object.fromEntries(STD_ACTIONS.map(a => [a, { name: `x.${a}`, seconds: 1 }]));
    expect(() => parse({ legion: rig({ clips }) })).not.toThrow();
  });
});

describe('resolveClip', () => {
  const has = (...names: string[]) => (n: string) => names.includes(n);
  const part = (extra: Partial<RigPart> = {}): RigPart => ({ src: 'a.glb', set: 'spear', ...extra });

  it('clips 指定的优先于「姿态.动作」与通用动作', () => {
    const p = part({ clips: { attack: 'spear.thrust' } });
    expect(resolveClip(p, 'attack', has('spear.attack', 'attack', 'spear.thrust'))).toEqual({ name: 'spear.thrust' });
  });

  it('clips 指定的动作即使 has 查不到也照给（交给加载处报错）', () => {
    expect(resolveClip(part({ clips: { run: 'nope' } }), 'run', has())).toEqual({ name: 'nope' });
  });

  it('clips 给对象时带出 seconds', () => {
    const p = part({ clips: { attack: { name: 'spear.thrust', seconds: 0.8 } } });
    expect(resolveClip(p, 'attack', has())).toEqual({ name: 'spear.thrust', seconds: 0.8 });
  });

  it('没有 clips 时先找「姿态.动作」', () => {
    expect(resolveClip(part(), 'walk', has('spear.walk', 'walk'))).toEqual({ name: 'spear.walk' });
  });

  it('姿态缺这个动作时退到不带前缀的动作', () => {
    expect(resolveClip(part(), 'walk', has('walk'))).toEqual({ name: 'walk' });
  });

  it('没有 set 时只找不带前缀的动作', () => {
    expect(resolveClip(part({ set: undefined }), 'walk', has('spear.walk'))).toBeNull();
    expect(resolveClip(part({ set: undefined }), 'walk', has('walk'))).toEqual({ name: 'walk' });
  });

  it('都没有时返回 null', () => {
    expect(resolveClip(part(), 'die', has('idle'))).toBeNull();
  });

  it('本姿态里缺这个动作时，沿退路找本姿态里相近的动作（attackMoveL → attackMove → attack）', () => {
    expect(resolveClip(part(), 'attackMoveL', has('spear.attack'))).toEqual({ name: 'spear.attack' });
    expect(resolveClip(part(), 'attackMoveBR', has('spear.attack', 'spear.attackMove'))).toEqual({ name: 'spear.attackMove' });
    expect(resolveClip(part(), 'ready', has('spear.idle'))).toEqual({ name: 'spear.idle' });
    expect(resolveClip(part(), 'brace', has('spear.ready', 'spear.idle'))).toEqual({ name: 'spear.ready' });
  });

  it('本姿态的退路排在不带前缀的同名动作之前', () => {
    // 动作库里不带前缀的 attackMoveL 可能是为别的姿态（如弓手回身射）做的
    expect(resolveClip(part(), 'attackMoveL', has('attackMoveL', 'spear.attack'))).toEqual({ name: 'spear.attack' });
  });

  it('本姿态的同名动作排在本姿态的退路之前', () => {
    expect(resolveClip(part(), 'attackMoveL', has('spear.attack', 'spear.attackMoveL'))).toEqual({ name: 'spear.attackMoveL' });
  });

  it('本姿态一个都没有时，只认不带前缀的同名动作，不带前缀的退路动作不算', () => {
    expect(resolveClip(part(), 'attackMoveL', has('attackMoveL'))).toEqual({ name: 'attackMoveL' });
    expect(resolveClip(part(), 'attackMoveL', has('attack', 'idle'))).toBeNull();
  });

  it('沿退路找本姿态的相近动作时不退到 idle：动作库有通用的同名动作就用它，都没有才用 set.idle', () => {
    expect(resolveClip(part(), 'die', has('spear.idle', 'die'))).toEqual({ name: 'die' });
    expect(resolveClip(part(), 'die', has('spear.idle'))).toEqual({ name: 'spear.idle' });
    expect(resolveClip(part(), 'walk', has('spear.idle', 'walk'))).toEqual({ name: 'walk' });
    expect(resolveClip(part(), 'attackMoveL', has('spear.idle', 'attackMoveL'))).toEqual({ name: 'attackMoveL' });
    expect(resolveClip(part(), 'ready', has('spear.idle', 'ready'))).toEqual({ name: 'ready' });
  });

  it('attack2/3/4：本姿态有就用自己的，没有退到本姿态的 attack', () => {
    for (const a of ['attack2', 'attack3', 'attack4'] as const) {
      expect(resolveClip(part(), a, has(`spear.${a}`, 'spear.attack'))).toEqual({ name: `spear.${a}` });
      expect(resolveClip(part(), a, has('spear.attack', 'spear.idle'))).toEqual({ name: 'spear.attack' });
    }
    expect(resolveClip(part({ clips: { attack3: 'x.stab' } }), 'attack3', has('spear.attack3'))).toEqual({ name: 'x.stab' });
  });

  it('attack2 本姿态一个攻击都没有时不退到 idle：有通用的 attack2 就用它', () => {
    expect(resolveClip(part(), 'attack2', has('attack2', 'spear.idle'))).toEqual({ name: 'attack2' });
  });

  it('std 本身是 idle 时照常先找 set.idle，再找通用 idle', () => {
    expect(resolveClip(part(), 'idle', has('spear.idle', 'idle'))).toEqual({ name: 'spear.idle' });
    expect(resolveClip(part(), 'idle', has('idle'))).toEqual({ name: 'idle' });
    expect(resolveClip(part(), 'idle', has())).toBeNull();
  });

  it('本姿态里非 idle 的退路仍排在通用同名动作之前', () => {
    expect(resolveClip(part(), 'walk', has('spear.run', 'walk'))).toEqual({ name: 'spear.run' });
  });

  it('没有 set 时不走退路，也没有 set.idle 可用', () => {
    expect(resolveClip(part({ set: undefined }), 'die', has('spear.idle', 'idle'))).toBeNull();
  });

  it('没有 set 时不走退路', () => {
    expect(resolveClip(part({ set: undefined }), 'attackMoveL', has('attack', 'attackMove'))).toBeNull();
  });

  it('clips 指定的仍优先于本姿态', () => {
    const p = part({ clips: { attackMoveL: 'x.shoot' } });
    expect(resolveClip(p, 'attackMoveL', has('spear.attackMoveL', 'spear.attack'))).toEqual({ name: 'x.shoot' });
  });

  it('只给其它动作的 clips 不影响这个动作的查找', () => {
    const p = part({ clips: { run: 'x' } });
    expect(resolveClip(p, 'walk', has('spear.walk'))).toEqual({ name: 'spear.walk' });
  });
});

describe('manifestEntry', () => {
  const legion: AssetSpec = { kind: 'rig', src: 'legion.glb' };
  const legionE: AssetSpec = { kind: 'rig', src: 'legion_e.glb' };
  const m: Manifest = { libraries: {}, models: { legion, onager: { kind: 'rig', src: 'o.glb' } } };

  it('登记了的 id 直接取', () => {
    expect(manifestEntry(m, 'legion')).toBe(legion);
  });

  it('高级形态没登记时退回初级形态', () => {
    expect(manifestEntry(m, 'legion_e')).toBe(legion);
  });

  it('高级形态登记了就用它自己的', () => {
    expect(manifestEntry({ ...m, models: { ...m.models, legion_e: legionE } }, 'legion_e')).toBe(legionE);
  });

  it('初级形态也没登记则查不到', () => {
    expect(manifestEntry(m, 'velites_e')).toBeUndefined();
    expect(manifestEntry(m, 'velites')).toBeUndefined();
  });

  it('不带 _e 后缀的 id 不会去找别的模型', () => {
    expect(manifestEntry({ libraries: {}, models: { legion_e: legionE } }, 'legion')).toBeUndefined();
  });
});

describe('manifestAssets', () => {
  it('空清单没有素材', () => {
    expect(manifestAssets({ libraries: {}, models: {} })).toEqual([]);
  });

  it('列出模型文件与它用到的动作库路径，骑兵含骑手与坐骑', () => {
    const m = parse({
      legion: rig(),
      onager: { kind: 'rig', src: 'units/rome/onager.glb' },
      equites: {
        kind: 'mounted',
        rider: { src: 'units/rome/equites.glb', anims: 'human', set: 'ride_lance' },
        mount: { src: 'units/anims/horse.glb' },
      },
    });
    expect(manifestAssets(m).sort()).toEqual([
      'units/anims/horse.glb', 'units/anims/human.glb', 'units/rome/equites.glb',
      'units/rome/legion.glb', 'units/rome/onager.glb',
    ]);
  });

  it('同一个文件被多处引用只出现一次', () => {
    const m = parse({
      a: rig({ src: 'x.glb' }),
      b: rig({ src: 'x.glb' }),
      c: { kind: 'mounted', rider: { src: 'x.glb', anims: 'human' }, mount: { src: 'h.glb' } },
      d: { kind: 'mounted', rider: { src: 'y.glb', anims: 'human' }, mount: { src: 'h.glb' } },
    });
    const list = manifestAssets(m);
    expect(list.length).toBe(new Set(list).size);
    expect(list.sort()).toEqual(['h.glb', 'units/anims/human.glb', 'x.glb', 'y.glb']);
  });

  it('没被任何模型用到的动作库不列出', () => {
    const m = parse({ onager: { kind: 'rig', src: 'o.glb' } });
    expect(manifestAssets(m)).toEqual(['o.glb']);
  });
});

describe('entryAssets', () => {
  const m = parse({
    legion: rig(),
    onager: { kind: 'rig', src: 'units/rome/onager.glb' },
    eq: {
      kind: 'mounted',
      rider: { src: 'units/rome/equites.glb', anims: 'human' },
      mount: { src: 'units/anims/horse.glb' },
    },
  });

  it('rig：模型文件加它的动作库；不带 anims 只有模型文件', () => {
    expect(entryAssets(m, m.models.legion).sort()).toEqual(['units/anims/human.glb', 'units/rome/legion.glb']);
    expect(entryAssets(m, m.models.onager)).toEqual(['units/rome/onager.glb']);
  });

  it('mounted：骑手与坐骑的文件、动作库都算', () => {
    expect(entryAssets(m, m.models.eq).sort()).toEqual(['units/anims/horse.glb', 'units/anims/human.glb', 'units/rome/equites.glb']);
  });
});

describe('withoutAssets', () => {
  const m = parse({
    legion: rig(),
    velites: rig({ src: 'units/rome/velites.glb' }),
    onager: { kind: 'rig', src: 'units/rome/onager.glb' },
    eq: {
      kind: 'mounted',
      rider: { src: 'units/rome/equites.glb' },
      mount: { src: 'units/anims/horse.glb' },
    },
  });

  it('去掉用到加载失败文件的模型，其余原样保留', () => {
    const r = withoutAssets(m, new Set(['units/rome/legion.glb']));
    expect(Object.keys(r.models).sort()).toEqual(['eq', 'onager', 'velites']);
    expect(r.models.velites).toBe(m.models.velites);
    expect(r.libraries).toEqual(m.libraries);
  });

  it('动作库失败时，用它的模型都去掉', () => {
    const r = withoutAssets(m, new Set(['units/anims/human.glb']));
    expect(Object.keys(r.models).sort()).toEqual(['eq', 'onager']);
  });

  it('骑兵的骑手或坐骑任一失败都去掉', () => {
    expect(Object.keys(withoutAssets(m, new Set(['units/anims/horse.glb'])).models)).not.toContain('eq');
    expect(Object.keys(withoutAssets(m, new Set(['units/rome/equites.glb'])).models)).not.toContain('eq');
  });

  it('没有失败时全部保留；不改动传入的清单', () => {
    expect(Object.keys(withoutAssets(m, new Set()).models)).toEqual(Object.keys(m.models));
    withoutAssets(m, new Set(['units/rome/legion.glb']));
    expect(Object.keys(m.models)).toContain('legion');
  });

  it('失败的文件没人用时不影响任何模型', () => {
    expect(Object.keys(withoutAssets(m, new Set(['other.glb'])).models)).toEqual(Object.keys(m.models));
  });
});

/** 取 GLB 里的动画名（名字带「|」的是重复动画，加载时会被忽略） */
function glbAnimations(file: string): Set<string> {
  const bytes = readFileSync(file);
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(header.getUint32(0, true)).toBe(0x46546c67); // glTF
  expect(header.getUint32(4, true)).toBe(2);
  expect(header.getUint32(16, true)).toBe(0x4e4f534a); // JSON
  const jsonEnd = 20 + header.getUint32(12, true);
  expect(jsonEnd).toBeLessThanOrEqual(bytes.length);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, jsonEnd))) as {
    animations?: { name?: string }[];
  };
  return new Set((json.animations ?? []).map(a => a.name ?? '').filter(n => n && !n.includes('|')));
}

describe('public/assets/units/manifest.json（真实清单）', () => {
  const root = fileURLToPath(new URL('../../../public/assets/', import.meta.url));
  const manifest = parseManifest(JSON.parse(readFileSync(resolve(root, 'units/manifest.json'), 'utf8')));

  it('清单合法，且登记了模型', () => {
    expect(Object.keys(manifest.models).length).toBeGreaterThan(0);
  });

  it('动作库里读得出动作（后面按动作名的校验不是空转）', () => {
    for (const lib of Object.values(manifest.libraries)) expect(glbAnimations(resolve(root, lib)).size).toBeGreaterThan(0);
  });

  it('引用的素材文件都存在', () => {
    for (const p of manifestAssets(manifest)) expect(existsSync(resolve(root, p)), p).toBe(true);
  });

  const parts = (s: AssetSpec): { where: string; part: RigPart }[] =>
    s.kind === 'rig' ? [{ where: 'rig', part: s }] : [{ where: 'rider', part: s.rider }, { where: 'mount', part: s.mount }];

  it('clips 指到的动作在素材（含动作库）里确实存在，每份素材至少有一个标准动作可用', () => {
    for (const [id, s] of Object.entries(manifest.models)) {
      for (const { where, part } of parts(s)) {
        const names = glbAnimations(resolve(root, part.src));
        if (part.anims) for (const n of glbAnimations(resolve(root, manifest.libraries[part.anims]))) names.add(n);
        for (const [std, ref] of Object.entries(part.clips ?? {})) {
          const name = typeof ref === 'string' ? ref : ref.name;
          expect(names.has(name), `${id}.${where} 的 ${std} → ${name}`).toBe(true);
        }
        const usable = STD_ACTIONS.filter(a => resolveClip(part, a as StdAction, n => names.has(n)));
        expect(usable.length, `${id}.${where} 没有可用的标准动作`).toBeGreaterThan(0);
      }
    }
  });

  it('每个模型的骑手 / 本体都能按查找顺序取到待命、移动、攻击、阵亡四个基本动作', () => {
    for (const [id, s] of Object.entries(manifest.models)) {
      const ps = s.kind === 'rig' ? [{ where: 'rig', part: s }] : [{ where: 'rider', part: s.rider }];
      for (const { where, part } of ps) {
        const names = glbAnimations(resolve(root, part.src));
        if (part.anims) for (const n of glbAnimations(resolve(root, manifest.libraries[part.anims]))) names.add(n);
        for (const a of ['idle', 'walk', 'attack', 'die'] as const) {
          expect(resolveClip(part, a, n => names.has(n)), `${id}.${where} 的 ${a}`).not.toBeNull();
        }
      }
    }
  });

  it('骑兵的坐骑至少有待命动作（其余动作缺了会退到它）', () => {
    for (const [id, s] of Object.entries(manifest.models)) {
      if (s.kind !== 'mounted') continue;
      const names = glbAnimations(resolve(root, s.mount.src));
      if (s.mount.anims) for (const n of glbAnimations(resolve(root, manifest.libraries[s.mount.anims]))) names.add(n);
      expect(resolveClip(s.mount, 'idle', n => names.has(n)), id).not.toBeNull();
    }
  });
});
