/**
 * 编队行军的行迹：探路点走过的路每隔 trailStep 记一个点，存在环形缓冲里（head 是最新的一点，离探路点 rec），
 * 每点带上两侧可用宽度的包络与这一处横截面的方向。队列各排沿行迹往后排，按「离探路点多远」（沿行迹量）取行迹上的点。
 *
 * 宽度包络：每点量到的宽度往前方窄处提前按 narrowIn 的坡度收、过了窄处按 narrowOut 的坡度放，收窄传到哪里，那一处窄处的方向也带到哪里。
 */
import { RULES } from '../content';
import { smooth } from '../ease';
import type { World } from '../world';
import type { March } from './march';
import { CHOKE, chokeAt, chokeClear } from './marchChoke';

/**
 * 行迹每个点占几个数：位置、朝向、左右可用宽度（包络后的）、窄处方向及其来历（0 没有、1 本处量到、2 从前后的窄处带来）、横截面方向，
 * 记这一点时探路点所在、判过走得通的格子（-1 没有：整队时铺的、收尾时虚拟直走的），以及这一点自己量到的左右宽度（改道时重做包络用）
 */
export const TRAIL = 14;
const T_L = 4, T_R = 5, T_AX = 6, T_AY = 7, T_HAS = 8, T_LX = 9, T_LY = 10, T_CELL = 11, T_RL = 12, T_RR = 13;
/** 行迹最多记多少点：拉长到最长时也要装得下整个队列 */
export const TRAIL_MAX = 2048;

/** 第 k 个行迹点（0 是最新的一点）在缓冲里的起始下标 */
function pt(g: March, k: number): number {
  return ((g.head + k) % g.cap) * TRAIL;
}

/** trailAt() 的结果：行迹上一点的位置、朝向、左右可用宽度、横截面方向（指向行进方向的右手边） */
export const TP = { x: 0, y: 0, hx: 0, hy: 0, L: 0, R: 0, lx: 0, ly: 0 };

/** 行迹上离探路点 b 远的那一点（b < 0 在探路点前方，沿它的朝向外推；比行迹还靠后的沿最老一点的朝向往后外推），结果放在 TP */
export function trailAt(g: March, b: number): void {
  const t = g.trail;
  if (b < g.rec) {
    const o = g.head * TRAIL;
    if (b <= 0) {
      TP.x = g.px - g.phx * b;
      TP.y = g.py - g.phy * b;
    } else {
      const f = b / g.rec;
      TP.x = g.px + (t[o] - g.px) * f;
      TP.y = g.py + (t[o + 1] - g.py) * f;
    }
    TP.hx = g.phx;
    TP.hy = g.phy;
    TP.L = t[o + T_L];
    TP.R = t[o + T_R];
    if (t[o + T_HAS]) {
      TP.lx = t[o + T_LX];
      TP.ly = t[o + T_LY];
    } else {
      TP.lx = -g.phy;
      TP.ly = g.phx;
    }
    return;
  }
  const step = RULES.march.trailStep;
  const s = b - g.rec, q = s / step, k = q | 0;
  if (k >= g.cap - 1) {
    const o = pt(g, g.cap - 1), over = s - (g.cap - 1) * step;
    TP.hx = t[o + 2];
    TP.hy = t[o + 3];
    TP.x = t[o] - TP.hx * over;
    TP.y = t[o + 1] - TP.hy * over;
    TP.L = t[o + T_L];
    TP.R = t[o + T_R];
    TP.lx = t[o + T_LX];
    TP.ly = t[o + T_LY];
    return;
  }
  const f = q - k;
  const o = pt(g, k), o2 = pt(g, k + 1);
  TP.x = t[o] + (t[o2] - t[o]) * f;
  TP.y = t[o + 1] + (t[o2 + 1] - t[o + 1]) * f;
  TP.hx = t[o + 2] + (t[o2 + 2] - t[o + 2]) * f;
  TP.hy = t[o + 3] + (t[o2 + 3] - t[o + 3]) * f;
  TP.L = t[o + T_L] + (t[o2 + T_L] - t[o + T_L]) * f;
  TP.R = t[o + T_R] + (t[o2 + T_R] - t[o + T_R]) * f;
  TP.lx = t[o + T_LX] + (t[o2 + T_LX] - t[o + T_LX]) * f;
  TP.ly = t[o + T_LY] + (t[o2 + T_LY] - t[o + T_LY]) * f;
}

