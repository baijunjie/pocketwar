import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ARCHETYPES, DIMS, FACTIONS, FACTION_BUDGET, FACTION_IDS, FactionDef, LEVEL_RANGES, MANPOWER_STEP, PRICES, PriceTable, REINF_BUDGET, REINF_STEP, UNIT_BY_KEY,
  UNIT_POINT_LIMITS, dimPoints, estimatePoints, forceList, headcount, levelRange, manpowerMult, reinforceMult,
} from '../src/sim/defs';
import { derivePrices } from '../tools/measure/price';
import type { Row } from '../tools/measure/measure';
import { armyList } from '../src/sim/setup';
import { contentUnits, measureFingerprint, pricingFingerprint } from '../tools/measure/fingerprint';
import {
  BUDGET_BASE_MANPOWER, factionBudgetOf, factionPoints, floorLevel, manpowerForBudget, reinfBudgetOf, reinfLevelForBudget, reinfPoints, reinfShares, shareRatio, unitPoints, unitStrategicCost,
} from '../tools/measure/faction';
import { PRICE_ROWS_FILE } from '../tools/measure/unitpoints';
import { REF_SHARE, refForcePerHead } from '../tools/measure/units';

/** 一张完整的试算价目表：游戏价目表每格减半，兵员每级 0.5 点 */
function halfTable(): PriceTable {
  const dims: PriceTable['dims'] = {}, traits: PriceTable['traits'] = {};
  for (const [pos, d] of Object.entries(PRICES.dims)) {
    dims[pos] = {};
    for (const [k, v] of Object.entries(d)) dims[pos][k as keyof typeof d] = [v![0] / 2, v![1] / 2];
  }
  for (const [pos, d] of Object.entries(PRICES.traits)) traits[pos] = Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v / 2]));
  return { dims, traits, manpower: 0.5 };
}

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
  const table = halfTable();

  it('兵力份数之比 = 兵员倍率 × 比重 ÷（位置人数比例 × 占用 ÷ 标准混编军每人平均占用）', () => {
    const d = UNIT_BY_KEY.samurai;
    const slot = REF_SHARE[d.position] * ARCHETYPES[d.arch].force / refForcePerHead();
    expect(shareRatio({ manpower: 0 }, 'samurai', 0.2)).toBeCloseTo(0.2 / slot, 9);
    expect(shareRatio({ manpower: 2 }, 'samurai', 0.2)).toBeCloseTo(1.035 ** 2 * 0.2 / slot, 9);
  });

  it('顶替别的位置的兵种（直射器械的蝎弩）按被顶替的器械位的人数比例、自己原型的占用算份数之比', () => {
    const d = UNIT_BY_KEY.scorpio;
    expect(d.position).toBe('bolt');
    const slot = REF_SHARE.siege * ARCHETYPES[d.arch].force / refForcePerHead();
    expect(shareRatio({ manpower: 0 }, 'scorpio', 0.2)).toBeCloseTo(0.2 / slot, 9);
    expect(Number.isFinite(shareRatio({ manpower: 0 }, 'scorpio', 0.2))).toBe(true);
  });

  it('兵种的战略维度成本：机动、射程、纪律的加级价目 × 高于基准的级数；低于基准的不计，其它维度不计', () => {
    const lv = UNIT_BY_KEY.samurai.lv, inf = table.dims.inf;
    expect(unitStrategicCost('samurai', table)).toBeCloseTo(Math.max(0, lv.spd ?? 0) * inf.spd![0] + Math.max(0, lv.disc ?? 0) * inf.disc![0], 9);
    // 机动低于基准（铁甲骑兵）不倒找
    const cata = UNIT_BY_KEY.cataphract.lv;
    expect(cata.spd!).toBeLessThan(0);
    expect(unitStrategicCost('cataphract', table)).toBeCloseTo(Math.max(0, cata.disc ?? 0) * table.dims.cav.disc![0], 9);
  });

  it('攻击距离按加级价目计进兵种点数，但不算战略成本：长戟兵（长柄位 +1 攻击距离）的点数比去掉攻击距离多一格价目，战略成本只看机动、射程、纪律', () => {
    const d = UNIT_BY_KEY.ji;
    expect(d.position).toBe('spear');
    expect(d.lv.reach).toBe(1);
    expect(unitPoints('ji', table) - estimatePoints('spear', { ...d.lv, reach: 0 }, d.ownTraits, table)).toBeCloseTo(table.dims.spear.reach![0], 9);
    expect(table.dims.spear.reach![0]).toBeGreaterThan(0);
    const lv = d.lv;
    expect(unitStrategicCost('ji', table)).toBeCloseTo(Math.max(0, lv.spd ?? 0) * table.dims.spear.spd![0] + Math.max(0, lv.disc ?? 0) * table.dims.spear.disc![0], 9);
  });

  it('兵种点数 = 估算点数：各维度级数 × 价目（加级减级各用各的）+ 兵种自己的特性价目；战略维度只计加级，减级不计不退点', () => {
    // 步兵位：生命、护甲加级用加级价目，节奏、近战护甲减级用减级价目；机动加级照计，纪律减级（战略维度）不计不退
    const inf = table.dims.inf;
    const L = { hp: 2, cad: -2, out: 3, armM: -1, armP: 1, spd: 2, disc: -3 };
    const want = 2 * inf.hp![0] + -2 * inf.cad![1] + 3 * inf.out![0] + -1 * inf.armM![1] + 1 * inf.armP![0] + 2 * inf.spd![0] + table.traits.inf.testudo;
    expect(table.traits.inf.testudo).toBeGreaterThan(0);
    expect(estimatePoints('inf', L, ['testudo'], table)).toBeCloseTo(want, 9);
    // 骑兵位：机动减级不计；生命、护甲、纪律加级照常
    const cav = table.dims.cav;
    expect(estimatePoints('cav', { hp: 4, armM: 2, spd: -4, disc: 3 }, [], table)).toBeCloseTo(4 * cav.hp![0] + 2 * cav.armM![0] + 3 * cav.disc![0], 9);
    expect(dimPoints('spd', -4, [0.1, 0.3])).toBe(0);
    expect(dimPoints('hp', -4, [0.1, 0.3])).toBeCloseTo(-1.2, 9);
    // 兵种点数就是按它自己的位置、级数与特性估的
    for (const key of ['samurai', 'cataphract']) {
      const d = UNIT_BY_KEY[key];
      expect(unitPoints(key, table), key).toBeCloseTo(estimatePoints(d.position, d.lv, d.ownTraits, table), 9);
    }
    // 用游戏的价目表时就是兵种定义里的估算点数
    for (const d of contentUnits().filter(u => u.tier === 0)) expect(unitPoints(d.key), d.key).toBeCloseTo(d.points, 9);
  });

  it('蝎弩（直射器械）的点数：生命、护甲等级数都是基准，只有破甲 +8 与重弩特性计点', () => {
    const d = UNIT_BY_KEY.scorpio;
    expect(d.lv).toEqual({ pen: 8 });
    expect(unitPoints('scorpio')).toBeCloseTo(PRICES.dims.bolt.pen![0] * 8 + PRICES.traits.bolt.ballista, 9);
    expect(unitPoints('scorpio')).toBeGreaterThanOrEqual(UNIT_POINT_LIMITS[0]);
    expect(unitPoints('scorpio')).toBeLessThanOrEqual(UNIT_POINT_LIMITS[1]);
  });

  it('兵种用到的维度或特性在价目表里没有条目时直接报错（显式记 0 的不算缺格）', () => {
    const t = halfTable();
    delete t.dims.inf.disc;
    expect(() => unitPoints('samurai', t)).toThrow('价目表缺格：inf 的 disc');
    const u = halfTable();
    delete u.traits.inf.bushido;
    expect(() => unitPoints('samurai', u)).toThrow('价目表缺格：inf 的特性 bushido');
    const z = halfTable();
    z.dims.inf.disc = [0, 0];
    expect(() => unitPoints('samurai', z)).not.toThrow();
  });

  it('阵营点数 = Σ 兵种点数（已含战略维度成本）× 份数之比 + 兵员价目 × 兵员级数；战略维度成本单列只为看构成', () => {
    for (const id of FACTION_IDS) {
      const f = FACTIONS[id];
      let unit = 0, st = 0;
      for (const [k, share] of f.army) {
        const r = shareRatio(f, k, share);
        unit += unitPoints(k, table) * r;
        st += unitStrategicCost(k, table) * r;
      }
      const p = factionPoints(f, table);
      expect(p.unitSum, id).toBeCloseTo(unit, 9);
      expect(p.strategic, id).toBeCloseTo(st, 9);
      expect(p.manpowerCost, id).toBeCloseTo(0.5 * f.manpower, 9);
      expect(p.total, id).toBeCloseTo(unit + 0.5 * f.manpower, 9);
      expect(p.units.map(u => u.key), id).toEqual(f.army.map(([k]) => k));
    }
  });

  it('补到预算要的兵员级数：代回去阵营点数等于预算；预算更高级数更高', () => {
    const f: FactionDef = { ...FACTIONS.japan, manpower: 0 };
    for (const budget of [-3, 2, 9]) {
      const lv = manpowerForBudget(f, budget, PRICES);
      expect(factionPoints({ ...f, manpower: lv }).total, `预算 ${budget}`).toBeCloseTo(budget, 6);
    }
    expect(manpowerForBudget(f, 5)).toBeGreaterThan(manpowerForBudget(f, 2));
  });
});

