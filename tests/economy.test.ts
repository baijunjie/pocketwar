import { describe, expect, it } from 'vitest';
import {
  BUILDINGS, ELITE, RULES, SITE_CAMP, SITE_FARM, SITE_HQ, SITE_INFO, SITE_LUMBER, SITE_MINE, SITE_OUTPOST, SITE_QUARRY, SITE_TOWN, SITE_VILLAGE,
  TILE, UNITS, UNIT_BY_KEY,
} from '../src/sim/defs';
import { generateMap } from '../src/sim/map';
import { createGame } from '../src/sim/setup';
import { damageUnit, spawnProj, updateTowers, windRangeMul } from '../src/sim/systems/combat';
import { outpostCount, towerCount, unitUpgradeCost, upgradeAllCost, upgradeQueue } from '../src/sim/systems/economy';
import { O_AMOVE, O_IDLE, S_TORCH, Site, World } from '../src/sim/world';
import { flatWorld, run } from './helpers';

const C = (120 * TILE) / 2;
const idx = (k: string): number => UNIT_BY_KEY[k].idx;
const game = (): World => createGame({
  seed: 5, factions: ['china', 'japan'], armySize: 60, difficulty: 1, fog: false, spectate: false, environment: false, supply: false,
}).world;
const clear = (w: World): void => {
  for (let i = 0; i < w.n; i++) if (w.alive[i]) w.removeUnit(i);
};
/** 把据点直接划给某一方（连同建筑） */
const give = (w: World, s: Site, tm: number): void => {
  s.owner = tm;
  for (const id of s.buildings) {
    w.buildings[id].owner = tm;
    w.nav.refresh(w.buildings[id]);
  }
};
/** 派几个人站到旗下并原地坚守 */
const garrison = (w: World, s: Site, tm: number, n = 3, key = 'nu'): number[] => {
  const g = w.spawnGroup(tm, Array(n).fill(idx(key)), s.x, s.y + 16, 0, -1);
  w.orderStop(g, true);
  return g;
};

describe('高级形态', () => {
  it('每个兵种都有一个高级形态：生命、攻击、护甲更高，其余不变', () => {
    expect(UNITS.length % 2).toBe(0);
    for (const d of UNITS) {
      if (d.tier) continue;
      const e = UNITS[d.elite];
      expect(e.tier).toBe(1);
      expect(e.basic).toBe(d.idx);
      expect(e.elite).toBe(-1);
      expect(e.key).toBe(`${d.key}_e`);
      expect(e.name).not.toBe(d.name);
      expect(e.hp / d.hp).toBeCloseTo(ELITE.hp, 1);
      expect(e.dmg).toBeCloseTo(d.dmg * ELITE.dmg, 5);
      expect(e.armM).toBe(d.armM + ELITE.armor);
      expect(e.armP).toBe(d.armP + ELITE.armor);
      expect(e.speed).toBe(d.speed);
      expect(e.upkeep).toBe(d.upkeep);
      expect(e.faction).toBe(d.faction);
    }
    expect(UNIT_BY_KEY.dao_e.name).toBe('重甲刀盾兵');
    expect(UNIT_BY_KEY.pili_e.name).toBe('包铁霹雳车');
  });

  it('黄金升级：等级高的优先，同级的在各兵种之间轮流，黄金耗尽即止', () => {
    const w = flatWorld();
    const dao = w.spawnGroup(1, Array(6).fill(idx('dao')), C, C, 1, 0);
    const nu = w.spawnGroup(1, Array(2).fill(idx('nu')), C, C + 80, 1, 0);
    const qi = w.spawnGroup(1, Array(2).fill(idx('tieqi')), C, C - 80, 1, 0);
    const all = [...dao, ...nu, ...qi];
    // 一个三级的弩兵排在最前
    w.level[nu[1]] = 2;
    const q = upgradeQueue(w, all);
    expect(q[0]).toBe(nu[1]);
    // 其余同级：三个兵种轮流（刀盾、弩、铁骑各一），不是先把人最多的刀盾升完
    const types = q.slice(1, 4).map(s => w.defs[w.type[s]].key).sort();
    expect(types).toEqual(['dao', 'nu', 'tieqi']);
    expect(upgradeAllCost(w, all)).toEqual({ count: 10, cost: (6 + 2 + 2 * 2) * RULES.economy.unitGold });
    // 没有黄金：一个也升不了
    expect(w.upgradeUnits(all).count).toBe(0);
    // 够升 3 个步兵加 1 个骑兵的钱
    w.stock.gold[1] = RULES.economy.unitGold * 5;
    w.hp[nu[1]] = w.maxHp[nu[1]] * 0.5;
    const r = w.upgradeUnits(all);
    expect(r.cost).toBe(RULES.economy.unitGold * 5);
    expect(w.stock.gold[1]).toBeCloseTo(0, 5);
    expect(w.defs[w.type[nu[1]]].key).toBe('nu_e');
    // 升级保留等级与伤势比例
    expect(w.level[nu[1]]).toBe(2);
    expect(w.maxHp[nu[1]]).toBe(UNIT_BY_KEY.nu_e.lvHp[2]);
    expect(w.hp[nu[1]] / w.maxHp[nu[1]]).toBeCloseTo(0.5, 5);
    const elite = (list: number[]): number => list.filter(s => w.defs[w.type[s]].tier === 1).length;
    expect(elite(dao) + elite(nu) + elite(qi)).toBe(r.count);
    expect(elite(dao)).toBeGreaterThan(0);
    expect(elite(qi)).toBe(1);
    expect(elite(dao)).toBeLessThan(6);
    // 钱管够：全部升完，再点也不会重复扣钱
    w.stock.gold[1] = 1000;
    w.upgradeUnits(all);
    expect(elite(all)).toBe(10);
    const left = w.stock.gold[1];
    expect(w.upgradeUnits(all).count).toBe(0);
    expect(w.stock.gold[1]).toBe(left);
    expect(unitUpgradeCost(UNIT_BY_KEY.dao_e)).toBe(0);
  });

  it('高级形态更能打：同样的对手，挨的打更轻、打得更重', () => {
    const w = flatWorld();
    const a = w.spawnUnit(idx('dao'), 1, C, C), b = w.spawnUnit(idx('dao_e'), 1, C, C + 100);
    const foe = UNIT_BY_KEY.yari;
    damageUnit(w, a, 20, 0, 0, foe.vs, 2, -1);
    damageUnit(w, b, 20, 0, 0, foe.vs, 2, -1);
    expect(w.maxHp[b] - w.hp[b]).toBeLessThan(w.maxHp[a] - w.hp[a]);
    expect(w.maxHp[b]).toBeGreaterThan(w.maxHp[a]);
  });
});

