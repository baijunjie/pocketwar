/**
 * 底部的卡片：兵种栏最左的全选卡片（屏幕内的全部己方部队）、兵种卡片（屏幕内以及已选中的每个己方兵种一张）与其上方一排编队卡片（每个还有活人的编队一张）。
 * 卡片直接浮在画面底部、不包外框，卡片之间的空隙就是画面：从画面上拉的框扫到卡片时，game 用 `cardsIn` 把这些兵种 / 编队并进框选。
 * 点击选择；按住拖动时卡片缩小跟在鼠标右下方，松在地面或小地图上就让这批人过去（松在敌军身上是攻击它）。
 * 移动版用手指拖时另画一把剑，剑尖是落点、抬在手指上方，卡片跟在剑的右下方。
 */
import { LEVELS, UNITS } from '../sim/defs';
import { World } from '../sim/world';
import { cardIntent, dropLift, inInscribedCircle } from '../touchInput';
import SWORD from './sword.svg?raw';
import { unitTip } from './unitText';

export interface CardBarCallbacks {
  /** 点兵种卡片：replace = 改选屏幕内这个兵种；toggle = 选着就去掉、没选就加上；map = 选中全图的这个兵种（双击） */
  pickTypes(types: number[], mode: 'replace' | 'toggle' | 'map'): void;
  /** 点全选卡片：replace = 改选屏幕内的全部己方部队；add = 加选它们；map = 选中全图的己方部队（双击） */
  pickAll(mode: 'replace' | 'add' | 'map'): void;
  /** 点编队卡片：选中这一队；jump = 双击，镜头再跳到这队 */
  selectGroup(g: number, jump: boolean): void;
  /**
   * 把卡片拖到地面（view）或小地图（mini）上松开，(x, y) 是落点的视口坐标（桌面版是鼠标位置，移动版抬在手指上方）：这批人去松开处——松在敌军身上是攻击它（同右键），否则攻击移动。
   * kind：type = 兵种卡片（id 是兵种），group = 编队卡片（id 是队号），all = 全选卡片（id 不用）
   */
  dropCard(kind: CardKind, id: number, x: number, y: number, target: 'view' | 'mini'): void;
}

export type CardKind = 'type' | 'group' | 'all';

/** 拖拽中跟着走的卡片缩到多大 */
const GHOST_SCALE = 0.8;
/** 移动版：翻到落点左边的卡片，右边空出这么多像素才翻回去 */
const FLIP_BACK = 40;

export interface Rect {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

/** 卡片元素是哪种卡片 */
function kindOf(c: HTMLElement): CardKind {
  return c.dataset.all !== undefined ? 'all' : c.dataset.g !== undefined ? 'group' : 'type';
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
  /** 移动版：卡片带横向滚动，按住后按方向区分是滚动还是拖卡片下令；拖拽中落点抬到手指上方，用一把剑指着 */
  mobile = false;

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
    // 全选卡片在屏幕内的人全都选着时上前一步
    const picked = new Set(sel);
    const allOn = screen.length > 0 && screen.every(s => picked.has(s));
    let key = `${this.mobile}|${w.humanTeam}|${sel.length}|${screen.length}|${Math.round(mAvg / 4)}|${allOn}|`;
    for (const t of types) {
      const r = rows.get(t)!, k = r.n || r.scr;
      key += `${t}:${r.scr}:${r.n}:${Math.round((r.hp / k) * 20)}:${Math.round((r.lv / k) * 4)}:${r.top},`;
    }
    if (key === this.rosterKey) return;
    this.rosterKey = key;
    if (!w.humanTeam) {
      this.roster.innerHTML = `<div class="hint">观战模式：${this.mobile ? '推摇杆、拖动小地图或双指滑动移动镜头，双指捏合缩放' : '方向键 / 拖动小地图移动镜头，滚轮缩放'}</div>`;
      return;
    }
    if (!types.length) {
      this.roster.innerHTML = `<div class="hint">屏幕内没有我方部队 · 拖框选择部队 · ${this.mobile ? '点地面移动或攻击' : '右键移动或攻击'} · 点据点可升级</div>`;
      return;
    }
    const allTip = `屏幕内 ${screen.length} 人${sel.length ? `，已选 ${sel.length} 人，平均士气 ${mAvg}` : ''}`
      + '\n—\n点击：选中屏幕内的全部部队　Shift+点击：加选它们　双击：选中全图的部队'
      + '\n拖到地面或小地图上松开：这些部队攻击移动过去，松在敌军身上则攻击它　从画面上拉框扫过卡片：一并选中它们';
    // 屏幕内没人（选着的全在屏幕外）时全选卡片变暗、按下不响应（见 bind）：点它只会把选择清空
    let html = `<div class="ucard acard${allOn ? ' on' : ''}${screen.length ? '' : ' off'}" data-all="1" title="${allTip}">
      <span class="ab"><span class="ah">全选</span><b>${screen.length}</b></span>
      ${sel.length ? `<span class="nm mor${mAvg < 40 ? ' bad' : mAvg < 55 ? ' warn' : ''}">士气 ${mAvg}</span>` : '<span class="nm">拖去下令</span>'}
      <span class="hp"></span>
      ${sel.length ? `<span class="sel">选 ${sel.length}</span>` : ''}</div>`;
    for (const t of types) {
      const r = rows.get(t)!, d = UNITS[t], k = r.n || r.scr;
      const lv = Math.round(r.lv / k);
      const routAt = d.lvRout[lv];
      const tip = `${unitTip(d)}\n—\n屏幕内 ${r.scr} 人${r.n ? `，已选 ${r.n} 人` : ''}　平均等级 ${lv + 1}（${LEVELS.names[lv]}），最高 ${r.top + 1} 级`
        + `　士气 ${Math.round(r.morale / k)}　${routAt < 0 ? '死战不退' : `低于 ${routAt} 溃逃`}`
        + '\n—\n点击：选中屏幕内的这个兵种　Shift+点击：加选 / 去掉　双击：选中全图的这个兵种'
        + '\n拖到地面或小地图上松开：这个兵种攻击移动过去，松在敌军身上则攻击它　从画面上拉框扫过卡片：一并选中这些兵种';
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
        + '\n—\n点击：选中这一队（同按数字键）　双击：镜头跳到这一队'
        + '\n拖到地面或小地图上松开：整队攻击移动过去，松在敌军身上则攻击它　从画面上拉框扫过卡片：一并选中这一队';
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

  /** 画面上拉的框扫到了哪些卡片（框是视口坐标）；all：扫到了全选卡片 */
  cardsIn(r: Rect): { types: number[]; groups: number[]; all: boolean } {
    const types: number[] = [], groups: number[] = [];
    let all = false;
    for (const c of this.cardsHit(r)) {
      const kind = kindOf(c);
      if (kind === 'all') all = true;
      else if (kind === 'group') groups.push(Number(c.dataset.g));
      else types.push(Number(c.dataset.t));
    }
    return { types, groups, all };
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
      // 禁用的卡片（屏幕内没人的全选卡片）扫到也不亮
      if (c.offsetParent === null || c.classList.contains('off')) return false;
      const b = c.getBoundingClientRect();
      const t = new DOMMatrixReadOnly(getComputedStyle(c).transform);
      const left = b.left - t.m41, top = b.top - t.m42;
      return left + b.width >= r.ax && left <= r.bx && top + b.height >= r.ay && top <= r.by;
    });
  }

