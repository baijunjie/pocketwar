/**
 * 编队行军的窄处测量：在行迹上的一点找两侧都被大块障碍挡满一翼的最短横截面，给出两侧可用的宽度与这一处窄处的方向。
 * 只有一侧有障碍、或障碍挡不满一翼（两翼从外面绕得过去）的地方不算窄处。
 */
import { RULES, TILE } from '../content';
import type { World } from '../world';
import type { March } from './march';

/** 量窄处用的四个方向（东西、两条斜线、南北），每两个数一个方向 */
const AXES = [1, 0, Math.SQRT1_2, Math.SQRT1_2, 0, 1, -Math.SQRT1_2, Math.SQRT1_2];
/** 与行进方向夹角的余弦超过这个值的方向不拿来量窄处：差不多顺着路，量出来的不是横截面 */
const AXIS_PAR = 0.8;
/** 看障碍是否沿横截面连续挡着：每半格采一点，第一点离顶到障碍处四分之一格（每格采到两次，不会漏掉一格宽的缺口） */
const RUN_FIRST = TILE / 4, RUN_STEP = TILE / 2;

/** chokeAt() 的结果：两侧可用宽度（右手边为 R）、窄处方向（指向行进方向的右手边）、量没量到窄处（1 量到，0 没有） */
export const CHOKE = { L: 0, R: 0, ax: 0, ay: 0, has: 0 };

/** 把 CHOKE 置成没有窄处：两侧都是没量到窄处时的宽度 */
export function chokeClear(g: March): void {
  CHOKE.L = CHOKE.R = g.open;
  CHOKE.ax = CHOKE.ay = CHOKE.has = 0;
}

/** 格子 (cx, cy) 本队的人站不了：走不通、墙顶，或在地图外 */
function solidCell(w: World, tm: number, cx: number, cy: number): boolean {
  if (cx < 0 || cy < 0 || cx >= w.map.w || cy >= w.map.h) return true;
  const c = cy * w.map.w + cx;
  return w.nav.block[tm][c] !== 0 || w.nav.deck[tm][c] !== 0;
}

/** 从 (x, y) 沿单位向量 (dx, dy) 走到第一个站不了人的格子有多远；max 以内没有返回 -1 */
function rayHit(w: World, tm: number, x: number, y: number, dx: number, dy: number, max: number): number {
  let cx = Math.floor(x / TILE), cy = Math.floor(y / TILE);
  if (solidCell(w, tm, cx, cy)) return 0;
  const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1;
  let tx = dx !== 0 ? ((dx > 0 ? (cx + 1) * TILE : cx * TILE) - x) / dx : Infinity;
  let ty = dy !== 0 ? ((dy > 0 ? (cy + 1) * TILE : cy * TILE) - y) / dy : Infinity;
  const ddx = dx !== 0 ? TILE / Math.abs(dx) : Infinity, ddy = dy !== 0 ? TILE / Math.abs(dy) : Infinity;
  for (;;) {
    let d: number;
    if (Math.abs(tx - ty) < 1e-6) {
      // 正好穿过格角：两边的格子有一个站不了人就算挡住
      d = tx;
      if (d > max) return -1;
      if (solidCell(w, tm, cx + sx, cy) || solidCell(w, tm, cx, cy + sy)) return d;
      cx += sx;
      cy += sy;
      tx += ddx;
      ty += ddy;
    } else if (tx < ty) {
      d = tx;
      cx += sx;
      tx += ddx;
    } else {
      d = ty;
      cy += sy;
      ty += ddy;
    }
    if (d > max) return -1;
    if (solidCell(w, tm, cx, cy)) return d;
  }
}

/**
 * 从行迹点 (x, y) 沿 (dx, dy) 顶到障碍的距离；障碍挡不满这一翼（从顶到的地方往外没连续挡到翼尖，即半个队宽处，
 * 至少 chokeMin；那一翼从外面绕得过去）就当没有，返回 -1
 */
function wallAt(w: World, g: March, x: number, y: number, dx: number, dy: number): number {
  const d = rayHit(w, g.team, x, y, dx, dy, g.width);
  if (d < 0) return -1;
  const run = Math.max(RULES.march.chokeMin, g.width / 2 - d);
  for (let k = RUN_FIRST; k <= run; k += RUN_STEP) {
    const px = x + dx * (d + k), py = y + dy * (d + k);
    if (!solidCell(w, g.team, Math.floor(px / TILE), Math.floor(py / TILE))) return -1;
  }
  return d;
}

/**
 * 在行迹点 (x, y) 量窄处（行进方向 (tx, ty)），结果放在 CHOKE：在四个固定方向里找一条与行进方向不平行、往两头都顶到大块障碍的线，
 * 取最短的一条当这一处的横截面——横截面跟着门洞走（与墙平行），不跟队列的朝向斜。量不到就是没有窄处（同 chokeClear）。
 * 两侧宽度扣掉与障碍留的余量 chokePad；量到的两侧宽度之和总小于队宽的 narrow 倍
 */
export function chokeAt(w: World, g: March, x: number, y: number, tx: number, ty: number): void {
  const M = RULES.march;
  chokeClear(g);
  let best = g.width * M.narrow;
  for (let a = 0; a < AXES.length; a += 2) {
    const ux = AXES[a], uy = AXES[a + 1];
    const dot = ux * tx + uy * ty;
    if (dot > AXIS_PAR || dot < -AXIS_PAR) continue;
    // 朝行进方向右手边的那一头记作正
    const sg = -ux * ty + uy * tx >= 0 ? 1 : -1, dx = ux * sg, dy = uy * sg;
    const dr = wallAt(w, g, x, y, dx, dy);
    if (dr < 0) continue;
    const dl = wallAt(w, g, x, y, -dx, -dy);
    if (dl < 0 || dl + dr >= best) continue;
    best = dl + dr;
    CHOKE.R = Math.max(0, dr - M.chokePad);
    CHOKE.L = Math.max(0, dl - M.chokePad);
    CHOKE.ax = dx;
    CHOKE.ay = dy;
    CHOKE.has = 1;
  }
}
