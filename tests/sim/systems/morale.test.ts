import { describe, expect, it } from 'vitest';
import { RULES, SITE_CAMP, SITE_CITY, SITE_FARM, SITE_INFO, SITE_OUTPOST, UNIT_BY_KEY } from '../../../src/sim/defs';
import { createGame } from '../../../src/sim/setup';
import { startRout, teamMoraleFactors } from '../../../src/sim/systems/morale';
import type { World } from '../../../src/sim/world';
import { flatWorld } from '../../helpers';

const M = RULES.morale;
const game = (): World => createGame({
  seed: 5, factions: ['china', 'japan'], armySize: 60, difficulty: 1, fog: false, spectate: false, environment: false, supply: false,
}).world;
const sitesFactor = (w: World, tm: number) => teamMoraleFactors(w, tm).find(f => f.key === 'sites');

describe('全队士气因素：据点', () => {
  it('只数城池与营寨：开局双方各有一座城池与一座营寨，各是「据点 ×2」，加成 = 每座加成 × 座数（不超过上限）', () => {
    const w = game();
    for (const tm of [1, 2]) {
      expect(sitesFactor(w, tm)).toEqual({ key: 'sites', label: '据点 ×2', value: Math.min(M.siteMax, M.perSite * 2) });
    }
  });

  it('座数多了加成封顶', () => {
    const w = game();
    const counted = w.sites.filter(s => SITE_INFO[s.type].counts);
    expect(counted.length).toBeGreaterThan(M.siteMax / M.perSite + 1);
    for (const s of counted) s.owner = 1;
    const f = sitesFactor(w, 1)!;
    expect(f.label).toBe(`据点 ×${counted.length}`);
    expect(f.value).toBe(M.siteMax);
  });

  it('资源点与临时据点不算：一座城池与营寨都没有时，再多资源点、临时据点也是「没有据点」', () => {
    const w = game();
    for (const s of w.sites) if (SITE_INFO[s.type].counts && s.owner === 1) s.owner = 2;
    for (const s of w.sites) if (s.type === SITE_FARM) s.owner = 1;
    w.addSite(SITE_OUTPOST, '行营', 100, 100, 1);
    expect(w.sites.filter(s => s.owner === 1 && SITE_INFO[s.type].category !== 'camp' && SITE_INFO[s.type].category !== 'city').length).toBeGreaterThan(0);
    expect(sitesFactor(w, 1)).toEqual({ key: 'sites', label: '没有据点', value: M.noSite });
    // 对方不受影响
    expect(sitesFactor(w, 2)!.label).toMatch(/^据点 ×/);
  });

  it('只剩一座营寨也算有据点，没有城池不影响', () => {
    const w = game();
    for (const s of w.sites) if (s.owner === 1 && s.type === SITE_CITY) s.owner = 2;
    expect(w.sites.some(s => s.owner === 1 && s.type === SITE_CAMP)).toBe(true);
    expect(sitesFactor(w, 1)).toEqual({ key: 'sites', label: '据点 ×1', value: Math.min(M.siteMax, M.perSite) });
  });

  it('地图上没有城池与营寨（沙盘）时没有这一项', () => {
    const w = flatWorld();
    w.addSite(SITE_FARM, '农庄', 100, 100, 1);
    expect(sitesFactor(w, 1)).toBeUndefined();
  });
});

describe('全队士气因素：形势与天气', () => {
  it('兵力占优与劣势：按战力占比，双方对称、一样强时没有这一项', () => {
    const w = flatWorld();
    w.power[1] = 75;
    w.power[2] = 25;
    const g = (tm: number) => teamMoraleFactors(w, tm).find(f => f.key === 'global');
    expect(g(1)).toEqual({ key: 'global', label: '兵力占优', value: Math.round(0.5 * M.global) });
    expect(g(2)).toEqual({ key: 'global', label: '兵力劣势', value: -Math.round(0.5 * M.global) });
    w.power[1] = w.power[2] = 50;
    expect(g(1)).toBeUndefined();
    w.power[1] = w.power[2] = 0;
    expect(g(1)).toBeUndefined();
  });

  it('下雨与夜间各一项，双方都一样', () => {
    const w = flatWorld();
    expect(teamMoraleFactors(w, 1)).toEqual([]);
    w.env.raining = true;
    w.env.night = true;
    for (const tm of [1, 2]) {
      const f = teamMoraleFactors(w, tm);
      expect(f.find(x => x.key === 'rain')!.value).toBe(M.rain);
      expect(f.find(x => x.key === 'night')!.value).toBe(M.night);
    }
  });
});

describe('溃兵的避难所', () => {
  const rout = (w: World, x: number, y: number): number => {
    const u = w.spawnUnit(UNIT_BY_KEY.dao.idx, 1, x, y);
    startRout(w, u);
    return u;
  };

  it('只逃往己方的城池、营寨；资源点、别人的据点（敌方的、中立的）都不是避难所，哪怕更近', () => {
    const w = flatWorld();
    const camp = w.addSite(SITE_CAMP, '营寨', 2000, 2000, 1);
    w.addSite(SITE_FARM, '农庄', 330, 330, 1);
    w.addSite(SITE_CITY, '敌城', 350, 350, 2);
    w.addSite(SITE_CAMP, '中立营寨', 360, 360, 0);
    const u = rout(w, 300, 300);
    expect(w.routSite[u]).toBe(camp.id);
  });

  it('有多座时逃向最近的一座', () => {
    const w = flatWorld();
    w.addSite(SITE_CITY, '远城', 2000, 2000, 1);
    const near = w.addSite(SITE_CAMP, '近营', 1000, 400, 1);
    const u = rout(w, 300, 300);
    expect(w.routSite[u]).toBe(near.id);
  });

  it('逃往的据点途中易主了就改逃别的（据点丢了不再作数）', () => {
    const w = flatWorld();
    const a = w.addSite(SITE_CAMP, 'A', 800, 300, 1), b = w.addSite(SITE_CITY, 'B', 2000, 2000, 1);
    const u = rout(w, 300, 300);
    expect(w.routSite[u]).toBe(a.id);
    a.owner = 2;
    for (let t = 0; t < 60; t++) {
      w.morale[u] = 0;
      w.tick();
    }
    expect(w.routSite[u]).toBe(b.id);
  });
});
