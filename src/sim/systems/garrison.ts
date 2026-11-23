/**
 * 城墙驻守：墙顶上是一个个固定的站位（每格墙顶几个人）。城里待命的远程步兵自动走到墙根、登上离自己最近的空位，
 * 在那里坚守；看到敌人在射程外，就沿着墙顶走到离敌人更近的空位（shiftPosts）。接到别的命令就先下墙再照办。
 * 站位满了就不能再上人。上下墙、沿墙走动都是按直线走的「过场」，不走寻路也不参与碰撞。
 */
import { DT, RULES, TILE, UnitDef } from '../content';
import { NONE, O_HOLD, O_IDLE, O_MOVE, S_ROUT, S_WALL } from '../state';
import type { World } from '../world';

/** 垛口位 */
export interface WallSlot {
  id: number;
  /** 站位，以及面朝城外的方向（弧度） */
  x: number;
  y: number;
  face: number;
  /** 墙根：从这里上下墙 */
  ex: number;
  ey: number;
  site: number;
  /** 脚下那段墙（或角楼）、那一格，以及这一格所在的那段连通的墙顶（被门楼隔开的算两段） */
  bld: number;
  cell: number;
  group: number;
  /** 占着这个位置的单位，-1 表示空着 */
  unit: number;
}

/** 单位的驻守进度 */
export const P_NONE = 0, P_GOING = 1, P_CLIMB = 2, P_POSTED = 3, P_DESCEND = 4, P_SHIFT = 5;

const NX = [1, 0, -1, 0], NY = [0, 1, 0, -1];

/** 给各据点的城墙排出站位：墙顶上紧挨城外的那一圈格子，每格 slotCap 个（开局圈出城内之后调用） */
export function buildSlots(w: World): void {
  const nav = w.nav, mw = w.map.w, mh = w.map.h;
  const inner = nav.inner, bld = nav.bld;
  const top = (c: number): boolean => bld[c] >= 0 && w.buildings[bld[c]].def.top > 0;
  w.slots.length = 0;
  w.wallGroup.clear();
  const reach = RULES.siege.slotReach, cap = RULES.siege.slotCap, subs = RULES.siege.slotSubs;
  // 墙顶分段：四邻相通的墙顶格子算一段
  let groups = 0;
  for (const b of w.buildings) {
    if (b.def.top <= 0) continue;
    for (let ty = b.ty; ty < b.ty + b.h; ty++) for (let tx = b.tx; tx < b.tx + b.w; tx++) {
      const c0 = ty * mw + tx;
      if (w.wallGroup.has(c0)) continue;
      const g = groups++;
      const stack = [c0];
      w.wallGroup.set(c0, g);
      while (stack.length) {
        const q = stack.pop()!;
        for (let k = 0; k < 4; k++) {
          const n = q + NX[k] + NY[k] * mw;
          if (n < 0 || n >= nav.n || w.wallGroup.has(n) || !top(n)) continue;
          w.wallGroup.set(n, g);
          stack.push(n);
        }
      }
    }
  }
  for (const s of w.sites) {
    for (const id of s.buildings) {
      const b = w.buildings[id];
      if (b.def.top <= 0) continue;
      for (let ty = b.ty; ty < b.ty + b.h; ty++) for (let tx = b.tx; tx < b.tx + b.w; tx++) {
        const c = ty * mw + tx;
        // 朝城外的方向：四邻里既不是墙顶、也不是城内、也不是别的建筑（门楼）的那几个
        let ox = 0, oy = 0;
        for (let k = 0; k < 4; k++) {
          const x = tx + NX[k], y = ty + NY[k];
          if (x < 0 || y < 0 || x >= mw || y >= mh) continue;
          const n = y * mw + x;
          if (!inner[n] && bld[n] < 0) {
            ox += NX[k];
            oy += NY[k];
          }
        }
        if (!ox && !oy) continue;
        // 墙根：沿墙顶往里找最近的一格城内空地
        const seen = new Set<number>([c]);
        let ring = [c], entry = -1;
        for (let step = 0; step < reach && entry < 0 && ring.length; step++) {
          const next: number[] = [];
          for (const q of ring) {
            for (let k = 0; k < 4 && entry < 0; k++) {
              const n = q + NX[k] + NY[k] * mw;
              if (n < 0 || n >= nav.n || seen.has(n)) continue;
              seen.add(n);
              if (inner[n] && bld[n] < 0 && nav.base[n] !== 0) entry = n;
              else if (top(n)) next.push(n);
            }
          }
          ring = next;
        }
        if (entry < 0) continue;
        const ol = Math.hypot(ox, oy), fx = ox / ol, fy = oy / ol;
        // 同一格里的几个站位：前排沿墙并排，后排往里退半步
        for (let k = 0; k < cap; k++) {
          const [out, lat] = subs[k % subs.length];
          w.slots.push({
            id: w.slots.length, x: (tx + 0.5) * TILE + fx * out - fy * lat, y: (ty + 0.5) * TILE + fy * out + fx * lat, face: Math.atan2(oy, ox),
            ex: (entry % mw + 0.5) * TILE, ey: (((entry / mw) | 0) + 0.5) * TILE, site: s.id, bld: id, cell: c, group: w.wallGroup.get(c)!, unit: -1,
          });
        }
      }
    }
  }
}

