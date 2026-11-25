/**
 * 编队行军：一道移动命令里的部队共用一个看不见的「领队」。领队走在队列最前面，按全队最慢者的速度沿路线前进，
 * 并把走过的路记成一条「行迹」；每个单位跟着自己在队列里的位置走——位置沿行迹往后排，所以拐弯时队伍像蛇一样跟着拐。
 * 落后了就跑步追上；队伍散了领队会停下来等。
 * 队列的横宽与纵深一路不变，不为地形变阵：位置落进障碍里、或隔着障碍够不着的人往中线收拢、或各自找路过去（见 marchFollow），
 * 过去之后再回到位置上。队列压在障碍上的那一段领队不等这些人，整个队列走出障碍之后才放慢等他们归队。
 * 领队走的就是单个单位的最短路线，不因为队伍宽而另选一条离障碍远些的路：给障碍附近加价，加得轻路线几乎不变，
 * 加得重路线就弯，整个方阵要跟着转身，不如照直走、让被挡的人自己绕；途经的营寨、城池也不绕开，
 * 两翼从墙外走、中间从门里穿，比整队绕过去快。
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
  /** 队伍正在打仗（攻击移动时有人交手，或大半人进入战斗状态）：不排队，各自为战；打完再整队 */
  loose: boolean;
  /**
   * 队伍「在和敌兵打」的状态还剩多少秒，大于 0 即在打：有成员以没溃逃的敌兵为目标（打建筑、追溃兵的不算），
   * 最后一次这样之后再保持 RULES.combat.linger 秒。在打时队列位置落在身后的成员不原地等，沿路线往前走
   */
  battleT: number;
  /** 以没溃逃的敌兵为目标的成员数（每 8 帧统计一次） */
  cFoe: number;
  /** 成员数与平均掉队距离（每 8 帧统计一次） */
  n: number;
  lag: number;
  cnt: number;
  lagSum: number;
  /** 够不着位置、正各自找路的成员的掉队距离之和：队列压在障碍上时不算进 lag */
  lagApart: number;
  /** 队列里有多少个位置落在障碍里、或与本排中线隔开（每 8 帧统计一次）：多到一定比例就算队列正压在障碍上 */
  over: number;
  /** 成员坐标之和（算重心用） */
  sx: number;
  sy: number;
  /** 行迹：领队走过的点（x, y, 朝向），环形缓冲，head 是最新的一个，间隔 trailStep */
  trail: Float32Array;
  cap: number;
  head: number;
  /** 最新一个行迹点到领队的路程 */
  rec: number;
  /** 队列的横宽与纵深 */
  width: number;
  depth: number;
}

/** 行迹每个点占几个数 */
const TRAIL = 4;

/**
 * marchSlot() 的结果：队列位置与那里的前进方向，以及本排中线上的那一点（同一排、横向偏移为 0 处）。
 * 中线点落在领队走过的路上，通常走得通；刚下令、刚重新整队时行迹是照直往后铺的，那一段可能压着障碍
 */
export const SLOT = { x: 0, y: 0, hx: 0, hy: 0, cx: 0, cy: 0 };

/**
 * 队列里某个位置此刻在哪：a 是相对领队沿行进方向的偏移（≤ 0，越小越靠后），l 是横向偏移（正为朝向的右手边）。
 * 沿行迹往回数 −a 的路程，再横移 l。
 */
