import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CARD_SCROLL_BIAS, CARD_SLOP, DROP_LIFT, HOLD_MS, STICK_CURVE, STICK_DEAD, SWIPE_MIN, TAP_SLOP, TouchGestures,
  asUiMode, cardIntent, dropLift, inInscribedCircle, isMobileUi, pinchOf, stickVector, swipeDir,
} from '../src/touchInput';
import type { Pinch, TouchHandlers } from '../src/touchInput';

describe('常量', () => {
  it('抖动容差约 10px、长按 0.5 秒、卡片起手约 8px、滑动约 28px', () => {
    expect(TAP_SLOP).toBe(10);
    expect(HOLD_MS).toBe(500);
    expect(CARD_SLOP).toBe(8);
    expect(SWIPE_MIN).toBe(28);
  });

  it('卡片起手偏向拖：横向要超竖向 1.5 倍才算滚动；落点最多抬 72px；摇杆死区 12%、读数曲线 1.5 次幂', () => {
    expect(CARD_SCROLL_BIAS).toBe(1.5);
    expect(DROP_LIFT).toBe(72);
    expect(STICK_DEAD).toBe(0.12);
    expect(STICK_CURVE).toBe(1.5);
  });
});

describe('asUiMode', () => {
  it('认得 auto / desktop / mobile', () => {
    expect(asUiMode('auto')).toBe('auto');
    expect(asUiMode('desktop')).toBe('desktop');
    expect(asUiMode('mobile')).toBe('mobile');
  });

  it('没存过或不认识的按 auto', () => {
    expect(asUiMode(null)).toBe('auto');
    expect(asUiMode('')).toBe('auto');
    expect(asUiMode('tablet')).toBe('auto');
    expect(asUiMode('Mobile')).toBe('auto');
  });
});

describe('isMobileUi', () => {
  it('mobile 一律移动版，不管设备', () => {
    expect(isMobileUi('mobile', true)).toBe(true);
    expect(isMobileUi('mobile', false)).toBe(true);
  });

  it('desktop 一律桌面版，不管设备', () => {
    expect(isMobileUi('desktop', true)).toBe(false);
    expect(isMobileUi('desktop', false)).toBe(false);
  });

  it('auto 由触屏竖屏决定', () => {
    expect(isMobileUi('auto', true)).toBe(true);
    expect(isMobileUi('auto', false)).toBe(false);
  });
});

describe('pinchOf 双指的数学', () => {
  const a0 = { x: 0, y: 0 }, b0 = { x: 100, y: 0 };

  it('缩放比是后两指距离除以前两指距离', () => {
    expect(pinchOf(a0, b0, { x: 0, y: 0 }, { x: 200, y: 0 }).scale).toBeCloseTo(2);
    expect(pinchOf(a0, b0, { x: 0, y: 0 }, { x: 50, y: 0 }).scale).toBeCloseTo(0.5);
    expect(pinchOf(a0, b0, { x: 10, y: 10 }, { x: 110, y: 10 }).scale).toBeCloseTo(1);
    // 斜着的距离也按直线距离算
    expect(pinchOf(a0, b0, { x: 0, y: 0 }, { x: 60, y: 80 }).scale).toBeCloseTo(1);
    expect(pinchOf(a0, b0, { x: 0, y: 0 }, { x: 120, y: 160 }).scale).toBeCloseTo(2);
  });

  it('两指连线没转时转角是 0', () => {
    expect(pinchOf(a0, b0, { x: 0, y: 0 }, { x: 300, y: 0 }).turn).toBeCloseTo(0);
  });

  it('转角是连线方向的变化，顺逆时针符号相反、大小相同', () => {
    // 屏幕坐标 y 向下：b 从右边转到下边是顺时针 90 度
    const cw = pinchOf(a0, b0, a0, { x: 0, y: 100 });
    const ccw = pinchOf(a0, b0, a0, { x: 0, y: -100 });
    expect(Math.abs(cw.turn)).toBeCloseTo(Math.PI / 2);
    expect(ccw.turn).toBeCloseTo(-cw.turn);
    expect(cw.turn).toBeGreaterThan(0);
    expect(ccw.turn).toBeLessThan(0);
  });

  it('转角与缩放互不影响', () => {
    const p = pinchOf(a0, b0, a0, { x: 0, y: 300 });
    expect(p.scale).toBeCloseTo(3);
    expect(p.turn).toBeCloseTo(Math.PI / 2);
  });

  it('连线转过 ±π 分界线时转角不跳变', () => {
    const r = 100, eps = 0.1;
    const at = (ang: number) => ({ x: r * Math.cos(ang), y: r * Math.sin(ang) });
    const o = { x: 0, y: 0 };
    // 从略小于 π 转到略大于 −π（同一方向转过 2·eps）
    const across = pinchOf(o, at(Math.PI - eps), o, at(-Math.PI + eps));
    expect(Math.abs(across.turn)).toBeCloseTo(2 * eps);
    // 反方向同理，且符号相反
    const back = pinchOf(o, at(-Math.PI + eps), o, at(Math.PI - eps));
    expect(back.turn).toBeCloseTo(-across.turn);
  });

  it('给出前后两个中点', () => {
    const p = pinchOf({ x: 0, y: 0 }, { x: 100, y: 40 }, { x: 10, y: 20 }, { x: 70, y: 100 });
    expect(p.x0).toBeCloseTo(50);
    expect(p.y0).toBeCloseTo(20);
    expect(p.x1).toBeCloseTo(40);
    expect(p.y1).toBeCloseTo(60);
  });

  it('两指重合时不产生无穷或 NaN', () => {
    const p = pinchOf(a0, b0, { x: 5, y: 5 }, { x: 5, y: 5 });
    expect(Number.isFinite(p.scale)).toBe(true);
    expect(Number.isFinite(p.turn)).toBe(true);
  });
});