describe('阵营点数预算（按提交的价目表计账）', () => {
  it('价目测量与价目表各自的指纹是最新的（过期时失败）；指纹不含具体兵种，配新兵种不会让它们失效', () => {
    expect(readJson<{ fingerprint: string }>(PRICE_ROWS_FILE).fingerprint,
      '价目测量已过期：规则、原型、特性、位置或测量规程变了，请运行 npm run measure -- prices 重量并提交').toBe(measureFingerprint());
    expect(PRICES.fingerprint, '价目表已过期：测量或地板价规则变了，测量没变时运行 npm run measure -- prices --derive，否则重量').toBe(pricingFingerprint());
    const before = [measureFingerprint(), pricingFingerprint()];
    UNIT_BY_KEY.samurai.lv.hp = (UNIT_BY_KEY.samurai.lv.hp ?? 0) + 1;
    try {
      expect([measureFingerprint(), pricingFingerprint()]).toEqual(before);
    } finally {
      UNIT_BY_KEY.samurai.lv.hp! -= 1;
    }
  });

  it('兵员价目由人数测量给出，为正', () => {
    expect(PRICES.manpower).toBeGreaterThan(0);
  });

  it('每个阵营的阵营点数不超过预算', () => {
    for (const id of FACTION_IDS) expect(factionPoints(FACTIONS[id]).total, id).toBeLessThanOrEqual(FACTION_BUDGET + 1e-9);
  });

  it('现有四阵营用兵员级数补到了预算（差额不到 0.02 点）', () => {
    for (const id of FACTION_IDS) expect(FACTION_BUDGET - factionPoints(FACTIONS[id]).total, id).toBeLessThan(0.02);
  });

  it('预算与兵员级数按规则算出且是最新的（价目或兵种变了要运行 npm run measure -- budget --write）', () => {
    const stale = '阵营预算或兵员级数过期，运行 npm run measure -- budget --write';
    expect(BUDGET_BASE_MANPOWER).toEqual({ china: 1.69, japan: -2.11, rome: -1.95, persia: -1.19 });
    expect(FACTION_BUDGET, stale).toBeCloseTo(factionBudgetOf(FACTION_IDS.map(id => FACTIONS[id])), 3);
    for (const id of FACTION_IDS) expect(FACTIONS[id].manpower, `${id} ${stale}`).toBe(floorLevel(manpowerForBudget(FACTIONS[id], FACTION_BUDGET)));
  });

  it('提交的价目表就是按提交的测量结果汇总出来的（汇总规则改了要运行 npm run measure -- prices --derive）', () => {
    const rows = readJson<{ rows: Row[] }>(PRICE_ROWS_FILE).rows;
    const { fingerprint: _f, ...prices } = PRICES;
    expect(derivePrices(rows)).toEqual(prices);
  });
});

