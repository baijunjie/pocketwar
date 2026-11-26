/**
 * 底部的卡片：兵种卡片（屏幕内以及已选中的每个己方兵种一张）与其上方一排编队卡片（每个还有活人的编队一张）。
 * 卡片直接浮在画面底部、不包外框，卡片之间的空隙就是画面：从画面上拉的框扫到卡片时，game 用 `cardsIn` 把这些兵种 / 编队并进框选。
 * 点击选择；按住拖动时卡片缩小跟在鼠标右下方，松在地面或小地图上就让这批人攻击移动过去。
 */
import { LEVELS, UNITS } from '../sim/defs';
import { World } from '../sim/world';
import { unitTip } from './unitText';

export interface CardBarCallbacks {
  /** 点兵种卡片：replace = 改选屏幕内这个兵种；toggle = 选着就去掉、没选就加上；map = 选中全图的这个兵种（双击） */
  pickTypes(types: number[], mode: 'replace' | 'toggle' | 'map'): void;
  /** 点编队卡片：选中这一队；jump = 双击，镜头再跳到这队 */
  selectGroup(g: number, jump: boolean): void;
  /** 把兵种卡片 / 编队卡片拖到地面（view）或小地图（mini）上松开：这批人攻击移动到松开处（clientX / clientY） */
  dropCard(kind: 'type' | 'group', id: number, x: number, y: number, target: 'view' | 'mini'): void;
}

export interface Rect {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  return e;
}

export class CardBar {
  readonly groupRow: HTMLDivElement;
  readonly roster: HTMLDivElement;
  private rosterKey = '?';
  private groupKey = '?';
  private groups: { g: number; slots: number[] }[] = [];
  /** 按住一张卡片期间（还没拖出去也算）：不重建卡片，免得按住的那张被换掉、捕获落到脱离页面的旧节点上 */
  private held = false;
  /** 画面上的框选正扫着卡片：不重建，免得高亮丢掉 */
  private boxing = false;
  private readonly cleanup: (() => void)[] = [];

  /**
   * area：两排卡片所在的容器（指针捕获挂在它上面）；overlay：拖拽中的卡片挂在这里；
   * minimap：小地图画布，松在它上面算投到小地图
   */
  constructor(private readonly world: World, private readonly portrait: (defIdx: number, team: number) => string,
    private readonly minimap: HTMLCanvasElement, private readonly overlay: HTMLElement, private readonly cb: CardBarCallbacks,
    area: HTMLElement) {
    this.groupRow = el('div', 'cardrow groups');
    this.groupRow.hidden = true;
    this.roster = el('div', 'cardrow unitbar');
    this.bind(area);
  }

  private get frozen(): boolean {
    return this.held || this.boxing;
  }

  update(sel: number[], screen: number[]): void {
    if (this.frozen) return;
    this.renderRoster(sel, screen);
    this.renderGroups(sel);
  }

  /** 编队（只含还有活人的，按队号排）；下一次 update 时画出来 */
  setGroups(groups: { g: number; slots: number[] }[]): void {
    this.groups = groups;
  }

  destroy(): void {
    for (const f of this.cleanup) f();
  }

