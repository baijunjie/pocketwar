/**
 * 编队行军：一道移动命令里的部队共用一个看不见的「领队」。领队走在队列最前面，按全队最慢者的速度沿路线前进，
 * 并把走过的路记成一条「行迹」；每个单位跟着自己在队列里的位置走——位置沿行迹往后排，所以拐弯时队伍像蛇一样跟着拐。
 * 落后了就跑步追上；队伍散了领队会停下来等。
 * 领队一路量两侧的空当：只有一侧被挡、另一侧摆得下，整队往另一侧让开；路比队列窄就把横排收窄、往后加排（纵队），
 * 整支队伍过了窄处再展开。
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
  /** 队列中线相对领队的横移（正为朝向的右手边）：一侧被挡时整队往另一侧让，窄路上走在路的正中 */
  shift: number;
  shiftTo: number;
  /**
   * 行迹：领队走过的点（x, y, 朝向, 当时的中线横移），环形缓冲，head 是最新的一个，间隔 trailStep。
   * 横移单独记一栏、不折进坐标里：行迹的路程只算领队实际走过的路，横移再怎么变，沿行迹排的队列也不会被折叠。
   */
  trail: Float32Array;
  cap: number;
  head: number;
  /** 最新一个行迹点到领队的路程 */
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
  /** 正在分步展开 */
  widening: boolean;
  reformTick: number;
}

/** 行迹每个点占几个数 */
const TRAIL = 5;

/** marchSlot() 的结果：队列位置与那里的前进方向 */
export const SLOT = { x: 0, y: 0, hx: 0, hy: 0 };

/**
 * 队列里某个位置此刻在哪：a 是相对领队沿行进方向的偏移（≤ 0，越小越靠后），l 是横向偏移。
 * 沿行迹往回数 −a 的路程，再横移 l。
 */
export function marchSlot(g: March, a: number, l: number): void {
  let s = -a;
  let px: number, py: number, hx = g.hx, hy = g.hy, sh = g.shift;
  const t = g.trail;
  if (s <= 0) {
    px = g.x - hx * s;
    py = g.y - hy * s;
  } else if (s < g.rec) {
    const o = g.head * TRAIL, f = s / g.rec;
    px = g.x + (t[o] - g.x) * f;
    py = g.y + (t[o + 1] - g.y) * f;
    sh += (t[o + 4] - sh) * f;
  } else {
    const step = RULES.march.trailStep;
    s -= g.rec;
    const q = s / step;
    const k = q | 0;
    if (k >= g.cap - 1) {
      // 比行迹还靠后：从最老的一点沿它的朝向往后直排
      const o = ((g.head + g.cap - 1) % g.cap) * TRAIL;
      const over = s - (g.cap - 1) * step;
      hx = t[o + 2];
      hy = t[o + 3];
      sh = t[o + 4];
      px = t[o] - hx * over;
      py = t[o + 1] - hy * over;
    } else {
      const f = q - k;
      const o = ((g.head + k) % g.cap) * TRAIL, o2 = ((g.head + k + 1) % g.cap) * TRAIL;
      px = t[o] + (t[o2] - t[o]) * f;
      py = t[o + 1] + (t[o2 + 1] - t[o + 1]) * f;
      hx = t[o + 2] + (t[o2 + 2] - t[o + 2]) * f;
      hy = t[o + 3] + (t[o2 + 3] - t[o + 3]) * f;
      sh = t[o + 4] + (t[o2 + 4] - t[o + 4]) * f;
    }
  }
  l += sh;
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
  // 成员走光的编队对象原样拿来重用：按编队对象统计某支队伍的人，要在它到达之前截止，或改按成员单位去认
  let g = w.marches.find(m => !m.alive);
  if (!g) {
    g = { id: w.marches.length, trail: new Float32Array(0) } as March;
    w.marches.push(g);
  }
  // 行迹要装得下最深的纵队
  const cap = Math.min(1024, Math.ceil(Math.max(depth, M.maxDepth) / M.trailStep) + 8);
  if (g.trail.length < cap * TRAIL) g.trail = new Float32Array(cap * TRAIL);
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
    g.trail[k * TRAIL] = x - hx * M.trailStep * k;
    g.trail[k * TRAIL + 1] = y - hy * M.trailStep * k;
    g.trail[k * TRAIL + 2] = hx;
    g.trail[k * TRAIL + 3] = hy;
    g.trail[k * TRAIL + 4] = 0;
  }
  Object.assign(g, {
    x, y, hx, hy, shift: 0, shiftTo: 0, head: 0, rec: 0, odo: 0, v: 0, lag: M.lagStop,
    wideOdo: 0, wideMin: g.fullW, widening: false,
    field: w.lineBlocked(x, y, g.destX, g.destY, team) ? w.nav.getField(team, g.destCell, w.tickCount) : null,
  });
}

