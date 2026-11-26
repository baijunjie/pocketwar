/**
 * 阵营点数：阵营点数 = Σ 兵力比重 × 兵种点数 + 兵员级数 × 兵员单价。
 * 纯计算、配完即得：兵种点数是 UnitDef.points（各维度级数 × 维度单价 + 兵种自己的特性点数），
 * 兵员单价与预算见 points.ts（MANPOWER_PRICE、FACTION_BUDGET、REINF_BUDGET），各阵营的差额由兵员级数、援军级数补。
 */
import { MANPOWER_PRICE } from './points';
import { FactionDef, UNIT_BY_KEY } from './types';

export interface UnitShare {
  key: string;
  /** 占全军兵力的比重 */
  share: number;
  /** 兵种点数与它的贡献（× 比重） */
  points: number;
  contrib: number;
}

export interface FactionPoints {
  units: UnitShare[];
  /** Σ 兵种贡献 */
  unitSum: number;
  /** 兵员单价 × 兵员级数 */
  manpowerCost: number;
  total: number;
}

/** 兵种点数 */
export const unitPoints = (unitKey: string): number => UNIT_BY_KEY[unitKey].points;

/** 按「编制比重 + 级数」记账（阵营开局与援军共用，兵员级数与援军级数共用一个单价） */
function account(army: readonly (readonly [string, number])[], level: number): FactionPoints {
  const units = army.map(([key, share]): UnitShare => {
    const p = unitPoints(key);
    return { key, share, points: p, contrib: p * share };
  });
  const unitSum = units.reduce((s, u) => s + u.contrib, 0);
  const manpowerCost = MANPOWER_PRICE * level;
  return { units, unitSum, manpowerCost, total: unitSum + manpowerCost };
}

/** 阵营点数与它的构成 */
export function factionPoints(f: Pick<FactionDef, 'army' | 'manpower'>): FactionPoints {
  return account(f.army, f.manpower);
}

/** 全兵种援军表的比重（每个兵种的份数 ÷ 全表每批总份数） */
export function reinfShares(f: Pick<FactionDef, 'reinf'>): [string, number][] {
  const total = f.reinf.reduce((n, [, x]) => n + x, 0);
  return f.reinf.map(([k, x]) => [k, x / total]);
}

/** 援军点数：算法与阵营点数一致，只是编制换成全兵种援军表（比重 = 份数 ÷ 全表总份数）、级数换成援军级数。UnitShare.share 是比重，不是份数 */
export function reinfPoints(f: Pick<FactionDef, 'reinf' | 'reinfLevel'>): FactionPoints {
  return account(reinfShares(f), f.reinfLevel);
}

/** 向下取到 0.01 级，补到预算不超预算（加一点容差，恰好落在 0.01 格点上的值不会因浮点误差多降一格） */
export const floorLevel = (lv: number): number => Math.floor(lv * 100 + 1e-9) / 100;

/** 让阵营点数正好等于 budget 的兵员级数（闭式：阵营点数随兵员级数线性增） */
export function manpowerForBudget(f: Pick<FactionDef, 'army'>, budget: number): number {
  return (budget - factionPoints({ army: f.army, manpower: 0 }).total) / MANPOWER_PRICE;
}

/** 让援军点数正好等于 budget 的援军级数 */
export function reinfLevelForBudget(f: Pick<FactionDef, 'reinf'>, budget: number): number {
  return (budget - reinfPoints({ reinf: f.reinf, reinfLevel: 0 }).total) / MANPOWER_PRICE;
}