describe('cardIntent 卡片起手方向', () => {
  it('位移没到起手阈值还没定', () => {
    expect(cardIntent(0, 0)).toBe('wait');
    expect(cardIntent(CARD_SLOP - 2, 0)).toBe('wait');
    expect(cardIntent(0, -(CARD_SLOP - 2))).toBe('wait');
    expect(cardIntent(4, 4)).toBe('wait');
  });

  it('超过阈值后竖直占主导是拖卡片', () => {
    expect(cardIntent(0, 30)).toBe('drag');
    expect(cardIntent(0, -30)).toBe('drag');
    expect(cardIntent(5, -40)).toBe('drag');
  });

  it('斜着起手偏向拖卡片：横向略多的斜拖、45 度都是拖', () => {
    expect(cardIntent(10, -8)).toBe('drag');
    expect(cardIntent(-10, -8)).toBe('drag');
    expect(cardIntent(20, -20)).toBe('drag');
    expect(cardIntent(-20, 20)).toBe('drag');
    expect(cardIntent(20, 15)).toBe('drag');
  });

  it('超过阈值后水平占主导是滚动卡片带', () => {
    expect(cardIntent(30, 0)).toBe('scroll');
    expect(cardIntent(-30, 0)).toBe('scroll');
    expect(cardIntent(-40, 5)).toBe('scroll');
    expect(cardIntent(40, -10)).toBe('scroll');
    expect(cardIntent(30, 10)).toBe('scroll');
  });

  it('横向要超过竖向的 bias 倍才滚动，刚好 bias 倍还是拖', () => {
    expect(cardIntent(15, 10)).toBe('drag');
    expect(cardIntent(16, 10)).toBe('scroll');
    expect(cardIntent(-16, -10)).toBe('scroll');
    expect(cardIntent(10, 7, 8, 1)).toBe('scroll');
    expect(cardIntent(10, 11, 8, 1)).toBe('drag');
    expect(cardIntent(30, 20, 8, 3)).toBe('drag');
    expect(cardIntent(61, 20, 8, 3)).toBe('scroll');
  });

  it('刚到起手阈值就判方向', () => {
    expect(cardIntent(CARD_SLOP, 0)).toBe('scroll');
    expect(cardIntent(0, CARD_SLOP)).toBe('drag');
  });

  it('可以指定阈值', () => {
    expect(cardIntent(0, 20, 50)).toBe('wait');
    expect(cardIntent(0, 60, 50)).toBe('drag');
    expect(cardIntent(60, 0, 50)).toBe('scroll');
  });
});

