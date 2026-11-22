/**
 * 世界状态：单位（SoA）、建筑、据点、投射物、环境、补给。不依赖 DOM，可在 Node 中无头运行。
 * 这里只放数据和最基础的增删查；所有玩法算法在 systems/ 下，由 tick() 按管线依次调用。
 */
import { BK_GATE, BuildingDef, DT, FactionDef, LEVELS, RULES, TILE, UNITS } from './content';
import { GameMap } from './map';
import { Field, Nav } from './nav';
import { RNG } from './rng';
import { System, defaultSystems } from './systems';
import { formation } from './systems/formation';
import * as orders from './systems/orders';
import { refreshVision } from './systems/vision';
import { damageBuilding } from './systems/combat';
import { MAX_CORPSE, MAX_PROJ, MAX_UNITS, COARSE, GRID, NONE, O_IDLE, S_ROUT, VIS_CELL } from './state';

export * from './state';

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
  climb: number;
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
  /** 旗帜区内各队人数 */
  flag: number[];
}

export type SimEvent =
  | { kind: 'captured'; site: number; team: number; from: number; repaired: boolean }
  | { kind: 'reinforce'; site: number; team: number; count: number }
  | { kind: 'razed'; site: number; team: number }
  | { kind: 'gameover'; winner: number }
  | { kind: 'rout'; team: number; count: number; x: number; y: number }
  | { kind: 'weather'; rain: boolean }
  | { kind: 'daynight'; night: boolean }
  | { kind: 'hunger'; team: number; on: boolean };

