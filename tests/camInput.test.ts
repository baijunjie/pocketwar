import { describe, expect, it } from 'vitest';
import {
  EDGE_ZONE, EXIT_BAND, WHEEL_BURST_GAP, WheelClassifier,
  asWheelMode, edgeSpeed, exitDirection, looksLikeTrackpad,
} from '../src/camInput';
import type { WheelSample } from '../src/camInput';

describe('常量', () => {
  it('卷屏区只有屏幕最外沿 6px，离开网页续卷的范围 64px，滚轮一串的间隔 0.3 秒', () => {
    expect(EDGE_ZONE).toBe(6);
    expect(EXIT_BAND).toBe(64);
    expect(WHEEL_BURST_GAP).toBe(0.3);
  });
});

describe('edgeSpeed 边缘卷屏速度', () => {
  it('离边不小于卷屏区宽度时不卷', () => {
    expect(edgeSpeed(EDGE_ZONE)).toBe(0);
    expect(edgeSpeed(10)).toBe(0);
    expect(edgeSpeed(500)).toBe(0);
  });

  it('贴边或越过边是 1', () => {
    expect(edgeSpeed(0)).toBe(1);
    expect(edgeSpeed(-1)).toBe(1);
    expect(edgeSpeed(-300)).toBe(1);
  });

  it('卷屏区内离边越近越快、单调不减，刚进入时不低于 0.5', () => {
    let prev = Infinity;
    for (let v = 0; v < EDGE_ZONE; v += 0.25) {
      const s = edgeSpeed(v);
      expect(s, `v=${v}`).toBeGreaterThanOrEqual(0.5);
      expect(s, `v=${v}`).toBeLessThanOrEqual(1);
      expect(s, `v=${v}`).toBeLessThanOrEqual(prev);
      prev = s;
    }
    expect(edgeSpeed(EDGE_ZONE - 0.01)).toBeGreaterThanOrEqual(0.5);
    expect(edgeSpeed(1)).toBeGreaterThan(edgeSpeed(5));
  });

  it('可指定卷屏区宽度', () => {
    expect(edgeSpeed(10, 20)).toBeGreaterThanOrEqual(0.5);
    expect(edgeSpeed(10, 20)).toBeLessThan(1);
    expect(edgeSpeed(20, 20)).toBe(0);
    expect(edgeSpeed(0, 20)).toBe(1);
    expect(edgeSpeed(8, 5)).toBe(0);
  });
});