describe('资源点', () => {
  it('地图上每方后方各有粮、木、石、金，另有金矿靠近中线；每处四个箭塔位', () => {
    for (const seed of [5, 42, 1234]) {
      const m = generateMap(seed);
      const n = (t: number): number => m.sites.filter(s => s.type === t).length;
      expect([n(SITE_FARM), n(SITE_LUMBER), n(SITE_QUARRY), n(SITE_MINE)]).toEqual([2, 2, 2, 4]);
      // 城池仍然排在最后（道路生成按这个找它）
      expect(m.sites[m.sites.length - 1].type).toBe(1);
      for (const s of m.sites) {
        if (SITE_INFO[s.type].category !== 'resource') continue;
        expect(s.owner).toBe(0);
        expect(s.slots!.length).toBe(4);
        for (const [tx, ty] of s.slots!) {
          // 箭塔位上没有别的建筑
          expect(m.buildings.some(b => tx >= b.tx && ty >= b.ty && tx < b.tx + BUILDINGS[b.def].w && ty < b.ty + BUILDINGS[b.def].h),
            `seed ${seed} ${s.name}`).toBe(false);
        }
      }
    }
  }, 30000);

  it('占领读秒短；占领后自动采集，农庄直接加军粮', () => {
    const w = createGame({ seed: 5, factions: ['china', 'japan'], armySize: 60, difficulty: 1, fog: false, spectate: false, environment: false }).world;
    clear(w);
    expect(w.armyBase[1]).toBeGreaterThan(0);
    const of = (t: number): Site => w.sites.find(s => s.type === t)!;
    const lumber = of(SITE_LUMBER), quarry = of(SITE_QUARRY), mine = of(SITE_MINE), farm = of(SITE_FARM);
    expect(SITE_INFO[SITE_LUMBER].captureTime).toBeLessThan(SITE_INFO[SITE_CAMP].captureTime / 2);
    garrison(w, lumber, 1);
    run(w, SITE_INFO[SITE_LUMBER].captureTime - 1.5);
    expect(lumber.owner).toBe(0);
    run(w, 3);
    expect(lumber.owner).toBe(1);
    expect(w.events.some(e => e.kind === 'captured' && e.site === lumber.id)).toBe(true);
    const food0 = w.foodIn[1];
    for (const s of [quarry, mine, farm]) give(w, s, 1);
    for (const k of ['wood', 'stone', 'gold'] as const) w.stock[k][1] = 0;
    run(w, 30);
    expect(w.income.wood[1]).toBe(SITE_INFO[SITE_LUMBER].yields!.wood);
    expect(w.income.stone[1]).toBe(SITE_INFO[SITE_QUARRY].yields!.stone);
    expect(w.income.gold[1]).toBeCloseTo((SITE_INFO[SITE_MINE].yields!.gold! * w.armyBase[1]) / 100, 5);
    expect(w.stock.wood[1]).toBeCloseTo(SITE_INFO[SITE_LUMBER].yields!.wood! / 2, 0);
    expect(w.stock.stone[1]).toBeCloseTo(SITE_INFO[SITE_QUARRY].yields!.stone! / 2, 0);
    expect(w.stock.gold[1]).toBeGreaterThan(0);
    expect(w.stock.wood[2]).toBe(0);
    expect(w.foodIn[1]).toBeCloseTo(food0 + (SITE_INFO[SITE_FARM].food * w.upkeep0[1]) / 100, 3);
    // 资源点不出援军、不算据点：不能在里面休整
    const u = w.spawnUnit(idx('dao'), 1, quarry.x + 30, quarry.y);
    w.hp[u] = 40;
    run(w, 5);
    expect(w.hp[u]).toBe(40);
    expect(w.sheltered[u]).toBe(0);
    expect(w.events.some(e => e.kind === 'reinforce' && w.sites[e.site].type >= SITE_FARM)).toBe(false);
  }, 30000);

  it('木材建箭塔：位置固定、最多四座；敌人要先摧毁全部箭塔才能占领，被毁的箭塔不会随易主复原', () => {
    const w = game();
    clear(w);
    const s = w.sites.find(x => x.type === SITE_LUMBER)!;
    give(w, s, 1);
    const cost = RULES.economy.towerCost;
    expect(w.buildTower(s)).toBe(false);
    w.stock.wood[1] = cost * 4 + 7;
    for (let k = 0; k < 4; k++) expect(w.buildTower(s)).toBe(true);
    expect(w.buildTower(s)).toBe(false);
    expect(w.stock.wood[1]).toBeCloseTo(7, 5);
    expect(towerCount(w, s)).toBe(4);
    const towers = s.slots.map(sl => w.buildings[sl.bld]);
    towers.forEach((b, k) => {
      expect([b.tx, b.ty]).toEqual([s.slots[k].tx, s.slots[k].ty]);
      expect(b.owner).toBe(1);
      expect(b.tower).toBeTruthy();
    });
    // 敌军站到旗下：箭塔还在就不读秒，还会挨箭
    const foes = garrison(w, s, 2, 4, 'yari');
    for (const f of foes) w.hp[f] = w.maxHp[f] = 1e6;
    run(w, 10);
    expect(s.owner).toBe(1);
    expect(s.cap).toBe(0);
    expect(foes.some(f => w.hp[f] < 1e6)).toBe(true);
    // 拆掉三座还不行，四座全毁才开始读秒
    for (let k = 0; k < 3; k++) w.damageBuilding(towers[k], 1e6, 0, 1, 2);
    run(w, 8);
    expect(s.owner).toBe(1);
    w.damageBuilding(towers[3], 1e6, 0, 1, 2);
    run(w, SITE_INFO[s.type].captureTime + 2);
    expect(s.owner).toBe(2);
    expect(towerCount(w, s)).toBe(0);
    expect(towers.every(b => !b.alive)).toBe(true);
    // 新主人重新花木材，在原来的位置重建
    w.stock.wood[2] = cost;
    expect(w.buildTower(s)).toBe(true);
    expect(towers[0].alive && towers[0].owner === 2).toBe(true);
    expect(w.buildings.filter(b => b.def.key === RULES.economy.towerKey).length).toBe(4);
  }, 30000);

  it('待命的部队被箭塔射中会上去拆塔', () => {
    const w = game();
    clear(w);
    const s = w.sites.find(x => x.type === SITE_QUARRY)!;
    give(w, s, 1);
    w.stock.wood[1] = RULES.economy.towerCost;
    w.buildTower(s);
    const t = w.buildings[s.slots[0].bld];
    // 从没有别的建筑挡着的一侧过来
    const g = w.spawnGroup(2, Array(6).fill(idx('yari')), t.cx - 200, t.cy, 1, 0);
    run(w, 25);
    expect(g.some(u => w.target[u] === -t.id - 2) || !t.alive || t.hp < t.maxHp).toBe(true);
    expect(t.hp).toBeLessThan(t.maxHp);
  }, 30000);

  it('箭塔、塔楼的视野比普通建筑远得多', () => {
    const w = game();
    clear(w);
    w.fog = true;
    const s = w.sites.find(x => x.type === SITE_MINE)!;
    give(w, s, 1);
    const main = w.buildings[s.main];
    const far = (RULES.vision.building + RULES.vision.tower) / 2;
    w.refreshVision();
    const seen = (x: number, y: number): boolean => w.teamVis[1][((y / 64) | 0) * w.vw + ((x / 64) | 0)] === 1;
    expect(seen(main.cx, main.cy)).toBe(true);
    expect(seen(s.x + far + 200, s.y)).toBe(false);
    w.stock.wood[1] = 999;
    while (w.buildTower(s));
    w.refreshVision();
    const t = w.buildings[s.slots[1].bld];
    expect(seen(t.cx + far, t.cy)).toBe(true);
    expect(RULES.vision.tower).toBeGreaterThan(RULES.vision.building * 2);
  }, 30000);
});

