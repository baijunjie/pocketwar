import { describe, expect, it } from 'vitest';
import { BR_COMMON, BR_DEFENSE, BR_MILITARY, FACTIONS, SITE_CAMP, SITE_CITY, SITE_FARM, SITE_INFO, UNITS, UNIT_BY_KEY, headcount } from '../../../src/sim/defs';
import { createGame } from '../../../src/sim/setup';
import { campBatch, defenseLocked, factionUnits, initPicks, militaryLeft, pickedUnit, reinfPaused } from '../../../src/sim/systems/sites';
import type { Site, World } from '../../../src/sim/world';
import { BASE, contentUnits } from '../../../tools/measure/units';
import { flatWorld, run } from '../../helpers';

const idx = (k: string): number => UNIT_BY_KEY[k].idx;
const game = (): World => createGame({
  seed: 5, factions: ['china', 'japan'], armySize: 60, difficulty: 1, fog: false, spectate: false, environment: false, supply: false,
}).world;
const clear = (w: World): void => {
  for (let i = 0; i < w.n; i++) if (w.alive[i]) w.removeUnit(i);
};
const roleOf = (w: World, s: Site, role: number) => s.buildings.map(id => w.buildings[id]).filter(b => b.def.role === role);
const ownSite = (w: World, type: number, tm: number): Site => w.sites.find(s => s.type === type && s.owner === tm)!;

describe('占领前的守备：defenseLocked', () => {
  it('敌方据点：军事建筑有一座立着就锁着；全拆光才解锁，城防与普通建筑不用拆', () => {
    const w = game();
    const s = ownSite(w, SITE_CAMP, 2);
    const mil = roleOf(w, s, BR_MILITARY);
    expect(mil.length).toBeGreaterThan(1);
    expect(roleOf(w, s, BR_DEFENSE).length).toBeGreaterThan(0);
    expect(roleOf(w, s, BR_COMMON).length).toBeGreaterThan(0);
    expect(defenseLocked(w, s, 1)).toBe(true);
    for (const b of mil.slice(0, -1)) w.damageBuilding(b, 1e9, 0, 1, 1);
    expect(defenseLocked(w, s, 1)).toBe(true);
    w.damageBuilding(mil[mil.length - 1], 1e9, 0, 1, 1);
    expect(defenseLocked(w, s, 1)).toBe(false);
    // 城防与普通建筑都还立着
    expect(roleOf(w, s, BR_DEFENSE).some(b => b.alive)).toBe(true);
    expect(roleOf(w, s, BR_COMMON).some(b => b.alive)).toBe(true);
  });

  it('中立据点与敌方据点一样：军事建筑立着就锁着', () => {
    const w = game();
    const s = w.sites.find(x => x.type === SITE_CITY && x.owner === 0) ?? w.sites.find(x => x.type === SITE_CAMP && x.owner === 0)!;
    expect(roleOf(w, s, BR_MILITARY).length).toBeGreaterThan(0);
    for (const tm of [1, 2]) expect(defenseLocked(w, s, tm)).toBe(true);
    for (const b of roleOf(w, s, BR_MILITARY)) w.damageBuilding(b, 1e9, 0, 1, 1);
    for (const tm of [1, 2]) expect(defenseLocked(w, s, tm)).toBe(false);
  });

  it('自己的军事建筑不锁自己；对方的军事建筑锁着', () => {
    const w = game();
    const s = ownSite(w, SITE_CITY, 1);
    expect(defenseLocked(w, s, 1)).toBe(false);
    expect(defenseLocked(w, s, 2)).toBe(true);
  });

  it('资源点没有军事建筑，不锁；自建的哨塔立着才锁，倒了就解开', () => {
    const w = game();
    const s = w.sites.find(x => x.type === SITE_FARM)!;
    expect(defenseLocked(w, s, 1)).toBe(false);
    s.owner = 2;
    w.stock.wood[2] = 1e5;
    expect(w.buildTower(s)).toBe(true);
    expect(defenseLocked(w, s, 1)).toBe(true);
    expect(defenseLocked(w, s, 2)).toBe(false);
    for (const b of roleOf(w, s, BR_MILITARY)) w.damageBuilding(b, 1e9, 0, 1, 1);
    for (const sl of s.slots) if (sl.bld >= 0) w.damageBuilding(w.buildings[sl.bld], 1e9, 0, 1, 1);
    expect(defenseLocked(w, s, 1)).toBe(false);
  });
});

