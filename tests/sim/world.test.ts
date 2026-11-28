import { describe, expect, it } from 'vitest';
import { TILE, T_MOUNTAIN, UNIT_BY_KEY } from '../../src/sim/defs';
import { createGame } from '../../src/sim/setup';
import { flatWorld } from '../helpers';

const idx = (k: string): number => UNIT_BY_KEY[k].idx;

it('复用被移除单位的槽位时，新单位没有旧的回血反馈', () => {
  const w = flatWorld();
  const a = w.spawnUnit(idx('dao'), 1, 10 * TILE, 10 * TILE);
  expect(w.lastHealTick[a]).toBe(-1);
  w.lastHealTick[a] = 15;
  w.removeUnit(a);
  const b = w.spawnUnit(idx('dao'), 1, 12 * TILE, 12 * TILE);
  expect(b).toBe(a);
  expect(w.lastHealTick[b]).toBe(-1);
});

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

  it('复用被移除单位的槽位：编队行军的 apart 标记清零', () => {
    const w = flatWorld();
    const a = w.spawnUnit(idx('dao'), 1, 10 * TILE, 10 * TILE);
    w.apart[a] = 1;
    w.removeUnit(a);
    const b = w.spawnUnit(idx('dao'), 1, 12 * TILE, 12 * TILE);
    expect(b).toBe(a);
    expect(w.apart[b]).toBe(0);
  });

  it('复用被移除单位的槽位：放下建筑的跳过倒计时清零', () => {
    const w = flatWorld();
    const a = w.spawnUnit(idx('dao'), 1, 10 * TILE, 10 * TILE);
    w.bldSkip[a] = 3;
    w.bldSkipT[a] = 7;
    w.removeUnit(a);
    const b = w.spawnUnit(idx('dao'), 1, 12 * TILE, 12 * TILE);
    expect(b).toBe(a);
    expect(w.bldSkipT[b]).toBe(0);
  });

  it('全新的槽位：wayUid 为 0，放下建筑的跳过倒计时为 0', () => {
    const w = flatWorld();
    const a = w.spawnUnit(idx('dao'), 1, 10 * TILE, 10 * TILE);
    expect(w.wayUid[a]).toBe(0);
    expect(w.wallUid[a]).toBe(0);
    expect(w.bldSkipT[a]).toBe(0);
  });
});

describe('lineReach：从 a 朝 b 直着走能走多远', () => {
  /** 南北向的一堵矿山墙：格子列 x，行 y0..y1（含） */
  const withWall = (x: number, y0: number, y1: number) => flatWorld(60, 7, (t, n) => {
    for (let y = y0; y <= y1; y++) t[y * n + x] = T_MOUNTAIN;
  });

  it('一路走得通：1；起点就是终点：1', () => {
    const w = flatWorld(60);
    expect(w.lineReach(5 * TILE, 5 * TILE, 40 * TILE, 33 * TILE, 1)).toBe(1);
    expect(w.lineReach(5 * TILE, 5 * TILE, 5 * TILE, 5 * TILE, 1)).toBe(1);
  });

  it('墙在途中：返回值落在 (0, 1) 内，停在墙跟前，离墙不超过一个探点间隔（16 像素）', () => {
    const w = withWall(30, 0, 59);
    const ax = 10 * TILE, bx = 50 * TILE, y = 20.5 * TILE;
    const r = w.lineReach(ax, y, bx, y, 1);
    expect(r).toBeGreaterThan(0);
    expect(r).toBeLessThan(1);
    const reached = ax + (bx - ax) * r;
    // 墙的西缘在 30 * TILE
    expect(reached).toBeLessThanOrEqual(30 * TILE);
    expect(reached).toBeGreaterThanOrEqual(30 * TILE - 16);
    expect(w.lineBlocked(ax, y, bx, y, 1)).toBe(true);
    expect(w.lineBlocked(ax, y, reached, y, 1)).toBe(false);
  });

  it('起点紧贴着障碍、朝障碍走：返回 0 附近，不超过一个探点间隔', () => {
    const w = withWall(30, 0, 59);
    const ax = 30 * TILE - 2, y = 20.5 * TILE;
    const r = w.lineReach(ax, y, 40 * TILE, y, 1);
    expect(r * (40 * TILE - ax)).toBeLessThan(16);
  });

  it('斜着撞上墙的一端：只走到挡住它的那一格跟前', () => {
    const w = withWall(30, 0, 25);
    const ax = 10 * TILE, ay = 10 * TILE, bx = 50 * TILE, by = 40 * TILE;
    const r = w.lineReach(ax, ay, bx, by, 1);
    // 这条线在 x = 30 格处 y = 25 格：恰好擦过墙的南端之外还是撞上，以 lineBlocked 为准
    const blocked = w.lineBlocked(ax, ay, bx, by, 1);
    expect(r < 1).toBe(blocked);
    const cx = ax + (bx - ax) * r, cy = ay + (by - ay) * r;
    expect(w.lineBlocked(ax, ay, cx, cy, 1)).toBe(false);
  });

  it('与 lineBlocked 一致：随机的点对里，走得通的必为 1，走不通的必小于 1，且走到的那一段本身走得通（含真实地图的城墙与建筑）', () => {
    const w = createGame({ seed: 7, factions: ['china', 'rome'], armySize: 100, difficulty: 1, fog: false, spectate: false, environment: false, supply: false }).world;
    let s = 12345;
    const rnd = (): number => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
    const lo = 40, hiX = w.W - 40, hiY = w.H - 40;
    let blocked = 0, open = 0;
    for (let k = 0; k < 4000; k++) {
      const ax = lo + rnd() * (hiX - lo), ay = lo + rnd() * (hiY - lo);
      const ang = rnd() * Math.PI * 2, len = 20 + rnd() * 400;
      const bx = Math.min(hiX, Math.max(lo, ax + Math.cos(ang) * len)), by = Math.min(hiY, Math.max(lo, ay + Math.sin(ang) * len));
      const r = w.lineReach(ax, ay, bx, by, 1);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(1);
      if (w.lineBlocked(ax, ay, bx, by, 1)) {
        blocked++;
        expect(r).toBeLessThan(1);
        expect(w.lineBlocked(ax, ay, ax + (bx - ax) * r, ay + (by - ay) * r, 1)).toBe(false);
      } else {
        open++;
        expect(r).toBe(1);
      }
    }
    // 样本里两种情形都有，用例才有意义
    expect(blocked).toBeGreaterThan(100);
    expect(open).toBeGreaterThan(100);
  });
});