describe('据点升级', () => {
  it('城邦花石料、营寨花木材；升级后建筑更结实、箭塔更狠，主建筑也会放箭；易主后降回', () => {
    const w = game();
    clear(w);
    const town = w.sites.find(s => s.type === SITE_TOWN)!;
    const camp = w.sites.find(s => s.type === SITE_CAMP && s.owner === 1)!;
    give(w, town, 1);
    expect(SITE_INFO[SITE_TOWN].material).toBe('stone');
    expect(SITE_INFO[SITE_CAMP].material).toBe('wood');
    // 木材升不了城邦
    w.stock.wood[1] = 9999;
    expect(w.upgradeSite(town)).toBe(false);
    w.stock.stone[1] = SITE_INFO[SITE_TOWN].upgradeCost + 5;
    const hall = w.buildings[town.main];
    const tower = town.buildings.map(id => w.buildings[id]).find(b => b.def.key === 'tower')!;
    hall.hp = hall.def.hp * 0.5;
    hall.hitTick = w.tickCount;
    expect(hall.tower).toBeNull();
    expect(w.upgradeSite(town)).toBe(true);
    expect(w.stock.stone[1]).toBeCloseTo(5, 5);
    expect(town.level).toBe(1);
    expect(w.upgradeSite(town)).toBe(false);
    expect(hall.maxHp).toBe(Math.round(hall.def.hp * RULES.economy.siteHp));
    // 新增的那部分生命补上，旧伤还在
    expect(hall.hp).toBeCloseTo(hall.maxHp - hall.def.hp * 0.5, 3);
    expect(hall.lv).toBe(1);
    expect(tower.tower!.dmg).toBeCloseTo(tower.def.tower!.dmg * RULES.economy.towerDmg, 5);
    expect(tower.tower!.range).toBeGreaterThan(tower.def.tower!.range);
    expect(hall.tower).toEqual({ ...RULES.economy.mainTower, arrows: RULES.economy.mainTower.arrows * RULES.economy.towerArrows });
    // 护甲加成：同样一击，升级后的建筑掉血更少
    const wallA = town.buildings.map(id => w.buildings[id]).find(b => b.def.key === 'wall')!;
    const wallB = w.sites.find(s => s.type === SITE_HQ && s.owner === 2)!.buildings.map(id => w.buildings[id]).find(b => b.def.key === 'wall')!;
    w.damageBuilding(wallA, 30, 0, 1, 2);
    w.damageBuilding(wallB, 30, 0, 1, 1);
    expect(wallA.maxHp - wallA.hp).toBeLessThan(wallB.maxHp - wallB.hp);
    // 升级后的镇公所会放箭
    const foe = w.spawnUnit(idx('yari'), 2, hall.cx, hall.y1 + 60);
    w.order[foe] = 4;
    w.hp[foe] = w.maxHp[foe] = 1e6;
    run(w, 6);
    expect(w.hp[foe]).toBeLessThan(1e6);
    w.removeUnit(foe);
    // 营寨用木材
    w.stock.wood[1] = SITE_INFO[SITE_CAMP].upgradeCost;
    expect(w.upgradeSite(camp)).toBe(true);
    expect(w.stock.wood[1]).toBeCloseTo(0, 5);
    // 敌人拆了镇公所再夺走城镇：等级降回，要重新升级
    w.damageBuilding(hall, 1e9, 0, 1, 2);
    for (const u of garrison(w, town, 2, 3, 'yumi')) w.hp[u] = w.maxHp[u] = 1e6;
    run(w, SITE_INFO[SITE_TOWN].captureTime + 3);
    expect(town.owner).toBe(2);
    expect(town.level).toBe(0);
    expect(hall.maxHp).toBe(hall.def.hp);
    expect(hall.hp).toBeLessThanOrEqual(hall.maxHp);
    expect(hall.tower).toBeNull();
    expect(tower.tower).toBe(tower.def.tower);
    expect(hall.lv).toBe(0);
  }, 30000);

  it('手里有石料 / 木材时建筑修得快得多，同时少量消耗', () => {
    const fix = (stone: number): { gain: number; used: number } => {
      const w = game();
      clear(w);
      const hq = w.sites.find(s => s.type === SITE_HQ && s.owner === 1)!;
      const main = w.buildings[hq.main];
      main.hp = main.maxHp * 0.5;
      main.hitTick = -99999;
      w.stock.stone[1] = stone;
      run(w, 10);
      return { gain: main.hp - main.maxHp * 0.5, used: stone - w.stock.stone[1] };
    };
    const slow = fix(0), fast = fix(500);
    expect(slow.used).toBe(0);
    expect(fast.gain / slow.gain).toBeCloseTo(RULES.economy.repairBoost, 1);
    expect(fast.used).toBeCloseTo((fast.gain * RULES.economy.repairCost) / 100, 3);
    expect(fast.used).toBeLessThan(30);
  }, 30000);
});

