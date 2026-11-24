/**
 * 阵营点数：阵营点数 = Σ 兵种点数 × 份数之比 + 兵员成本。
 * 像给人物加属性点一样按价目表计账，纯计算、配完即得：兵种点数是估算点数（各维度级数 × 价目 + 特性价目），
 * 其中战略维度（机动、射程、纪律）只计高于基准的级数（见 points.ts 的 STRATEGIC_DIMS），在这里单列出来只为看构成。
 * 兵种整体的实测点数（tools/measure/data/unit-points.json）只用来发现估算的偏差，不进账。
 * 预算与规则见 src/sim/content/points.ts 的 FACTION_BUDGET。
 */
import { ARCHETYPES, FactionDef, FactionId, PRICES, PriceTable, STRATEGIC_DIMS, UNIT_BY_KEY, estimatePoints, manpowerMult, reinforceMult } from '../../src/sim/defs';
import { REF_SHARE, refForcePerHead, slotOf } from './units';

/**
 * 预算的取值规则用的兵员级数：现有四阵营迁移前的阵营特色倍率（中国 1.06、日本 0.93、罗马 0.935、波斯 0.96）换算的级数。
 * 预算 = 四阵营在这组兵员级数下阵营点数的中位数
 */
export const BUDGET_BASE_MANPOWER: Record<FactionId, number> = { china: 1.69, japan: -2.11, rome: -1.95, persia: -1.19 };

export interface UnitShare {
  key: string;
  position: string;
  /** 占全军兵力的比重 */
  share: number;
  /** 该兵种的兵力份数 ÷ 标准混编军里对应位置的兵力份数（同样的基准份数下） */
  ratio: number;
  /** 兵种点数（估算点数）与它的贡献（× ratio） */
  points: number;
  contrib: number;
  /** 其中战略维度的成本（已乘 ratio，已含在 contrib 里） */
  strategic: number;
}

export interface FactionPoints {
  units: UnitShare[];
  /** Σ 兵种贡献（含战略维度成本） */
  unitSum: number;
  /** 其中战略维度的成本合计（已含在 unitSum 里） */
  strategic: number;
  /** 兵员价目 × 兵员级数 */
  manpowerCost: number;
  total: number;
}

/**
 * 某兵种在阵营标准军里的兵力份数，相对标准混编军里它对应位置的兵力份数。
 * 阵营一方 = S × 兵员倍率 × 比重；标准混编军的位置 = S × 位置人数比例 × 占用 ÷ 每人平均占用。S 约掉。
 */
export function shareRatio(f: Pick<FactionDef, 'manpower'>, unitKey: string, share: number): number {
  return slotRatio(manpowerMult(f), unitKey, share);
}

/**
 * 份数之比：倍率 × 比重 ÷ 标准混编军里该兵种对应位置的兵力比重（阵营开局与援军共用），即两边人数之比。
 * 顶替别的位置的位置（直射器械）按被顶替位置的人数比例算：它的点数是在「那个位置整个换成它」上量的
 */
function slotRatio(mult: number, unitKey: string, share: number): number {
  const d = UNIT_BY_KEY[unitKey];
  const slotForce = (REF_SHARE[slotOf(d.position)] * ARCHETYPES[d.arch].force) / refForcePerHead();
  return (mult * share) / slotForce;
}

/** 一个兵种点数里战略维度的部分（未乘份数之比）：Σ 加级价目 × 高于基准的级数；低于基准不计 */
export function unitStrategicCost(unitKey: string, table: PriceTable = PRICES): number {
  const d = UNIT_BY_KEY[unitKey];
  let c = 0;
  for (const k of STRATEGIC_DIMS) {
    const lv = d.lv[k] ?? 0;
    if (lv > 0) c += (table.dims[d.position]?.[k]?.[0] ?? 0) * lv;
  }
  return c;
}

/** 兵种点数：按价目表计的估算点数（各维度级数 × 价目 + 兵种自己的特性价目） */
export function unitPoints(unitKey: string, table: PriceTable = PRICES): number {
  const d = UNIT_BY_KEY[unitKey];
  return estimatePoints(d.position, d.lv, d.ownTraits, table);
}

