import { describe, expect, it } from 'vitest';
import { BUILDINGS, FACTIONS, RULES, SITE_CAMP, TILE, T_BRIDGE, T_DEEP, T_MOUNTAIN, UNIT_BY_KEY } from '../../../src/sim/defs';
import { O_AMOVE, O_IDLE, O_MOVE, S_COMBAT, S_ROUT } from '../../../src/sim/state';
import { startRout } from '../../../src/sim/systems/morale';
import { armyList, createGame } from '../../../src/sim/setup';
import { formation } from '../../../src/sim/systems/formation';
import { FOLLOW, FOLLOW_APART, FOLLOW_SLOT, FOLLOW_SQUEEZE, SLOT, marchFollow, marchRelease, marchSlot } from '../../../src/sim/systems/marchSlots';
import type { March } from '../../../src/sim/systems/march';
import { TRAIL } from '../../../src/sim/systems/marchTrail';
import type { World } from '../../../src/sim/world';
import { breathe, flatWorld, run } from '../../helpers';

const idx = (k: string): number => UNIT_BY_KEY[k].idx;
const M = RULES.march;
const C = (120 * TILE) / 2;

/** 一队 n 个刀盾（默认 80 个），围着 (cx, cy) 摆好，朝 (dx, dy) */
const squad = (w: World, cx: number, cy: number, dx = 1, dy = 0, n = 80): number[] => w.spawnGroup(1, Array(n).fill(idx('dao')), cx, cy, dx, dy);

/** 下令行军，返回队伍与它的 march */
function order(w: World, g: number[], tx: number, ty: number): March {
  w.orderMove(g, tx, ty, false);
  const gi = w.grp[g[0]];
  expect(gi).toBeGreaterThanOrEqual(0);
  return w.marches[gi];
}

/** 画一道矿山墙：格子范围 [x0, x1] × [y0, y1]（含两端） */
const wall = (t: Uint8Array, n: number, x0: number, x1: number, y0: number, y1: number): void => {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) t[y * n + x] = T_MOUNTAIN;
};

const inWall = (w: World, x: number, y: number): boolean => w.map.terrain[w.cellAt(x, y)] === T_MOUNTAIN;

/** 行军途中盯着的指标；统计到全员到达（命令都变回待命）为止 */
interface Watch {
  /** 全员到达用了多少秒，没到为 Infinity */
  secs: number;
  /** 行军途中队宽、纵深变过 */
  resized: boolean;
  /** 行军途中有成员的队列偏移被改写 */
  rewritten: boolean;
  /** 同一时刻落在走不通的格子里的最多人数 */
  inBlock: number;
  /** 行军途中连续 5 秒以上位移不到行军速度 15% 的最多人数 */
  stalled: number;
  /** 最前排走过的路程；成员走过的最长路程（像素） */
  leadPath: number;
  maxPath: number;
  /** 出发整队（头 2 秒）之后，队列压在障碍上（over 超过 overMin 的比例）的那些帧里最前排停下不动的帧数 */
  stops: number;
  /** 一开始的队宽与纵深 */
  width: number;
  depth: number;
}

/** 盯着一队人走到全员到达或超时：队宽纵深与队列偏移有没有变、有没有人落进走不通的格子、停顿人数、路程 */
async function watch(w: World, g: number[], m: March, maxSecs: number): Promise<Watch> {
  const gi = m.id, width = m.width, depth = m.depth;
  const offA = g.map(s => w.offA[s]), offL = g.map(s => w.offL[s]);
  const blk = w.nav.block[1];
  const px = g.map(s => w.x[s]), py = g.map(s => w.y[s]);
  const still = g.map(() => 0), path = g.map(() => 0);
  const r: Watch = { secs: Infinity, resized: false, rewritten: false, inBlock: 0, stalled: 0, leadPath: 0, maxPath: 0, stops: 0, width, depth };
  let lx = m.x, ly = m.y, over = false;
  const moving = (s: number): boolean => w.alive[s] === 1 && (w.order[s] === O_MOVE || w.order[s] === O_AMOVE);
  for (let t = 0; t < maxSecs * 30; t++) {
    await breathe(t);
    w.tick();
    w.fxN = 0;
    // 最前排到达后这个 march 对象会被别的队伍重用，统计到此为止
    if (m.arrived || !m.alive) over = true;
    const active = !over;
    if (active) {
      if (m.width !== width || m.depth !== depth) r.resized = true;
      if (t > 60 && m.v === 0 && m.over > Math.max(1, m.cnt * M.overMin)) r.stops++;
      r.leadPath += Math.hypot(m.x - lx, m.y - ly);
      lx = m.x;
      ly = m.y;
    }
    let inBlock = 0, stalled = 0, any = false;
    g.forEach((s, k) => {
      if (!w.alive[s]) return;
      const mv = Math.hypot(w.x[s] - px[k], w.y[s] - py[k]);
      path[k] += mv;
      px[k] = w.x[s];
      py[k] = w.y[s];
      if (blk[w.cellAt(w.x[s], w.y[s])]) inBlock++;
      if (!moving(s)) {
        still[k] = 0;
        return;
      }
      any = true;
      if (mv < w.defs[w.type[s]].walk / 30 * 0.15) {
        if (++still[k] >= 150) stalled++;
      } else still[k] = 0;
      if (active && w.grp[s] === gi && (w.offA[s] !== offA[k] || w.offL[s] !== offL[k])) r.rewritten = true;
    });
    r.inBlock = Math.max(r.inBlock, inBlock);
    r.stalled = Math.max(r.stalled, stalled);
    if (!any) {
      r.secs = (t + 1) / 30;
      break;
    }
  }
  r.maxPath = Math.max(...path);
  return r;
}

/** 平地上摆几处障碍、让一队 n 个刀盾从 from 走到 to（格坐标）的场景 */
interface Scene {
  paint?: (t: Uint8Array, n: number) => void;
  from: [number, number];
  to: [number, number];
  dir: [number, number];
  n?: number;
}

const SCENES: Record<string, Scene> = {
  // 东西向的山谷：x 50..80 格，谷宽 4 格
  valley: {
    paint: (t, n) => {
      for (let x = 50; x <= 80; x++) for (let y = 20; y < 110; y++) if (y < 58 || y > 61) t[y * n + x] = T_MOUNTAIN;
    },
    from: [25, 60], to: [115, 60], dir: [1, 0],
  },
  // 南北向的河，桥 2 格宽
  bridge: {
    paint: (t, n) => {
      for (let x = 60; x <= 64; x++) for (let y = 0; y < n; y++) t[y * n + x] = y === 58 || y === 59 ? T_BRIDGE : T_DEEP;
    },
    from: [35, 70], to: [105, 50], dir: [1, 0],
  },
  // 一道南北向的山梁挡在中间，只能从南头绕过去
  ridge: {
    paint: (t, n) => wall(t, n, 60, 63, 0, 84),
    from: [35, 60], to: [100, 50], dir: [1, 0],
  },
  // 乱石：每 6 格、每 5 格一块山，错开着摆
  rocks: {
    paint: (t, n) => {
      for (let x = 50; x <= 90; x += 6) for (let y = 40; y <= 80; y += 5) t[(y + (x % 4)) * n + x] = T_MOUNTAIN;
    },
    from: [30, 60], to: [110, 62], dir: [1, 0],
  },
};

const watched = new Map<string, Watch>();
/** 跑一遍场景（同样的场景只跑一遍） */
async function cross(name: string, count = 200): Promise<Watch> {
  const key = `${name}/${count}`;
  const hit = watched.get(key);
  if (hit) return hit;
  const sc = SCENES[name];
  const w = flatWorld(140, 7, sc.paint);
  const g = squad(w, sc.from[0] * TILE, sc.from[1] * TILE, sc.dir[0], sc.dir[1], count);
  const m = order(w, g, sc.to[0] * TILE, sc.to[1] * TILE);
  const r = await watch(w, g, m, 200);
  watched.set(key, r);
  return r;
}

/** 通用的「看得见的结果」：不变阵、没人落进走不通的格子、全员到达、停顿的人不多 */
function expectSmooth(r: Watch, count: number): void {
  expect(r.resized, '队宽或纵深变过').toBe(false);
  expect(r.rewritten, '队列偏移被改写').toBe(false);
  expect(r.inBlock, '落进走不通格子的人数').toBe(0);
  expect(r.secs, '全员到达的秒数').toBeLessThan(150);
  expect(r.stalled, '停顿的人数').toBeLessThanOrEqual(Math.max(3, count * 0.05));
}

describe('编队行军：不规则地形不变阵，各自找路过去', () => {
  for (const name of ['valley', 'bridge', 'ridge', 'rocks']) {
    const label = { valley: '窄山谷', bridge: '窄桥', ridge: '山梁', rocks: '乱石地' }[name];
    it(`${label}：队宽纵深与队列偏移不变、没人落进障碍、全员到达、停顿的人不多`, async () => {
      const r = await cross(name);
      expectSmooth(r, 200);
    }, 120000);
  }

  it('最短路线：最前排走的路程接近地形允许的最短路线，成员走的最长路程也在正常范围内（不绕整座山）', async () => {
    // 各场景起点到终点、沿必经之处（谷口、桥头、山梁南端）折线的路程（格）
    const shortest: Record<string, number> = {
      valley: 90,
      bridge: Math.hypot(25, 11) + 5 + Math.hypot(40, 9),
      ridge: Math.hypot(25, 25) + 5 + Math.hypot(36, 35.5),
      rocks: Math.hypot(80, 2),
    };
    for (const name of Object.keys(shortest)) {
      const r = await cross(name);
      expect(r.leadPath / TILE, `${name} 最前排`).toBeLessThan(shortest[name] * 1.15);
      expect(r.maxPath / TILE, `${name} 成员`).toBeLessThan(shortest[name] * 1.4);
    }
  }, 120000);
});

describe('编队行军：贴着长墙走、斜着走向没有门的墙', () => {
  const ROW = 70;

  // 墙在路线的哪一侧：朝东走，右手边是 +y。路线沿一格的中线走，墙与路线的间距 gap 格
  for (const n of [80, 300]) {
    for (const gap of [1, 3]) {
      for (const side of [1, -1]) {
        it(`一侧被长墙贴着：队宽纵深不变、没人落进墙里、全员到达（${n} 人，墙在${side > 0 ? '右' : '左'}手边，间距 ${gap} 格）`, async () => {
          const w = flatWorld(140, 7, (t, nn) => {
            if (side > 0) wall(t, nn, 50, 100, ROW + gap, ROW + gap + 1);
            else wall(t, nn, 50, 100, ROW - gap - 1, ROW - gap);
          });
          const cy = (ROW + 0.5) * TILE;
          const g = squad(w, 15 * TILE, cy, 1, 0, n);
          const m = order(w, g, 120 * TILE, cy);
          const r = await watch(w, g, m, 200);
          expect(r.resized).toBe(false);
          expect(r.rewritten).toBe(false);
          expect(r.inBlock).toBe(0);
          expect(r.secs).toBeLessThan(150);
          // 最前排走的是一条直线：贴着墙也不绕远
          expect(r.leadPath / TILE).toBeLessThan(110 * 1.05);
        }, 120000);
      }
    }
  }

  // 一道东西向的长墙在 y = 110 格；队伍从北边斜着往墙前的一点走，行进方向与墙成 angle 角
  for (const angle of [30, 60]) {
    for (const dir of [1, -1]) {
      it(`斜着走向墙前一点：队宽纵深不变、没人落进墙里、全员到达（与墙成 ${angle}°，朝${dir > 0 ? '东' : '西'}南）`, async () => {
        const WALL = 110;
        const w = flatWorld(140, 7, (t, n) => wall(t, n, 10, 130, WALL, WALL + 1));
        const rad = angle * Math.PI / 180;
        const dx = Math.cos(rad) * dir, dy = Math.sin(rad);
        // 终点在墙前 6 格；起点沿相反方向退回 55 格远
        const ex = (dir > 0 ? 90 : 50) * TILE, ey = (WALL - 6) * TILE;
        const len = 55 * TILE;
        const g = squad(w, ex - dx * len, ey - dy * len, dx, dy);
        const m = order(w, g, ex, ey);
        const r = await watch(w, g, m, 200);
        expect(r.resized).toBe(false);
        expect(r.rewritten).toBe(false);
        expect(r.inBlock).toBe(0);
        expect(r.secs).toBeLessThan(150);
      }, 120000);
    }
  }
});

describe('编队行军：真实地图上进营寨、穿营寨', () => {
  /** 真实地图上己方「前锋营」附近的三条路线（像素坐标）；一支 579 人的中国军 */
  const CAMP: Record<string, { from: [number, number]; to: [number, number]; dir: [number, number] }> = {
    enter: { from: [2080, 8160], to: [3072, 7136], dir: [Math.SQRT1_2, -Math.SQRT1_2] },
    south: { from: [3072, 7900], to: [3072, 7136], dir: [0, -1] },
    through: { from: [3072, 7900], to: [3072, 6500], dir: [0, -1] },
  };
  const results = new Map<string, Watch>();
  async function campRun(name: string): Promise<Watch> {
    const hit = results.get(name);
    if (hit) return hit;
    const w = createGame({ seed: 7, factions: ['china', 'rome'], armySize: 850, difficulty: 1, fog: false, spectate: false, environment: false, supply: false }).world;
    for (let i = 0; i < w.n; i++) if (w.alive[i]) w.removeUnit(i);
    const c = CAMP[name];
    const g = w.spawnGroup(1, armyList(FACTIONS.china, 850), c.from[0], c.from[1], c.dir[0], c.dir[1]);
    const camp = w.sites.find(s => s.type === SITE_CAMP && s.owner === 1)!;
    // 路线确实穿过或进入这座营寨
    expect(Math.abs(c.to[0] - camp.x)).toBeLessThan(TILE * 2);
    const m = order(w, g, c.to[0], c.to[1]);
    const r = await watch(w, g, m, 200);
    results.set(name, r);
    return r;
  }

  for (const [name, label] of [['enter', '斜着从西南进营'], ['south', '从正南进营'], ['through', '从南到北穿过营寨']]) {
    it(`${label}：队宽纵深不变、没人落进走不通的格子、全员到达、停顿的人不多（579 人）`, async () => {
      const r = await campRun(name);
      expectSmooth(r, 579);
    }, 180000);
  }

  it('穿过营寨：队列压在障碍上的那些帧里，最前排没有停下来等人（停下的帧数不到 3 秒）', async () => {
    const r = await campRun('through');
    expect(r.stops).toBeLessThan(90);
  }, 180000);
});