describe('临时据点', () => {
  it('部队走到地方才搭起来：扣木材、能休整；被毁后不再重生', () => {
    const w = flatWorld();
    const E = RULES.economy;
    const g = w.spawnGroup(1, Array(4).fill(idx('dao')), C - 300, C, 1, 0);
    expect(w.orderOutpost(g, C, C)).toBe('wood');
    w.stock.wood[1] = E.outpostCost + 10;
    expect(w.orderOutpost(g, C, C)).toBeNull();
    // 下令时就扣了木材，正在搭的也占名额
    expect(w.stock.wood[1]).toBeCloseTo(10, 5);
    expect(outpostCount(w, 1)).toBe(1);
    expect(w.sites.length).toBe(0);
    run(w, 14);
    expect(w.sites.length).toBe(1);
    const s = w.sites[0];
    expect(s.type).toBe(SITE_OUTPOST);
    expect(s.owner).toBe(1);
    const b = w.buildings[s.main];
    expect(b.def.key).toBe(E.outpostKey);
    expect(w.events.some(e => e.kind === 'outpost' && e.built)).toBe(true);
    // 离得太近不能再搭一座
    w.stock.wood[1] = 999;
    expect(w.orderOutpost(g, s.x + 60, s.y)).toBe('near');
    // 在里面休整回血，雪天也算有遮蔽
    w.hp[g[0]] = 30;
    run(w, 10);
    expect(w.hp[g[0]]).toBeGreaterThan(30);
    expect(w.sheltered[g[0]]).toBe(1);
    // 敌人站到旗下也占不走
    const foe = w.spawnGroup(2, Array(3).fill(idx('yumi')), s.x, s.y + 40, 0, -1);
    w.orderStop(foe, true);
    for (const u of g) w.removeUnit(u);
    run(w, 20);
    expect(s.owner).toBe(1);
    // 打掉就没了
    w.damageBuilding(b, 1e6, 0, 1, 2);
    expect(s.gone).toBe(true);
    expect(outpostCount(w, 1)).toBe(0);
    run(w, 30);
    expect(s.owner).toBe(0);
    expect(b.alive).toBe(false);
  });

  it('每方数量有上限；部队没到、被消灭则退还木材', () => {
    const w = flatWorld();
    const E = RULES.economy;
    w.stock.wood[1] = E.outpostCost * 10;
    const g = w.spawnGroup(1, Array(3).fill(idx('dao')), C - 900, C - 900, 1, 0);
    for (let k = 0; k < E.outpostMax; k++) expect(w.orderOutpost(g, C - 600 + k * 500, C + 600)).toBeNull();
    expect(w.orderOutpost(g, C, C - 600)).toBe('max');
    expect(w.stock.wood[1]).toBe(E.outpostCost * (10 - E.outpostMax));
    for (const u of g) w.removeUnit(u);
    run(w, 2);
    expect(w.builds.length).toBe(0);
    expect(w.sites.length).toBe(0);
    expect(w.stock.wood[1]).toBe(E.outpostCost * 10);
    expect(w.events.filter(e => e.kind === 'outpost' && !e.built).length).toBe(E.outpostMax);
  });
});

