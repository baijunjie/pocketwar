import { describe, expect, it } from 'vitest';
import { RULES, TILE, UNIT_BY_KEY } from '../../../src/sim/defs';
import { S_COMBAT } from '../../../src/sim/world';
import { NONE } from '../../../src/sim/state';
import type { World } from '../../../src/sim/world';
import { flatWorld, run } from '../../helpers';

const C = (120 * TILE) / 2;
const idx = (k: string): number => UNIT_BY_KEY[k].idx;

/** 跑一帧，返回 slot 这一帧的位移 */
function stepMove(w: World, s: number): number {
  const x = w.x[s], y = w.y[s];
  w.tick();
  w.fxN = 0;
  return Math.hypot(w.x[s] - x, w.y[s] - y);
}

/**
 * 围攻一个血量无限的靶子：前 2 秒之后，没在交手、位移明显的单位里，相邻两帧位移方向反向的比例。
 * 来回弹跳的单位这个比例很高；停下或绕开的很低。
 */
const reversalRatio = (w: World, slots: number[], secs: number): number => {
  const px = new Map<number, [number, number]>();
  let moved = 0, flipped = 0;
  run(w, 2);
  for (const s of slots) px.set(s, [0, 0]);
  for (let t = 0; t < secs * 30; t++) {
    const x0 = slots.map(s => w.x[s]), y0 = slots.map(s => w.y[s]);
    w.tick();
    w.fxN = 0;
    slots.forEach((s, k) => {
      if (!w.alive[s]) return;
      const dx = w.x[s] - x0[k], dy = w.y[s] - y0[k];
      const prev = px.get(s)!;
      const m = Math.hypot(dx, dy);
      if (!w.engaged[s] && m > 0.15) {
        const pm = Math.hypot(prev[0], prev[1]);
        if (pm > 0.15) {
          moved++;
          if (dx * prev[0] + dy * prev[1] < -0.3 * m * pm) flipped++;
        }
        px.set(s, [dx, dy]);
      } else px.set(s, [0, 0]);
    });
  }
  return moved ? flipped / moved : 0;
};
describe('单位分离：不打仗时自己人可以穿过', () => {
  /** 两个己方军团步兵叠在一起（A 在左），gap 为圆心距；A 是否行军由 marchA 定，B 一直待命 */
  const overlapPair = (marchA: boolean, withEnemy = false): { w: World; a: number; b: number } => {
    const w = flatWorld();
    const [a] = w.spawnGroup(1, [idx('legion')], C, C, 1, 0);
    const b = w.spawnUnit(idx('legion'), 1, C + 4, C);
    if (marchA) w.orderMove([a], C, C + 600, false);
    if (withEnemy) {
      const [e] = w.spawnGroup(2, [idx('legion')], C + 100, C + 20, -1, 0);
      w.hp[e] = w.maxHp[e] = 1e9;
      w.orderStop([e], true);
    }
    return { w, a, b };
  };

  it('一方行军时，被穿过的待命单位只被推开很小一截', () => {
    const base = overlapPair(false);
    const march = overlapPair(true);
    const d0 = stepMove(base.w, base.b);
    const d1 = stepMove(march.w, march.b);
    expect(d0).toBeGreaterThan(0.5);
    expect(d1).toBeLessThan(d0 * 0.5);
  });

  it('行军穿过待命的自己人，对方被顶开的距离只剩 passPush 的比例', () => {
    const shift = (): { minDist: number; maxShift: number; sum: number } => {
      const w = flatWorld();
      const [a] = w.spawnGroup(1, [idx('legion')], C - 100, C, 1, 0);
      const b = w.spawnUnit(idx('legion'), 1, C, C);
      w.orderMove([a], C + 200, C, false);
      let maxShift = 0, minDist = Infinity;
      for (let t = 0; t < 30 * 8; t++) {
        w.tick();
        w.fxN = 0;
        maxShift = Math.max(maxShift, Math.hypot(w.x[b] - C, w.y[b] - C));
        minDist = Math.min(minDist, Math.hypot(w.x[a] - w.x[b], w.y[a] - w.y[b]));
      }
      return { minDist, maxShift, sum: w.rad[a] + w.rad[b] };
    };
    const pass = shift();
    const saved = RULES.combat.passPush;
    let full: ReturnType<typeof shift>;
    try {
      RULES.combat.passPush = 1;
      full = shift();
    } finally {
      RULES.combat.passPush = saved;
    }
    // 真的穿过去了：圆心靠得比半径和近得多；而且对方被顶开的距离远小于推挤不打折时
    expect(pass.minDist).toBeLessThan(pass.sum * 0.5);
    expect(full.maxShift).toBeGreaterThan(pass.maxShift * 2);
  });

  it('两个人都停下后照常分开，不会长期叠在一起', () => {
    const { w, a, b } = overlapPair(false);
    run(w, 3);
    expect(Math.hypot(w.x[a] - w.x[b], w.y[a] - w.y[b])).toBeGreaterThan((w.rad[a] + w.rad[b]) * 0.9);
  });

  it('行军的人停下后，与叠着的待命者也会分开', () => {
    const w = flatWorld();
    const [a] = w.spawnGroup(1, [idx('legion')], C - 60, C, 1, 0);
    const b = w.spawnUnit(idx('legion'), 1, C, C);
    // 目的地就在待命者身上：到达后两人叠在一起
    w.orderMove([a], C + 2, C, false);
    run(w, 8);
    expect(Math.hypot(w.x[a] - w.x[b], w.y[a] - w.y[b])).toBeGreaterThan((w.rad[a] + w.rad[b]) * 0.9);
  });

  it('任一方在战斗状态时不能穿过：推挤不打折', () => {
    // 敌人在视野内、双方进入战斗状态后，再把两人叠在一起，对比待命和行军两种命令下被推开的距离
    const build = (marchA: boolean): { w: World; a: number; b: number } => {
      const w = flatWorld();
      const a = w.spawnUnit(idx('legion'), 1, C, C);
      const b = w.spawnUnit(idx('legion'), 1, C + 30, C);
      const [e] = w.spawnGroup(2, [idx('legion')], C + 100, C + 20, -1, 0);
      w.hp[e] = w.maxHp[e] = 1e9;
      w.orderStop([e], true);
      for (let t = 0; t < 20; t++) {
        w.tick();
        w.fxN = 0;
      }
      expect(w.state[a] & S_COMBAT).toBeTruthy();
      expect(w.state[b] & S_COMBAT).toBeTruthy();
      w.x[b] = w.px[b] = w.homeX[b] = w.x[a] + 4;
      w.y[b] = w.py[b] = w.homeY[b] = w.y[a];
      w.vx[a] = w.vy[a] = w.vx[b] = w.vy[b] = 0;
      if (marchA) w.orderMove([a], C, C + 600, false);
      return { w, a, b };
    };
    const base = build(false), march = build(true);
    const d0 = stepMove(base.w, base.b);
    const d1 = stepMove(march.w, march.b);
    expect(march.w.state[march.a] & S_COMBAT).toBeTruthy();
    expect(d0).toBeGreaterThan(0.5);
    expect(d1).toBeGreaterThan(d0 * 0.5);
  });
});

