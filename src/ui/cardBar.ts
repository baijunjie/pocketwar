/**
 * 底部的卡片：兵种栏最左的全选卡片（屏幕内的全部己方部队）、兵种卡片（屏幕内以及已选中的每个己方兵种一张）与其上方一排编队卡片（每个还有活人的编队一张）。
 * 没选中的卡片按屏幕内的人数，选中后改按选中的人、不再随屏幕变化：移动镜头不会让选中的人从卡片上掉出去。
 * 卡片直接浮在画面底部、不包外框，卡片之间的空隙就是画面：从画面上拉的框扫到卡片时，game 用 `cardsIn` 把这些兵种 / 编队并进框选。
 * 点击选择；按住拖动时卡片缩小跟在鼠标右下方，松在地面或小地图上就让这批人过去（松在敌军身上是攻击它）。
 * 移动版用手指拖时卡片立在手指上方（下沿压在手指下），另画一把剑从卡片顶上伸出去，剑尖所指才是落点。
 */
import { LEVELS, UNITS } from '../sim/defs';
import { World } from '../sim/world';
import { CARD_SLOP, DROP_ARM, DROP_REACH, HOLD_MS, TAP_SLOP, cardIntent, dropOffset } from '../touchInput';
import SWORD from './sword.svg?raw';
import { unitTip } from './unitText';

export interface CardBarCallbacks {
  /** 点兵种卡片：replace = 改选这张卡片代表的人（选中的兵种是选中的这些人，没选中的是屏幕内的）；toggle = 选着就去掉、没选就加上；map = 选中全图的这个兵种（双击） */
  pickTypes(types: number[], mode: 'replace' | 'toggle' | 'map'): void;
  /** 点全选卡片：replace = 改选它代表的人（选中态时是选中的人，否则是屏幕内的全部己方部队）；add = 加选屏幕内的；map = 选中全图的己方部队（双击） */
  pickAll(mode: 'replace' | 'add' | 'map'): void;
  /** 点编队卡片：选中这一队；jump = 双击，镜头再跳到这队 */
  selectGroup(g: number, jump: boolean): void;
  /** 单击已选中（亮着）的卡片：把这张卡片代表的人从选择里去掉（全选卡片是清空选择） */
  unpickCard(kind: CardKind, id: number): void;
  /** 这张卡片此刻代表多少人（拖卡片下令会出动的人）：拖拽中的影子按它写人数，0 时不能投放 */
  cardCount(kind: CardKind, id: number): number;
  /** 点了移动版的「取消选择」或空队按钮，与卡片共用手指归属 */
  tapButton?(btn: HTMLElement): void;
  /** 长按卡片（按住不动 HOLD_MS）：在 rect（卡片的视口矩形）附近弹出升级选择 */
  holdCard(kind: CardKind, id: number, rect: DOMRect): void;
  holdGroup?(g: number): void;
  /**
   * 把卡片拖到地面（view）或小地图（mini）上松开，(x, y) 是落点的视口坐标（桌面版是鼠标位置，移动版是手指外面的剑尖）：这批人去松开处——松在敌军身上是攻击它（同右键），否则攻击移动。
   * kind：type = 兵种卡片（id 是兵种），group = 编队卡片（id 是队号），all = 全选卡片（id 不用）
   */
  dropCard(kind: CardKind, id: number, x: number, y: number, target: 'view' | 'mini'): void;
}

export type CardKind = 'type' | 'group' | 'all';

/** 连点两下同一张卡片在这么多毫秒内算双击 */
const DOUBLE_MS = 350;

/** 拖拽中跟着走的卡片缩到多大 */
const GHOST_SCALE = 0.8;
/** 移动版拖拽中的卡片缩到多大：要在手指上方看清内容，比桌面版大一点 */
const TOUCH_GHOST_SCALE = 0.9;
/** 移动版：剑尖从拖拽中的卡片顶上伸出多少像素 */
const SWORD_OUT = 34;

