import { describe, expect, it } from 'vitest';
import { SITE_CITY, UNIT_BY_KEY } from '../../../src/sim/defs';
import { createGame } from '../../../src/sim/setup';
import type { World } from '../../../src/sim/world';

const idx = (k: string): number => UNIT_BY_KEY[k].idx;
const game = (): World => createGame({
  seed: 5, factions: ['china', 'japan'], armySize: 60, difficulty: 1, fog: false, spectate: false, environment: false, supply: false,
}).world;

describe('驻守命令：清掉追击的状态', () => {
  it('远程步兵被派去上墙时，之前记下的追击判断、重试间隔与主动挑的墙顶敌兵作废', () => {
    const w = game();
    for (let i = 0; i < w.n; i++) if (w.alive[i] && w.team[i] === 1) w.removeUnit(i);
    const hq = w.sites.find(s => s.type === SITE_CITY && s.owner === 1)!;
    const u = w.spawnUnit(idx('nu'), 1, hq.x + 40, hq.y - 60);
    w.wayUid[u] = 321;
    w.wayNoT[u] = 1.5;
    w.wallUid[u] = 654;
    expect(w.orderGarrison([u])).toBe(1);
    expect(w.wayUid[u]).toBe(0);
    expect(w.wayNoT[u]).toBe(0);
    expect(w.wallUid[u]).toBe(0);
  });
});
