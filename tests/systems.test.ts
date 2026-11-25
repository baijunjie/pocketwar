import { describe, expect, it } from 'vitest';
import { BUILDINGS, LEVELS, RULES, SITE_CAMP, SITE_CITY, SITE_FARM, SITE_INFO, SITE_TOWN, SIZES, TILE, T_BRIDGE, T_DEEP, T_MOUNTAIN, UNITS, UNIT_BY_KEY } from '../src/sim/defs';
import { createGame } from '../src/sim/setup';
import { damageUnit } from '../src/sim/systems/combat';
import { P_POSTED } from '../src/sim/systems/garrison';
import { SLOT, marchSlot } from '../src/sim/systems/march';
import { lightAt } from '../src/sim/systems/environment';
import { startRout } from '../src/sim/systems/morale';
import { initSupply } from '../src/sim/systems/supply';
import { S_BRACE, S_CHARGE, S_COMBAT, S_ROUT, S_SHIELD, S_TORCH, S_WALL, World } from '../src/sim/world';
import { breathe, flatWorld, run, spinStats } from './helpers';

const C = (120 * TILE) / 2;
const idx = (k: string): number => UNIT_BY_KEY[k].idx;

describe('兵种定义', () => {
  it('体型越大越慢，行军比奔跑慢；5 级攻击 ×3', () => {
    for (const d of UNITS) {
      expect(d.speed).toBe(Math.round(d.pace * SIZES[d.size].speedMul));
      expect(d.walk).toBeLessThanOrEqual(d.speed);
      expect(d.lvHp.length).toBe(LEVELS.thresholds.length);
      expect(d.lvDmg[4]).toBeCloseTo(d.lvDmg[0] * 3, 5);
      expect(d.lvRout[4]).toBeLessThan(0);
    }
    for (let i = 1; i < SIZES.length; i++) expect(SIZES[i].speedMul).toBeLessThan(SIZES[i - 1].speedMul);
    // 同样的基准机动，骑上马（中型）就比步兵（小型）慢一截
    expect(UNIT_BY_KEY.tieqi.speed / UNIT_BY_KEY.tieqi.pace).toBeLessThan(UNIT_BY_KEY.dao.speed / UNIT_BY_KEY.dao.pace);
  });

  it('默认队列：快的排在前面，器械殿后', () => {
    const w = flatWorld();
    const g = w.spawnGroup(1, [idx('pili'), idx('nu'), idx('dao'), idx('tieqi')], C, C, 1, 0);
    const xs = g.map(s => w.x[s]);
    // 朝 +X 列阵：铁骑最前，其次刀盾、弩兵，霹雳车最后
    expect(xs[3]).toBeGreaterThan(xs[2]);
    expect(xs[2]).toBeGreaterThan(xs[1]);
    expect(xs[1]).toBeGreaterThan(xs[0]);
  });
});

describe('行军与战斗状态', () => {
  it('同一道命令里的部队按最慢的行军；单独下令则各走各的', () => {
    const w = flatWorld();
    const cav = w.spawnGroup(1, [idx('tieqi')], C - 600, C - 100, 1, 0);
    const mixed = w.spawnGroup(1, [idx('tieqi'), idx('pili')], C - 600, C + 100, 1, 0);
    w.orderMove(cav, C + 900, C - 100, false);
    w.orderMove(mixed, C + 900, C + 100, false);
    run(w, 10);
    const slow = UNIT_BY_KEY.pili.walk, fast = UNIT_BY_KEY.tieqi.walk;
    expect(w.x[cav[0]] - (C - 600)).toBeGreaterThan(fast * 10 * 0.8);
    // 与霹雳车同行的铁骑没有跑到前面去
    expect(w.x[mixed[0]] - w.x[mixed[1]]).toBeLessThan(60);
    expect(w.x[mixed[0]] - (C - 600)).toBeLessThan(slow * 10 * 1.15);
    expect(w.state[cav[0]] & S_COMBAT).toBe(0);
  });

  it('发现敌人后进入战斗状态并改为奔跑', () => {
    const w = flatWorld();
    const a = w.spawnGroup(1, Array(10).fill(idx('dao')), C - 200, C, 1, 0);
    w.spawnGroup(2, Array(10).fill(idx('yari')), C + 60, C, -1, 0);
    w.orderMove(a, C + 60, C, true);
    run(w, 1);
    const s = a[0];
    expect(w.state[s] & S_COMBAT).toBe(S_COMBAT);
    expect(Math.hypot(w.vx[s], w.vy[s])).toBeGreaterThan(UNIT_BY_KEY.dao.walk * 1.1);
  });
});

describe('特殊动作', () => {
  it('骑兵远距离接敌时冲锋，撞上的敌人受到冲撞伤害', () => {
    const w = flatWorld();
    const cav = w.spawnGroup(1, Array(6).fill(idx('tieqi')), C - 300, C, 1, 0);
    const foe = w.spawnGroup(2, Array(6).fill(idx('dao')), C, C, -1, 0);
    w.orderStop(foe, true);
    w.orderMove(cav, C, C, true);
    let charged = false, top = 0;
    for (let t = 0; t < 30 * 6; t++) {
      w.tick();
      for (const s of cav) if (w.alive[s] && w.state[s] & S_CHARGE) {
        charged = true;
        top = Math.max(top, Math.hypot(w.vx[s], w.vy[s]));
      }
    }
    expect(charged).toBe(true);
    expect(top).toBeGreaterThan(UNIT_BY_KEY.tieqi.speed * 1.1);
    let hurt = 0;
    for (const s of foe) hurt += w.alive[s] ? w.maxHp[s] - w.hp[s] : w.maxHp[s];
    expect(hurt).toBeGreaterThan(UNIT_BY_KEY.tieqi.abilities.charge!.impact * 2);
    // 冲完有冷却，不会一直处于冲锋状态
    expect(cav.every(s => !w.alive[s] || !(w.state[s] & S_CHARGE))).toBe(true);
  });

  it('枪兵见骑兵冲来会立枪：骑兵撞上受伤，冲撞伤害被挡下', () => {
    const hit = (target: string): { braced: boolean; cavLoss: number; footLoss: number } => {
      const w = flatWorld();
      const cav = w.spawnGroup(1, Array(8).fill(idx('tieqi')), C - 300, C, 1, 0);
      const foot = w.spawnGroup(2, Array(8).fill(idx(target)), C, C, -1, 0);
      w.orderStop(foot, true);
      w.orderMove(cav, C, C, true);
      let braced = false;
      for (let t = 0; t < 30 * 4; t++) {
        w.tick();
        if (foot.some(s => w.alive[s] && w.state[s] & S_BRACE)) braced = true;
      }
      const loss = (g: number[]): number => g.reduce((a, s) => a + (w.alive[s] ? 1 - w.hp[s] / w.maxHp[s] : 1), 0) / g.length;
      return { braced, cavLoss: loss(cav), footLoss: loss(foot) };
    };
    const spear = hit('ji'), sword = hit('dao');
    expect(spear.braced).toBe(true);
    expect(sword.braced).toBe(false);
    expect(spear.cavLoss).toBeGreaterThan(sword.cavLoss);
  });

  it('盾兵遇到弓箭手会举盾：走得慢一些，挨的箭轻得多', () => {
    const w = flatWorld();
    const sh = w.spawnGroup(1, [idx('dao')], C - 150, C, 1, 0)[0];
    const bow = w.spawnGroup(2, Array(4).fill(idx('yumi')), C + 80, C, -1, 0);
    w.orderStop(bow, true);
    w.orderMove([sh], C + 80, C, false);
    run(w, 1.5);
    expect(w.state[sh] & S_SHIELD).toBe(S_SHIELD);
    expect(Math.hypot(w.vx[sh], w.vy[sh])).toBeLessThan(UNIT_BY_KEY.dao.speed * 0.9);
    // 没有盾的同类单位做对照：同样的箭雨下掉血更多
    const loss = (key: string): number => {
      const v = flatWorld();
      const u = v.spawnGroup(1, [idx(key)], C - 150, C, 1, 0)[0];
      v.hp[u] = v.maxHp[u] = 1e5;
      const b = v.spawnGroup(2, Array(6).fill(idx('yumi')), C + 80, C, -1, 0);
      v.orderStop(b, true);
      v.orderStop([u], true);
      run(v, 12);
      return 1e5 - v.hp[u];
    };
    expect(UNIT_BY_KEY.sohei.abilities.shield).toBeUndefined();
    const withShield = loss('dao') / (9 - UNIT_BY_KEY.dao.armP), noShield = loss('sohei') / (9 - UNIT_BY_KEY.sohei.armP);
    expect(withShield).toBeLessThan(noShield * 0.75);
  });
});