describe('dropLift 拖卡片时落点抬起的高度', () => {
  // 屏幕 [0, 800]，卡片带 [500, 600]
  const scr0 = 0, strTop = 500, strBot = 600, scr1 = 800;
  const lift = (y: number, l?: number): number => dropLift(y, scr0, strTop, strBot, scr1, l);

  it('手指还在卡片带里不抬', () => {
    for (const y of [500, 520, 550, 599, 600]) expect(lift(y), `y=${y}`).toBe(0);
  });

  it('往上离开卡片带后按离开距离的一半抬起', () => {
    expect(lift(480)).toBeCloseTo(10);
    expect(lift(440)).toBeCloseTo(30);
    expect(lift(500 - 2)).toBeCloseTo(1);
  });

  it('往上封顶 lift：离开 2 倍 lift 及更远（且离屏幕顶也够远）恒为 lift', () => {
    expect(lift(500 - 2 * DROP_LIFT)).toBeCloseTo(DROP_LIFT);
    expect(lift(300)).toBe(DROP_LIFT);
    expect(lift(DROP_LIFT * 2)).toBe(DROP_LIFT);
  });

  it('可以指定 lift', () => {
    expect(lift(300, 30)).toBe(30);
    expect(lift(490, 30)).toBeCloseTo(5);
    expect(lift(300, 0)).toBe(0);
  });

  it('手指刚出卡片带上沿时落点就在卡片带上沿', () => {
    expect(strTop - lift(strTop)).toBe(strTop);
    expect(strTop - 0.01 - lift(strTop - 0.01)).toBeGreaterThan(strTop - 0.02);
  });

  it('接近屏幕顶时按到屏幕顶距离的一半降回 0，手指到屏幕顶时落点也在屏幕顶', () => {
    expect(lift(100)).toBeCloseTo(50);
    expect(lift(20)).toBeCloseTo(10);
    expect(lift(2)).toBeCloseTo(1);
    expect(lift(scr0)).toBe(0);
    expect(scr0 - lift(scr0)).toBe(scr0);
  });

  it('屏幕顶不在 0 时按屏幕顶算', () => {
    expect(dropLift(120, 100, strTop, strBot, scr1)).toBeCloseTo(10);
    expect(dropLift(100, 100, strTop, strBot, scr1)).toBe(0);
    expect(dropLift(300, 100, strTop, strBot, scr1)).toBe(DROP_LIFT);
    expect(dropLift(90, 100, strTop, strBot, scr1)).toBe(0);
  });

  it('超出屏幕顶不为负', () => {
    expect(lift(-1)).toBe(0);
    expect(lift(-500)).toBe(0);
  });

  it('往下离开卡片带后按离开距离的一半抬起，封顶 lift', () => {
    expect(lift(620)).toBeCloseTo(10);
    expect(lift(640)).toBeCloseTo(20);
    expect(dropLift(700, scr0, strTop, strBot, 5000)).toBeCloseTo(50);
    expect(dropLift(745, scr0, strTop, strBot, 5000)).toBe(DROP_LIFT);
    expect(dropLift(2000, scr0, strTop, strBot, 5000)).toBe(DROP_LIFT);
  });

  it('接近屏幕底时按到屏幕底距离的一半降回 0，手指到屏幕底时落点也在屏幕底', () => {
    expect(lift(780)).toBeCloseTo(10);
    expect(lift(760)).toBeCloseTo(20);
    expect(lift(scr1)).toBe(0);
    expect(scr1 - lift(scr1)).toBe(scr1);
  });

  it('超出屏幕底不为负', () => {
    expect(lift(scr1 + 1)).toBe(0);
    expect(lift(scr1 + 500)).toBe(0);
  });

  it('落点随手指 y 单调不减且连续（从屏幕顶到屏幕底整个范围，以及两头之外）', () => {
    const step = 0.5;
    for (const l of [undefined, 30, 200]) {
      for (const [lo, hi] of [[scr0 - 200, scr1 + 200], [scr0, scr1]]) {
        let prev = lo - lift(lo, l);
        for (let y = lo + step; y <= hi; y += step) {
          const cur = y - lift(y, l);
          expect(cur, `y=${y} lift=${l}`).toBeGreaterThanOrEqual(prev);
          // 抬起量每走 1px 最多变 0.5px，落点每步至多走 1.5 倍步长
          expect(cur - prev, `y=${y} lift=${l}`).toBeLessThanOrEqual(step * 1.5 + 1e-9);
          expect(lift(y, l), `y=${y} lift=${l}`).toBeGreaterThanOrEqual(0);
          expect(lift(y, l), `y=${y} lift=${l}`).toBeLessThanOrEqual(l ?? DROP_LIFT);
          prev = cur;
        }
      }
    }
  });

  it('屏幕范围内的落点永远在屏幕内', () => {
    for (let y = scr0; y <= scr1; y += 1) {
      const p = y - lift(y);
      expect(p, `y=${y}`).toBeGreaterThanOrEqual(scr0);
      expect(p, `y=${y}`).toBeLessThanOrEqual(scr1);
    }
  });
});

