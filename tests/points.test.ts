import { describe, expect, it } from 'vitest';
import {
  ARCHETYPES, DIMS, EXPAND_RULES, HP_SCALE, LEVEL_RANGES, POSITIONS, PRICES, STRATEGIC_DIMS, levelRange, PriceTable, STEP, UNITS, UNIT_BY_KEY, applyLevels, dimPoints, estimatePoints,
  expandUnit, panelPower, powerFromPoints,
} from '../src/sim/defs';
import { contentUnits } from '../tools/measure/fingerprint';
import { Row } from '../tools/measure/measure';
import { FLOOR_DIMS, FLOOR_RATIO, derivePrices } from '../tools/measure/price';
import { estimateGaps, measuredUnits, readUnitPoints } from '../tools/measure/unitpoints';

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

  it('每个兵种都有位置与级数，级数只用原型开放的维度', () => {
    for (const d of tier0) {
      expect(Object.keys(POSITIONS), d.key).toContain(d.position);
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

describe('价目表与估算点数', () => {
  const table: PriceTable = {
    dims: { inf: { hp: [0.3, 0.28], out: [0.2, 0.2], armM: [0.25, 0.2], spd: [0.1, 0.1] } },
    traits: { inf: { bushido: 1.5 } },
    manpower: 0.4,
  };

  it('估算点数 = Σ 价目 × 级数 + 特性价目；加级用加级价目，减级用减级价目；战略维度（机动）减级不计', () => {
    expect(estimatePoints('inf', { hp: 4, out: -2, armM: 3 }, ['bushido'], table)).toBeCloseTo(4 * 0.3 + -2 * 0.2 + 3 * 0.25 + 1.5);
    expect(estimatePoints('inf', { hp: -5 }, [], table)).toBeCloseTo(-5 * 0.28);
    expect(estimatePoints('inf', { spd: 3 }, [], table)).toBeCloseTo(3 * 0.1);
    expect(estimatePoints('inf', { spd: -3 }, [], table)).toBe(0);
    // 用到的维度、特性在价目表里没有条目：报错（显式记 0 的不算缺格）
    expect(() => estimatePoints('inf', { disc: 5 }, [], table)).toThrow('价目表缺格');
    expect(() => estimatePoints('inf', {}, ['naginata'], table)).toThrow('价目表缺格');
    expect(() => estimatePoints('cav', { hp: 5 }, [], table)).toThrow('价目表缺格');
    expect(estimatePoints('inf', {}, [], table)).toBe(0);
  });

  it('攻击距离只有加级价目、不是战略维度：加级按价目计点，价目表里近战步兵、长柄、近战骑兵、载具各一格，别的位置没有', () => {
    expect(STRATEGIC_DIMS).not.toContain('reach');
    expect(FLOOR_DIMS).toContain('reach');
    const t: PriceTable = { dims: { inf: { reach: [0.4, 0] } }, traits: {}, manpower: 0 };
    expect(estimatePoints('inf', { reach: 1 }, [], t)).toBeCloseTo(0.4, 12);
    expect(estimatePoints('inf', { reach: 2 }, [], t)).toBeCloseTo(0.8, 12);
    expect(dimPoints('reach', 2, [0.4, 0])).toBeCloseTo(0.8, 12);
    expect(() => estimatePoints('ranged', { reach: 1 }, [], t)).toThrow('价目表缺格');
    expect(Object.keys(PRICES.dims).filter(pos => PRICES.dims[pos].reach).sort()).toEqual(['cav', 'ele', 'inf', 'spear']);
    for (const pos of ['inf', 'spear', 'cav', 'ele']) {
      const p = PRICES.dims[pos];
      // 地板价：加级价目不低于同位置生命加级价目的 1/3；没有减级价目
      expect(p.reach![0], pos).toBeGreaterThanOrEqual(p.hp![0] * FLOOR_RATIO - 1e-9);
      expect(p.reach![1], pos).toBe(0);
    }
  });

  it('汇总价目时攻击距离取实测与地板价（生命加级价目的三分之一）中较大的：实测不显著或为负就取地板价，实测更高就取实测', () => {
    const rows: Row[] = [];
    const push = (label: string, slot: string, levels: object, points: number, significant = true): void => {
      rows.push({ kind: 'dim', label, size: 100, n: 48, adv: 0, advSe: 0, win: 0, points, significant, meta: { slot, levels } });
    };
    for (const pos of Object.keys(POSITIONS)) {
      const a = ARCHETYPES.find(x => x.key === POSITIONS[pos].arch)!;
      for (const dim of a.dims.filter(k => k !== 'heal')) {
        const [up, down] = ['armM', 'armP'].includes(dim) ? [4, -3] : ['cad', 'spd', 'rng'].includes(dim) ? [4, -4] : dim === 'reach' ? [1, null] : [8, -8];
        const val = (lv: number): number => (dim === 'hp' ? (lv > 0 ? 2.4 : -2) : dim === 'reach' ? (pos === 'cav' ? 2 : 0.1) : lv > 0 ? 0.8 : -0.4);
        push(`${pos}:${dim}=${up}`, pos, { [dim]: up }, val(up), !(dim === 'reach' && pos === 'ele'));
        if (down !== null) push(`${pos}:${dim}=${down}`, pos, { [dim]: down }, val(down));
      }
    }
    rows.push({ kind: 'count', label: 'manpower:+8', size: 449, n: 96, adv: 0, advSe: 0, win: 0, points: 3, significant: true, meta: { slot: 'all', manpower: 7.5 } });
    const t = derivePrices(rows);
    // 生命每级 0.3 点，地板价 0.1
    expect(t.dims.inf.reach![0]).toBeCloseTo(0.1, 9);
    expect(t.dims.spear.reach![0]).toBeCloseTo(0.1, 9);
    // 实测 2 点每级，高于地板价，取实测
    expect(t.dims.cav.reach![0]).toBeCloseTo(2, 9);
    // 不显著记 0，再取地板价
    expect(t.dims.ele.reach![0]).toBeCloseTo(t.dims.ele.hp![0] / 3, 9);
    // 只量加级，减级价目是 0
    for (const pos of ['inf', 'spear', 'cav', 'ele']) expect(t.dims[pos].reach![1], pos).toBe(0);
    // 不开放的位置没有这一格
    expect(t.dims.ranged.reach).toBeUndefined();
    expect(t.dims.bolt.reach).toBeUndefined();
  });

  it('战力估值 = 原型基准的战力估值 × 1.05 的（点数 ÷（生命价目 + 输出价目））次方', () => {
    expect(powerFromPoints(2, 'inf', 0, table)).toBe(2);
    expect(powerFromPoints(2, 'inf', 1, table)).toBeCloseTo(2 * 1.05 ** (1 / 0.5));
    // 点数折成「生命与输出各加几级」：对应的面板估值也是这个倍数
    const hp = 100, dmg = 10, cd = 1;
    const n = 3;
    expect(panelPower(hp * 1.05 ** n, dmg / cd * 1.05 ** n, 1, false, false) / panelPower(hp, dmg, cd, false, false)).toBeCloseTo(1.05 ** n, 6);
    // 没有价目（价目表是空的）时不改战力估值
    expect(powerFromPoints(2, 'inf', 5, { dims: {}, traits: {}, manpower: 0 })).toBe(2);
  });

  it('汇总价目：每格 = 点数 ÷ 级数；不显著记 0；加级为负按 0；机动、射程、纪律的加级取实测与地板价（生命加级价目的三分之一）中较大的；特性取差值；兵员取每级的点数', () => {
    const row = (label: string, slot: string, levels: Row['meta'] extends infer M ? any : never, points: number, significant = true): Row => ({
      kind: 'dim', label, size: 100, n: 48, adv: 0, advSe: 0, win: 0, points, significant, meta: { slot, levels },
    });
    const rows: Row[] = [];
    for (const pos of Object.keys(POSITIONS)) {
      const a = ARCHETYPES.find(x => x.key === POSITIONS[pos].arch)!;
      for (const dim of a.dims.filter(k => k !== 'heal')) {
        const [up, down] = ['armM', 'armP'].includes(dim) ? [4, -3] : ['cad', 'spd', 'rng'].includes(dim) ? [4, -4] : [8, -8];
        // 生命量得 +2.4 / −2.0 点；机动实测为负；射程不显著；近战护甲加级为负、减级为正（减一级反而更强）；其余统一 +0.8 / −0.4
        const pts = (lv: number): [number, boolean] =>
          dim === 'hp' ? [lv > 0 ? 2.4 : -2.0, true] : dim === 'spd' ? [lv > 0 ? -0.5 : 0.3, true] : dim === 'rng' ? [0.1, false]
            : dim === 'armM' && pos === 'cav' ? [lv > 0 ? -0.2 : 0.3, true] : [lv > 0 ? 0.8 : -0.4, true];
        for (const lv of [up, down]) rows.push(row(`${pos}:${dim}=${lv}`, pos, { [dim]: lv }, pts(lv)[0], pts(lv)[1]));
      }
    }
    rows.push({ kind: 'trait', label: 'inf:+bushido', size: 100, n: 48, adv: 0, advSe: 0, win: 0, points: 2.2, significant: true, meta: { slot: 'inf', trait: 'bushido' } });
    rows.push({ kind: 'trait', label: 'inf:+testudo', size: 100, n: 48, adv: 0, advSe: 0, win: 0, points: 1, significant: false, meta: { slot: 'inf', trait: 'testudo' } });
    rows.push({ kind: 'count', label: 'manpower:+8', size: 449, n: 96, adv: 0, advSe: 0, win: 0, points: 3, significant: true, meta: { slot: 'all', manpower: 7.5 } });
    const t = derivePrices(rows);
    expect(t.dims.inf.hp![0]).toBeCloseTo(2.4 / 8);
    expect(t.dims.inf.hp![1]).toBeCloseTo(-2.0 / -8);
    expect(t.dims.inf.armM![0]).toBeCloseTo(0.8 / 4);
    expect(t.dims.inf.armM![1]).toBeCloseTo(-0.4 / -3);
    // 机动实测为负：加级按 0 再取地板价；地板价只作用于加级，减级照实测（0.3 / −4，战略维度减级本来就不计点）
    expect(t.dims.inf.spd![0]).toBeCloseTo(0.3 / 3);
    expect(t.dims.inf.spd![1]).toBeCloseTo(0.3 / -4);
    // 加级价目为负按 0（加一级不能倒找点数）；减级价目为负照记（减一级时是收点数）
    expect(t.dims.cav.armM).toEqual([0, 0.3 / -3]);
    // 射程不显著记 0，再取地板价
    expect(t.dims.ranged.rng![0]).toBeCloseTo(0.3 / 3);
    expect(t.traits.inf.bushido).toBe(2.2);
    expect(t.traits.inf.testudo).toBe(0);
    // 兵员每级 = 点数 ÷ 实际加的兵员级数
    expect(t.manpower).toBeCloseTo(3 / 7.5);
    expect(() => derivePrices(rows.slice(1))).toThrow('缺测量');
    expect(() => derivePrices(rows.slice(0, -1))).toThrow('缺测量：兵员');
  });
});

describe('兵种实测表（参考，不进门槛）', () => {
  it('字段齐全；每个兵种的位置、点数与标准误是有限数', () => {
    const f = readUnitPoints();
    expect(f.fingerprint).toMatch(/^[0-9a-f]{16}$/);
    for (const [k, u] of Object.entries(f.units)) {
      expect(Object.keys(POSITIONS), k).toContain(u.position);
      expect(Number.isFinite(u.points) && Number.isFinite(u.estimate) && u.se >= 0, k).toBe(true);
    }
    // 参与实测的是全部初级形态的正式兵种
    expect(measuredUnits().length).toBe(28);
  });

  it('估算与实测相差超过 1 点的兵种能列出清单，按相差大小排序', () => {
    const gaps = estimateGaps(readUnitPoints());
    for (const g of gaps) expect(Math.abs(g.diff)).toBeGreaterThan(1);
    for (let i = 1; i < gaps.length; i++) expect(Math.abs(gaps[i - 1].diff)).toBeGreaterThanOrEqual(Math.abs(gaps[i].diff));
  });
});
