/**
 * 通行网格与流场寻路。成百上千单位共用同一张流场，寻路开销与单位数无关。
 * 流场用 Dijkstra 从终点向外扩散，并按预算分摊到多帧计算，避免单帧卡顿；
 * 尚未算到的格子返回 DIR_NONE，单位会先朝目标直线前进，几帧后自动改用流场。
 */
import { TERRAIN_COST } from './defs';

export const DIRX = [1, 1, 0, -1, -1, -1, 0, 1];
export const DIRY = [0, 1, 1, 1, 0, -1, -1, -1];
export const DIR_HERE = 8, DIR_NONE = 255;

/** 每帧最多弹出的堆节点数（约 1~2ms） */
const BUDGET = 22000;

export interface Field {
  key: number;
  team: number;
  /** 目标格（建筑流场为建筑左上角格） */
  cell: number;
  seeds: Int32Array;
  dirs: Uint8Array;
  version: number;
  lastUse: number;
  dead: boolean;
  pending: boolean;
}

export interface NavBuilding {
  id: number;
  tx: number;
  ty: number;
  w: number;
  h: number;
  owner: number;
  alive: boolean;
  gate: boolean;
  /** 能被攻击；不能的（普通建筑）对谁都是实心障碍，没有「打穿」这条路 */
  hittable: boolean;
  breach: number;
  /** 己方可以走上去（城墙顶）；值为额外的寻路代价，0 表示不能 */
  climb: number;
}

interface Job {
  field: Field;
  dirs: Uint8Array;
  dist: Uint32Array;
  hd: Uint32Array;
  hc: Int32Array;
  hs: number;
  version: number;
}

export class Nav {
  readonly n: number;
  /** 地形通行代价 ×10，0 = 不可通行 */
  readonly base: Uint8Array;
  /** 占据该格的建筑 id，-1 表示无 */
  readonly bld: Int32Array;
  /** [队伍] 寻路代价：0 不可通行；敌方/中立建筑按"可破坏"计入额外代价 */
  readonly cost: Uint16Array[];
  /** [队伍] 移动阻挡 */
  readonly block: Uint8Array[];
  /** [队伍] 该格是本队能站上去的墙顶 / 楼顶 */
  readonly deck: Uint8Array[];
  /** 城墙圈内的地面：只有从这里才能上下墙顶 */
  readonly inner: Uint8Array;
  version = 1;
  readonly fields = new Map<number, Field>();
  /** 统计：累计计算的流场数 */
  computed = 0;

  private readonly jobs: Job[] = [];
  private readonly pool: { dist: Uint32Array; hd: Uint32Array; hc: Int32Array }[] = [];
  private readonly off: Int32Array;
  private readonly offX: Int32Array;
  private readonly offY: Int32Array;

