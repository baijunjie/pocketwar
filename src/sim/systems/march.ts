/**
 * 编队行军（弹性队列）：一道移动命令里的部队共用一个看不见的「探路点」。探路点照单个单位的最短路线往前走，把走过的路记成行迹；
 * 队列最前排沿行迹跟在探路点身后一段路程，按全队最慢者的速度前进，各排再沿行迹一排接一排往后排，所以拐弯时队伍像蛇一样跟着拐。
 * 本文件管编队的建立与重新整队、行军途中改道、探路点怎么走，以及每帧最前排走多快、走到哪。
 *
 * 探路点走的就是单个单位的最短路线，不因为队伍宽而另选一条离障碍远些的路：给障碍附近加价，加得轻路线几乎不变，
 * 加得重路线就弯，整个方阵要跟着转身，不如照直走、让队列在窄处收拢；途经的营寨、城池也不绕开。
 */
import { DT, RULES, TERRAIN_SPEED, TILE } from '../content';
import { smooth } from '../ease';
import { DIRX, DIRY, DIR_HERE, Field } from '../nav';
import { NONE, S_COMBAT, S_ROUT } from '../state';
import type { World } from '../world';
import type { Formation } from './formation';
import { SLOT, marchSlot, rowsAt, standable } from './marchSlots';
import { TP, TRAIL, TRAIL_MAX, addPoint, cutAhead, layTrail, nearCell, routeCut, trailAt } from './marchTrail';

export interface March {
  id: number;
  alive: boolean;
  team: number;
  /** 队列最前排的位置与朝向（单位向量）：行迹上落后探路点 lead 的那一点 */
  x: number;
  y: number;
  hx: number;
  hy: number;
  /** 探路点的位置与朝向（朝向即队列横排的方向，脚下可以斜着走） */
  px: number;
  py: number;
  phx: number;
  phy: number;
  /** 探路点已到终点 */
  pDone: boolean;
  /** 探路点被敌方 / 中立建筑挡住、停在它跟前 */
  pBlk: boolean;
  /** 最前排沿行迹落后探路点多远；探路点该领先多远（够最前排在窄处前提前收窄） */
  lead: number;
  ahead: number;
  destX: number;
  destY: number;
  destCell: number;
  field: Field | null;
  /** 全队最慢者的行军速度、奔跑速度 */
  speed: number;
  run: number;
  /** 攻击移动：有人接敌后最前排停下，打完再走 */
  amove: boolean;
  /** 正在交手、处于战斗状态的成员比例 */
  fight: number;
  alert: number;
  cFight: number;
  cAlert: number;
  /** 最前排当前的速度（等人时为 0） */
  v: number;
  /** 到位后的朝向 */
  fx: number;
  fy: number;
  arrived: boolean;
  /** 最前排走到了被敌方 / 中立建筑挡住的探路点跟前：成员各自上前攻打，打通后再整队前进 */
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
  /** 行迹：探路点走过的点（布局见 marchTrail.ts 的 TRAIL），环形缓冲，head 是最新的一个，间隔 trailStep */
  trail: Float64Array;
  cap: number;
  head: number;
  /** 最新一个行迹点到探路点的路程 */
  rec: number;
  /** 队列的横宽与纵深（不折排时） */
  width: number;
  depth: number;
  /** 没量到窄处时行迹上记的单侧可用宽度：半个队宽再加成员的最大半径（各排扣掉自己的半径后仍不小于半个队宽） */
  open: number;
  /** 行迹上最靠前的一处窄处离探路点多远（沿行迹量；没有为 Infinity） */
  narrowB: number;
  /**
   * 收尾：路线上有过窄处时，最前排到终点后队伍不立刻解散，探路点沿最后的朝向虚拟直走，队列接着往前带，
   * 成员按 marchRelease 离队。endB 是终点离探路点多远（沿行迹），tailT 是收尾了多久
   */
  tail: boolean;
  endB: number;
  tailT: number;
  /** 几排；各排的队列偏移（同 offA）、总宽、排深、平均间距、最大半径（离障碍各扣这么多）、奔跑速度（本排最慢的成员） */
  rows: number;
  rowA: Float32Array;
  rowW: Float64Array;
  rowD: Float64Array;
  rowSp: Float64Array;
  rowRad: Float64Array;
  rowRun: Float64Array;
  /** 各排此刻（rowsAt 的结果）：中心离探路点多远、占行迹多长、比不折时多往后挪了多少；最前排每走 1 这一排走多远 */
  rowB: Float64Array;
  rowLen: Float64Array;
  rowE: Float64Array;
  rowK: Float64Array;
}

