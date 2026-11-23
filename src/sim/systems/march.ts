/**
 * 编队行军：一道移动命令里的部队共用一个看不见的「领队」。领队按全队最慢者的速度沿路线前进，
 * 每个单位跟着自己在队列里的位置走（位置随领队的朝向转动），落后了就跑步追上；队伍散了领队会停下来等。
 * 过桥、进城门这类队列摆不开的地方，够不着自己位置的单位改走寻路路线，过去之后再归队。
 */
import { DT, RULES, TERRAIN_SPEED, TILE } from '../content';
import { DIRX, DIRY, DIR_HERE, Field } from '../nav';
import { NONE, S_COMBAT, S_ROUT } from '../state';
import type { World } from '../world';

export interface March {
  id: number;
  alive: boolean;
  team: number;
  /** 领队位置与朝向（单位向量） */
  x: number;
  y: number;
  hx: number;
  hy: number;
  destX: number;
  destY: number;
  destCell: number;
  field: Field | null;
  /** 全队最慢者的行军速度、奔跑速度 */
  speed: number;
  run: number;
  /** 攻击移动：有人接敌后领队停下，打完再走 */
  amove: boolean;
  /** 正在交手、处于战斗状态的成员比例 */
  fight: number;
  alert: number;
  cFight: number;
  cAlert: number;
  /** 领队当前的实际速度（等人时为 0） */
  v: number;
  /** 到位后的朝向 */
  fx: number;
  fy: number;
  arrived: boolean;
  /** 领队被敌方 / 中立建筑挡住去路：成员各自上前攻打，打通后再整队前进 */
  blocked: boolean;
  /** 成员数与平均掉队距离（每 8 帧统计一次） */
  n: number;
  lag: number;
  cnt: number;
  lagSum: number;
}

export function createMarch(w: World, team: number, x: number, y: number, destX: number, destY: number, destCell: number,
  speed: number, run: number, amove: boolean, fx: number, fy: number, n: number): March {
  let g = w.marches.find(m => !m.alive);
  if (!g) {
    g = { id: w.marches.length } as March;
    w.marches.push(g);
  }
  // 领队不能出生在水里或墙里
  const c0 = w.cellAt(x, y);
  if (w.nav.block[team][c0]) {
    const c = w.nav.nearestFree(team, c0, 20);
    x = (c % w.map.w + 0.5) * TILE;
    y = (((c / w.map.w) | 0) + 0.5) * TILE;
  }
  const dx = destX - x, dy = destY - y, dl = Math.hypot(dx, dy) || 1;
  Object.assign(g, {
    alive: true, team, x, y, hx: dx / dl, hy: dy / dl, destX, destY, destCell,
    field: w.lineBlocked(x, y, destX, destY, team) ? w.nav.getField(team, destCell, w.tickCount) : null,
    speed, run, amove, fight: 0, alert: 0, cFight: 0, cAlert: 0, v: 0, fx, fy, arrived: false, blocked: false, n, lag: RULES.march.lagStop,
    cnt: 0, lagSum: 0,
  });
  return g;
}

export function updateMarches(w: World): void {
  const ms = w.marches;
  if (!ms.length) return;
  const M = RULES.march;
  const tick = w.tickCount;
  if ((tick & 7) === 0) {
    // 统计各队人数与掉队情况
    for (const g of ms) g.cnt = g.lagSum = g.cFight = g.cAlert = 0;
    const grp = w.grp;
    for (let i = 0; i < w.n; i++) {
      const gi = grp[i];
      if (gi < 0 || !w.alive[i]) continue;
      const g = ms[gi];
      if (!g.alive || g.arrived || w.state[i] & S_ROUT) {
        grp[i] = -1;
        continue;
      }
      const px = g.x + g.hx * w.offA[i] - g.hy * w.offL[i], py = g.y + g.hy * w.offA[i] + g.hx * w.offL[i];
      const lag = Math.hypot(px - w.x[i], py - w.y[i]);
      g.cnt++;
      if (w.target[i] !== NONE) g.cFight++;
      if (w.state[i] & S_COMBAT) g.cAlert++;
      g.lagSum += lag > 400 ? 400 : lag;
    }
    for (const g of ms) {
      if (!g.alive) continue;
      g.n = g.cnt;
      if (!g.cnt) g.alive = false;
      else {
        g.lag = g.lagSum / g.cnt;
        g.fight = g.cFight / g.cnt;
        g.alert = g.cAlert / g.cnt;
      }
    }
  }
  const mw = w.map.w, terr = w.map.terrain;
  const rain = w.env.raining ? RULES.env.rainSpeed : 1;
  const turn = M.turn * DT;
  for (const g of ms) {
    if (!g.alive || g.arrived) continue;
    const k = (M.lagStop - g.lag) / (M.lagStop - M.lagFull);
    const mult = g.amove && g.fight > M.holdFight ? 0 : k < 0 ? 0 : k > 1 ? 1 : k;
    const cell = ((g.y / TILE) | 0) * mw + ((g.x / TILE) | 0);
    // 大半人进入战斗状态后改为跑步前进
    const sp = (g.alert > 0.5 ? g.run : g.speed) * TERRAIN_SPEED[terr[cell]] * rain * mult;
    g.v = sp;
    if (sp <= 0) continue;
    const ddx = g.destX - g.x, ddy = g.destY - g.y;
    const dd = Math.sqrt(ddx * ddx + ddy * ddy);
    const step = sp * DT;
    if (dd <= step + 1) {
      g.x = g.destX;
      g.y = g.destY;
      g.arrived = true;
      g.v = 0;
      continue;
    }
    let mx = ddx / dd, my = ddy / dd;
    let f = g.field;
    if (f) {
      if (f.dead) f = g.field = w.nav.getField(g.team, g.destCell, tick);
      f.lastUse = tick;
      const dir = f.dirs[cell];
      if (dir < 8) {
        const kk = dir & 1 ? 0.7071 : 1;
        mx = DIRX[dir] * kk;
        my = DIRY[dir] * kk;
      } else if (dir !== DIR_HERE && f.pending) {
        // 路线还没算出来：等一等
        g.v = 0;
        continue;
      }
    }
    let nx = g.x + mx * step, ny = g.y + my * step;
    const nc = ((ny / TILE) | 0) * mw + ((nx / TILE) | 0);
    g.blocked = false;
    if (nc !== cell && (w.nav.block[g.team][nc] || !w.nav.canStep(g.team, cell, nc))) {
      // 直线走不通：改用寻路；寻路路线上是别人的建筑（城门、木栅）就停下，让成员去打
      if (!g.field) g.field = w.nav.getField(g.team, g.destCell, tick);
      else if (w.nav.bld[nc] >= 0) g.blocked = true;
      nx = g.x;
      ny = g.y;
      g.v = 0;
    }
    g.x = nx;
    g.y = ny;
    // 朝向平滑地转向前进方向
    let da = Math.atan2(my, mx) - Math.atan2(g.hy, g.hx);
    if (da > Math.PI) da -= Math.PI * 2;
    else if (da < -Math.PI) da += Math.PI * 2;
    if (da !== 0) {
      const a = Math.atan2(g.hy, g.hx) + (da > turn ? turn : da < -turn ? -turn : da);
      g.hx = Math.cos(a);
      g.hy = Math.sin(a);
    }
  }
}
