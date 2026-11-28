/** 桌面和移动版共用的编队卡片。保留卡片元素，刷新部队状态时不丢键盘焦点。 */
import { UNITS } from '../sim/defs';
import type { World } from '../sim/world';
import { compactNum } from './unitText';

/** 常驻可编队的队号从 1 到 8，已有队员的 9 和 0 也会显示。 */
export const GROUP_SLOTS = 8;

interface GroupCard {
  number: number;
  button: HTMLButtonElement;
  image: HTMLImageElement;
  name: HTMLElement;
  count: HTMLElement;
  health: HTMLElement;
}

export class GroupSlots {
  readonly el: HTMLDivElement;
  private readonly cards: GroupCard[] = [];
  private groups: { g: number; slots: number[] }[] = [];
  private readonly unbind: (() => void)[] = [];
  private scrollable = false;

  constructor(private readonly world: World, private readonly portrait: (type: number) => string,
    activate: (g: number, occupied: boolean) => void) {
    this.el = document.createElement('div');
    this.el.className = 'groupslots';
    // 窄屏桌面版这一排横向滚动（样式表按窗口宽度定）：滚轮的主导轴滚动换成横向。
    // 不锁定鼠标时浏览器不会这样做；锁定时 pointerLock 合成的 wheel 也派发到这里，它只替纵向可滚的祖先滚
    const wheel = (e: WheelEvent): void => {
      const el = this.el;
      // 触控板捏合（ctrlKey）是缩放手势，不横滚
      if (e.ctrlKey || el.scrollWidth <= el.clientWidth) return;
      // 取主导轴：鼠标滚轮是纵向，触控板横扫是 deltaX
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (!d) return;
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientWidth : 1;
      el.scrollLeft += d * unit;
      e.preventDefault();
    };
    this.el.addEventListener('wheel', wheel, { passive: false });
    this.unbind.push(() => this.el.removeEventListener('wheel', wheel));
    // 只在溢出时接鼠标（样式表的 .scroll）：滚动条能拖，没溢出时卡片之间的空隙仍是画面
    if (typeof ResizeObserver !== 'undefined') {
      const watch = new ResizeObserver(() => this.syncScrollable());
      watch.observe(this.el);
      this.unbind.push(() => watch.disconnect());
    }
    for (const number of [...Array.from({ length: GROUP_SLOTS }, (_, i) => i + 1), 9, 0]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ucard gcard slot';
      button.dataset.g = String(number);
      button.hidden = number === 0 || number > GROUP_SLOTS;
      button.setAttribute('aria-label', `编为第 ${number} 队`);

      const tag = document.createElement('b');
      tag.className = 'gno';
      tag.textContent = String(number);
      const image = document.createElement('img');
      image.alt = '';
      image.draggable = false;
      const count = document.createElement('span');
      count.className = 'n';
      const name = document.createElement('span');
      name.className = 'nm';
      const bar = document.createElement('span');
      bar.className = 'hp';
      const health = document.createElement('u');
      bar.appendChild(health);
      button.append(tag, image, count, name, bar);

      // 指针由卡片带处理，原生按钮的 click 给键盘和读屏使用。
      const click = (e: MouseEvent): void => {
        if (e.detail === 0) activate(number, button.classList.contains('has'));
      };
      button.addEventListener('click', click);
      this.unbind.push(() => button.removeEventListener('click', click));
      this.cards.push({ number, button, image, name, count, health });
      this.el.appendChild(button);
    }
  }

  setGroups(groups: { g: number; slots: number[] }[]): void {
    this.groups = groups;
  }

  update(sel: number[]): void {
    const picked = new Set(sel);
    for (const card of this.cards) {
      const { number, button, image, count, name, health } = card;
      const slots = this.groups.find(group => group.g === number)?.slots;
      const size = slots?.length ?? 0;
      const hidden = !size && (number === 0 || number > GROUP_SLOTS);
      if (button.hidden !== hidden) button.hidden = hidden;
      const on = slots?.length ? slots.every(slot => picked.has(slot)) : false;
      button.classList.toggle('has', !!size);
      button.classList.toggle('on', on);
      // 激活只是选队并跳转、不切换，所以选中态写进名称，不用 aria-pressed
      const label = size ? `第 ${number} 队，${size} 人${on ? '，已选中' : ''}` : `编为第 ${number} 队`;
      if (button.getAttribute('aria-label') !== label) button.setAttribute('aria-label', label);
      if (!slots?.length) continue;

      const types = new Map<number, number>();
      let totalHp = 0;
      for (const slot of slots) {
        const type = this.world.type[slot];
        types.set(type, (types.get(type) ?? 0) + 1);
        totalHp += this.world.hp[slot] / this.world.maxHp[slot];
      }
      const [[main]] = [...types].sort((a, b) => b[1] - a[1] || UNITS[a[0]].row - UNITS[b[0]].row);
      const url = this.portrait(main), title = UNITS[main].name + (types.size > 1 ? ' 等' : '');
      const amount = compactNum(size), width = `${Math.round(totalHp / size * 100)}%`;
      if (image.getAttribute('src') !== url) image.setAttribute('src', url);
      if (name.textContent !== title) name.textContent = title;
      if (count.textContent !== amount) count.textContent = amount;
      if (health.style.width !== width) health.style.width = width;
    }
  }

  private syncScrollable(): void {
    const on = this.el.scrollWidth > this.el.clientWidth;
    if (on === this.scrollable) return;
    this.scrollable = on;
    this.el.classList.toggle('scroll', on);
  }

  destroy(): void {
    for (const f of this.unbind) f();
  }
}