describe('marchSlot：队列位置的契约', () => {
  it('直线行军：各排的位置沿行迹往最前排身后依次排开，相邻两排的间距等于排深，同一排里两个位置相距 |l1 − l2|，连线垂直于前进方向', () => {
    const w = flatWorld(140);
    const g = squad(w, 25 * TILE, 70 * TILE);
    const m = order(w, g, 125 * TILE, 70 * TILE);
    run(w, 6);
    expect(m.v).toBeGreaterThan(0);
    expect(m.rows).toBeGreaterThan(3);
    const at = (r: number, l: number, c = 0): [number, number] => {
      marchSlot(m, r, c, l);
      return [SLOT.x, SLOT.y];
    };
    // 第 r 排中心沿朝向落在最前排身后 r 个排深（各排排深相同的刀盾队）：到最前排的距离 = 排深之和
    let behind = 0;
    for (let r = 0; r < m.rows; r++) {
      if (r > 0) behind += (m.rowD[r - 1] + m.rowD[r]) / 2;
      const [x, y] = at(r, 17);
      const [x0, y0] = at(0, 17);
      expect((x0 - x) * m.hx + (y0 - y) * m.hy).toBeCloseTo(behind, 3);
      expect(Math.hypot(x0 - x, y0 - y)).toBeCloseTo(behind, 3);
      // 相邻两排的间距 = 两排排深的平均
      if (r > 0) {
        const [px, py] = at(r - 1, 17);
        expect(Math.hypot(px - x, py - y)).toBeCloseTo((m.rowD[r - 1] + m.rowD[r]) / 2, 3);
      }
    }
    // 同一排里横向偏移差多少就相距多少，连线垂直于前进方向
    for (let r = 0; r < m.rows; r++) {
      const [x1, y1] = at(r, -60), [x2, y2] = at(r, 45);
      expect(Math.hypot(x1 - x2, y1 - y2)).toBeCloseTo(105, 3);
      expect((x2 - x1) * SLOT.hx + (y2 - y1) * SLOT.hy).toBeCloseTo(0, 3);
    }
  }, 30000);

  it('直线行军：最前排、l = 0 就是最前排的位置，位置的行进方向就是最前排的朝向，正的 l 在朝向的右手边', () => {
    const w = flatWorld(140);
    const g = squad(w, 25 * TILE, 70 * TILE);
    const m = order(w, g, 125 * TILE, 70 * TILE);
    run(w, 6);
    marchSlot(m, 0, 0, 0);
    expect(SLOT.x).toBeCloseTo(m.x, 3);
    expect(SLOT.y).toBeCloseTo(m.y, 3);
    expect(SLOT.hx).toBeCloseTo(m.hx, 3);
    expect(SLOT.hy).toBeCloseTo(m.hy, 3);
    // 朝东走：右手边是 +y
    marchSlot(m, 0, 0, 50);
    expect(SLOT.y - m.y).toBeCloseTo(50 * m.hx, 3);
    expect(SLOT.x - m.x).toBeCloseTo(-50 * m.hy, 3);
    expect(SLOT.y).toBeGreaterThan(m.y);
  }, 30000);

  it('转弯时（开阔地、没有窄处）：第 r 排在沿探路点实际走过的路、从最前排落后探路点处再往回数 −rowA 的地方，l 是在该处朝向的右手边再横移的距离，SLOT.hx/hy 是该处的行进方向', () => {
    // 一道南北向的山梁挡在中间，从南头绕过去
    const w = flatWorld(140, 7, (t, n) => wall(t, n, 60, 63, 0, 84));
    const g = squad(w, 35 * TILE, 60 * TILE);
    const m = order(w, g, 100 * TILE, 50 * TILE);
    // 探路点的实际足迹：累计路程、位置、朝向。最前排是行迹上落后探路点 m.lead 的那一点，第 r 排再往后 −rowA[r]
    interface Rec { s: number; x: number; y: number; hx: number; hy: number }
    const hist: Rec[] = [{ s: 0, x: m.px, y: m.py, hx: m.phx, hy: m.phy }];
    // 在足迹上找累计路程为 s 的点
    const pick = (s: number): Rec => {
      let k = hist.length - 1;
      while (k > 0 && hist[k - 1].s >= s) k--;
      const a = hist[Math.max(0, k - 1)], b = hist[k];
      const f = b.s > a.s ? (s - a.s) / (b.s - a.s) : 0;
      return { s, x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, hx: a.hx + (b.hx - a.hx) * f, hy: a.hy + (b.hy - a.hy) * f };
    };
    let checked = 0, turned = 0, rowsChecked = 0;
    for (let t = 1; t < 30 * 200 && !m.arrived; t++) {
      const px = m.px, py = m.py;
      w.tick();
      w.fxN = 0;
      if (m.arrived) break;
      const last = hist[hist.length - 1];
      hist.push({ s: last.s + Math.hypot(m.px - px, m.py - py), x: m.px, y: m.py, hx: m.phx, hy: m.phy });
      if (t % 30 || last.s < 700) continue;
      const S = hist[hist.length - 1].s;
      // 比行迹还靠后的位置是从最老的一点直排下去的，不再跟着走过的路：只抽查行迹以内的各排
      for (let r = 0; r < m.rows; r++) {
        const a = m.rowA[r];
        if (-a + m.lead > (m.cap - 2) * M.trailStep) continue;
        const ref = pick(S - m.lead + a);
        const nx = -ref.hy, ny = ref.hx;
        for (const l of [-50, 0, 35]) {
          marchSlot(m, r, 0, l);
          expect(Math.hypot(SLOT.x - (ref.x + nx * l), SLOT.y - (ref.y + ny * l))).toBeLessThan(3);
          expect(Math.hypot(SLOT.hx - ref.hx, SLOT.hy - ref.hy)).toBeLessThan(0.08);
        }
        // 同一排里不同 l：相距 |Δl|，连线垂直于该处的前进方向
        marchSlot(m, r, 0, -20);
        const x1 = SLOT.x, y1 = SLOT.y;
        marchSlot(m, r, 0, 20);
        expect(Math.hypot(SLOT.x - x1, SLOT.y - y1)).toBeCloseTo(40, 0);
        expect((SLOT.x - x1) * SLOT.hx + (SLOT.y - y1) * SLOT.hy).toBeCloseTo(0, 3);
        rowsChecked++;
      }
      checked++;
      if (Math.abs(pick(S - 300).hx - pick(S).hx) + Math.abs(pick(S - 300).hy - pick(S).hy) > 0.3) turned++;
    }
    expect(checked).toBeGreaterThan(10);
    expect(rowsChecked).toBeGreaterThan(checked * 3);
    // 抽查的时刻里确实有过转弯
    expect(turned).toBeGreaterThan(0);
  }, 60000);
});

describe('marchFollow：成员这一帧跟着哪一点走', () => {
  const CY = 70.5 * TILE;
  const N = 200;
  /** 摆好障碍后的场景：n 个刀盾刚下令（还没走），挑一个前排、l 约 −126 的成员，SLOT 是他此刻的位置与本排中线点 */
  interface Ctx { w: World; m: March; u: number; l: number; sx: number; sy: number; cx: number; cy: number }
  /**
   * paint 拿到他的位置与中线点（像素）、返回摆障碍的函数。刚下令时队列朝东、位置的 x 与中线点相同，
   * 中线点在位置的右手边（+y 一侧）l 远处，所以位置在中线点北边（y 更小）
   */
  function setup(paint: (sx: number, sy: number, cx: number, cy: number) => (t: Uint8Array, n: number) => void = () => () => {}): Ctx {
    const build = (p?: (t: Uint8Array, n: number) => void) => {
      const w = flatWorld(140, 7, p);
      const g = squad(w, 20 * TILE, CY, 1, 0, N);
      const m = order(w, g, 120 * TILE, CY);
      return { w, g, m };
    };
    const dry = build();
    let u = dry.g[0], bl = Infinity;
    for (const s of dry.g) {
      const e = Math.abs(dry.w.offL[s] + 126);
      if (dry.w.offA[s] > -1 && e < bl) {
        bl = e;
        u = s;
      }
    }
    const k = dry.g.indexOf(u);
    marchSlot(dry.m, dry.w.marchRow[u], dry.w.marchCol[u], dry.w.offL[u]);
    // 障碍摆在队伍前方 AHEAD 处（摆在队伍脚下会把人挤开、队列也跟着变），再把最前排连同行迹整体挪过去
    const AHEAD = 480;
    const { x: sx, y: sy, cx, cy } = SLOT;
    const { w, g, m } = build(paint(sx + AHEAD, sy, cx + AHEAD, cy));
    m.x += AHEAD;
    // 行迹每点 TRAIL 个数，头一个是位置的 x；探路点也一起挪
    for (let i = 0; i < m.cap; i++) m.trail[i * TRAIL] += AHEAD;
    m.px += AHEAD;
    const v = g[k];
    marchSlot(m, w.marchRow[v], w.marchCol[v], w.offL[v]);
    expect(SLOT.x - AHEAD).toBeCloseTo(sx, 3);
    expect(SLOT.y).toBeCloseTo(sy, 3);
    return { w, m, u: v, l: w.offL[v], sx: SLOT.x, sy: SLOT.y, cx: SLOT.cx, cy: SLOT.cy };
  }
  const follow = (c: Ctx, ux: number, uy: number): number => {
    marchSlot(c.m, c.w.marchRow[c.u], c.w.marchCol[c.u], c.l);
    return marchFollow(c.w, c.m, ux, uy);
  };
  /** 以 (x, y) 为中心的一格 */
  const tileAt = (t: Uint8Array, n: number, x: number, y: number): void => {
    t[((y / TILE) | 0) * n + ((x / TILE) | 0)] = T_MOUNTAIN;
  };
  /** 一根 3 行高的石柱：朝中线的一边离中线 80 像素，位置落在柱子里 */
  const pillarAround = (sx: number) => (t: Uint8Array, n: number): void => {
    const edgeRow = Math.round((CY - 80) / TILE);
    for (let y = edgeRow - 3; y < edgeRow; y++) for (let x = ((sx / TILE) | 0) - 1; x <= ((sx / TILE) | 0) + 1; x++) t[y * n + x] = T_MOUNTAIN;
  };

  it('位置站得住、成员到位置直走得通：返回 FOLLOW_SLOT，跟着位置本身走（障碍在别处不影响）', () => {
    const c = setup((sx, sy) => (t, n) => tileAt(t, n, sx + 160, sy));
    const r = follow(c, c.sx - 30, c.sy + 10);
    expect(r).toBe(FOLLOW_SLOT);
    expect(FOLLOW.x).toBeCloseTo(c.sx, 3);
    expect(FOLLOW.y).toBeCloseTo(c.sy, 3);
  });

  it('SLOT 带着本排中线点：与位置同一排、横向偏移为 0 处，即位置朝中线横移回 l', () => {
    const c = setup();
    follow(c, c.sx, c.sy);
    expect(c.l).toBeLessThan(-110);
    // 刚下令、朝东：中线点与位置同 x；位置在中线点的左手边 |l| 远
    expect(SLOT.cx).toBeCloseTo(SLOT.x, 3);
    expect(SLOT.cy - SLOT.y).toBeCloseTo(-c.l, 3);
    expect(SLOT.cy).toBeCloseTo(CY, 1);
  });

  it('位置落在障碍里、看得见中线点：返回 FOLLOW_SQUEEZE，往中线收拢：目标离中线 = 中线到障碍跟前的距离 × |l| × 2 ÷ 队宽，在位置同一条横线上', () => {
    const c = setup(sx => pillarAround(sx));
    // 成员在中线上、位置的正南偏西一点
    const r = follow(c, c.cx - 10, c.cy);
    expect(r).toBe(FOLLOW_SQUEEZE);
    // 中线到柱子跟前 80 像素，量到的距离离柱子不到 16 像素
    const k = [(80 - 16) * -c.l * 2 / c.m.width, 80 * -c.l * 2 / c.m.width];
    const lat = c.cy - FOLLOW.y;
    expect(lat).toBeGreaterThanOrEqual(k[0] - 1);
    expect(lat).toBeLessThanOrEqual(k[1] + 1);
    expect(FOLLOW.x).toBeCloseTo(c.sx, 3);
    // 目标站得住，在中线与柱子之间
    expect(c.w.map.terrain[c.w.cellAt(FOLLOW.x, FOLLOW.y)]).not.toBe(T_MOUNTAIN);
    expect(lat).toBeGreaterThan(0);
    expect(lat).toBeLessThan(80);
  });

  it('位置站得住、但中线点到位置隔着一道薄墙：reach < 1，同样往中线收拢，按走得通的那一段算宽度', () => {
    // 薄墙一格厚，朝中线的一边离中线 80 像素；位置在墙外一格里（站得住）
    const c = setup(sx => (t, n) => {
      const row = Math.round((CY - 80) / TILE) - 1;
      for (let x = ((sx / TILE) | 0) - 2; x <= ((sx / TILE) | 0) + 2; x++) t[row * n + x] = T_MOUNTAIN;
    });
    const r = follow(c, c.cx - 10, c.cy);
    expect(r).toBe(FOLLOW_SQUEEZE);
    const lat = c.cy - FOLLOW.y;
    expect(lat).toBeGreaterThanOrEqual((80 - 16) * -c.l * 2 / c.m.width - 1);
    expect(lat).toBeLessThanOrEqual(80 * -c.l * 2 / c.m.width + 1);
  });

  it('位置站得住、中线点到位置走得通，只是成员自己被一小块障碍挡住：这一侧没有变窄，目标是位置本身的方向（k = 1），看不见它时 FOLLOW 是中线点', () => {
    // 成员站在位置西边 96 像素；他与位置之间立一格障碍。
    // 若按「往中线拉」的算法，目标会落在中线与位置之间约 74% 处，从他这里看得见，FOLLOW 就不是中线点
    const c = setup((sx, sy) => (t, n) => tileAt(t, n, sx - 48, sy));
    const ux = c.sx - 96, uy = c.sy;
    const r = follow(c, ux, uy);
    expect(r).toBe(FOLLOW_SQUEEZE);
    expect(FOLLOW.x).toBeCloseTo(c.cx, 3);
    expect(FOLLOW.y).toBeCloseTo(c.cy, 3);
    // 对照：没有这块障碍就是 FOLLOW_SLOT
    const open = setup();
    expect(follow(open, open.sx - 96, open.sy)).toBe(FOLLOW_SLOT);
  });

  it('收拢的目标点被挡：退到中线点', () => {
    // 位置落在柱子里；成员在中线点西边 96 像素，他到收拢目标点的直线上立一格障碍，到中线点的直线是通的
    const probe = setup(sx => pillarAround(sx));
    follow(probe, probe.cx - 96, probe.cy);
    const qx = FOLLOW.x, qy = FOLLOW.y;
    expect(qy).toBeLessThan(probe.cy);
    const bx = (probe.cx - 96 + qx) / 2, by = (probe.cy + qy) / 2;
    const c = setup(sx => (t, n) => {
      pillarAround(sx)(t, n);
      tileAt(t, n, bx, by);
    });
    const ux = c.cx - 96, uy = c.cy;
    // 障碍确实在去目标点的路上，没在去中线点的路上
    expect(c.w.lineBlocked(ux, uy, qx, qy, 1)).toBe(true);
    expect(c.w.lineBlocked(ux, uy, c.cx, c.cy, 1)).toBe(false);
    expect(follow(c, ux, uy)).toBe(FOLLOW_SQUEEZE);
    expect(FOLLOW.x).toBeCloseTo(c.cx, 3);
    expect(FOLLOW.y).toBeCloseTo(c.cy, 3);
  });

  it('位置够不着、连中线点也看不见（成员与本排之间隔着一道墙）：返回 FOLLOW_APART，不填 FOLLOW', () => {
    // 成员在中线点南边 96 像素，中线点与他之间横着一道长墙；位置在中线点北边
    const c = setup((sx, sy, cx, cy) => (t, n) => {
      const row = ((cy + 48) / TILE) | 0;
      for (let x = ((cx / TILE) | 0) - 8; x <= ((cx / TILE) | 0) + 8; x++) t[row * n + x] = T_MOUNTAIN;
    });
    FOLLOW.x = FOLLOW.y = -777;
    const r = follow(c, c.cx, c.cy + 96);
    expect(r).toBe(FOLLOW_APART);
    expect(FOLLOW.x).toBe(-777);
    expect(FOLLOW.y).toBe(-777);
  });

  it('位置在地图外、成员与中线点之间走得通：不跟位置走，往中线收拢（不返回 FOLLOW_SLOT）', () => {
    // 贴着地图上缘行进：位置的 y 小于 8
    const w = flatWorld(140);
    const g = squad(w, 20 * TILE, 3 * TILE, 1, 0, N);
    const m = order(w, g, 120 * TILE, 3 * TILE);
    let out = -1;
    for (const s of g) if (w.offL[s] < -100 && w.offA[s] > -1) out = s;
    expect(out).toBeGreaterThanOrEqual(0);
    marchSlot(m, w.marchRow[out], w.marchCol[out], w.offL[out]);
    expect(SLOT.y).toBeLessThan(8);
    const r = marchFollow(w, m, SLOT.cx - 10, SLOT.cy);
    expect(r).toBe(FOLLOW_SQUEEZE);
    expect(FOLLOW.y).toBeGreaterThanOrEqual(8 - 16);
    expect(FOLLOW.y).toBeLessThan(SLOT.cy);
  });
});

