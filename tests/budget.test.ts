import { describe, expect, it } from 'vitest';
import {
  ARCHETYPES, DIMS, FACTIONS, FACTION_BUDGET, FACTION_IDS, LEVEL_RANGES, MANPOWER_PRICE, MANPOWER_STEP, REINF_BUDGET, REINF_STEP, TRAITS, UNIT_BY_KEY,
  UNIT_POINT_LIMITS, factionPoints, floorLevel, forceList, headcount, levelPoints, levelRange, manpowerForBudget, manpowerMult, reinfLevelForBudget, reinfPoints,
  reinfShares, reinforceMult, unitPoints,
} from '../src/sim/defs';
import { armyList } from '../src/sim/setup';
import { contentUnits } from '../tools/measure/units';

const countBy = (list: number[]): Record<string, number> => {
  const byIdx = new Map(Object.values(UNIT_BY_KEY).map(d => [d.idx, d.key]));
  const out: Record<string, number> = {};
  for (const i of list) out[byIdx.get(i)!] = (out[byIdx.get(i)!] ?? 0) + 1;
  return out;
};

describe('兵员：阵营级维度，兵员倍率只由兵员级数给出', () => {
  it('兵员倍率 = 1.035 的兵员级数次方，级数可以是负数、小数；阵营定义里没有别的开局兵力倍率', () => {
    expect(MANPOWER_STEP).toBe(1.035);
    expect(manpowerMult({ manpower: 0 })).toBe(1);
    expect(manpowerMult({ manpower: -1.5 })).toBeCloseTo(1.035 ** -1.5, 12);
    for (const id of FACTION_IDS) {
      expect(Object.keys(FACTIONS[id]), id).not.toContain('armyMult');
      expect(Number.isFinite(FACTIONS[id].manpower), id).toBe(true);
    }
  });

  it('开局人数 = 份数 × 兵员倍率 × 比重 ÷ 兵力占用；兵员级数多 1 级，各兵种按 ×1.035 后的份数换算', () => {
    for (const id of FACTION_IDS) {
      const f = FACTIONS[id];
      for (const lv of [f.manpower, f.manpower + 1]) {
        const c = countBy(armyList({ ...f, manpower: lv }, 900));
        for (const [k, share] of f.army) expect(c[k], `${id} ${k} 兵员 ${lv}`).toBe(headcount(UNIT_BY_KEY[k], 900 * MANPOWER_STEP ** lv * share));
      }
    }
  });

});

describe('援军：阵营级维度，援军倍率只由援军级数给出', () => {
  it('援军倍率 = 1.035 的援军级数次方，级数可以是负数、小数；阵营定义里没有别的援军倍率', () => {
    expect(REINF_STEP).toBe(1.035);
    expect(reinforceMult({ reinfLevel: 0 })).toBe(1);
    expect(reinforceMult({ reinfLevel: -2.5 })).toBeCloseTo(1.035 ** -2.5, 12);
    for (const id of FACTION_IDS) {
      expect(Object.keys(FACTIONS[id]), id).not.toContain('reinfMult');
      expect(Number.isFinite(FACTIONS[id].reinfLevel), id).toBe(true);
    }
  });

  it('全兵种援军的人数 = 份数 × 援军倍率 ÷ 占用；援军级数多 1 级，各兵种按 ×1.035 后的份数换算', () => {
    for (const id of FACTION_IDS) {
      const f = FACTIONS[id];
      for (const lv of [f.reinfLevel, f.reinfLevel + 1]) {
        const got = countBy(forceList(f.reinf, reinforceMult({ reinfLevel: lv })));
        for (const [k, n] of f.reinf) expect(got[k], `${id} ${k} 援军 ${lv}`).toBe(headcount(UNIT_BY_KEY[k], n * REINF_STEP ** lv));
      }
    }
  });
});