describe('雪天', () => {
  const snowy = (w: World): void => {
    w.env.enabled = true;
    w.env.snowing = true;
    w.env.raining = false;
    w.env.nextWeather = 1e9;
  };

  it('下雪少见；雪天行军变慢、火把点不着，视野缩小并与夜晚叠乘', () => {
    expect(RULES.env.snowChance).toBeLessThan(0.35);
    const dist = (snow: boolean): number => {
      const w = flatWorld();
      w.env.enabled = true;
      w.env.nextWeather = 1e9;
      if (snow) snowy(w);
      const u = w.spawnGroup(1, [idx('dao')], C - 400, C, 1, 0)[0];
      w.orderMove([u], C + 600, C, false);
      run(w, 8);
      return w.x[u] - (C - 400);
    };
    const r = dist(true) / dist(false);
    expect(r).toBeGreaterThan(RULES.env.snowSpeed - 0.05);
    expect(r).toBeLessThan(RULES.env.snowSpeed + 0.05);
    const w = flatWorld();
    snowy(w);
    const torch = w.spawnGroup(1, [idx('dao')], C, C, 1, 0)[0];
    run(w, 1);
    expect(w.env.visionMul).toBeCloseTo(RULES.env.snowVision, 2);
    // 拨到深夜：两项叠乘，火把点不着
    w.time = (0.95 - RULES.env.startClock) * RULES.env.dayLength;
    run(w, 1);
    expect(w.env.night).toBe(true);
    expect(w.env.visionMul).toBeCloseTo(RULES.env.snowVision * RULES.env.nightVision, 2);
    expect(w.state[torch] & S_TORCH).toBe(0);
    // 雪停了火把就能点
    w.env.nextWeather = w.time;
    run(w, 1);
    expect(w.env.snowing).toBe(false);
    expect(w.state[torch] & S_TORCH).toBe(S_TORCH);
  });

  it('雪和雨共用一套日程，多数时候下的是雨', () => {
    let snow = 0, rain = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const w = flatWorld(40, seed);
      w.env.enabled = true;
      w.env.nextWeather = 0;
      run(w, 0.5);
      expect(w.env.snowing !== w.env.raining).toBe(true);
      if (w.env.snowing) snow++;
      else rain++;
    }
    expect(snow).toBeGreaterThan(0);
    expect(rain).toBeGreaterThan(snow);
  });

  it('雪天在据点之外防御下降，在自家据点里不受影响', () => {
    const w = game();
    clear(w);
    const hq = w.sites.find(s => s.type === SITE_HQ && s.owner === 1)!;
    const inside = w.spawnUnit(idx('dao'), 1, hq.x, hq.y + 60);
    const outside = w.spawnUnit(idx('dao'), 1, hq.x + 900, hq.y - 900);
    run(w, 1);
    expect(w.sheltered[inside]).toBe(1);
    expect(w.sheltered[outside]).toBe(0);
    const hit = (u: number): number => {
      const before = w.hp[u];
      damageUnit(w, u, 10, 0, 0, UNIT_BY_KEY.yari.vs, 2, -1);
      return before - w.hp[u];
    };
    const arm = UNIT_BY_KEY.dao.armM;
    expect(hit(outside)).toBeCloseTo(10 - arm, 5);
    snowy(w);
    expect(hit(outside)).toBeCloseTo(10 - arm * RULES.env.snowArmor, 5);
    expect(hit(inside)).toBeCloseTo(10 - arm, 5);
  }, 30000);
});

describe('电脑会花资源', () => {
  it('AI 对战几分钟后：占了资源点，升了兵或据点', () => {
    const g = createGame({ seed: 100, factions: ['china', 'japan'], armySize: 200, difficulty: 1, fog: false, spectate: true });
    const w = g.world;
    for (let t = 0; t < 30 * 60 * 7 && !w.winner; t++) {
      w.tick();
      for (const ai of g.ais) ai.update();
      w.fxN = 0;
    }
    const res = w.sites.filter(s => SITE_INFO[s.type].category === 'resource' && s.owner !== 0).length;
    expect(res).toBeGreaterThan(2);
    let elite = 0;
    for (let i = 0; i < w.n; i++) if (w.alive[i] && w.defs[w.type[i]].tier === 1) elite++;
    const upgraded = w.sites.filter(s => s.level === 1).length;
    const towers = w.buildings.filter(b => b.def.key === RULES.economy.towerKey).length;
    if (import.meta.env.VITE_DUMP) console.log({ res, elite, upgraded, towers, stock: w.stock });
    expect(elite + upgraded + towers).toBeGreaterThan(0);
  }, 180000);
});

