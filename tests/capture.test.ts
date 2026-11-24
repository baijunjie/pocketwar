import { describe, expect, it } from 'vitest';
import {
  A_FIRE, BR_COMMON, BR_DEFENSE, BR_MILITARY, BUILDINGS, RULES, SITE_CITY, SITE_FARM, SITE_CAMP, SITE_INFO, SITE_OUTPOST, TILE, UNIT_BY_KEY,
} from '../src/sim/defs';
import { createGame } from '../src/sim/setup';
import { splashDamage } from '../src/sim/systems/combat';
import { fightState } from '../src/sim/systems/sites';
import { canAttackBuilding, findBuilding } from '../src/sim/systems/targeting';
import { NONE, O_ATTACK, Site, World } from '../src/sim/world';
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
const military = (w: World, s: Site) => s.buildings.map(id => w.buildings[id]).filter(b => b.def.role === BR_MILITARY);
/** 血量无限、原地坚守的单位 */
const tank = (w: World, tm: number, key: string, x: number, y: number): number => {
  const u = w.spawnUnit(idx(key), tm, x, y);
  w.hp[u] = w.maxHp[u] = 1e7;
  w.orderStop([u], true);
  return u;
};

describe('建筑角色', () => {
  it('每种建筑都声明了角色：会放箭的是军事建筑，墙与门是城防，其余是普通建筑；只有普通建筑不可被攻击（行营例外）', () => {
    for (const d of Object.values(BUILDINGS)) {
      expect(d.role === BR_MILITARY, d.key).toBe(d.tower !== null);
      if (d.role === BR_DEFENSE) expect(d.kind === 0 || d.kind === 1, d.key).toBe(true);
      expect(d.hittable, d.key).toBe(d.role !== BR_COMMON || d.key === 'outpost');
    }
    for (const k of ['tower', 'keep', 'keep_town', 'watchtower', 'cmdtent', 'arrowtower']) expect(BUILDINGS[k].role).toBe(BR_MILITARY);
    for (const k of ['wall', 'gate_h', 'gate_v', 'palisade', 'wgate_h', 'wgate_v']) expect(BUILDINGS[k].role).toBe(BR_DEFENSE);
    for (const k of ['house', 'barracks', 'tent', 'farmstead', 'lumbercamp', 'quarry', 'goldmine']) {
      expect(BUILDINGS[k].role).toBe(BR_COMMON);
    }
  });
});

describe('普通建筑不可攻击', () => {
  it('攻击指令、范围伤害、直接伤害、自动索敌、挡路时的就地攻击都不碰它；对寻路是实心障碍', () => {
    const w = flatWorld();
    const house = w.addBuilding(BUILDINGS.house, 60, 60, 2, -1);
    const post = w.addBuilding(BUILDINGS.watchtower, 66, 60, 2, -1);
    post.tower = null;
    const hp0 = house.hp;
    expect(canAttackBuilding(house, 1, true)).toBe(false);
    expect(canAttackBuilding(post, 1, false)).toBe(true);
    expect(canAttackBuilding(post, 2, true)).toBe(false);
    // 攻击指令：被忽略
    const u = tank(w, 1, 'yari', house.x0 - 20, house.cy);
    w.orderAttackBuilding([u], house);
    expect(w.order[u]).not.toBe(O_ATTACK);
    expect(w.target[u]).toBe(NONE);
    // 直接伤害与范围伤害（含火把）
    w.damageBuilding(house, 1e9, 0, 1, 1);
    w.damageBuilding(house, 1e9, A_FIRE, 1, 1);
    splashDamage(w, house.cx, house.cy, 60, 1e9, 0, 0, { vs: null, vsBld: 5, siege: true }, 1, NONE, true);
    expect(house.hp).toBe(hp0);
    expect(house.alive).toBe(true);
    // 对寻路：敌我双方都是实心障碍，没有「打穿」的代价
    const c = house.ty * w.map.w + house.tx;
    expect(w.nav.block[1][c]).toBe(1);
    expect(w.nav.cost[1][c]).toBe(0);
    expect(w.nav.cost[2][c]).toBe(0);
    const pc = post.ty * w.map.w + post.tx;
    expect(w.nav.cost[1][pc]).toBeGreaterThan(0);
    // 自动索敌：待命的单位在旁边站着，不去打房子，却会打能打的哨塔
    w.removeUnit(u);
    const d = UNIT_BY_KEY.yari;
    expect(findBuilding(w, 0, house.x0 - 10, house.cy, 1, 60, d)).toBe(-1);
    expect(findBuilding(w, 0, post.x0 - 10, post.cy, 1, 200, d)).toBe(post.id);
    const idle = w.spawnUnit(idx('yari'), 1, post.x0 - 20, house.cy);
    w.hp[idle] = w.maxHp[idle] = 1e7;
    run(w, 20);
    expect(house.hp).toBe(hp0);
    expect(post.hp).toBeLessThan(post.maxHp);
  });
});