/** 探路点一次最多走多远，再远就分几步走（每步各自转向、判格子） */
const PROBE_SUB = 2;
/** 探路点落后于该领先的路程时（被挡过、路线刚算好），每帧除了跟着最前排走，最多再追这么多 */
const PROBE_CATCH = TILE;
/** 探路点在「最前排从整队宽收窄到零要提前的路程」之外再多领先这么多 */
const PROBE_PAD = 48;
/** 最前排到终点时，最靠前的窄处还在最后一排后沿往后这么多个行迹间距以内，就算还有排没过完窄处，队伍进入收尾 */
const TAIL_SLACK = 2;

/** rowsAt 的临时结果（量各排速度用） */
let TB = new Float64Array(64), TL = new Float64Array(64), TE = new Float64Array(64);

/**
 * @param x, y 队伍的重心：队列先围着它排好，最前排站到队列最前面
 * @param f 队列（formation() 的结果）
 */
export function createMarch(w: World, team: number, x: number, y: number, destX: number, destY: number, destCell: number,
  speed: number, run: number, amove: boolean, fx: number, fy: number, n: number, f: Formation): March {
  const M = RULES.march;
  // 成员走光的编队对象原样拿来重用：按编队对象统计某支队伍的人，要在它到达之前截止，或改按成员单位去认
  let g = w.marches.find(m => !m.alive);
  if (!g) {
    const e = new Float64Array(0);
    g = { id: w.marches.length, trail: e, rowA: new Float32Array(0), rowW: e, rowD: e, rowSp: e, rowRad: e, rowRun: e, rowB: e, rowLen: e, rowE: e, rowK: e } as March;
    w.marches.push(g);
  }
  const width = f.width, depth = f.depth, rows = f.rowW.length;
  const ahead = width / 2 / M.narrowIn + PROBE_PAD;
  // 行迹要装得下拉长到 stretchMax 倍的队列与探路点领先的路程
  const stretched = depth * M.stretchMax;
  const cap = Math.min(TRAIL_MAX, Math.ceil((stretched + ahead) / M.trailStep) + 8);
  if (g.trail.length < cap * TRAIL) g.trail = new Float64Array(cap * TRAIL);
  if (g.rowA.length < rows) {
    g.rowA = new Float32Array(rows);
    g.rowW = new Float64Array(rows);
    g.rowD = new Float64Array(rows);
    g.rowSp = new Float64Array(rows);
    g.rowRad = new Float64Array(rows);
    g.rowRun = new Float64Array(rows);
    g.rowB = new Float64Array(rows);
    g.rowLen = new Float64Array(rows);
    g.rowE = new Float64Array(rows);
    g.rowK = new Float64Array(rows);
  }
  if (TB.length < rows) {
    TB = new Float64Array(rows);
    TL = new Float64Array(rows);
    TE = new Float64Array(rows);
  }
  // 与成员的 offA 同样算（存进 Float32 之前先各自舍入）：开阔地上各排的位置与按成员队列偏移排的横队逐位相同
  const front = Math.fround(f.rowFa[0]);
  let big = 0;
  for (let r = 0; r < rows; r++) {
    g.rowA[r] = Math.fround(f.rowFa[r]) - front;
    g.rowW[r] = f.rowW[r];
    g.rowD[r] = f.rowD[r];
    g.rowSp[r] = f.rowW[r] / f.rowN[r];
    g.rowRad[r] = f.rowRad[r];
    g.rowRun[r] = f.rowRun[r];
    if (f.rowRad[r] > big) big = f.rowRad[r];
  }
  Object.assign(g, {
    alive: true, team, destX, destY, destCell,
    speed, run, amove, fight: 0, alert: 0, cFight: 0, cAlert: 0, cFoe: 0, fx, fy, arrived: false, blocked: false, loose: false, battleT: 0, n,
    cnt: 0, lagSum: 0, lagApart: 0, over: 0, sx: 0, sy: 0, cap, width, depth, open: width / 2 + big, ahead, rows, tail: false, tailT: 0,
  });
  anchor(w, g, x, y, false);
  return g;
}

