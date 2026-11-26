import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOLD_MS, TAP_SLOP } from '../../src/touchInput';
import { bindPress } from '../../src/ui/pressable';
import { FakeEl, firePointer } from './fakeDom';

describe('bindPress 点一下与长按', () => {
  let el: FakeEl;
  let tap: ReturnType<typeof vi.fn>;
  let hold: ReturnType<typeof vi.fn>;
  const asEl = (): HTMLElement => el as unknown as HTMLElement;
  const down = (x = 50, y = 50, id = 1, button = 0): Event => firePointer(el, 'pointerdown', { clientX: x, clientY: y, pointerId: id, button });
  const move = (x: number, y: number, id = 1): Event => firePointer(el, 'pointermove', { clientX: x, clientY: y, pointerId: id });
  const up = (id = 1): Event => firePointer(el, 'pointerup', { pointerId: id });
  /** click 事件：detail 为 0 是键盘 / 读屏的激活，≥ 1 是手指 / 鼠标点出来的 */
  const click = (detail: number): Event => {
    const e = new Event('click', { cancelable: true });
    Object.defineProperty(e, 'detail', { value: detail });
    el.dispatchEvent(e);
    return e;
  };
  const isDown = (): boolean => el.classList.contains('down');

  beforeEach(() => {
    vi.useFakeTimers();
    el = new FakeEl('button');
    tap = vi.fn();
    hold = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('点一下', () => {
    it('按下后元素带 down 类，抬起调一次 tap、去掉 down', () => {
      bindPress(asEl(), { tap, hold });
      down();
      expect(isDown()).toBe(true);
      expect(tap).not.toHaveBeenCalled();
      up();
      expect(tap).toHaveBeenCalledTimes(1);
      expect(hold).not.toHaveBeenCalled();
      expect(isDown()).toBe(false);
    });

    it('位移不超过 slop（默认 TAP_SLOP）仍是点；刚好等于 slop 不算滑开', () => {
      bindPress(asEl(), { tap, hold });
      down(50, 50);
      move(50 + TAP_SLOP, 50);
      expect(isDown()).toBe(true);
      up();
      expect(tap).toHaveBeenCalledTimes(1);
    });

    it('没到 holdMs 就抬起是 tap，不调 hold；之后计时到了也不调 hold', () => {
      bindPress(asEl(), { tap, hold });
      down();
      vi.advanceTimersByTime(HOLD_MS - 1);
      up();
      vi.advanceTimersByTime(HOLD_MS * 2);
      expect(tap).toHaveBeenCalledTimes(1);
      expect(hold).not.toHaveBeenCalled();
    });

    it('没有按下过直接收到 pointerup 不调 tap', () => {
      bindPress(asEl(), { tap, hold });
      up();
      expect(tap).not.toHaveBeenCalled();
    });

    it('抬起后可以再按一次，每次各调一次 tap', () => {
      bindPress(asEl(), { tap });
      down(); up();
      down(); up();
      expect(tap).toHaveBeenCalledTimes(2);
    });

    it('按下时捕获这根指针', () => {
      bindPress(asEl(), { tap });
      down(50, 50, 7);
      expect(el.captureCalls).toEqual([7]);
    });
  });

  describe('长按', () => {
    it('按住不动满 holdMs（默认 HOLD_MS）调一次 hold、去掉 down；之后抬起不调 tap', () => {
      bindPress(asEl(), { tap, hold });
      down();
      vi.advanceTimersByTime(HOLD_MS - 1);
      expect(hold).not.toHaveBeenCalled();
      expect(isDown()).toBe(true);
      vi.advanceTimersByTime(1);
      expect(hold).toHaveBeenCalledTimes(1);
      expect(isDown()).toBe(false);
      up();
      expect(tap).not.toHaveBeenCalled();
      expect(hold).toHaveBeenCalledTimes(1);
    });

    it('可以指定 holdMs', () => {
      bindPress(asEl(), { tap, hold }, 200);
      down();
      vi.advanceTimersByTime(199);
      expect(hold).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(hold).toHaveBeenCalledTimes(1);
    });

    it('长按触发后再按一次仍能点：新一次按压独立计算', () => {
      bindPress(asEl(), { tap, hold });
      down();
      vi.advanceTimersByTime(HOLD_MS);
      up();
      down();
      up();
      expect(hold).toHaveBeenCalledTimes(1);
      expect(tap).toHaveBeenCalledTimes(1);
    });

    it('没给 hold：按多久抬起都是 tap', () => {
      bindPress(asEl(), { tap });
      down();
      vi.advanceTimersByTime(HOLD_MS * 10);
      expect(isDown()).toBe(true);
      up();
      expect(tap).toHaveBeenCalledTimes(1);
      expect(isDown()).toBe(false);
    });
  });

  describe('作废', () => {
    it('手指滑开超过 slop：去掉 down，抬起不调 tap，到时间也不调 hold', () => {
      bindPress(asEl(), { tap, hold });
      down(50, 50);
      move(50 + TAP_SLOP + 1, 50);
      expect(isDown()).toBe(false);
      vi.advanceTimersByTime(HOLD_MS * 2);
      up();
      expect(tap).not.toHaveBeenCalled();
      expect(hold).not.toHaveBeenCalled();
    });

    it('斜向位移按直线距离算：各轴都没超过 slop 但合起来超过也作废', () => {
      bindPress(asEl(), { tap, hold });
      down(50, 50);
      move(50 + TAP_SLOP * 0.8, 50 + TAP_SLOP * 0.8);
      expect(isDown()).toBe(false);
      up();
      expect(tap).not.toHaveBeenCalled();
    });

    it('可以指定 slop', () => {
      bindPress(asEl(), { tap }, HOLD_MS, 30);
      down(50, 50);
      move(50, 50 + 25);
      expect(isDown()).toBe(true);
      move(50, 50 + 31);
      expect(isDown()).toBe(false);
      up();
      expect(tap).not.toHaveBeenCalled();
    });

    it('作废后可以重新按下，照常 tap', () => {
      bindPress(asEl(), { tap, hold });
      down(50, 50);
      move(200, 200);
      up();
      down(50, 50);
      up();
      expect(tap).toHaveBeenCalledTimes(1);
    });

    it('pointercancel：作废，不调 tap、hold', () => {
      bindPress(asEl(), { tap, hold });
      down();
      firePointer(el, 'pointercancel', { pointerId: 1 });
      expect(isDown()).toBe(false);
      vi.advanceTimersByTime(HOLD_MS * 2);
      up();
      expect(tap).not.toHaveBeenCalled();
      expect(hold).not.toHaveBeenCalled();
    });

    it('lostpointercapture：作废，不调 tap、hold', () => {
      bindPress(asEl(), { tap, hold });
      down();
      firePointer(el, 'lostpointercapture', { pointerId: 1 });
      expect(isDown()).toBe(false);
      vi.advanceTimersByTime(HOLD_MS * 2);
      up();
      expect(tap).not.toHaveBeenCalled();
      expect(hold).not.toHaveBeenCalled();
    });
  });

  describe('不响应的情形', () => {
    it('元素 disabled 时按下不响应：没有 down 类、不 tap、不 hold', () => {
      bindPress(asEl(), { tap, hold });
      (el as unknown as { disabled: boolean }).disabled = true;
      down();
      expect(isDown()).toBe(false);
      vi.advanceTimersByTime(HOLD_MS * 2);
      up();
      expect(tap).not.toHaveBeenCalled();
      expect(hold).not.toHaveBeenCalled();
    });

    it('非左键（button ≠ 0）按下不响应', () => {
      bindPress(asEl(), { tap, hold });
      for (const b of [1, 2]) {
        down(50, 50, 1, b);
        expect(isDown()).toBe(false);
        vi.advanceTimersByTime(HOLD_MS * 2);
        up();
      }
      expect(tap).not.toHaveBeenCalled();
      expect(hold).not.toHaveBeenCalled();
    });

    it('按着时别的 pointerId 的 move、up、cancel 不影响它', () => {
      bindPress(asEl(), { tap, hold });
      down(50, 50, 1);
      move(500, 500, 2);
      expect(isDown()).toBe(true);
      up(2);
      expect(tap).not.toHaveBeenCalled();
      expect(isDown()).toBe(true);
      firePointer(el, 'pointercancel', { pointerId: 2 });
      firePointer(el, 'lostpointercapture', { pointerId: 2 });
      expect(isDown()).toBe(true);
      up(1);
      expect(tap).toHaveBeenCalledTimes(1);
    });

    it('按着时别的手指的 up 也不打断长按计时', () => {
      bindPress(asEl(), { tap, hold });
      down(50, 50, 1);
      up(2);
      vi.advanceTimersByTime(HOLD_MS);
      expect(hold).toHaveBeenCalledTimes(1);
      expect(tap).not.toHaveBeenCalled();
    });

    it('按着时第二根手指按下不重新开始：长按计时不重置，抬起各自按 pointerId 认', () => {
      bindPress(asEl(), { tap, hold });
      down(50, 50, 1);
      vi.advanceTimersByTime(HOLD_MS - 100);
      down(50, 50, 2);
      expect(el.captureCalls).toEqual([1]);
      vi.advanceTimersByTime(100);
      expect(hold).toHaveBeenCalledTimes(1);
    });

    it('第二根手指按下后第一根抬起照常 tap，第二根的抬起不再 tap', () => {
      bindPress(asEl(), { tap });
      down(50, 50, 1);
      down(50, 50, 2);
      up(1);
      expect(tap).toHaveBeenCalledTimes(1);
      up(2);
      expect(tap).toHaveBeenCalledTimes(1);
    });
  });

  describe('键盘与读屏的激活（click）', () => {
    it('detail 为 0 的 click（Enter / 空格 / 读屏激活）调一次 tap', () => {
      bindPress(asEl(), { tap, hold });
      click(0);
      expect(tap).toHaveBeenCalledTimes(1);
      expect(hold).not.toHaveBeenCalled();
    });

    it('没给 hold 时同样 tap', () => {
      bindPress(asEl(), { tap });
      click(0);
      expect(tap).toHaveBeenCalledTimes(1);
    });

    it('detail ≥ 1 的 click（手指 / 鼠标点出来的）不调 tap，免得与 pointer 事件重复', () => {
      bindPress(asEl(), { tap, hold });
      click(1);
      click(2);
      expect(tap).not.toHaveBeenCalled();
    });

    it('一次手指点按：pointer 事件调一次 tap，随后浏览器补发的 click（detail 为 1）不再调', () => {
      bindPress(asEl(), { tap });
      down(); up();
      click(1);
      expect(tap).toHaveBeenCalledTimes(1);
    });

    it('元素 disabled 时 detail 为 0 的 click 不调 tap', () => {
      bindPress(asEl(), { tap });
      (el as unknown as { disabled: boolean }).disabled = true;
      click(0);
      expect(tap).not.toHaveBeenCalled();
    });
  });

  describe('contextmenu', () => {
    it('contextmenu 被 preventDefault（触屏长按弹系统菜单）', () => {
      bindPress(asEl(), { tap, hold });
      const e = firePointer(el, 'contextmenu');
      expect(e.defaultPrevented).toBe(true);
    });
  });

  describe('解除绑定', () => {
    it('解除后的事件不再触发回调、不再加 down 类', () => {
      const off = bindPress(asEl(), { tap, hold });
      off();
      down();
      expect(isDown()).toBe(false);
      vi.advanceTimersByTime(HOLD_MS * 2);
      up();
      expect(tap).not.toHaveBeenCalled();
      expect(hold).not.toHaveBeenCalled();
    });

    it('正按着时解除：去掉 down，抬起不 tap，长按计时作废不调 hold', () => {
      const off = bindPress(asEl(), { tap, hold });
      down();
      off();
      expect(isDown()).toBe(false);
      vi.advanceTimersByTime(HOLD_MS * 2);
      up();
      expect(tap).not.toHaveBeenCalled();
      expect(hold).not.toHaveBeenCalled();
    });

    it('解除后 click 与 contextmenu 的监听也摘掉：键盘激活不再 tap，菜单不再被拦', () => {
      const off = bindPress(asEl(), { tap, hold });
      off();
      click(0);
      expect(tap).not.toHaveBeenCalled();
      expect(firePointer(el, 'contextmenu').defaultPrevented).toBe(false);
    });

    it('解除只摘自己绑的：重复调用不报错', () => {
      const off = bindPress(asEl(), { tap });
      off();
      expect(() => off()).not.toThrow();
    });
  });
});
