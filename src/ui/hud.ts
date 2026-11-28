/** 游戏内界面：顶栏、据点与援军、选中面板、指令按钮、战报、帮助与结算 */
import {
  BuildingDef, FactionDef, LEVELS, RES_KINDS, RES_NAMES, RES_SHORT, RULES, ResKind, SITE_CATEGORY_NAMES, SITE_INFO, SIZES, UNITS, unitKind,
} from '../sim/defs';
import { SITE_MAX_LEVEL, siteUpgradeCost, towerCount, unitUpgradeCost } from '../sim/systems/economy';
import { teamMoraleFactors } from '../sim/systems/morale';
import { unitEffects } from '../sim/systems/effects';
import { canRally, rallySites } from '../sim/rally';
import { fightState } from '../sim/siteArea';
import { campBatch, factionUnits, militaryLeft, pickedUnit, reinfPaused } from '../sim/systems/sites';
import { S_BRACE, S_CHARGE, S_COMBAT, S_SHIELD, S_TORCH, S_WALL, Site, World } from '../sim/world';
import { unitPortrait } from '../render/portrait';
import { WheelMode } from '../camInput';
import { TAP_SLOP, UiMode, swipeDir } from '../touchInput';
import { loadPref, savePref } from '../prefs';
import { CardBar, CardBarCallbacks } from './cardBar';
import { Joystick } from './joystick';
import { GroupSlots, GROUP_SLOTS } from './groupSlots';
import { ZoomSlider } from './zoomSlider';
import { bindPress } from './pressable';
import { auraPct, compactNum, effectText, num, rangeText, unitTip } from './unitText';

/** 城池、营寨名字后面的星数 = 据点等级；其他据点不能升级，不显示。compact：据点列表里写成「★3」省地方 */
function starsHtml(s: Site, compact = false): string {
  return SITE_INFO[s.type].upgradeCost > 0 ? ` <em>${compact ? `★${s.level}` : '★'.repeat(s.level)}</em>` : '';
}

/** 据点满级（3 级）时所含建筑各自的最高级升级（每种建筑一项）及它解锁的能力（炮弹、连弩），等级一行与升级提示共用 */
export function tier3Perks(w: World, s: Site): { def: BuildingDef; unlocks: string[] }[] {
  const out: { def: BuildingDef; unlocks: string[] }[] = [];
  for (const id of s.buildings) {
    const d = w.buildings[id].def, t = d.tier3;
    if (!t || out.some(o => o.def === d)) continue;
    out.push({ def: d, unlocks: [t.shells ? '炮弹' : '', t.arrowMul ? '连弩' : ''].filter(Boolean) });
  }
  return out;
}

/** 据点升到某一级的加成与解锁的能力，写给提示与等级一栏看 */
function levelPerks(w: World, s: Site, lv: number): string {
  const L = RULES.economy.siteLevels[lv - 1], sh = RULES.economy.shell;
  const out = [`建筑生命 ×${L.hp}、护甲 +${L.armor}，箭矢伤害 ×${L.dmg}、射程 ×${L.range}`];
  if (lv >= SITE_MAX_LEVEL) {
    for (const { def: d } of tier3Perks(w, s)) {
      const t = d.tier3!;
      const what = [t.shells ? `每轮加 ${t.shells} 发炮弹（伤害 ${sh.dmg}、范围 ${sh.splash}）` : '', t.arrowMul ? `箭矢 ×${t.arrowMul}` : ''].filter(Boolean).join('，');
      out.push(`${d.name}${t.name !== d.name ? `变${t.name}` : ''}：${what}`);
    }
  }
  return out.join('；');
}

/** 此刻可以点的升级：所选部队、全图全部部队、全图全部城池 / 营寨（null = 不显示这个按钮） */
export interface UpgradeOffers {
  /** 所选部队：黄金够升其中几人、要花多少 */
  sel: { count: number; cost: number; total: number } | null;
  /** 全图的己方部队 / 城池 / 营寨：资源够升其中几个、要花多少、一共还有几个能升 */
  all: { count: number; cost: number; total: number } | null;
  cities: { count: number; cost: number; total: number } | null;
  camps: { count: number; cost: number; total: number } | null;
}
export type UpgradeAction = 'sel' | 'all' | 'cities' | 'camps';

/**
 * 长按卡片弹出的一项升级：label 是按钮上的字，offer 是黄金够升几人、花多少（null = 一个也升不了），
 * total 是这批人里还能升的总数，need 是升其中最便宜的一人要多少金（黄金不足时告诉玩家差多少）
 */
export interface UpgradeChoice {
  label: string;
  offer: { count: number; cost: number } | null;
  total: number;
  need: number;
  /** 这一项一共代表多少人（含已是高级形态的）：0 是此刻没有人（如镜头里没有），与「都已升级」区分 */
  size: number;
  run(): void;
}

/** 长按卡片的升级选择由 Hud 弹出，不交给 game：game 只提供 upgradeChoices */
export interface HudCallbacks extends Omit<CardBarCallbacks, 'holdCard' | 'holdGroup' | 'tapButton'> {
  /** 长按卡片时可选的升级（见 UpgradeChoice） */
  upgradeChoices(kind: 'all' | 'type', id: number): UpgradeChoice[];
  command(cmd: 'amove' | 'stop' | 'hold' | 'rally' | 'unrally' | 'all' | 'torch' | 'outpost' | 'follow' | 'deselect'): void;
  /** 把所选部队编为第 g 队 */
  groupSlot(g: number): void;
  /** 长按全选或兵种卡片时，锁定卡片代表的部队，供选择队号。 */
  groupCard(kind: 'all' | 'type', id: number): { count: number; assign(g: number): void } | null;
  /** 移动版的缩放条：把镜头缩放到缩放条上的位置 f（0 = 最远、1 = 最近，见 camInput 的 fracToZoom） */
  zoomTo(f: number): void;
  /** 点了某个升级按钮 */
  upgrade(act: UpgradeAction): void;
  /** 选中一个据点（-1 = 取消） */
  selectSite(id: number): void;
  /** 对选中的据点：升级 / 建一座哨塔 / 营寨改选援军兵种（unit 是兵种下标） */
  siteAction(act: 'upgrade' | 'tower' | 'pick', id: number, unit?: number): void;
  /** 暂停 / 继续（继续用暂停前的速度） */
  togglePause(): void;
  /** 速度切到下一档（循环） */
  cycleSpeed(): void;
  focus(x: number, y: number): void;
  exit(): void;
  toggleSound(): boolean;
  soundOn(): boolean;
  toggleMusic(): boolean;
  musicOn(): boolean;
  /** 滚轮 / 双指滑动的解释方式（设置面板里改） */
  wheelMode(): WheelMode;
  setWheelMode(m: WheelMode): void;
  /** 浏览器支不支持锁定鼠标：不支持（iOS Safari）时设置里不显示这一项 */
  lockMouseSupported(): boolean;
  /** 锁定鼠标（光标出不了画面，甩到边就卷屏） */
  lockMouse(): boolean;
  setLockMouse(on: boolean): void;
  /** 「界面」设置：自动 / 桌面 / 移动 */
  uiMode(): UiMode;
  setUiMode(m: UiMode): void;
}

/** 升级框限高滚动时按一下 ↑ / ↓ 滚动的距离（约一项的高度） */
const UP_ARROW_STEP = 40;
/** 把升级框里的一项滚出来时多留的边距：键盘焦点环画在按钮外沿，贴着框的滚动边缘会被裁掉一半 */
const UP_REVEAL_PAD = 3;

/** 设置面板里「滚轮 / 双指」的选项 */
const WHEEL_MODES: { mode: WheelMode; label: string; tip: string }[] = [
  { mode: 'auto', label: '自动', tip: '自动判断是鼠标滚轮还是触控板（判断不准时改选另外两项）' },
  { mode: 'trackpad', label: '触控板', tip: '双指滑动平移镜头，捏合缩放，Option（Alt）+ 双指滑动旋转' },
  { mode: 'mouse', label: '鼠标', tip: '滚轮缩放镜头' },
];

/** 移动版的摇杆在哪一侧（小地图在另一侧），设置里改、会记住 */
export type StickSide = 'left' | 'right';

/** 设置面板里「界面」的选项 */
const UI_MODES: { mode: UiMode; label: string; tip: string }[] = [
  { mode: 'auto', label: '自动', tip: '触屏设备竖屏时用移动版，其余用桌面版' },
  { mode: 'desktop', label: '桌面', tip: '键鼠操作的桌面版界面' },
  { mode: 'mobile', label: '移动', tip: '竖屏触控的移动版界面（电脑上也可用，方便调试）' },
];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

const css = (c: [number, number, number]): string => `rgb(${c[0]},${c[1]},${c[2]})`;

export class Hud {
  readonly root: HTMLDivElement;
  readonly minimap: HTMLCanvasElement;
  /** 两版共用的编队卡片（观战时没有） */
  private slotRow: GroupSlots | null = null;
  /** 移动版摇杆旁的「取消选择」（观战时没有） */
  private deselBtn: HTMLButtonElement | null = null;
  /** 移动版的镜头摇杆（与小地图并排）：game 每帧读它的读数卷屏 */
  readonly stick = new Joystick();
  /** 移动版摇杆上方的缩放条：game 每帧把镜头的缩放同步给它 */
  readonly zoom: ZoomSlider;
  /** 移动版的摇杆在哪一侧 */
  private stickSide: StickSide = loadPref('stickSide') === 'right' ? 'right' : 'left';
  private readonly counts: HTMLDivElement;
  private readonly clock: HTMLSpanElement;
  /** 风向标：箭头指向风吹去的方向（随镜头旋转），无风时隐藏 */
  private readonly windBox: HTMLSpanElement;
  private readonly windArrow: HTMLElement;
  private windDeg = NaN;
  /** 据点面板：标题栏点一下（或按 L）收起 / 展开，列表在 sitesList 里定时重建 */
  private readonly sitesBox: HTMLDivElement;
  private readonly sitesList: HTMLDivElement;
  /** 设置面板（右上角「设置」按钮弹出） */
  private readonly settings: HTMLDivElement;
  /** 选中单个单位 / 据点时的详情（兵种栏上方） */
  private readonly selBox: HTMLDivElement;
  /** 详情的内容（定时重建），与关闭按钮分开放 */
  private readonly selBody: HTMLDivElement;
  /** 当前详情是谁（u + 单位 uid / s + 据点号，没有详情时空串），与用关闭按钮收起的那一个（再选一次才重新打开） */
  private detailKey = '';
  /** 上一次显示的详情是谁：换了对象时把内容滚回顶部 */
  private shownKey = '';
  /** 详情里营寨选兵那一排属于哪个据点（同一据点重建时保留横向滚动位置） */
  private picksFor = -1;
  private detailClosed = '';
  /** 长按卡片弹出的升级选择与它的各项 */
  private readonly upMenu: HTMLDivElement;
  /** 卡片带（移动版的升级选择以它的上沿为底） */
  private readonly cardwrap: HTMLDivElement;
  private readonly topbar: HTMLDivElement;
  private upChoices: { run(): void }[] = [];
  /** 升级选择是为哪张卡片弹的（开着时刷新用）与上次写入的内容 */
  /**
   * 长按的是哪张卡；dx / dy / w 是弹出时那张卡相对卡片带（cardwrap）的位置与宽度。
   * 摆位时先取那张卡此刻的位置（视口变了、卡片带重新排版了都跟着走），卡片已不在了才按卡片带的实时位置加这份偏移还原
   */
  private upFor: { kind: 'all' | 'type'; id: number; dx: number; dy: number; w: number; group: ReturnType<HudCallbacks['groupCard']> } | null = null;
  private upHtml = '';
  /** 键盘与指针各自按着升级框里的按钮（任一按着就不刷新报价）：分开记，一种输入的松开不解另一种的锁 */
  private upKeyHeld = false;
  private upPointerHeld = false;
  /** 按着确认期间选择变了：这一按结束时没成交就收起 */
  private upStale = false;
  /** 升级框限高滚动时的阅读位置（同一个框里跨过不限高也留着） */
  private upScroll = 0;
  /** 键盘（空格）按着确认的是哪一项：按下时定下，松开时按它成交 */
  private upKeyBtn: HTMLButtonElement | null = null;
  /** 启动这次键盘确认的是哪个键（空格 / Enter） */
  private upKeyName = '';
  /** 按着升级框的那个指针（只认它的抬起、取消、离开）；离开过升级框的这一按作废，随后的 click 不成交 */
  private upPointer: { pid: number; voided: boolean } | null = null;

