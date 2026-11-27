import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TAP_SLOP } from '../../src/touchInput';
import { ZoomSlider } from '../../src/ui/zoomSlider';
import { FakeCanvas, FakeEl, firePointer, installFakeDom, rectOf } from './fakeDom';

/** 假 DOM 的 innerHTML 只认不带属性、不嵌套的标签：缩放条的标记（带属性、嵌套）在这里按标签与 class 解析成子节点 */
class MarkupEl extends FakeEl {
  override get innerHTML(): string { return super.innerHTML; }
  override set innerHTML(v: string) {
    super.innerHTML = v;
    const stack: FakeEl[] = [this];
    for (const m of v.matchAll(/<(\/?)(\w+)([^>]*)>|([^<]+)/g)) {
      const top = stack[stack.length - 1];
      if (m[4] !== undefined) {
        top.textContent += m[4];
      } else if (m[1]) {
        stack.pop();
      } else {
        const c = new MarkupEl(m[2]);
        c.className = /class="([^"]*)"/.exec(m[3])?.[1] ?? '';
        top.appendChild(c);
        stack.push(c);
      }
    }
  }
}

/*
 * 横着的缩放条：.zoom 横向 [0, 240]，− 在左（x < 40）、+ 在右（x > 200），中间 .ztrack 横向 [40, 200]（宽 160），滑块宽 40。
 * 滑块中心能走的范围是 x ∈ [60, 180]：手指在 60 是 0（最远）、在 180 是 1（最近）、在 120 是 0.5。
 */
