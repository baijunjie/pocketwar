/**
 * 移动版下半屏的一排编队按钮 1～8，补手机上没有键盘的编队（桌面版 Ctrl+数字）。按钮只管编队，选中一队靠卡片带里的编队卡片。
 * 按钮自己用 pointer 事件处理手指（见 bindPress），不靠 click。
 */
import { bindPress } from './pressable';
import { compactNum } from './unitText';

/** 放几个编队按钮（队号 1 起） */
export const GROUP_SLOTS = 8;

export class GroupSlots {
  readonly el: HTMLDivElement;
  /** 编队按钮，下标 + 1 是队号 */
  private readonly slots: HTMLButtonElement[] = [];
  private groups: { g: number; slots: number[] }[] = [];
  private readonly unbind: (() => void)[] = [];

  /** assign：点了第 g 队的按钮，把所选部队编为这一队 */
  constructor(assign: (g: number) => void) {
    this.el = document.createElement('div');
    this.el.className = 'groupslots';
    for (let g = 1; g <= GROUP_SLOTS; g++) {
      const b = document.createElement('button');
      b.className = 'slot';
      b.innerHTML = `<b>${g}</b><i></i>`;
      b.setAttribute('aria-label', `编为第 ${g} 队`);
      this.unbind.push(bindPress(b, { tap: () => assign(g) }));
      this.slots.push(b);
      this.el.appendChild(b);
    }
  }

  /** 编队（只含还有活人的）；下一次 update 时画出来 */
  setGroups(groups: { g: number; slots: number[] }[]): void {
    this.groups = groups;
  }

  /** sel：当前选中的单位。有人的队在队号下面写人数（上千缩写），整队都选着时点亮 */
  update(sel: number[]): void {
    const picked = new Set(sel);
    this.slots.forEach((b, i) => {
      const grp = this.groups.find(x => x.g === i + 1);
      const n = grp ? compactNum(grp.slots.length) : '';
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
