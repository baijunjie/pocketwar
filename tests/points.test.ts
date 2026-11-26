import { describe, expect, it } from 'vitest';
import {
  ARCHETYPES, DIMS, DIM_PRICE, EXPAND_RULES, FACTION_BUDGET, HP_SCALE, LEVEL_RANGES, MANPOWER_PRICE, REINF_BUDGET, TRAITS, UNIT_POINT_LIMITS, levelRange, levelPoints, STEP, UNITS, UNIT_BY_KEY, applyLevels,
  archetypePower, defineTrait, expandUnit, panelPower, powerFromPoints,
} from '../src/sim/defs';
import type { Dim } from '../src/sim/defs';
import * as defs from '../src/sim/defs';
import { contentUnits } from '../tools/measure/units';

describe('兵种表点数化：面板由原型基准与级数算出', () => {
  const tier0 = contentUnits().filter(d => d.tier === 0);

  it('原型基准按级数展开：生命乘全局倍率取整，节奏同乘伤害与间隔，输出只缩短间隔，护甲加减，机动、射程、纪律、冲击按阶梯', () => {
    const b = ARCHETYPES.find(a => a.key === 'cav')!.panel;
    const p = applyLevels(b, { hp: 4, cad: 2, out: 3, armM: -1, spd: 2, disc: 3, imp: 1 });
    expect(p.hp).toBeCloseTo(b.hp * STEP.hp ** 4);
    expect(p.dmg).toBeCloseTo(b.dmg * STEP.cad ** 2);
    expect(p.cd).toBeCloseTo((b.cd * STEP.cad ** 2) / STEP.out ** 3);
    expect(p.armM).toBe(b.armM - 1);
    expect(p.pace).toBeCloseTo(b.pace * STEP.spd ** 2);
    expect(p.discipline).toBe(6);
    expect(p.impact).toBeCloseTo(b.impact * STEP.imp);
    const u = expandUnit({ faction: 'china', key: 't', name: 't', arch: 'cav', spec: { lv: { hp: 4 } }, desc: '' }, EXPAND_RULES, false)[0];
    expect(u.hp).toBe(Math.round(b.hp * STEP.hp ** 4 * HP_SCALE));
    expect(u.abilities.charge?.impact).toBe(b.impact);
  });

  it('攻击距离是加数阶梯：每级 +15 像素，在面板的攻击距离上加，不影响别的面板字段', () => {
    expect(STEP.reach).toBe(15);
    const b = ARCHETYPES.find(a => a.key === 'inf')!.panel;
    expect(b.reach).toBe(0);
    expect(applyLevels(b, { reach: 2 }).reach).toBe(30);
    expect(applyLevels(b, {}).reach).toBe(0);
    expect({ ...applyLevels(b, { reach: 1 }), reach: 0 }).toEqual({ ...applyLevels(b, {}), reach: 0 });
    expect(DIMS).toContain('reach');
  });

  it('点数维度的面板在兵种表里只填级数：填绝对数值直接报错；用了原型没开放的维度也报错', () => {
    const bad = (spec: object): unknown => () => expandUnit({ faction: 'china', key: 't', name: 't', arch: 'inf', spec, desc: '' }, EXPAND_RULES);
    expect(bad({ hp: 80 })).toThrow('点数维度');
    expect(bad({ lv: { rng: 1 } })).toThrow('没有开放维度');
    const badRanged = (spec: object): unknown => () => expandUnit({ faction: 'china', key: 't', name: 't', arch: 'ranged', spec, desc: '' }, EXPAND_RULES);
    expect(badRanged({ lv: { reach: 1 } })).toThrow('没有开放维度');
    expect(bad({ lv: { imp: 1 } })).toThrow('没有开放维度');
  });

  it('每个兵种的级数只用原型开放的维度', () => {
    for (const d of tier0) {
      for (const k of Object.keys(d.lv)) expect(ARCHETYPES[d.arch].dims, `${d.key} ${k}`).toContain(k);
    }
  });

  it('高级形态与等级仍是统一倍率：护甲 +2、生命与攻击按倍率，不计点', () => {
    for (const d of tier0) {
      const e = UNITS[d.elite];
      expect(e.armM, d.key).toBe(d.armM + 2);
      expect(e.points, d.key).toBe(d.points);
      expect(e.lv, d.key).toEqual(d.lv);
      expect(e.power / d.power, d.key).toBeCloseTo(Math.sqrt(1.35 * 1.25), 6);
    }
  });

  it('级数范围登记在规则里（原型可以为个别维度声明自己的），展开兵种时执行：越出范围、护甲低于 0 都报错', () => {
    expect(LEVEL_RANGES.hp).toEqual([-6, 12]);
    expect(levelRange(ARCHETYPES[0], 'hp')).toEqual([-6, 12]);
    expect(levelRange({ ...ARCHETYPES[0], ranges: { hp: [-2, 3] } }, 'hp')).toEqual([-2, 3]);
    const mk = (lv: object, arch = 'inf'): unknown => () => expandUnit({ faction: 'china', key: 't', name: 't', arch, spec: { lv }, desc: '' }, EXPAND_RULES, false);
    expect(mk({ out: 12 })).not.toThrow();
    expect(mk({ out: 13 })).toThrow('越出范围');
    expect(mk({ hp: -7 })).toThrow('越出范围');
    expect(mk({ armM: -3 })).toThrow('护甲低于 0');
    // 攻击距离 0…+2，没有负级数
    expect(LEVEL_RANGES.reach).toEqual([0, 2]);
    expect(mk({ reach: 2 })).not.toThrow();
    expect(mk({ reach: 3 })).toThrow('越出范围');
    expect(mk({ reach: -1 })).toThrow('越出范围');
  });
});

