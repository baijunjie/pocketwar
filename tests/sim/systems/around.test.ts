import { describe, expect, it } from 'vitest';
import { BUILDINGS, RULES, T_MOUNTAIN, TILE, UNIT_BY_KEY } from '../../../src/sim/defs';
import { AROUND, WAY_AROUND, WAY_DIRECT, WAY_NONE, chaseWay, findAround, keepWay, planWay } from '../../../src/sim/systems/around';
import type { World } from '../../../src/sim/world';
import { flatWorld } from '../../helpers';

const N = 120;
const idx = (k: string): number => UNIT_BY_KEY[k].idx;

/** 格子 (tx, ty) 中心的像素坐标 */
const mid = (t: number): number => (t + 0.5) * TILE;

/** 画一块矿山：格子范围 [x0, x1] × [y0, y1]（含两端） */
const rock = (t: Uint8Array, n: number, x0: number, x1: number, y0: number, y1: number): void => {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) t[y * n + x] = T_MOUNTAIN;
};

/** 己方（队伍 1）一个追击者站在 (x, y) */
const chaser = (w: World, x: number, y: number): number => w.spawnUnit(idx('dao'), 1, x, y);

describe('findAround：局部路线上的路点', () => {
  it('障碍一侧到另一侧：路点从起点直线看得见、不是终点本身，且落在障碍的上沿或下沿之外（朝着绕过去的方向）', () => {
    // 3×3 格的矿山，中心在 (60, 60) 格；起点在西、终点在东，正好隔着它
    const w = flatWorld(N, 7, (t, n) => rock(t, n, 59, 61, 59, 61));
    const ux = mid(54), uy = mid(60), tx = mid(66), ty = mid(60);
    const me = chaser(w, ux, uy);
    expect(w.lineBlocked(ux, uy, tx, ty, 1)).toBe(true);
    expect(findAround(w, me, tx, ty)).toBe(true);
    expect(w.lineBlocked(ux, uy, AROUND.x, AROUND.y, 1)).toBe(false);
    expect(Math.hypot(AROUND.x - tx, AROUND.y - ty)).toBeGreaterThan(TILE);
    // 路点在障碍南北边缘之外，并且比起点更靠近终点
    expect(AROUND.y < 59 * TILE || AROUND.y > 62 * TILE).toBe(true);
    expect(Math.hypot(AROUND.x - tx, AROUND.y - ty)).toBeLessThan(Math.hypot(ux - tx, uy - ty));
    // 路点本身走得通
    const c = w.cellAt(AROUND.x, AROUND.y);
    expect(w.nav.block[1][c]).toBe(0);
  });

  it('路点往前走几步之后，从新位置到终点的路线依旧找得到，最终看得见终点（沿路点走能绕过去）', () => {
    const w = flatWorld(N, 7, (t, n) => rock(t, n, 59, 61, 59, 61));
    const tx = mid(66), ty = mid(60);
    const me = chaser(w, mid(54), mid(60));
    let steps = 0;
    for (; steps < 20 && w.lineBlocked(w.x[me], w.y[me], tx, ty, 1); steps++) {
      expect(findAround(w, me, tx, ty)).toBe(true);
      w.x[me] = AROUND.x;
      w.y[me] = AROUND.y;
    }
    expect(w.lineBlocked(w.x[me], w.y[me], tx, ty, 1)).toBe(false);
    expect(steps).toBeLessThan(20);
  });

  it('起点终点直线走得通：找到路线，路点就是终点', () => {
    const w = flatWorld(N, 7);
    const me = chaser(w, mid(40), mid(40));
    expect(findAround(w, me, mid(50), mid(45))).toBe(true);
    expect(AROUND.x).toBeCloseTo(mid(50), 5);
    expect(AROUND.y).toBeCloseTo(mid(45), 5);
  });

  it('绕过去的路程不超过「直线距离 + chaseDetour」才算绕得过去，超过就绕不过去', () => {
    // 一堵 1 格厚的南北向矿山墙，上端在 y = 30 格，下端由 below 决定；起点终点各在墙两侧、与墙相距 2 格、高度与墙中点齐平
    const cases = (half: number): { w: World; me: number; tx: number; ty: number; extra: number } => {
      const w = flatWorld(N, 7, (t, n) => rock(t, n, 60, 60, 60 - half, 60 + half));
      const ux = mid(58), uy = mid(60), tx = mid(62), ty = mid(60);
      // 绕过墙端的路程至少是经过墙上端（或下端）外侧一格的折线
      const around = 2 * Math.hypot(TILE * 2, TILE * (half + 1.5));
      return { w, me: chaser(w, ux, uy), tx, ty, extra: around - Math.hypot(tx - ux, ty - uy) };
    };
    // 绕路多出的部分远小于上限
    const short = cases(1);
    expect(short.extra).toBeLessThan(RULES.combat.chaseDetour * 0.6);
    expect(findAround(short.w, short.me, short.tx, short.ty)).toBe(true);
    // 绕路多出的部分远大于上限
    const long = cases(Math.ceil((RULES.combat.chaseDetour * 3) / TILE));
    expect(long.extra).toBeGreaterThan(RULES.combat.chaseDetour * 1.5);
    expect(findAround(long.w, long.me, long.tx, long.ty)).toBe(false);
  });

  it('终点本身走不进去（在障碍里）：绕不过去', () => {
    const w = flatWorld(N, 7, (t, n) => rock(t, n, 60, 62, 60, 62));
    const me = chaser(w, mid(54), mid(61));
    expect(findAround(w, me, mid(61), mid(61))).toBe(false);
  });

  it('斜着走不擦障碍角：两个障碍格对角相邻拼成的斜线墙，不能从两格之间穿过去', () => {
    // 贯穿整张地图的对角线单格墙（k, k）：对角相邻的两格之间只有一个角点的缝隙
    const w = flatWorld(N, 7, (t, n) => {
      for (let k = 0; k < n; k++) t[k * n + k] = T_MOUNTAIN;
    });
    // 起点在斜线下方（y > x 一侧），终点在上方，连线穿过斜线上某一格的中心
    const ux = mid(5), uy = mid(9), tx = mid(9), ty = mid(5);
    const me = chaser(w, ux, uy);
    expect(w.lineBlocked(ux, uy, tx, ty, 1)).toBe(true);
    expect(findAround(w, me, tx, ty)).toBe(false);
  });

  it('短的斜线墙：从墙端绕得过去，路点从起点直线看得见', () => {
    // 三格的对角线墙 (6,6) (7,7) (8,8)；起点、终点在墙两侧，连线穿过 (7,7) 的中心
    const w = flatWorld(N, 7, (t, n) => {
      for (let k = 6; k <= 8; k++) t[k * n + k] = T_MOUNTAIN;
    });
    const ux = mid(6), uy = mid(8), tx = mid(8), ty = mid(6);
    const me = chaser(w, ux, uy);
    expect(w.lineBlocked(ux, uy, tx, ty, 1)).toBe(true);
    expect(findAround(w, me, tx, ty)).toBe(true);
    expect(w.lineBlocked(ux, uy, AROUND.x, AROUND.y, 1)).toBe(false);
    expect(Math.hypot(AROUND.x - tx, AROUND.y - ty)).toBeGreaterThan(TILE);
  });

  it('民房（己方不可通行的建筑）也算障碍，能绕过去', () => {
    const w = flatWorld(N, 7);
    w.addBuilding(BUILDINGS.house, 60, 59, 1, -1);
    const ux = mid(55), uy = mid(60), tx = mid(66), ty = mid(60);
    const me = chaser(w, ux, uy);
    expect(w.lineBlocked(ux, uy, tx, ty, 1)).toBe(true);
    expect(findAround(w, me, tx, ty)).toBe(true);
    expect(w.lineBlocked(ux, uy, AROUND.x, AROUND.y, 1)).toBe(false);
  });
});

