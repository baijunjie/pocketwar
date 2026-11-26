import { describe, expect, it } from 'vitest';
import { CLICK_DIST, CLICK_GAP, moveCursor, nextClickCount, tipPosition } from '../src/pointerLock';

describe('常量', () => {
  it('连击 400ms / 6px', () => {
    expect(CLICK_GAP).toBe(400);
    expect(CLICK_DIST).toBe(6);
  });
});

describe('moveCursor 虚拟光标', () => {
  const w = 1000, h = 800;

  it('视口内直接加位移', () => {
    expect(moveCursor(100, 200, 15, -30, w, h)).toEqual({ x: 115, y: 170 });
    expect(moveCursor(100, 200, 0, 0, w, h)).toEqual({ x: 100, y: 200 });
  });

  it('贴边后继续往外推，停在最外一个像素', () => {
    expect(moveCursor(5, 5, -50, -50, w, h)).toEqual({ x: 0, y: 0 });
    expect(moveCursor(0, 0, -10, -10, w, h)).toEqual({ x: 0, y: 0 });
    expect(moveCursor(995, 795, 50, 50, w, h)).toEqual({ x: w - 1, y: h - 1 });
    expect(moveCursor(w - 1, h - 1, 10, 10, w, h)).toEqual({ x: w - 1, y: h - 1 });
  });

  it('两轴各自夹取', () => {
    expect(moveCursor(0, 400, -9, 20, w, h)).toEqual({ x: 0, y: 420 });
    expect(moveCursor(500, h - 1, 7, 9, w, h)).toEqual({ x: 507, y: h - 1 });
  });

  it('位移超大也不越界', () => {
    expect(moveCursor(500, 400, 1e6, -1e6, w, h)).toEqual({ x: w - 1, y: 0 });
  });

  it('贴边后往回移立刻离开边缘', () => {
    expect(moveCursor(0, 400, 3, 0, w, h).x).toBe(3);
    expect(moveCursor(w - 1, 400, -3, 0, w, h).x).toBe(w - 4);
    expect(moveCursor(500, 0, 0, 2, w, h).y).toBe(2);
    expect(moveCursor(500, h - 1, 0, -2, w, h).y).toBe(h - 3);
  });
});

describe('nextClickCount 连击计数', () => {
  const prev = { t: 1000, x: 100, y: 100, count: 1 };

  it('没有上一次是第 1 下', () => {
    expect(nextClickCount(null, 1000, 100, 100)).toBe(1);
  });

  it('间隔短、位置近：接着数', () => {
    expect(nextClickCount(prev, 1200, 100, 100)).toBe(2);
    expect(nextClickCount({ ...prev, count: 2 }, 1300, 102, 103)).toBe(3);
  });

  it('间隔恰为 CLICK_GAP、距离恰为 CLICK_DIST 仍算连击', () => {
    expect(nextClickCount(prev, 1000 + CLICK_GAP, 100, 100)).toBe(2);
    expect(nextClickCount(prev, 1100, 100 + CLICK_DIST, 100)).toBe(2);
  });

  it('超时从 1 起', () => {
    expect(nextClickCount(prev, 1000 + CLICK_GAP + 1, 100, 100)).toBe(1);
    expect(nextClickCount({ ...prev, count: 3 }, 5000, 100, 100)).toBe(1);
  });

  it('离得远从 1 起', () => {
    expect(nextClickCount(prev, 1100, 100 + CLICK_DIST + 1, 100)).toBe(1);
    expect(nextClickCount({ ...prev, count: 2 }, 1100, 100, 400)).toBe(1);
  });

  it('距离按直线算，不按单轴', () => {
    // 两轴各 5px，直线约 7.07 > 6
    expect(nextClickCount(prev, 1100, 105, 105)).toBe(1);
    // 两轴各 4px，直线约 5.66 <= 6
    expect(nextClickCount(prev, 1100, 104, 104)).toBe(2);
  });
});

describe('tipPosition 提示框位置', () => {
  const w = 1000, h = 800, tw = 200, th = 60;
  const inside = (p: { x: number; y: number }, tw: number, th: number) => {
    expect(p.x).toBeGreaterThanOrEqual(0);
    expect(p.y).toBeGreaterThanOrEqual(0);
    expect(p.x + tw).toBeLessThanOrEqual(w);
    expect(p.y + th).toBeLessThanOrEqual(h);
  };

  it('默认在光标右下方', () => {
    const p = tipPosition(300, 300, tw, th, w, h);
    expect(p.x).toBeGreaterThan(300);
    expect(p.y).toBeGreaterThan(300);
    inside(p, tw, th);
  });

  it('右边放不下翻到光标左边', () => {
    const p = tipPosition(950, 300, tw, th, w, h);
    expect(p.x + tw).toBeLessThanOrEqual(950);
    expect(p.y).toBeGreaterThan(300);
    inside(p, tw, th);
  });

  it('下边放不下翻到光标上方', () => {
    const p = tipPosition(300, 780, tw, th, w, h);
    expect(p.y + th).toBeLessThanOrEqual(780);
    expect(p.x).toBeGreaterThan(300);
    inside(p, tw, th);
  });

  it('右下都放不下：翻到左上', () => {
    const p = tipPosition(990, 790, tw, th, w, h);
    expect(p.x + tw).toBeLessThanOrEqual(990);
    expect(p.y + th).toBeLessThanOrEqual(790);
    inside(p, tw, th);
  });

  it('无论光标在哪（含四角与视口外一点）整个提示框都在视口内', () => {
    for (const x of [-5, 0, 1, 100, 500, 900, 999, 1005]) {
      for (const y of [-5, 0, 1, 100, 400, 700, 799, 805]) {
        inside(tipPosition(x, y, tw, th, w, h), tw, th);
      }
    }
  });

  it('左右两边都放不下时贴视口边，不越界', () => {
    // 视口宽 250、提示框宽 200：光标在中间，右边与左边都放不下
    const p = tipPosition(125, 100, 200, 60, 250, 800);
    expect(p.x).toBeGreaterThanOrEqual(0);
    expect(p.x + 200).toBeLessThanOrEqual(250);
  });

  it('提示框比视口还大时贴左上角', () => {
    expect(tipPosition(50, 50, 400, 300, 200, 150)).toEqual({ x: 0, y: 0 });
  });
});