  /** 升级选择上次重建时的各项（标题、有没有可升级的、各项的字）：没变就原地刷新 */
  private upShape = '';
  /** 兵种栏：屏幕内每个己方兵种一张卡片 */
  /** 底部的兵种卡片与编队卡片 */
  readonly cards: CardBar;
  private readonly cmdBtns = new Map<string, HTMLButtonElement>();
  /** 镜头正在跟随部队：「跟随」按钮高亮，没选部队时也能点它取消 */
  following = false;
  private readonly feed: HTMLDivElement;
  /** 战报最多几条：移动版只有 3 条 */
  private feedMax = 5;
  /** 移动版：抽屉手势、据点列表的点选方式、部分文案只在移动版生效（元素在桌面版里照样存在，不能只靠样式隐藏） */
  private mobile = false;
  /** 移动版：右上角「菜单」弹出的按钮组（桌面版里就是右上角的按钮组本身） */
  private readonly ctl: HTMLDivElement;
  private readonly menuBtn: HTMLButtonElement;
  /** 移动版的两个抽屉（据点列表在左、指令面板在右）与它们后面的遮罩 */
  private readonly drawers: { left: HTMLElement; right: HTMLElement };
  private readonly scrim: HTMLDivElement;
  private readonly modeTip: HTMLDivElement;
  private readonly help: HTMLDivElement;
  private readonly helpContent: HTMLDivElement;
  private readonly over: HTMLDivElement;
  private readonly pauseBtn: HTMLButtonElement;
  private readonly speedBtn: HTMLButtonElement;
  /** 最近一次的运行速度：暂停时速度按钮写它 */
  private runSpeed = 1;
  private soundBtn!: HTMLButtonElement;
  private readonly effectsSwitch = el('button');
  private readonly musicSwitch = el('button');
  private settingsBtn!: HTMLButtonElement;
  private readonly portraits = new Map<number, string>();
  private selKey = '?';
  private readonly dbg: HTMLSpanElement;
  private readonly envBox: HTMLSpanElement;
  private readonly foodBox: HTMLSpanElement;
  private readonly moraleBox: HTMLSpanElement;
  private readonly resBox: HTMLSpanElement;
  /** 指令面板里的「升级」一栏 */
  private readonly upBar: HTMLDivElement;
  private readonly upHead: HTMLElement;
  private upKey = '';
  private sitesHtml = '';
  /** 有可取消的选择（部队或据点）、正处于指令模式：两个「取消选择」据此可按 */
  private hasSel = false;
  private inMode = false;
  /** 挂在 window 上的监听，销毁时摘掉 */
  private readonly disposers: (() => void)[] = [];

