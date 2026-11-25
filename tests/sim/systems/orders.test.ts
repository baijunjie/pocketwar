import { describe, expect, it } from 'vitest';
import { BUILDINGS, TILE, UNIT_BY_KEY } from '../../../src/sim/defs';
import type { World } from '../../../src/sim/world';
import { flatWorld } from '../../helpers';

const idx = (k: string): number => UNIT_BY_KEY[k].idx;
const mid = (t: number): number => (t + 0.5) * TILE;

describe('新指令清掉追击的状态（含远程主动挑的墙顶敌兵）', () => {
  /** 一个攻击移动的近战，留着上一个追击目标的判断记录与「刚判出绕不过去」的重试间隔；另有一个敌兵和一座敌方行营可供下指令 */
  const scene = () => {
    const w = flatWorld();
    const me = w.spawnUnit(idx('dao'), 1, mid(60), mid(60));
    w.hp[me] = w.maxHp[me] = 1e9;
    const far = w.addBuilding(BUILDINGS.outpost, 70, 70, 2, -1);
    const foe = w.spawnUnit(idx('legion'), 2, mid(80), mid(40));
    w.hp[foe] = w.maxHp[foe] = 1e9;
    w.orderStop([foe], true);
    w.orderMove([me], mid(60), mid(30), true);
    // 追击的判断记录（模拟上一个追击目标）
    w.wayUid[me] = 777;
    w.wayNoT[me] = 1.5;
    // 远程主动挑的墙顶敌兵的记录
    w.wallUid[me] = 888;
    return { w, me, far, foe };
  };
  const clean = (w: World, me: number): void => {
    expect(w.wayUid[me]).toBe(0);
    expect(w.wayNoT[me]).toBe(0);
    expect(w.wallUid[me]).toBe(0);
  };

  it('移动命令', () => {
    const { w, me } = scene();
    w.orderMove([me], mid(50), mid(50), false);
    clean(w, me);
  });

  it('攻击移动命令', () => {
    const { w, me } = scene();
    w.orderMove([me], mid(50), mid(50), true);
    clean(w, me);
  });

  it('停止与坚守', () => {
    const a = scene();
    a.w.orderStop([a.me], false);
    clean(a.w, a.me);
    const b = scene();
    b.w.orderStop([b.me], true);
    clean(b.w, b.me);
  });

  it('攻击某个敌兵', () => {
    const { w, me, foe } = scene();
    w.orderAttackUnit([me], foe);
    clean(w, me);
  });

  it('攻击某座建筑', () => {
    const { w, me, far } = scene();
    w.orderAttackBuilding([me], far);
    clean(w, me);
    expect(w.target[me]).toBe(-far.id - 2);
  });
});
