/** 指令：移动、攻击、停止。溃逃中的单位不接受任何指令 */
import { RULES, TILE } from '../content';
import type { Field } from '../nav';
import { NONE, O_AMOVE, O_ATTACK, O_HOLD, O_IDLE, O_MOVE, S_ROUT } from '../state';
import type { Building, World } from '../world';
import { formation } from './formation';
import type { Formation } from './formation';
import { P_POSTED, P_SHIFT, leavePost } from './garrison';
import { createMarch, rerouteMarch } from './march';
import { canAttackBuilding } from './targeting';

function obey(w: World, units: number[]): number[] {
  let ok = true;
  for (const s of units) if (!w.alive[s] || w.state[s] & S_ROUT) {
    ok = false;
    break;
  }
  return ok ? units : units.filter(s => w.alive[s] && !(w.state[s] & S_ROUT));
}

function reset(w: World, s: number): void {
  w.stuck[s] = 0;
  w.bestD[s] = 1e9;
  w.noGain[s] = 0;
  w.ignoreT[s] = 0;
  w.waitT[s] = 0;
  w.waits[s] = 0;
  w.detourT[s] = 0;
  w.avoidT[s] = w.bldSkipT[s] = 0;
  w.wayUid[s] = w.wayNoT[s] = w.wallUid[s] = 0;
}

/**
 * @param fx, fy 到位后队列面朝的方向；都为 0 时取行进方向
 */
export function orderMove(w: World, all: number[], tx: number, ty: number, amove: boolean, fx = 0, fy = 0): void {
  const units = obey(w, all);
  const n = units.length;
  if (!n) return;
  const tm = w.team[units[0]];
  const blk = w.nav.block[tm];
  const mw = w.map.w;
  tx = Math.min(w.W - 40, Math.max(40, tx));
  ty = Math.min(w.H - 40, Math.max(40, ty));
  let mx = 0, my = 0, slow = 1e9, slowRun = 1e9;
  for (const s of units) {
    mx += w.x[s];
    my += w.y[s];
    const d = w.defs[w.type[s]];
    if (d.walk < slow) slow = d.walk;
    if (d.speed < slowRun) slowRun = d.speed;
  }
  mx /= n;
  my /= n;
  if (!fx && !fy) {
    fx = tx - mx;
    fy = ty - my;
  }
  const fl = Math.hypot(fx, fy);
  if (fl < 1e-3) {
    fx = 0;
    fy = -1;
  } else {
    fx /= fl;
    fy /= fl;
  }
  // 这道命令里的人正好是某一个编队的全部成员
  const g0 = w.grp[units[0]];
  const g = n > 1 && g0 >= 0 ? w.marches[g0] : null;
  const whole = !!g && g.alive && !g.arrived && g.n === n && units.every(s => w.grp[s] === g0);
  // 同一队人重复收到去同一处的命令（电脑指挥官常这样）：沿用现有的编队，不重新整队
  // 从攻击移动切到普通移动时，要清除主动索敌留下的目标。
  if (whole && (!g.amove || amove) && (g.destX - tx) ** 2 + (g.destY - ty) ** 2 < 48 * 48) {
    g.amove = amove;
    for (const s of units) if (w.order[s] === O_MOVE || w.order[s] === O_AMOVE) w.order[s] = amove ? O_AMOVE : O_MOVE;
    return;
  }
  const destCell = w.nav.nearestFree(tm, w.cellAt(tx, ty));
  if (destCell !== w.cellAt(tx, ty)) {
    tx = (destCell % mw + 0.5) * TILE;
    ty = (((destCell / mw) | 0) + 0.5) * TILE;
  }
  // 行军途中改去别处、又不用掉头：不重新整队，队列照旧，最前排直接拐过去（在打、被挡住的照常重新整队）
  const kept = whole && !g.loose && !g.blocked && rerouteMarch(w, g, tx, ty, destCell, amove, fx, fy) ? g : null;
  let f: Formation | null = null;
  let field: Field | null = null;
  let march = -1, radius: number, keptFront = 0;
  if (kept) {
    march = kept.id;
    radius = Math.hypot(kept.width, kept.depth) / 2;
    // 最前排相对队列中心的偏移：落点照原来的队列偏移、按新的朝向排在新目的地
    keptFront = kept.depth / 2 - kept.rowD[0] / 2;
  } else {
    f = formation(w, units.map(s => w.type[s]), tx, ty, fx, fy, units);
    radius = f.radius;
    // 编队行军：散得太开的不编（否则全军要先跑到重心集合）
    if (n > 1) {
      let sp2 = 0;
      for (const s of units) sp2 += (w.x[s] - mx) ** 2 + (w.y[s] - my) ** 2;
      if (Math.sqrt(sp2 / n) <= RULES.march.maxSpread && (tx - mx) ** 2 + (ty - my) ** 2 > 60 * 60) {
        march = createMarch(w, tm, mx, my, tx, ty, destCell, slow, slowRun, amove, fx, fy, n, f).id;
      }
    }
  }
  const face = Math.atan2(fy, fx);
  // 行军时最前排走在最前面：队列位置都排在它身后
  let front = -1e9;
  if (f) for (let m = 0; m < n; m++) if (f.fa[m] > front) front = f.fa[m];
  for (let m = 0; m < n; m++) {
    const s = units[m];
    let sx: number, sy: number;
    if (f) {
      sx = f.sx[m];
      sy = f.sy[m];
    } else {
      const fa = w.offA[s] + keptFront, fl = w.offL[s];
      sx = tx - fy * fl + fx * fa;
      sy = ty + fx * fl + fy * fa;
    }
    sx = Math.min(w.W - 24, Math.max(24, sx));
    sy = Math.min(w.H - 24, Math.max(24, sy));
    const c = w.cellAt(sx, sy);
    if (blk[c] || w.nav.deck[tm][c]) {
      const nc = w.nav.nearestFree(tm, c, 6);
      sx = (nc % mw + 0.5) * TILE;
      sy = (((nc / mw) | 0) + 0.5) * TILE;
    }
    // 站位和落点之间隔着墙（或者一个在墙顶、一个在墙下）：往落点收拢，直到走得通
    if (w.lineBlocked(tx, ty, sx, sy, tm)) {
      for (let k = 1; k <= 8; k++) {
        const px = sx + (tx - sx) * k / 8, py = sy + (ty - sy) * k / 8;
        if (k === 8 || !w.lineBlocked(tx, ty, px, py, tm)) {
          sx = px;
          sy = py;
          break;
        }
      }
    }
    leavePost(w, s);
    if (f) {
      w.grp[s] = march;
      w.offA[s] = f.fa[m] - front;
      w.offL[s] = f.fl[m];
      w.marchRow[s] = f.row[m];
      w.marchCol[s] = f.col[m];
    }
    w.faceA[s] = face;
    w.order[s] = amove ? O_AMOVE : O_MOVE;
    w.target[s] = w.otarget[s] = NONE;
    w.destX[s] = sx;
    w.destY[s] = sy;
    w.destCell[s] = destCell;
    w.seekR[s] = radius + 48;
    // 同一道命令里的部队按最慢的那个行军，队形才不会散
    w.grpSpeed[s] = n > 1 ? slow : 0;
    reset(w, s);
    if (march >= 0 || w.lineBlocked(w.x[s], w.y[s], sx, sy, tm)) {
      field ??= w.nav.getField(tm, destCell, w.tickCount);
      w.field[s] = field;
    } else w.field[s] = null;
  }
}

