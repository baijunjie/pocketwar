/**
 * 追击绕开小障碍：追击者与目标之间直线不通（隔着民房、营帐这类建筑或一小块走不通的地形）时，
 * 在两者之间做一次有路程上限的局部寻路（A*），朝路线上从自己这里直线看得见的最远一点（路点）走。
 * 路线比直线远出 RULES.combat.chaseDetour 以上（隔着城墙、深水，要绕很远）就算绕不过去。
 * 不用整图流场：每个追击者的目标格各不相同，按目标格申请流场既慢又会挤爆流场缓存。
 */
import { RULES, TILE } from '../content';
import { DIRX, DIRY } from '../nav';
import type { World } from '../world';

/** 判断结果（存进 World.wayMode）：直线走得通、要绕（朝 wayX、wayY 走）、绕不过去 */
export const WAY_DIRECT = 0, WAY_AROUND = 1, WAY_NONE = 2;

/** 局部寻路最多展开多少格：路程上限之外的保险（上限内的格子通常只有一两百个） */
const MAX_NODES = 1200;
/** 追击中每隔几帧重新判断一次（目标在动），错开每 8 帧一次的索敌那一帧（挑中目标时已判断过一次）；到了路点附近立刻重判 */
const RECHECK = 8, RECHECK_PHASE = 4;
/** 离路点不到这么远（像素）就重判，接着朝下一个路点走 */
const WAY_NEAR = 10;

const SQRT2 = Math.SQRT2;
const heapF = new Float64Array(MAX_NODES * 8 + 1);
const heapC = new Int32Array(MAX_NODES * 8 + 1);
const path = new Int32Array(MAX_NODES + 1);
let cells = 0, gen = 0;
let stamp = new Int32Array(0), gScore = new Float64Array(0), parent = new Int32Array(0), closed = new Int32Array(0);

/** findAround() 的结果：路点 */
export const AROUND = { x: 0, y: 0 };

/**
 * 从 i 所在的格到 (tx, ty) 所在的格找一条路程不超过「直线距离 + chaseDetour」的路线（八方向），
 * 找到就把路线上从 i 直线看得见的最远一点写进 AROUND（看得见终点时就是终点本身）。只算判断，不写 i 的状态。
 * 相邻两格能不能走用 nav.block、nav.canStep、nav.canStepDiag，看不看得见用 world.lineBlocked，与位移、流场的规则一致；
 * 与流场不同的是可被攻击的敌方建筑（门楼、塔楼等）也当走不通（流场把它当可拆的高代价格），追击不会想着从建筑里打穿过去。
 */
