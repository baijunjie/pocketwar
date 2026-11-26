/**
 * 编队行军的各排与成员：各排此刻排在行迹的哪一段（一排人比那里的通道宽就折成几小排、占的路程拉长），
 * 每名成员的队列位置，以及成员这一帧跟着哪一点走、收尾时该不该离队。
 */
import { RULES } from '../content';
import { smooth } from '../ease';
import type { World } from '../world';
import type { March } from './march';
import { TP, trailAt, widthAt } from './marchTrail';

/** 求一排占多长路程时每一小段的长度 */
const ROW_STEP = 4;

/**
 * 第 r 排从前沿 edge（离探路点多远）往后占行迹多长：每一小段按「本排可用宽度 ÷ 排宽」（不超过 1，不低于 1 / stretchMax）
 * 折算成排深，累到一个排深为止。通道够宽处一小段就算一小段，所以开阔地上正好是一个排深；
 * 通道窄到排宽的几分之一就拉长到几倍，最多 stretchMax 倍。长折排跨过宽窄变化的地方时长度连续变化，不会跳
 */
function rowLength(g: March, r: number, edge: number): number {
  const d = g.rowD[r], rw = g.rowW[r], pad = g.rowRad[r] * 2;
  const lo = 1 / RULES.march.stretchMax;
  let acc = 0, len = 0, squeezed = false;
  for (;;) {
    const q = (d - acc) * (squeezed ? 1 / lo : 1);
    if (q < 1e-6) return len;
    const step = q < ROW_STEP ? q : ROW_STEP;
    let f = (widthAt(g, edge + len + step / 2) - pad) / rw;
    if (f >= 1) f = 1;
    else {
      squeezed = true;
      if (f < lo) f = lo;
    }
    if (acc + f * step >= d) {
      // 一路都够宽：正好一个排深（不累加浮点误差，开阔地上与不折时的队列逐位相同）
      return squeezed ? len + (d - acc) / f : d;
    }
    acc += f * step;
    len += step;
  }
}

/**
 * 最前排离探路点 b 远时，各排排在行迹的哪一段：从最前排往后一排接一排，各排占的路程由 rowLength 求出。
 * 结果写进 rb（排中心离探路点多远）、rl（占多长）、re（比不折时多往后挪了多少）
 */
export function rowsAt(g: March, b: number, rb: Float64Array, rl: Float64Array, re: Float64Array): void {
  let extra = 0;
  for (let r = 0; r < g.rows; r++) {
    const d = g.rowD[r];
    // 不折时这一排的中心
    const c = b - g.rowA[r] + extra;
    const len = rowLength(g, r, c - d / 2);
    const e = extra + (len - d) / 2;
    rb[r] = b - g.rowA[r] + e;
    rl[r] = len;
    re[r] = e;
    extra += len - d;
  }
}

/**
 * marchSlot() 的结果：队列位置与那里的前进方向，本排中线上的那一点（同一小排、横向偏移为 0 处），
 * 位置离探路点多远（沿行迹）、相对中线的本地横向偏移与本地半宽（折排、收窄后的），以及本排此刻的速度
 */
export const SLOT = { x: 0, y: 0, hx: 0, hy: 0, cx: 0, cy: 0, b: 0, l: 0, half: 1, v: 0 };

/**
 * 第 r 排、排内第 c 个、横向偏移 l（正为朝向的右手边）的成员此刻的队列位置，结果放在 SLOT。
 * 先由 rowsAt 定下本排在行迹上的那一段，再把人摆进去：一排折成几小排时，压到一半宽时隔一个人退后半排、再并到前一个人身后，
 * 压到四分之一宽时再折一次……每折一次先前后错开、后横向并拢，中途两人不相撞。横向按那一处的通道宽等比收拢，
 * 这一排比通道窄时照旧以行迹为中线，只在贴着一侧障碍时往里让；横截面跟着窄处的方向转，不跟队列的朝向斜。
 * 开阔地上就是本排在行迹上的那一点再横移 l。
 */
