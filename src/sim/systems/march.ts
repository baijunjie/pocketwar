/**
 * 编队行军：一道移动命令里的部队共用一个看不见的「领队」。领队走在队列最前面，按全队最慢者的速度沿路线前进，
 * 并把走过的路记成一条「行迹」；每个单位跟着自己在队列里的位置走——位置沿行迹往后排，所以拐弯时队伍像蛇一样跟着拐。
 * 落后了就跑步追上；队伍散了领队会停下来等。
 * 领队一路量两侧的空当：路比队列窄就把横排收窄、往后加排（纵队），整支队伍过了窄处再展开。
 * 实在摆不开的地方，够不着自己位置的单位改走寻路路线，过去之后再归队。
 */
import { DT, RULES, TERRAIN_SPEED, TILE } from '../content';
import { DIRX, DIRY, DIR_HERE, Field } from '../nav';
import { NONE, S_COMBAT, S_ROUT } from '../state';
import type { World } from '../world';
import { formation } from './formation';

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
  /** 队伍正在打仗（攻击移动时有人交手，或大半人进入战斗状态）：不排队，各自为战；打完再整队 */
  loose: boolean;
  /** 成员数与平均掉队距离（每 8 帧统计一次） */
  n: number;
  lag: number;
  cnt: number;
  lagSum: number;
  /** 成员坐标之和（算重心用） */
  sx: number;
  sy: number;
  /** 队列中线：领队位置按两侧空当横移之后的点（走在窄路正中） */
  cx: number;
  cy: number;
  shift: number;
  shiftTo: number;
  /** 行迹：中线走过的点（x, y, 朝向），环形缓冲，head 是最新的一个，间隔 trailStep */
  trail: Float32Array;
  cap: number;
  head: number;
  /** 最新一个行迹点到当前中线的距离 */
  rec: number;
  /** 领队累计走过的路程 */
  odo: number;
  /** 队列现在的横宽、不受地形限制时的横宽、纵深，以及全队占地 */
  width: number;
  fullW: number;
  depth: number;
  area: number;
  /** 从哪里起两侧一直够宽（走过一个纵深之后才展开），以及这一段里见过的最窄处 */
  wideOdo: number;
  wideMin: number;
  reformTick: number;
}

/** marchSlot() 的结果：队列位置与那里的前进方向 */
export const SLOT = { x: 0, y: 0, hx: 0, hy: 0 };

/**
 * 队列里某个位置此刻在哪：a 是相对领队沿行进方向的偏移（≤ 0，越小越靠后），l 是横向偏移。
 * 沿行迹往回数 −a 的路程，再横移 l。
 */
export function marchSlot(g: March, a: number, l: number): void {
  let s = -a;
  let px: number, py: number, hx = g.hx, hy = g.hy;
  const t = g.trail;
  if (s <= 0) {
    px = g.cx - hx * s;
    py = g.cy - hy * s;
  } else if (s < g.rec) {
    const o = g.head * 4, f = s / g.rec;
    px = g.cx + (t[o] - g.cx) * f;
    py = g.cy + (t[o + 1] - g.cy) * f;
  } else {
    const step = RULES.march.trailStep;
    s -= g.rec;
    const q = s / step;
    const k = q | 0;
    if (k >= g.cap - 1) {
      // 比行迹还靠后：从最老的一点沿它的朝向往后直排
      const o = ((g.head + g.cap - 1) % g.cap) * 4;
      const over = s - (g.cap - 1) * step;
      hx = t[o + 2];
      hy = t[o + 3];
      px = t[o] - hx * over;
      py = t[o + 1] - hy * over;
    } else {
      const f = q - k;
      const o = ((g.head + k) % g.cap) * 4, o2 = ((g.head + k + 1) % g.cap) * 4;
      px = t[o] + (t[o2] - t[o]) * f;
      py = t[o + 1] + (t[o2 + 1] - t[o + 1]) * f;
      hx = t[o + 2] + (t[o2 + 2] - t[o + 2]) * f;
      hy = t[o + 3] + (t[o2 + 3] - t[o + 3]) * f;
    }
  }
  SLOT.x = px - hy * l;
  SLOT.y = py + hx * l;
  SLOT.hx = hx;
  SLOT.hy = hy;
}

/**
 * @param x, y 队伍的重心：队列先围着它排好，领队站到队列最前面
 * @param width, depth, area 队列的横宽、纵深与全队占地（formation() 的结果）
 */
