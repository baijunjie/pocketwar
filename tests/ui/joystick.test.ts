import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Joystick } from '../../src/ui/joystick';
import { FakeEl, firePointer, installFakeDom, rectOf } from './fakeDom';

describe('Joystick 镜头摇杆', () => {
  let dom: ReturnType<typeof installFakeDom>;
  let joy: Joystick;
  let base: FakeEl, knob: FakeEl;
  // 底座 100×100、左上角在 (200, 300)：中心 (250, 350)，半径 50；摇杆头宽 20
  const CX = 250, CY = 350;
  const press = (id: number, dx: number, dy: number, button = 0): Event => firePointer(base, 'pointerdown', { pointerId: id, clientX: CX + dx, clientY: CY + dy, button });
  const move = (id: number, dx: number, dy: number): Event => firePointer(base, 'pointermove', { pointerId: id, clientX: CX + dx, clientY: CY + dy });
  const shift = (): { x: number; y: number } => {
    const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(knob.style.transform ?? '');
    return m ? { x: Number(m[1]), y: Number(m[2]) } : { x: 0, y: 0 };
  };
  const len = (): number => Math.hypot(joy.x, joy.y);

  beforeEach(() => {
    dom = installFakeDom(vi);
    joy = new Joystick();
    base = joy.el as unknown as FakeEl;
    base.rect = rectOf(200, 300, 100, 100);
    knob = base.children[0];
    knob.offsetWidth = 20;
  });

  afterEach(() => {
    joy.destroy();
    vi.unstubAllGlobals();
  });

  it('底座是 class joy 的元素，里面一个 <i> 摇杆头；没按着时读数为 0、没有 on 类', () => {
    expect(base.className).toBe('joy');
    expect(base.children).toHaveLength(1);
    expect(knob.tagName).toBe('i');
    expect(joy.x).toBe(0);
    expect(joy.y).toBe(0);
    expect(base.classList.contains('on')).toBe(false);
  });

  it('按下后读数按手指相对底座中心的偏移算（半径是底座宽的一半），底座加 on 类，并捕获指针', () => {
    // 偏移 28、半径 50：m = 0.56，长度 ((0.56 − 0.12) / 0.88) ^ 1.5
    press(1, 28, 0);
    expect(joy.x).toBeCloseTo(0.5 ** 1.5);
    expect(joy.y).toBeCloseTo(0);
    expect(base.classList.contains('on')).toBe(true);
    expect(base.captureCalls).toEqual([1]);
  });

  it('方向：x 右正、y 下正', () => {
    press(1, 0, -50);
    expect(joy.x).toBeCloseTo(0);
    expect(joy.y).toBeCloseTo(-1);
    move(1, -50, 0);
    expect(joy.x).toBeCloseTo(-1);
    expect(joy.y).toBeCloseTo(0);
    move(1, 0, 50);
    expect(joy.y).toBeCloseTo(1);
    move(1, 30, 40);
    expect(joy.x).toBeGreaterThan(0);
    expect(joy.y).toBeGreaterThan(0);
    expect(joy.y / joy.x).toBeCloseTo(40 / 30);
  });

  it('按在死区内读数仍为 0，但已经按着（on）', () => {
    press(1, 3, 3);
    expect(joy.x).toBe(0);
    expect(joy.y).toBe(0);
    expect(base.classList.contains('on')).toBe(true);
  });

  it('推到半径处及以外长度为 1', () => {
    press(1, 50, 0);
    expect(len()).toBeCloseTo(1);
    move(1, 300, 400);
    expect(len()).toBeCloseTo(1);
    expect(joy.x).toBeCloseTo(0.6);
    expect(joy.y).toBeCloseTo(0.8);
  });

  it('同一个指针移动时更新读数', () => {
    press(1, 0, 0);
    move(1, 50, 0);
    expect(joy.x).toBeCloseTo(1);
    move(1, 0, 50);
    expect(joy.x).toBeCloseTo(0);
    expect(joy.y).toBeCloseTo(1);
  });

  it('摇杆头跟着手指平移，推得再远也不出底座', () => {
    press(1, 20, -10);
    expect(shift().x).toBeCloseTo(20);
    expect(shift().y).toBeCloseTo(-10);
    move(1, 500, -500);
    const s = shift();
    expect(Math.hypot(s.x, s.y)).toBeLessThanOrEqual(50);
    expect(Math.hypot(s.x, s.y)).toBeGreaterThan(0);
    expect(s.x).toBeGreaterThan(0);
    expect(s.y).toBeLessThan(0);
    expect(s.x).toBeCloseTo(-s.y);
  });

  it('不是左键不响应', () => {
    press(1, 30, 0, 2);
    expect(joy.x).toBe(0);
    expect(base.classList.contains('on')).toBe(false);
    expect(base.captureCalls).toEqual([]);
  });

  it('按着时别的指针的事件不影响它：第二根手指按下不抢、移动不改读数、抬起不归零', () => {
    press(1, 50, 0);
    const before = { x: joy.x, y: joy.y };
    press(2, -50, 0);
    expect(joy.x).toBeCloseTo(before.x);
    move(2, 0, 50);
    expect(joy.x).toBeCloseTo(before.x);
    expect(joy.y).toBeCloseTo(before.y);
    firePointer(base, 'pointerup', { pointerId: 2 });
    firePointer(base, 'pointercancel', { pointerId: 2 });
    firePointer(base, 'lostpointercapture', { pointerId: 2 });
    expect(joy.x).toBeCloseTo(before.x);
    expect(base.classList.contains('on')).toBe(true);
    // 第一根手指仍然驱动
    move(1, 0, -50);
    expect(joy.y).toBeCloseTo(-1);
  });

  it('第二根手指按下被忽略时不会拿到捕获', () => {
    press(1, 50, 0);
    press(2, 0, 50);
    expect(base.captureCalls).toEqual([1]);
  });

  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    it(`${type}（同一个指针）：读数归零、去掉 on 类、摇杆头回中`, () => {
      press(1, 40, 20);
      expect(len()).toBeGreaterThan(0);
      firePointer(base, type, { pointerId: 1 });
      expect(joy.x).toBe(0);
      expect(joy.y).toBe(0);
      expect(base.classList.contains('on')).toBe(false);
      expect(shift()).toEqual({ x: 0, y: 0 });
      // 归零后再动也不更新
      move(1, 50, 0);
      expect(joy.x).toBe(0);
    });
  }

  it('reset() 归零、去掉 on、摇杆头回中，之后可以重新按下', () => {
    press(1, 40, 0);
    joy.reset();
    expect(joy.x).toBe(0);
    expect(joy.y).toBe(0);
    expect(base.classList.contains('on')).toBe(false);
    expect(shift()).toEqual({ x: 0, y: 0 });
    press(3, 0, 50);
    expect(joy.y).toBeCloseTo(1);
    expect(base.classList.contains('on')).toBe(true);
  });

  it('松手后可以用别的指针重新按下', () => {
    press(1, 50, 0);
    firePointer(base, 'pointerup', { pointerId: 1 });
    press(2, 0, -50);
    expect(joy.y).toBeCloseTo(-1);
    expect(base.classList.contains('on')).toBe(true);
  });

  it('窗口失去焦点（blur）时归零', () => {
    press(1, 50, 0);
    dom.win.dispatchEvent(new Event('blur'));
    expect(joy.x).toBe(0);
    expect(joy.y).toBe(0);
    expect(base.classList.contains('on')).toBe(false);
    expect(shift()).toEqual({ x: 0, y: 0 });
  });

  it('destroy() 之后窗口 blur 不再影响它', () => {
    press(1, 50, 0);
    joy.destroy();
    dom.win.dispatchEvent(new Event('blur'));
    expect(joy.x).toBeCloseTo(1);
    expect(base.classList.contains('on')).toBe(true);
  });
});