/**
 * 重新整队（下令时，以及打完仗、路被堵时）：把行迹从最前排沿去目的地的方向往后铺直，探路点从最前排出发先一次走出领先的路程。
 * @param x, y 队伍的重心（front 为 false，队列围着它排好、最前排站到队列最前面），或最前排的位置（front 为 true）
 */
function anchor(w: World, g: March, x: number, y: number, front: boolean): void {
  const M = RULES.march, team = g.team;
  // 最前排不能出生在水里或墙里
  const c0 = w.cellAt(x, y);
  if (w.nav.block[team][c0] || w.nav.deck[team][c0]) {
    const c = w.nav.nearestFree(team, c0, 20);
    x = (c % w.map.w + 0.5) * TILE;
    y = (((c / w.map.w) | 0) + 0.5) * TILE;
  }
  const dx = g.destX - x, dy = g.destY - y, dl = Math.hypot(dx, dy) || 1;
  const hx = dx / dl, hy = dy / dl;
  if (!front) {
    // 最前排站到队列最前面（走得通的话）：队列正好围着重心
    const fwd = Math.min(g.depth / 2, dl - 1);
    const lx = x + hx * fwd, ly = y + hy * fwd;
    if (fwd > 0 && !w.nav.block[team][w.cellAt(lx, ly)] && !w.lineBlocked(x, y, lx, ly, team)) {
      x = lx;
      y = ly;
    }
  }
  layTrail(g, x, y, hx, hy);
  Object.assign(g, {
    x, y, hx, hy, px: x, py: y, phx: hx, phy: hy, head: 0, rec: 0, v: 0, lag: M.lagStop,
    lead: 0, pDone: false, pBlk: false, narrowB: Infinity, endB: Infinity, tail: false, tailT: 0,
    field: w.lineBlocked(x, y, g.destX, g.destY, team) ? w.nav.getField(team, g.destCell, w.tickCount) : null,
  });
  probeMove(w, g, g.ahead, g.speed);
  placeFront(g);
  rowsAt(g, g.lead, g.rowB, g.rowLen, g.rowE);
  g.rowK.fill(1);
}

/**
 * 行军途中改道（同一批人又收到去别处的命令）：不重新整队，沿用现有的队列与行迹，最前排直接拐向新目的地。
 * 新路线的起始方向（从最前排出发朝新目的地的第一个瞄准方向）与最前排朝向夹角的余弦低于 rerouteCos 时（要掉头）不沿用，返回 false、什么都不改。
 * 沿用时：最前排前方探路点已探出去的那段行迹作废，探路点回到最前排，按新路线重新探出领先的路程；
 * 留下的行迹点按各自量到的宽度重做包络，撤掉作废那段的窄处往回传的收窄，身后的窄处照旧起作用
 */
export function rerouteMarch(w: World, g: March, destX: number, destY: number, destCell: number, amove: boolean, fx: number, fy: number): boolean {
  const M = RULES.march, team = g.team;
  const field = w.lineBlocked(g.x, g.y, destX, destY, team) ? w.nav.getField(team, destCell, w.tickCount) : null;
  // 新路线还没算好就当场算完：不看路线、只按直线判断，会把要绕回头的路线也当成不用掉头
  if (field?.pending) w.nav.finish(field);
  const ox = g.destX, oy = g.destY, oc = g.destCell;
  g.destX = destX;
  g.destY = destY;
  g.destCell = destCell;
  let ax = destX - g.x, ay = destY - g.y;
  if (field && lookAhead(w, g, field, w.cellAt(g.x, g.y), g.x, g.y)) {
    ax = AIM.x - g.x;
    ay = AIM.y - g.y;
  }
  const al = Math.hypot(ax, ay), hl = Math.hypot(g.hx, g.hy);
  if (al > 1e-6 && (ax * g.hx + ay * g.hy) / (al * (hl || 1)) < M.rerouteCos) {
    g.destX = ox;
    g.destY = oy;
    g.destCell = oc;
    return false;
  }
  Object.assign(g, { field, amove, fx, fy });
  cutAhead(g);
  probeMove(w, g, g.ahead, g.speed);
  placeFront(g);
  rowsAt(g, g.lead, g.rowB, g.rowLen, g.rowE);
  return true;
}

