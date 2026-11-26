import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FACTIONS, FACTION_BUDGET, FACTION_IDS, REINF_BUDGET, floorLevel, manpowerForBudget, reinfLevelForBudget } from '../../../src/sim/defs';

// 只拦 node:fs 的读写（写回 factions.ts 的路径），不真改源码；别的读取照旧
const fsMock = vi.hoisted(() => ({ files: new Map<string, string>(), writes: [] as [string, string][] }));
vi.mock('node:fs', async importOriginal => {
  const real = await importOriginal<typeof import('node:fs')>();
  return {
    ...real,
    readFileSync: ((p: string, ...rest: unknown[]) => (String(p).endsWith('factions.ts') ? fsMock.files.get('factions') : (real.readFileSync as (...a: unknown[]) => unknown)(p, ...rest))) as typeof real.readFileSync,
    writeFileSync: ((p: string, data: string) => { fsMock.writes.push([String(p), String(data)]); }) as typeof real.writeFileSync,
  };
});
// 对战测量太慢：Measurer.trait 换成记录调用的桩，别的方法照旧
const traitCalls = vi.hoisted(() => [] as unknown[][]);
vi.mock('../../../tools/measure/measure', async importOriginal => {
  const real = await importOriginal<typeof import('../../../tools/measure/measure')>();
  class Stub extends real.Measurer {
    trait(pos: string, trait: string, opts?: { size?: number; n?: number }) {
      traitCalls.push([pos, trait, opts]);
      return Promise.resolve({ kind: 'trait' as const, label: `${pos}:+${trait}`, size: 0, n: 0, adv: 0, advSe: 0, win: 0.5 });
    }
  }
  return { ...real, Measurer: Stub };
});
const { main } = await import('../../../tools/measure/cli');

/** 一份只有四个阵营 id、兵员级数与援军级数的 factions.ts 样子的文本，旧值都是 99 */
const fake = (): string => FACTION_IDS.map(id => `  ${id}: {\n    id: '${id}',\n    other: 7,\n    manpower: 99, reinfLevel: 99,\n  },`).join('\n');
const nums = (src: string, field: string): Record<string, number> =>
  Object.fromEntries(FACTION_IDS.map(id => [id, Number(new RegExp(`id: '${id}'[\\s\\S]*?${field}: ([-\\d.]+)`).exec(src)![1])]));

describe('测量工具命令行：写回', () => {
  beforeEach(() => {
    fsMock.files.set('factions', fake());
    fsMock.writes.length = 0;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('budget 不带 --write 不写任何文件', async () => {
    await main(['budget']);
    expect(fsMock.writes).toEqual([]);
  });

  it('budget --write 只写 factions.ts，且只改各阵营的 manpower 为补到预算的级数，reinfLevel 与别的字段不动', async () => {
    await main(['budget', '--write']);
    expect(fsMock.writes.map(([p]) => p)).toEqual(['src/sim/content/factions.ts']);
    const out = fsMock.writes[0][1];
    const want = Object.fromEntries(FACTION_IDS.map(id => [id, floorLevel(manpowerForBudget(FACTIONS[id], FACTION_BUDGET))]));
    expect(nums(out, 'manpower')).toEqual(want);
    expect(out).toBe(fake().replace(/(id: '(\w+)'[\s\S]*?manpower: )99/g, (_, a, id) => `${a}${want[id]}`));
  });

  it('reinf --write 只写 factions.ts，且只改各阵营的 reinfLevel 为补到预算的级数，manpower 不动', async () => {
    await main(['reinf', '--write']);
    expect(fsMock.writes.map(([p]) => p)).toEqual(['src/sim/content/factions.ts']);
    const out = fsMock.writes[0][1];
    const want = Object.fromEntries(FACTION_IDS.map(id => [id, floorLevel(reinfLevelForBudget(FACTIONS[id], REINF_BUDGET))]));
    expect(nums(out, 'reinfLevel')).toEqual(want);
    expect(nums(out, 'manpower')).toEqual(Object.fromEntries(FACTION_IDS.map(id => [id, 99])));
  });

  it('trait 命令认得：每个特性各量一次（位置、特性 key、--n），不再报「不认识的命令」，也不写文件', async () => {
    traitCalls.length = 0;
    await main(['--workers', '1', '--n', '7', 'trait', 'inf', 'cover', 'pilum']);
    expect(traitCalls).toEqual([['inf', 'cover', { size: undefined, n: 7 }], ['inf', 'pilum', { size: undefined, n: 7 }]]);
    expect(fsMock.writes).toEqual([]);
  });

  it('已经删掉的命令（prices、manpower、units、report）都报「不认识的命令」', async () => {
    for (const cmd of ['prices', 'manpower', 'units', 'report']) {
      await expect(main(['--workers', '1', cmd]), cmd).rejects.toThrow('不认识的命令');
    }
  });
});