const AIM = { x: 0, y: 0 };

/**
 * 沿流场从领队脚下往前数格子，取直线走得通的最远一格（不超过 look 的距离），结果放在 AIM。
 * 流场只有八个方向，直接照着走是一段段折线；横队跟着折线拐，每拐一下都要整队转一次身。
 */
function lookAhead(w: World, g: March, f: Field, cell: number): boolean {
  const M = RULES.march, mw = w.map.w;
  const look = Math.max(M.lookMin, g.width * M.lookK);
  const max = Math.ceil(look / TILE) * 2 + 2;
  let c = cell, ok = false;
  for (let k = 0; k < max; k++) {
    const dir = f.dirs[c];
    if (dir > 7) {
      if (dir === DIR_HERE && !w.lineBlocked(g.x, g.y, g.destX, g.destY, g.team)) {
        AIM.x = g.destX;
        AIM.y = g.destY;
        ok = true;
      }
      break;
    }
    c += DIRX[dir] + DIRY[dir] * mw;
    const px = (c % mw + 0.5) * TILE, py = (((c / mw) | 0) + 0.5) * TILE;
    if ((px - g.x) ** 2 + (py - g.y) ** 2 > look * look) break;
    if (w.lineBlocked(g.x, g.y, px, py, g.team)) break;
    AIM.x = px;
    AIM.y = py;
    ok = true;
  }
  return ok;
}

/** 量空当时每隔多远探一次；量出的是探到的最后一点，离障碍还有不到一步 */
const PROBE = 16;