describe('最前排等不等人：队列压在障碍上时不等够不着位置的人，走出障碍后才等（山梁：只有一侧有障碍，不收窄）', () => {
  /** 按需求里的口径，从场上的状态算出这一轮统计（每 8 帧一次）应得的 over 与 lag */
  function expected(w: World, g: number[], m: March): { over: number; lag: number; cnt: number; lagApart: number; draped: boolean } {
    let cnt = 0, over = 0, lagSum = 0, lagApart = 0;
    const blk = w.nav.block[m.team];
    for (const s of g) {
      if (!w.alive[s] || w.grp[s] !== m.id || w.state[s] & S_ROUT) continue;
      cnt++;
      if (w.state[s] & S_COMBAT) continue;
      marchSlot(m, w.marchRow[s], w.marchCol[s], w.offL[s]);
      const sx = SLOT.x, sy = SLOT.y, hx = SLOT.hx, hy = SLOT.hy;
      // 本排中线上的那一点
      const cx = SLOT.cx, cy = SLOT.cy;
      if (sx < 8 || sy < 8 || sx > w.W - 8 || sy > w.H - 8 || blk[w.cellAt(sx, sy)] === 1 || w.lineBlocked(cx, cy, sx, sy, m.team)) over++;
      const ox = sx - w.x[s], oy = sy - w.y[s];
      if (ox * hx + oy * hy < -M.waitAhead) continue;
      const lag = Math.min(400, Math.hypot(ox, oy));
      if (w.apart[s]) lagApart += lag;
      else lagSum += lag;
    }
    const draped = over > Math.max(1, cnt * M.overMin);
    return { over, lag: (lagSum + (draped ? 0 : lagApart)) / cnt, cnt, lagApart, draped };
  }

  /** 一队 n 个刀盾绕山梁（只有一侧有障碍，队列不收窄、压在山上的人各自找路）；每一轮统计前后对照 expected 的结果；返回压在障碍上的帧里最前排的最低速度比（占行军速度）与「若也算够不着的人」的掉队距离 */
  async function bridge(n: number): Promise<{ drapedWithApart: number; openWithApart: number; slowest: number; counted: number; arrived: boolean }> {
    const sc = SCENES.ridge;
    const w = flatWorld(140, 7, sc.paint);
    const g = squad(w, sc.from[0] * TILE, sc.from[1] * TILE, sc.dir[0], sc.dir[1], n);
    const m = order(w, g, sc.to[0] * TILE, sc.to[1] * TILE);
    let drapedWithApart = 0, openWithApart = 0, slowest = Infinity, stats = 0, counted = 0;
    for (let t = 0; t < 30 * 200 && !m.arrived; t++) {
      await breathe(t);
      // 统计在 tickCount 为 8 的倍数的那一帧，march 系统先于 units 系统，用的是上一帧收尾时场上的状态
      const exp = ((w.tickCount + 1) & 7) === 0 ? expected(w, g, m) : null;
      w.tick();
      w.fxN = 0;
      if (m.arrived) break;
      if (exp) {
        stats++;
        expect(m.over, `第 ${t} 帧 over`).toBe(exp.over);
        expect(m.lag, `第 ${t} 帧 lag`).toBeCloseTo(exp.lag, 3);
        if (exp.lagApart > 0) {
          if (exp.draped) drapedWithApart++;
          else openWithApart++;
        }
      }
      // 上一轮统计判定队列压在障碍上（或没压）之后，最前排在这一帧走的速度
      if (t > 90 && m.over > Math.max(1, m.cnt * M.overMin)) {
        slowest = Math.min(slowest, m.v / m.speed);
        // 假如把够不着位置的人也算进去，掉队距离会是多少
        counted = Math.max(counted, m.lag + m.lagApart / m.cnt);
      }
    }
    expect(stats).toBeGreaterThan(100);
    return { drapedWithApart, openWithApart, slowest, counted, arrived: m.arrived };
  }

  it('每一轮统计：over 是落在障碍里、出图或与中线点隔开的位置数；压在障碍上时 lag 不含够不着位置的人，否则含（山梁，200 人）', async () => {
    const r = await bridge(200);
    expect(r.arrived).toBe(true);
    // 两种情形都出现过，用例才有意义
    expect(r.drapedWithApart).toBeGreaterThan(5);
    expect(r.openWithApart).toBeGreaterThan(0);
  }, 120000);

  it('队列压在障碍上的那一段最前排不停（山梁，200 人与 579 人）：够不着位置的人若也算进去，最前排本会被拖慢', async () => {
    for (const n of [200, 579]) {
      const r = await bridge(n);
      // 只算跟着位置走的人：最前排至少还以一半以上的速度前进
      expect(r.slowest, `${n} 人`).toBeGreaterThan(0.5);
      // 对照：把够不着的人也算进去，平均掉队距离已超过 lagFull，最前排会被拖慢
      expect(r.counted, `${n} 人`).toBeGreaterThan(M.lagFull);
    }
  }, 180000);
});