  /** 兵种栏：屏幕内（以及已选中）的每个己方兵种一张卡片；选中的兵种卡片上前一步 */
  private renderRoster(sel: number[], screen: number[]): void {
    const w = this.world;
    interface Row { scr: number; n: number; hp: number; lv: number; top: number; morale: number }
    const rows = new Map<number, Row>();
    const row = (t: number): Row => {
      let r = rows.get(t);
      if (!r) rows.set(t, (r = { scr: 0, n: 0, hp: 0, lv: 0, top: 0, morale: 0 }));
      return r;
    };
    for (const s of screen) row(w.type[s]).scr++;
    let moraleSum = 0;
    for (const s of sel) {
      const r = row(w.type[s]);
      r.n++;
      r.hp += w.hp[s] / w.maxHp[s];
      r.lv += w.level[s];
      if (w.level[s] > r.top) r.top = w.level[s];
      r.morale += w.morale[s];
      moraleSum += w.morale[s];
    }
    // 没选中的兵种，等级与血量按屏幕内的人算
    for (const s of screen) {
      const r = rows.get(w.type[s])!;
      if (r.n) continue;
      r.hp += w.hp[s] / w.maxHp[s];
      r.lv += w.level[s];
      if (w.level[s] > r.top) r.top = w.level[s];
      r.morale += w.morale[s];
    }
    const types = [...rows.keys()].sort((a, b) => UNITS[a].row - UNITS[b].row || a - b);
    const mAvg = sel.length ? Math.round(moraleSum / sel.length) : 0;
    let key = `${w.humanTeam}|${sel.length}|${screen.length}|${Math.round(mAvg / 4)}|`;
    for (const t of types) {
      const r = rows.get(t)!, k = r.n || r.scr;
      key += `${t}:${r.scr}:${r.n}:${Math.round((r.hp / k) * 20)}:${Math.round((r.lv / k) * 4)}:${r.top},`;
    }
    if (key === this.rosterKey) return;
    this.rosterKey = key;
    if (!w.humanTeam) {
      this.roster.innerHTML = '<div class="hint">观战模式：方向键 / 拖动小地图移动镜头，滚轮缩放</div>';
      return;
    }
    if (!types.length) {
      this.roster.innerHTML = '<div class="hint">屏幕内没有我方部队 · 拖框选择部队 · 右键移动或攻击 · 点据点可升级</div>';
      return;
    }
    const head = sel.length
      ? `<div class="total">已选 <b>${sel.length}</b><span class="${mAvg < 40 ? 'bad' : mAvg < 55 ? 'warn' : ''}">士气 ${mAvg}</span></div>`
      : `<div class="total">屏幕内 <b>${screen.length}</b><span>拖去下令</span></div>`;
    let html = head;
    for (const t of types) {
      const r = rows.get(t)!, d = UNITS[t], k = r.n || r.scr;
      const lv = Math.round(r.lv / k);
      const routAt = d.lvRout[lv];
      const tip = `${unitTip(d)}\n—\n屏幕内 ${r.scr} 人${r.n ? `，已选 ${r.n} 人` : ''}　平均等级 ${lv + 1}（${LEVELS.names[lv]}），最高 ${r.top + 1} 级`
        + `　士气 ${Math.round(r.morale / k)}　${routAt < 0 ? '死战不退' : `低于 ${routAt} 溃逃`}`
        + '\n—\n点击：选中屏幕内的这个兵种　Shift+点击：加选 / 去掉　双击：选中全图的这个兵种\n拖到地面或小地图上松开：这个兵种攻击移动过去　从画面上拉框扫过卡片：一并选中这些兵种';
      html += `<div class="ucard${d.tier ? ' elite' : ''}${r.n ? ' on' : ''}" data-t="${t}" title="${tip.replace(/"/g, '&quot;')}">
        <img src="${this.portrait(t, w.humanTeam)}" draggable="false">
        <span class="n">${r.scr}</span>
        <span class="nm">${d.name}</span>
        <span class="lv">Lv${lv + 1}</span>
        <span class="hp"><u style="width:${Math.round((r.hp / k) * 100)}%"></u></span>
        ${r.n ? `<span class="sel">选 ${r.n}</span>` : ''}</div>`;
    }
    this.roster.innerHTML = html;
  }