describe('stickVector 摇杆读数', () => {
  const R = 100;
  const len = (v: { x: number; y: number }): number => Math.hypot(v.x, v.y);

  it('没偏移是 (0, 0)', () => {
    expect(stickVector(0, 0, R)).toEqual({ x: 0, y: 0 });
  });

  it('死区内是 (0, 0)', () => {
    expect(stickVector(R * STICK_DEAD - 1, 0, R)).toEqual({ x: 0, y: 0 });
    expect(stickVector(0, -(R * STICK_DEAD - 1), R)).toEqual({ x: 0, y: 0 });
    expect(stickVector(8, 8, R)).toEqual({ x: 0, y: 0 });
  });

  it('刚出死区读数从 0 起连续上升', () => {
    const v = stickVector(R * STICK_DEAD + 1, 0, R);
    expect(v.x).toBeGreaterThan(0);
    expect(v.x).toBeLessThan(0.01);
  });

  it('推到半径处及以外长度为 1，方向不变', () => {
    expect(len(stickVector(R, 0, R))).toBeCloseTo(1);
    expect(len(stickVector(0, -R, R))).toBeCloseTo(1);
    const out = stickVector(300, 400, R);
    expect(out.x).toBeCloseTo(0.6);
    expect(out.y).toBeCloseTo(0.8);
    const far = stickVector(-1000, 0, R);
    expect(far.x).toBeCloseTo(-1);
    expect(far.y).toBeCloseTo(0);
  });

  it('中间长度是 ((m − dead) / (1 − dead)) ^ curve', () => {
    const m = 0.56;
    expect(len(stickVector(m * R, 0, R))).toBeCloseTo(((m - STICK_DEAD) / (1 - STICK_DEAD)) ** STICK_CURVE);
    const m2 = 0.8;
    expect(len(stickVector(0, m2 * R, R))).toBeCloseTo(((m2 - STICK_DEAD) / (1 - STICK_DEAD)) ** STICK_CURVE);
  });

  it('方向与偏移相同，各象限符号对', () => {
    const a = stickVector(30, 40, R);
    expect(a.x).toBeGreaterThan(0);
    expect(a.y).toBeGreaterThan(0);
    expect(a.y / a.x).toBeCloseTo(40 / 30);
    const b = stickVector(-30, 40, R);
    expect(b.x).toBeLessThan(0);
    expect(b.y).toBeGreaterThan(0);
    expect(b.x).toBeCloseTo(-a.x);
    const c = stickVector(30, -40, R);
    expect(c.x).toBeGreaterThan(0);
    expect(c.y).toBeLessThan(0);
    expect(c.y).toBeCloseTo(-a.y);
    const d = stickVector(-30, -40, R);
    expect(d.x).toBeCloseTo(-a.x);
    expect(d.y).toBeCloseTo(-a.y);
  });

  it('随推出距离单调上升，小幅度时比线性慢', () => {
    let prev = 0;
    for (let d = 0; d <= 150; d += 1) {
      const l = len(stickVector(d, 0, R));
      expect(l, `d=${d}`).toBeGreaterThanOrEqual(prev - 1e-12);
      expect(l, `d=${d}`).toBeLessThanOrEqual(1 + 1e-12);
      prev = l;
    }
    expect(len(stickVector(30, 0, R))).toBeLessThan(0.3);
    expect(len(stickVector(50, 0, R))).toBeLessThan(0.5);
  });

  it('半径不同按比例算', () => {
    const a = stickVector(28, 0, 50), b = stickVector(56, 0, 100);
    expect(a.x).toBeCloseTo(b.x);
    expect(len(stickVector(50, 0, 50))).toBeCloseTo(1);
  });

  it('可以指定死区与曲线', () => {
    // curve = 1：死区以外线性
    expect(len(stickVector(60, 0, R, 0.2, 1))).toBeCloseTo(0.5);
    expect(len(stickVector(15, 0, R, 0.2, 1))).toBe(0);
    // 无死区、平方
    expect(len(stickVector(50, 0, R, 0, 2))).toBeCloseTo(0.25);
  });

  it('半径不大于 0 或偏移为 0 时是 (0, 0)，不出 NaN', () => {
    for (const r of [0, -10]) {
      const v = stickVector(30, 40, r);
      expect(v).toEqual({ x: 0, y: 0 });
    }
    for (const v of [stickVector(0, 0, 0), stickVector(0, 0, R), stickVector(0, 0, -1), stickVector(0, 0, R, 0)]) {
      expect(Number.isNaN(v.x) || Number.isNaN(v.y)).toBe(false);
      expect(v).toEqual({ x: 0, y: 0 });
    }
  });
});

