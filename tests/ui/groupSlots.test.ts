import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UNIT_BY_KEY } from '../../src/sim/defs';
import { flatWorld } from '../helpers';
import { GroupSlots, GROUP_SLOTS } from '../../src/ui/groupSlots';
import { FakeEl, installFakeDom } from './fakeDom';

describe('GroupSlots 编队卡片', () => {
  let activate: ReturnType<typeof vi.fn>;
  let row: GroupSlots;
  let root: FakeEl;
  const world = flatWorld(8);
  const slot = (g: number): FakeEl => root.children.find(b => b.dataset.g === String(g))!;
  const visible = (): FakeEl[] => root.children.filter(b => !b.hidden);
  const count = (g: number): string => slot(g).querySelector('.n')!.textContent;
  const click = (g: number, detail = 0): void => {
    const e = new Event('click');
    Object.defineProperty(e, 'detail', { value: detail });
    slot(g).dispatchEvent(e);
  };

  beforeEach(() => {
    installFakeDom(vi);
    activate = vi.fn();
    world.type.fill(UNIT_BY_KEY.dao.idx);
    world.hp.fill(100);
    world.maxHp.fill(100);
    row = new GroupSlots(world, type => `portrait-${type}`, activate);
    root = row.el as unknown as FakeEl;
  });

  afterEach(() => {
    row.destroy();
    vi.unstubAllGlobals();
  });

  describe('结构', () => {
    it('GROUP_SLOTS 是 8', () => {
      expect(GROUP_SLOTS).toBe(8);
    });

    it('默认显示 1～8 队按钮，没有取消选择按钮', () => {
      expect(root.className).toBe('groupslots');
      expect(visible()).toHaveLength(8);
      for (const [index, b] of visible().entries()) {
        expect(b.tagName).toBe('button');
        expect(b.classList.contains('slot')).toBe(true);
        expect(b.dataset.g).toBe(String(index + 1));
      }
      expect(root.querySelector('.desel')).toBeNull();
      expect(root.children.some(b => b.textContent === '取消选择')).toBe(false);
    });

    it('空编队卡片显示队号，读屏提示可编为这一队', () => {
      for (let g = 1; g <= 8; g++) {
        const button = slot(g);
        expect(button.classList.contains('ucard')).toBe(true);
        expect(button.classList.contains('gcard')).toBe(true);
        expect(button.querySelector('.gno')?.textContent).toBe(String(g));
        expect(count(g)).toBe('');
        expect(button.attrs['aria-label']).toBe(`编为第 ${g} 队`);
      }
    });

  });

  describe('横向滚轮', () => {
    const wheel = (init: { deltaX?: number; deltaY?: number; deltaMode?: number; ctrlKey?: boolean }): Event => {
      const e = new Event('wheel', { cancelable: true });
      Object.assign(e, { deltaMode: 0, deltaX: 0, deltaY: 0, ctrlKey: false, ...init });
      root.dispatchEvent(e);
      return e;
    };

    it('横向可滚时把竖向滚轮换成 scrollLeft 并阻止默认行为', () => {
      Object.assign(root, { scrollWidth: 800, clientWidth: 400 });
      const e = wheel({ deltaY: 120 });
      expect(root.scrollLeft).toBe(120);
      expect(e.defaultPrevented).toBe(true);
      wheel({ deltaY: -50 });
      expect(root.scrollLeft).toBe(70);
    });

    it('取主导轴：横扫（deltaX 更大）按 deltaX 滚，两者都是 0 不处理', () => {
      Object.assign(root, { scrollWidth: 800, clientWidth: 400 });
      const e = wheel({ deltaX: -30, deltaY: 5 });
      expect(root.scrollLeft).toBe(-30);
      expect(e.defaultPrevented).toBe(true);
      root.scrollLeft = 0;
      const none = wheel({});
      expect(root.scrollLeft).toBe(0);
      expect(none.defaultPrevented).toBe(false);
    });

    it('触控板捏合（ctrlKey）不横滚、不阻止默认行为', () => {
      Object.assign(root, { scrollWidth: 800, clientWidth: 400 });
      const e = wheel({ deltaY: 120, ctrlKey: true });
      expect(root.scrollLeft).toBe(0);
      expect(e.defaultPrevented).toBe(false);
    });

    it('按 deltaMode 换算：行 = 16px，页 = 容器宽', () => {
      Object.assign(root, { scrollWidth: 800, clientWidth: 400 });
      wheel({ deltaY: 2, deltaMode: 1 });
      expect(root.scrollLeft).toBe(32);
      wheel({ deltaY: 1, deltaMode: 2 });
      expect(root.scrollLeft).toBe(432);
    });

    it('不溢出时不处理，也不阻止默认行为', () => {
      Object.assign(root, { scrollWidth: 400, clientWidth: 400 });
      const e = wheel({ deltaY: 120 });
      expect(root.scrollLeft).toBe(0);
      expect(e.defaultPrevented).toBe(false);
    });

    it('destroy() 后不再处理', () => {
      Object.assign(root, { scrollWidth: 800, clientWidth: 400 });
      row.destroy();
      wheel({ deltaY: 120 });
      expect(root.scrollLeft).toBe(0);
    });
  });

  describe('溢出时接鼠标（scroll 类）', () => {
    it('尺寸变化后按是否溢出切换 scroll 类，destroy() 时停止观察', () => {
      let notify = (): void => {};
      const disconnect = vi.fn();
      vi.stubGlobal('ResizeObserver', class {
        constructor(cb: () => void) { notify = cb; }
        observe(): void {}
        disconnect = disconnect;
      });
      row.destroy();
      row = new GroupSlots(world, type => `portrait-${type}`, activate);
      root = row.el as unknown as FakeEl;
      Object.assign(root, { scrollWidth: 800, clientWidth: 400 });
      notify();
      expect(root.classList.contains('scroll')).toBe(true);
      Object.assign(root, { scrollWidth: 400 });
      notify();
      expect(root.classList.contains('scroll')).toBe(false);
      row.destroy();
      expect(disconnect).toHaveBeenCalledTimes(1);
    });
  });

  describe('按钮回调', () => {
    it('键盘或读屏激活空队时回调队号，状态是未占用', () => {
      for (let g = 1; g <= 8; g++) {
        click(g);
        expect(activate).toHaveBeenLastCalledWith(g, false);
      }
      expect(activate).toHaveBeenCalledTimes(8);
    });

    it('键盘或读屏激活已有队伍时传回占用状态，与是否已选中无关', () => {
      row.setGroups([{ g: 2, slots: [10, 11] }]);
      row.update([]);
      click(2);
      row.update([10, 11]);
      click(2);
      expect(activate.mock.calls).toEqual([[2, true], [2, true]]);
    });

    it('非键盘 click 不重复激活已由指针处理的按钮', () => {
      click(2, 1);
      expect(activate).not.toHaveBeenCalled();
    });

    it('destroy() 后按钮不再回调', () => {
      row.destroy();
      click(1);
      click(8);
      expect(activate).not.toHaveBeenCalled();
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

    it('编队卡片显示人数、主要兵种头像和平均生命比例，并原地更新', () => {
      world.type[11] = UNIT_BY_KEY.nu.idx;
      world.maxHp[11] = 50;
      world.hp[11] = 25;
      const button = slot(1);
      row.setGroups([{ g: 1, slots: [10, 11, 12] }]);
      row.update([]);
      expect(count(1)).toBe('3');
      expect(button.querySelector('img')!.attrs.src).toBe(`portrait-${UNIT_BY_KEY.dao.idx}`);
      expect(button.querySelector('.nm')?.textContent).toBe(`${UNIT_BY_KEY.dao.name} 等`);
      const health = button.querySelector('.hp u')!;
      expect(health.style.width).toBe('83%');

      row.setGroups([{ g: 1, slots: [11] }]);
      row.update([]);
      expect(slot(1)).toBe(button);
      expect(count(1)).toBe('1');
      expect(button.querySelector('img')!.attrs.src).toBe(`portrait-${UNIT_BY_KEY.nu.idx}`);
      expect(button.querySelector('.nm')?.textContent).toBe(UNIT_BY_KEY.nu.name);
      expect(health.style.width).toBe('50%');
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

    it('编队消失后卡片恢复为空队，可再次编队', () => {
      row.setGroups([{ g: 2, slots: [20, 21] }]);
      row.update([20, 21]);
      expect(slot(2).classList.contains('has')).toBe(true);
      expect(slot(2).classList.contains('on')).toBe(true);
      row.setGroups([]);
      row.update([20, 21]);
      expect(slot(2).classList.contains('has')).toBe(false);
      expect(slot(2).classList.contains('on')).toBe(false);
      click(2);
      expect(activate).toHaveBeenCalledExactlyOnceWith(2, false);
    });

    it('更新队伍状态时保留按钮节点，读屏可读到人数与选中状态', () => {
      const original = slot(1);
      row.setGroups([{ g: 1, slots: [10, 11] }]);
      row.update([10, 11]);
      expect(slot(1)).toBe(original);
      expect(original.attrs['aria-label']).toBe('第 1 队，2 人，已选中');
      row.update([10]);
      expect(original.attrs['aria-label']).toBe('第 1 队，2 人');
      row.setGroups([]);
      row.update([]);
      expect(slot(1)).toBe(original);
      expect(original.attrs['aria-label']).toBe('编为第 1 队');
      expect('aria-pressed' in original.attrs).toBe(false);
    });

    it('同一编队状态重复刷新时不重写辅助功能属性', () => {
      const button = slot(1);
      row.setGroups([{ g: 1, slots: [10, 11] }]);
      row.update([10, 11]);
      const writeAttribute = vi.spyOn(button, 'setAttribute');
      row.update([10, 11]);
      expect(writeAttribute).not.toHaveBeenCalled();
      row.update([]);
      expect(writeAttribute).toHaveBeenCalledExactlyOnceWith('aria-label', '第 1 队，2 人');
    });

    it('9 和 0 队有成员时可见且可激活，失去成员后恢复隐藏', () => {
      expect(slot(9).hidden).toBe(true);
      expect(slot(0).hidden).toBe(true);
      row.setGroups([{ g: 9, slots: [10, 11] }, { g: 0, slots: [20] }]);
      row.update([20]);
      expect(visible().map(b => b.dataset.g)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']);
      expect(count(9)).toBe('2');
      expect(count(0)).toBe('1');
      click(9);
      click(0);
      expect(activate.mock.calls).toEqual([[9, true], [0, true]]);

      row.setGroups([{ g: 0, slots: [20] }]);
      row.update([20]);
      expect(slot(9).hidden).toBe(true);
      expect(slot(0).hidden).toBe(false);
      row.setGroups([]);
      row.update([]);
      expect(slot(0).hidden).toBe(true);
      expect(visible()).toHaveLength(8);
    });

    it('不支持的队号不会新增按钮', () => {
      row.setGroups([{ g: 12, slots: [3] }]);
      row.update([3]);
      expect(visible()).toHaveLength(8);
      expect(root.children.some(b => b.dataset.g === '12')).toBe(false);
    });
  });
});