export function marchSlot(g: March, a: number, l: number): void {
  let s = -a;
  let px: number, py: number, hx = g.hx, hy = g.hy;
  const t = g.trail;
  if (s <= 0) {
    px = g.x - hx * s;
    py = g.y - hy * s;
  } else if (s < g.rec) {
    const o = g.head * TRAIL, f = s / g.rec;
    px = g.x + (t[o] - g.x) * f;
    py = g.y + (t[o + 1] - g.y) * f;
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
      px = t[o] - hx * over;
      py = t[o + 1] - hy * over;
    } else {
      const f = q - k;
      const o = ((g.head + k) % g.cap) * TRAIL, o2 = ((g.head + k + 1) % g.cap) * TRAIL;
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
  SLOT.cx = px;
  SLOT.cy = py;
}

/**
 * @param x, y 队伍的重心：队列先围着它排好，领队站到队列最前面
 * @param width, depth 队列的横宽与纵深（formation() 的结果）
 */
export function createMarch(w: World, team: number, x: number, y: number, destX: number, destY: number, destCell: number,
  speed: number, run: number, amove: boolean, fx: number, fy: number, n: number, width: number, depth: number): March {
  const M = RULES.march;
  // 成员走光的编队对象原样拿来重用：按编队对象统计某支队伍的人，要在它到达之前截止，或改按成员单位去认
  let g = w.marches.find(m => !m.alive);
  if (!g) {
    g = { id: w.marches.length, trail: new Float32Array(0) } as March;
    w.marches.push(g);
  }
  // 行迹要装得下整个队列的纵深
  const cap = Math.min(1024, Math.ceil(depth / M.trailStep) + 8);
  if (g.trail.length < cap * TRAIL) g.trail = new Float32Array(cap * TRAIL);
  Object.assign(g, {
    alive: true, team, destX, destY, destCell,
    speed, run, amove, fight: 0, alert: 0, cFight: 0, cAlert: 0, cFoe: 0, fx, fy, arrived: false, blocked: false, loose: false, battleT: 0, n,
    cnt: 0, lagSum: 0, lagApart: 0, over: 0, sx: 0, sy: 0, cap, width, depth,
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
  }
  Object.assign(g, {
    x, y, hx, hy, head: 0, rec: 0, v: 0, lag: M.lagStop,
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

/** (x, y) 在地图里、所在的格子本队走得通 */
function standable(w: World, tm: number, x: number, y: number): boolean {
  return x > 8 && y > 8 && x < w.W - 8 && y < w.H - 8 && w.nav.block[tm][w.cellAt(x, y)] === 0;
}

/** marchFollow() 的结果：这一帧跟着走的那一点 */
export const FOLLOW = { x: 0, y: 0 };
/** marchFollow() 的返回值：跟着自己的位置走、往中线收拢着随本排走、够不着也看不见本排（各自找路） */
export const FOLLOW_SLOT = 0, FOLLOW_SQUEEZE = 1, FOLLOW_APART = 2;

/**
 * 站在 (ux, uy) 的成员这一帧该跟着哪一点走，结果放在 FOLLOW。位置要先由 marchSlot 算好放在 SLOT 里，l 是它的横向偏移。
 * - 位置站得住、直线走得到：跟着位置走。
 * - 够不着位置、但看得见本排中线点：这一侧被障碍削窄了，往中线收拢着随本排走。从中线点朝位置量到障碍跟前，那是这一侧还剩的宽度；
 *   站到「自己原来离中线多远 ÷ 半个队宽」的同一比例处，最外侧的人贴着障碍，其余的人往里摊开，不会都挤在障碍边上。
 *   位置本身站得住、中线点到它也走得通时（只是自己这里被一小块障碍挡着），这一侧没有变窄，仍以位置为准。
 *   一时看不见要去的那一点（隔着障碍的一角）就先朝中线点走。
 * - 连中线点也看不见（隔着墙、房子、河）：返回 FOLLOW_APART，由调用方按寻路路线各自找路，FOLLOW 不填。
 */
export function marchFollow(w: World, g: March, l: number, ux: number, uy: number): number {
  const tm = g.team, px = SLOT.x, py = SLOT.y, cx = SLOT.cx, cy = SLOT.cy;
  if (standable(w, tm, px, py) && !w.lineBlocked(ux, uy, px, py, tm)) {
    FOLLOW.x = px;
    FOLLOW.y = py;
    return FOLLOW_SLOT;
  }
  if (w.lineBlocked(ux, uy, cx, cy, tm)) return FOLLOW_APART;
  const reach = w.lineReach(cx, cy, px, py, tm);
  let k = reach < 1 || !standable(w, tm, px, py) ? reach * (l < 0 ? -l : l) * 2 / g.width : 1;
  if (k > 1) k = 1;
  const qx = cx + (px - cx) * k, qy = cy + (py - cy) * k;
  if (w.lineBlocked(ux, uy, qx, qy, tm)) {
    FOLLOW.x = cx;
    FOLLOW.y = cy;
  } else {
    FOLLOW.x = qx;
    FOLLOW.y = qy;
  }
  return FOLLOW_SQUEEZE;
}

export function updateMarches(w: World): void {
  const ms = w.marches;
  if (!ms.length) return;
  const M = RULES.march;
  const tick = w.tickCount;
  if ((tick & 7) === 0) {
    // 统计各队人数与掉队情况
    for (const g of ms) g.cnt = g.lagSum = g.lagApart = g.over = g.cFight = g.cAlert = g.cFoe = g.sx = g.sy = 0;
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
      if (w.target[i] !== NONE) {
        g.cFight++;
        const t = w.target[i];
        if (t >= 0 && !(w.state[t] & S_ROUT)) g.cFoe++;
      }
      if (w.state[i] & S_COMBAT) {
        // 进入战斗状态的人不排队，也不算掉队
        g.cAlert++;
        continue;
      }
      marchSlot(g, w.offA[i], w.offL[i]);
      // 位置站不了人，或与本排中线点之间被隔开：队列的这一处压在障碍上
      if (!standable(w, g.team, SLOT.x, SLOT.y) || w.lineBlocked(SLOT.cx, SLOT.cy, SLOT.x, SLOT.y, g.team)) g.over++;
      const ox = SLOT.x - w.x[i], oy = SLOT.y - w.y[i];
      // 位置在自己身后的人不算掉队：平时他们原地等位置走过来，队伍在打时沿路线往前走，都不需要领队等
      if (ox * SLOT.hx + oy * SLOT.hy < -M.waitAhead) continue;
      const lag = Math.sqrt(ox * ox + oy * oy);
      if (w.apart[i]) g.lagApart += lag > 400 ? 400 : lag;
      else g.lagSum += lag > 400 ? 400 : lag;
    }
    for (const g of ms) {
      if (!g.alive) continue;
      g.n = g.cnt;
      if (!g.cnt) g.alive = false;
      else {
        // 队列压在障碍上时，够不着位置的人正各自绕路，领队不等他们：停下来等的话，后几排的位置也跟着停在障碍这一侧，
        // 全队就成了一排一排地等、一排一排地过。整个队列走出障碍之后再把他们算进来，领队放慢等他们归队
        const draped = g.over > Math.max(1, g.cnt * M.overMin);
        g.lag = (g.lagSum + (draped ? 0 : g.lagApart)) / g.cnt;
        g.fight = g.cFight / g.cnt;
        g.alert = g.cAlert / g.cnt;
        // 打起来了就散开各自为战；打完以大家现在的重心重新整队，不走回头路
        const loose = (g.amove && g.fight > M.holdFight) || g.alert > 0.5;
        // 统计每 8 帧一次，保持时间按 8 帧扣；零星一个敌兵冒出来又没了，队伍不至于刚散开往前走又马上回去等位置
        if (g.cFoe > 0) g.battleT = RULES.combat.linger;
        else if (g.battleT > 0) g.battleT -= DT * 8;
        if (g.loose && !loose && !g.arrived) anchor(w, g, g.sx / g.cnt, g.sy / g.cnt);
        g.loose = loose;
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
    // 朝向（队列横排的方向）按队宽限制转向：转弯半径不小于领队到队列最外侧的距离（半个队宽），
    // 否则内侧的位置会往回折、外侧要跑一大圈
    const ha = Math.atan2(g.hy, g.hx);
    let da = Math.atan2(ty - g.y, tx - g.x) - ha;
    if (da > Math.PI) da -= Math.PI * 2;
    else if (da < -Math.PI) da += Math.PI * 2;
    const radius = dd < g.width ? 1 : Math.max(M.turnR, g.width / 2);
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
    const moved = Math.hypot(nx - px, ny - py);
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
      g.rec -= M.trailStep;
    }
  }
}