describe('阵营点数的计算', () => {
  it('兵种点数 = Σ 级数 × 维度单价 + 兵种自己的特性点数，就是兵种定义里的 points', () => {
    for (const d of contentUnits().filter(u => u.tier === 0)) expect(unitPoints(d.key), d.key).toBe(d.points);
    const samurai = UNIT_BY_KEY.samurai;
    expect(samurai.ownTraits).toContain('bushido');
    expect(samurai.points).toBeCloseTo(levelPoints(samurai.lv) + samurai.ownTraits.reduce((n, t) => n + TRAITS[t].points, 0), 9);
  });

  it('阵营点数 = Σ 兵力比重 × 兵种点数 + 兵员级数 × 兵员单价', () => {
    for (const id of FACTION_IDS) {
      const f = FACTIONS[id];
      const unit = f.army.reduce((n, [k, share]) => n + share * UNIT_BY_KEY[k].points, 0);
      const p = factionPoints(f);
      expect(p.unitSum, id).toBeCloseTo(unit, 9);
      expect(p.manpowerCost, id).toBeCloseTo(MANPOWER_PRICE * f.manpower, 9);
      expect(p.total, id).toBeCloseTo(unit + MANPOWER_PRICE * f.manpower, 9);
      expect(p.units.map(u => u.key), id).toEqual(f.army.map(([k]) => k));
    }
  });

  it('自造编制核对：比重 0.25 / 0.75 的两个兵种、兵员 2 级 = 0.25 × 甲 + 0.75 × 乙 + 2 × 兵员单价', () => {
    const [a, b] = [UNIT_BY_KEY.legion.points, UNIT_BY_KEY.equites.points];
    expect(a).not.toBe(b);
    const army: [string, number][] = [['legion', 0.25], ['equites', 0.75]];
    expect(factionPoints({ army, manpower: 2 }).total).toBeCloseTo(0.25 * a + 0.75 * b + 2 * MANPOWER_PRICE, 9);
  });

  it('兵员级数只通过「级数 × 兵员单价」一项进账，是线性的；兵种构成不变时阵营点数只差这一项', () => {
    const army = FACTIONS.persia.army;
    const at0 = factionPoints({ army, manpower: 0 }).total;
    for (const m of [-3, -0.5, 1, 4.25]) expect(factionPoints({ army, manpower: m }).total, `${m}`).toBeCloseTo(at0 + MANPOWER_PRICE * m, 9);
  });

  it('补到预算要的兵员级数 = (预算 − Σ 比重 × 兵种点数) ÷ 兵员单价；代回去阵营点数等于预算；预算更高级数更高', () => {
    const sum = FACTIONS.japan.army.reduce((n, [k, share]) => n + share * UNIT_BY_KEY[k].points, 0);
    expect(manpowerForBudget(FACTIONS.japan, FACTION_BUDGET)).toBeCloseTo((FACTION_BUDGET - sum) / MANPOWER_PRICE, 9);
    const f = { ...FACTIONS.japan, manpower: 0 };
    for (const budget of [-3, 2, 9]) {
      const lv = manpowerForBudget(f, budget);
      expect(factionPoints({ ...f, manpower: lv }).total, `预算 ${budget}`).toBeCloseTo(budget, 6);
    }
    expect(manpowerForBudget(f, 5)).toBeGreaterThan(manpowerForBudget(f, 2));
    expect(manpowerForBudget(f, 5) - manpowerForBudget(f, 2)).toBeCloseTo(3 / MANPOWER_PRICE, 9);
  });
});