/** 昼夜与天气 */
export interface Env {
  /** 关掉后永远是晴朗的白天 */
  enabled: boolean;
  /** 一天中的时刻 0..1（0 午夜，0.5 正午） */
  clock: number;
  /** 天光 0（深夜）..1（白昼） */
  light: number;
  night: boolean;
  raining: boolean;
  /** 雨势 0..1（渲染用，渐入渐出） */
  rain: number;
  /** 下一次天气变化的时间（秒） */
  nextWeather: number;
  /** 当前的单位视野倍率 */
  visionMul: number;
}

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
  /** 系统管线：可增删、替换其中任意一环 */
  systems: System[] = defaultSystems();

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
  readonly maxHp = new Float32Array(MAX_UNITS);
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
  /** 累计行进距离（像素），渲染层用它推进步伐动画 */
  readonly odo = new Float32Array(MAX_UNITS);
  readonly destX = new Float32Array(MAX_UNITS);
  readonly destY = new Float32Array(MAX_UNITS);
  readonly destCell = new Int32Array(MAX_UNITS);
  readonly seekR = new Float32Array(MAX_UNITS);
  readonly homeX = new Float32Array(MAX_UNITS);
  readonly homeY = new Float32Array(MAX_UNITS);
  readonly stuck = new Float32Array(MAX_UNITS);
  readonly ignoreT = new Float32Array(MAX_UNITS);
  readonly engaged = new Uint8Array(MAX_UNITS);
  readonly field: (Field | null)[] = new Array(MAX_UNITS).fill(null);
  /** 状态位 S_* */
  readonly state = new Uint8Array(MAX_UNITS);
  /** 战斗状态剩余秒数 */
  readonly combatT = new Float32Array(MAX_UNITS);
  /** 编队行军速度上限（0 = 不限），由移动指令统一成队里最慢的 */
  readonly grpSpeed = new Float32Array(MAX_UNITS);
  readonly level = new Uint8Array(MAX_UNITS);
  readonly xp = new Float32Array(MAX_UNITS);
  readonly morale = new Float32Array(MAX_UNITS);
  /** 溃兵重整后的稳定期（秒） */
  readonly steadyT = new Float32Array(MAX_UNITS);
  /** 溃逃目的地：据点 id；-1 表示逃向地图边缘 */
  readonly routSite = new Int16Array(MAX_UNITS);
  readonly chargeT = new Float32Array(MAX_UNITS);
  readonly chargeCd = new Float32Array(MAX_UNITS);
  readonly chargeHits = new Uint8Array(MAX_UNITS);
  readonly chargeLast = new Uint32Array(MAX_UNITS);
  readonly braceT = new Float32Array(MAX_UNITS);
  readonly shieldT = new Float32Array(MAX_UNITS);
  /** 玩家下令熄灭火把 */
  readonly torchOff = new Uint8Array(MAX_UNITS);
  /** 被判定够不着的目标及其失效倒计时 */
  readonly avoidUid = new Uint32Array(MAX_UNITS);
  readonly avoidT = new Float32Array(MAX_UNITS);
  /** 挤不进战线时原地列队等待的倒计时，以及连续等待的次数 */
  readonly waitT = new Float32Array(MAX_UNITS);
  readonly waits = new Uint8Array(MAX_UNITS);
  /** 正有多少近战敌人以它为目标 */
  readonly crowd = new Uint8Array(MAX_UNITS);
  /** 被哪些队伍看见（位 1、2） */
  readonly seen = new Uint8Array(MAX_UNITS);
  /** 最近打过它的两个敌人（算助攻） */
  readonly hitBy = new Int32Array(MAX_UNITS * 2);
  readonly hitByUid = new Uint32Array(MAX_UNITS * 2);
  readonly hitByTick = new Int32Array(MAX_UNITS * 2);
  readonly free = new Int32Array(MAX_UNITS);
  freeN = 0;
  private nextUid = 1;
  readonly teamCount = [0, 0, 0];
  readonly kills = [0, 0, 0];
  readonly lost = [0, 0, 0];
  readonly arrived = [0, 0, 0];
  /** 逃离战场、不再回来的人数（已计入 lost） */
  readonly deserted = [0, 0, 0];
  /** 当前处于溃逃状态的人数 */
  readonly routing = [0, 0, 0];
  readonly defs = UNITS;

  // ---- 空间网格 ----
  readonly gw: number;
  readonly gh: number;
  readonly cellStart: Int32Array;
  readonly cellCur: Int32Array;
  readonly items = new Int32Array(MAX_UNITS);
  readonly cw: number;
  readonly ch: number;
  readonly pres: Uint16Array[];

  // ---- 建筑与据点 ----
  readonly buildings: Building[] = [];
  readonly armed: Building[] = [];
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
  readonly pDmg = new Float32Array(MAX_PROJ);
  readonly pAtk = new Uint8Array(MAX_PROJ);
  readonly pSplash = new Float32Array(MAX_PROJ);
  readonly pPen = new Float32Array(MAX_PROJ);
  readonly pDef = new Int16Array(MAX_PROJ);
  readonly pTeam = new Uint8Array(MAX_PROJ);
  readonly pTgt = new Int32Array(MAX_PROJ);
  readonly pTgtUid = new Uint32Array(MAX_PROJ);
  readonly pSrc = new Int32Array(MAX_PROJ);
  readonly pSrcUid = new Uint32Array(MAX_PROJ);

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

  // ---- 视野：每队一张；vis / explored 是玩家看到的那张（关迷雾或观战时全亮） ----
  readonly vw: number;
  readonly vh: number;
  readonly teamVis: Uint8Array[];
  readonly vis: Uint8Array;
  readonly explored: Uint8Array;
  readonly visStamp: Uint8Array;

  // ---- 昼夜天气 ----
  readonly env: Env = {
    enabled: true, clock: RULES.env.startClock, light: 1, night: false, raining: false, rain: 0, nextWeather: 0, visionMul: 1,
  };

  // ---- 粮草（按队伍） ----
  readonly food = [0, 0, 0];
  readonly foodCap = [0, 0, 0];
  /** 每分钟产量与消耗（界面显示用） */
  readonly foodIn = [0, 0, 0];
  readonly foodOut = [0, 0, 0];
  /** 饥饿程度 0..1 */
  readonly hunger = [0, 0, 0];
  /** 开局全军每分钟的口粮：据点产量以它为基准；0 表示本局不启用粮草 */
  readonly upkeep0 = [0, 0, 0];
  readonly upkeep = [0, 0, 0];

  // ---- 士气统计格（morale 系统填写） ----
  readonly mw: number;
  readonly mh: number;
  /** [队伍] 每格的战力、阵亡冲击、溃兵数、冲锋中的单位数 */
  readonly mPow: Float32Array[];
  readonly mShock: Float32Array[];
  readonly mRout: Float32Array[];
  readonly mCharge: Uint8Array[];
  /** 全队平均士气（界面显示用） */
  readonly avgMorale = [0, RULES.morale.base, RULES.morale.base];
  readonly power = [0, 0, 0];

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
    const vn = this.vw * this.vh;
    this.teamVis = [new Uint8Array(0), new Uint8Array(vn), new Uint8Array(vn)];
    this.vis = new Uint8Array(vn);
    this.explored = new Uint8Array(vn);
    this.visStamp = new Uint8Array(vn);
    const mc = RULES.morale.cell;
    this.mw = Math.ceil(this.W / mc);
    this.mh = Math.ceil(this.H / mc);
    const mn = this.mw * this.mh;
    const f = (): Float32Array[] => [new Float32Array(0), new Float32Array(mn), new Float32Array(mn)];
    this.mPow = f();
    this.mShock = f();
    this.mRout = f();
    this.mCharge = [new Uint8Array(0), new Uint8Array(mn), new Uint8Array(mn)];
    this.target.fill(NONE);
    this.otarget.fill(NONE);
    const e = RULES.env;
    this.env.nextWeather = e.firstRain[0] + this.rng.next() * (e.firstRain[1] - e.firstRain[0]);
  }

  // =====================================================================
  // 搭建
  // =====================================================================
  addBuilding(def: BuildingDef, tx: number, ty: number, owner: number, site: number, style = ''): Building {
    const b: Building = {
      id: this.buildings.length, def, tx, ty, w: def.w, h: def.h,
      x0: tx * TILE, y0: ty * TILE, x1: (tx + def.w) * TILE, y1: (ty + def.h) * TILE,
      cx: (tx + def.w / 2) * TILE, cy: (ty + def.h / 2) * TILE,
      hp: def.hp, owner, alive: true, gate: def.kind === BK_GATE, breach: def.breach, climb: def.top > 0 ? RULES.siege.climbCost : 0, site,
      cd: this.rng.next(), style, variant: this.rng.int(0, 3), hitTick: -999,
    };
    this.buildings.push(b);
    if (def.tower) this.armed.push(b);
    this.nav.refresh(b);
    return b;
  }

  spawnUnit(defIdx: number, tm: number, ux: number, uy: number, level = 0): number {
    let i: number;
    if (this.freeN > 0) i = this.free[--this.freeN];
    else if (this.n < MAX_UNITS) i = this.n++;
    else return NONE;
    const d = this.defs[defIdx];
    level = Math.min(level, d.lvHp.length - 1);
    this.alive[i] = 1;
    this.uid[i] = this.nextUid++;
    this.team[i] = tm;
    this.type[i] = defIdx;
    this.rad[i] = d.radius;
    this.x[i] = this.px[i] = ux;
    this.y[i] = this.py[i] = uy;
    this.vx[i] = this.vy[i] = 0;
    this.level[i] = level;
    this.xp[i] = LEVELS.thresholds[level];
    this.hp[i] = this.maxHp[i] = d.lvHp[level];
    this.facing[i] = tm === 1 ? 1 : -1;
    this.dir[i] = tm === 1 ? 0 : Math.PI;
    this.order[i] = O_IDLE;
    this.target[i] = this.otarget[i] = NONE;
    this.cd[i] = this.rng.next() * d.cd;
    this.auxCd[i] = 0;
    this.atkAnim[i] = this.flash[i] = 0;
    this.odo[i] = this.rng.next() * 40;
    this.destX[i] = this.homeX[i] = ux;
    this.destY[i] = this.homeY[i] = uy;
    this.stuck[i] = this.ignoreT[i] = 0;
    this.engaged[i] = 0;
    this.field[i] = null;
    this.state[i] = 0;
    this.combatT[i] = this.grpSpeed[i] = 0;
    this.morale[i] = RULES.morale.base + d.discipline + level * RULES.morale.perLevel;
    this.steadyT[i] = 0;
    this.routSite[i] = -1;
    this.chargeT[i] = this.chargeCd[i] = this.braceT[i] = this.shieldT[i] = 0;
    this.chargeHits[i] = 0;
    this.torchOff[i] = 0;
    this.avoidT[i] = this.waitT[i] = 0;
    this.waits[i] = this.crowd[i] = 0;
    this.seen[i] = 0;
    this.hitBy[i * 2] = this.hitBy[i * 2 + 1] = NONE;
    this.teamCount[tm]++;
    this.upkeep[tm] += d.upkeep;
    return i;
  }

  /** 把单位从场上移除（阵亡与逃离战场共用）；不留尸体、不计战果 */
  removeUnit(j: number): void {
    const tm = this.team[j];
    this.alive[j] = 0;
    this.teamCount[tm]--;
    this.upkeep[tm] -= this.defs[this.type[j]].upkeep;
    if (this.state[j] & S_ROUT) this.routing[tm]--;
    this.state[j] = 0;
    this.field[j] = null;
    this.free[this.freeN++] = j;
  }

  /** 以阵型生成一队单位，返回槽位列表 */
  spawnGroup(tm: number, defIdxs: number[], cx: number, cy: number, dx: number, dy: number): number[] {
    const f = formation(this, defIdxs, cx, cy, dx, dy, null);
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

  // =====================================================================
  // 指令（算法在 systems/orders.ts）
  // =====================================================================
  orderMove(units: number[], tx: number, ty: number, amove: boolean): void {
    orders.orderMove(this, units, tx, ty, amove);
  }
  orderAttackUnit(units: number[], tgt: number): void {
    orders.orderAttackUnit(this, units, tgt);
  }
  orderAttackBuilding(units: number[], b: Building): void {
    orders.orderAttackBuilding(this, units, b);
  }
  orderStop(units: number[], hold: boolean): void {
    orders.orderStop(this, units, hold);
  }
  orderTorch(units: number[], on: boolean): void {
    orders.orderTorch(this, units, on);
  }

  /** 单位当前是否听从指令（溃兵不听） */
  controllable(i: number): boolean {
    return this.alive[i] === 1 && !(this.state[i] & S_ROUT);
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
    const t = ++this.tickCount;
    this.time += DT;
    for (const s of this.systems) if (s.every === 1 || t % s.every === s.phase) s.run(this);
  }

  /**
   * 最近的、本队看得见的敌方单位；没有返回 NONE。
   * @param needSeen 为 false 时不考虑视野（用于「附近有没有敌人」这类判断）
   */
  findEnemy(ux: number, uy: number, tm: number, range: number, minRange: number, needSeen = true): number {
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
    const x = this.x, y = this.y, team = this.team, alive = this.alive, seen = this.seen;
    const bit = needSeen ? 1 << tm : 0;
    for (let gy = gy0; gy <= gy1; gy++) {
      const row = gy * gw;
      const k0 = cs[row + gx0], k1 = cs[row + gx1 + 1];
      for (let k = k0; k < k1; k++) {
        const j = items[k];
        if (team[j] === tm || !alive[j] || (bit && !(seen[j] & bit))) continue;
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

  /** @param canFort 攻击者是否为工程类（否则打不动石墙与箭楼） */
  damageBuilding(b: Building, raw: number, atk: number, vsBld: number, ateam: number, canFort = true): void {
    damageBuilding(this, b, raw, atk, vsBld, ateam, canFort);
  }

  addFx(kind: number, fx: number, fy: number, a: number): void {
    if (this.fxN >= 4096) return;
    const o = this.fxN++ * 4;
    this.fx[o] = kind;
    this.fx[o + 1] = fx;
    this.fx[o + 2] = fy;
    this.fx[o + 3] = a;
  }

  isVisible(wx: number, wy: number): boolean {
    return this.vis[((wy / VIS_CELL) | 0) * this.vw + ((wx / VIS_CELL) | 0)] === 1;
  }
  isExplored(wx: number, wy: number): boolean {
    return this.explored[((wy / VIS_CELL) | 0) * this.vw + ((wx / VIS_CELL) | 0)] === 1;
  }
  /** 玩家此刻能否看到这个单位（己方恒为可见） */
  unitVisible(i: number): boolean {
    const h = this.humanTeam;
    return !this.fog || !h || this.team[i] === h || (this.seen[i] & (1 << h)) !== 0;
  }

  /** 强制刷新一次视野（开局用） */
  refreshVision(): void {
    refreshVision(this);
  }
}