/** 能上墙驻守的兵种：远程的步行人形单位 */
export function canGarrison(d: UnitDef): boolean {
  return d.humanoid && d.range > 0 && !d.mobile;
}

/**
 * 让这些单位里的远程步兵登上所在城邦的城墙驻守，各自去最近的空垛口。
 * @returns 派上去几人；-1 表示里面没有能上墙的兵种，-2 表示都不在自家有城墙的据点里，0 表示垛口满了
 */
export function orderGarrison(w: World, all: number[]): number {
  let able = 0, inTown = 0, sent = 0;
  for (const i of all) {
    if (!w.alive[i] || w.state[i] & S_ROUT) continue;
    const d = w.defs[w.type[i]];
    if (!canGarrison(d)) continue;
    able++;
    if (w.pmode[i] === P_GOING || w.pmode[i] === P_CLIMB || w.pmode[i] === P_POSTED) {
      inTown++;
      continue;
    }
    if (w.pmode[i] !== P_NONE) continue;
    const tm = w.team[i], ux = w.x[i], uy = w.y[i];
    let best = 1e18, pick = -1, here = false;
    for (const sl of w.slots) {
      const s = w.sites[sl.site];
      if (s.owner !== tm || s.disabled) continue;
      const r = s.radius > 0 ? s.radius : RULES.site.hqRadius;
      if ((ux - s.x) ** 2 + (uy - s.y) ** 2 > r * r) continue;
      here = true;
      const b = w.buildings[sl.bld];
      if (sl.unit >= 0 || !b.alive || b.owner !== tm) continue;
      const d2 = (sl.ex - ux) ** 2 + (sl.ey - uy) ** 2;
      if (d2 < best) {
        best = d2;
        pick = sl.id;
      }
    }
    if (here) inTown++;
    if (pick < 0) continue;
    sendToSlot(w, i, pick);
    sent++;
  }
  return !able ? -1 : !inTown ? -2 : sent;
}

/** 占下这个站位，走到它的墙根去（到了由 stepPost 接着上墙） */
function sendToSlot(w: World, i: number, id: number): void {
  const sl = w.slots[id], tm = w.team[i];
  sl.unit = i;
  w.post[i] = id;
  w.pmode[i] = P_GOING;
  const cell = w.cellAt(sl.ex, sl.ey);
  w.order[i] = O_MOVE;
  w.target[i] = w.otarget[i] = NONE;
  w.grp[i] = -1;
  w.grpSpeed[i] = 0;
  w.destX[i] = sl.ex;
  w.destY[i] = sl.ey;
  w.destCell[i] = cell;
  w.seekR[i] = 0;
  w.stuck[i] = w.ignoreT[i] = w.waitT[i] = 0;
  w.field[i] = w.lineBlocked(w.x[i], w.y[i], sl.ex, sl.ey, tm) ? w.nav.getField(tm, cell, w.tickCount) : null;
}