describe('经验与升级', () => {
  it('击杀得经验并升级，助攻次之；升级加攻防', () => {
    const w = flatWorld();
    const a = w.spawnGroup(1, [idx('samurai'), idx('samurai')], C, C, 1, 0);
    const victims = w.spawnGroup(2, Array(30).fill(idx('kamandar')), C + 20, C, -1, 0);
    for (const s of a) w.hp[s] = w.maxHp[s] = 1e5;
    w.orderStop(a, false);
    run(w, 60);
    const xp = a.map(s => w.xp[s]);
    expect(Math.max(...xp)).toBeGreaterThan(LEVELS.thresholds[1]);
    const best = a[xp[0] > xp[1] ? 0 : 1];
    expect(w.level[best]).toBeGreaterThan(0);
    const d = UNIT_BY_KEY.samurai;
    expect(w.maxHp[best]).toBeCloseTo(1e5 + d.lvHp[w.level[best]] - d.lvHp[0], 0);
    expect(d.lvDmg[w.level[best]]).toBeGreaterThan(d.dmg);
    // 防御：同样一击，等级越高掉血越少（5 级是 1/3）
    const v = flatWorld();
    const lo = v.spawnUnit(idx('samurai'), 1, C, C), hi = v.spawnUnit(idx('samurai'), 1, C + 40, C);
    v.level[hi] = 4;
    v.hp[lo] = v.hp[hi] = 1e4;
    damageUnit(v, lo, 300, 0, 0, UNIT_BY_KEY.dao.vs, 2, -1);
    damageUnit(v, hi, 300, 0, 0, UNIT_BY_KEY.dao.vs, 2, -1);
    expect((1e4 - v.hp[hi]) / (1e4 - v.hp[lo])).toBeCloseTo(1 / 3, 2);
    // 两人打同一批敌人：都有经验入账
    expect(Math.min(...xp)).toBeGreaterThan(0);
  });
});

describe('士气与溃逃', () => {
  it('寡不敌众的新兵会溃逃，溃兵不受指挥', () => {
    const w = flatWorld();
    const few = w.spawnGroup(1, Array(12).fill(idx('spara')), C - 120, C, 1, 0);
    const many = w.spawnGroup(2, Array(120).fill(idx('samurai')), C + 120, C, -1, 0);
    // 让他们撑得久一点，好看到士气一路跌破阈值
    for (const s of few) w.hp[s] = w.maxHp[s] = 5000;
    w.orderMove(few, C + 120, C, true);
    w.orderMove(many, C - 120, C, true);
    let routed = false;
    for (let t = 0; t < 30 * 90 && !routed; t++) {
      w.tick();
      routed = few.some(s => w.alive[s] && w.state[s] & S_ROUT);
    }
    expect(routed).toBe(true);
    const r = few.find(s => w.alive[s] && w.state[s] & S_ROUT)!;
    expect(w.controllable(r)).toBe(false);
    w.orderMove([r], C + 120, C, true);
    expect(w.state[r] & S_ROUT).toBe(S_ROUT);
    expect(w.events.some(e => e.kind === 'rout' && e.team === 1)).toBe(true);
  });

  it('等级越高越不容易溃逃，满级死战不退', () => {
    const w = flatWorld();
    const few: number[] = [];
    for (let k = 0; k < 12; k++) few.push(w.spawnUnit(idx('spara'), 1, C - 120 + (k % 4) * 14, C + ((k / 4) | 0) * 14, 4));
    for (const s of few) w.hp[s] = w.maxHp[s] = 5000;
    const many = w.spawnGroup(2, Array(120).fill(idx('samurai')), C + 120, C, -1, 0);
    w.orderMove(few, C + 120, C, true);
    w.orderMove(many, C - 120, C, true);
    run(w, 40);
    expect(w.routing[1]).toBe(0);
    expect(w.deserted[1]).toBe(0);
    expect(LEVELS.rout[0]).toBeGreaterThan(LEVELS.rout[1]);
    expect(LEVELS.rout[3]).toBeGreaterThan(LEVELS.rout[4]);
  });

  it('溃兵逃回最近的己方据点后恢复控制；没有据点则逃出地图消失', () => {
    const g = createGame({ seed: 5, factions: ['china', 'japan'], armySize: 60, difficulty: 1, fog: false, spectate: false, environment: false });
    const w = g.world;
    const hq = w.sites.find(s => s.type === SITE_CITY && s.owner === 1)!;
    const dp = w.map.deploy[1];
    const u = w.spawnGroup(1, [idx('dao')], dp.x + dp.dx * 500, dp.y + dp.dy * 500, 1, 0)[0];
    startRout(w, u);
    expect(w.routSite[u]).toBeGreaterThanOrEqual(0);
    const refuge = w.sites[w.routSite[u]];
    expect(refuge.owner).toBe(1);
    // 士气一直起不来（比如断粮）的溃兵才会一路逃回据点；途中士气回升会当场恢复，见「第四轮反馈」
    for (let t = 0; t < 30 * 120 && w.state[u] & S_ROUT; t++) {
      w.morale[u] = 0;
      w.tick();
    }
    expect(w.alive[u]).toBe(1);
    expect(w.state[u] & S_ROUT).toBe(0);
    expect(w.controllable(u)).toBe(true);
    expect(Math.hypot(w.x[u] - refuge.x, w.y[u] - refuge.y)).toBeLessThan(RULES.morale.rallyRadius + 40);
    expect(hq).toBeTruthy();

    const f = flatWorld();
    const v = f.spawnGroup(1, [idx('dao')], 300, C, 1, 0)[0];
    startRout(f, v);
    expect(f.routSite[v]).toBe(-1);
    for (let t = 0; t < 30 * 60 && f.alive[v]; t++) {
      f.morale[v] = 0;
      f.tick();
    }
    expect(f.alive[v]).toBe(0);
    expect(f.deserted[1]).toBe(1);
    expect(f.kills[2]).toBe(0);
  }, 30000);
});

describe('昼夜与天气', () => {
  it('天光随时刻变化，夜里视野缩小', () => {
    expect(lightAt(0.5)).toBe(1);
    expect(lightAt(0)).toBe(0);
    expect(lightAt(RULES.env.sunrise)).toBeCloseTo(0.5, 1);
    const w = flatWorld();
    w.env.enabled = true;
    const u = w.spawnGroup(1, [idx('nu')], C, C, 1, 0)[0];
    const far = w.spawnGroup(2, [idx('yumi')], C + 300, C, -1, 0)[0];
    w.orderStop([far], true);
    run(w, 1);
    expect(w.env.night).toBe(false);
    expect(w.seen[far] & 2).toBe(2);
    // 拨到深夜
    w.time = (0.95 - RULES.env.startClock) * RULES.env.dayLength;
    w.env.nextWeather = 1e9;
    run(w, 1);
    expect(w.env.night).toBe(true);
    expect(w.env.visionMul).toBeCloseTo(RULES.env.nightVision, 2);
    expect(w.seen[far] & 2).toBe(0);
    expect(w.target[u]).toBe(-1);
  });

  it('火把：夜里照得更远，也让敌人在更远处发现自己；下雨点不着', () => {
    const w = flatWorld();
    w.env.enabled = true;
    w.time = (0.95 - RULES.env.startClock) * RULES.env.dayLength;
    w.env.nextWeather = 1e9;
    const torch = w.spawnGroup(1, [idx('dao')], C, C, 1, 0)[0];
    const dark = w.spawnGroup(1, [idx('nu')], C, C + 300, 1, 0)[0];
    const watcher = w.spawnGroup(2, [idx('yumi')], C + 380, C, -1, 0)[0];
    const watcher2 = w.spawnGroup(2, [idx('yumi')], C + 380, C + 300, -1, 0)[0];
    w.orderStop([torch, dark, watcher, watcher2], true);
    run(w, 1);
    expect(w.state[torch] & S_TORCH).toBe(S_TORCH);
    expect(w.state[dark] & S_TORCH).toBe(0);
    // 同样的距离：打火把的被看见了，没打的没有
    expect(w.seen[torch] & 4).toBe(4);
    expect(w.seen[dark] & 4).toBe(0);
    // 熄灭火把就藏回黑暗里
    w.orderTorch([torch], false);
    run(w, 1);
    expect(w.state[torch] & S_TORCH).toBe(0);
    expect(w.seen[torch] & 4).toBe(0);
    w.orderTorch([torch], true);
    w.env.nextWeather = w.time;
    run(w, 1);
    expect(w.env.raining).toBe(true);
    expect(w.state[torch] & S_TORCH).toBe(0);
  });

  it('下雨拖慢行军', () => {
    const dist = (rain: boolean): number => {
      const w = flatWorld();
      w.env.enabled = true;
      w.env.nextWeather = rain ? 0 : 1e9;
      const u = w.spawnGroup(1, [idx('dao')], C - 400, C, 1, 0)[0];
      w.orderMove([u], C + 600, C, false);
      run(w, 8);
      return w.x[u] - (C - 400);
    };
    const dry = dist(false), wet = dist(true);
    expect(wet / dry).toBeGreaterThan(RULES.env.rainSpeed - 0.05);
    expect(wet / dry).toBeLessThan(RULES.env.rainSpeed + 0.05);
  });
});

