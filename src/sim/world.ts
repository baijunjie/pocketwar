/** 世界模拟：单位（SoA）、战斗、投射物、建筑、据点与援军。不依赖 DOM，可在 Node 中无头运行。 */
import {
  A_MELEE, A_PIERCE, BK_GATE, BuildingDef, C_CAV, C_CAVR, C_SIEGE, DT, FactionDef, PROJ_SPEED, P_BALL, P_BULLET,
  P_ROCKET, SITE_HQ, SITE_INFO, TERRAIN_SPEED, TILE, TOWER_ATTACKER, TR_BRACE, TR_BUSHIDO, TR_FIREMOVE, TR_TESTUDO,
  TR_TRAMPLE, T_FOREST, T_HILL, UNITS, UNIT_BY_KEY, UnitDef,
} from './defs';
import { GameMap } from './map';
import { DIRX, DIRY, Field, Nav } from './nav';
import { RNG } from './rng';

export const MAX_UNITS = 8192;
export const MAX_PROJ = 4096;
export const MAX_CORPSE = 2048;
export const NONE = -1;
export const O_IDLE = 0, O_MOVE = 1, O_AMOVE = 2, O_ATTACK = 3, O_HOLD = 4;
export const GRID = 40;
const COARSE = 320;
export const VIS_CELL = 64;
const LEASH = 330;

export const FX_HIT = 1, FX_EXPLODE = 2, FX_SMOKE = 3, FX_DEATH = 4, FX_COLLAPSE = 5, FX_ARROW_HIT = 6;

export interface Building {
  id: number;
  def: BuildingDef;
  tx: number;
  ty: number;
  w: number;
  h: number;
  /** 占地矩形（世界坐标） */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  cx: number;
  cy: number;
  hp: number;
  owner: number;
  alive: boolean;
  gate: boolean;
  breach: number;
  site: number;
  cd: number;
  /** 外观风格（主堡按阵营区分） */
  style: string;
  variant: number;
  hitTick: number;
}

export interface Site {
  id: number;
  type: number;
  name: string;
  x: number;
  y: number;
  radius: number;
  owner: number;
  /** 正在夺取的一方及进度 0..1 */
  capTeam: number;
  cap: number;
  timer: number;
  interval: number;
  buildings: number[];
  main: number;
  disabled: boolean;
  /** 圈内各队人数 */
  count: number[];
}

export type SimEvent =
  | { kind: 'captured'; site: number; team: number; from: number }
  | { kind: 'reinforce'; site: number; team: number; count: number }
  | { kind: 'razed'; site: number; team: number }
  | { kind: 'gameover'; winner: number };

