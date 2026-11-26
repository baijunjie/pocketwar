import { describe, expect, it } from 'vitest';
import { BUILDINGS, P_TORCH, RULES, SITE_CAMP, SITE_CITY, STEP, T_MOUNTAIN, TILE, TRAITS, UNIT_BY_KEY } from '../../../src/sim/defs';
import { fightState, siteContains } from '../../../src/sim/siteArea';
import { S_COMBAT } from '../../../src/sim/world';
import { BLD_SKIP_ALL, ENG_CLOSE, ENG_NONE, ENG_REACH, NONE, O_AMOVE, O_ATTACK, O_IDLE, O_MOVE, S_CHARGE, S_ROUT, S_SHIELD, S_WALL } from '../../../src/sim/state';
import { createGame } from '../../../src/sim/setup';
import { WAY_AROUND, WAY_DIRECT, WAY_NONE } from '../../../src/sim/systems/around';
import { tryDetour } from '../../../src/sim/systems/detour';
import { damageUnit, kill } from '../../../src/sim/systems/combat';
import { canAttackBuilding } from '../../../src/sim/systems/targeting';
import type { Site, World } from '../../../src/sim/world';
import { BASE, variant } from '../../../tools/measure/units';
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

describe('单位分离：正在走的近战从射击中的己方远程身上穿过去', () => {
  /** 己方 120 个弓箭手列在中心朝 +x，敌方 120 个步兵在 +330 处不动、血量无限；先跑 2 秒让弓手开始射击 */
  const archerLine = (): { w: World; archers: number[]; foes: number[] } => {
    const w = flatWorld(200, 7);
    const c = (200 * TILE) / 2;
    const archers = w.spawnGroup(1, Array(120).fill(idx('sagitt')), c, c, 1, 0);
    const foes = w.spawnGroup(2, Array(120).fill(idx('yari')), c + 330, c, -1, 0);
    for (const f of foes) w.hp[f] = w.maxHp[f] = 1e9;
    w.orderStop(foes, true);
    run(w, 2);
    return { w, archers, foes };
  };

  it('射击中的弓手堆里放近战攻击移动：近战走得出去、接上敌，弓手照射不误、位置不动', () => {
    const { w, archers, foes } = archerLine();
    expect(archers.filter(s => w.engaged[s] === 1).length, '前排弓手已在射击').toBeGreaterThan(30);
    const shooters = archers.filter(s => w.engaged[s] === 1);
    const home = shooters.map(s => [w.x[s], w.y[s]]);
    // 近战放在弓手堆中间：取一些弓手的位置，错开几个像素叠上去
    const legions = shooters.filter((_, k) => k % 4 === 1).map(s => w.spawnUnit(idx('legion'), 1, w.x[s] + 3, w.y[s] + 2));
    expect(legions.length).toBeGreaterThanOrEqual(8);
    const start = legions.map(s => [w.x[s], w.y[s]]);
    const tx = w.x[foes[0]], ty = w.y[foes[0]];
    w.orderMove(legions, tx, ty, true);
    run(w, 5);
    legions.forEach((s, k) => {
      expect(Math.hypot(w.x[s] - start[k][0], w.y[s] - start[k][1]), `近战 ${k} 5 秒内走出去了`).toBeGreaterThan(40);
    });
    run(w, 5);
    const engaged = legions.filter(s => w.alive[s] && w.engaged[s] === 1).length;
    expect(engaged, `10 秒时接敌的近战 ${engaged}/${legions.length}`).toBeGreaterThanOrEqual(Math.ceil(legions.length * 0.6));
    // 被穿过的弓手没被挤动，还在射
    let drift = 0, stillShooting = 0;
    shooters.forEach((s, k) => {
      drift = Math.max(drift, Math.hypot(w.x[s] - home[k][0], w.y[s] - home[k][1]));
      if (w.engaged[s] === 1) stillShooting++;
    });
    expect(drift, '弓手被挤动的最大距离').toBeLessThan(10);
    expect(stillShooting, '弓手仍在射击').toBeGreaterThanOrEqual(Math.floor(shooters.length * 0.9));
  }, 60000);

  it('近战从弓手线后面攻击移动上来：越过弓手线', () => {
    const { w, archers } = archerLine();
    const lineX = archers.map(s => w.x[s]);
    const front = Math.max(...lineX);
    const legions = w.spawnGroup(1, Array(40).fill(idx('legion')), Math.min(...lineX) - 90, w.y[archers[0]], 1, 0);
    const foeX = w.x[archers[0]] + 330;
    w.orderMove(legions, foeX, w.y[archers[0]], true);
    run(w, 10);
    const beyond = legions.filter(s => w.alive[s] && w.x[s] > front).length;
    expect(beyond, `越过弓手线的近战 ${beyond}/40`).toBeGreaterThanOrEqual(34);
  }, 60000);

  /**
   * 一个站定的己方单位 blocker 在 (C, C)，一个己方单位 walker 从西边 100 处沿 x 轴走向东边 150 处，
   * 敌兵（血量无限、不动）摆在 blocker 射程内且不在路上。blocker 为 'sagitt' 时它在射击；为 'legion' 时敌兵贴着它让它站定交手。
   */
  const walkThrough = (blockerKey: string, walkerKey: string, amove = false) => {
    const w = flatWorld();
    const blocker = w.spawnUnit(idx(blockerKey), 1, C, C);
    w.hp[blocker] = w.maxHp[blocker] = 1e9;
    // 攻击移动的人会去打看得见的敌兵：敌兵放在路线终点附近，路上正好穿过 blocker；普通移动时放在路旁
    const foe = amove ? w.spawnUnit(idx('yari'), 2, C + 200, C)
      : w.spawnUnit(idx('yari'), 2, C, C + (blockerKey === 'legion' ? w.rad[blocker] * 2 : 60));
    w.hp[foe] = w.maxHp[foe] = 1e9;
    w.orderStop([foe], true);
    run(w, 1.5);
    expect(w.engaged[blocker], 'blocker 已在交手').toBe(1);
    // 走路的人在 blocker 已站定之后才出现，直接下走路命令
    const walker = w.spawnUnit(idx(walkerKey), 1, C - 100, C);
    w.orderMove([walker], amove ? C + 200 : C + 150, C, amove);
    let minDist = Infinity, maxShift = 0, maxX = -Infinity;
    for (let t = 0; t < 30 * 10; t++) {
      w.tick();
      w.fxN = 0;
      maxX = Math.max(maxX, w.x[walker]);
      minDist = Math.min(minDist, Math.hypot(w.x[walker] - w.x[blocker], w.y[walker] - w.y[blocker]));
      maxShift = Math.max(maxShift, Math.hypot(w.x[blocker] - C, w.y[blocker] - C));
    }
    return { w, walker, blocker, minDist, maxShift, maxX, sum: w.rad[walker] + w.rad[blocker] };
  };

  it('近战走路（普通移动）撞上射击中的弓手：穿了过去，弓手仍在射击', () => {
    const r = walkThrough('sagitt', 'legion');
    expect(r.minDist, '圆心靠得比半径和近得多').toBeLessThan(r.sum * 0.5);
    expect(r.maxX, '走到了弓手东边').toBeGreaterThan(C + 100);
    expect(r.w.engaged[r.blocker]).toBe(1);
  });

  it('近战攻击移动撞上射击中的弓手：同样穿过去', () => {
    const r = walkThrough('sagitt', 'legion', true);
    expect(r.minDist).toBeLessThan(r.sum * 0.5);
    expect(r.maxX, '走到了弓手东边').toBeGreaterThan(C + 100);
  });

  it('战象（近战）同样穿过射击中的弓手', () => {
    const r = walkThrough('sagitt', 'elephant');
    expect(r.minDist, '圆心靠得比半径和近得多').toBeLessThan(r.sum * 0.5);
  });

  it.each(['legion', 'elephant'])('被 %s 穿过的射击中的弓手位置不动', walkerKey => {
    const r = walkThrough('sagitt', walkerKey);
    expect(r.maxShift, '弓手被挤动的最大距离').toBeLessThan(3);
    expect(r.w.engaged[r.blocker]).toBe(1);
  });

  it('远程走路撞上射击中的弓手：不穿过，被挡在外面、不叠在一起', () => {
    const r = walkThrough('sagitt', 'sagitt');
    expect(r.minDist).toBeGreaterThan(r.sum * 0.8);
  });

  it('近战走路撞上正在交手站定的近战：不穿过', () => {
    const r = walkThrough('legion', 'legion');
    expect(r.minDist).toBeGreaterThan(r.sum * 0.8);
  });

  it('交手中的近战骑兵叠在射击中的弓手身上：照常被推开，不一直叠着', () => {
    const w = flatWorld();
    const archer = w.spawnUnit(idx('sagitt'), 1, C, C);
    w.hp[archer] = w.maxHp[archer] = 1e9;
    // 骑兵与北侧贴着的敌兵先在弓手东边 30 处站着交手，弓手也已在射击
    const foe = w.spawnUnit(idx('yari'), 2, C + 30, C - 17);
    w.hp[foe] = w.maxHp[foe] = 1e9;
    w.orderStop([foe], true);
    const horse = w.spawnUnit(idx('equites'), 1, C + 30, C);
    w.hp[horse] = w.maxHp[horse] = 1e9;
    run(w, 2);
    expect(w.engaged[archer], '弓手在射击').toBe(1);
    expect(w.engaged[horse], '骑兵在交手').toBe(1);
    // 骑兵连同敌兵一起平移到与弓手半叠着的位置（叠得不深：站定的人本来不会被这点重叠推动）
    for (const [s, dx] of [[horse, -22], [foe, -22]]) {
      w.x[s] += dx;
      w.px[s] += dx;
      w.homeX[s] += dx;
      w.vx[s] = w.vy[s] = 0;
    }
    const gap = (): number => Math.hypot(w.x[horse] - w.x[archer], w.y[horse] - w.y[archer]);
    const sum = w.rad[horse] + w.rad[archer];
    expect(gap(), '起点确实叠着').toBeLessThan(sum * 0.7);
    run(w, 4);
    expect(w.engaged[horse], '骑兵仍在交手').toBe(1);
    expect(gap()).toBeGreaterThan(sum * 0.9);
  });

  describe('待命、坚守的近战原位压在射击中的弓手身上', () => {
    /** 己方弓手在中心射击（敌兵 30 个在东边 200 处不动），再在弓手旁放一个下了坚守命令的近战（只下待命的话它会去追看得见的敌兵，有了目标就不在本条范围内），原位就在弓手身上 */
    const standOnArcher = (dx = 2) => {
      const w = flatWorld();
      const archer = w.spawnUnit(idx('sagitt'), 1, C, C);
      const foes = w.spawnGroup(2, Array(30).fill(idx('yari')), C + 200, C, -1, 0);
      for (const f of foes) w.hp[f] = w.maxHp[f] = 1e9;
      w.orderStop(foes, true);
      run(w, 2);
      expect(w.engaged[archer], '弓手在射击').toBe(1);
      const m = w.spawnUnit(idx('legion'), 1, C + dx, C);
      w.orderStop([m], true);
      return { w, archer, m };
    };

    it('坚守命令：被推到不重叠后就地站住，原位跟过去，不再来回走', () => {
      const { w, archer, m } = standOnArcher();
      run(w, 2);
      const sum = w.rad[m] + w.rad[archer];
      const ax = w.x[archer], ay = w.y[archer];
      const gap = (): number => Math.hypot(w.x[m] - w.x[archer], w.y[m] - w.y[archer]);
      expect(gap(), '不重叠了').toBeGreaterThanOrEqual(sum * 0.95);
      let path = 0, minGap = Infinity;
      for (let t = 0; t < 3 * 30; t++) {
        const x0 = w.x[m], y0 = w.y[m];
        w.tick();
        w.fxN = 0;
        path += Math.hypot(w.x[m] - x0, w.y[m] - y0);
        minGap = Math.min(minGap, gap());
      }
      expect(path, '这 3 秒近战没有白走').toBeLessThan(2);
      expect(minGap, '没有再穿进弓手').toBeGreaterThanOrEqual(sum * 0.95);
      expect(Math.hypot(w.homeX[m] - w.x[m], w.homeY[m] - w.y[m]), '原位跟到了站住的地方').toBeLessThan(2);
      expect(Math.hypot(w.x[archer] - ax, w.y[archer] - ay), '弓手没动').toBeLessThan(0.5);
      expect(w.engaged[archer], '弓手仍在射击').toBe(1);
      expect(w.engaged[m], '近战没在交手').toBe(0);
    });

    it('近战原位与弓手恰好同一点：同样分开后站住', () => {
      const { w, archer, m } = standOnArcher(0);
      run(w, 3);
      const sum = w.rad[m] + w.rad[archer];
      expect(Math.hypot(w.x[m] - w.x[archer], w.y[m] - w.y[archer])).toBeGreaterThanOrEqual(sum * 0.95);
      const p = [w.x[m], w.y[m]];
      run(w, 2);
      expect(Math.hypot(w.x[m] - p[0], w.y[m] - p[1]), '站住了').toBeLessThan(2);
    });
  });

  describe('绕行起步（tryDetour）：正前方贴着的自己人', () => {
    /**
     * 目标 e 与它南北两侧的两个敌人 f1、f2；己方 p、q1、q2（key 指定兵种）各贴着一个敌人站定交手，
     * 追击者 a 在它们围成的三面里朝 e 去。返回 a 与世界。
     */
    const surrounded = (key: string) => {
      const w = flatWorld();
      const probe = w.spawnUnit(idx('legion'), 2, 0, 0);
      const S = 2 * w.rad[probe] + 2;
      w.removeUnit(probe);
      const ex = C + 100, ey = C;
      const e = w.spawnUnit(idx('legion'), 2, ex, ey);
      const f1 = w.spawnUnit(idx('legion'), 2, ex - 2 * S, ey - 2 * S);
      const f2 = w.spawnUnit(idx('legion'), 2, ex - 2 * S, ey + 2 * S);
      for (const f of [e, f1, f2]) w.hp[f] = w.maxHp[f] = 1e9;
      w.orderStop([e, f1, f2], true);
      const guards = [
        w.spawnUnit(idx(key), 1, ex - S + 1, ey),
        w.spawnUnit(idx(key), 1, ex - 2 * S, ey - S + 1),
        w.spawnUnit(idx(key), 1, ex - 2 * S, ey + S - 1),
      ];
      w.orderAttackUnit([guards[0]], e);
      w.orderAttackUnit([guards[1]], f1);
      w.orderAttackUnit([guards[2]], f2);
      // a 贴着正前方的 p（圆心距略小于半径和加 contactSkin），起绕方向（偏东北）与正东的夹角在 flankCos 之内
      const a = w.spawnUnit(idx('legion'), 1, ex - S + 1 - 12.5, ey);
      w.orderAttackUnit([a], e);
      for (let t = 0; t < 2; t++) {
        w.tick();
        w.fxN = 0;
      }
      return { w, a, guards, e };
    };

    it('贴着的是射击中的己方远程：不算堵着，起绕成功', () => {
      const { w, a, guards, e } = surrounded('sagitt');
      expect(guards.every(g => w.engaged[g] === 1 && w.planted[g] === 1), '三个弓手都在站定射击').toBe(true);
      expect(tryDetour(w, a, e, w.state[a], w.order[a], w.defs[idx('legion')].speed, 0)).toBe(true);
      expect(w.detourT[a]).toBeGreaterThan(0);
    });

    it('贴着的是正在交手站定的己方近战：仍然放弃绕行', () => {
      const { w, a, guards, e } = surrounded('legion');
      expect(guards.every(g => w.engaged[g] === 1 && w.planted[g] === 1), '三个近战都在站定交手').toBe(true);
      expect(tryDetour(w, a, e, w.state[a], w.order[a], w.defs[idx('legion')].speed, 0)).toBe(false);
      expect(w.detourT[a]).toBe(0);
    });
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

  it('横挪途中正前方空出来：钻进去接敌，「追不上」计时随之清零，不会被残留的计时判成追不上去列队等', () => {
    const w = flatWorld();
    const { ps, back } = lineWall(w, 31);
    const a = w.spawnUnit(idx('legion'), 1, C - 60, C + 3);
    w.orderAttackUnit([a], back[15]);
    // 横挪到「追不上」计时攒到一半多，把正前方一段人墙（站定的自己人与他们贴着的敌人）撤掉
    let cleared = false;
    for (let t = 0; t < 10 * 30 && !cleared; t++) {
      w.tick();
      w.fxN = 0;
      if (w.stuck[a] <= RULES.combat.blockedAfter / 2) continue;
      cleared = true;
      const reach = 8 * w.rad[a];
      expect(w.engaged[a], '清人墙时还没接敌').toBe(0);
      expect(w.waitT[a], '清人墙时还没列队等').toBe(0);
      const near = ps.filter(p => Math.abs(w.y[p] - w.y[a]) < reach);
      expect(near.length, '正前方有人墙').toBeGreaterThan(0);
      for (const p of near) w.removeUnit(p);
      for (let u = 0; u < w.n; u++) {
        // 前排敌人（后排在更东边）
        if (w.alive[u] && w.team[u] === 2 && w.x[u] < w.x[back[15]] - w.rad[u] && Math.abs(w.y[u] - w.y[a]) < reach) w.removeUnit(u);
      }
    }
    expect(cleared, '横挪攒下了计时').toBe(true);
    let engagedAt = -1, waited = false, clearedStuck = false;
    for (let t = 0; t < 3 * 30 && engagedAt < 0; t++) {
      w.tick();
      w.fxN = 0;
      if (w.waitT[a] > 0) waited = true;
      if (w.stuck[a] === 0) clearedStuck = true;
      if (w.engaged[a]) engagedAt = t;
    }
    expect(waited, '没有去列队等').toBe(false);
    expect(engagedAt, '钻进空位接上敌').toBeGreaterThanOrEqual(0);
    expect(clearedStuck, '走通之后计时清零').toBe(true);
    expect(w.target[a]).toBe(back[15]);
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
   * segs 按时间顺序给出每一段的时长，以及这一段结束之后到下一段开始之前（观察结束时止）有没有进入过列队等。
   */
  const flankAlongWall = (secs: number, key = 'legion'): {
    maxDev: number; stuckRate: number; lateralFrames: number; engagedFrames: number;
    segs: { secs: number; waitedAfter: boolean }[];
  } => {
    const w = flatWorld();
    const { ps, back } = lineWall(w, 31);
    const mid = back[15];
    const a = w.spawnUnit(idx(key), 1, C - 60, C + 3);
    w.orderAttackUnit([a], mid);
    let maxDev = 0, spell = 0, gap = 0, lateralFrames = 0, prevStuck = 0, engagedFrames = 0;
    const rates: number[] = [];
    const segs: { secs: number; waitedAfter: boolean }[] = [];
    for (let t = 0; t < secs * 30; t++) {
      const x0 = w.x[a], y0 = w.y[a];
      w.tick();
      w.fxN = 0;
      const vx = (w.x[a] - x0) * 30, vy = (w.y[a] - y0) * 30;
      if (w.waitT[a] > 0 && segs.length > 0) segs[segs.length - 1].waitedAfter = true;
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
        if (spell === 0) segs.push({ secs: 0, waitedAfter: false });
        spell++;
        segs[segs.length - 1].secs = spell / 30;
        gap = 0;
      } else if (++gap > 6) spell = 0;
    }
    rates.sort((p, q) => p - q);
    return {
      maxDev, stuckRate: rates.length ? rates[rates.length >> 1] : 1, lateralFrames, engagedFrames, segs,
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

  it.each(['legion', 'dao', 'auxilia', 'elephant'])('绕不过去就停下排队：每一段横挪都有上限，横挪攒满之后列队等、等完再试（%s）', key => {
    // 理论上限 blockedAfter ÷ flankStuck；统计时把走近人墙与刚开始列队等时减速的几帧也算进一段，余 1 秒
    const full = RULES.combat.blockedAfter / RULES.combat.flankStuck;
    const r = flankAlongWall(30, key);
    // 够不着目标：整个过程没有交上手
    expect(r.engagedFrames).toBe(0);
    const longest = Math.max(...r.segs.map(g => g.secs));
    expect(longest, `各段横挪（秒）${r.segs.map(g => g.secs.toFixed(2)).join(' ')}`).toBeLessThanOrEqual(full + 1);
    // 横挪被打断（顿一下抛标枪、收尾的抖动）会把一段切成几截，短的几截后面不一定接着列队等；攒到上限附近的段后面一定进入原地排队。
    // 最后一段可能还没来得及等，不查
    const spent = r.segs.filter(g => g.secs >= full - 0.5);
    const unwaited = r.segs.slice(0, -1).map((g, k) => (g.secs >= full - 0.5 && !g.waitedAfter ? k : -1)).filter(k => k >= 0);
    expect(unwaited, '攒满之后没进列队等的段号').toEqual([]);
    // 等完之后还会再试：不是挪一次就彻底停了
    expect(spent.length, '攒满的横挪段数').toBeGreaterThanOrEqual(3);
  });

  /**
   * 带重标枪的军团步兵追后排敌人、被人墙堵着横挪：「追不上」计时攒到 frac × blockedAfter 之后、仍在横挪时，把副武器冷却置 0 触发一次抛掷。
   * 逐帧记下：抛掷停顿（atkAnim > 0）里计时有没有变过；触发到进入列队等 / 绕行之间的帧数。
   */
  const throwWhileFlanking = (frac: number, key = 'legion'): {
    threw: boolean; pauseFrames: number; stuckMoved: number; trigStuck: number; elapsed: number; ended: boolean;
  } => {
    const w = flatWorld();
    const { back } = lineWall(w, 31);
    const a = w.spawnUnit(idx(key), 1, C - 60, C + 3);
    w.orderAttackUnit([a], back[15]);
    let triggered = false, threw = false, ended = false, pauseFrames = 0, stuckMoved = 0, trigStuck = 0, trigAt = 0, elapsed = 0;
    for (let t = 0; t < 30 * 30 && !ended; t++) {
      const s0 = w.stuck[a];
      if (!triggered && w.stuck[a] >= frac * RULES.combat.blockedAfter && w.waitT[a] <= 0) {
        triggered = true;
        trigStuck = w.stuck[a];
        trigAt = t;
        w.auxCd[a] = 0;
      }
      w.tick();
      w.fxN = 0;
      if (triggered && w.atkAnim[a] > 0) {
        if (w.auxCd[a] > 0) threw = true;
        pauseFrames++;
        stuckMoved = Math.max(stuckMoved, Math.abs(w.stuck[a] - s0));
      }
      if (triggered && (w.waitT[a] > 0 || w.detourT[a] > 0)) {
        ended = true;
        elapsed = (t - trigAt + 1) / 30;
      }
    }
    return { threw, pauseFrames, stuckMoved, trigStuck, elapsed, ended };
  };

  it.each([0.4, 0.8])('横挪途中抛副武器，停下的那一小段里「追不上」计时原样不动：不回落、也不多记（已攒 %f 的上限）', frac => {
    const r = throwWhileFlanking(frac);
    expect(r.trigStuck, '触发时已攒了一段计时').toBeGreaterThan(0);
    expect(r.threw, '确实抛出了').toBe(true);
    // 抛一下原地停约 0.3 秒
    expect(r.pauseFrames, '停顿的帧数').toBeGreaterThanOrEqual(6);
    expect(r.stuckMoved, '停顿里计时的变化').toBe(0);
  });

  it.each([0.4, 0.8])('含一次抛掷的那一轮横挪，扣掉抛掷停顿后与没抛掷的各轮一样受 blockedAfter ÷ flankStuck 的上限约束（已攒 %f 的上限）', frac => {
    const r = throwWhileFlanking(frac);
    expect(r.ended, '横挪到点后换成列队等或绕行').toBe(true);
    const left = (RULES.combat.blockedAfter - r.trigStuck) / RULES.combat.flankStuck;
    // 触发时刻起剩下的横挪时间 = 剩下的计时 ÷ flankStuck，再加抛掷停顿本身；余 0.3 秒给帧取整与收尾减速
    expect(r.elapsed - r.pauseFrames / 30, `扣掉停顿的横挪时长（秒），上限 ${left.toFixed(2)}`).toBeLessThanOrEqual(left + 0.3);
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
    const chaseBehindWall = (n: number, secs: number) => {
      const w = flatWorld();
      const { back } = lineWall(w, n);
      const mid = back[(n - 1) >> 1];
      const a = w.spawnUnit(idx('legion'), 1, C - 60, C + 3);
      w.orderAttackUnit([a], mid);
      const backX = w.x[mid];
      let firstDetour = -1, firstWait = -1, firstEngaged = -1, maxXEngaged = -Infinity;
      for (let t = 0; t < secs * 30; t++) {
        w.tick();
        w.fxN = 0;
        if (w.detourT[a] > 0 && firstDetour < 0) firstDetour = t;
        if (w.waitT[a] > 0 && firstWait < 0) firstWait = t;
        if (w.engaged[a]) {
          if (firstEngaged < 0) firstEngaged = t;
          maxXEngaged = Math.max(maxXEngaged, w.x[a]);
        }
      }
      return { firstDetour, firstWait, firstEngaged, maxXEngaged, backX, rad: w.rad[a] };
    };

    it('先起绕、空位被占着走不到：到点（时限用尽）结束绕行，改为列队等', () => {
      // 17 宽的人墙，追击者在人墙北端外侧：绕到南端的空位走得通，起绕条件满足；起绕那一刻有人站到了空位上
      const w = flatWorld();
      const { back } = lineWall(w, 17);
      const a = w.spawnUnit(idx('legion'), 1, C - 30, C + 100);
      w.orderAttackUnit([a], back[8]);
      for (let t = 0; t < 2; t++) {
        w.tick();
        w.fxN = 0;
      }
      expect(tryDetour(w, a, w.target[a], w.state[a], w.order[a], w.defs[idx('legion')].speed, 0), '起绕了').toBe(true);
      expect(w.detourT[a]).toBe(RULES.combat.detourFor);
      const f = w.target[a];
      w.spawnUnit(idx('legion'), 1, w.x[f] + w.detourX[a], w.y[f] + w.detourY[a]);
      // 剩下的时限只够走不到一半的路程：到点时还远没到位
      const left = RULES.combat.detourFor / 4;
      w.detourT[a] = left;
      let end = -1, waitAtEnd = false, engaged = false;
      for (let t = 0; t < 15 * 30 && end < 0; t++) {
        w.tick();
        w.fxN = 0;
        if (w.engaged[a]) engaged = true;
        if (w.detourT[a] <= 0) {
          end = t;
          waitAtEnd = w.waitT[a] > 0;
        }
      }
      expect(end, '绕行结束了').toBeGreaterThanOrEqual(0);
      expect((end + 1) / 30, '不晚于时限').toBeLessThanOrEqual(left + 0.1);
      expect(waitAtEnd, '结束的这一刻改为列队等').toBe(true);
      expect(engaged, '没到位接敌').toBe(false);
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
      // 100 人里：不绕行时交手的不到三成、列队等的过半；绕行时交手的近六成、列队等的不到两成。门槛夹在两者之间，两头都留了余量
      expect(eng, `平均交手 ${eng}`).toBeGreaterThan(45);
      expect(wait, `平均列队等 ${wait}`).toBeLessThan(30);
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

    /** 11 宽人墙 + 追击者 a（在西边、偏中线 startY 处，右键指定攻击后排正中的敌人）；跑到 a 起绕为止，返回此时的世界 */
    const detouringAtWall = (startY = 3): { w: World; a: number; rr: number } => {
      const w = flatWorld();
      const { back } = lineWall(w, 11);
      const a = w.spawnUnit(idx('legion'), 1, C - 60, C + startY);
      w.orderAttackUnit([a], back[5]);
      for (let t = 0; t < 20 * 30 && w.detourT[a] <= 0; t++) {
        w.tick();
        w.fxN = 0;
      }
      expect(w.detourT[a], '起绕了').toBeGreaterThan(0);
      return { w, a, rr: w.rad[a] };
    };

    /**
     * 绕行者去路上横着摆一排 5 个己方单位（前进方向前方 4 个身位，间距按这排单位自己的碰撞半径排）：
     * 步兵在原地待命；骑兵各贴着一个敌人在交手，敌人在骑兵的前方（远离绕行者一侧）。
     * 返回绕行者第一次越过这排（沿前进方向越过它们所在的线）时偏离这排中心的距离（身位）、
     * 绕行期间离这排最近的距离占半径和的比例，以及绕行期间这排里有人没在交手的帧数。
     */
    const crossRow = (kind: 'inf' | 'cav'): { crossLat: number | null; minRatio: number; idleFrames: number } => {
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
      const probe = w.spawnUnit(idx(kind === 'inf' ? 'legion' : 'equites'), 1, 0, 0);
      const rq = w.rad[probe];
      w.removeUnit(probe);
      const row: number[] = [];
      for (let k = -2; k <= 2; k++) {
        const qx = ox - hy * k * 2 * rq * 0.95, qy = oy + hx * k * 2 * rq * 0.95;
        if (kind === 'inf') {
          const q = w.spawnUnit(idx('legion'), 1, qx, qy);
          w.orderStop([q], true);
          row.push(q);
        } else {
          // 骑兵前方（前进方向）贴着一个站着不动的敌人，交手时脚下可以动，但不是站定
          const dist = (rq + rr) * 1.1;
          const f = w.spawnUnit(idx('legion'), 2, qx + hx * dist, qy + hy * dist);
          w.hp[f] = w.maxHp[f] = 1e9;
          w.orderStop([f], true);
          const q = w.spawnUnit(idx('equites'), 1, qx, qy);
          w.orderAttackUnit([q], f);
          row.push(q);
        }
      }
      let crossLat: number | null = null, minRatio = Infinity, idleFrames = 0;
      for (let t = 0; t < 12 * 30; t++) {
        w.tick();
        w.fxN = 0;
        if (w.detourT[a] <= 0) continue;
        if (row.some(q => !w.engaged[q])) idleFrames++;
        const along = (w.x[a] - ox) * hx + (w.y[a] - oy) * hy;
        if (crossLat === null && along > 0) crossLat = Math.abs(-(w.x[a] - ox) * hy + (w.y[a] - oy) * hx) / rr;
        for (const q of row) minRatio = Math.min(minRatio, Math.hypot(w.x[a] - w.x[q], w.y[a] - w.y[q]) / (w.rad[a] + w.rad[q]));
      }
      return { crossLat, minRatio, idleFrames };
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
      expect(r.idleFrames, '绕行期间这排骑兵一直在交手').toBe(0);
      expect(r.crossLat, '绕行期间没越过这排').toBeNull();
      expect(r.minRatio).toBeGreaterThan(0.6);
    });

    it.each([[60, 0, 3], [0, 40, 80]])('空位跟着所属敌兵走：绕行途中敌兵挪了 (%i, ±%i)（纵向朝空位所在的一侧挪；追击者初始偏 %i），落点贴着它的新位置', (dx, dy, startY) => {
      const { w, a } = detouringAtWall(startY);
      const f = w.target[a];
      const oldX = w.x[f] + w.detourX[a], oldY = w.y[f] + w.detourY[a];
      // 战线上下对称，绕行者往哪一侧绕取决于细微的差别；纵向挪动朝空位所在的一侧，空位才不会被挪到敌兵的另一面。
      // 纵向挪得多时，绕行圆心跟着挪，追击者得已经在那一侧（startY 偏大），才不会改从另一侧绕、被交手的自己人堵住
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
     * 大战场：平地，我方 371 个近战（戟 140、刀 140、铁骑 91）攻击移动到 34 个枪足轻（血量 ×15、士气锁 100、原地待命）身上。
     * 构成写死、不经 armyList 与兵员级数取人：开 / 关绕行之比对兵数极敏感，结局是两态的（要么把敌群整个包圆，要么只围一层），
     * 加减几个兵就可能整体换一种结局，与绕行好坏无关。
     * 返回第 10–40 秒里「交手人数 ÷ 敌兵贴身位总数」的平均（每个敌兵按 6 个贴身位算：同半径的圆最多贴 6 个），
     * 交手人数的平均，以及第 10 秒起深度重叠的己方近战对占接触对的比例。
     * 敌兵死得慢，「敌群剩一半以上才采样」的条件实际不会触发，贴身位利用率就是交手人数 ÷ 贴身位总数。
     */
    const bigBattle = (seed: number): { slotUse: number; engaged: number; deepRatio: number; mine: number } => {
      const n = 160, c2 = (n * TILE) / 2;
      const w = flatWorld(n, seed);
      const mineList = [...Array(140).fill(idx('ji')), ...Array(140).fill(idx('dao')), ...Array(91).fill(idx('tieqi'))];
      const foeList: number[] = Array(34).fill(idx('yari'));
      const foes = w.spawnGroup(2, foeList, c2 + 250, c2, -1, 0);
      for (const e of foes) w.hp[e] = w.maxHp[e] *= 15;
      w.orderStop(foes, true);
      const mine = w.spawnGroup(1, mineList, c2 - 300, c2, 1, 0);
      const tx = foes.reduce((a, e) => a + w.x[e], 0) / foes.length;
      const ty = foes.reduce((a, e) => a + w.y[e], 0) / foes.length;
      w.orderMove(mine, tx, ty, true);
      let use = 0, engSum = 0, uses = 0, deep = 0, pairs = 0;
      for (let t = 1; t <= 40 * 30; t++) {
        for (const e of foes) w.morale[e] = 100;
        w.tick();
        w.fxN = 0;
        const left = foes.filter(e => w.alive[e]).length;
        if (left * 2 < foes.length) break;
        if (t % 15 === 0 && t >= 10 * 30) {
          const eng = mine.filter(q => w.alive[q] && w.engaged[q]).length;
          use += eng / (left * 6);
          engSum += eng;
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
      return { slotUse: uses ? use / uses : 0, engaged: uses ? engSum / uses : 0, deepRatio: pairs ? deep / pairs : 0, mine: mine.length };
    };

    // 门槛按实测留余量：开 / 关之比均值约 1.7、各种子 1.5–2.0；多出的交手人数各种子 10–21；深度重叠不超过 2.4%
    const MEAN_MIN = 1.45, RATIO_MIN = 1.3, ENG_GAIN_MIN = 6;

    it('大战场：贴身位被用上的比例明显高于不绕行时，且己方不叠成一坨（种子 7、11、19）', () => {
      const seeds = [7, 11, 19];
      const on = seeds.map(bigBattle);
      let off: ReturnType<typeof bigBattle>[];
      const saved = RULES.combat.detourMaxCost;
      try {
        // 绕行的代价上限设为 0：找不到空位，绕行不启动，退回只横挪与列队等
        RULES.combat.detourMaxCost = 0;
        off = seeds.map(bigBattle);
      } finally {
        RULES.combat.detourMaxCost = saved;
      }
      const ratios = seeds.map((_, k) => on[k].slotUse / off[k].slotUse);
      const mean = ratios.reduce((a, r) => a + r, 0) / ratios.length;
      const desc = seeds.map((sd, k) => `种子 ${sd}：开 ${on[k].slotUse.toFixed(3)} 关 ${off[k].slotUse.toFixed(3)} 比 ${ratios[k].toFixed(2)}`).join('；');
      expect(on[0].mine).toBe(371);
      expect(mean, desc).toBeGreaterThan(MEAN_MIN);
      seeds.forEach((sd, k) => {
        expect(ratios[k], `种子 ${sd}：${desc}`).toBeGreaterThan(RATIO_MIN);
        // 开绕行时同时交手的人比关时多出的绝对人数
        expect(on[k].engaged - off[k].engaged, `种子 ${sd} 多出的交手人数`).toBeGreaterThan(ENG_GAIN_MIN);
        expect(on[k].deepRatio, `种子 ${sd} 深度重叠`).toBeLessThan(0.04);
      });
    }, 360000);
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

/** 格子 (t) 中心的像素坐标 */
const mid = (t: number): number => (t + 0.5) * TILE;
/** 画一道南北向的矿山墙：第 x 列，格子 y0..y1 */
const wallV = (t: Uint8Array, n: number, x: number, y0: number, y1: number): void => {
  for (let y = y0; y <= y1; y++) t[y * n + x] = T_MOUNTAIN;
};
/** 血量无限、原地坚守的敌兵（队伍 2） */
const dummy = (w: World, x: number, y: number, key = 'legion'): number => {
  const e = w.spawnUnit(idx(key), 2, x, y);
  w.hp[e] = w.maxHp[e] = 1e9;
  w.orderStop([e], true);
  return e;
};
/** 血量无限的己方单位（队伍 1） */
const mine = (w: World, x: number, y: number, key = 'dao'): number => {
  const s = w.spawnUnit(idx(key), 1, x, y);
  w.hp[s] = w.maxHp[s] = 1e9;
  return s;
};
const step = (w: World, ticks: number, each?: (t: number) => void): void => {
  for (let t = 0; t < ticks; t++) {
    w.tick();
    w.fxN = 0;
    each?.(t);
  }
};

describe('追击时直线不通就绕过去', () => {
  /** 己方近战在 (56, 60) 格，敌兵在 (65, 60) 格（9 格，在警戒距离内），中间 (60..61, 59..60) 格是一座己方民房 */
  const houseScene = () => {
    const w = flatWorld(120, 7);
    w.addBuilding(BUILDINGS.house, 60, 59, 1, -1);
    const me = mine(w, mid(56), mid(60));
    const foe = dummy(w, mid(65), mid(60));
    return { w, me, foe };
  };
  const inBlocked = (w: World, s: number): boolean => w.nav.block[1][w.cellAt(w.x[s], w.y[s])] === 1;

  it('攻击移动：隔着民房（直线不通）、绕过去不超过 chaseDetour 的敌兵照样挑，并绕过去交上手，全程不走进不可通行格', () => {
    const { w, me, foe } = houseScene();
    expect(w.lineBlocked(w.x[me], w.y[me], w.x[foe], w.y[foe], 1)).toBe(true);
    w.orderMove([me], mid(90), mid(60), true);
    let pickedAt = -1, entered = false, engaged = false;
    step(w, 30 * 20, t => {
      if (pickedAt < 0 && w.target[me] === foe) pickedAt = t;
      if (inBlocked(w, me)) entered = true;
      if (w.engaged[me] && w.target[me] === foe) engaged = true;
    });
    // 一轮索敌（8 帧）内就挑中了，那时人还没走出多远，直线依旧不通
    expect(pickedAt).toBeGreaterThanOrEqual(0);
    expect(pickedAt).toBeLessThan(16);
    expect(entered).toBe(false);
    // 绕过去交上了手
    expect(engaged).toBe(true);
  });

  it('隔着民房的敌兵，被挑中那一帧己方还在原地附近（不是先走到直线看得见才挑）', () => {
    const { w, me, foe } = houseScene();
    const x0 = w.x[me], y0 = w.y[me];
    w.orderMove([me], mid(90), mid(60), true);
    let at = -1;
    for (let t = 0; t < 16 && at < 0; t++) {
      step(w, 1);
      if (w.target[me] === foe) at = t;
    }
    expect(at).toBeGreaterThanOrEqual(0);
    expect(Math.hypot(w.x[me] - x0, w.y[me] - y0)).toBeLessThan(16);
    expect(w.lineBlocked(w.x[me], w.y[me], w.x[foe], w.y[foe], 1)).toBe(true);
  });

  it('隔着绕不过去的长墙：不挑这个敌兵，几秒内少挑它（avoidT 机制），也不因此丢进 1.5 秒不索敌（ignoreT 不被设置）', () => {
    const w = flatWorld(120, 7, (t, n) => wallV(t, n, 64, 44, 76));
    const me = mine(w, mid(60), mid(60));
    const foe = dummy(w, mid(67), mid(60));
    w.orderMove([me], mid(60), mid(30), true);
    let picked = false, ignored = false, avoided = false;
    step(w, 60, () => {
      if (w.target[me] === foe) picked = true;
      if (w.ignoreT[me] > 0) ignored = true;
      if (w.avoidT[me] > 0 && w.avoidUid[me] === w.uid[foe]) avoided = true;
    });
    expect(picked).toBe(false);
    expect(avoided).toBe(true);
    expect(ignored).toBe(false);
  });

  it('已经盯着的目标途中变成绕不过去：放弃并少挑它，ignoreT 不被设置，旁边别的够得着的敌兵马上换去打', () => {
    // 墙在 64 列；己方在墙西 (62, 60)，被盯着的敌兵在墙东 (66, 60)，另一个敌兵在西侧开阔地 (62, 69)
    const w = flatWorld(120, 7, (t, n) => wallV(t, n, 64, 44, 76));
    const me = mine(w, mid(62), mid(60));
    const behind = dummy(w, mid(66), mid(60));
    const open = dummy(w, mid(62), mid(69));
    w.orderMove([me], mid(62), mid(30), true);
    w.target[me] = behind;
    w.targetUid[me] = w.uid[behind];
    let ignored = false, avoided = false, switchedAt = -1;
    step(w, 45, t => {
      if (w.ignoreT[me] > 0) ignored = true;
      if (w.avoidT[me] > 0 && w.avoidUid[me] === w.uid[behind]) avoided = true;
      if (switchedAt < 0 && w.target[me] === open) switchedAt = t;
    });
    expect(avoided).toBe(true);
    expect(ignored).toBe(false);
    // 远小于 1.5 秒（45 帧）：下一轮索敌就换了
    expect(switchedAt).toBeGreaterThanOrEqual(0);
    expect(switchedAt).toBeLessThan(24);
  });

  it('玩家指定攻击某个敌兵：近处隔着民房能绕就绕，目标不变，最终交上手', () => {
    const { w, me, foe } = houseScene();
    w.orderAttackUnit([me], foe);
    let dropped = false, entered = false, engaged = false;
    step(w, 30 * 20, () => {
      if (w.target[me] !== foe) dropped = true;
      if (inBlocked(w, me)) entered = true;
      if (w.engaged[me]) engaged = true;
    });
    expect(dropped).toBe(false);
    expect(entered).toBe(false);
    expect(engaged).toBe(true);
  });

  it('玩家指定攻击隔着长墙的敌兵：不放弃目标，改走寻路绕过墙端', () => {
    const w = flatWorld(120, 7, (t, n) => wallV(t, n, 64, 44, 76));
    const me = mine(w, mid(62), mid(60));
    const foe = dummy(w, mid(66), mid(60));
    w.orderAttackUnit([me], foe);
    const y0 = w.y[me];
    let dropped = false;
    step(w, 30 * 6, () => {
      if (w.target[me] !== foe) dropped = true;
    });
    expect(dropped).toBe(false);
    expect(w.order[me]).toBe(O_ATTACK);
    // 在沿着墙往墙端走，不是原地顶着墙
    expect(Math.abs(w.y[me] - y0)).toBeGreaterThan(TILE * 2);
    expect(w.ignoreT[me]).toBe(0);
  });

  it('开阔地上直线本来就通：不绕，沿直线走向目标，判断结果是直走', () => {
    const w = flatWorld(120, 7);
    const me = mine(w, mid(56), mid(60));
    const foe = dummy(w, mid(64), mid(60));
    w.orderMove([me], mid(90), mid(60), true);
    const y0 = w.y[me];
    let off = 0;
    step(w, 45, () => { off = Math.max(off, Math.abs(w.y[me] - y0)); });
    expect(w.target[me]).toBe(foe);
    expect(w.wayUid[me]).toBe(w.uid[foe]);
    expect(w.wayMode[me]).toBe(WAY_DIRECT);
    expect(off).toBeLessThan(1);
    expect(w.x[me]).toBeGreaterThan(mid(56) + TILE);
  });

  it('远程兵追击时同样会绕：直线被墙挡住、凑不进射程时沿路点绕过墙端，最终进了射程开火，目标不变', () => {
    // 一堵 5 格高的矿山墙紧贴在射手前面：直接往前走够不着射程，要绕到墙端
    const w = flatWorld(120, 7, (t, n) => wallV(t, n, 57, 58, 62));
    const me = mine(w, mid(56), mid(60), 'nu');
    const foe = dummy(w, mid(65), mid(60));
    const range = w.defs[w.type[me]].main.range;
    expect(w.lineBlocked(w.x[me], w.y[me], w.x[foe], w.y[foe], 1)).toBe(true);
    expect(Math.hypot(w.x[foe] - w.x[me], w.y[foe] - w.y[me])).toBeGreaterThan(range + TILE);
    w.orderMove([me], mid(56), mid(40), true);
    const y0 = w.y[me];
    let around = false, entered = false, engaged = false, dropped = false, off = 0;
    step(w, 30 * 12, () => {
      if (w.target[me] === foe && w.wayMode[me] === WAY_AROUND) around = true;
      if (w.target[me] !== foe && w.target[me] !== NONE) dropped = true;
      if (inBlocked(w, me)) entered = true;
      if (w.engaged[me]) engaged = true;
      off = Math.max(off, Math.abs(w.y[me] - y0));
    });
    expect(around).toBe(true);
    expect(dropped).toBe(false);
    expect(entered).toBe(false);
    // 确实沿着路点往墙端走了一段，而不是顶着墙
    expect(off).toBeGreaterThan(TILE * 2);
    expect(engaged).toBe(true);
  });

  it('远程兵追击时绕不过去（隔着长墙）：照旧朝目标直线走，不放弃目标、不少挑它', () => {
    const w = flatWorld(120, 7, (t, n) => wallV(t, n, 57, 44, 76));
    const me = mine(w, mid(56), mid(60), 'nu');
    const foe = dummy(w, mid(65), mid(60));
    expect(Math.hypot(w.x[foe] - w.x[me], w.y[foe] - w.y[me])).toBeGreaterThan(w.defs[w.type[me]].main.range + TILE);
    w.orderMove([me], mid(56), mid(40), true);
    let none = false, dropped = false, avoided = false, ignored = false, seen = false;
    step(w, 30 * 6, () => {
      if (w.target[me] === foe && w.wayMode[me] === WAY_NONE) none = true;
      if (w.target[me] === foe) seen = true;
      else if (seen) dropped = true;
      if (w.avoidT[me] > 0 && w.avoidUid[me] === w.uid[foe]) avoided = true;
      if (w.ignoreT[me] > 0) ignored = true;
    });
    expect(none).toBe(true);
    expect(dropped).toBe(false);
    expect(avoided).toBe(false);
    expect(ignored).toBe(false);
    // 朝着目标直线走，贴到了墙边（墙的西沿在 57 列起点）
    expect(w.x[me]).toBeGreaterThan(mid(56) + 8);
  });
});

describe('挑目标：判出绕不过去之后的重试间隔（chaseRetry）', () => {
  /**
   * 己方近战 (60, 60) 站着不动；墙在 62 列（长墙，绕不过去），敌兵 A 在墙东 (63, 60)，比 B 近；
   * 一座 2×2 民房在 (59..60, 57..58)，敌兵 B 在房后 (60, 56)：绕得过去，但直线不通
   */
  const scene = (withA: boolean) => {
    const w = flatWorld(120, 7, (t, n) => wallV(t, n, 62, 44, 76));
    w.addBuilding(BUILDINGS.house, 59, 57, 1, -1);
    const me = mine(w, mid(60), mid(60));
    const a = withA ? dummy(w, mid(63), mid(60)) : NONE;
    const b = dummy(w, mid(60), mid(56));
    expect(w.lineBlocked(w.x[me], w.y[me], w.x[b], w.y[b], 1)).toBe(true);
    return { w, me, a, b };
  };

  it('对照：没有绕不过去的 A 时，隔着民房的 B 很快就被挑中', () => {
    const { w, me, b } = scene(false);
    let at = -1;
    step(w, 30, t => {
      if (at < 0 && w.target[me] === b) at = t;
    });
    expect(at).toBeGreaterThanOrEqual(0);
    expect(at).toBeLessThan(16);
  });

  it('刚判出 A 绕不过去：chaseRetry 秒内直线不通的 B 不挑（即使绕得过去）；过了这段时间恢复，挑中并绕过去交上手', () => {
    const { w, me, a, b } = scene(true);
    const window = Math.floor(RULES.combat.chaseRetry * 30);
    let early = false, judged = false;
    // 第一次判断最早在第 0 帧、最晚在第 7 帧，重试间隔从那时起算：前 window 帧一定还在间隔里
    step(w, window, () => {
      if (w.target[me] === b) early = true;
      if (w.avoidT[me] > 0 && w.avoidUid[me] === w.uid[a]) judged = true;
    });
    expect(judged).toBe(true);
    expect(early).toBe(false);
    // A 没了，间隔过去之后 B 就能被挑中：挑中的时刻不早于间隔结束，也不晚于间隔结束后一轮索敌（8 帧）加一点余量
    w.removeUnit(a);
    let at = -1, expired = -1, engaged = false;
    step(w, 30 * 5, t => {
      if (expired < 0 && w.wayNoT[me] <= 0) expired = t;
      if (at < 0 && w.target[me] === b) at = t;
      if (w.engaged[me] && w.target[me] === b) engaged = true;
    });
    expect(at).toBeGreaterThanOrEqual(0);
    expect(expired).toBeGreaterThanOrEqual(0);
    expect(at).toBeGreaterThanOrEqual(expired);
    expect(at - expired).toBeLessThanOrEqual(10);
    expect(engaged).toBe(true);
  });

  it('间隔内被跳过的 B 不会被罚得比间隔更久：间隔一结束，比直线通的 D 更近的 B 就先被挑中', () => {
    const { w, me, a, b } = scene(true);
    // D 一开始在索敌距离之外
    const d = dummy(w, mid(60), mid(69));
    let judged = false;
    for (let t = 0; t < 30 && !judged; t++) {
      step(w, 1);
      if (w.avoidT[me] > 0 && w.avoidUid[me] === w.uid[a]) judged = true;
    }
    expect(judged).toBe(true);
    expect(w.wayNoT[me]).toBeGreaterThan(0);
    // A 拿走，只剩间隔在走：期间每轮索敌 B 都被跳过（进少挑名单），但不被挑
    w.removeUnit(a);
    let skipped = false, picked = false;
    for (let t = 0; t < 200 && w.wayNoT[me] > 0; t++) {
      step(w, 1);
      if (w.avoidT[me] > 0 && w.avoidUid[me] === w.uid[b]) skipped = true;
      if (w.target[me] === b) picked = true;
    }
    expect(w.wayNoT[me]).toBeLessThanOrEqual(0);
    expect(skipped).toBe(true);
    expect(picked).toBe(false);
    // 间隔刚结束时 D 走进来：直线通、比 B 远一点。B 更近，少挑名单若还罚着 B 就会先挑 D
    w.y[d] = mid(65);
    let first = NONE;
    step(w, 16, () => {
      if (first === NONE && w.target[me] !== NONE) first = w.target[me];
    });
    expect(first).toBe(b);
    expect(first).not.toBe(d);
  });

  it('间隔期内直线走得通的候选照挑：隔着民房的 B 不挑，改挑直线通的 C；不在间隔里时先挑更近的 B', () => {
    const mk = (retry: number) => {
      const w = flatWorld(120, 7);
      w.addBuilding(BUILDINGS.house, 59, 57, 1, -1);
      const me = mine(w, mid(60), mid(60));
      // B：隔着民房、更近；C：直线通、略远
      const b = dummy(w, mid(60), mid(56));
      const c = dummy(w, mid(60), mid(65));
      expect(w.lineBlocked(w.x[me], w.y[me], w.x[b], w.y[b], 1)).toBe(true);
      expect(w.lineBlocked(w.x[me], w.y[me], w.x[c], w.y[c], 1)).toBe(false);
      w.wayNoT[me] = retry;
      return { w, me, b, c };
    };
    const a = mk(RULES.combat.chaseRetry);
    let pickedB = false, pickedC = -1;
    step(a.w, 30, t => {
      if (a.w.target[a.me] === a.b) pickedB = true;
      if (pickedC < 0 && a.w.target[a.me] === a.c) pickedC = t;
    });
    expect(pickedB).toBe(false);
    expect(pickedC).toBeGreaterThanOrEqual(0);
    expect(pickedC).toBeLessThan(16);
    const b = mk(0);
    let first = NONE;
    step(b.w, 16, () => {
      if (first === NONE && b.w.target[b.me] !== NONE) first = b.w.target[b.me];
    });
    expect(first).toBe(b.b);
  });
});

describe('没被挑中的候选不留绕行记录', () => {
  /** 墙在 62 列（长墙）；敌兵 X 在墙东 (64, 60)，己方 (60, 60)：X 被判成绕不过去，没有别的可打 */
  const judged = (key: string) => {
    const w = flatWorld(120, 7, (t, n) => wallV(t, n, 62, 44, 76));
    const me = mine(w, mid(60), mid(60), key);
    const x = dummy(w, mid(64), mid(60));
    let at = -1;
    step(w, 30, t => {
      if (at < 0 && w.avoidT[me] > 0 && w.avoidUid[me] === w.uid[x]) at = t;
    });
    expect(at).toBeGreaterThanOrEqual(0);
    expect(w.target[me]).toBe(NONE);
    // 判断过 X 但没挑它：单位身上没有「在追 X」的走法记录
    expect(w.wayUid[me]).not.toBe(w.uid[x]);
    return { w, me, x };
  };
  /** X 走到了己方这一侧的开阔地：直线通了；少挑名单也让它到期，免得和这次的结果混在一起 */
  const comeOver = (w: World, me: number, x: number): void => {
    w.x[x] = mid(60);
    w.y[x] = mid(65);
    w.avoidT[me] = 0;
  };

  it('目标换成先前判过绕不过去、此刻直线已通的敌兵：照常追击并交上手，不被放弃、不被记进少挑名单', () => {
    const { w, me, x } = judged('dao');
    comeOver(w, me, x);
    let seen = false, dropped = false, engaged = false, avoided = false;
    step(w, 30 * 6, () => {
      if (w.target[me] === x) {
        seen = true;
        if (w.wayMode[me] !== WAY_DIRECT) dropped = true;
      } else if (seen && w.engaged[me] === 0) dropped = true;
      if (w.avoidT[me] > 0 && w.avoidUid[me] === w.uid[x]) avoided = true;
      if (w.engaged[me] && w.target[me] === x) engaged = true;
    });
    expect(seen).toBe(true);
    expect(dropped).toBe(false);
    expect(avoided).toBe(false);
    expect(engaged).toBe(true);
  });

  it('冲锋盯上先前判过绕不过去的敌兵、且那时直线已通：照常追击并交上手，不被放弃', () => {
    const { w, me, x } = judged('tieqi');
    comeOver(w, me, x);
    let charged = false, dropped = false, engaged = false, avoided = false;
    step(w, 30 * 6, () => {
      if (w.state[me] & S_CHARGE && w.target[me] === x) charged = true;
      if (charged && w.target[me] !== x && w.engaged[me] === 0) dropped = true;
      if (w.avoidT[me] > 0 && w.avoidUid[me] === w.uid[x]) avoided = true;
      if (w.engaged[me] && w.target[me] === x) engaged = true;
    });
    expect(charged).toBe(true);
    expect(dropped).toBe(false);
    expect(avoided).toBe(false);
    expect(engaged).toBe(true);
  });

  it('盯着 Y 追的时候判了绕不过去的 X：单位的追击记录仍是 Y，不被改写', () => {
    // Y 在南侧开阔地、较远但正盯着；X 在墙东、近得多，绕不过去，每轮索敌都会被判一次
    const w = flatWorld(120, 7, (t, n) => wallV(t, n, 61, 44, 76));
    const me = mine(w, mid(60), mid(60));
    const x = dummy(w, mid(63), mid(60));
    const y = dummy(w, mid(60), mid(65));
    w.target[me] = y;
    w.targetUid[me] = w.uid[y];
    let wrote = false, judgedX = false;
    step(w, 30, () => {
      if (w.avoidT[me] > 0 && w.avoidUid[me] === w.uid[x]) judgedX = true;
      if (w.target[me] === y && w.wayUid[me] !== 0 && w.wayUid[me] !== w.uid[y]) wrote = true;
    });
    expect(judgedX).toBe(true);
    expect(wrote).toBe(false);
    expect(w.target[me]).toBe(y);
    expect(w.wayUid[me]).toBe(w.uid[y]);
  });
});

describe('近战横挪时贴着民房', () => {
  it('被自己人堵在窄道里往侧面横挪、撞上民房：按被自己人挡住处理（换目标或列队等），不因此 1.5 秒不索敌', () => {
    // 一条一格宽的通道（上下两排民房），敌兵、站定的己方兵各两个并排堵满通道；后面赶来的 a 横挪时一侧就是民房
    const w = flatWorld(120, 7);
    for (const tx of [57, 59, 61]) for (const ty of [58, 61]) w.addBuilding(BUILDINGS.house, tx, ty, 1, -1);
    const es = [-8, 8].map(o => dummy(w, mid(61), mid(60) + o));
    const rr = w.rad[es[0]];
    for (const e of es) {
      const p = mine(w, w.x[e] - 2 * rr + 2, w.y[e], 'legion');
      w.orderAttackUnit([p], e);
    }
    const a = mine(w, mid(58), mid(60), 'legion');
    w.orderMove([a], mid(80), mid(60), true);
    let ignored = false, handled = false, engaged = false, held = 0;
    step(w, 30 * 8, t => {
      if (w.ignoreT[a] > 0) ignored = true;
      // 按被自己人挡住处理：把当前目标记进少挑名单，换了目标或原地列队等
      if (w.avoidT[a] > 0 && es.some(e => w.uid[e] === w.avoidUid[a])) handled = true;
      if (w.engaged[a]) engaged = true;
      if (t >= 30 && (w.target[a] !== NONE || w.waitT[a] > 0 || w.detourT[a] > 0)) held++;
    });
    // 场景有效：a 一直被堵在后面没能交手
    expect(engaged).toBe(false);
    expect(handled).toBe(true);
    expect(ignored).toBe(false);
    // 一直保持着目标、列队或绕行，没有进入「不索敌」的空窗
    expect(held).toBeGreaterThan(30 * 7 - 5);
  });
});

describe('近战够不着隔墙的敌兵：转去打可攻击的建筑', () => {
  /**
   * 己方近战 (60, 60)，行营（可被人形单位攻击）在 (56..57, 56..57)；敌兵 A 在 (64, 60)，
   * wall 为真时中间隔着 62 列的长墙（绕不过去），否则开阔
   */
  const scene = (wall: boolean, how: 'amove' | 'idle') => {
    const w = flatWorld(120, 7, wall ? (t, n) => wallV(t, n, 62, 44, 76) : undefined);
    const bld = w.addBuilding(BUILDINGS.outpost, 56, 56, 2, -1);
    expect(canAttackBuilding(bld, 1, false)).toBe(true);
    const me = mine(w, mid(60), mid(60));
    const a = dummy(w, mid(64), mid(60));
    if (how === 'amove') w.orderMove([me], mid(60), mid(30), true);
    expect(w.lineBlocked(w.x[me], w.y[me], w.x[a], w.y[a], 1)).toBe(wall);
    return { w, me, a, bid: -bld.id - 2 };
  };

  for (const how of ['amove', 'idle'] as const) {
    it(`${how === 'amove' ? '攻击移动' : '到位后待命'}：敌兵隔着长墙绕不过去，去打旁边的行营，而不是既不打人也不打建筑地站着`, () => {
      const { w, me, a, bid } = scene(true, how);
      let at = -1, engaged = false, onFoe = false;
      step(w, 30 * 4, t => {
        if (at < 0 && w.target[me] === bid) at = t;
        if (w.target[me] === a) onFoe = true;
        if (w.engaged[me] && w.target[me] === bid) engaged = true;
      });
      expect(at).toBeGreaterThanOrEqual(0);
      expect(at).toBeLessThan(30);
      expect(onFoe).toBe(false);
      expect(engaged).toBe(true);
    });

    it(`${how === 'amove' ? '攻击移动' : '到位后待命'}对照：敌兵直线可通时照旧先打敌兵，不去打建筑`, () => {
      const { w, me, a, bid } = scene(false, how);
      let onBld = false, engaged = false;
      step(w, 30 * 4, () => {
        if (w.target[me] === bid) onBld = true;
        if (w.engaged[me] && w.target[me] === a) engaged = true;
      });
      expect(onBld).toBe(false);
      expect(engaged).toBe(true);
    });
  }

  it('对照：敌兵隔着民房、绕得过去时，也先去打敌兵，不去打建筑', () => {
    const w = flatWorld(120, 7);
    const bld = w.addBuilding(BUILDINGS.outpost, 56, 56, 2, -1);
    w.addBuilding(BUILDINGS.house, 59, 57, 1, -1);
    const me = mine(w, mid(60), mid(60));
    const b = dummy(w, mid(60), mid(56));
    expect(w.lineBlocked(w.x[me], w.y[me], w.x[b], w.y[b], 1)).toBe(true);
    let onBld = false, engaged = false;
    step(w, 30 * 5, () => {
      if (w.target[me] === -bld.id - 2) onBld = true;
      if (w.engaged[me] && w.target[me] === b) engaged = true;
    });
    expect(onBld).toBe(false);
    expect(engaged).toBe(true);
  });
});

describe('追击判断的状态记录', () => {
  it('追击记录跟着目标走：追敌兵时记下它的 uid，目标没了就清零', () => {
    const w = flatWorld();
    const a = mine(w, mid(56), mid(60));
    const foe = dummy(w, mid(62), mid(60));
    w.orderMove([a], mid(90), mid(60), true);
    step(w, 20);
    expect(w.target[a]).toBe(foe);
    expect(w.wayUid[a]).toBe(w.uid[foe]);
    w.removeUnit(foe);
    step(w, 2);
    expect(w.target[a]).toBe(NONE);
    expect(w.wayUid[a]).toBe(0);
  });
});

describe('远程单位主动去打登上城墙的敌兵', () => {
  const WALL_TY = 60;
  /** 墙顶那个敌兵的位置 */
  const FX = C + 10, FY = WALL_TY * TILE + 10;

  /**
   * 一座敌方城池（据点范围是 ty 40..60 的矩形，南墙在 ty = WALL_TY，横贯战场中部），一个血量无限、站定（坚守）的敌方弓足轻 e 站在南墙顶；
   * 我方的 me 在墙正南 gap 远的地方、血量无限。
   * spot：在墙根南面摆一座己方民居给视野，不摆的话 e 离 me 太远看不见。
   * fight：据点的交战状态。'unit'（默认）是一个我方站定的步兵站在据点范围里；'hit' 是据点的一段城墙刚挨了一下打；false 是平静。
   * before：封墙之前再摆些别的建筑。
   */
  const scene = (o: {
    me?: string; gap?: number; spot?: boolean; fight?: 'unit' | 'hit' | false; before?: (w: World) => void;
  } = {}): { w: World; e: number; u: number; site: Site } => {
    const w = flatWorld();
    const site = w.addSite(SITE_CITY, '敌城', 30 * TILE, 40 * TILE, 2);
    for (let tx = 30; tx <= 90; tx++) site.buildings.push(w.addBuilding(BUILDINGS.wall, tx, WALL_TY, 2, site.id).id);
    // 北边角上的一座城墙，把据点范围撑成矩形
    site.buildings.push(w.addBuilding(BUILDINGS.wall, 30, 40, 2, site.id).id);
    o.before?.(w);
    w.sealWalls();
    const e = w.spawnUnit(idx('yumi'), 2, FX, FY);
    w.hp[e] = w.maxHp[e] = 1e7;
    w.orderStop([e], true);
    if (o.spot ?? true) w.addBuilding(BUILDINGS.house, 58, WALL_TY + 3, 1, -1);
    const u = w.spawnUnit(idx(o.me ?? 'nu'), 1, C, FY + (o.gap ?? 700));
    w.hp[u] = w.maxHp[u] = 1e7;
    const fight = o.fight ?? 'unit';
    if (fight === 'unit') intrude(w);
    else if (fight === 'hit') hitSite(w, site);
    return { w, e, u, site };
  };
  /** 一个我方站定的步兵进了据点范围 */
  const intrude = (w: World): number => {
    const q = w.spawnUnit(idx('dao'), 1, C - 400, WALL_TY * TILE - 150);
    w.hp[q] = w.maxHp[q] = 1e7;
    w.orderStop([q], true);
    return q;
  };
  /** 据点的一段城墙挨一下打 */
  const hitSite = (w: World, site: Site): void => {
    w.damageBuilding(w.buildings[site.buildings[10]], 50, 1, 1, 1, true);
  };
  const damaged = (w: World, e: number): number => 1e7 - w.hp[e];
  /** 跑 secs 秒：返回过程中 u 有没有盯上 e、离出发点最远走了多少、离 e 最近到多少 */
  const watch = (w: World, u: number, e: number, secs: number): { targeted: boolean; away: number; nearest: number } => {
    const x0 = w.x[u], y0 = w.y[u];
    let targeted = false, away = 0, nearest = Infinity;
    for (let t = 0; t < secs * 30; t++) {
      w.tick();
      w.fxN = 0;
      if (w.target[u] === e) targeted = true;
      away = Math.max(away, Math.hypot(w.x[u] - x0, w.y[u] - y0));
      nearest = Math.min(nearest, Math.hypot(w.x[u] - w.x[e], w.y[u] - w.y[e]));
    }
    return { targeted, away, nearest };
  };

  it('场景前提：墙顶的敌兵确实在城墙上，己方一开始离它太远、没有目标', () => {
    const { w, e, u } = scene();
    run(w, 1);
    expect(w.state[e] & S_WALL).toBe(S_WALL);
    expect(w.seen[e] & 2).toBe(2);
    expect(fightState(w, w.sites[0]).fighting, '默认据点在交战').toBe(true);
    expect(Math.hypot(w.x[e] - w.x[u], w.y[e] - w.y[u])).toBeGreaterThan(UNIT_BY_KEY.nu.alert);
  });

  it('待命的远程：走到刚好进射程的地方对墙顶的敌兵开火；目标没了之后回到原岗位', () => {
    const { w, e, u } = scene();
    const home = { x: w.x[u], y: w.y[u] };
    const r = watch(w, u, e, 12);
    expect(r.targeted).toBe(true);
    expect(damaged(w, e)).toBeGreaterThan(0);
    // 不贴着墙根：停在射程边缘（射程 + 双方半径）
    const reach = UNIT_BY_KEY.nu.main.range + w.rad[u] + w.rad[e];
    expect(Math.hypot(w.x[u] - w.x[e], w.y[u] - w.y[e])).toBeLessThanOrEqual(reach + 4);
    expect(Math.hypot(w.x[u] - w.x[e], w.y[u] - w.y[e])).toBeGreaterThan(reach * 0.8);
    w.removeUnit(e);
    run(w, 20);
    expect(w.target[u]).toBe(NONE);
    expect(Math.hypot(w.x[u] - home.x, w.y[u] - home.y)).toBeLessThan(40);
  });

  it('攻击移动途中：没有别的目标时也去打墙顶的敌兵', () => {
    const { w, e, u } = scene();
    // 平行于城墙往东走，路上离墙最近也有 700，远在平时索敌范围之外
    w.orderMove([u], C + 700, w.y[u], true);
    const r = watch(w, u, e, 12);
    expect(r.targeted).toBe(true);
    expect(damaged(w, e)).toBeGreaterThan(0);
    expect(w.y[u], '朝墙的方向走了').toBeLessThan(FY + 700 - 200);
  });

  it('待命时只找离岗位不超过 wallSeek 的：近一点的去，远一点的不去', () => {
    const near = scene({ gap: RULES.combat.wallSeek - 150 });
    const rn = watch(near.w, near.u, near.e, 20);
    expect(rn.targeted).toBe(true);
    expect(damaged(near.w, near.e)).toBeGreaterThan(0);
    const far = scene({ gap: RULES.combat.wallSeek + 100 });
    const rf = watch(far.w, far.u, far.e, 20);
    expect(rf.targeted).toBe(false);
    expect(rf.away).toBeLessThan(5);
    expect(damaged(far.w, far.e)).toBe(0);
  });

  it('岗位离敌兵超过 wallSeek 的不去，即使人此刻离它很近', () => {
    const { w, e, u } = scene();
    // 人在 700 外，岗位记在刚过 wallSeek 的地方（待命追击自身的距离限制要宽一点，这一带只有主动索敌这一层挡得住）
    w.homeY[u] = FY + RULES.combat.wallSeek + 50;
    const r = watch(w, u, e, 10);
    expect(r.targeted).toBe(false);
    expect(damaged(w, e)).toBe(0);
  });

  describe('不去的情形', () => {
    const cases: [string, () => { w: World; e: number; u: number }][] = [
      ['坚守的远程', () => {
        const s = scene();
        s.w.orderStop([s.u], true);
        return s;
      }],
      ['普通移动命令行进中的远程', () => {
        const s = scene();
        s.w.orderMove([s.u], C + 700, s.w.y[s.u], false);
        return s;
      }],
      ['待命的近战（对墙上的敌兵仍不挑）', () => scene({ me: 'dao' })],
      ['攻击移动途中的近战', () => {
        const s = scene({ me: 'dao' });
        s.w.orderMove([s.u], C + 700, s.w.y[s.u], true);
        return s;
      }],
      ['工程类器械', () => scene({ me: 'pili' })],
      ['己方看不见墙上的敌兵', () => scene({ spot: false })],
    ];
    it.each(cases)('%s', (_name, mk) => {
      const { w, e, u } = mk();
      const x0 = w.x[u], y0 = w.y[u], moving = w.order[u] === O_MOVE || w.order[u] === O_AMOVE;
      const r = watch(w, u, e, 10);
      expect(r.targeted).toBe(false);
      expect(damaged(w, e)).toBe(0);
      // 没有目标又不是在赶路的，原地不动
      if (!moving) expect(Math.hypot(w.x[u] - x0, w.y[u] - y0)).toBeLessThan(5);
      // 赶路的沿原来的路线走，没有朝墙拐
      else expect(Math.abs(w.y[u] - y0)).toBeLessThan(20);
    });
  });

  describe('不白送', () => {
    /** 墙顶敌兵与我方之间、刚好进射程的那一点附近放障碍；返回 12 秒内的结果 */
    const withObstacle = (put: (w: World) => void) => {
      const { w, e, u } = scene();
      put(w);
      return { w, e, ...watch(w, u, e, 12) };
    };
    // 刚好进射程的那一点离墙约 235（弩兵射程），ty = WALL_TY + 7 一带
    const reachRow = WALL_TY + 7;

    it('走到「刚好进射程」那一点走不通（那一点在城墙里）：不挑', () => {
      const r = withObstacle(w => {
        // 停下的点离墙约一个射程加两边的半径，两排城墙盖住它
        for (let tx = 20; tx <= 100; tx++) for (const ty of [reachRow, reachRow + 1]) w.addBuilding(BUILDINGS.wall, tx, ty, 2, -1);
      });
      expect(r.targeted).toBe(false);
      expect(damaged(r.w, r.e)).toBe(0);
    });

    it.each([2, 0])('那一点落在箭塔射程里（箭塔属于 %i 方）：不挑', owner => {
      const r = withObstacle(w => {
        w.addBuilding(BUILDINGS.watchtower, 64, reachRow + 2, owner, -1);
      });
      expect(r.targeted).toBe(false);
      expect(damaged(r.w, r.e)).toBe(0);
    });

    it('对照：箭塔离那一点很远，照常去', () => {
      const r = withObstacle(w => {
        w.addBuilding(BUILDINGS.watchtower, 60, WALL_TY - 20, 2, -1);
      });
      expect(r.targeted).toBe(true);
      expect(damaged(r.w, r.e)).toBeGreaterThan(0);
    });
  });

  it('手头正在打建筑的远程，看见墙上的敌兵也换去打敌兵', () => {
    // 先不给视野：弩兵自己去打旁边的敌方哨塔
    const { w, e, u } = scene({ spot: false });
    const tower = w.addBuilding(BUILDINGS.watchtower, 66, WALL_TY + 19, 2, -1);
    run(w, 4);
    expect(w.target[u], '先盯着建筑').toBe(-tower.id - 2);
    // 墙顶的敌兵进了视野
    w.addBuilding(BUILDINGS.house, 58, WALL_TY + 3, 1, -1);
    run(w, 3);
    expect(w.target[u]).toBe(e);
  });

  describe('待命的远程只在那座据点正处于交战状态时才主动去', () => {
    it('据点平静：城头有看得见的敌方弓手、在 wallSeek 以内，待命的也不去', () => {
      const { w, e, u, site } = scene({ fight: false });
      const r = watch(w, u, e, 10);
      expect(fightState(w, site).fighting).toBe(false);
      expect(w.target[e], '城头的敌兵没有在打任何人').toBe(NONE);
      expect(w.seen[e] & 2, '看得见').toBe(2);
      expect(r.targeted).toBe(false);
      expect(r.away).toBeLessThan(5);
      expect(damaged(w, e)).toBe(0);
    });

    it('据点范围里有了我方的兵（据点转入交战）：去', () => {
      const { w, e, u, site } = scene({ fight: false });
      watch(w, u, e, 3);
      expect(w.target[u]).toBe(NONE);
      intrude(w);
      const r = watch(w, u, e, 12);
      expect(fightState(w, site).fighting).toBe(true);
      expect(r.targeted).toBe(true);
      expect(damaged(w, e)).toBeGreaterThan(0);
    });

    it('据点的建筑刚挨过打（据点转入交战）：去', () => {
      const { w, e, u, site } = scene({ fight: false });
      hitSite(w, site);
      const r = watch(w, u, e, 12);
      expect(r.targeted).toBe(true);
      expect(damaged(w, e)).toBeGreaterThan(0);
    });

    it('据点从交战转为平静（建筑 bldCalm 秒没挨打）：还在半路的放手，回岗位', () => {
      const { w, e, u, site } = scene({ fight: false });
      const home = { x: w.x[u], y: w.y[u] };
      w.orderStop([u], true);
      hitSite(w, site);
      run(w, RULES.site.bldCalm - 3);
      expect(fightState(w, site).fighting).toBe(true);
      // 改成待命：接近的路程远不止 3 秒，走到半路据点就平静了
      w.orderStop([u], false);
      expect(watch(w, u, e, 1).targeted, '先是去了').toBe(true);
      const r = watch(w, u, e, 30);
      expect(fightState(w, site).fighting).toBe(false);
      expect(w.target[u]).toBe(NONE);
      expect(damaged(w, e), '没走到开火的地方').toBe(0);
      expect(r.nearest).toBeGreaterThan(UNIT_BY_KEY.nu.acq);
      expect(Math.hypot(w.x[u] - home.x, w.y[u] - home.y), '回到岗位').toBeLessThan(40);
    });

    it('攻击移动途中的远程：据点平静也去', () => {
      const { w, e, u, site } = scene({ fight: false });
      w.orderMove([u], C + 700, w.y[u], true);
      const r = watch(w, u, e, 12);
      expect(fightState(w, site).fighting).toBe(false);
      expect(r.targeted).toBe(true);
      expect(damaged(w, e)).toBeGreaterThan(0);
    });
  });

  describe('据点平静时，待命的远程回击正在打我方的人的墙顶敌兵', () => {
    /** 一个我方站定的步兵站在据点范围之外、城头弓手的射程之内：被射，但不会让据点转入交战 */
    const bait = (w: World): number => {
      const q = w.spawnUnit(idx('dao'), 1, C - 100, FY + 190);
      w.hp[q] = w.maxHp[q] = 1e7;
      w.orderStop([q], true);
      return q;
    };

    it('前提：被射的那个人在据点范围之外，据点保持平静', () => {
      const { w, e, site } = scene({ fight: false });
      const q = bait(w);
      run(w, 4);
      expect(w.target[e], '城头的敌兵在打它').toBe(q);
      expect(siteContains(site, w.x[q], w.y[q])).toBe(false);
      expect(fightState(w, site).fighting).toBe(false);
    });

    it('敌兵正以我方的人为目标：离它在 wallSeek 以内的待命远程去打它，据点仍平静', () => {
      const { w, e, u, site } = scene({ fight: false });
      bait(w);
      const r = watch(w, u, e, 12);
      expect(fightState(w, site).fighting).toBe(false);
      expect(r.targeted).toBe(true);
      expect(damaged(w, e)).toBeGreaterThan(0);
    });

    it('追到一半它不再打我方的人、据点又平静：放手回岗位', () => {
      const { w, e, u, site } = scene({ fight: false, gap: RULES.combat.wallSeek - 100 });
      const q = bait(w);
      const home = { x: w.x[u], y: w.y[u] };
      expect(watch(w, u, e, 2).targeted, '先是去了').toBe(true);
      w.removeUnit(q);
      const r = watch(w, u, e, 40);
      expect(fightState(w, site).fighting).toBe(false);
      expect(w.target[e], '它没有目标了').toBe(NONE);
      expect(w.target[u]).toBe(NONE);
      expect(damaged(w, e), '没走到开火的地方').toBe(0);
      expect(r.nearest).toBeGreaterThan(UNIT_BY_KEY.nu.acq);
      expect(Math.hypot(w.x[u] - home.x, w.y[u] - home.y), '回到岗位').toBeLessThan(40);
    });
  });

  describe('挑中之后复核：落点变得不该去了就放手', () => {
    const gap = RULES.combat.wallSeek - 100;
    const reachRow = WALL_TY + 7;
    /** 接近途中（目标仍在平时的索敌范围之外）：返回此刻 u 是否盯着 e */
    const approaching = (w: World, u: number, e: number): boolean => {
      run(w, 2);
      return w.target[u] === e && Math.hypot(w.x[u] - w.x[e], w.y[u] - w.y[e]) > UNIT_BY_KEY.nu.acq + 100;
    };

    it.each([
      ['冒出一座敌方箭塔，落点进了它的射程', (w: World) => { w.addBuilding(BUILDINGS.watchtower, 64, reachRow + 2, 2, -1); }],
      ['落点那里变得走不通', (w: World) => {
        for (let tx = 20; tx <= 100; tx++) for (const ty of [reachRow, reachRow + 1]) w.addBuilding(BUILDINGS.wall, tx, ty, 2, -1);
      }],
    ])('待命的：途中%s，放手回岗位，不会顶到墙根', (_name, change) => {
      const { w, e, u } = scene({ gap });
      const home = { x: w.x[u], y: w.y[u] };
      expect(approaching(w, u, e), '先是朝它去了').toBe(true);
      change(w);
      const r = watch(w, u, e, 40);
      expect(w.target[u]).toBe(NONE);
      expect(damaged(w, e)).toBe(0);
      expect(r.nearest, '没走到开火的地方').toBeGreaterThan(UNIT_BY_KEY.nu.acq);
      expect(Math.hypot(w.x[u] - home.x, w.y[u] - home.y), '回到岗位').toBeLessThan(40);
    });

    it('攻击移动的：途中冒出箭塔，放手后继续往目的地走', () => {
      const { w, e, u } = scene({ gap });
      w.orderMove([u], C + 900, w.y[u], true);
      expect(approaching(w, u, e), '先是朝它去了').toBe(true);
      w.addBuilding(BUILDINGS.watchtower, 64, reachRow + 2, 2, -1);
      const x1 = w.x[u];
      const r = watch(w, u, e, 6);
      expect(r.targeted && w.target[u] === e, '放手了').toBe(false);
      expect(damaged(w, e)).toBe(0);
      expect(r.nearest).toBeGreaterThan(UNIT_BY_KEY.nu.acq);
      expect(w.x[u] - x1, '继续往目的地走').toBeGreaterThan(40);
    });

    it('挑中时记下目标：wallUid 就是它的 uid', () => {
      const { w, e, u } = scene({ gap });
      expect(w.wallUid[u]).toBe(0);
      expect(approaching(w, u, e)).toBe(true);
      expect(w.wallUid[u]).toBe(w.uid[e]);
    });

    it('目标清空：记录随之清掉，不论这一帧是不是索敌的那一帧', () => {
      const { w, u } = scene({ fight: false, spot: false });
      w.orderStop([u], false);
      for (let k = 0; k < 8; k++) {
        w.wallUid[u] = 77;
        w.tick();
        w.fxN = 0;
        expect(w.target[u]).toBe(NONE);
        expect(w.wallUid[u], `第 ${k} 帧`).toBe(0);
      }
    });

    it('攻击移动的：墙顶只有目标这一个敌兵，它下墙进城、直线不通：放手，继续往目的地走，不会追到墙根', () => {
      const { w, e, u } = scene({ gap });
      w.orderMove([u], C + 900, w.y[u], true);
      expect(approaching(w, u, e), '先是朝它去了').toBe(true);
      let onWall = 0;
      for (let i = 0; i < w.n; i++) if (w.alive[i] && w.team[i] === 2 && w.state[i] & S_WALL) onWall++;
      expect(onWall, '墙顶只有它一个').toBe(1);
      // 下墙进城，在城里靠北的地方站定：走到射程的那一点在城里，直线被城墙挡住
      w.x[e] = FX;
      w.y[e] = 45 * TILE;
      const x1 = w.x[u];
      const r = watch(w, u, e, 8);
      expect(w.state[e] & S_WALL).toBe(0);
      expect(w.target[u]).not.toBe(e);
      expect(w.wallUid[u]).toBe(0);
      expect(r.nearest, '没有顶到墙根').toBeGreaterThan(UNIT_BY_KEY.nu.acq);
      expect(w.x[u] - x1, '继续往目的地走').toBeGreaterThan(40);
    });

    it('攻击移动的：目标下了墙、走到城外开阔处，直线可通、落点没问题：不放手，照常追着打；记录清掉', () => {
      const { w, e, u } = scene({ gap });
      w.orderMove([u], C + 900, w.y[u], true);
      expect(approaching(w, u, e), '先是朝它去了').toBe(true);
      // 下墙，站到墙外南面的空地上（仍在弩兵前方）
      w.x[e] = FX;
      w.y[e] = FY + 450;
      run(w, 1);
      expect(w.state[e] & S_WALL).toBe(0);
      expect(w.target[u], '照旧盯着它').toBe(e);
      expect(w.wallUid[u], '不再按墙顶敌兵复核').toBe(0);
      const r = watch(w, u, e, 12);
      expect(damaged(w, e), '追上去打了').toBeGreaterThan(0);
      expect(r.nearest).toBeLessThanOrEqual(UNIT_BY_KEY.nu.main.range + 40);
    });
  });

  describe('据点里待命的守军不被拉去打别处墙顶的敌兵', () => {
    /** 己方营寨（两座对角的木栅围出矩形，没有城墙可上）围着 u 的出发点；mine：是否真摆这座营寨 */
    const camp = (mine: boolean) => scene({
      before: w => {
        if (!mine) return;
        const s = w.addSite(SITE_CAMP, '我营', C, C + 3000, 1);
        const cx = (C / TILE) | 0, cy = ((FY + 700) / TILE) | 0;
        for (const [tx, ty] of [[cx - 5, cy - 5], [cx + 5, cy + 5]]) s.buildings.push(w.addBuilding(BUILDINGS.palisade, tx, ty, 1, s.id).id);
      },
    });

    it('对照：不在据点里的同一个人，同一个位置，会去', () => {
      const { w, e, u } = camp(false);
      expect(watch(w, u, e, 25).targeted).toBe(true);
      expect(w.sheltered[u]).toBe(0);
    });

    it('在据点里待命的远程不去', () => {
      const { w, e, u } = camp(true);
      const r = watch(w, u, e, 25);
      expect(w.sheltered[u], '在自家据点里').toBe(1);
      expect(Math.hypot(w.x[e] - w.x[u], w.y[e] - w.y[u]), '敌兵在据点警戒距离之外').toBeGreaterThan(RULES.site.alarm);
      expect(r.targeted).toBe(false);
      expect(damaged(w, e)).toBe(0);
    });
  });

  it('平地上没有敌兵登墙时，待命的远程对索敌范围外的地面敌兵仍不追', () => {
    const w = flatWorld();
    const foe = w.spawnUnit(idx('dao'), 2, C, C - 450);
    w.hp[foe] = w.maxHp[foe] = 1e7;
    w.orderStop([foe], true);
    w.addBuilding(BUILDINGS.house, 58, 50, 1, -1);
    const u = w.spawnUnit(idx('nu'), 1, C, C);
    w.hp[u] = w.maxHp[u] = 1e7;
    const r = watch(w, u, foe, 10);
    expect(w.seen[foe] & 2, '己方看得见它').toBe(2);
    expect(r.targeted).toBe(false);
    expect(r.away).toBeLessThan(5);
    expect(1e7 - w.hp[foe]).toBe(0);
  });
});

describe('近战武器的攻击距离：长兵器隔一段距离出手', () => {
  const contact = RULES.combat.meleeContact;
  const reach = contact + STEP.reach;
  /** 血量充裕、原地坚守的敌方靶子（队伍 2）。血量不能取得太大，float32 装不下一次出手的损伤 */
  const puppet = (w: World, x: number, y: number, key = 'dao'): number => {
    const e = w.spawnUnit(idx(key), 2, x, y);
    w.hp[e] = w.maxHp[e] = 1e5;
    w.orderStop([e], true);
    return e;
  };
  const ally = (w: World, x: number, y: number, key: string): number => {
    const u = w.spawnUnit(idx(key), 1, x, y);
    w.hp[u] = w.maxHp[u] = 1e5;
    return u;
  };
  /** 两人身体边缘的间距（沿 x 轴摆的） */
  const gap = (w: World, a: number, e: number): number => Math.hypot(w.x[e] - w.x[a], w.y[e] - w.y[a]) - w.rad[a] - w.rad[e];
  const R = UNIT_BY_KEY.dao.radius * 2;

  it('场景前提：长戟兵、足轻枪兵、辅助矛兵、持盾矛兵的攻击距离比贴身多一排，其余近战是贴身', () => {
    for (const k of ['ji', 'yari', 'auxilia', 'spara']) expect(UNIT_BY_KEY[k].main.range, k).toBe(reach);
    expect(UNIT_BY_KEY.dao.main.range).toBe(contact);
    expect(reach).toBeGreaterThan(contact);
  });

  it('间距在攻击距离以内、比贴身远：长兵器脚下不动直接出手；贴身兵种在同样的间距上要走上前去', () => {
    for (const k of ['ji', 'yari', 'auxilia', 'spara']) {
      const w = flatWorld(120, 7);
      const a = ally(w, C, C, k), e = puppet(w, C + R + 15, C);
      expect(gap(w, a, e)).toBeCloseTo(15, 9);
      const x0 = w.x[a];
      let hit = -1;
      step(w, 90, t => {
        if (hit < 0 && w.hp[e] < 1e5) hit = t;
      });
      expect(hit, k).toBeGreaterThanOrEqual(0);
      expect(hit, k).toBeLessThan(45);
      expect(Math.abs(w.x[a] - x0), k).toBeLessThan(0.5);
    }
    const w = flatWorld(120, 7);
    const a = ally(w, C, C, 'dao'), e = puppet(w, C + R + 15, C);
    const x0 = w.x[a];
    step(w, 90);
    expect(w.x[a] - x0).toBeGreaterThan(3);
    expect(gap(w, a, e)).toBeLessThanOrEqual(contact + 1);
    expect(w.hp[e]).toBeLessThan(1e5);
  });

  it('接敌时进了攻击距离就停下出手：第一次出手时的间距在攻击距离附近（比贴身远得多）；贴身兵种出手时贴着对方', () => {
    const at = (key: string): number => {
      const w = flatWorld(120, 7);
      const a = ally(w, C, C, key), e = puppet(w, C + R + 100, C);
      w.orderMove([a], C + 500, C, true);
      let g = -1;
      step(w, 200, () => {
        if (g < 0 && w.hp[e] < 1e5) g = gap(w, a, e);
      });
      return g;
    };
    const long = at('yari'), short = at('dao');
    expect(long).toBeGreaterThan(contact + 8);
    expect(long).toBeLessThanOrEqual(reach + 1);
    expect(short).toBeGreaterThanOrEqual(0);
    expect(short).toBeLessThanOrEqual(contact + 1);
  });

  it('隔着一个自己人也能出手，不用贴上去：自己人在中间不动，长兵器站在后面照样打到敌人', () => {
    const w = flatWorld(120, 7);
    const e = puppet(w, C + 100, C);
    const front = ally(w, C + 100 - R - contact, C, 'dao');
    // 前排的自己人压住出手，免得伤害分不清是谁打的
    w.cd[front] = 1e9;
    const back = ally(w, C + 100 - R - contact - 13, C, 'yari');
    expect(gap(w, back, e)).toBeGreaterThan(contact);
    expect(gap(w, back, e)).toBeLessThanOrEqual(reach);
    const x0 = w.x[back];
    step(w, 60);
    expect(w.hp[e]).toBeLessThan(1e5);
    expect(Math.abs(w.x[back] - x0)).toBeLessThan(1);
  });

  describe('超出贴身的那一段要与目标之间直线可通', () => {
    /** 长兵器与敌人隔着一格矿山，间距在攻击距离以内（21）、比贴身远；wall 为假时没有墙 */
    const scene = (wall: boolean) => {
      const w = flatWorld(120, 7, (t, n) => {
        if (wall) for (let y = 44; y <= 76; y++) t[y * n + 60] = T_MOUNTAIN;
      });
      const a = ally(w, 60 * TILE - 0.5, C, 'yari'), e = puppet(w, 61 * TILE + 0.5, C);
      return { w, a, e };
    };

    it('隔着墙：间距虽在攻击距离以内，够不着，几秒内敌人不掉血；去掉墙就打得到', () => {
      const open = scene(false);
      expect(gap(open.w, open.a, open.e)).toBeGreaterThan(contact);
      expect(gap(open.w, open.a, open.e)).toBeLessThanOrEqual(reach);
      expect(open.w.lineBlocked(open.w.x[open.a], open.w.y[open.a], open.w.x[open.e], open.w.y[open.e], 1)).toBe(false);
      step(open.w, 90);
      expect(open.w.hp[open.e]).toBeLessThan(1e5);
      const { w, a, e } = scene(true);
      expect(gap(w, a, e)).toBeLessThanOrEqual(reach);
      expect(w.lineBlocked(w.x[a], w.y[a], w.x[e], w.y[e], 1)).toBe(true);
      step(w, 90);
      expect(w.hp[e]).toBe(1e5);
    });
  });

  describe('冲锋中只按贴身距离算够不够得着', () => {
    const charge = (charging: boolean) => {
      const cav = variant(BASE.cav, { reach: 1 });
      expect(cav.main.range).toBe(reach);
      const w = flatWorld(120, 7);
      const a = w.spawnUnit(cav.idx, 1, C, C);
      w.hp[a] = w.maxHp[a] = 1e5;
      const e = puppet(w, C + 300, C);
      if (!charging) w.chargeCd[a] = 1e9;
      w.orderMove([a], C + 700, C, true);
      let minCharging = Infinity, first = -1, charged = false;
      step(w, 200, () => {
        const g = gap(w, a, e);
        if (w.state[a] & S_CHARGE) {
          charged = true;
          minCharging = Math.min(minCharging, g);
        }
        if (first < 0 && w.hp[e] < 1e5) first = g;
      });
      return { charged, minCharging, first };
    };

    it('冲锋的骑兵不在攻击距离处停下，冲到贴身才出手；不冲锋的同款骑兵在攻击距离处出手', () => {
      const c = charge(true);
      expect(c.charged).toBe(true);
      expect(c.minCharging).toBeLessThanOrEqual(contact);
      expect(c.first).toBeLessThanOrEqual(contact + 1);
      const n = charge(false);
      expect(n.charged).toBe(false);
      expect(n.first).toBeGreaterThan(contact + 8);
      expect(n.first).toBeLessThanOrEqual(reach + 1);
    });
  });

  describe('隔着贴身距离出手的长兵器不算钉在战位上', () => {
    it('叠在自己人身上时照常被推开：前排自己人站定出手，叠上来的长兵器被推到不重叠为止', () => {
      const w = flatWorld(120, 7);
      const e = puppet(w, C + 100, C);
      const front = ally(w, C + 100 - R - contact, C, 'dao');
      const back = ally(w, C + 100 - R - contact - 8, C, 'yari');
      const dist = (): number => Math.hypot(w.x[front] - w.x[back], w.y[front] - w.y[back]);
      expect(dist()).toBeLessThan(R);
      const x0 = w.x[back];
      step(w, 30);
      expect(gap(w, back, e)).toBeGreaterThan(contact);
      expect(gap(w, back, e)).toBeLessThanOrEqual(reach);
      expect(w.x[back]).toBeLessThan(x0 - 0.5);
      expect(dist()).toBeGreaterThanOrEqual(R - 0.1);
      expect(w.hp[e]).toBeLessThan(1e5);
    });

    it('贴身出手的单位仍然钉住：站定出手后，后面挤上来的自己人推不动它', () => {
      const w = flatWorld(120, 7);
      const e = puppet(w, C + 100, C);
      const front = ally(w, C + 100 - R - 5, C, 'dao');
      ally(w, C + 100 - R - 5 - 40, C, 'dao');
      step(w, 5);
      expect(gap(w, front, e)).toBeLessThanOrEqual(contact);
      const x0 = w.x[front];
      step(w, 90);
      expect(Math.abs(w.x[front] - x0)).toBeLessThan(0.5);
      expect(w.hp[e]).toBeLessThan(1e5);
    });
  });
});

const contactOf = (): number => RULES.combat.meleeContact;
const TRAITS_AUX = { pilum: TRAITS.pilum.aux!, sidebow: TRAITS.sidebow.aux! };

describe('选武器：主武器、副武器与对建筑武器', () => {
  const puppet = (w: World, x: number, y: number): number => {
    const e = w.spawnUnit(idx('dao'), 2, x, y);
    w.hp[e] = w.maxHp[e] = 1e5;
    w.orderStop([e], true);
    return e;
  };
  const gap = (w: World, a: number, e: number): number => Math.hypot(w.x[e] - w.x[a], w.y[e] - w.y[a]) - w.rad[a] - w.rad[e];

  for (const [key, trait] of [['legion', 'pilum'], ['immortal', 'sidebow']] as const) {
    it(`${UNIT_BY_KEY[key].name}：主武器够不着就继续上前，途中副武器够得着且冷却好了就用副武器出手；主武器没有出手，副武器的冷却单独计`, () => {
      const d = UNIT_BY_KEY[key], aux = TRAITS_AUX[trait];
      const w = flatWorld(120, 7);
      const a = w.spawnUnit(d.idx, 1, C, C);
      w.hp[a] = w.maxHp[a] = 1e5;
      const e = puppet(w, C + aux.range + 80, C);
      w.orderMove([a], C + 900, C, true);
      let fired = -1, gapAtFire = 0, mainCd = 0;
      let prevAux = 0;
      for (let t = 0; t < 400 && fired < 0; t++) {
        mainCd = w.cd[a];
        w.tick();
        w.fxN = 0;
        if (w.auxCd[a] > prevAux + 0.5) {
          fired = t;
          gapAtFire = gap(w, a, e);
        }
        prevAux = w.auxCd[a];
      }
      expect(fired).toBeGreaterThanOrEqual(0);
      // 出手时离敌人还远（主武器够不着），但副武器已经够得着
      expect(gapAtFire).toBeGreaterThan(d.main.range + 20);
      expect(gapAtFire).toBeLessThanOrEqual(aux.range + 1);
      // 副武器出手没有动主武器的冷却（冷却只会往下走）
      expect(w.cd[a]).toBeLessThanOrEqual(mainCd);
      expect(w.auxCd[a]).toBeGreaterThanOrEqual(aux.cd * 0.9);
      expect(w.auxCd[a]).toBeLessThanOrEqual(aux.cd * 1.1);
      // 之后脚下继续往前走，直到主武器够得着
      const g0 = gapAtFire;
      step(w, 45);
      expect(gap(w, a, e)).toBeLessThan(g0 - 15);
    });

    it(`${UNIT_BY_KEY[key].name}：主武器够得着时站定用主武器，不用副武器`, () => {
      const d = UNIT_BY_KEY[key];
      const w = flatWorld(120, 7);
      const a = w.spawnUnit(d.idx, 1, C, C);
      w.hp[a] = w.maxHp[a] = 1e5;
      const e = puppet(w, C + d.radius * 2 + 4, C);
      expect(gap(w, a, e)).toBeLessThanOrEqual(d.main.range);
      step(w, 90);
      expect(w.auxCd[a]).toBe(0);
      expect(w.hp[e]).toBeLessThan(1e5);
    });
  }

  it('打建筑用对建筑武器：刀盾兵在火把距离处站定扔火把；战象没有对建筑武器，贴上去用主武器，也不扔火把', () => {
    const attack = (key: string) => {
      const w = flatWorld(120, 7);
      const b = w.addBuilding(BUILDINGS.outpost, 70, 58, 2, -1);
      const a = w.spawnUnit(idx(key), 1, C - 200, C);
      w.hp[a] = w.maxHp[a] = 1e5;
      w.orderAttackBuilding([a], b);
      const hp0 = b.hp;
      let torches = 0, min = Infinity;
      step(w, 400, () => {
        for (let p = 0; p < w.pn; p++) if (w.pType[p] === P_TORCH) torches++;
        min = Math.min(min, b.x0 - w.x[a] - w.rad[a]);
      });
      return { torches, min, lost: hp0 - b.hp };
    };
    const dao = attack('dao'), el = attack('elephant');
    expect(dao.torches).toBeGreaterThan(0);
    expect(dao.lost).toBeGreaterThan(0);
    expect(dao.min).toBeGreaterThan(contactOf() + 20);
    expect(dao.min).toBeLessThanOrEqual(RULES.siege.torchRange + 1);
    expect(el.torches).toBe(0);
    expect(el.lost).toBeGreaterThan(0);
    expect(el.min).toBeLessThanOrEqual(contactOf() + 2);
  });
});

describe('交手状态：没交手、肉搏、隔着贴身距离出手', () => {
  const contact = RULES.combat.meleeContact;
  const puppet = (w: World, x: number, y: number, key = 'dao'): number => {
    const e = w.spawnUnit(idx(key), 2, x, y);
    w.hp[e] = w.maxHp[e] = 1e5;
    w.orderStop([e], true);
    return e;
  };
  const ally = (w: World, x: number, y: number, key: string): number => {
    const u = w.spawnUnit(idx(key), 1, x, y);
    w.hp[u] = w.maxHp[u] = 1e5;
    return u;
  };
  const R = UNIT_BY_KEY.dao.radius * 2;

  it('三种状态的取值：没交手是 0，肉搏与隔着贴身距离出手都非 0 且互不相同', () => {
    expect(ENG_NONE).toBe(0);
    expect(ENG_CLOSE).not.toBe(ENG_NONE);
    expect(ENG_REACH).not.toBe(ENG_NONE);
    expect(ENG_CLOSE).not.toBe(ENG_REACH);
  });

  it('远处没敌人是没交手；贴身出手是肉搏；长兵器在比贴身远的间距出手是隔着贴身距离出手；长兵器贴到贴身距离内出手则是肉搏', () => {
    const w = flatWorld(120, 7);
    const lone = ally(w, C - 500, C, 'yari');
    const e = puppet(w, C + 200, C);
    const dao = ally(w, C + 200 - R - 5, C, 'dao');
    const e2 = puppet(w, C + 200, C - 300);
    const yari = ally(w, C + 200 - R - 15, C - 300, 'yari');
    const e3 = puppet(w, C + 200, C + 300);
    const close = ally(w, C + 200 - R - 4, C + 300, 'yari');
    step(w, 90);
    expect(w.engaged[lone]).toBe(ENG_NONE);
    expect(w.engaged[dao]).toBe(ENG_CLOSE);
    expect(w.engaged[yari]).toBe(ENG_REACH);
    expect(w.engaged[close]).toBe(ENG_CLOSE);
    // 目标都被打到了
    for (const t of [e, e2, e3]) expect(w.hp[t]).toBeLessThan(1e5);
  });

  describe('围攻人数：只算会去贴身的近战', () => {
    /** 靶子在 (C, C)，围着它的是 key 兵种：贴身（间距 5）或隔着贴身距离（间距 15），各 3 个 */
    const crowdOf = (key: string, gapPx: number): { w: World; foe: number; units: number[] } => {
      const w = flatWorld(120, 7);
      const foe = puppet(w, C, C);
      const dist = R + gapPx;
      const units = [[-dist, 0], [-dist * 0.8, dist * 0.6], [-dist * 0.8, -dist * 0.6]].map(([dx, dy]) => ally(w, C + dx, C + dy, key));
      step(w, 30);
      return { w, foe, units };
    };

    it('贴身肉搏的近战都计入目标的围攻人数', () => {
      const { w, foe, units } = crowdOf('dao', 4);
      for (const u of units) expect(w.engaged[u]).toBe(ENG_CLOSE);
      expect(w.crowd[foe]).toBe(3);
    });

    it('隔着贴身距离出手的长兵器不计入目标的围攻人数', () => {
      const { w, foe, units } = crowdOf('yari', 14);
      for (const u of units) {
        expect(w.target[u]).toBe(foe);
        expect(w.engaged[u]).toBe(ENG_REACH);
      }
      expect(w.crowd[foe]).toBe(0);
    });

    it('同一个目标上，贴身的计、隔排的不计：一个贴身加两个隔排，围攻人数是 1', () => {
      const w = flatWorld(120, 7);
      const foe = puppet(w, C, C);
      const near = ally(w, C - R - 4, C, 'dao');
      const far1 = ally(w, C + R + 14, C, 'yari'), far2 = ally(w, C, C - R - 14, 'yari');
      step(w, 30);
      expect([w.engaged[near], w.engaged[far1], w.engaged[far2]]).toEqual([ENG_CLOSE, ENG_REACH, ENG_REACH]);
      expect(w.crowd[foe]).toBe(1);
    });
  });

  describe('举盾：隔排出手不算肉搏', () => {
    const shooter = (w: World, x: number, y: number): number => {
      const e = puppet(w, x, y, 'nu');
      w.cd[e] = 1e9;
      return e;
    };

    it('后排隔着贴身距离出手的举盾长兵器（辅助矛兵、持盾矛兵）看到远程敌人就举盾；贴身肉搏的举盾兵腾不出手', () => {
      for (const k of ['auxilia', 'spara']) {
        const w = flatWorld(120, 7);
        // 最近的敌人是不出手的弩兵：长兵器在它的攻击距离内，近战的盾兵则贴着它
        shooter(w, C + R + 15, C);
        const back = ally(w, C, C, k);
        shooter(w, C + R + 4, C + 400);
        const front = ally(w, C, C + 400, 'dao');
        step(w, 30);
        expect(w.engaged[back], k).toBe(ENG_REACH);
        expect(w.engaged[front], k).toBe(ENG_CLOSE);
        expect(w.state[back] & S_SHIELD, k).toBe(S_SHIELD);
        expect(w.state[front] & S_SHIELD, k).toBe(0);
      }
    });

    it('挨了远程伤害：隔排出手的举盾长兵器举盾，举着时远程伤害按举盾减免；贴身肉搏的仍然举不了', () => {
      const w = flatWorld(120, 7);
      const foe = puppet(w, C + R + 15, C);
      const back = ally(w, C, C, 'spara');
      const foe2 = puppet(w, C + R + 4, C + 400);
      const front = ally(w, C, C + 400, 'dao');
      w.cd[foe] = w.cd[foe2] = 1e9;
      step(w, 30);
      expect([w.engaged[back], w.engaged[front]]).toEqual([ENG_REACH, ENG_CLOSE]);
      expect([w.shieldT[back], w.shieldT[front]]).toEqual([0, 0]);
      const archer = w.spawnUnit(idx('nu'), 2, C + 150, C - 200);
      w.hp[archer] = w.maxHp[archer] = 1e5;
      damageUnit(w, back, 10, 1, 0, null, 2, archer);
      damageUnit(w, front, 10, 1, 0, null, 2, archer);
      expect(w.shieldT[back]).toBeGreaterThan(0);
      expect(w.shieldT[front]).toBe(0);
      // 举着盾时受到的远程伤害按举盾减免
      w.tick();
      w.fxN = 0;
      expect(w.state[back] & S_SHIELD).toBe(S_SHIELD);
      const block = UNIT_BY_KEY.spara.abilities.shield!.block;
      const lose = (): number => {
        const h = w.hp[back];
        damageUnit(w, back, 10, 1, 0, null, 2, archer);
        const l = h - w.hp[back];
        w.hp[back] = h;
        return l;
      };
      const shielded = lose();
      w.state[back] &= ~S_SHIELD;
      const bare = lose();
      expect(shielded / bare).toBeCloseTo(1 - block, 3);
    });
  });
});

describe('近战挤不到自己挑中的建筑跟前：放下它接着执行原来的命令，不在后面列队等', () => {
  const FOR = RULES.combat.bldSkipFor, SPREAD = RULES.combat.bldSkipSpread;

  /** 一次放下：哪个单位、哪一帧、放下那一帧的状态 */
  interface Drop { s: number; t: number; v: number; target: number; waitT: number; bld: number }

  /**
   * 100 个血量无限的己方 dao 排成 10 列的密集方阵（站在建筑的索敌范围内），跑 secs 秒；
   * 逐帧记录每个单位跳过倒计时从非正变正的那一帧（放下的瞬间）、期间有没有单位在列队等。
   * track 每帧调用一次，供各用例额外记录。
   */
  const crowd = (w: World, us: number[], secs: number, track?: (t: number) => void) => {
    const drops: Drop[] = [];
    const prev = new Map<number, number>();
    let waiting = 0;
    step(w, secs * 30, t => {
      for (const s of us) {
        if ((prev.get(s) ?? 0) <= 0 && w.bldSkipT[s] > 0) {
          drops.push({ s, t, v: w.bldSkipT[s], target: w.target[s], waitT: w.waitT[s], bld: w.bldSkip[s] });
        }
        prev.set(s, w.bldSkipT[s]);
        if (w.waitT[s] > 0) waiting++;
      }
      track?.(t);
    });
    return { drops, waiting };
  };
  const block = (w: World, x0: number, y0: number, step: number, n = 100): number[] => {
    const us: number[] = [];
    for (let k = 0; k < n; k++) us.push(mine(w, mid(x0 + (k % 10) * step), mid(y0 + Math.floor(k / 10) * step)));
    return us;
  };

  describe('攻击移动：建筑在路线旁边', () => {
    // 敌方行营在 (70..71, 52..53)，方阵从 (45, 56) 起往东南的 (100, 62) 攻击移动；路线从行营南面过去，不穿过它
    const scene = () => {
      const w = flatWorld(120, 7);
      const b = w.addBuilding(BUILDINGS.outpost, 70, 52, 2, -1);
      const us = block(w, 45, 56, 0.7);
      w.orderMove(us, mid(100), mid(62), true);
      return { w, b, us, bid: -b.id - 2 };
    };

    it('有人挤不到跟前：放下它（target 变回 NONE），当帧没有列队等，记下放下的是哪一座', () => {
      const { w, b, us } = scene();
      const { drops } = crowd(w, us, 40);
      expect(drops.length, '场景前提：有人被挤得放下了').toBeGreaterThan(0);
      for (const dr of drops) {
        expect(dr.target).toBe(NONE);
        expect(dr.waitT).toBeLessThanOrEqual(0);
        expect(dr.bld).toBe(b.id);
      }
    });

    it('成片的人不再等在建筑后面：全程没有任何单位在列队等', () => {
      const { w, us } = scene();
      expect(crowd(w, us, 40).waiting).toBe(0);
    });

    it('放下后的跳过时长落在 [bldSkipFor, bldSkipFor + bldSkipSpread)，不同的人时长不全相同', () => {
      const { w, us } = scene();
      const { drops } = crowd(w, us, 40);
      expect(drops.length).toBeGreaterThan(0);
      for (const dr of drops) {
        expect(dr.v).toBeGreaterThanOrEqual(FOR);
        expect(dr.v).toBeLessThan(FOR + SPREAD);
      }
      expect(new Set(drops.map(dr => dr.v)).size).toBeGreaterThan(1);
    });

    it('跳过期间放下它的人不再挑这座建筑', () => {
      const { w, us, b, bid } = scene();
      let again = false;
      crowd(w, us, 40, () => {
        for (const s of us) if (w.bldSkipT[s] > 0 && w.bldSkip[s] === b.id && w.target[s] === bid) again = true;
      });
      expect(again).toBe(false);
    });

    it('放下后接着往目的地走：命令仍是攻击移动，最后离目的地比放下那一刻近得多', () => {
      const { w, us } = scene();
      const dest = (s: number): number => Math.hypot(w.x[s] - mid(100), w.y[s] - mid(62));
      const at = new Map<number, number>();
      const prev = new Set<number>();
      const orders = new Set<number>();
      crowd(w, us, 40, () => {
        for (const s of us) {
          if (w.bldSkipT[s] > 0 && !prev.has(s)) {
            prev.add(s);
            at.set(s, dest(s));
            orders.add(w.order[s]);
          }
        }
      });
      expect(at.size, '场景前提：有人放下了').toBeGreaterThan(0);
      expect([...orders]).toEqual([O_AMOVE]);
      for (const [s, d0] of at) expect(dest(s), `slot ${s}`).toBeLessThan(d0 - 100);
    });
  });

  describe('待命：建筑在岗位旁边', () => {
    // 方阵在 (46, 58) 起待命，敌方行营在 (53..54, 56..57)，全在待命的索敌范围内
    const scene = () => {
      const w = flatWorld(120, 7);
      const b = w.addBuilding(BUILDINGS.outpost, 53, 56, 2, -1);
      const us = block(w, 46, 58, 0.5);
      return { w, b, us, bid: -b.id - 2 };
    };

    it('有人挤不到跟前：放下它、不列队等；全程没有人在列队等', () => {
      const { w, b, us } = scene();
      const { drops, waiting } = crowd(w, us, 40);
      expect(drops.length, '场景前提：有人被挤得放下了').toBeGreaterThan(0);
      for (const dr of drops) {
        expect(dr.target).toBe(NONE);
        expect(dr.waitT).toBeLessThanOrEqual(0);
        expect(dr.bld).toBe(b.id);
        expect(dr.v).toBeGreaterThanOrEqual(FOR);
        expect(dr.v).toBeLessThan(FOR + SPREAD);
      }
      expect(waiting).toBe(0);
    });

    it('放下后回岗位：命令仍是待命，跳过期间不再挑这座，最后站回岗位附近', () => {
      const { w, us, b, bid } = scene();
      const home = new Map(us.map(s => [s, [w.homeX[s], w.homeY[s]]]));
      let again = false;
      const dropped = new Set<number>();
      crowd(w, us, 40, () => {
        for (const s of us) {
          if (w.bldSkipT[s] > 0) dropped.add(s);
          if (w.bldSkipT[s] > 0 && w.bldSkip[s] === b.id && w.target[s] === bid) again = true;
        }
      });
      expect(dropped.size).toBeGreaterThan(0);
      expect(again).toBe(false);
      for (const s of dropped) {
        expect(w.order[s]).toBe(O_IDLE);
        const [hx, hy] = home.get(s)!;
        expect(Math.hypot(w.x[s] - hx, w.y[s] - hy), `slot ${s}`).toBeLessThan(80);
      }
    });
  });

  describe('不放下的情形：照旧原地列队等', () => {
    it('玩家右键指定攻打的建筑（O_ATTACK）：挤不到跟前的人（「追不上」计时远超 blockedAfter）也不放下它，一直盯着打', () => {
      const w = flatWorld(120, 7);
      const b = w.addBuilding(BUILDINGS.outpost, 53, 56, 2, -1);
      // 血量取得很大，建筑在测试期间不会倒
      b.hp = b.maxHp = 1e9;
      const us = block(w, 46, 58, 0.5);
      w.orderAttackBuilding(us, b);
      const { drops } = crowd(w, us, 20);
      const crowded = us.filter(s => w.stuck[s] > RULES.combat.blockedAfter * 2);
      expect(crowded.length, '场景前提：有人被挤在后面够不着').toBeGreaterThan(0);
      expect(drops).toHaveLength(0);
      for (const s of us) {
        expect(w.bldSkipT[s]).toBe(0);
        expect(w.order[s]).toBe(O_ATTACK);
        expect(w.target[s]).toBe(-b.id - 2);
      }
    });

    it('挡在路线上的建筑（整行木栅里的一座营门）：攻击移动的人挤不到它跟前时列队等，不放下', () => {
      const w = flatWorld(120, 7);
      for (let tx = 0; tx < 120; tx++) if (tx < 59 || tx > 60) w.addBuilding(BUILDINGS.palisade, tx, 70, 2, -1);
      const gate = w.addBuilding(BUILDINGS.wgate_h, 59, 70, 2, -1);
      const us: number[] = [];
      for (let k = 0; k < 100; k++) us.push(mine(w, mid(54 + (k % 12) * 0.9), mid(50 + Math.floor(k / 12))));
      w.orderMove(us, mid(60), mid(100), true);
      let onGate = false;
      const { drops, waiting } = crowd(w, us, 40, () => {
        for (const s of us) if (w.target[s] === -gate.id - 2) onGate = true;
      });
      expect(onGate, '场景前提：有人去打挡路的营门').toBe(true);
      expect(waiting, '场景前提：有人挤不到营门跟前、列队等').toBeGreaterThan(0);
      expect(drops).toHaveLength(0);
    });
  });

  it('远程单位不受影响：攻击移动路过敌方行营，没有人记下放下的建筑', () => {
    const w = flatWorld(120, 7);
    w.addBuilding(BUILDINGS.outpost, 70, 52, 2, -1);
    const us: number[] = [];
    for (let k = 0; k < 100; k++) us.push(mine(w, mid(45 + (k % 10) * 0.7), mid(56 + Math.floor(k / 10) * 0.8), 'nu'));
    w.orderMove(us, mid(100), mid(62), true);
    expect(crowd(w, us, 40).drops).toHaveLength(0);
  });

  describe('两座可打的建筑挨在一起（相距约 3 格，血量无限）：不在它们之间来回跑', () => {
    /** 每人整段时间里放下建筑的次数上限，以及全体的平均上限：来回倒腾的话每人每几秒就放下一次，远超这个数 */
    const MAX_DROPS = 20, MEAN_DROPS = 8;
    const SECS = 60;
    const forever = (b: { hp: number; maxHp: number }): void => {
      b.hp = b.maxHp = 1e9;
    };

    /**
     * 跑 SECS 秒，逐帧记录：每人放下建筑的次数（跳过倒计时被重新设置的次数）、
     * 进入「什么建筑都不挑」状态（BLD_SKIP_ALL）的那一刻的倒计时、这个状态下有没有人手里盯着建筑
     */
    const watch = (w: World, us: number[]) => {
      const drops = new Map<number, number>();
      const prevT = new Map<number, number>();
      const allSpans: number[] = [];
      let targetedInAll = false;
      step(w, SECS * 30, () => {
        for (const s of us) {
          const t = w.bldSkipT[s], was = prevT.get(s) ?? 0;
          if (t > was + 0.5) {
            drops.set(s, (drops.get(s) ?? 0) + 1);
            if (w.bldSkip[s] === BLD_SKIP_ALL) allSpans.push(t);
          }
          if (t > 0 && w.bldSkip[s] === BLD_SKIP_ALL && w.target[s] < NONE) targetedInAll = true;
          prevT.set(s, t);
        }
      });
      const counts = us.map(s => drops.get(s) ?? 0);
      return {
        max: Math.max(...counts),
        mean: counts.reduce((a, b) => a + b, 0) / us.length,
        total: counts.reduce((a, b) => a + b, 0),
        allSpans, targetedInAll,
      };
    };
    const meanTo = (w: World, us: number[], x: number, y: number): number => us.reduce((a, s) => a + Math.hypot(w.x[s] - x, w.y[s] - y), 0) / us.length;

    /** 待命：方阵在 (46, 58) 起，两座行营在 (53..54, 56..57) 与 (53..54, 59..60) */
    const idleScene = () => {
      const w = flatWorld(120, 7);
      forever(w.addBuilding(BUILDINGS.outpost, 53, 56, 2, -1));
      forever(w.addBuilding(BUILDINGS.outpost, 53, 59, 2, -1));
      return { w, us: block(w, 46, 58, 0.5) };
    };
    /** 攻击移动：方阵从 (45, 56) 起往 (100, 62)，路线旁一座或两座行营（(70, 52) 起，第二座在 (70, 55)） */
    const marchScene = (two: boolean) => {
      const w = flatWorld(120, 7);
      forever(w.addBuilding(BUILDINGS.outpost, 70, 52, 2, -1));
      if (two) forever(w.addBuilding(BUILDINGS.outpost, 70, 55, 2, -1));
      const us = block(w, 45, 56, 0.7);
      w.orderMove(us, mid(100), mid(62), true);
      return { w, us };
    };

    it('待命：每人放下建筑的次数有很小的上限，没有人在两座之间反复切换', () => {
      const { w, us } = idleScene();
      const r = watch(w, us);
      expect(r.total, '场景前提：有人放下了建筑').toBeGreaterThan(0);
      expect(r.max).toBeLessThanOrEqual(MAX_DROPS);
      expect(r.mean).toBeLessThanOrEqual(MEAN_DROPS);
    });

    it('待命：接连放下第二座时进入「什么建筑都不挑」，时长落在 [bldSkipFor, bldSkipFor + bldSkipSpread)，这期间手里不盯建筑', () => {
      const { w, us } = idleScene();
      const r = watch(w, us);
      expect(r.allSpans.length, '场景前提：有人接连两座都挤不进').toBeGreaterThan(0);
      for (const v of r.allSpans) {
        expect(v).toBeGreaterThanOrEqual(FOR);
        expect(v).toBeLessThan(FOR + SPREAD);
      }
      expect(r.targetedInAll).toBe(false);
    });

    it('待命：折腾完后大家站回岗位附近（平均离岗位不远），没有人在列队等', () => {
      const { w, us } = idleScene();
      let waiting = 0;
      step(w, SECS * 30, () => {
        for (const s of us) if (w.waitT[s] > 0) waiting++;
      });
      expect(waiting).toBe(0);
      const away = us.reduce((a, s) => a + Math.hypot(w.x[s] - w.homeX[s], w.y[s] - w.homeY[s]), 0) / us.length;
      expect(away).toBeLessThan(100);
    });

    it('攻击移动：每人放下建筑的次数有很小的上限，方阵照常前进，进度与路线旁只有一座时相差不大', () => {
      const two = marchScene(true);
      const r = watch(two.w, two.us);
      expect(r.total, '场景前提：有人放下了建筑').toBeGreaterThan(0);
      expect(r.max).toBeLessThanOrEqual(MAX_DROPS);
      expect(r.mean).toBeLessThanOrEqual(MEAN_DROPS);
      expect(r.targetedInAll).toBe(false);
      const one = marchScene(false);
      step(one.w, SECS * 30);
      const left2 = meanTo(two.w, two.us, mid(100), mid(62)), left1 = meanTo(one.w, one.us, mid(100), mid(62));
      expect(left2).toBeLessThan(left1 * 2.8);
    });
  });

  describe('跳过期间与到期', () => {
    /** 一个待命的 dao，岗位在敌方行营 A 旁边（离 A 约 2 格，够得着索敌）；B 是更远的另一座行营 */
    const scene = (withB: boolean) => {
      const w = flatWorld(120, 7);
      w.addBuilding(BUILDINGS.house, 20, 20, 1, -1);
      const a = w.addBuilding(BUILDINGS.outpost, 60, 60, 2, -1);
      const b = withB ? w.addBuilding(BUILDINGS.outpost, 60, 64, 2, -1) : null;
      const me = mine(w, a.x0 - 64, a.cy);
      return { w, me, a, b };
    };

    it('跳过期间不挑记下的那座，倒计时走完后又挑回来', () => {
      const { w, me, a } = scene(false);
      w.bldSkip[me] = a.id;
      w.bldSkipT[me] = 3;
      let early = false, back = -1;
      step(w, 30 * 8, t => {
        if (w.bldSkipT[me] > 0 && w.target[me] === -a.id - 2) early = true;
        if (back < 0 && w.target[me] === -a.id - 2) back = t;
      });
      expect(early).toBe(false);
      expect(w.bldSkipT[me]).toBeLessThanOrEqual(0);
      // 倒计时 3 秒，走完之后一轮索敌（8 帧）内挑回来
      expect(back).toBeGreaterThanOrEqual(3 * 30 - 1);
      expect(back).toBeLessThanOrEqual(3 * 30 + 12);
    });

    it('跳过期间附近别的可打的敌方建筑照常能挑', () => {
      const { w, me, a, b } = scene(true);
      w.bldSkip[me] = a.id;
      w.bldSkipT[me] = 30;
      let first = NONE;
      step(w, 30 * 2, () => {
        if (first === NONE && w.target[me] !== NONE) first = w.target[me];
      });
      expect(first).toBe(-b!.id - 2);
    });

    it('对照：没有跳过记录时先挑近的 A', () => {
      const { w, me, a } = scene(true);
      let first = NONE;
      step(w, 30 * 2, () => {
        if (first === NONE && w.target[me] !== NONE) first = w.target[me];
      });
      expect(first).toBe(-a.id - 2);
    });
  });
});
