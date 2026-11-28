/** 一局游戏：主循环、镜头、选择与指令输入 */
import { BK_GATE, BK_WALL, BR_MILITARY, DT, FactionDef, RES_NAMES, RULES, SITE_INFO, UNITS } from './sim/defs';
import { Game, GameOptions, createGame } from './sim/setup';
import { canRally, rallySites } from './sim/rally';
import { pickedUnit } from './sim/systems/sites';
import { canAttackBuilding } from './sim/systems/targeting';
import { canUpgradeSite, siteUpgradeCost, unitUpgradeCost, upgradeQueue } from './sim/systems/economy';
import { MAX_UNITS, S_ROUT, Site, World } from './sim/world';
import { Minimap } from './render/minimap';
import { Renderer, type Marker } from './render/renderer';
import { CardKind, allCardPicked } from './ui/cardBar';
import { Hud, type HudCallbacks, UpgradeAction, UpgradeChoice, UpgradeOffers } from './ui/hud';
import { Sound } from './audio/sound';
import { BackGuard, blocksEdgeSwipe } from './backGuard';
import { WheelClassifier, WheelMode, asWheelMode, edgeSpeed, exitDirection, fracToZoom, zoomToFrac } from './camInput';
import { loadPref, savePref } from './prefs';
import { GroundTaps, Pinch, TouchGestures, UiMode, asUiMode, isMobileUi } from './touchInput';
import { PointerLock } from './pointerLock';

type Mode = '' | 'amove' | 'rally' | 'outpost';
/** 镜头跟随的平滑程度：每秒把剩下的距离收拢多少（越大跟得越紧） */
const FOLLOW_RATE = 4;
/** 移动版摇杆推到头时的卷屏速度，是方向键卷屏速度的几倍：竖屏画面窄，照方向键的速度一秒要卷过一屏半，这里压到一屏出头 */
const STICK_GAIN = 0.8;
/** 滚轮一格按行 / 按页计量时（Firefox 的鼠标滚轮）换算成多少像素 */
const WHEEL_LINE = 33;
const WHEEL_PAGE = 800;

/** 速度按钮与 + / − 依次切换的速度 */
const SPEEDS = [1, 2, 4];

export class GameApp {
  readonly world: World;
  readonly renderer: Renderer;
  private readonly game: Game;
  private readonly hud: Hud;
  private readonly minimap: Minimap;
  private readonly box: HTMLDivElement;
  private readonly sel = new Uint8Array(MAX_UNITS);
  private selList: number[] = [];
  /** 全选卡片处于选中态：它代表的是选中的人，不再是屏幕内的（见 setSelection） */
  private selAll = false;
  /** 正在下令或编队而顺带换选择（拖卡片、Shift+数字）：不重新打开用关闭按钮收起的详情 */
  private quietSelect = false;
  /** 焦点是用键盘（Tab）移到当前元素上的：这时空格 / Enter 交给获得焦点的按钮 */
  private keyNav = false;
  private selUid: number[] = [];
  /** 没选部队时选中的据点（-1 = 没有） */
  private selSite = -1;
  private readonly groups: { slots: number[]; uids: number[] }[] = [];
  private speed = 1;
  private lastSpeed = 1;
  private acc = 0;
  private last = 0;
  private raf = 0;
  private mode: Mode = '';
  private readonly keys = new Set<string>();
  /**
   * mx / my：最近一次移动的方向（判断鼠标从哪条边离开网页）；
   * out：鼠标从某条边离开了网页，朝那个方向续卷，直到鼠标回来或窗口失去焦点
   */
  /** buttons：按着的鼠标键（拖框、拖小地图、拖卡片时不边缘卷屏） */
  private mouse = { x: 0, y: 0, mx: 0, my: 0, buttons: 0, inside: false, out: null as { dx: number; dy: number } | null };
  private wheelMode: WheelMode = asWheelMode(loadPref('wheel'));
  private readonly wheel = new WheelClassifier();
  /** Safari 的捏合手势进行中：开始时的缩放（期间忽略带 Ctrl 的 wheel，免得别的浏览器两种事件都发时缩两次） */
  private gesture: { zoom: number } | null = null;
  private drag: { x: number; y: number; active: boolean } | null = null;
  private pan: { x: number; y: number; rotate: boolean } | null = null;
  /** 右键按下的位置：拖出一段距离就是在指定队列朝向 */
  private rdrag: { sx: number; sy: number; x: number; y: number; active: boolean } | null = null;
  private readonly cam0 = { yaw: 0, pitch: 0.8 };
  private lastClick = { t: 0, type: -1 };
  private lastGroup = { t: 0, g: -1 };
  /** 镜头跟随的部队（按 C 开关）：镜头平滑地跟着他们的重心走，手动移动镜头即取消 */
  private follow: { slots: number[]; uids: number[] } | null = null;
  /** 「界面」设置与据此得出的结果：移动版是上下分屏的竖屏触控布局（根上的 mobile 类） */
  private uiMode: UiMode = asUiMode(loadPref('ui'));
  private mobile = false;
  private readonly portraitQuery = window.matchMedia('(pointer: coarse) and (orientation: portrait)');
  private groundMarker: Marker | undefined;
  private readonly groundTaps = new GroundTaps((p, attackMove) => {
    if (!attackMove && this.groundMarker) {
      const index = this.renderer.markers.indexOf(this.groundMarker);
      if (index >= 0) this.renderer.markers.splice(index, 1);
    }
    const marker = this.issueMove(p.x, p.y, attackMove);
    this.groundMarker = attackMove ? marker : undefined;
  });
  /** 移动版画面上的手指手势（点、长按、框选、双指缩放旋转） */
  private readonly touch = new TouchGestures({
    tap: (x, y) => this.primaryClick(x, y, false),
    hold: (x, y) => this.touchHold(x, y),
    canBox: () => !this.mode && !!this.world.humanTeam,
    box: (x0, y0, x1, y1, done, commit) => this.touchBox(x0, y0, x1, y1, done, commit),
    pinchStart: () => this.groundTaps.cancel(),
    pinch: p => this.touchPinch(p),
  });
  private uiTimer = 0;
  private mmTimer = 0;
  private over = false;
  private fps = 60;
  private readonly cleanup: (() => void)[] = [];
  /** 锁定鼠标模式：要在 Hud 之前建，它在 window 捕获阶段的监听得排在 Hud 的前面，才拦得住真实事件 */
  private readonly pointer: PointerLock;

  constructor(private readonly root: HTMLElement, private readonly canvas: HTMLCanvasElement, opts: GameOptions,
    private readonly onExit: () => void, private readonly sound: Sound) {
    this.game = createGame(opts);
    const w = (this.world = this.game.world);
    this.renderer = new Renderer(canvas, w);
    this.pointer = new PointerLock(canvas, loadPref('lockMouse') === '1', locked => {
      // 解锁后真实光标在哪不知道，等它动一下再算；虚拟光标停在边上时别接着卷
      this.mouse.out = null;
      if (!locked) this.mouse.inside = false;
    }, giveUp => this.hud.message(giveUp
      ? '锁定鼠标连续失败，这一局点画面不再进入锁定；在「设置」里关掉再打开即可重试'
      : '锁定鼠标失败，请再点一下画面；一直失败可在「设置」里关掉', 'bad'));
    const rgb = this.renderer.teamRgb;
    this.hud = new Hud(root, w, rgb, {
      command: c => this.command(c),
      upgrade: a => this.upgrade(a),
      selectSite: id => this.selectSite(id),
      siteAction: (act, id, unit) => this.siteAction(act, id, unit),
      pickTypes: (types, mode) => this.pickTypes(types, mode),
      pickAll: mode => this.pickAll(mode),
      selectGroup: (g, jump) => this.selectGroup(g, jump),
      unpickCard: (kind, id) => this.unpickCard(kind, id),
      cardCount: (kind, id) => this.cardUnits(kind, id).length,
      upgradeChoices: (kind, id) => this.upgradeChoices(kind, id),
      groupSlot: g => this.groupSlot(g),
      groupCard: (kind, id) => this.groupCard(kind, id),
      zoomTo: f => this.zoomAt(this.renderer.viewW / 2, this.renderer.viewH / 2, fracToZoom(f) / this.renderer.cam.zoom),
      dropCard: (kind, id, x, y, target) => this.dropCard(kind, id, x, y, target),
      togglePause: () => this.togglePause(),
      cycleSpeed: () => this.setSpeed(SPEEDS[(SPEEDS.indexOf(this.lastSpeed) + 1) % SPEEDS.length]),
      focus: (x, y) => this.focus(x, y),
      exit: () => this.onExit(),
      toggleSound: () => this.sound.toggle(),
      soundOn: () => this.sound.enabled,
      toggleMusic: () => this.sound.toggleMusic(),
      musicOn: () => this.sound.musicEnabled,
      wheelMode: () => this.wheelMode,
      setWheelMode: m => {
        this.wheelMode = m;
        savePref('wheel', m);
      },
      uiMode: () => this.uiMode,
      setUiMode: m => {
        this.uiMode = m;
        savePref('ui', m);
        this.applyLayout();
      },
      lockMouseSupported: () => this.pointer.supported,
      lockMouse: () => this.pointer.enabled,
      setLockMouse: on => {
        this.pointer.setEnabled(on);
        savePref('lockMouse', on ? '1' : '0');
      },
    });
    this.minimap = new Minimap(this.hud.minimap, w, this.renderer.terrain.miniColors,
      rgb.map(c => `rgb(${c[0]},${c[1]},${c[2]})`));
    this.box = document.createElement('div');
    this.box.className = 'selbox';
    root.appendChild(this.box);

    const cam = this.renderer.cam;
    if (w.humanTeam) {
      const dp = w.map.deploy[w.humanTeam];
      cam.x = dp.x;
      cam.y = dp.y;
      cam.zoom = 1.25;
    } else {
      cam.x = w.W / 2;
      cam.y = w.H / 2;
      cam.zoom = 0.4;
    }
    this.bind();
    this.applyLayout();
    const onQuery = (): void => this.applyLayout();
    this.portraitQuery.addEventListener('change', onQuery);
    this.cleanup.push(() => this.portraitQuery.removeEventListener('change', onQuery));
    // 小地图的显示尺寸随布局变（移动版里按下半屏剩下的空间放大）
    const mmObserver = new ResizeObserver(() => this.minimap.resize());
    mmObserver.observe(this.hud.minimap);
    this.cleanup.push(() => mmObserver.disconnect());
    this.refreshUi();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.cancelTouch();
    for (const f of this.cleanup) f();
    this.pointer.destroy();
    this.hud.destroy();
    this.sound.dispose();
    this.box.remove();
  }

