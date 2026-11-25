import { describe, expect, it } from 'vitest';
import { FACTIONS, FACTION_IDS, SITE_CAMP, SITE_CITY, SITE_INFO, UNITS, UNIT_BY_KEY, forceOf, headcount } from '../src/sim/defs';
import { pickCampUnit } from '../src/sim/ai/picker';
import { createGame } from '../src/sim/setup';
import { factionUnits, pickedUnit } from '../src/sim/systems/sites';
import type { Site, World } from '../src/sim/world';
import { run } from './helpers';

const idx = (k: string): number => UNIT_BY_KEY[k].idx;
const game = (f1: 'china' | 'japan' | 'rome' | 'persia' = 'china', spectate = false): World => createGame({
  seed: 5, factions: [f1, 'japan'], armySize: 60, difficulty: 1, fog: false, spectate, environment: false, supply: false,
}).world;
const clear = (w: World): void => {
  for (let i = 0; i < w.n; i++) if (w.alive[i]) w.removeUnit(i);
};
/** 把据点直接划给某一方（连同建筑），选择回到缺省 */
const give = (w: World, s: Site, tm: number): void => {
  s.owner = tm;
  s.pick = -1;
  for (const id of s.buildings) w.buildings[id].owner = tm;
};
/** 让这座营寨立刻出一批，返回这一批的兵种下标 → 人数 */
const batch = (w: World, s: Site): Map<number, number> => {
  for (const o of w.sites) o.timer = 999;
  s.timer = 0.01;
  const before = new Set<number>();
  for (let i = 0; i < w.n; i++) if (w.alive[i]) before.add(i);
  run(w, 1);
  const out = new Map<number, number>();
  for (let i = 0; i < w.n; i++) if (w.alive[i] && !before.has(i) && w.team[i] === s.owner) out.set(w.type[i], (out.get(w.type[i]) ?? 0) + 1);
  return out;
};
const ownCamp = (w: World, tm = 1): Site => w.sites.find(s => s.type === SITE_CAMP && s.owner === tm)!;

describe('营寨统一', () => {
  it('地图上的营寨只有一种：12 座，数值统一；开局双方各有一座，其余中立', () => {
    const w = game();
    const camps = w.sites.filter(s => s.type === SITE_CAMP);
    expect(camps.length).toBe(12);
    expect(camps.filter(s => s.owner === 1).length).toBe(1);
    expect(camps.filter(s => s.owner === 2).length).toBe(1);
    expect(w.sites.filter(s => SITE_INFO[s.type].category === 'camp').length).toBe(12);
    const c = SITE_INFO[SITE_CAMP];
    expect([c.label, c.reinf, c.interval, c.reinfForce, c.food, c.captureTime, c.upgradeCost]).toEqual(['营寨', 'pick', 66, 11.6, 11.2, 13, 127]);
  });

  it('全图营寨每秒的援军总份数与总产粮，与原来的营地、村庄、马场、工坊相当（原值按四阵营援军表取平均）', () => {
    // 原来各类营寨在标准地图上的座数、间隔、四阵营原援军表的平均份数、产粮
    const OLD = [
      { n: 4, iv: 70, force: (8 + 8 + 8.52 + 8.28) / 4, food: 10 },
      { n: 4, iv: 50, force: (8 + 8 + 8.52 + 8.28) / 4, food: 16 },
      { n: 2, iv: 65, force: (22.5 + 22.5 + 26.25 + 13.5) / 4, food: 9 },
      { n: 2, iv: 90, force: (19.2 + 10.2 + 19.2 + 12.7) / 4, food: 6 },
    ];
    const oldRate = OLD.reduce((a, o) => a + (o.n * o.force) / o.iv, 0);
    const oldFood = OLD.reduce((a, o) => a + o.n * o.food, 0);
    const c = SITE_INFO[SITE_CAMP];
    expect(12 * c.reinfForce / c.interval / oldRate).toBeGreaterThan(0.99);
    expect(12 * c.reinfForce / c.interval / oldRate).toBeLessThan(1.01);
    expect(Math.abs(12 * c.food / oldFood - 1)).toBeLessThan(0.01);
  });
});

