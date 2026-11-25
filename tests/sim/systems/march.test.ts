import { describe, expect, it } from 'vitest';
import { BUILDINGS, RULES, SITE_CAMP, TILE, T_MOUNTAIN, UNIT_BY_KEY } from '../../../src/sim/defs';
import { O_IDLE, O_MOVE, S_ROUT } from '../../../src/sim/state';
import { startRout } from '../../../src/sim/systems/morale';
import { createGame } from '../../../src/sim/setup';
import { SLOT, marchSlot } from '../../../src/sim/systems/march';
import type { March } from '../../../src/sim/systems/march';
import type { World } from '../../../src/sim/world';
import { flatWorld, run } from '../../helpers';

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

describe('编队行军：真实地图走进己方营寨', () => {
  interface Stat {
    arrived: boolean;
    /** 队首到队尾的直线距离 / 纵深，最小值 */
    minRatio: number;
    /** 横宽收窄（变小）发生时，领队周围量路宽够得着的范围内没有任何障碍的次数 */
    narrowInOpen: number;
    /** 中线横移一帧的变化量 / 领队这一帧走的路程，最大值 */
    maxShiftRate: number;
  }

  /** 领队周围 reach 以内有没有走不通的格子（障碍、水、建筑） */
  function obstacleNear(w: World, x: number, y: number, reach: number): boolean {
    const blk = w.nav.block[1], mw = w.map.w, mh = w.map.h;
    const cx = (x / TILE) | 0, cy = (y / TILE) | 0, r = Math.ceil(reach / TILE) + 1;
    for (let ty = Math.max(0, cy - r); ty <= Math.min(mh - 1, cy + r); ty++) {
      for (let tx = Math.max(0, cx - r); tx <= Math.min(mw - 1, cx + r); tx++) {
        if (!blk[ty * mw + tx]) continue;
        const dx = Math.max(tx * TILE - x, 0, x - (tx + 1) * TILE), dy = Math.max(ty * TILE - y, 0, y - (ty + 1) * TILE);
        if (dx * dx + dy * dy <= reach * reach) return true;
      }
    }
    return false;
  }

  const cache = new Map<string, Stat>();
  /** 全队从出发阵地走进营寨；同样的参数只跑一遍 */
  function campRun(seed: number, armySize: number): Stat {
    const key = `${seed}/${armySize}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const w = createGame({ seed, factions: ['china', 'japan'], armySize, difficulty: 1, fog: false, spectate: false, environment: false, supply: false }).world;
    const dp = w.map.deploy[1];
    const units: number[] = [];
    for (let i = 0; i < w.n; i++) if (w.alive[i] && w.team[i] === 1 && Math.hypot(w.x[i] - dp.x, w.y[i] - dp.y) < 900) units.push(i);
    const camp = w.sites.find(s => s.type === SITE_CAMP && s.owner === 1)!;
    const m = order(w, units, camp.x, camp.y);
    const st: Stat = { arrived: false, minRatio: Infinity, narrowInOpen: 0, maxShiftRate: 0 };
    let width = m.width;
    for (let t = 0; t < 30 * 300; t++) {
      const px = m.x, py = m.y, ps = m.shift;
      w.tick();
      w.fxN = 0;
      // 领队到达后这个 march 会被别的队伍复用，统计到此为止
      if (m.arrived) {
        st.arrived = true;
        break;
      }
      marchSlot(m, 0, 0);
      const fx = SLOT.x, fy = SLOT.y;
      marchSlot(m, -m.depth, 0);
      st.minRatio = Math.min(st.minRatio, Math.hypot(fx - SLOT.x, fy - SLOT.y) / m.depth);
      // 量路宽的点最远在身前 probeAhead 处，从那里往侧面最多量 fullW + 16：障碍离领队比这两段的斜边（各加两格余量）还远，就够不着
      if (m.width < width - 1e-6 && !obstacleNear(w, m.x, m.y, Math.hypot(M.probeAhead + 2 * TILE, m.fullW + 16 + 2 * TILE))) st.narrowInOpen++;
      width = m.width;
      const moved = Math.hypot(m.x - px, m.y - py);
      if (moved > 0) st.maxShiftRate = Math.max(st.maxShiftRate, Math.abs(m.shift - ps) / moved);
    }
    cache.set(key, st);
    return st;
  }

  it('队列不被折叠：队首到队尾的直线距离与纵深之比始终接近 1（种子 42）', () => {
    const st = campRun(42, 600);
    expect(st.arrived).toBe(true);
    expect(st.minRatio).toBeGreaterThan(0.7);
  }, 120000);

  it('队列不被折叠：队首到队尾的直线距离与纵深之比始终接近 1（种子 3，千人）', () => {
    const st = campRun(3, 1000);
    expect(st.arrived).toBe(true);
    expect(st.minRatio).toBeGreaterThan(0.7);
  }, 120000);

  it('开阔地上不变阵：每次收窄时，领队周围量路宽够得着的范围内都有障碍', () => {
    for (const [seed, size] of [[42, 600], [3, 1000]]) {
      expect(campRun(seed, size).narrowInOpen).toBe(0);
    }
  }, 120000);

  it('中线横移跟路程走：一帧的变化量不超过领队这一帧实际走的路程 × shiftSlope', () => {
    for (const [seed, size] of [[42, 600], [3, 1000]]) {
      expect(campRun(seed, size).maxShiftRate).toBeLessThanOrEqual(M.shiftSlope + 1e-6);
    }
  }, 120000);
});

describe('编队行军：两侧的空当与中线横移', () => {
  const ROW = 70;
  const Y = ROW * TILE;

  it('两侧都宽敞：不收窄，中线不横移', () => {
    const w = flatWorld(140);
    const g = squad(w, 25 * TILE, Y);
    const m = order(w, g, 120 * TILE, Y);
    for (let t = 0; t < 30 * 200 && !m.arrived; t++) {
      w.tick();
      w.fxN = 0;
      if (m.arrived) break;
      expect(m.shiftTo).toBe(0);
      expect(m.shift).toBe(0);
      expect(m.width).toBe(m.fullW);
      // 出发整队完成之后，平均掉队不大
      if (t >= 90) expect(m.lag).toBeLessThan(M.lagStop * 0.5);
    }
    expect(m.arrived).toBe(true);
  }, 60000);

  // 墙在路线的哪一侧：朝东走，右手边是 +y。路线沿一格的中线走，墙与路线的间距 gap 格
  for (const n of [80, 300, 700]) {
    for (const gap of n === 700 ? [1] : [1, 3]) {
      for (const side of [1, -1]) {
        it(`一侧被长墙贴着、另一侧开阔：整队让开而不收窄，从墙头起没有人落在墙里（${n} 人，墙在${side > 0 ? '右' : '左'}手边，间距 ${gap} 格）`, () => {
          const w = flatWorld(140, 7, (t, nn) => {
            if (side > 0) wall(t, nn, 50, 100, ROW + gap, ROW + gap + 1);
            else wall(t, nn, 50, 100, ROW - gap - 1, ROW - gap);
          });
          const cy = (ROW + 0.5) * TILE;
          const g = squad(w, 15 * TILE, cy, 1, 0, n);
          const m = order(w, g, 120 * TILE, cy);
          const x0 = 50 * TILE, x1 = 100 * TILE;
          let settled = 0;
          for (let t = 0; t < 30 * 300 && !m.arrived; t++) {
            w.tick();
            w.fxN = 0;
            if (m.arrived) break;
            // 全程不收窄；从不往墙那一侧让
            expect(m.width).toBe(m.fullW);
            expect(m.shift * side).toBeLessThanOrEqual(0);
            // 从出发到到达，包括墙头那一段：没有一个队列位置在墙里
            for (const s of g) {
              marchSlot(m, w.offA[s], w.offL[s]);
              expect(inWall(w, SLOT.x, SLOT.y)).toBe(false);
            }
            // 领队走进墙段一个纵深再多一点之后，横移已经让到位
            if (m.x > x0 + m.depth + 250 && m.x < x1) {
              settled++;
              expect(m.shift * side).toBeLessThan(-1);
            }
          }
          expect(m.arrived).toBe(true);
          expect(settled).toBeGreaterThan(30);
        }, 120000);
      }
    }
  }

  it('路比队列窄、两侧都有墙：收窄成纵队，中线走在路正中，过了窄处再展开', () => {
    // 一条 4 格宽的夹道（y 在 ROW-1 .. ROW+2 之间），路线偏在夹道的上半
    const w = flatWorld(140, 7, (t, n) => {
      wall(t, n, 50, 90, ROW - 3, ROW - 2);
      wall(t, n, 50, 90, ROW + 3, ROW + 4);
    });
    const g = squad(w, 25 * TILE, Y);
    const m = order(w, g, 125 * TILE, Y);
    const roadMid = (ROW - 1 + ROW + 3) / 2 * TILE;
    const roadW = 4 * TILE;
    let judged = 0, minWidth = m.width;
    for (let t = 0; t < 30 * 120 && !m.arrived; t++) {
      w.tick();
      w.fxN = 0;
      if (m.arrived) break;
      minWidth = Math.min(minWidth, m.width);
      // 领队走进夹道一小段、行迹上的横移也已经到位之后
      if (m.x > 52 * TILE + 100 && m.x < 88 * TILE) {
        judged++;
        expect(m.width).toBeLessThanOrEqual(roadW);
        expect(Math.abs(m.y + m.shift - roadMid)).toBeLessThan(0.6 * TILE);
      }
    }
    expect(m.arrived).toBe(true);
    expect(judged).toBeGreaterThan(30);
    expect(minWidth).toBeLessThan(m.fullW);
    expect(m.width).toBe(m.fullW);
  }, 60000);

  // 夹道偏在路线一侧，横移会有大幅变化；风让领队实际走的路程与无风时的步长不同（朝东走：风向 0 是顺风，π 是逆风）
  for (const [name, force, dir] of [['无风', 0, 0], ['顺风', 1, 0], ['逆风', 1, Math.PI]] as const) {
    it(`中线横移跟路程走（${name}）：每帧变化量不超过领队这一帧实际位移 × shiftSlope，领队停下时不动`, () => {
      const w = flatWorld(140, 7, (t, n) => {
        wall(t, n, 50, 90, ROW - 1, ROW);
        wall(t, n, 50, 90, ROW + 5, ROW + 6);
      });
      if (force > 0) {
        w.env.enabled = true;
        w.env.nextWeather = w.env.nextWind = 1e9;
        w.env.windy = true;
        w.env.wind = w.env.windTarget = force;
        w.env.windDir = dir;
      }
      const g = squad(w, 25 * TILE, Y);
      const m = order(w, g, 125 * TILE, Y);
      let moves = 0, changed = 0;
      for (let t = 0; t < 30 * 300 && !m.arrived; t++) {
        const px = m.x, py = m.y, ps = m.shift;
        w.tick();
        w.fxN = 0;
        if (m.arrived) break;
        const dsh = Math.abs(m.shift - ps);
        if (m.v === 0) {
          expect(m.shift).toBe(ps);
        } else {
          moves++;
          expect(dsh).toBeLessThanOrEqual(Math.hypot(m.x - px, m.y - py) * M.shiftSlope + 1e-6);
        }
        if (dsh > 0) changed++;
      }
      expect(m.arrived).toBe(true);
      // 风确实一直在吹
      expect(w.env.wind).toBe(force);
      expect(moves).toBeGreaterThan(100);
      // 确实发生过横移，用例才有意义
      expect(changed).toBeGreaterThan(20);
    }, 60000);
  }
});

describe('编队行军：斜着走向没有门的墙', () => {
  // 一道东西向的长墙在 y = 110 格；队伍从北边斜着往墙前的一点走，行进方向与墙成 angle 角
  for (const angle of [30, 45, 60]) {
    for (const dir of [1, -1]) {
      it(`离墙还远时不收窄、不横移（与墙成 ${angle}°，朝${dir > 0 ? '东' : '西'}南）`, () => {
        const WALL = 110;
        const w = flatWorld(140, 7, (t, n) => wall(t, n, 10, 130, WALL, WALL + 1));
        const rad = angle * Math.PI / 180;
        const dx = Math.cos(rad) * dir, dy = Math.sin(rad);
        // 终点在墙前 6 格；起点沿相反方向退回 55 格远
        const ex = (dir > 0 ? 90 : 50) * TILE, ey = (WALL - 6) * TILE;
        const len = 55 * TILE;
        const g = squad(w, ex - dx * len, ey - dy * len, dx, dy);
        const m = order(w, g, ex, ey);
        let judged = 0;
        for (let t = 0; t < 30 * 200 && !m.arrived; t++) {
          w.tick();
          w.fxN = 0;
          if (m.arrived) break;
          // 领队离墙的垂直距离大于「往前量的距离 + 一个队宽」：墙够不着任何一次量
          if (WALL * TILE - m.y > M.probeAhead + m.fullW) {
            judged++;
            expect(m.shiftTo).toBe(0);
            expect(m.width).toBe(m.fullW);
          }
        }
        expect(m.arrived).toBe(true);
        expect(judged).toBeGreaterThan(30);
      }, 60000);
    }
  }
});

describe('marchSlot：队列位置的契约', () => {
  it('直线行军、没有横移：a 相差 d 的两个位置相距 d，同一个 a 上的两个位置相距 |l1 − l2|，连线垂直于前进方向', () => {
    const w = flatWorld(140);
    const g = squad(w, 25 * TILE, 70 * TILE);
    const m = order(w, g, 125 * TILE, 70 * TILE);
    run(w, 6);
    expect(m.shift).toBe(0);
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

  it('转弯、中线横移变化时：a 是沿领队实际走过的路往回数的路程，l 是在此之上的横向偏移', () => {
    // 一道南北向的山梁挡在中间，从南头绕过去；绕行和贴着山梁走时都会有横移
    const w = flatWorld(140, 7, (t, n) => wall(t, n, 60, 63, 0, 84));
    const g = squad(w, 35 * TILE, 60 * TILE);
    const m = order(w, g, 100 * TILE, 50 * TILE);
    // 领队的实际足迹：累计路程、位置、朝向、中线横移
    interface Rec { s: number; x: number; y: number; hx: number; hy: number; sh: number }
    const hist: Rec[] = [{ s: 0, x: m.x, y: m.y, hx: m.hx, hy: m.hy, sh: m.shift }];
    // 在足迹上找累计路程为 s 的点
    const pick = (s: number): Rec => {
      let k = hist.length - 1;
      while (k > 0 && hist[k - 1].s >= s) k--;
      const a = hist[Math.max(0, k - 1)], b = hist[k];
      const f = b.s > a.s ? (s - a.s) / (b.s - a.s) : 0;
      return { s, x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, hx: a.hx + (b.hx - a.hx) * f, hy: a.hy + (b.hy - a.hy) * f, sh: a.sh + (b.sh - a.sh) * f };
    };
    let checked = 0, turned = 0, shifted = 0;
    for (let t = 1; t < 30 * 200 && !m.arrived; t++) {
      const px = m.x, py = m.y;
      w.tick();
      w.fxN = 0;
      if (m.arrived) break;
      const last = hist[hist.length - 1];
      hist.push({ s: last.s + Math.hypot(m.x - px, m.y - py), x: m.x, y: m.y, hx: m.hx, hy: m.hy, sh: m.shift });
      if (t % 30 || last.s < 700) continue;
      const S = hist[hist.length - 1].s;
      for (const a of [-5, -40, -150, -300, -500]) {
        const r = pick(S + a);
        const nx = -r.hy, ny = r.hx;
        for (const l of [-50, 0, 35]) {
          marchSlot(m, a, l);
          expect(Math.hypot(SLOT.x - (r.x + nx * (l + r.sh)), SLOT.y - (r.y + ny * (l + r.sh)))).toBeLessThan(3);
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
      if (Math.abs(pick(S - 300).sh) > 5 || Math.abs(m.shift) > 5) shifted++;
    }
    expect(checked).toBeGreaterThan(10);
    // 抽查的时刻里确实有过转弯、有过横移
    expect(turned).toBeGreaterThan(0);
    expect(shifted).toBeGreaterThan(0);
  }, 60000);
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