  /**
   * 点击：全选卡片选屏幕内的全部部队（Shift 加选，双击选全图），兵种卡片选屏幕内这个兵种（Shift 加选 / 去掉，双击选全图），
   * 编队卡片选这一队（双击跳镜头）；
   * 按住拖动：卡片缩小跟在鼠标右下方，松在地面或小地图上就让这批人过去（松在敌军身上是攻击它）；松在别处、按右键、按 Esc、窗口失去焦点都取消。
   * 移动版（手指拖）：按住后横向位移明显占主导是滚动卡片带（area 自己是滚动容器），否则是拖卡片；滚动中手指竖向离开了卡片带也改成拖卡片。
   * 落点不在手指正下方（会被手指挡住），抬在手指上方、用剑尖指着；按在卡片之间的空隙上只能滚动。
   */
  private bind(area: HTMLElement): void {
    let down: { card: HTMLElement | null; x: number; y: number; add: boolean; id: number; scroll0: number;
      intent: 'wait' | 'drag' | 'scroll' } | null = null;
    let ghost: HTMLElement | null = null;
    /** 移动版：影子卡片翻到了落点左下方（右边放不下） */
    let flipped = false;
    // 移动版拖卡片时指着落点的剑（桌面版落点就是鼠标指针，本来就是剑）
    const sword = el('div', 'dragptr');
    sword.innerHTML = SWORD;
    let last = { t: 0, key: '' };
    const target = (x: number, y: number): 'view' | 'mini' | null => {
      const e = document.elementFromPoint(x, y);
      // 移动版：小地图画布方形的四角（地图圆外）不算小地图
      if (e === this.minimap && this.mobile && !inInscribedCircle(x, y, this.minimap.getBoundingClientRect())) return null;
      return e === this.minimap ? 'mini' : e instanceof HTMLCanvasElement && e.classList.contains('view') ? 'view' : null;
    };
    /** 指针在 (x, y) 时的落点：桌面版就是鼠标位置；移动版抬到手指上方（见 dropLift） */
    const dropAt = (x: number, y: number): { x: number; y: number } => {
      if (!this.mobile) return { x, y };
      const strip = area.getBoundingClientRect(), screen = this.overlay.getBoundingClientRect();
      return { x, y: y - dropLift(y, screen.top, strip.top, strip.bottom, screen.bottom) };
    };
    const place = (x: number, y: number): void => {
      if (!ghost) return;
      const p = dropAt(x, y), ok = !!target(p.x, p.y);
      // 卡片跟在落点右下方；移动版的剑比鼠标指针大，多让出一点，右边放不下（会伸出屏幕）就翻到左下方
      // 翻过去后要往回让出 FLIP_BACK 才翻回来：手指停在分界线附近时卡片不来回跳
      const gap = this.mobile ? 22 : 14, w = ghost.offsetWidth * GHOST_SCALE;
      const room = this.overlay.getBoundingClientRect().right - (p.x + gap + w);
      flipped = this.mobile && room < (flipped ? FLIP_BACK : 0);
      ghost.style.transform = `translate(${flipped ? p.x - gap - w : p.x + gap}px, ${p.y + gap}px) scale(${GHOST_SCALE})`;
      ghost.classList.toggle('nodrop', !ok);
      sword.style.transform = `translate(${p.x}px, ${p.y}px)`;
      sword.classList.toggle('nodrop', !ok);
    };
    const stop = (): void => {
      if (!down) return;
      down.card?.classList.remove('hot');
      down = null;
      ghost?.remove();
      ghost = null;
      flipped = false;
      sword.remove();
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
      let card = (e.target as HTMLElement).closest<HTMLElement>('.cardrow .ucard');
      // 禁用的卡片（屏幕内没人的全选卡片）：桌面版在这里吃掉，不能放给底下的画面（会变成点选、框选或指令模式里的下令）；
      // 移动版当作按在空隙上，只能滚动卡片带
      if (card?.classList.contains('off')) {
        if (!this.mobile) {
          e.preventDefault();
          return;
        }
        card = null;
      }
      if ((!card && !this.mobile) || e.button !== 0) return;
      const id = card && kindOf(card) !== 'all' ? Number(card.dataset.g ?? card.dataset.t) : -1;
      down = { card, x: e.clientX, y: e.clientY, add: e.shiftKey || e.ctrlKey || e.metaKey, id, scroll0: area.scrollLeft,
        intent: card && this.mobile ? 'wait' : this.mobile ? 'scroll' : 'drag' };
      this.held = true;
      // 手指按住的那张先亮起来：还没拖出起手距离、卡片没跟上来之前，也看得出按中了
      if (this.mobile) card?.classList.add('hot');
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
      if (down.intent === 'wait') {
        down.intent = cardIntent(e.clientX - down.x, e.clientY - down.y);
        // 判成滚动：按中的那张不再亮着，免得看着像选中了它
        if (down.intent === 'scroll') down.card?.classList.remove('hot');
      }
      if (down.intent === 'scroll' && down.card) {
        // 卡片带只横向滚动：手指竖向离开了它就是要把卡片拖出去，滚动掉的那一点还回去
        const strip = area.getBoundingClientRect();
        if (e.clientY < strip.top || e.clientY > strip.bottom) {
          down.intent = 'drag';
          area.scrollLeft = down.scroll0;
        }
      }
      if (down.intent === 'scroll') {
        area.scrollLeft = down.scroll0 - (e.clientX - down.x);
        return;
      }
      if (!ghost) {
        if (down.intent === 'wait' || !down.card || Math.hypot(e.clientX - down.x, e.clientY - down.y) < (this.mobile ? 0 : 6)) return;
        ghost = down.card.cloneNode(true) as HTMLElement;
        // 「选 N」角标与选中态不跟着走：松手后出动的是这张卡代表的全部人，不只是选着的那些
        ghost.removeAttribute('title');
        ghost.querySelector('.sel')?.remove();
        // 全选卡片上的士气说的也是选着的人，拖动时换回「拖去下令」
        const mor = ghost.querySelector('.mor');
        if (mor) {
          mor.className = 'nm';
          mor.textContent = '拖去下令';
        }
        ghost.classList.remove('hover', 'hot', 'on');
        ghost.classList.add('ghost');
        this.overlay.appendChild(ghost);
        if (this.mobile) this.overlay.appendChild(sword);
      }
      place(e.clientX, e.clientY);
    });
    area.addEventListener('pointerup', e => {
      if (!e.buttons) unguardMenu();
      const d = down;
      if (!d || e.button !== 0) return;
      const dragged = !!ghost, scrolled = d.intent === 'scroll';
      const p = dropAt(e.clientX, e.clientY);
      stop();
      if (area.hasPointerCapture(e.pointerId)) area.releasePointerCapture(e.pointerId);
      // 空隙上按下、或横向滚动了卡片带：不是点卡片
      if (!d.card || scrolled) return;
      const kind = kindOf(d.card);
      if (dragged) {
        const t = target(p.x, p.y);
        if (t) this.cb.dropCard(kind, d.id, p.x, p.y, t);
        return;
      }
      const now = performance.now(), key = `${kind}${d.id}`;
      const double = last.key === key && now - last.t < 350;
      last = double ? { t: 0, key: '' } : { t: now, key };
      if (kind === 'all') this.cb.pickAll(double ? 'map' : d.add ? 'add' : 'replace');
      else if (kind === 'group') this.cb.selectGroup(d.id, double);
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
