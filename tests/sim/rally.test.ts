import { describe, expect, it } from 'vitest';
import { SITE_CAMP, SITE_CITY, SITE_FARM, SITE_INFO } from '../../src/sim/defs';
import { canRally, rallyPoint, rallySites } from '../../src/sim/rally';
import { createGame } from '../../src/sim/setup';

const world = () => createGame({
  seed: 5, factions: ['china', 'japan'], armySize: 60, difficulty: 1, fog: false, spectate: false, environment: false, supply: false,
}).world;

describe('集结点：只有会出援军的据点能设', () => {
  it('canRally：城池、营寨可以；资源点、临时据点不行；已被毁的据点不行', () => {
    const w = world();
    for (const s of w.sites) expect(canRally(s), `${s.name}`).toBe(!!SITE_INFO[s.type].reinf);
    expect(w.sites.some(s => s.type === SITE_CITY)).toBe(true);
    expect(w.sites.some(s => s.type === SITE_CAMP)).toBe(true);
    const farm = w.sites.find(s => s.type === SITE_FARM)!;
    expect(canRally(farm)).toBe(false);
    const camp = w.sites.find(s => s.type === SITE_CAMP)!;
    camp.gone = true;
    expect(canRally(camp)).toBe(false);
  });

  it('rallySites：只取己方出援军的据点，不含资源点与敌方据点', () => {
    const w = world();
    // 把一座农庄划给己方，也不该进来
    w.sites.find(s => s.type === SITE_FARM)!.owner = 1;
    const list = rallySites(w, 1);
    expect(list.length).toBeGreaterThan(0);
    for (const s of list) {
      expect(s.owner).toBe(1);
      expect(SITE_INFO[s.type].reinf).toBeTruthy();
    }
    expect(rallySites(w, 2).every(s => s.owner === 2)).toBe(true);
  });

  it('rallyPoint：己方出援军据点的集结点才有效', () => {
    const w = world();
    const camp = w.sites.find(s => s.type === SITE_CAMP && s.owner === 1)!;
    camp.rally = { x: 10, y: 20 };
    expect(rallyPoint(camp, 1)).toEqual({ x: 10, y: 20 });
    expect(rallyPoint(camp, 2)).toBeNull();
    const farm = w.sites.find(s => s.type === SITE_FARM)!;
    farm.owner = 1;
    farm.rally = { x: 1, y: 2 };
    expect(rallyPoint(farm, 1)).toBeNull();
  });
});