  constructor(private readonly host: HTMLElement, private readonly world: World, private readonly teamRgb: [number, number, number][],
    private readonly cb: HudCallbacks) {
    const root = (this.root = el('div', 'hud'));
    host.appendChild(root);
    const human = world.humanTeam;

    // ---- 顶栏 ----
    const top = (this.topbar = el('div', 'panel topbar'));
    this.counts = el('div', 'counts');
    this.clock = el('span', 'clock', '00:00');
    this.dbg = el('span', 'dbg');
    this.envBox = el('span', 'env');
    this.windBox = el('span', 'wind', '<i>➤</i><b></b>');
    this.windArrow = this.windBox.firstElementChild as HTMLElement;
    this.foodBox = el('span', 'food');
    this.moraleBox = el('span', 'morale');
    this.resBox = el('span', 'res');
    this.menuBtn = el('button', 'menubtn mobile-only', '菜单');
    this.menuBtn.setAttribute('aria-label', '菜单');
    top.append(this.counts, this.clock, this.envBox, this.windBox, this.foodBox, this.resBox, this.moraleBox, this.dbg, this.menuBtn);
    root.appendChild(top);

    const ctl = (this.ctl = el('div', 'panel ctl'));
    this.menuBtn.onclick = () => this.setMenu(!ctl.classList.contains('open'));
    // 点菜单里的按钮后收起（速度按钮除外：要连点几下切到想要的速度）；点菜单与「菜单」按钮以外的地方也收起
    ctl.addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest('button');
      if (b && b !== this.speedBtn) this.setMenu(false);
    });
    const closeMenu = (e: PointerEvent): void => {
      if (!ctl.classList.contains('open') || ctl.contains(e.target as Node) || this.menuBtn.contains(e.target as Node)) return;
      this.setMenu(false);
    };
    window.addEventListener('pointerdown', closeMenu, true);
    this.disposers.push(() => window.removeEventListener('pointerdown', closeMenu, true));
    // 暂停是开关；速度是一个按钮，每点一下切到下一档（暂停中点它也接着走，用切到的速度）
    this.pauseBtn = el('button', '', '暂停');
    this.pauseBtn.title = '暂停 / 继续（空格）';
    this.pauseBtn.onclick = () => cb.togglePause();
    this.speedBtn = el('button', 'speed', '1×');
    this.speedBtn.title = '切换速度：1× → 2× → 4×（+ / − 也可调）';
    this.speedBtn.onclick = () => cb.cycleSpeed();
    ctl.append(this.pauseBtn, this.speedBtn);
    const fs = el('button', '', '全屏');
    fs.onclick = () => {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen();
    };
    // iPhone 的 Safari 没有全屏接口：不放这个按钮（不用 hidden 占着位置，移动版菜单按网格排，靠子元素个数让「退出」铺满末行）
    const canFullscreen = !!document.documentElement.requestFullscreen;
    this.soundBtn = el('button', '', '');
    this.soundBtn.title = '开 / 关音效（M）';
    this.soundBtn.onclick = () => this.setSound(cb.toggleSound());
    const hb = el('button', '', '帮助');
    hb.onclick = () => this.toggleHelp();
    const sb = (this.settingsBtn = el('button', '', '设置'));
    const xb = el('button', '', '退出');
    xb.onclick = () => cb.exit();
    ctl.append(...(canFullscreen ? [fs] : []), this.soundBtn, sb, hb, xb);
    root.appendChild(ctl);

    // ---- 设置面板 ----
    this.settings = el('div', 'panel settings');
    this.settings.hidden = true;
    this.buildSettings();
    sb.onclick = () => {
      if (this.settingsOpen) this.closeSettings();
      else {
        this.settings.hidden = false;
        sb.classList.add('on');
        this.syncScrim();
      }
    };
    // 点面板与「设置」按钮以外的地方收起
    const closeSettings = (e: PointerEvent): void => {
      if (this.settings.hidden || this.settings.contains(e.target as Node) || sb.contains(e.target as Node)) return;
      this.closeSettings();
    };
    window.addEventListener('pointerdown', closeSettings, true);
    this.disposers.push(() => window.removeEventListener('pointerdown', closeSettings, true));
    root.appendChild(this.settings);

    // ---- 据点与援军 ----
    this.sitesBox = el('div', 'panel sites');
    const head = el('button', 'fold', '<b>据点与援军</b><i>L</i>');
    head.title = '收起 / 展开据点列表（L）';
    head.onclick = () => this.toggleSites();
    this.sitesList = el('div', 'list');
    this.sitesBox.append(head, this.sitesList);
    if (loadPref('sitesFolded') === '1') this.sitesBox.classList.add('folded');
    // 列表会被定时重建，用事件委托响应点击
    const pickSite = (id: number): void => {
      const s = world.sites[id];
      cb.focus(s.x, s.y);
      cb.selectSite(s.id);
      // 移动版：选好了收起抽屉，露出镜头跳到的地方
      this.openDrawer(null);
    };
    const rowId = (e: Event): number => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('[data-id]');
      return row ? Number(row.dataset.id) : -1;
    };
    // 移动版里手指在列表上按下可能是要滚动：触屏记下按下的行，没怎么动就抬起才算点（列表会定时重建，不能靠 click）；桌面版与鼠标按下即选
    let touchRow: { pid: number; id: number; x: number; y: number } | null = null;
    this.sitesList.onpointerdown = e => {
      const id = rowId(e);
      if (id < 0) return;
      if (e.pointerType === 'mouse' || !this.mobile) pickSite(id);
      else touchRow = { pid: e.pointerId, id, x: e.clientX, y: e.clientY };
    };
    this.sitesList.onpointerup = e => {
      const t = touchRow;
      touchRow = null;
      if (t && t.pid === e.pointerId && Math.hypot(e.clientX - t.x, e.clientY - t.y) <= TAP_SLOP) pickSite(t.id);
    };
    this.sitesList.onpointercancel = () => {
      touchRow = null;
    };
    // 右侧一列：上面据点列表（占满剩下的高度），下面指令面板
    const right = el('div', 'rightcol');
    right.appendChild(this.sitesBox);
    root.appendChild(right);

    // ---- 小地图 ----
    const mm = el('div', 'panel mini');
    this.minimap = el('canvas');
    if (human) {
      const row = new GroupSlots(world, t => this.portrait(t, world.humanTeam), (g, occupied) => {
        if (this.cards.busy) return;
        if (!occupied) cb.groupSlot(g);
        else if (cb.cardCount('group', g)) cb.selectGroup(g, true);
      });
      this.slotRow = row;
      this.disposers.push(() => row.destroy());
    } else host.classList.add('watch');
    const mmRow = el('div', 'minirow');
    const joyCol = el('div', 'joycol mobile-only');
    this.zoom = new ZoomSlider(f => cb.zoomTo(f));
    this.disposers.push(() => this.stick.destroy());
    const joyPad = el('div', 'joypad');
    joyPad.appendChild(this.stick.el);
    joyCol.append(this.zoom.el, joyPad);
    mmRow.appendChild(joyCol);
    if (human) {
      // 移动版里点空地是下令，取消选择靠按钮：常用，所以在指令面板之外，在摇杆旁再放一个
      const b = (this.deselBtn = el('button', 'desel mobile-only', '<b>✕</b>取消<br>选择'));
      b.setAttribute('aria-label', '取消选择');
      // 手指由卡片带受理（与卡片共用「一次只认一根手指」：拖卡片时另一指按它不响应，先按住它时也拖不了卡片），见 CardBar 的 tapButton；
      // 键盘（Enter / 空格）与读屏软件的激活只发 click（detail 为 0）
      b.addEventListener('click', e => {
        if (e.detail === 0 && !b.disabled && !this.cards.busy) cb.command('deselect');
      });
      b.addEventListener('contextmenu', e => e.preventDefault());
      joyPad.appendChild(b);
    }
    mmRow.appendChild(this.minimap);
    mm.appendChild(mmRow);
    root.appendChild(mm);

    // ---- 底部中央：上面是详情（选中单个单位 / 据点时），下面是兵种栏 ----
    const bottom = el('div', 'bottom');
    this.selBox = el('div', 'panel detail');
    this.selBox.hidden = true;
    // 移动版详情浮在卡片带上边，右上角的关闭只收起详情
    const close = el('button', 'dclose mobile-only', '✕');
    close.setAttribute('aria-label', '关闭详情');
    this.disposers.push(bindPress(close, {
      tap: () => this.suppressDetail(),
    }));
    this.selBody = el('div', 'dbody');
    this.selBox.append(close, this.selBody);
    // 面板内容会被定时重建，按钮用事件委托。
    // 注意防连击：点一下升级，面板同步重建，同一位置立刻换成「升到下一级」的按钮，双击就会连升两级；e.detail > 1 是连续的第二下起，一律不响应
    this.selBox.addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
      if (b && !b.disabled && (e.detail <= 1 || b.dataset.act === 'pick')) cb.siteAction(b.dataset.act as 'upgrade' | 'tower' | 'pick', Number(b.dataset.site), b.dataset.unit === undefined ? undefined : Number(b.dataset.unit));
    });
    // 桌面版在兵种卡片上方显示编队卡片；移动版把它们移到单独一行
    const cardwrap = (this.cardwrap = el('div', 'cardwrap'));
    this.cards = new CardBar(world, (t, team) => this.portrait(t, team), this.minimap, root,
      {
        ...cb,
        holdCard: (kind, id, rect) => this.showUpgradeMenu(kind, id, rect),
        holdGroup: g => cb.groupSlot(g),
        tapButton: b => b.dataset.g === undefined ? cb.command('deselect') : cb.groupSlot(Number(b.dataset.g)),
      }, cardwrap, top, this.deselBtn, this.slotRow?.el ?? el('div', 'groupslots'));
    // 长按卡片弹出的升级选择：点它以外的地方收起
    this.upMenu = el('div', 'panel upmenu');
    this.upMenu.hidden = true;
    // 焦点停在弹出框本身时能接键盘（tabIndex -1：不进 Tab 次序，只作项目失效时焦点的落脚处）
    this.upMenu.tabIndex = -1;
    // 键盘按着空格 / Enter 期间同样锁住报价（空格在抬起时才点下去）；焦点在弹出框里时这两个键不交给游戏
    // 键盘确认：按下时就定下是哪一项（upKeyBtn，按下时的报价也就锁住了），松开在 window 上收（不论焦点此时在哪）——
    // 焦点被别的指针抢走不影响这一按；按着期间按了 Tab 是玩家主动移开，取消这一按。
    // 空格的激活由这里自己做（松开时成交），不交给浏览器；Enter 照旧原生（按下即激活，click 的 detail 为 0）
    this.upMenu.addEventListener('keydown', e => {
      // 限高滚动时 ↑ / ↓ 滚框里的选项，不交给游戏挪镜头；没限高时框不滚，照旧挪镜头
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && this.upMenu.style.maxHeight) {
        e.preventDefault();
        e.stopPropagation();
        this.upMenu.scrollTop += e.key === 'ArrowDown' ? UP_ARROW_STEP : -UP_ARROW_STEP;
        this.upScroll = this.upMenu.scrollTop;
        return;
      }
      if (e.key !== ' ' && e.key !== 'Enter') return;
      const b = e.target instanceof HTMLButtonElement ? e.target.closest<HTMLButtonElement>('button[data-i]') : null;
      // 限高滚动时焦点所在的那一项被滚出了视野：这一按只把它滚出来、不确认，看清报价再按一次（免得对着看不见的项成交）
      // 没开启确认的那一按（如上面只滚出了项）按住不放：自动重复的按下也不激活
      if (b && e.repeat && !this.upKeyHeld) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (b && !e.repeat && !this.upKeyHeld && this.revealUpItem(b)) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (b) {
        const busy = this.upKeyHeld;
        if (!e.repeat && !busy) {
          this.upKeyHeld = true;
          this.upKeyName = e.key;
          this.upKeyBtn = e.key === ' ' ? b : null;
        }
        // 已有一次键盘确认在进行（如按着空格）时再按别的确认键：不激活（Enter 的原生激活会绕过上面的可见检查，直接成交），
        // 这次确认仍归原来那个键、原来那一项
        if (e.key === ' ' || busy) e.preventDefault();
      } else e.preventDefault();
      e.stopPropagation();
    });
    const keyDownAnywhere = (e: KeyboardEvent): void => {
      if (e.key === 'Tab' && this.upKeyHeld) {
        this.upKeyHeld = false;
        this.upKeyBtn = null;
        // 选择早变过、又没有指针在按：同步收起，不让过期的那几项在下一次刷新前还能点成交
        if (this.upStale && !this.upPointerLive()) this.closeUpgradeMenu();
      }
    };
    const keyUpAnywhere = (e: KeyboardEvent): void => {
      // 只有启动这次确认的那个键松开才结束它（先按住别的键、后来松开的不算）
      if (!this.upKeyHeld || e.key !== this.upKeyName) return;
      const b = this.upKeyBtn;
      this.upKeyHeld = false;
      this.upKeyBtn = null;
      if (e.key === ' ' && b && !b.disabled && !this.upMenu.hidden && this.upMenu.contains(b)) {
        this.upChoices[Number(b.dataset.i)]?.run();
        this.closeUpgradeMenu();
        return;
      }
      // 按着期间选择变过、这一按没成交：指针也没在按就收起
      if (this.upStale && !this.upPointerLive()) this.closeUpgradeMenu();
    };
    window.addEventListener('keydown', keyDownAnywhere, true);
    window.addEventListener('keyup', keyUpAnywhere, true);
    this.disposers.push(() => {
      window.removeEventListener('keydown', keyDownAnywhere, true);
      window.removeEventListener('keyup', keyUpAnywhere, true);
    });
    const releaseUp = (): void => {
      this.upKeyHeld = this.upPointerHeld = false;
      this.upKeyBtn = null;
      this.upPointer = null;
      if (this.upStale) this.closeUpgradeMenu();
    };
    window.addEventListener('blur', releaseUp);
    this.disposers.push(() => window.removeEventListener('blur', releaseUp));
    // 手指按在弹出框上期间不刷新它：刷新会重建按钮，按下与抬起之间换掉按钮就丢了这一下
    this.upMenu.addEventListener('pointerdown', e => {
      if (this.upPointer) return;
      const pid = e.pointerId;
      // 只有按在能点的那一项上、可能成交的这一按才登记并锁住报价；按在标题、空白处或不能点的项上什么也不锁，
      // 免得它撑着报价不刷新（选择变了也不收起），让人改用键盘买到过期的那批
      const pressed = e.button === 0 ? (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-i]') : null;
      if (!pressed || pressed.disabled) return;
      this.upPointer = { pid, voided: false };
      this.upPointerHeld = true;
      // 松开、取消可能落在升级框外（按着移出去再松手）：在 window 上等这个指针的结束，不论落在哪都收尾
      // 按着时按实际坐标看是否出了升级框（触屏有隐式捕获，pointerleave 要到松手才来），或补按了别的鼠标键：都作废这一按并放开报价锁
      const move = (ev: PointerEvent): void => {
        const p = this.upPointer;
        if (ev.pointerId !== pid || p?.pid !== pid || p.voided) return;
        const r = this.upMenu.getBoundingClientRect();
        const out = ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom;
        if (out || ev.buttons & ~1) this.voidUpPointer();
      };
      const end = (ev: PointerEvent): void => {
        if (ev.pointerId !== pid) return;
        window.removeEventListener('pointermove', move, true);
        window.removeEventListener('pointerup', end, true);
        window.removeEventListener('pointercancel', end, true);
        const p = this.upPointer;
        if (p?.pid !== pid) return;
        this.upPointer = null;
        this.upPointerHeld = false;
        // 指针点按在松开这一刻直接成交，不等 click（触屏的 click 由点按手势异步合成，时序靠不住）：
        // 没离开过升级框、松开处还是按下的那一项（触屏有隐式捕获，target 总是按中的元素，所以按坐标取）、那一项还能点
        // 只认左键的松开（组合按键时最后松开的可能是中键 / 右键）
        const at = !p.voided && ev.type === 'pointerup' && ev.button === 0 && pressed
          ? document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLButtonElement>('button[data-i]') : null;
        if (pressed && at === pressed && !pressed.disabled && this.upMenu.contains(pressed)) {
          this.upChoices[Number(pressed.dataset.i)]?.run();
          this.closeUpgradeMenu();
        } else if (this.upStale && !this.upKeyHeld) this.closeUpgradeMenu(); // 键盘还按着确认：等它结束再定
      };
      window.addEventListener('pointermove', move, true);
      window.addEventListener('pointerup', end, true);
      window.addEventListener('pointercancel', end, true);
    });
    // 按着时移出升级框：这一按作废（放开报价锁，移回再松手也不成交，免得同一按悄悄按新价成交）
    this.upMenu.addEventListener('pointerleave', e => {
      if (this.upPointer?.pid !== e.pointerId) return;
      this.voidUpPointer();
    });
    // click 只处理键盘与读屏的激活（detail 为 0）；指针点按在上面的松开收尾里成交，指针产生的 click 一律不理（也挡掉没拿到报价锁的其它触点）
    this.upMenu.addEventListener('click', e => {
      if (e.detail !== 0) return;
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-i]');
      if (!b || b.disabled) return;
      this.upChoices[Number(b.dataset.i)]?.run();
      this.closeUpgradeMenu();
    });
    // 点在画面或小地图上收起时，这一下只收起、不落到画面上下令（同遮罩）；点在别的卡片上照常开始新的一按
    const closeUp = (e: PointerEvent): void => {
      if (this.upMenu.hidden || this.upMenu.contains(e.target as Node)) return;
      // 有一根手指正按着升级框里的报价确认：别的手指按到框外不收起、也不拦（照常落到画面上），确认归按着的那根手指
      // （移出过、已作废的那一按不算，它已不能成交）
      if (this.upPointerLive() && this.upPointer!.pid !== e.pointerId) return;
      // 键盘正按着确认：同样不收起、不拦（这一按抢走焦点也不影响键盘确认，松开在 window 上收）
      if (this.upKeyHeld) return;
      this.closeUpgradeMenu();
      const t = e.target as HTMLElement;
      if (t === this.minimap || (t instanceof HTMLCanvasElement && t.classList.contains('view'))) {
        e.stopPropagation();
        e.preventDefault();
      }
    };
    window.addEventListener('pointerdown', closeUp, true);
    this.disposers.push(() => window.removeEventListener('pointerdown', closeUp, true));
    this.disposers.push(() => this.cards.destroy());
    if (this.slotRow) cardwrap.appendChild(this.slotRow.el);
    cardwrap.appendChild(this.cards.roster);
    bottom.append(this.selBox, cardwrap);
    root.appendChild(bottom);
    root.appendChild(this.upMenu);

    // ---- 右下：指令面板，分「部队」「援军」「升级」三栏 ----
    const cmds = el('div', 'panel cmds');
    const btn = (name: string, key: string, cmd: Parameters<HudCallbacks['command']>[0], tip: string): HTMLButtonElement => {
      const b = el('button', '', `<b>${name}</b><i>${key}</i>`);
      b.title = tip;
      b.onclick = () => {
        cb.command(cmd);
        this.openDrawer(null);
      };
      this.cmdBtns.set(cmd, b);
      return b;
    };
    const section = (title: string, ...items: HTMLElement[]): HTMLDivElement => {
      const sec = el('div', 'csec');
      sec.append(el('h3', '', title), ...items);
      return sec;
    };
    if (human) {
      const unit = el('div', 'cgrid');
      unit.append(
        btn('攻击移动', 'F', 'amove', '行军途中遇敌即战、见敌方建筑就打'),
        btn('停止', 'X', 'stop', '停止当前行动'),
        btn('坚守', 'H', 'hold', '原地坚守，不追击'),
        btn('火把', 'T', 'torch', '点燃 / 熄灭所选部队的火把：点着看得远，也更容易被发现'),
        btn('扎营', 'B', 'outpost', `派所选部队到指定位置搭一座临时据点（木材 ${RULES.economy.outpostCost}，最多 ${RULES.economy.outpostMax} 座）：部队在里面休整回血，被毁不会重生`),
        btn('跟随', 'C', 'follow', '镜头平滑地跟着所选部队走；再按一次、或手动移动镜头即取消'),
        btn('全军', 'Ctrl+A', 'all', '选中全图的全部部队'),
        btn('取消选择', 'Esc', 'deselect', '退出指令模式并取消选择（部队和据点）；移动版里点空地是下令，取消选择靠它'),
      );
      this.cmdBtns.get('deselect')!.classList.add('mobile-only');
      const reinf = el('div', 'cgrid');
      reinf.append(
        btn('集结点', 'R', 'rally', '设置援军集结点：选中己方据点时只设它的，没选据点时给全部据点设；之后新出的援军自动开赴那里（已经出来的部队不受影响）'),
        btn('取消集结', '⇧R', 'unrally', '取消集结点：选中己方据点时只取消它的，没选据点时全部取消；之后新出的援军留在据点里驻守'),
      );
      this.upBar = el('div', 'upbar');
      // 同样要防连击：「城池 / 营寨全部升级」点一下就重建按钮，双击会连升两级
      this.upBar.onclick = e => {
        const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-up]');
        if (b && e.detail <= 1) cb.upgrade(b.dataset.up as UpgradeAction);
      };
      const up = section('升级', this.upBar);
      this.upHead = up;
      up.hidden = true;
      cmds.append(section('部队', unit), section('援军', reinf), up);
    } else {
      this.upBar = el('div');
      this.upHead = this.upBar;
      cmds.appendChild(el('div', 'hint', '观战模式'));
    }
    right.appendChild(cmds);

    // ---- 移动版的抽屉：据点列表从左、指令面板从右滑出，上半屏两侧边缘各一个把手 ----
    this.drawers = { left: this.sitesBox, right: cmds };
    this.sitesBox.classList.add('drawer', 'left');
    cmds.classList.add('drawer', 'right');
    this.scrim = el('div', 'scrim');
    // 遮罩盖住画面：点菜单、设置、抽屉以外的地方只收起它们，这一下不落到画面上下令
    this.scrim.onpointerdown = e => {
      e.preventDefault();
      this.openDrawer(null);
      this.setMenu(false);
      this.closeSettings();
    };
    root.appendChild(this.scrim);
    // 观战时指令面板里只有一句「观战模式」，移动版不放拉它出来的把手
    for (const side of human ? ['left', 'right'] as const : ['left'] as const) {
      const h = el('div', `handle mobile-only ${side}`, '<i></i>');
      h.setAttribute('role', 'button');
      h.setAttribute('aria-label', side === 'left' ? '据点列表' : '指令面板');
      h.setAttribute('aria-expanded', 'false');
      this.bindDrawerGestures(h, side, true);
      this.bindDrawerGestures(this.drawers[side], side, false);
      root.appendChild(h);
    }

    this.feed = el('div', 'feed');
    this.modeTip = el('div', 'modetip');
    root.append(this.feed, this.modeTip);
    // 战报接在提示条下面：提示条换行（屏宽变了、文字变了）时跟着更新它的高度
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => {
        this.syncTipHeight();
        // 桌面版底部（详情与卡片）上边不越过顶栏
        this.root.style.setProperty('--topbar', `${this.topbar.offsetHeight + 8}px`);
      });
      ro.observe(this.modeTip);
      ro.observe(this.topbar);
      this.disposers.push(() => ro.disconnect());
    }

    // ---- 帮助 ----
    this.help = el('div', 'overlay help', `
      <div class="panel card" role="dialog" aria-labelledby="help-title">
        <div class="help-content" tabindex="0">
          <h2 id="help-title">快速上手</h2>
          <p class="help-goal">丢光城池和营寨的一方战败：攻占敌方所有城池与营寨即可获胜。</p>
          <table class="mobile-only" aria-label="触屏基本操作">
            <tr><th scope="row">点己方单位 / 据点</th><td>点己方单位选中它；没选部队时，点据点选中据点</td></tr>
            <tr><th scope="row">单指拖动</th><td>框选部队</td></tr>
            <tr><th scope="row">单击 / 双击地面</th><td>已选部队攻击移动 / 普通移动</td></tr>
            <tr><th scope="row">点敌军 / 可攻击的建筑</th><td>已选部队直接攻击目标</td></tr>
            <tr><th scope="row">长按地面</th><td>攻击移动</td></tr>
            <tr><th scope="row">双指捏合 / 拧转</th><td>缩放 / 旋转镜头</td></tr>
            <tr><th scope="row">推摇杆 / 拖动或点小地图</th><td>移动镜头</td></tr>
            <tr><th scope="row">摇杆上方的缩放条</th><td>拖动滑块或点在条上缩放镜头（往右拉近）；点两端的 − / + 缩放一档</td></tr>
            <tr><th scope="row">卡片拖到地图上</th><td>剑尖指着的地方是落点：这批人攻击移动过去，松在敌军身上则攻击它</td></tr>
            <tr><th scope="row">点亮着的全选或兵种卡片 / 长按这两种卡片</th><td>取消选中它代表的人 / 弹出升级选择（花黄金升为高级形态）</td></tr>
            <tr><th scope="row">编队 1～${GROUP_SLOTS}</th><td>空队点一下编入所选部队；已有队伍点一下选中并跳到队伍。长按编队卡片把所选部队编为该队（替换原队员）；长按兵种卡片后也可选队号</td></tr>
            <tr><th scope="row">两侧边缘的把手</th><td>拉出据点列表 / 指令面板</td></tr>
          </table>
          <table class="desktop-only" aria-label="基本操作">
            <tr><th scope="row">左键点己方单位 / 拖框</th><td>选择部队</td></tr>
            <tr><th scope="row">左键单击 / 双击地面</th><td>已选部队立即攻击移动 / 普通移动</td></tr>
            <tr><th scope="row">右键点地面</th><td>命令部队移动</td></tr>
            <tr><th scope="row">左键或右键点敌军 / 可攻击的建筑</th><td>命令部队直接攻击目标</td></tr>
            <tr><th scope="row">WASD / 滚轮</th><td>移动镜头 / 缩放</td></tr>
          </table>
          <details>
            <summary>详细操作与规则</summary>
            <table class="desktop-only">
              <tr><td>左键点己方单位 / 拖框</td><td>选择部队（Shift 加选，双击单位选中同类）</td></tr>
              <tr><td>底部兵种卡片</td><td>没选中的卡片写屏幕内的人数，选中后改写选中的人数、不再随镜头变化。点击：选中屏幕内这个兵种（已选中的卡片则取消选中）；Shift 加选 / 去掉；双击：选中全图的这个兵种；按住不动：弹出升级选择；按住拖到地面或小地图上松开：这个兵种攻击移动过去，松在敌军身上则攻击它（右键或 Esc 取消）。从画面上拉框扫过卡片：一并选中这些兵种。选中的兵种卡片会上前一步</td></tr>
              <tr><td>全选卡片</td><td>兵种栏最左一张，写屏幕内的总人数；屏幕内的人全都选着时上前一步，改写选中的人数、不再随镜头变化。点击：选中屏幕内的全部部队（已选中时取消选择）；Shift 加选；按住不动：弹出升级选择；双击：选中全图的部队；拖动、框扫同兵种卡片</td></tr>
              <tr><td>右键地面</td><td>移动（编队行军，自动列阵：近战在前、远程居后、器械殿后）</td></tr>
              <tr><td>右键按住拖动</td><td>在按下处列阵，面朝拖动的方向（原地拖动即原地转向重排）</td></tr>
              <tr><td>右键敌军 / 敌方建筑</td><td>攻击（中立的军事建筑会放箭，也直接右键就打；Ctrl+右键可强攻中立的城墙、门楼、木栅、营门；带着器械或战象时，中立的城墙、门楼直接右键就砸；普通建筑不可攻击）</td></tr>
              <tr><td>F + 左键</td><td>攻击移动：沿途遇敌即战、见敌方建筑就打，遇墙自动破城；点在敌方建筑上则直接攻打它</td></tr>
              <tr><td>X / H</td><td>停止 / 坚守</td></tr>
              <tr><td>R + 左键</td><td>设置援军集结点（只对之后新出的援军有效）：选中己方据点时只设它的，没选据点时给全部据点设；据点易主后集结点清除</td></tr>
              <tr><td>Shift + R</td><td>取消集结点，新出的援军留在据点里：选中己方据点时只取消它的，没选据点时全部取消</td></tr>
              <tr><td>T</td><td>点燃 / 熄灭所选部队的火把（夜间）</td></tr>
              <tr><td>B + 左键</td><td>扎营：派所选部队去搭一座临时据点（耗木材）</td></tr>
              <tr><td>没选部队时左键点据点</td><td>选中据点：升级城池、营寨，或给资源点建哨塔；己方营寨还可以选出哪个兵种</td></tr>
              <tr><td>Ctrl 或 Alt+数字 / 数字</td><td>编队 / 选中编队（连按两次跳转镜头）</td></tr>
              <tr><td>编队卡片</td><td>点击选中这一队并跳转镜头。长按把当前选择编为该队（替换原队员）；长按全选或兵种卡片可为卡片上的部队选队号</td></tr>
              <tr><td>Shift+数字</td><td>追加编队：把当前选中的部队并入该队</td></tr>
              <tr><td>鼠标顶到屏幕最外沿、W A S D / 方向键、小地图</td><td>移动镜头（压在界面上也卷；鼠标冲出网页会接着往那边卷，回来即停）</td></tr>
              <tr><td>滚轮、捏合、PageUp / PageDown</td><td>缩放（Mac 上 PageUp / PageDown 是 fn + ↑ / ↓）</td></tr>
              <tr><td>触控板双指滑动</td><td>平移镜头；Option（Alt）+ 双指滑动旋转。识别不准时在右上角「设置」里指定是鼠标还是触控板</td></tr>
              <tr><td>L</td><td>收起 / 展开右上的据点列表</td></tr>
              <tr><td>C</td><td>镜头跟随所选部队（平滑跟着部队走）；再按一次、或手动移动镜头即取消</td></tr>
              <tr><td>中键拖动、Q / E</td><td>旋转镜头（上下拖动调俯角）；Shift+中键拖动平移；Home 复位</td></tr>
              <tr><td>空格 / + −　M</td><td>暂停 / 调整速度　开关音效</td></tr>
            </table>
            <p><b>占领据点：</b>敌占或中立的据点要先拆光全部军事建筑（会放箭的角楼、哨塔、主堡、中军帐）；再肃清据点范围内的守军（有围墙的是围墙圈出的矩形，其余是圆圈），派人站到中央旗帜下读秒；敌人回到范围内读秒暂停，旗下没人则清零。占领后据点定时出援军（这个据点设了集结点就开赴集结点，没设就留在据点里），被毁的建筑也会修好。</p>
            <p><b>攻坚：</b>士兵和骑兵打建筑是扔火把——营寨的木栅一烧就垮，城池的石墙只有器械与战象能破（门楼、营门不放箭；角楼、主堡和营寨的哨塔、中军帐会放箭，可以慢慢烧毁）。在自家城池里待命的远程步兵会自动登城驻守（每格墙顶三人），看到射程外的敌人会沿墙顶挪过去；在墙上射得更远、挨箭更轻（下别的命令即下墙）；别的兵种上不了墙，据点里的近战守军不出城，挨了敌方远程的打才出击。</p>
            <p>高地上的远程部队射程与伤害更高；森林减免远程伤害并拖慢骑兵；浅滩可涉水但行动迟缓。</p>
            <p><b>士气：</b>敌众我寡、伤亡惨重、断粮、淋雨都会压低士气，士气见底的部队会溃逃（头顶一面小白旗，防御大减），逃回最近的己方据点才恢复指挥。老兵更不容易溃逃。</p>
            <p><b>粮草：</b>据点产粮、部队吃粮，只靠开局的城池和营寨养不活全军。<b>昼夜：</b>夜里视野缩小，火把能照远但会暴露自己；下雨时火把点不着、行军变慢。偶尔下雪：走得更慢、看得更近，据点外的部队防御下降。</p>
            <p><b>营寨：</b>占下后选中它，在面板里点选要出的兵种（本文明的全部兵种，含器械与战象），之后定时出这个兵种的援军，选贵的兵种每批人就少；改选后援军计时从头开始，易主后回到缺省兵种。城池与城镇出全兵种援军。</p>
            <p><b>资源点：</b>农庄、伐木场、采石场、金矿，站到旗下几秒就占领，之后自动采集。<b>黄金</b>把部队升为重甲的高级形态（指令面板的「升级」一栏，老兵优先）；<b>石料</b>升级城池、<b>木材</b>升级营寨（选中据点后点升级，最高 3 级），手里有料时建筑也修得更快；木材还能给资源点建哨塔（最多 4 座，敌人得先拆光才能占领）、让部队扎营。</p>
          </details>
        </div>
        <button class="primary">开始指挥</button>
      </div>`);
    this.helpContent = this.help.querySelector<HTMLDivElement>('.help-content')!;
    const start = this.help.querySelector('button')!;
    start.onclick = () => this.toggleHelp();
    this.help.onkeydown = e => {
      if (e.key.startsWith('Arrow') || e.key === ' ' || e.key === 'Home' || e.key === 'End' || e.key === 'PageUp' || e.key === 'PageDown') e.stopPropagation();
    };
    this.help.onclick = e => {
      if (e.target === this.help) this.toggleHelp();
    };
    this.over = el('div', 'overlay over');
    this.over.hidden = true;
    root.append(this.help, this.over);
    this.help.hidden = true;
    if (human) this.toggleHelp();
  }

  get helpOpen(): boolean {
    return !this.help.hidden;
  }

  toggleHelp(): void {
    this.help.hidden = !this.help.hidden;
    // 打开帮助时收起设置面板：关掉帮助后不残留一个没人在看的设置面板
    if (this.helpOpen) this.closeSettings();
    if (this.helpOpen) this.helpContent.focus({ preventScroll: true });
  }

  /** 收起 / 展开据点列表，记住选择 */
  toggleSites(): void {
    const folded = this.sitesBox.classList.toggle('folded');
    savePref('sitesFolded', folded ? '1' : '0');
  }

  get settingsOpen(): boolean {
    return !this.settings.hidden;
  }

  closeSettings(): void {
    this.settings.hidden = true;
    this.settingsBtn.classList.remove('on');
    this.syncScrim();
  }

  private buildSettings(): void {
    for (const [label, button] of [['音效', this.effectsSwitch], ['音乐', this.musicSwitch]] as const) {
      const row = el('div', 'srow');
      button.setAttribute('role', 'switch');
      button.setAttribute('aria-label', label);
      row.append(el('span', '', label), button);
      this.settings.appendChild(row);
    }
    this.effectsSwitch.onclick = () => this.setSound(this.cb.toggleSound());
    this.musicSwitch.onclick = () => this.setAudioSwitch(this.musicSwitch, this.cb.toggleMusic());
    this.setSound(this.cb.soundOn());
    this.setAudioSwitch(this.musicSwitch, this.cb.musicOn());

    const row = el('div', 'srow', '<span title="鼠标滚轮与触控板双指滑动怎么操作镜头">滚轮 / 双指</span>');
    const seg = el('div', 'seg');
    const btns = WHEEL_MODES.map(({ mode, label, tip }) => {
      const b = el('button', '', label);
      b.title = tip;
      b.onclick = () => {
        this.cb.setWheelMode(mode);
        for (const x of btns) x.classList.toggle('on', x === b);
      };
      b.classList.toggle('on', this.cb.wheelMode() === mode);
      return b;
    });
    seg.append(...btns);
    row.appendChild(seg);
    row.classList.add('desktop-only');
    this.settings.append(row, el('div', 'shint desktop-only', '触控板：双指滑动平移，捏合缩放，Option（Alt）+ 双指旋转。<br>鼠标：滚轮缩放，中键拖动旋转。<br>PageUp / PageDown（Mac：fn + ↑ / ↓）也能缩放'));

    if (this.cb.lockMouseSupported()) {
      const lrow = el('div', 'srow desktop-only', '<span title="开启后在画面上点一下，光标就出不了画面，甩到边缘即卷屏">锁定鼠标</span>');
      const lseg = el('div', 'seg');
      const lbtns = [true, false].map(on => {
        const b = el('button', '', on ? '开' : '关');
        b.onclick = () => {
          this.cb.setLockMouse(on);
          for (const x of lbtns) x.classList.toggle('on', x === b);
        };
        b.classList.toggle('on', this.cb.lockMouse() === on);
        return b;
      });
      lseg.append(...lbtns);
      lrow.appendChild(lseg);
      this.settings.append(lrow, el('div', 'shint desktop-only', '开启后在画面上点一下进入锁定，光标改由游戏自己画。按 Esc 退出锁定：全屏时（Chrome / Edge）锁定中 Esc 照常交给游戏（取消选择、退出指令模式），改为长按 Esc 退出锁定；其他浏览器与非全屏时，第一下 Esc 只解锁、不取消选择。解锁后再点一下画面重新锁定'));
    }

    const urow = el('div', 'srow', '<span title="触屏设备竖屏时自动用移动版；在电脑上调试移动版时手动选「移动」">界面</span>');
    const useg = el('div', 'seg');
    const ubtns = UI_MODES.map(({ mode, label, tip }) => {
      const b = el('button', '', label);
      b.title = tip;
      b.onclick = () => {
        this.cb.setUiMode(mode);
        for (const x of ubtns) x.classList.toggle('on', x === b);
      };
      b.classList.toggle('on', this.cb.uiMode() === mode);
      return b;
    });
    useg.append(...ubtns);
    urow.appendChild(useg);
    this.settings.append(urow);

    const jrow = el('div', 'srow mobile-only', '<span title="摇杆与缩放条放在哪一侧，小地图在另一侧">摇杆位置</span>');
    const jseg = el('div', 'seg');
    const jbtns = (['left', 'right'] as const).map(side => {
      const b = el('button', '', side === 'left' ? '左' : '右');
      b.onclick = () => {
        this.applyStickSide(side);
        savePref('stickSide', side);
        for (const x of jbtns) x.classList.toggle('on', x === b);
      };
      b.classList.toggle('on', this.stickSide === side);
      return b;
    });
    jseg.append(...jbtns);
    jrow.appendChild(jseg);
    this.settings.append(jrow, el('div', 'shint mobile-only', '惯用左手时把摇杆放到右侧'));
  }

  /** 移动版的摇杆放到哪一侧（小地图在另一侧）；拖卡片时剑也改往小地图那一侧放倒 */
  private applyStickSide(side: StickSide): void {
    this.stickSide = side;
    this.host.classList.toggle('stick-right', side === 'right');
    this.cards.mapSide = side === 'right' ? -1 : 1;
  }

  /** 移动版弹出 / 收起右上角「菜单」里的按钮组 */
  private setMenu(on: boolean): void {
    this.ctl.classList.toggle('open', on);
    this.menuBtn.classList.toggle('on', on);
    this.syncScrim();
  }

  /** 抽屉、菜单、设置面板任何一个开着就盖上遮罩 */
  private syncScrim(): void {
    this.scrim.classList.toggle('show', this.drawers.left.classList.contains('open') || this.drawers.right.classList.contains('open')
      || this.ctl.classList.contains('open') || this.settingsOpen);
  }

  /**
   * 抽屉与把手上的横向滑动：把手上往里滑或点一下拉出抽屉，抽屉上往回滑（城镇面板左滑、操作面板右滑）收起。
   * 抽屉里的按钮照常点，所以不设指针捕获；滑动后吞掉紧跟着的那一下 click，免得滑过的按钮被点中。
   */
  private bindDrawerGestures(target: HTMLElement, side: 'left' | 'right', handle: boolean): void {
    let from: { id: number; x: number; y: number } | null = null;
    const inward = side === 'left' ? 'right' : 'left';
    const finish = (dx: number, dy: number): boolean => {
      const dir = swipeDir(dx, dy);
      if (handle ? dir === inward : dir === side) {
        this.openDrawer(handle ? side : null);
        return true;
      }
      return false;
    };
    // 桌面版里据点列表与指令面板是常驻面板：鼠标在上面拖动、点按钮不该被当成滑动，滑动后吞掉 click 还会吞掉正常的点击
    target.addEventListener('pointerdown', e => {
      if (!this.mobile) return;
      from = { id: e.pointerId, x: e.clientX, y: e.clientY };
      if (handle) target.setPointerCapture(e.pointerId);
    });
    target.addEventListener('pointermove', e => {
      if (!from || from.id !== e.pointerId) return;
      if (finish(e.clientX - from.x, e.clientY - from.y)) {
        from = null;
        if (!handle) {
          const eat = (ev: Event): void => ev.stopPropagation();
          target.addEventListener('click', eat, { capture: true, once: true });
          setTimeout(() => target.removeEventListener('click', eat, true), 400);
        }
      }
    });
    target.addEventListener('pointerup', e => {
      const f = from;
      from = null;
      // 把手上点一下（没怎么动）也拉出抽屉
      if (handle && f && f.id === e.pointerId && Math.hypot(e.clientX - f.x, e.clientY - f.y) <= TAP_SLOP) this.openDrawer(side);
    });
    target.addEventListener('pointercancel', () => {
      from = null;
    });
  }

  /** 编队（只含还有活人的，按队号排）：交给编队卡片显示；下一次 updateSelection 时画出来 */
  setGroups(groups: { g: number; slots: number[] }[]): void {
    this.slotRow?.setGroups(groups);
  }

  /** 移动版：拉出（left / right）或收起（null）抽屉，同一时间只开一个 */
  openDrawer(side: 'left' | 'right' | null): void {
    this.drawers.left.classList.toggle('open', side === 'left');
    this.drawers.right.classList.toggle('open', side === 'right');
    for (const s of ['left', 'right'] as const) this.root.querySelector(`.handle.${s}`)?.setAttribute('aria-expanded', String(side === s));
    this.syncScrim();
  }

  /** 切换到移动版 / 桌面版：根上的 mobile 类让样式表换布局，收起抽屉与菜单，战报条数与卡片带跟着换 */
  setMobile(on: boolean): void {
    this.mobile = on;
    this.host.classList.toggle('mobile', on);
    this.cards.mobile = on;
    if (this.slotRow) {
      if (on) this.root.appendChild(this.slotRow.el);
      else this.cardwrap.prepend(this.slotRow.el);
    }
    this.applyStickSide(this.stickSide);
    this.stick.reset();
    this.zoom.release();
    this.openDrawer(null);
    this.setMenu(false);
    this.closeUpgradeMenu();
    // 关闭按钮只在移动版有：桌面版没有收起详情的说法
    this.detailClosed = '';
    this.feedMax = on ? 3 : 5;
    while (this.feed.children.length > this.feedMax) this.feed.lastChild!.remove();
  }

  private setAudioSwitch(button: HTMLButtonElement, on: boolean): void {
    button.textContent = on ? '开' : '关';
    button.classList.toggle('on', on);
    button.setAttribute('aria-checked', String(on));
  }

  setSound(on: boolean): void {
    this.setAudioSwitch(this.effectsSwitch, on);
    this.soundBtn.textContent = on ? '音效：开' : '音效：关';
    this.soundBtn.classList.toggle('on', on);
  }

  setSpeed(s: number): void {
    if (s > 0) this.runSpeed = s;
    this.pauseBtn.classList.toggle('on', s === 0);
    this.pauseBtn.textContent = s === 0 ? '继续' : '暂停';
    this.speedBtn.textContent = `${this.runSpeed}×`;
  }

  setMode(text: string): void {
    this.modeTip.textContent = text;
    // 移动版里战报条要让到提示条下面
    this.modeTip.style.display = text ? 'block' : 'none';
    this.syncTipHeight();
    // 指令模式里「取消选择」也用来退出模式：没选东西时也要能按
    this.inMode = !!text;
    this.syncDeselect();
  }

  setDebug(text: string): void {
    this.dbg.textContent = text;
  }

  message(text: string, kind: 'good' | 'bad' | 'info', x?: number, y?: number): void {
    // 只有带地点、点了能跳过去的战报接指针；其余的点下去落到底下的画面与把手上
    const m = el('div', `msg ${kind}`, text);
    if (x !== undefined && y !== undefined) {
      m.classList.add('go');
      m.onclick = () => this.cb.focus(x, y);
    }
    this.feed.prepend(m);
    while (this.feed.children.length > this.feedMax) this.feed.lastChild!.remove();
    setTimeout(() => m.classList.add('fade'), 6000);
    setTimeout(() => m.remove(), 7200);
  }

  /** 每帧：把风向换算到屏幕上（镜头转了 yaw，世界方位角 a 在屏幕上是 a + yaw） */
  setWindView(yaw: number): void {
    const deg = Math.round(((this.world.env.windDir + yaw) * 180) / Math.PI);
    if (deg === this.windDeg) return;
    this.windDeg = deg;
    this.windArrow.style.transform = `rotate(${deg}deg)`;
  }

  /** 把提示条的实际高度写到根上的 --tip（移动版的战报据此接在它下面），没有提示时是 0 */
  private syncTipHeight(): void {
    this.root.style.setProperty('--tip', this.modeTip.style.display === 'block' ? `${this.modeTip.offsetHeight + 2}px` : '0px');
  }

  /** game 在下令顺带换选择期间设为 true：这期间的 updateSelection 不打开原本没显示的详情 */
  detailQuiet = false;

  /** 收起当前的详情，直到玩家重新选单位或据点（关闭按钮） */
  suppressDetail(): void {
    this.detailClosed = this.detailKey;
    this.selBox.hidden = true;
  }

  /** 详情此刻是否显示着 */
  get detailShown(): boolean {
    return !this.selBox.hidden;
  }

  /** 玩家重新选了单位或据点（哪怕还是同一个）：用关闭按钮收起的详情可以再弹出来 */
  reopenDetail(): void {
    this.detailClosed = '';
  }

  /** 长按卡片：在卡片上方显示升级与编队选项。 */
  private showUpgradeMenu(kind: 'all' | 'type', id: number, rect: DOMRect): void {
    // 正有手指 / 键盘按着报价确认：别的手指长按卡片不重开（不改写按着的那份报价）
    if (this.upPointerLive() || this.upKeyHeld) return;
    // 只剩作废的那一按：丢掉它的记录（它松开时不再收尾），新弹出的是新报价，不过期
    this.upPointer = null;
    this.upPointerHeld = false;
    this.upStale = false;
    const cw = this.cardwrap.getBoundingClientRect();
    const group = this.cb.groupCard(kind, id);
    this.upFor = { kind, id, dx: rect.left - cw.left, dy: rect.top - cw.top, w: rect.width, group };
    if (!this.renderUpgradeMenu()) return;
    this.upMenu.hidden = false;
    // 新弹出的从顶上开始（限高滚动时不接着上一个框滚到的位置；同一个框刷新、重摆时才保留）
    this.upMenu.scrollTop = this.upScroll = 0;
    this.placeUpgradeMenu();
    navigator.vibrate?.(15);
  }

  /** 按此刻的局面重写升级选择的各项（开着时随低频刷新更新人数与金额）；没有可选的项返回 false */
  private renderUpgradeMenu(): boolean {
    const f = this.upFor;
    if (!f) return false;
    const upgrades = this.cb.upgradeChoices(f.kind, f.id);
    if (!upgrades.length && !f.group) return false;
    const title = f.kind === 'type' ? UNITS[f.id].name : '全选';
    const none = upgrades.length > 0 && upgrades.every(c => !c.total && c.size > 0);
    const sub = (c: UpgradeChoice): string => (!c.size ? '当前没有人' : !c.total ? '已是高级形态'
      : c.offer ? `${c.offer.count}${c.offer.count < c.total ? ` / ${c.total}` : ''} 人 · 金 ${Math.round(c.offer.cost)}`
      : `${c.total} 人 · 黄金不足，升 1 人需 ${Math.round(c.need)}`);
    const choices: { label: string; detail: string; enabled: boolean; run(): void }[] = [];
    const group = f.group;
    const groupCount = group?.count ?? 0;
    if (group) {
      for (let g = 1; g <= GROUP_SLOTS; g++) {
        choices.push({
          label: `第 ${g} 队`, detail: '', enabled: groupCount > 0,
          run: () => { if (!this.upStale) group.assign(g); },
        });
      }
    }
    const groupButtons = choices.length;
    if (!none) choices.push(...upgrades.map(c => ({
      label: c.label, detail: sub(c), enabled: !!c.offer, run: () => c.run(),
    })));
    this.upChoices = choices;
    // 项目不变时就地刷新价格和可用状态，以免丢失焦点或正在确认的指针。
    const heading = group ? title : `${title} · 升级`;
    const shape = `${heading}|${none}|${choices.map(c => c.label).join('|')}`;
    const btns = [...this.upMenu.querySelectorAll<HTMLButtonElement>('button[data-i]')];
    const groupLabel = `编队 · ${groupCount} 人（替换原队员）`;
    if (shape === this.upShape && btns.length === choices.length) {
      const count = this.upMenu.querySelector('.groupcount');
      if (count && count.textContent !== groupLabel) count.textContent = groupLabel;
      choices.forEach((c, i) => {
        const detail = btns[i].querySelector('i');
        if (detail && detail.textContent !== c.detail) detail.textContent = c.detail;
        if (btns[i].disabled === c.enabled) {
          if (!c.enabled && btns[i] === document.activeElement) this.upMenu.focus();
          btns[i].disabled = !c.enabled;
        }
      });
      return true;
    }
    const buttons = choices.map((c, i) =>
      `<button data-i="${i}"${c.enabled ? '' : ' disabled'}><b>${c.label}</b><i>${c.detail}</i></button>`);
    const groups = group
      ? `<p class="groupcount">${groupLabel}</p><div class="groupchoices">${buttons.slice(0, groupButtons).join('')}</div>`
      : '';
    const html = `<h3>${heading}</h3>${groups}${buttons.slice(groupButtons).join('')}${none ? '<p>没有可升级的人（都已是高级形态）</p>' : ''}`;
    if (html === this.upHtml) return true;
    // 各项变了要重建：焦点原在哪一项（按这一项是什么，不按第几行——去重后行号会挪），重建后放回那一项；
    // 那一项没了或不能点，焦点留在弹出框上，不交给别的项（不能把确认转给另一批人）
    const focusedBtn = btns.find(b => b === document.activeElement);
    const focusedLabel = focusedBtn?.querySelector('b')?.textContent ?? null;
    const hadFocus = this.upMenu.contains(document.activeElement);
    this.upMenu.innerHTML = this.upHtml = html;
    this.upShape = shape;
    if (hadFocus) {
      const at = focusedLabel === null ? -1 : choices.findIndex(c => c.label === focusedLabel && c.enabled);
      const target = at >= 0 ? this.upMenu.querySelector<HTMLButtonElement>(`button[data-i="${at}"]`) : null;
      (target ?? this.upMenu).focus();
    }
    return true;
  }

  private placeUpgradeMenu(): void {
    const f = this.upFor!, cw = this.cardwrap.getBoundingClientRect();
    const rect = this.cards.cardRect(f.kind, f.id) ?? { left: cw.left + f.dx, top: cw.top + f.dy, width: f.w };
    // 层级在把手与战报之上（见 style.css 的 .upmenu）；仍让开把手，免得盖住它。
    // 移动版：左右让开把手连同它向内伸的命中范围（量把手的实际宽度，加上 style.css 里 .handle::after 向内伸的 20 × --u，那边改了这里同步），
    // 底边落在卡片带的金边上方（卡片选没选中、上没上移都一样）
    const host = this.root.getBoundingClientRect();
    const handle = this.root.querySelector<HTMLElement>('.handle.left');
    const hw = handle ? handle.getBoundingClientRect().width : 0;
    const edge = this.mobile ? Math.ceil(hw * (42 / 22)) : 8;
    // 宽度也限在两侧让位之间：先限宽再量尺寸，否则夹完左边右边就越界、盖住右侧把手
    this.upMenu.style.maxWidth = this.mobile ? `${host.width - 2 * edge}px` : '';
    // 先去掉限高量出完整高度；限高时框里滚到的位置会被这一量夹回顶部，量完还原（摆位随 update 反复调，不能每次都把人滚回去）
    // 记下的阅读位置跨过「不限高」（视口变大又变回）也留着：不限高时框不滚动，读到的 scrollTop 恒为 0，不覆盖它
    const prevMax = this.upMenu.style.maxHeight;
    if (prevMax) this.upScroll = this.upMenu.scrollTop;
    this.upMenu.style.maxHeight = '';
    const w = this.upMenu.offsetWidth;
    let h = this.upMenu.offsetHeight;
    const x = Math.max(edge, Math.min(host.width - edge - w, rect.left - host.left + rect.width / 2 - w / 2));
    let base = this.mobile ? this.cardwrap.getBoundingClientRect().top : rect.top;
    // 桌面版：卡片会换行，横向对着长按的那张卡，纵向让开所有卡片（落在最上一排之上），也让开叠在卡片上方的详情；
    // 上边不盖顶栏。矮屏上多排卡片加详情放不下时，让详情在升级框开着期间先隐去（只是不可见、不改布局，收起升级框就回来）
    const top = this.mobile && !f.group ? edge : Math.max(edge, this.topbar.getBoundingClientRect().bottom - host.top + 8);
    if (!this.mobile) {
      base = Math.min(base, this.cards.cardsTop());
      const detail = this.detailShown ? this.selBox.getBoundingClientRect().top : Infinity;
      const fits = Math.min(base, detail) - host.top - h - 8 >= top;
      this.selBox.classList.toggle('yield', !fits && detail < Infinity);
      if (fits) base = Math.min(base, detail);
    }
    if (!this.mobile || f.group) {
      // 详情让开了还放不下（卡片排得太多）：压低升级框，里面滚动，不盖卡片（矮到连几十像素都没有才只好盖上）
      const room = base - host.top - 8 - top;
      if (h > room) {
        const max = `${Math.max(room, 64)}px`;
        this.upMenu.style.maxHeight = max;
        h = this.upMenu.offsetHeight;
        this.upMenu.scrollTop = this.upScroll;
        // 刚变成限高、或限高的高度变了（视口变了）：键盘正按着、或焦点所在的那一项可能被裁掉，让它露出来（免得对着看不见的项成交）；
        // 限高没变的常规刷新不动，玩家自己滚到哪就是哪（焦点停在某项时照样能滚着读别的项）
        const act = document.activeElement as HTMLElement | null;
        const keep = max === prevMax ? null : this.upKeyBtn ?? (act && act !== this.upMenu && this.upMenu.contains(act) ? act : null);
        if (keep) this.revealUpItem(keep);
        this.upScroll = this.upMenu.scrollTop;
      }
    }
    const y = Math.max(top, base - host.top - h - 8);
    this.upMenu.style.transform = `translate(${x}px, ${y}px)`;
  }

  /**
   * 选择变了：升级选择上的人数与金额不准了，收起它。但若正有手指 / 键盘按着报价确认（另一根手指点画面改了选择），
   * 不打断这一按：记下「过期」，等这一按结束——成交就按按下时的报价成交，没成交再收起
   */
  selectionChanged(): void {
    if (this.upMenu.hidden) return;
    if (this.upPointerLive() || this.upKeyHeld) this.upStale = true;
    else this.closeUpgradeMenu();
  }

  /** 指针这一按作废：放开报价锁；选择早变过、键盘也没在按着确认的，过期的报价没人再撑着，当下收起 */
  private voidUpPointer(): void {
    if (!this.upPointer) return;
    this.upPointer.voided = true;
    this.upPointerHeld = false;
    if (this.upStale && !this.upKeyHeld) this.closeUpgradeMenu();
  }

  /** 升级框里这一项没有整个露在框的可视范围里就把它滚出来，返回是否滚了 */
  private revealUpItem(b: HTMLElement): boolean {
    const m = this.upMenu;
    // 没限高时框不滚动，每一项都露着
    if (!m.style.maxHeight) return false;
    // 「整个露着」连同外沿的焦点环一起算（上下各多要 UP_REVEAL_PAD）：贴着滚动边缘时焦点环已被裁掉一截。
    // offsetTop 是取整的，差不到 1px 的贴边靠这几像素的余量兜住
    const top = b.offsetTop - UP_REVEAL_PAD, bottom = b.offsetTop + b.offsetHeight + UP_REVEAL_PAD;
    const max = m.scrollHeight ? m.scrollHeight - m.clientHeight : Infinity;
    // 滚到头了也露不全（第一项上面、最后一项下面没那么多空）就不再要求
    const want = top < m.scrollTop ? Math.max(0, top) : bottom > m.scrollTop + m.clientHeight ? Math.min(max, bottom - m.clientHeight) : m.scrollTop;
    if (Math.abs(want - m.scrollTop) < 0.5) return false;
    m.scrollTop = want;
    this.upScroll = m.scrollTop;
    return true;
  }

  /** 有指针还按着升级框里的报价、这一按仍可能成交（移出过的已作废，不算：它不该再替过期的报价撑着） */
  private upPointerLive(): boolean {
    return !!this.upPointer && !this.upPointer.voided;
  }

  /** 收起长按卡片弹出的升级选择 */
  closeUpgradeMenu(): void {
    this.upMenu.hidden = true;
    this.selBox.classList.remove('yield');
    this.upChoices = [];
    this.upFor = null;
    this.upHtml = '';
    this.upShape = '';
    this.upKeyHeld = this.upPointerHeld = false;
    this.upKeyBtn = null;
    this.upPointer = null;
    this.upStale = false;
  }

  /** 两个「取消选择」（指令面板里与摇杆旁）：有可取消的选择、或处于指令模式时可按 */
  private syncDeselect(): void {
    const off = !this.hasSel && !this.inMode;
    for (const b of [this.cmdBtns.get('deselect'), this.deselBtn]) if (b && b.disabled !== off) b.disabled = off;
  }

  /** 低频刷新（约 4 次/秒） */
  update(): void {
    const w = this.world;
    // 升级选择开着时跟着黄金与人数刷新，宽高变了重新摆位置；没有可选的项了就收起
    // 按着确认期间选择变过、现在已没人按着（如键盘按着时焦点移走）：照「选择变了就收起」收起
    if (this.upStale && !this.upKeyHeld && !this.upPointerLive()) this.closeUpgradeMenu();
    if (this.upFor && !this.upKeyHeld && !this.upPointerHeld) {
      if (this.renderUpgradeMenu()) this.placeUpgradeMenu();
      else this.closeUpgradeMenu();
    } else if (this.upFor && !this.upPointerHeld && !this.upMenu.hidden) {
      // 只有键盘按着：内容锁住不刷新，但位置照常跟着摆（如期间详情出现了，让开它）；
      // 指针按着时不挪：按着的那一项从手指下挪走，松开就落空了（选择变了导致的遮挡，松开后过期的框随即收起）
      this.placeUpgradeMenu();
    }
    const f = w.factions as FactionDef[];
    const human = w.humanTeam || 1;
    const other = 3 - human;
    this.counts.innerHTML = `
      <span class="tag" style="--c:${css(this.teamRgb[human])}" title="${f[human].name}">${f[human].name}</span><b>${w.teamCount[human]}</b>
      <span class="vs">对</span>
      <span class="tag" style="--c:${css(this.teamRgb[other])}" title="${f[other].name}">${f[other].name}</span><b>${w.teamCount[other]}</b>`;
    const t = Math.floor(w.time);
    this.clock.textContent = `${String((t / 60) | 0).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
    // 时辰与天气
    const env = w.env;
    const ck = env.clock;
    const E = RULES.env;
    const part = env.night ? '夜晚' : ck < E.sunrise + 0.06 ? '清晨' : ck > E.sunset - 0.06 ? '黄昏' : ck < 0.44 ? '上午' : ck < 0.56 ? '正午' : '下午';
    this.envBox.textContent = `${part} · ${env.snowing ? '雪' : env.raining ? '雨' : '晴'}`;
    this.envBox.className = `env${env.night ? ' night' : ''}${env.raining ? ' rain' : ''}${env.snowing ? ' snow' : ''}`;
    this.envBox.title = `夜间视野 ×${E.nightVision}，火把 ×${E.torchVision}；雨天行军 ×${E.rainSpeed}，火把点不着\n`
      + `雪天行军 ×${E.snowSpeed}、视野 ×${E.snowVision}（与夜晚叠乘）、火把点不着，据点之外的部队护甲 ×${E.snowArmor}`;
    // 风
    const wk = env.wind;
    this.windBox.style.display = wk > 0.02 ? '' : 'none';
    if (wk > 0.02) {
      const pct = Math.round(wk * E.windSpeed * 100);
      (this.windBox.lastElementChild as HTMLElement).textContent = wk < 0.45 ? '微风' : wk < 0.75 ? '大风' : '狂风';
      this.windBox.title = `风向：箭头指向风吹去的方向（随镜头转动）\n顺风行军快 ${pct}%，顶风慢 ${pct}%，侧风不受影响`;
    }
    // 木材、石料、黄金
    const use: Record<ResKind, string> = {
      wood: `升级营寨、给资源点建哨塔（${RULES.economy.towerCost}）、扎营（${RULES.economy.outpostCost}）；有木材时营寨的建筑修得更快`,
      stone: '升级城池；有石料时城池的建筑修得更快',
      gold: `把部队升为高级形态（每份口粮 ${RULES.economy.unitGold}）`,
    };
    // 移动版顶栏窄：上千的数缩写，给右端的「菜单」留住位置
    const amount = (v: number): string => (this.mobile ? compactNum(v) : String(Math.floor(v)));
    this.resBox.innerHTML = RES_KINDS.map(k => `<span class="r-${k}" title="${RES_NAMES[k]}：每分钟 +${Math.round(w.income[k][human])}\n${use[k]}">`
      + `${RES_SHORT[k]} <b>${amount(w.stock[k][human])}</b></span>`).join('');
    // 粮草
    if (w.upkeep0[human] > 0) {
      const net = w.foodIn[human] - w.foodOut[human];
      this.foodBox.hidden = false;
      this.foodBox.textContent = this.mobile ? `粮 ${amount(w.food[human])}（${net >= 0 ? '+' : ''}${Math.round(net)}）`
        : `粮草 ${Math.round(w.food[human])}（${net >= 0 ? '+' : ''}${Math.round(net)}/分）`;
      this.foodBox.className = `food${w.hunger[human] > 0.15 ? ' bad' : net < 0 ? ' warn' : ''}`;
      this.foodBox.title = `每分钟产 ${Math.round(w.foodIn[human])}、耗 ${Math.round(w.foodOut[human])}，粮仓上限 ${Math.round(w.foodCap[human])}`
        + (w.hunger[human] > 0.01 ? `\n断粮：士气 −${Math.round(w.hunger[human] * RULES.morale.hunger)}` : '');
    } else this.foodBox.hidden = true;
    // 士气
    const mor = Math.round(w.avgMorale[human]);
    const rout = w.routing[human];
    this.moraleBox.textContent = `士气 ${mor}${rout ? ` · 溃逃 ${rout}` : ''}`;
    this.moraleBox.className = `morale${mor < 40 ? ' bad' : mor < 55 ? ' warn' : ''}`;
    this.moraleBox.title = ['全军士气的加减项：', ...teamMoraleFactors(w, human).map(f => `${f.label} ${f.value > 0 ? '+' : ''}${f.value}`),
      '另受附近敌我兵力对比、伤亡、负伤影响'].join('\n');
    // 据点列表：正经据点一行一个，资源点挤成一排小牌子
    let html = '';
    const order = w.sites.slice().sort((a, b) => (a.owner === human ? 0 : a.owner === 0 ? 1 : 2) - (b.owner === human ? 0 : b.owner === 0 ? 1 : 2));
    let chips = '';
    for (const s of order) {
      const info = SITE_INFO[s.type];
      if (s.gone) continue;
      const c = css(this.teamRgb[s.owner]);
      if (info.category === 'resource') {
        const towers = towerCount(w, s);
        const short = info.yields ? RES_SHORT[Object.keys(info.yields)[0] as ResKind] : info.provides[0];
        chips += `<span class="chip" data-id="${s.id}" style="--c:${c}" title="${s.name}：${s.owner === human ? '我方' : s.owner ? '敌占' : '中立'}`
          + `${towers ? `，哨塔 ${towers}` : ''}">${short}${towers ? `<i>${towers}</i>` : ''}`
          + `${s.cap > 0 && s.capTeam ? `<u style="width:${Math.round(s.cap * 100)}%;background:${css(this.teamRgb[s.capTeam])}"></u>` : ''}</span>`;
        continue;
      }
      // 行末的状态要短（右栏很窄）：详情放在整行的 title 里
      let state: string, tip = `${s.name}（${SITE_CATEGORY_NAMES[info.category]}）`;
      if (info.category === 'outpost') {
        state = `<i>${s.owner === human ? '休整' : '敌方'}</i>`;
      } else if (s.owner === human || (!w.humanTeam && s.owner)) {
        const sec = Math.max(0, Math.ceil(s.timer));
        const full = w.teamCount[s.owner] >= w.unitCap[s.owner];
        const foodN = w.upkeep0[s.owner] > 0 ? Math.round((info.food * w.upkeep0[s.owner]) / 100) : 0;
        const food = foodN ? ` <i>粮 +${foodN}</i>` : '';
        if (reinfPaused(w, s)) {
          state = '<i>援军暂停</i>' + food;
          tip += '：援军暂停（中央建筑被毁）';
        } else if (full) {
          state = '<i>兵力已满</i>' + food;
          tip += '：兵力已满，暂不出援军';
        } else {
          // 城池、城镇出全兵种援军，不必写「全兵种援军」占地方（在 title 里）；营寨写所选的兵种
          state = `${info.reinf === 'pick' ? `<b>${this.supply(s)}</b> ` : ''}${(sec / 60) | 0}:${String(sec % 60).padStart(2, '0')}${food}`;
          tip += `：${this.supply(s)}，${sec} 秒后出下一批`;
        }
        if (foodN) tip += `；产粮 +${foodN}`;
      } else {
        const who = s.owner ? '敌占' : '中立';
        state = `<i>${who}${s.owner && info.reinf === 'pick' ? ` · ${this.supply(s)}` : ''}</i>`;
        tip += `：${who}${info.provides ? `，${s.owner && info.reinf === 'pick' ? this.supply(s) : info.provides}` : ''}`;
      }
      const cap = s.cap > 0 && s.capTeam ? `<u style="width:${Math.round(s.cap * 100)}%;background:${css(this.teamRgb[s.capTeam])}"></u>` : '';
      html += `<div class="site" data-id="${s.id}" title="${tip}"><span class="dot" style="background:${c}"></span><span class="nm">${s.name}${starsHtml(s, true)}</span><span class="st">${state}</span>${cap}</div>`;
    }
    if (chips) html += `<h3 class="sub">资源点</h3><div class="chips">${chips}</div>`;
    if (html !== this.sitesHtml) this.sitesList.innerHTML = this.sitesHtml = html;
  }

  private portrait(defIdx: number, team: number): string {
    const key = defIdx * 4 + team;
    let url = this.portraits.get(key);
    if (!url) {
      url = unitPortrait(UNITS[defIdx].model, this.teamRgb[team], 64).toDataURL();
      this.portraits.set(key, url);
    }
    return url;
  }

  /** 指令面板里的升级按钮：只列出此刻点了就能生效的 */
  updateUpgrades(o: UpgradeOffers): void {
    const rows: string[] = [];
    if (o.sel) {
      rows.push(`<button data-up="sel" title="把所选部队升为高级形态：等级高的优先，同级的在各兵种之间轮流，直到升完或黄金用尽"><b>升级所选部队</b>`
        + `<i>${o.sel.count}${o.sel.count < o.sel.total ? ` / ${o.sel.total}` : ''} 人 · 金 ${Math.round(o.sel.cost)}</i></button>`);
    }
    const part = (v: { count: number; total: number }): string => `${v.count}${v.count < v.total ? ` / ${v.total}` : ''}`;
    if (o.all) rows.push(`<button data-up="all" class="gold" title="把全图的己方部队升为高级形态：等级高的优先，直到升完或黄金用尽"><b>部队全部升级</b><i>${part(o.all)} 人 · 金 ${Math.round(o.all.cost)}</i></button>`);
    if (o.cities) rows.push(`<button data-up="cities" class="gold" title="把全图的己方城池各升一级，已满级的不再升（石料不够时先升离镜头近的）"><b>城池全部升级</b><i>${part(o.cities)} 座 · 石 ${o.cities.cost}</i></button>`);
    if (o.camps) rows.push(`<button data-up="camps" class="gold" title="把全图的己方营寨各升一级，已满级的不再升（木材不够时先升离镜头近的）"><b>营寨全部升级</b><i>${part(o.camps)} 座 · 木 ${o.camps.cost}</i></button>`);
    const key = rows.join('');
    if (key === this.upKey) return;
    this.upKey = key;
    this.upBar.innerHTML = key;
    this.upHead.hidden = !key;
  }

  /** 选中一个据点时：它的状况，以及能对它做的事（升级、建哨塔） */
  private siteDetail(s: Site): void {
    const w = this.world, human = w.humanTeam;
    const info = SITE_INFO[s.type];
    const mine = s.owner === human;
    const mat = info.material, have = Math.floor(w.stock[mat][human] ?? 0);
    let alive = 0, total = 0, hp = 0, max = 0, shooters = 0, down = 0;
    for (const id of s.buildings) {
      const b = w.buildings[id];
      if (b.extra && !b.alive) continue;
      total++;
      max += b.maxHp;
      if (!b.alive) continue;
      alive++;
      hp += b.hp;
      if (b.down) down++;
      else if (b.tower) shooters++;
    }
    const military = militaryLeft(w, s, human);
    const towers = towerCount(w, s);
    const yields: string[] = [];
    if (info.food && w.upkeep0[human] > 0) yields.push(`粮 +${Math.round((info.food * w.upkeep0[human]) / 100)}`);
    for (const k of RES_KINDS) {
      const v = info.yields?.[k];
      if (v) yields.push(`${RES_NAMES[k]} +${Math.round(k === 'gold' ? (v * w.armyBase[human]) / 100 : v)}`);
    }
    const E = RULES.economy;
    let btns = '';
    if (mine && info.upgradeCost > 0) {
      const cost = siteUpgradeCost(s), ok = cost > 0 && have >= cost;
      btns += s.level >= SITE_MAX_LEVEL ? '<span class="done">已升到最高级</span>'
        : `<button data-act="upgrade" data-site="${s.id}"${ok ? '' : ' disabled'} title="${levelPerks(w, s, s.level + 1)}。被敌人占领后降回 1 级">`
          + `<b>升到 ${s.level + 1} 级</b><i>${RES_NAMES[mat]} ${cost}${ok ? '' : `（现有 ${have}）`}</i></button>`;
    }
    if (mine && s.slots.length) {
      const ok = towers < s.slots.length && w.stock.wood[human] >= E.towerCost;
      btns += towers >= s.slots.length ? `<span class="done">哨塔 ${towers} / ${s.slots.length}</span>`
        : `<button data-act="tower" data-site="${s.id}"${ok ? '' : ' disabled'} title="在固定的位置建一座哨塔（地上的黄圈）。敌人要把哨塔全部摧毁才能占领这里">`
          + `<b>建哨塔 ${towers} / ${s.slots.length}</b><i>木材 ${E.towerCost}${ok ? '' : `（现有 ${Math.floor(w.stock.wood[human])}）`}</i></button>`;
    }
    const afterCapture = mine ? '' : [info.upgradeCost > 0 ? '升级' : '', info.reinf === 'pick' && !s.owner ? '选择出哪个兵种' : ''].filter(Boolean).join('、');
    const unlocks = s.level >= SITE_MAX_LEVEL ? [...new Set(tier3Perks(w, s).flatMap(p => p.unlocks))] : [];
    const who = s.owner === human ? '我方' : s.owner ? '敌方' : '中立';
    const html = `
      <div class="sdetail">
        <div class="who"><b>${s.name}${starsHtml(s)}</b><span>${SITE_CATEGORY_NAMES[info.category]}${SITE_CATEGORY_NAMES[info.category] === info.label ? '' : ` · ${info.label}`}</span>
          <span class="own" style="--c:${css(this.teamRgb[s.owner])}">${who}</span></div>
        <div class="rows">
          <div class="grid">
            <span>状态</span><b>${this.siteFight(s)}</b>
            <span>建筑</span><b>${alive - down} / ${total} 完好${down ? ` · ${down} 座重建中` : ''} · 生命 ${max ? Math.round((hp / max) * 100) : 0}%</b>
            ${info.upgradeCost > 0 ? `<span>等级</span><b title="${s.level > 1 ? levelPerks(w, s, s.level) : ''}">${s.level} / ${SITE_MAX_LEVEL} 级${unlocks.length ? ` · 解锁${unlocks.join('、')}` : ''}</b>` : ''}
            <span>守备</span><b>${shooters ? `${shooters} 处放箭` : '不设防'}${info.captureTime > 0 ? ` · 占领需 ${info.captureTime} 秒` : ' · 不能占领，只能摧毁'}</b>
            <span>产出</span><b>${yields.length ? `${yields.join('　')} <i>每分钟</i>` : '—'}</b>
            <span>${info.reinf ? '援军' : '用途'}</span><b>${info.reinf ? `${this.supply(s)}${this.batch(s)} · 每 ${info.interval} 秒${reinfPaused(w, s) ? ' · 暂停：中央建筑被毁' : ''}` : info.haven ? '部队在此休整回血' : `采集${info.provides}`}</b>
            ${mine && info.reinf ? `<span>集结点</span><b>${s.rally ? '已设（地上的旗）' : '未设，援军留在据点里'}</b>` : ''}
          </div>
          ${info.captureTime > 0 && !mine && military > 0 ? `<div class="dim">要先摧毁全部军事建筑才能占领（还剩 ${military} 座）</div>` : ''}
          ${!s.owner && shooters > 0 ? `<div class="dim">中立的军事建筑会向双方放箭，可以直接${this.mobile ? '点它' : '右键'}攻击</div>` : ''}
          ${afterCapture ? `<div class="dim">占领后可以${afterCapture}</div>` : ''}
          ${mine && info.reinf === 'pick' ? this.pickList(s) : ''}
        </div>
        ${btns ? `<div class="acts">${btns}</div>` : ''}
      </div>`;
    if (html === this.selKey) return;
    this.selKey = html;
    // 营寨选兵那一排横向滚动：同一据点重建（如刚点了一个兵种）时留在原处，换了据点把选中的兵种滚到中间
    const prev = this.selBody.querySelector<HTMLElement>('.picks');
    const keepX = prev && this.picksFor === s.id ? prev.scrollLeft : null;
    this.selBody.innerHTML = html;
    this.picksFor = s.id;
    const picks = this.selBody.querySelector<HTMLElement>('.picks');
    if (picks && keepX !== null) picks.scrollLeft = keepX;
    else if (picks) {
      const on = picks.querySelector<HTMLElement>('button.on');
      if (on) {
        const pr = picks.getBoundingClientRect(), br = on.getBoundingClientRect();
        picks.scrollLeft += br.left - pr.left - (pr.width - br.width) / 2;
      }
    }
  }

  /** 据点出什么援军：营寨是所选的兵种名，其余是据点类型的说明 */
  private supply(s: Site): string {
    const info = SITE_INFO[s.type];
    return info.reinf === 'pick' && s.owner ? UNITS[pickedUnit(this.world, s)].name : info.provides;
  }

  /** 营寨每批援军的人数（给「援军」一行补上「× n」）；没有主人的营寨不显示 */
  private batch(s: Site): string {
    const w = this.world;
    if (SITE_INFO[s.type].reinf !== 'pick' || !s.owner) return '';
    return ` × ${campBatch(w, s, s.owner, UNITS[pickedUnit(w, s)])}`;
  }

  /** 己方营寨的兵种选择：本文明全部兵种，当前所选高亮，鼠标悬停看每批人数；改选后援军计时从头开始 */
  private pickList(s: Site): string {
    const w = this.world, human = w.humanTeam;
    const cur = pickedUnit(w, s);
    const btns = factionUnits(w.factions[human]!).map(d => {
      const n = campBatch(w, s, human, d);
      const tip = `${d.name}：每批 ${n} 人。${unitTip(d)}`.replace(/"/g, '&quot;');
      return `<button data-act="pick" data-site="${s.id}" data-unit="${d.idx}" class="${d.idx === cur ? 'on' : ''}" title="${tip}">`
        + `<img src="${this.portrait(d.idx, human)}" draggable="false"><b>${d.name}</b><i>${n} 人</i></button>`;
    }).join('');
    return `<div class="picks" title="选择这座营寨出哪个兵种的援军；改选后援军计时从头开始">${btns}</div>`;
  }

  /** 据点此刻是否在交战，以及为什么（交战中不修建筑、不回血） */
  private siteFight(s: Site): string {
    const info = SITE_INFO[s.type];
    const f = fightState(this.world, s);
    if (!info.regen) return '<i>没有恢复能力，建筑不自行修复</i>';
    if (!f.fighting) return s.owner ? '平静 <i>建筑自修、部队休整</i>' : '平静 <i>建筑自修</i>';
    const why: string[] = [];
    if (f.foes) why.push(s.owner ? `据点内有 ${f.foes} 名敌兵` : `据点内有 ${f.foes} 名士兵`);
    if (f.calmIn > 0) why.push(`建筑 ${Math.round(f.hitAgo)} 秒前挨打`);
    const tail = f.calmIn > 0 ? `，${Math.ceil(f.calmIn)} 秒后平静` : f.foes ? (s.owner ? '，敌兵离开后平静' : '，士兵离开后平静') : '';
    return `<span class="warn">交战中</span> <i>${why.join('、')}${tail}</i>`;
  }

  /** 只选中一个单位时：列出它此刻的全部数值（含等级加成）与状态 */
  private unitDetail(s: number): void {
    const w = this.world;
    const d = UNITS[w.type[s]];
    const lv = w.level[s], max = LEVELS.thresholds.length;
    const st = w.state[s];
    // 此刻身上的增减益（城墙、地形、天气、风、光环）：行军中随风向与朝向一直在变，只重写这一行，不整块重画（免得面板闪动、打断悬停提示）
    const fx = unitEffects(w, s).map(e => `<span class="${e.good ? 'up' : 'down'}">${effectText(e)}</span>`).join('');
    const key = `one:${s}:${w.uid[s]}:${w.type[s]}:${lv}:${Math.round(w.hp[s])}:${Math.round(w.maxHp[s])}:${Math.round(w.xp[s])}:${Math.round(w.morale[s])}:${st}`;
    if (key === this.selKey) {
      const row = this.selBody.querySelector<HTMLElement>('.udetail .fx');
      if (row && row.innerHTML !== fx) {
        row.innerHTML = fx;
        row.hidden = !fx;
      }
      return;
    }
    this.selKey = key;
    const pct = (v: number): string => (lv > 0 && v ? ` <i>+${Math.round(v * lv * 100)}%</i>` : '');
    const next = lv + 1 < max ? LEVELS.thresholds[lv + 1] : 0;
    const base = LEVELS.thresholds[lv];
    const xpPct = next ? Math.round(((w.xp[s] - base) / (next - base)) * 100) : 100;
    const routAt = d.lvRout[lv];
    const m = Math.round(w.morale[s]);
    const flags: string[] = [st & S_COMBAT ? '战斗' : '行军'];
    if (st & S_CHARGE) flags.push('冲锋');
    if (st & S_BRACE) flags.push('立枪');
    if (st & S_SHIELD) flags.push('举盾');
    if (st & S_WALL) flags.push('城墙上');
    if (st & S_TORCH) flags.push('火把');
    const ab = d.abilities;
    const perks: string[] = [];
    if (ab.charge) perks.push(`冲锋 ${num(ab.charge.impact)}`);
    if (ab.brace) perks.push(`拒马 ${ab.brace.dmg}`);
    if (ab.shield) perks.push(`举盾 −${Math.round(ab.shield.block * 100)}%`);
    if (d.mobile) perks.push('可边走边打');
    if (d.siege) perks.push('可破城墙');
    if (d.aux) perks.push(`副武器 ${d.aux.lvDmg[0]}/${d.aux.range}`);
    for (const a of d.auras) perks.push(`${a.name} ${auraPct(a)}`);
    this.selBody.innerHTML = `
      <div class="udetail" title="${unitTip(d).replace(/"/g, '&quot;')}">
        <div class="who">
          <img src="${this.portrait(d.idx, w.humanTeam)}" draggable="false">
          <b>${d.name}</b>
          <span>${unitKind(d)}<i class="sep"> · </i><em>${SIZES[d.size].name}</em></span>
          <span class="${d.tier ? 'elite' : ''}">${d.tier ? '高级形态' : `初级<i class="sep"> · </i><em>升级需 ${unitUpgradeCost(d)} 金</em>`}</span>
        </div>
        <div class="rows">
          <div class="lvrow"><b>等级 ${lv + 1} / ${max}</b> ${LEVELS.names[lv]}
            <span class="pips">${'◆'.repeat(lv + 1)}<i>${'◇'.repeat(max - lv - 1)}</i></span>
            <span class="xp" title="击杀得全额经验，助攻得 ${Math.round(RULES.xp.assist * 100)}%"><u style="width:${xpPct}%"></u></span>
            <span class="dim">${next ? `经验 ${Math.round(w.xp[s])} / ${next}` : '已满级'}</span></div>
          <div class="grid">
            <span>生命</span><b>${Math.round(w.hp[s])} / ${Math.round(w.maxHp[s])}${pct(LEVELS.hp)}</b>
            <span>攻击</span><b>${num(d.main.lvDmg[lv])}${d.main.splash ? '（范围）' : ''}${pct(LEVELS.dmg)}</b>
            <span>间隔</span><b>${num(d.main.lvCd[lv])} 秒${lv > 0 && LEVELS.cd ? ` <i>−${Math.round(LEVELS.cd * lv * 100)}%</i>` : ''}</b>
            <span>射程</span><b>${rangeText(d)}</b>
            <span>护甲</span><b>近 ${num(d.lvArmM[lv])} · 远 ${num(d.lvArmP[lv])}${lv > 0 && LEVELS.armor ? ` <i>+${num(LEVELS.armor * lv)}</i>` : ''}</b>
            <span>防御</span><b>×${num(1 + LEVELS.def * lv)}${lv > 0 ? ' <i>受到的伤害按此折算</i>' : ''}</b>
            <span>速度</span><b>行军 ${d.walk} · 奔跑 ${d.speed}</b>
            <span>士气</span><b class="${routAt >= 0 && m < routAt + 12 ? 'bad' : m < 55 ? 'warn' : ''}">${m} <i>${routAt < 0 ? '死战不退' : `低于 ${routAt} 溃逃`}</i></b>
            <span>状态</span><b>${flags.join(' · ')}</b>
          </div>
          ${perks.length ? `<div class="dim">${perks.join('　')}</div>` : ''}
          <div class="fx"${fx ? '' : ' hidden'}>${fx}</div>
        </div>
      </div>`;
  }

  /**
   * 「取消集结」有没有东西可取消：选中己方出援军的据点看它自己，没选据点看全部己方据点；
   * 选中的据点不是这样的（敌方、中立、不出援军）时留着可按（按下会提示）
   */
  private rallySet(site: number): boolean {
    const w = this.world;
    if (site >= 0 && !w.sites[site].gone) {
      const s = w.sites[site];
      return s.owner !== w.humanTeam || !canRally(s) || !!s.rally;
    }
    return rallySites(w, w.humanTeam).some(s => s.rally);
  }

  /**
   * @param site 没选部队时选中的据点（-1 = 没有）
   * @param screen 屏幕内的己方单位（兵种栏按它数没选中的兵种的数量）
   * @param allPicked 全选卡片处于选中态（见 CardBar.update）
   */
  updateSelection(sel: number[], site = -1, screen: number[] = [], allPicked = false): void {
    const w = this.world;
    // ---- 详情：选中单个单位，或没选部队而选着据点；用关闭按钮收起的那一个不再弹出，直到重新选它 ----
    const siteShown = !sel.length && site >= 0 && !w.sites[site].gone, unitShown = sel.length === 1 && w.alive[sel[0]];
    this.detailKey = siteShown ? `s${site}` : unitShown ? `u${w.uid[sel[0]]}` : '';
    // 下令顺带换的选择（detailQuiet）：没显示着的详情不打开，记成收起，直到玩家重新选
    if (this.detailQuiet && this.selBox.hidden) this.detailClosed = this.detailKey;
    if (this.detailKey && this.detailKey !== this.detailClosed) {
      // 换了对象或重新打开：从头看起，不留着上一个详情滚到的位置（隐藏着的元素设 scrollTop 无效，要先显示出来）
      const fresh = this.selBox.hidden || this.detailKey !== this.shownKey;
      this.shownKey = this.detailKey;
      this.selBox.hidden = false;
      if (siteShown) this.siteDetail(w.sites[site]);
      else this.unitDetail(sel[0]);
      if (fresh) this.selBody.scrollTop = 0;
    } else if (!this.selBox.hidden) {
      this.selBox.hidden = true;
      this.selKey = '?';
    }
    // ---- 指令按钮：没选部队时部队指令不可用；没设集结点时「取消集结」不可用 ----
    this.hasSel = sel.length > 0 || site >= 0;
    for (const [cmd, b] of this.cmdBtns) {
      if (cmd === 'deselect') continue;
      const off = cmd === 'unrally' ? !this.rallySet(site) : cmd === 'follow' ? !sel.length && !this.following
        : cmd !== 'all' && cmd !== 'rally' && !sel.length;
      if (b.disabled !== off) b.disabled = off;
      if (cmd === 'follow') b.classList.toggle('on', this.following);
    }
    this.syncDeselect();
    this.slotRow?.update(sel);
    this.cards.update(sel, screen, allPicked);
  }


  showGameOver(win: boolean | null, onAgain: () => void): void {
    this.closeSettings();
    const w = this.world;
    const human = w.humanTeam || 1, other = 3 - human;
    const f = w.factions as FactionDef[];
    const title = win === null ? `${f[w.winner].name} 获胜` : win ? '胜　利' : '战　败';
    const sub = win === null ? '' : win ? '敌方城池与营寨已全部丢失' : '我方城池与营寨已全部丢失';
    const t = Math.floor(w.time);
    this.over.innerHTML = `
      <div class="panel card ${win === false ? 'lose' : 'win'}">
        <h1>${title}</h1><p>${sub}</p>
        <table>
          <tr><th></th><th>${f[human].name}</th><th>${f[other].name}</th></tr>
          <tr><td>歼敌</td><td>${w.kills[human]}</td><td>${w.kills[other]}</td></tr>
          <tr><td>损失</td><td>${w.lost[human]}</td><td>${w.lost[other]}</td></tr>
          <tr><td>其中逃散</td><td>${w.deserted[human]}</td><td>${w.deserted[other]}</td></tr>
          <tr><td>援军</td><td>${w.arrived[human]}</td><td>${w.arrived[other]}</td></tr>
          <tr><td>残存</td><td>${w.teamCount[human]}</td><td>${w.teamCount[other]}</td></tr>
        </table>
        <p>用时 ${(t / 60) | 0} 分 ${t % 60} 秒</p>
        <button class="primary">返回主菜单</button>
      </div>`;
    this.over.querySelector('button')!.onclick = onAgain;
    this.over.hidden = false;
  }

  destroy(): void {
    this.host.classList.remove('mobile', 'watch', 'stick-right');
    for (const f of this.disposers) f();
    this.root.remove();
  }
}