describe('援军人数上限', () => {
  it('到了人数上限就不出援军，计时改为 5 秒后再看；有了空位再出', () => {
    const w = game();
    const s = ownSite(w, SITE_CITY, 1);
    for (const o of w.sites) o.timer = 999;
    s.timer = 0.01;
    w.unitCap[1] = w.teamCount[1];
    const n0 = w.teamCount[1];
    run(w, 1);
    expect(w.teamCount[1]).toBe(n0);
    expect(s.timer).toBeGreaterThan(3);
    expect(s.timer).toBeLessThanOrEqual(5);
    w.unitCap[1] = n0 + 1000;
    run(w, 6);
    expect(w.teamCount[1]).toBeGreaterThan(n0);
    // 出了一批之后计时回到一个完整的间隔
    expect(s.timer).toBeGreaterThan(s.interval - 10);
  }, 30000);
});

describe('营寨的兵种选择：边界', () => {
  it('所选兵种已不属于主人的文明时（比如易主后没清）取本文明兵种表里的第一个', () => {
    const w = game();
    const s = ownSite(w, SITE_CAMP, 1);
    s.pick = idx('samurai');
    expect(pickedUnit(w, s)).toBe(factionUnits(FACTIONS.china)[0].idx);
    s.pick = -1;
    expect(pickedUnit(w, s)).toBe(factionUnits(FACTIONS.china)[0].idx);
  });

  it('兵种表是本文明的初级形态，按兵种表的顺序，没有别家的与高级形态', () => {
    for (const id of ['china', 'japan', 'rome', 'persia'] as const) {
      const list = factionUnits(FACTIONS[id]);
      expect(list.length).toBeGreaterThan(0);
      for (const d of list) {
        expect(d.faction).toBe(id);
        expect(d.tier).toBe(0);
      }
    }
  });

  it('测量工具登记在 china 名下的基准兵种与变体不进营寨可选兵种，选了也不采用', () => {
    // 加载了测量工具：基准兵种以 faction: china 进了全局兵种表
    expect(UNITS.some(d => d.key.startsWith('base_') && d.faction === 'china' && d.tier === 0)).toBe(true);
    for (const id of ['china', 'japan', 'rome', 'persia'] as const) {
      expect(factionUnits(FACTIONS[id]).map(d => d.key), id).toEqual(contentUnits().filter(d => d.faction === id && d.tier === 0).map(d => d.key));
    }
    const w = game();
    const s = ownSite(w, SITE_CAMP, 1);
    expect(w.pickUnit(s, 1, BASE.inf.idx)).toBe(false);
    w.autoPick[1] = () => BASE.inf.idx;
    initPicks(w);
    expect(s.pick).toBe(factionUnits(FACTIONS.china)[0].idx);
  });

  it('据点无主时 pickedUnit 返回 -1（不抛）', () => {
    const w = game();
    const s = w.sites.find(x => x.type === SITE_CAMP && x.owner === 0)!;
    expect(pickedUnit(w, s)).toBe(-1);
  });

  it('电脑给出的兵种不属于本文明时不采用，营寨出缺省兵种', () => {
    const w = game();
    const s = ownSite(w, SITE_CAMP, 1);
    w.autoPick[1] = () => idx('samurai');
    initPicks(w);
    expect(s.pick).toBe(factionUnits(FACTIONS.china)[0].idx);
    w.autoPick[1] = () => idx('pili');
    initPicks(w);
    expect(s.pick).toBe(idx('pili'));
  });

  it('开局只有有主的营寨有选择，城池、资源点、中立营寨没有', () => {
    const w = game();
    for (const s of w.sites) {
      if (s.type === SITE_CAMP && s.owner) expect(factionUnits(w.factions[s.owner]!).some(d => d.idx === s.pick), s.name).toBe(true);
      else expect(s.pick, s.name).toBe(-1);
    }
  });

  it('改选的站点不存在、已毁、不是自己的、兵种不在表里都返回 false，且不动计时与选择', () => {
    const w = game();
    clear(w);
    const s = ownSite(w, SITE_CAMP, 1);
    s.timer = 10;
    const before = s.pick;
    expect(w.pickUnit(s, 2, idx('yari'))).toBe(false);
    expect(w.pickUnit(s, 0, idx('tieqi'))).toBe(false);
    expect(w.pickUnit(s, 1, 999999)).toBe(false);
    s.gone = true;
    expect(w.pickUnit(s, 1, idx('tieqi'))).toBe(false);
    expect([s.timer, s.pick]).toEqual([10, before]);
  });

  it('营寨中央建筑倒了，改选也不会让援军出来：计时暂停', () => {
    const w = game();
    clear(w);
    const s = ownSite(w, SITE_CAMP, 1);
    for (const o of w.sites) o.timer = 999;
    w.damageBuilding(w.buildings[s.main], 1e9, 0, 1, 2);
    s.timer = 0.01;
    run(w, 5);
    expect(w.teamCount[1]).toBe(0);
    expect(s.timer).toBeCloseTo(0.01, 5);
  });
});

