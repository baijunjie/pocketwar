import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOLD_MS } from '../../src/touchInput';
import { GroupSlots, GROUP_SLOTS } from '../../src/ui/groupSlots';
import { FakeEl, firePointer, installFakeDom } from './fakeDom';

describe('GroupSlots 移动版编队按钮排', () => {
  let assign: ReturnType<typeof vi.fn>;
  let row: GroupSlots;
  let root: FakeEl;
  const slot = (g: number): FakeEl => root.children[g - 1];
  const count = (g: number): string => slot(g).lastElementChild!.textContent;
  const tapOn = (b: FakeEl, id = 1): void => { firePointer(b, 'pointerdown', { pointerId: id }); firePointer(b, 'pointerup', { pointerId: id }); };

  beforeEach(() => {
    vi.useFakeTimers();
    installFakeDom(vi);
    assign = vi.fn();
    row = new GroupSlots(assign);
    root = row.el as unknown as FakeEl;
  });

  afterEach(() => {
    row.destroy();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  describe('结构', () => {
    it('GROUP_SLOTS 是 8', () => {
      expect(GROUP_SLOTS).toBe(8);
    });

    it('el 是 class slots 的一排：8 个编队按钮，没有别的按钮（没有「取消选择」）', () => {
      expect(root.className).toBe('groupslots');
      expect(root.children).toHaveLength(8);
      for (const b of root.children) {
        expect(b.tagName).toBe('button');
        expect(b.className).toBe('slot');
      }
      expect(root.querySelector('.desel')).toBeNull();
      expect(root.children.some(b => b.textContent === '取消选择')).toBe(false);
    });

    it('编队按钮里是 <b>队号</b><i>人数</i>，aria-label 为「编为第 N 队」，开始人数为空', () => {
      for (let g = 1; g <= 8; g++) {
        const [b, i] = slot(g).children;
        expect(b.tagName).toBe('b');
        expect(b.textContent).toBe(String(g));
        expect(i.tagName).toBe('i');
        expect(i.textContent).toBe('');
        expect(slot(g).attrs['aria-label']).toBe(`编为第 ${g} 队`);
      }
    });
  });

  describe('按钮回调', () => {
    it('点一下回调 assign(队号)，每个按钮对应自己的队号', () => {
      for (let g = 1; g <= 8; g++) {
        tapOn(slot(g));
        expect(assign).toHaveBeenLastCalledWith(g);
      }
      expect(assign).toHaveBeenCalledTimes(8);
    });

    it('点的时候这一队有没有人、选没选中都不影响：照样回调 assign', () => {
      row.setGroups([{ g: 2, slots: [10, 11] }]);
      row.update([10, 11]);
      tapOn(slot(2));
      tapOn(slot(3));
      expect(assign.mock.calls).toEqual([[2], [3]]);
    });

    it('没有长按：按住很久再抬起仍只回调一次，也不会在按住期间回调', () => {
      firePointer(slot(3), 'pointerdown');
      vi.advanceTimersByTime(HOLD_MS * 4);
      expect(assign).not.toHaveBeenCalled();
      firePointer(slot(3), 'pointerup');
      vi.advanceTimersByTime(HOLD_MS * 4);
      expect(assign.mock.calls).toEqual([[3]]);
    });

    it('键盘 / 读屏激活（detail 为 0 的 click）也编队', () => {
      const e = new Event('click');
      Object.defineProperty(e, 'detail', { value: 0 });
      slot(5).dispatchEvent(e);
      expect(assign.mock.calls).toEqual([[5]]);
    });

    it('destroy() 后按钮不再回调', () => {
      row.destroy();
      tapOn(slot(1));
      tapOn(slot(8));
      expect(assign).not.toHaveBeenCalled();
    });
  });

  describe('setGroups 与 update', () => {
    it('setGroups 只记下，update 之前不画', () => {
      row.setGroups([{ g: 1, slots: [10, 11] }]);
      expect(slot(1).classList.contains('has')).toBe(false);
      expect(count(1)).toBe('');
      row.update([]);
      expect(slot(1).classList.contains('has')).toBe(true);
    });

    it('有人的队带 has 类、人数写 slots.length；没人的队没有 has、人数为空；6～8 队同样有效', () => {
      row.setGroups([{ g: 1, slots: [10, 11, 12] }, { g: 4, slots: [20] }, { g: 8, slots: [30, 31] }]);
      row.update([]);
      expect(slot(1).classList.contains('has')).toBe(true);
      expect(count(1)).toBe('3');
      expect(slot(4).classList.contains('has')).toBe(true);
      expect(count(4)).toBe('1');
      expect(slot(8).classList.contains('has')).toBe(true);
      expect(count(8)).toBe('2');
      for (const g of [2, 3, 5, 6, 7]) {
        expect(slot(g).classList.contains('has')).toBe(false);
        expect(count(g)).toBe('');
      }
    });

    it('整队的人都在 sel 里带 on 类；只选了一部分或没选不带', () => {
      row.setGroups([{ g: 1, slots: [10, 11] }, { g: 2, slots: [20, 21] }, { g: 3, slots: [30] }]);
      row.update([10, 11, 20, 99]);
      expect(slot(1).classList.contains('on')).toBe(true);
      expect(slot(2).classList.contains('on')).toBe(false);
      expect(slot(3).classList.contains('on')).toBe(false);
      row.update([]);
      expect(slot(1).classList.contains('on')).toBe(false);
    });

    it('没人的队即使 sel 里有人也不带 on', () => {
      row.setGroups([{ g: 1, slots: [10] }]);
      row.update([10, 20]);
      expect(slot(2).classList.contains('on')).toBe(false);
      expect(slot(8).classList.contains('on')).toBe(false);
    });

    it('选中变化后下一次 update 跟着变：补齐整队后点亮、少了一个熄灭', () => {
      row.setGroups([{ g: 1, slots: [10, 11] }]);
      row.update([10]);
      expect(slot(1).classList.contains('on')).toBe(false);
      row.update([10, 11]);
      expect(slot(1).classList.contains('on')).toBe(true);
      row.update([11]);
      expect(slot(1).classList.contains('on')).toBe(false);
    });

    it('人数上千缩写：1426 人写 1.4k，12999 人写 12k，不到 1000 原样', () => {
      row.setGroups([{ g: 1, slots: Array.from({ length: 1426 }, (_, i) => i) }, { g: 2, slots: Array.from({ length: 999 }, (_, i) => i) }]);
      row.update([]);
      expect(count(1)).toBe('1.4k');
      expect(count(2)).toBe('999');
    });

    it('人数变化后下一次 update 更新', () => {
      row.setGroups([{ g: 1, slots: [10, 11, 12] }]);
      row.update([]);
      row.setGroups([{ g: 1, slots: [10, 11] }]);
      expect(count(1)).toBe('3');
      row.update([]);
      expect(count(1)).toBe('2');
    });

    it('编队消失（setGroups 里不再有它）后下一次 update 去掉 has / on、清空人数', () => {
      row.setGroups([{ g: 2, slots: [20, 21] }]);
      row.update([20, 21]);
      expect(slot(2).classList.contains('has')).toBe(true);
      expect(slot(2).classList.contains('on')).toBe(true);
      row.setGroups([]);
      row.update([20, 21]);
      expect(slot(2).classList.contains('has')).toBe(false);
      expect(slot(2).classList.contains('on')).toBe(false);
      expect(count(2)).toBe('');
    });

    it('队号超出 1～8 的编队不影响这排按钮', () => {
      row.setGroups([{ g: 0, slots: [1] }, { g: 9, slots: [2] }, { g: 12, slots: [3] }]);
      row.update([1, 2, 3]);
      expect(root.children).toHaveLength(8);
      for (let g = 1; g <= 8; g++) {
        expect(slot(g).classList.contains('has')).toBe(false);
        expect(slot(g).classList.contains('on')).toBe(false);
        expect(count(g)).toBe('');
      }
    });
  });
});