describe('inInscribedCircle 矩形内切圆', () => {
  const sq = { left: 100, top: 200, width: 80, height: 80 };

  it('圆心（矩形中心）与圆内的点在里面', () => {
    expect(inInscribedCircle(140, 240, sq)).toBe(true);
    expect(inInscribedCircle(110, 240, sq)).toBe(true);
    expect(inInscribedCircle(160, 260, sq)).toBe(true);
  });

  it('圆周上算在里面，刚过圆周在外面', () => {
    expect(inInscribedCircle(180, 240, sq)).toBe(true);
    expect(inInscribedCircle(100, 240, sq)).toBe(true);
    expect(inInscribedCircle(140, 200, sq)).toBe(true);
    expect(inInscribedCircle(140, 280, sq)).toBe(true);
    expect(inInscribedCircle(180.01, 240, sq)).toBe(false);
    expect(inInscribedCircle(99.99, 240, sq)).toBe(false);
    expect(inInscribedCircle(140, 280.01, sq)).toBe(false);
  });

  it('方形的四角在圆外', () => {
    for (const [x, y] of [[100, 200], [180, 200], [100, 280], [180, 280], [105, 205]]) {
      expect(inInscribedCircle(x, y, sq), `${x},${y}`).toBe(false);
    }
  });

  it('矩形外的点在圆外', () => {
    expect(inInscribedCircle(0, 0, sq)).toBe(false);
    expect(inInscribedCircle(140, 500, sq)).toBe(false);
    expect(inInscribedCircle(-1000, 240, sq)).toBe(false);
  });

  it('非正方形按短边的一半作半径，圆心在矩形中心', () => {
    const wide = { left: 0, top: 0, width: 200, height: 100 };
    expect(inInscribedCircle(100, 50, wide)).toBe(true);
    expect(inInscribedCircle(149, 50, wide)).toBe(true);
    expect(inInscribedCircle(151, 50, wide)).toBe(false);
    expect(inInscribedCircle(100, 0, wide)).toBe(true);
    expect(inInscribedCircle(100, 101, wide)).toBe(false);
    expect(inInscribedCircle(10, 50, wide)).toBe(false);
    const tall = { left: 0, top: 0, width: 100, height: 300 };
    expect(inInscribedCircle(50, 150, tall)).toBe(true);
    expect(inInscribedCircle(50, 199, tall)).toBe(true);
    expect(inInscribedCircle(50, 201, tall)).toBe(false);
    expect(inInscribedCircle(50, 20, tall)).toBe(false);
  });

  it('没有大小的矩形里只有圆心算（半径 0）', () => {
    expect(inInscribedCircle(5, 5, { left: 5, top: 5, width: 0, height: 0 })).toBe(true);
    expect(inInscribedCircle(6, 5, { left: 5, top: 5, width: 0, height: 0 })).toBe(false);
  });
});

describe('swipeDir 抽屉滑动方向', () => {
  it('位移没到滑动距离不算滑动', () => {
    expect(swipeDir(0, 0)).toBeNull();
    expect(swipeDir(SWIPE_MIN - 2, 0)).toBeNull();
    expect(swipeDir(-(SWIPE_MIN - 2), 0)).toBeNull();
  });

  it('水平占主导且够远给出左 / 右', () => {
    expect(swipeDir(-60, 5)).toBe('left');
    expect(swipeDir(60, -5)).toBe('right');
    expect(swipeDir(-SWIPE_MIN - 10, 0)).toBe('left');
    expect(swipeDir(SWIPE_MIN + 10, 0)).toBe('right');
  });

  it('可以指定滑动距离', () => {
    expect(swipeDir(40, 0, 100)).toBeNull();
    expect(swipeDir(120, 0, 100)).toBe('right');
    expect(swipeDir(-120, 0, 100)).toBe('left');
  });
});