/** 行迹上离探路点 b 远处的通道宽（左右可用宽度之和） */
export function widthAt(g: March, b: number): number {
  const t = g.trail;
  if (b < g.rec) {
    const o = g.head * TRAIL;
    return t[o + T_L] + t[o + T_R];
  }
  const q = (b - g.rec) / RULES.march.trailStep, k = q | 0;
  if (k >= g.cap - 1) {
    const o = pt(g, g.cap - 1);
    return t[o + T_L] + t[o + T_R];
  }
  const f = q - k;
  const o = pt(g, k), o2 = pt(g, k + 1);
  const w0 = t[o + T_L] + t[o + T_R];
  return w0 + (t[o2 + T_L] + t[o2 + T_R] - w0) * f;
}

/** 把整条行迹从 (x, y) 沿朝向 (hx, hy) 往后铺直，宽度都是没量到窄处时的宽度（整队时；(x, y) 是第 0 个点） */
export function layTrail(g: March, x: number, y: number, hx: number, hy: number): void {
  const st = RULES.march.trailStep, t = g.trail, open = g.open;
  for (let k = 0; k < g.cap; k++) {
    const o = k * TRAIL;
    t[o] = x - hx * st * k;
    t[o + 1] = y - hy * st * k;
    t[o + 2] = hx;
    t[o + 3] = hy;
    t[o + T_L] = t[o + T_R] = t[o + T_RL] = t[o + T_RR] = open;
    t[o + T_AX] = t[o + T_AY] = t[o + T_HAS] = 0;
    t[o + T_LX] = -hy;
    t[o + T_LY] = hx;
    t[o + T_CELL] = -1;
  }
}

/**
 * 在探路点前方记一个新行迹点 (x, y)，朝向取探路点此刻的朝向；cell 是探路点在这一点附近判过走得通的格子（-1 没有）。
 * measure 为真时量一次窄处，并入宽度包络；量到窄处就记下它离探路点多远（g.rec 要先扣好）
 */
export function addPoint(w: World, g: March, x: number, y: number, cell: number, measure: boolean): void {
  const t = g.trail;
  const prev = g.head * TRAIL;
  g.head = (g.head + g.cap - 1) % g.cap;
  const o = g.head * TRAIL;
  t[o] = x;
  t[o + 1] = y;
  t[o + 2] = g.phx;
  t[o + 3] = g.phy;
  t[o + T_CELL] = cell;
  if (measure) {
    let tx = x - t[prev], ty = y - t[prev + 1];
    const tl = Math.hypot(tx, ty);
    if (tl > 1e-3) {
      tx /= tl;
      ty /= tl;
    } else {
      tx = g.phx;
      ty = g.phy;
    }
    chokeAt(w, g, x, y, tx, ty);
  } else chokeClear(g);
  if (CHOKE.L + CHOKE.R < g.width * RULES.march.narrow) g.narrowB = g.rec;
  envelope(g, o, prev);
}

/** 行迹点 o 的横截面方向：开阔处是队列朝向的垂线，收到 axisFrom 倍半队宽以内开始转向窄处的方向，收到 axisFull 倍时完全跟着它 */
function crossAt(g: March, o: number): void {
  const t = g.trail, hlx = -t[o + 3], hly = t[o + 2];
  if (!t[o + T_HAS]) {
    t[o + T_LX] = hlx;
    t[o + T_LY] = hly;
    return;
  }
  const M = RULES.march;
  const k = smooth((M.axisFrom - (t[o + T_L] + t[o + T_R]) / g.width) / (M.axisFrom - M.axisFull));
  // 与队列朝向的垂线取同一侧，免得过渡时翻面
  const ax = t[o + T_AX], ay = t[o + T_AY], sg = ax * hlx + ay * hly >= 0 ? 1 : -1;
  const x = hlx + (ax * sg - hlx) * k, y = hly + (ay * sg - hly) * k;
  const l = Math.hypot(x, y) || 1;
  t[o + T_LX] = x / l;
  t[o + T_LY] = y / l;
}

/** 行迹点 o 的左右宽度不超过相邻点 src 的宽度加 slope；压低了的话，o 没有窄处方向时带上 src 的。返回压低了没有 */
function pull(t: Float64Array, o: number, src: number, slope: number): boolean {
  let hit = false;
  if (t[src + T_L] + slope < t[o + T_L]) {
    t[o + T_L] = t[src + T_L] + slope;
    hit = true;
  }
  if (t[src + T_R] + slope < t[o + T_R]) {
    t[o + T_R] = t[src + T_R] + slope;
    hit = true;
  }
  if (hit && t[src + T_HAS] && !t[o + T_HAS]) {
    t[o + T_AX] = t[src + T_AX];
    t[o + T_AY] = t[src + T_AY];
    t[o + T_HAS] = 2;
  }
  return hit;
}

