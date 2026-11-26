import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CARD_SLOP, HOLD_MS, SWIPE_MIN, TAP_SLOP, TouchGestures,
  asUiMode, cardIntent, isMobileUi, pinchOf, swipeDir,
} from '../src/touchInput';
import type { Pinch, TouchHandlers } from '../src/touchInput';

describe('常量', () => {
  it('抖动容差约 10px、长按 0.5 秒、卡片起手约 8px、滑动约 28px', () => {
    expect(TAP_SLOP).toBe(10);
    expect(HOLD_MS).toBe(500);
    expect(CARD_SLOP).toBe(8);
    expect(SWIPE_MIN).toBe(28);
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

  it('超过阈值后水平占主导是滚动卡片带', () => {
    expect(cardIntent(30, 0)).toBe('scroll');
    expect(cardIntent(-30, 0)).toBe('scroll');
    expect(cardIntent(-40, 5)).toBe('scroll');
  });

  it('可以指定阈值', () => {
    expect(cardIntent(0, 20, 50)).toBe('wait');
    expect(cardIntent(0, 60, 50)).toBe('drag');
    expect(cardIntent(60, 0, 50)).toBe('scroll');
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