describe('findAround：只算不记', () => {
  it('找到路线或判成绕不过去，都不改动单位身上的追击记录', () => {
    const half = Math.ceil((RULES.combat.chaseDetour * 3) / TILE);
    const w = flatWorld(N, 7, (t, n) => {
      rock(t, n, 59, 61, 59, 61);
      rock(t, n, 90, 90, 90 - half, 90 + half);
    });
    const me = chaser(w, mid(54), mid(60));
    const far = chaser(w, mid(88), mid(90));
    for (const s of [me, far]) {
      w.wayUid[s] = 55;
      w.wayMode[s] = WAY_DIRECT;
      w.wayX[s] = 1;
      w.wayY[s] = 2;
      w.wayNoT[s] = 0.5;
    }
    expect(findAround(w, me, mid(66), mid(60))).toBe(true);
    expect(findAround(w, far, mid(92), mid(90))).toBe(false);
    for (const s of [me, far]) {
      expect([w.wayUid[s], w.wayMode[s], w.wayX[s], w.wayY[s], w.wayNoT[s]]).toEqual([55, WAY_DIRECT, 1, 2, 0.5]);
    }
  });
});

describe('keepWay：把判断结果记成追某个目标的走法', () => {
  it('要绕的同时记下路点（取刚算出的 AROUND）；直走、绕不过去只记目标与结果，不动路点', () => {
    const w = flatWorld(N, 7, (t, n) => rock(t, n, 59, 61, 59, 61));
    const me = chaser(w, mid(54), mid(60));
    expect(findAround(w, me, mid(66), mid(60))).toBe(true);
    keepWay(w, me, 31, WAY_AROUND);
    expect([w.wayUid[me], w.wayMode[me]]).toEqual([31, WAY_AROUND]);
    expect(w.wayX[me]).toBeCloseTo(AROUND.x, 5);
    expect(w.wayY[me]).toBeCloseTo(AROUND.y, 5);
    const wx = w.wayX[me], wy = w.wayY[me];
    keepWay(w, me, 32, WAY_NONE);
    expect([w.wayUid[me], w.wayMode[me], w.wayX[me], w.wayY[me]]).toEqual([32, WAY_NONE, wx, wy]);
    keepWay(w, me, 33, WAY_DIRECT);
    expect([w.wayUid[me], w.wayMode[me], w.wayX[me], w.wayY[me]]).toEqual([33, WAY_DIRECT, wx, wy]);
  });
});

