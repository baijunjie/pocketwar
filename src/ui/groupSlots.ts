/** 移动版的编队卡片。保留每个队号的元素，刷新人数时不丢键盘焦点。 */
import { compactNum } from './unitText';

/** 放几个编队按钮（队号 1 起） */
export const GROUP_SLOTS = 8;

export class GroupSlots {
  readonly el: HTMLDivElement;
  /** 常用的 1～8 队一直可见；切到移动版时也能使用桌面已编好的 9、0 队。 */
  private readonly slots: HTMLButtonElement[] = [];
  private groups: { g: number; slots: number[] }[] = [];
  private readonly unbind: (() => void)[] = [];

  constructor(activate: (g: number, occupied: boolean, picked: boolean) => void) {
    this.el = document.createElement('div');
    this.el.className = 'groupslots';
    for (const g of [...Array.from({ length: GROUP_SLOTS }, (_, i) => i + 1), 9, 0]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ucard slot';
      b.dataset.g = String(g);
      b.hidden = g === 0 || g > GROUP_SLOTS;
      b.innerHTML = `<b>${g}</b><i></i>`;
      b.setAttribute('aria-label', `编为第 ${g} 队`);
      // 指针走卡片的手势处理，键盘和读屏用原生按钮的 click。
      const click = (e: MouseEvent): void => {
        if (e.detail === 0) activate(g, b.classList.contains('has'), b.classList.contains('on'));
      };
      b.addEventListener('click', click);
      this.unbind.push(() => b.removeEventListener('click', click));
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
    this.slots.forEach(b => {
      const g = Number(b.dataset.g);
      const grp = this.groups.find(x => x.g === g);
      const hidden = !grp && (g === 0 || g > GROUP_SLOTS);
      if (b.hidden !== hidden) b.hidden = hidden;
      const n = grp ? compactNum(grp.slots.length) : '';
      const count = b.lastElementChild!;
      if (count.textContent !== n) count.textContent = n;
      const on = !!grp && grp.slots.every(s => picked.has(s));
      b.classList.toggle('has', !!grp);
      b.classList.toggle('on', on);
      const label = grp ? `第 ${g} 队，${grp.slots.length} 人` : `编为第 ${g} 队`;
      if (b.getAttribute('aria-label') !== label) b.setAttribute('aria-label', label);
      const pressed = b.getAttribute('aria-pressed');
      if (grp && pressed !== String(on)) b.setAttribute('aria-pressed', String(on));
      if (!grp && pressed !== null) b.removeAttribute('aria-pressed');
    });
  }

  destroy(): void {
    for (const f of this.unbind) f();
  }
}