describe('向下取到 0.01 级', () => {
  it('floorLevel 向下取整到两位小数，负数也是向下（更小）', () => {
    expect(floorLevel(0.689)).toBe(0.68);
    expect(floorLevel(1.5)).toBe(1.5);
    expect(floorLevel(-2.831)).toBe(-2.84);
    expect(floorLevel(0.004)).toBe(0);
  });

  it('floorLevel：恰好落在 0.01 格点上的值不因浮点误差多降一格，略低于格点的才降', () => {
    for (const x of [0.29, 1.15, 4.35, 0.57, -0.29, -1.15]) expect(floorLevel(x), `${x}`).toBe(x);
    expect(floorLevel(0.299)).toBe(0.29);
    expect(floorLevel(-0.291)).toBe(-0.3);
    expect(floorLevel(4.349)).toBe(4.34);
  });

  it('补到预算的级数向下取到 0.01 后：阵营点数不超过预算，差额小于一个 0.01 级的价（0.014）', () => {
    for (const id of FACTION_IDS) {
      for (const budget of [FACTION_BUDGET, 0, 3.7, 12.345]) {
        const left = budget - factionPoints({ ...FACTIONS[id], manpower: floorLevel(manpowerForBudget(FACTIONS[id], budget)) }).total;
        expect(left, `${id} 预算 ${budget}`).toBeGreaterThanOrEqual(-1e-9);
        expect(left, `${id} 预算 ${budget}`).toBeLessThan(MANPOWER_PRICE * 0.01 + 1e-9);
        const rleft = budget - reinfPoints({ reinf: FACTIONS[id].reinf, reinfLevel: floorLevel(reinfLevelForBudget(FACTIONS[id], budget)) }).total;
        expect(rleft, `${id} 援军 预算 ${budget}`).toBeGreaterThanOrEqual(-1e-9);
        expect(rleft, `${id} 援军 预算 ${budget}`).toBeLessThan(MANPOWER_PRICE * 0.01 + 1e-9);
      }
    }
  });
});

describe('阵营点数预算', () => {
  it('预算是固定常量（有限正数），各阵营共用同一个，阵营定义里没有自己的预算字段', () => {
    for (const b of [FACTION_BUDGET, REINF_BUDGET]) expect(Number.isFinite(b) && b > 0).toBe(true);
    for (const id of FACTION_IDS) expect(Object.keys(FACTIONS[id]).filter(k => /budget/i.test(k)), id).toEqual([]);
  });

  it('每个阵营的阵营点数不超过预算', () => {
    for (const id of FACTION_IDS) expect(factionPoints(FACTIONS[id]).total, id).toBeLessThanOrEqual(FACTION_BUDGET + 1e-9);
  });

  it('现有四阵营用兵员级数补到了预算（差额不到 0.014 点，一个 0.01 级的价），级数就是补到预算的级数（兵种变了要运行 npm run measure -- budget --write）', () => {
    const stale = '兵员级数过期，运行 npm run measure -- budget --write';
    for (const id of FACTION_IDS) {
      expect(FACTION_BUDGET - factionPoints(FACTIONS[id]).total, id).toBeLessThan(MANPOWER_PRICE * 0.01 + 1e-9);
      expect(FACTIONS[id].manpower, `${id} ${stale}`).toBe(floorLevel(manpowerForBudget(FACTIONS[id], FACTION_BUDGET)));
    }
  });
});

