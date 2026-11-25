import { describe, expect, it } from 'vitest';
import {
  ARCHETYPES, BR_MILITARY, BUILDINGS, ELITE, FACTIONS, RULES, SITE_CAMP, SITE_CITY, SITE_FARM, SITE_INFO, SITE_LUMBER, SITE_MINE, SITE_OUTPOST, SITE_QUARRY, SITE_TOWN,
  TILE, UNITS, UNIT_BY_KEY, P_ARROW, P_BALL, A_SIEGE, forceList, reinforceMult,
} from '../src/sim/defs';
import { generateMap } from '../src/sim/map';
import { createGame } from '../src/sim/setup';
import { damageUnit, spawnProj, updateTowers } from '../src/sim/systems/combat';
import { outpostCount, setSiteLevel, siteUpgradeCost, towerCount, unitUpgradeCost, upgradeAllCost, upgradeQueue } from '../src/sim/systems/economy';
import { windRangeMul } from '../src/sim/systems/targeting';
import { Building, O_AMOVE, O_IDLE, S_TORCH, Site, World } from '../src/sim/world';
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
  it('地图上每方后方各有粮、木、石、金，另有金矿靠近中线；每处四个哨塔位', () => {
    for (const seed of [5, 42, 1234]) {
      const m = generateMap(seed);
      const n = (t: number): number => m.sites.filter(s => s.type === t).length;
      expect([n(SITE_FARM), n(SITE_LUMBER), n(SITE_QUARRY), n(SITE_MINE)]).toEqual([2, 2, 2, 4]);
      // 城池仍然排在最后（道路生成按这个找它）
      expect(m.sites[m.sites.length - 1].type).toBe(SITE_CITY);
      for (const s of m.sites) {
        if (SITE_INFO[s.type].category !== 'resource') continue;
        expect(s.owner).toBe(0);
        expect(s.slots!.length).toBe(4);
        for (const [tx, ty] of s.slots!) {
          // 哨塔位上没有别的建筑
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

  it('木材建哨塔：位置固定、最多四座；敌人要先摧毁全部哨塔才能占领，被毁的哨塔不会随易主复原', () => {
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
    // 敌军站到旗下：哨塔还在就不读秒，还会挨箭
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

  it('待命的部队被哨塔射中会上去拆塔', () => {
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

  it('哨塔、塔楼的视野比普通建筑远得多', () => {
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
  const blds = (w: World, s: Site, key: string): Building[] => s.buildings.map(id => w.buildings[id]).filter(b => b.def.key === key);

  it('升级花费：升到 2 级沿用各据点的升级花费，升到 3 级是它的 1.5 倍；资源点不能升级', () => {
    const w = game();
    clear(w);
    const want: [number, number, number][] = [
      [SITE_CITY, 320, 480], [SITE_TOWN, 220, 330], [SITE_CAMP, 127, 191],
    ];
    for (const [type, c2, c3] of want) {
      const s = w.sites.find(x => x.type === type)!;
      give(w, s, 1);
      setSiteLevel(w, s, 1);
      expect(siteUpgradeCost(s), SITE_INFO[type].label).toBe(c2);
      setSiteLevel(w, s, 2);
      expect(siteUpgradeCost(s), SITE_INFO[type].label).toBe(c3);
      setSiteLevel(w, s, 3);
      expect(siteUpgradeCost(s), SITE_INFO[type].label).toBe(0);
    }
    for (const type of [SITE_FARM, SITE_LUMBER, SITE_QUARRY, SITE_MINE]) {
      const s = w.sites.find(x => x.type === type)!;
      give(w, s, 1);
      expect(siteUpgradeCost(s)).toBe(0);
      expect(w.upgradeSite(s)).toBe(false);
    }
  });

  it('城池逐级升：花石料，每级按表加生命、护甲、箭矢伤害与射程，3 级角楼加炮弹、主堡加两发；易主后降回 1 级', () => {
    const w = game();
    clear(w);
    const town = w.sites.find(s => s.type === SITE_TOWN)!;
    give(w, town, 1);
    expect(town.level).toBe(1);
    expect(SITE_INFO[SITE_TOWN].material).toBe('stone');
    expect(SITE_INFO[SITE_CAMP].material).toBe('wood');
    // 木材升不了城池
    w.stock.wood[1] = 9999;
    expect(w.upgradeSite(town)).toBe(false);
    const L = RULES.economy.siteLevels;
    const hall = w.buildings[town.main];
    const tower = blds(w, town, 'tower')[0], gate = blds(w, town, 'gate_h')[0] ?? blds(w, town, 'gate_v')[0];
    expect(hall.def.key).toBe('keep_town');
    hall.hp = hall.def.hp * 0.5;
    hall.hitTick = w.tickCount;
    expect([hall.lv, hall.armor, hall.tower]).toEqual([1, 0, hall.def.tower]);
    // 2 级
    w.stock.stone[1] = 220 + 5;
    expect(w.upgradeSite(town)).toBe(true);
    expect(w.stock.stone[1]).toBeCloseTo(5, 5);
    expect(town.level).toBe(2);
    expect(hall.maxHp).toBe(Math.round(hall.def.hp * L[1].hp));
    // 新增的那部分生命补上，旧伤还在
    expect(hall.hp).toBeCloseTo(hall.maxHp - hall.def.hp * 0.5, 3);
    expect([hall.lv, tower.lv, hall.armor]).toEqual([2, 2, L[1].armor]);
    expect(tower.tower!.dmg).toBeCloseTo(tower.def.tower!.dmg * L[1].dmg, 5);
    expect(tower.tower!.range).toBeCloseTo(tower.def.tower!.range * L[1].range, 5);
    // 箭数不翻倍，2 级也没有炮弹
    expect(tower.tower!.arrows).toBe(tower.def.tower!.arrows);
    expect(hall.tower!.arrows).toBe(hall.def.tower!.arrows);
    expect(tower.tower!.shells ?? 0).toBe(0);
    expect(gate.tower).toBeNull();
    // 钱不够升 3 级
    expect(w.upgradeSite(town)).toBe(false);
    expect(town.level).toBe(2);
    // 3 级
    w.stock.stone[1] = 330 + 5;
    expect(w.upgradeSite(town)).toBe(true);
    expect(w.stock.stone[1]).toBeCloseTo(5, 5);
    expect(town.level).toBe(3);
    expect(hall.maxHp).toBe(Math.round(hall.def.hp * L[2].hp));
    expect([hall.lv, hall.armor]).toEqual([3, L[2].armor]);
    expect(tower.tower).toEqual({ range: tower.def.tower!.range * L[2].range, dmg: tower.def.tower!.dmg * L[2].dmg, cd: tower.def.tower!.cd, arrows: 2, shells: 1 });
    expect(hall.tower).toEqual({ range: hall.def.tower!.range * L[2].range, dmg: hall.def.tower!.dmg * L[2].dmg, cd: hall.def.tower!.cd, arrows: 4, shells: 2 });
    expect(gate.tower).toBeNull();
    // 满级不能再升
    w.stock.stone[1] = 1e5;
    expect(w.upgradeSite(town)).toBe(false);
    // 护甲加成：同样一击，3 级的城墙比 1 级的掉血少
    const wallA = blds(w, town, 'wall')[0];
    const wallB = blds(w, w.sites.find(s => s.type === SITE_CITY && s.owner === 2)!, 'wall')[0];
    w.damageBuilding(wallA, 30, 0, 1, 2);
    w.damageBuilding(wallB, 30, 0, 1, 1);
    expect(wallA.maxHp - wallA.hp).toBeLessThan(wallB.maxHp - wallB.hp);
    // 敌人拆光军事建筑再夺走城镇：等级降回 1 级，要重新升级
    for (const id of town.buildings) if (w.buildings[id].def.role === BR_MILITARY) w.damageBuilding(w.buildings[id], 1e9, 0, 1, 2);
    for (const u of garrison(w, town, 2, 3, 'yumi')) w.hp[u] = w.maxHp[u] = 1e6;
    run(w, SITE_INFO[SITE_TOWN].captureTime + 3);
    expect(town.owner).toBe(2);
    expect(town.level).toBe(1);
    expect(hall.maxHp).toBe(hall.def.hp);
    expect(hall.hp).toBeLessThanOrEqual(hall.maxHp);
    expect(hall.tower).toBe(hall.def.tower);
    expect(tower.tower).toBe(tower.def.tower);
    expect([hall.lv, tower.lv, hall.armor]).toEqual([1, 1, 0]);
  }, 30000);

  it('营寨逐级升：花木材，3 级哨塔变连弩哨塔、中军帐箭矢 ×3，没有炮弹；资源点自建的哨塔不随升级变化', () => {
    const w = game();
    clear(w);
    const camp = w.sites.find(s => s.type === SITE_CAMP && s.owner === 1)!;
    const post = blds(w, camp, 'watchtower')[0], tent = w.buildings[camp.main];
    expect(tent.def.key).toBe('cmdtent');
    expect([post.def.tower!.arrows, tent.def.tower!.arrows]).toEqual([1, 2]);
    w.stock.wood[1] = SITE_INFO[SITE_CAMP].upgradeCost;
    expect(w.upgradeSite(camp)).toBe(true);
    expect(w.stock.wood[1]).toBeCloseTo(0, 5);
    expect([camp.level, post.tower!.arrows, tent.tower!.arrows]).toEqual([2, 1, 2]);
    expect(w.upgradeSite(camp)).toBe(false);
    w.stock.wood[1] = siteUpgradeCost(camp);
    expect(w.upgradeSite(camp)).toBe(true);
    expect(w.stock.wood[1]).toBeCloseTo(0, 5);
    expect(camp.level).toBe(3);
    const L3 = RULES.economy.siteLevels[2];
    expect(post.tower).toEqual({ range: post.def.tower!.range * L3.range, dmg: post.def.tower!.dmg * L3.dmg, cd: post.def.tower!.cd, arrows: 3, shells: 0 });
    expect(tent.tower).toEqual({ range: tent.def.tower!.range * L3.range, dmg: tent.def.tower!.dmg * L3.dmg, cd: tent.def.tower!.cd, arrows: 6, shells: 0 });
    // 资源点的哨塔是后来搭的，设成几级都不变
    const farm = w.sites.find(s => s.type === SITE_FARM)!;
    give(w, farm, 1);
    w.stock.wood[1] = 1e4;
    expect(w.buildTower(farm)).toBe(true);
    const mine = farm.buildings.map(id => w.buildings[id]).find(b => b.extra)!;
    setSiteLevel(w, farm, 3);
    expect(mine.tower).toBe(mine.def.tower);
    expect([mine.lv, mine.armor, mine.maxHp]).toEqual([1, 0, mine.def.hp]);
  });

  it('3 级的炮楼与主堡放炮弹：每轮的发数按建筑、单发伤害 36 与半径 20 不随等级变；2 级与营寨没有炮弹', () => {
    const w = game();
    clear(w);
    w.env.wind = 0;
    const city = w.sites.find(s => s.type === SITE_CITY && s.owner === 1)!;
    const tower = blds(w, city, 'tower')[0], keep = w.buildings[city.main];
    const camp = w.sites.find(s => s.type === SITE_CAMP && s.owner === 1)!;
    const post = blds(w, camp, 'watchtower')[0];
    const foe = (b: Building): number => {
      const f = w.spawnUnit(idx('dao'), 2, b.cx + 60, b.cy + 60);
      w.hp[f] = w.maxHp[f] = 1e6;
      return f;
    };
    // 一轮炮弹：{发数，每发伤害，半径，种类}
    const salvo = (b: Building): { n: number; dmg: number[]; splash: number[]; atk: number[] } => {
      w.tick();
      w.pn = 0;
      b.cd = 0;
      updateTowers(w);
      const o = { n: 0, dmg: [] as number[], splash: [] as number[], atk: [] as number[] };
      for (let p = 0; p < w.pn; p++) if (w.pSrc[p] === -b.id - 2 && w.pType[p] === P_BALL) {
        o.n++;
        o.dmg.push(w.pDmg[p]);
        o.splash.push(w.pSplash[p]);
        o.atk.push(w.pAtk[p]);
      }
      return o;
    };
    for (const b of [tower, keep, post]) foe(b);
    w.refreshVision();
    w.stock.stone[1] = w.stock.wood[1] = 1e5;
    for (const lv of [1, 2]) {
      for (const b of [tower, keep]) expect(salvo(b).n, `${b.def.key} ${lv}`).toBe(0);
      w.upgradeSite(city);
    }
    expect(city.level).toBe(3);
    const t = salvo(tower), k = salvo(keep);
    expect([t.n, k.n]).toEqual([1, 2]);
    for (const o of [t, k]) {
      expect(o.dmg.every(d => d === RULES.economy.shell.dmg)).toBe(true);
      expect(o.splash.every(d => d === RULES.economy.shell.splash)).toBe(true);
      expect(o.atk.every(a => a === A_SIEGE)).toBe(true);
    }
    // 营寨升到 3 级也只加箭矢，不放炮弹
    for (let i = 0; i < 2; i++) w.upgradeSite(camp);
    expect(camp.level).toBe(3);
    expect(salvo(post).n).toBe(0);
  }, 30000);

  it('炮弹是范围伤害：一发炮弹落下，挤在一起的几个敌人都挨炸', () => {
    const w = game();
    clear(w);
    w.env.wind = 0;
    const city = w.sites.find(s => s.type === SITE_CITY && s.owner === 1)!;
    const tower = blds(w, city, 'tower')[0];
    setSiteLevel(w, city, 3);
    // 三个敌人挤在一起，一轮炮弹打最近的那个，旁边两个也挨到
    const cx = tower.cx + 100, cy = tower.cy + 100;
    const ids = [0, 7, 14].map(dx => w.spawnUnit(idx('dao'), 2, cx + dx, cy));
    for (const f of ids) w.hp[f] = w.maxHp[f] = 1e6;
    w.refreshVision();
    w.tick();
    w.pn = 0;
    tower.cd = 0;
    // 只留炮弹：先射出一轮，再把箭清掉
    updateTowers(w);
    let shells = 0;
    for (let p = w.pn - 1; p >= 0; p--) {
      if (w.pType[p] === P_BALL) { shells++; continue; }
      w.pType[p] = P_ARROW;
      w.pDmg[p] = 0;
    }
    expect(shells).toBe(1);
    for (let t = 0; t < 60; t++) w.tick();
    const lost = ids.map(f => 1e6 - w.hp[f]);
    expect(lost.filter(l => l > 0).length).toBeGreaterThanOrEqual(2);
  }, 30000);

  it('电脑逐级升级据点：手里有料就先把各据点升到 2 级、再升 3 级', () => {
    const g = createGame({ seed: 7, factions: ['china', 'japan'], armySize: 60, difficulty: 2, fog: false, spectate: false, environment: false, supply: false });
    const w = g.world;
    const seen = new Set<number>();
    for (let t = 0; t < 30 * 240; t++) {
      if (t % 30 === 0) {
        w.stock.stone[2] = w.stock.wood[2] = 1e5;
        for (const s of w.sites) if (s.owner === 2) seen.add(s.level);
      }
      w.tick();
      for (const ai of g.ais) ai.update();
      w.fxN = 0;
    }
    for (const s of w.sites) if (s.owner === 2) seen.add(s.level);
    expect([...seen].sort()).toEqual([1, 2, 3]);
  }, 120000);

  it('手里有石料 / 木材时建筑修得快得多，同时少量消耗', () => {
    const fix = (stone: number): { gain: number; used: number } => {
      const w = game();
      clear(w);
      const hq = w.sites.find(s => s.type === SITE_CITY && s.owner === 1)!;
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
    const hq = w.sites.find(s => s.type === SITE_CITY && s.owner === 1)!;
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
    // 伤害 = d² ÷ (d + 2 × 护甲)；雪天据点外护甲减半
    const dmg = (a: number): number => 100 / (10 + RULES.combat.armorScale * a);
    expect(hit(outside)).toBeCloseTo(dmg(arm), 5);
    snowy(w);
    expect(hit(outside)).toBeCloseTo(dmg(arm * RULES.env.snowArmor), 5);
    expect(hit(inside)).toBeCloseTo(dmg(arm), 5);
    expect(hit(outside)).toBeGreaterThan(hit(inside));
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
    const upgraded = w.sites.filter(s => s.level > 1).length;
    const towers = w.buildings.filter(b => b.def.key === RULES.economy.towerKey).length;
    if (import.meta.env.VITE_DUMP) console.log({ res, elite, upgraded, towers, stock: w.stock });
    expect(elite + upgraded + towers).toBeGreaterThan(0);
  }, 180000);
});

describe('第八轮：城防与占领', () => {
  it('据点构成：城池 4 角楼 4 门楼加主堡，营寨 4 哨塔 4 营门加中军帐，资源点没有塔；石城门四格宽', () => {
    for (const seed of [5, 42, 1234]) {
      const m = generateMap(seed);
      const occupied = (tx: number, ty: number): boolean =>
        m.buildings.some(b => tx >= b.tx && ty >= b.ty && tx < b.tx + BUILDINGS[b.def].w && ty < b.ty + BUILDINGS[b.def].h);
      m.sites.forEach((s, si) => {
        const mine = m.buildings.filter(b => b.site === si);
        const count = (...keys: string[]): number => mine.filter(b => keys.includes(b.def)).length;
        const main = mine.filter(b => b.main).map(b => b.def);
        const cat = SITE_INFO[s.type].category;
        if (cat === 'city') {
          expect([count('tower'), count('gate_h', 'gate_v'), count('watchtower', 'wgate_h', 'wgate_v')], `seed ${seed} ${s.name}`).toEqual([4, 4, 0]);
          expect(main).toEqual([s.type === SITE_CITY ? 'keep' : 'keep_town']);
        } else if (cat === 'camp') {
          expect([count('watchtower'), count('wgate_h', 'wgate_v'), count('tower', 'gate_h', 'gate_v')], `seed ${seed} ${s.name}`).toEqual([4, 4, 0]);
          expect(main).toEqual(['cmdtent']);
          expect(s.slots).toBeUndefined();
        } else if (cat === 'resource') {
          expect(count('tower', 'watchtower', 'arrowtower'), `seed ${seed} ${s.name}`).toBe(0);
          expect(s.slots!.length).toBe(4);
          for (const [tx, ty] of s.slots!) expect(occupied(tx, ty), `seed ${seed} ${s.name}`).toBe(false);
        }
      });
      // 所有营寨的构成与寨墙尺寸都相同：寨内只有营帐，没有别的建筑
      const camps = m.sites.map((s, si) => ({ s, si })).filter(x => x.s.type === SITE_CAMP);
      expect(camps.length).toBe(12);
      const span = (si: number): number[] => {
        const ws = m.buildings.filter(b => b.site === si && b.def === 'palisade');
        return [Math.max(...ws.map(b => b.tx)) - Math.min(...ws.map(b => b.tx)), Math.max(...ws.map(b => b.ty)) - Math.min(...ws.map(b => b.ty))];
      };
      for (const { si } of camps) {
        expect(span(si)).toEqual(span(camps[0].si));
        const kinds = new Set(m.buildings.filter(b => b.site === si).map(b => b.def));
        expect([...kinds].sort(), `seed ${seed}`).toEqual(['cmdtent', 'palisade', 'tent', 'watchtower', 'wgate_h', 'wgate_v'].filter(k => kinds.has(k)));
        expect(kinds.has('granary') || kinds.has('stable') || kinds.has('workshop') || kinds.has('farmhouse')).toBe(false);
      }
    }
    expect(BUILDINGS.gate_h.w).toBe(4);
    expect(BUILDINGS.gate_v.h).toBe(4);
    // 资源点能花木材建哨塔；营寨已有固定的哨塔，没有自建的位置
    const w = game();
    clear(w);
    const v = w.sites.find(s => s.type === SITE_FARM)!;
    give(w, v, 1);
    w.stock.wood[1] = RULES.economy.towerCost * 5;
    for (let k = 0; k < 4; k++) expect(w.buildTower(v)).toBe(true);
    expect(towerCount(w, v)).toBe(4);
    const camp = w.sites.find(s => s.type === SITE_CAMP && s.owner === 0)!;
    give(w, camp, 1);
    expect(camp.slots.length).toBe(0);
    expect(w.buildTower(camp)).toBe(false);
  }, 30000);

  it('敌占的城池、营寨要先拆光军事建筑才能读秒；只拆中央建筑不够，城防与普通建筑不用拆', () => {
    const w = game();
    clear(w);
    const town = w.sites.find(s => s.type === SITE_TOWN)!;
    give(w, town, 1);
    for (const u of garrison(w, town, 2, 3, 'yari')) w.hp[u] = w.maxHp[u] = 1e6;
    const military = town.buildings.map(id => w.buildings[id]).filter(b => b.def.role === BR_MILITARY);
    expect(military.length).toBeGreaterThan(1);
    run(w, SITE_INFO[SITE_TOWN].captureTime + 3);
    expect(town.owner).toBe(1);
    expect(town.cap).toBe(0);
    // 拆掉中央建筑，角楼还立着：照样不能读秒，据点也没易主
    w.damageBuilding(w.buildings[town.main], 1e9, 0, 1, 2);
    run(w, SITE_INFO[SITE_TOWN].captureTime + 3);
    expect(town.owner).toBe(1);
    expect(town.cap).toBe(0);
    // 全部拆光（城墙、门楼、民居都立着）：读秒，走完易主
    for (const b of military) w.damageBuilding(b, 1e9, 0, 1, 2);
    expect(town.buildings.some(id => w.buildings[id].alive && w.buildings[id].def.role !== BR_MILITARY)).toBe(true);
    run(w, SITE_INFO[SITE_TOWN].captureTime + 3);
    expect(town.owner).toBe(2);
    expect(military.every(b => b.alive && b.hp === b.maxHp)).toBe(true);
  }, 30000);

  it('倒塌的角楼在据点脱离战斗后自行重建，修满之前不放箭；交战时停修', () => {
    const w = game();
    clear(w);
    const hq = w.sites.find(s => s.type === SITE_CITY && s.owner === 1)!;
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
    // 只看天气，其余系统不跑：整局推进 40 分钟要半分钟以上，会把测试进程卡到超时
    w.systems = w.systems.filter(s => s.name === 'environment');
    let windyWet = 0, wet = 0, windyDry = 0, dry = 0, calmZero = true;
    for (let t = 0; t < 30 * 60 * 40; t++) {
      w.tick();
      w.events.length = 0;
      if (t % 30) continue;
      const isWet = w.env.raining || w.env.snowing;
      if (isWet) { wet++; if (w.env.windy) windyWet++; } else { dry++; if (w.env.windy) windyDry++; }
      if (!w.env.windy && w.env.wind > 0 && w.env.windTarget === 0) calmZero = false;
    }
    expect(wet).toBeGreaterThan(0);
    expect(windyWet / wet).toBeGreaterThan(windyDry / dry);
    expect(windyDry / dry).toBeLessThan(0.6);
    expect(calmZero).toBe(true);
  });
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
    const hq = w.sites.find(s => s.type === SITE_CITY && s.owner === 1)!;
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
    for (let p = 0; p < w.pn; p++) if (w.pSrc[p] === -b.id - 2 && w.pType[p] === P_ARROW) out.push(w.pTgt[p]);
    return out;
  };
  /** 刚放完一轮后，在飞的炮弹数 */
  const shellsOf = (w: World, id: number): number => {
    let n = 0;
    for (let p = 0; p < w.pn; p++) if (w.pSrc[p] === -id - 2 && w.pType[p] === P_BALL) n++;
    return n;
  };

  it('角楼一轮两支箭、主堡四支，哨塔一支、中军帐两支，门楼不放箭；升级不改箭数；多支箭分射不同的敌人', () => {
    const w = game();
    clear(w);
    w.env.wind = 0;
    const hq = w.sites.find(s => s.type === SITE_CITY && s.owner === 1)!;
    const tower = hq.buildings.map(id => w.buildings[id]).find(b => b.def.key === 'tower')!;
    const foes = w.spawnGroup(2, Array(6).fill(idx('dao')), tower.cx + 120, tower.cy + 120, 0, -1);
    for (const f of foes) w.hp[f] = w.maxHp[f] = 1e5;
    w.refreshVision();
    const t0 = volley(w, tower.id);
    expect(t0.length).toBe(2);
    expect(new Set(t0).size).toBe(2);
    const B = BUILDINGS;
    expect(B.tower.tower!.arrows).toBe(2);
    // 主堡相当于 2 座角楼，中军帐相当于 2 座哨塔：射程、单支伤害、间隔相同
    for (const k of ['keep', 'keep_town']) expect(B[k].tower, k).toEqual({ ...B.tower.tower!, arrows: 4 });
    expect(B.watchtower.tower!.arrows).toBe(1);
    expect(B.arrowtower.tower).toEqual(B.watchtower.tower);
    expect(B.cmdtent.tower).toEqual({ ...B.watchtower.tower!, arrows: 2 });
    for (const k of ['gate_h', 'gate_v', 'wgate_h', 'wgate_v']) expect(B[k].tower, k).toBeNull();
    // 升级不再让箭数翻倍：2 级与 3 级的角楼仍是两支箭，3 级起另加一发炮弹
    w.stock.stone[1] = 1e4;
    expect(w.upgradeSite(hq)).toBe(true);
    expect(volley(w, tower.id).length).toBe(2);
    expect(w.upgradeSite(hq)).toBe(true);
    expect(volley(w, tower.id).length).toBe(2);
    expect(shellsOf(w, tower.id)).toBe(1);
    // 射程里只有一个敌人：几支箭都射它
    for (const f of foes.slice(1)) w.removeUnit(f);
    expect(volley(w, tower.id)).toEqual([foes[0], foes[0]]);
  }, 30000);

  it('援军在出兵的据点里出现；没设集结点就留在据点，设了就开赴集结点；集结点只管之后新出的援军', () => {
    const w = game();
    clear(w);
    expect(w.sites.every(s => s.owner !== 1 || s.rally === null)).toBe(true);
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
    camp.rally = { x: rx, y: ry };
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
    camp.rally = null;
    for (const u of fire()) expect(w.order[u]).not.toBe(O_AMOVE);
  }, 30000);

  it('集结点按据点设：只有设了的据点新出的援军开赴那里，别的据点的留在原地', () => {
    const w = game();
    clear(w);
    const mine = w.sites.filter(s => s.owner === 1 && SITE_INFO[s.type].reinf);
    expect(mine.length).toBeGreaterThanOrEqual(2);
    const [a, b] = mine;
    const spot = { x: a.x + 900, y: a.y };
    a.rally = spot;
    const fire = (s: Site): number[] => {
      for (const o of w.sites) o.timer = 999;
      s.timer = 0.01;
      const before = new Set<number>();
      for (let i = 0; i < w.n; i++) if (w.alive[i]) before.add(i);
      for (let t = 0; t < 30; t++) w.tick();
      const out: number[] = [];
      for (let i = 0; i < w.n; i++) if (w.alive[i] && !before.has(i) && w.team[i] === 1) out.push(i);
      return out;
    };
    const toSpot = (u: number): boolean => w.order[u] === O_AMOVE && Math.hypot(w.destX[u] - spot.x, w.destY[u] - spot.y) < 200;
    const ua = fire(a);
    expect(ua.length).toBeGreaterThan(0);
    expect(ua.every(toSpot)).toBe(true);
    const ub = fire(b);
    expect(ub.length).toBeGreaterThan(0);
    expect(ub.some(toSpot)).toBe(false);
    for (const u of ub) expect(w.order[u]).not.toBe(O_AMOVE);
    // 取消 A 的：它新出的也留下；B 的集结点不受影响
    b.rally = { x: spot.x, y: spot.y };
    a.rally = null;
    expect(fire(a).some(toSpot)).toBe(false);
    expect(fire(b).every(toSpot)).toBe(true);
  }, 30000);

  it('据点易主时集结点清除：电脑新占的出援军据点设回出发阵地（资源点不设），玩家新占的据点援军留守', () => {
    const w = game();
    clear(w);
    const dp = w.map.deploy[2];
    // 开局：电脑所有据点的集结点都在出发阵地；玩家的都没设
    const ai = w.sites.filter(s => s.owner === 2);
    expect(ai.length).toBeGreaterThan(0);
    for (const s of ai) expect(s.rally).toEqual({ x: dp.x, y: dp.y });
    for (const s of w.sites) if (s.owner === 1) expect(s.rally).toBe(null);
    const lumber = w.sites.find(s => s.type === SITE_LUMBER)!;
    // 玩家的据点设了集结点，被电脑夺走：前主人的作废；资源点不出援军，电脑也不给它设出发阵地（出援军据点的情形见 sites.test.ts）
    give(w, lumber, 1);
    lumber.rally = { x: 100, y: 100 };
    garrison(w, lumber, 2);
    run(w, SITE_INFO[SITE_LUMBER].captureTime + 3);
    expect(lumber.owner).toBe(2);
    expect(lumber.rally).toBe(null);
    // 玩家夺回：电脑的作废，玩家新占的据点不设
    clear(w);
    garrison(w, lumber, 1);
    run(w, SITE_INFO[SITE_LUMBER].captureTime + 3);
    expect(lumber.owner).toBe(1);
    expect(lumber.rally).toBe(null);
  }, 30000);

  it('有城墙、木栅的据点：围墙之内（含墙顶）都能休整回血，墙外不行；没有围墙的仍按占领圈', () => {
    const w = game();
    clear(w);
    const town = w.sites.find(s => s.type === SITE_TOWN)!;
    give(w, town, 1);
    expect(town.rect).not.toBeNull();
    const r = town.rect!, x1 = r.x1 / TILE - 1, y1 = r.y1 / TILE - 1;
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
    const camp = w.sites.find(s => s.type === SITE_CAMP && s.owner === 0)!;
    expect(camp.rect).not.toBeNull();
    const farm = w.sites.find(s => s.type === SITE_FARM)!;
    expect(farm.rect).toBeNull();
  }, 30000);
});


describe('据点构成与胜负', () => {
  const FULL_TOTAL: Record<string, number> = { china: 16, japan: 15, rome: 13, persia: 10 };
  const archOf = (key: string): string => ARCHETYPES[UNIT_BY_KEY[key].arch].key;

  it('城池与城镇共用每个阵营的一张全兵种援军表：步兵、远程、骑兵、器械齐全，人数取原城池援军表的总人数', () => {
    for (const f of Object.values(FACTIONS)) {
      const archs = new Set(f.reinf.map(([k]) => archOf(k)));
      expect(archs.has('inf'), f.id).toBe(true);
      expect(archs.has('ranged') || archs.has('cavr'), f.id).toBe(true);
      expect(archs.has('cav') || archs.has('cavr'), f.id).toBe(true);
      expect(archs.has('siege') || archs.has('vehicle'), f.id).toBe(true);
      expect(forceList(f.reinf, 1).length, f.id).toBe(FULL_TOTAL[f.id]);
      // 编成只用本阵营的兵种
      for (const [k] of f.reinf) expect(UNIT_BY_KEY[k].faction, k).toBe(f.id);
    }
    expect(SITE_INFO[SITE_CITY].reinf).toBe('full');
    expect(SITE_INFO[SITE_TOWN].reinf).toBe('full');
    expect(SITE_INFO[SITE_TOWN].reinfScale).toBe(0.6);
    expect(SITE_INFO[SITE_CITY].interval).toBe(55);
    expect(SITE_INFO[SITE_TOWN].interval).toBe(60);
  });

  it('城池出的援军包含步兵、远程、骑兵、器械；城镇每批是城池的 0.6 倍', () => {
    const w = game();
    clear(w);
    const city = w.sites.find(s => s.type === SITE_CITY && s.owner === 0)!;
    const town = w.sites.find(s => s.type === SITE_TOWN)!;
    give(w, city, 1);
    give(w, town, 1);
    const batch = (s: Site): number[] => {
      for (const o of w.sites) o.timer = 999;
      s.timer = 0.01;
      const before = new Set<number>();
      for (let i = 0; i < w.n; i++) if (w.alive[i]) before.add(i);
      run(w, 1);
      const out: number[] = [];
      for (let i = 0; i < w.n; i++) if (w.alive[i] && !before.has(i) && w.team[i] === 1) out.push(i);
      return out;
    };
    const c = batch(city), t = batch(town);
    const archs = new Set(c.map(i => archOf(w.defs[w.type[i]].key)));
    for (const need of ['inf', 'ranged', 'cav', 'siege']) expect(archs.has(need), need).toBe(true);
    const mult = reinforceMult(FACTIONS.china);
    expect(c.length).toBe(forceList(FACTIONS.china.reinf, mult).length);
    expect(t.length).toBe(forceList(FACTIONS.china.reinf, mult * 0.6).length);
    expect(t.length).toBeLessThan(c.length);
  });

  it('开局双方各有一座城池和一座营寨，没有大本营；开局粮草收入是城池 40 加营寨 11.2', () => {
    const g = createGame({ seed: 5, factions: ['china', 'japan'], armySize: 60, difficulty: 1, fog: false, spectate: false, environment: false });
    const w = g.world;
    for (const tm of [1, 2]) {
      const mine = w.sites.filter(s => s.owner === tm);
      expect(mine.map(s => s.type).sort()).toEqual([SITE_CITY, SITE_CAMP].sort());
      expect(mine.reduce((n, s) => n + SITE_INFO[s.type].food, 0)).toBeCloseTo(51.2, 6);
    }
    expect(SITE_INFO[SITE_CITY].food).toBe(40);
    expect(SITE_INFO[SITE_TOWN].food).toBe(18);
    const homes = w.sites.filter(s => s.owner === 1 && s.type === SITE_CITY);
    expect(homes[0].name).toContain('都城');
    // 开局城池与地图中央的城池类型、占地相同
    const center = w.sites.find(s => s.type === SITE_CITY && s.owner === 0)!;
    const spanOf = (s: Site): number[] => {
      const ws = s.buildings.map(id => w.buildings[id]).filter(b => b.def.key === 'wall');
      return [Math.max(...ws.map(b => b.tx)) - Math.min(...ws.map(b => b.tx)), Math.max(...ws.map(b => b.ty)) - Math.min(...ws.map(b => b.ty))];
    };
    expect(spanOf(homes[0])).toEqual(spanOf(center));
  });

  it('墙上远程单位所受的远程伤害减半', () => {
    expect(RULES.siege.wallCover).toBe(0.5);
  });
});
