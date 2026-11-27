/**
 * 近战绕行：被自己人挡在战线后面又没有别的敌人可换时，绕到目标所在敌群外缘的一个空位去接敌，而不是原地干等。
 * 找空位（findOpening）、起绕（tryDetour）、绕行中每帧的期望速度（detourStep）、移动之后判断走没走动（detourProgress）。
 * 绕行的状态存在 World 的 detour* 字段里；空位与圆心按相对空位所属敌兵的位置存，敌人被人群推着走时它们跟着走。
 *
 * 连空位也没有时的等待（startWait）与等待期间的游走（prowlPivot、prowlStep、prowlProgress）也在这里：
 * 人不站着，沿敌群外缘来回走，位置一直在变，哪里空出来了离得近的人就能补上。游走的状态存在 World 的 prowl* 字段里。
 */
import { DT, RULES, TILE } from '../content';
import { ENG_CLOSE, GRID, NONE, O_ATTACK, O_IDLE, S_CHARGE, S_ROUT } from '../state';
import type { World } from '../world';

/** findOpening() 的结果：空位坐标、空位所属的敌兵，以及绕过去用的圆（敌群重心与半径） */
export const OPENING = { x: 0, y: 0, foe: NONE, cx: 0, cy: 0, r: 0 };

/** 每个敌兵周围试多少个方向 */
const OPENING_DIRS = 12;
/** 最多试多少个敌兵的空位（取离自己最近的）；敌群重心与半径不受它限制，始终按范围内全部敌兵算 */
const OPENING_FOES = 128;
/** 绕行时每隔几帧复查一次空位还空不空 */
const DETOUR_RECHECK = 8;
/** 往前看几帧的位移，前面走不通就结束绕行 */
const DETOUR_LOOK = 3;
/** 某个目标所在的敌群整圈都没有空位之后，这么多帧内别人再为它找空位直接算没有：成片的人等在同一群敌人外面时，不必各自把敌群试一遍 */
const OPENING_MEMO = 16;

const foeBuf = new Int32Array(OPENING_FOES);
const foeD2 = new Float64Array(OPENING_FOES);
/** 绕行的期望速度（detourStep 写入，调用方读 wx、wy），以及它是不是直奔空位（相对绕圈） */
export const STEP = { wx: 0, wy: 0, direct: false };

/**
 * (px, py) 这个点上有没有人（敌我都算，i 自己除外）能让半径 ri 的 i 站进去：按实际占位查，不看 crowd 计数
 * @param ov 与别人重叠不超过这么多（像素）仍算站得进去
 */
export function spotFree(w: World, i: number, px: number, py: number, ri: number, ov = RULES.combat.detourOverlap): boolean {
  const gw = w.gw, gh = w.gh, cs = w.cellStart, items = w.items;
  const gx = (px / GRID) | 0, gy = (py / GRID) | 0;
  for (let cy = gy - 1; cy <= gy + 1; cy++) {
    if (cy < 0 || cy >= gh) continue;
    for (let cx = gx - 1; cx <= gx + 1; cx++) {
      if (cx < 0 || cx >= gw) continue;
      const c = cy * gw + cx;
      const e = cs[c + 1];
      for (let k = cs[c]; k < e; k++) {
        const j = items[k];
        if (j === i || !w.alive[j]) continue;
        const rr = w.rad[j] + ri - ov;
        if ((w.x[j] - px) ** 2 + (w.y[j] - py) ** 2 < rr * rr) return false;
      }
    }
  }
  return true;
}

/**
 * 在目标所在敌群的外缘找一个真空位。
 * 敌群是目标周围 detourRange 内全部看得见、没溃逃的敌兵：重心与半径对他们全部累加，不设上限。
 * 只有「试空位」的敌兵数有上限：取其中离 i 最近的 OPENING_FOES 个（不按网格行序截，免得只剩某一个方向的）。
 * 每个敌兵周围取若干个贴身点，只留比这个敌兵更远离重心的；点上有人、落在走不通的格子里、
 * 与敌兵之间直线不通、自己上不去（墙顶与地面）的排除。
 * 余下的挑代价最小的：绕敌群转过去的弧长，加上从自己所在的半径走到绕行圆的径向距离，再加上从圆走进空位的径向距离（乘 detourDepth）；
 * 代价不超过 detourMaxCost，也不超过 speed × detourFor（时限内走不到的不去绕）。
 * 结果写进 OPENING，返回是否找到。
 * @param only 不为 NONE 时空位只能属于这个敌兵（玩家指定了攻击目标，不能绕去打别人）
 * @param leash2 大于 0 时，空位所属的敌兵离 i 的岗位（homeX, homeY）的距离平方不超过它（待命的单位不被引得离岗太远）
 * @param keep 给了就只留它判为真的敌兵作空位的所属者（据点守军不被引出据点）
 */
