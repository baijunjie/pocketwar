/**
 * 城墙驻守：墙顶不能随意走动，只有固定的垛口位。城里的远程步兵接到「驻守」命令后走到墙根、登上分给自己的垛口，
 * 在那里原地坚守；接到别的命令就先下墙再照办。垛口满了就不能再上人。
 * 上下墙是一段按直线走的「过场」，不走寻路也不参与碰撞。
 */
import { DT, RULES, TILE, UnitDef } from '../content';
import { NONE, O_HOLD, O_MOVE, S_ROUT, S_WALL } from '../state';
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
  /** 脚下那段墙（或角楼） */
  bld: number;
  /** 占着这个位置的单位，-1 表示空着 */
  unit: number;
}

/** 单位的驻守进度 */
export const P_NONE = 0, P_GOING = 1, P_CLIMB = 2, P_POSTED = 3, P_DESCEND = 4;

const NX = [1, 0, -1, 0], NY = [0, 1, 0, -1];

/** 给各据点的城墙排出垛口位：墙顶上紧挨城外的那一圈格子，每格一个（开局圈出城内之后调用） */
export function buildSlots(w: World): void {
  const nav = w.nav, mw = w.map.w, mh = w.map.h;
  const inner = nav.inner, bld = nav.bld;
  const top = (c: number): boolean => bld[c] >= 0 && w.buildings[bld[c]].def.top > 0;
  w.slots.length = 0;
  const reach = RULES.siege.slotReach;
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
        const ol = Math.hypot(ox, oy);
        w.slots.push({
          id: w.slots.length, x: (tx + 0.5) * TILE + (ox / ol) * 6, y: (ty + 0.5) * TILE + (oy / ol) * 6, face: Math.atan2(oy, ox),
          ex: (entry % mw + 0.5) * TILE, ey: (((entry / mw) | 0) + 0.5) * TILE, site: s.id, bld: id, unit: -1,
        });
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
    const sl = w.slots[pick];
    sl.unit = i;
    w.post[i] = pick;
    w.pmode[i] = P_GOING;
    // 走到墙根
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
    w.field[i] = w.lineBlocked(ux, uy, sl.ex, sl.ey, tm) ? w.nav.getField(tm, cell, w.tickCount) : null;
    sent++;
  }
  return !able ? -1 : !inTown ? -2 : sent;
}

/** 腾出垛口。已经在墙上（或正在上墙）的先走下来，再去做别的 */
export function leavePost(w: World, i: number): void {
  const pm = w.pmode[i];
  if (pm === P_NONE || pm === P_DESCEND) return;
  const sl = w.slots[w.post[i]];
  if (sl.unit === i) sl.unit = -1;
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
  if (pm === P_POSTED || pm === P_CLIMB) {
    if (!b.alive || b.owner !== w.team[i]) {
      // 脚下的墙塌了或易主了：就地解除
      if (sl.unit === i) sl.unit = -1;
      w.pmode[i] = P_NONE;
      w.post[i] = -1;
      return false;
    }
    if (w.state[i] & S_ROUT) leavePost(w, i);
    else if (pm === P_POSTED) return false;
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

/** 这个据点还有几个空垛口、一共几个（界面显示用） */
export function slotCount(w: World, site: number): { free: number; total: number } {
  let free = 0, total = 0;
  for (const sl of w.slots) {
    if (sl.site !== site || !w.buildings[sl.bld].alive) continue;
    total++;
    if (sl.unit < 0) free++;
  }
  return { free, total };
}
