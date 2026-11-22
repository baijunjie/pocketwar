/**
 * 索敌：在看得见的敌人里挑一个「打得到」的，而不是单纯最近的。
 * 评分 = 距离 × 克制偏好 + 各种惩罚：目标已被围满、刚被判定够不着、已经溃逃。
 */
import { RULES, SIZES, UnitDef } from '../content';
import { COARSE, GRID, NONE, S_ROUT } from '../state';
import type { World } from '../world';

/** scan() 的结果 */
export const SCAN = {
  /** 索敌距离内评分最好的目标 */
  pick: NONE,
  /** 警戒距离内最近的敌人及其距离平方（用来判断是否进入战斗状态） */
  near: NONE,
  nearD2: 0,
};

/**
 * @param leash 大于 0 时，只挑离岗位（homeX, homeY）不超过这个距离的目标——待命的部队不会被引得越追越远
 */
export function scan(w: World, i: number, tm: number, ux: number, uy: number, scanR: number, acqR: number, d: UnitDef,
  cur: number, leash = 0): void {
  SCAN.pick = SCAN.near = NONE;
  SCAN.nearD2 = 0;
  const cw = w.cw, ch = w.ch;
  const pe = w.pres[3 - tm];
  let cx0 = ((ux - scanR) / COARSE) | 0, cx1 = ((ux + scanR) / COARSE) | 0;
  let cy0 = ((uy - scanR) / COARSE) | 0, cy1 = ((uy + scanR) / COARSE) | 0;
  if (cx0 < 0) cx0 = 0;
  if (cy0 < 0) cy0 = 0;
  if (cx1 >= cw) cx1 = cw - 1;
  if (cy1 >= ch) cy1 = ch - 1;
  let any = false;
  for (let cy = cy0; cy <= cy1 && !any; cy++) for (let cx = cx0; cx <= cx1; cx++) if (pe[cy * cw + cx]) {
    any = true;
    break;
  }
  if (!any) return;
  const gw = w.gw, gh = w.gh, cs = w.cellStart, items = w.items;
  let gx0 = ((ux - scanR) / GRID) | 0, gx1 = ((ux + scanR) / GRID) | 0;
  let gy0 = ((uy - scanR) / GRID) | 0, gy1 = ((uy + scanR) / GRID) | 0;
  if (gx0 < 0) gx0 = 0;
  if (gy0 < 0) gy0 = 0;
  if (gx1 >= gw) gx1 = gw - 1;
  if (gy1 >= gh) gy1 = gh - 1;
  const C = RULES.combat;
  const x = w.x, y = w.y, team = w.team, alive = w.alive, seen = w.seen, type = w.type, defs = w.defs;
  const bit = 1 << tm, melee = d.range === 0;
  const acq2 = acqR * acqR, min2 = d.minRange * d.minRange;
  const avoid = w.avoidT[i] > 0 ? w.avoidUid[i] : 0;
  const hx = w.homeX[i], hy = w.homeY[i], leash2 = leash * leash;
  let nearD2 = scanR * scanR, near = NONE, best = 1e9, pick = NONE;
  for (let gy = gy0; gy <= gy1; gy++) {
    const row = gy * gw;
    const k0 = cs[row + gx0], k1 = cs[row + gx1 + 1];
    for (let k = k0; k < k1; k++) {
      const j = items[k];
      if (team[j] === tm || !alive[j] || !(seen[j] & bit)) continue;
      const ox = x[j] - ux, oy = y[j] - uy;
      const d2 = ox * ox + oy * oy;
      if (d2 < nearD2) {
        nearD2 = d2;
        near = j;
      }
      if (d2 > acq2 || d2 < min2) continue;
      if (leash2 > 0 && j !== cur && (x[j] - hx) * (x[j] - hx) + (y[j] - hy) * (y[j] - hy) > leash2) continue;
      const jd = defs[type[j]];
      // 优先打自己克制的类别
      const v = d.vs[jd.cls];
      let score = Math.sqrt(d2) * (v > 1.05 ? 0.8 : v < 0.95 ? 1.15 : 1);
      if (j === cur) score -= 25;
      else if (melee && w.crowd[j] >= SIZES[jd.size].slots) score += C.crowdPenalty;
      if (avoid && w.uid[j] === avoid) score += 200;
      if (w.state[j] & S_ROUT) score += C.routPenalty;
      if (score < best) {
        best = score;
        pick = j;
      }
    }
  }
  SCAN.pick = pick;
  SCAN.near = near;
  SCAN.nearD2 = nearD2;
}

/** 最近的、可攻击的敌方有武装建筑 */
export function findArmedBuilding(w: World, ux: number, uy: number, tm: number, range: number, siege: boolean): number {
  let best = range * range, id = -1;
  for (const b of w.armed) {
    if (!b.alive || b.owner === tm || b.owner === 0 || (b.def.fort && !siege)) continue;
    const ox = b.cx - ux, oy = b.cy - uy;
    const d2 = ox * ox + oy * oy;
    if (d2 < best) {
      best = d2;
      id = b.id;
    }
  }
  return id;
}
