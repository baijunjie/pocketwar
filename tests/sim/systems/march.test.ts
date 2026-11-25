import { describe, expect, it } from 'vitest';
import { BUILDINGS, FACTIONS, RULES, SITE_CAMP, TILE, T_BRIDGE, T_DEEP, T_MOUNTAIN, UNIT_BY_KEY } from '../../../src/sim/defs';
import { O_AMOVE, O_IDLE, O_MOVE, S_COMBAT, S_ROUT } from '../../../src/sim/state';
import { startRout } from '../../../src/sim/systems/morale';
import { armyList, createGame } from '../../../src/sim/setup';
import { FOLLOW, FOLLOW_APART, FOLLOW_SLOT, FOLLOW_SQUEEZE, SLOT, marchFollow, marchSlot } from '../../../src/sim/systems/march';
import type { March } from '../../../src/sim/systems/march';
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
  /** 领队走过的路程；成员走过的最长路程（像素） */
  leadPath: number;
  maxPath: number;
  /** 出发整队（头 2 秒）之后，队列压在障碍上（over 超过 overMin 的比例）的那些帧里领队停下不动的帧数 */
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
    // 领队到达后这个 march 对象会被别的队伍重用，统计到此为止
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

  it('最短路线：领队走的路程接近地形允许的最短路线，成员走的最长路程也在正常范围内（不绕整座山）', async () => {
    // 各场景起点到终点、沿必经之处（谷口、桥头、山梁南端）折线的路程（格）
    const shortest: Record<string, number> = {
      valley: 90,
      bridge: Math.hypot(25, 11) + 5 + Math.hypot(40, 9),
      ridge: Math.hypot(25, 25) + 5 + Math.hypot(36, 35.5),
      rocks: Math.hypot(80, 2),
    };
    for (const name of Object.keys(shortest)) {
      const r = await cross(name);
      expect(r.leadPath / TILE, `${name} 领队`).toBeLessThan(shortest[name] * 1.15);
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
          // 领队走的是一条直线：贴着墙也不绕远
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

  it('穿过营寨：队列压在障碍上的那些帧里，领队没有停下来等人（停下的帧数不到 3 秒）', async () => {
    const r = await campRun('through');
    expect(r.stops).toBeLessThan(90);
  }, 180000);
});

describe('marchSlot：队列位置的契约', () => {
  it('直线行军：a 相差 d 的两个位置相距 d，同一个 a 上的两个位置相距 |l1 − l2|，连线垂直于前进方向', () => {
    const w = flatWorld(140);
    const g = squad(w, 25 * TILE, 70 * TILE);
    const m = order(w, g, 125 * TILE, 70 * TILE);
    run(w, 6);
    expect(m.v).toBeGreaterThan(0);
    const at = (a: number, l: number): [number, number] => {
      marchSlot(m, a, l);
      return [SLOT.x, SLOT.y];
    };
    for (const [a1, a2] of [[0, -1], [0, -100], [-5, -17.3], [-100, -333], [-12, -600], [-250, -251]]) {
      const [x1, y1] = at(a1, 17), [x2, y2] = at(a2, 17);
      expect(Math.hypot(x1 - x2, y1 - y2)).toBeCloseTo(a1 - a2, 3);
    }
    for (const a of [0, -30, -200, -600]) {
      const [x1, y1] = at(a, -60), [x2, y2] = at(a, 45);
      expect(Math.hypot(x1 - x2, y1 - y2)).toBeCloseTo(105, 3);
      expect((x2 - x1) * SLOT.hx + (y2 - y1) * SLOT.hy).toBeCloseTo(0, 3);
    }
  }, 30000);

  it('直线行军：a = 0、l = 0 就是领队，位置的行进方向就是领队的朝向，正的 l 在朝向的右手边', () => {
    const w = flatWorld(140);
    const g = squad(w, 25 * TILE, 70 * TILE);
    const m = order(w, g, 125 * TILE, 70 * TILE);
    run(w, 6);
    marchSlot(m, 0, 0);
    expect(SLOT.x).toBeCloseTo(m.x, 3);
    expect(SLOT.y).toBeCloseTo(m.y, 3);
    expect(SLOT.hx).toBeCloseTo(m.hx, 3);
    expect(SLOT.hy).toBeCloseTo(m.hy, 3);
    // 朝东走：右手边是 +y
    marchSlot(m, 0, 50);
    expect(SLOT.y - m.y).toBeCloseTo(50 * m.hx, 3);
    expect(SLOT.x - m.x).toBeCloseTo(-50 * m.hy, 3);
    expect(SLOT.y).toBeGreaterThan(m.y);
  }, 30000);

  it('转弯时：a 是沿领队实际走过的路往回数的路程，l 是在该处朝向的右手边再横移的距离，SLOT.hx/hy 是该处的行进方向', () => {
    // 一道南北向的山梁挡在中间，从南头绕过去
    const w = flatWorld(140, 7, (t, n) => wall(t, n, 60, 63, 0, 84));
    const g = squad(w, 35 * TILE, 60 * TILE);
    const m = order(w, g, 100 * TILE, 50 * TILE);
    // 领队的实际足迹：累计路程、位置、朝向
    interface Rec { s: number; x: number; y: number; hx: number; hy: number }
    const hist: Rec[] = [{ s: 0, x: m.x, y: m.y, hx: m.hx, hy: m.hy }];
    // 在足迹上找累计路程为 s 的点
    const pick = (s: number): Rec => {
      let k = hist.length - 1;
      while (k > 0 && hist[k - 1].s >= s) k--;
      const a = hist[Math.max(0, k - 1)], b = hist[k];
      const f = b.s > a.s ? (s - a.s) / (b.s - a.s) : 0;
      return { s, x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, hx: a.hx + (b.hx - a.hx) * f, hy: a.hy + (b.hy - a.hy) * f };
    };
    let checked = 0, turned = 0;
    for (let t = 1; t < 30 * 200 && !m.arrived; t++) {
      const px = m.x, py = m.y;
      w.tick();
      w.fxN = 0;
      if (m.arrived) break;
      const last = hist[hist.length - 1];
      hist.push({ s: last.s + Math.hypot(m.x - px, m.y - py), x: m.x, y: m.y, hx: m.hx, hy: m.hy });
      if (t % 30 || last.s < 700) continue;
      const S = hist[hist.length - 1].s;
      // 比行迹还靠后的位置是从最老的一点直排下去的，不再跟着走过的路：只抽查行迹以内的
      for (const a of [-5, -40, -150, -300, -500].filter(a => -a <= (m.cap - 2) * M.trailStep)) {
        const r = pick(S + a);
        const nx = -r.hy, ny = r.hx;
        for (const l of [-50, 0, 35]) {
          marchSlot(m, a, l);
          expect(Math.hypot(SLOT.x - (r.x + nx * l), SLOT.y - (r.y + ny * l))).toBeLessThan(3);
          expect(Math.hypot(SLOT.hx - r.hx, SLOT.hy - r.hy)).toBeLessThan(0.08);
        }
        // 同一个 a 上不同 l：相距 |Δl|，连线垂直于该处的前进方向
        marchSlot(m, a, -20);
        const x1 = SLOT.x, y1 = SLOT.y;
        marchSlot(m, a, 20);
        expect(Math.hypot(SLOT.x - x1, SLOT.y - y1)).toBeCloseTo(40, 0);
        expect((SLOT.x - x1) * SLOT.hx + (SLOT.y - y1) * SLOT.hy).toBeCloseTo(0, 3);
      }
      checked++;
      if (Math.abs(pick(S - 300).hx - pick(S).hx) + Math.abs(pick(S - 300).hy - pick(S).hy) > 0.3) turned++;
    }
    expect(checked).toBeGreaterThan(10);
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
    marchSlot(dry.m, dry.w.offA[u], dry.w.offL[u]);
    // 障碍摆在队伍前方 AHEAD 处（摆在队伍脚下会把人挤开、队列也跟着变），再把领队连同行迹整体挪过去
    const AHEAD = 480;
    const { x: sx, y: sy, cx, cy } = SLOT;
    const { w, g, m } = build(paint(sx + AHEAD, sy, cx + AHEAD, cy));
    m.x += AHEAD;
    for (let i = 0; i < m.cap; i++) m.trail[i * 4] += AHEAD;
    const v = g[k];
    marchSlot(m, w.offA[v], w.offL[v]);
    expect(SLOT.x - AHEAD).toBeCloseTo(sx, 3);
    expect(SLOT.y).toBeCloseTo(sy, 3);
    return { w, m, u: v, l: w.offL[v], sx: SLOT.x, sy: SLOT.y, cx: SLOT.cx, cy: SLOT.cy };
  }
  const follow = (c: Ctx, ux: number, uy: number): number => {
    marchSlot(c.m, c.w.offA[c.u], c.l);
    return marchFollow(c.w, c.m, c.l, ux, uy);
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
    marchSlot(m, w.offA[out], w.offL[out]);
    expect(SLOT.y).toBeLessThan(8);
    const r = marchFollow(w, m, w.offL[out], SLOT.cx - 10, SLOT.cy);
    expect(r).toBe(FOLLOW_SQUEEZE);
    expect(FOLLOW.y).toBeGreaterThanOrEqual(8 - 16);
    expect(FOLLOW.y).toBeLessThan(SLOT.cy);
  });
});

describe('领队等不等人：队列压在障碍上时不等够不着位置的人，走出障碍后才等', () => {
  /** 按需求里的口径，从场上的状态算出这一轮统计（每 8 帧一次）应得的 over 与 lag */
  function expected(w: World, g: number[], m: March): { over: number; lag: number; cnt: number; lagApart: number; draped: boolean } {
    let cnt = 0, over = 0, lagSum = 0, lagApart = 0;
    const blk = w.nav.block[m.team];
    for (const s of g) {
      if (!w.alive[s] || w.grp[s] !== m.id || w.state[s] & S_ROUT) continue;
      cnt++;
      if (w.state[s] & S_COMBAT) continue;
      const l = w.offL[s];
      marchSlot(m, w.offA[s], l);
      const sx = SLOT.x, sy = SLOT.y, hx = SLOT.hx, hy = SLOT.hy;
      // 本排中线上的那一点：位置朝中线横移回 l
      const cx = sx + hy * l, cy = sy - hx * l;
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

  /** 一队 n 个刀盾过窄桥；每一轮统计前后对照 expected 的结果；返回压在障碍上的帧里领队的最低速度比（占行军速度）与「若也算够不着的人」的掉队距离 */
  async function bridge(n: number): Promise<{ drapedWithApart: number; openWithApart: number; slowest: number; counted: number; arrived: boolean }> {
    const sc = SCENES.bridge;
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
      // 上一轮统计判定队列压在障碍上（或没压）之后，领队在这一帧走的速度
      if (t > 90 && m.over > Math.max(1, m.cnt * M.overMin)) {
        slowest = Math.min(slowest, m.v / m.speed);
        // 假如把够不着位置的人也算进去，掉队距离会是多少
        counted = Math.max(counted, m.lag + m.lagApart / m.cnt);
      }
    }
    expect(stats).toBeGreaterThan(100);
    return { drapedWithApart, openWithApart, slowest, counted, arrived: m.arrived };
  }

  it('每一轮统计：over 是落在障碍里、出图或与中线点隔开的位置数；压在障碍上时 lag 不含够不着位置的人，否则含（窄桥，200 人）', async () => {
    const r = await bridge(200);
    expect(r.arrived).toBe(true);
    // 两种情形都出现过，用例才有意义
    expect(r.drapedWithApart).toBeGreaterThan(5);
    expect(r.openWithApart).toBeGreaterThan(0);
  }, 120000);

  it('队列压在障碍上的那一段领队不停（窄桥，200 人与 579 人）：够不着位置的人若也算进去，领队本会放慢到几乎停下', async () => {
    for (const n of [200, 579]) {
      const r = await bridge(n);
      // 只算跟着位置走的人：领队至少还以一半以上的速度前进
      expect(r.slowest, `${n} 人`).toBeGreaterThan(0.5);
      // 对照：把够不着的人也算进去，平均掉队距离已远超 lagFull，领队会被拖慢
      expect(r.counted, `${n} 人`).toBeGreaterThan(M.lagFull * 2);
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
      marchSlot(m, w.offA[s], w.offL[s]);
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
    marchSlot(m, w.offA[r], w.offL[r]);
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
      const u = g[best], l = w.offL[u], a = w.offA[u];
      expect(l).toBeLessThan(-110);
      expect(l).toBeGreaterThan(-140);
      const edgeY = edgeRow * TILE;
      const dEdge = CY - edgeY;
      expect(dEdge).toBeCloseTo(EDGE, 5);
      const half = m.width / 2;
      const lo = (dEdge - 16) * -l / half - 8, hi = dEdge * -l / half + 8;
      let inside = 0, aparts = 0, entered = false, settled = 0;
      tick(w, 30 * 50, () => {
        marchSlot(m, a, l);
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
      marchSlot(m, a, l);
      expect(w.apart[u]).toBe(0);
      expect(Math.hypot(SLOT.x - w.x[u], SLOT.y - w.y[u])).toBeLessThan(20);
    }, 60000);

    it('这些人是随本排走的，不是各自赶路：位置落在柱子里的整个过程中，他们没有跑到领队前面去', () => {
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

  describe('位置够不着、本排中线点也看不见（隔着墙）：不等，跑步沿自己的路线走，过去之后再归队', () => {
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

    it('apart 为 1，以奔跑速度走，不进墙；绕过墙端、看得见位置之后 apart 回到 0', () => {
      const { w, m, u } = scene2();
      const d = w.defs[w.type[u]];
      let apartFrames = 0, entered = false, aroundAt = -1, speedSum = 0, speedN = 0, px = w.x[u], py = w.y[u];
      for (let t = 0; t < 30 * 25; t++) {
        tick(w, 1);
        const sp = Math.hypot(w.x[u] - px, w.y[u] - py) * 30;
        px = w.x[u];
        py = w.y[u];
        if (inWall(w, w.x[u], w.y[u])) entered = true;
        if (w.apart[u]) {
          apartFrames++;
          // 一开始的 5 秒：路上没有别的阻碍，应当全速
          if (t < 30 * 5) {
            speedSum += sp;
            speedN++;
          }
        } else if (aroundAt < 0) aroundAt = t;
        if (aroundAt < 0 && t < 30 * 5) expect(w.apart[u]).toBe(1);
      }
      expect(entered).toBe(false);
      expect(apartFrames).toBeGreaterThan(30 * 5);
      expect(speedSum / speedN).toBeGreaterThan(d.speed * 0.95);
      expect(speedSum / speedN).toBeLessThanOrEqual(d.speed * 1.02);
      // 过了墙端（71 格）之后就不再算够不着
      expect(aroundAt).toBeGreaterThan(0);
      expect(w.x[u]).toBeGreaterThan(71 * TILE);
      expect(m.arrived).toBe(false);
    }, 60000);

    it('归队时位置若落在自己身后：原地等，不往回跑', () => {
      const { w, u } = scene2();
      // 绕过墙端
      for (let t = 0; t < 30 * 12 && !(w.x[u] > 71 * TILE && !w.apart[u]); t++) tick(w, 1);
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