  private renderGroups(sel: number[]): void {
    const w = this.world;
    const picked = new Set(sel);
    let key = `${w.humanTeam}|`;
    const cards: string[] = [];
    for (const { g, slots } of this.groups) {
      const count = new Map<number, number>();
      let hp = 0, on = slots.length > 0;
      for (const s of slots) {
        count.set(w.type[s], (count.get(w.type[s]) ?? 0) + 1);
        hp += w.hp[s] / w.maxHp[s];
        if (!picked.has(s)) on = false;
      }
      // 头像与名字用人最多的兵种
      const kinds = [...count].sort((a, b) => b[1] - a[1] || UNITS[a[0]].row - UNITS[b[0]].row);
      const main = UNITS[kinds[0][0]];
      const pct = Math.round((hp / slots.length) * 100);
      key += `${g}:${slots.length}:${kinds[0][0]}:${kinds.length}:${Math.round(pct / 5)}:${on},`;
      const tip = `第 ${g} 队，共 ${slots.length} 人：${kinds.map(([t, n]) => `${UNITS[t].name} ${n}`).join('、')}`
        + '\n—\n点击：选中这一队（同按数字键）　双击：镜头跳到这一队\n拖到地面或小地图上松开：整队攻击移动过去　从画面上拉框扫过卡片：一并选中这一队';
      cards.push(`<div class="ucard gcard${on ? ' on' : ''}" data-g="${g}" title="${tip}">
        <img src="${this.portrait(main.idx, w.humanTeam)}" draggable="false">
        <span class="gno">${g}</span>
        <span class="n">${slots.length}</span>
        <span class="nm">${main.name}${kinds.length > 1 ? ' 等' : ''}</span>
        <span class="hp"><u style="width:${pct}%"></u></span></div>`);
    }
    if (key === this.groupKey) return;
    this.groupKey = key;
    this.groupRow.innerHTML = cards.join('');
    this.groupRow.hidden = !cards.length;
  }

  /** 画面上拉的框扫到了哪些卡片（框是视口坐标） */
  cardsIn(r: Rect): { types: number[]; groups: number[] } {
    const types: number[] = [], groups: number[] = [];
    for (const c of this.cardsHit(r)) {
      if (c.dataset.g !== undefined) groups.push(Number(c.dataset.g));
      else types.push(Number(c.dataset.t));
    }
    return { types, groups };
  }

  /** 框选拖动中：被框扫到的卡片亮起来，期间不重建卡片；null 收起 */
  markCards(r: Rect | null): void {
    const hot = new Set(r ? this.cardsHit(r) : []);
    for (const c of this.cards()) c.classList.toggle('hot', hot.has(c));
    if (this.boxing && !r) this.rosterKey = this.groupKey = '?';
    this.boxing = !!r;
  }

  private cards(): HTMLElement[] {
    return [...this.groupRow.querySelectorAll<HTMLElement>('.ucard'), ...this.roster.querySelectorAll<HTMLElement>('.ucard')];
  }

  /** 按卡片的布局位置判定（选中的卡片上移是 transform，不算进去：否则框的边缘压在卡片附近时，命中与否跟着上移来回跳） */
  private cardsHit(r: Rect): HTMLElement[] {
    return this.cards().filter(c => {
      if (c.offsetParent === null) return false;
      const b = c.getBoundingClientRect();
      const t = new DOMMatrixReadOnly(getComputedStyle(c).transform);
      const left = b.left - t.m41, top = b.top - t.m42;
      return left + b.width >= r.ax && left <= r.bx && top + b.height >= r.ay && top <= r.by;
    });
  }