describe('丢光城池与营寨判负：边界', () => {
  it('没有可计数据点的世界第一次结算不判负；某方曾经有过、之后丢光才判负', () => {
    const w = game();
    clear(w);
    for (const s of w.sites) if (SITE_INFO[s.type].counts) s.owner = 0;
    run(w, 1);
    expect(w.winner).toBe(0);
    const mine = w.sites.find(s => SITE_INFO[s.type].counts)!;
    mine.owner = 1;
    run(w, 1);
    // 二号方从没有过城池与营寨，一号方有：不判
    expect(w.winner).toBe(0);
    mine.owner = 0;
    run(w, 1);
    expect(w.winner).toBe(2);
  });

  it('一方丢光城池与营寨即判对方胜；已判定后不再改写赢家', () => {
    const w = game();
    clear(w);
    run(w, 1);
    for (const s of w.sites) if (SITE_INFO[s.type].counts && s.owner === 2) s.owner = 1;
    run(w, 1);
    expect(w.winner).toBe(1);
    // 之后即使一号方也丢光了，赢家仍是一号方
    for (const s of w.sites) if (SITE_INFO[s.type].counts) s.owner = 2;
    run(w, 1);
    expect(w.winner).toBe(1);
  });
});

describe('军事建筑计数：militaryLeft', () => {
  it('数还立着的、不是 tm 的军事建筑；拆一座少一座；defenseLocked 即计数大于 0', () => {
    const w = game();
    const s = ownSite(w, SITE_CAMP, 2);
    const mil = roleOf(w, s, BR_MILITARY);
    expect(militaryLeft(w, s, 1)).toBe(mil.length);
    expect(militaryLeft(w, s, 2)).toBe(0);
    for (let i = 0; i < mil.length; i++) {
      expect(defenseLocked(w, s, 1)).toBe(militaryLeft(w, s, 1) > 0);
      w.damageBuilding(mil[i], 1e9, 0, 1, 1);
      expect(militaryLeft(w, s, 1)).toBe(mil.length - i - 1);
    }
    expect(defenseLocked(w, s, 1)).toBe(false);
  });
});

describe('营寨每批人数：campBatch', () => {
  it('份数固定，按兵种占用折算；贵的兵种每批人少；乘己方的难度倍率', () => {
    const w = game();
    const s = ownSite(w, SITE_CAMP, 1);
    const per = SITE_INFO[SITE_CAMP].reinfForce;
    for (const tm of [1, 2]) {
      for (const d of factionUnits(w.factions[tm]!)) expect(campBatch(w, s, tm, d), d.key).toBe(headcount(d, per * w.reinfMult[tm]));
    }
    const list = factionUnits(w.factions[1]!);
    expect(Math.max(...list.map(d => campBatch(w, s, 1, d)))).toBeGreaterThan(Math.min(...list.map(d => campBatch(w, s, 1, d))));
    w.reinfMult[1] *= 2;
    const d = UNITS[pickedUnit(w, s)];
    expect(campBatch(w, s, 1, d)).toBe(headcount(d, per * w.reinfMult[1]));
  });

  it('直射器械的占用为 1：营寨选蝎弩每批人数 = 营寨每批份数 × 援军倍率，难度倍率照乘（11.6 份 × 2 ÷ 1 = 23）', () => {
    const w = game();
    const s = ownSite(w, SITE_CAMP, 1);
    expect(campBatch(w, s, 1, UNIT_BY_KEY.scorpio)).toBe(headcount(UNIT_BY_KEY.scorpio, SITE_INFO[SITE_CAMP].reinfForce * w.reinfMult[1]));
    w.reinfMult[1] = 2;
    expect(campBatch(w, s, 1, UNIT_BY_KEY.scorpio)).toBe(23);
  });

  it('营寨出兵的人数就是 campBatch', () => {
    const w = game();
    clear(w);
    const s = ownSite(w, SITE_CAMP, 1);
    for (const o of w.sites) o.timer = 999;
    s.timer = 0.01;
    run(w, 2);
    expect(w.teamCount[1]).toBe(campBatch(w, s, 1, UNITS[pickedUnit(w, s)]));
  });
});

