import { describe, expect, it } from 'vitest';
import { BUILDINGS, LEVELS, RULES, SITE_CAMP, SITE_HQ, SITE_INFO, SITE_TOWN, SIZES, TILE, UNITS, UNIT_BY_KEY } from '../src/sim/defs';
import { createGame } from '../src/sim/setup';
import { damageUnit } from '../src/sim/systems/combat';
import { lightAt } from '../src/sim/systems/environment';
import { startRout } from '../src/sim/systems/morale';
import { initSupply } from '../src/sim/systems/supply';
import { S_BRACE, S_CHARGE, S_COMBAT, S_ROUT, S_SHIELD, S_TORCH, S_WALL, World } from '../src/sim/world';
import { flatWorld, run, spinStats } from './helpers';

const C = (120 * TILE) / 2;
const idx = (k: string): number => UNIT_BY_KEY[k].idx;

describe('兵种定义', () => {
  it('体型越大越慢，行军比奔跑慢，等级只加生命与攻防', () => {
    for (const d of UNITS) {
      expect(d.speed).toBe(Math.round(d.pace * SIZES[d.size].speedMul));
      expect(d.walk).toBeLessThanOrEqual(d.speed);
      expect(d.lvHp.length).toBe(LEVELS.thresholds.length);
      expect(d.lvHp[4]).toBeGreaterThan(d.lvHp[0]);
      expect(d.lvDmg[4]).toBeGreaterThan(d.lvDmg[0]);
      expect(d.lvCd[4]).toBeLessThan(d.lvCd[0]);
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
  it('击杀得经验并升级，助攻次之；升级加生命和攻防', () => {
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
    expect(d.lvArmM[w.level[best]]).toBeGreaterThan(d.armM);
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
    for (let t = 0; t < 30 * 40 && !routed; t++) {
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
    const hq = w.sites.find(s => s.type === 0 && s.owner === 1)!;
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
  it('只靠大本营养不活全军：存粮耗尽后挨饿、士气下降；多占据点则有盈余', () => {
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
      expect(st.wander, mode).toBeLessThan(mode === 'idle' ? 26 : 12);
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

  it('据点分城邦与营寨；兵种分人形与工程类', () => {
    expect(SITE_INFO[SITE_HQ].category).toBe('fort');
    expect(SITE_INFO[SITE_TOWN].category).toBe('fort');
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

  it('城邦的石墙：人形单位烧不动，工程类才能破坏', () => {
    const w = game();
    clear(w, 2);
    const hq = w.sites.find(s => s.type === SITE_HQ && s.owner === 2)!;
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

  it('城墙可以驻守：己方能走上墙顶，敌人过不去；墙上射得更远、挨箭更轻', () => {
    const w = game();
    const hq = w.sites.find(s => s.type === SITE_HQ && s.owner === 1)!;
    const wall = hq.buildings.map(id => w.buildings[id]).filter(b => b.def.key === 'wall').sort((a, b) => a.cy - b.cy)[0];
    const cell = wall.ty * w.map.w + wall.tx;
    expect(wall.def.top).toBeGreaterThan(0);
    expect(w.nav.block[1][cell]).toBe(0);
    expect(w.nav.block[2][cell]).toBe(1);
    const inside = hq.y > wall.cy ? 1 : -1;
    const u = w.spawnGroup(1, [idx('nu')], wall.cx, wall.cy + inside * 60, 0, -inside)[0];
    w.orderMove([u], wall.cx, wall.cy, false);
    for (let t = 0; t < 30 * 20 && !(w.state[u] & S_WALL); t++) w.tick();
    expect(w.state[u] & S_WALL).toBe(S_WALL);
    w.orderStop([u], true);
    // 墙外一个刚好在平地射程之外的敌人：墙上够得着
    const reach = UNIT_BY_KEY.nu.range * RULES.siege.wallRange;
    const foe = w.spawnUnit(idx('samurai'), 2, wall.cx, wall.cy - inside * (reach - 8));
    w.hp[foe] = w.maxHp[foe] = 1e5;
    w.order[foe] = 4;
    run(w, 6);
    expect(1e5 - w.hp[foe]).toBeGreaterThan(0);
    // 挨箭：墙上的比平地上的掉血少
    const ground = w.spawnUnit(idx('nu'), 1, hq.x, hq.y + 40);
    w.hp[u] = w.hp[ground] = 40;
    damageUnit(w, u, 20, 1, 0, UNIT_BY_KEY.yumi.vs, 2, -1);
    damageUnit(w, ground, 20, 1, 0, UNIT_BY_KEY.yumi.vs, 2, -1);
    expect(40 - w.hp[u]).toBeCloseTo((40 - w.hp[ground]) * RULES.siege.wallCover, 3);
  }, 30000);

  it('占领：肃清守军后在旗下读秒；敌人回来暂停，旗下没人清零；占领后修复废墟', () => {
    const w = game();
    clear(w, 1);
    clear(w, 2);
    const s = w.sites.find(x => x.owner === 0 && x.type >= 4)!;
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

    // 主建筑被毁 → 无主废墟，不再产出；重新占领后修复
    const main = w.buildings[s.main];
    for (const m of mine) w.x[m] += 3000;
    for (const m of mine) w.destX[m] = w.x[m];
    w.damageBuilding(main, 1e6, 2, 1, 2);
    expect(main.alive).toBe(false);
    expect(s.disabled).toBe(true);
    expect(s.owner).toBe(0);
    const foes = w.spawnGroup(2, Array(3).fill(idx('yumi')), s.x, s.y + 20, 0, -1);
    for (const m of foes) {
      w.order[m] = 1;
      w.destX[m] = w.x[m];
      w.destY[m] = w.y[m];
    }
    run(w, T + 2);
    expect(s.owner).toBe(2);
    expect(s.disabled).toBe(false);
    expect(main.alive).toBe(true);
    expect(main.hp).toBe(main.def.hp);
    expect(w.events.some(e => e.kind === 'captured' && e.team === 2 && e.repaired)).toBe(true);
  }, 30000);
});

describe('城墙与守御', () => {
  const game = (): World => createGame({
    seed: 5, factions: ['china', 'japan'], armySize: 60, difficulty: 1, fog: false, spectate: false, environment: false, supply: false,
  }).world;

  it('城墙两格厚、分内外：只能从城内一侧上墙，墙外上不去；角楼顶也能站人', () => {
    const w = game();
    const hq = w.sites.find(s => s.type === SITE_HQ && s.owner === 1)!;
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
    expect(w.nav.canStep(1, cOut - mw, cOut)).toBe(false);
    expect(w.nav.canStep(1, cIn + mw, cIn)).toBe(true);
    // 墙外的人接到上墙的命令：不会直接翻上去（得绕城门从里面上）
    const u = w.spawnUnit(idx('nu'), 1, outerW.cx, outerW.cy - 70);
    w.orderMove([u], outerW.cx, outerW.cy, false);
    let climbedFromOutside = false;
    for (let t = 0; t < 30 * 6; t++) {
      const wasOut = w.y[u] < outerW.y0 && Math.abs(w.x[u] - outerW.cx) < 40;
      w.tick();
      if (wasOut && w.state[u] & S_WALL) climbedFromOutside = true;
    }
    expect(climbedFromOutside).toBe(false);
    expect(w.state[u] & S_WALL).toBe(0);
    // 城里的人直接上墙，并且能走上角楼
    const tower = blds.filter(b => b.def.key === 'tower').sort((a, b) => a.cx + a.cy - b.cx - b.cy)[0];
    expect(tower.def.top).toBeGreaterThan(0);
    const v = w.spawnUnit(idx('nu'), 1, innerW.cx, innerW.cy + 50);
    w.orderMove([v], tower.cx, tower.cy, false);
    for (let t = 0; t < 30 * 40 && w.order[v] !== 0; t++) w.tick();
    expect(Math.hypot(w.x[v] - tower.cx, w.y[v] - tower.cy)).toBeLessThan(30);
    expect(w.state[v] & S_WALL).toBe(S_WALL);
    // 从墙上往墙外走：出不去
    w.orderMove([v], tower.cx - 200, tower.cy - 200, false);
    let jumped = false;
    for (let t = 0; t < 30 * 5; t++) {
      const on = (w.state[v] & S_WALL) !== 0;
      w.tick();
      const c = w.cellAt(w.x[v], w.y[v]);
      if (on && !w.nav.deck[1][c] && !w.nav.inner[c]) jumped = true;
    }
    expect(jumped).toBe(false);
  }, 30000);

  it('门楼、角楼、望楼都会放箭；门楼和角楼烧得掉，石墙烧不动', () => {
    for (const k of ['gate_h', 'gate_v', 'tower', 'watchtower']) expect(BUILDINGS[k].tower, k).not.toBeNull();
    expect(BUILDINGS.gate_h.fort || BUILDINGS.tower.fort).toBe(false);
    expect(BUILDINGS.wall.fort).toBe(true);
    const w = game();
    const hq = w.sites.find(s => s.type === SITE_HQ && s.owner === 1)!;
    const gate = hq.buildings.map(id => w.buildings[id]).find(b => b.gate)!;
    const tower = hq.buildings.map(id => w.buildings[id]).find(b => b.def.key === 'tower')!;
    for (let i = 0; i < w.n; i++) if (w.alive[i]) w.removeUnit(i);
    const out = gate.cy < hq.y ? -1 : gate.cy > hq.y + 100 ? 1 : 0;
    const foe = w.spawnUnit(idx('samurai'), 2, gate.cx + (out === 0 ? (gate.cx < hq.x ? -120 : 120) : 0), gate.cy + out * 120);
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
    const hq = w.sites.find(s => s.type === SITE_HQ && s.owner === 1)!;
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
    // 刚挨过打的还不修，早就没人打的在修
    expect(main.hp).toBe(main.def.hp * 0.5);
    expect(house.hp).toBeGreaterThan(house.def.hp * 0.5);
    run(w, RULES.site.bldCalm);
    expect(main.hp).toBeGreaterThan(main.def.hp * 0.5);
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
      const px = m.x + m.hx * w.offA[s] - m.hy * w.offL[s], py = m.y + m.hy * w.offA[s] + m.hx * w.offL[s];
      lag = Math.max(lag, Math.hypot(px - w.x[s], py - w.y[s]));
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
    expect(1000 - w.hp[u]).toBeCloseTo(30 - UNIT_BY_KEY.legion.armM, 3);
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
    // 敌方大本营：石门楼
    const hq = w.sites.find(s => s.type === SITE_HQ && s.owner === 2)!;
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
