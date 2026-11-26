/**
 * 移动版下半屏的一排控制按钮：编队 1～5 与「取消选择」，补手机上没有键盘的那几样操作。
 * 按钮自己用 pointer 事件处理手指（见 bindPress），不靠 click。
 */
import { bindPress } from './pressable';

/** 放几个编队按钮（队号 1 起） */
const GROUP_SLOTS = 5;

export interface ControlRowCallbacks {
  /**
   * 编队按钮（队号 g）：assign 为 true 是长按，把所选部队编为这一队；
   * 否则是点一下，选中这一队（这一队没人时把所选部队编进去）
   */
  groupSlot(g: number, assign: boolean): void;
  /** 点了「取消选择」 */
  deselect(): void;
}

export class ControlRow {
  readonly el: HTMLDivElement;
  /** 编队按钮，下标 + 1 是队号 */
  private readonly slots: HTMLButtonElement[] = [];
  private readonly desel: HTMLButtonElement;
  private groups: { g: number; slots: number[] }[] = [];
  private readonly unbind: (() => void)[] = [];

  constructor(cb: ControlRowCallbacks) {
    this.el = document.createElement('div');
    this.el.className = 'ctlrow';
    for (let g = 1; g <= GROUP_SLOTS; g++) {
      const b = document.createElement('button');
      b.className = 'slot';
      b.innerHTML = `<b>${g}</b><i></i>`;
      b.setAttribute('aria-label', `第 ${g} 队`);
      this.unbind.push(bindPress(b, { tap: () => cb.groupSlot(g, false), hold: () => cb.groupSlot(g, true) }));
      this.slots.push(b);
      this.el.appendChild(b);
    }
    this.desel = document.createElement('button');
    this.desel.className = 'desel';
    this.desel.textContent = '取消选择';
    this.unbind.push(bindPress(this.desel, { tap: () => cb.deselect() }));
    this.el.appendChild(this.desel);
  }

  /** 编队（只含还有活人的）；下一次 update 时画出来 */
  setGroups(groups: { g: number; slots: number[] }[]): void {
    this.groups = groups;
  }

  /** sel：当前选中的单位；canDeselect：有没有可取消的选择（部队或据点）。有人的队写人数，整队都选着时点亮 */
  update(sel: number[], canDeselect: boolean): void {
    if (this.desel.disabled === canDeselect) this.desel.disabled = !canDeselect;
    const picked = new Set(sel);
    this.slots.forEach((b, i) => {
      const grp = this.groups.find(x => x.g === i + 1);
      const n = grp ? String(grp.slots.length) : '';
      const count = b.lastElementChild!;
      if (count.textContent !== n) count.textContent = n;
      b.classList.toggle('has', !!grp);
      b.classList.toggle('on', !!grp && grp.slots.every(s => picked.has(s)));
    });
  }

  destroy(): void {
    for (const f of this.unbind) f();
  }
}