describe('编队行军：成员怎么走（队伍没在打）', () => {
  const CY = 70.5 * TILE;
  /** n 个刀盾从 (x0, 70.5) 格朝东走向 (120, 70.5) 格；paint 摆障碍 */
  const scene = (n: number, paint?: (t: Uint8Array, nn: number) => void, x0 = 20) => {
    const w = flatWorld(140, 7, paint);
    const g = squad(w, x0 * TILE, CY, 1, 0, n);
    const m = order(w, g, 120 * TILE, CY);
    return { w, g, m };
  };
  const tick = (w: World, n: number, each?: () => void): void => {
    for (let t = 0; t < n; t++) {
      w.tick();
      w.fxN = 0;
      each?.();
    }
  };

  it('开阔地上每个人都够得着位置：apart 始终为 0，每个人都跟在自己的位置上', () => {
    const { w, g, m } = scene(80);
    let apart = 0;
    tick(w, 30 * 20, () => {
      for (const s of g) apart += w.apart[s];
    });
    expect(apart).toBe(0);
    for (const s of g) {
      marchSlot(m, w.marchRow[s], w.marchCol[s], w.offL[s]);
      expect(Math.hypot(SLOT.x - w.x[s], SLOT.y - w.y[s])).toBeLessThan(20);
    }
  });

  it('够得着位置、落后了：跑步追（速度超过行军速度、不超过奔跑速度），不算够不着位置', () => {
    const { w, g, m } = scene(6);
    const r = g[0];
    tick(w, 9);
    w.x[r] -= 100;
    const d = w.defs[w.type[r]];
    let peak = 0, apart = 0, px = w.x[r], py = w.y[r];
    tick(w, 30 * 6, () => {
      peak = Math.max(peak, Math.hypot(w.x[r] - px, w.y[r] - py) * 30);
      px = w.x[r];
      py = w.y[r];
      apart += w.apart[r];
    });
    expect(peak).toBeGreaterThan(d.walk * 1.2);
    expect(peak).toBeLessThanOrEqual(d.speed * 1.02);
    expect(apart).toBe(0);
    marchSlot(m, w.marchRow[r], w.marchCol[r], w.offL[r]);
    expect(Math.hypot(SLOT.x - w.x[r], SLOT.y - w.y[r])).toBeLessThan(20);
  });

  describe('位置落在障碍里、但本排中线上那一点看得见：往中线收拢着随本排走', () => {
    // 队宽 342（200 个刀盾）；一根 4 格宽、3 格高的石柱立在路线左侧，朝向中线的一边离中线 80 像素：
    // 左翼 l 在 −80 ~ −171 的人，位置经过时都落在柱子里
    const N = 200, EDGE = 80, PX0 = 60, PX1 = 63;
    const edgeRow = Math.round((CY - EDGE) / TILE);
    const pillar = (t: Uint8Array, nn: number): void => {
      for (let y = edgeRow - 3; y < edgeRow; y++) for (let x = PX0; x <= PX1; x++) t[y * nn + x] = T_MOUNTAIN;
    };

    it('位置在柱子里的人：不进柱子，站到中线与柱子之间，离中线的距离 = 中线到柱子跟前的距离 × |l| ÷ 半个队宽；柱子过去后回到位置上', () => {
      // 先用一个没有柱子的世界挑出左翼中段（l 约 −126）的前排单位
      const dry = scene(N);
      let best = 0, bl = Infinity;
      dry.g.forEach((s, k) => {
        const e = Math.abs(dry.w.offL[s] + 126);
        if (dry.w.offA[s] > -1 && e < bl) {
          bl = e;
          best = k;
        }
      });
      const { w, g, m } = scene(N, pillar);
      const u = g[best], l = w.offL[u], r = w.marchRow[u], c = w.marchCol[u];
      expect(l).toBeLessThan(-110);
      expect(l).toBeGreaterThan(-140);
      const edgeY = edgeRow * TILE;
      const dEdge = CY - edgeY;
      expect(dEdge).toBeCloseTo(EDGE, 5);
      const half = m.width / 2;
      const lo = (dEdge - 16) * -l / half - 8, hi = dEdge * -l / half + 8;
      let inside = 0, aparts = 0, entered = false, settled = 0;
      tick(w, 30 * 50, () => {
        marchSlot(m, r, c, l);
        if (w.map.terrain[w.cellAt(w.x[u], w.y[u])] === T_MOUNTAIN) entered = true;
        // 位置走到柱子里一格半之后的那些帧（前面一段他还在从原来的位置往里收）
        if (SLOT.x > (PX0 + 2.5) * TILE && SLOT.x < (PX1 + 0.5) * TILE) {
          inside++;
          if (w.apart[u]) aparts++;
          // 位置确实落在柱子里
          expect(inWall(w, SLOT.x, SLOT.y)).toBe(true);
          const lat = CY - w.y[u];
          if (lat >= lo && lat <= hi) settled++;
        }
      });
      expect(entered).toBe(false);
      expect(inside).toBeGreaterThan(15);
      expect(aparts).toBe(inside);
      expect(settled).toBe(inside);
      // 柱子过去之后：回到自己的位置上，不再算够不着
      marchSlot(m, r, c, l);
      expect(w.apart[u]).toBe(0);
      expect(Math.hypot(SLOT.x - w.x[u], SLOT.y - w.y[u])).toBeLessThan(20);
    }, 60000);

    it('这些人是随本排走的，不是各自赶路：位置落在柱子里的整个过程中，他们没有跑到最前排前面去', () => {
      const { w, g, m } = scene(N, pillar);
      let ahead = 0, apartMax = 0;
      tick(w, 30 * 50, () => {
        let ap = 0;
        for (const s of g) {
          if (!w.apart[s]) continue;
          ap++;
          if ((w.x[s] - m.x) * m.hx + (w.y[s] - m.y) * m.hy > 40) ahead++;
        }
        apartMax = Math.max(apartMax, ap);
      });
      // 确有一批人在收拢
      expect(apartMax).toBeGreaterThan(10);
      expect(ahead).toBe(0);
    }, 60000);

    it('队伍散开（loose）时不排队，这一帧的 apart 记为 0', () => {
      const { w, g, m } = scene(N, pillar);
      // 走到柱子里有位置的时候
      let k = 0;
      for (; k < 30 * 60 && !g.some(s => w.apart[s]); k++) tick(w, 1);
      expect(g.some(s => w.apart[s])).toBe(true);
      // 统计在 tickCount 为 8 的倍数的帧；挑一个不是统计的帧，免得 loose 马上被改回去
      while (((w.tickCount + 1) & 7) === 0) tick(w, 1);
      m.loose = true;
      tick(w, 1);
      expect(g.some(s => w.apart[s])).toBe(false);
    }, 60000);
  });

  describe('位置够不着、本排中线点也看不见（隔着墙）：不等，沿自己的路线找路过去，过去之后再归队', () => {
    // 一道东西向的墙：x 50..70 格，第 71、72 行；路线在墙北侧的第 70 行。把一个前排中线上的人挪到墙南侧
    const scene2 = () => {
      const s = scene(80, (t, nn) => wall(t, nn, 50, 70, 71, 72), 40);
      const { w, g, m } = s;
      let u = g[0], bl = Infinity;
      for (const x of g) if (w.offA[x] > -1 && Math.abs(w.offL[x]) < bl) {
        bl = Math.abs(w.offL[x]);
        u = x;
      }
      tick(w, 90);
      w.x[u] = 60.5 * TILE;
      w.y[u] = 74.5 * TILE;
      return { ...s, u, m };
    };
    /** 一小队 6 个刀盾在墙北（第 68 行）从 x = 50 格往东走，一个前排的人被挪到墙南侧、队列位置的西南：他够不着位置也看不见本排，位置在他前方 */
    const sceneAhead = () => {
      const w = flatWorld(140, 7, (t, nn) => wall(t, nn, 40, 80, 71, 72));
      const cy = 68.5 * TILE;
      const g = squad(w, 50 * TILE, cy, 1, 0, 6);
      const m = order(w, g, 120 * TILE, cy);
      tick(w, 20);
      const u = g.find(s => w.offA[s] > -1)!;
      w.x[u] = 46 * TILE;
      w.y[u] = 74.5 * TILE;
      return { w, g, m, u };
    };

    it('位置在自己身后：apart 为 1，按本排此刻的速度走（不是奔跑速度，不跑到队伍前面去），不进墙；绕过墙端、看得见位置之后 apart 回到 0', () => {
      const { w, m, u } = scene2();
      const d = w.defs[w.type[u]];
      let apartFrames = 0, entered = false, aroundAt = -1, speedSum = 0, speedN = 0, peak = 0, px = w.x[u], py = w.y[u];
      for (let t = 0; t < 30 * 25; t++) {
        tick(w, 1);
        const sp = Math.hypot(w.x[u] - px, w.y[u] - py) * 30;
        px = w.x[u];
        py = w.y[u];
        if (inWall(w, w.x[u], w.y[u])) entered = true;
        if (w.apart[u]) {
          apartFrames++;
          // 一开始的 5 秒：路上没有别的阻碍，位置一直在他身后，本排在匀速走
          if (t < 30 * 5) {
            speedSum += sp;
            speedN++;
            peak = Math.max(peak, sp);
          }
        } else if (aroundAt < 0) aroundAt = t;
        if (aroundAt < 0 && t < 30 * 5) expect(w.apart[u]).toBe(1);
      }
      expect(entered).toBe(false);
      expect(apartFrames).toBeGreaterThan(30 * 5);
      // 与本排同速（刀盾的行军速度），远低于奔跑速度
      expect(m.v).toBeGreaterThan(0);
      expect(speedSum / speedN).toBeGreaterThan(m.v * 0.95);
      expect(speedSum / speedN).toBeLessThanOrEqual(m.v * 1.05);
      expect(peak).toBeLessThan(d.speed * 0.8);
      // 过了墙端（71 格）之后就不再算够不着
      expect(aroundAt).toBeGreaterThan(0);
      expect(w.x[u]).toBeGreaterThan(71 * TILE);
      expect(m.arrived).toBe(false);
    }, 60000);

    it('位置在自己身后、本排停下等人（速度为 0）：仍按自己行军速度的 apartTrail 倍以上沿路线走，不在墙边干站', () => {
      const { w, g, m, u } = scene2();
      const d = w.defs[w.type[u]];
      // 把一大半人挪回队伍后面 400 像素：平均掉队距离超过 lagStop，最前排原地等
      let moved = 0;
      for (const s of g) {
        if (s === u || moved >= 50) continue;
        w.x[s] -= 400;
        moved++;
      }
      let still = true, peak = 0, px = w.x[u], py = w.y[u];
      // 统计每 8 帧一次，等本排停下；之后量他的速度
      tick(w, 12);
      px = w.x[u];
      py = w.y[u];
      expect(m.v).toBe(0);
      for (let t = 0; t < 10; t++) {
        tick(w, 1);
        peak = Math.max(peak, Math.hypot(w.x[u] - px, w.y[u] - py) * 30);
        px = w.x[u];
        py = w.y[u];
        if (m.v > 0) still = false;
      }
      expect(still).toBe(true);
      expect(w.apart[u]).toBe(1);
      expect(peak).toBeGreaterThanOrEqual(d.walk * M.apartTrail * 0.95);
      expect(peak).toBeLessThanOrEqual(d.speed * 1.02);
    }, 60000);

    it('位置在自己前方：跑步追（奔跑速度），位置落到身后之后改按本排的速度', () => {
      const { w, m, u } = sceneAhead();
      const d = w.defs[w.type[u]];
      let runSum = 0, runN = 0, trail = 0, trailN = 0, px = w.x[u], py = w.y[u], entered = false;
      for (let t = 0; t < 30 * 12; t++) {
        tick(w, 1);
        const sp = Math.hypot(w.x[u] - px, w.y[u] - py) * 30;
        px = w.x[u];
        py = w.y[u];
        if (inWall(w, w.x[u], w.y[u])) entered = true;
        if (!w.apart[u]) continue;
        marchSlot(m, w.marchRow[u], w.marchCol[u], w.offL[u]);
        const ahead = (SLOT.x - w.x[u]) * SLOT.hx + (SLOT.y - w.y[u]) * SLOT.hy;
        // 位置明显在前方时取数；已落到身后（超过 waitAhead）时另取
        if (ahead > 40 && t > 3) {
          runSum += sp;
          runN++;
        } else if (ahead < -M.waitAhead - 1) {
          trail += sp;
          trailN++;
        }
      }
      expect(entered).toBe(false);
      expect(runN).toBeGreaterThan(30);
      expect(runSum / runN).toBeGreaterThan(d.speed * 0.95);
      expect(runSum / runN).toBeLessThanOrEqual(d.speed * 1.02);
      // 追上并超过位置之后：与本排同速（行军速度），不再跑
      expect(trailN).toBeGreaterThan(30);
      expect(trail / trailN).toBeLessThan(d.speed * 0.8);
      expect(trail / trailN).toBeGreaterThan(d.walk * 0.9);
    }, 60000);

    it('归队时位置若落在自己身后：原地等，不往回跑', () => {
      const { w, u } = scene2();
      // 绕过墙端（沿本排的速度走，要比跑步多花些时间）
      for (let t = 0; t < 30 * 30 && !(w.x[u] > 71 * TILE && !w.apart[u]); t++) tick(w, 1);
      expect(w.apart[u]).toBe(0);
      const x0 = w.x[u], y0 = w.y[u];
      tick(w, 30 * 5);
      expect(Math.hypot(w.x[u] - x0, w.y[u] - y0)).toBeLessThan(6);
    }, 60000);
  });
});

describe('队伍的 battle：队伍在和敌兵打', () => {
  /** 80 个刀盾从 (C-600, C) 往东攻击移动；一个血量无限、原地坚守的敌兵站在 (C, C) */
  const scene = (opts: { foe?: boolean } = {}) => {
    const w = flatWorld();
    const g = squad(w, C - 600, C);
    for (const s of g) w.hp[s] = w.maxHp[s] = 1e9;
    let foe = -1;
    if (opts.foe !== false) {
      foe = w.spawnUnit(idx('legion'), 2, C, C);
      w.hp[foe] = w.maxHp[foe] = 1e9;
      w.orderStop([foe], true);
    }
    w.orderMove(g, C + 700, C, true);
    const m = w.marches[w.grp[g[0]]];
    expect(m.amove).toBe(true);
    return { w, g, m, foe };
  };
  const tick = (w: World, n: number, each?: () => void): void => {
    for (let t = 0; t < n; t++) {
      w.tick();
      w.fxN = 0;
      each?.();
    }
  };

  it('没有敌兵：battleT 一直为 0', () => {
    const { w, m } = scene({ foe: false });
    let on = false;
    tick(w, 30 * 6, () => { if (m.battleT > 0 || m.cFoe > 0) on = true; });
    expect(on).toBe(false);
  });

  it('有成员以没溃逃的敌兵为目标：battleT 大于 0，cFoe 统计这样的成员数', () => {
    const { w, g, m } = scene();
    let on = false, foes = 0;
    tick(w, 30 * 20, () => {
      if (m.battleT > 0) {
        on = true;
        foes = Math.max(foes, m.cFoe);
      }
    });
    expect(on).toBe(true);
    expect(foes).toBeGreaterThan(0);
    expect(foes).toBeLessThanOrEqual(g.length);
  });

  it('敌兵没了之后再保持 linger 秒才复位：保持期内一直为真，过了才变假', () => {
    const { w, m, foe } = scene();
    let t = 0;
    while (t++ < 30 * 30 && !(m.battleT > 0)) tick(w, 1);
    expect(m.battleT > 0).toBe(true);
    tick(w, 8);
    w.removeUnit(foe);
    // 去掉敌兵后最多还差一次统计（8 帧）才发现没人打了：保持期按 linger 算，留出一次统计与一点余量
    const slack = 12;
    let early = false;
    tick(w, RULES.combat.linger * 30 - slack, () => { if (!(m.battleT > 0)) early = true; });
    expect(early).toBe(false);
    tick(w, slack * 2 + 8);
    expect(m.battleT > 0).toBe(false);
    expect(m.cFoe).toBe(0);
  });

  it('只以溃兵为目标不算：成员追着溃兵打时 battleT 保持为 0', () => {
    const { w, g, m, foe } = scene();
    startRout(w, foe);
    let on = false, chasing = false;
    tick(w, 30 * 12, () => {
      // 把溃兵钉在原地、士气压到最低，免得它跑掉或当场恢复
      w.x[foe] = C;
      w.y[foe] = C;
      w.morale[foe] = 0;
      if (m.battleT > 0 || m.cFoe > 0) on = true;
      if (g.some(s => w.target[s] === foe)) chasing = true;
    });
    expect(w.state[foe] & S_ROUT).toBe(S_ROUT);
    // 确有成员盯上了溃兵（场景有效），但队伍没算在打仗
    expect(chasing).toBe(true);
    expect(on).toBe(false);
  });

  it('只是在打建筑的不算：battleT 保持为 0', () => {
    const w = flatWorld();
    const g = squad(w, C - 600, C, 1, 0, 40);
    for (const s of g) w.hp[s] = w.maxHp[s] = 1e9;
    for (let k = 0; k < 8; k++) w.addBuilding(BUILDINGS.outpost, Math.floor((C - 400) / TILE) + k * 3, Math.floor(C / TILE) - 4, 2, -1);
    w.orderMove(g, C + 700, C, true);
    const m = w.marches[w.grp[g[0]]];
    let on = false, burning = false;
    tick(w, 30 * 15, () => {
      if (m.battleT > 0) on = true;
      if (g.some(s => w.target[s] < -1)) burning = true;
    });
    expect(burning).toBe(true);
    expect(on).toBe(false);
  });
});

