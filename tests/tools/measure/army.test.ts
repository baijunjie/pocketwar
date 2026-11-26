import { describe, expect, it } from 'vitest';
import { FACTIONS, UNITS, UNIT_BY_KEY } from '../../../src/sim/defs';
import { armyList } from '../../../src/sim/setup';
import { buildArmy, parseLevels, refSpec } from '../../../tools/measure/army';
import { BASE, STEP, positionOf, refForce } from '../../../tools/measure/units';

describe('测量工具：解析命令行的级数写法', () => {
  it('逗号分隔的 维度=级数，可以是负数与小数', () => {
    expect(parseLevels('hp=6,out=-2')).toEqual({ hp: 6, out: -2 });
    expect(parseLevels('armM=1.5')).toEqual({ armM: 1.5 });
  });

  it('不认识的维度、不是数的级数、缺等号都报错', () => {
    expect(() => parseLevels('foo=1')).toThrow();
    expect(() => parseLevels('hp=abc')).toThrow();
    expect(() => parseLevels('hp')).toThrow();
    expect(() => parseLevels('')).toThrow();
  });
});

describe('测量工具：阵营的标准军', () => {
  const size = 200;

  it('不改动时与开局编制是同一份名单（同一个函数）', () => {
    for (const id of ['china', 'japan'] as const) {
      expect(buildArmy({ type: 'faction', faction: id, size })).toEqual(armyList(FACTIONS[id], size));
    }
  });

  it('manpower 换掉阵营的兵员级数：级数高的人更多，其余兵种构成不变', () => {
    const base = buildArmy({ type: 'faction', faction: 'china', size });
    const more = buildArmy({ type: 'faction', faction: 'china', size, manpower: FACTIONS.china.manpower + 5 });
    expect(more.length).toBeGreaterThan(base.length);
    expect(new Set(more)).toEqual(new Set(base));
  });

  it('all 给全军每个兵种加级数：人数不变，面板按阶梯变', () => {
    const base = buildArmy({ type: 'faction', faction: 'china', size });
    const up = buildArmy({ type: 'faction', faction: 'china', size, all: { hp: 4 } });
    expect(up.length).toBe(base.length);
    base.forEach((u, i) => {
      expect(UNITS[up[i]].hp, UNITS[u].key).toBe(Math.round(UNITS[u].hp * STEP.hp ** 4));
    });
    // 同一兵种的变体只有一个
    expect(new Set(up).size).toBe(new Set(base).size);
  });

  it('swap 把这个兵种换成它所属位置的基准单位，别的兵种不动', () => {
    const base = buildArmy({ type: 'faction', faction: 'china', size });
    const key = UNITS[base[0]].key;
    const swapped = buildArmy({ type: 'faction', faction: 'china', size, swap: key });
    expect(swapped.length).toBe(base.length);
    base.forEach((u, i) => {
      if (UNITS[u].key === key) expect(swapped[i]).toBe(BASE[positionOf(UNITS[u])].idx);
      else expect(swapped[i]).toBe(u);
    });
  });
});

describe('测量工具：直射器械在阵营标准军里', () => {
  it('swap 蝎弩换成直射器械的基准单位（它所属的位置），人数与别的兵种不变', () => {
    const base = buildArmy({ type: 'faction', faction: 'rome', size: 300 });
    const swapped = buildArmy({ type: 'faction', faction: 'rome', size: 300, swap: 'scorpio' });
    const scorpio = UNIT_BY_KEY.scorpio.idx;
    expect(base.filter(i => i === scorpio).length).toBeGreaterThan(0);
    expect(swapped.length).toBe(base.length);
    base.forEach((u, i) => expect(swapped[i]).toBe(u === scorpio ? BASE.bolt.idx : u));
  });
});

describe('测量工具：标准混编军的描述', () => {
  it('位置换成兵种、加人与级数可以同时给；位置上全员同一个下标', () => {
    const army = buildArmy({
      type: 'ref', size: refForce(100), slots: { inf: { unit: 'samurai', add: 3, levels: { hp: 2 } } }, all: { armM: 1 },
    });
    const plain = buildArmy(refSpec(refForce(100)));
    expect(army.length).toBe(plain.length + 3);
    const sam = army.filter(i => UNITS[i].key.startsWith(`${UNIT_BY_KEY.samurai.key}|`));
    expect(sam.length).toBeGreaterThanOrEqual(3);
    expect(new Set(sam).size).toBe(1);
    expect(UNITS[sam[0]].hp).toBe(Math.round(UNIT_BY_KEY.samurai.hp * STEP.hp ** 2));
    expect(UNITS[sam[0]].armM).toBe(UNIT_BY_KEY.samurai.armM + 1);
  });

  it('位置上的特性加进该位置全员；没有这个兵种报错', () => {
    const army = buildArmy({ type: 'ref', size: refForce(100), slots: { inf: { traits: ['naginata'] } } });
    const inf = army.filter(i => positionOf(UNITS[i]) === 'inf');
    expect(inf.length).toBeGreaterThan(0);
    for (const i of inf) expect(UNITS[i].vs[BASE.cav.idx]).toBeGreaterThan(BASE.inf.vs[BASE.cav.idx]);
    expect(() => buildArmy({ type: 'ref', size: 30, slots: { inf: { unit: 'no_such_unit' } } })).toThrow();
  });

  it('位置加人加到比 0 还少时人数为 0（不会抛错也不会出负数）', () => {
    const plain = buildArmy(refSpec(refForce(100)));
    const n = plain.filter(i => i === BASE.ele.idx).length;
    const army = buildArmy({ type: 'ref', size: refForce(100), slots: { ele: { add: -n } } });
    expect(army.filter(i => i === BASE.ele.idx).length).toBe(0);
  });
});
