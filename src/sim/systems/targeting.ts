/**
 * 索敌：在看得见的敌人里挑一个「打得到」的，而不是单纯最近的。
 * 评分 = 距离 × 克制偏好 + 各种惩罚：目标已被围满、刚被判定够不着、已经溃逃。
 */
import { BK_WALL, BR_MILITARY, RULES, SIZES, TILE, T_HILL, UnitDef } from '../content';
import { BLD_SKIP_ALL, GRID, NONE, S_ROUT, S_WALL } from '../state';
import { fightState, siteContains } from '../siteArea';
import type { Building, World } from '../world';

/** scan() 的结果 */
export const SCAN = {
  /** 索敌距离内评分最好的目标 */
  pick: NONE,
  /** 警戒距离内最近的敌人及其距离平方（用来判断是否进入战斗状态） */
  near: NONE,
  nearD2: 0,
};

/**
 * 近战的攻击方 d 要打 j 时 j 算不算围满：贴身的位置已被占满，而自己又得挤到它身边才打得到。
 * 长兵器已经够得着的目标不用挤过去，不算围满。dist 是两者的圆心距
 */
export function crowded(w: World, d: UnitDef, j: number, dist: number): boolean {
  if (w.crowd[j] < SIZES[w.defs[w.type[j]].size].slots) return false;
  return !(d.main.range > RULES.combat.meleeContact && dist - w.rad[j] - d.radius <= d.main.range);
}

/**
 * @param leash 大于 0 时，只挑离岗位（homeX, homeY）不超过这个距离的目标——待命的部队不会被引得越追越远
 * @param keep 给出时，只挑它认可的目标（不影响 near）
 */
export function scan(w: World, i: number, tm: number, ux: number, uy: number, scanR: number, acqR: number, d: UnitDef,
  cur: number, leash = 0, keep?: (j: number) => boolean): void {
  SCAN.pick = SCAN.near = NONE;
  SCAN.nearD2 = 0;
  if (!w.foeNear(ux, uy, tm, scanR)) return;
  const gw = w.gw, gh = w.gh, cs = w.cellStart, items = w.items;
  let gx0 = ((ux - scanR) / GRID) | 0, gx1 = ((ux + scanR) / GRID) | 0;
  let gy0 = ((uy - scanR) / GRID) | 0, gy1 = ((uy + scanR) / GRID) | 0;
  if (gx0 < 0) gx0 = 0;
  if (gy0 < 0) gy0 = 0;
  if (gx1 >= gw) gx1 = gw - 1;
  if (gy1 >= gh) gy1 = gh - 1;
  const C = RULES.combat;
  const x = w.x, y = w.y, team = w.team, alive = w.alive, seen = w.seen, type = w.type, defs = w.defs;
  const bit = 1 << tm, melee = d.melee;
  const acq2 = acqR * acqR, min2 = d.main.minRange * d.main.minRange;
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
      if (keep !== undefined && !keep(j)) continue;
      const jd = defs[type[j]];
      // 优先打自己克制的兵种
      const v = d.vs[jd.idx];
      const dj = Math.sqrt(d2);
      let score = dj * (v > 1.05 ? 0.8 : v < 0.95 ? 1.15 : 1);
      if (j === cur) score -= 25;
      else if (melee && crowded(w, d, j, dj)) score += C.crowdPenalty;
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

/** 风对射程的影响：沿 (dx, dy) 方向射击时的射程倍率 */
export function windRangeMul(w: World, dx: number, dy: number): number {
  const wind = w.env.wind;
  if (wind <= 0) return 1;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d < 1e-6) return 1;
  return 1 + RULES.env.windRange * wind * (dx * Math.cos(w.env.windDir) + dy * Math.sin(w.env.windDir)) / d;
}

/**
 * 远程单位去打站在墙顶垛口上的敌兵（近战够不着墙顶，只有远程要去）时挑目标：看得见、没溃逃，
 * 在 RULES.combat.wallSeek 以内、离岗位也不超过它（leash 大于 0 时），挑最近的。
 * 自己走到刚好进射程的那一点不该去的（见 wallSpotBad）不挑。
 * @param inFight 为 true 时只挑所在据点正在交战（fightState）、或自己正在打 tm 的人的：待命的单位不为没动静的城头守军走上去
 * 调用方负责限频；手里没有敌兵目标时才调（可以盯着建筑）。
 */