describe('队伍里的个人：队伍在打仗时的走法', () => {
  const tick = (w: World, n: number, each?: () => void): void => {
    for (let t = 0; t < n; t++) {
      w.tick();
      w.fxN = 0;
      each?.();
    }
  };

  describe('队列位置落在自己身后', () => {
    /** 6 个刀盾往东行军（普通移动），其中一个被挪到队列前面 200 像素：它的队列位置就落在它身后 */
    const ahead = (battle: boolean) => {
      const w = flatWorld();
      const g = squad(w, C - 400, C, 1, 0, 6);
      const m = order(w, g, C + 600, C);
      const r = g[0];
      w.x[r] += 200;
      if (battle) m.battleT = 1000;
      // 先让统计跑一轮（battleT 设得足够大，统计时扣掉的那点不影响）
      tick(w, 9);
      const x0 = w.x[r], y0 = w.y[r];
      // 逐帧的速度（像素/秒）最大值
      let peak = 0, px = x0, py = y0;
      tick(w, 15, () => {
        peak = Math.max(peak, Math.hypot(w.x[r] - px, w.y[r] - py) * 30);
        px = w.x[r];
        py = w.y[r];
      });
      return { w, m, r, peak, moved: Math.hypot(w.x[r] - x0, w.y[r] - y0), dx: w.x[r] - x0 };
    };

    it('队伍没在打：原地等位置走过来，不往回跑也不往前走', () => {
      const { m, moved } = ahead(false);
      expect(m.battleT > 0).toBe(false);
      expect(moved).toBeLessThan(4);
    });

    it('队伍在打：不原地等，沿路线往前走', () => {
      const { m, moved, dx } = ahead(true);
      expect(m.battleT > 0).toBe(true);
      expect(dx).toBeGreaterThan(8);
      expect(moved).toBeGreaterThan(8);
    });

    it('队伍在打：往前走不提速追赶，速度不超过不在战斗状态时的行军速度', () => {
      const { w, r, peak } = ahead(true);
      const d = w.defs[w.type[r]];
      const march = Math.min(w.grpSpeed[r] > 0 ? w.grpSpeed[r] : d.walk, d.walk);
      expect(march).toBeLessThan(d.speed);
      expect(peak).toBeGreaterThan(8);
      expect(peak).toBeLessThanOrEqual(march * 1.02);
    });
  });

  describe('队伍在打时沿路线往前走的成员：不被提前判到达、脱离队伍', () => {
    const DEST = C - 100;
    /** 6 个刀盾从远处往东行军，终点 (DEST, C)；其中一个被挪到队列前面 600 像素，队列位置在它身后，battleT 手动置大 */
    const scene = () => {
      const w = flatWorld();
      const g = squad(w, C - 1000, C, 1, 0, 6);
      for (const s of g) w.hp[s] = w.maxHp[s] = 1e9;
      const m = order(w, g, DEST, C);
      const r = g[0];
      // 他自己的落点（队列里的位置决定，与下令的终点差一点）
      const destX = w.destX[r], destY = w.destY[r];
      const gi = w.grp[r];
      w.x[r] += 600;
      m.battleT = 1000;
      return { w, g, m, r, gi, destX, destY };
    };
    /**
     * 队伍还在很远的地方（队列位置在他身后很远），他自己站在障碍西侧，终点在障碍另一侧不远处。
     * wall：一堵 5 格长的矿山墙（60 列），终点在墙东；pocket：终点被一圈矿山完全围住，哪儿都进不去。
     * fight 为假时队伍没在打。他的流场置空，和刚被挪到这里的人一样
     */
    const beyond = (kind: 'wall' | 'pocket', fight: boolean) => {
      const w = flatWorld(120, 7, (t, n) => {
        if (kind === 'wall') wall(t, n, 60, 60, 58, 62);
        else for (const [x0, x1, y0, y1] of [[59, 65, 57, 57], [59, 65, 63, 63], [59, 59, 57, 63], [65, 65, 57, 63]]) wall(t, n, x0, x1, y0, y1);
      });
      const g = squad(w, 420, C, 1, 0, 6);
      for (const s of g) w.hp[s] = w.maxHp[s] = 1e9;
      const m = order(w, g, kind === 'wall' ? 62.5 * TILE : 62 * TILE, 60.5 * TILE);
      const r = g[0];
      const gi = w.grp[r];
      const destX = w.destX[r], destY = w.destY[r];
      w.x[r] = (kind === 'wall' ? 59.3 : 58.3) * TILE;
      w.y[r] = 60.5 * TILE;
      w.field[r] = null;
      m.battleT = fight ? 1000 : 0;
      return { w, m, r, gi, destX, destY };
    };
    const still = (w: World, r: number, gi: number): boolean => w.order[r] === O_MOVE && w.grp[r] === gi;

    it('走到离落点很近之后也不判到达：命令仍是移动、仍属这支队伍（队伍没到、也没散）', () => {
      const { w, m, r, gi, destX, destY } = scene();
      // 先走到落点
      let near = false, broke = false;
      tick(w, 30 * 14, () => {
        if (Math.hypot(w.x[r] - destX, w.y[r] - destY) < 12) near = true;
        if (!still(w, r, gi)) broke = true;
      });
      expect(near).toBe(true);
      // 在落点上再停留比「迟迟不靠近就地算到达」的等待还久，队伍依旧没到
      tick(w, (M.giveUpAfter + 3) * 30, () => {
        if (!still(w, r, gi)) broke = true;
      });
      expect(m.arrived).toBe(false);
      expect(m.alive).toBe(true);
      expect(broke).toBe(false);
    });

    it('被障碍顶住不会一直顶着：绕过墙到落点附近，全程命令仍是移动、仍属这支队伍；到了之后继续停留也不判到达', () => {
      const { w, m, r, gi, destX, destY } = beyond('wall', true);
      let broke = false, near = false, minY = Infinity;
      tick(w, 30 * 18, () => {
        if (!still(w, r, gi)) broke = true;
        minY = Math.min(minY, w.y[r]);
        if (Math.hypot(w.x[r] - destX, w.y[r] - destY) < 12) near = true;
      });
      // 绕过了墙：走到过墙的北端之外，最后停在墙东的落点上
      expect(minY).toBeLessThan(58 * TILE);
      expect(near).toBe(true);
      expect(w.x[r]).toBeGreaterThan(61 * TILE);
      // 在落点上再停留比「迟迟不靠近就地算到达」的等待还久
      tick(w, (M.giveUpAfter + 3) * 30, () => {
        if (!still(w, r, gi)) broke = true;
      });
      expect(Math.hypot(w.x[r] - destX, w.y[r] - destY)).toBeLessThan(12);
      expect(m.arrived).toBe(false);
      expect(broke).toBe(false);
    });

    it('对照：队伍没在打时，同一处墙边他原地等位置，不去绕墙', () => {
      const { w, r, gi } = beyond('wall', false);
      const x0 = w.x[r], y0 = w.y[r];
      let broke = false;
      tick(w, 30 * 10, () => {
        if (!still(w, r, gi)) broke = true;
      });
      expect(Math.hypot(w.x[r] - x0, w.y[r] - y0)).toBeLessThan(4);
      expect(broke).toBe(false);
    });

    it('落点被障碍完全围住、哪儿都去不了：队伍在打期间他留在围外，不判到达、仍属这支队伍', () => {
      const { w, m, r, gi } = beyond('pocket', true);
      let broke = false, inside = false;
      tick(w, 30 * 14, () => {
        if (!still(w, r, gi)) broke = true;
        if (w.x[r] > 59 * TILE) inside = true;
      });
      expect(inside).toBe(false);
      expect(m.arrived).toBe(false);
      expect(broke).toBe(false);
    });

    it('队伍到达之后：他照常到达，转为待命', () => {
      const { w, m, r } = scene();
      // battleT 一直不减（置得很大），队伍走到终点后他也不再算队伍的人
      tick(w, 30 * 40);
      expect(m.arrived).toBe(true);
      expect(w.order[r]).toBe(O_IDLE);
      expect(w.grp[r]).toBe(-1);
    });
  });
});