export function findOpening(w: World, i: number, tgt: number, only = NONE, speed = Infinity, leash2 = 0,
  keep?: (foe: number) => boolean): boolean {
  const C = RULES.combat;
  // 不限定空位属于谁的搜索，「整圈没有空位」的结论对同一队的人都成立（各人半径的差别、墙顶与地面的差别忽略：
  // 近战上了墙顶还在找空位的极少）。敌群大到试不全时各人试的是各自身边的那些，结论不通用，不记
  const shared = only === NONE && leash2 <= 0 && !keep;
  if (shared && w.tickCount - w.noOpening[tgt] < OPENING_MEMO) return false;
  const tm = w.team[i], ri = w.rad[i], bit = 1 << tm;
  const x = w.x, y = w.y, rad = w.rad;
  const gw = w.gw, gh = w.gh, cs = w.cellStart, items = w.items;
  const ux = x[i], uy = y[i];
  const R = C.detourRange, R2 = R * R;
  let gx0 = ((x[tgt] - R) / GRID) | 0, gx1 = ((x[tgt] + R) / GRID) | 0;
  let gy0 = ((y[tgt] - R) / GRID) | 0, gy1 = ((y[tgt] + R) / GRID) | 0;
  if (gx0 < 0) gx0 = 0;
  if (gy0 < 0) gy0 = 0;
  if (gx1 >= gw) gx1 = gw - 1;
  if (gy1 >= gh) gy1 = gh - 1;
  const hx = w.homeX[i], hy = w.homeY[i];
  // 敌群的重心：范围内全部看得见、没溃逃的敌兵；一个都没有（目标自己也不算）才退回用目标的位置
  let nAll = 0, cx = 0, cy = 0;
  for (let gy = gy0; gy <= gy1; gy++) {
    for (let k = cs[gy * gw + gx0], e = cs[gy * gw + gx1 + 1]; k < e; k++) {
      const j = items[k];
      if (w.team[j] === tm || !w.alive[j] || (w.state[j] & S_ROUT) || !(w.seen[j] & bit)) continue;
      if ((x[j] - x[tgt]) ** 2 + (y[j] - y[tgt]) ** 2 > R2) continue;
      cx += x[j];
      cy += y[j];
      nAll++;
    }
  }
  if (nAll === 0) {
    nAll = 1;
    cx = x[tgt];
    cy = y[tgt];
  }
  cx /= nAll;
  cy /= nAll;
  // 敌群的半径，同时挑出试空位的敌兵：离自己最近的 OPENING_FOES 个（满了就换掉最远的）
  let cr = 0, n = 0, far = 0, cut = false;
  for (let gy = gy0; gy <= gy1; gy++) {
    for (let k = cs[gy * gw + gx0], e = cs[gy * gw + gx1 + 1]; k < e; k++) {
      const j = items[k];
      if (w.team[j] === tm || !w.alive[j] || (w.state[j] & S_ROUT) || !(w.seen[j] & bit)) continue;
      if ((x[j] - x[tgt]) ** 2 + (y[j] - y[tgt]) ** 2 > R2) continue;
      const r = Math.hypot(x[j] - cx, y[j] - cy) + rad[j];
      if (r > cr) cr = r;
      if (only !== NONE ? j !== only : (leash2 > 0 && (x[j] - hx) ** 2 + (y[j] - hy) ** 2 > leash2) || (keep && !keep(j))) continue;
      const d2 = (x[j] - ux) ** 2 + (y[j] - uy) ** 2;
      if (n < OPENING_FOES) {
        foeBuf[n] = j;
        foeD2[n] = d2;
        if (d2 > foeD2[far]) far = n;
        n++;
      } else {
        cut = true;
        if (d2 < foeD2[far]) {
          foeBuf[far] = j;
          foeD2[far] = d2;
          far = 0;
          for (let m = 1; m < n; m++) if (foeD2[m] > foeD2[far]) far = m;
        }
      }
    }
  }
  const ad = Math.hypot(ux - cx, uy - cy);
  const pa = Math.atan2(uy - cy, ux - cx);
  const orbit = Math.max(ad, cr + ri + C.detourMargin);
  OPENING.cx = cx;
  OPENING.cy = cy;
  OPENING.r = orbit;
  const blk = w.nav.block[tm], dk = w.nav.deck[tm];
  const myDeck = dk[w.cellAt(ux, uy)];
  const mw = w.map.w, maxX = w.W - 6, maxY = w.H - 6;
  const radial = Math.max(0, orbit - ad);
  let best = Math.min(C.detourMaxCost, speed * C.detourFor), found = false, tooFar = false;
  for (let k = 0; k < n; k++) {
    const e = foeBuf[k];
    const ex = x[e], ey = y[e];
    const dEdge = Math.hypot(ex - cx, ey - cy);
    const reach = rad[e] + ri + C.detourGap;
    for (let m = 0; m < OPENING_DIRS; m++) {
      const a = (m * Math.PI * 2) / OPENING_DIRS;
      const sx = ex + Math.cos(a) * reach, sy = ey + Math.sin(a) * reach;
      // 外缘：比敌兵本身更远离重心
      const sd = Math.hypot(sx - cx, sy - cy);
      if (sd <= dEdge) continue;
      if (sx < 6 || sy < 6 || sx > maxX || sy > maxY) continue;
      const c = ((sy / TILE) | 0) * mw + ((sx / TILE) | 0);
      if (blk[c] || dk[c] !== myDeck) continue;
      let da = Math.atan2(sy - cy, sx - cx) - pa;
      if (da > Math.PI) da -= Math.PI * 2;
      else if (da < -Math.PI) da += Math.PI * 2;
      const cost = Math.abs(da) * orbit + radial + C.detourDepth * Math.max(0, orbit - sd);
      if (cost >= best) {
        tooFar = true;
        continue;
      }
      if (!spotFree(w, i, sx, sy, ri) || w.lineBlocked(ex, ey, sx, sy, tm)) continue;
      best = cost;
      found = true;
      OPENING.x = sx;
      OPENING.y = sy;
      OPENING.foe = e;
    }
  }
  // 没找到、也没有哪个位置是嫌远没看的：整圈确实没有空位
  if (!found && !tooFar && !cut && shared) w.noOpening[tgt] = w.tickCount;
  return found;
}