/** 按「编制比重 + 倍率 + 级数」记账：兵种点数 × 份数之比 + 价目 × 级数（阵营开局与援军共用，兵员级数与援军级数共用一个价） */
function account(army: readonly (readonly [string, number])[], mult: number, level: number, table: PriceTable): FactionPoints {
  const units = army.map(([key, share]): UnitShare => {
    const p = unitPoints(key, table);
    const ratio = slotRatio(mult, key, share);
    return { key, position: UNIT_BY_KEY[key].position, share, ratio, points: p, contrib: p * ratio, strategic: unitStrategicCost(key, table) * ratio };
  });
  const unitSum = units.reduce((s, u) => s + u.contrib, 0);
  const strategic = units.reduce((s, u) => s + u.strategic, 0);
  const manpowerCost = table.manpower * level;
  return { units, unitSum, strategic, manpowerCost, total: unitSum + manpowerCost };
}

/** 阵营点数与它的构成 */
export function factionPoints(f: FactionDef, table: PriceTable = PRICES): FactionPoints {
  return account(f.army, manpowerMult(f), f.manpower, table);
}

/** 全兵种援军表的比重（每个兵种的份数 ÷ 全表每批总份数） */
export function reinfShares(f: Pick<FactionDef, 'reinf'>): [string, number][] {
  const total = f.reinf.reduce((n, [, x]) => n + x, 0);
  return f.reinf.map(([k, x]) => [k, x / total]);
}

/**
 * 援军点数：算法与阵营点数一致，只是编制换成全兵种援军表（比重 = 份数 ÷ 全表总份数）、倍率与级数换成援军倍率与援军级数；
 * 援军级数的价格与兵员级数共用（价目表的 manpower）。UnitShare.share 是比重，不是份数
 */
export function reinfPoints(f: Pick<FactionDef, 'reinf' | 'reinfLevel'>, table: PriceTable = PRICES): FactionPoints {
  return account(reinfShares(f), reinforceMult(f), f.reinfLevel, table);
}

/**
 * 让阵营点数正好等于 budget 的兵员级数（二分；阵营点数随兵员级数单调增）。
 * 兵员级数同时改兵员成本与份数之比（兵员倍率在份数之比里）
 */
export function manpowerForBudget(f: FactionDef, budget: number, table: PriceTable = PRICES): number {
  return solveLevel(lv => factionPoints({ ...f, manpower: lv }, table).total, budget, `${f.id}：兵员级数`);
}

/** 让援军点数正好等于 reinfBudget 的援军级数（同样二分，点数随援军级数单调增） */
export function reinfLevelForBudget(f: Pick<FactionDef, 'id' | 'reinf'>, budget: number, table: PriceTable = PRICES): number {
  return solveLevel(lv => reinfPoints({ reinf: f.reinf, reinfLevel: lv }, table).total, budget, `${f.id}：援军级数`);
}

/** 阵营预算的取值规则：四阵营在迁移前兵员级数（BUDGET_BASE_MANPOWER）下阵营点数的中位数 */
export function factionBudgetOf(fs: readonly FactionDef[], table: PriceTable = PRICES): number {
  return median(fs.map(f => factionPoints({ ...f, manpower: BUDGET_BASE_MANPOWER[f.id] }, table).total));
}

const median = (xs: number[]): number => {
  const v = [...xs].sort((a, b) => a - b), m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

/** 现有阵营（援军级数按 0，即援军倍率 1）的援军点数中位数：援军预算的取值规则 */
export function reinfBudgetOf(fs: readonly Pick<FactionDef, 'reinf'>[], table: PriceTable = PRICES): number {
  return median(fs.map(f => reinfPoints({ reinf: f.reinf, reinfLevel: 0 }, table).total));
}

/** 向下取到 0.01 级，补到预算不超预算 */
export const floorLevel = (lv: number): number => Math.floor(lv * 100) / 100;

function solveLevel(at: (lv: number) => number, budget: number, what: string): number {
  let lo = -60, hi = 60;
  if (at(lo) > budget || at(hi) < budget) throw new Error(`${what}在 ±60 内补不到预算 ${budget}`);
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (at(mid) < budget) lo = mid;
    else hi = mid;
  }
  return lo;
}