export function createMarch(w: World, team: number, x: number, y: number, destX: number, destY: number, destCell: number,
  speed: number, run: number, amove: boolean, fx: number, fy: number, n: number, width: number, depth: number, area: number): March {
  const M = RULES.march;
  let g = w.marches.find(m => !m.alive);
  if (!g) {
    g = { id: w.marches.length, trail: new Float32Array(0) } as March;
    w.marches.push(g);
  }
  // 行迹要装得下最深的纵队
  const cap = Math.min(1024, Math.ceil(Math.max(depth, M.maxDepth) / M.trailStep) + 8);
  if (g.trail.length < cap * 4) g.trail = new Float32Array(cap * 4);
  Object.assign(g, {
    alive: true, team, destX, destY, destCell,
    speed, run, amove, fight: 0, alert: 0, cFight: 0, cAlert: 0, fx, fy, arrived: false, blocked: false, loose: false, n,
    cnt: 0, lagSum: 0, sx: 0, sy: 0, cap, width, fullW: width, depth, area, reformTick: w.tickCount,
  });
  anchor(w, g, x, y);
  return g;
}

/** 把领队安到以 (x, y) 为重心的队列最前面，行迹沿去目的地的方向往后铺直（下令时，以及打完仗重新整队时） */
function anchor(w: World, g: March, x: number, y: number): void {
  const M = RULES.march, team = g.team;
  // 领队不能出生在水里或墙里
  const c0 = w.cellAt(x, y);
  if (w.nav.block[team][c0] || w.nav.deck[team][c0]) {
    const c = w.nav.nearestFree(team, c0, 20);
    x = (c % w.map.w + 0.5) * TILE;
    y = (((c / w.map.w) | 0) + 0.5) * TILE;
  }
  const dx = g.destX - x, dy = g.destY - y, dl = Math.hypot(dx, dy) || 1;
  const hx = dx / dl, hy = dy / dl;
  // 领队站到队列最前面（走得通的话）：队列正好围着重心
  const lead = Math.min(g.depth / 2, dl - 1);
  const lx = x + hx * lead, ly = y + hy * lead;
  if (lead > 0 && !w.nav.block[team][w.cellAt(lx, ly)] && !w.lineBlocked(x, y, lx, ly, team)) {
    x = lx;
    y = ly;
  }
  for (let k = 0; k < g.cap; k++) {
    g.trail[k * 4] = x - hx * M.trailStep * k;
    g.trail[k * 4 + 1] = y - hy * M.trailStep * k;
    g.trail[k * 4 + 2] = hx;
    g.trail[k * 4 + 3] = hy;
  }
  Object.assign(g, {
    x, y, hx, hy, cx: x, cy: y, shift: 0, shiftTo: 0, head: 0, rec: 0, odo: 0, v: 0, lag: M.lagStop,
    wideOdo: 0, wideMin: g.fullW,
    field: w.lineBlocked(x, y, g.destX, g.destY, team) ? w.nav.getField(team, g.destCell, w.tickCount) : null,
  });
}

/** 从 (qx, qy) 沿 (nx, ny) 方向量出多远都走得通（每 16 像素探一次，最多 max） */
function clearance(w: World, tm: number, qx: number, qy: number, nx: number, ny: number, max: number): number {
  const blk = w.nav.block[tm], mw = w.map.w;
  let prev = ((qy / TILE) | 0) * mw + ((qx / TILE) | 0);
  let d = 0;
  while (d < max) {
    const px = qx + nx * (d + 16), py = qy + ny * (d + 16);
    if (px < 0 || py < 0 || px >= w.W || py >= w.H) break;
    const c = ((py / TILE) | 0) * mw + ((px / TILE) | 0);
    if (c !== prev && (blk[c] || !w.nav.canStep(tm, prev, c))) break;
    prev = c;
    d += 16;
  }
  return d;
}

/** 按新的横宽把队列重排一遍（保持各人原来的先后与左右次序） */
function reform(w: World, g: March, width: number): void {
  const units: number[] = [];
  for (let i = 0; i < w.n; i++) if (w.alive[i] && w.grp[i] === g.id) units.push(i);
  if (!units.length) return;
  const f = formation(w, units.map(s => w.type[s]), 0, 0, 1, 0, units, width, true);
  let top = -1e9;
  for (let m = 0; m < units.length; m++) if (f.fa[m] > top) top = f.fa[m];
  for (let m = 0; m < units.length; m++) {
    w.offA[units[m]] = f.fa[m] - top;
    w.offL[units[m]] = f.fl[m];
  }
  g.width = f.width;
  g.depth = f.depth;
  g.reformTick = w.tickCount;
}