describe('exitDirection 离开网页后的续卷方向', () => {
  const w = 1000, h = 800;

  it('最后位置在 band 以内且最后一次移动严格朝着那条边：朝那个方向续卷', () => {
    expect(exitDirection(10, 400, -5, 0, w, h)).toEqual({ dx: -1, dy: 0 });
    expect(exitDirection(990, 400, 5, 0, w, h)).toEqual({ dx: 1, dy: 0 });
    expect(exitDirection(500, 10, 0, -5, w, h)).toEqual({ dx: 0, dy: -1 });
    expect(exitDirection(500, 790, 0, 5, w, h)).toEqual({ dx: 0, dy: 1 });
  });

  it('甩得快时最后位置离边几十像素也算', () => {
    expect(exitDirection(40, 400, -30, 0, w, h)).toEqual({ dx: -1, dy: 0 });
    expect(exitDirection(960, 400, 30, 0, w, h)).toEqual({ dx: 1, dy: 0 });
    expect(exitDirection(500, 50, 0, -30, w, h)).toEqual({ dx: 0, dy: -1 });
    expect(exitDirection(500, 750, 0, 30, w, h)).toEqual({ dx: 0, dy: 1 });
  });

  it('离边不到 zone 时，静止也续卷', () => {
    expect(exitDirection(5, 400, 0, 0, w, h)).toEqual({ dx: -1, dy: 0 });
    expect(exitDirection(995, 400, 0, 0, w, h)).toEqual({ dx: 1, dy: 0 });
    expect(exitDirection(500, 3, 0, 0, w, h)).toEqual({ dx: 0, dy: -1 });
    expect(exitDirection(500, 795, 0, 0, w, h)).toEqual({ dx: 0, dy: 1 });
  });

  it('离边不到 zone 时，最后一次移动沿着边（该轴分量为 0）或稍微朝里，也续卷', () => {
    expect(exitDirection(2, 400, 0, 9, w, h)).toEqual({ dx: -1, dy: 0 });
    expect(exitDirection(2, 400, 3, 0, w, h)).toEqual({ dx: -1, dy: 0 });
    expect(exitDirection(997, 400, -3, 0, w, h)).toEqual({ dx: 1, dy: 0 });
    expect(exitDirection(500, 2, 9, 3, w, h)).toEqual({ dx: 0, dy: -1 });
  });

  it('离右 / 下边的距离按 w-1-x、h-1-y 算', () => {
    // 离右边 5（< 6）：算贴边；w-x 算的话是 6，不算
    expect(exitDirection(994, 400, 0, 0, w, h)).toEqual({ dx: 1, dy: 0 });
    expect(exitDirection(500, 794, 0, 0, w, h)).toEqual({ dx: 0, dy: 1 });
    // 离右边恰为 6：不在 zone 内，静止不算
    expect(exitDirection(993, 400, 0, 0, w, h)).toBeNull();
    expect(exitDirection(500, 793, 0, 0, w, h)).toBeNull();
    // 最右一个像素
    expect(exitDirection(999, 400, 0, 0, w, h)).toEqual({ dx: 1, dy: 0 });
  });

  it('在 band 内但不朝着该边、又不在 zone 内：不续卷（移动分量为 0 也不算）', () => {
    expect(exitDirection(40, 400, 0, 0, w, h)).toBeNull();
    expect(exitDirection(960, 400, 0, 0, w, h)).toBeNull();
    expect(exitDirection(500, 40, 0, 0, w, h)).toBeNull();
    expect(exitDirection(500, 760, 0, 0, w, h)).toBeNull();
    expect(exitDirection(40, 400, 5, 0, w, h)).toBeNull();
  });

  it('位置在中间：不续卷', () => {
    expect(exitDirection(500, 400, -5, -5, w, h)).toBeNull();
    expect(exitDirection(500, 400, 0, 0, w, h)).toBeNull();
    expect(exitDirection(200, 300, 9, 9, w, h)).toBeNull();
  });

  it('位置在 band 内但正远离那条边：不续卷', () => {
    expect(exitDirection(10, 400, 5, 0, w, h)).toBeNull();
    expect(exitDirection(990, 400, -5, 0, w, h)).toBeNull();
    expect(exitDirection(500, 10, 0, 5, w, h)).toBeNull();
    expect(exitDirection(500, 790, 0, -5, w, h)).toBeNull();
  });

  it('真正从角上出去（两轴都离边不到 zone）：两轴都续', () => {
    expect(exitDirection(2, 3, 0, 0, w, h)).toEqual({ dx: -1, dy: -1 });
    expect(exitDirection(2, 3, -3, -3, w, h)).toEqual({ dx: -1, dy: -1 });
    expect(exitDirection(997, 796, 3, 3, w, h)).toEqual({ dx: 1, dy: 1 });
    expect(exitDirection(2, 796, -3, 3, w, h)).toEqual({ dx: -1, dy: 1 });
    expect(exitDirection(997, 3, 3, -3, w, h)).toEqual({ dx: 1, dy: -1 });
  });

  it('往上冲进左上角的标签栏：横向的一点抖动不带着镜头斜着卷，只续上', () => {
    expect(exitDirection(30, 3, -1, -8, w, h)).toEqual({ dx: 0, dy: -1 });
    // 对称：往左冲进左边，纵向的一点抖动不算
    expect(exitDirection(3, 30, -8, -1, w, h)).toEqual({ dx: -1, dy: 0 });
    // 右下角同理
    expect(exitDirection(970, 797, 1, 8, w, h)).toEqual({ dx: 0, dy: 1 });
    expect(exitDirection(996, 770, 8, 1, w, h)).toEqual({ dx: 1, dy: 0 });
  });

  it('两轴都算但不都在 zone 内：只留离边更近的那条轴', () => {
    // 都只在 band 内、都朝外：横向 10 比纵向 40 近
    expect(exitDirection(10, 40, -3, -3, w, h)).toEqual({ dx: -1, dy: 0 });
    expect(exitDirection(40, 10, -3, -3, w, h)).toEqual({ dx: 0, dy: -1 });
    // 一条在 zone 内、另一条在 band 内朝外：留 zone 内那条
    expect(exitDirection(3, 40, 0, -5, w, h)).toEqual({ dx: -1, dy: 0 });
    // 右下：纵向离边 2、横向离边 9
    expect(exitDirection(990, 797, 3, 3, w, h)).toEqual({ dx: 0, dy: 1 });
  });

  it('角落里只有一个轴朝外，只续那个轴', () => {
    expect(exitDirection(10, 10, -3, 3, w, h)).toEqual({ dx: -1, dy: 0 });
    expect(exitDirection(10, 10, 3, -3, w, h)).toEqual({ dx: 0, dy: -1 });
  });

  it('可指定 band', () => {
    expect(exitDirection(100, 400, -1, 0, w, h, 150)).toEqual({ dx: -1, dy: 0 });
    expect(exitDirection(100, 400, -1, 0, w, h, 20)).toBeNull();
  });

  it('可指定 zone', () => {
    expect(exitDirection(10, 400, 0, 0, w, h)).toBeNull();
    expect(exitDirection(10, 400, 0, 0, w, h, undefined, 20)).toEqual({ dx: -1, dy: 0 });
    expect(exitDirection(10, 400, 5, 0, w, h, undefined, 20)).toEqual({ dx: -1, dy: 0 });
    expect(exitDirection(2, 400, 0, 0, w, h, undefined, 1)).toBeNull();
  });
});