  /**
   * 点击：兵种卡片选屏幕内这个兵种（Shift 加选 / 去掉，双击选全图），编队卡片选这一队（双击跳镜头）；
   * 按住拖动：卡片缩小跟在鼠标右下方，松在地面或小地图上就让这批人攻击移动过去；松在别处、按右键、按 Esc、窗口失去焦点都取消。
   */
  private bind(area: HTMLElement): void {
    let down: { card: HTMLElement; x: number; y: number; add: boolean; id: number } | null = null;
    let ghost: HTMLElement | null = null;
    let last = { t: 0, key: '' };
    const kindOf = (c: HTMLElement): 'type' | 'group' => (c.dataset.g !== undefined ? 'group' : 'type');
    const target = (x: number, y: number): 'view' | 'mini' | null => {
      const e = document.elementFromPoint(x, y);
      return e === this.minimap ? 'mini' : e instanceof HTMLCanvasElement && e.classList.contains('view') ? 'view' : null;
    };
    const place = (x: number, y: number): void => {
      if (!ghost) return;
      ghost.style.transform = `translate(${x + 14}px, ${y + 14}px) scale(0.8)`;
      ghost.classList.toggle('nodrop', !target(x, y));
    };
    const stop = (): void => {
      if (!down) return;
      down = null;
      ghost?.remove();
      ghost = null;
      this.held = false;
      this.rosterKey = this.groupKey = '?';
      window.removeEventListener('keydown', onKey, true);
    };
    // 拦右键菜单的监听比拖拽活得久：组合按键时 contextmenu 排在取消拖拽的那次 pointermove 之后（macOS 在按下右键时发，
    // Windows 在松开右键时发、还在最后一次 pointerup 之后），所以等全部按键松开后再多留一会儿才摘
    let menuTimer = 0;
    const guardMenu = (): void => {
      clearTimeout(menuTimer);
      window.addEventListener('contextmenu', onMenu, true);
    };
    const unguardMenu = (): void => {
      clearTimeout(menuTimer);
      menuTimer = window.setTimeout(() => window.removeEventListener('contextmenu', onMenu, true), 300);
    };
    const cancel = (): void => {
      stop();
      unguardMenu();
    };
    // 拖动中按 Esc：取消这次拖拽，不让它再落到游戏的取消选择上
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      e.preventDefault();
      stop();
    };
    // 按住左键再按右键（组合按键只发 pointermove，见下）时浏览器还会发 contextmenu：拦下菜单，拖拽还在的话同样算取消
    const onMenu = (e: MouseEvent): void => {
      e.preventDefault();
      stop();
    };
    area.addEventListener('pointerdown', e => {
      const card = (e.target as HTMLElement).closest<HTMLElement>('.cardrow .ucard');
      if (!card || e.button !== 0) return;
      const id = Number(card.dataset.g ?? card.dataset.t);
      down = { card, x: e.clientX, y: e.clientY, add: e.shiftKey || e.ctrlKey || e.metaKey, id };
      this.held = true;
      area.setPointerCapture(e.pointerId);
      window.addEventListener('keydown', onKey, true);
      guardMenu();
      e.preventDefault();
    });
    area.addEventListener('pointermove', e => {
      if (!down) return;
      // 按着左键再按右键：Pointer Events 里组合按键不发 pointerdown，只能从 buttons 看出来
      if (e.buttons & 2) {
        stop();
        return;
      }
      if (!ghost) {
        if (Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6) return;
        ghost = down.card.cloneNode(true) as HTMLElement;
        // 「选 N」角标与选中态不跟着走：松手后出动的是这张卡代表的全部人，不只是选着的那些
        ghost.removeAttribute('title');
        ghost.querySelector('.sel')?.remove();
        ghost.classList.remove('hover', 'hot', 'on');
        ghost.classList.add('ghost');
        this.overlay.appendChild(ghost);
      }
      place(e.clientX, e.clientY);
    });
    area.addEventListener('pointerup', e => {
      if (!e.buttons) unguardMenu();
      const d = down;
      if (!d || e.button !== 0) return;
      const dragged = !!ghost;
      stop();
      if (area.hasPointerCapture(e.pointerId)) area.releasePointerCapture(e.pointerId);
      const kind = kindOf(d.card);
      if (dragged) {
        const t = target(e.clientX, e.clientY);
        if (t) this.cb.dropCard(kind, d.id, e.clientX, e.clientY, t);
        return;
      }
      const now = performance.now(), key = `${kind}${d.id}`;
      const double = last.key === key && now - last.t < 350;
      last = double ? { t: 0, key: '' } : { t: now, key };
      if (kind === 'group') this.cb.selectGroup(d.id, double);
      else if (double) this.cb.pickTypes([d.id], 'map');
      else this.cb.pickTypes([d.id], d.add ? 'toggle' : 'replace');
    });
    area.addEventListener('pointercancel', cancel);
    area.addEventListener('lostpointercapture', cancel);
    window.addEventListener('blur', cancel);
    this.cleanup.push(stop, () => {
      clearTimeout(menuTimer);
      window.removeEventListener('contextmenu', onMenu, true);
      window.removeEventListener('blur', cancel);
    });
  }
}