  // ------------------------------------------------------------------ 输入
  private on<K extends keyof WindowEventMap>(target: Window | HTMLElement, type: K, fn: (e: WindowEventMap[K]) => void,
    opts?: AddEventListenerOptions): void {
    target.addEventListener(type, fn as EventListener, opts);
    this.cleanup.push(() => target.removeEventListener(type, fn as EventListener, opts));
  }

  private bind(): void {
    const cv = this.canvas;
    // 对局中拦住「返回」：误触系统的返回手势不该丢掉这一局
    const guard = new BackGuard(() => this.hud.message(`已拦下返回：要离开对局请点${this.mobile ? '菜单里的' : '右上角的'}「退出」`, 'info'));
    guard.start();
    this.cleanup.push(() => guard.stop());
    // iOS Safari 从屏幕边缘起手的滑动是「返回上一页」，会抢走拉抽屉、框选、推摇杆的那一下：在这些界面上边缘起手时拦下默认行为
    this.on(this.root, 'touchstart', e => {
      if (e.cancelable && blocksEdgeSwipe(e, window.innerWidth)) e.preventDefault();
    }, { passive: false });
    this.on(cv, 'contextmenu', e => e.preventDefault());
    // 浏览器要有用户操作才允许出声
    this.on(window, 'pointerdown', e => {
      this.sound.unlock();
      if (e.target !== cv || e.button !== 0) this.groundTaps.cancel();
    }, { capture: true });
    this.on(window, 'pointerup', e => { if (e.pointerType === 'touch') this.sound.unlock(); }, { capture: true });
    const syncAudio = (): void => this.syncAudioPause();
    document.addEventListener('visibilitychange', syncAudio);
    this.cleanup.push(() => document.removeEventListener('visibilitychange', syncAudio));
    this.on(cv, 'pointerdown', e => {
      cv.focus();
      if (this.hud.helpOpen) return;
      const p = this.local(e);
      if (this.mobile && e.button === 0) {
        cv.setPointerCapture(e.pointerId);
        this.touch.down(e.pointerId, p.x, p.y);
        return;
      }
      if (e.button === 1) {
        // 中键拖动旋转镜头；按住 Shift 改为平移
        this.pan = { x: p.x, y: p.y, rotate: !e.shiftKey };
        cv.setPointerCapture(e.pointerId);
        e.preventDefault();
      } else if (e.button === 0) {
        if (this.mode) {
          this.modeClick(p.x, p.y);
          return;
        }
        this.drag = { x: p.x, y: p.y, active: false };
        cv.setPointerCapture(e.pointerId);
      } else if (e.button === 2) {
        if (this.mode) this.setMode('');
        else if (this.world.humanTeam && this.selList.length) {
          const wp = this.renderer.screenToWorld(p.x, p.y);
          this.rdrag = { sx: p.x, sy: p.y, x: wp.x, y: wp.y, active: false };
          cv.setPointerCapture(e.pointerId);
        }
      }
    });
    this.on(cv, 'pointermove', e => {
      const p = this.local(e);
      if (this.mobile) this.touch.move(e.pointerId, p.x, p.y);
      this.mouse.x = p.x;
      this.mouse.y = p.y;
      this.mouse.inside = true;
      if (this.pan) {
        const cam = this.renderer.cam;
        if (this.pan.rotate) {
          cam.yaw -= (p.x - this.pan.x) * 0.006;
          cam.pitch += (p.y - this.pan.y) * 0.004;
        } else {
          // 让按住的那一点地面跟着鼠标走
          const a = this.renderer.screenToWorld(this.pan.x, this.pan.y), b = this.renderer.screenToWorld(p.x, p.y);
          if (a.x !== b.x || a.y !== b.y) this.stopFollow();
          cam.x += a.x - b.x;
          cam.y += a.y - b.y;
        }
        this.pan.x = p.x;
        this.pan.y = p.y;
        this.renderer.clampCam();
      }
      const rd = this.rdrag;
      if (rd) {
        if (!rd.active && Math.hypot(p.x - rd.sx, p.y - rd.sy) > 14) rd.active = true;
        if (rd.active) {
          const wp = this.renderer.screenToWorld(p.x, p.y);
          this.renderer.arrow = { x0: rd.x, y0: rd.y, x1: wp.x, y1: wp.y };
        }
      }
      const d = this.drag;
      if (d) {
        if (!d.active && Math.hypot(p.x - d.x, p.y - d.y) > 5) {
          d.active = true;
          this.groundTaps.cancel();
        }
        if (d.active) {
          this.showBox(d.x, d.y, p.x, p.y);
          this.hud.cards.markCards(this.clientRect(d.x, d.y, p.x, p.y));
        }
      }
    });
    this.on(cv, 'pointerup', e => {
      const p = this.local(e);
      if (this.mobile && e.button === 0) this.touch.up(e.pointerId, p.x, p.y);
      if (this.pan && (e.button === 1 || e.button === 0)) this.pan = null;
      const rd = this.rdrag;
      if (rd && e.button === 2) {
        this.rdrag = null;
        this.renderer.arrow = null;
        if (rd.active) {
          // 拖动：在按下的位置列阵，面朝拖动的方向
          const wp = this.renderer.screenToWorld(p.x, p.y);
          this.issueMove(rd.x, rd.y, false, wp.x - rd.x, wp.y - rd.y);
        } else this.rightClick(rd.sx, rd.sy, e.ctrlKey || e.metaKey);
      }
      const d = this.drag;
      if (d && e.button === 0) {
        this.drag = null;
        this.box.style.display = 'none';
        this.hud.cards.markCards(null);
        if (d.active) this.boxSelect(d.x, d.y, p.x, p.y, e.shiftKey);
        // 鼠标有右键下令，左键只管选择（点空地即取消选择）；手指和触控笔没有右键，单击地面才下令
        else if (e.pointerType !== 'mouse') this.primaryClick(p.x, p.y, e.shiftKey);
        else this.clickSelect(p.x, p.y, e.shiftKey);
      }
    });
    this.on(cv, 'pointercancel', () => this.cancelTouch());
    // 鼠标位置在整个窗口上跟踪（贴边卷屏不管底下是不是界面面板）
    this.on(window, 'pointermove', e => {
      const p = this.local(e), m = this.mouse;
      if (p.x !== m.x || p.y !== m.y) {
        m.mx = p.x - m.x;
        m.my = p.y - m.y;
      }
      m.x = p.x;
      m.y = p.y;
      m.buttons = e.buttons;
      m.inside = p.x >= 0 && p.y >= 0 && p.x <= this.renderer.viewW && p.y <= this.renderer.viewH;
      m.out = null;
    });
    // 拖到边上松手、鼠标不再动时也要马上开始卷屏
    this.on(window, 'pointerup', e => {
      this.mouse.buttons = e.buttons;
    });
    // 鼠标从某条边离开网页（冲过头进了浏览器的标签栏、macOS 全屏时碰出了菜单栏）：朝那个方向续卷，鼠标回来即停
    this.on(document.documentElement, 'pointerleave', e => {
      const p = this.local(e), m = this.mouse;
      m.inside = false;
      m.out = e.pointerType === 'mouse' && !e.buttons
        ? exitDirection(p.x, p.y, m.mx, m.my, this.renderer.viewW, this.renderer.viewH) : null;
    });
    this.on(document.documentElement, 'pointerenter', () => {
      this.mouse.out = null;
    });
    this.on(cv, 'wheel', e => this.onWheel(e), { passive: false });
    // 捏合时浏览器默认缩放整个网页：在界面面板上捏合也拦下（面板里的列表照常滚动）
    this.on(window, 'wheel', e => {
      if (e.ctrlKey) e.preventDefault();
    }, { passive: false });
    // Safari 的捏合不发带 Ctrl 的 wheel，而是自己的手势事件（不在标准类型里）
    const gestureStart = (e: Event): void => {
      e.preventDefault();
      this.gesture = { zoom: this.renderer.cam.zoom };
    };
    const gestureChange = (e: Event): void => {
      e.preventDefault();
      // 移动版的双指缩放由指针事件处理，Safari 同时发的手势事件不能再缩一次
      if (this.mobile) return;
      const g = this.gesture, scale = (e as Event & { scale?: number }).scale;
      // 锁定时手势事件的 target 多半是锁定元素：改看虚拟光标下的元素
      const v = this.pointer.virtualPos;
      const onCanvas = v ? document.elementFromPoint(v.x, v.y) === cv : e.target === cv;
      if (!g || !scale || !onCanvas) return;
      this.groundTaps.cancel();
      this.zoomAt(this.mouse.x, this.mouse.y, (g.zoom * scale) / this.renderer.cam.zoom);
    };
    const gestureEnd = (e: Event): void => {
      e.preventDefault();
      this.gesture = null;
    };
    for (const [type, fn] of [['gesturestart', gestureStart], ['gesturechange', gestureChange], ['gestureend', gestureEnd]] as const) {
      window.addEventListener(type, fn, { passive: false });
      this.cleanup.push(() => window.removeEventListener(type, fn));
    }

    // 小地图
    const mm = this.hud.minimap;
    let mmDown = false;
    const mmPos = (e: PointerEvent): { x: number; y: number } => {
      const r = mm.getBoundingClientRect();
      return this.minimap.toWorld(e.clientX - r.left, e.clientY - r.top);
    };
    this.on(mm, 'contextmenu', e => e.preventDefault());
    this.on(mm, 'pointerdown', e => {
      const p = mmPos(e);
      if (e.button === 2) {
        if (this.mode) this.setMode('');
        else if (this.selList.length) this.issueMove(p.x, p.y, false);
      } else if (this.mode) this.modeAt(p.x, p.y);
      else {
        mmDown = true;
        mm.setPointerCapture(e.pointerId);
        this.focus(p.x, p.y);
      }
    });
    this.on(mm, 'pointermove', e => {
      if (!mmDown) return;
      const p = mmPos(e);
      this.focus(p.x, p.y);
    });
    this.on(mm, 'pointerup', () => {
      mmDown = false;
    });

    // 焦点是怎么来的：按 Tab 移过来的算键盘，之后任何一次指针按下都算回指针（焦点元素没变也一样）
    this.on(window, 'pointerdown', () => {
      this.keyNav = false;
    }, { capture: true });
    this.on(window, 'keydown', e => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === 'Tab') this.keyNav = true;
      // 用键盘把焦点移到按钮上时，空格 / Enter 交给按钮自己激活（读屏与键盘用户）；鼠标点过的按钮不算（不抢走空格暂停的习惯）
      if ((e.key === ' ' || e.key === 'Enter') && e.target instanceof HTMLButtonElement) {
        if (this.keyNav) return;
        // 鼠标点过、焦点还留着的按钮：Enter 不去激活它（空格在下面另作暂停）
        e.preventDefault();
      }
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      // 带 Ctrl / Cmd 的组合键不记入「按住的键」：Mac 上按着 Cmd 时字母键收不到松开事件，会一直卷屏
      if (!e.ctrlKey && !e.metaKey) this.keys.add(k);
      this.sound.unlock();
      if (e.repeat) return;
      const human = this.world.humanTeam;
      if (k.startsWith('Arrow') || k === ' ' || k === 'PageUp' || k === 'PageDown') e.preventDefault();
      // 移动镜头的键一按下就取消跟随（卷屏是每帧轮询按住的键，点得太快可能一帧也没赶上）
      if (k.startsWith('Arrow') || (!e.ctrlKey && !e.metaKey && (k === 'w' || k === 'a' || k === 's' || k === 'd'))) {
        this.stopFollow();
        this.groundTaps.cancel();
      }
      if (!e.ctrlKey && !e.metaKey && (k === 'q' || k === 'e' || k === 'PageUp' || k === 'PageDown')) this.groundTaps.cancel();
      if (k === 'Escape') {
        if (this.hud.helpOpen) this.hud.toggleHelp();
        else if (this.hud.settingsOpen) this.hud.closeSettings();
        else if (this.mode) this.setMode('');
        else {
          this.setSelection([]);
          this.selectSite(-1);
        }
      } else if (k === 'F1' || k === '?') {
        e.preventDefault();
        this.hud.toggleHelp();
      } else if (k === ' ' || k === 'p') this.togglePause();
      else if (k === '=' || k === '+') this.setSpeed(SPEEDS[Math.min(SPEEDS.length - 1, SPEEDS.indexOf(this.lastSpeed) + (this.speed ? 1 : 0))]);
      else if (k === '-') this.setSpeed(SPEEDS[Math.max(0, SPEEDS.indexOf(this.lastSpeed) - (this.speed ? 1 : 0))]);
      else if (k === 'm') this.hud.setSound(this.sound.toggle());
      else if (k === 'l') this.hud.toggleSites();
      else if (!human) return;
      else if (k === 'a' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this.command('all');
      } else if (k === 'f') this.command('amove');
      else if (k === 'c') this.command('follow');
      else if (k === 'x') this.command('stop');
      else if (k === 'h') this.command('hold');
      else if (k === 'r' || k === 'R') this.command(e.shiftKey ? 'unrally' : 'rally');
      else if (k === 't') this.command('torch');
      else if (k === 'b') this.command('outpost');
      else if (k === 'Home' || k === 'Backspace') {
        this.groundTaps.cancel();
        // 镜头转回正北、恢复默认俯角
        this.renderer.cam.yaw = this.cam0.yaw;
        this.renderer.cam.pitch = this.cam0.pitch;
      }
      else if (e.code.startsWith('Digit')) {
        // 用物理键位判断：Mac 上 Option+数字 输出的是特殊字符，Cmd+数字 又会被浏览器拿去切标签页
        const g = Number(e.code.slice(5));
        if (e.ctrlKey || e.metaKey || e.altKey) {
          e.preventDefault();
          this.assignGroup(g);
        } else if (e.shiftKey) {
          // 追加编队：把当前选中的并入该队，并选中合并后的整队
          const w = this.world;
          const old = this.groups[g];
          const slots = old ? old.slots.filter((s, i) => w.controllable(s) && w.uid[s] === old.uids[i]) : [];
          const have = new Set(slots);
          let added = 0;
          for (const s of this.selList) if (!have.has(s)) {
            slots.push(s);
            added++;
          }
          this.groups[g] = { slots, uids: slots.map(s => w.uid[s]) };
          this.pushGroups();
          this.quietSelect = true;
          this.hud.detailQuiet = !this.hud.detailShown;
          this.setSelection(slots.slice());
          this.quietSelect = this.hud.detailQuiet = false;
          this.hud.message(`第 ${g} 队追加 ${added} 人，共 ${slots.length} 人`, 'info');
        } else {
          if (!this.groups[g]) return;
          this.recallGroup(g);
        }
      }
    });
    this.on(window, 'keyup', e => {
      this.keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key);
    });
    this.on(window, 'blur', () => {
      this.keys.clear();
      this.pan = null;
      this.rdrag = null;
      this.renderer.arrow = null;
      this.mouse.inside = false;
      this.mouse.out = null;
      this.mouse.buttons = 0;
      this.gesture = null;
      this.cancelTouch();
      // 拖框时切走窗口可能收不到松手：收起框，也给卡片解冻（框选扫卡片期间卡片不重建）
      if (this.drag) {
        this.drag = null;
        this.box.style.display = 'none';
        this.hud.cards.markCards(null);
      }
    });
  }

  /**
   * 滚轮与触控板：捏合（带 Ctrl 的 wheel）一律缩放；鼠标滚轮缩放；触控板双指滑动平移镜头，按住 Option（Alt）时旋转、调俯角。
   * 鼠标还是触控板按设置，「自动」时由 `WheelClassifier` 按事件特征判断。
   */
  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    this.groundTaps.cancel();
    const p = this.local(e);
    const unit = e.deltaMode === 1 ? WHEEL_LINE : e.deltaMode === 2 ? WHEEL_PAGE : 1;
    const dx = e.deltaX * unit, dy = e.deltaY * unit;
    if (e.ctrlKey) {
      if (this.gesture) return;
      this.zoomAt(p.x, p.y, Math.exp(-Math.max(-50, Math.min(50, dy)) * 0.01));
      return;
    }
    const kind = this.wheel.classify({ deltaX: e.deltaX, deltaY: e.deltaY, deltaMode: e.deltaMode,
      wheelDeltaY: (e as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY }, this.wheelMode, performance.now() / 1000);
    if (kind === 'mouse') {
      this.zoomAt(p.x, p.y, Math.exp(-dy * 0.0015));
      return;
    }
    const cam = this.renderer.cam;
    if (e.altKey) {
      // 自然滚动下手指右移时 deltaX 为负：与中键往右拖同向转
      cam.yaw += dx * 0.006;
      cam.pitch -= dy * 0.004;
      this.renderer.clampCam();
      return;
    }
    // 像滚动网页一样平移：屏幕中央那一点地面跟着手指走
    const cx = this.renderer.viewW / 2, cy = this.renderer.viewH / 2;
    const a = this.renderer.screenToWorld(cx, cy), b = this.renderer.screenToWorld(cx + dx, cy + dy);
    if (a.x === b.x && a.y === b.y) return;
    this.stopFollow();
    cam.x += b.x - a.x;
    cam.y += b.y - a.y;
    this.renderer.clampCam();
  }

  /** 以屏幕上 (sx, sy) 为中心缩放 factor 倍；跟随中只缩放，不往那一点挪（挪了也会被拉回来） */
  private zoomAt(sx: number, sy: number, factor: number): void {
    const cam = this.renderer.cam;
    const before = this.renderer.screenToWorld(sx, sy);
    cam.zoom *= factor;
    this.renderer.clampCam();
    if (this.follow) return;
    const after = this.renderer.screenToWorld(sx, sy);
    cam.x += before.x - after.x;
    cam.y += before.y - after.y;
    this.renderer.clampCam();
  }

  private local(e: MouseEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private setMode(m: Mode): void {
    this.groundTaps.cancel();
    this.mode = m;
    // 样式表给整个界面设了 !important 的剑形指针，指令模式的十字准星要同样 !important 才盖得过
    this.canvas.style.setProperty('cursor', m ? 'crosshair' : '', m ? 'important' : '');
    this.pointer.refreshCursor();
    // 移动版的提示条占画面上方，写短：矮屏上也不超过两行
    const mb = this.mobile;
    this.hud.setMode(m === 'amove' ? `攻击移动：${mb ? '点一下目的地（再点指令取消）' : '左键指定目的地（右键取消）'}`
      : m === 'rally' ? `集结点：${mb ? '点一下位置' : '左键指定位置'}，${this.selSite >= 0 ? '只设所选据点' : '给全部据点设'}${mb ? '（再点指令退出）' : '（右键退出；Shift+R 取消集结点）'}`
      : m === 'outpost' ? (mb ? `扎营：点一下位置搭临时据点（木材 ${RULES.economy.outpostCost}，再点指令取消）`
        : `扎营：左键指定临时据点的位置，所选部队会赶去搭建（木材 ${RULES.economy.outpostCost}，右键取消）`) : '');
  }

  /** 设集结点模式下选中对象变了：提示跟着换；选中的据点设不了集结点就退出模式，并给出与按 R 时一样的提示 */
  private refreshRallyMode(): void {
    if (this.mode !== 'rally') return;
    this.setMode(this.rallyTargets() ? 'rally' : '');
  }

  /** 暂停 / 继续（继续用暂停前的速度） */
  private togglePause(): void {
    this.setSpeed(this.speed ? 0 : this.lastSpeed);
  }

  private setSpeed(s: number): void {
    if (s > 0) this.lastSpeed = s;
    this.speed = s;
    this.hud.setSpeed(s);
  }

  private focus(x: number, y: number): void {
    this.stopFollow();
    this.renderer.cam.x = x;
    this.renderer.cam.y = y;
    this.renderer.clampCam();
  }

  // ------------------------------------------------------------------ 选择
  /** all：指定全选卡片的选中态（点全选卡片时），不给就按屏幕内的人是否全都选着来定 */
  private setSelection(list: number[], all?: boolean): void {
    this.groundTaps.cancel();
    for (const s of this.selList) this.sel[s] = 0;
    this.selList = list;
    this.selUid = list.map(s => this.world.uid[s]);
    for (const s of list) this.sel[s] = 1;
    this.selAll = list.length > 0 && (all ?? allCardPicked(list, this.screenUnits()));
    // 玩家重新选了人：收起的详情可以再弹出来；拖卡片下令、追加编队顺带换的选择不算
    if (!this.quietSelect) this.hud.reopenDetail();
    this.hud.selectionChanged();
    // 选了部队就不再选着据点
    if (list.length) this.selSite = this.renderer.selSite = -1;
    this.refreshRallyMode();
    this.syncSelection();
  }

  /** 把当前的选择交给界面（详情、指令按钮、卡片） */
  private syncSelection(): void {
    this.hud.updateSelection(this.selList, this.selSite, this.screenUnits(), this.allPicked);
  }

  /** 全选卡片处于选中态（选中的人全部阵亡、溃逃被清出选择后就不算） */
  private get allPicked(): boolean {
    return this.selAll && this.selList.length > 0;
  }

  private selectSite(id: number): void {
    if (id >= 0 && this.selList.length) this.setSelection([]);
    this.selSite = this.renderer.selSite = id;
    this.hud.reopenDetail();
    this.refreshRallyMode();
    this.syncSelection();
  }

  /** 鼠标点到的据点：点在它的建筑上，或者点在旗帜圈里 */
  private siteAt(x: number, y: number): number {
    const w = this.world;
    if (x <= 0 || y <= 0 || x >= w.W || y >= w.H || (w.fog && !w.isExplored(x, y))) return -1;
    const bid = w.nav.bld[w.cellAt(x, y)];
    if (bid >= 0 && w.buildings[bid].site >= 0 && !w.sites[w.buildings[bid].site].gone) return w.buildings[bid].site;
    const r2 = RULES.capture.flagRadius ** 2;
    for (const s of w.sites) if (!s.gone && (s.x - x) ** 2 + (s.y - y) ** 2 < r2) return s.id;
    return -1;
  }

  /** 全图的己方单位（可操控的） */
  private myUnits(): number[] {
    const w = this.world, human = w.humanTeam;
    const out: number[] = [];
    for (let i = 0; i < w.n; i++) if (w.controllable(i) && w.team[i] === human) out.push(i);
    return out;
  }

  /** 全图还能再升一级的己方据点（城池或营寨），近的（离镜头中心）排前面 */
  private mySites(category: 'city' | 'camp'): Site[] {
    const w = this.world, c = this.renderer.cam;
    return w.sites.filter(s => s.owner === w.humanTeam && SITE_INFO[s.type].category === category && canUpgradeSite(s))
      .sort((a, b) => (a.x - c.x) ** 2 + (a.y - c.y) ** 2 - ((b.x - c.x) ** 2 + (b.y - c.y) ** 2));
  }

  /** 按升级的先后次序往下数，看黄金够升几个 */
  private affordUnits(units: number[]): { count: number; cost: number; total: number; need: number; picks: number[] } {
    const w = this.world;
    let left = w.stock.gold[w.humanTeam], count = 0, cost = 0, need = Infinity;
    const q = upgradeQueue(w, units), picks: number[] = [];
    for (const s of q) {
      const c = unitUpgradeCost(w.defs[w.type[s]]);
      need = Math.min(need, c);
      if (c > left + 1e-6) continue;
      left -= c;
      cost += c;
      count++;
      picks.push(s);
    }
    return { count, cost, total: q.length, need: Number.isFinite(need) ? need : 0, picks };
  }

  /** 此刻该出现哪些升级按钮：「全部升级」针对全图，资源不够全升时能升几个就升几个 */
  private offers(): UpgradeOffers {
    const w = this.world, human = w.humanTeam;
    const o: UpgradeOffers = { sel: null, all: null, cities: null, camps: null };
    if (!human) return o;
    if (w.stock.gold[human] >= RULES.economy.unitGold) {
      const sel = this.selList.length ? this.affordUnits(this.selList) : null, all = this.affordUnits(this.myUnits());
      if (sel?.count) o.sel = sel;
      if (all.count) o.all = all;
    }
    for (const cat of ['city', 'camp'] as const) {
      const list = this.mySites(cat);
      let left = w.stock[cat === 'city' ? 'stone' : 'wood'][human], count = 0, cost = 0;
      for (const s of list) {
        const c = siteUpgradeCost(s);
        if (c > left) continue;
        left -= c;
        cost += c;
        count++;
      }
      if (count) o[cat === 'city' ? 'cities' : 'camps'] = { count, cost, total: list.length };
    }
    return o;
  }

  private upgrade(act: UpgradeAction): void {
    const w = this.world;
    if (!w.humanTeam) return;
    if (act === 'sel' || act === 'all') {
      this.upgradeList(act === 'sel' ? this.selList : this.myUnits());
      return;
    }
    const list = this.mySites(act === 'cities' ? 'city' : 'camp').filter(s => w.upgradeSite(s));
    if (list.length) {
      this.hud.message(list.map(s => `${s.name} 升到 ${s.level} 级`).join('、'), 'good');
      this.sound.ui('order');
    } else this.sound.ui('deny');
    this.refreshUi();
  }

  /** 把这批人升为高级形态（等级高的优先，黄金用尽为止），出战报；返回升了几人 */
  private upgradeList(units: number[]): number {
    const r = this.world.upgradeUnits(units);
    if (r.count) {
      this.hud.message(`${r.count} 人升为高级形态，花费黄金 ${Math.round(r.cost)}`, 'good');
      this.sound.ui('order');
    } else this.sound.ui('deny');
    this.refreshUi();
    return r.count;
  }

  /**
   * 长按卡片时的升级选择：兵种卡片是这张卡代表的人与全图的这个兵种，全选卡片是它代表的人；
   * 有选中时再加「当前选中的部队」（可能混编）；与前面某一项是同一批人的不重复列
   */
  private upgradeChoices(kind: 'all' | 'type', id: number): UpgradeChoice[] {
    const w = this.world;
    if (!w.humanTeam) return [];
    return this.upgradeSets(kind, id).map(({ label, units }) => {
      const { count, cost, total, need, picks } = this.affordUnits(units), size = units.length;
      // 点下去只升报价上的这几个人（玩家看到的人数与金额是上限）：弹出框开着时游戏照常跑，
      // 阵亡的人的槽位会被新兵（甚至敌军）复用，所以按 uid 核对，仍是己方、还能升的才升
      const uids = picks.map(s => w.uid[s]);
      return { label, offer: count ? { count, cost } : null, total, need, size, run: () => {
        // 报价开着期间可能已经变了：人不在了、被别处（指令面板）先升了、黄金被别处花掉了；各给各的说明，都没花黄金
        const alive = picks.filter((s, i) => w.uid[s] === uids[i] && w.controllable(s) && w.team[s] === w.humanTeam);
        const valid = new Set(upgradeQueue(w, alive));
        const list = picks.filter(s => valid.has(s));
        const why = !alive.length ? '升级的人已不在（阵亡或溃逃）'
          : !list.length ? '这些人已是高级形态'
          : this.upgradeList(list) ? '' : '黄金不足';
        if (why) {
          this.hud.message(`${why}，没有花黄金`, 'info');
          if (!list.length) this.sound.ui('deny');
        }
      } };
    });
  }

  /** upgradeChoices 的各项与各自的人 */
  private upgradeSets(kind: 'all' | 'type', id: number): { label: string; units: number[] }[] {
    const w = this.world;
    const sets: { label: string; units: number[] }[] = [];
    if (kind === 'type') {
      sets.push({ label: '升级这些人', units: this.typeUnits([id]) });
      sets.push({ label: `升级全图的${UNITS[id].name}`, units: this.myUnits().filter(s => w.type[s] === id) });
    } else sets.push({ label: '升级这些人', units: this.allCardUnits() });
    if (this.selList.length) sets.push({ label: '升级当前选中的部队', units: this.selList.slice() });
    // 与前面某一项是同一批人的不再列（如这个兵种全在屏幕内、选中的正是这张卡的人）
    const same = (a: number[], b: number[]): boolean => {
      const set = new Set(a);
      return a.length === b.length && b.every(s => set.has(s));
    };
    return sets.filter((s, i) => !sets.slice(0, i).some(p => same(p.units, s.units)));
  }

  private siteAction(act: 'upgrade' | 'tower' | 'pick', id: number, unit?: number): void {
    const w = this.world, s = w.sites[id];
    if (!s || s.owner !== w.humanTeam) return;
    const info = SITE_INFO[s.type];
    if (act === 'pick') {
      const before = pickedUnit(w, s);
      if (unit === undefined || !w.pickUnit(s, w.humanTeam, unit)) return;
      if (unit !== before) this.hud.message(`${s.name} 改出${UNITS[unit].name}，援军计时重新开始`, 'info', s.x, s.y);
    } else if (act === 'upgrade') {
      const cost = siteUpgradeCost(s);
      if (w.upgradeSite(s)) this.hud.message(`${s.name} 升到 ${s.level} 级：建筑更坚固，火力更强`, 'good', s.x, s.y);
      else if (cost > 0) this.hud.message(`${RES_NAMES[info.material]}不足，升级 ${s.name} 需要 ${cost}`, 'info');
    } else if (w.buildTower(s)) this.hud.message(`${s.name} 建起一座哨塔`, 'good', s.x, s.y);
    else this.hud.message(`木材不足，建哨塔需要 ${RULES.economy.towerCost}`, 'info');
    this.sound.ui('order');
    this.refreshUi();
  }

  private refreshUi(): void {
    this.hud.update();
    this.pushGroups();
    this.syncSelection();
    this.hud.updateUpgrades(this.offers());
  }

  private prune(): void {
    const w = this.world;
    let k = 0, changed = false;
    for (let m = 0; m < this.selList.length; m++) {
      const s = this.selList[m];
      // 阵亡的、溃逃中的都从选择里拿掉
      if (!w.alive[s] || w.uid[s] !== this.selUid[m] || w.state[s] & S_ROUT) {
        this.sel[s] = 0;
        changed = true;
        continue;
      }
      this.selList[k] = s;
      this.selUid[k++] = this.selUid[m];
    }
    if (changed) {
      this.selList.length = this.selUid.length = k;
      for (const s of this.selList) this.sel[s] = 1;
    }
  }

  private unitAt(sx: number, sy: number, team: number, visibleOnly: boolean): number {
    const w = this.world;
    const rd = this.renderer;
    rd.updateCamera();
    const k = rd.pxPerUnit;
    let best = -1, bd = 1e9;
    for (let i = 0; i < w.n; i++) {
      if (!w.alive[i] || w.team[i] !== team || (team === w.humanTeam && w.state[i] & S_ROUT)) continue;
      const p = rd.worldToScreen(w.x[i], w.y[i], 8);
      if (!p) continue;
      const r = 7 + w.rad[i] * k * 1.2;
      const dx = p.x - sx, dy = p.y - sy;
      const d = dx * dx + dy * dy;
      if (d < r * r && d < bd) {
        if (visibleOnly && !w.unitVisible(i)) continue;
        bd = d;
        best = i;
      }
    }
    return best;
  }

  /** 触屏点按的入口（移动版的点按，含移动版下的鼠标；桌面版界面下的手指与触控笔），先处理选择和直接攻击，再下地面指令；桌面版界面下鼠标左键只走 clickSelect。 */
  private primaryClick(x: number, y: number, add: boolean): void {
    if (this.over || this.hud.helpOpen) return;
    if (this.mode) return this.modeClick(x, y);
    const human = this.world.humanTeam;
    if (!human) return;
    if (add || !this.selList.length || this.unitAt(x, y, human, false) >= 0) {
      this.groundTaps.cancel();
      this.clickSelect(x, y, add);
      return;
    }
    const target = this.renderer.screenToWorld(x, y);
    if (this.attackUnitAt(x, y) || this.attackBuildingAt(target.x, target.y, false)) {
      this.groundTaps.cancel();
      return;
    }
    this.groundTaps.tap({ x, y }, target);
  }

  private clickSelect(sx: number, sy: number, add: boolean): void {
    const w = this.world;
    const human = w.humanTeam;
    if (!human) return;
    const u = this.unitAt(sx, sy, human, false);
    if (u < 0) {
      if (add) return;
      // 没点到部队：看看是不是点在据点上
      const p = this.renderer.screenToWorld(sx, sy);
      this.setSelection([]);
      this.selectSite(this.siteAt(p.x, p.y));
      return;
    }
    const now = performance.now();
    const type = w.type[u];
    if (this.lastClick.type === type && now - this.lastClick.t < 350) {
      // 双击：选中视野内全部同类
      const rd = this.renderer;
      rd.updateCamera();
      const list: number[] = [];
      for (let i = 0; i < w.n; i++) {
        if (!w.controllable(i) || w.team[i] !== human || w.type[i] !== type) continue;
        const p = rd.worldToScreen(w.x[i], w.y[i], 8);
        if (p && p.x > 0 && p.y > 0 && p.x < rd.viewW && p.y < rd.viewH) list.push(i);
      }
      this.setSelection(list);
    } else if (add) {
      const list = this.selList.slice();
      const at = list.indexOf(u);
      if (at >= 0) list.splice(at, 1);
      else list.push(u);
      this.setSelection(list);
    } else this.setSelection([u]);
    this.lastClick = { t: now, type };
  }

  /**
   * 画面上的框选：框住的己方单位，加上框扫到的卡片代表的人（全选、兵种卡片见 allCardUnits、typeUnits，编队卡片是这一队），合并成一次选择
   */
  private boxSelect(x0: number, y0: number, x1: number, y1: number, add: boolean, withCards = true): void {
    const w = this.world;
    const human = w.humanTeam;
    if (!human) return;
    const ax = Math.min(x0, x1), ay = Math.min(y0, y1), bx = Math.max(x0, x1), by = Math.max(y0, y1);
    const rd = this.renderer;
    rd.updateCamera();
    const list = add ? this.selList.slice() : [];
    const have = new Set(list);
    const push = (i: number): void => {
      if (have.has(i)) return;
      have.add(i);
      list.push(i);
    };
    for (let i = 0; i < w.n; i++) {
      if (!w.controllable(i) || w.team[i] !== human || have.has(i)) continue;
      const p = rd.worldToScreen(w.x[i], w.y[i], 8);
      if (p && p.x >= ax && p.x <= bx && p.y >= ay && p.y <= by) push(i);
    }
    if (withCards) {
      const cards = this.hud.cards.cardsIn(this.clientRect(x0, y0, x1, y1));
      if (cards.all) for (const s of this.allCardUnits()) push(s);
      for (const s of this.typeUnits(cards.types)) push(s);
      for (const g of cards.groups) for (const s of this.groupAlive(g)) push(s);
    }
    this.setSelection(list);
  }

  /** 画布坐标的框换成视口坐标（卡片的位置按视口算） */
  private clientRect(x0: number, y0: number, x1: number, y1: number): { ax: number; ay: number; bx: number; by: number } {
    const c = this.canvas.getBoundingClientRect();
    return { ax: Math.min(x0, x1) + c.left, ay: Math.min(y0, y1) + c.top, bx: Math.max(x0, x1) + c.left, by: Math.max(y0, y1) + c.top };
  }

  /** 把还有活人的编队交给编队卡片 */
  private pushGroups(): void {
    this.hud.setGroups(this.groups.flatMap((_, g) => {
      const slots = this.groupAlive(g);
      return slots.length ? [{ g, slots }] : [];
    }));
  }

  /**
   * 兵种卡片代表的人：选中的兵种是选中的这些人（选中后不随屏幕变化，移动镜头不会把他们丢掉），没选中的兵种是屏幕内的这些人。
   * 点卡片、拖卡片、画面框扫到卡片都按这个口径
   */
  private typeUnits(types: number[]): number[] {
    if (!types.length) return [];
    const w = this.world, want = new Set(types), picked = new Set<number>();
    const list: number[] = [];
    for (const s of this.selList) if (want.has(w.type[s])) {
      list.push(s);
      picked.add(w.type[s]);
    }
    for (const s of this.screenUnits()) if (want.has(w.type[s]) && !picked.has(w.type[s])) list.push(s);
    return list;
  }

  /** 卡片此刻代表的人（拖它下令会出动的人） */
  private cardUnits(kind: CardKind, id: number): number[] {
    return kind === 'all' ? this.allCardUnits() : kind === 'group' ? this.groupAlive(id) : this.typeUnits([id]);
  }

  /** 全选卡片代表的人：选中态时是选中的人，否则是屏幕内的全部己方部队 */
  private allCardUnits(): number[] {
    return this.allPicked ? this.selList.slice() : this.screenUnits();
  }

  /** 第 g 队里还活着、能操控的人 */
  private groupAlive(g: number): number[] {
    const grp = this.groups[g], w = this.world;
    return grp ? grp.slots.filter((s, i) => w.controllable(s) && w.uid[s] === grp.uids[i]) : [];
  }

  /** 把当前选中的部队编为第 g 队（原来的这一队作废） */
  private assignGroup(g: number, slots = this.selList, uids = this.selUid): void {
    this.groups[g] = { slots: slots.slice(), uids: uids.slice() };
    this.hud.message(`已编为第 ${g} 队（${slots.length} 人）`, 'info');
    this.pushGroups();
    this.syncSelection();
  }

  /** 按编队号选中第 g 队；0.4 秒内连按同一个号，镜头再跳过去 */
  private recallGroup(g: number): void {
    const now = performance.now();
    this.selectGroup(g, this.lastGroup.g === g && now - this.lastGroup.t < 400);
    this.lastGroup = { t: now, g };
  }

  /** 单击空队或长按编队卡片，把所选部队编入该队 */
  private groupSlot(g: number): void {
    if (!this.world.humanTeam) return;
    if (!this.selList.length) {
      this.hud.message('先选中要编队的部队', 'info');
      return;
    }
    this.assignGroup(g);
  }

  /** 编队确认时复核单位身份，避免把期间复用同一槽位的新单位编入队伍。 */
  private groupCard(kind: 'all' | 'type', id: number): ReturnType<HudCallbacks['groupCard']> {
    const w = this.world;
    const units = this.cardUnits(kind, id).map(slot => ({ slot, uid: w.uid[slot] }));
    if (!units.length) return null;
    const available = () => units.filter(({ slot, uid }) => w.controllable(slot) && w.uid[slot] === uid);
    return {
      get count() { return available().length; },
      assign: g => {
        const alive = available();
        if (alive.length) this.assignGroup(g, alive.map(unit => unit.slot), alive.map(unit => unit.uid));
        else this.hud.message('这批部队已无法编队', 'info');
      },
    };
  }

  /** 单击亮着的卡片：兵种卡片去掉选中的这个兵种，全选卡片清空选择 */
  private unpickCard(kind: 'all' | 'type', id: number): void {
    const w = this.world;
    if (kind === 'all') return this.setSelection([]);
    this.setSelection(this.selList.filter(s => w.type[s] !== id));
  }

  /** 选中第 g 队；jump 时镜头再跳到这队的重心（连按两次数字键或点击编队卡片） */
  private selectGroup(g: number, jump: boolean): void {
    const w = this.world, alive = this.groupAlive(g);
    this.setSelection(alive);
    if (!jump || !alive.length) return;
    let cx = 0, cy = 0;
    for (const s of alive) {
      cx += w.x[s];
      cy += w.y[s];
    }
    this.focus(cx / alive.length, cy / alive.length);
  }

  /**
   * 卡片拖到地面或小地图上松开：全选卡片、兵种卡片代表的人见 allCardUnits、typeUnits，编队卡片是这一队；
   * 选中这批人，松在画面上的敌军身上就攻击它（同右键），松在敌方建筑上直接攻打它，否则攻击移动到松开处（同攻击移动指令）
   */
  private dropCard(kind: CardKind, id: number, x: number, y: number, target: 'view' | 'mini'): void {
    if (!this.world.humanTeam) return;
    // 这张卡片此刻代表的人已经没了（卡片随后会消失、或拖拽中镜头移走了）：不改选择、不下令
    if (!this.cardUnits(kind, id).length) return;
    // 下令顺带换的选择不打开详情：原来没显示，换成单个单位后也不显示（拖卡片下令是为了让这批人走，不该顺带在画面上突然弹出详情）
    this.quietSelect = true;
    this.hud.detailQuiet = !this.hud.detailShown;
    if (kind === 'all') this.pickAll('replace');
    else if (kind === 'group') this.selectGroup(id, false);
    else this.pickTypes([id], 'replace');
    this.quietSelect = this.hud.detailQuiet = false;
    if (this.mode) this.setMode('');
    if (!this.selList.length) return;
    let p: { x: number; y: number };
    if (target === 'mini') {
      const r = this.hud.minimap.getBoundingClientRect();
      p = this.minimap.toWorld(x - r.left, y - r.top);
    } else {
      const c = this.canvas.getBoundingClientRect();
      if (this.attackUnitAt(x - c.left, y - c.top)) return;
      p = this.renderer.screenToWorld(x - c.left, y - c.top);
    }
    if (!this.attackBuildingAt(p.x, p.y, false)) this.issueMove(p.x, p.y, true);
  }

  /** 屏幕内的己方可操控单位 */
  private screenUnits(): number[] {
    const w = this.world, rd = this.renderer, human = w.humanTeam;
    const out: number[] = [];
    if (!human) return out;
    rd.updateCamera();
    for (let i = 0; i < w.n; i++) {
      if (!w.controllable(i) || w.team[i] !== human) continue;
      const p = rd.worldToScreen(w.x[i], w.y[i], 8);
      if (p && p.x > 0 && p.y > 0 && p.x < rd.viewW && p.y < rd.viewH) out.push(i);
    }
    return out;
  }

  /** 点全选卡片（见 CardBarCallbacks.pickAll） */
  private pickAll(mode: 'replace' | 'add' | 'map'): void {
    if (mode === 'map') return this.command('all');
    if (mode === 'replace') return this.setSelection(this.allCardUnits(), true);
    const have = new Set(this.selList);
    this.setSelection([...this.selList, ...this.screenUnits().filter(s => !have.has(s))], true);
  }

  /** 点兵种卡片（见 CardBarCallbacks.pickTypes） */
  private pickTypes(types: number[], mode: 'replace' | 'toggle' | 'map'): void {
    const w = this.world;
    const want = new Set(types);
    if (mode === 'map') {
      const list: number[] = [];
      for (let i = 0; i < w.n; i++) if (w.controllable(i) && w.team[i] === w.humanTeam && want.has(w.type[i])) list.push(i);
      this.setSelection(list);
      return;
    }
    if (mode === 'toggle') {
      if (this.selList.some(s => want.has(w.type[s]))) this.setSelection(this.selList.filter(s => !want.has(w.type[s])));
      else this.setSelection([...this.selList, ...this.typeUnits(types)]);
      return;
    }
    this.setSelection(this.typeUnits(types));
  }

  // ------------------------------------------------------------------ 指令
  private command(c: 'amove' | 'stop' | 'hold' | 'rally' | 'unrally' | 'all' | 'torch' | 'outpost' | 'follow' | 'deselect'): void {
    const w = this.world;
    if (!w.humanTeam) return;
    this.groundTaps.cancel();
    if (c === 'deselect') {
      this.setMode('');
      this.setSelection([]);
      this.selectSite(-1);
    } else if (c === 'follow') {
      if (this.follow) this.stopFollow();
      else if (!this.selList.length) this.hud.message('先选中要跟随的部队', 'info');
      else {
        this.follow = { slots: this.selList.slice(), uids: this.selUid.slice() };
        this.hud.following = true;
        this.hud.message(this.mobile ? '镜头跟随所选部队（再点一次「跟随」或移动镜头即取消）' : '镜头跟随所选部队（再按 C 或移动镜头即取消）', 'info');
      }
    } else if (c === 'all') {
      const list: number[] = [];
      for (let i = 0; i < w.n; i++) if (w.controllable(i) && w.team[i] === w.humanTeam) list.push(i);
      this.setSelection(list);
    } else if (c === 'rally') {
      if (this.mode === 'rally') this.setMode('');
      else if (this.rallyTargets() !== null) this.setMode('rally');
    } else if (c === 'unrally') {
      if (this.mode === 'rally') this.setMode('');
      const sites = this.rallyTargets();
      if (!sites) return;
      const set = sites.filter(s => s.rally);
      if (!set.length) this.hud.message(this.selSite >= 0 ? '这个据点还没有设集结点：援军留在据点里' : '还没有设集结点：援军留在各自的据点', 'info');
      else {
        for (const s of set) s.rally = null;
        this.hud.message(this.selSite >= 0 ? `已取消${sites[0].name}的集结点：新出的援军留在据点里` : '已取消全部集结点：新出的援军留在各自的据点', 'info');
        this.sound.ui('order');
        this.syncSelection();
      }
    }
    else if (!this.selList.length) return;
    else if (c === 'amove') this.setMode(this.mode === 'amove' ? '' : 'amove');
    else if (c === 'outpost') {
      const E = RULES.economy;
      if (this.mode === 'outpost') this.setMode('');
      else if (w.stock.wood[w.humanTeam] < E.outpostCost) {
        this.hud.message(`木材不足，扎营需要 ${E.outpostCost}（占领伐木场获得木材）`, 'info');
        this.sound.ui('deny');
      } else this.setMode('outpost');
    }
    else if (c === 'torch') {
      // 所选部队里只要有人没熄火把就全部熄灭，否则全部点燃
      const off = this.selList.some(s => w.defs[w.type[s]].abilities.torch && !w.torchOff[s]);
      w.orderTorch(this.selList, !off);
      const lit = w.env.night && !w.env.raining;
      this.hud.message(off ? '火把已熄灭' : lit ? '火把已点燃' : '已下令：入夜且不下雨时点燃火把', 'info');
    }
    else w.orderStop(this.selList, c === 'hold');
  }

  /**
   * 集结点指令作用的据点：选中己方据点时只有它，没选据点时是全部己方出援军的据点。
   * 选中的是敌方、中立或不出援军的据点时返回 null 并提示（按「没选据点」处理会意外改掉全部据点的集结点）
   */
  private rallyTargets(): Site[] | null {
    const w = this.world;
    if (this.selSite >= 0) {
      const s = w.sites[this.selSite];
      if (s.gone || s.owner !== w.humanTeam || !canRally(s)) {
        this.hud.message(!s.gone && s.owner === w.humanTeam ? '这个据点不出援军' : '只能给己方据点设集结点', 'info');
        this.sound.ui('deny');
        return null;
      }
      return [s];
    }
    return rallySites(w, w.humanTeam);
  }

  private modeClick(sx: number, sy: number): void {
    const p = this.renderer.screenToWorld(sx, sy);
    this.modeAt(p.x, p.y);
  }

  /** 在世界坐标处执行当前指令模式（攻击移动 / 集结点） */
  private modeAt(x: number, y: number): void {
    if (this.mode === 'amove') {
      // 点在敌方建筑上：直接攻打它（点在空地上才是攻击移动）
      if (!this.attackBuildingAt(x, y, false)) this.issueMove(x, y, true);
    } else if (this.mode === 'outpost') {
      const E = RULES.economy;
      const err = this.world.orderOutpost(this.selList, x, y);
      if (err) {
        this.hud.message(err === 'wood' ? `木材不足，扎营需要 ${E.outpostCost}` : err === 'max' ? `临时据点最多 ${E.outpostMax} 座`
          : err === 'near' ? '离别的据点太近，换个地方' : err === 'ground' ? '这里搭不了：要一块没有建筑的平地' : '没有可派的部队', 'info');
        this.sound.ui('deny');
        return;
      }
      this.sound.ui('order');
      this.renderer.addMarker(x, y, 1, 0.85, 0.35);
      this.hud.message('部队前去扎营，到位后临时据点即落成', 'info', x, y);
    } else if (this.mode === 'rally') {
      const sites = this.rallyTargets();
      if (!sites) return this.setMode('');
      for (const s of sites) s.rally = { x, y };
      this.renderer.addMarker(x, y, 1, 0.9, 0.3, false);
      this.hud.message(this.selSite >= 0 ? `${sites[0].name}的集结点已设：之后它新出的援军开赴这里${this.mobile ? '' : '（Shift+R 取消）'}`
        : `集结点已设：之后各据点新出的援军开赴这里${this.mobile ? '（指令面板里可取消集结）' : '（Shift+R 取消）'}`, 'info', x, y);
      this.syncSelection();
    }
    this.setMode('');
  }

  private issueMove(x: number, y: number, amove: boolean, fx = 0, fy = 0): Marker | undefined {
    if (!this.selList.length) return;
    this.world.orderMove(this.selList, x, y, amove, fx, fy);
    this.sound.ui(amove ? 'attack' : 'order');
    return amove ? this.renderer.addMarker(x, y, 1, 0.45, 0.25) : this.renderer.addMarker(x, y, 0.4, 1, 0.45);
  }

  /**
   * (x, y) 处是可以攻打的建筑就下令攻打（或提示打不动），返回 true；不是则返回 false。
   * 普通建筑不可攻击，当作空地处理；中立的军事建筑（会放箭）和敌方建筑一样直接右键就打。
   * @param force 中立的城防（城墙、门楼、木栅、营门）也打
   */
  private attackBuildingAt(x: number, y: number, force: boolean): boolean {
    const w = this.world;
    const human = w.humanTeam;
    if (!human || !this.selList.length || !(x > 0 && y > 0 && x < w.W && y < w.H)) return false;
    const bid = w.nav.bld[w.cellAt(x, y)];
    if (bid < 0) return false;
    const b = w.buildings[bid];
    // 中立的城防要 Ctrl+右键才打；例外：带着器械时，中立的石质城防（城墙、门楼）直接右键就砸
    const siege = this.selList.some(s => w.defs[w.type[s]].siege);
    const kind = b.def.kind;
    if (siege && b.owner === 0 && !b.def.wood && (kind === BK_WALL || kind === BK_GATE)) force = true;
    if (b.owner === 0 && b.def.role === BR_MILITARY) force = true;
    // 能不能打按索敌共用的规则判（先假定带着器械，剩下的才是「打不动」）；中立的城防要强攻、迷雾里没探索过的建筑看不见，是这里的玩家规则
    if (!canAttackBuilding(b, human, true) || (b.owner === 0 && !force) || (w.fog && !w.isExplored(b.cx, b.cy))) return false;
    if (!canAttackBuilding(b, human, siege)) {
      this.hud.message(`${b.def.name}只有器械和战象能破坏`, 'info');
      this.sound.ui('deny');
      return true;
    }
    w.orderAttackBuilding(this.selList, b);
    this.sound.ui('attack');
    this.renderer.addMarker(b.cx, b.cy, 1, 0.25, 0.2);
    return true;
  }

  private rightClick(sx: number, sy: number, force: boolean): void {
    const w = this.world;
    const human = w.humanTeam;
    if (!human || !this.selList.length) return;
    if (this.attackUnitAt(sx, sy)) return;
    const p = this.renderer.screenToWorld(sx, sy);
    if (this.attackBuildingAt(p.x, p.y, force)) return;
    this.issueMove(p.x, p.y, false);
  }

  /** 画布坐标 (sx, sy) 处有看得见的敌军就让选着的部队攻击它，返回 true；没有则返回 false */
  private attackUnitAt(sx: number, sy: number): boolean {
    const w = this.world;
    const human = w.humanTeam;
    if (!human || !this.selList.length) return false;
    const enemy = this.unitAt(sx, sy, 3 - human, true);
    if (enemy < 0) return false;
    w.orderAttackUnit(this.selList, enemy);
    this.sound.ui('attack');
    this.renderer.addMarker(w.x[enemy], w.y[enemy], 1, 0.25, 0.2);
    return true;
  }

  // ------------------------------------------------------------------ 移动版
  /** 按「界面」设置与设备方向重新判定用哪套布局，变了就切换 */
  private applyLayout(): void {
    const on = isMobileUi(this.uiMode, this.portraitQuery.matches);
    if (on === this.mobile) return;
    this.mobile = on;
    this.cancelTouch();
    this.mouse.out = null;
    this.mouse.inside = false;
    this.hud.setMobile(on);
    // 移动版没有锁定鼠标；回到桌面版按偏好恢复
    this.pointer.setEnabled(!on && loadPref('lockMouse') === '1');
    if (this.mode) this.setMode(this.mode);
    this.minimap.resize();
  }

  private cancelTouch(): void {
    this.groundTaps.cancel();
    this.touch.cancel();
  }

  /** 长按：已选部队攻击移动到那里（点在敌方建筑上则直接攻打） */
  private touchHold(x: number, y: number): void {
    if (this.mode || !this.world.humanTeam || !this.selList.length) return;
    this.groundTaps.cancel();
    const p = this.renderer.screenToWorld(x, y);
    if (!this.attackBuildingAt(p.x, p.y, false)) this.issueMove(p.x, p.y, true);
    navigator.vibrate?.(15);
  }

  /** 画面上拖出的选框（画布坐标） */
  private showBox(x0: number, y0: number, x1: number, y1: number): void {
    const s = this.box.style;
    s.display = 'block';
    s.left = `${Math.min(x0, x1)}px`;
    s.top = `${Math.min(y0, y1)}px`;
    s.width = `${Math.abs(x1 - x0)}px`;
    s.height = `${Math.abs(y1 - y0)}px`;
  }

  /**
   * 框选的拖动与结束。框的两端钳在上半屏的画面里：手指拖到下半屏时，框不该扫到画面外的单位；
   * 卡片在下半屏、手指拖不进框里，移动版也不走卡片合并
   */
  private touchBox(x0: number, y0: number, x1: number, y1: number, done: boolean, commit: boolean): void {
    const vw = this.renderer.viewW, vh = this.renderer.viewH;
    const cx = (v: number): number => Math.max(0, Math.min(vw, v)), cy = (v: number): number => Math.max(0, Math.min(vh, v));
    this.groundTaps.cancel();
    if (!done) return this.showBox(cx(x0), cy(y0), cx(x1), cy(y1));
    this.box.style.display = 'none';
    if (commit) this.boxSelect(cx(x0), cy(y0), cx(x1), cy(y1), false, false);
  }

  /** 双指：缩放、旋转都绕两指的中点，中点本身的移动就是平移——两指按住的那块地面始终跟着手指走 */
  private touchPinch(g: Pinch): void {
    const rd = this.renderer, cam = rd.cam;
    const anchor = rd.screenToWorld(g.x0, g.y0);
    cam.zoom *= g.scale;
    cam.yaw += g.turn;
    rd.clampCam();
    // 镜头跟随中只缩放旋转，不往中点挪（挪了也会被拉回来）；手指拖动中点才算手动移动镜头
    if (Math.hypot(g.x1 - g.x0, g.y1 - g.y0) > 2) this.stopFollow();
    if (this.follow) return;
    const now = rd.screenToWorld(g.x1, g.y1);
    cam.x += anchor.x - now.x;
    cam.y += anchor.y - now.y;
    rd.clampCam();
  }

  private syncAudioPause(): void {
    this.sound.setPaused(document.hidden || this.speed === 0 || this.hud.helpOpen);
  }

  // ------------------------------------------------------------------ 主循环
  private readonly frame = (now: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    // 帧时间戳可能早于初始化结束的时刻（初始化耗时较长时），不能让 dt 为负
    const real = Math.max(0, Math.min(0.1, (now - this.last) / 1000));
    this.last = now;
    this.fps += (1 / Math.max(real, 0.001) - this.fps) * 0.05;
    const w = this.world;
    const running = this.speed > 0 && !this.over && !this.hud.helpOpen;
    let simMs = 0;
    if (running) {
      this.acc += real * this.speed;
      let steps = 0;
      const t0 = performance.now();
      while (this.acc >= DT && steps < 8) {
        w.tick();
        for (const ai of this.game.ais) ai.update();
        this.acc -= DT;
        steps++;
      }
      if (steps === 8) this.acc = 0;
      simMs = steps ? (performance.now() - t0) / steps : 0;
    }
    this.updateCamera(real);
    this.prune();
    // 音效要赶在渲染器取走特效事件之前读
    this.syncAudioPause();
    if (running && !document.hidden) {
      const rd = this.renderer, cam = rd.cam;
      this.sound.update(w, cam.x, cam.y, 900 / cam.zoom + 250, cam.zoom, (x, y) => {
        const p = rd.worldToScreen(x, y);
        return p ? Math.max(-0.8, Math.min(0.8, (p.x / rd.viewW) * 2 - 1)) : 0;
      });
    }
    this.drainEvents();

    this.renderer.render(Math.min(1, this.acc / DT), running ? real * Math.min(this.speed, 2) : 0, this.sel, this.selList.length <= 40);
    this.mmTimer -= real;
    if (this.mmTimer <= 0) {
      this.mmTimer = 0.1;
      this.minimap.yaw = this.renderer.cam.yaw;
      this.minimap.draw(this.renderer.viewQuad(), 0.1);
    }
    this.hud.setWindView(this.renderer.cam.yaw);
    if (this.mobile) this.hud.zoom.sync(zoomToFrac(this.renderer.cam.zoom));
    this.uiTimer -= real;
    if (this.uiTimer <= 0) {
      this.uiTimer = 0.25;
      this.refreshUi();
      this.hud.setDebug(`${Math.round(this.fps)} FPS · 模拟 ${simMs.toFixed(1)}ms · ${w.teamCount[1] + w.teamCount[2]} 单位`);
    }
  };

  private updateCamera(dt: number): void {
    const cam = this.renderer.cam, k = this.keys;
    let dx = 0, dy = 0;
    if (k.has('ArrowLeft') || k.has('a')) dx -= 1;
    if (k.has('ArrowRight') || k.has('d')) dx += 1;
    if (k.has('ArrowUp') || k.has('w')) dy -= 1;
    if (k.has('ArrowDown') || k.has('s')) dy += 1;
    // 鼠标贴到屏幕最外沿卷屏，底下是界面面板也卷；从某条边离开了网页就朝那边续卷。
    // 按着键拖动时不卷（画面上拖框、拖卡片、拖小地图）：拖过头卷走了镜头，松手时选中的就不是框住的那批人
    const m = this.mouse;
    if (!this.mobile && !m.buttons && !this.drag && !this.pan && !this.hud.helpOpen && document.hasFocus()) {
      if (m.out) {
        dx += m.out.dx;
        dy += m.out.dy;
      } else if (m.inside) {
        const vw = this.renderer.viewW, vh = this.renderer.viewH;
        dx += edgeSpeed(vw - 1 - m.x) - edgeSpeed(m.x);
        dy += edgeSpeed(vh - 1 - m.y) - edgeSpeed(m.y);
      }
    }
    // 移动版的摇杆：往哪边推就往哪边卷，推得越远越快
    if (this.mobile) {
      dx += this.hud.stick.x * STICK_GAIN;
      dy += this.hud.stick.y * STICK_GAIN;
    }
    if (dx || dy) {
      this.stopFollow();
      const sp = (1100 / cam.zoom) * dt;
      this.renderer.moveCam(dx * sp, dy * sp);
    }
    if (this.follow) this.followStep(dt);
    // Q / E 旋转镜头
    const rot = (k.has('q') ? 1 : 0) - (k.has('e') ? 1 : 0);
    if (rot) cam.yaw += rot * 1.5 * dt;
    // PageUp / PageDown（Mac 上 fn + ↑ / ↓）缩放：给不能捏合的 Magic Mouse 与键盘党
    const zoom = (k.has('PageUp') ? 1 : 0) - (k.has('PageDown') ? 1 : 0);
    if (zoom) this.zoomAt(this.renderer.viewW / 2, this.renderer.viewH / 2, Math.exp(zoom * 1.5 * dt));
  }

  private stopFollow(): void {
    if (!this.follow) return;
    this.follow = null;
    this.hud.following = false;
    this.hud.message('已取消镜头跟随', 'info');
  }

  /**
   * 镜头向跟随部队的重心靠拢。重心用和渲染同一个插值系数算（模拟 30 帧/秒，画面更快，直接取模拟坐标会一顿一顿），
   * 再按指数平滑追过去：有人阵亡、掉队时重心会跳，镜头不跟着跳。
   */
  private followStep(dt: number): void {
    const f = this.follow!, w = this.world;
    const a = Math.min(1, this.acc / DT);
    let cx = 0, cy = 0, n = 0;
    for (let k = 0; k < f.slots.length; k++) {
      const s = f.slots[k];
      if (!w.alive[s] || w.uid[s] !== f.uids[k]) continue;
      cx += w.px[s] + (w.x[s] - w.px[s]) * a;
      cy += w.py[s] + (w.y[s] - w.py[s]) * a;
      n++;
    }
    if (!n) {
      this.follow = null;
      this.hud.following = false;
      this.hud.message('跟随的部队已全部阵亡', 'info');
      return;
    }
    const cam = this.renderer.cam, t = 1 - Math.exp(-dt * FOLLOW_RATE);
    cam.x += (cx / n - cam.x) * t;
    cam.y += (cy / n - cam.y) * t;
    this.renderer.clampCam();
  }

  private drainEvents(): void {
    const w = this.world;
    if (!w.events.length) return;
    const human = w.humanTeam;
    const f = w.factions as FactionDef[];
    const colors = this.renderer.teamRgb.map(c => `rgb(${c[0]},${c[1]},${c[2]})`);
    for (const e of w.events) {
      if (e.kind === 'gameover') {
        this.over = true;
        const won = human ? e.winner === human : null;
        this.sound.finish(won);
        this.hud.showGameOver(won, () => this.onExit());
        continue;
      }
      if (e.kind === 'rout') {
        if (e.count < 3) continue;
        if (e.team === human) this.hud.message(`我军 ${e.count} 人士气崩溃，正在溃逃！`, 'bad', e.x, e.y);
        else if (!human) this.hud.message(`${f[e.team].name} ${e.count} 人溃逃`, 'info', e.x, e.y);
        else if (w.isVisible(e.x, e.y)) this.hud.message(`敌军 ${e.count} 人溃逃`, 'good', e.x, e.y);
        continue;
      }
      if (e.kind === 'weather') {
        this.hud.message(e.snow ? '下雪了：行军更慢、看得更近，火把点不着；据点之外的部队防御下降' : e.rain ? '下雨了：火把点不着，行军变慢，士气下降' : '雨雪停了', 'info');
        continue;
      }
      if (e.kind === 'outpost') {
        if (e.team !== human) continue;
        if (e.built) this.hud.message('临时据点落成：部队可在此休整回血', 'good', e.x, e.y);
        else this.hud.message('扎营未成，木材已退还', 'info', e.x, e.y);
        continue;
      }
      if (e.kind === 'daynight') {
        this.hud.message(e.night ? `入夜：视野缩小，可点火把${this.mobile ? '' : '（T）'}` : '天亮了', 'info');
        continue;
      }
      if (e.kind === 'hunger') {
        if (e.team === human) this.hud.message(e.on ? '粮草耗尽，全军挨饿，士气持续下降！多占据点' : '粮草恢复供应', e.on ? 'bad' : 'good');
        continue;
      }
      const s = w.sites[e.site];
      if (e.kind === 'captured') {
        if (human && e.team === human) this.sound.oneShot('signals/rally-horn', 0.2);
        else if (human && e.from === human) this.sound.oneShot('signals/watch-bell', 0.16);
        this.minimap.pings.push({ x: s.x, y: s.y, t: 0, color: colors[e.team] });
        if (!human) this.hud.message(`${f[e.team].name} 占领了 ${s.name}`, 'info', s.x, s.y);
        else if (e.team === human) {
          const info = SITE_INFO[s.type];
          this.hud.message(`已占领 ${s.name}${e.repaired ? '并修复' : ''}，${info.reinf === 'pick' ? `将定时出${UNITS[pickedUnit(w, s)].name}，可在据点面板里改选兵种` : info.reinf ? `将定时获得${info.provides}` : `开始采集${info.provides}`}`, 'good', s.x, s.y);
        }
        else if (e.from === human) this.hud.message(`${s.name} 失守！`, 'bad', s.x, s.y);
        else this.hud.message(`敌军占领了 ${s.name}`, 'info', s.x, s.y);
      } else if (e.kind === 'reinforce') {
        if (e.team === human) {
          this.hud.message(`援军抵达：${e.count} 人（${s.name}）${s.rally ? '，开赴集结点' : ''}`, 'good', s.x, s.y);
          this.minimap.pings.push({ x: s.x, y: s.y, t: 0, color: '#fff' });
        }
      } else if (e.kind === 'razed') {
        this.hud.message(e.team === human ? '敌方的临时据点已被摧毁' : '我方一座临时据点被摧毁', e.team === human ? 'good' : 'bad', s.x, s.y);
      }
    }
    w.events.length = 0;
  }
}