describe('弹性队列：宽队过窄处提前收窄、折排穿过、出去再展开', () => {
  const dao200 = (): number[] => Array(200).fill(idx('dao'));
  /** 混编的一大队（200 人）：兵种的前后次序各不相同，带几辆器械 */
  const army = (): number[] => [...Array(60).fill(idx('ji')), ...Array(50).fill(idx('dao')), ...Array(60).fill(idx('nu')),
    ...Array(30).fill(idx('tieqi')), ...Array(4).fill(idx('pili'))];
  const rect = wall;
  /** 东西向的山谷：x 50..80 格，谷宽 wd 格（居中在第 60 行线上），两侧各 25 格厚的山 */
  const valley = (wd: number) => (t: Uint8Array, n: number): void => {
    for (let x = 50; x <= 80; x++) for (let y = 35; y < 85; y++) if (y < 60 - wd / 2 || y >= 60 + wd / 2) t[y * n + x] = T_MOUNTAIN;
  };
  const LANE = 4 * TILE;

  /** 在 paint 摆好的平地上，units 从 from 走到 to（格坐标，路线沿第 cy 行线） */
  function lane(paint: ((t: Uint8Array, n: number) => void) | undefined, units: number[], from: number, to: number, cy = 60) {
    const w = flatWorld(140, 7, paint);
    const g = w.spawnGroup(1, units, from * TILE, cy * TILE, 1, 0);
    const m = order(w, g, to * TILE, cy * TILE);
    return { w, g, m };
  }
  const tick = (w: World, n: number, each?: () => void): void => {
    for (let t = 0; t < n; t++) {
      w.tick();
      w.fxN = 0;
      each?.();
    }
  };
  /** 最前排（同一排的人）的位置沿 y 方向（东西向路线上的横向）铺开多宽，和中点的 y */
  function rowSpan(w: World, g: number[], m: March, row = 0): { ext: number; mid: number } {
    let lo = Infinity, hi = -Infinity;
    for (const s of g) {
      if (w.marchRow[s] !== row) continue;
      marchSlot(m, row, w.marchCol[s], w.offL[s]);
      lo = Math.min(lo, SLOT.y);
      hi = Math.max(hi, SLOT.y);
    }
    return { ext: hi - lo, mid: (lo + hi) / 2 };
  }
  /** 此刻最大的折排倍数（一排占的路程 ÷ 不折时的排深） */
  const foldNow = (m: March): number => {
    let f = 1;
    for (let r = 0; r < m.rows; r++) f = Math.max(f, m.rowLen[r] / m.rowD[r]);
    return f;
  };
  /** 走到全员到达（或 maxSecs 秒）为止，每帧记最前排的位置、宽度、速度、折排倍数 */
  interface Frame { x: number; ext: number; v: number; fold: number }
  function profile(w: World, g: number[], m: March, maxSecs = 100): { frames: Frame[]; inBlock: number; arrived: boolean; done: boolean } {
    const frames: Frame[] = [];
    const blk = w.nav.block[1];
    let inBlock = 0;
    for (let t = 0; t < maxSecs * 30 && !m.arrived; t++) {
      tick(w, 1);
      if (m.arrived) break;
      frames.push({ x: m.x, ext: rowSpan(w, g, m).ext, v: m.v, fold: foldNow(m) });
      for (const s of g) if (blk[w.cellAt(w.x[s], w.y[s])]) inBlock++;
    }
    for (let t = 0; t < 30 * 60 && g.some(s => w.alive[s] && w.order[s] !== O_IDLE); t++) tick(w, 1);
    return { frames, inBlock, arrived: m.arrived, done: g.every(s => !w.alive[s] || w.order[s] === O_IDLE) };
  }

  const cache = new Map<string, ReturnType<typeof profile>>();
  const cached = (key: string, build: () => ReturnType<typeof lane>, secs = 100): ReturnType<typeof profile> => {
    let r = cache.get(key);
    if (!r) {
      const s = build();
      r = profile(s.w, s.g, s.m, secs);
      cache.set(key, r);
    }
    return r;
  };
  const valley4 = (): ReturnType<typeof profile> => cached('valley4', () => lane(valley(4), dao200(), 25, 115));

  describe('认窄处：两侧都被障碍夹住、且障碍挡满一翼才算', () => {
    it('山谷（谷宽 4 格，队宽 342）：离谷口还有一段路最前排就开始收窄，进谷时不宽于谷口，出谷后展开回原宽', () => {
      const { frames, arrived, done } = valley4();
      expect(arrived).toBe(true);
      expect(done).toBe(true);
      // 一开始的宽度是队宽：比谷宽得多
      const full = frames[30].ext;
      expect(full).toBeGreaterThan(LANE * 2);
      // 最前排走到离谷口（x = 50 格）还差 2 格时已经往里收了
      const early = frames.find(f => f.x >= 48 * TILE)!;
      expect(early.ext).toBeLessThan(full * 0.8);
      // 进了谷口之后位置都在谷宽以内
      const inside = frames.filter(f => f.x >= 51 * TILE && f.x <= 79 * TILE);
      expect(inside.length).toBeGreaterThan(30);
      for (const f of inside) expect(f.ext).toBeLessThanOrEqual(LANE);
      // 出了谷之后展开回去
      const out = frames.filter(f => f.x >= 92 * TILE);
      expect(out.length).toBeGreaterThan(30);
      for (const f of out) expect(f.ext).toBeGreaterThan(full * 0.97);
    }, 60000);

    it('收放是连续的：最前排的宽度每帧只变一点（没有离散变阵），最前排也不为收放停下', () => {
      const { frames } = valley4();
      let jump = 0;
      for (let k = 1; k < frames.length; k++) jump = Math.max(jump, Math.abs(frames[k].ext - frames[k - 1].ext));
      // 每帧最多几个像素：坡度（narrowIn、narrowOut）乘以最前排每帧走的路，两侧相加
      expect(jump).toBeLessThan(6);
      // 一开始整队之后最前排一直在走，没有一帧停下
      for (const f of frames.slice(30)) expect(f.v).toBeGreaterThan(0.25 * UNIT_BY_KEY.dao.walk);
    }, 60000);

    for (const [label, paint] of [
      ['只有右手边有一道长墙', (t: Uint8Array, n: number) => rect(t, n, 50, 100, 62, 63)],
      ['只有左手边有一道长墙', (t: Uint8Array, n: number) => rect(t, n, 50, 100, 56, 57)],
      ['两侧各有一块障碍、但都挡不满一翼（各 3 格厚，营寨、房子那样的小块头）', (t: Uint8Array, n: number) => {
        rect(t, n, 60, 65, 55, 57);
        rect(t, n, 60, 65, 62, 64);
      }],
    ] as const) {
      it(`${label}：不算窄处，队列照原样走，不折排、宽度不变`, () => {
        const { w, g, m } = lane(paint, dao200(), 25, 115);
        const full = rowSpan(w, g, m).ext;
        let maxFold = 1, ext = full;
        const r = profile(w, g, m);
        for (const f of r.frames) {
          maxFold = Math.max(maxFold, f.fold);
          ext = Math.max(ext, Math.abs(f.ext - full) + full);
        }
        expect(maxFold).toBe(1);
        expect(ext - full).toBeLessThan(1);
        expect(r.arrived).toBe(true);
        expect(r.inBlock).toBe(0);
        expect(r.done).toBe(true);
      }, 60000);
    }

    it('两侧各有一块障碍、且挡满一翼（各 6 格厚）：算窄处，折排穿过，出去再展开', () => {
      const { w, g, m } = lane((t, n) => {
        rect(t, n, 60, 65, 52, 57);
        rect(t, n, 60, 65, 62, 67);
      }, dao200(), 25, 115);
      const full = rowSpan(w, g, m).ext;
      const r = profile(w, g, m);
      expect(Math.max(...r.frames.map(f => f.fold))).toBeGreaterThan(2);
      expect(Math.min(...r.frames.map(f => f.ext))).toBeLessThanOrEqual(LANE);
      expect(r.frames[r.frames.length - 1].ext).toBeGreaterThan(full * 0.97);
      expect(r.arrived).toBe(true);
      expect(r.inBlock).toBe(0);
    }, 60000);
  });

  describe('窄处的横排与窄处方向一致、在通道里居中，不跟队列的朝向斜', () => {
    // 南北向的一道薄墙（x 60、61 格）在 y 58..61 格留一个门；队伍从东西两侧斜着朝门走去，再斜着走出去
    const gate = (t: Uint8Array, n: number): void => {
      rect(t, n, 60, 61, 0, 57);
      rect(t, n, 60, 61, 62, 139);
    };
    for (const [label, sx, sy, ex, ey] of [['西北来、往东南去', 35, 40, 100, 85], ['西南来、往东北去', 35, 80, 100, 38], ['正东', 30, 60, 100, 60]] as const) {
      it(`${label}：最前排的位置正在门里时，横向顺着门的方向（南北），整排在门里居中，行进方向与墙垂直`, () => {
        const w = flatWorld(140, 7, gate);
        const g = w.spawnGroup(1, dao200(), sx * TILE, sy * TILE, ex - sx, ey - sy);
        w.orderMove(g, ex * TILE, ey * TILE, false);
        const m = w.marches[w.grp[g[0]]];
        const row0 = g.filter(s => w.marchRow[s] === 0);
        let inGate = 0, tilted = false, maxOff = 0, maxOut = 0, minProbeHy = Infinity;
        for (let t = 0; t < 30 * 100 && !m.arrived; t++) {
          tick(w, 1);
          let mx = 0, lo = Infinity, hi = -Infinity, hy = 0;
          for (const s of row0) {
            marchSlot(m, 0, w.marchCol[s], w.offL[s]);
            mx += SLOT.x;
            lo = Math.min(lo, SLOT.y);
            hi = Math.max(hi, SLOT.y);
            hy = Math.max(hy, Math.abs(SLOT.hy));
          }
          mx /= row0.length;
          if (mx < 60.5 * TILE || mx > 61.5 * TILE) continue;
          inGate++;
          // 行进方向（SLOT.hx/hy）是横向的垂线：横向沿南北，行进方向就沿东西，hy 为 0
          if (hy > 0.1) tilted = true;
          maxOff = Math.max(maxOff, Math.abs((lo + hi) / 2 - 60 * TILE));
          maxOut = Math.max(maxOut, 58 * TILE - lo, hi - 62 * TILE);
          minProbeHy = Math.min(minProbeHy, Math.abs(m.phy));
        }
        expect(inGate).toBeGreaterThan(10);
        expect(tilted).toBe(false);
        expect(maxOff).toBeLessThan(8);
        expect(maxOut).toBeLessThan(2);
        // 对照：斜着来的队伍，探路点（队列朝向）在这个时刻确实是斜的
        if (sy !== ey) expect(minProbeHy).toBeGreaterThan(0.5);
      }, 60000);
    }
  });

  describe('折排', () => {
    it('谷宽 2 格（比队宽窄得多）：一排最多拉长到 stretchMax 倍，再窄就挤着过，全员过得去、没人落进山里', () => {
      const r = cached('valley2', () => lane(valley(2), dao200(), 25, 115), 150);
      const peak = Math.max(...r.frames.map(f => f.fold));
      expect(peak).toBeLessThanOrEqual(M.stretchMax + 1e-6);
      expect(peak).toBeGreaterThan(M.stretchMax * 0.99);
      expect(r.arrived).toBe(true);
      expect(r.inBlock).toBe(0);
      expect(r.done).toBe(true);
    }, 90000);

    it('谷宽 4 格：折排倍数在 1 到 stretchMax 之间，比谷窄的排拉长、足够宽的开阔处不拉长', () => {
      const { frames } = valley4();
      const peak = Math.max(...frames.map(f => f.fold));
      expect(peak).toBeGreaterThan(2);
      expect(peak).toBeLessThanOrEqual(M.stretchMax);
      for (const f of frames.filter(f => f.x < 40 * TILE || f.x > 95 * TILE)) expect(f.fold).toBe(1);
    }, 60000);

    describe('混编的一队过谷：兵种的前后次序不变，位置都落在可通行处', () => {
      let orderBad = 0, slotBad = 0, rowsFolded = 0, checked = 0, unitsInBlock = 0;
      let speedBad = 0;
      it('逐帧检查', () => {
        const { w, g, m } = lane(valley(4), army(), 25, 115);
        const blk = w.nav.block[1];
        // 各兵种档（UnitDef.row）里位置离探路点最近 / 最远的路程
        for (let t = 0; t < 30 * 75 && !m.arrived; t++) {
          tick(w, 1);
          if (t < 30) continue;
          const lo = new Map<number, number>(), hi = new Map<number, number>();
          for (const s of g) {
            if (w.grp[s] !== m.id) continue;
            marchSlot(m, w.marchRow[s], w.marchCol[s], w.offL[s]);
            const dr = w.defs[w.type[s]].row;
            lo.set(dr, Math.min(lo.get(dr) ?? Infinity, SLOT.b));
            hi.set(dr, Math.max(hi.get(dr) ?? -Infinity, SLOT.b));
            // 位置落在走不通的格子里（谷口拐角上不到一个兵半径的误差不算：四周 6 像素处只要有一处走得通就不算）
            const blocked = (x: number, y: number): boolean => blk[w.cellAt(x, y)] !== 0;
            if (blocked(SLOT.x, SLOT.y) && [[6, 0], [-6, 0], [0, 6], [0, -6]].every(([dx, dy]) => blocked(SLOT.x + dx, SLOT.y + dy))) slotBad++;
            // 被折起来的排：本排的速度不超过本排的小跑速度
            const r = w.marchRow[s];
            if (m.rowLen[r] / m.rowD[r] > 1.05 && SLOT.v > Math.max(m.rowRun[r] * M.trot, m.speed) * 1.01) speedBad++;
            if (blk[w.cellAt(w.x[s], w.y[s])]) unitsInBlock++;
          }
          const keys = [...lo.keys()].sort((a, b) => a - b);
          for (let k = 0; k + 1 < keys.length; k++) if (hi.get(keys[k])! > lo.get(keys[k + 1])! + 1) orderBad++;
          if (foldNow(m) > 1.5) rowsFolded++;
          checked++;
        }
        expect(checked).toBeGreaterThan(1000);
        // 确有被折起来的时候，不是空转
        expect(rowsFolded).toBeGreaterThan(200);
        expect(orderBad).toBe(0);
        expect(slotBad).toBe(0);
        expect(speedBad).toBe(0);
        expect(unitsInBlock).toBe(0);
      }, 120000);
    });
  });

  describe('速度', () => {
    it('开阔地（还没到窄处、出了窄处之后）：全队按行军速度走，规则不变', () => {
      const { frames } = valley4();
      const walk = UNIT_BY_KEY.dao.walk;
      const open = frames.slice(30).filter(f => f.x < 44 * TILE || f.x > 95 * TILE);
      expect(open.length).toBeGreaterThan(100);
      for (const f of open) expect(Math.abs(f.v - walk)).toBeLessThan(0.05);
    }, 60000);

    it('有排被折起来时全队小跑通过：折得最厉害的那些帧里最前排的速度 = 奔跑速度 × trot，任何时候都不超过它', () => {
      const { frames } = valley4();
      const trot = UNIT_BY_KEY.dao.speed * M.trot;
      // 折得最厉害、最前排还在谷里的那些帧（出谷时最前排要等后面的排展开，速度另算）
      const folded = frames.filter(f => f.fold > 2.5 && f.x > 52 * TILE && f.x < 79 * TILE);
      expect(folded.length).toBeGreaterThan(100);
      for (const f of folded) expect(f.v / trot).toBeGreaterThan(0.95);
      for (const f of frames) expect(f.v).toBeLessThanOrEqual(trot * 1.001);
    }, 60000);

    it('成员真的小跑：折排期间最前排的人走得比行军速度快，不超过自己的奔跑速度', () => {
      const { w, g, m } = lane(valley(4), dao200(), 25, 115);
      const u = g.find(s => w.marchRow[s] === 0 && Math.abs(w.offL[s]) < 20)!;
      const d = w.defs[w.type[u]];
      let px = w.x[u], py = w.y[u], sum = 0, n = 0, peak = 0;
      for (let t = 0; t < 30 * 60 && !m.arrived; t++) {
        tick(w, 1);
        const sp = Math.hypot(w.x[u] - px, w.y[u] - py) * 30;
        px = w.x[u];
        py = w.y[u];
        if (foldNow(m) > 2.5 && m.v > d.walk * 1.2) {
          sum += sp;
          n++;
          peak = Math.max(peak, sp);
        }
      }
      expect(n).toBeGreaterThan(60);
      expect(sum / n).toBeGreaterThan(d.walk * 1.2);
      expect(peak).toBeLessThanOrEqual(d.speed * 1.02);
    }, 60000);
  });

  describe('开阔地上与刚性横队一致', () => {
    it('没有窄处：队列位置就是最前排 + 沿朝向的偏移 + 横向偏移，不折排，按行军速度走，到达时不收尾', () => {
      const { w, g, m } = lane(undefined, Array(80).fill(idx('dao')), 20, 100, 70);
      let rigid = 0, maxErr = 0, folds = 1, slow = 0, tail = false;
      for (let t = 0; t < 30 * 100 && !m.arrived; t++) {
        tick(w, 1);
        if (m.tail) tail = true;
        // 最后一帧到达时最前排速度记为 0，不算
        if (m.arrived) break;
        folds = Math.max(folds, foldNow(m));
        if (t > 30 && Math.abs(m.v - UNIT_BY_KEY.dao.walk) > 1e-6) slow++;
        if (t % 10 || m.arrived) continue;
        for (const s of g) {
          marchSlot(m, w.marchRow[s], w.marchCol[s], w.offL[s]);
          const ex = m.x + m.hx * w.offA[s] - m.hy * w.offL[s], ey = m.y + m.hy * w.offA[s] + m.hx * w.offL[s];
          maxErr = Math.max(maxErr, Math.hypot(SLOT.x - ex, SLOT.y - ey));
        }
        rigid++;
      }
      expect(rigid).toBeGreaterThan(50);
      expect(maxErr).toBeLessThan(0.1);
      expect(folds).toBe(1);
      expect(slow).toBe(0);
      expect(m.arrived).toBe(true);
      expect(tail).toBe(false);
      // 到达：这一帧起成员不再属于队列，各自走完剩下的路
      tick(w, 2);
      expect(g.every(s => w.grp[s] === -1)).toBe(true);
      for (let t = 0; t < 30 * 20 && g.some(s => w.order[s] !== O_IDLE); t++) tick(w, 1);
      expect(g.every(s => w.order[s] === O_IDLE)).toBe(true);
    }, 60000);
  });

  describe('到达后的收尾：路线上有窄处时，最前排到终点后接着把队尾带过窄处', () => {
    /** 山谷（x 50..80 格），终点在谷口外 5 格（85 格）：最前排到终点时后面还有排在谷里。返回收尾刚开始那一帧的场景 */
    function atTail() {
      const s = lane(valley(4), dao200(), 25, 85);
      for (let t = 0; t < 30 * 100 && !s.m.tail; t++) tick(s.w, 1);
      expect(s.m.tail).toBe(true);
      return s;
    }
    /** 谷南边（山外）一点：与谷里隔着山，直线看不见谷里的任何一点，看得见与否由调用方判 */
    const OUT = [65 * TILE, 112 * TILE];

    it('到终点时队伍不立刻解散：命令仍是移动，队伍已到达但仍在收尾，还有成员属于它，带完之后全员到达、转为待命，不超过 tailMax', () => {
      const { w, g, m } = atTail();
      expect(m.arrived).toBe(true);
      const inGrp = g.filter(s => w.grp[s] === m.id);
      expect(inGrp.length).toBeGreaterThan(0);
      for (const s of inGrp) expect(w.order[s]).toBe(O_MOVE);
      // 最前排已到终点附近，这时仍在队伍里的是还在谷里（或没进谷）的人
      let maxT = 0;
      for (let t = 0; t < 30 * 40 && g.some(s => w.order[s] !== O_IDLE); t++) {
        tick(w, 1);
        maxT = Math.max(maxT, m.tailT);
      }
      expect(g.every(s => w.order[s] === O_IDLE)).toBe(true);
      expect(g.every(s => w.grp[s] === -1)).toBe(true);
      expect(maxT).toBeLessThan(M.tailMax);
    }, 60000);

    it('离队：前方再没有窄处、又看得见落点的人（已出谷的那些排）去了落点；还在谷里或谷前的人继续跟队列', () => {
      const { w, g, m } = atTail();
      tick(w, 15);
      expect(m.tail).toBe(true);
      const inGrp = g.filter(s => w.grp[s] === m.id);
      const left = g.filter(s => w.grp[s] !== m.id);
      expect(inGrp.length).toBeGreaterThan(0);
      expect(left.length).toBeGreaterThan(0);
      // 还留在队伍里的，没有一个已经出了谷（谷口 x = 81 格）；出了谷、看得见落点的都已经离队
      for (const s of inGrp) expect(w.x[s]).toBeLessThan(82 * TILE);
      for (const s of g) if (w.x[s] > 83 * TILE) expect(w.grp[s]).toBe(-1);
      // 离队的人是去落点：命令仍是移动
      for (const s of left) expect(w.order[s]).toBe(O_MOVE);
    }, 60000);

    describe('marchRelease：成员该不该离队', () => {
      /** 收尾刚开始时挑几个成员：本排已走过终点的、前方再没窄处的、窄处还在前方的 */
      function pick() {
        const s = atTail();
        const { w, g, m } = s;
        // 再走几帧：最前排的位置已走过终点
        tick(w, 5);
        const byB = g.map(u => {
          marchSlot(m, w.marchRow[u], w.marchCol[u], w.offL[u]);
          return { u, b: SLOT.b };
        });
        const passed = byB.find(e => e.b <= m.endB)!;
        const clear = byB.find(e => e.b > m.endB + 1 && e.b < m.narrowB - 1)!;
        const behind = byB.find(e => e.b > m.narrowB + 1)!;
        expect(passed && clear && behind).toBeTruthy();
        const rel = (e: { u: number }, ux: number, uy: number): boolean => {
          marchSlot(m, w.marchRow[e.u], w.marchCol[e.u], w.offL[e.u]);
          return marchRelease(w, m, ux, uy, m.destX, m.destY);
        };
        return { ...s, passed, clear, behind, rel };
      }
      const IN_VALLEY = [70 * TILE, 60 * TILE];

      it('本排已走过终点：不管看不看得见落点都离队', () => {
        const { passed, rel } = pick();
        expect(rel(passed, IN_VALLEY[0], IN_VALLEY[1])).toBe(true);
        expect(rel(passed, OUT[0], OUT[1])).toBe(true);
      }, 60000);

      it('前方再没有窄处：看得见落点才离队，隔着山看不见就不离', () => {
        const { clear, rel } = pick();
        expect(rel(clear, IN_VALLEY[0], IN_VALLEY[1])).toBe(true);
        expect(rel(clear, OUT[0], OUT[1])).toBe(false);
      }, 60000);

      it('窄处还在前方（本排在窄处后面）：就算看得见落点也不离队', () => {
        const { behind, rel } = pick();
        expect(rel(behind, IN_VALLEY[0], IN_VALLEY[1])).toBe(false);
      }, 60000);
    });

    it('够不着队列（够不着位置也看不见本排）的人：收尾时离队去落点，不再归队；不在收尾时则仍归队', () => {
      // 对照：行军途中同样被挪到山外，仍属于队伍、各自找路
      const pre = lane(valley(4), dao200(), 25, 85);
      tick(pre.w, 30 * 3);
      const p = pre.g.find(s => pre.w.offA[s] > -1 && Math.abs(pre.w.offL[s]) < 30)!;
      pre.w.x[p] = OUT[0];
      pre.w.y[p] = OUT[1];
      tick(pre.w, 30);
      expect(pre.m.tail).toBe(false);
      expect(pre.w.grp[p]).toBe(pre.m.id);

      const { w, g, m } = atTail();
      // 挑队尾的人（窄处还在它前方，不会因为已走过终点而离队）
      let rear = -1, rb = -1;
      for (const s of g) {
        if (w.grp[s] !== m.id) continue;
        marchSlot(m, w.marchRow[s], w.marchCol[s], w.offL[s]);
        if (SLOT.b > rb) {
          rb = SLOT.b;
          rear = s;
        }
      }
      expect(rear).toBeGreaterThanOrEqual(0);
      expect(rb).toBeGreaterThan(m.narrowB);
      w.x[rear] = OUT[0];
      w.y[rear] = OUT[1];
      tick(w, 3);
      expect(w.grp[rear]).toBe(-1);
      // 去落点：命令仍是移动，不是就地待命
      expect(w.order[rear]).toBe(O_MOVE);
    }, 60000);

    it('收尾最长 tailMax 秒：到了就解散，还在队伍里的人各自去落点，最终全员到达', () => {
      const { w, g, m } = atTail();
      expect(g.some(s => w.grp[s] === m.id)).toBe(true);
      m.tailT = M.tailMax - 0.02;
      tick(w, 3);
      expect(m.tail).toBe(false);
      tick(w, 3);
      expect(g.every(s => w.grp[s] !== m.id)).toBe(true);
      for (let t = 0; t < 30 * 40 && g.some(s => w.order[s] !== O_IDLE); t++) tick(w, 1);
      expect(g.every(s => w.order[s] === O_IDLE)).toBe(true);
    }, 60000);
  });

  describe('行军途中改道：同一批人又收到移动命令，不重新整队，最前排直接拐过去，后排沿走过的路跟着拐', () => {
    /** 80 个刀盾从 (30, 70) 格朝东走了 8 秒（开阔地，路线朝 (120, 70) 格） */
    function underway() {
      const w = flatWorld(140, 7);
      const g = squad(w, 30 * TILE, 70 * TILE, 1, 0, 80);
      const m = order(w, g, 120 * TILE, 70 * TILE);
      tick(w, 30 * 8);
      expect(m.arrived).toBe(false);
      return { w, g, m };
    }
    const layout = (w: World, g: number[]): number[][] => g.map(s => [w.grp[s], w.marchRow[s], w.marchCol[s], w.offA[s], w.offL[s]]);
    const centroid = (w: World, g: number[]): [number, number] => [g.reduce((a, s) => a + w.x[s], 0) / g.length, g.reduce((a, s) => a + w.y[s], 0) / g.length];

    it('沿用现有队列：还是原来那个编队，每个人的排、排内序号、前后左右偏移都不变，最前排的位置不跳、速度不归零', () => {
      const { w, g, m } = underway();
      const before = layout(w, g), id = m.id, fx0 = m.x, fy0 = m.y;
      w.orderMove(g, 90 * TILE, 100 * TILE, true);
      expect(w.grp[g[0]]).toBe(id);
      expect(m.alive).toBe(true);
      expect(layout(w, g)).toEqual(before);
      // 最前排没有被重新摆到别处，也没有停下等位置
      expect(Math.hypot(m.x - fx0, m.y - fy0)).toBeLessThan(4);
      expect(m.v).toBeGreaterThan(UNIT_BY_KEY.dao.walk * 0.9);
    }, 60000);

    it('攻击移动标志、目的地、到位朝向换成新的；成员的命令随之换成攻击移动，落点按新目的地与新朝向、用原来的队列偏移重算', () => {
      const { w, g, m } = underway();
      const [mx, my] = centroid(w, g);
      const tx = 90 * TILE, ty = 100 * TILE;
      const fl = Math.hypot(tx - mx, ty - my), fx = (tx - mx) / fl, fy = (ty - my) / fl;
      w.orderMove(g, tx, ty, true);
      expect(m.amove).toBe(true);
      expect(m.destX).toBeCloseTo(tx, 3);
      expect(m.destY).toBeCloseTo(ty, 3);
      expect(m.fx).toBeCloseTo(fx, 4);
      expect(m.fy).toBeCloseTo(fy, 4);
      expect(g.every(s => w.order[s] === O_AMOVE)).toBe(true);
      expect(g.every(s => Math.abs(w.faceA[s] - Math.atan2(fy, fx)) < 1e-4)).toBe(true);
      // 落点 = 新目的地 + 朝向 × (队列偏移 + 最前排相对队列中心的偏移) + 横向（朝向的右手边）× 横向偏移；这个最前排偏移与重新整队时一样
      const fresh = formation(w, g.map(s => w.type[s]), tx, ty, fx, fy, null);
      const front = Math.max(...fresh.fa);
      for (const s of g) {
        const dx = w.destX[s] - tx, dy = w.destY[s] - ty;
        expect(dx * fx + dy * fy - w.offA[s]).toBeCloseTo(front, 1);
        expect(-dx * fy + dy * fx).toBeCloseTo(w.offL[s], 1);
        expect(w.destCell[s]).toBe(w.cellAt(tx, ty));
      }
    }, 60000);

    it('最前排转向新目的地，后排沿走过的路跟着拐：一秒后后面的排还在原路线上，最前排已拐出去', () => {
      const { w, g, m } = underway();
      const routeY = 70 * TILE;
      w.orderMove(g, 90 * TILE, 100 * TILE, false);
      tick(w, 30);
      const rowN = new Set(g.map(s => w.marchRow[s])).size;
      const mid = Math.floor(rowN / 2);
      let ys = 0, n = 0;
      for (const s of g) {
        if (w.marchRow[s] !== mid) continue;
        marchSlot(m, mid, w.marchCol[s], w.offL[s]);
        ys += SLOT.y;
        n++;
      }
      expect(n).toBeGreaterThan(0);
      // 中间一排的位置中心还在原来的东西向路线上
      expect(Math.abs(ys / n - routeY)).toBeLessThan(4);
      // 最前排已朝新目的地（东南）拐出去：朝向转向南，位置也偏出了原路线
      expect(m.hy).toBeGreaterThan(0.2);
      expect(m.y - routeY).toBeGreaterThan(8);
    }, 60000);

    it('改道之后全队接着走到新目的地：最前排不停，没有人因为改道原地停下等位置，全员到达', () => {
      const { w, g, m } = underway();
      w.orderMove(g, 90 * TILE, 100 * TILE, false);
      const px = g.map(s => w.x[s]), py = g.map(s => w.y[s]), still = g.map(() => 0);
      let stalled = 0, minV = Infinity;
      for (let t = 0; t < 30 * 80 && !m.arrived; t++) {
        tick(w, 1);
        if (m.arrived) break;
        minV = Math.min(minV, m.v);
        g.forEach((s, k) => {
          const mv = Math.hypot(w.x[s] - px[k], w.y[s] - py[k]);
          px[k] = w.x[s];
          py[k] = w.y[s];
          if (w.order[s] !== O_IDLE && mv < UNIT_BY_KEY.dao.walk / 30 * 0.15) {
            if (++still[k] === 60) stalled++;
          } else still[k] = 0;
        });
      }
      expect(m.arrived).toBe(true);
      // 最前排一路按行军速度走（开阔地、没有窄处）
      expect(minV).toBeGreaterThan(UNIT_BY_KEY.dao.walk * 0.95);
      expect(stalled).toBe(0);
      for (let t = 0; t < 30 * 30 && g.some(s => w.order[s] !== O_IDLE); t++) tick(w, 1);
      expect(g.every(s => w.order[s] === O_IDLE)).toBe(true);
      for (const s of g) expect(Math.hypot(w.x[s] - 90 * TILE, w.y[s] - 100 * TILE)).toBeLessThan(m.depth + m.width);
    }, 60000);

    describe('改道时前方原路线上的窄处不再影响队列，身后还没过完的窄处照旧起作用', () => {
      it('最前排正为前方的山谷提前收窄时改道：为它收的放开，队列恢复原宽，之后不再折排', () => {
        const w = flatWorld(140, 7, valley(4));
        const g = squad(w, 25 * TILE, 60 * TILE, 1, 0, 200);
        const m = order(w, g, 115 * TILE, 60 * TILE);
        const full = rowSpan(w, g, m).ext;
        let t = 0;
        while (t++ < 30 * 60 && rowSpan(w, g, m).ext > full * 0.9) tick(w, 1);
        // 已经在收窄了，但还没进谷（谷口在 x = 50 格）
        expect(foldNow(m)).toBeGreaterThan(1);
        expect(m.x).toBeLessThan(49 * TILE);
        const id = m.id;
        // 往南改道，目的地在谷口西边：不用掉头（夹角不到 90°），也不经过山谷
        w.orderMove(g, m.x + TILE, 100 * TILE, false);
        expect(w.grp[g[0]]).toBe(id);
        expect(rowSpan(w, g, m).ext).toBeGreaterThan(full * 0.97);
        expect(foldNow(m)).toBe(1);
        for (let k = 0; k < 150; k++) {
          tick(w, 1);
          expect(foldNow(m)).toBe(1);
        }
      }, 60000);

      it('最前排出了山谷、后几排还在谷里时改道：后排接着折着过谷，不绕路、不停，没人落进山里，出谷后展开，全员到达新目的地', () => {
        const w = flatWorld(140, 7, valley(4));
        const g = squad(w, 25 * TILE, 60 * TILE, 1, 0, 200);
        const m = order(w, g, 115 * TILE, 60 * TILE);
        for (let t = 0; t < 30 * 100 && m.x < 84 * TILE; t++) tick(w, 1);
        const id = m.id;
        const inValley = (): number => g.filter(s => w.x[s] > 50 * TILE && w.x[s] < 81 * TILE).length;
        expect(inValley()).toBeGreaterThan(30);
        expect(foldNow(m)).toBeGreaterThan(1.5);
        // 往东南改道（夹角不到 90°）：新路线完全在谷外
        w.orderMove(g, 100 * TILE, 85 * TILE, false);
        expect(w.grp[g[0]]).toBe(id);
        // 身后的窄处仍在起作用：后排还是折着的
        expect(foldNow(m)).toBeGreaterThan(1.5);
        const blk = w.nav.block[1];
        let inBlock = 0, maxApart = 0, minV = Infinity, peakFold = 0, slotBad = 0;
        for (let t = 0; t < 30 * 90 && !m.arrived; t++) {
          tick(w, 1);
          if (m.arrived) break;
          minV = Math.min(minV, m.v);
          peakFold = Math.max(peakFold, foldNow(m));
          let ap = 0;
          for (const s of g) {
            if (blk[w.cellAt(w.x[s], w.y[s])]) inBlock++;
            ap += w.apart[s];
            // 还在谷里的人，位置不落在山里（谷两侧的山：y < 58 格或 y > 62 格，拐角上不到一个兵半径的误差不算）
            if (w.x[s] > 50 * TILE && w.x[s] < 81 * TILE) {
              marchSlot(m, w.marchRow[s], w.marchCol[s], w.offL[s]);
              if (SLOT.x > 50 * TILE && SLOT.x < 81 * TILE && (SLOT.y < 58 * TILE - 6 || SLOT.y > 62 * TILE + 6)) slotBad++;
            }
          }
          maxApart = Math.max(maxApart, ap);
        }
        expect(m.arrived).toBe(true);
        expect(inBlock).toBe(0);
        expect(slotBad).toBe(0);
        // 没有人因为够不着位置而各自绕路
        expect(maxApart).toBeLessThanOrEqual(5);
        // 最前排没有停下
        expect(minV).toBeGreaterThan(0.25 * UNIT_BY_KEY.dao.walk);
        // 出谷之后展开，没有再折
        expect(foldNow(m)).toBe(1);
        for (let t = 0; t < 30 * 60 && g.some(s => w.order[s] !== O_IDLE); t++) tick(w, 1);
        expect(g.every(s => w.order[s] === O_IDLE)).toBe(true);
        for (const s of g) expect(Math.hypot(w.x[s] - 100 * TILE, w.y[s] - 85 * TILE)).toBeLessThan(m.depth + m.width);
      }, 90000);
    });
  });

  describe('流场、堵路与收尾的边角', () => {
    /** 一道山墙：y 58..60 格、x 从 20 格到图边，只有西头（x < 20 格）能绕过去 */
    const longWall = (t: Uint8Array, n: number): void => rect(t, n, 20, n - 1, 58, 60);

    it('改道后的路线要先往回走（只有西头能绕）、新路线的流场又还没算好：当场算好再判，要掉头就重新整队，不沿用队列', () => {
      const w = flatWorld(140, 7, longWall);
      const g = squad(w, 30 * TILE, 66 * TILE, 1, 0, 80);
      const m = order(w, g, 120 * TILE, 66 * TILE);
      tick(w, 30 * 4);
      expect(m.arrived).toBe(false);
      const id = m.id;
      // 队伍在墙南侧，下令去墙北侧前方偏左处：直线被墙挡住，路线要先往西走回头路
      w.orderMove(g, 50 * TILE, 50 * TILE, false);
      const now = w.grp[g[0]];
      expect(now).not.toBe(id);
      const nm = w.marches[now];
      expect(nm.v).toBe(0);
      expect(nm.destX).toBeCloseTo(50 * TILE, 0);
      // 重新整队：最前排的人队列偏移为 0
      expect(Math.max(...g.map(s => w.offA[s]))).toBe(0);
    }, 60000);

    it('终点后面紧挨着走不通的地形（过窄处到终点，再往前是深水）：收尾不停，不拖到 tailMax，期间最前排速度不为 0，全员到达', () => {
      const w = flatWorld(140, 7, (t, n) => {
        valley(4)(t, n);
        for (let y = 0; y < n; y++) for (let x = 86; x < n; x++) t[y * n + x] = T_DEEP;
      });
      const g = squad(w, 25 * TILE, 60 * TILE, 1, 0, 200);
      const m = order(w, g, 85 * TILE, 60 * TILE);
      let tailFrames = 0, minV = Infinity;
      for (let t = 0; t < 30 * 100 && g.some(s => w.order[s] !== O_IDLE); t++) {
        tick(w, 1);
        // 队伍还在收尾（成员走光后编队对象就闲置了，不再算）
        if (m.tail && m.alive) {
          tailFrames++;
          minV = Math.min(minV, m.v);
        }
      }
      expect(tailFrames).toBeGreaterThan(10);
      expect(minV).toBeGreaterThan(0);
      // 收尾时长远小于 tailMax（是带完队尾的时间，不是等到超时）
      expect(tailFrames / 30).toBeLessThan(M.tailMax / 2);
      expect(g.every(s => w.order[s] === O_IDLE)).toBe(true);
    }, 60000);

    it('探好的路之后被堵（最前排前方的路线上建起了建筑）：以当前位置重新整队、改走新路线，不穿过建筑，不停，全员到达', () => {
      const w = flatWorld(140, 7);
      const g = squad(w, 30 * TILE, 70 * TILE, 1, 0, 80);
      const m = order(w, g, 110 * TILE, 70 * TILE);
      tick(w, 30 * 4);
      // 建筑立在最前排前方 8 格、路线正中（2×2 格，占 69、70 两行）
      const bx = Math.floor(m.x / TILE) + 8;
      const b = w.addBuilding(BUILDINGS.outpost, bx, 69, 2, -1);
      const blk = w.nav.block[1];
      expect(blk[w.cellAt((bx + 0.5) * TILE, 70 * TILE)]).toBe(1);
      let lastX = m.x, lastY = m.y, jump = 0, stopped = 0, inBlock = 0, inside = 0, detour = 0, stalled = 0;
      const px = g.map(s => w.x[s]), py = g.map(s => w.y[s]), still = g.map(() => 0);
      for (let t = 0; t < 30 * 120 && !m.arrived; t++) {
        tick(w, 1);
        if (m.arrived) break;
        jump = Math.max(jump, Math.hypot(m.x - lastX, m.y - lastY));
        lastX = m.x;
        lastY = m.y;
        if (m.v === 0) stopped++;
        // 最前排的位置不落进建筑占的格子
        if (m.x > b.tx * TILE && m.x < (b.tx + b.def.w) * TILE && m.y > b.ty * TILE && m.y < (b.ty + b.def.h) * TILE) inside++;
        detour = Math.max(detour, Math.abs(m.y - 70 * TILE));
        for (const s of g) if (blk[w.cellAt(w.x[s], w.y[s])]) inBlock++;
        g.forEach((s, k) => {
          const mv = Math.hypot(w.x[s] - px[k], w.y[s] - py[k]);
          px[k] = w.x[s];
          py[k] = w.y[s];
          if (w.order[s] !== O_IDLE && mv < UNIT_BY_KEY.dao.walk / 30 * 0.15) {
            if (++still[k] === 150) stalled++;
          } else still[k] = 0;
        });
      }
      expect(m.arrived).toBe(true);
      expect(inside).toBe(0);
      expect(inBlock).toBe(0);
      // 绕开了建筑：最前排偏出过原来的直线
      expect(detour).toBeGreaterThan(TILE / 2);
      // 没有跳变；重新整队后最前排只等一次统计（8 帧）就接着走，不会一直停；没有卡死的人
      expect(jump).toBeLessThan(5);
      expect(stopped).toBeLessThanOrEqual(10);
      expect(stalled).toBe(0);
      for (let t = 0; t < 30 * 40 && g.some(s => w.order[s] !== O_IDLE); t++) tick(w, 1);
      expect(g.every(s => w.order[s] === O_IDLE)).toBe(true);
    }, 90000);

    it('下令后路线还没算好：最前排不越过探路点（原地等），路线算好之后恢复行军速度', () => {
      // 路线要绕过山墙的西头，下令时流场是新算的、还没算好
      const w = flatWorld(140, 7, longWall);
      const g = squad(w, 30 * TILE, 66 * TILE, 1, 0, 80);
      const m = order(w, g, 120 * TILE, 50 * TILE);
      expect(m.field).not.toBeNull();
      expect(m.field!.pending).toBe(true);
      // 探路点还没出发：最前排就在探路点上，一动不动
      expect(m.lead).toBe(0);
      const x0 = m.x, y0 = m.y;
      let leadMin = 0, vMax = 0;
      for (let t = 0; t < 30 * 6; t++) {
        tick(w, 1);
        // 探路点始终在最前排前方（或重合），最前排从不越过它
        leadMin = Math.min(leadMin, m.lead);
        vMax = Math.max(vMax, m.v);
        if (m.field && m.field.pending) {
          expect(m.v).toBe(0);
          expect(Math.hypot(m.x - x0, m.y - y0)).toBeLessThan(1);
        }
      }
      expect(leadMin).toBeGreaterThanOrEqual(0);
      // 算好后按行军速度走
      expect(vMax).toBeCloseTo(UNIT_BY_KEY.dao.walk, 3);
      expect(Math.hypot(m.x - x0, m.y - y0)).toBeGreaterThan(100);
    }, 60000);

    it('改道后新路线要绕障碍：路线当场算好，沿用队列，最前排不越过探路点，行军速度不掉', () => {
      // 往东北走了几秒，再改去一块山后面（新路线要绕过它）：夹角不到 90°，沿用编队
      const w = flatWorld(140, 7, (t, n) => rect(t, n, 70, 72, 62, 80));
      const g = squad(w, 30 * TILE, 70 * TILE, 1, 0, 80);
      const m = order(w, g, 120 * TILE, 40 * TILE);
      tick(w, 30 * 4);
      const id = m.id;
      w.orderMove(g, 110 * TILE, 72 * TILE, false);
      expect(w.grp[g[0]]).toBe(id);
      expect(m.field).not.toBeNull();
      let leadMin = Infinity, vMin = Infinity;
      for (let t = 0; t < 30 * 8 && !m.arrived; t++) {
        tick(w, 1);
        if (m.arrived) break;
        leadMin = Math.min(leadMin, m.lead);
        vMin = Math.min(vMin, m.v);
      }
      expect(leadMin).toBeGreaterThanOrEqual(0);
      expect(vMin).toBeGreaterThan(UNIT_BY_KEY.dao.walk * 0.95);
    }, 60000);

    it('折排途中有成员阵亡或溃逃：其余的人位置仍然自洽（不越界、没有 NaN、没人落进山里），仍能全员到达', () => {
      const w = flatWorld(140, 7, valley(4));
      const g = squad(w, 25 * TILE, 60 * TILE, 1, 0, 200);
      const m = order(w, g, 115 * TILE, 60 * TILE);
      for (let t = 0; t < 30 * 100 && foldNow(m) <= 2.5; t++) tick(w, 1);
      expect(foldNow(m)).toBeGreaterThan(2.5);
      // 每 5 个死 1 个，其余每 7 个溃逃 1 个，分布在各排各处
      const routed: number[] = [];
      g.forEach((s, k) => {
        if (k % 5 === 0) w.removeUnit(s);
        else if (k % 7 === 0) {
          startRout(w, s);
          routed.push(s);
        }
      });
      const rest = g.filter(s => w.alive[s] && !routed.includes(s));
      expect(rest.length).toBeGreaterThan(100);
      const blk = w.nav.block[1];
      let nan = 0, oob = 0, inBlock = 0;
      for (let t = 0; t < 30 * 100 && !m.arrived && m.alive; t++) {
        tick(w, 1);
        for (const s of rest) {
          if (!w.alive[s] || w.grp[s] !== m.id) continue;
          marchSlot(m, w.marchRow[s], w.marchCol[s], w.offL[s]);
          if (!Number.isFinite(SLOT.x) || !Number.isFinite(SLOT.y) || !Number.isFinite(w.x[s]) || !Number.isFinite(w.y[s])) nan++;
          if (SLOT.x < 0 || SLOT.y < 0 || SLOT.x > w.W || SLOT.y > w.H) oob++;
          if (blk[w.cellAt(w.x[s], w.y[s])]) inBlock++;
        }
      }
      expect(nan).toBe(0);
      expect(oob).toBe(0);
      expect(inBlock).toBe(0);
      for (let t = 0; t < 30 * 80 && rest.some(s => w.alive[s] && w.order[s] !== O_IDLE); t++) tick(w, 1);
      expect(rest.every(s => !w.alive[s] || w.order[s] === O_IDLE)).toBe(true);
    }, 90000);
  });
});