describe('第八轮：城防与占领', () => {
  it('村庄有四个箭塔位；石城门四格宽', () => {
    for (const seed of [5, 42, 1234]) {
      const m = generateMap(seed);
      const occupied = (tx: number, ty: number): boolean =>
        m.buildings.some(b => tx >= b.tx && ty >= b.ty && tx < b.tx + BUILDINGS[b.def].w && ty < b.ty + BUILDINGS[b.def].h);
      m.sites.forEach((s, si) => {
        if (s.type === SITE_VILLAGE) {
          expect(s.slots!.length).toBe(4);
          for (const [tx, ty] of s.slots!) expect(occupied(tx, ty), `seed ${seed} ${s.name}`).toBe(false);
        }
        if (s.type === SITE_HQ) expect(m.buildings.filter(b => b.site === si && b.def === 'tower').length).toBe(4);
        if (s.type === SITE_TOWN) expect(m.buildings.filter(b => b.site === si && b.def === 'tower').length).toBe(4);
      });
    }
    expect(BUILDINGS.gate_h.w).toBe(4);
    expect(BUILDINGS.gate_v.h).toBe(4);
    // 村庄能花木材建箭塔
    const w = game();
    clear(w);
    const v = w.sites.find(s => s.type === SITE_VILLAGE)!;
    give(w, v, 1);
    w.stock.wood[1] = RULES.economy.towerCost * 4;
    for (let k = 0; k < 4; k++) expect(w.buildTower(v)).toBe(true);
    expect(towerCount(w, v)).toBe(4);
  }, 30000);

  it('敌占的城邦、营寨要先拆毁主建筑才能读秒；中立的不用', () => {
    const w = game();
    clear(w);
    const town = w.sites.find(s => s.type === SITE_TOWN)!;
    give(w, town, 1);
    for (const id of town.buildings) w.buildings[id].tower = null;
    const hall = w.buildings[town.main];
    for (const u of garrison(w, town, 2, 3, 'yari')) w.hp[u] = w.maxHp[u] = 1e6;
    run(w, SITE_INFO[SITE_TOWN].captureTime + 3);
    expect(town.owner).toBe(1);
    expect(town.cap).toBe(0);
    w.damageBuilding(hall, 1e9, 0, 1, 2);
    expect(town.disabled).toBe(true);
    run(w, SITE_INFO[SITE_TOWN].captureTime + 3);
    expect(town.owner).toBe(2);
    expect(hall.alive && hall.hp === hall.maxHp).toBe(true);
    // 中立营地：主建筑立着也照常占领
    const camp = w.sites.find(s => s.type === SITE_CAMP && s.owner === 0) ?? w.sites.find(s => s.type === SITE_VILLAGE && s.owner === 0)!;
    for (const u of garrison(w, camp, 1, 3, 'yari')) w.hp[u] = w.maxHp[u] = 1e6;
    run(w, SITE_INFO[camp.type].captureTime + 3);
    expect(camp.owner).toBe(1);
  }, 30000);

  it('倒塌的角楼在据点脱离战斗后自行重建，修满之前不放箭；交战时停修', () => {
    const w = game();
    clear(w);
    const hq = w.sites.find(s => s.type === SITE_HQ && s.owner === 1)!;
    const tower = hq.buildings.map(id => w.buildings[id]).find(b => b.def.key === 'tower')!;
    w.damageBuilding(tower, 1e9, 0, 1, 2);
    expect(tower.alive).toBe(false);
    w.stock.stone[1] = 1e6;
    // 刚倒塌（挨过打）的据点还在交战
    run(w, RULES.site.bldCalm - 1);
    expect(tower.alive).toBe(false);
    run(w, 3);
    expect(tower.alive && tower.down).toBe(true);
    expect(tower.hp).toBeGreaterThan(0);
    // 敌人走进来：停修；而且重建中的角楼不放箭
    const foe = w.spawnUnit(idx('yari'), 2, hq.x + (tower.cx - hq.x) * 0.5, hq.y + (tower.cy - hq.y) * 0.5);
    w.hp[foe] = w.maxHp[foe] = 1e6;
    w.orderStop([foe], true);
    for (const id of hq.buildings) if (w.buildings[id] !== tower) w.buildings[id].tower = null;
    const hp0 = tower.hp;
    run(w, 5);
    expect(tower.hp).toBe(hp0);
    expect(w.hp[foe]).toBe(1e6);
    w.removeUnit(foe);
    // 修满后恢复放箭（有石料按 4 倍速）
    run(w, 1 / (RULES.site.bldRegen * RULES.economy.repairBoost) + 5);
    expect(tower.hp).toBe(tower.maxHp);
    expect(tower.down).toBe(false);
    const foe2 = w.spawnUnit(idx('yari'), 2, tower.cx, tower.cy + 120);
    w.hp[foe2] = w.maxHp[foe2] = 1e6;
    w.orderStop([foe2], true);
    run(w, 4);
    expect(w.hp[foe2]).toBeLessThan(1e6);
  }, 60000);
});