describe('中立军事建筑', () => {
  it('向敌我双方放箭，自动索敌会打它；中立的城防不挑', () => {
    const w = flatWorld();
    const tw = w.addBuilding(BUILDINGS.watchtower, 60, 60, 0, -1);
    // 中立的塔打离得最近的兵：先只有一号的兵，再换成只有二号的兵
    const a = tank(w, 1, 'yari', tw.cx - 120, tw.cy);
    run(w, 6);
    expect(w.hp[a]).toBeLessThan(1e7);
    const b = tank(w, 2, 'yari', tw.cx + 80, tw.cy);
    run(w, 6);
    expect(w.hp[b]).toBeLessThan(1e7);
    // 自动索敌：中立的哨塔挑得中，中立的营门、木栅不挑
    const gate = w.addBuilding(BUILDINGS.wgate_h, 60, 54, 0, -1);
    w.addBuilding(BUILDINGS.palisade, 62, 57, 0, -1);
    const d = UNIT_BY_KEY.yari;
    expect(findBuilding(w, a, tw.cx - 100, gate.cy + 10, 1, 300, d)).toBe(tw.id);
    w.damageBuilding(tw, 1e9, 0, 1, 1);
    expect(findBuilding(w, a, tw.cx - 100, gate.cy + 10, 1, 300, d)).toBe(NONE);
  });
});