describe('TouchGestures 画面手势', () => {
  const calls: string[] = [];
  const pinches: Pinch[] = [];
  const boxes: { x0: number; y0: number; x1: number; y1: number; done: boolean; commit: boolean }[] = [];
  let canBox = true;
  let g: TouchGestures;

  beforeEach(() => {
    vi.useFakeTimers();
    calls.length = 0;
    pinches.length = 0;
    boxes.length = 0;
    canBox = true;
    const h: TouchHandlers = {
      tap: (x, y) => calls.push(`tap ${x},${y}`),
      hold: (x, y) => calls.push(`hold ${x},${y}`),
      canBox: () => canBox,
      box: (x0, y0, x1, y1, done, commit) => {
        boxes.push({ x0, y0, x1, y1, done, commit });
        calls.push('box');
      },
      pinch: p => {
        pinches.push(p);
        calls.push('pinch');
      },
    };
    g = new TouchGestures(h);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('单指', () => {
    it('按下抬起没怎么动、时间短是点，给出抬起位置', () => {
      g.down(1, 100, 200);
      vi.advanceTimersByTime(HOLD_MS - 1);
      g.up(1, 100, 200);
      expect(calls).toEqual(['tap 100,200']);
    });

    it('位移不超过抖动容差仍是点', () => {
      g.down(1, 100, 200);
      g.move(1, 100 + TAP_SLOP, 200);
      g.up(1, 100 + TAP_SLOP, 200);
      expect(calls).toEqual(['tap 110,200']);
    });

    it('按住不动满长按阈值触发长按，位置是手指当时的位置', () => {
      g.down(1, 100, 200);
      vi.advanceTimersByTime(HOLD_MS - 1);
      expect(calls).toEqual([]);
      vi.advanceTimersByTime(1);
      expect(calls).toEqual(['hold 100,200']);
    });

    it('抖动范围内的移动不妨碍长按', () => {
      g.down(1, 100, 200);
      g.move(1, 104, 203);
      vi.advanceTimersByTime(HOLD_MS);
      expect(calls).toEqual(['hold 104,203']);
    });

    it('长按触发后抬起不再算点', () => {
      g.down(1, 100, 200);
      vi.advanceTimersByTime(HOLD_MS);
      g.up(1, 100, 200);
      expect(calls).toEqual(['hold 100,200']);
    });

    it('长按只触发一次', () => {
      g.down(1, 100, 200);
      vi.advanceTimersByTime(HOLD_MS * 5);
      expect(calls).toEqual(['hold 100,200']);
    });

    it('位移超过容差是框选，给出起点与当前点，抬起时结束', () => {
      g.down(1, 100, 200);
      g.move(1, 100 + TAP_SLOP + 5, 200);
      g.move(1, 160, 260);
      g.up(1, 170, 270);
      expect(boxes).toEqual([
        { x0: 100, y0: 200, x1: 115, y1: 200, done: false, commit: true },
        { x0: 100, y0: 200, x1: 160, y1: 260, done: false, commit: true },
        { x0: 100, y0: 200, x1: 170, y1: 270, done: true, commit: true },
      ]);
      expect(calls.filter(c => c !== 'box')).toEqual([]);
    });

    it('拖动开始后不再触发长按，也不算点', () => {
      g.down(1, 100, 200);
      g.move(1, 150, 200);
      vi.advanceTimersByTime(HOLD_MS * 2);
      g.up(1, 150, 200);
      expect(calls.filter(c => c !== 'box')).toEqual([]);
    });

    it('拖出去又拖回起点附近，抬起也不算点', () => {
      g.down(1, 100, 200);
      g.move(1, 150, 200);
      g.move(1, 101, 200);
      g.up(1, 101, 200);
      expect(calls.filter(c => c !== 'box')).toEqual([]);
      expect(boxes[boxes.length - 1].done).toBe(true);
    });

    it('指令模式里（不能框选）拖动不框选，也不触发点或长按', () => {
      canBox = false;
      g.down(1, 100, 200);
      g.move(1, 160, 260);
      vi.advanceTimersByTime(HOLD_MS * 2);
      g.up(1, 160, 260);
      expect(calls).toEqual([]);
    });

    it('手势结束后下一轮重新判定', () => {
      g.down(1, 100, 200);
      g.up(1, 100, 200);
      g.down(2, 30, 40);
      vi.advanceTimersByTime(HOLD_MS);
      g.up(2, 30, 40);
      expect(calls).toEqual(['tap 100,200', 'hold 30,40']);
    });

    it('没按下过的手指抬起、移动没有任何效果', () => {
      g.move(9, 10, 10);
      g.up(9, 10, 10);
      expect(calls).toEqual([]);
    });
  });

  describe('第二根手指', () => {
    it('按下时作废待定的单指手势：不触发点、长按', () => {
      g.down(1, 100, 200);
      g.down(2, 200, 200);
      vi.advanceTimersByTime(HOLD_MS * 2);
      g.up(2, 200, 200);
      g.up(1, 100, 200);
      expect(calls).toEqual([]);
    });

    it('按下时打断拖动中的框选，且标明不该选', () => {
      g.down(1, 100, 200);
      g.move(1, 160, 260);
      calls.length = 0;
      boxes.length = 0;
      g.down(2, 300, 300);
      expect(boxes).toHaveLength(1);
      expect(boxes[0].done).toBe(true);
      expect(boxes[0].commit).toBe(false);
      g.up(2, 300, 300);
      g.up(1, 160, 260);
      expect(boxes).toHaveLength(1);
      expect(calls).toEqual(['box']);
    });

    it('双指移动时给出缩放、旋转与中点', () => {
      g.down(1, 0, 0);
      g.down(2, 100, 0);
      g.move(2, 200, 0);
      expect(pinches).toHaveLength(1);
      expect(pinches[0].scale).toBeCloseTo(2);
      expect(pinches[0].turn).toBeCloseTo(0);
      expect(pinches[0].x0).toBeCloseTo(50);
      expect(pinches[0].x1).toBeCloseTo(100);
      g.move(1, 0, 100);
      expect(pinches).toHaveLength(2);
      expect(pinches[1].turn).not.toBeCloseTo(0);
    });

    it('双指期间抬起一指，剩下的手指移动、抬起都不再触发单指手势或缩放', () => {
      g.down(1, 100, 200);
      g.down(2, 200, 200);
      g.up(2, 200, 200);
      calls.length = 0;
      g.move(1, 300, 300);
      vi.advanceTimersByTime(HOLD_MS * 2);
      g.up(1, 300, 300);
      expect(calls).toEqual([]);
    });

    it('双指期间抬起一指后再按下的手指也不触发单指手势，全部抬完后恢复', () => {
      g.down(1, 100, 200);
      g.down(2, 200, 200);
      g.up(2, 200, 200);
      g.down(3, 50, 50);
      vi.advanceTimersByTime(HOLD_MS * 2);
      g.up(3, 50, 50);
      g.up(1, 100, 200);
      expect(calls).toEqual([]);

      g.down(4, 10, 20);
      g.up(4, 10, 20);
      expect(calls).toEqual(['tap 10,20']);
    });
  });

  describe('cancel 被系统打断', () => {
    it('待定的手势被放弃：不触发点、长按', () => {
      g.down(1, 100, 200);
      g.cancel();
      vi.advanceTimersByTime(HOLD_MS * 2);
      g.up(1, 100, 200);
      expect(calls).toEqual([]);
    });

    it('拖动中的框选被收起且标明不该选', () => {
      g.down(1, 100, 200);
      g.move(1, 160, 260);
      boxes.length = 0;
      g.cancel();
      expect(boxes).toHaveLength(1);
      expect(boxes[0].done).toBe(true);
      expect(boxes[0].commit).toBe(false);
    });

    it('打断后下一轮能正常判定', () => {
      g.down(1, 100, 200);
      g.down(2, 200, 200);
      g.cancel();
      g.down(3, 10, 20);
      g.up(3, 10, 20);
      expect(calls).toEqual(['tap 10,20']);
    });
  });
});