/**
 * 挤不进战线：等一会儿再往上挤，连续等的次数越多等得越久。
 * @param prowl 等的时候不站着，沿敌群外缘来回游走（等的是敌兵时）；据点里待命的守军不游走，免得被带出据点
 */
export function startWait(w: World, i: number, prowl = false): void {
  const C = RULES.combat;
  w.waitT[i] = Math.min(C.waitMax, C.waitBase + w.waits[i] * 0.8);
  if (w.waits[i] < 200) w.waits[i]++;
  if (prowl && !(w.order[i] === O_IDLE && w.sheltered[i] === 1)) {
    // 跟着身边正在游走的自己人往同一边走（迎面走会互相堵住）；身边没有或两边一样多时，上一轮往哪边这一轮接着往哪边，
    // 头一回按编号一半往左、一半往右
    const flow = prowlFlow(w, i);
    w.prowl[i] = flow > 0 ? 1 : flow < 0 ? -1 : w.prowl[i] > 0 ? 1 : w.prowl[i] < 0 ? -1 : i & 1 ? 1 : -1;
    w.prowlPivot[i] = NONE;
    w.prowlD[i] = w.prowlStall[i] = 0;
  } else w.prowl[i] = 0;
}

/** i 身边（所在格与相邻格）正在游走的自己人往哪边走的多：正负同 World.prowl 的方向，0 是没有或一样多 */
function prowlFlow(w: World, i: number): number {
  const tm = w.team[i];
  const gw = w.gw, gh = w.gh, cs = w.cellStart, items = w.items;
  const gx = (w.x[i] / GRID) | 0, gy = (w.y[i] / GRID) | 0;
  let sum = 0;
  for (let cy = gy - 1; cy <= gy + 1; cy++) {
    if (cy < 0 || cy >= gh) continue;
    for (let cx = gx - 1; cx <= gx + 1; cx++) {
      if (cx < 0 || cx >= gw) continue;
      const c = cy * gw + cx;
      for (let k = cs[c], e = cs[c + 1]; k < e; k++) {
        const j = items[k];
        if (j === i || !w.alive[j] || w.team[j] !== tm || w.waitT[j] <= 0) continue;
        sum += w.prowl[j] > 0 ? 1 : w.prowl[j] < 0 ? -1 : 0;
      }
    }
  }
  return sum;
}