export interface Rect {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

/**
 * 选择变成 list 那一刻（不是点全选卡片选出来的时候），全选卡片是否处于选中态：屏幕内的己方单位（screen）全都被选着。
 * 屏幕内一个人都没有时谈不上「都选着」，不算。定下后不随镜头变
 */
export function allCardPicked(list: number[], screen: number[]): boolean {
  if (!list.length) return false;
  const picked = new Set(list);
  return screen.length > 0 && screen.every(s => picked.has(s));
}

/** 卡片元素是哪种卡片 */
function kindOf(c: HTMLElement): CardKind {
  return c.dataset.all !== undefined ? 'all' : c.dataset.g !== undefined ? 'group' : 'type';
}

/** 卡片的身份：种类加队号 / 兵种号（全选卡片只有一张，不看号）；双击记录、冻住的那张、按身份找重建后的新卡片都按它比对 */
function keyOf(kind: CardKind, id: number): string {
  return `${kind}${kind === 'all' ? -1 : id}`;
}

function isEmptySlot(c: HTMLElement): boolean {
  return c.classList.contains('slot') && !c.classList.contains('has');
}

function cardKey(c: HTMLElement): string {
  return keyOf(kindOf(c), Number(c.dataset.g ?? c.dataset.t));
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
  /** 最近一次 update 给的选择与全选卡片的选中态 */
  private sel: number[] = [];
  private screen: number[] = [];
  /** 拖拽中按此刻会出动的人刷新影子（bind 里设，没在拖时为 null） */
  private dragTick: (() => void) | null = null;
  private allPicked = false;
  /** 单击亮着的卡片取消选中后的双击时限内：卡片带冻住（那张原位变淡，.pending），第二下还能点中它判成双击 */
  private waiting = false;
  private readonly cleanup: (() => void)[] = [];
  /** 移动版：卡片带横向滚动，按住后按方向区分是滚动还是拖卡片下令；拖拽中从手指伸出一把剑，剑尖是落点 */
  private mobileMode = false;
  private resetGesture: () => void = () => {};

  get mobile(): boolean {
    return this.mobileMode;
  }

  set mobile(on: boolean) {
    if (on === this.mobileMode) return;
    this.resetGesture();
    this.mobileMode = on;
  }
  /** 移动版的小地图在哪一侧（1 右、−1 左）：拖卡片时手指贴近屏幕底，剑往这一侧放倒 */
  mapSide: 1 | -1 = 1;

  /**
   * area：两排卡片所在的容器（指针捕获挂在它上面）；overlay：拖拽中的卡片挂在这里；
   * minimap：小地图画布，松在它上面算投到小地图；topbar：顶栏，移动版拖拽中的卡片不往上盖住它；pressButton：与卡片共用手指归属的取消选择按钮
   */
  constructor(private readonly world: World, private readonly portrait: (defIdx: number, team: number) => string,
    private readonly minimap: HTMLCanvasElement, private readonly overlay: HTMLElement, private readonly cb: CardBarCallbacks,
    area: HTMLElement, private readonly topbar: HTMLElement | null = null, pressButton: HTMLButtonElement | null = null,
    private readonly groupButtons: HTMLElement | null = null) {
    this.groupRow = el('div', 'cardrow groups');
    this.groupRow.hidden = true;
    this.roster = el('div', 'cardrow unitbar');
    this.bind(area, pressButton);
  }

  /** 卡片带上正有一根手指按着（点、拖、长按、滚动中）：移动版的「取消选择」这时不响应 */
  get busy(): boolean {
    return this.held;
  }

  private get frozen(): boolean {
    return this.held || this.boxing || this.waiting;
  }

  /**
   * sel：选中的单位；screen：屏幕内的己方单位；
   * allPicked：全选卡片处于选中态，代表的是选中的人（由 game 在选择变化时定下，之后不随屏幕变）
   */
  update(sel: number[], screen: number[], allPicked = false): void {
    // 拖拽中（卡片带冻着）也跟着局面刷新影子：镜头移动、伤亡后会出动的人数变了
    this.dragTick?.();
    // 选择先记下（冻结时卡片不重建，但点卡片时要按此刻的选择判断它亮不亮，解冻时也按它补画）
    this.sel = sel;
    this.screen = screen;
    this.allPicked = allPicked;
    if (this.frozen) return;
    this.renderRoster(sel, screen, allPicked);
    this.renderGroups(sel);
  }

  /** 编队（只含还有活人的，按队号排）；下一次 update 时画出来 */
  setGroups(groups: { g: number; slots: number[] }[]): void {
    this.groups = groups;
  }

  destroy(): void {
    for (const f of this.cleanup) f();
  }

  /** 兵种栏：屏幕内（以及已选中）的每个己方兵种一张卡片；选中的兵种卡片上前一步，人数写选中的 */
  private renderRoster(sel: number[], screen: number[], allOn: boolean): void {
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
    const allN = allOn ? sel.length : screen.length;
    let key = `${this.mobile}|${w.humanTeam}|${sel.length}|${allN}|${Math.round(mAvg / 4)}|${allOn}|`;
    for (const t of types) {
      const r = rows.get(t)!, k = r.n || r.scr;
      key += `${t}:${r.n ? 0 : r.scr}:${r.n}:${Math.round((r.hp / k) * 20)}:${Math.round((r.lv / k) * 4)}:${r.top},`;
    }
    if (key === this.rosterKey) return;
    this.rosterKey = key;
    if (!w.humanTeam) {
      this.roster.innerHTML = `<div class="hint">观战模式：${this.mobile ? '推摇杆、拖动小地图或双指滑动移动镜头，双指捏合或拉缩放条缩放' : '方向键 / 拖动小地图移动镜头，滚轮缩放'}</div>`;
      return;
    }
    if (!types.length && !this.mobile) {
      this.roster.innerHTML = `<div class="hint">屏幕内没有我方部队 · 拖框选择部队 · 右键移动或攻击 · 点据点可升级</div>`;
      return;
    }
    const allTip = (allOn ? `已选 ${sel.length} 人（选中后不随屏幕变化），平均士气 ${mAvg}`
      : `屏幕内 ${screen.length} 人${sel.length ? `，已选 ${sel.length} 人，平均士气 ${mAvg}` : ''}`)
      + (allOn ? '\n—\n点击：取消选择　Shift+点击：加选屏幕内的部队　双击：选中全图的部队\n拖到地面或小地图上松开：选中的部队攻击移动过去，松在敌军身上则攻击它'
        : '\n—\n点击：选中屏幕内的全部部队　Shift+点击：加选它们　双击：选中全图的部队'
        + '\n拖到地面或小地图上松开：屏幕内的部队攻击移动过去，松在敌军身上则攻击它')
      + '　从画面上拉框扫过卡片：一并选中它们\n按住不动：弹出升级选择';
    // 没选中、屏幕内又没人时全选卡片变暗、按下不响应（见 bind）：点它只会把选择清空
    let html = `<div class="ucard acard${allOn ? ' on' : ''}${allN ? '' : ' off'}" data-all="1" title="${allTip}">
      <span class="ab"><span class="ah">${this.mobile ? '全选屏幕' : '全选'}</span><b>${allN}</b></span>
      ${sel.length ? `<span class="nm mor${mAvg < 40 ? ' bad' : mAvg < 55 ? ' warn' : ''}">士气 ${mAvg}</span>`
        : `<span class="nm">${allN ? '拖去下令' : '屏幕内无人'}</span>`}
      <span class="hp"></span>
      ${sel.length && !allOn ? `<span class="sel">选 ${sel.length}</span>` : ''}</div>`;
    for (const t of types) {
      const r = rows.get(t)!, d = UNITS[t], k = r.n || r.scr;
      const lv = Math.round(r.lv / k);
      const routAt = d.lvRout[lv];
      const tip = `${unitTip(d)}\n—\n${r.n ? `已选 ${r.n} 人（选中后不随屏幕变化）` : `屏幕内 ${r.scr} 人`}　平均等级 ${lv + 1}（${LEVELS.names[lv]}），最高 ${r.top + 1} 级`
        + `　士气 ${Math.round(r.morale / k)}　${routAt < 0 ? '死战不退' : `低于 ${routAt} 溃逃`}`
        + (r.n ? '\n—\n点击 / Shift+点击：取消选中它们　双击：选中全图的这个兵种'
          + '\n拖到地面或小地图上松开：选中的这个兵种攻击移动过去，松在敌军身上则攻击它'
          : '\n—\n点击：选中屏幕内的这个兵种　Shift+点击：加选　双击：选中全图的这个兵种'
          + '\n拖到地面或小地图上松开：屏幕内的这个兵种攻击移动过去，松在敌军身上则攻击它')
        + '　从画面上拉框扫过卡片：一并选中这些兵种\n按住不动：弹出升级选择';
      html += `<div class="ucard${d.tier ? ' elite' : ''}${r.n ? ' on' : ''}" data-t="${t}" title="${tip.replace(/"/g, '&quot;')}">
        <img src="${this.portrait(t, w.humanTeam)}" draggable="false">
        <span class="n">${r.n || r.scr}</span>
        <span class="nm">${d.name}</span>
        <span class="lv">Lv${lv + 1}</span>
        <span class="hp"><u style="width:${Math.round((r.hp / k) * 100)}%"></u></span></div>`;
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
        + `\n—\n${on ? '点击：取消选中这一队' : '点击：选中这一队（同按数字键）'}　双击：镜头跳到这一队`
        + '\n拖到地面或小地图上松开：整队攻击移动过去，松在敌军身上则攻击它　从画面上拉框扫过卡片：一并选中这一队\n按住不动：弹出升级选择';
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

  /**
   * 这张卡片此刻是否选中（亮着）：按选择本身判断，不读卡片元素上的 on 类——同一按里选择可能刚变过、卡片还没重建
   * （全选卡片看选中态，兵种卡片看选中的人里有没有这个兵种，编队卡片看这一队是否全都选着）
   */
  private isLit(kind: CardKind, id: number): boolean {
    if (kind === 'all') return this.allPicked && this.sel.length > 0;
    if (kind === 'type') return this.sel.some(s => this.world.type[s] === id);
    const grp = this.groups.find(x => x.g === id), picked = new Set(this.sel);
    return !!grp && grp.slots.length > 0 && grp.slots.every(s => picked.has(s));
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

  /** 页面上这张卡片此刻的位置（卡片已不在就是 null）；全选卡片的 id 不管 */
  cardRect(kind: CardKind, id: number): DOMRect | null {
    const key = keyOf(kind, id);
    const c = this.cards().find(x => cardKey(x) === key);
    return c && !isEmptySlot(c) ? c.getBoundingClientRect() : null;
  }

  /** 页面上所有卡片里最高的上沿（含选中卡片的上移）；没有卡片是 Infinity */
  cardsTop(): number {
    return Math.min(...this.cards().filter(c => !c.hidden).map(c => c.getBoundingClientRect().top));
  }

  private cards(): HTMLElement[] {
    const groups = this.groupButtons?.querySelectorAll<HTMLElement>('.slot') ?? this.groupRow.querySelectorAll<HTMLElement>('.ucard');
    return [...groups, ...this.roster.querySelectorAll<HTMLElement>('.ucard')];
  }

  /** 按卡片的布局位置判定（选中的卡片上移是 transform，不算进去：否则框的边缘压在卡片附近时，命中与否跟着上移来回跳） */
  private cardsHit(r: Rect): HTMLElement[] {
    return this.cards().filter(c => {
      // 禁用的卡片（屏幕内没人的全选卡片）扫到也不亮
      if (c.offsetParent === null || c.classList.contains('off') || isEmptySlot(c)) return false;
      const b = c.getBoundingClientRect();
      const t = new DOMMatrixReadOnly(getComputedStyle(c).transform);
      const left = b.left - t.m41, top = b.top - t.m42;
      return left + b.width >= r.ax && left <= r.bx && top + b.height >= r.ay && top <= r.by;
    });
  }

  /**
   * 点击：全选卡片、兵种卡片选它代表的人（没选中时是屏幕内的，选中后是选中的；Shift 加选 / 去掉，双击选全图），
   * 编队卡片选这一队（双击跳镜头）；单击亮着的卡片取消选中它代表的人；按住不动满 HOLD_MS 弹出升级选择（这一按不再拖、也不算点）；
   * 按住拖动：卡片缩小跟在鼠标右下方，松在地面或小地图上就让这批人过去（松在敌军身上是攻击它）；松在别处、按右键、按 Esc、窗口失去焦点都取消。
   * 移动版（手指拖）：按住后横向位移明显占主导是滚动卡片带（area 自己是滚动容器），否则是拖卡片；滚动中手指竖向离开了卡片带也改成拖卡片。
   * 落点不在手指正下方（会被手指挡住）：从手指伸出一把剑，剑尖是落点；按在卡片之间的空隙上只能滚动。
   */
  private bind(area: HTMLElement, pressButton: HTMLButtonElement | null): void {
    /** 正按着的那一下：只认按下它的那个指针（pid），松手或取消前卡片带上的其它手指一律不理，免得影子与下令的对象错配 */
    let down: { pid: number; card: HTMLElement | null; btn: HTMLElement | null; x: number; y: number; add: boolean; id: number; scroll0: number;
      intent: 'wait' | 'drag' | 'scroll'; held: boolean; voided?: boolean; mouse?: boolean } | null = null;
    // 长按：按住卡片不动满 HOLD_MS 弹出升级选择，这一按之后既不拖也不算点
    let holdTimer = 0;
    let ghost: HTMLElement | null = null;
    let topEdge = -Infinity;
    // 移动版拖卡片时指着落点的剑（桌面版落点就是鼠标指针，本来就是剑）
    const sword = el('div', 'dragptr');
    sword.innerHTML = SWORD;
    sword.style.setProperty('--reach', `${DROP_REACH}px`);
    let last = { t: 0, key: '' };
    /**
     * 事件落在哪张卡片上。卡片可能在捕获阶段刚被重建（解冻补画），旧节点已脱离卡片行：只按 `.ucard` 往上找（不带卡片行，
     * 脱离后的旧卡片自己还在），再按身份换成页面上的新卡片（人数、亮不亮、位置都按新的来）
     */
    const cardOf = (e: Event): HTMLElement | null => {
      const target = e.target as HTMLElement;
      return liveCard(target.closest?.<HTMLElement>('.ucard') ?? target.closest?.<HTMLElement>('.slot') ?? null);
    };
    const liveCard = (c: HTMLElement | null): HTMLElement | null => {
      if (!c || c.isConnected !== false) return c;
      const key = cardKey(c);
      return this.cards().find(x => cardKey(x) === key) ?? null;
    };
    // 单击亮着的卡片：立刻取消选中它代表的人（之后的下令都按新选择），卡片带在双击时限内冻住、那张原位变淡，
    // 第二下点中同一张就判成双击；在别处一按、按别的键或时限到了就解冻，按此刻的选择补画
    let settle: { key: string; card: HTMLElement; timer: number } | null = null;
    const endSettle = (): void => {
      const st = settle;
      if (!st) return;
      settle = null;
      clearTimeout(st.timer);
      st.card.classList.remove('pending');
      this.waiting = false;
      this.rosterKey = this.groupKey = '?';
      if (!this.boxing) {
        this.renderRoster(this.sel, this.screen, this.allPicked);
        this.renderGroups(this.sel);
      }
    };
    // 双击只认连续两下主键点按：在别处按下、按了非主键、按了别的键都打断（单按修饰键不算：按住 Shift 会连发 keydown）
    const interrupt = (e: Event): void => {
      if (e.type === 'keydown' && ['Shift', 'Control', 'Alt', 'Meta'].includes((e as KeyboardEvent).key)) return;
      // 卡片带上已有一根手指按着时，落在卡片带里的其它手指一律不理（同卡片带自己的处理），也不打断第一指的连点
      if (e.type === 'pointerdown' && down && (e as PointerEvent).pointerId !== down.pid && (area.contains(e.target as Node) || pressButton?.contains(e.target as Node) || this.groupButtons?.contains(e.target as Node))) return;
      const c = e.type === 'pointerdown' && (e as PointerEvent).button === 0 ? cardOf(e) : null;
      if (!c || cardKey(c) !== last.key) last = { t: 0, key: '' };
      if (settle && (!c || cardKey(c) !== settle.key)) endSettle();
    };
    window.addEventListener('pointerdown', interrupt, true);
    window.addEventListener('keydown', interrupt, true);
    const target = (x: number, y: number): 'view' | 'mini' | null => {
      const e = document.elementFromPoint(x, y);
      return e === this.minimap ? 'mini' : e instanceof HTMLCanvasElement && e.classList.contains('view') ? 'view' : null;
    };
    /** 指针在 (x, y) 时的落点：桌面版就是鼠标位置；移动版是剑尖，在手指外面（见 dropOffset） */
    const dropAt = (x: number, y: number): { x: number; y: number } => {
      if (!this.mobile) return { x, y };
      const o = dropOffset(y, this.overlay.getBoundingClientRect().bottom, this.mapSide);
      return { x: x + o.x, y: y + o.y };
    };
    /** 松手算不算下令：移动版里手指要离开按下处一段才算（见 DROP_ARM），拖回按下处松手即取消 */
    const armed = (from: { x: number; y: number }, x: number, y: number): boolean =>
      !this.mobile || Math.hypot(x - from.x, y - from.y) >= DROP_ARM;
    let at = { x: 0, y: 0 }, dragN = 0;
    /** recount：重算会出动的人数（拖出影子时、每次 update）；手指移动时人数不变，沿用（重算要遍历全部单位） */
    const place = (x: number, y: number, recount = false): void => {
      if (!ghost || !down || !down.card) return;
      at = { x, y };
      // 影子写此刻会出动的人数（拖拽中镜头移动、伤亡都会变）；一个人都没有就不能投放
      if (recount) dragN = this.cb.cardCount(kindOf(down.card), down.id);
      const n = dragN;
      const num = ghost.querySelector<HTMLElement>(kindOf(down.card) === 'all' ? '.ab b' : '.n')
        ?? (down.card.classList.contains('slot') ? ghost.querySelector<HTMLElement>('i') : null);
      if (num && num.textContent !== String(n)) num.textContent = String(n);
      const p = dropAt(x, y), ok = n > 0 && armed(down, x, y) && !!target(p.x, p.y);
      const scr = this.overlay.getBoundingClientRect();
      if (this.mobile) {
        // 卡片立在手指上方、左右居中（不伸出屏幕）：上沿在手指上方、离剑的长度差 SWORD_OUT，所以剑朝上时剑尖从卡片顶上伸出这么多；
        // 卡片比这段高，下沿压在手指下，露在手指上方的是卡片的内容。手指贴近屏幕顶时卡片停在顶栏下沿，不盖住顶栏，剑照旧指着落点
        const w = ghost.offsetWidth * TOUCH_GHOST_SCALE;
        const gx = Math.max(scr.left, Math.min(scr.right - w, x - w / 2));
        ghost.style.transform = `translate(${gx}px, ${Math.max(scr.top, topEdge, y - DROP_REACH + SWORD_OUT)}px) scale(${TOUCH_GHOST_SCALE})`;
      } else {
        // 卡片跟在鼠标右下方；靠右边、底边放不下时换到鼠标的左边、上边，不伸出屏幕
        const w = ghost.offsetWidth * GHOST_SCALE, h = ghost.offsetHeight * GHOST_SCALE;
        const gx = p.x + 14 + w <= scr.right ? p.x + 14 : p.x - 14 - w;
        const gy = p.y + 14 + h <= scr.bottom ? p.y + 14 : p.y - 14 - h;
        ghost.style.transform = `translate(${gx}px, ${gy}px) scale(${GHOST_SCALE})`;
      }
      ghost.classList.toggle('nodrop', !ok);
      // 剑图里剑尖朝左上、剑身沿 45° 斜下去：转到剑柄正对手指
      const turn = (Math.atan2(y - p.y, x - p.x) * 180) / Math.PI - 45;
      sword.style.transform = `translate(${p.x}px, ${p.y}px) rotate(${turn}deg)`;
      sword.classList.toggle('nodrop', !ok);
    };
    const stop = (): void => {
      if (!down) return;
      down.card?.classList.remove('hot');
      down.btn?.classList.remove('down');
      down = null;
      clearTimeout(holdTimer);
      ghost?.remove();
      ghost = null;
      this.overlay.classList.remove('dragging');
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
      // 只有按着这一下的那只鼠标真的补按了右键才作废它；别的指针（另一只鼠标、触屏长按弹的菜单事件）、
      // 键盘的菜单键（button 不是 2、buttons 里也没有右键）只拦菜单、不改这一按
      const pid = (e as PointerEvent).pointerId;
      if (!down?.mouse || (pid !== undefined && pid !== down.pid) || (e.button !== 2 && !(e.buttons & 2))) return;
      breakTap();
      // 按在卡片带按钮上时只作废这一下点按，卡片带仍归这根手指（同滑开）；按在卡片上的照旧取消这一按
      if (down?.btn) {
        down.voided = true;
        down.btn.classList.remove('down');
      } else stop();
    };
    /** 按住左键时补按了右键、中键（组合按键不发第二个 pointerdown）：同样打断连点、结束冻结 */
    const breakTap = (): void => {
      last = { t: 0, key: '' };
      endSettle();
    };
    const pointerDown = (e: PointerEvent): void => {
      // 已有一根手指按着时不理别的（按在卡片上、按钮上都一样）
      if (down) return;
      // 空队支持点按与长按；已有队员时还可以双击和拖动。
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (btn && (!btn.classList.contains('slot') || isEmptySlot(btn))) {
        if (e.button !== 0 || btn.disabled) return;
        down = { pid: e.pointerId, card: null, btn, x: e.clientX, y: e.clientY, add: false, id: -1, scroll0: area.scrollLeft, intent: 'wait', held: false,
          mouse: e.pointerType === 'mouse' };
        const press = down;
        if (isEmptySlot(btn) && this.cb.holdGroup) {
          holdTimer = window.setTimeout(() => {
            if (down !== press || press.voided || btn.hidden) return;
            press.held = true;
            this.cb.holdGroup?.(Number(btn.dataset.g));
          }, HOLD_MS);
        }
        this.held = true;
        btn.classList.add('down');
        area.setPointerCapture(e.pointerId);
        // 按住时补按右键：指针捕获在卡片带上，按钮自己拦不到右键菜单，由卡片带拦
        guardMenu();
        e.preventDefault();
        return;
      }
      let card = cardOf(e);
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
      down = { pid: e.pointerId, card, btn: null, x: e.clientX, y: e.clientY, add: e.shiftKey || e.ctrlKey || e.metaKey, id, scroll0: area.scrollLeft,
        intent: this.mobile && !card?.classList.contains('slot') ? (card ? 'wait' : 'scroll') : 'drag', held: false, mouse: e.pointerType === 'mouse' };
      clearTimeout(holdTimer);
      if (card) {
        const press = down;
        holdTimer = window.setTimeout(() => {
          if (down !== press || ghost || press.intent === 'scroll') return;
          press.held = true;
          // 冻结（DOUBLE_MS）总比长按（HOLD_MS）先结束：此时卡片可能已补画，量页面上的那张；整张没了就不弹
          const live = liveCard(card);
          if (!live || live.hidden) return;
          live.classList.remove('hot');
          if (live.classList.contains('slot') && this.cb.holdGroup) {
            this.cb.holdGroup(id);
            return;
          }
          if (isEmptySlot(live)) return;
          this.cb.holdCard(kindOf(live), id, live.getBoundingClientRect());
        }, HOLD_MS);
      }
      this.held = true;
      // 手指按住的那张先亮起来：还没拖出起手距离、卡片没跟上来之前，也看得出按中了
      if (this.mobile || card?.classList.contains('slot')) card?.classList.add('hot');
      area.setPointerCapture(e.pointerId);
      window.addEventListener('keydown', onKey, true);
      guardMenu();
      e.preventDefault();
    };
    this.resetGesture = () => {
      breakTap();
      if (!down) return;
      const pid = down.pid;
      cancel();
      if (area.hasPointerCapture(pid)) area.releasePointerCapture(pid);
    };
    area.addEventListener('pointerdown', pointerDown);
    pressButton?.addEventListener('pointerdown', pointerDown);
    const groupDown = (e: PointerEvent): void => {
      if (this.mobile && cardOf(e)) pointerDown(e);
    };
    const preventGroupMenu = (e: Event): void => e.preventDefault();
    this.groupButtons?.addEventListener('pointerdown', groupDown);
    this.groupButtons?.addEventListener('contextmenu', preventGroupMenu);
    this.cleanup.push(() => {
      pressButton?.removeEventListener('pointerdown', pointerDown);
      this.groupButtons?.removeEventListener('pointerdown', groupDown);
      this.groupButtons?.removeEventListener('contextmenu', preventGroupMenu);
    });
    area.addEventListener('pointermove', e => {
      if (!down || down.held || e.pointerId !== down.pid) return;
      // 按在按钮上滑开了、或补按了别的鼠标键：这一下不算点（去掉按下样子），但卡片带仍归这根手指，直到它抬起或被取消
      if (down.btn) {
        if (!down.voided && (e.buttons & ~1 || Math.hypot(e.clientX - down.x, e.clientY - down.y) > TAP_SLOP)) {
          down.voided = true;
          down.btn.classList.remove('down');
          if (e.buttons & ~1) breakTap();
        }
        return;
      }
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > CARD_SLOP) clearTimeout(holdTimer);
      // 按着左键再按别的键（右键、中键）：Pointer Events 里组合按键不发 pointerdown，只能从 buttons 看出来
      if (e.buttons & ~1) {
        breakTap();
        stop();
        return;
      }
      if (down.intent === 'wait') {
        down.intent = cardIntent(e.clientX - down.x, e.clientY - down.y);
        // 判成滚动：按中的那张不再亮着，免得看着像选中了它；这一按不再是点按，打断连点
        if (down.intent === 'scroll') {
          down.card?.classList.remove('hot');
          last = { t: 0, key: '' };
        }
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
        if (down.intent === 'wait' || !down.card) return;
        const slop = down.card.classList.contains('slot') ? CARD_SLOP : this.mobile ? 0 : 6;
        if (Math.hypot(e.clientX - down.x, e.clientY - down.y) < slop) return;
        last = { t: 0, key: '' };
        // 拖的正是刚取消选中、冻住的那张：先解冻补画；影子一律从页面上的那张克隆（人数按此刻会出动的人），
        // 卡片在补画中整张没了（这批人已不在卡片上）就放弃这次拖拽
        if (settle?.key === cardKey(down.card)) endSettle();
        const live = liveCard(down.card);
        if (!live) {
          stop();
          return;
        }
        down.card = live;
        // 窄队列使用队号和人数，拖出的影子要容得下头像和完整人数。
        const groupCard = live.classList.contains('slot')
          ? this.groupRow.querySelector<HTMLElement>(`[data-g="${down.id}"]`)
          : null;
        ghost = (groupCard ?? live).cloneNode(true) as HTMLElement;
        // 「选 N」角标与选中态不跟着走：松手后出动的是这张卡代表的全部人，不只是选着的那些
        ghost.removeAttribute('title');
        ghost.querySelector('.sel')?.remove();
        // 全选卡片上的士气说的也是选着的人，拖动时换回「拖去下令」
        const mor = ghost.querySelector('.mor');
        if (mor) {
          mor.className = 'nm';
          mor.textContent = '拖去下令';
        }
        ghost.classList.remove('hover', 'hot', 'on', 'slot');
        ghost.classList.add('ucard', 'ghost');
        // 拖拽期间顶栏盖过卡片与剑（样式表里按 dragging 提层级）：剑朝上伸进顶栏时不压住顶栏上的字
        this.overlay.classList.add('dragging');
        // 移动版顶栏的下沿：拖拽中的卡片不往上盖住它（没有顶栏就是 overlay 的上沿）
        topEdge = this.mobile && this.topbar ? this.topbar.getBoundingClientRect().bottom : -Infinity;
        this.overlay.appendChild(ghost);
        if (this.mobile) this.overlay.appendChild(sword);
        place(e.clientX, e.clientY, true);
        return;
      }
      place(e.clientX, e.clientY);
    });
    this.dragTick = () => {
      if (ghost) place(at.x, at.y, true);
    };
    area.addEventListener('pointerup', e => {
      // 只有占着卡片带的那根手指（或已没有按着的一下）松开才撤掉拦右键菜单：被忽略的其它手指抬起不算
      if (!e.buttons && (!down || e.pointerId === down.pid)) unguardMenu();
      const d = down;
      if (!d || e.button !== 0 || e.pointerId !== d.pid) return;
      if (d.btn) {
        stop();
        if (area.hasPointerCapture(e.pointerId)) area.releasePointerCapture(e.pointerId);
        // 按着空队时可能有人用快捷键为该队编组，原来的一按不覆盖新队伍。
        if (!d.held && !d.voided && !(d.btn as HTMLButtonElement).disabled && (!d.btn.classList.contains('slot') || isEmptySlot(d.btn))) {
          this.cb.tapButton?.(d.btn);
        }
        return;
      }
      const dragged = !!ghost, notTap = d.intent === 'scroll' || d.held;
      const p = dropAt(e.clientX, e.clientY), go = armed(d, e.clientX, e.clientY);
      stop();
      if (area.hasPointerCapture(e.pointerId)) area.releasePointerCapture(e.pointerId);
      // 空隙上按下、横向滚动了卡片带、或长按弹出了升级选择：不是点卡片
      if (!d.card || notTap || isEmptySlot(d.card)) return;
      const kind = kindOf(d.card);
      if (dragged) {
        const t = target(p.x, p.y);
        if (t && go && this.cb.cardCount(kind, d.id) > 0) this.cb.dropCard(kind, d.id, p.x, p.y, t);
        return;
      }
      // 队伍可能在两次界面刷新之间失去最后一人，旧卡片仍在时也不能清空当前选择。
      if (d.card.classList.contains('slot') && !this.cb.cardCount('group', d.id)) return;
      const now = performance.now(), key = keyOf(kind, d.id);
      const double = last.key === key && now - last.t < DOUBLE_MS;
      last = double ? { t: 0, key: '' } : { t: now, key };
      endSettle();
      // 单击亮着的卡片：先冻住卡片带（取消选中触发的重建不画，卡片不消失、不下移），再取消选中
      if (!double && !d.add && this.isLit(kind, d.id)) {
        d.card.classList.add('pending');
        this.waiting = true;
        settle = { key, card: d.card, timer: window.setTimeout(endSettle, DOUBLE_MS) };
        this.cb.unpickCard(kind, d.id);
        return;
      }
      if (kind === 'all') this.cb.pickAll(double ? 'map' : d.add ? 'add' : 'replace');
      else if (kind === 'group') this.cb.selectGroup(d.id, double);
      else if (double) this.cb.pickTypes([d.id], 'map');
      else this.cb.pickTypes([d.id], d.add ? 'toggle' : 'replace');
    });
    const cancelOwn = (e: PointerEvent): void => {
      if (down && e.pointerId === down.pid) cancel();
    };
    area.addEventListener('pointercancel', cancelOwn);
    area.addEventListener('lostpointercapture', cancelOwn);
    window.addEventListener('blur', cancel);
    this.cleanup.push(stop, () => {
      this.dragTick = null;
      if (settle) clearTimeout(settle.timer);
      window.removeEventListener('pointerdown', interrupt, true);
      window.removeEventListener('keydown', interrupt, true);
      clearTimeout(menuTimer);
      window.removeEventListener('contextmenu', onMenu, true);
      window.removeEventListener('blur', cancel);
    });
  }
}