export function findAround(w: World, i: number, tx: number, ty: number): boolean {
  const mw = w.map.w, mh = w.map.h, n = mw * mh;
  if (n !== cells) {
    cells = n;
    stamp = new Int32Array(n);
    closed = new Int32Array(n);
    gScore = new Float64Array(n);
    parent = new Int32Array(n);
    gen = 0;
  }
  if (++gen === 0x7fffffff) {
    stamp.fill(0);
    closed.fill(0);
    gen = 1;
  }
  const tm = w.team[i], nav = w.nav, blk = nav.block[tm];
  const ux = w.x[i], uy = w.y[i];
  const s = w.cellAt(ux, uy), g = w.cellAt(tx, ty);
  if (blk[g]) return false;
  const gx = g % mw, gy = (g / mw) | 0;
  // 路程上限（格）：直线距离加上允许多绕的那段
  const lim = (Math.hypot(tx - ux, ty - uy) + RULES.combat.chaseDetour) / TILE;
  let hs = 0, expanded = 0, found = false;
  stamp[s] = gen;
  gScore[s] = 0;
  parent[s] = -1;
  heapF[0] = 0;
  heapC[hs++] = s;
  while (hs > 0) {
    const c = heapC[0];
    // 弹出堆顶
    hs--;
    if (hs > 0) {
      const lf = heapF[hs], lc = heapC[hs];
      let k = 0;
      for (;;) {
        let l = 2 * k + 1;
        if (l >= hs) break;
        if (l + 1 < hs && heapF[l + 1] < heapF[l]) l++;
        if (heapF[l] >= lf) break;
        heapF[k] = heapF[l];
        heapC[k] = heapC[l];
        k = l;
      }
      heapF[k] = lf;
      heapC[k] = lc;
    }
    if (closed[c] === gen) continue;
    closed[c] = gen;
    if (c === g) {
      found = true;
      break;
    }
    if (++expanded > MAX_NODES) break;
    const cx = c % mw, cy = (c / mw) | 0, gc = gScore[c];
    for (let dir = 0; dir < 8; dir++) {
      const ddx = DIRX[dir], ddy = DIRY[dir];
      const nx = cx + ddx, ny = cy + ddy;
      if (nx < 0 || ny < 0 || nx >= mw || ny >= mh) continue;
      const nc = ny * mw + nx;
      if (closed[nc] === gen || blk[nc]) continue;
      let ng: number;
      if (dir & 1) {
        if (!nav.canStepDiag(tm, c, nc)) continue;
        ng = gc + SQRT2;
      } else {
        if (!nav.canStep(tm, c, nc)) continue;
        ng = gc + 1;
      }
      if (stamp[nc] === gen && gScore[nc] <= ng) continue;
      // 八方向的估计距离
      const hx = Math.abs(nx - gx), hy = Math.abs(ny - gy);
      const nf = ng + (hx > hy ? hx - hy + hy * SQRT2 : hy - hx + hx * SQRT2);
      if (nf > lim || hs >= heapF.length) continue;
      stamp[nc] = gen;
      gScore[nc] = ng;
      parent[nc] = c;
      let k = hs++;
      while (k > 0) {
        const p = (k - 1) >> 1;
        if (heapF[p] <= nf) break;
        heapF[k] = heapF[p];
        heapC[k] = heapC[p];
        k = p;
      }
      heapF[k] = nf;
      heapC[k] = nc;
    }
  }
  if (!found) return false;
  // 路线倒着记下来，再从自己这头往前找直线看得见的最远一格
  let len = 0;
  for (let c = g; c !== -1 && len < path.length; c = parent[c]) path[len++] = c;
  AROUND.x = tx;
  AROUND.y = ty;
  for (let k = len - 2; k >= 0; k--) {
    const c = path[k];
    const px = k === 0 ? tx : (c % mw + 0.5) * TILE, py = k === 0 ? ty : (((c / mw) | 0) + 0.5) * TILE;
    if (k < len - 2 && w.lineBlocked(ux, uy, px, py, tm)) break;
    AROUND.x = px;
    AROUND.y = py;
  }
  return true;
}

/** 把判断结果记成 i 追目标 uid 的走法：m 为 WAY_AROUND 时路点取 AROUND（刚由 findAround 算出） */
export function keepWay(w: World, i: number, uid: number, m: number): void {
  w.wayUid[i] = uid;
  w.wayMode[i] = m;
  if (m === WAY_AROUND) {
    w.wayX[i] = AROUND.x;
    w.wayY[i] = AROUND.y;
  }
}

/** 为 i 判断去 (tx, ty) 的目标 uid 要不要绕、能不能绕，记进 i 的 way* 字段，返回 WAY_*。只用于 i 已经盯着的目标 */
export function planWay(w: World, i: number, uid: number, tx: number, ty: number): number {
  const m = !w.lineBlocked(w.x[i], w.y[i], tx, ty, w.team[i]) ? WAY_DIRECT : findAround(w, i, tx, ty) ? WAY_AROUND : WAY_NONE;
  keepWay(w, i, uid, m);
  return m;
}

/**
 * 追击中的一帧：去单位目标 tgt（在 tx, ty）该怎么走。换了目标、每隔 RECHECK 帧、或走到路点附近时重新判断，其余帧沿用上次的结果。
 * 返回 WAY_*；WAY_AROUND 时朝 i 的 wayX、wayY 走。
 */
export function chaseWay(w: World, i: number, tgt: number, tx: number, ty: number): number {
  const uid = w.uid[tgt];
  let m = w.wayMode[i];
  if (w.wayUid[i] !== uid || ((i + w.tickCount) % RECHECK) === RECHECK_PHASE
    || (m === WAY_AROUND && (w.wayX[i] - w.x[i]) ** 2 + (w.wayY[i] - w.y[i]) ** 2 < WAY_NEAR * WAY_NEAR)) {
    m = planWay(w, i, uid, tx, ty);
  }
  return m;
}