/** 游走的人看见了最近的敌兵 near（距离平方 d2）：绕着它走；头一次看见时量下此后保持的距离，至少隔开一排人 */
export function prowlPivot(w: World, i: number, near: number, d2: number): void {
  w.prowlPivot[i] = near;
  w.prowlUid[i] = w.uid[near];
  if (w.prowlD[i] <= 0) w.prowlD[i] = Math.max(Math.sqrt(d2), w.rad[near] + w.rad[i] * 3 + RULES.combat.meleeContact);
}

/** 游走的人找正对着的空位时，在正对方向两侧各多试几个方向，相邻两个差这么多弧度 */
const GAP_STEP = 0.35;
const GAP_SIDE = 2;

/**
 * 游走的人正对着的位置是不是空出来了：绕着走的那个敌兵身边、朝着自己这一侧（正对方向及两侧各 GAP_SIDE 个方向）有贴着它的位置没人站，
 * 自己又只隔着一排的距离，直线也走得通。是就返回那个敌兵（调用方改打它、不等了），否则 NONE。
 * 隔着两排以上的不算：前面还有自己人，冲上去也是被挡住。
 * 占位按 prowlFit 放宽：前排腾出一个人的位置时两边的人并没有挪开，刚好一人宽，路过的人很少正对着它的正中
 */
export function prowlGap(w: World, i: number): number {
  const C = RULES.combat, tm = w.team[i];
  const p = w.prowlPivot[i];
  if (w.prowl[i] === 0 || p < 0 || !w.alive[p] || w.uid[p] !== w.prowlUid[i] || !(w.seen[p] & (1 << tm))) return NONE;
  const ux = w.x[i], uy = w.y[i], ri = w.rad[i];
  const blk = w.nav.block[tm], dk = w.nav.deck[tm];
  const myDeck = dk[w.cellAt(ux, uy)];
  const maxX = w.W - 6, maxY = w.H - 6;
  const ax = ux - w.x[p], ay = uy - w.y[p], ad = Math.hypot(ax, ay) || 1;
  const reach = w.rad[p] + ri + C.detourGap;
  if (ad - reach > ri * 2 + C.prowlReach) return NONE;
  const base = Math.atan2(ay, ax);
  for (let k = -GAP_SIDE; k <= GAP_SIDE; k++) {
    const a = base + k * GAP_STEP;
    const sx = w.x[p] + Math.cos(a) * reach, sy = w.y[p] + Math.sin(a) * reach;
    // 落在走不通的地形或建筑里、自己上不去（墙顶与地面）的位置没人站也不算空位：敌兵贴着墙、房子站时那一侧永远没人
    if (sx < 6 || sy < 6 || sx > maxX || sy > maxY) continue;
    const c = w.cellAt(sx, sy);
    if (blk[c] || dk[c] !== myDeck) continue;
    if (spotFree(w, i, sx, sy, ri, C.prowlFit)) return w.lineBlocked(ux, uy, w.x[p], w.y[p], tm) ? NONE : p;
  }
  return NONE;
}

/** 游走掉头；掉头后还没走动过就又要掉头的（两边都走不通），改成站着等 */
function prowlTurn(w: World, i: number): void {
  const p = w.prowl[i];
  w.prowl[i] = p === 1 ? -2 : p === -1 ? 2 : 0;
  w.prowlStall[i] = 0;
}