/** 量领队身前一段路两侧的空当，决定队列该排多宽、往哪边让 */
function fit(w: World, g: March): void {
  const M = RULES.march;
  const tm = g.team, blk = w.nav.block[tm];
  const nx = -g.hy, ny = g.hx;
  const max = g.fullW / 2 + 16;
  let left = max, right = max;
  for (const a of M.probe) {
    const qx = g.x + g.hx * a, qy = g.y + g.hy * a;
    if (qx < 0 || qy < 0 || qx >= w.W || qy >= w.H || blk[w.cellAt(qx, qy)]) continue;
    if (a > 0 && w.lineBlocked(g.x, g.y, qx, qy, tm)) continue;
    const r = clearance(w, tm, qx, qy, nx, ny, max), l = clearance(w, tm, qx, qy, -nx, -ny, max);
    if (r < right) right = r;
    if (l < left) left = l;
  }
  const tight = left < max || right < max;
  g.shiftTo = tight ? (right - left) / 2 : 0;
  // 探的是格子中心到障碍的距离：两侧各留一点余量，人不贴着墙走；纵队也不排得太长，摆不下的照旧各自寻路
  let want = tight ? left + right + 16 - M.margin * 2 : g.fullW;
  const floor = g.area / M.maxDepth;
  if (want < floor) want = floor;
  if (want > g.fullW) want = g.fullW;
  if (want < g.width - 6) {
    reform(w, g, want);
    g.wideOdo = g.odo;
    g.wideMin = g.fullW;
  } else if (want > g.width + 6 && (want >= g.fullW || want > g.width * M.widen)) {
    // 够宽了：等整支队伍都走过窄处再展开
    if (want < g.wideMin) g.wideMin = want;
    if (g.odo - g.wideOdo > g.depth * M.widenAfter) {
      reform(w, g, g.wideMin);
      g.wideOdo = g.odo;
      g.wideMin = g.fullW;
    }
  } else {
    g.wideOdo = g.odo;
    g.wideMin = g.fullW;
  }
}

export function updateMarches(w: World): void {
  const ms = w.marches;
  if (!ms.length) return;
  const M = RULES.march;
  const tick = w.tickCount;
  if ((tick & 7) === 0) {
    // 统计各队人数与掉队情况
    for (const g of ms) g.cnt = g.lagSum = g.cFight = g.cAlert = g.sx = g.sy = 0;
    const grp = w.grp;
    for (let i = 0; i < w.n; i++) {
      const gi = grp[i];
      if (gi < 0 || !w.alive[i]) continue;
      const g = ms[gi];
      if (!g.alive || g.arrived || w.state[i] & S_ROUT) {
        grp[i] = -1;
        continue;
      }
      g.cnt++;
      g.sx += w.x[i];
      g.sy += w.y[i];
      if (w.target[i] !== NONE) g.cFight++;
      if (w.state[i] & S_COMBAT) {
        // 进入战斗状态的人不排队，也不算掉队
        g.cAlert++;
        continue;
      }
      marchSlot(g, w.offA[i], w.offL[i]);
      const ox = SLOT.x - w.x[i], oy = SLOT.y - w.y[i];
      let lag = Math.sqrt(ox * ox + oy * oy);
      // 站在自己位置前面的人不用等：位置会自己走过来
      if (ox * SLOT.hx + oy * SLOT.hy < 0) lag *= M.aheadLag;
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
        // 打起来了就散开各自为战；打完以大家现在的重心重新整队，不走回头路
        const loose = (g.amove && g.fight > M.holdFight) || g.alert > 0.5;
        if (g.loose && !loose && !g.arrived) anchor(w, g, g.sx / g.cnt, g.sy / g.cnt);
        g.loose = loose;
        if (!g.arrived && !loose && g.cnt > 1) fit(w, g);
      }
    }
  }
  const mw = w.map.w, terr = w.map.terrain;
  const rain = w.env.raining ? RULES.env.rainSpeed : 1;
  // 领队也吃顺风 / 顶风，否则成员和队列位置对不上
  const windK = w.env.wind * RULES.env.windSpeed, windX = Math.cos(w.env.windDir), windY = Math.sin(w.env.windDir);
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
    const ml = Math.sqrt(mx * mx + my * my);
    const wf = windK > 0 && ml > 0 ? 1 + windK * (mx * windX + my * windY) / ml : 1;
    let nx = g.x + mx * step * wf, ny = g.y + my * step * wf;
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
    if (g.v <= 0) continue;
    // 中线与行迹
    g.shift += (g.shiftTo - g.shift) * M.shiftRate;
    const pcx = g.cx, pcy = g.cy;
    g.cx = nx - g.hy * g.shift;
    g.cy = ny + g.hx * g.shift;
    const moved = Math.hypot(g.cx - pcx, g.cy - pcy);
    g.odo += step;
    g.rec += moved;
    while (g.rec >= M.trailStep && moved > 0) {
      // 在走过的这一小段上、离上一个行迹点正好一个间隔的地方记一点
      const back = (g.rec - M.trailStep) / moved;
      g.head = (g.head + g.cap - 1) % g.cap;
      const o = g.head * 4;
      g.trail[o] = g.cx - (g.cx - pcx) * back;
      g.trail[o + 1] = g.cy - (g.cy - pcy) * back;
      g.trail[o + 2] = g.hx;
      g.trail[o + 3] = g.hy;
      g.rec -= M.trailStep;
    }
  }
}