describe('ZoomSlider 横向缩放条', () => {
  let onChange: ReturnType<typeof vi.fn>;
  let zs: ZoomSlider;
  let root: FakeEl, track: FakeEl, thumb: FakeEl;
  const STEP = 0.125;
  const xOf = (f: number): number => 60 + f * 120;
  const down = (x: number, y = 20, id = 1, button = 0): Event => firePointer(root, 'pointerdown', { clientX: x, clientY: y, pointerId: id, button, buttons: 1 });
  const move = (x: number, y = 20, id = 1): Event => firePointer(root, 'pointermove', { clientX: x, clientY: y, pointerId: id, buttons: 1 });
  const up = (id = 1): Event => firePointer(root, 'pointerup', { pointerId: id });
  const key = (k: string): { e: Event; stopped: boolean } => {
    const e = new Event('keydown', { cancelable: true });
    Object.defineProperty(e, 'key', { value: k });
    const stop = vi.spyOn(e, 'stopPropagation');
    root.dispatchEvent(e);
    return { e, stopped: stop.mock.calls.length > 0 };
  };
  const fVar = (): number => Number(track.style.getPropertyValue('--f'));
  const last = (): number => onChange.mock.calls.at(-1)![0] as number;

  beforeEach(() => {
    vi.useFakeTimers();
    installFakeDom(vi);
    vi.stubGlobal('document', {
      createElement: (tag: string) => (tag === 'canvas' ? new FakeCanvas() : new MarkupEl(tag)),
      elementFromPoint: () => null,
    });
    onChange = vi.fn();
    zs = new ZoomSlider(onChange);
    root = zs.el as unknown as FakeEl;
    root.rect = rectOf(0, 0, 240, 40);
    track = root.querySelector('.ztrack')!;
    track.rect = rectOf(40, 0, 160, 40);
    thumb = track.children[0];
    thumb.offsetWidth = 40;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  describe('结构', () => {
    it('.zoom 本身是 slider：横向、0～100、可 Tab 聚焦', () => {
      expect(root.className).toBe('zoom');
      expect(root.attrs.role).toBe('slider');
      expect(root.attrs['aria-orientation']).toBe('horizontal');
      expect(root.attrs['aria-valuemin']).toBe('0');
      expect(root.attrs['aria-valuemax']).toBe('100');
      expect((root as unknown as { tabIndex: number }).tabIndex).toBe(0);
    });

    it('里面依次是 <b>−</b>、.ztrack（含 <i> 滑块）、<b>+</b>', () => {
      expect(root.children).toHaveLength(3);
      expect(root.children[0].tagName).toBe('b');
      expect(root.children[0].textContent).toBe('−');
      expect(root.children[1]).toBe(track);
      expect(track.children).toHaveLength(1);
      expect(thumb.tagName).toBe('i');
      expect(root.children[2].tagName).toBe('b');
      expect(root.children[2].textContent).toBe('+');
    });
  });

  describe('在长条上按下与拖动', () => {
    it('按下立即按手指 x 定位置并回调：滑块中心对手指，左端 0、右端 1、中点 0.5', () => {
      down(xOf(0.5));
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(last()).toBeCloseTo(0.5);
      up();
      down(xOf(0.25));
      expect(last()).toBeCloseTo(0.25);
      up();
      down(xOf(1));
      expect(last()).toBeCloseTo(1);
      up();
      down(xOf(0));
      expect(last()).toBeCloseTo(0);
    });

    it('超出滑块中心能走的范围（含长条两端的边缘）夹到 0～1', () => {
      down(45);
      expect(last()).toBe(0);
      up();
      down(40);
      expect(last()).toBe(0);
      up();
      down(199);
      expect(last()).toBe(1);
      up();
      down(200);
      expect(last()).toBe(1);
    });

    it('按住拖动：每次移动按手指的 x 回调，竖向位置无关', () => {
      down(xOf(0.5));
      onChange.mockClear();
      move(xOf(0.25), 500);
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(last()).toBeCloseTo(0.25);
      move(xOf(0.9), -300);
      expect(last()).toBeCloseTo(0.9);
      move(0);
      expect(last()).toBe(0);
      move(1000);
      expect(last()).toBe(1);
    });

    it('拖出长条范围（到 − / + 那端）也继续按 x 定位置，抬起不再多一次回调', () => {
      down(xOf(0.5));
      move(10);
      expect(last()).toBe(0);
      onChange.mockClear();
      up();
      expect(onChange).not.toHaveBeenCalled();
    });

    it('track 宽不大于滑块宽时不改值，也不回调', () => {
      zs.sync(0.3);
      track.rect = rectOf(40, 0, 40, 40);
      down(60);
      move(70);
      expect(onChange).not.toHaveBeenCalled();
      expect(fVar()).toBeCloseTo(0.3);
      up();
      track.rect = rectOf(40, 0, 20, 40);
      down(50);
      expect(onChange).not.toHaveBeenCalled();
    });

    it('换算按 track 与滑块的实际宽度：宽 260 的条上中点仍是 0.5', () => {
      track.rect = rectOf(40, 0, 260, 40);
      down(40 + 20 + 0.5 * 220);
      expect(last()).toBeCloseTo(0.5);
    });

    it('松手后再移动不改位置、不回调', () => {
      down(xOf(0.5));
      up();
      onChange.mockClear();
      move(xOf(0.1));
      expect(onChange).not.toHaveBeenCalled();
      expect(fVar()).toBeCloseTo(0.5);
    });

    it('位置写在 track 的 --f 与 .zoom 的 aria-valuenow（0～100 取整）', () => {
      down(xOf(0.5));
      expect(fVar()).toBeCloseTo(0.5);
      expect(root.attrs['aria-valuenow']).toBe('50');
      move(xOf(0.333));
      expect(root.attrs['aria-valuenow']).toBe('33');
      move(xOf(0.666));
      expect(root.attrs['aria-valuenow']).toBe('67');
      move(xOf(1));
      expect(root.attrs['aria-valuenow']).toBe('100');
      move(xOf(0));
      expect(root.attrs['aria-valuenow']).toBe('0');
      expect(fVar()).toBeCloseTo(0);
    });
  });

  describe('点 − / +（长条两端）', () => {
    it('在左边（− 那端）按下后抬起：−0.125 并回调；在右边（+ 那端）：+0.125', () => {
      zs.sync(0.5);
      down(20);
      expect(onChange).not.toHaveBeenCalled();
      up();
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(last()).toBeCloseTo(0.5 - STEP);
      down(220);
      up();
      expect(onChange).toHaveBeenCalledTimes(2);
      expect(last()).toBeCloseTo(0.5);
    });

    it('点在标记本身上（最外沿）同样有效', () => {
      zs.sync(0.5);
      down(1);
      up();
      expect(last()).toBeCloseTo(0.5 - STEP);
      down(239);
      up();
      expect(last()).toBeCloseTo(0.5);
    });

    it('夹在 0～1，到头后再点仍回调端点值', () => {
      zs.sync(0.95);
      down(220);
      up();
      expect(last()).toBe(1);
      down(220);
      up();
      expect(last()).toBe(1);
      zs.sync(0.05);
      down(20);
      up();
      expect(last()).toBe(0);
      expect(fVar()).toBe(0);
    });

    it('点之后位置与 --f、aria-valuenow 跟着变', () => {
      zs.sync(0.5);
      down(220);
      up();
      expect(fVar()).toBeCloseTo(0.625);
      expect(root.attrs['aria-valuenow']).toBe('63');
    });

    it('手指没滑开超过 TAP_SLOP（含刚好等于）仍算点', () => {
      zs.sync(0.5);
      down(220);
      move(220 + TAP_SLOP);
      up();
      expect(last()).toBeCloseTo(0.5 + STEP);
      down(20, 20);
      move(20, 20 + TAP_SLOP);
      up();
      expect(last()).toBeCloseTo(0.5);
    });

    it('滑开超过 TAP_SLOP（横向、竖向或斜着）后抬起不算点，也不拖动（移动时不回调）', () => {
      zs.sync(0.5);
      for (const [x, y] of [[220 + TAP_SLOP + 1, 20], [220, 20 + TAP_SLOP + 1], [220 + 9, 20 + 9]]) {
        down(220, 20);
        move(x, y);
        move(xOf(0.9), y);
        up();
      }
      expect(onChange).not.toHaveBeenCalled();
      expect(fVar()).toBeCloseTo(0.5);
    });

    it('滑开后手指回到按下处再抬起也不算点', () => {
      zs.sync(0.5);
      down(20);
      move(20, 60);
      move(20, 20);
      up();
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe('按压的管理', () => {
    const minusEl = (): FakeEl => root.children[0];
    const plusEl = (): FakeEl => root.children[2];
    const lit = (): { on: boolean; minus: boolean; plus: boolean } => ({
      on: root.classList.contains('on'), minus: minusEl().classList.contains('down'), plus: plusEl().classList.contains('down'),
    });

    it('在长条上按下：.zoom 带 on，两端的 <b> 不带 down；抬起都去掉', () => {
      down(xOf(0.5));
      expect(lit()).toEqual({ on: true, minus: false, plus: false });
      up();
      expect(lit()).toEqual({ on: false, minus: false, plus: false });
    });

    it('在左端（−）按下：.zoom 不带 on，− 那端带 down；抬起去掉', () => {
      down(20);
      expect(lit()).toEqual({ on: false, minus: true, plus: false });
      up();
      expect(lit()).toEqual({ on: false, minus: false, plus: false });
    });

    it('在右端（+）按下：.zoom 不带 on，+ 那端带 down；抬起去掉', () => {
      down(220);
      expect(lit()).toEqual({ on: false, minus: false, plus: true });
      up();
      expect(lit()).toEqual({ on: false, minus: false, plus: false });
    });

    it('端点按下后手指滑开超过 TAP_SLOP：down 立即去掉（这一下作废）；没超过时保持', () => {
      down(220);
      move(220 + TAP_SLOP);
      expect(lit().plus).toBe(true);
      move(220 + TAP_SLOP + 1);
      expect(lit()).toEqual({ on: false, minus: false, plus: false });
      up();
      expect(onChange).not.toHaveBeenCalled();
      down(20);
      move(20, 20 + TAP_SLOP + 1);
      expect(lit().minus).toBe(false);
      up();
    });

    it('cancel 与 lostpointercapture 清掉 on 与两端的 down', () => {
      for (const type of ['pointercancel', 'lostpointercapture']) {
        for (const x of [xOf(0.5), 20, 220]) {
          down(x);
          firePointer(root, type, { pointerId: 1 });
          expect(lit(), `${type} x=${x}`).toEqual({ on: false, minus: false, plus: false });
        }
      }
    });

    it('按下时捕获这根指针，按下时阻止默认行为', () => {
      const e = down(xOf(0.5), 20, 5);
      expect(root.captured).toBe(5);
      expect(e.defaultPrevented).toBe(true);
    });

    it('pointercancel 与 lostpointercapture 结束按压：on 类去掉，点 − / + 不算点，拖动不再继续，之后可以再按', () => {
      zs.sync(0.5);
      for (const type of ['pointercancel', 'lostpointercapture']) {
        down(220);
        firePointer(root, type, { pointerId: 1 });
        expect(root.classList.contains('on'), type).toBe(false);
        up();
        expect(onChange, type).not.toHaveBeenCalled();
        down(xOf(0.5));
        onChange.mockClear();
        firePointer(root, type, { pointerId: 1 });
        move(xOf(0.1));
        expect(onChange, type).not.toHaveBeenCalled();
      }
      zs.sync(0.5);
      down(220);
      up();
      expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('只认主键：右键按下不理', () => {
      down(220, 20, 1, 2);
      expect(root.classList.contains('on')).toBe(false);
      up();
      expect(onChange).not.toHaveBeenCalled();
    });

    it('同时只认一根手指：按着时别的手指的按下、移动、抬起都不理', () => {
      down(xOf(0.5), 20, 1);
      onChange.mockClear();
      down(xOf(0.9), 20, 2);
      move(xOf(0.1), 20, 2);
      up(2);
      expect(onChange).not.toHaveBeenCalled();
      expect(root.classList.contains('on')).toBe(true);
      move(xOf(0.75), 20, 1);
      expect(last()).toBeCloseTo(0.75);
      up(1);
      expect(root.classList.contains('on')).toBe(false);
    });

    it('点 − / + 时别的手指的抬起不算这次的点', () => {
      zs.sync(0.5);
      down(220, 20, 1);
      up(2);
      expect(onChange).not.toHaveBeenCalled();
      up(1);
      expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('没有按下过的移动、抬起不回调', () => {
      move(100);
      up();
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe('release：放掉正按着的手指', () => {
    const lit = (): { on: boolean; minus: boolean; plus: boolean } => ({
      on: root.classList.contains('on'), minus: root.children[0].classList.contains('down'), plus: root.children[2].classList.contains('down'),
    });

    it('拖长条中途 release：去掉 on；之后的 move / up 不再改值、不回调', () => {
      down(xOf(0.5));
      onChange.mockClear();
      const before = fVar();
      zs.release();
      expect(lit()).toEqual({ on: false, minus: false, plus: false });
      move(xOf(0.9));
      up();
      expect(onChange).not.toHaveBeenCalled();
      expect(fVar()).toBe(before);
    });

    it('按着 − / + 时 release：去掉 down；抬起也不再点一档', () => {
      down(20);
      zs.release();
      expect(lit()).toEqual({ on: false, minus: false, plus: false });
      up();
      expect(onChange).not.toHaveBeenCalled();
      down(220);
      zs.release();
      expect(lit()).toEqual({ on: false, minus: false, plus: false });
      up();
      expect(onChange).not.toHaveBeenCalled();
    });

    it('release 本身不回调 onChange、不改位置', () => {
      down(xOf(0.5));
      onChange.mockClear();
      const before = fVar();
      zs.release();
      expect(onChange).not.toHaveBeenCalled();
      expect(fVar()).toBe(before);
    });

    it('没按着时 release 什么也不做：不回调、不改位置、不改状态', () => {
      const before = fVar();
      zs.release();
      expect(onChange).not.toHaveBeenCalled();
      expect(fVar()).toBe(before);
      expect(lit()).toEqual({ on: false, minus: false, plus: false });
    });

    it('release 之后可以重新按下并正常拖', () => {
      down(xOf(0.5));
      zs.release();
      down(xOf(0.25), 20, 2);
      expect(last()).toBeCloseTo(0.25);
      expect(lit().on).toBe(true);
    });
  });

  describe('键盘（事件挂在 .zoom 上）', () => {
    it('ArrowUp / ArrowRight +0.125，ArrowDown / ArrowLeft −0.125，并回调', () => {
      zs.sync(0.5);
      key('ArrowUp');
      expect(last()).toBeCloseTo(0.625);
      key('ArrowRight');
      expect(last()).toBeCloseTo(0.75);
      key('ArrowDown');
      expect(last()).toBeCloseTo(0.625);
      key('ArrowLeft');
      expect(last()).toBeCloseTo(0.5);
      expect(onChange).toHaveBeenCalledTimes(4);
    });

    it('方向键阻止事件传播与默认行为', () => {
      zs.sync(0.5);
      for (const k of ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft']) {
        const r = key(k);
        expect(r.stopped, k).toBe(true);
        expect(r.e.defaultPrevented, k).toBe(true);
      }
    });

    it('夹在 0～1', () => {
      zs.sync(0.95);
      key('ArrowUp');
      expect(last()).toBe(1);
      zs.sync(0.05);
      key('ArrowDown');
      expect(last()).toBe(0);
    });

    it('别的键不改位置、不回调', () => {
      zs.sync(0.5);
      key('a');
      key('Enter');
      expect(onChange).not.toHaveBeenCalled();
      expect(fVar()).toBeCloseTo(0.5);
    });
  });

  describe('sync', () => {
    it('把滑块同步到 f（track 的 --f 与 .zoom 的 aria-valuenow），不回调 onChange', () => {
      zs.sync(0.4);
      expect(fVar()).toBeCloseTo(0.4);
      expect(root.attrs['aria-valuenow']).toBe('40');
      zs.sync(1);
      expect(fVar()).toBe(1);
      expect(root.attrs['aria-valuenow']).toBe('100');
      expect(onChange).not.toHaveBeenCalled();
    });

    it('手指按着（拖动或点 − / + 都算）不改位置；松手后又能同步', () => {
      down(xOf(0.5));
      zs.sync(0.9);
      expect(fVar()).toBeCloseTo(0.5);
      move(xOf(0.3));
      zs.sync(0.9);
      expect(fVar()).toBeCloseTo(0.3);
      up();
      zs.sync(0.9);
      expect(fVar()).toBeCloseTo(0.9);
      down(220);
      zs.sync(0.2);
      expect(fVar()).toBeCloseTo(0.9);
      up();
    });

    it('取消按压后也能同步', () => {
      down(xOf(0.5));
      firePointer(root, 'pointercancel', { pointerId: 1 });
      zs.sync(0.7);
      expect(fVar()).toBeCloseTo(0.7);
    });

    it('同步之后点 − / + 从同步的位置起算', () => {
      zs.sync(0.2);
      down(220);
      up();
      expect(last()).toBeCloseTo(0.2 + STEP);
    });
  });
});