describe('改价拦截：有意改价才改这里', () => {
  // 全工程只有这一处写死价目、预算、上限的现值。有意改价、改预算、改上限时同步改这里；
  // 其余用例验证的是规则（公式、加减同价、原型自带不计……），数值都引用常量，不会因改价连带改动。
  it('维度单价整表、各特性点数、兵员单价、两个预算、单兵种上下限的现值（有意改价才改这里）', () => {
    expect(DIM_PRICE).toEqual({
      hp: 1, out: 1, cad: 0.5, armM: 1, armP: 1, spd: 0.5, rng: 0.5, disc: 0.5, imp: 0.5, pen: 0.5, block: 0.5, splash: 1.5, reach: 8, heal: 1,
    });
    expect(Object.fromEntries(Object.entries(TRAITS).filter(([k]) => !k.startsWith('t_')).map(([k, t]) => [k, t.points]))).toEqual({
      bushido: 4.5, testudo: 4.5, sidebow: 3.5, polearm: 6.5, naginata: 3.5, cover: 2.5, firemove: 3, trample: 5.5, javelin: 2.5, pilum: 2, ballista: 0.5, pierce: -2,
    });
    expect(MANPOWER_PRICE).toBe(1.4);
    expect([FACTION_BUDGET, REINF_BUDGET]).toEqual([5.5, 5.5]);
    expect(UNIT_POINT_LIMITS).toEqual([-12, 24]);
  });
});