describe('asWheelMode 存下来的字符串还原成滚轮模式', () => {
  it('trackpad、mouse 原样返回', () => {
    expect(asWheelMode('trackpad')).toBe('trackpad');
    expect(asWheelMode('mouse')).toBe('mouse');
  });

  it('null、auto、空串、非法字符串都是 auto', () => {
    expect(asWheelMode(null)).toBe('auto');
    expect(asWheelMode('auto')).toBe('auto');
    expect(asWheelMode('')).toBe('auto');
    expect(asWheelMode('banana')).toBe('auto');
    expect(asWheelMode('Mouse')).toBe('auto');
  });
});

describe('looksLikeTrackpad 单个 wheel 事件像不像触控板', () => {
  const s = (o: Partial<WheelSample>): WheelSample => ({ deltaX: 0, deltaY: 0, deltaMode: 0, ...o });

  it('deltaMode 不是 0（按行 / 页计量）不是触控板，即使有横向分量', () => {
    expect(looksLikeTrackpad(s({ deltaMode: 1, deltaY: 3 }))).toBe(false);
    expect(looksLikeTrackpad(s({ deltaMode: 2, deltaY: 1 }))).toBe(false);
    expect(looksLikeTrackpad(s({ deltaMode: 1, deltaX: 2, deltaY: 3 }))).toBe(false);
  });

  it('有横向分量是触控板', () => {
    expect(looksLikeTrackpad(s({ deltaX: 5, deltaY: 100, wheelDeltaY: -120 }))).toBe(true);
    expect(looksLikeTrackpad(s({ deltaX: -1 }))).toBe(true);
  });

  it('deltaY 为 0 且没有横向分量不是触控板', () => {
    expect(looksLikeTrackpad(s({}))).toBe(false);
    expect(looksLikeTrackpad(s({ wheelDeltaY: 0 }))).toBe(false);
  });

  it('有非零 wheelDeltaY：恰好是 -3 倍 deltaY 是触控板，否则不是', () => {
    expect(looksLikeTrackpad(s({ deltaY: 4.5, wheelDeltaY: -13.5 }))).toBe(true);
    expect(looksLikeTrackpad(s({ deltaY: -7, wheelDeltaY: 21 }))).toBe(true);
    expect(looksLikeTrackpad(s({ deltaY: 120, wheelDeltaY: -360 }))).toBe(true);
    // 鼠标一格
    expect(looksLikeTrackpad(s({ deltaY: 100, wheelDeltaY: -120 }))).toBe(false);
    expect(looksLikeTrackpad(s({ deltaY: -100, wheelDeltaY: 120 }))).toBe(false);
    // 小数、幅度小，但 wheelDeltaY 对不上：以 wheelDeltaY 为准
    expect(looksLikeTrackpad(s({ deltaY: 4.5, wheelDeltaY: -120 }))).toBe(false);
  });

  it('没有 wheelDeltaY：带小数且幅度小于 50 是触控板，整数或幅度大的是鼠标', () => {
    expect(looksLikeTrackpad(s({ deltaY: 4.5 }))).toBe(true);
    expect(looksLikeTrackpad(s({ deltaY: -12.25 }))).toBe(true);
    expect(looksLikeTrackpad(s({ deltaY: 4 }))).toBe(false);
    expect(looksLikeTrackpad(s({ deltaY: 100 }))).toBe(false);
    expect(looksLikeTrackpad(s({ deltaY: 120.5 }))).toBe(false);
    expect(looksLikeTrackpad(s({ deltaY: -80.5 }))).toBe(false);
  });
});