describe('风', () => {
  const setWind = (w: World, dir: number, force: number): void => {
    w.env.enabled = true;
    w.env.nextWeather = w.env.nextWind = 1e9;
    w.env.windy = force > 0;
    w.env.wind = w.env.windTarget = force;
    w.env.windDir = dir;
  };
  const travel = (dir: number, force: number, toward: number): number => {
    const w = flatWorld();
    setWind(w, dir, force);
    const u = w.spawnUnit(idx('dao'), 1, C, C);
    w.orderMove([u], C + Math.cos(toward) * 2000, C + Math.sin(toward) * 2000, false);
    run(w, 6);
    return Math.hypot(w.x[u] - C, w.y[u] - C);
  };

  it('顺风走得快、顶风走得慢，侧风不影响', () => {
    const calm = travel(0, 0, 0);
    const tail = travel(0, 1, 0), head = travel(0, 1, Math.PI), side = travel(0, 1, Math.PI / 2);
    expect(tail / calm).toBeGreaterThan(1 + RULES.env.windSpeed * 0.8);
    expect(head / calm).toBeLessThan(1 - RULES.env.windSpeed * 0.8);
    expect(Math.abs(side / calm - 1)).toBeLessThan(0.03);
  }, 30000);

  it('风不是一直有：雨雪天起风的机会远多于晴天；无风时风力为 0', () => {
    const w = game();
    w.env.enabled = true;
    let windyWet = 0, wet = 0, windyDry = 0, dry = 0, calmZero = true;
    for (let t = 0; t < 30 * 60 * 40; t++) {
      w.tick();
      w.events.length = 0;
      w.fxN = 0;
      if (t % 30) continue;
      const isWet = w.env.raining || w.env.snowing;
      if (isWet) { wet++; if (w.env.windy) windyWet++; } else { dry++; if (w.env.windy) windyDry++; }
      if (!w.env.windy && w.env.wind > 0 && w.env.windTarget === 0) calmZero = false;
    }
    expect(wet).toBeGreaterThan(0);
    expect(windyWet / wet).toBeGreaterThan(windyDry / dry);
    expect(windyDry / dry).toBeLessThan(0.6);
    expect(calmZero).toBe(true);
  }, 120000);
});

describe('风与远程', () => {
  const windy = (w: World, dir: number, force: number): void => {
    w.env.enabled = true;
    w.env.nextWeather = w.env.nextWind = 1e9;
    w.env.windy = force > 0;
    w.env.wind = w.env.windTarget = force;
    w.env.windDir = dir;
  };

  it('顺风射得远、顶风射得近，侧风不变', () => {
    const w = flatWorld();
    windy(w, 0, 1);
    const K = RULES.env.windRange;
    expect(windRangeMul(w, 1, 0)).toBeCloseTo(1 + K, 5);
    expect(windRangeMul(w, -1, 0)).toBeCloseTo(1 - K, 5);
    expect(windRangeMul(w, 0, 1)).toBeCloseTo(1, 5);
    // 坚守的弩手：射程外一点点的敌人，顺风一侧够得着，顶风一侧够不着
    const R = UNIT_BY_KEY.nu.range;
    const shoot = (side: number): number => {
      const v = flatWorld();
      windy(v, 0, 1);
      const a = v.spawnUnit(idx('nu'), 1, C, C);
      v.orderStop([a], true);
      const e = v.spawnUnit(idx('yari'), 2, C + side * (R * (1 + K / 2) + 10), C);
      v.hp[e] = v.maxHp[e] = 1e6;
      v.orderStop([e], true);
      run(v, 6);
      return 1e6 - v.hp[e];
    };
    expect(shoot(1)).toBeGreaterThan(0);
    expect(shoot(-1)).toBe(0);
  }, 30000);

  it('侧风让箭落空，器械落点顺风偏；无风时箭必中', () => {
    const fire = (force: number, dir: number): number => {
      const w = flatWorld();
      windy(w, dir, force);
      const e = w.spawnUnit(idx('yari'), 2, C + RULES.env.windMissDist, C);
      let miss = 0;
      for (let k = 0; k < 400; k++) {
        w.pn = 0;
        spawnProj(w, C, C, e, w.x[e], w.y[e], 0, 5, 1, 0, 0, -1, 1, -1);
        miss += w.pMiss[0];
      }
      return miss / 400;
    };
    expect(fire(0, 0)).toBe(0);
    const cross = fire(1, Math.PI / 2), tail = fire(1, 0);
    expect(cross).toBeGreaterThan(RULES.env.windMiss * 0.75);
    expect(cross).toBeLessThan(RULES.env.windMiss * 1.25);
    expect(tail).toBe(0);
    // 投石：落点往下风（+y）偏
    const w = flatWorld();
    windy(w, Math.PI / 2, 1);
    const e = w.spawnUnit(idx('yari'), 2, C + 400, C);
    let sum = 0;
    for (let k = 0; k < 50; k++) {
      w.pn = 0;
      spawnProj(w, C, C, e, w.x[e], w.y[e], 4, 30, 2, 40, 0, -1, 1, -1);
      sum += w.pTy[0] - C;
    }
    expect(sum / 50).toBeGreaterThan(400 * RULES.env.windDrift * 0.7);
  }, 30000);
});

describe('倒塌重建与站在废墟上的人', () => {
  it('自家人站在城门废墟上不耽误重建；站在城墙废墟上的被挪到空地', () => {
    const w = game();
    clear(w);
    const hq = w.sites.find(s => s.type === SITE_HQ && s.owner === 1)!;
    const blds = hq.buildings.map(id => w.buildings[id]);
    const gate = blds.find(b => b.gate)!, wall = blds.find(b => b.def.key === 'wall')!;
    w.stock.stone[1] = 1e6;
    for (const b of [gate, wall]) w.damageBuilding(b, 1e9, 0, 1, 2);
    const g = w.spawnGroup(1, Array(4).fill(idx('yari')), gate.cx, gate.cy, 0, 1);
    w.orderStop(g, true);
    const onWall = w.spawnUnit(idx('yari'), 1, wall.cx, wall.cy);
    w.orderStop([onWall], true);
    run(w, RULES.site.bldCalm + 3);
    expect(gate.alive).toBe(true);
    expect(wall.alive).toBe(true);
    // 墙上那个人被挪出来了，不在墙格里
    expect(w.nav.bld[w.cellAt(w.x[onWall], w.y[onWall])]).not.toBe(wall.id);
  }, 30000);
});