/** 在自家城邦里待命的远程步兵自动登城（每隔一段时间由据点系统调用；垛口满了就留在地上） */
export function autoGarrison(w: World): void {
  if (!w.slots.length) return;
  const one = [0];
  for (let i = 0; i < w.n; i++) {
    if (!w.alive[i] || !w.sheltered[i] || w.order[i] !== O_IDLE || w.pmode[i] !== P_NONE || w.state[i] & S_ROUT) continue;
    if (!canGarrison(w.defs[w.type[i]])) continue;
    one[0] = i;
    orderGarrison(w, one);
  }
}

/** 腾出垛口。已经在墙上（或正在上墙）的先走下来，再去做别的 */
export function leavePost(w: World, i: number): void {
  // 任何新命令都取消「出击后回原位」
  w.sortie[i] = 0;
  // 下墙之后原本要去另一段墙的，作罢，把预留的站位让出来
  releaseNext(w, i);
  const pm = w.pmode[i];
  if (pm === P_NONE || pm === P_DESCEND) return;
  const sl = w.slots[w.post[i]];
  if (sl.unit === i) sl.unit = -1;
  w.wallRoute.delete(i);
  if (pm === P_GOING) {
    w.pmode[i] = P_NONE;
    w.post[i] = -1;
  } else w.pmode[i] = P_DESCEND;
}

/**
 * 每帧：推进上墙 / 下墙的过场。返回 true 表示这一帧单位由过场接管，不再走平常的行为。
 */
export function stepPost(w: World, i: number, d: UnitDef): boolean {
  const pm = w.pmode[i];
  const sl = w.slots[w.post[i]];
  const b = w.buildings[sl.bld];
  const ux = w.x[i], uy = w.y[i];
  if (pm === P_GOING) {
    // 走到墙根就开始上墙；半路被别的事打断（卡住放弃、溃逃）就把位置让出来
    if (!b.alive || b.owner !== w.team[i] || w.order[i] !== O_MOVE && (ux - sl.ex) ** 2 + (uy - sl.ey) ** 2 > 400) {
      if (sl.unit === i) sl.unit = -1;
      w.pmode[i] = P_NONE;
      w.post[i] = -1;
    } else if ((ux - sl.ex) ** 2 + (uy - sl.ey) ** 2 < 196) w.pmode[i] = P_CLIMB;
    return false;
  }
  if (pm === P_POSTED || pm === P_CLIMB || pm === P_SHIFT) {
    if (!b.alive || b.owner !== w.team[i]) {
      // 脚下的墙塌了或易主了：就地解除
      if (sl.unit === i) sl.unit = -1;
      w.pmode[i] = P_NONE;
      w.post[i] = -1;
      w.wallRoute.delete(i);
      return false;
    }
    if (w.state[i] & S_ROUT) leavePost(w, i);
    else if (pm === P_POSTED) return false;
    else if (pm === P_SHIFT) return walkWall(w, i, d, sl);
  }
  // 过场：沿直线上墙 / 下墙
  const up = w.pmode[i] === P_CLIMB;
  const tx = up ? sl.x : sl.ex, ty = up ? sl.y : sl.ey;
  const dx = tx - ux, dy = ty - uy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const step = d.speed * DT;
  w.px[i] = ux;
  w.py[i] = uy;
  w.vx[i] = w.vy[i] = 0;
  w.engaged[i] = 0;
  w.planted[i] = 1;
  if (w.cd[i] > 0) w.cd[i] -= DT;
  if (w.atkAnim[i] > 0) w.atkAnim[i] -= DT;
  if (w.flash[i] > 0) w.flash[i] -= DT;
  if (dist <= step) {
    w.x[i] = tx;
    w.y[i] = ty;
    w.odo[i] += dist;
    if (up) {
      w.pmode[i] = P_POSTED;
      w.order[i] = O_HOLD;
      w.target[i] = w.otarget[i] = NONE;
      w.homeX[i] = tx;
      w.homeY[i] = ty;
      w.faceA[i] = sl.face;
      w.field[i] = null;
    } else {
      w.pmode[i] = P_NONE;
      w.post[i] = -1;
      w.homeX[i] = tx;
      w.homeY[i] = ty;
      // 下墙是为了换到另一段墙上去：接着走过去
      const nx = w.postNext[i];
      if (nx >= 0) {
        w.postNext[i] = -1;
        const ns = w.slots[nx], nb = w.buildings[ns.bld];
        if (ns.unit === i && nb.alive && nb.owner === w.team[i] && !(w.state[i] & S_ROUT)) sendToSlot(w, i, nx);
        else if (ns.unit === i) ns.unit = -1;
      }
    }
  } else {
    w.x[i] = ux + (dx / dist) * step;
    w.y[i] = uy + (dy / dist) * step;
    w.odo[i] += step;
    w.dir[i] = Math.atan2(dy, dx);
  }
  const under = w.nav.bld[w.cellAt(w.x[i], w.y[i])];
  const onWall = under >= 0 && w.buildings[under].def.top > 0;
  w.state[i] = (w.state[i] & S_ROUT) | (onWall ? S_WALL : 0);
  return true;
}