export function findWallFoe(w: World, i: number, tm: number, ux: number, uy: number, d: UnitDef, leash = 0, inFight = false): number {
  const seek = RULES.combat.wallSeek;
  if (!w.foeNear(ux, uy, tm, seek)) return NONE;
  const gw = w.gw, gh = w.gh, cs = w.cellStart, items = w.items;
  let gx0 = ((ux - seek) / GRID) | 0, gx1 = ((ux + seek) / GRID) | 0;
  let gy0 = ((uy - seek) / GRID) | 0, gy1 = ((uy + seek) / GRID) | 0;
  if (gx0 < 0) gx0 = 0;
  if (gy0 < 0) gy0 = 0;
  if (gx1 >= gw) gx1 = gw - 1;
  if (gy1 >= gh) gy1 = gh - 1;
  const x = w.x, y = w.y, team = w.team, alive = w.alive, seen = w.seen, state = w.state;
  const bit = 1 << tm, min2 = d.main.minRange * d.main.minRange;
  const hx = w.homeX[i], hy = w.homeY[i], leash2 = leash * leash;
  let best = seek * seek, pick = NONE;
  for (let gy = gy0; gy <= gy1; gy++) {
    const row = gy * gw;
    const k0 = cs[row + gx0], k1 = cs[row + gx1 + 1];
    for (let k = k0; k < k1; k++) {
      const j = items[k];
      if (team[j] === tm || !alive[j] || !(seen[j] & bit) || (state[j] & (S_WALL | S_ROUT)) !== S_WALL) continue;
      const ox = x[j] - ux, oy = y[j] - uy;
      const d2 = ox * ox + oy * oy;
      if (d2 >= best || d2 < min2) continue;
      if (leash2 > 0 && (x[j] - hx) * (x[j] - hx) + (y[j] - hy) * (y[j] - hy) > leash2) continue;
      if (wallSpotBad(w, tm, j, ux, uy, d)) continue;
      if (inFight && !foeSiteFighting(w, j) && !foeTargets(w, j, tm)) continue;
      best = d2;
      pick = j;
    }
  }
  return pick;
}

/** 单位 j 此刻在打 tm 一方的人（它手里的攻击目标是 tm 的单位） */
export function foeTargets(w: World, j: number, tm: number): boolean {
  const t = w.target[j];
  return t >= 0 && w.team[t] === tm;
}

/** 单位 j 所在的据点正在交战（fightState）；不在任何据点范围内的算没有 */
export function foeSiteFighting(w: World, j: number): boolean {
  for (const s of w.sites) if (!s.gone && siteContains(s, w.x[j], w.y[j])) return fightState(w, s).fighting;
  return false;
}

/**
 * 从 (ux, uy) 朝墙顶敌兵 j 走到刚好进射程的那一点，是不是不该去：直线走不到（被城墙、建筑挡着，
 * 那一点多半在墙里头，追过去只会顶在墙根），或者落在敌方（含中立）箭塔的射程里（白挨塔的箭）。
 * 停下的位置按实际出手的射程算（高地、风与 units.ts 的 reach 同式），箭塔的射程按塔到那一点的方向算风（与 updateTowers 同式）。
 * 已经进了射程的不用走，算可以去。
 */
export function wallSpotBad(w: World, tm: number, j: number, ux: number, uy: number, d: UnitDef): boolean {
  const tx = w.x[j], ty = w.y[j];
  const dx = tx - ux, dy = ty - uy;
  const dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
  const wind = windRangeMul(w, dx, dy);
  const mw = w.map.w;
  let hill = 1;
  let stop = 0, px = ux, py = uy;
  // 停下的那一点是不是高地要看那一点，而那一点又取决于射程：先按平地估一次，再按估出的那格修正
  for (let pass = 0; pass < 2; pass++) {
    stop = d.main.range * hill * wind + w.rad[j] + d.radius;
    if (dist <= stop) return false;
    const k = stop / dist;
    px = tx - dx * k;
    py = ty - dy * k;
    hill = w.map.terrain[((py / TILE) | 0) * mw + ((px / TILE) | 0)] === T_HILL ? 1.12 : 1;
  }
  if (w.lineBlocked(ux, uy, px, py, tm)) return true;
  for (const b of w.armed) {
    if (!b.alive || b.owner === tm || !b.tower) continue;
    const r = b.tower.range * windRangeMul(w, px - b.cx, py - b.cy);
    if ((b.cx - px) * (b.cx - px) + (b.cy - py) * (b.cy - py) < r * r) return true;
  }
  return false;
}