/**
 * 把刚记下的行迹点 o（CHOKE 是它量到的宽度）并进宽度包络：新点先受身后一点（prev）按放开坡度的限制，
 * 再把它的收窄往回传，直到不再变小
 */
function envelope(g: March, o: number, prev: number): void {
  const M = RULES.march, t = g.trail, st = M.trailStep;
  t[o + T_RL] = t[o + T_L] = CHOKE.L;
  t[o + T_RR] = t[o + T_R] = CHOKE.R;
  t[o + T_HAS] = CHOKE.has;
  if (CHOKE.has) {
    t[o + T_AX] = CHOKE.ax;
    t[o + T_AY] = CHOKE.ay;
  }
  pull(t, o, prev, M.narrowOut * st);
  crossAt(g, o);
  const si = M.narrowIn * st;
  for (let n = 1, j = o; n < g.cap; n++) {
    const k = pt(g, n);
    if (!pull(t, k, j, si)) break;
    crossAt(g, k);
    j = k;
  }
}

/**
 * 改道时砍掉最前排前方的行迹：探路点回到最前排的位置与朝向，作废的那些点挪到环形缓冲的最老一端、沿最老一点的朝向往后铺直；
 * 留下的点按各自量到的宽度从头做一遍包络（先把收窄往身后传，再按放开坡度往前限），窄处方向照样跟着带
 */
export function cutAhead(g: March): void {
  const M = RULES.march, st = M.trailStep, t = g.trail, cap = g.cap;
  const k0 = g.lead <= g.rec ? 0 : Math.min(cap - 1, Math.ceil((g.lead - g.rec) / st - 1e-9));
  const oldTail = pt(g, cap - 1);
  const tx = t[oldTail], ty = t[oldTail + 1], thx = t[oldTail + 2], thy = t[oldTail + 3];
  // 作废的点（新 head 之前的 k0 个）成了最老的一端：接着原来最老的一点往后铺
  for (let j = 0; j < k0; j++) {
    const o = pt(g, j), back = (j + 1) * st;
    t[o] = tx - thx * back;
    t[o + 1] = ty - thy * back;
    t[o + 2] = thx;
    t[o + 3] = thy;
    t[o + T_RL] = t[o + T_RR] = g.open;
    t[o + T_HAS] = 0;
    t[o + T_CELL] = -1;
  }
  g.rec = g.rec + k0 * st - g.lead;
  g.head = (g.head + k0) % cap;
  const hl = Math.hypot(g.hx, g.hy) || 1;
  Object.assign(g, { px: g.x, py: g.y, phx: g.hx / hl, phy: g.hy / hl, lead: 0, pDone: false, pBlk: false, blocked: false, endB: Infinity, narrowB: Infinity });
  // 恢复各点量到的宽度，只留本处量到的窄处方向
  for (let k = 0; k < cap; k++) {
    const o = pt(g, k);
    t[o + T_L] = t[o + T_RL];
    t[o + T_R] = t[o + T_RR];
    if (t[o + T_HAS] !== 1) t[o + T_HAS] = 0;
    if (g.narrowB === Infinity && t[o + T_RL] + t[o + T_RR] < g.width * M.narrow) g.narrowB = g.rec + k * st;
  }
  const si = M.narrowIn * st, so = M.narrowOut * st;
  for (let n = 1; n < cap; n++) pull(t, pt(g, n), pt(g, n - 1), si);
  for (let k = cap - 2; k >= 0; k--) pull(t, pt(g, k), pt(g, k + 1), so);
  for (let k = 0; k < cap; k++) crossAt(g, pt(g, k));
}

/** 行迹上离最前排最近的那一点记下的、探路点走过的格子；没有就是 fallback */
export function nearCell(g: March, fallback: number): number {
  if (g.lead < g.rec) return fallback;
  let k = Math.round((g.lead - g.rec) / RULES.march.trailStep);
  if (k > g.cap - 1) k = g.cap - 1;
  const c = g.trail[pt(g, k) + T_CELL];
  return c >= 0 ? c : fallback;
}

/** 最前排前方紧挨着的那个行迹点记下的格子现在走不通了：探好的路之后被堵了 */
export function routeCut(w: World, g: March): boolean {
  if (g.lead < g.rec) return false;
  const k = ((g.lead - g.rec) / RULES.march.trailStep) | 0;
  if (k >= g.cap) return false;
  const c = g.trail[pt(g, k) + T_CELL];
  return c >= 0 && (w.nav.block[g.team][c] !== 0 || w.nav.deck[g.team][c] !== 0);
}