describe('单位分离：战斗中不往让不开的自己人身上挤', () => {
  it('贴着站定的自己人时，朝它走的速度为 0', () => {
    const w = flatWorld();
    // 靶子在前，p 贴着它站定出手，a 在 p 身后被堵住
    const [e] = w.spawnGroup(2, [idx('legion')], C + 40, C, -1, 0);
    w.hp[e] = w.maxHp[e] = 1e9;
    w.orderStop([e], true);
    const p = w.spawnUnit(idx('legion'), 1, C + 40 - 2 * w.rad[e] + 2, C);
    const a = w.spawnUnit(idx('legion'), 1, C - 60, C);
    w.orderAttackUnit([p, a], e);
    const skin = RULES.combat.contactSkin;
    let checked = 0;
    for (let t = 0; t < 30 * 10; t++) {
      const d0 = Math.hypot(w.x[a] - w.x[p], w.y[a] - w.y[p]);
      w.tick();
      w.fxN = 0;
      const d1 = Math.hypot(w.x[a] - w.x[p], w.y[a] - w.y[p]);
      const rr = w.rad[a] + w.rad[p];
      // 开帧时贴着、对方站定、双方都在战斗状态：这一帧不能再往里挤
      if (w.planted[p] !== 0 && (w.state[a] & S_COMBAT) && d0 < rr + skin && d0 > rr * 0.5 && w.alive[a] && w.alive[p]) {
        checked++;
        expect(d1, `第 ${t} 帧`).toBeGreaterThanOrEqual(d0 - 0.05);
      }
    }
    expect(checked).toBeGreaterThan(10);
  });

  it('挤不进战线的近战兵不再原地来回弹跳', () => {
    const w = flatWorld(120, 3);
    const mix = [
      ...Array(40).fill(idx('legion')), ...Array(24).fill(idx('auxilia')),
      ...Array(16).fill(idx('equites')), ...Array(30).fill(idx('sagitt')),
    ];
    const a = w.spawnGroup(1, mix, C - 160, C, 1, 0);
    const [e] = w.spawnGroup(2, [idx('legion')], C + 60, C, -1, 0);
    w.hp[e] = w.maxHp[e] = 1e9;
    w.orderStop([e], true);
    w.orderAttackUnit(a, e);
    expect(reversalRatio(w, a, 10)).toBeLessThan(0.08);
  }, 30000);

  it('自己人叠得很深的情况不会因此变多：围攻时深度重叠的己方对很少', () => {
    const w = flatWorld(120, 3);
    const a = w.spawnGroup(1, Array(60).fill(idx('legion')), C - 160, C, 1, 0);
    const [e] = w.spawnGroup(2, [idx('legion')], C + 60, C, -1, 0);
    w.hp[e] = w.maxHp[e] = 1e9;
    w.orderStop([e], true);
    w.orderAttackUnit(a, e);
    run(w, 8);
    let deep = 0, pairs = 0;
    for (let i = 0; i < a.length; i++) {
      for (let j = i + 1; j < a.length; j++) {
        const rr = w.rad[a[i]] + w.rad[a[j]];
        const d = Math.hypot(w.x[a[i]] - w.x[a[j]], w.y[a[i]] - w.y[a[j]]);
        if (d < rr * 2) pairs++;
        if (d < rr * 0.6) deep++;
      }
    }
    expect(pairs).toBeGreaterThan(0);
    expect(deep / pairs).toBeLessThan(0.03);
  });

  it('敌我之间的推挤不受影响：进攻的人照样贴上敌人', () => {
    const w = flatWorld();
    const [a] = w.spawnGroup(1, [idx('legion')], C - 120, C, 1, 0);
    const [e] = w.spawnGroup(2, [idx('legion')], C + 20, C, -1, 0);
    w.hp[e] = w.maxHp[e] = 1e5;
    w.orderStop([e], true);
    w.orderAttackUnit([a], e);
    run(w, 10);
    expect(w.engaged[a]).toBe(1);
    expect(w.hp[e]).toBeLessThan(1e5);
  });
});