/** 重新规划到某一点的路线（追击移动目标时用） */
export function retarget(w: World, s: number, tm: number, tx: number, ty: number): void {
  const cell = w.nav.nearestFree(tm, w.cellAt(tx, ty));
  w.destX[s] = tx;
  w.destY[s] = ty;
  w.destCell[s] = cell;
  w.seekR[s] = 0;
  w.field[s] = w.lineBlocked(w.x[s], w.y[s], tx, ty, tm) ? w.nav.getField(tm, cell, w.tickCount) : null;
}

export function orderAttackUnit(w: World, all: number[], tgt: number): void {
  if (!w.alive[tgt]) return;
  for (const s of obey(w, all)) {
    const tm = w.team[s];
    if (w.team[tgt] === tm) continue;
    leavePost(w, s);
    w.order[s] = O_ATTACK;
    w.target[s] = w.otarget[s] = tgt;
    w.targetUid[s] = w.otargetUid[s] = w.uid[tgt];
    w.grpSpeed[s] = 0;
    w.grp[s] = -1;
    retarget(w, s, tm, w.x[tgt], w.y[tgt]);
    reset(w, s);
  }
}

export function orderAttackBuilding(w: World, all: number[], b: Building): void {
  if (!b.alive) return;
  for (const s of obey(w, all)) {
    const tm = w.team[s];
    // 普通建筑不可攻击，城防工事只有工程类单位打得动
    if (!canAttackBuilding(b, tm, w.defs[w.type[s]].siege)) continue;
    leavePost(w, s);
    w.order[s] = O_ATTACK;
    w.target[s] = w.otarget[s] = -b.id - 2;
    w.destX[s] = b.cx;
    w.destY[s] = b.cy;
    w.destCell[s] = b.ty * w.map.w + b.tx;
    w.seekR[s] = 0;
    w.grpSpeed[s] = 0;
    w.grp[s] = -1;
    w.field[s] = w.nav.getBuildingField(tm, b, w.tickCount);
    reset(w, s);
  }
}

export function orderStop(w: World, all: number[], hold: boolean): void {
  for (const s of obey(w, all)) {
    // 已经在垛口上的：坚守就是留在原位
    if (hold && (w.pmode[s] === P_POSTED || w.pmode[s] === P_SHIFT)) continue;
    leavePost(w, s);
    w.order[s] = hold ? O_HOLD : O_IDLE;
    w.target[s] = w.otarget[s] = NONE;
    w.homeX[s] = w.x[s];
    w.homeY[s] = w.y[s];
    w.field[s] = null;
    w.grpSpeed[s] = 0;
    w.grp[s] = -1;
    w.faceA[s] = w.dir[s];
    reset(w, s);
  }
}

/** 点燃 / 熄灭火把（只对会打火把的兵种有意义；夜里不下雨时才真的点着） */
export function orderTorch(w: World, all: number[], on: boolean): void {
  for (const s of obey(w, all)) w.torchOff[s] = on ? 0 : 1;
}
