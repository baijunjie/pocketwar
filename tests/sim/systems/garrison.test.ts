import { describe, expect, it } from 'vitest';
import { SITE_CITY, UNITS, UNIT_BY_KEY, isContentUnit } from '../../../src/sim/defs';
import { canGarrison } from '../../../src/sim/systems/garrison';
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

describe('能上墙驻守的兵种：主武器是远程武器的步行人形单位', () => {
  it('远程步兵可以；攻击距离再长的近战（长戟兵、足轻枪兵）、骑兵、器械、战象都不行', () => {
    for (const k of ['nu', 'liannu', 'yumi', 'teppo', 'velites', 'sagitt', 'kamandar']) expect(canGarrison(UNIT_BY_KEY[k]), k).toBe(true);
    for (const k of ['ji', 'yari', 'auxilia', 'spara', 'dao', 'legion', 'immortal', 'tieqi', 'asvaran', 'huojian', 'onager', 'scorpio', 'elephant']) {
      expect(canGarrison(UNIT_BY_KEY[k]), k).toBe(false);
    }
  });

  it('判据只看主武器是不是远程、是不是人形、能不能边走边打：高级形态与初级一致', () => {
    for (const d of UNITS.filter(isContentUnit)) expect(canGarrison(d), d.key).toBe(d.humanoid && !d.melee && !d.mobile);
  });
});