/** 让出「下墙后要去的」那个站位 */
export function releaseNext(w: World, i: number): void {
  const nx = w.postNext[i];
  if (nx < 0) return;
  if (w.slots[nx].unit === i) w.slots[nx].unit = -1;
  w.postNext[i] = -1;
}

/** 沿墙顶走向新站位：先走过沿途各格的中心，最后走到站位上；到了就照常坚守 */
function walkWall(w: World, i: number, d: UnitDef, sl: WallSlot): boolean {
  const route = w.wallRoute.get(i);
  const ux = w.x[i], uy = w.y[i];
  let tx = sl.x, ty = sl.y, last = true;
  if (route && route.length) {
    const c = route[0], mw = w.map.w;
    tx = (c % mw + 0.5) * TILE;
    ty = (((c / mw) | 0) + 0.5) * TILE;
    last = false;
  }
  const dx = tx - ux, dy = ty - uy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const step = d.speed * DT;
  w.px[i] = ux;
  w.py[i] = uy;
  w.vx[i] = w.vy[i] = 0;
  w.engaged[i] = 0;
  w.planted[i] = 1;
  w.target[i] = NONE;
  if (w.cd[i] > 0) w.cd[i] -= DT;
  if (w.atkAnim[i] > 0) w.atkAnim[i] -= DT;
  if (w.flash[i] > 0) w.flash[i] -= DT;
  if (dist <= step) {
    w.x[i] = tx;
    w.y[i] = ty;
    w.odo[i] += dist;
    if (!last) route!.shift();
    else {
      w.wallRoute.delete(i);
      w.pmode[i] = P_POSTED;
      w.homeX[i] = tx;
      w.homeY[i] = ty;
      w.faceA[i] = sl.face;
    }
  } else {
    w.x[i] = ux + (dx / dist) * step;
    w.y[i] = uy + (dy / dist) * step;
    w.odo[i] += step;
    w.dir[i] = Math.atan2(dy, dx);
  }
  w.state[i] = (w.state[i] & S_ROUT) | S_WALL;
  return true;
}

/**
 * 墙上的守军看到射程外的敌人，就沿墙顶挪到离那个敌人更近的空站位（只在同一段连通的墙顶上挪，不跨过门楼）。
 * 正在射击的、敌人已在射程内的不动。由据点系统定期调用。
 */