describe('第十二轮：箭数、集结点', () => {
  /** 让建筑立刻放一轮箭，返回这一轮射出的箭各自的目标 */
  const volley = (w: World, id: number): number[] => {
    const b = w.buildings[id];
    // 先走一帧：新生成的单位要进了空间网格才找得到
    w.tick();
    w.pn = 0;
    b.cd = 0;
    updateTowers(w);
    const out: number[] = [];
    for (let p = 0; p < w.pn; p++) if (w.pSrc[p] === -b.id - 2) out.push(w.pTgt[p]);
    return out;
  };

  it('角楼、门楼一轮两支箭，望楼一支；据点升级后翻倍；多支箭分射不同的敌人', () => {
    const w = game();
    clear(w);
    w.env.wind = 0;
    const hq = w.sites.find(s => s.type === SITE_HQ && s.owner === 1)!;
    const tower = hq.buildings.map(id => w.buildings[id]).find(b => b.def.key === 'tower')!;
    const foes = w.spawnGroup(2, Array(6).fill(idx('dao')), tower.cx + 120, tower.cy + 120, 0, -1);
    for (const f of foes) w.hp[f] = w.maxHp[f] = 1e5;
    w.refreshVision();
    const t0 = volley(w, tower.id);
    expect(t0.length).toBe(2);
    expect(new Set(t0).size).toBe(2);
    expect(BUILDINGS.gate_h.tower!.arrows).toBe(2);
    expect(BUILDINGS.watchtower.tower!.arrows).toBe(1);
    expect(BUILDINGS.arrowtower.tower!.arrows).toBe(1);
    w.stock.stone[1] = 1e4;
    expect(w.upgradeSite(hq)).toBe(true);
    const t1 = volley(w, tower.id);
    expect(t1.length).toBe(4);
    expect(new Set(t1).size).toBe(4);
    // 射程里只有一个敌人：几支箭都射它
    for (const f of foes.slice(1)) w.removeUnit(f);
    expect(volley(w, tower.id)).toEqual([foes[0], foes[0], foes[0], foes[0]]);
  }, 30000);

  it('援军在出兵的据点里出现；没设集结点就留在据点，设了就开赴集结点；集结点只管之后新出的援军', () => {
    const w = game();
    clear(w);
    expect(w.rally[1]).toBe(null);
    const camp = w.sites.find(s => s.type === SITE_CAMP && s.owner === 1)!;
    const fire = (): number[] => {
      for (const s of w.sites) s.timer = 999;
      camp.timer = 0.01;
      const n0 = w.n;
      const before = new Set<number>();
      for (let i = 0; i < n0; i++) if (w.alive[i]) before.add(i);
      for (let t = 0; t < 30; t++) w.tick();
      const out: number[] = [];
      for (let i = 0; i < w.n; i++) if (w.alive[i] && !before.has(i) && w.team[i] === 1) out.push(i);
      return out;
    };
    const a = fire();
    expect(a.length).toBeGreaterThan(0);
    for (const u of a) {
      expect(Math.hypot(w.x[u] - camp.x, w.y[u] - camp.y)).toBeLessThan(camp.radius + 60);
      expect(w.order[u] === O_IDLE || w.pmode[u] !== 0).toBe(true);
    }
    const rx = camp.x + 900, ry = camp.y;
    w.rally[1] = { x: rx, y: ry };
    const b = fire();
    expect(b.length).toBeGreaterThan(0);
    for (const u of b) {
      expect(Math.hypot(w.x[u] - camp.x, w.y[u] - camp.y)).toBeLessThan(camp.radius + 60);
      expect(w.order[u]).toBe(O_AMOVE);
      expect(Math.hypot(w.destX[u] - rx, w.destY[u] - ry)).toBeLessThan(200);
    }
    // 先前出来的那批不受影响
    for (const u of a) expect(w.order[u] === O_AMOVE && Math.hypot(w.destX[u] - rx, w.destY[u] - ry) < 200).toBe(false);
    // 取消后新出的又留在据点
    w.rally[1] = null;
    for (const u of fire()) expect(w.order[u]).not.toBe(O_AMOVE);
  }, 30000);

  it('有城墙、木栅的据点：围墙之内（含墙顶）都能休整回血，墙外不行；没有围墙的仍按占领圈', () => {
    const w = game();
    clear(w);
    const town = w.sites.find(s => s.type === SITE_TOWN)!;
    give(w, town, 1);
    expect(town.walled).toBe(true);
    const mw = w.map.w;
    let x1 = 0, y1 = 0;
    for (let c = 0; c < w.enclosure.length; c++) if (w.enclosure[c] === town.id) {
      x1 = Math.max(x1, c % mw);
      y1 = Math.max(y1, (c / mw) | 0);
    }
    // 墙内东南角（占领圈之外）；以及墙外
    const inX = (x1 - 2.5) * TILE, inY = (y1 - 2.5) * TILE;
    expect(Math.hypot(inX - town.x, inY - town.y)).toBeGreaterThan(town.radius);
    const a = w.spawnUnit(idx('dao'), 1, inX, inY);
    const b = w.spawnUnit(idx('dao'), 1, (x1 + 3.5) * TILE, inY);
    w.hp[a] = w.hp[b] = 40;
    run(w, 4);
    expect(w.sheltered[a]).toBe(1);
    expect(w.hp[a]).toBeGreaterThan(40);
    expect(w.sheltered[b]).toBe(0);
    expect(w.hp[b]).toBe(40);
    const village = w.sites.find(s => s.type === SITE_VILLAGE)!;
    expect(village.walled).toBe(false);
  }, 30000);
});

