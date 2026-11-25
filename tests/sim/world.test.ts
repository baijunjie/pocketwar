import { describe, expect, it } from 'vitest';
import { TILE, UNIT_BY_KEY } from '../../src/sim/defs';
import { flatWorld } from '../helpers';

const idx = (k: string): number => UNIT_BY_KEY[k].idx;

describe('spawnUnit：新生成的单位没有上一任留下的追击状态', () => {
  it('复用被移除单位的槽位：wayUid、wayMode、wayNoT、wallUid 清零', () => {
    const w = flatWorld();
    const a = w.spawnUnit(idx('dao'), 1, 10 * TILE, 10 * TILE);
    w.wayUid[a] = 123;
    w.wayMode[a] = 2;
    w.wayNoT[a] = 1.5;
    w.wallUid[a] = 456;
    w.removeUnit(a);
    const b = w.spawnUnit(idx('dao'), 1, 12 * TILE, 12 * TILE);
    expect(b).toBe(a);
    expect(w.wayUid[b]).toBe(0);
    expect(w.wayMode[b]).toBe(0);
    expect(w.wayNoT[b]).toBe(0);
    expect(w.wallUid[b]).toBe(0);
  });

  it('全新的槽位：wayUid 为 0', () => {
    const w = flatWorld();
    const a = w.spawnUnit(idx('dao'), 1, 10 * TILE, 10 * TILE);
    expect(w.wayUid[a]).toBe(0);
    expect(w.wallUid[a]).toBe(0);
  });
});