  constructor(readonly w: number, readonly h: number, terrain: Uint8Array) {
    const n = (this.n = w * h);
    this.base = new Uint8Array(n);
    this.bld = new Int32Array(n).fill(-1);
    this.cost = [new Uint16Array(0), new Uint16Array(n), new Uint16Array(n)];
    this.block = [new Uint8Array(0), new Uint8Array(n), new Uint8Array(n)];
    this.deck = [new Uint8Array(0), new Uint8Array(n), new Uint8Array(n)];
    this.inner = new Uint8Array(n);
    this.off = Int32Array.from(DIRX.map((dx, i) => dx + DIRY[i] * w));
    this.offX = Int32Array.from(DIRX);
    this.offY = Int32Array.from(DIRY.map(dy => dy * w));
    for (let i = 0; i < n; i++) this.setTerrain(i, terrain[i]);
    // 紧贴山体、深水的格子略微加价：行军路线会与障碍留出一点余量，不至于全军贴着河岸挤成一线
    const hug = new Uint8Array(n);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const c = y * w + x;
        if (this.base[c] === 0) continue;
        for (let d = 0; d < 8; d++) {
          if (this.base[c + this.off[d]] === 0) {
            hug[c] = 1;
            break;
          }
        }
      }
    }
    for (let i = 0; i < n; i++) {
      if (!hug[i]) continue;
      this.base[i] += 7;
      this.setCell(i, null);
    }
  }

  setTerrain(c: number, t: number): void {
    const x = c % this.w, y = (c / this.w) | 0;
    // 地图最外一圈永远不可通行，寻路时可省去边界判断
    const edge = x === 0 || y === 0 || x === this.w - 1 || y === this.h - 1;
    this.base[c] = edge ? 0 : TERRAIN_COST[t];
    this.setCell(c, null);
  }

  private setCell(c: number, b: NavBuilding | null): void {
    const base = this.base[c];
    for (let t = 1; t <= 2; t++) {
      this.deck[t][c] = b && base !== 0 && b.owner === t && b.climb > 0 && !b.gate ? 1 : 0;
      if (!b || base === 0) {
        this.cost[t][c] = base;
        this.block[t][c] = base === 0 ? 1 : 0;
      } else if (b.gate && (b.owner === 0 || b.owner === t)) {
        this.cost[t][c] = base;
        this.block[t][c] = 0;
      } else if (b.owner === t && b.climb > 0) {
        // 自家城墙：能上去驻守，但寻路时尽量走城门
        this.cost[t][c] = base + b.climb;
        this.block[t][c] = 0;
      } else if (b.owner === t || !b.hittable) {
        this.cost[t][c] = 0;
        this.block[t][c] = 1;
      } else {
        this.cost[t][c] = base + b.breach;
        this.block[t][c] = 1;
      }
    }
  }

  /** 建筑新建、被毁或易主后刷新其占地 */
  refresh(b: NavBuilding): void {
    for (let y = b.ty; y < b.ty + b.h; y++) {
      for (let x = b.tx; x < b.tx + b.w; x++) {
        const c = y * this.w + x;
        this.bld[c] = b.alive ? b.id : -1;
        this.setCell(c, b.alive ? b : null);
      }
    }
    this.version++;
  }

  /** 本队单位能否从 a 格直接走到相邻的 b 格：地面上不了墙顶（上墙只有驻守一条路），墙顶只能往城内一侧下 */
  canStep(team: number, a: number, b: number): boolean {
    const dk = this.deck[team];
    return dk[a] === dk[b] || (dk[a] === 1 && this.inner[b] === 1);
  }

  /** 找到离给定格最近的可站立格（墙顶不算） */
  nearestFree(team: number, cell: number, maxR = 10): number {
    const blk = this.block[team], dk = this.deck[team];
    if (!blk[cell] && !dk[cell]) return cell;
    const cx = cell % this.w, cy = (cell / this.w) | 0;
    for (let r = 1; r <= maxR; r++) {
      let best = -1, bestD = 1e9;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = cx + dx, y = cy + dy;
          if (x < 0 || y < 0 || x >= this.w || y >= this.h) continue;
          const c = y * this.w + x;
          if (blk[c] || dk[c]) continue;
          const d = dx * dx + dy * dy;
          if (d < bestD) {
            bestD = d;
            best = c;
          }
        }
      }
      if (best >= 0) return best;
    }
    return cell;
  }

  getField(team: number, cell: number, tick: number): Field {
    const key = team * 1048576 + cell;
    let f = this.fields.get(key);
    if (!f) f = this.make(key, team, cell, Int32Array.of(cell), tick);
    f.lastUse = tick;
    return f;
  }

  /** 以建筑占地为终点的流场（用于攻击建筑） */
  getBuildingField(team: number, b: NavBuilding, tick: number): Field {
    const key = team * 1048576 + 524288 + b.id;
    let f = this.fields.get(key);
    if (!f) {
      const seeds = new Int32Array(b.w * b.h);
      let k = 0;
      for (let y = b.ty; y < b.ty + b.h; y++) for (let x = b.tx; x < b.tx + b.w; x++) seeds[k++] = y * this.w + x;
      f = this.make(key, team, b.ty * this.w + b.tx, seeds, tick);
    }
    f.lastUse = tick;
    return f;
  }

  private make(key: number, team: number, cell: number, seeds: Int32Array, tick: number): Field {
    const f: Field = {
      key, team, cell, seeds, dirs: new Uint8Array(this.n).fill(DIR_NONE), version: this.version, lastUse: tick,
      dead: false, pending: true,
    };
    this.fields.set(key, f);
    this.start(f, f.dirs);
    return f;
  }

  private start(f: Field, dirs: Uint8Array): void {
    this.computed++;
    const buf = this.pool.pop() ?? { dist: new Uint32Array(this.n), hd: new Uint32Array(this.n * 2), hc: new Int32Array(this.n * 2) };
    const job: Job = { field: f, dirs, dist: buf.dist, hd: buf.hd, hc: buf.hc, hs: 0, version: this.version };
    job.dist.fill(0xffffffff);
    for (let i = 0; i < f.seeds.length; i++) {
      const s = f.seeds[i];
      job.dist[s] = 0;
      dirs[s] = DIR_HERE;
      job.hd[job.hs] = 0;
      job.hc[job.hs++] = s;
    }
    f.pending = true;
    this.jobs.push(job);
  }

  /** 立即算完某张流场（测试与少数需要同步结果的场合） */
  finish(f: Field): void {
    const i = this.jobs.findIndex(j => j.field === f);
    if (i < 0) return;
    const job = this.jobs[i];
    this.step(job, Infinity);
    this.done(job);
    this.jobs.splice(i, 1);
  }

  private done(job: Job): void {
    const f = job.field;
    f.dirs = job.dirs;
    f.version = job.version;
    f.pending = false;
    this.pool.push({ dist: job.dist, hd: job.hd, hc: job.hc });
  }

  /** 每帧调用：推进排队中的流场计算，刷新过期流场，回收久未使用的流场 */
  maintain(tick: number): void {
    let budget = BUDGET;
    while (budget > 0 && this.jobs.length) {
      const job = this.jobs[0];
      budget = this.step(job, budget);
      if (job.hs > 0) break;
      this.done(job);
      this.jobs.shift();
    }
    if (tick % 20 === 0 && this.jobs.length < 2) {
      // 建筑被毁/易主后，仍在使用的旧流场在后台重算，算完再整体替换
      for (const f of this.fields.values()) {
        if (f.version !== this.version && !f.pending && f.lastUse >= tick - 60) {
          this.start(f, new Uint8Array(this.n).fill(DIR_NONE));
          break;
        }
      }
    }
    if (this.fields.size > 48 && tick % 64 === 0) {
      for (const [k, f] of this.fields) {
        if (f.lastUse < tick - 300 && !f.pending) {
          f.dead = true;
          this.fields.delete(k);
        }
      }
    }
  }

  /** 推进一次搜索，返回剩余预算 */
  private step(job: Job, budget: number): number {
    const cost = this.cost[job.field.team], blk = this.block[job.field.team];
    const dk = this.deck[job.field.team], inner = this.inner;
    const dist = job.dist, dirs = job.dirs;
    const off = this.off, offX = this.offX, offY = this.offY;
    let hd = job.hd, hc = job.hc, hs = job.hs;
    while (hs > 0 && budget-- > 0) {
      // 弹出堆顶
      const d = hd[0], c = hc[0];
      hs--;
      if (hs > 0) {
        const ld = hd[hs], lc = hc[hs];
        let i = 0;
        for (;;) {
          let l = 2 * i + 1;
          if (l >= hs) break;
          if (l + 1 < hs && hd[l + 1] < hd[l]) l++;
          if (hd[l] >= ld) break;
          hd[i] = hd[l];
          hc[i] = hc[l];
          i = l;
        }
        hd[i] = ld;
        hc[i] = lc;
      }
      if (d > dist[c]) continue;
      const cc = d === 0 ? 10 : cost[c]; // 进入 c 的代价（终点格固定为 10）
      const cd = (cc * 1.4142) | 0;
      const cBlocked = blk[c];
      for (let dir = 0; dir < 8; dir++) {
        const nc = c + off[dir];
        if (cost[nc] === 0) continue;
        let nd: number;
        if (dir & 1) {
          // 斜向：不允许擦着障碍角穿过
          if (cBlocked || blk[nc] || blk[c + offX[dir]] || blk[c + offY[dir]]) continue;
          // 上下墙只能正着走，也不许擦着墙角斜穿
          const k = dk[c];
          if (dk[nc] !== k || dk[c + offX[dir]] !== k || dk[c + offY[dir]] !== k) continue;
          nd = d + cd;
        } else {
          // 搜索是从终点往外扩的：这一步是单位从 nc 走到 c
          if (dk[c] !== dk[nc] && !(dk[nc] && inner[c])) continue;
          nd = d + cc;
        }
        if (nd < dist[nc]) {
          dist[nc] = nd;
          dirs[nc] = (dir + 4) & 7;
          if (hs >= hd.length) {
            const nhd = new Uint32Array(hd.length * 2), nhc = new Int32Array(hc.length * 2);
            nhd.set(hd);
            nhc.set(hc);
            hd = job.hd = nhd;
            hc = job.hc = nhc;
          }
          let i = hs++;
          while (i > 0) {
            const p = (i - 1) >> 1;
            if (hd[p] <= nd) break;
            hd[i] = hd[p];
            hc[i] = hc[p];
            i = p;
          }
          hd[i] = nd;
          hc[i] = nc;
        }
      }
    }
    job.hs = hs;
    return budget;
  }
}