/**
 * tm 一方能不能攻击这座建筑：立着、不是自己的、可被攻击（普通建筑不行）、打得动（城防工事只有工程类能破坏）。
 * 玩家的攻击指令、单位自动索敌、挡路时就地攻城、电脑选目标、投射物与范围伤害都按它判断。
 */
export function canAttackBuilding(b: Building, tm: number, siege: boolean): boolean {
  return b.alive && b.owner !== tm && b.def.hittable && (!b.def.fort || siege);
}

/**
 * i 是不是正跳过建筑 bid：刚因为挤不到跟前而放下它（World.bldSkip），倒计时还没走完；
 * 接连放下两座之后记的是 BLD_SKIP_ALL，这段时间里哪座都算跳过。自动挑建筑与被建筑射中的还击都按它判断
 */
export function bldSkipped(w: World, i: number, bid: number): boolean {
  return w.bldSkipT[i] > 0 && (w.bldSkip[i] === BLD_SKIP_ALL || w.bldSkip[i] === bid);
}

/**
 * 附近最该打的敌方建筑（自动攻击用）：先挑会放箭的，再挑近的。
 * 敌方的建筑，以及中立的军事建筑（会放箭，又必须拆光才能占领）。
 * 不挑的：城墙与木栅（只在挡路时才打，否则会沿着墙一格一格拆下去）、中立的城防、自己打不动的城防工事、普通建筑（不可被攻击），
 * 以及 i 刚因为挤不到跟前而放下的那一座（World.bldSkip；记的是 BLD_SKIP_ALL 时这段时间里一座都不挑）。
 * @param leash 大于 0 时只挑离岗位不超过这个距离的
 */
export function findBuilding(w: World, i: number, ux: number, uy: number, tm: number, range: number, d: UnitDef, leash = 0): number {
  const mw = w.map.w, mh = w.map.h, bld = w.nav.bld, bs = w.buildings;
  let x0 = ((ux - range) / TILE) | 0, x1 = ((ux + range) / TILE) | 0;
  let y0 = ((uy - range) / TILE) | 0, y1 = ((uy + range) / TILE) | 0;
  if (x0 < 0) x0 = 0;
  if (y0 < 0) y0 = 0;
  if (x1 >= mw) x1 = mw - 1;
  if (y1 >= mh) y1 = mh - 1;
  const foe = 3 - tm, min2 = d.main.minRange * d.main.minRange, leash2 = leash * leash;
  const hx = w.homeX[i], hy = w.homeY[i];
  const armed = RULES.combat.armedFirst;
  // 这段时间里什么建筑都不挑的，不必扫
  if (bldSkipped(w, i, BLD_SKIP_ALL)) return -1;
  let best = range * range, id = -1, last = -1;
  for (let y = y0; y <= y1; y++) {
    const row = y * mw;
    for (let x = x0; x <= x1; x++) {
      const k = bld[row + x];
      if (k < 0 || k === last || bldSkipped(w, i, k)) continue;
      last = k;
      const b = bs[k];
      if ((b.owner !== foe && !(b.owner === 0 && b.def.role === BR_MILITARY)) || b.def.kind === BK_WALL || !canAttackBuilding(b, tm, d.siege)) continue;
      const px = ux < b.x0 ? b.x0 : ux > b.x1 ? b.x1 : ux, py = uy < b.y0 ? b.y0 : uy > b.y1 ? b.y1 : uy;
      const d2 = (px - ux) * (px - ux) + (py - uy) * (py - uy);
      if (d2 < min2 || d2 > range * range) continue;
      if (leash2 > 0 && (px - hx) * (px - hx) + (py - hy) * (py - hy) > leash2) continue;
      const score = b.tower ? d2 * armed : d2;
      if (score < best) {
        best = score;
        id = k;
      }
    }
  }
  return id;
}