/**
 * 游走的一帧：期望速度写进 STEP（wx、wy），返回 false 表示这一帧站着（还没量好距离、前面走不通刚掉头）。
 * 走法是绕着最近的敌兵转、与它保持 prowlD 的距离：最近的敌兵随走随换，走出来的就是敌群外缘的等距线，
 * 敌群是一团就绕着转圈，是一条线就沿着线走。
 * @param cell i 当前所在的格
 */
export function prowlStep(w: World, i: number, tgt: number, spd: number, cell: number): boolean {
  const C = RULES.combat, tm = w.team[i];
  const D = w.prowlD[i];
  if (D <= 0) return false;
  let p = w.prowlPivot[i];
  if (p < 0 || !w.alive[p] || w.uid[p] !== w.prowlUid[i]) p = tgt;
  const ux = w.x[i], uy = w.y[i];
  const ax = ux - w.x[p], ay = uy - w.y[p], ad = Math.hypot(ax, ay) || 1;
  const sg = w.prowl[i] > 0 ? 1 : -1;
  // 切向走，再带一点把距离拉回 D 的分量（不超过切向分量，免得掉头就跑）
  let pull = (D - ad) / C.detourPull;
  if (pull > 1) pull = 1;
  else if (pull < -1) pull = -1;
  const tx = (-ay / ad) * sg + (ax / ad) * pull, ty = (ax / ad) * sg + (ay / ad) * pull;
  const tl = Math.hypot(tx, ty) || 1;
  const v = spd * C.prowlSpeed;
  STEP.wx = (tx / tl) * v;
  STEP.wy = (ty / tl) * v;
  // 往前看一小段：走不通（地形、别人的建筑、墙顶与墙下）就掉头
  const look = DT * DETOUR_LOOK;
  const px = Math.min(w.W - 6, Math.max(6, ux + STEP.wx * look)), py = Math.min(w.H - 6, Math.max(6, uy + STEP.wy * look));
  const c1 = w.cellAt(px, py);
  if (c1 !== cell && (w.nav.block[tm][c1] || !w.nav.canStep(tm, cell, c1))) {
    prowlTurn(w, i);
    return false;
  }
  return true;
}

/** 游走的人移动之后调用：这一帧实际走了 moved，想走的速度是 want。连着走不动（被站定的自己人或迎面的人堵着）就掉头 */
export function prowlProgress(w: World, i: number, moved: number, want: number): void {
  const C = RULES.combat;
  if (moved < want * DT * C.detourStall) {
    if ((w.prowlStall[i] += DT) > C.prowlStallAfter) prowlTurn(w, i);
  } else {
    w.prowlStall[i] = 0;
    w.prowl[i] = w.prowl[i] > 0 ? 1 : -1;
  }
}

/** 结束绕行；wait 为真时改为等一会儿再挤（见 startWait） */
function endDetour(w: World, i: number, wait: boolean): void {
  w.detourT[i] = w.detourStall[i] = 0;
  if (wait) {
    startWait(w, i, true);
    w.detourLoose[i] = RULES.combat.detourLoose;
  }
}

/** 把空位、圆心按相对敌兵 foe 的位置存进 i 的绕行状态，目标换成 foe，剩余时间 t */
function setDetour(w: World, i: number, foe: number, t: number): void {
  w.detourX[i] = OPENING.x - w.x[foe];
  w.detourY[i] = OPENING.y - w.y[foe];
  w.detourCx[i] = OPENING.cx - w.x[foe];
  w.detourCy[i] = OPENING.cy - w.y[foe];
  w.detourR[i] = OPENING.r;
  w.detourStall[i] = 0;
  w.detourT[i] = t;
  w.target[i] = foe;
  w.targetUid[i] = w.uid[foe];
}

/**
 * 绕行的期望速度写进 STEP：沿以敌群重心为圆心、半径 r 的圆转到空位所在的方位，方位够近了就直奔空位；
 * 已到位（离空位不到 detourNear）返回 false。坐标都是绝对的。
 */