describe('单位分离：不冲着目标去的人照旧能把没站定的自己人挤开', () => {
  /** 待命的 legion 方阵被 auxilia 攻击，打了 12 秒、再过 20 秒后，数「原位被改到离开战前的值超过 8」的活人 */
  const rehomedAfterFight = (seed: number): { rehomed: number; alive: number; enemiesLeft: number } => {
    const w = flatWorld(120, seed);
    const mine = w.spawnGroup(1, Array(48).fill(idx('legion')), C, C, 1, 0);
    run(w, 2);
    const homes = mine.map(s => [w.homeX[s], w.homeY[s]]);
    const foes = w.spawnGroup(2, Array(16).fill(idx('auxilia')), C + 160, C, -1, 0);
    w.orderAttackUnit(foes, mine[0]);
    run(w, 12);
    const enemiesLeft = foes.filter(s => w.alive[s]).length;
    run(w, 20);
    let rehomed = 0, alive = 0;
    mine.forEach((s, k) => {
      if (!w.alive[s]) return;
      alive++;
      if (Math.hypot(w.homeX[s] - homes[k][0], w.homeY[s] - homes[k][1]) > 8) rehomed++;
    });
    return { rehomed, alive, enemiesLeft };
  };

  it.each([7, 11, 23])('待命部队被攻击、打完后绝大多数人回得到原位，原位不被改掉（种子 %i）', seed => {
    const { rehomed, alive, enemiesLeft } = rehomedAfterFight(seed);
    expect(enemiesLeft, '确实打过一仗').toBeLessThan(16);
    expect(alive).toBeGreaterThan(40);
    // 修好后三个种子都是 0；留余量，不断言具体走向
    expect(rehomed).toBeLessThanOrEqual(2);
  }, 60000);

  it('回原位的人（待命、无目标）即使在战斗状态，也能挤过没站定的自己人', () => {
    const w = flatWorld();
    const a = w.spawnUnit(idx('legion'), 1, C - 70, C);
    const r = w.rad[a];
    // 没站定的一排自己人横在回家的路上，挨在一起没有缝
    const wall: number[] = [];
    for (let k = -3; k <= 3; k++) wall.push(w.spawnUnit(idx('legion'), 1, C, C + k * 2 * r));
    w.homeX[a] = C + 60;
    w.homeY[a] = C;
    // 没有敌人，直接给战斗状态一个很长的余温：全体在战斗状态、都没有目标
    for (const s of [a, ...wall]) w.combatT[s] = 1e6;
    for (let t = 0; t < 30 * 10; t++) {
      w.tick();
      w.fxN = 0;
      expect(w.target[a], '回家的人没有目标').toBe(NONE);
    }
    expect(w.state[a] & S_COMBAT).toBeTruthy();
    expect(wall.some(s => w.planted[s] !== 0), '这排人没站定').toBe(false);
    // 越过了这排人的中线，没有被挡在西侧
    expect(w.x[a]).toBeGreaterThan(C);
  });

  it('战斗状态下赶路（移动命令、无目标）的人能挤过原地待命的自己人，不会被挡死在半路', () => {
    const w = flatWorld();
    const a = w.spawnUnit(idx('legion'), 1, C - 150, C);
    const r = w.rad[a];
    // 一整块没站定的待命方阵（8 列 12 排，挨在一起）横在路上，绕不开
    const block: number[] = [];
    for (let i = 0; i < 8; i++) {
      for (let k = 0; k < 12; k++) block.push(w.spawnUnit(idx('legion'), 1, C + i * 2 * r, C + (k - 5.5) * 2 * r));
    }
    // 没有敌人，直接给战斗状态一个很长的余温：全体在战斗状态、都没有目标
    for (const s of [a, ...block]) w.combatT[s] = 1e6;
    const destX = C + 8 * 2 * r + 120;
    w.orderMove([a], destX, C, false);
    for (let t = 0; t < 30 * 20; t++) {
      w.tick();
      w.fxN = 0;
      expect(w.target[a], '赶路的人没有目标').toBe(NONE);
    }
    expect(w.state[a] & S_COMBAT, '赶路途中一直在战斗状态').toBeTruthy();
    expect(block.some(s => w.planted[s] !== 0), '方阵没站定').toBe(false);
    expect(Math.hypot(w.x[a] - destX, w.y[a] - C), '没有被挡死在半路').toBeLessThan(40);
  });
});