describe('planWay：判断去目标要不要绕、能不能绕', () => {
  it('直线走得通：判为直走，并记下目标的 uid', () => {
    const w = flatWorld(N, 7);
    const me = chaser(w, mid(40), mid(40));
    expect(planWay(w, me, 4242, mid(50), mid(40))).toBe(WAY_DIRECT);
    expect(w.wayMode[me]).toBe(WAY_DIRECT);
    expect(w.wayUid[me]).toBe(4242);
  });

  it('隔着小障碍：判为要绕，路点写进 wayX、wayY，且就是 findAround 给出的那个', () => {
    const w = flatWorld(N, 7, (t, n) => rock(t, n, 59, 61, 59, 61));
    const me = chaser(w, mid(54), mid(60));
    const tx = mid(66), ty = mid(60);
    expect(planWay(w, me, 7, tx, ty)).toBe(WAY_AROUND);
    expect(w.wayMode[me]).toBe(WAY_AROUND);
    expect(findAround(w, me, tx, ty)).toBe(true);
    expect(w.wayX[me]).toBeCloseTo(AROUND.x, 5);
    expect(w.wayY[me]).toBeCloseTo(AROUND.y, 5);
    expect(w.lineBlocked(w.x[me], w.y[me], w.wayX[me], w.wayY[me], 1)).toBe(false);
  });

  it('隔着绕不过去的长墙：判为绕不过去', () => {
    const half = Math.ceil((RULES.combat.chaseDetour * 3) / TILE);
    const w = flatWorld(N, 7, (t, n) => rock(t, n, 60, 60, 60 - half, 60 + half));
    const me = chaser(w, mid(58), mid(60));
    expect(planWay(w, me, 9, mid(62), mid(60))).toBe(WAY_NONE);
    expect(w.wayMode[me]).toBe(WAY_NONE);
    expect(w.wayUid[me]).toBe(9);
  });
});