describe('粮草', () => {
  it('只靠开局城池养不活全军：存粮耗尽后挨饿、士气下降；多占据点则有盈余', () => {
    const g = createGame({ seed: 5, factions: ['china', 'japan'], armySize: 200, difficulty: 1, fog: false, spectate: false, environment: false });
    const w = g.world;
    expect(w.upkeep0[1]).toBeGreaterThan(0);
    expect(w.foodIn[1]).toBeLessThan(w.foodOut[1]);
    expect(w.food[1]).toBeCloseTo(w.upkeep0[1] * RULES.supply.startMinutes, 0);
    const m0 = w.avgMorale[1];
    // 快进：直接把存粮清空
    w.food[1] = 0;
    run(w, 60);
    expect(w.hunger[1]).toBeGreaterThan(0.3);
    expect(w.avgMorale[1]).toBeLessThan(m0 - 8);
    expect(w.events.some(e => e.kind === 'hunger' && e.team === 1 && e.on)).toBe(true);
    // 把所有中立据点都划给一方：产量超过消耗
    for (const s of w.sites) if (s.owner === 0) s.owner = 1;
    run(w, 60);
    expect(w.foodIn[1]).toBeGreaterThan(w.foodOut[1]);
    expect(w.hunger[1]).toBeLessThan(0.05);
    expect(w.food[1]).toBeGreaterThan(0);
  }, 30000);

  it('平地沙盘不启用粮草', () => {
    const w = flatWorld();
    w.spawnGroup(1, Array(20).fill(idx('dao')), C, C, 1, 0);
    run(w, 5);
    expect(w.hunger[1]).toBe(0);
    initSupply(w);
    expect(w.upkeep0[1]).toBe(20);
  });
});

describe('战斗寻敌', () => {
  // 旧版在这三个场景里的无效位移分别约为 1.9、35、22.6 像素/秒（待命和骑兵两项会来回乱跑）
  const scene = (mode: 'amove' | 'idle' | 'cav'): { turn: number; wander: number; idle: number } => {
    const w = flatWorld();
    const a = w.spawnGroup(1, Array(140).fill(idx(mode === 'cav' ? 'tieqi' : 'dao')), C - 200, C, 1, 0);
    const b = w.spawnGroup(2, Array(14).fill(idx('samurai')), C + 120, C, -1, 0);
    for (const s of b) w.hp[s] = w.maxHp[s] = 1e6;
    if (mode === 'idle') for (const s of b) w.x[s] -= 200;
    w.orderStop(b, true);
    if (mode === 'idle') w.orderStop(a, false);
    else w.orderMove(a, C + 120, C, true);
    run(w, 10);
    return spinStats(w, a, 15);
  };

  it('挤不进战线的近战单位原地列队，不来回乱跑', () => {
    for (const mode of ['amove', 'idle', 'cav'] as const) {
      const st = scene(mode);
      console.log(`${mode}: 未接敌 ${st.idle} 人，每秒转向 ${st.turn.toFixed(2)} rad，无效位移 ${st.wander.toFixed(1)} px/s`);
      expect(st.idle, mode).toBeGreaterThan(40);
      expect(st.turn, mode).toBeLessThan(0.9);
      expect(st.wander, mode).toBeLessThan(mode === 'idle' ? 26 : mode === 'amove' ? 16 : 12);
    }
  }, 30000);

  it('目标被围满时改打旁边还有空位的敌人', () => {
    const w = flatWorld();
    const a = w.spawnGroup(1, Array(30).fill(idx('dao')), C - 120, C, 1, 0);
    // 敌人排成一列横队（站定出手后挤不动，后排本来就够不着）
    const b = [0, 1, 2, 3, 4, 5].map(k => w.spawnUnit(idx('samurai'), 2, C + 40, C - 50 + k * 20));
    for (const s of b) w.hp[s] = w.maxHp[s] = 1e6;
    w.orderStop(b, true);
    w.orderMove(a, C + 40, C, true);
    run(w, 12);
    // 30 人打 6 人：每个敌人身边都有人，没有谁被冷落、也没有谁被十几个人挤着打
    const per = b.map(t => a.filter(s => w.alive[s] && w.engaged[s] && w.target[s] === t).length);
    expect(Math.min(...per)).toBeGreaterThan(0);
    expect(Math.max(...per)).toBeLessThanOrEqual(7);
  });
});