/** 从 (qx, qy) 沿 (nx, ny) 方向量出多远都走得通（每 PROBE 像素探一次，最多 max） */
function clearance(w: World, tm: number, qx: number, qy: number, nx: number, ny: number, max: number): number {
  const blk = w.nav.block[tm], mw = w.map.w;
  let prev = ((qy / TILE) | 0) * mw + ((qx / TILE) | 0);
  let d = 0;
  while (d < max) {
    const px = qx + nx * (d + PROBE), py = qy + ny * (d + PROBE);
    if (px < 0 || py < 0 || px >= w.W || py >= w.H) break;
    const c = ((py / TILE) | 0) * mw + ((px / TILE) | 0);
    if (c !== prev && (blk[c] || !w.nav.canStep(tm, prev, c))) break;
    prev = c;
    d += PROBE;
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

/** measure() 的结果：近处（probeAhead 以内）与远处（一直量到 ahead）两侧最窄的空当 */
const SIDE = { left: 0, right: 0, farLeft: 0, farRight: 0 };

/** 在 (qx, qy) 朝 (hx, hy) 走时两侧各有多少空当，比 SIDE 里已有的窄就记下；near 为 false 时只记进远处的 */
function sides(w: World, tm: number, qx: number, qy: number, hx: number, hy: number, max: number, near: boolean): void {
  const r = clearance(w, tm, qx, qy, -hy, hx, max), l = clearance(w, tm, qx, qy, hy, -hx, max);
  if (r < SIDE.farRight) SIDE.farRight = r;
  if (l < SIDE.farLeft) SIDE.farLeft = l;
  if (near) {
    if (r < SIDE.right) SIDE.right = r;
    if (l < SIDE.left) SIDE.left = l;
  }
}

/**
 * 量领队脚下与身前一段路两侧的空当（每侧最多量到 max），结果放在 SIDE。
 * 身前的各点沿路线取（有流场时逐格顺着流场数，没有时沿去终点的直线），空当垂直于那一点的路线方向量：
 * 照领队此刻的朝向直着往前量的话，斜着走向一道墙时，前方的墙会被量成侧面的墙。
 */
function measure(w: World, g: March, max: number): void {
  const M = RULES.march;
  const tm = g.team, blk = w.nav.block[tm], mw = w.map.w;
  // 中线横移有快慢限制，让开半个队宽要走这么远的路：往前至少量这么远，队首到障碍跟前时才来得及让到位
  const ahead = Math.max(M.probeAhead, g.fullW / 2 / M.shiftSlope);
  SIDE.left = SIDE.right = SIDE.farLeft = SIDE.farRight = max;
  sides(w, tm, g.x, g.y, g.hx, g.hy, max, true);
  const f = g.field;
  let c = w.cellAt(g.x, g.y);
  if (f && f.dirs[c] < 8) {
    for (let d = 0; d < ahead;) {
      const dir = f.dirs[c];
      if (dir > 7) break;
      const sx = DIRX[dir], sy = DIRY[dir];
      c += sx + sy * mw;
      if (blk[c]) break;
      // 从近段以内迈出的这一步所到的点仍算近段
      const near = d < M.probeAhead;
      d += dir & 1 ? TILE * 1.4142 : TILE;
      // 路线方向取进这一格与出这一格两步的平均，八方向的折线不至于每格偏出 45°
      const nd = f.dirs[c];
      let hx = sx, hy = sy;
      if (nd < 8 && (sx + DIRX[nd] || sy + DIRY[nd])) {
        hx += DIRX[nd];
        hy += DIRY[nd];
      }
      const k = 1 / Math.hypot(hx, hy);
      sides(w, tm, (c % mw + 0.5) * TILE, (((c / mw) | 0) + 0.5) * TILE, hx * k, hy * k, max, near);
    }
  } else if (!f) {
    const dx = g.destX - g.x, dy = g.destY - g.y, dd = Math.hypot(dx, dy);
    if (dd > 1) {
      const ux = dx / dd, uy = dy / dd;
      for (let a = TILE; a <= ahead && a < dd; a += TILE) {
        const qx = g.x + ux * a, qy = g.y + uy * a;
        if (blk[w.cellAt(qx, qy)]) break;
        sides(w, tm, qx, qy, ux, uy, max, a - TILE < M.probeAhead);
      }
    }
  }
}

/** 按两侧的空当决定队列该排多宽、中线往哪边让 */
function fit(w: World, g: March): void {
  const M = RULES.march;
  // 一侧被挡时另一侧要量到摆得下整个横排那么远：整队让过去就行的地方不必收窄
  const max = g.fullW + PROBE;
  measure(w, g, max);
  const left = SIDE.left, right = SIDE.right;
  const tight = left < max || right < max;
  // 量出的空当离障碍还差不到一步，两侧合起来按一步补上；再各留一点余量，人不贴着墙走。
  // 纵队也不排得太长，摆不下的照旧各自寻路
  let want = tight ? left + right + PROBE - M.margin * 2 : g.fullW;
  const floor = g.area / M.maxDepth;
  if (want < floor) want = floor;
  if (want > g.fullW) want = g.fullW;
  // 中线只让到刚好摆得下：两侧都够就不动，一侧不够往另一侧让出差的那一截，两侧都不够（路比队列还窄）才走正中。
  // half 是中线到一侧障碍至少要有的空当，与上面 want 的算法互逆。
  // 先按远处的空当提前让，再收进近处摆得下的范围里：远处有比队列还窄的路（走近了才收窄）时先朝它的正中靠
  const half = want / 2 + M.margin - PROBE / 2;
  const lo = half - left, hi = right - half;
  const flo = half - SIDE.farLeft, fhi = SIDE.farRight - half;
  const to = flo > fhi ? (SIDE.farRight - SIDE.farLeft) / 2 : flo > 0 ? flo : fhi < 0 ? fhi : 0;
  g.shiftTo = lo > hi ? (right - left) / 2 : to < lo ? lo : to > hi ? hi : to;
  if (want < g.width - 6) {
    reform(w, g, want);
    g.widening = false;
    g.wideOdo = g.odo;
    g.wideMin = g.fullW;
  } else if (want > g.width + 6 && (g.widening || want >= g.fullW || want > g.width * M.widen)) {
    // 够宽了：等整支队伍都走过窄处再展开
    if (want < g.wideMin) g.wideMin = want;
    if (g.widening || g.odo - g.wideOdo > g.depth * M.widenAfter) {
      // 一次只展开一点：纵深每次最多缩短 widenStep，后排的位置只往前挪这么多，小跑几步就跟上；
      // 一下子展开到位的话，后排的位置会前跳几百像素，领队只能停下来等
      g.widening = true;
      if (g.lag < M.lagFull && w.tickCount - g.reformTick >= M.widenEvery) {
        const room = g.depth - M.widenStep;
        const to = room > g.depth / 2 ? g.width * g.depth / room : g.width * 2;
        reform(w, g, to < g.wideMin ? to : g.wideMin);
        if (g.width >= g.wideMin - 6) {
          g.widening = false;
          g.wideOdo = g.odo;
          g.wideMin = g.fullW;
        }
      }
    }
  } else {
    g.widening = false;
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
      // 位置在自己身后的人（收窄成纵队时排到了后面）原地等位置走过来，不算掉队：
      // 算进去的话领队会为了等他们放慢，位置就走得更慢，整支队伍越等越久
      if (ox * SLOT.hx + oy * SLOT.hy < -M.waitAhead) continue;
      const lag = Math.sqrt(ox * ox + oy * oy);
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
  // 与 units.ts 里成员的速度用同一个天气系数
  const rain = w.env.raining ? RULES.env.rainSpeed : w.env.snowing ? RULES.env.snowSpeed : 1;
  // 领队也吃顺风 / 顶风，否则成员和队列位置对不上
  const windK = w.env.wind * RULES.env.windSpeed, windX = Math.cos(w.env.windDir), windY = Math.sin(w.env.windDir);
  const maxTurn = M.turn * DT;
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
    // 往哪儿走：沿路线往前看一段，取看得见的最远一点（八方向流场的折线拉直）；离终点近了就直奔终点
    let tx = g.destX, ty = g.destY;
    let f = g.field;
    let fdx = 0, fdy = 0;
    if (f) {
      if (f.dead) f = g.field = w.nav.getField(g.team, g.destCell, tick);
      f.lastUse = tick;
      const dir = f.dirs[cell];
      if (dir < 8) {
        const kk = dir & 1 ? 0.7071 : 1;
        fdx = DIRX[dir] * kk;
        fdy = DIRY[dir] * kk;
        if (lookAhead(w, g, f, cell)) {
          tx = AIM.x;
          ty = AIM.y;
        } else {
          tx = g.x + fdx * TILE;
          ty = g.y + fdy * TILE;
        }
      } else if (dir !== DIR_HERE && f.pending) {
        // 路线还没算出来：等一等
        g.v = 0;
        continue;
      }
    }
    // 朝向（队列横排的方向）按队宽限制转向：转弯半径不小于领队到队列最外侧的距离（半个队宽加中线横移），
    // 否则内侧的位置会往回折、外侧要跑一大圈
    const ha = Math.atan2(g.hy, g.hx);
    let da = Math.atan2(ty - g.y, tx - g.x) - ha;
    if (da > Math.PI) da -= Math.PI * 2;
    else if (da < -Math.PI) da += Math.PI * 2;
    const radius = dd < g.width ? 1 : Math.max(M.turnR, g.width / 2 + Math.abs(g.shift));
    let turn = step / radius;
    if (turn > maxTurn) turn = maxTurn;
    const na = ha + (da > turn ? turn : da < -turn ? -turn : da);
    g.hx = Math.cos(na);
    g.hy = Math.sin(na);
    // 脚下的方向：朝向转得慢，领队可以斜着走一点（最多 slide），横队整体侧移着跟上路线
    let ma = na;
    const rest = da - (na - ha);
    if (rest > M.slide) ma += M.slide;
    else if (rest < -M.slide) ma -= M.slide;
    else ma += rest;
    let mx = Math.cos(ma), my = Math.sin(ma);
    const wf = windK > 0 ? 1 + windK * (mx * windX + my * windY) : 1;
    let nx = g.x + mx * step * wf, ny = g.y + my * step * wf;
    let nc = ((ny / TILE) | 0) * mw + ((nx / TILE) | 0);
    const blk = w.nav.block[g.team];
    if (nc !== cell && (blk[nc] || !w.nav.canStep(g.team, cell, nc)) && (fdx || fdy)) {
      // 抄近路撞上了障碍：老老实实沿流场走
      mx = fdx;
      my = fdy;
      nx = g.x + mx * step * wf;
      ny = g.y + my * step * wf;
      nc = ((ny / TILE) | 0) * mw + ((nx / TILE) | 0);
    }
    g.blocked = false;
    if (nc !== cell && (blk[nc] || !w.nav.canStep(g.team, cell, nc))) {
      // 直线走不通：改用寻路；寻路路线上是别人的建筑（城门、木栅）就停下，让成员去打
      if (!g.field) g.field = w.nav.getField(g.team, g.destCell, tick);
      else if (w.nav.bld[nc] >= 0) g.blocked = true;
      nx = g.x;
      ny = g.y;
      g.v = 0;
    }
    const px = g.x, py = g.y;
    g.x = nx;
    g.y = ny;
    if (g.v <= 0) continue;
    // 中线横移的快慢跟着领队走过的路程算，不跟时间算：领队放慢等人时，后面的位置不会原地左右扫
    const psh = g.shift;
    const moved = Math.hypot(nx - px, ny - py);
    const ds = g.shiftTo - psh, lim = moved * M.shiftSlope;
    g.shift = psh + (ds > lim ? lim : ds < -lim ? -lim : ds);
    g.odo += step;
    g.rec += moved;
    while (g.rec >= M.trailStep && moved > 0) {
      // 在走过的这一小段上、离上一个行迹点正好一个间隔的地方记一点
      const back = (g.rec - M.trailStep) / moved;
      g.head = (g.head + g.cap - 1) % g.cap;
      const o = g.head * TRAIL;
      g.trail[o] = nx - (nx - px) * back;
      g.trail[o + 1] = ny - (ny - py) * back;
      g.trail[o + 2] = g.hx;
      g.trail[o + 3] = g.hy;
      g.trail[o + 4] = g.shift - (g.shift - psh) * back;
      g.rec -= M.trailStep;
    }
  }
}