export function shiftPosts(w: World): void {
  if (!w.slots.length) return;
  const G = RULES.siege, alarm = RULES.site.alarm;
  let byGroup: Map<number, WallSlot[]> | null = null;
  for (let i = 0; i < w.n; i++) {
    if (!w.alive[i] || w.pmode[i] !== P_POSTED || w.state[i] & S_ROUT) continue;
    const t = w.target[i];
    if (t !== NONE && w.alive[t]) continue;
    const d = w.defs[w.type[i]], tm = w.team[i];
    const ux = w.x[i], uy = w.y[i];
    const e = w.findEnemy(ux, uy, tm, alarm, 0);
    if (e === NONE) continue;
    const ex = w.x[e], ey = w.y[e];
    const dist = Math.hypot(ex - ux, ey - uy);
    if (dist <= d.range * G.wallRange * G.shiftInRange) continue;
    const cur = w.slots[w.post[i]];
    if (!byGroup) {
      byGroup = new Map();
      for (const sl of w.slots) {
        let l = byGroup.get(sl.group);
        if (!l) byGroup.set(sl.group, (l = []));
        l.push(sl);
      }
    }
    let best = dist - G.shiftGain, pick: WallSlot | null = null;
    for (const sl of byGroup.get(cur.group)!) {
      if (sl.unit >= 0) continue;
      const b = w.buildings[sl.bld];
      if (!b.alive || b.owner !== tm) continue;
      const dd = Math.hypot(ex - sl.x, ey - sl.y);
      if (dd < best) {
        best = dd;
        pick = sl;
      }
    }
    if (!pick) {
      // 这一段墙上没有更近的空位：隔着门楼的另一段墙上有近得多的，就下墙走过去再上
      best = Math.min(best, dist - G.shiftFar);
      for (const sl of w.slots) {
        if (sl.unit >= 0 || sl.site !== cur.site || sl.group === cur.group) continue;
        const b = w.buildings[sl.bld];
        if (!b.alive || b.owner !== tm) continue;
        const dd = Math.hypot(ex - sl.x, ey - sl.y);
        if (dd < best) {
          best = dd;
          pick = sl;
        }
      }
      if (pick) {
        leavePost(w, i);
        pick.unit = i;
        w.postNext[i] = pick.id;
      }
      continue;
    }
    const route = wallPath(w, cur.cell, pick.cell);
    if (!route) continue;
    cur.unit = -1;
    pick.unit = i;
    w.post[i] = pick.id;
    w.pmode[i] = P_SHIFT;
    w.wallRoute.set(i, route);
  }
}

/** 墙顶上从 a 格走到 b 格要经过的格子（不含 a，含 b；b 由最后走向站位代替，所以去掉）；走不通返回 null */
function wallPath(w: World, a: number, b: number): number[] | null {
  if (a === b) return [];
  const mw = w.map.w, g = w.wallGroup.get(a);
  const prev = new Map<number, number>([[a, -1]]);
  const queue = [a];
  for (let h = 0; h < queue.length; h++) {
    const q = queue[h];
    if (q === b) break;
    for (let k = 0; k < 4; k++) {
      const n = q + NX[k] + NY[k] * mw;
      if (prev.has(n) || w.wallGroup.get(n) !== g) continue;
      prev.set(n, q);
      queue.push(n);
    }
  }
  if (!prev.has(b)) return null;
  const out: number[] = [];
  for (let c = prev.get(b)!; c !== a && c >= 0; c = prev.get(c)!) out.push(c);
  return out.reverse();
}

/** 这个据点还有几个空站位、一共几个（界面显示用） */
export function slotCount(w: World, site: number): { free: number; total: number } {
  let free = 0, total = 0;
  for (const sl of w.slots) {
    if (sl.site !== site || !w.buildings[sl.bld].alive) continue;
    total++;
    if (sl.unit < 0) free++;
  }
  return { free, total };
}