describe('营寨选兵种', () => {
  it('占下时出本文明兵种表里的第一个兵种；援军人数 = 份数 × 援军倍率 ÷ 兵力占用，至少 1 人', () => {
    for (const id of FACTION_IDS) {
      const w = game(id);
      clear(w);
      const s = ownCamp(w);
      const f = FACTIONS[id];
      expect(pickedUnit(w, s), id).toBe(factionUnits(f)[0].idx);
      // 每个兵种都能选，出的是它、人数按份数换算
      for (const d of factionUnits(f)) {
        expect(w.pickUnit(s, 1, d.idx)).toBe(true);
        const got = batch(w, s);
        expect([...got.keys()], d.key).toEqual([d.idx]);
        expect(got.get(d.idx), d.key).toBe(headcount(d, SITE_INFO[SITE_CAMP].reinfForce));
        expect(got.get(d.idx)).toBeGreaterThanOrEqual(1);
      }
    }
  }, 60000);

  it('罗马营寨选蝎弩：一批只出蝎弩，人数 = 营寨每批份数 × 援军倍率 ÷ 占用 1', () => {
    const w = game('rome');
    clear(w);
    const s = ownCamp(w);
    expect(w.pickUnit(s, 1, idx('scorpio'))).toBe(true);
    const got = batch(w, s);
    expect([...got.keys()]).toEqual([idx('scorpio')]);
    expect(got.get(idx('scorpio'))).toBe(headcount(UNIT_BY_KEY.scorpio, SITE_INFO[SITE_CAMP].reinfForce * w.reinfMult[1]));
  });

  it('份数换算：贵的兵种人更少，近战步兵最多；份数再少也有 1 人', () => {
    const force = SITE_INFO[SITE_CAMP].reinfForce;
    expect(headcount(UNIT_BY_KEY.dao, force)).toBeGreaterThan(headcount(UNIT_BY_KEY.tieqi, force));
    expect(headcount(UNIT_BY_KEY.tieqi, force)).toBeGreaterThan(headcount(UNIT_BY_KEY.huojian, force));
    expect(headcount(UNIT_BY_KEY.pili, 0.01)).toBe(1);
    expect(forceOf(UNIT_BY_KEY.dao)).toBe(1);
    // 营寨每批份数固定，不随阵营的援军级数变；电脑的难度倍率照旧，再乘 w.reinfMult
    const w = game();
    clear(w);
    const s = ownCamp(w);
    w.reinfMult[1] = 1.25;
    const d = UNIT_BY_KEY.ji;
    expect(batch(w, s).get(d.idx)).toBe(headcount(d, force * 1.25));
    w.factions[1] = { ...FACTIONS.china, reinfLevel: 20 };
    expect(batch(w, s).get(d.idx)).toBe(headcount(d, force * 1.25));
  });

  it('只有己方营寨能选，只能选本文明的初级兵种；选城池、中立营寨、敌方营寨、别家兵种、高级形态都不行', () => {
    const w = game();
    const mine = ownCamp(w, 1), foe = ownCamp(w, 2);
    const neutral = w.sites.find(s => s.type === SITE_CAMP && s.owner === 0)!;
    const city = w.sites.find(s => s.type === SITE_CITY && s.owner === 1)!;
    expect(w.pickUnit(mine, 1, idx('tieqi'))).toBe(true);
    expect(w.pickUnit(foe, 1, idx('tieqi'))).toBe(false);
    expect(w.pickUnit(neutral, 1, idx('tieqi'))).toBe(false);
    expect(w.pickUnit(city, 1, idx('tieqi'))).toBe(false);
    expect(w.pickUnit(mine, 1, idx('samurai'))).toBe(false);
    expect(w.pickUnit(mine, 1, UNIT_BY_KEY.tieqi.elite)).toBe(false);
    expect(pickedUnit(w, mine)).toBe(idx('tieqi'));
    expect(city.pick).toBe(-1);
  });

  it('改选重置援军计时（从头计时）；选回现在这个兵种不算改选', () => {
    const w = game();
    const s = ownCamp(w);
    s.timer = 10;
    expect(w.pickUnit(s, 1, idx('ji'))).toBe(true);
    expect(s.timer).toBe(10);
    expect(w.pickUnit(s, 1, idx('nu'))).toBe(true);
    expect(s.timer).toBe(s.interval);
  });

  it('易主后回到新主人的缺省兵种', () => {
    const w = game('china');
    clear(w);
    const s = ownCamp(w);
    w.pickUnit(s, 1, idx('pili'));
    expect(pickedUnit(w, s)).toBe(idx('pili'));
    // 敌方（日本）占下：兵种表换成日本的，第一个是足轻枪兵（先关掉电脑自己的选择）
    w.autoPick[2] = null;
    for (const id of s.buildings) if (w.buildings[id].def.role === 0) w.damageBuilding(w.buildings[id], 1e9, 0, 1, 2);
    w.spawnGroup(2, Array(6).fill(idx('yari')), s.x, s.y + 20, 0, -1);
    for (let t = 0; t < 30 * 30 && s.owner === 1; t++) w.tick();
    expect(s.owner).toBe(2);
    expect(UNITS[s.pick].key).toBe('yari');
    expect(pickedUnit(w, s)).toBe(idx('yari'));
  });
});