describe('占领条件：拆光军事建筑', () => {
  const camp = (w: World): Site => w.sites.find(s => s.type === SITE_CAMP && s.owner === 0)!;

  it('中立据点：军事建筑没拆光不能读秒，拆光后读秒；读秒期间不重建，走完占领并修复', () => {
    const w = game();
    clear(w);
    // 中立的城池：读秒 30 秒，比建筑「脱离战斗」的 15 秒长，正好看出读秒期间没有重建
    const s = w.sites.find(x => x.type === SITE_CITY && x.owner === 0)!;
    const mil = military(w, s);
    expect(mil.length).toBe(5);
    for (const b of mil) expect(b.owner).toBe(0);
    tank(w, 1, 'yari', s.x, s.y + 16);
    const T = SITE_INFO[s.type].captureTime;
    run(w, T + 3);
    expect(s.owner).toBe(0);
    expect(s.cap).toBe(0);
    // 只剩一座也不行
    for (const b of mil.slice(1)) w.damageBuilding(b, 1e9, 0, 1, 1);
    run(w, T + 3);
    expect(s.owner).toBe(0);
    expect(s.cap).toBe(0);
    w.damageBuilding(mil[0], 1e9, 0, 1, 1);
    expect(mil.every(b => !b.alive)).toBe(true);
    // 读秒期间圈内有进攻方的人：算交战，军事建筑不重建
    run(w, RULES.site.bldCalm + 3);
    expect(fightState(w, s).fighting).toBe(true);
    expect(mil.every(b => !b.alive)).toBe(true);
    expect(s.cap).toBeGreaterThan(0.5);
    expect(s.owner).toBe(0);
    run(w, T);
    expect(s.owner).toBe(1);
    expect(mil.every(b => b.alive && b.hp === b.maxHp && b.owner === 1)).toBe(true);
  }, 30000);

  it('敌占据点同样：中央建筑拆了、角楼还立着，不能读秒', () => {
    const w = game();
    clear(w);
    const city = w.sites.find(s => s.type === SITE_CITY && s.owner === 2)!;
    tank(w, 1, 'yari', city.x, city.y + 16);
    for (const b of military(w, city)) if (b.id !== city.main) b.tower = null;
    w.damageBuilding(w.buildings[city.main], 1e9, 0, 1, 1);
    run(w, SITE_INFO[SITE_CITY].captureTime + 3);
    expect(city.owner).toBe(2);
    expect(city.cap).toBe(0);
  }, 30000);

  it('资源点没有军事建筑，主建筑不可攻击；自建的哨塔要拆光才能占领', () => {
    const w = game();
    clear(w);
    const farm = w.sites.find(s => s.type === SITE_FARM)!;
    expect(military(w, farm).length).toBe(0);
    const main = w.buildings[farm.main];
    w.damageBuilding(main, 1e9, 0, 1, 1);
    expect(main.alive).toBe(true);
    give(w, farm, 2);
    w.stock.wood[2] = 1e4;
    expect(w.buildTower(farm)).toBe(true);
    tank(w, 1, 'yari', farm.x, farm.y + 16);
    run(w, SITE_INFO[SITE_FARM].captureTime + 3);
    expect(farm.owner).toBe(2);
    w.damageBuilding(military(w, farm)[0], 1e9, 0, 1, 1);
    run(w, SITE_INFO[SITE_FARM].captureTime + 3);
    expect(farm.owner).toBe(1);
  }, 30000);
});

describe('中立据点与资源点的恢复', () => {
  it('中立据点不在交战时自行重建倒塌的军事建筑，修满前不放箭；圈内有任何一方的兵就算交战，不重建', () => {
    const w = game();
    clear(w);
    const s = w.sites.find(x => x.type === SITE_CAMP && x.owner === 0)!;
    const tw = military(w, s)[0];
    w.damageBuilding(tw, 1e9, 0, 1, 1);
    // 圈内有一个乙方的兵（没打建筑）：交战，不重建
    const foe = tank(w, 2, 'yari', s.x + s.radius - 40, s.y);
    run(w, RULES.site.bldCalm + 5);
    expect(fightState(w, s).fighting).toBe(true);
    expect(fightState(w, s).foes).toBe(1);
    expect(tw.alive).toBe(false);
    // 走了：转为平静，倒塌的塔重建，归属仍是中立，修满前不放箭
    w.removeUnit(foe);
    run(w, 6);
    expect(tw.alive && tw.down).toBe(true);
    expect(tw.owner).toBe(0);
    expect(tw.hp).toBeGreaterThan(0);
    // 修满后恢复放箭
    run(w, 1 / RULES.site.bldRegen + 5);
    expect(tw.down).toBe(false);
    expect(tw.hp).toBe(tw.maxHp);
    const u = tank(w, 1, 'yari', tw.cx, tw.cy + 100);
    run(w, 6);
    expect(w.hp[u]).toBeLessThan(1e7);
  }, 30000);

  it('资源点没有恢复能力：受伤的哨塔不自修，被毁的不会自己重建', () => {
    const w = game();
    clear(w);
    const farm = w.sites.find(s => s.type === SITE_FARM)!;
    give(w, farm, 1);
    w.stock.wood[1] = 1e4;
    w.buildTower(farm);
    const tw = military(w, farm)[0];
    tw.hp = tw.maxHp * 0.5;
    tw.hitTick = -99999;
    run(w, 30);
    expect(tw.hp).toBe(tw.maxHp * 0.5);
    w.damageBuilding(tw, 1e9, 0, 2, 2);
    run(w, RULES.site.bldCalm + 60);
    expect(tw.alive).toBe(false);
    // 要花资源在原位重建
    expect(w.buildTower(farm)).toBe(true);
    expect(tw.alive).toBe(true);
  }, 30000);
});