describe('chaseWay：追击中的一帧', () => {
  /** 一块矿山挡在追击者与两个目标之间：近的目标在障碍后面，远的目标在开阔地 */
  const scene = () => {
    const w = flatWorld(N, 7, (t, n) => rock(t, n, 59, 61, 59, 61));
    const me = chaser(w, mid(54), mid(60));
    const behind = w.spawnUnit(idx('legion'), 2, mid(66), mid(60));
    const open = w.spawnUnit(idx('legion'), 2, mid(54), mid(52));
    return { w, me, behind, open };
  };

  it('第一次对某个目标判断：隔着障碍绕得过去就给出要绕，并把路点留在 wayX、wayY', () => {
    const { w, me, behind } = scene();
    expect(chaseWay(w, me, behind, w.x[behind], w.y[behind])).toBe(WAY_AROUND);
    expect(w.wayUid[me]).toBe(w.uid[behind]);
    expect(w.lineBlocked(w.x[me], w.y[me], w.wayX[me], w.wayY[me], 1)).toBe(false);
  });

  it('换了目标就重新判断：从障碍后面的目标换成开阔地上的目标，立刻变成直走', () => {
    const { w, me, behind, open } = scene();
    expect(chaseWay(w, me, behind, w.x[behind], w.y[behind])).toBe(WAY_AROUND);
    expect(chaseWay(w, me, open, w.x[open], w.y[open])).toBe(WAY_DIRECT);
    expect(w.wayUid[me]).toBe(w.uid[open]);
  });

  it('同一个目标：中途不复查的帧沿用上次的结果，复查的帧按当时的情况重判', () => {
    const { w, me, behind } = scene();
    chaseWay(w, me, behind, w.x[behind], w.y[behind]);
    // 把目标挪到开阔地上，路点还远：找一个不会触发复查的帧，结果沿用「要绕」；
    // 再逐帧推进，复查帧一到（最多每 RECHECK 帧一次）就改判成直走
    w.x[behind] = mid(54);
    w.y[behind] = mid(52);
    const modes: number[] = [];
    for (let k = 0; k < 16; k++) {
      modes.push(chaseWay(w, me, behind, w.x[behind], w.y[behind]));
      w.tickCount++;
    }
    expect(modes).toContain(WAY_AROUND);
    expect(modes).toContain(WAY_DIRECT);
    // 改判之后不再回到要绕
    expect(modes.slice(modes.indexOf(WAY_DIRECT))).not.toContain(WAY_AROUND);
  });

  it('走到路点附近就立刻重判，接着朝下一个路点走', () => {
    const { w, me, behind } = scene();
    chaseWay(w, me, behind, w.x[behind], w.y[behind]);
    const wx0 = w.wayX[me], wy0 = w.wayY[me];
    // 站到路点上
    w.x[me] = wx0;
    w.y[me] = wy0;
    expect(chaseWay(w, me, behind, w.x[behind], w.y[behind])).not.toBe(WAY_NONE);
    // 重判后路点不再是原来那个（已经站在上面了）
    expect(Math.hypot(w.wayX[me] - wx0, w.wayY[me] - wy0) > 1 || w.wayMode[me] === WAY_DIRECT).toBe(true);
  });
});