describe('据点与建筑', () => {
  const game = (): World => createGame({
    seed: 5, factions: ['china', 'japan'], armySize: 60, difficulty: 1, fog: false, spectate: false, environment: false, supply: false,
  }).world;
  const clear = (w: World, tm: number): void => {
    for (let i = 0; i < w.n; i++) if (w.alive[i] && w.team[i] === tm) w.removeUnit(i);
  };

  it('据点分城池与营寨；兵种分人形与工程类', () => {
    expect(SITE_INFO[SITE_CITY].category).toBe('city');
    expect(SITE_INFO[SITE_TOWN].category).toBe('city');
    expect(SITE_INFO[SITE_CAMP].category).toBe('camp');
    expect(UNIT_BY_KEY.dao.humanoid && UNIT_BY_KEY.tieqi.humanoid && UNIT_BY_KEY.nu.humanoid).toBe(true);
    expect(UNIT_BY_KEY.pili.humanoid || UNIT_BY_KEY.elephant.humanoid).toBe(false);
    expect(UNIT_BY_KEY.pili.siege && UNIT_BY_KEY.elephant.siege).toBe(true);
    expect(UNIT_BY_KEY.dao.siege || UNIT_BY_KEY.tieqi.siege).toBe(false);
  });

  it('人形单位扔火把：营寨的木栅烧得掉', () => {
    const w = game();
    clear(w, 2);
    const camp = w.sites.find(s => s.type === SITE_CAMP && s.owner === 2)!;
    const fence = camp.buildings.map(id => w.buildings[id]).filter(b => b.def.key === 'palisade').sort((a, b) => b.cy - a.cy)[0];
    const men = w.spawnGroup(1, Array(12).fill(idx('dao')).concat(Array(4).fill(idx('tieqi'))), fence.cx, fence.cy + 110, 0, -1);
    w.orderAttackBuilding(men, fence);
    let torches = 0;
    for (let t = 0; t < 30 * 40 && fence.alive; t++) {
      w.tick();
      for (let p = 0; p < w.pn; p++) if (w.pType[p] === 8) torches++;
    }
    expect(torches).toBeGreaterThan(0);
    expect(fence.alive).toBe(false);
    // 是隔着一段距离扔的，不是贴上去砍
    expect(men.every(s => Math.hypot(w.x[s] - fence.cx, w.y[s] - fence.cy) > 20)).toBe(true);
  }, 30000);

  it('城池的石墙：人形单位烧不动，工程类才能破坏', () => {
    const w = game();
    clear(w, 2);
    const hq = w.sites.find(s => s.type === SITE_CITY && s.owner === 2)!;
    const wall = hq.buildings.map(id => w.buildings[id]).filter(b => b.def.key === 'wall').sort((a, b) => b.cy - a.cy)[0];
    expect(wall.def.fort).toBe(true);
    const men = w.spawnGroup(1, Array(20).fill(idx('dao')), wall.cx, wall.cy + 110, 0, -1);
    w.orderAttackBuilding(men, wall);
    // 命令被拒绝：没有人去打这堵墙
    expect(men.every(s => w.target[s] === -1)).toBe(true);
    w.damageBuilding(wall, 500, 3, 1, 1, false);
    w.damageBuilding(wall, 500, 0, 1, 1, false);
    expect(wall.hp).toBe(wall.def.hp);
    const siege = w.spawnGroup(1, Array(8).fill(idx('pili')), wall.cx, wall.cy + 14 * TILE, 0, -1);
    w.orderAttackBuilding(siege, wall);
    for (let t = 0; t < 30 * 60 && wall.alive; t++) w.tick();
    expect(wall.alive).toBe(false);
  }, 30000);

  it('城墙驻守：只有远程步兵能上，站在固定的垛口上；墙上射得更远、挨箭更轻；垛口满了不能再上', () => {
    const w = game();
    clear(w, 1);
    clear(w, 2);
    const hq = w.sites.find(s => s.type === SITE_CITY && s.owner === 1)!;
    const wall = hq.buildings.map(id => w.buildings[id]).filter(b => b.def.key === 'wall').sort((a, b) => a.cy - b.cy)[0];
    const cell = wall.ty * w.map.w + wall.tx;
    expect(wall.def.top).toBeGreaterThan(0);
    expect(w.nav.block[2][cell]).toBe(1);
    const mine = w.slots.filter(sl => sl.site === hq.id);
    expect(mine.length).toBeGreaterThan(40);
    // 普通的移动命令上不了墙
    const u = w.spawnGroup(1, [idx('nu')], hq.x + 40, hq.y - 60, 0, -1)[0];
    w.orderMove([u], wall.cx, wall.cy, false);
    let climbed = false;
    for (let t = 0; t < 30 * 12; t++) {
      w.tick();
      if (w.state[u] & S_WALL) climbed = true;
    }
    expect(climbed).toBe(false);
    // 移动命令把人带到了墙根，不同兵种的速度差一点就会停在墙外：放回城内再下驻守令
    w.orderStop([u], false);
    w.x[u] = hq.x + 40;
    w.y[u] = hq.y - 60;
    // 近战、骑射不能驻守；城外的人也不行
    expect(w.orderGarrison([w.spawnUnit(idx('dao'), 1, hq.x, hq.y + 60)])).toBe(-1);
    expect(w.orderGarrison([w.spawnUnit(idx('asvaran'), 1, hq.x + 30, hq.y + 60)])).toBe(-1);
    expect(w.orderGarrison([w.spawnUnit(idx('nu'), 1, hq.x + 1200, hq.y - 900)])).toBe(-2);
    // 驻守：走到墙根、登上垛口，钉在那里坚守
    expect(w.orderGarrison([u])).toBe(1);
    for (let t = 0; t < 30 * 40 && w.pmode[u] !== P_POSTED; t++) w.tick();
    expect(w.pmode[u]).toBe(P_POSTED);
    const sl = w.slots[w.post[u]];
    expect(sl.unit).toBe(u);
    run(w, 1);
    expect(w.state[u] & S_WALL).toBe(S_WALL);
    expect(Math.hypot(w.x[u] - sl.x, w.y[u] - sl.y)).toBeLessThan(0.01);
    // 墙外一个刚好在平地射程之外的敌人：墙上够得着
    const reach = UNIT_BY_KEY.nu.range * RULES.siege.wallRange;
    const foe = w.spawnUnit(idx('samurai'), 2, sl.x + Math.cos(sl.face) * (reach - 8), sl.y + Math.sin(sl.face) * (reach - 8));
    w.hp[foe] = w.maxHp[foe] = 1e5;
    w.order[foe] = 4;
    run(w, 6);
    expect(1e5 - w.hp[foe]).toBeGreaterThan(0);
    expect(Math.hypot(w.x[u] - sl.x, w.y[u] - sl.y)).toBeLessThan(0.01);
    w.removeUnit(foe);
    // 挨箭：墙上的比平地上的掉血少
    const ground = w.spawnUnit(idx('nu'), 1, hq.x, hq.y + 40);
    w.hp[u] = w.hp[ground] = 40;
    damageUnit(w, u, 20, 1, 0, UNIT_BY_KEY.yumi.vs, 2, -1);
    damageUnit(w, ground, 20, 1, 0, UNIT_BY_KEY.yumi.vs, 2, -1);
    expect(40 - w.hp[u]).toBeCloseTo((40 - w.hp[ground]) * RULES.siege.wallCover, 3);
    // 垛口满了：不能再上
    for (const x of mine) if (x.unit < 0) x.unit = u;
    expect(w.orderGarrison([ground])).toBe(0);
    for (const x of mine) if (x !== sl) x.unit = -1;
    // 接到别的命令：先下墙，垛口腾出来
    w.orderMove([u], hq.x, hq.y + 80, false);
    expect(sl.unit).toBe(-1);
    let down = false;
    for (let t = 0; t < 30 * 40 && !down; t++) {
      w.tick();
      down = w.pmode[u] === 0 && !(w.state[u] & S_WALL);
    }
    expect(down).toBe(true);
    // 走到地方、在自家城里待命：又自动登城
    run(w, 20);
    expect(w.pmode[u]).toBe(3);
  }, 30000);

  it('墙上的守军沿墙顶挪向射程外的敌人，一格站几人，始终不离开墙顶', () => {
    const w = game();
    clear(w, 1);
    clear(w, 2);
    const hq = w.sites.find(s => s.type === SITE_CITY && s.owner === 1)!;
    const mine = w.slots.filter(sl => sl.site === hq.id);
    // 北墙正中的一个站位，以及同一段墙顶上隔得最远（但不超过警戒距离）的另一个站位
    const s0 = mine.filter(sl => sl.y < hq.y).sort((a, b) => Math.abs(a.x - hq.x) - Math.abs(b.x - hq.x) || a.y - b.y)[0];
    const far = mine.filter(sl => sl.group === s0.group && Math.hypot(sl.x - s0.x, sl.y - s0.y) < 420)
      .sort((a, b) => Math.hypot(b.x - s0.x, b.y - s0.y) - Math.hypot(a.x - s0.x, a.y - s0.y))[0];
    expect(Math.hypot(far.x - s0.x, far.y - s0.y)).toBeGreaterThan(300);
    const men = w.spawnGroup(1, Array(6).fill(idx('nu')), s0.ex, s0.ey + 20, 0, -1);
    w.orderGarrison(men);
    for (let t = 0; t < 30 * 40 && men.some(u => w.pmode[u] !== P_POSTED); t++) w.tick();
    expect(men.every(u => w.pmode[u] === P_POSTED)).toBe(true);
    // 同一格里站了不止一个人
    const cells = new Set(men.map(u => w.slots[w.post[u]].cell));
    expect(cells.size).toBeLessThan(men.length);
    const reach = UNIT_BY_KEY.nu.range * RULES.siege.wallRange;
    const fx = far.x + Math.cos(far.face) * 90, fy = far.y + Math.sin(far.face) * 90;
    const foe = w.spawnUnit(idx('samurai'), 2, fx, fy);
    w.hp[foe] = w.maxHp[foe] = 1e6;
    w.order[foe] = 4;
    const d0 = Math.min(...men.map(u => Math.hypot(w.x[u] - fx, w.y[u] - fy)));
    expect(d0).toBeGreaterThan(reach);
    let offWall = 0;
    for (let t = 0; t < 30 * 30; t++) {
      w.tick();
      w.x[foe] = fx;
      w.y[foe] = fy;
      for (const u of men) {
        const b = w.nav.bld[w.cellAt(w.x[u], w.y[u])];
        if (!(w.state[u] & S_WALL) || b < 0 || w.buildings[b].def.top <= 0) offWall++;
      }
    }
    expect(offWall).toBe(0);
    expect(men.every(u => w.pmode[u] === P_POSTED)).toBe(true);
    // 都挪到了够得着的地方，并且射中了
    expect(Math.max(...men.map(u => Math.hypot(w.x[u] - fx, w.y[u] - fy)))).toBeLessThan(reach);
    expect(1e6 - w.hp[foe]).toBeGreaterThan(0);
  }, 30000);

  it('墙上的守军所在那段墙够不着敌人时，下墙绕到隔着门楼的另一段墙上', () => {
    const w = game();
    clear(w, 1);
    clear(w, 2);
    const hq = w.sites.find(s => s.type === SITE_CITY && s.owner === 1)!;
    const mine = w.slots.filter(sl => sl.site === hq.id);
    const men = w.spawnGroup(1, Array(2).fill(idx('nu')), hq.x - 200, hq.y - 120, 0, -1);
    w.orderGarrison(men);
    for (let t = 0; t < 30 * 40 && men.some(u => w.pmode[u] !== P_POSTED); t++) w.tick();
    expect(men.every(u => w.pmode[u] === P_POSTED)).toBe(true);
    const g0 = w.slots[w.post[men[0]]].group, ux = w.x[men[0]], uy = w.y[men[0]];
    // 找一处敌人位置：在警戒距离内，本段墙上最近的站位也够不着，另一段墙上近得多
    const reach = UNIT_BY_KEY.nu.range * RULES.siege.wallRange;
    let fx = 0, fy = 0;
    for (const sl of mine) {
      if (sl.group === g0) continue;
      const x = sl.x + Math.cos(sl.face) * 100, y = sl.y + Math.sin(sl.face) * 100;
      if (Math.hypot(x - ux, y - uy) > 520) continue;
      const own = Math.min(...mine.filter(o => o.group === g0).map(o => Math.hypot(o.x - x, o.y - y)));
      if (own > reach + 40 && own > Math.hypot(sl.x - x, sl.y - y) + RULES.siege.shiftFar + 20) {
        fx = x;
        fy = y;
        break;
      }
    }
    expect(fx).toBeGreaterThan(0);
    const foe = w.spawnUnit(idx('samurai'), 2, fx, fy);
    w.hp[foe] = w.maxHp[foe] = 1e6;
    w.order[foe] = 4;
    for (let t = 0; t < 30 * 90; t++) {
      w.tick();
      w.x[foe] = fx;
      w.y[foe] = fy;
    }
    expect(men.every(u => w.pmode[u] === P_POSTED && w.slots[w.post[u]].group !== g0)).toBe(true);
    expect(1e6 - w.hp[foe]).toBeGreaterThan(0);
  }, 30000);

  it('占领：肃清守军后在旗下读秒；敌人回来暂停，旗下没人清零', () => {
    const w = game();
    clear(w, 1);
    clear(w, 2);
    // 资源点没有军事建筑，肃清守军站到旗下就能读秒
    const s = w.sites.find(x => x.owner === 0 && x.type >= SITE_FARM)!;
    const T = SITE_INFO[s.type].captureTime;
    // 圈内有守军：站在旗下也不读秒
    const guard = w.spawnUnit(idx('yari'), 2, s.x + s.radius - 30, s.y);
    w.order[guard] = 4;
    w.hp[guard] = w.maxHp[guard] = 1e6;
    const mine = w.spawnGroup(1, Array(3).fill(idx('nu')), s.x, s.y + 20, 0, -1);
    for (const m of mine) {
      w.order[m] = 1;
      w.destX[m] = w.x[m];
      w.destY[m] = w.y[m];
    }
    run(w, 4);
    expect(s.capTeam).toBe(0);
    // 消灭最后一个守军：开始读秒
    w.removeUnit(guard);
    run(w, T * 0.5);
    expect(s.capTeam).toBe(1);
    const half = s.cap;
    expect(half).toBeGreaterThan(0.3);
    expect(half).toBeLessThan(0.7);
    // 守军再次进入：暂停，不清零
    const back = w.spawnUnit(idx('yari'), 2, s.x + s.radius - 30, s.y);
    w.order[back] = 4;
    run(w, 3);
    expect(s.cap).toBeCloseTo(half, 1);
    expect(s.owner).toBe(0);
    // 旗下没有自己人：清零
    const away = mine.map(m => [w.x[m], w.y[m]]);
    for (const m of mine) w.x[m] += 3000;
    for (const m of mine) w.destX[m] = w.x[m];
    run(w, 1.5);
    expect(s.cap).toBe(0);
    expect(s.capTeam).toBe(0);
    // 回到旗下、守军离开：从头读秒直到占领
    mine.forEach((m, k) => {
      w.x[m] = w.destX[m] = away[k][0];
      w.y[m] = away[k][1];
    });
    w.removeUnit(back);
    run(w, T * 0.6);
    expect(s.owner).toBe(0);
    run(w, T * 0.6);
    expect(s.owner).toBe(1);

  }, 30000);
});

