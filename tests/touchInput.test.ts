import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CARD_SCROLL_BIAS, CARD_SLOP, DROP_ARM, DROP_REACH, DROP_TURN_BAND, GroundTaps, HOLD_MS, STICK_CURVE, STICK_DEAD, SWIPE_MIN, TAP_SLOP, TouchGestures,
  asUiMode, cardIntent, dropOffset, isMobileUi, pinchOf, stickVector, swipeDir,
} from '../src/touchInput';
import type { Pinch, TouchHandlers } from '../src/touchInput';

describe('GroundTaps 移动版地面点按', () => {
  const firstScreen = { x: 100, y: 200 };
  const firstWorld = { x: 400, y: 700 };
  const secondWorld = { x: 430, y: 660 };
  const move = vi.fn();
  let taps: GroundTaps;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    move.mockClear();
    taps = new GroundTaps(move);
  });

  afterEach(() => {
    taps.cancel();
    vi.useRealTimers();
  });

  it('首点立即对点按的世界坐标发出攻击移动，随后不迟发', () => {
    taps.tap(firstScreen, firstWorld);
    expect(move).toHaveBeenCalledExactlyOnceWith(firstWorld, true);
    vi.advanceTimersByTime(500);
    expect(move).toHaveBeenCalledTimes(1);
  });

  it('恰好间隔 260 ms、相距 24 px 的次点立即发出普通移动', () => {
    taps.tap(firstScreen, firstWorld);
    expect(move).toHaveBeenCalledExactlyOnceWith(firstWorld, true);
    vi.advanceTimersByTime(260);
    taps.tap({ x: 100, y: 224 }, secondWorld);
    expect(move.mock.calls).toEqual([[firstWorld, true], [secondWorld, false]]);
    vi.advanceTimersByTime(500);
    expect(move).toHaveBeenCalledTimes(2);
  });

  it('窗口内但相距超过 24 px 时，两点各自立即攻击移动', () => {
    taps.tap(firstScreen, firstWorld);
    vi.advanceTimersByTime(100);
    taps.tap({ x: 100, y: 225 }, secondWorld);
    expect(move.mock.calls).toEqual([[firstWorld, true], [secondWorld, true]]);
  });

  it('超过 260 ms 的同处点按立即发出新的攻击移动', () => {
    taps.tap(firstScreen, firstWorld);
    vi.advanceTimersByTime(261);
    taps.tap(firstScreen, secondWorld);
    expect(move.mock.calls).toEqual([[firstWorld, true], [secondWorld, true]]);
  });

  it('同处连续三次点按时，第三点作为下一组的首点攻击移动', () => {
    const thirdWorld = { x: 410, y: 720 };
    taps.tap(firstScreen, firstWorld);
    vi.advanceTimersByTime(60);
    taps.tap(firstScreen, secondWorld);
    vi.advanceTimersByTime(60);
    taps.tap(firstScreen, thirdWorld);
    expect(move.mock.calls).toEqual([[firstWorld, true], [secondWorld, false], [thirdWorld, true]]);
  });

  it('取消只清掉配对，下一次同处点按立即攻击移动且没有迟发命令', () => {
    taps.tap(firstScreen, firstWorld);
    expect(move).toHaveBeenCalledExactlyOnceWith(firstWorld, true);
    vi.advanceTimersByTime(70);
    taps.cancel();
    taps.tap(firstScreen, secondWorld);
    expect(move.mock.calls).toEqual([[firstWorld, true], [secondWorld, true]]);
    vi.advanceTimersByTime(500);
    expect(move).toHaveBeenCalledTimes(2);
  });
});