describe('援军暂停：reinfPaused', () => {
  it('有主人、出援军的据点中央建筑被毁才算暂停，立起来就恢复；无主、不出援军的不算', () => {
    const w = game();
    const camp = ownSite(w, SITE_CAMP, 1);
    expect(reinfPaused(w, camp)).toBe(false);
    w.damageBuilding(w.buildings[camp.main], 1e9, 0, 1, 2);
    expect(reinfPaused(w, camp)).toBe(true);
    w.buildings[camp.main].alive = true;
    expect(reinfPaused(w, camp)).toBe(false);
    // 中立营寨中央建筑毁了也不算（没有援军计时）
    const neutral = w.sites.find(s => s.type === SITE_CAMP && s.owner === 0)!;
    w.damageBuilding(w.buildings[neutral.main], 1e9, 0, 1, 1);
    expect(reinfPaused(w, neutral)).toBe(false);
    // 资源点不出援军
    const farm = w.sites.find(s => s.type === SITE_FARM)!;
    farm.owner = 1;
    expect(reinfPaused(w, farm)).toBe(false);
  });

  it('暂停与计时一致：中央建筑被毁时计时不走，立起来后接着走', () => {
    const w = game();
    clear(w);
    const camp = ownSite(w, SITE_CAMP, 1);
    for (const o of w.sites) o.timer = 999;
    camp.timer = 30;
    w.damageBuilding(w.buildings[camp.main], 1e9, 0, 1, 2);
    expect(reinfPaused(w, camp)).toBe(true);
    run(w, 3);
    expect(camp.timer).toBe(30);
    w.buildings[camp.main].alive = true;
    run(w, 3);
    expect(camp.timer).toBeLessThan(30);
  });
});

describe('占领时的集结点：电脑占下据点', () => {
  const capture = (w: World, s: Site, tm: number): void => {
    clear(w);
    for (const id of s.buildings) if (w.buildings[id].def.role === BR_MILITARY) w.damageBuilding(w.buildings[id], 1e9, 0, 1, 1);
    const u = w.spawnUnit(UNIT_BY_KEY.yari.idx, tm, s.x, s.y + 16);
    w.hp[u] = w.maxHp[u] = 1e7;
    w.orderStop([u], true);
    run(w, SITE_INFO[s.type].captureTime + 3);
    expect(s.owner).toBe(tm);
  };

  it('电脑占下出援军的据点（营寨），集结点设回出发阵地', () => {
    const w = game();
    const camp = w.sites.find(s => s.type === SITE_CAMP && s.owner === 0)!;
    const auto = w.autoRally[2]!;
    expect(auto).toBeTruthy();
    capture(w, camp, 2);
    expect(camp.rally).toEqual({ x: auto.x, y: auto.y });
  });

  it('电脑占下资源点，不写集结点（资源点不出援军）', () => {
    const w = game();
    const farm = w.sites.find(s => s.type === SITE_FARM && s.owner === 0)!;
    capture(w, farm, 2);
    expect(farm.rally).toBeNull();
  });

  it('人类占下据点，集结点留空', () => {
    const w = game();
    const camp = w.sites.find(s => s.type === SITE_CAMP && s.owner === 0)!;
    capture(w, camp, 1);
    expect(camp.rally).toBeNull();
  });
});