export class World {
  readonly nav: Nav;
  readonly rng: RNG;
  /** 世界尺寸（像素） */
  readonly W: number;
  readonly H: number;
  tickCount = 0;
  time = 0;
  winner = 0;
  humanTeam = 1;
  fog = true;
  factions: (FactionDef | null)[] = [null, null, null];
  reinfMult = [1, 1, 1];
  unitCap = [0, 900, 900];
  rally = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }];
  onReinforce: ((team: number, slots: number[]) => void) | null = null;

  // ---- 单位 SoA ----
  n = 0;
  readonly alive = new Uint8Array(MAX_UNITS);
  readonly uid = new Uint32Array(MAX_UNITS);
  readonly team = new Uint8Array(MAX_UNITS);
  readonly type = new Uint16Array(MAX_UNITS);
  readonly rad = new Float32Array(MAX_UNITS);
  readonly x = new Float32Array(MAX_UNITS);
  readonly y = new Float32Array(MAX_UNITS);
  readonly px = new Float32Array(MAX_UNITS);
  readonly py = new Float32Array(MAX_UNITS);
  readonly vx = new Float32Array(MAX_UNITS);
  readonly vy = new Float32Array(MAX_UNITS);
  readonly hp = new Float32Array(MAX_UNITS);
  readonly facing = new Int8Array(MAX_UNITS);
  /** 朝向角（弧度，atan2(dy, dx)），供立体渲染使用；平滑转向 */
  readonly dir = new Float32Array(MAX_UNITS);
  readonly order = new Uint8Array(MAX_UNITS);
  readonly target = new Int32Array(MAX_UNITS);
  readonly targetUid = new Uint32Array(MAX_UNITS);
  /** 玩家明确指定的攻击目标（途中临时目标清除后恢复） */
  readonly otarget = new Int32Array(MAX_UNITS);
  readonly otargetUid = new Uint32Array(MAX_UNITS);
  readonly cd = new Float32Array(MAX_UNITS);
  readonly auxCd = new Float32Array(MAX_UNITS);
  readonly atkAnim = new Float32Array(MAX_UNITS);
  readonly flash = new Float32Array(MAX_UNITS);
  readonly anim = new Float32Array(MAX_UNITS);
  readonly destX = new Float32Array(MAX_UNITS);
  readonly destY = new Float32Array(MAX_UNITS);
  readonly destCell = new Int32Array(MAX_UNITS);
  readonly seekR = new Float32Array(MAX_UNITS);
  readonly homeX = new Float32Array(MAX_UNITS);
  readonly homeY = new Float32Array(MAX_UNITS);
  readonly stuck = new Float32Array(MAX_UNITS);
  readonly ignoreT = new Float32Array(MAX_UNITS);
  readonly chargeT = new Float32Array(MAX_UNITS);
  readonly engaged = new Uint8Array(MAX_UNITS);
  readonly field: (Field | null)[] = new Array(MAX_UNITS).fill(null);
  private readonly free = new Int32Array(MAX_UNITS);
  private freeN = 0;
  private nextUid = 1;
  readonly teamCount = [0, 0, 0];
  readonly kills = [0, 0, 0];
  readonly lost = [0, 0, 0];
  readonly arrived = [0, 0, 0];
  readonly defs = UNITS;

  // ---- 空间网格 ----
  readonly gw: number;
  readonly gh: number;
  private readonly cellStart: Int32Array;
  private readonly cellCur: Int32Array;
  private readonly items = new Int32Array(MAX_UNITS);
  private readonly cw: number;
  private readonly ch: number;
  private readonly pres: Uint16Array[];

  // ---- 建筑与据点 ----
  readonly buildings: Building[] = [];
  private armed: Building[] = [];
  readonly sites: Site[] = [];

  // ---- 投射物 ----
  pn = 0;
  readonly pType = new Uint8Array(MAX_PROJ);
  readonly pSx = new Float32Array(MAX_PROJ);
  readonly pSy = new Float32Array(MAX_PROJ);
  readonly pTx = new Float32Array(MAX_PROJ);
  readonly pTy = new Float32Array(MAX_PROJ);
  readonly pT = new Float32Array(MAX_PROJ);
  readonly pDur = new Float32Array(MAX_PROJ);
  private readonly pDmg = new Float32Array(MAX_PROJ);
  private readonly pAtk = new Uint8Array(MAX_PROJ);
  private readonly pSplash = new Float32Array(MAX_PROJ);
  private readonly pPen = new Float32Array(MAX_PROJ);
  private readonly pDef = new Int16Array(MAX_PROJ);
  readonly pTeam = new Uint8Array(MAX_PROJ);
  private readonly pTgt = new Int32Array(MAX_PROJ);
  private readonly pTgtUid = new Uint32Array(MAX_PROJ);
  private readonly pSrc = new Int32Array(MAX_PROJ);
  private readonly pSrcUid = new Uint32Array(MAX_PROJ);

  // ---- 尸体（环形缓冲，仅供渲染） ----
  corpseN = 0;
  readonly cX = new Float32Array(MAX_CORPSE);
  readonly cY = new Float32Array(MAX_CORPSE);
  readonly cType = new Uint16Array(MAX_CORPSE);
  readonly cTeam = new Uint8Array(MAX_CORPSE);
  readonly cFace = new Int8Array(MAX_CORPSE);
  readonly cDir = new Float32Array(MAX_CORPSE);
  readonly cTick = new Int32Array(MAX_CORPSE).fill(-99999);

  // ---- 特效事件（每帧由渲染层取走） ----
  fxN = 0;
  readonly fx = new Float32Array(4096 * 4);
  events: SimEvent[] = [];

  // ---- 视野 ----
  readonly vw: number;
  readonly vh: number;
  readonly vis: Uint8Array;
  readonly explored: Uint8Array;
  private readonly visStamp: Uint8Array;

  constructor(readonly map: GameMap, seed: number) {
    this.rng = new RNG(seed ^ 0x5bd1e995);
    this.W = map.w * TILE;
    this.H = map.h * TILE;
    this.nav = new Nav(map.w, map.h, map.terrain);
    this.gw = Math.ceil(this.W / GRID);
    this.gh = Math.ceil(this.H / GRID);
    this.cellStart = new Int32Array(this.gw * this.gh + 1);
    this.cellCur = new Int32Array(this.gw * this.gh);
    this.cw = Math.ceil(this.W / COARSE);
    this.ch = Math.ceil(this.H / COARSE);
    this.pres = [new Uint16Array(0), new Uint16Array(this.cw * this.ch), new Uint16Array(this.cw * this.ch)];
    this.vw = Math.ceil(this.W / VIS_CELL);
    this.vh = Math.ceil(this.H / VIS_CELL);
    this.vis = new Uint8Array(this.vw * this.vh);
    this.explored = new Uint8Array(this.vw * this.vh);
    this.visStamp = new Uint8Array(this.vw * this.vh);
    this.target.fill(NONE);
    this.otarget.fill(NONE);
  }

  // =====================================================================
  // 搭建
  // =====================================================================
  addBuilding(def: BuildingDef, tx: number, ty: number, owner: number, site: number, style = ''): Building {
    const b: Building = {
      id: this.buildings.length, def, tx, ty, w: def.w, h: def.h,
      x0: tx * TILE, y0: ty * TILE, x1: (tx + def.w) * TILE, y1: (ty + def.h) * TILE,
      cx: (tx + def.w / 2) * TILE, cy: (ty + def.h / 2) * TILE,
      hp: def.hp, owner, alive: true, gate: def.kind === BK_GATE, breach: def.breach, site,
      cd: this.rng.next(), style, variant: this.rng.int(0, 3), hitTick: -999,
    };
    this.buildings.push(b);
    if (def.tower) this.armed.push(b);
    this.nav.refresh(b);
    return b;
  }

  spawnUnit(defIdx: number, tm: number, ux: number, uy: number): number {
    let i: number;
    if (this.freeN > 0) i = this.free[--this.freeN];
    else if (this.n < MAX_UNITS) i = this.n++;
    else return NONE;
    const d = this.defs[defIdx];
    this.alive[i] = 1;
    this.uid[i] = this.nextUid++;
    this.team[i] = tm;
    this.type[i] = defIdx;
    this.rad[i] = d.radius;
    this.x[i] = this.px[i] = ux;
    this.y[i] = this.py[i] = uy;
    this.vx[i] = this.vy[i] = 0;
    this.hp[i] = d.hp;
    this.facing[i] = tm === 1 ? 1 : -1;
    this.dir[i] = tm === 1 ? 0 : Math.PI;
    this.order[i] = O_IDLE;
    this.target[i] = this.otarget[i] = NONE;
    this.cd[i] = this.rng.next() * d.cd;
    this.auxCd[i] = 0;
    this.atkAnim[i] = this.flash[i] = 0;
    this.anim[i] = this.rng.next() * 4;
    this.destX[i] = this.homeX[i] = ux;
    this.destY[i] = this.homeY[i] = uy;
    this.stuck[i] = this.ignoreT[i] = this.chargeT[i] = 0;
    this.engaged[i] = 0;
    this.field[i] = null;
    this.teamCount[tm]++;
    return i;
  }

  /** 以阵型生成一队单位，返回槽位列表 */
  spawnGroup(tm: number, defIdxs: number[], cx: number, cy: number, dx: number, dy: number): number[] {
    const f = this.formation(defIdxs, cx, cy, dx, dy, null);
    const out: number[] = [];
    const blk = this.nav.block[tm];
    for (let m = 0; m < defIdxs.length; m++) {
      let sx = Math.min(this.W - 40, Math.max(40, f.sx[m])), sy = Math.min(this.H - 40, Math.max(40, f.sy[m]));
      const c = this.cellAt(sx, sy);
      if (blk[c]) {
        const nc = this.nav.nearestFree(tm, c);
        sx = (nc % this.map.w + 0.5) * TILE;
        sy = (((nc / this.map.w) | 0) + 0.5) * TILE;
      }
      const s = this.spawnUnit(defIdxs[m], tm, sx, sy);
      if (s !== NONE) out.push(s);
    }
    return out;
  }

  cellAt(wx: number, wy: number): number {
    return ((wy / TILE) | 0) * this.map.w + ((wx / TILE) | 0);
  }

  /**
   * 阵型站位。前排近战、其后骑兵、再后远程、器械殿后。
   * @param pos 若提供（单位槽位），按现有位置就近分配以减少交叉
   */
  formation(defIdxs: number[], cx: number, cy: number, dx: number, dy: number, pos: number[] | null):
    { sx: Float32Array; sy: Float32Array; radius: number } {
    const n = defIdxs.length;
    const sx = new Float32Array(n), sy = new Float32Array(n);
    const dl = Math.hypot(dx, dy);
    if (dl < 1e-4) {
      dx = 0;
      dy = -1;
    } else {
      dx /= dl;
      dy /= dl;
    }
    const lx = -dy, ly = dx; // 横向
    const along = new Float32Array(n), lat = new Float32Array(n);
    if (pos) {
      for (let m = 0; m < n; m++) {
        const s = pos[m];
        along[m] = this.x[s] * dx + this.y[s] * dy;
        lat[m] = this.x[s] * lx + this.y[s] * ly;
      }
    }
    const defs = this.defs;
    const idx = Array.from({ length: n }, (_, i) => i);
    idx.sort((a, b) => defs[defIdxs[a]].row - defs[defIdxs[b]].row || along[b] - along[a] || a - b);
    let area = 0;
    for (let m = 0; m < n; m++) {
      const sp = defs[defIdxs[m]].radius * 2 + 3;
      area += sp * sp;
    }
    const width = Math.max(48, Math.sqrt(area * 2.6));
    // 分行
    const rows: number[][] = [];
    let cur: number[] = [], curW = 0, curRow = -1;
    for (const m of idx) {
      const d = defs[defIdxs[m]];
      const sp = d.radius * 2 + 3;
      if (cur.length && (curW + sp > width || d.row !== curRow)) {
        rows.push(cur);
        cur = [];
        curW = 0;
      }
      curRow = d.row;
      cur.push(m);
      curW += sp;
    }
    if (cur.length) rows.push(cur);
    let depth = 0;
    const rowDepth: number[] = [];
    for (const r of rows) {
      let mx = 0;
      for (const m of r) mx = Math.max(mx, defs[defIdxs[m]].radius * 2 + 3);
      rowDepth.push(mx);
      depth += mx;
    }
    let dAcc = 0;
    for (let ri = 0; ri < rows.length; ri++) {
      const r = rows[ri];
      if (pos) r.sort((a, b) => lat[a] - lat[b]);
      let w = 0;
      for (const m of r) w += defs[defIdxs[m]].radius * 2 + 3;
      let xo = -w / 2;
      const fwd = depth / 2 - dAcc - rowDepth[ri] / 2;
      for (const m of r) {
        const sp = defs[defIdxs[m]].radius * 2 + 3;
        const l = xo + sp / 2;
        sx[m] = cx + lx * l + dx * fwd;
        sy[m] = cy + ly * l + dy * fwd;
        xo += sp;
      }
      dAcc += rowDepth[ri];
    }
    return { sx, sy, radius: Math.hypot(width, depth) / 2 };
  }

  // =====================================================================
  // 指令
  // =====================================================================
  orderMove(units: number[], tx: number, ty: number, amove: boolean): void {
    const n = units.length;
    if (!n) return;
    const tm = this.team[units[0]];
    const blk = this.nav.block[tm];
    const w = this.map.w;
    tx = Math.min(this.W - 40, Math.max(40, tx));
    ty = Math.min(this.H - 40, Math.max(40, ty));
    let mx = 0, my = 0;
    for (const s of units) {
      mx += this.x[s];
      my += this.y[s];
    }
    mx /= n;
    my /= n;
    const destCell = this.nav.nearestFree(tm, this.cellAt(tx, ty));
    if (blk[this.cellAt(tx, ty)]) {
      tx = (destCell % w + 0.5) * TILE;
      ty = (((destCell / w) | 0) + 0.5) * TILE;
    }
    const defIdxs = units.map(s => this.type[s]);
    const f = this.formation(defIdxs, tx, ty, tx - mx, ty - my, units);
    let field: Field | null = null;
    for (let m = 0; m < n; m++) {
      const s = units[m];
      let sx = Math.min(this.W - 24, Math.max(24, f.sx[m])), sy = Math.min(this.H - 24, Math.max(24, f.sy[m]));
      const c = this.cellAt(sx, sy);
      if (blk[c]) {
        const nc = this.nav.nearestFree(tm, c, 6);
        sx = (nc % w + 0.5) * TILE;
        sy = (((nc / w) | 0) + 0.5) * TILE;
      }
      this.order[s] = amove ? O_AMOVE : O_MOVE;
      this.target[s] = this.otarget[s] = NONE;
      this.destX[s] = sx;
      this.destY[s] = sy;
      this.destCell[s] = destCell;
      this.seekR[s] = f.radius + 48;
      this.stuck[s] = 0;
      this.ignoreT[s] = 0;
      if (this.lineBlocked(this.x[s], this.y[s], sx, sy, blk)) {
        field ??= this.nav.getField(tm, destCell, this.tickCount);
        this.field[s] = field;
      } else this.field[s] = null;
    }
  }

  orderAttackUnit(units: number[], tgt: number): void {
    if (!this.alive[tgt]) return;
    for (const s of units) {
      const tm = this.team[s];
      if (this.team[tgt] === tm) continue;
      this.order[s] = O_ATTACK;
      this.target[s] = this.otarget[s] = tgt;
      this.targetUid[s] = this.otargetUid[s] = this.uid[tgt];
      this.retarget(s, tm, this.x[tgt], this.y[tgt]);
      this.stuck[s] = 0;
      this.ignoreT[s] = 0;
    }
  }

  private retarget(s: number, tm: number, tx: number, ty: number): void {
    const cell = this.nav.nearestFree(tm, this.cellAt(tx, ty));
    this.destX[s] = tx;
    this.destY[s] = ty;
    this.destCell[s] = cell;
    this.seekR[s] = 0;
    this.field[s] = this.lineBlocked(this.x[s], this.y[s], tx, ty, this.nav.block[tm])
      ? this.nav.getField(tm, cell, this.tickCount) : null;
  }

  orderAttackBuilding(units: number[], b: Building): void {
    if (!b.alive) return;
    for (const s of units) {
      const tm = this.team[s];
      if (b.owner === tm) continue;
      this.order[s] = O_ATTACK;
      this.target[s] = this.otarget[s] = -b.id - 2;
      this.destX[s] = b.cx;
      this.destY[s] = b.cy;
      this.destCell[s] = b.ty * this.map.w + b.tx;
      this.seekR[s] = 0;
      this.field[s] = this.nav.getBuildingField(tm, b, this.tickCount);
      this.stuck[s] = 0;
      this.ignoreT[s] = 0;
    }
  }

  orderStop(units: number[], hold: boolean): void {
    for (const s of units) {
      this.order[s] = hold ? O_HOLD : O_IDLE;
      this.target[s] = this.otarget[s] = NONE;
      this.homeX[s] = this.x[s];
      this.homeY[s] = this.y[s];
      this.field[s] = null;
    }
  }

  /** 两点之间是否被本队不可通行的格子挡住 */
  lineBlocked(ax: number, ay: number, bx: number, by: number, blk: Uint8Array): boolean {
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy);
    const steps = Math.ceil(len / 20);
    const w = this.map.w;
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      if (blk[(((ay + dy * t) / TILE) | 0) * w + (((ax + dx * t) / TILE) | 0)]) return true;
    }
    return false;
  }

  // =====================================================================
  // 帧推进
  // =====================================================================
  tick(): void {
    this.tickCount++;
    this.time += DT;
    this.buildGrid();
    this.updateUnits();
    this.updateProjectiles();
    this.updateBuildings();
    if (this.tickCount % 15 === 0) this.updateSites();
    if (this.tickCount % 6 === 1) this.updateVision();
    this.nav.maintain(this.tickCount);
  }

  private buildGrid(): void {
    const cs = this.cellStart, cur = this.cellCur, gw = this.gw, cw = this.cw;
    cur.fill(0);
    this.pres[1].fill(0);
    this.pres[2].fill(0);
    const n = this.n;
    for (let i = 0; i < n; i++) {
      if (!this.alive[i]) continue;
      cur[((this.y[i] / GRID) | 0) * gw + ((this.x[i] / GRID) | 0)]++;
      this.pres[this.team[i]][((this.y[i] / COARSE) | 0) * cw + ((this.x[i] / COARSE) | 0)]++;
    }
    let acc = 0;
    const cells = cur.length;
    for (let c = 0; c < cells; c++) {
      cs[c] = acc;
      acc += cur[c];
      cur[c] = 0;
    }
    cs[cells] = acc;
    for (let i = 0; i < n; i++) {
      if (!this.alive[i]) continue;
      const c = ((this.y[i] / GRID) | 0) * gw + ((this.x[i] / GRID) | 0);
      this.items[cs[c] + cur[c]++] = i;
    }
  }

  /** 最近的敌方单位；没有返回 NONE */
  findEnemy(ux: number, uy: number, tm: number, range: number, minRange: number): number {
    const cw = this.cw, ch = this.ch;
    const pe = this.pres[3 - tm];
    let cx0 = ((ux - range) / COARSE) | 0, cx1 = ((ux + range) / COARSE) | 0;
    let cy0 = ((uy - range) / COARSE) | 0, cy1 = ((uy + range) / COARSE) | 0;
    if (cx0 < 0) cx0 = 0;
    if (cy0 < 0) cy0 = 0;
    if (cx1 >= cw) cx1 = cw - 1;
    if (cy1 >= ch) cy1 = ch - 1;
    let any = false;
    for (let cy = cy0; cy <= cy1 && !any; cy++) for (let cx = cx0; cx <= cx1; cx++) if (pe[cy * cw + cx]) {
      any = true;
      break;
    }
    if (!any) return NONE;
    const gw = this.gw, gh = this.gh, cs = this.cellStart, items = this.items;
    let gx0 = ((ux - range) / GRID) | 0, gx1 = ((ux + range) / GRID) | 0;
    let gy0 = ((uy - range) / GRID) | 0, gy1 = ((uy + range) / GRID) | 0;
    if (gx0 < 0) gx0 = 0;
    if (gy0 < 0) gy0 = 0;
    if (gx1 >= gw) gx1 = gw - 1;
    if (gy1 >= gh) gy1 = gh - 1;
    let best = range * range, bi = NONE;
    const min2 = minRange * minRange;
    const x = this.x, y = this.y, team = this.team, alive = this.alive;
    for (let gy = gy0; gy <= gy1; gy++) {
      const row = gy * gw;
      const k0 = cs[row + gx0], k1 = cs[row + gx1 + 1];
      for (let k = k0; k < k1; k++) {
        const j = items[k];
        if (team[j] === tm || !alive[j]) continue;
        const ox = x[j] - ux, oy = y[j] - uy;
        const d2 = ox * ox + oy * oy;
        if (d2 < best && d2 >= min2) {
          best = d2;
          bi = j;
        }
      }
    }
    return bi;
  }

  private findArmedBuilding(ux: number, uy: number, tm: number, range: number): Building | null {
    let best = range * range, bb: Building | null = null;
    for (const b of this.armed) {
      if (!b.alive || b.owner === tm || b.owner === 0) continue;
      const ox = b.cx - ux, oy = b.cy - uy;
      const d2 = ox * ox + oy * oy;
      if (d2 < best) {
        best = d2;
        bb = b;
      }
    }
    return bb;
  }

  private arrive(i: number, atSlot: boolean): void {
    this.order[i] = O_IDLE;
    this.homeX[i] = atSlot ? this.destX[i] : this.x[i];
    this.homeY[i] = atSlot ? this.destY[i] : this.y[i];
    this.field[i] = null;
    this.stuck[i] = 0;
  }

  private updateUnits(): void {
    const x = this.x, y = this.y, vx = this.vx, vy = this.vy, team = this.team, type = this.type, order = this.order,
      target = this.target, defs = this.defs, alive = this.alive, rad = this.rad;
    const tick = this.tickCount, w = this.map.w, terr = this.map.terrain;
    const gw = this.gw, gh = this.gh, cs = this.cellStart, items = this.items;
    const maxX = this.W - 6, maxY = this.H - 6;
    const bldAt = this.nav.bld, buildings = this.buildings;
    const n = this.n;
    for (let i = 0; i < n; i++) {
      if (!alive[i]) continue;
      const d = defs[type[i]];
      const tm = team[i];
      const blk = this.nav.block[tm];
      const ux = x[i], uy = y[i];
      this.px[i] = ux;
      this.py[i] = uy;
      const cell = ((uy / TILE) | 0) * w + ((ux / TILE) | 0);
      const tt = terr[cell];
      if (this.cd[i] > 0) this.cd[i] -= DT;
      if (this.auxCd[i] > 0) this.auxCd[i] -= DT;
      if (this.atkAnim[i] > 0) this.atkAnim[i] -= DT;
      if (this.flash[i] > 0) this.flash[i] -= DT;
      if (this.ignoreT[i] > 0) this.ignoreT[i] -= DT;
      let ord = order[i];
      let tgt = target[i];

      // ---- 校验目标 ----
      if (tgt !== NONE) {
        if (tgt >= 0) {
          if (!alive[tgt] || this.uid[tgt] !== this.targetUid[i]) tgt = NONE;
        } else {
          const b = buildings[-tgt - 2];
          if (!b.alive || b.owner === tm) tgt = NONE;
        }
        if (tgt === NONE) {
          target[i] = NONE;
          if (ord === O_ATTACK) {
            // 临时目标（挡路的建筑）清除后，恢复玩家指定的目标
            const ot = this.otarget[i];
            let ok = false;
            if (ot >= 0) ok = alive[ot] === 1 && this.uid[ot] === this.otargetUid[i];
            else if (ot < NONE) {
              const b = buildings[-ot - 2];
              ok = b.alive && b.owner !== tm;
            }
            if (ok) {
              tgt = target[i] = ot;
              this.targetUid[i] = this.otargetUid[i];
            } else {
              ord = order[i] = O_IDLE;
              this.otarget[i] = NONE;
              this.homeX[i] = ux;
              this.homeY[i] = uy;
              this.field[i] = null;
            }
          }
        }
      }

      // ---- 索敌（分帧错开） ----
      if (ord !== O_MOVE && ord !== O_ATTACK && ((i + tick) & 7) === 0 && this.ignoreT[i] <= 0
        && (tgt === NONE || tgt < 0 || (d.range === 0 && !this.engaged[i]))) {
        const hill = tt === T_HILL && d.range > 0 ? 1.12 : 1;
        const ar = ord === O_HOLD ? (d.range > 0 ? d.range * hill : 44) : d.acq * hill;
        const e = this.findEnemy(ux, uy, tm, ar, d.minRange);
        if (e !== NONE) {
          if (e !== tgt && (d.range > 0 || !this.lineBlocked(ux, uy, x[e], y[e], blk))) {
            tgt = target[i] = e;
            this.targetUid[i] = this.uid[e];
          }
        } else if (tgt === NONE && (d.range === 0 || d.vsBld >= 2) && ord !== O_HOLD) {
          const b = this.findArmedBuilding(ux, uy, tm, Math.max(ar, 160));
          if (b) tgt = target[i] = -b.id - 2;
        }
      }

      // ---- 行为 ----
      let wx = 0, wy = 0;
      let spd = d.speed * TERRAIN_SPEED[tt];
      if (tt === T_FOREST && (d.cls === C_CAV || d.cls === C_CAVR)) spd *= 0.75;
      let eng = 0, usePath = false, chasing = false;
      let aim = this.dir[i];
      if (tgt !== NONE) {
        let tx: number, ty: number, tr: number;
        if (tgt >= 0) {
          tx = x[tgt];
          ty = y[tgt];
          tr = rad[tgt];
        } else {
          const b = buildings[-tgt - 2];
          tx = ux < b.x0 ? b.x0 : ux > b.x1 ? b.x1 : ux;
          ty = uy < b.y0 ? b.y0 : uy > b.y1 ? b.y1 : uy;
          tr = 0;
        }
        const dx = tx - ux, dy = ty - uy;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
        const edge = dist - tr - d.radius;
        const reach = d.range > 0 ? (tt === T_HILL ? d.range * 1.12 : d.range) : 7;
        if (edge <= reach) {
          if (d.minRange > 0 && dist < d.minRange) {
            // 器械无法攻击贴身目标
            target[i] = tgt = NONE;
            this.ignoreT[i] = 0.5;
          } else {
            eng = 1;
            aim = Math.atan2(dy, dx);
            if (dx > 1) this.facing[i] = 1;
            else if (dx < -1) this.facing[i] = -1;
            if (this.cd[i] <= 0) this.attack(i, d, tgt, tt);
            if ((d.traits & TR_FIREMOVE) && tgt >= 0 && edge < reach * 0.55) {
              // 骑射：保持距离
              wx = (-dx / dist) * spd;
              wy = (-dy / dist) * spd;
            }
          }
        } else if (ord === O_HOLD) {
          target[i] = tgt = NONE;
        } else if (ord === O_IDLE && (ux - this.homeX[i]) ** 2 + (uy - this.homeY[i]) ** 2 > LEASH * LEASH) {
          target[i] = tgt = NONE;
          this.ignoreT[i] = 1.5;
        } else {
          // 接敌途中的副武器（重标枪、弓）
          const aux = d.aux;
          if (aux && tgt >= 0 && this.auxCd[i] <= 0 && edge <= aux.range) {
            this.auxCd[i] = aux.cd * (0.9 + this.rng.next() * 0.2);
            this.atkAnim[i] = 0.3;
            this.spawnProj(ux, uy, tgt, tx, ty, aux.proj, aux.dmg, A_PIERCE, 0, 0, d.idx, tm, i);
          }
          if (tgt < 0 ? ord !== O_IDLE : ord === O_ATTACK && dist > 240) usePath = true;
          else {
            chasing = true;
            wx = (dx / dist) * spd;
            wy = (dy / dist) * spd;
          }
        }
      }
      if (tgt === NONE || usePath) {
        if (ord === O_MOVE || ord === O_AMOVE || ord === O_ATTACK) {
          // 追击移动中的单位：目标走远后重新规划
          if (ord === O_ATTACK && tgt >= 0 && ((i + tick) & 31) === 0) {
            const ox = x[tgt] - this.destX[i], oy = y[tgt] - this.destY[i];
            if (ox * ox + oy * oy > 200 * 200) this.retarget(i, tm, x[tgt], y[tgt]);
          }
          const ddx = this.destX[i] - ux, ddy = this.destY[i] - uy;
          const dd = Math.sqrt(ddx * ddx + ddy * ddy);
          if (dd < 5 && ord !== O_ATTACK) this.arrive(i, true);
          else {
            let f = this.field[i];
            let direct = true;
            if (f) {
              const gc = this.destCell[i];
              const gx = (gc % w + 0.5) * TILE - ux, gy = (((gc / w) | 0) + 0.5) * TILE - uy;
              const sr = this.seekR[i];
              if (gx * gx + gy * gy > sr * sr || sr === 0) {
                if (f.dead) f = this.field[i] = this.nav.getField(tm, f.cell, tick);
                f.lastUse = tick;
                const dir = f.dirs[cell];
                if (dir < 8) {
                  direct = false;
                  const k = dir & 1 ? spd * 0.7071 : spd;
                  wx = DIRX[dir] * k;
                  wy = DIRY[dir] * k;
                  // 行军路线被敌方建筑挡住：就地攻击它（攻城）
                  const K = d.lookK;
                  if (tgt === NONE && (K === 1 || ((i + tick) & 7) === 3)) {
                    let c2 = cell;
                    for (let k2 = 0; k2 < K; k2++) {
                      const dr = f.dirs[c2];
                      if (dr > 7) break;
                      c2 += DIRX[dr] + DIRY[dr] * w;
                      if (blk[c2]) {
                        const bid = bldAt[c2];
                        if (bid >= 0 && buildings[bid].owner !== tm) target[i] = -bid - 2;
                        break;
                      }
                    }
                  }
                }
              }
            }
            if (direct) {
              const k = (spd * Math.min(1, dd / 10)) / (dd || 1);
              wx = ddx * k;
              wy = ddy * k;
              const st = this.stuck[i];
              if (st > 1.2 && ord !== O_ATTACK) {
                if (dd < 140 || st > 3.5) this.arrive(i, false);
                else if (!f) {
                  this.field[i] = this.nav.getField(tm, this.destCell[i], tick);
                  this.seekR[i] = 40;
                  this.stuck[i] = 0;
                } else this.seekR[i] = 0.001;
              } else if (st > 1.5 && ord === O_ATTACK && !f) {
                this.field[i] = this.nav.getField(tm, this.destCell[i], tick);
                this.stuck[i] = 0;
              }
            }
          }
        } else {
          // 待命与坚守：被挤开或追击结束后回到原位
          const hx = this.homeX[i] - ux, hy = this.homeY[i] - uy;
          const h2 = hx * hx + hy * hy;
          if (h2 > 64) {
            const hd = Math.sqrt(h2);
            if (this.stuck[i] > 2) {
              this.homeX[i] = ux;
              this.homeY[i] = uy;
              this.stuck[i] = 0;
            } else {
              const k = (spd * Math.min(1, hd / 24)) / hd;
              wx = hx * k;
              wy = hy * k;
            }
          }
        }
      }
      this.engaged[i] = eng;

      // ---- 分离（单位互不重叠） ----
      let pxs = 0, pys = 0;
      const gx = (ux / GRID) | 0, gy = (uy / GRID) | 0;
      const r = rad[i], r2 = r * r;
      for (let cy = gy - 1; cy <= gy + 1; cy++) {
        if (cy < 0 || cy >= gh) continue;
        for (let cx = gx - 1; cx <= gx + 1; cx++) {
          if (cx < 0 || cx >= gw) continue;
          const c = cy * gw + cx;
          const e = cs[c + 1];
          for (let k = cs[c]; k < e; k++) {
            const j = items[k];
            if (j === i || !alive[j]) continue;
            let ox = ux - x[j], oy = uy - y[j];
            const rj = rad[j];
            const rr = r + rj;
            let d2 = ox * ox + oy * oy;
            if (d2 >= rr * rr) continue;
            if (d2 < 0.01) {
              ox = ((i * 7919) % 13) - 6;
              oy = ((i * 104729) % 11) - 5;
              d2 = ox * ox + oy * oy + 0.01;
            }
            const dd = Math.sqrt(d2);
            const push = ((rr - dd) / dd) * ((rj * rj) / (r2 + rj * rj));
            pxs += ox * push;
            pys += oy * push;
          }
        }
      }
      const pm = pxs * pxs + pys * pys;
      if (pm > 9) {
        const k = 3 / Math.sqrt(pm);
        pxs *= k;
        pys *= k;
      }

      // ---- 积分与地形碰撞 ----
      const nvx = vx[i] + (wx - vx[i]) * 0.3, nvy = vy[i] + (wy - vy[i]) * 0.3;
      vx[i] = nvx;
      vy[i] = nvy;
      let nx = ux + nvx * DT + pxs, ny = uy + nvy * DT + pys;
      if (nx < 6) nx = 6;
      else if (nx > maxX) nx = maxX;
      if (ny < 6) ny = 6;
      else if (ny > maxY) ny = maxY;
      if (!blk[cell]) {
        if (blk[((uy / TILE) | 0) * w + ((nx / TILE) | 0)]) {
          nx = ux;
          vx[i] = 0;
        }
        if (blk[((ny / TILE) | 0) * w + ((nx / TILE) | 0)]) {
          ny = uy;
          vy[i] = 0;
        }
      }
      x[i] = nx;
      y[i] = ny;
      const mvx = nx - ux, mvy = ny - uy;
      const moved = Math.sqrt(mvx * mvx + mvy * mvy);
      const want = Math.sqrt(wx * wx + wy * wy);
      if (want > 8 && moved < want * DT * 0.3) this.stuck[i] += DT;
      else if (this.stuck[i] > 0) this.stuck[i] = Math.max(0, this.stuck[i] - DT * 2);
      if (chasing && this.stuck[i] > 1.2 && d.range === 0) {
        // 被挡住够不着：放弃当前目标，稍后重新索敌
        if (ord !== O_ATTACK) target[i] = NONE;
        this.ignoreT[i] = 1.5;
        this.stuck[i] = 0;
      }
      if (!eng) {
        if (nvx > 6) this.facing[i] = 1;
        else if (nvx < -6) this.facing[i] = -1;
        if (nvx * nvx + nvy * nvy > 64) aim = Math.atan2(nvy, nvx);
      }
      let turn = aim - this.dir[i];
      if (turn > Math.PI) turn -= Math.PI * 2;
      else if (turn < -Math.PI) turn += Math.PI * 2;
      if (turn !== 0) {
        const lim = 9 * DT;
        this.dir[i] += turn > lim ? lim : turn < -lim ? -lim : turn;
        if (this.dir[i] > Math.PI) this.dir[i] -= Math.PI * 2;
        else if (this.dir[i] < -Math.PI) this.dir[i] += Math.PI * 2;
      }
      this.anim[i] += moved * 0.11;
      if (d.charge > 0) {
        if (moved > d.speed * DT * 0.7) {
          if (this.chargeT[i] < 3) this.chargeT[i] += DT;
        } else if (this.chargeT[i] > 0) this.chargeT[i] -= DT * 2;
      }
    }
  }

  private attack(i: number, d: UnitDef, tgt: number, tt: number): void {
    let dm = 1;
    if (d.traits & TR_BUSHIDO) dm += 0.5 * (1 - this.hp[i] / d.hp);
    this.cd[i] = d.cd * (0.9 + this.rng.next() * 0.2);
    this.atkAnim[i] = 0.3;
    const tm = this.team[i];
    if (d.range > 0) {
      if (tt === T_HILL) dm *= 1.15;
      let tx: number, ty: number;
      if (tgt >= 0) {
        tx = this.x[tgt];
        ty = this.y[tgt];
      } else {
        const b = this.buildings[-tgt - 2];
        tx = b.cx;
        ty = b.cy;
      }
      this.spawnProj(this.x[i], this.y[i], tgt, tx, ty, d.proj, d.dmg * dm, d.atk, d.splash, d.pen, d.idx, tm, i);
      if (d.proj === P_BULLET || d.proj === P_BALL || d.proj === P_ROCKET) this.addFx(FX_SMOKE, this.x[i] + this.facing[i] * 8, this.y[i] - 10, d.proj === P_BULLET ? 1 : 2.2);
    } else {
      let dmg = d.dmg * dm;
      if (d.charge > 0 && this.chargeT[i] > 0.8) {
        if (!(tgt >= 0 && (this.defs[this.type[tgt]].traits & TR_BRACE))) dmg += d.charge;
        this.chargeT[i] = 0;
      }
      if (tgt >= 0) {
        if ((this.uid[i] + this.tickCount) % 3 === 0) this.addFx(FX_HIT, (this.x[i] + this.x[tgt]) / 2, (this.y[i] + this.y[tgt]) / 2 - 8, 0);
        if (d.traits & TR_TRAMPLE) this.splashDamage(this.x[tgt], this.y[tgt], 28, dmg, A_MELEE, 0, d, tm, i, false);
        else this.damageUnit(tgt, dmg, A_MELEE, 0, d.vs, tm, i);
      } else this.damageBuilding(this.buildings[-tgt - 2], dmg, A_MELEE, d.vsBld, tm);
    }
  }

  damageUnit(j: number, raw: number, atk: number, pen: number, vs: number[], ateam: number, aslot: number): void {
    const td = this.defs[this.type[j]];
    const arm = atk === A_MELEE ? td.armM : atk === A_PIERCE ? td.armP : 0;
    let dmg = raw * vs[td.cls] - arm * (1 - pen);
    if (atk === A_PIERCE) {
      if (td.traits & TR_TESTUDO) dmg *= 0.65;
      if (this.map.terrain[this.cellAt(this.x[j], this.y[j])] === T_FOREST) dmg *= 0.75;
    }
    if (dmg < 1) dmg = 1;
    this.hp[j] -= dmg;
    this.flash[j] = 0.12;
    if (this.hp[j] <= 0) {
      this.kill(j, ateam);
      return;
    }
    // 挨打还击
    if (aslot >= 0 && this.target[j] === NONE && this.order[j] !== O_MOVE && this.order[j] !== O_ATTACK
      && this.ignoreT[j] <= 0 && this.alive[aslot] && this.team[aslot] !== this.team[j]) {
      this.target[j] = aslot;
      this.targetUid[j] = this.uid[aslot];
    }
  }

  private kill(j: number, ateam: number): void {
    const tm = this.team[j];
    this.alive[j] = 0;
    this.teamCount[tm]--;
    this.lost[tm]++;
    this.kills[ateam]++;
    const c = this.corpseN++ % MAX_CORPSE;
    this.cX[c] = this.x[j];
    this.cY[c] = this.y[j];
    this.cType[c] = this.type[j];
    this.cTeam[c] = tm;
    this.cFace[c] = this.facing[j];
    this.cDir[c] = this.dir[j];
    this.cTick[c] = this.tickCount;
    this.addFx(FX_DEATH, this.x[j], this.y[j], this.rad[j]);
    this.field[j] = null;
    this.free[this.freeN++] = j;
  }

  private splashDamage(cx: number, cy: number, radius: number, dmg: number, atk: number, pen: number,
    ad: { vs: number[]; vsBld: number }, ateam: number, aslot: number, hitBuilding: boolean): void {
    const gw = this.gw, gh = this.gh, cs = this.cellStart, items = this.items;
    const reach = radius + 15;
    let gx0 = ((cx - reach) / GRID) | 0, gx1 = ((cx + reach) / GRID) | 0;
    let gy0 = ((cy - reach) / GRID) | 0, gy1 = ((cy + reach) / GRID) | 0;
    if (gx0 < 0) gx0 = 0;
    if (gy0 < 0) gy0 = 0;
    if (gx1 >= gw) gx1 = gw - 1;
    if (gy1 >= gh) gy1 = gh - 1;
    for (let gy = gy0; gy <= gy1; gy++) {
      const k1 = cs[gy * gw + gx1 + 1];
      for (let k = cs[gy * gw + gx0]; k < k1; k++) {
        const j = items[k];
        if (!this.alive[j] || this.team[j] === ateam) continue;
        const dist = Math.hypot(this.x[j] - cx, this.y[j] - cy) - this.rad[j];
        if (dist > radius) continue;
        this.damageUnit(j, dmg * (1 - 0.6 * Math.max(0, dist) / radius), atk, pen, ad.vs, ateam, aslot);
      }
    }
    if (hitBuilding && cx > 0 && cy > 0 && cx < this.W && cy < this.H) {
      const bid = this.nav.bld[this.cellAt(cx, cy)];
      if (bid >= 0 && this.buildings[bid].owner !== ateam) this.damageBuilding(this.buildings[bid], dmg, atk, ad.vsBld, ateam);
    }
  }

  damageBuilding(b: Building, raw: number, atk: number, vsBld: number, ateam: number): void {
    if (!b.alive) return;
    const def = b.def;
    const arm = atk === A_MELEE ? def.armM : atk === A_PIERCE ? def.armP : 0;
    let dmg = raw * vsBld - arm;
    const min = atk === A_PIERCE ? 0.5 : 1;
    if (dmg < min) dmg = min;
    b.hp -= dmg;
    b.hitTick = this.tickCount;
    if (b.hp <= 0) this.destroyBuilding(b, ateam);
  }

  private destroyBuilding(b: Building, ateam: number): void {
    b.alive = false;
    b.hp = 0;
    this.nav.refresh(b);
    this.addFx(FX_COLLAPSE, b.cx, b.cy, Math.max(b.w, b.h));
    if (b.site >= 0) {
      const s = this.sites[b.site];
      if (s.main === b.id) {
        if (s.type === SITE_HQ) {
          if (!this.winner) {
            this.winner = 3 - s.owner;
            this.events.push({ kind: 'gameover', winner: this.winner });
          }
        } else {
          s.disabled = true;
          this.events.push({ kind: 'razed', site: s.id, team: ateam });
        }
      }
    }
  }

  // ---- 投射物 ----
  private spawnProj(sx: number, sy: number, tgt: number, tx: number, ty: number, ptype: number, dmg: number, atk: number,
    splash: number, pen: number, defIdx: number, tm: number, src: number): void {
    if (this.pn >= MAX_PROJ) return;
    const p = this.pn++;
    if (splash > 0 && tgt >= 0) {
      // 抛射武器打预判落点，带散布
      const lead = Math.hypot(tx - sx, ty - sy) / PROJ_SPEED[ptype];
      tx += this.vx[tgt] * lead * 0.7 + (this.rng.next() - 0.5) * splash * 0.9;
      ty += this.vy[tgt] * lead * 0.7 + (this.rng.next() - 0.5) * splash * 0.9;
    }
    this.pType[p] = ptype;
    this.pSx[p] = sx;
    this.pSy[p] = sy;
    this.pTx[p] = tx;
    this.pTy[p] = ty;
    this.pT[p] = 0;
    this.pDur[p] = Math.max(0.08, Math.hypot(tx - sx, ty - sy) / PROJ_SPEED[ptype]);
    this.pDmg[p] = dmg;
    this.pAtk[p] = atk;
    this.pSplash[p] = splash;
    this.pPen[p] = pen;
    this.pDef[p] = defIdx;
    this.pTeam[p] = tm;
    this.pTgt[p] = tgt;
    this.pTgtUid[p] = tgt >= 0 ? this.uid[tgt] : 0;
    this.pSrc[p] = src;
    this.pSrcUid[p] = src >= 0 ? this.uid[src] : 0;
  }

  private updateProjectiles(): void {
    for (let p = 0; p < this.pn; p++) {
      this.pT[p] += DT;
      const tgt = this.pTgt[p];
      const splash = this.pSplash[p];
      const live = tgt >= 0 && this.alive[tgt] === 1 && this.uid[tgt] === this.pTgtUid[p];
      if (live && splash === 0) {
        // 直射武器追踪目标
        this.pTx[p] = this.x[tgt];
        this.pTy[p] = this.y[tgt];
      }
      if (this.pT[p] < this.pDur[p]) continue;
      const tm = this.pTeam[p];
      const ad = this.pDef[p] >= 0 ? this.defs[this.pDef[p]] : TOWER_ATTACKER;
      let src = this.pSrc[p];
      if (src >= 0 && (!this.alive[src] || this.uid[src] !== this.pSrcUid[p])) src = NONE;
      const ix = this.pTx[p], iy = this.pTy[p];
      if (tgt < NONE) {
        const b = this.buildings[-tgt - 2];
        this.damageBuilding(b, this.pDmg[p], this.pAtk[p], ad.vsBld, tm);
        if (splash > 0) {
          this.splashDamage(ix, iy, splash, this.pDmg[p], this.pAtk[p], this.pPen[p], ad, tm, src, false);
          this.addFx(FX_EXPLODE, ix, iy, splash);
        } else this.addFx(FX_ARROW_HIT, ix + (this.rng.next() - 0.5) * 20, iy + (this.rng.next() - 0.5) * 20, 0);
      } else if (splash > 0) {
        this.splashDamage(ix, iy, splash, this.pDmg[p], this.pAtk[p], this.pPen[p], ad, tm, src, true);
        this.addFx(FX_EXPLODE, ix, iy, splash);
      } else if (live) {
        this.damageUnit(tgt, this.pDmg[p], this.pAtk[p], this.pPen[p], ad.vs, tm, src);
      }
      // 删除：末尾元素补位
      const q = --this.pn;
      if (p !== q) {
        this.pType[p] = this.pType[q];
        this.pSx[p] = this.pSx[q];
        this.pSy[p] = this.pSy[q];
        this.pTx[p] = this.pTx[q];
        this.pTy[p] = this.pTy[q];
        this.pT[p] = this.pT[q];
        this.pDur[p] = this.pDur[q];
        this.pDmg[p] = this.pDmg[q];
        this.pAtk[p] = this.pAtk[q];
        this.pSplash[p] = this.pSplash[q];
        this.pPen[p] = this.pPen[q];
        this.pDef[p] = this.pDef[q];
        this.pTeam[p] = this.pTeam[q];
        this.pTgt[p] = this.pTgt[q];
        this.pTgtUid[p] = this.pTgtUid[q];
        this.pSrc[p] = this.pSrc[q];
        this.pSrcUid[p] = this.pSrcUid[q];
      }
      p--;
    }
  }

  private updateBuildings(): void {
    for (const b of this.armed) {
      if (!b.alive || b.owner === 0) continue;
      b.cd -= DT;
      if (b.cd > 0) continue;
      const tw = b.def.tower!;
      const e = this.findEnemy(b.cx, b.cy, b.owner, tw.range, 0);
      if (e === NONE) {
        b.cd = 0.4;
        continue;
      }
      b.cd = tw.cd;
      this.spawnProj(b.cx, b.y0 - b.def.tall * 0.6, e, this.x[e], this.y[e], 0, tw.dmg, A_PIERCE, 0, 0, -1, b.owner, NONE);
    }
  }

  addFx(kind: number, fx: number, fy: number, a: number): void {
    if (this.fxN >= 4096) return;
    const o = this.fxN++ * 4;
    this.fx[o] = kind;
    this.fx[o + 1] = fx;
    this.fx[o + 2] = fy;
    this.fx[o + 3] = a;
  }

  // ---- 据点：占领与援军 ----
  private updateSites(): void {
    const sites = this.sites;
    for (const s of sites) s.count[1] = s.count[2] = 0;
    for (let i = 0; i < this.n; i++) {
      if (!this.alive[i]) continue;
      const ux = this.x[i], uy = this.y[i];
      for (const s of sites) {
        const dx = ux - s.x, dy = uy - s.y;
        if (dx * dx + dy * dy < s.radius * s.radius) s.count[this.team[i]]++;
      }
    }
    const step = 0.5;
    for (const s of sites) {
      if (s.disabled) continue;
      if (s.type !== SITE_HQ) {
        const a = s.count[1], b = s.count[2];
        const dom = a > 0 && b === 0 ? 1 : b > 0 && a === 0 ? 2 : 0;
        if (dom && dom !== s.owner) {
          const rate = (step * (0.5 + Math.min(dom === 1 ? a : b, 24) / 16)) / 9;
          if (s.capTeam !== dom) {
            s.cap -= rate * 2;
            if (s.cap <= 0) {
              s.capTeam = dom;
              s.cap = 0;
            }
          } else {
            s.cap += rate;
            if (s.cap >= 1) this.captureSite(s, dom);
          }
        } else if (s.cap > 0 && (dom === s.owner || (a === 0 && b === 0))) {
          s.cap = Math.max(0, s.cap - step / 6);
        }
      }
      if (s.owner) {
        s.timer -= step;
        if (s.timer <= 0) {
          if (this.teamCount[s.owner] < this.unitCap[s.owner]) {
            s.timer = s.interval;
            this.reinforce(s);
          } else s.timer = 5;
        }
      }
    }
  }

  private captureSite(s: Site, tm: number): void {
    const from = s.owner;
    s.owner = tm;
    s.cap = 0;
    s.capTeam = 0;
    s.timer = s.interval * 0.6;
    for (const id of s.buildings) {
      const b = this.buildings[id];
      b.owner = tm;
      if (b.alive) this.nav.refresh(b);
    }
    this.events.push({ kind: 'captured', site: s.id, team: tm, from });
  }

  /** 援军从己方后方入场，开赴集结点 */
  private reinforce(s: Site): void {
    const tm = s.owner;
    const fac = this.factions[tm];
    if (!fac) return;
    const list = fac.reinf[SITE_INFO[s.type].reinf];
    const mult = fac.reinfMult * this.reinfMult[tm];
    const idxs: number[] = [];
    for (const [key, cnt] of list) {
      const n = Math.max(1, Math.round(cnt * mult));
      for (let k = 0; k < n; k++) idxs.push(UNIT_BY_KEY[key].idx);
    }
    const sp = this.map.spawn[tm];
    const r = this.rally[tm];
    const slots = this.spawnGroup(tm, idxs, sp.x, sp.y, r.x - sp.x, r.y - sp.y);
    if (!slots.length) return;
    this.arrived[tm] += slots.length;
    this.orderMove(slots, r.x + (this.rng.next() - 0.5) * 160, r.y + (this.rng.next() - 0.5) * 160, true);
    this.events.push({ kind: 'reinforce', site: s.id, team: tm, count: slots.length });
    this.onReinforce?.(tm, slots);
  }

  // ---- 战争迷雾 ----
  private updateVision(): void {
    const vis = this.vis;
    if (!this.fog || !this.humanTeam) {
      if (vis[0] !== 1) {
        vis.fill(1);
        this.explored.fill(1);
      }
      return;
    }
    const st = this.visStamp, vw = this.vw, vh = this.vh, ht = this.humanTeam;
    vis.fill(0);
    st.fill(0);
    const stamp = (cx: number, cy: number, r: number): void => {
      const c = cy * vw + cx;
      if (st[c] >= r) return;
      st[c] = r;
      for (let dy = -r; dy <= r; dy++) {
        const yy = cy + dy;
        if (yy < 0 || yy >= vh) continue;
        const span = Math.floor(Math.sqrt(r * r + r - dy * dy));
        let xa = cx - span, xb = cx + span;
        if (xa < 0) xa = 0;
        if (xb >= vw) xb = vw - 1;
        const row = yy * vw;
        for (let xx = xa; xx <= xb; xx++) vis[row + xx] = 1;
      }
    };
    for (let i = 0; i < this.n; i++) {
      if (!this.alive[i] || this.team[i] !== ht) continue;
      stamp((this.x[i] / VIS_CELL) | 0, (this.y[i] / VIS_CELL) | 0, Math.round(this.defs[this.type[i]].vision / VIS_CELL));
    }
    for (const b of this.buildings) {
      if (!b.alive || b.owner !== ht) continue;
      stamp((b.cx / VIS_CELL) | 0, (b.cy / VIS_CELL) | 0, b.def.tower ? 6 : 3);
    }
    const ex = this.explored;
    for (let i = 0; i < vis.length; i++) if (vis[i]) ex[i] = 1;
  }

  isVisible(wx: number, wy: number): boolean {
    return this.vis[((wy / VIS_CELL) | 0) * this.vw + ((wx / VIS_CELL) | 0)] === 1;
  }
  isExplored(wx: number, wy: number): boolean {
    return this.explored[((wy / VIS_CELL) | 0) * this.vw + ((wx / VIS_CELL) | 0)] === 1;
  }

  /** 强制刷新一次视野（开局用） */
  refreshVision(): void {
    this.vis[0] = 0;
    this.updateVision();
  }
}