describe('城墙与守御', () => {
  const game = (): World => createGame({
    seed: 5, factions: ['china', 'japan'], armySize: 60, difficulty: 1, fog: false, spectate: false, environment: false, supply: false,
  }).world;

  it('城墙两格厚、分内外：墙顶走不上去，墙外更上不去；垛口都排在朝外的一圈、墙根在城内', () => {
    const w = game();
    const hq = w.sites.find(s => s.type === SITE_CITY && s.owner === 1)!;
    const blds = hq.buildings.map(id => w.buildings[id]);
    const walls = blds.filter(b => b.def.key === 'wall');
    // 北墙：最靠北的两排各有一圈
    const north = walls.filter(b => Math.abs(b.cx - (hq.x - 112)) < 10).sort((a, b) => a.cy - b.cy);
    const outerW = north[0], innerW = north[1];
    expect(innerW.ty - outerW.ty).toBe(1);
    const mw = w.map.w;
    const cOut = outerW.ty * mw + outerW.tx, cIn = innerW.ty * mw + innerW.tx;
    expect(w.nav.deck[1][cOut] && w.nav.deck[1][cIn]).toBe(1);
    // 墙外的格子不是城内，墙里的是
    expect(w.nav.inner[cOut - mw]).toBe(0);
    expect(w.nav.inner[cIn + mw]).toBe(1);
    // 地面上不了墙顶（里外都不行），墙顶只能往城内下
    expect(w.nav.canStep(1, cOut - mw, cOut)).toBe(false);
    expect(w.nav.canStep(1, cIn + mw, cIn)).toBe(false);
    expect(w.nav.canStep(1, cIn, cIn + mw)).toBe(true);
    expect(w.nav.canStep(1, cOut, cOut - mw)).toBe(false);
    // 站位：外圈那一格有（每格 slotCap 个）、里圈那一格没有；角楼顶上也有；墙根都是城内的空地
    const cap = RULES.siege.slotCap;
    const at = (b: { x0: number; y0: number; x1: number; y1: number }): number =>
      w.slots.filter(sl => sl.x > b.x0 && sl.x < b.x1 && sl.y > b.y0 && sl.y < b.y1).length;
    expect(at(outerW)).toBe(cap);
    expect(at(innerW)).toBe(0);
    const tower = blds.filter(b => b.def.key === 'tower')[0];
    expect(at(tower)).toBe(3 * cap);
    for (const sl of w.slots) {
      const c = w.cellAt(sl.ex, sl.ey);
      expect(w.nav.inner[c] && !w.nav.block[1][c] && !w.nav.deck[1][c]).toBe(true);
    }
    // 墙外的人接到上墙的命令：上不去
    const u = w.spawnUnit(idx('nu'), 1, outerW.cx, outerW.cy - 70);
    w.orderMove([u], outerW.cx, outerW.cy, false);
    let climbed = false;
    for (let t = 0; t < 30 * 6; t++) {
      w.tick();
      if (w.state[u] & S_WALL) climbed = true;
    }
    expect(climbed).toBe(false);
  }, 30000);

  it('角楼、哨塔、主堡、中军帐放箭，门楼、营门不放箭；门楼和角楼烧得掉，石墙烧不动', () => {
    for (const k of ['tower', 'watchtower', 'keep', 'keep_town', 'cmdtent', 'arrowtower']) expect(BUILDINGS[k].tower, k).not.toBeNull();
    for (const k of ['gate_h', 'gate_v', 'wgate_h', 'wgate_v', 'wall', 'palisade']) expect(BUILDINGS[k].tower, k).toBeNull();
    expect(BUILDINGS.gate_h.fort || BUILDINGS.tower.fort).toBe(false);
    expect(BUILDINGS.wall.fort).toBe(true);
    const w = game();
    const hq = w.sites.find(s => s.type === SITE_CITY && s.owner === 1)!;
    const gate = hq.buildings.map(id => w.buildings[id]).find(b => b.gate)!;
    const tower = hq.buildings.map(id => w.buildings[id]).find(b => b.def.key === 'tower')!;
    for (let i = 0; i < w.n; i++) if (w.alive[i]) w.removeUnit(i);
    const out = tower.cy < hq.y ? -1 : 1;
    const foe = w.spawnUnit(idx('samurai'), 2, tower.cx, tower.cy + out * 120);
    w.hp[foe] = w.maxHp[foe] = 1e5;
    w.order[foe] = 4;
    run(w, 5);
    expect(1e5 - w.hp[foe]).toBeGreaterThan(0);
    // 火把（非工程类）对门楼、角楼有效
    w.damageBuilding(gate, 100, 3, 1, 2, false);
    w.damageBuilding(tower, 100, 3, 1, 2, false);
    expect(gate.hp).toBeCloseTo(gate.def.hp - 100 * RULES.siege.gate, 3);
    expect(tower.hp).toBeCloseTo(tower.def.hp - 100 * RULES.siege.gate, 3);
  }, 30000);

  it('在自家据点里休整：单位慢慢回血，建筑一段时间没挨打后自行修复', () => {
    const w = game();
    const hq = w.sites.find(s => s.type === SITE_CITY && s.owner === 1)!;
    for (let i = 0; i < w.n; i++) if (w.alive[i]) w.removeUnit(i);
    const inside = w.spawnUnit(idx('dao'), 1, hq.x, hq.y + 60);
    const outside = w.spawnUnit(idx('dao'), 1, hq.x + 900, hq.y - 900);
    w.hp[inside] = w.hp[outside] = 50;
    const main = w.buildings[hq.main];
    main.hp = main.def.hp * 0.5;
    main.hitTick = w.tickCount;
    const house = hq.buildings.map(id => w.buildings[id]).find(b => b.def.key === 'house')!;
    house.hp = house.def.hp * 0.5;
    house.hitTick = -99999;
    run(w, 10);
    expect(w.hp[inside]).toBeCloseTo(50 + w.maxHp[inside] * RULES.site.unitRegen * 10, 0);
    expect(w.hp[outside]).toBe(50);
    // 据点里有建筑刚挨过打 = 在交战：全城都不修
    expect(main.hp).toBe(main.def.hp * 0.5);
    expect(house.hp).toBe(house.def.hp * 0.5);
    run(w, RULES.site.bldCalm);
    expect(main.hp).toBeGreaterThan(main.def.hp * 0.5);
    expect(house.hp).toBeGreaterThan(house.def.hp * 0.5);
  }, 30000);
});