/** 最前排的位置与朝向：行迹上落后探路点 lead 的那一点 */
function placeFront(g: March): void {
  trailAt(g, g.lead);
  g.x = TP.x;
  g.y = TP.y;
  g.hx = TP.hx;
  g.hy = TP.hy;
}

const AIM = { x: 0, y: 0 };

/**
 * 沿流场从探路点脚下往前数格子，取直线走得通的最远一格（不超过 look 的距离），结果放在 AIM。
 * 流场只有八个方向，直接照着走是一段段折线；横队跟着折线拐，每拐一下都要整队转一次身。
 */
function lookAhead(w: World, g: March, f: Field, cell: number, x = g.px, y = g.py): boolean {
  const M = RULES.march, mw = w.map.w;
  const look = Math.max(M.lookMin, g.width * M.lookK);
  const max = Math.ceil(look / TILE) * 2 + 2;
  let c = cell, ok = false;
  for (let k = 0; k < max; k++) {
    const dir = f.dirs[c];
    if (dir > 7) {
      if (dir === DIR_HERE && !w.lineBlocked(x, y, g.destX, g.destY, g.team)) {
        AIM.x = g.destX;
        AIM.y = g.destY;
        ok = true;
      }
      break;
    }
    c += DIRX[dir] + DIRY[dir] * mw;
    const px = (c % mw + 0.5) * TILE, py = (((c / mw) | 0) + 0.5) * TILE;
    if ((px - x) ** 2 + (py - y) ** 2 > look * look) break;
    if (w.lineBlocked(x, y, px, py, g.team)) break;
    AIM.x = px;
    AIM.y = py;
    ok = true;
  }
  return ok;
}

/**
 * 探路点沿路线往前走 dist（分成不超过 PROBE_SUB 的几步），边走边记行迹：
 * 沿路线往前看一段，取看得见的最远一点（八方向流场的折线拉直）；朝向（队列横排的方向）按队宽限制转向，
 * 转弯半径不小于半个队宽，脚下可以斜着走一点（最多 slide），横队斜着侧移跟上路线。路线还没算好、或被别人的建筑挡住就停下。
 * @param vref 这段路按什么速度走：朝向每秒最多转 turn 弧度，换算成每走 1 转多少
 */