describe('维度单价与点数', () => {
  const tier0 = contentUnits().filter(d => d.tier === 0);
  /** 按定义独立算一遍：Σ 级数 × 单价 */
  const byPrice = (lv: Partial<Record<Dim, number>>): number => Object.entries(lv).reduce((n, [k, v]) => n + v * DIM_PRICE[k as Dim], 0);
  const mk = (spec: object, arch: string, key = 't') => expandUnit({ faction: 'china', key, name: 't', arch, spec, desc: '' }, EXPAND_RULES, false)[0];

  it('维度单价所有原型共用：每个维度都有正的单价，加一级花一个单价、减一级退同一个单价', () => {
    for (const k of DIMS) {
      expect(DIM_PRICE[k], k).toBeGreaterThan(0);
      expect(levelPoints({ [k]: 1 }), k).toBeCloseTo(DIM_PRICE[k], 12);
      expect(levelPoints({ [k]: -1 }), `${k} 减级`).toBeCloseTo(-DIM_PRICE[k], 12);
    }
  });

  it('级数的点数 = Σ 级数 × 单价：负级数退点没有例外，没写的维度为 0', () => {
    const lv = { hp: 4, out: -2, spd: 3, disc: -3, reach: 1, armM: 2 };
    expect(levelPoints(lv)).toBeCloseTo(byPrice(lv), 12);
    expect(levelPoints({ spd: -4 })).toBeCloseTo(-4 * DIM_PRICE.spd, 12);
    expect(levelPoints({})).toBe(0);
  });

  it('特性点数声明在特性上、有限数；兵种自己的特性不含原型缺省自带的，长柄是普通计点特性', () => {
    for (const t of Object.values(TRAITS)) expect(Number.isFinite(t.points), t.key).toBe(true);
    for (const k of ['ji', 'yari', 'auxilia', 'spara']) expect(UNIT_BY_KEY[k].ownTraits, k).toContain('polearm');
    expect(UNIT_BY_KEY.asvaran.ownTraits).not.toContain('firemove');
    expect(UNIT_BY_KEY.elephant.ownTraits).not.toContain('trample');
    expect(UNIT_BY_KEY.elephant.points).toBe(0);
    expect(UNIT_BY_KEY.asvaran.points).toBe(0);
  });

  it('每个兵种的点数 = Σ 级数 × 维度单价 + 兵种自己的特性点数之和（按定义独立算）', () => {
    for (const d of tier0) {
      const own = d.ownTraits.reduce((n, t) => n + TRAITS[t].points, 0);
      expect(d.points, d.key).toBeCloseTo(byPrice(d.lv) + own, 9);
    }
  });

  it('长柄是计点特性：四个长柄兵种的自有特性都含它，点数里各含一份长柄的点数', () => {
    for (const k of ['ji', 'yari', 'auxilia', 'spara']) {
      const d = UNIT_BY_KEY[k];
      const others = d.ownTraits.filter(t => t !== 'polearm').reduce((n, t) => n + TRAITS[t].points, 0);
      expect(d.points, k).toBeCloseTo(byPrice(d.lv) + TRAITS.polearm.points + others, 9);
    }
  });

  it('兵种用特性时改写克制倍率不另计点：[polearm, { cav: 2.5 }] 与直接挂 polearm 同点数，克制倍率按改写的', () => {
    const plain = mk({ traits: ['polearm'] }, 'inf'), over = mk({ traits: [['polearm', { cav: 2.5 }]] }, 'inf');
    expect(over.points).toBe(plain.points);
    expect(plain.points).toBe(TRAITS.polearm.points);
    expect(JSON.stringify(over.counter)).not.toBe(JSON.stringify(plain.counter));
  });

  it('兵种点数 = 级数的点数 + 特性点数，特性点数可为负（退点）', () => {
    expect(mk({ traits: ['pierce'] }, 'siege').points).toBe(TRAITS.pierce.points);
    expect(TRAITS.pierce.points).toBeLessThan(0);
    expect(mk({ lv: { spd: -2 } }, 'inf').points).toBeCloseTo(-2 * DIM_PRICE.spd, 12);
    expect(mk({ lv: { hp: 3, out: -1 }, traits: ['bushido'] }, 'inf').points).toBeCloseTo(3 * DIM_PRICE.hp - DIM_PRICE.out + TRAITS.bushido.points, 12);
  });

  it('新定义的特性按声明的点数计入，负数照存', () => {
    defineTrait('t_points_neg', { name: 't', points: -1.5 });
    expect(TRAITS.t_points_neg.points).toBe(-1.5);
    const d = mk({ traits: ['t_points_neg'], lv: { hp: 1 } }, 'inf', 't_pn');
    expect(d.points).toBeCloseTo(DIM_PRICE.hp - 1.5, 12);
  });

  it('src 里没有「位置」概念：不导出 POSITIONS、positionOf、positionTraits，兵种定义没有 position 字段', () => {
    for (const k of ['POSITIONS', 'positionOf', 'positionTraits', 'PRICES', 'estimatePoints']) expect(Object.keys(defs), k).not.toContain(k);
    for (const d of UNITS) expect(Object.keys(d), d.key).not.toContain('position');
    for (const t of Object.values(TRAITS)) expect(Object.keys(t), t.key).not.toContain('priceAt');
  });

  it('兵种的战力估值按点数折算：原型基准估值 × 1.05 ^ (点数 ÷（生命单价 + 输出单价）)，同原型点数越高越大', () => {
    for (const d of tier0) expect(d.power, d.key).toBeCloseTo(powerFromPoints(archetypePower(ARCHETYPES[d.arch]), d.points), 9);
    expect(mk({ lv: { hp: 4 } }, 'inf').power).toBeGreaterThan(mk({}, 'inf').power);
    expect(mk({}, 'inf').power).toBeCloseTo(archetypePower(ARCHETYPES.find(a => a.key === 'inf')!), 9);
  });

  it('战力估值 = 原型基准的战力估值 × 1.05 的（点数 ÷（生命单价 + 输出单价））次方', () => {
    const per = DIM_PRICE.hp + DIM_PRICE.out;
    expect(powerFromPoints(2, 0)).toBe(2);
    expect(powerFromPoints(2, per)).toBeCloseTo(2 * 1.05, 12);
    expect(powerFromPoints(2, -3 * per)).toBeCloseTo(2 * 1.05 ** -3, 12);
    // 点数折成「生命与输出各加几级」：对应的面板估值也是这个倍数
    const hp = 100, dmg = 10, cd = 1;
    const n = 3;
    expect(panelPower(hp * 1.05 ** n, dmg / cd * 1.05 ** n, 1, false, false) / panelPower(hp, dmg, cd, false, false)).toBeCloseTo(1.05 ** n, 6);
    expect(powerFromPoints(1, n * per)).toBeCloseTo(1.05 ** n, 12);
  });
});