describe('队列与站位', () => {
  it('编队行军：途中保持队列，落后的跑步归队；到位后按指定方向列阵，远程排在近战后面', () => {
    const w = flatWorld();
    const kinds = [...Array(20).fill(idx('dao')), ...Array(12).fill(idx('nu')), ...Array(8).fill(idx('tieqi')), idx('asvaran'), idx('asvaran')];
    const g = w.spawnGroup(1, kinds, C - 700, C, 1, 0);
    // 朝东行军，到位后面朝南列阵
    w.orderMove(g, C + 500, C, false, 0, 1);
    expect(w.grp[g[0]]).toBeGreaterThanOrEqual(0);
    const m = w.marches[w.grp[g[0]]];
    run(w, 12);
    // 行军途中：每个人都在自己的队列位置附近，整队以最慢者的行军速度前进
    let lag = 0;
    for (const s of g) {
      marchSlot(m, w.offA[s], w.offL[s]);
      lag = Math.max(lag, Math.hypot(SLOT.x - w.x[s], SLOT.y - w.y[s]));
    }
    expect(lag).toBeLessThan(20);
    expect(m.x).toBeGreaterThan(C - 700 + 100);
    for (let t = 0; t < 30 * 90 && g.some(s => w.order[s] !== 0); t++) w.tick();
    expect(g.every(s => w.order[s] === 0)).toBe(true);
    const avgY = (k: string): number => {
      const l = g.filter(s => w.defs[w.type[s]].key === k);
      return l.reduce((a, s) => a + w.y[s], 0) / l.length;
    };
    // 面朝南（+Y）：骑兵最前，刀盾其次，骑射在步弓之前，但所有远程都在近战之后
    expect(avgY('tieqi')).toBeGreaterThan(avgY('dao'));
    expect(avgY('dao')).toBeGreaterThan(avgY('asvaran'));
    expect(avgY('asvaran')).toBeGreaterThan(avgY('nu'));
    run(w, 2);
    // 到位后转向指定的方向
    for (const s of g) expect(Math.abs(w.dir[s] - Math.PI / 2)).toBeLessThan(0.3);
  }, 30000);

  it('站定出手：非骑兵交手时脚下不动，也挤不动；只有骑兵能边走边打', () => {
    expect(UNIT_BY_KEY.tieqi.mobile && UNIT_BY_KEY.asvaran.mobile).toBe(true);
    expect(UNIT_BY_KEY.dao.mobile || UNIT_BY_KEY.nu.mobile || UNIT_BY_KEY.elephant.mobile || UNIT_BY_KEY.pili.mobile).toBe(false);
    const w = flatWorld();
    const a = w.spawnGroup(1, Array(60).fill(idx('dao')), C - 150, C, 1, 0);
    const b = w.spawnGroup(2, Array(60).fill(idx('yari')), C + 150, C, -1, 0);
    for (const s of [...a, ...b]) w.hp[s] = w.maxHp[s] = 1e6;
    w.orderMove(a, C + 150, C, true);
    w.orderMove(b, C - 150, C, true);
    run(w, 14);
    const all = [...a, ...b];
    let moved = 0, n = 0, atkMoving = 0;
    for (let t = 0; t < 30 * 10; t++) {
      const px = all.map(s => w.x[s]), py = all.map(s => w.y[s]), eng = all.map(s => w.engaged[s]);
      w.tick();
      all.forEach((s, k) => {
        if (!eng[k] || !w.engaged[s]) return;
        const d = Math.hypot(w.x[s] - px[k], w.y[s] - py[k]);
        moved += d;
        n++;
        if (w.atkAnim[s] > 0 && d > 0.05) atkMoving++;
      });
    }
    expect(n).toBeGreaterThan(3000);
    // 交手中的人平均每秒位移不到四分之一像素
    expect((moved / n) * 30).toBeLessThan(0.25);
    expect(atkMoving / n).toBeLessThan(0.01);
  }, 30000);

  it('溃兵防御大减：护甲不算，受伤加重', () => {
    const w = flatWorld();
    const u = w.spawnUnit(idx('legion'), 1, C, C), v = w.spawnUnit(idx('legion'), 1, C + 200, C);
    w.hp[u] = w.hp[v] = w.maxHp[u] = w.maxHp[v] = 1000;
    startRout(w, v);
    damageUnit(w, u, 30, 0, 0, UNIT_BY_KEY.dao.vs, 2, -1);
    damageUnit(w, v, 30, 0, 0, UNIT_BY_KEY.dao.vs, 2, -1);
    expect(1000 - w.hp[u]).toBeCloseTo(900 / (30 + RULES.combat.armorScale * UNIT_BY_KEY.legion.armM), 3);
    expect(1000 - w.hp[v]).toBeCloseTo(30 * RULES.morale.routDamage, 3);
  });
});

describe('第四轮反馈', () => {
  it('攻击移动会自己打开挡路的城门，也会去烧放箭的门楼', () => {
    const w = createGame({
      seed: 5, factions: ['china', 'japan'], armySize: 60, difficulty: 1, fog: false, spectate: false, environment: false, supply: false,
    }).world;
    for (let i = 0; i < w.n; i++) if (w.alive[i]) w.removeUnit(i);
    // 敌方营地：木栅 + 营门
    const camp = w.sites.find(s => s.type === SITE_CAMP && s.owner === 2)!;
    const men = w.spawnGroup(1, Array(40).fill(idx('dao')), camp.x, camp.y + 420, 0, -1);
    w.orderMove(men, camp.x, camp.y, true);
    let inside = false;
    for (let t = 0; t < 30 * 150 && !inside; t++) {
      w.tick();
      inside = men.some(s => w.alive[s] && Math.hypot(w.x[s] - camp.x, w.y[s] - camp.y) < 80);
    }
    expect(inside).toBe(true);
    expect(camp.buildings.some(id => !w.buildings[id].alive)).toBe(true);
    // 敌方开局城池：石门楼
    const hq = w.sites.find(s => s.type === SITE_CITY && s.owner === 2)!;
    const gates = hq.buildings.map(id => w.buildings[id]).filter(b => b.gate);
    const g0 = gates.sort((a, b) => b.cy - a.cy)[0];
    const army = w.spawnGroup(1, Array(60).fill(idx('dao')), g0.cx, g0.cy + 400, 0, -1);
    for (const s of army) w.hp[s] = w.maxHp[s] = 1e5;
    w.orderMove(army, hq.x, hq.y + 40, true);
    for (let t = 0; t < 30 * 120 && g0.alive; t++) w.tick();
    expect(g0.hp).toBeLessThan(g0.def.hp * 0.6);
  }, 60000);

  it('溃兵的士气实时计算：逃到己方大部队身边就当场恢复指挥', () => {
    const w = flatWorld();
    const u = w.spawnUnit(idx('dao'), 1, C, C);
    w.morale[u] = 5;
    startRout(w, u);
    expect(w.state[u] & S_ROUT).toBe(S_ROUT);
    // 身边没有敌人、没有伤亡：士气自己回升，过了阈值 + recover 就恢复
    w.spawnGroup(1, Array(40).fill(idx('dao')), C + 60, C, 1, 0);
    let secs = 0;
    for (; secs < 30 && w.alive[u] && w.state[u] & S_ROUT; secs++) run(w, 1);
    expect(w.alive[u]).toBe(1);
    expect(w.state[u] & S_ROUT).toBe(0);
    expect(w.morale[u]).toBeGreaterThanOrEqual(UNIT_BY_KEY.dao.lvRout[0] + RULES.morale.recover);
    expect(w.controllable(u)).toBe(true);
  });
});