function probeMove(w: World, g: March, dist: number, vref: number): void {
  const M = RULES.march, mw = w.map.w, tick = w.tickCount;
  const blk = w.nav.block[g.team];
  const turnK = M.turn / (vref > 1 ? vref : 1);
  while (dist > 1e-9) {
    const step = dist > PROBE_SUB ? PROBE_SUB : dist;
    dist -= step;
    const cell = ((g.py / TILE) | 0) * mw + ((g.px / TILE) | 0);
    const ddx = g.destX - g.px, ddy = g.destY - g.py;
    const dd = Math.sqrt(ddx * ddx + ddy * ddy);
    if (dd <= step + 1) {
      advance(w, g, g.destX, g.destY, true);
      g.pDone = true;
      g.pBlk = false;
      g.endB = 0;
      return;
    }
    // 往哪儿走：沿路线往前看一段，取看得见的最远一点；离终点近了就直奔终点
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
          tx = g.px + fdx * TILE;
          ty = g.py + fdy * TILE;
        }
      } else if (dir !== DIR_HERE && f.pending) return; // 路线还没算出来：等一等
    }
    // 朝向按队宽限制转向：转弯半径不小于半个队宽，否则内侧的位置会往回折、外侧要跑一大圈
    const ha = Math.atan2(g.phy, g.phx);
    let da = Math.atan2(ty - g.py, tx - g.px) - ha;
    if (da > Math.PI) da -= Math.PI * 2;
    else if (da < -Math.PI) da += Math.PI * 2;
    const radius = dd < g.width ? 1 : Math.max(M.turnR, g.width / 2);
    let turn = step / radius;
    if (turn > step * turnK) turn = step * turnK;
    const na = ha + (da > turn ? turn : da < -turn ? -turn : da);
    g.phx = Math.cos(na);
    g.phy = Math.sin(na);
    // 脚下的方向：朝向转得慢，探路点可以斜着走一点，横队整体侧移着跟上路线
    let ma = na;
    const rest = da - (na - ha);
    if (rest > M.slide) ma += M.slide;
    else if (rest < -M.slide) ma -= M.slide;
    else ma += rest;
    let nx = g.px + Math.cos(ma) * step, ny = g.py + Math.sin(ma) * step;
    let nc = ((ny / TILE) | 0) * mw + ((nx / TILE) | 0);
    if (nc !== cell && (blk[nc] || !w.nav.canStep(g.team, cell, nc)) && (fdx || fdy)) {
      // 抄近路撞上了障碍：老老实实沿流场走
      nx = g.px + fdx * step;
      ny = g.py + fdy * step;
      nc = ((ny / TILE) | 0) * mw + ((nx / TILE) | 0);
    }
    if (nc !== cell && (blk[nc] || !w.nav.canStep(g.team, cell, nc))) {
      // 直线走不通：改用寻路；寻路路线上是别人的建筑（城门、木栅）就停下，等成员去打
      if (!g.field) g.field = w.nav.getField(g.team, g.destCell, tick);
      else if (w.nav.bld[nc] >= 0) g.pBlk = true;
      return;
    }
    g.pBlk = false;
    advance(w, g, nx, ny, true);
  }
}

/** 探路点到终点后（收尾时）沿最后的朝向虚拟直走：不判格子、不量窄处，只把队列接着往前带 */
function coast(w: World, g: March, dist: number): void {
  advance(w, g, g.px + g.phx * dist, g.py + g.phy * dist, false);
}

/** 探路点挪到 (nx, ny)：最前排相对落后得更多，走过的这一小段上每隔 trailStep 记一个行迹点；measure 为真时每点量一次窄处 */
function advance(w: World, g: March, nx: number, ny: number, measure: boolean): void {
  const st = RULES.march.trailStep;
  const ox = g.px, oy = g.py;
  const moved = Math.hypot(nx - ox, ny - oy);
  g.px = nx;
  g.py = ny;
  if (moved <= 0) return;
  g.lead += moved;
  g.narrowB += moved;
  g.endB += moved;
  g.rec += moved;
  while (g.rec >= st) {
    // 在走过的这一小段上、离上一个行迹点正好一个间隔的地方记一点
    const back = (g.rec - st) / moved;
    const x = nx - (nx - ox) * back, y = ny - (ny - oy) * back;
    // 记下离这一点近的那一头探路点所在的格子（探路点照这个算法判过它走得通），之后用来看路有没有被堵；
    // 不拿这一点自己的坐标重新算格子：贴着格线时插值出来的点可能落在隔壁的格子里
    const ex = back < 0.5 ? nx : ox, ey = back < 0.5 ? ny : oy;
    g.rec -= st;
    addPoint(w, g, x, y, measure ? ((ey / TILE) | 0) * w.map.w + ((ex / TILE) | 0) : -1, measure);
  }
}

/**
 * 最前排的速度上限（还没乘地形、天气、等人的系数）：平时是全队最慢者的行军速度，大半人进入战斗状态后是奔跑速度。
 * 前面的排一展开，后面窄处的排就得走得更快才跟得上：量出最前排每走 1 各排要走多远（写进 rowK），
 * 让每一排都不超过本排奔跑速度的 trot 倍；有排被折起来时全队小跑着过，按被折起来的排里最慢的那排小跑
 */