describe('电脑选兵种', () => {
  it('选在场兵力占比低于开局编制比重最多的兵种', () => {
    const w = game('china', true);
    const s = ownCamp(w, 2);
    // 2 号是日本：把铁炮足轻全部撤掉，它就是缺口最大的
    for (let i = 0; i < w.n; i++) if (w.alive[i] && w.team[i] === 2 && w.defs[w.type[i]].key.startsWith('teppo')) w.removeUnit(i);
    expect(pickCampUnit(w, 2, s)).toBe(idx('teppo'));
    // 再把骑马武者全部撤掉：骑马武者比重（0.33）远大于铁炮，成了缺口最大的
    for (let i = 0; i < w.n; i++) if (w.alive[i] && w.team[i] === 2 && w.defs[w.type[i]].key.startsWith('kiba')) w.removeUnit(i);
    expect(pickCampUnit(w, 2, s)).toBe(idx('kiba'));
  });

  it('别的营寨已选、还没出的一批也算在场，几座营寨不扎堆选同一个兵种', () => {
    const w = game('china', true);
    const a = ownCamp(w, 2);
    const b = w.sites.find(s => s.type === SITE_CAMP && s.owner === 0)!;
    give(w, b, 2);
    // 2 号的兵全撤掉：骑马武者比重最大，a 选它
    for (let i = 0; i < w.n; i++) if (w.alive[i] && w.team[i] === 2) w.removeUnit(i);
    expect(pickCampUnit(w, 2, a)).toBe(idx('kiba'));
    // b 已经选了骑马武者：它没出的一批算在场，骑马武者占满了，a 再选就轮到别的兵种（比重次大的足轻枪兵）
    b.pick = idx('kiba');
    expect(pickCampUnit(w, 2, a)).toBe(idx('yari'));
  });

  it('开局电脑的营寨就选好了；每出一批后接着选下一批的兵种，不重置计时', () => {
    const g = createGame({ seed: 5, factions: ['china', 'japan'], armySize: 60, difficulty: 1, fog: false, spectate: false, environment: false, supply: false });
    const w = g.world;
    const s = ownCamp(w, 2);
    expect(factionUnits(FACTIONS.japan).some(d => d.idx === s.pick)).toBe(true);
    // 日本的兵全撤掉只留一个武士：缺口最大的是比重最大的骑马武者
    for (let i = 0; i < w.n; i++) if (w.alive[i] && w.team[i] === 2) w.removeUnit(i);
    s.pick = idx('yari');
    const got = batch(w, s);
    expect([...got.keys()]).toEqual([idx('yari')]);
    expect(s.pick).toBe(idx('kiba'));
    expect(s.timer).toBeGreaterThan(s.interval - 2);
    // 玩家一方不自动选
    const mine = ownCamp(w, 1);
    mine.pick = idx('nu');
    batch(w, mine);
    expect(mine.pick).toBe(idx('nu'));
  });
});