describe('常量', () => {
  it('抖动容差约 10px、长按 0.5 秒、卡片起手约 8px、滑动约 28px', () => {
    expect(TAP_SLOP).toBe(10);
    expect(HOLD_MS).toBe(500);
    expect(CARD_SLOP).toBe(8);
    expect(SWIPE_MIN).toBe(28);
  });

  it('卡片起手偏向拖：横向要超竖向 1.5 倍才算滚动；落点（剑尖）离手指 100px、手指离屏幕底 150px 以内开始放倒、手指离按下处 28px 以上才下令；摇杆死区 12%、读数曲线 1.5 次幂', () => {
    expect(CARD_SCROLL_BIAS).toBe(1.5);
    expect(DROP_REACH).toBe(100);
    expect(DROP_TURN_BAND).toBe(150);
    expect(DROP_ARM).toBe(28);
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

describe('dropOffset 拖卡片时落点（剑尖）相对手指的偏移', () => {
  // 屏幕底 800：离屏幕底 150px 以内（y > 650）开始放倒
  const bottom = 800;
  const off = (y: number, reach?: number, band?: number) => dropOffset(y, bottom, 1, reach, band);
  const len = (v: { x: number; y: number }): number => Math.hypot(v.x, v.y);

  it('手指离屏幕底不少于 band：竖直朝上，偏移 (0, −reach)', () => {
    for (const y of [650, 600, 500, 300, 0, -100]) {
      const v = off(y);
      expect(v.x, `y=${y}`).toBeCloseTo(0);
      expect(v.y, `y=${y}`).toBeCloseTo(-DROP_REACH);
    }
  });

  it('到屏幕底（及以下）时水平朝右，偏移 (reach, 0)', () => {
    for (const y of [800, 801, 900, 2000]) {
      const v = off(y);
      expect(v.x, `y=${y}`).toBeCloseTo(DROP_REACH);
      expect(v.y, `y=${y}`).toBeCloseTo(0);
    }
  });

  it('进到一半深度时是 45 度', () => {
    const v = off(bottom - DROP_TURN_BAND / 2);
    expect(v.x).toBeCloseTo(DROP_REACH * Math.SQRT1_2);
    expect(v.y).toBeCloseTo(-DROP_REACH * Math.SQRT1_2);
  });

  it('转角与进入的深度成正比：进到 1/3 深度是 30 度，2/3 是 60 度', () => {
    const a = off(bottom - DROP_TURN_BAND * 2 / 3);
    expect(Math.atan2(a.x, -a.y) * 180 / Math.PI).toBeCloseTo(30);
    const b = off(bottom - DROP_TURN_BAND / 3);
    expect(Math.atan2(b.x, -b.y) * 180 / Math.PI).toBeCloseTo(60);
  });

  it('偏移的长度始终等于 reach，只朝上、朝右（x 不为负、y 不为正）', () => {
    for (let y = -200; y <= 1100; y += 1) {
      const v = off(y);
      expect(len(v), `y=${y}`).toBeCloseTo(DROP_REACH);
      expect(v.x, `y=${y}`).toBeGreaterThanOrEqual(-1e-9);
      expect(v.y, `y=${y}`).toBeLessThanOrEqual(1e-9);
    }
  });

  it('落点的 y 随手指 y 单调不减且连续；手指在屏幕底时落点的 y 也在屏幕底', () => {
    const step = 0.5;
    for (const [reach, band] of [[undefined, undefined], [60, 100], [150, 400]] as const) {
      const r = reach ?? DROP_REACH, bd = band ?? DROP_TURN_BAND;
      let prev = -300 + off(-300, reach, band).y;
      for (let y = -300 + step; y <= 1100; y += step) {
        const cur = y + off(y, reach, band).y;
        expect(cur, `y=${y} reach=${reach}`).toBeGreaterThanOrEqual(prev - 1e-9);
        // 落点每步走的距离不超过步长的 (1 + reach·π/2/band) 倍
        expect(cur - prev, `y=${y} reach=${reach}`).toBeLessThanOrEqual(step * (1 + (r * Math.PI / 2) / bd) + 1e-9);
        prev = cur;
      }
      expect(bottom + off(bottom, reach, band).y).toBeCloseTo(bottom);
    }
  });

  it('偏移的 x 随手指下移单调不减（越往下越朝右倒）', () => {
    let prev = -1;
    for (let y = 0; y <= 1000; y += 1) {
      const x = off(y).x;
      expect(x, `y=${y}`).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = x;
    }
  });

  describe('side = −1（向左放倒）', () => {
    const offL = (y: number): { x: number; y: number } => dropOffset(y, bottom, -1);

    it('x 分量与 side = 1 镜像、y 相同', () => {
      for (let y = -100; y <= 1000; y += 7) {
        const r = dropOffset(y, bottom, 1), l = offL(y);
        expect(l.x, `y=${y}`).toBeCloseTo(-r.x);
        expect(l.y, `y=${y}`).toBeCloseTo(r.y);
      }
    });

    it('离屏幕底不少于 band：竖直朝上，不受 side 影响', () => {
      for (const y of [650, 300, 0, -100]) {
        expect(offL(y).x, `y=${y}`).toBeCloseTo(0);
        expect(offL(y).y, `y=${y}`).toBeCloseTo(-DROP_REACH);
      }
    });

    it('到屏幕底时水平朝左，偏移 (−reach, 0)', () => {
      for (const y of [800, 900]) {
        expect(offL(y).x).toBeCloseTo(-DROP_REACH);
        expect(offL(y).y).toBeCloseTo(0);
      }
    });

    it('一半深度是向左 45 度；指定 reach 与 band 同样镜像', () => {
      const v = offL(bottom - DROP_TURN_BAND / 2);
      expect(v.x).toBeCloseTo(-DROP_REACH * Math.SQRT1_2);
      expect(v.y).toBeCloseTo(-DROP_REACH * Math.SQRT1_2);
      const w = dropOffset(450, 500, -1, 80, 100);
      expect(w.x).toBeCloseTo(-80 * Math.SQRT1_2);
      expect(w.y).toBeCloseTo(-80 * Math.SQRT1_2);
    });

    it('偏移长度始终是 reach，x 不为正', () => {
      for (let y = -200; y <= 1100; y += 1) {
        const v = offL(y);
        expect(len(v), `y=${y}`).toBeCloseTo(DROP_REACH);
        expect(v.x, `y=${y}`).toBeLessThanOrEqual(1e-9);
      }
    });

    it('band 不大于 0 时始终朝上', () => {
      const v = dropOffset(900, bottom, -1, 100, 0);
      expect(v.x).toBeCloseTo(0);
      expect(v.y).toBeCloseTo(-100);
    });
  });

  it('可以指定 reach 与 band', () => {
    expect(off(0, 50).y).toBeCloseTo(-50);
    expect(len(off(750, 50))).toBeCloseTo(50);
    const v = dropOffset(450, 500, 1, 80, 100);
    // 离屏幕底 50 = band 的一半：45 度
    expect(v.x).toBeCloseTo(80 * Math.SQRT1_2);
    expect(v.y).toBeCloseTo(-80 * Math.SQRT1_2);
    expect(dropOffset(399, 500, 1, 80, 100).x).toBeCloseTo(0);
    expect(dropOffset(500, 500, 1, 80, 100).x).toBeCloseTo(80);
  });

  it('band 不大于 0 时始终朝上，不出 NaN', () => {
    for (const band of [0, -10]) {
      for (const y of [0, 700, 800, 900]) {
        const v = off(y, 100, band);
        expect(Number.isNaN(v.x) || Number.isNaN(v.y), `band=${band} y=${y}`).toBe(false);
        expect(v.x).toBeCloseTo(0);
        expect(v.y).toBeCloseTo(-100);
      }
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
  const pinchStart = vi.fn();
  const boxes: { x0: number; y0: number; x1: number; y1: number; done: boolean; commit: boolean }[] = [];
  let canBox = true;
  let g: TouchGestures;

  beforeEach(() => {
    vi.useFakeTimers();
    calls.length = 0;
    pinches.length = 0;
    pinchStart.mockClear();
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
      pinchStart,
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
    it('第二根手指一按下即通知双指起手，移动与此后按下的第三指不重复通知', () => {
      g.down(1, 100, 200);
      expect(pinchStart).not.toHaveBeenCalled();
      g.down(2, 200, 200);
      expect(pinchStart).toHaveBeenCalledTimes(1);
      expect(pinches).toHaveLength(0);
      g.down(3, 300, 200);
      g.move(2, 200, 230);
      expect(pinchStart).toHaveBeenCalledTimes(1);
      expect(pinches).toHaveLength(1);
    });

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
