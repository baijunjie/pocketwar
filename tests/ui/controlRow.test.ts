import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOLD_MS } from '../../src/touchInput';
import { ControlRow } from '../../src/ui/controlRow';
import { FakeEl, firePointer, installFakeDom } from './fakeDom';

describe('ControlRow 移动版控制排', () => {
  let groupSlot: ReturnType<typeof vi.fn>;
  let deselect: ReturnType<typeof vi.fn>;
  let row: ControlRow;
  let root: FakeEl;
  const btn = (i: number): FakeEl => root.children[i];
  const slot = (g: number): FakeEl => btn(g - 1);
  const desel = (): FakeEl => btn(5);
  const count = (g: number): string => slot(g).lastElementChild!.textContent;
  const tapOn = (b: FakeEl, id = 1): void => { firePointer(b, 'pointerdown', { pointerId: id }); firePointer(b, 'pointerup', { pointerId: id }); };
  const holdOn = (b: FakeEl, id = 1): void => {
    firePointer(b, 'pointerdown', { pointerId: id });
    vi.advanceTimersByTime(HOLD_MS);
    firePointer(b, 'pointerup', { pointerId: id });
  };

  beforeEach(() => {
    vi.useFakeTimers();
    installFakeDom(vi);
    groupSlot = vi.fn();
    deselect = vi.fn();
    row = new ControlRow({ groupSlot, deselect });
    root = row.el as unknown as FakeEl;
  });

  afterEach(() => {
    row.destroy();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  describe('结构', () => {
    it('el 是 class ctlrow 的一排：5 个编队按钮在前，「取消选择」在最后', () => {
      expect(root.className).toBe('ctlrow');
      expect(root.children).toHaveLength(6);
      for (let g = 1; g <= 5; g++) {
        expect(slot(g).tagName).toBe('button');
        expect(slot(g).className).toBe('slot');
      }
      expect(desel().tagName).toBe('button');
      expect(desel().className).toBe('desel');
      expect(desel().textContent).toBe('取消选择');
    });

    it('编队按钮里是 <b>队号</b><i>人数</i>，aria-label 为「第 N 队」，开始人数为空', () => {
      for (let g = 1; g <= 5; g++) {
        const [b, i] = slot(g).children;
        expect(b.tagName).toBe('b');
        expect(b.textContent).toBe(String(g));
        expect(i.tagName).toBe('i');
        expect(i.textContent).toBe('');
        expect(slot(g).attrs['aria-label']).toBe(`第 ${g} 队`);
      }
    });
  });

  describe('按钮回调', () => {
    it('编队按钮点一下：groupSlot(队号, false)，每个按钮对应自己的队号', () => {
      for (let g = 1; g <= 5; g++) {
        tapOn(slot(g));
        expect(groupSlot).toHaveBeenLastCalledWith(g, false);
      }
      expect(groupSlot).toHaveBeenCalledTimes(5);
      expect(deselect).not.toHaveBeenCalled();
    });

    it('编队按钮长按：groupSlot(队号, true)，长按后抬起不再回调点一下', () => {
      holdOn(slot(3));
      expect(groupSlot).toHaveBeenCalledTimes(1);
      expect(groupSlot).toHaveBeenCalledWith(3, true);
    });

    it('没到长按时间抬起是点一下，不是长按', () => {
      firePointer(slot(2), 'pointerdown');
      vi.advanceTimersByTime(HOLD_MS - 1);
      firePointer(slot(2), 'pointerup');
      vi.advanceTimersByTime(HOLD_MS * 2);
      expect(groupSlot.mock.calls).toEqual([[2, false]]);
    });

    it('「取消选择」点一下回调 deselect()', () => {
      row.update([], true);
      tapOn(desel());
      expect(deselect).toHaveBeenCalledTimes(1);
      expect(groupSlot).not.toHaveBeenCalled();
    });

    it('「取消选择」没有长按：按多久抬起都是 deselect，只调一次', () => {
      row.update([], true);
      firePointer(desel(), 'pointerdown');
      vi.advanceTimersByTime(HOLD_MS * 4);
      firePointer(desel(), 'pointerup');
      expect(deselect).toHaveBeenCalledTimes(1);
    });

    it('destroy() 后按钮不再回调', () => {
      row.update([], true);
      row.destroy();
      tapOn(slot(1));
      holdOn(slot(2));
      tapOn(desel());
      expect(groupSlot).not.toHaveBeenCalled();
      expect(deselect).not.toHaveBeenCalled();
    });
  });

  describe('setGroups 与 update', () => {
    it('setGroups 只记下，update 之前不画', () => {
      row.setGroups([{ g: 1, slots: [10, 11] }]);
      expect(slot(1).classList.contains('has')).toBe(false);
      expect(count(1)).toBe('');
      row.update([], false);
      expect(slot(1).classList.contains('has')).toBe(true);
    });

    it('有人的队带 has 类、人数写 slots.length；没人的队没有 has、人数为空', () => {
      row.setGroups([{ g: 1, slots: [10, 11, 12] }, { g: 4, slots: [20] }]);
      row.update([], false);
      expect(slot(1).classList.contains('has')).toBe(true);
      expect(count(1)).toBe('3');
      expect(slot(4).classList.contains('has')).toBe(true);
      expect(count(4)).toBe('1');
      for (const g of [2, 3, 5]) {
        expect(slot(g).classList.contains('has')).toBe(false);
        expect(count(g)).toBe('');
      }
    });

    it('整队的人都在 sel 里带 on 类；只选了一部分或没选不带', () => {
      row.setGroups([{ g: 1, slots: [10, 11] }, { g: 2, slots: [20, 21] }, { g: 3, slots: [30] }]);
      row.update([10, 11, 20, 99], false);
      expect(slot(1).classList.contains('on')).toBe(true);
      expect(slot(2).classList.contains('on')).toBe(false);
      expect(slot(3).classList.contains('on')).toBe(false);
      row.update([], false);
      expect(slot(1).classList.contains('on')).toBe(false);
    });

    it('没人的队即使 sel 里有人也不带 on', () => {
      row.setGroups([{ g: 1, slots: [10] }]);
      row.update([10, 20], false);
      expect(slot(2).classList.contains('on')).toBe(false);
      expect(slot(5).classList.contains('on')).toBe(false);
    });

    it('选中变化后下一次 update 跟着变：补齐整队后点亮、少了一个熄灭', () => {
      row.setGroups([{ g: 1, slots: [10, 11] }]);
      row.update([10], false);
      expect(slot(1).classList.contains('on')).toBe(false);
      row.update([10, 11], false);
      expect(slot(1).classList.contains('on')).toBe(true);
      row.update([11], false);
      expect(slot(1).classList.contains('on')).toBe(false);
    });

    it('人数变化后下一次 update 更新', () => {
      row.setGroups([{ g: 1, slots: [10, 11, 12] }]);
      row.update([], false);
      row.setGroups([{ g: 1, slots: [10, 11] }]);
      expect(count(1)).toBe('3');
      row.update([], false);
      expect(count(1)).toBe('2');
    });

    it('编队消失（setGroups 里不再有它）后下一次 update 去掉 has / on、清空人数', () => {
      row.setGroups([{ g: 2, slots: [20, 21] }]);
      row.update([20, 21], false);
      expect(slot(2).classList.contains('has')).toBe(true);
      expect(slot(2).classList.contains('on')).toBe(true);
      row.setGroups([]);
      row.update([20, 21], false);
      expect(slot(2).classList.contains('has')).toBe(false);
      expect(slot(2).classList.contains('on')).toBe(false);
      expect(count(2)).toBe('');
    });

    it('队号超出 1～5 的编队不影响这排按钮', () => {
      row.setGroups([{ g: 0, slots: [1] }, { g: 6, slots: [2] }, { g: 9, slots: [3] }]);
      row.update([1, 2, 3], true);
      expect(root.children).toHaveLength(6);
      for (let g = 1; g <= 5; g++) {
        expect(slot(g).classList.contains('has')).toBe(false);
        expect(slot(g).classList.contains('on')).toBe(false);
        expect(count(g)).toBe('');
      }
    });
  });

  describe('canDeselect', () => {
    it('false 时「取消选择」disabled，true 时可用', () => {
      row.update([], false);
      expect(desel().disabled).toBe(true);
      row.update([], true);
      expect(desel().disabled).toBe(false);
      row.update([], false);
      expect(desel().disabled).toBe(true);
    });

    it('disabled 时按它不回调（pointer 点按与键盘激活都不）', () => {
      row.update([], false);
      tapOn(desel());
      const e = new Event('click');
      Object.defineProperty(e, 'detail', { value: 0 });
      desel().dispatchEvent(e);
      expect(deselect).not.toHaveBeenCalled();
    });

    it('canDeselect 为 false 不影响编队按钮', () => {
      row.update([], false);
      tapOn(slot(1));
      expect(groupSlot).toHaveBeenCalledWith(1, false);
    });
  });
});
