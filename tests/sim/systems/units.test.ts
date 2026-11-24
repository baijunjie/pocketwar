import { describe, expect, it } from 'vitest';
import { FACTIONS, RULES, SITE_CITY, T_MOUNTAIN, TILE, UNIT_BY_KEY } from '../../../src/sim/defs';
import { siteContains } from '../../../src/sim/siteArea';
import { S_COMBAT } from '../../../src/sim/world';
import { NONE, O_IDLE, S_CHARGE, S_ROUT } from '../../../src/sim/state';
import { armyList, createGame } from '../../../src/sim/setup';
import { kill } from '../../../src/sim/systems/combat';
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
/**
 * 小战场：16 个血量近乎无限的 dao 排成 4×4 方阵（间距 22）原地待命，每帧士气锁在 100；
 * 我方 100 个 dao 在西边 300 像素外，order 为 'amove' 时攻击移动到方阵中心，为数字时右键指定攻击方阵里的第几个敌人。
 * 返回每帧 step()（先锁士气再 tick）。
 */
const smallBattle = (seed: number, order: 'amove' | number = 'amove', paint?: (t: Uint8Array, n: number) => void) => {
  const w = flatWorld(120, seed, paint);
  const foes: number[] = [];
  for (let a = 0; a < 4; a++) {
    for (let b = 0; b < 4; b++) foes.push(w.spawnUnit(idx('dao'), 2, C + 300 + 22 * a, C + 22 * (b - 1.5)));
  }
  for (const e of foes) w.hp[e] = w.maxHp[e] = 1e7;
  w.orderStop(foes, true);
  const mine = w.spawnGroup(1, Array(100).fill(idx('dao')), C - 100, C, 1, 0);
  if (order === 'amove') w.orderMove(mine, C + 333, C, true);
  else w.orderAttackUnit(mine, foes[order]);
  const step = (): void => {
    for (const e of foes) w.morale[e] = 100;
    w.tick();
    w.fxN = 0;
  };
  return { w, foes, mine, step };
};

