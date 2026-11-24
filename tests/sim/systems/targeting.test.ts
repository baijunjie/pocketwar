import { describe, expect, it } from 'vitest';
import { BUILDINGS, UNIT_BY_KEY } from '../../../src/sim/defs';
import { canAttackBuilding } from '../../../src/sim/systems/targeting';
import { NONE } from '../../../src/sim/world';
import { flatWorld, run } from '../../helpers';

const idx = (k: string): number => UNIT_BY_KEY[k].idx;

describe('canAttackBuilding：谁能攻击这座建筑', () => {
  const w = flatWorld();
  const mk = (key: string, owner: number) => w.addBuilding(BUILDINGS[key], 10, 10, owner, -1);

  it('立着的、不是自己的、可被攻击的建筑能打：敌方的与中立的军事建筑、城防', () => {
    expect(canAttackBuilding(mk('watchtower', 2), 1, false)).toBe(true);
    expect(canAttackBuilding(mk('watchtower', 0), 1, false)).toBe(true);
    expect(canAttackBuilding(mk('tower', 2), 1, false)).toBe(true);
    expect(canAttackBuilding(mk('wgate_h', 2), 1, false)).toBe(true);
    expect(canAttackBuilding(mk('palisade', 2), 1, false)).toBe(true);
  });

  it('自己的建筑不能打', () => {
    expect(canAttackBuilding(mk('watchtower', 1), 1, true)).toBe(false);
    expect(canAttackBuilding(mk('wall', 2), 2, true)).toBe(false);
  });

  it('倒了的建筑不能打', () => {
    const b = mk('watchtower', 2);
    b.alive = false;
    expect(canAttackBuilding(b, 1, true)).toBe(false);
  });

  it('普通建筑不可被攻击，工程类也不行；行营是例外', () => {
    for (const k of ['house', 'barracks', 'tent', 'farmstead', 'lumbercamp', 'quarry', 'goldmine']) {
      expect(canAttackBuilding(mk(k, 2), 1, true), k).toBe(false);
      expect(canAttackBuilding(mk(k, 0), 1, true), k).toBe(false);
    }
    expect(canAttackBuilding(mk('outpost', 2), 1, false)).toBe(true);
  });

  it('城防工事（石墙）只有工程类打得动；门楼、木栅人形单位也能打', () => {
    const wall = mk('wall', 2);
    expect(canAttackBuilding(wall, 1, false)).toBe(false);
    expect(canAttackBuilding(wall, 1, true)).toBe(true);
    expect(canAttackBuilding(mk('gate_h', 2), 1, false)).toBe(true);
  });
});

describe('索敌：优先打自己克制的兵种', () => {
  /** 在 (cx, cy) 摆一个单位，再在它周围摆几个敌人（血量无限、不动），跑一帧，返回它盯上的敌人 */
  function pick(me: string, foes: [string, number, number][]): string | null {
    const w = flatWorld();
    const cx = 60 * 20, cy = 60 * 20;
    const u = w.spawnUnit(idx(me), 1, cx, cy);
    const ids = foes.map(([k, dx, dy]) => {
      const e = w.spawnUnit(idx(k), 2, cx + dx, cy + dy);
      w.hp[e] = w.maxHp[e] = 1e7;
      w.orderStop([e], true);
      return e;
    });
    w.hp[u] = w.maxHp[u] = 1e7;
    run(w, 0.5);
    const t = w.target[u];
    if (t === NONE) return null;
    return foes[ids.indexOf(t)]?.[0] ?? null;
  }

  it('克制对方的兵种：比最近的敌人稍远一点也先打它（距离按 0.8 折算）', () => {
    const yari = UNIT_BY_KEY.yari, cav = UNIT_BY_KEY.tieqi, inf = UNIT_BY_KEY.dao;
    expect(yari.vs[cav.idx]).toBeGreaterThan(1.05);
    expect(yari.vs[inf.idx]).toBeLessThanOrEqual(1.05);
    expect(pick('yari', [['dao', 80, 0], ['tieqi', 0, 90]])).toBe('tieqi');
  });

  it('被对方克制的兵种：比最近的敌人稍近一点也后打它（距离按 1.15 折算）', () => {
    const cav = UNIT_BY_KEY.tieqi, yari = UNIT_BY_KEY.yari, inf = UNIT_BY_KEY.dao;
    expect(cav.vs[yari.idx]).toBeLessThan(0.95);
    expect(cav.vs[inf.idx]).toBeGreaterThanOrEqual(0.95);
    expect(pick('tieqi', [['yari', 80, 0], ['dao', 0, 90]])).toBe('dao');
  });

  it('差得很远时还是先打近的', () => {
    expect(pick('yari', [['dao', 60, 0], ['tieqi', 0, 140]])).toBe('dao');
  });
});