describe('援军点数预算（城池、城镇的全兵种援军表，按与开局同一套算法计账）', () => {
  const ids = FACTION_IDS;
  const at0 = (id: (typeof FACTION_IDS)[number]): number => reinfPoints({ reinf: FACTIONS[id].reinf, reinfLevel: 0 }).total;

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

  it('援军点数 = Σ 兵种点数 × 份数之比 + 兵员价目 × 援军级数（份数之比里的倍率是援军倍率）', () => {
    const table = halfTable();
    for (const id of ids) {
      const f = { ...FACTIONS[id], reinfLevel: 1.5 };
      let unit = 0, st = 0;
      for (const [k, share] of reinfShares(f)) {
        const r = shareRatio({ manpower: 1.5 }, k, share);
        unit += unitPoints(k, table) * r;
        st += unitStrategicCost(k, table) * r;
      }
      const p = reinfPoints(f, table);
      expect(p.unitSum, id).toBeCloseTo(unit, 9);
      expect(p.strategic, id).toBeCloseTo(st, 9);
      expect(p.manpowerCost, id).toBeCloseTo(0.5 * 1.5, 9);
      expect(p.total, id).toBeCloseTo(unit + 0.75, 9);
      expect(p.units.map(u => u.key), id).toEqual(f.reinf.map(([k]) => k));
    }
  });

  it('援军级数的价格与兵员级数共用价目表里的同一个价', () => {
    const f = FACTIONS.china;
    const d = reinfPoints({ reinf: f.reinf, reinfLevel: 1 }).manpowerCost;
    expect(d).toBeCloseTo(PRICES.manpower, 12);
    expect(factionPoints({ ...f, manpower: 1 }).manpowerCost).toBeCloseTo(PRICES.manpower, 12);
  });

  it('补到预算要的援军级数：代回去援军点数等于预算；预算更高级数更高', () => {
    const f = { id: 'china' as const, reinf: FACTIONS.china.reinf };
    for (const budget of [3, 7.6, 12]) {
      const lv = reinfLevelForBudget(f, budget, PRICES);
      expect(reinfPoints({ reinf: f.reinf, reinfLevel: lv }).total, `预算 ${budget}`).toBeCloseTo(budget, 6);
    }
    expect(reinfLevelForBudget(f, 9)).toBeGreaterThan(reinfLevelForBudget(f, 6));
  });

  it('援军预算 = 各阵营援军点数（援军级数按 0）的中位数（四舍五入到 0.001）；规则变了用 npm run measure -- reinf --write 重算', () => {
    const stale = '援军预算或援军级数已过期：价目、兵种表或援军表变了，请运行 npm run measure -- reinf --write 重算并提交';
    expect(reinfBudgetOf(ids.map(id => FACTIONS[id])), stale).toBeCloseTo(REINF_BUDGET, 3);
    const v = ids.map(at0).sort((a, b) => a - b);
    expect(REINF_BUDGET, stale).toBeCloseTo((v[1] + v[2]) / 2, 3);
  });

  it('每个阵营的援军点数不超过援军预算', () => {
    for (const id of ids) expect(reinfPoints(FACTIONS[id]).total, id).toBeLessThanOrEqual(REINF_BUDGET + 1e-9);
  });

  it('现有四阵营用援军级数补到了预算（差额不到 0.02 点），级数就是补到预算的级数（向下取到 0.01）', () => {
    const stale = '援军级数已过期：请运行 npm run measure -- reinf --write 重算并提交';
    for (const id of ids) {
      expect(REINF_BUDGET - reinfPoints(FACTIONS[id]).total, `${id} ${stale}`).toBeLessThan(0.02);
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

  it('各兵种的点数（估算点数）在 −2…+5 内', () => {
    expect(UNIT_POINT_LIMITS).toEqual([-2, 5]);
    for (const d of contentUnits().filter(u => u.tier === 0)) {
      expect(d.points, d.key).toBeGreaterThanOrEqual(UNIT_POINT_LIMITS[0]);
      expect(d.points, d.key).toBeLessThanOrEqual(UNIT_POINT_LIMITS[1]);
    }
  });

  it('各阵营开局编制的比重之和为 1', () => {
    for (const id of FACTION_IDS) expect(FACTIONS[id].army.reduce((n, [, x]) => n + x, 0), id).toBeCloseTo(1, 6);
  });
});

const readJson = <T>(file: string): T => JSON.parse(readFileSync(file, 'utf8')) as T;