/** 小战场跑 30 秒，第 15–30 秒每 15 帧采样：平均交手人数、平均列队等待人数、深度重叠的己方对占接触对的比例 */
const smallBattleStats = (seed: number): { engaged: number; waiting: number; deepRatio: number } => {
  const { w, mine, step } = smallBattle(seed);
  let eng = 0, wait = 0, samples = 0, deep = 0, pairs = 0;
  for (let t = 1; t <= 30 * 30; t++) {
    step();
    if (t < 15 * 30 || t % 15 !== 0) continue;
    samples++;
    for (const s of mine) {
      if (!w.alive[s]) continue;
      if (w.engaged[s] === 1) eng++;
      if (w.waitT[s] > 0) wait++;
    }
    for (let i = 0; i < mine.length; i++) {
      for (let j = i + 1; j < mine.length; j++) {
        const a = mine[i], b = mine[j];
        const rr = w.rad[a] + w.rad[b];
        const d = Math.hypot(w.x[a] - w.x[b], w.y[a] - w.y[b]);
        if (d < rr * 2) pairs++;
        if (d < rr * 0.6) deep++;
      }
    }
  }
  return { engaged: eng / samples, waiting: wait / samples, deepRatio: pairs ? deep / pairs : 0 };
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

    it.each([5, 9])('同一种子下，近战会往侧面找位置比完全不会，同时交手的人更多、阵亡明显更多（种子 %i）', seed => {
      const on = deaths(seed, 45);
      // 对照组：横挪与绕行都关掉。flankCos 设为 2：正前方夹角余弦永远到不了，横挪不触发；
      // detourMaxCost 设为 0：任何空位的代价都不低于 0，绕行找不到空位、不启动
      const saved = { flankCos: RULES.combat.flankCos, detourMaxCost: RULES.combat.detourMaxCost };
      let off: number;
      try {
        RULES.combat.flankCos = 2;
        RULES.combat.detourMaxCost = 0;
        off = deaths(seed, 45);
      } finally {
        RULES.combat.flankCos = saved.flankCos;
        RULES.combat.detourMaxCost = saved.detourMaxCost;
      }
      expect(on, `开 ${on} 关 ${off}`).toBeGreaterThan(off * 1.15);
    }, 60000);
  });

  describe('近战绕行：追不上时先绕到敌群外缘的空位', () => {
    /** 在 lineWall 的人墙前放一个追击者，追后排正中的敌人；逐帧记下绕行、列队等待、交手的时间点 */
    const chaseBehindWall = (n: number, secs: number, onDetourStart?: (w: World, a: number) => void) => {
      const w = flatWorld();
      const { back } = lineWall(w, n);
      const mid = back[(n - 1) >> 1];
      const a = w.spawnUnit(idx('legion'), 1, C - 60, C + 3);
      w.orderAttackUnit([a], mid);
      const backX = w.x[mid];
      let firstDetour = -1, endDetour = -1, firstWait = -1, firstEngaged = -1, maxXEngaged = -Infinity;
      let waitAtEnd = false, prev = 0;
      for (let t = 0; t < secs * 30; t++) {
        w.tick();
        w.fxN = 0;
        const det = w.detourT[a];
        if (det > 0 && firstDetour < 0) {
          firstDetour = t;
          onDetourStart?.(w, a);
        }
        if (prev > 0 && det <= 0 && endDetour < 0) {
          endDetour = t;
          waitAtEnd = w.waitT[a] > 0;
        }
        prev = det;
        if (w.waitT[a] > 0 && firstWait < 0) firstWait = t;
        if (w.engaged[a]) {
          if (firstEngaged < 0) firstEngaged = t;
          maxXEngaged = Math.max(maxXEngaged, w.x[a]);
        }
      }
      return { firstDetour, endDetour, firstWait, firstEngaged, maxXEngaged, waitAtEnd, backX, rad: w.rad[a] };
    };

    it('追不上先绕行、绕不成才列队等：空位被占着走不到，绕行一次最长 detourFor 秒，到点改为列队等', () => {
      // 17 宽的人墙：绕到后排东面要走很久；起绕那一刻有人站到了空位上
      const r = chaseBehindWall(17, 25, (w, a) => {
        const f = w.target[a];
        w.spawnUnit(idx('legion'), 1, w.x[f] + w.detourX[a], w.y[f] + w.detourY[a]);
      });
      expect(r.firstDetour, '绕过行').toBeGreaterThan(0);
      expect(r.endDetour, '绕行结束了').toBeGreaterThan(r.firstDetour);
      expect(r.firstWait, '绕行之后才列队等').toBeGreaterThan(r.firstDetour);
      expect((r.endDetour - r.firstDetour) / 30).toBeLessThanOrEqual(RULES.combat.detourFor + 0.1);
      expect(r.waitAtEnd, '放弃绕行的这一刻改为列队等').toBe(true);
    });

    it('绕过去的路程超过 速度 × detourFor：不起绕，照旧横挪与列队等', () => {
      // 31 宽的人墙：绕一圈要走的路超过时限内走得到的
      const r = chaseBehindWall(31, 12);
      expect(r.firstDetour, '没有起绕').toBe(-1);
      expect(r.firstWait, '照旧列队等').toBeGreaterThan(0);
      expect(r.firstEngaged, '够不着').toBe(-1);
    });

    it('人墙不宽时绕到敌群的另一侧接上敌', () => {
      const r = chaseBehindWall(11, 25);
      expect(r.firstDetour, '绕过行').toBeGreaterThan(0);
      expect(r.firstEngaged, '交上了手').toBeGreaterThan(r.firstDetour);
      // 交手时人到了敌群后排的东边：不是挤在人墙前
      expect(r.maxXEngaged).toBeGreaterThan(r.backX + r.rad);
    });

    it('起步时正前方贴着正在交手的自己人：不绕，直接列队等', () => {
      const w = flatWorld();
      const probe = w.spawnUnit(idx('legion'), 2, 0, 0);
      const S = 2 * w.rad[probe] + 2;
      w.removeUnit(probe);
      const ex = C + 100, ey = C;
      // 目标 e 与它南北两侧的两个敌人 f1、f2；己方 p、q1、q2 各贴着一个敌人站定交手，追击者 a 被它们围在三面
      const e = w.spawnUnit(idx('legion'), 2, ex, ey);
      const f1 = w.spawnUnit(idx('legion'), 2, ex - 2 * S, ey - 2 * S);
      const f2 = w.spawnUnit(idx('legion'), 2, ex - 2 * S, ey + 2 * S);
      for (const f of [e, f1, f2]) w.hp[f] = w.maxHp[f] = 1e9;
      w.orderStop([e, f1, f2], true);
      w.orderAttackUnit([w.spawnUnit(idx('legion'), 1, ex - S + 1, ey)], e);
      w.orderAttackUnit([w.spawnUnit(idx('legion'), 1, ex - 2 * S, ey - S + 1)], f1);
      w.orderAttackUnit([w.spawnUnit(idx('legion'), 1, ex - 2 * S, ey + S - 1)], f2);
      const a = w.spawnUnit(idx('legion'), 1, ex - 2 * S, ey);
      w.orderAttackUnit([a], e);
      let waited = false, detoured = false, engaged = false;
      for (let t = 0; t < 20 * 30; t++) {
        w.tick();
        w.fxN = 0;
        if (w.waitT[a] > 0) waited = true;
        if (w.detourT[a] > 0) detoured = true;
        if (w.engaged[a]) engaged = true;
      }
      expect(engaged, '被围在里面够不着').toBe(false);
      expect(detoured, '没有起绕').toBe(false);
      expect(waited, '直接列队等').toBe(true);
    });

    const SEEDS = [7, 11, 23];

    it('小战场：后排近战绕到敌群外缘接敌，平均交手的人明显多于原地列队等的人', () => {
      const stats = SEEDS.map(smallBattleStats);
      const eng = stats.reduce((a, r) => a + r.engaged, 0) / stats.length;
      const wait = stats.reduce((a, r) => a + r.waiting, 0) / stats.length;
      // 不绕行时交手的约占 100 人的四分之一、列队等的过半；门槛要求明显好于此，并留了余量
      expect(eng, `平均交手 ${eng}`).toBeGreaterThan(33);
      expect(wait, `平均列队等 ${wait}`).toBeLessThan(45);
    }, 60000);

    it('小战场：绕行的人不叠成一坨，深度重叠的己方对占接触对的比例仍然很低', () => {
      for (const seed of SEEDS.slice(0, 2)) {
        expect(smallBattleStats(seed).deepRatio, `种子 ${seed}`).toBeLessThan(0.04);
      }
    }, 60000);

    it('绕行连续走不动超过 detourStallAfter 秒的不存在（早早放弃），一次绕行也不超过 detourFor 秒', () => {
      const spd = UNIT_BY_KEY.dao.speed;
      let detourFrames = 0, maxStill = 0, maxRun = 0;
      for (const seed of SEEDS.slice(0, 2)) {
        const { w, mine, step } = smallBattle(seed);
        const still = new Map<number, number>(), run = new Map<number, number>();
        for (let t = 0; t < 30 * 30; t++) {
          const x0 = mine.map(q => w.x[q]), y0 = mine.map(q => w.y[q]);
          step();
          mine.forEach((q, k) => {
            if (!w.alive[q] || w.detourT[q] <= 0) {
              still.delete(q);
              run.delete(q);
              return;
            }
            detourFrames++;
            // 位移不到满速的一成算原地没动（门槛 detourStall 的比例更高，这里只抓明显卡住的）
            const moved = Math.hypot(w.x[q] - x0[k], w.y[q] - y0[k]);
            const st = moved < (0.1 * spd) / 30 ? (still.get(q) ?? 0) + 1 : 0;
            still.set(q, st);
            maxStill = Math.max(maxStill, st);
            const r = (run.get(q) ?? 0) + 1;
            run.set(q, r);
            maxRun = Math.max(maxRun, r);
          });
        }
      }
      expect(detourFrames, '确实有人在绕').toBeGreaterThan(100);
      expect(maxStill / 30).toBeLessThanOrEqual(RULES.combat.detourStallAfter + 0.2);
      expect(maxRun / 30).toBeLessThanOrEqual(RULES.combat.detourFor + 0.1);
    }, 60000);

    describe.each([
      ['敌群两侧都是山', 2],
      ['敌群只有北侧是山', 1],
    ])('%s', (_name, sides) => {
      it('绕行的人任何一帧都不落在不可通行格里，绕不过去的在原地列队等', () => {
        // 山带从敌群前方 100 像素处起，沿敌群两侧（或只北侧）铺到敌群后面；通道宽 112 像素
        const paint = (t: Uint8Array, n: number): void => {
          const x0 = Math.floor((C + 200) / TILE), x1 = Math.floor((C + 460) / TILE);
          const north = Math.floor((C - 56) / TILE), south = Math.floor((C + 56) / TILE);
          for (let ty = 0; ty < n; ty++) {
            if (!(ty < north || (sides === 2 && ty > south))) continue;
            for (let tx = x0; tx <= x1; tx++) t[ty * n + tx] = T_MOUNTAIN;
          }
        };
        const { w, mine, step } = smallBattle(7, 'amove', paint);
        let onBlocked = 0, detoured = 0, waited = false, engaged = 0, samples = 0;
        for (let t = 1; t <= 30 * 30; t++) {
          step();
          for (const q of mine) {
            if (!w.alive[q]) continue;
            if (w.map.terrain[((w.y[q] / TILE) | 0) * 120 + ((w.x[q] / TILE) | 0)] === T_MOUNTAIN) onBlocked++;
            if (w.detourT[q] > 0) detoured++;
            if (w.waitT[q] > 0) waited = true;
          }
          if (t >= 15 * 30 && t % 15 === 0) {
            samples++;
            engaged += mine.filter(q => w.alive[q] && w.engaged[q]).length;
          }
        }
        expect(onBlocked).toBe(0);
        expect(detoured, '仍会绕行').toBeGreaterThan(0);
        expect(waited, '绕不过去的列队等').toBe(true);
        // 地形没有把仗打停：照样有人交手
        expect(engaged / samples).toBeGreaterThan(20);
      }, 60000);
    });

    it.each([0, 15])('右键指定攻击某个敌兵：绕行的人目标始终是它（方阵里第 %i 个）', X => {
      const { w, foes, mine, step } = smallBattle(7, X);
      let detoured = 0;
      for (let t = 0; t < 30 * 30; t++) {
        step();
        for (const q of mine) {
          if (!w.alive[q] || w.detourT[q] <= 0) continue;
          detoured++;
          expect(w.target[q], `第 ${t} 帧 ${q}`).toBe(foes[X]);
        }
      }
      expect(detoured, '确实有人在绕').toBeGreaterThan(0);
    }, 60000);

    it('绕行期间不重新挑目标：目标只会随空位被占后重找空位而换，不会改回离得最近的敌人', () => {
      for (const seed of SEEDS) {
        const { w, mine, step } = smallBattle(seed);
        // 记每个人上一帧的目标与空位的绝对坐标（空位按相对所属敌兵的偏移存，要加上敌兵的位置）
        const last = new Map<number, [number, number, number]>();
        let detoured = 0, swapped = 0;
        for (let t = 0; t < 30 * 30; t++) {
          step();
          for (const q of mine) {
            if (!w.alive[q] || w.detourT[q] <= 0) {
              last.delete(q);
              continue;
            }
            detoured++;
            const f = w.target[q];
            const sx = w.x[f] + w.detourX[q], sy = w.y[f] + w.detourY[q];
            const prev = last.get(q);
            if (prev && prev[0] !== f) {
              swapped++;
              // 换目标的同一帧空位也换到了别处（空位被占了重找）；空位没动就换目标，是被拉回了最近的敌人
              expect(Math.hypot(prev[1] - sx, prev[2] - sy), `种子 ${seed} 第 ${t} 帧 ${q}`).toBeGreaterThan(3);
            }
            last.set(q, [f, sx, sy]);
          }
        }
        expect(detoured, '确实有人在绕').toBeGreaterThan(1000);
        // 换目标是少数：绕行的帧里不到 1%
        expect(swapped / detoured).toBeLessThan(0.01);
      }
    }, 60000);

    describe.each([
      ['目标溃逃', (w: World, tgt: number) => { w.state[tgt] |= S_ROUT; }],
      ['目标死亡', (w: World, tgt: number, by: number) => { kill(w, tgt, w.team[by], by); }],
    ])('%s', (_name, hit) => {
      it('正在绕的人当即结束绕行', () => {
        const { w, mine, step } = smallBattle(7);
        let q: number | undefined;
        for (let t = 0; t < 30 * 20 && q === undefined; t++) {
          step();
          if (t > 120) q = mine.find(s => w.alive[s] && w.detourT[s] > 0 && !w.engaged[s] && w.target[s] !== NONE);
        }
        expect(q, '找到一个在绕的人').toBeDefined();
        const s = q as number;
        hit(w, w.target[s], s);
        step();
        expect(w.detourT[s]).toBe(0);
      });
    });

    /** 11 宽人墙 + 追击者 a（右键指定攻击后排正中的敌人）；跑到 a 起绕为止，返回此时的世界 */
    const detouringAtWall = (): { w: World; a: number; rr: number } => {
      const w = flatWorld();
      const { back } = lineWall(w, 11);
      const a = w.spawnUnit(idx('legion'), 1, C - 60, C + 3);
      w.orderAttackUnit([a], back[5]);
      for (let t = 0; t < 20 * 30 && w.detourT[a] <= 0; t++) {
        w.tick();
        w.fxN = 0;
      }
      expect(w.detourT[a], '起绕了').toBeGreaterThan(0);
      return { w, a, rr: w.rad[a] };
    };

    /**
     * 绕行者去路上横着摆一排 5 个己方单位（前进方向前方 4 个身位）：步兵在原地待命，骑兵各贴着一个敌人在交手。
     * 返回绕行者第一次越过这排（沿前进方向越过它们所在的线）时偏离这排中心的距离（身位），以及绕行期间离这排最近的距离占半径和的比例。
     */
    const crossRow = (kind: 'inf' | 'cav'): { crossLat: number | null; minRatio: number } => {
      const { w, a, rr } = detouringAtWall();
      let px = w.x[a], py = w.y[a];
      for (let k = 0; k < 10; k++) {
        px = w.x[a];
        py = w.y[a];
        w.tick();
        w.fxN = 0;
      }
      const vx = w.x[a] - px, vy = w.y[a] - py, l = Math.hypot(vx, vy) || 1;
      const hx = vx / l, hy = vy / l;
      const ox = w.x[a] + hx * 4 * rr, oy = w.y[a] + hy * 4 * rr;
      const row: number[] = [];
      for (let k = -2; k <= 2; k++) {
        const qx = ox - hy * k * 2 * rr * 0.95, qy = oy + hx * k * 2 * rr * 0.95;
        if (kind === 'inf') {
          const q = w.spawnUnit(idx('legion'), 1, qx, qy);
          w.orderStop([q], true);
          row.push(q);
        } else {
          // 骑兵西边（远离人墙一侧）贴着一个站着不动的敌人，交手时脚下可以动，但不是站定
          const f = w.spawnUnit(idx('legion'), 2, qx - 2.2 * rr, qy);
          w.hp[f] = w.maxHp[f] = 1e9;
          w.orderStop([f], true);
          const q = w.spawnUnit(idx('equites'), 1, qx, qy);
          w.orderAttackUnit([q], f);
          row.push(q);
        }
      }
      let crossLat: number | null = null, minRatio = Infinity;
      for (let t = 0; t < 12 * 30; t++) {
        w.tick();
        w.fxN = 0;
        if (w.detourT[a] <= 0) continue;
        const along = (w.x[a] - ox) * hx + (w.y[a] - oy) * hy;
        if (crossLat === null && along > 0) crossLat = Math.abs(-(w.x[a] - ox) * hy + (w.y[a] - oy) * hx) / rr;
        for (const q of row) minRatio = Math.min(minRatio, Math.hypot(w.x[a] - w.x[q], w.y[a] - w.y[q]) / (w.rad[a] + w.rad[q]));
      }
      return { crossLat, minRatio };
    };

    it('绕行的人从待命的己方步兵中间穿过去', () => {
      const r = crossRow('inf');
      // 越线的位置在这排的中间（排宽约 ±4 个身位），不是绕到排的尽头；中途挨得比半径和还近
      expect(r.crossLat, '穿过了这排').not.toBeNull();
      expect(r.crossLat as number).toBeLessThan(2);
      expect(r.minRatio).toBeLessThan(0.9);
    });

    it('绕行的人不穿过正在交手的己方骑兵：绕行期间越不过这排，也不深度重叠', () => {
      const r = crossRow('cav');
      expect(r.crossLat, '绕行期间没越过这排').toBeNull();
      expect(r.minRatio).toBeGreaterThan(0.6);
    });

    it.each([[60, 0], [0, 40]])('空位跟着所属敌兵走：绕行途中敌兵挪了 (%i, ±%i)（纵向朝空位所在的一侧挪），落点贴着它的新位置', (dx, dy) => {
      const { w, a } = detouringAtWall();
      const f = w.target[a];
      const oldX = w.x[f] + w.detourX[a], oldY = w.y[f] + w.detourY[a];
      // 战线上下对称，绕行者往哪一侧绕取决于细微的差别；纵向挪动朝空位所在的一侧，空位才不会被挪到敌兵的另一面
      w.x[f] += dx;
      w.y[f] += dy * (Math.sign(w.detourY[a]) || 1);
      w.px[f] = w.homeX[f] = w.x[f];
      w.py[f] = w.homeY[f] = w.y[f];
      let end = -1;
      for (let t = 0; t < 12 * 30 && end < 0; t++) {
        w.tick();
        w.fxN = 0;
        if (w.detourT[a] <= 0) end = t;
      }
      expect(end, '绕行结束了').toBeGreaterThan(0);
      expect(w.waitT[a], '到位结束，不是放弃').toBe(0);
      // 结束时贴着敌兵的新位置，离旧空位很远
      const sum = w.rad[a] + w.rad[f];
      expect(Math.hypot(w.x[a] - w.x[f], w.y[a] - w.y[f])).toBeLessThan(sum + 2 * RULES.combat.detourNear);
      expect(Math.hypot(w.x[a] - oldX, w.y[a] - oldY)).toBeGreaterThan(30);
      expect(w.target[a]).toBe(f);
    });

    it('冲锋中不起绕：冲锋被自己人挡住时不绕，冲锋过后才绕', () => {
      const saved = RULES.combat.blockedAfter;
      try {
        // 把「追不上」的计时调短，冲锋途中被堵住时一定会到点
        RULES.combat.blockedAfter = 0.15;
        const w = flatWorld();
        const { back } = lineWall(w, 11);
        const a = w.spawnUnit(idx('equites'), 1, C - 260, C + 3);
        w.orderAttackUnit([a], back[5]);
        let charging = 0, detourInCharge = 0, firstDetour = -1, lastCharge = -1;
        for (let t = 0; t < 25 * 30; t++) {
          w.tick();
          w.fxN = 0;
          const ch = (w.state[a] & S_CHARGE) !== 0;
          if (ch) {
            charging++;
            lastCharge = t;
          }
          if (w.detourT[a] > 0) {
            if (firstDetour < 0) firstDetour = t;
            if (ch) detourInCharge++;
          }
        }
        expect(charging, '冲锋了一阵').toBeGreaterThan(60);
        expect(detourInCharge).toBe(0);
        expect(firstDetour, '冲锋结束后绕行').toBeGreaterThan(lastCharge - 1);
      } finally {
        RULES.combat.blockedAfter = saved;
      }
    });

    it('待命的单位绕行时，空位只属于离岗位在追击范围内的敌兵', () => {
      // 敌方方阵每列隔 70 像素，后几列离待命部队的岗位已超出追击范围
      const w = flatWorld(120, 7);
      const foes: number[] = [];
      for (let a = 0; a < 4; a++) {
        for (let b = 0; b < 4; b++) foes.push(w.spawnUnit(idx('dao'), 2, C + 40 + 70 * a, C + 22 * (b - 1.5)));
      }
      for (const e of foes) w.hp[e] = w.maxHp[e] = 1e7;
      w.orderStop(foes, true);
      const mine = w.spawnGroup(1, Array(100).fill(idx('dao')), C - 100, C, 1, 0);
      w.orderStop(mine, false);
      // 追击范围：敌人离岗位多远以内才追（待命单位不被引得离岗太远）
      const lim = RULES.combat.leash * Math.sqrt(1.2);
      let detoured = 0, beyond = 0;
      for (let t = 0; t < 30 * 30; t++) {
        for (const e of foes) w.morale[e] = 100;
        w.tick();
        w.fxN = 0;
        for (const q of mine) {
          if (!w.alive[q] || w.order[q] !== O_IDLE || w.detourT[q] <= 0) continue;
          detoured++;
          const f = w.target[q];
          if (Math.hypot(w.homeX[q] - w.x[f], w.homeY[q] - w.y[f]) > lim + 1) beyond++;
        }
      }
      expect(detoured, '确实有人在绕').toBeGreaterThan(500);
      expect(beyond).toBe(0);
    }, 60000);

    it('据点里待命的近战守军起绕：目标始终是据点内的敌兵（或最近打过自己的人），不绕去据点外', () => {
      const w = createGame({
        seed: 5, factions: ['china', 'japan'], armySize: 60, difficulty: 1, fog: false, spectate: false, environment: false, supply: false,
      }).world;
      for (let i = 0; i < w.n; i++) if (w.alive[i]) w.removeUnit(i);
      // 己方开局城池；它的范围是围墙矩形，往东找到范围的边缘
      const hq = w.sites.find(s => s.type === SITE_CITY && s.owner === 1)!;
      let R = 0;
      while (siteContains(hq, hq.x + R + 1, hq.y)) R++;
      const inSite = (q: number): boolean => siteContains(hq, w.x[q], w.y[q]);
      // 敌方 5×4 方阵跨在据点边缘上：前几列在据点内，最后一列在据点外；守军从据点内往边缘列阵待命
      const foes: number[] = [];
      for (let a = 0; a < 5; a++) {
        for (let b = 0; b < 4; b++) foes.push(w.spawnUnit(idx('dao'), 2, hq.x + R - 80 + 22 * a, hq.y + 22 * (b - 1.5)));
      }
      for (const e of foes) w.hp[e] = w.maxHp[e] = 1e7;
      w.orderStop(foes, true);
      const outside = foes.filter(e => !inSite(e));
      expect(outside.length, '有敌兵在据点外').toBeGreaterThan(0);
      expect(outside.length, '也有敌兵在据点内').toBeLessThan(foes.length);
      const mine = w.spawnGroup(1, Array(150).fill(idx('dao')), hq.x + R - 240, hq.y, 1, 0);
      w.orderStop(mine, false);
      let detoured = 0, bad = 0;
      for (let t = 0; t < 30 * 30; t++) {
        for (const e of foes) w.morale[e] = 100;
        w.tick();
        w.fxN = 0;
        for (const q of mine) {
          if (!w.alive[q] || w.order[q] !== O_IDLE || w.sheltered[q] !== 1 || w.detourT[q] <= 0) continue;
          detoured++;
          const f = w.target[q];
          if (!inSite(f) && f !== w.hitBy[q * 2] && f !== w.hitBy[q * 2 + 1]) bad++;
        }
      }
      expect(detoured, '确实有人在绕').toBeGreaterThan(1000);
      expect(bad).toBe(0);
    }, 60000);

    /**
     * 大战场：平地，中国 600 人编制里的近战（337 人）攻击移动到 34 个日本近战兵（血量 ×15、士气锁 100、原地待命）身上。
     * 返回第 10–40 秒里「交手人数 ÷ 敌兵贴身位总数」的平均（每个敌兵按 6 个贴身位算：同半径的圆最多贴 6 个），
     * 以及第 10 秒起深度重叠的己方近战对占接触对的比例。
     */
    const bigBattle = (seed: number): { slotUse: number; deepRatio: number; mine: number } => {
      const n = 160, c2 = (n * TILE) / 2;
      const w = flatWorld(n, seed);
      const melee = (list: number[]): number[] => list.filter(k => w.defs[k].range === 0);
      // 兵力按份数计：970 份时中国的近战兵数与按人头计时每方 600 人相当（约 330 人）
      const mineList = melee(armyList(FACTIONS.china, 970));
      const foeList = melee(armyList(FACTIONS.japan, 970)).slice(0, 34);
      const foes = w.spawnGroup(2, foeList, c2 + 250, c2, -1, 0);
      for (const e of foes) w.hp[e] = w.maxHp[e] *= 15;
      w.orderStop(foes, true);
      const mine = w.spawnGroup(1, mineList, c2 - 300, c2, 1, 0);
      const tx = foes.reduce((a, e) => a + w.x[e], 0) / foes.length;
      const ty = foes.reduce((a, e) => a + w.y[e], 0) / foes.length;
      w.orderMove(mine, tx, ty, true);
      let use = 0, uses = 0, deep = 0, pairs = 0;
      for (let t = 1; t <= 40 * 30; t++) {
        for (const e of foes) w.morale[e] = 100;
        w.tick();
        w.fxN = 0;
        const left = foes.filter(e => w.alive[e]).length;
        if (left * 2 < foes.length) break;
        if (t % 15 === 0 && t >= 10 * 30) {
          const eng = mine.filter(q => w.alive[q] && w.engaged[q]).length;
          use += eng / (left * 6);
          uses++;
        }
        if (t % 60 === 0 && t >= 10 * 30) {
          const am = mine.filter(q => w.alive[q]);
          for (let i = 0; i < am.length; i++) {
            for (let j = i + 1; j < am.length; j++) {
              const rr = w.rad[am[i]] + w.rad[am[j]];
              const d = Math.hypot(w.x[am[i]] - w.x[am[j]], w.y[am[i]] - w.y[am[j]]);
              if (d < rr * 2) pairs++;
              if (d < rr * 0.6) deep++;
            }
          }
        }
      }
      return { slotUse: uses ? use / uses : 0, deepRatio: pairs ? deep / pairs : 0, mine: mine.length };
    };

    it('大战场：贴身位被用上的比例明显高于不绕行时，且己方不叠成一坨', () => {
      const on = bigBattle(7);
      let off: ReturnType<typeof bigBattle>;
      const saved = RULES.combat.detourMaxCost;
      try {
        // 绕行的代价上限设为 0：找不到空位，绕行不启动，退回只横挪与列队等
        RULES.combat.detourMaxCost = 0;
        off = bigBattle(7);
      } finally {
        RULES.combat.detourMaxCost = saved;
      }
      expect(on.mine).toBeGreaterThan(300);
      // 开 / 关之比随兵种数值与寻敌的克制偏好而变：这组兵种下 4 个种子（3、7、11、19）实测 1.36–1.48
      expect(on.slotUse, `开 ${on.slotUse} 关 ${off.slotUse}`).toBeGreaterThan(off.slotUse * 1.3);
      expect(on.deepRatio).toBeLessThan(0.04);
    }, 120000);
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