describe('WheelClassifier 自动判定', () => {
  const mouse: WheelSample = { deltaX: 0, deltaY: 100, deltaMode: 0, wheelDeltaY: -120 };
  const pad: WheelSample = { deltaX: 3, deltaY: 4.5, deltaMode: 0 };

  it('指定 trackpad / mouse 时直接返回，不看事件特征', () => {
    const c = new WheelClassifier();
    expect(c.classify(mouse, 'trackpad', 1)).toBe('trackpad');
    expect(c.classify(pad, 'mouse', 2)).toBe('mouse');
  });

  it('一串事件按头一个事件定性', () => {
    const c1 = new WheelClassifier();
    expect(c1.classify(mouse, 'auto', 10)).toBe('mouse');
    expect(c1.classify(mouse, 'auto', 10.1)).toBe('mouse');
    const c2 = new WheelClassifier();
    expect(c2.classify(pad, 'auto', 10)).toBe('trackpad');
    expect(c2.classify(pad, 'auto', 10.1)).toBe('trackpad');
  });

  it('串中途出现触控板特征改判为触控板，保持到串结束', () => {
    const c = new WheelClassifier();
    expect(c.classify(mouse, 'auto', 10)).toBe('mouse');
    expect(c.classify(pad, 'auto', 10.1)).toBe('trackpad');
    expect(c.classify(mouse, 'auto', 10.2)).toBe('trackpad');
    expect(c.classify(mouse, 'auto', 10.4)).toBe('trackpad');
  });

  it('同一串里不会从触控板改回鼠标（惯性尾巴）', () => {
    const c = new WheelClassifier();
    expect(c.classify(pad, 'auto', 5)).toBe('trackpad');
    for (let t = 5.1; t < 6; t += 0.1) expect(c.classify(mouse, 'auto', t), `t=${t}`).toBe('trackpad');
  });

  it('间隔超过 0.3 秒开启新的一串，重新定性，可以从触控板变回鼠标', () => {
    const c = new WheelClassifier();
    expect(c.classify(pad, 'auto', 1)).toBe('trackpad');
    expect(c.classify(mouse, 'auto', 1 + WHEEL_BURST_GAP + 0.05)).toBe('mouse');
    expect(c.classify(pad, 'auto', 3)).toBe('trackpad');
  });

  it('间隔按相邻两个事件算，不按一串的起点算', () => {
    const c = new WheelClassifier();
    expect(c.classify(pad, 'auto', 0)).toBe('trackpad');
    expect(c.classify(mouse, 'auto', 0.25)).toBe('trackpad');
    expect(c.classify(mouse, 'auto', 0.5)).toBe('trackpad');
    expect(c.classify(mouse, 'auto', 0.75)).toBe('trackpad');
  });

  it('指定模式下的事件不影响之后自动判定的新一串', () => {
    const c = new WheelClassifier();
    expect(c.classify(pad, 'mouse', 1)).toBe('mouse');
    expect(c.classify(mouse, 'auto', 5)).toBe('mouse');
  });
});
