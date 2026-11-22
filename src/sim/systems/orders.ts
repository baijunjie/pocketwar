/** 指令：移动、攻击、停止。溃逃中的单位不接受任何指令 */
import { TILE } from '../content';
import type { Field } from '../nav';
import { NONE, O_AMOVE, O_ATTACK, O_HOLD, O_IDLE, O_MOVE, S_ROUT } from '../state';
import type { Building, World } from '../world';
import { formation } from './formation';

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
  w.ignoreT[s] = 0;
  w.waitT[s] = 0;
  w.waits[s] = 0;
  w.avoidT[s] = 0;
}

export function orderMove(w: World, all: number[], tx: number, ty: number, amove: boolean): void {
  const units = obey(w, all);
  const n = units.length;
  if (!n) return;
  const tm = w.team[units[0]];
  const blk = w.nav.block[tm];
  const mw = w.map.w;
  tx = Math.min(w.W - 40, Math.max(40, tx));
  ty = Math.min(w.H - 40, Math.max(40, ty));
  let mx = 0, my = 0, slow = 1e9;
  for (const s of units) {
    mx += w.x[s];
    my += w.y[s];
    const wk = w.defs[w.type[s]].walk;
    if (wk < slow) slow = wk;
  }
  mx /= n;
  my /= n;
  const destCell = w.nav.nearestFree(tm, w.cellAt(tx, ty));
  if (blk[w.cellAt(tx, ty)]) {
    tx = (destCell % mw + 0.5) * TILE;
    ty = (((destCell / mw) | 0) + 0.5) * TILE;
  }
  const defIdxs = units.map(s => w.type[s]);
  const f = formation(w, defIdxs, tx, ty, tx - mx, ty - my, units);
  let field: Field | null = null;
  for (let m = 0; m < n; m++) {
    const s = units[m];
    let sx = Math.min(w.W - 24, Math.max(24, f.sx[m])), sy = Math.min(w.H - 24, Math.max(24, f.sy[m]));
    const c = w.cellAt(sx, sy);
    if (blk[c]) {
      const nc = w.nav.nearestFree(tm, c, 6);
      sx = (nc % mw + 0.5) * TILE;
      sy = (((nc / mw) | 0) + 0.5) * TILE;
    }
    w.order[s] = amove ? O_AMOVE : O_MOVE;
    w.target[s] = w.otarget[s] = NONE;
    w.destX[s] = sx;
    w.destY[s] = sy;
    w.destCell[s] = destCell;
    w.seekR[s] = f.radius + 48;
    // 同一道命令里的部队按最慢的那个行军，队形才不会散
    w.grpSpeed[s] = n > 1 ? slow : 0;
    reset(w, s);
    if (w.lineBlocked(w.x[s], w.y[s], sx, sy, blk)) {
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
  w.field[s] = w.lineBlocked(w.x[s], w.y[s], tx, ty, w.nav.block[tm]) ? w.nav.getField(tm, cell, w.tickCount) : null;
}

export function orderAttackUnit(w: World, all: number[], tgt: number): void {
  if (!w.alive[tgt]) return;
  for (const s of obey(w, all)) {
    const tm = w.team[s];
    if (w.team[tgt] === tm) continue;
    w.order[s] = O_ATTACK;
    w.target[s] = w.otarget[s] = tgt;
    w.targetUid[s] = w.otargetUid[s] = w.uid[tgt];
    w.grpSpeed[s] = 0;
    retarget(w, s, tm, w.x[tgt], w.y[tgt]);
    reset(w, s);
  }
}

export function orderAttackBuilding(w: World, all: number[], b: Building): void {
  if (!b.alive) return;
  for (const s of obey(w, all)) {
    const tm = w.team[s];
    // 城防工事只有工程类单位打得动
    if (b.owner === tm || (b.def.fort && !w.defs[w.type[s]].siege)) continue;
    w.order[s] = O_ATTACK;
    w.target[s] = w.otarget[s] = -b.id - 2;
    w.destX[s] = b.cx;
    w.destY[s] = b.cy;
    w.destCell[s] = b.ty * w.map.w + b.tx;
    w.seekR[s] = 0;
    w.grpSpeed[s] = 0;
    w.field[s] = w.nav.getBuildingField(tm, b, w.tickCount);
    reset(w, s);
  }
}

export function orderStop(w: World, all: number[], hold: boolean): void {
  for (const s of obey(w, all)) {
    w.order[s] = hold ? O_HOLD : O_IDLE;
    w.target[s] = w.otarget[s] = NONE;
    w.homeX[s] = w.x[s];
    w.homeY[s] = w.y[s];
    w.field[s] = null;
    w.grpSpeed[s] = 0;
    reset(w, s);
  }
}

/** 点燃 / 熄灭火把（只对会打火把的兵种有意义；夜里不下雨时才真的点着） */
export function orderTorch(w: World, all: number[], on: boolean): void {
  for (const s of obey(w, all)) w.torchOff[s] = on ? 0 : 1;
}
