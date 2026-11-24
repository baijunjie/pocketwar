/** 兵力占用：开局兵力与援军按兵力份数计，换算成人数 */
import { ARCHETYPES, FactionDef, UNIT_BY_KEY, UnitDef } from './types';

/** 一个兵种每人占几份兵力：由它所属原型决定 */
export const forceOf = (d: UnitDef): number => ARCHETYPES[d.arch].force;

/** 某个兵种分到若干份兵力时的人数，每个兵种至少 1 人（加一点点避开浮点误差压在四舍五入的边界上） */
export const headcount = (d: UnitDef, force: number): number => Math.max(1, Math.round(force / forceOf(d) + 1e-9));

/** 兵种表（兵种 key → 份数或比重）乘上倍率后的兵力换算成兵种下标列表，每个兵种至少 1 人 */
export function forceList(table: readonly (readonly [string, number])[], scale: number): number[] {
  const out: number[] = [];
  for (const [key, share] of table) {
    const d = UNIT_BY_KEY[key];
    for (let k = headcount(d, share * scale); k > 0; k--) out.push(d.idx);
  }
  return out;
}

/** 兵员每级人数的倍率 */
export const MANPOWER_STEP = 1.035;

/** 阵营的兵员倍率：开局兵力份数乘它，只由兵员级数给出 */
export const manpowerMult = (f: Pick<FactionDef, 'manpower'>): number => MANPOWER_STEP ** f.manpower;

/** 援军每级人数的倍率 */
export const REINF_STEP = 1.035;

/** 阵营的援军倍率：城池、城镇的全兵种援军份数乘它，只由援军级数给出 */
export const reinforceMult = (f: Pick<FactionDef, 'reinfLevel'>): number => REINF_STEP ** f.reinfLevel;