export function marchSlot(g: March, r: number, c: number, l: number): void {
  const rw = g.rowW[r], sp = g.rowSp[r], len = g.rowLen[r];
  const m = len / g.rowD[r], E = RULES.march.foldEase;
  let ph = 0, dc = 0;
  for (let k = 0, p2 = 1; k < 7 && p2 < m; k++, p2 *= 2) {
    const bit = (c >> k) & 1;
    ph += (bit - 0.5) * smooth((m / p2 - 1) / E) / (2 * p2);
    dc += (0.5 - bit) * p2 * smooth((m / p2 - 1 - E) / E);
  }
  const b = g.rowB[r] + ph * len;
  trailAt(g, b);
  // 本排离障碍还要各让出自己的最大半径
  const rad = g.rowRad[r], L = TP.L > rad ? TP.L - rad : 0, R = TP.R > rad ? TP.R - rad : 0;
  const k = Math.min(1, (L + R) / rw), half = rw * k / 2;
  const lo = half - L, hi = R - half;
  const sh = lo > hi ? (R - L) / 2 : lo > 0 ? lo : hi < 0 ? hi : 0;
  const ll = (l + dc * sp) * k, lat = sh + ll;
  SLOT.x = TP.x + TP.lx * lat;
  SLOT.y = TP.y + TP.ly * lat;
  SLOT.hx = TP.ly;
  SLOT.hy = -TP.lx;
  SLOT.cx = TP.x + TP.lx * sh;
  SLOT.cy = TP.y + TP.ly * sh;
  SLOT.b = b;
  SLOT.l = ll;
  // 本地半宽：开阔处是半个队宽，收窄到比队宽窄就是那里的半个通道宽
  const room = L + R < g.width ? L + R : g.width;
  SLOT.half = Math.max(room / 2, sp / 2);
  SLOT.v = g.v * g.rowK[r];
}

/** (x, y) 在地图里、所在的格子本队走得通 */
export function standable(w: World, tm: number, x: number, y: number): boolean {
  return x > 8 && y > 8 && x < w.W - 8 && y < w.H - 8 && w.nav.block[tm][w.cellAt(x, y)] === 0;
}

/** marchFollow() 的结果：这一帧跟着走的那一点 */
export const FOLLOW = { x: 0, y: 0 };
/** marchFollow() 的返回值：跟着自己的位置走、往中线收拢着随本排走、够不着也看不见本排（各自找路） */
export const FOLLOW_SLOT = 0, FOLLOW_SQUEEZE = 1, FOLLOW_APART = 2;

/**
 * 站在 (ux, uy) 的成员这一帧该跟着哪一点走，结果放在 FOLLOW。位置要先由 marchSlot 算好放在 SLOT 里。
 * - 位置站得住、直线走得到：跟着位置走。
 * - 够不着位置、但看得见本排中线点：这一侧被障碍削窄了，往中线收拢着随本排走。从中线点朝位置量到障碍跟前，那是这一侧还剩的宽度；
 *   站到「自己离中线多远（SLOT.l）÷ 本地半宽（SLOT.half）」的同一比例处，最外侧的人贴着障碍，其余的人往里摊开，不会都挤在障碍边上。
 *   位置本身站得住、中线点到它也走得通时（只是自己这里被一小块障碍挡着），这一侧没有变窄，仍以位置为准。
 *   一时看不见要去的那一点（隔着障碍的一角）就先朝中线点走。
 * - 连中线点也看不见（隔着墙、房子、河）：返回 FOLLOW_APART，由调用方按寻路路线各自找路，FOLLOW 不填。
 */
export function marchFollow(w: World, g: March, ux: number, uy: number): number {
  const tm = g.team, px = SLOT.x, py = SLOT.y, cx = SLOT.cx, cy = SLOT.cy, l = SLOT.l;
  if (standable(w, tm, px, py) && !w.lineBlocked(ux, uy, px, py, tm)) {
    FOLLOW.x = px;
    FOLLOW.y = py;
    return FOLLOW_SLOT;
  }
  if (w.lineBlocked(ux, uy, cx, cy, tm)) return FOLLOW_APART;
  const reach = w.lineReach(cx, cy, px, py, tm);
  let k = reach < 1 || !standable(w, tm, px, py) ? reach * (l < 0 ? -l : l) / SLOT.half : 1;
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

/**
 * 收尾时（g.tail），站在 (ux, uy)、落点在 (dx, dy) 的成员该不该离队去落点：本排已走过终点，
 * 或自己的位置前方再没有窄处、又直线看得见落点。位置要先由 marchSlot 算好放在 SLOT 里。
 * 够不着位置也看不见本排中线（marchFollow 返回 FOLLOW_APART）的，调用方另让他离队。
 */
export function marchRelease(w: World, g: March, ux: number, uy: number, dx: number, dy: number): boolean {
  return SLOT.b <= g.endB || (SLOT.b < g.narrowB && !w.lineBlocked(ux, uy, dx, dy, g.team));
}