describe('单位分离：挤不进战线的人沿自己人背后绕到侧面', () => {
  /**
   * 一道站定的战线：n 个血量无限的敌人排成两排横队，前排每个敌人面前贴着一个己方站定的近战兵。
   * 返回己方站定者和后排敌人：后排离前线两个身位，追后排的人从自己人的缝里也够不着。
   */
  const lineWall = (w: World, n: number): { ps: number[]; back: number[] } => {
    const probe = w.spawnUnit(idx('legion'), 2, 0, 0);
    const rr = w.rad[probe];
    w.removeUnit(probe);
    const front: number[] = [], back: number[] = [], ps: number[] = [];
    for (let k = 0; k < n; k++) {
      const y = C + (k - (n - 1) / 2) * 2 * rr;
      front.push(w.spawnUnit(idx('legion'), 2, C + 40, y));
      back.push(w.spawnUnit(idx('legion'), 2, C + 40 + 2 * rr, y));
    }
    for (const e of [...front, ...back]) w.hp[e] = w.maxHp[e] = 1e9;
    w.orderStop([...front, ...back], true);
    for (let k = 0; k < n; k++) {
      const p = w.spawnUnit(idx('legion'), 1, C + 40 - 2 * rr + 2, C + (k - (n - 1) / 2) * 2 * rr);
      ps.push(p);
      w.orderAttackUnit([p], front[k]);
    }
    return { ps, back };
  };

  /** 一个敌人、一个贴着它站定的己方兵 p（y 偏 off），后面追来一个 a；返回 a 偏离中线最远的 y 位移（带符号）和最后是否在交手 */
  const flankOne = (off: number, secs = 8): { maxY: number; engaged: boolean } => {
    const w = flatWorld();
    const [e] = w.spawnGroup(2, [idx('legion')], C + 40, C, -1, 0);
    w.hp[e] = w.maxHp[e] = 1e9;
    w.orderStop([e], true);
    const p = w.spawnUnit(idx('legion'), 1, C + 40 - 2 * w.rad[e] + 2, C + off);
    const a = w.spawnUnit(idx('legion'), 1, C - 60, C);
    w.orderAttackUnit([p, a], e);
    let maxY = 0;
    for (let t = 0; t < secs * 30; t++) {
      w.tick();
      w.fxN = 0;
      if (Math.abs(w.y[a] - C) > Math.abs(maxY)) maxY = w.y[a] - C;
    }
    return { maxY, engaged: w.engaged[a] === 1 };
  };

  it('正前方被站定的自己人堵住时绕到侧面，钻进空位交上手', () => {
    // 前面正好一个人把路堵死：不绕的话到不了敌人跟前
    const { maxY, engaged } = flankOne(0);
    expect(Math.abs(maxY)).toBeGreaterThan(8);
    expect(engaged).toBe(true);
  });

  it('选贴着的人少的一侧：前面的人偏向哪边，就往另一边绕', () => {
    expect(flankOne(5).maxY).toBeLessThan(-5);
    expect(flankOne(-5).maxY).toBeGreaterThan(5);
  });

  it('两边一样多时按编号分两边：相邻编号的两个人往相反方向绕', () => {
    const w = flatWorld();
    // 先连着生两个追击者，编号相邻；各自面前一个站定的自己人，正对着，两边一样多
    const a1 = w.spawnUnit(idx('legion'), 1, C - 60, C - 400);
    const a2 = w.spawnUnit(idx('legion'), 1, C - 60, C + 400);
    const rows = [[a1, C - 400], [a2, C + 400]] as const;
    for (const [a, cy] of rows) {
      const e = w.spawnUnit(idx('legion'), 2, C + 40, cy);
      w.hp[e] = w.maxHp[e] = 1e9;
      w.orderStop([e], true);
      const p = w.spawnUnit(idx('legion'), 1, C + 40 - 2 * w.rad[e] + 2, cy);
      w.orderAttackUnit([p, a], e);
    }
    const far = [0, 0];
    for (let t = 0; t < 30 * 3; t++) {
      w.tick();
      w.fxN = 0;
      rows.forEach(([a, cy], k) => {
        if (Math.abs(w.y[a] - cy) > Math.abs(far[k])) far[k] = w.y[a] - cy;
      });
    }
    expect(Math.abs(far[0])).toBeGreaterThan(5);
    expect(Math.abs(far[1])).toBeGreaterThan(5);
    expect(Math.sign(far[0])).toBe(-Math.sign(far[1]));
  });

  /**
   * 一个人追后排的敌人，被前排站定的自己人堵着够不着：逐帧记下横移速度、面朝与目标方向的夹角、「追不上」计时的增速。
   * 横挪的一段 = 贴着自己人、没交手、在挪动的连续帧（中间断开不超过 6 帧的算同一段）；走近人墙的路上不算。
   */
  const flankAlongWall = (secs: number): {
    spellSecs: number; maxDev: number; stuckRate: number; lateralFrames: number; waited: boolean; engagedFrames: number;
  } => {
    const w = flatWorld();
    const { ps, back } = lineWall(w, 31);
    const mid = back[15];
    const a = w.spawnUnit(idx('legion'), 1, C - 60, C + 3);
    w.orderAttackUnit([a], mid);
    let maxDev = 0, spell = 0, best = 0, gap = 0, lateralFrames = 0, prevStuck = 0, waited = false, engagedFrames = 0;
    const rates: number[] = [];
    for (let t = 0; t < secs * 30; t++) {
      const x0 = w.x[a], y0 = w.y[a];
      w.tick();
      w.fxN = 0;
      const vx = (w.x[a] - x0) * 30, vy = (w.y[a] - y0) * 30;
      if (w.waitT[a] > 0) waited = true;
      if (w.engaged[a]) engagedFrames++;
      if (Math.abs(vy) > 20 && Math.abs(vy) > 2 * Math.abs(vx)) {
        lateralFrames++;
        let dv = w.dir[a] - Math.atan2(w.y[mid] - w.y[a], w.x[mid] - w.x[a]);
        while (dv > Math.PI) dv -= 2 * Math.PI;
        while (dv < -Math.PI) dv += 2 * Math.PI;
        maxDev = Math.max(maxDev, Math.abs(dv));
        const ds = w.stuck[a] - prevStuck;
        if (ds > 0) rates.push(ds * 30);
      }
      prevStuck = w.stuck[a];
      const touching = ps.some(p => Math.hypot(w.x[a] - w.x[p], w.y[a] - w.y[p]) < w.rad[a] + w.rad[p] + RULES.combat.contactSkin + 1);
      if (touching && !w.engaged[a] && Math.hypot(vx, vy) > 9) {
        spell++;
        gap = 0;
        best = Math.max(best, spell);
      } else if (++gap > 6) spell = 0;
    }
    rates.sort((p, q) => p - q);
    return {
      spellSecs: best / 30, maxDev, stuckRate: rates.length ? rates[rates.length >> 1] : 1, lateralFrames, waited, engagedFrames,
    };
  };

  it('绕的时候面朝敌人，不朝着横挪的方向转身', () => {
    const r = flankAlongWall(5);
    expect(r.lateralFrames).toBeGreaterThan(30);
    // 朝着横挪方向转身的话夹角接近 90 度（约 1.57 rad）
    expect(r.maxDev).toBeLessThan(0.9);
  });

  it('绕的时候「追不上」计时按 flankStuck 的比例走，不是整速', () => {
    const r = flankAlongWall(5);
    expect(r.lateralFrames).toBeGreaterThan(30);
    expect(r.stuckRate).toBeGreaterThan(RULES.combat.flankStuck * 0.5);
    expect(r.stuckRate).toBeLessThan(RULES.combat.flankStuck * 2);
  });

  it('绕不过去就停下排队：单段横挪有上限，不会一直沿着人墙来回绕', () => {
    // 上限给得宽：理论上限 blockedAfter ÷ flankStuck 的两倍再加 1 秒，中途被打断重算也不应超过
    const maxSecs = 2 * RULES.combat.blockedAfter / RULES.combat.flankStuck + 1;
    const r = flankAlongWall(8);
    // 够不着目标：整个过程没有交上手
    expect(r.engagedFrames).toBe(0);
    expect(r.spellSecs).toBeLessThanOrEqual(maxSecs);
    // 横挪一段之后一定进入原地排队
    expect(r.waited).toBe(true);
  });

  it('围攻时非交手单位逐帧反向的比例仍然很低', () => {
    const w = flatWorld(120, 3);
    const a = w.spawnGroup(1, Array(60).fill(idx('legion')), C - 160, C, 1, 0);
    const [e] = w.spawnGroup(2, [idx('legion')], C + 60, C, -1, 0);
    w.hp[e] = w.maxHp[e] = 1e9;
    w.orderStop([e], true);
    w.orderAttackUnit(a, e);
    expect(reversalRatio(w, a, 10)).toBeLessThan(0.04);
  }, 30000);

  /** 贴着人墙，追一个够不着（超出投矛射程）、又近得不用绕远路的目标：返回 a 在 5 秒里偏离中线的最大 y 位移 */
  const sidewaysAtWall = (key: string): number => {
    const w = flatWorld();
    lineWall(w, 31);
    const a = w.spawnUnit(idx(key), 1, C + 18, C);
    const far = w.spawnUnit(idx('legion'), 2, C + 218, C);
    w.hp[far] = w.maxHp[far] = 1e9;
    w.orderStop([far], true);
    w.orderAttackUnit([a], far);
    let maxY = 0;
    for (let t = 0; t < 30 * 5; t++) {
      w.tick();
      w.fxN = 0;
      maxY = Math.max(maxY, Math.abs(w.y[a] - C));
    }
    return maxY;
  };

  it('只有近战绕：远程兵（投矛兵）被自己人堵着去追够不着的目标时不横挪', () => {
    const melee = sidewaysAtWall('legion');
    const ranged = sidewaysAtWall('velites');
    expect(melee).toBeGreaterThan(8);
    expect(ranged).toBeLessThan(melee * 0.5);
  });

  describe('400 对 400 攻击移动对冲', () => {
    /** 300 legion 加 100 sagitt 对冲，双方攻击移动穿过对方；返回 secs 秒后的合计阵亡数 */
    const deaths = (seed: number, secs: number): number => {
      const c2 = (160 * TILE) / 2;
      const w = flatWorld(160, seed);
      const mix = [...Array(300).fill(idx('legion')), ...Array(100).fill(idx('sagitt'))];
      const a = w.spawnGroup(1, mix, c2 - 200, c2, 1, 0);
      const b = w.spawnGroup(2, mix, c2 + 200, c2, -1, 0);
      w.orderMove(a, c2 + 300, c2, true);
      w.orderMove(b, c2 - 300, c2, true);
      run(w, secs);
      return 800 - [...a, ...b].filter(s => w.alive[s]).length;
    };

    it.each([5, 9])('同一种子下，开着绕行比关掉绕行同时交手的人更多、阵亡明显更多（种子 %i）', seed => {
      const on = deaths(seed, 45);
      // flankCos 设为 2：正前方夹角余弦永远到不了，绕行不触发
      const saved = RULES.combat.flankCos;
      let off: number;
      try {
        RULES.combat.flankCos = 2;
        off = deaths(seed, 45);
      } finally {
        RULES.combat.flankCos = saved;
      }
      expect(on, `开 ${on} 关 ${off}`).toBeGreaterThan(off * 1.15);
    }, 60000);
  });
});

describe('单位分离：一帧内的推开量', () => {
  it('几处接触叠加，推开的距离不超过最深那一处的修正量', () => {
    const w = flatWorld();
    const a = w.spawnUnit(idx('legion'), 1, C, C);
    const r = w.rad[a];
    // 三个同类邻居挤在同一侧，各叠进 a 约 4 像素：叠加起来朝同一方向推
    const depth = 4;
    const ns = [-0.35, 0, 0.35].map(ang =>
      w.spawnUnit(idx('legion'), 1, C + Math.cos(ang) * (2 * r - depth), C + Math.sin(ang) * (2 * r - depth)));
    const x0 = w.x[a], y0 = w.y[a];
    let deepest = 0;
    for (const n of ns) deepest = Math.max(deepest, 2 * r - Math.hypot(w.x[n] - x0, w.y[n] - y0));
    w.tick();
    w.fxN = 0;
    const moved = Math.hypot(w.x[a] - x0, w.y[a] - y0);
    // 同类邻居各担一半：a 这一侧的修正量是最深重叠的一半
    expect(moved).toBeGreaterThan(0.1);
    expect(moved).toBeLessThanOrEqual(deepest * 0.5 + 1e-3);
  });
});