function paceTop(g: March): number {
  const M = RULES.march;
  rowsAt(g, g.lead - 1, TB, TL, TE);
  let fold = 1, foldRun = Infinity;
  for (let r = 0; r < g.rows; r++) {
    g.rowK[r] = 1 + g.rowE[r] - TE[r];
    const fr = g.rowLen[r] / g.rowD[r];
    if (fr > 1 && g.rowRun[r] < foldRun) foldRun = g.rowRun[r];
    if (fr > fold) fold = fr;
  }
  let top = g.alert > 0.5 ? g.run : g.speed;
  if (fold > 1 && foldRun * M.trot > top) top += (foldRun * M.trot - top) * smooth(fold - 1);
  for (let r = 0; r < g.rows; r++) {
    const kr = g.rowK[r];
    if (kr <= 1) continue;
    const rt = g.rowRun[r] * M.trot, lim = (rt > g.speed ? rt : g.speed) / kr;
    if (lim < top) top = lim;
  }
  return top;
}

/** 最前排到终点时要不要收尾：最靠前的窄处还在最后一排后沿附近或更靠后，也就是还有排没过完窄处 */
function needTail(g: March): boolean {
  const last = g.rows - 1;
  return g.narrowB < g.rowB[last] + g.rowLen[last] / 2 + RULES.march.trailStep * TAIL_SLACK;
}

/**
 * 最前排脚下的地形速度系数，总是正的：最前排是行迹上插值出来的点，贴着桥边、岸边时可能落进走不通的格子，
 * 收尾时更是沿直线虚拟前进、可能走进水里墙里。取不到正值时，收尾中按终点格算，平时按身边行迹点上探路点走过的格子算，
 * 仍取不到就按 1：为 0 的话最前排停住，探路点也跟着不再推进，队伍就一直停在那里
 */
function frontTerrain(w: World, g: March): number {
  const mw = w.map.w, mh = w.map.h, terr = w.map.terrain;
  const cxi = (g.x / TILE) | 0, cyi = (g.y / TILE) | 0;
  const cell = (cyi < 0 ? 0 : cyi >= mh ? mh - 1 : cyi) * mw + (cxi < 0 ? 0 : cxi >= mw ? mw - 1 : cxi);
  let v = TERRAIN_SPEED[terr[cell]];
  if (v > 0) return v;
  if (g.tail) v = TERRAIN_SPEED[terr[g.destCell]];
  else {
    const near = nearCell(g, -1);
    v = near >= 0 ? TERRAIN_SPEED[terr[near]] : 0;
  }
  return v > 0 ? v : 1;
}

/** 统计各队人数与掉队情况（每 8 帧一次），定下队伍在不在打、要不要散开或重新整队 */
function tally(w: World): void {
  const ms = w.marches, M = RULES.march;
  for (const g of ms) g.cnt = g.lagSum = g.lagApart = g.over = g.cFight = g.cAlert = g.cFoe = g.sx = g.sy = 0;
  const grp = w.grp;
  for (let i = 0; i < w.n; i++) {
    const gi = grp[i];
    if (gi < 0 || !w.alive[i]) continue;
    const g = ms[gi];
    if (!g.alive || (g.arrived && !g.tail) || w.state[i] & S_ROUT) {
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
    marchSlot(g, w.marchRow[i], w.marchCol[i], w.offL[i]);
    // 位置站不了人，或与本排中线点之间被隔开：队列的这一处压在障碍上
    if (!standable(w, g.team, SLOT.x, SLOT.y) || w.lineBlocked(SLOT.cx, SLOT.cy, SLOT.x, SLOT.y, g.team)) g.over++;
    const ox = SLOT.x - w.x[i], oy = SLOT.y - w.y[i];
    // 位置在自己身后的人不算掉队：平时他们原地等位置走过来，队伍在打时沿路线往前走，都不需要最前排等
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
      // 队列压在障碍上时，够不着位置的人正各自绕路，最前排不等他们：停下来等的话，后几排的位置也跟着停在障碍这一侧，
      // 全队就成了一排一排地等、一排一排地过。整个队列走出障碍之后再把他们算进来，最前排放慢等他们归队
      const draped = g.over > Math.max(1, g.cnt * M.overMin);
      g.lag = (g.lagSum + (draped ? 0 : g.lagApart)) / g.cnt;
      g.fight = g.cFight / g.cnt;
      g.alert = g.cAlert / g.cnt;
      // 打起来了就散开各自为战；打完以大家现在的重心重新整队，不走回头路
      const loose = (g.amove && g.fight > M.holdFight) || g.alert > 0.5;
      // 统计每 8 帧一次，保持时间按 8 帧扣；零星一个敌兵冒出来又没了，队伍不至于刚散开往前走又马上回去等位置
      if (g.cFoe > 0) g.battleT = RULES.combat.linger;
      else if (g.battleT > 0) g.battleT -= DT * 8;
      if (g.loose && !loose && !g.arrived) anchor(w, g, g.sx / g.cnt, g.sy / g.cnt, false);
      g.loose = loose;
    }
  }
}