describe('第六轮反馈', () => {
  const game = (): World => createGame({
    seed: 5, factions: ['china', 'japan'], armySize: 60, difficulty: 1, fog: false, spectate: false, environment: false, supply: false,
  }).world;

  it('编队行军遇到窄路：队列不收窄成纵队，全队涌过去，过去之后在终点归队', () => {
    // 东西向的山谷：x 50..80 格，谷宽 4 格
    const w = flatWorld(140, 7, (t, n) => {
      for (let x = 50; x <= 80; x++) for (let y = 20; y < 110; y++) if (y < 58 || y > 61) t[y * n + x] = T_MOUNTAIN;
    });
    const cy = 60 * TILE;
    const g = w.spawnGroup(1, Array(40).fill(idx('tieqi')), 25 * TILE, cy, 1, 0);
    w.orderMove(g, 115 * TILE, cy, false);
    const m = w.marches[w.grp[g[0]]];
    const width = m.width, depth = m.depth;
    expect(width).toBeGreaterThan(4 * TILE);
    const blk = w.nav.block[1];
    let inValley = 0, left = 0, resized = false, inBlock = 0;
    for (let t = 0; t < 30 * 120 && !m.arrived; t++) {
      w.tick();
      if (m.arrived) break;
      if (m.width !== width || m.depth !== depth) resized = true;
      for (const s of g) if (blk[w.cellAt(w.x[s], w.y[s])]) inBlock++;
      // 领队走在谷里的那一段：没有人掉出编队
      if (m.x > 56 * TILE && m.x < 78 * TILE) {
        inValley++;
        left = Math.max(left, g.filter(s => w.grp[s] < 0).length);
      }
    }
    expect(inValley).toBeGreaterThan(100);
    expect(left).toBe(0);
    // 队宽纵深从下令到到达始终不变，没有人落进山里
    expect(resized).toBe(false);
    expect(inBlock).toBe(0);
    expect(m.arrived).toBe(true);
    expect(m.width).toBe(width);
    expect(m.depth).toBe(depth);
    for (let t = 0; t < 30 * 30 && g.some(s => w.order[s] !== 0); t++) w.tick();
    expect(g.every(s => w.order[s] === 0)).toBe(true);
  }, 30000);

  it('一大队近战步兵往墙上挤：上不了墙，也不会被挤进墙里再漏到城外', () => {
    const w = game();
    const hq = w.sites.find(s => s.type === SITE_CITY && s.owner === 1)!;
    for (let i = 0; i < w.n; i++) if (w.alive[i]) w.removeUnit(i);
    const north = hq.buildings.map(id => w.buildings[id]).filter(b => b.def.key === 'wall').sort((a, b) => a.cy - b.cy)[0];
    const men = w.spawnGroup(1, Array(80).fill(idx('dao')), hq.x, hq.y + 60, 0, -1);
    w.orderMove(men, hq.x + 60, north.cy, false);
    const dk = w.nav.deck[1], inner = w.nav.inner;
    let leaks = 0, onWall = 0;
    for (let t = 0; t < 30 * 40; t++) {
      const prev = men.map(s => w.cellAt(w.x[s], w.y[s]));
      w.tick();
      men.forEach((s, k) => {
        const c = w.cellAt(w.x[s], w.y[s]);
        if (dk[prev[k]] && !dk[c] && !inner[c]) leaks++;
      });
    }
    for (const s of men) if (w.state[s] & S_WALL) onWall++;
    expect(onWall).toBe(0);
    expect(leaks).toBe(0);
  }, 30000);

  it('自动攻击：人形单位先打敌兵、没有敌兵再烧建筑，工程类先打建筑', () => {
    const w = game();
    for (let i = 0; i < w.n; i++) if (w.alive[i]) w.removeUnit(i);
    const camp = w.sites.find(s => s.type === SITE_CAMP && s.owner === 2)!;
    const blds = camp.buildings.map(id => w.buildings[id]);
    const main = w.buildings[camp.main];
    expect(SITE_INFO[camp.type].captureTime).toBeGreaterThan(0);
    for (const b of blds) b.tower = null;
    // 营里站着一队待命的步兵，旁边有一个敌兵：全都先打人
    const men = w.spawnGroup(1, Array(12).fill(idx('dao')), camp.x, camp.y + 50, 0, -1);
    const foe = w.spawnUnit(idx('yari'), 2, camp.x + 70, camp.y + 60);
    w.hp[foe] = w.maxHp[foe] = 1e6;
    run(w, 2);
    expect(men.every(s => w.target[s] === foe)).toBe(true);
    // 器械：射程里既有敌兵又有建筑，打建筑
    const tower = blds.filter(b => b.def.key === 'watchtower' && b.alive)[0];
    const dir = Math.sign(tower.cx - camp.x) || 1;
    const cat = w.spawnUnit(idx('pili'), 1, tower.cx + dir * 260, tower.cy);
    const foe2 = w.spawnUnit(idx('yari'), 2, tower.cx + dir * 260, tower.cy + 200);
    w.hp[cat] = w.maxHp[cat] = w.hp[foe2] = w.maxHp[foe2] = 1e6;
    w.order[foe2] = 4;
    run(w, 1);
    expect(w.target[cat]).toBeLessThan(-1);
    // 敌兵没了：转头烧营里的建筑（中军帐也烧：敌占营寨要先拆主建筑才能占领）
    w.removeUnit(foe);
    const rest = blds.filter(b => b.def.key !== 'palisade');
    run(w, 8);
    expect(rest.some(b => !b.alive || b.hp < b.maxHp)).toBe(true);
    void main;
  }, 30000);

  it('冲锋一撞至少打掉普通步兵七成的血', () => {
    const foot = [UNIT_BY_KEY.dao, UNIT_BY_KEY.nu, UNIT_BY_KEY.yumi];
    for (const d of UNITS) {
      const cg = d.abilities.charge;
      if (!cg || d.tier) continue;
      for (const f of foot) expect(cg.impact * d.vs[f.idx] - f.armM, `${d.key} → ${f.key}`).toBeGreaterThanOrEqual(f.lvHp[0] * 0.7);
    }
    // 实打一次：一队铁骑冲一队刀盾兵，被撞到的人当场掉七成以上
    const w = flatWorld();
    const cav = w.spawnGroup(1, Array(6).fill(idx('tieqi')), C - 260, C, 1, 0);
    const men = w.spawnGroup(2, Array(6).fill(idx('dao')), C + 40, C, -1, 0);
    w.orderStop(men, true);
    w.orderMove(cav, C + 40, C, true);
    const hp0 = UNIT_BY_KEY.dao.lvHp[0];
    let worst = hp0;
    for (let t = 0; t < 30 * 8; t++) {
      const before = men.map(s => w.hp[s]);
      w.tick();
      men.forEach((s, k) => {
        // 一帧之内掉的血：冲撞是一次结算的
        if (before[k] === hp0 && w.hp[s] < worst) worst = w.alive[s] ? w.hp[s] : 0;
      });
    }
    expect(worst).toBeLessThanOrEqual(hp0 * 0.3);
  });

  it('据点里的守军：远程自动登城；近战不出城，挨了敌方远程的打才出击', () => {
    const w = game();
    for (let i = 0; i < w.n; i++) if (w.alive[i]) w.removeUnit(i);
    const hq = w.sites.find(s => s.type === SITE_CITY && s.owner === 1)!;
    const bow = w.spawnUnit(idx('nu'), 1, hq.x - 20, hq.y + 80), sword = w.spawnUnit(idx('dao'), 1, hq.x + 20, hq.y + 80);
    run(w, 25);
    // 待命的弩兵自己走上城墙站到垛口上
    expect(w.pmode[bow]).toBe(3);
    expect(w.state[bow] & S_WALL).toBe(S_WALL);
    expect(w.sheltered[sword]).toBe(1);
    // 敌人出现在南门外：近战守军警觉但不出城
    const gate = hq.buildings.map(id => w.buildings[id]).filter(b => b.gate).sort((a, b) => b.cy - a.cy)[0];
    const foe = w.spawnUnit(idx('samurai'), 2, gate.cx, gate.cy + 150);
    w.hp[foe] = w.maxHp[foe] = 1e6;
    w.order[foe] = 4;
    const sx0 = w.x[sword], sy0 = w.y[sword];
    run(w, 6);
    expect(w.state[sword] & S_COMBAT).toBe(S_COMBAT);
    expect(w.target[sword]).toBe(-1);
    expect(Math.hypot(w.x[sword] - sx0, w.y[sword] - sy0)).toBeLessThan(12);
    w.removeUnit(foe);
    // 城外的敌方弓手射中了它：出击去打那个弓手
    const archer = w.spawnUnit(idx('yumi'), 2, gate.cx, gate.cy + 200);
    w.hp[archer] = w.maxHp[archer] = 1e6;
    w.order[archer] = 4;
    run(w, 1);
    damageUnit(w, sword, 5, 1, 0, UNIT_BY_KEY.yumi.vs, 2, archer);
    run(w, 3);
    expect(w.target[sword]).toBe(archer);
    run(w, 10);
    expect(Math.hypot(w.x[sword] - w.x[archer], w.y[sword] - w.y[archer])).toBeLessThan(60);
    // 打完回原位
    w.removeUnit(archer);
    run(w, 20);
    expect(Math.hypot(w.x[sword] - sx0, w.y[sword] - sy0)).toBeLessThan(40);
  }, 30000);

  it('编队只在不打仗的时候排队：攻击移动遇敌后全队各自上前，打完以现在的位置重新整队', () => {
    const w = flatWorld();
    const men = w.spawnGroup(1, Array(60).fill(idx('dao')), C - 500, C, 1, 0);
    const foes = w.spawnGroup(2, Array(5).fill(idx('samurai')), C, C, -1, 0);
    for (const s of foes) w.hp[s] = w.maxHp[s] = 1e6;
    w.orderStop(foes, true);
    w.orderMove(men, C + 700, C, true);
    const m = w.marches[w.grp[men[0]]];
    run(w, 25);
    // 打起来了：队伍散开，没有人还站在队列里干等（都盯上了敌人）
    expect(m.loose).toBe(true);
    expect(men.filter(s => w.alive[s] && w.target[s] === -1).length).toBe(0);
    // 敌人没了：就地重新整队（领队不在后面等着大家走回头路），然后继续走到目的地
    for (const s of foes) w.removeUnit(s);
    run(w, 8);
    expect(m.loose).toBe(false);
    expect(m.x).toBeGreaterThan(C - 150);
    for (let t = 0; t < 30 * 90 && men.some(s => w.alive[s] && w.order[s] !== 0); t++) w.tick();
    expect(men.every(s => !w.alive[s] || (w.order[s] === 0 && Math.abs(w.x[s] - (C + 700)) < 200))).toBe(true);
  }, 30000);
});