describe('援军点数预算（城池、城镇的全兵种援军表，按与开局同一套算法计账）', () => {
  const ids = FACTION_IDS;

  it('援军比重 = 每个兵种的份数 ÷ 全表每批总份数，和为 1', () => {
    for (const id of ids) {
      const sh = reinfShares(FACTIONS[id]);
      expect(sh.reduce((n, [, x]) => n + x, 0), id).toBeCloseTo(1, 9);
      const total = FACTIONS[id].reinf.reduce((n, [, x]) => n + x, 0);
      FACTIONS[id].reinf.forEach(([k, n], i) => {
        expect(sh[i][0]).toBe(k);
        expect(sh[i][1], `${id} ${k}`).toBeCloseTo(n / total, 9);
      });
    }
  });

  it('自造援军表核对：份数 3 : 1 的两个兵种、援军 1 级 = 0.75 × 甲 + 0.25 × 乙 + 兵员单价', () => {
    const [x, y] = [UNIT_BY_KEY.legion.points, UNIT_BY_KEY.equites.points];
    expect(reinfPoints({ reinf: [['legion', 3], ['equites', 1]], reinfLevel: 1 }).total).toBeCloseTo(0.75 * x + 0.25 * y + MANPOWER_PRICE, 9);
  });

  it('援军点数 = Σ 援军表比重 × 兵种点数 + 援军级数 × 兵员单价', () => {
    for (const id of ids) {
      const f = { ...FACTIONS[id], reinfLevel: 1.5 };
      const unit = reinfShares(f).reduce((n, [k, share]) => n + share * UNIT_BY_KEY[k].points, 0);
      const p = reinfPoints(f);
      expect(p.unitSum, id).toBeCloseTo(unit, 9);
      expect(p.manpowerCost, id).toBeCloseTo(MANPOWER_PRICE * 1.5, 9);
      expect(p.total, id).toBeCloseTo(unit + MANPOWER_PRICE * 1.5, 9);
      expect(p.units.map(u => u.key), id).toEqual(f.reinf.map(([k]) => k));
    }
  });

  it('援军级数的价格与兵员级数共用同一个兵员单价', () => {
    const f = FACTIONS.china;
    expect(reinfPoints({ reinf: f.reinf, reinfLevel: 1 }).manpowerCost).toBeCloseTo(MANPOWER_PRICE, 12);
    expect(factionPoints({ ...f, manpower: 1 }).manpowerCost).toBeCloseTo(MANPOWER_PRICE, 12);
  });

  it('补到预算要的援军级数：代回去援军点数等于预算；预算更高级数更高', () => {
    const f = { id: 'china' as const, reinf: FACTIONS.china.reinf };
    for (const budget of [3, 7.6, 12]) {
      const lv = reinfLevelForBudget(f, budget);
      expect(reinfPoints({ reinf: f.reinf, reinfLevel: lv }).total, `预算 ${budget}`).toBeCloseTo(budget, 6);
    }
    expect(reinfLevelForBudget(f, 9)).toBeGreaterThan(reinfLevelForBudget(f, 6));
  });

  it('每个阵营的援军点数不超过援军预算', () => {
    for (const id of ids) expect(reinfPoints(FACTIONS[id]).total, id).toBeLessThanOrEqual(REINF_BUDGET + 1e-9);
  });

  it('现有四阵营用援军级数补到了预算（差额不到 0.014 点），级数就是补到预算的级数（向下取到 0.01）', () => {
    const stale = '援军级数已过期：请运行 npm run measure -- reinf --write 重算并提交';
    for (const id of ids) {
      expect(REINF_BUDGET - reinfPoints(FACTIONS[id]).total, `${id} ${stale}`).toBeLessThan(MANPOWER_PRICE * 0.01 + 1e-9);
      expect(FACTIONS[id].reinfLevel, `${id} ${stale}`).toBe(floorLevel(reinfLevelForBudget(FACTIONS[id], REINF_BUDGET)));
    }
  });
});

describe('级数范围与单兵种上下限', () => {
  const tier0 = contentUnits().filter(d => d.tier === 0);

  it('各兵种每个维度的级数都在范围内，护甲不低于 0', () => {
    const bad: string[] = [];
    for (const d of tier0) {
      for (const k of DIMS) {
        const v = d.lv[k] ?? 0;
        const [lo, hi] = levelRange(ARCHETYPES[d.arch], k);
        if (v < lo || v > hi) bad.push(`${d.key} ${k}=${v}（${lo}…${hi}）`);
      }
      if (d.armM < 0 || d.armP < 0) bad.push(`${d.key} 护甲低于 0`);
    }
    expect(bad).toEqual([]);
  });

  it('射程放宽到 −6…+6（超过两成的现有远程兵种越限，按规则放到八成落在范围内），攻击距离 0…+2，其余维度用初值表', () => {
    expect(LEVEL_RANGES).toEqual({
      hp: [-6, 12], out: [-6, 12], cad: [-8, 8], armM: [-3, 8], armP: [-3, 8], spd: [-4, 6], rng: [-6, 6], disc: [-3, 6], imp: [-3, 6], heal: [-4, 8],
      pen: [0, 8], splash: [-15, 5], block: [0, 14], reach: [0, 2],
    });
  });

  it('各兵种的点数在单兵种上下限内（含边界）', () => {
    for (const d of contentUnits().filter(u => u.tier === 0)) {
      expect(d.points, d.key).toBeGreaterThanOrEqual(UNIT_POINT_LIMITS[0]);
      expect(d.points, d.key).toBeLessThanOrEqual(UNIT_POINT_LIMITS[1]);
    }
  });

  it('各阵营开局编制的比重之和为 1', () => {
    for (const id of FACTION_IDS) expect(FACTIONS[id].army.reduce((n, [, x]) => n + x, 0), id).toBeCloseTo(1, 6);
  });
});