export function updateMarches(w: World): void {
  const ms = w.marches;
  if (!ms.length) return;
  const M = RULES.march;
  if ((w.tickCount & 7) === 0) tally(w);
  // 与 units.ts 里成员的速度用同一个天气系数
  const rain = w.env.raining ? RULES.env.rainSpeed : w.env.snowing ? RULES.env.snowSpeed : 1;
  // 最前排也吃顺风 / 顶风，否则成员和队列位置对不上
  const windK = w.env.wind * RULES.env.windSpeed, windX = Math.cos(w.env.windDir), windY = Math.sin(w.env.windDir);
  for (const g of ms) {
    if (!g.alive || (g.arrived && !g.tail)) continue;
    if (g.tail && (g.tailT += DT) > M.tailMax) {
      // 收尾太久（有人一直卡着）：解散，剩下的人各自去落点
      g.tail = false;
      continue;
    }
    // 收尾时只是把后面的排带过窄处，不再为掉队的人停下
    const k = (M.lagStop - g.lag) / (M.lagStop - M.lagFull);
    const mult = g.tail ? 1 : g.amove && g.fight > M.holdFight ? 0 : k < 0 ? 0 : k > 1 ? 1 : k;
    const sp = paceTop(g) * frontTerrain(w, g) * rain * mult;
    g.v = sp;
    if (sp <= 0) continue;
    const step = sp * DT;
    if (g.pDone && !g.tail && g.lead <= step + 1) {
      g.arrived = true;
      if (needTail(g)) {
        // 后面还有排没过窄处：队伍不解散，接着往前带，成员各自看情况离队
        g.tail = true;
        g.tailT = 0;
      } else {
        g.x = g.destX;
        g.y = g.destY;
        g.v = 0;
        continue;
      }
    }
    const wf = windK > 0 ? 1 + windK * (g.hx * windX + g.hy * windY) : 1;
    const full = step * wf;
    // 最前排沿行迹走，走到探路点跟前为止
    const df = full > g.lead ? g.lead : full;
    g.lead -= df;
    if (df < full) g.v = df / (DT * wf);
    // 最前排走多远，探路点就再走多远；落后于该领先的路程（被挡过、路线刚算好）就多追一点
    const want = g.ahead - g.lead;
    if (want > 1e-6) {
      const adv = want < df + PROBE_CATCH ? want : df + PROBE_CATCH;
      if (g.tail) coast(w, g, adv);
      else if (!g.pDone) probeMove(w, g, adv, sp * wf);
    }
    if (!g.tail) g.blocked = g.pBlk && g.lead < 1;
    placeFront(g);
    // 探好的路之后被堵了（建起了建筑、城门易主）：从最前排现在的位置重新整队
    if (!g.tail && df > 0 && routeCut(w, g)) anchor(w, g, g.x, g.y, true);
    rowsAt(g, g.lead, g.rowB, g.rowLen, g.rowE);
  }
}