describe('编队行军：特殊地形', () => {
  // 混编的一大队：200 人，带几辆器械
  const army = (): number[] => [...Array(60).fill(idx('ji')), ...Array(50).fill(idx('dao')), ...Array(60).fill(idx('nu')),
    ...Array(30).fill(idx('tieqi')), ...Array(4).fill(idx('pili'))];
  /** 队列位置在自己身后、正原地等着的人数 */
  const waiting = (w: World, g: number[], gi: number): number => {
    const m = w.marches[gi];
    let n = 0;
    for (const s of g) {
      if (w.grp[s] !== gi) continue;
      marchSlot(m, w.offA[s], w.offL[s]);
      if ((SLOT.x - w.x[s]) * SLOT.hx + (SLOT.y - w.y[s]) * SLOT.hy < -RULES.march.waitAhead) n++;
    }
    return n;
  };

  it('过窄桥：队列不变阵，够不着位置的人各自过桥，队列压在桥上的那一段领队不为他们放慢，过桥后全员到达', async () => {
    // 南北向的河，桥 2 格宽
    const w = flatWorld(140, 7, (t, n) => {
      for (let x = 60; x <= 64; x++) for (let y = 0; y < n; y++) t[y * n + x] = y === 58 || y === 59 ? T_BRIDGE : T_DEEP;
    });
    const g = w.spawnGroup(1, army(), 35 * TILE, 70 * TILE, 1, 0);
    w.orderMove(g, 105 * TILE, 50 * TILE, false);
    const gi = w.grp[g[0]], m = w.marches[gi];
    const width = m.width, depth = m.depth;
    const blk = w.nav.block[1];
    let draped = 0, slow = 0, resized = false, inBlock = 0;
    for (let t = 0; t < 30 * 200 && !m.arrived; t++) {
      await breathe(t);
      w.tick();
      if (m.arrived) break;
      if (m.width !== width || m.depth !== depth) resized = true;
      for (const s of g) if (blk[w.cellAt(w.x[s], w.y[s])]) inBlock++;
      // 队列压在障碍上的那些帧：领队不为够不着位置的人放慢（走出障碍之后领队可以放慢等人归队，不在这里断言）
      if (t > 30 * 5 && m.over > Math.max(1, m.cnt * RULES.march.overMin)) {
        draped++;
        if (m.v < m.speed * 0.5) slow++;
      }
    }
    expect(m.arrived).toBe(true);
    // 没有收成纵队，也没有人掉进水里
    expect(resized).toBe(false);
    expect(inBlock).toBe(0);
    expect(draped).toBeGreaterThan(60);
    expect(slow / draped).toBeLessThan(0.05);
    // 过桥之后全员到达
    for (let t = 0; t < 30 * 60 && g.some(s => w.alive[s] && w.order[s] !== 0); t++) w.tick();
    expect(g.every(s => !w.alive[s] || w.order[s] === 0)).toBe(true);
  }, 60000);

  it('横队绕过障碍拐弯：转弯半径随队宽变大，内侧的人不用原地干等', () => {
    // 一道南北向的山梁挡在中间，只能从南头绕过去
    const w = flatWorld(140, 7, (t, n) => {
      for (let x = 60; x <= 63; x++) for (let y = 0; y < 85; y++) t[y * n + x] = T_MOUNTAIN;
    });
    const g = w.spawnGroup(1, army(), 35 * TILE, 60 * TILE, 1, 0);
    w.orderMove(g, 100 * TILE, 50 * TILE, false);
    const gi = w.grp[g[0]], m = w.marches[gi];
    let sum = 0, frames = 0, maxLag = 0;
    for (let t = 0; t < 30 * 200 && !m.arrived; t++) {
      w.tick();
      if (t < 30 * 8 || t % 10) continue;
      frames++;
      sum += waiting(w, g, gi) / g.length;
      maxLag = Math.max(maxLag, m.lag);
    }
    expect(m.arrived).toBe(true);
    expect(sum / frames).toBeLessThan(0.02);
    expect(maxLag).toBeLessThan(RULES.march.lagStop * 0.4);
  }, 60000);

  it('到了终点挤不进自己的落点：几秒没再靠近就就地算到，不在人堆边上来回绕', () => {
    // 真实地图上复现过的一例：全军开进营寨，有人在流场和直线之间来回绕，永远到不了
    const w = createGame({ seed: 7, factions: ['china', 'rome'], armySize: 300, difficulty: 1, fog: false, spectate: false, environment: false }).world;
    const dp = w.map.deploy[1];
    const g: number[] = [];
    for (let i = 0; i < w.n; i++) if (w.alive[i] && w.team[i] === 1 && Math.hypot(w.x[i] - dp.x, w.y[i] - dp.y) < 800) g.push(i);
    const site = w.sites.find(s => s.name === '柳溪寨')!;
    w.orderMove(g, site.x, site.y + 120, false);
    const moving = (): boolean => g.some(s => w.alive[s] && (w.order[s] === 1 || w.order[s] === 2));
    let t = 0;
    for (; t < 30 * 240 && moving(); t++) w.tick();
    expect(moving()).toBe(false);
  }, 60000);
});