describe('中央建筑被毁：不易主、不变废墟，只停援军', () => {
  it('主堡倒了据点照旧归原主、建筑不转中立、不判负；援军计时暂停，重建立起来后恢复', () => {
    const w = game();
    clear(w);
    const city = w.sites.find(s => s.type === SITE_CITY && s.owner === 1)!;
    const keep = w.buildings[city.main];
    w.damageBuilding(keep, 1e9, 0, 2, 2);
    expect(keep.alive).toBe(false);
    run(w, 1);
    expect(city.owner).toBe(1);
    expect(city.gone).toBe(false);
    expect(city.buildings.every(id => w.buildings[id].owner === 1)).toBe(true);
    expect(w.winner).toBe(0);
    expect(w.events.some(e => e.kind === 'razed')).toBe(false);
    // 援军停了：计时不走，到点也不出兵
    const timer = city.timer, before = w.arrived[1];
    city.timer = 1;
    run(w, 5);
    expect(city.timer).toBe(1);
    expect(w.arrived[1]).toBe(before);
    expect(timer).toBeGreaterThan(0);
    // 脱离战斗后主堡重建，立起来之后援军恢复
    w.stock.stone[1] = 1e6;
    run(w, RULES.site.bldCalm + 3);
    expect(keep.alive).toBe(true);
    run(w, 3);
    expect(w.arrived[1]).toBeGreaterThan(before);
    expect(city.owner).toBe(1);
  }, 30000);

  it('临时据点的行营仍然可以被攻击：被毁则这座据点没了', () => {
    const w = game();
    clear(w);
    const s = w.addSite(SITE_OUTPOST, '行营', C, C, 1);
    const b = w.addBuilding(BUILDINGS.outpost, 60, 60, 1, s.id);
    s.buildings.push(b.id);
    s.main = b.id;
    expect(canAttackBuilding(b, 2, false)).toBe(true);
    w.damageBuilding(b, 1e9, 0, 2, 2);
    expect(s.gone).toBe(true);
    expect(s.owner).toBe(0);
  });
});

describe('电脑攻占据点', () => {
  it('到了据点先拆军事建筑，拆光后肃清、读秒占下来，不会站在旗下干等', () => {
    const g = createGame({ seed: 5, factions: ['china', 'japan'], armySize: 60, difficulty: 1, fog: false, spectate: true, environment: false, supply: false });
    const w = g.world;
    clear(w);
    const ai = g.ais.find(a => (a as unknown as { team: number }).team === 2)!;
    // 给 1 号一座营寨（带哨塔与中军帐），2 号的一队兵压在它旁边，1 号没有别的兵
    const s = w.sites.find(x => x.type === SITE_CAMP && x.owner === 0)!;
    give(w, s, 1);
    const slots = w.spawnGroup(2, Array(40).fill(idx('yari')), s.x, s.y + 150, 0, -1);
    for (const u of slots) w.hp[u] = w.maxHp[u] = 1e5;
    (ai as unknown as { addGroup(sl: number[], guard: boolean): void }).addGroup(slots, false);
    const mil = military(w, s);
    let allDown = -1, capturedAt = -1;
    for (let t = 0; t < 30 * 300 && !w.winner; t++) {
      w.tick();
      ai.update();
      w.fxN = 0;
      if (allDown < 0 && mil.every(b => !b.alive)) allDown = t;
      if (s.owner === 2) {
        capturedAt = t;
        break;
      }
    }
    expect(allDown).toBeGreaterThan(0);
    expect(capturedAt).toBeGreaterThan(allDown);
  }, 60000);
});