function detourVel(ux: number, uy: number, sx: number, sy: number, cx: number, cy: number, r: number, spd: number): boolean {
  const C = RULES.combat;
  const ax = ux - cx, ay = uy - cy, ad = Math.hypot(ax, ay) || 1;
  let da = Math.atan2(sy - cy, sx - cx) - Math.atan2(ay, ax);
  if (da > Math.PI) da -= Math.PI * 2;
  else if (da < -Math.PI) da += Math.PI * 2;
  if (Math.abs(da) * ad > C.detourDirect) {
    // 切向走，再带一点把半径拉回圆上的分量
    const sg = da > 0 ? 1 : -1;
    const pull = (r - ad) / C.detourPull;
    const tx = (-ay / ad) * sg + (ax / ad) * pull, ty = (ax / ad) * sg + (ay / ad) * pull;
    const tl = Math.hypot(tx, ty) || 1;
    STEP.wx = (tx / tl) * spd;
    STEP.wy = (ty / tl) * spd;
    STEP.direct = false;
    return true;
  }
  const ex = sx - ux, ey = sy - uy, el = Math.hypot(ex, ey);
  if (el < C.detourNear) return false;
  STEP.wx = (ex / el) * spd;
  STEP.wy = (ey / el) * spd;
  STEP.direct = true;
  return true;
}

/** 起步方向的正前方是不是贴着正在交手（站定）的自己人：是的话绕不动。射击中的远程不算，近战能从他们身上穿过去 */
function blockedAhead(w: World, i: number): boolean {
  const l = Math.hypot(STEP.wx, STEP.wy) || 1;
  const fx = STEP.wx / l, fy = STEP.wy / l;
  const ux = w.x[i], uy = w.y[i], ri = w.rad[i], tm = w.team[i];
  const C = RULES.combat;
  const gw = w.gw, gh = w.gh, cs = w.cellStart, items = w.items;
  const gx = (ux / GRID) | 0, gy = (uy / GRID) | 0;
  for (let cy = gy - 1; cy <= gy + 1; cy++) {
    if (cy < 0 || cy >= gh) continue;
    for (let cx = gx - 1; cx <= gx + 1; cx++) {
      if (cx < 0 || cx >= gw) continue;
      const c = cy * gw + cx;
      for (let k = cs[c], e = cs[c + 1]; k < e; k++) {
        const j = items[k];
        if (j === i || !w.alive[j] || w.team[j] !== tm || w.planted[j] !== 1 || shooting(w, j)) continue;
        const ox = w.x[j] - ux, oy = w.y[j] - uy, d = Math.hypot(ox, oy) || 0.001;
        if (d < ri + w.rad[j] + C.contactSkin && (fx * ox + fy * oy) / d > C.flankCos) return true;
      }
    }
  }
  return false;
}

/**
 * 追不上、又没有别的敌人可换时试着起绕：找空位，起步方向不堵就把目标换成空位所属的敌兵并开始绕行。
 * 返回 false 表示没绕成（冲锋中、没有空位、起步就被正在交手的自己人堵着），调用方改为等一会儿再挤。
 * @param st i 的状态位
 * @param ord i 的命令；玩家指定了攻击目标时空位只能属于那个目标
 * @param spd i 的速度
 * @param leash2 待命单位的追击范围平方（敌人离岗位超过它就不追），其余传 0
 * @param keep 同 findOpening
 */
export function tryDetour(w: World, i: number, tgt: number, st: number, ord: number, spd: number, leash2: number,
  keep?: (foe: number) => boolean): boolean {
  if ((st & S_CHARGE) || !findOpening(w, i, tgt, ord === O_ATTACK ? tgt : NONE, spd, leash2, keep)) return false;
  if (detourVel(w.x[i], w.y[i], OPENING.x, OPENING.y, OPENING.cx, OPENING.cy, OPENING.r, spd) && blockedAhead(w, i)) return false;
  setDetour(w, i, OPENING.foe, RULES.combat.detourFor);
  return true;
}

/**
 * 绕行的一帧：算这一帧的期望速度写进 STEP（wx、wy）。
 * 返回 false 表示绕行结束（目标溃逃或看不见、到点、空位没了又找不到、前面走不通、已到位），这一帧交回普通追击逻辑；
 * 空位没了、前面走不通、到点这三种另外让他等一会儿再挤。
 * @param cell i 当前所在的格
 * @param leash2、keep 同 tryDetour
 */
export function detourStep(w: World, i: number, tgt: number, ord: number, spd: number, cell: number, leash2: number,
  keep?: (foe: number) => boolean): boolean {
  const C = RULES.combat, tm = w.team[i];
  const ux = w.x[i], uy = w.y[i];
  if ((w.state[tgt] & S_ROUT) || !(w.seen[tgt] & (1 << tm))) {
    endDetour(w, i, false);
    return false;
  }
  if ((w.detourT[i] -= DT) <= 0) {
    endDetour(w, i, true);
    return false;
  }
  // 空位被占了：重找一次（时间接着算）；临近了就不查，直接凑过去
  let sx = w.x[tgt] + w.detourX[i], sy = w.y[tgt] + w.detourY[i];
  if (((i + w.tickCount) % DETOUR_RECHECK) === 0 && (sx - ux) ** 2 + (sy - uy) ** 2 > C.detourCommit ** 2
    && !spotFree(w, i, sx, sy, w.rad[i])) {
    if (!findOpening(w, i, tgt, ord === O_ATTACK ? tgt : NONE, spd, leash2, keep)) {
      endDetour(w, i, true);
      return false;
    }
    setDetour(w, i, OPENING.foe, w.detourT[i]);
  }
  const f = w.target[i], fx = w.x[f], fy = w.y[f];
  sx = fx + w.detourX[i];
  sy = fy + w.detourY[i];
  if (!detourVel(ux, uy, sx, sy, fx + w.detourCx[i], fy + w.detourCy[i], w.detourR[i], spd)) {
    endDetour(w, i, false);
    return false;
  }
  // 往前看一小段：不可通行的格子、别人的建筑、墙顶与墙下不能互通
  const look = (spd * DT * DETOUR_LOOK) / (Math.hypot(STEP.wx, STEP.wy) || 1);
  const px = Math.min(w.W - 6, Math.max(6, ux + STEP.wx * look)), py = Math.min(w.H - 6, Math.max(6, uy + STEP.wy * look));
  const c1 = w.cellAt(px, py);
  if (c1 !== cell && (w.nav.block[tm][c1] || !w.nav.canStep(tm, cell, c1))) {
    endDetour(w, i, true);
    return false;
  }
  return true;
}

/**
 * 绕行的人移动之后调用：这一帧从 (ux, uy) 走到 (nx, ny)，想走的速度是 want。
 * 实际进展远小于想走的（被正在交手的自己人堵在人堆里）连续超过 detourStallAfter 秒就放弃绕行、改为等一会儿再挤。
 * 直奔空位时看离空位近了多少（空位被别人占着、在旁边顶着不算走动），绕圈时看挪动了多少。
 */
export function detourProgress(w: World, i: number, ux: number, uy: number, nx: number, ny: number, want: number): void {
  const C = RULES.combat;
  const f = w.target[i], sx = w.x[f] + w.detourX[i], sy = w.y[f] + w.detourY[i];
  const gain = STEP.direct ? Math.hypot(sx - ux, sy - uy) - Math.hypot(sx - nx, sy - ny) : Math.hypot(nx - ux, ny - uy);
  if (gain < want * DT * C.detourStall) {
    if ((w.detourStall[i] += DT) > C.detourStallAfter) endDetour(w, i, true);
  } else w.detourStall[i] = 0;
}

/** 绕行中的 i 能不能穿过自己人 j：j 没在交手（不论步兵还是骑兵）也没在绕行，且 i 自己真的在走 */
export function detourPasses(w: World, i: number, j: number): boolean {
  const C = RULES.combat;
  return w.planted[j] !== 1 && !w.engaged[j] && w.detourT[j] <= 0 && w.detourStall[i] < C.detourStallAfter * C.detourPassStall;
}

/** j 是不是正在射击的远程单位（射程内有目标） */
export function shooting(w: World, j: number): boolean {
  return w.engaged[j] === ENG_CLOSE && !w.defs[w.type[j]].melee;
}
