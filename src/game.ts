/** 一局游戏：主循环、镜头、选择与指令输入 */
import { BK_GATE, BK_WALL, BR_MILITARY, DT, FactionDef, RES_NAMES, RULES, SITE_INFO, UNITS } from './sim/defs';
import { Game, GameOptions, createGame } from './sim/setup';
import { canRally, rallySites } from './sim/rally';
import { pickedUnit } from './sim/systems/sites';
import { canAttackBuilding } from './sim/systems/targeting';
import { canUpgradeSite, siteUpgradeCost, unitUpgradeCost, upgradeQueue } from './sim/systems/economy';
import { MAX_UNITS, S_ROUT, Site, World } from './sim/world';
import { Minimap } from './render/minimap';
import { Renderer } from './render/renderer';
import { Hud, UpgradeAction, UpgradeOffers } from './ui/hud';
import { Sound } from './audio/sound';
import { WheelClassifier, WheelMode, asWheelMode, edgeSpeed, exitDirection } from './camInput';
import { loadPref, savePref } from './prefs';
import { Pinch, TouchGestures, UiMode, asUiMode, isMobileUi } from './touchInput';
import { PointerLock } from './pointerLock';

type Mode = '' | 'amove' | 'rally' | 'outpost';
/** 镜头跟随的平滑程度：每秒把剩下的距离收拢多少（越大跟得越紧） */
const FOLLOW_RATE = 4;
/** 滚轮一格按行 / 按页计量时（Firefox 的鼠标滚轮）换算成多少像素 */
const WHEEL_LINE = 33;
const WHEEL_PAGE = 800;

export class GameApp {
  readonly world: World;
  readonly renderer: Renderer;
  private readonly game: Game;
  private readonly hud: Hud;
  private readonly minimap: Minimap;
  private readonly sound = new Sound();
  private readonly box: HTMLDivElement;
  private readonly sel = new Uint8Array(MAX_UNITS);
  private selList: number[] = [];
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
  /** 移动版画面上的手指手势（点、长按、框选、双指缩放旋转） */
  private readonly touch = new TouchGestures({
    tap: (x, y) => this.touchTap(x, y),
    hold: (x, y) => this.touchHold(x, y),
    canBox: () => !this.mode && !!this.world.humanTeam,
    box: (x0, y0, x1, y1, done, commit) => this.touchBox(x0, y0, x1, y1, done, commit),
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
    private readonly onExit: () => void) {
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
      selectGroup: (g, jump) => this.selectGroup(g, jump),
      dropCard: (kind, id, x, y, target) => this.dropCard(kind, id, x, y, target),
      setSpeed: s => this.setSpeed(s),
      focus: (x, y) => this.focus(x, y),
      exit: () => this.onExit(),
      toggleSound: () => this.sound.toggle(),
      soundOn: () => this.sound.enabled,
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
    this.touch.cancel();
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
    this.on(cv, 'contextmenu', e => e.preventDefault());
    // 浏览器要有用户操作才允许出声
    this.on(window, 'pointerdown', () => this.sound.unlock());
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
        if (!d.active && Math.hypot(p.x - d.x, p.y - d.y) > 5) d.active = true;
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
        else this.clickSelect(p.x, p.y, e.shiftKey);
      }
    });
    this.on(cv, 'pointercancel', () => this.touch.cancel());
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

    this.on(window, 'keydown', e => {
      if (e.target instanceof HTMLInputElement) return;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      // 带 Ctrl / Cmd 的组合键不记入「按住的键」：Mac 上按着 Cmd 时字母键收不到松开事件，会一直卷屏
      if (!e.ctrlKey && !e.metaKey) this.keys.add(k);
      this.sound.unlock();
      if (e.repeat) return;
      const human = this.world.humanTeam;
      if (k.startsWith('Arrow') || k === ' ' || k === 'PageUp' || k === 'PageDown') e.preventDefault();
      // 移动镜头的键一按下就取消跟随（卷屏是每帧轮询按住的键，点得太快可能一帧也没赶上）
      if (k.startsWith('Arrow') || (!e.ctrlKey && !e.metaKey && (k === 'w' || k === 'a' || k === 's' || k === 'd'))) this.stopFollow();
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
      } else if (k === ' ' || k === 'p') this.setSpeed(this.speed ? 0 : this.lastSpeed);
      else if (k === '=' || k === '+') this.setSpeed(Math.min(4, Math.max(1, this.speed * 2)));
      else if (k === '-') this.setSpeed(Math.max(1, this.speed / 2));
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
        // 镜头转回正北、恢复默认俯角
        this.renderer.cam.yaw = this.cam0.yaw;
        this.renderer.cam.pitch = this.cam0.pitch;
      }
      else if (e.code.startsWith('Digit')) {
        // 用物理键位判断：Mac 上 Option+数字 输出的是特殊字符，Cmd+数字 又会被浏览器拿去切标签页
        const g = Number(e.code.slice(5));
        if (e.ctrlKey || e.metaKey || e.altKey) {
          e.preventDefault();
          this.groups[g] = { slots: this.selList.slice(), uids: this.selUid.slice() };
          this.hud.message(`已编为第 ${g} 队（${this.selList.length} 人）`, 'info');
          this.pushGroups();
          this.hud.updateSelection(this.selList, this.selSite, this.screenUnits());
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
          this.setSelection(slots.slice());
          this.hud.message(`第 ${g} 队追加 ${added} 人，共 ${slots.length} 人`, 'info');
        } else {
          if (!this.groups[g]) return;
          const now = performance.now();
          this.selectGroup(g, this.lastGroup.g === g && now - this.lastGroup.t < 400);
          this.lastGroup = { t: now, g };
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
      this.touch.cancel();
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
    this.mode = m;
    // 样式表给整个界面设了 !important 的剑形指针，指令模式的十字准星要同样 !important 才盖得过
    this.canvas.style.setProperty('cursor', m ? 'crosshair' : '', m ? 'important' : '');
    this.pointer.refreshCursor();
    const mb = this.mobile;
    this.hud.setMode(m === 'amove' ? `攻击移动：${mb ? '点一下指定目的地（再点一次指令按钮取消）' : '左键指定目的地（右键取消）'}`
      : m === 'rally' ? `集结点：${mb ? '点一下指定位置' : '左键指定位置'}，${this.selSite >= 0 ? '只设所选据点' : '给全部据点设'}${mb ? '（再点一次指令按钮退出）' : '（右键退出；Shift+R 取消集结点）'}`
      : m === 'outpost' ? `扎营：${mb ? '点一下' : '左键'}指定临时据点的位置，所选部队会赶去搭建（木材 ${RULES.economy.outpostCost}，${mb ? '再点一次指令按钮取消' : '右键取消'}）` : '');
  }

  /** 设集结点模式下选中对象变了：提示跟着换；选中的据点设不了集结点就退出模式，并给出与按 R 时一样的提示 */
  private refreshRallyMode(): void {
    if (this.mode !== 'rally') return;
    this.setMode(this.rallyTargets() ? 'rally' : '');
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
  private setSelection(list: number[]): void {
    for (const s of this.selList) this.sel[s] = 0;
    this.selList = list;
    this.selUid = list.map(s => this.world.uid[s]);
    for (const s of list) this.sel[s] = 1;
    // 选了部队就不再选着据点
    if (list.length) this.selSite = this.renderer.selSite = -1;
    this.refreshRallyMode();
    this.hud.updateSelection(list, this.selSite, this.screenUnits());
  }

  private selectSite(id: number): void {
    if (id >= 0 && this.selList.length) this.setSelection([]);
    this.selSite = this.renderer.selSite = id;
    this.refreshRallyMode();
    this.hud.updateSelection(this.selList, id, this.screenUnits());
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
  private affordUnits(units: number[]): { count: number; cost: number; total: number } | null {
    const w = this.world;
    let left = w.stock.gold[w.humanTeam], count = 0, cost = 0;
    const q = upgradeQueue(w, units);
    for (const s of q) {
      const c = unitUpgradeCost(w.defs[w.type[s]]);
      if (c > left + 1e-6) continue;
      left -= c;
      cost += c;
      count++;
    }
    return count ? { count, cost, total: q.length } : null;
  }

  /** 此刻该出现哪些升级按钮：「全部升级」针对全图，资源不够全升时能升几个就升几个 */
  private offers(): UpgradeOffers {
    const w = this.world, human = w.humanTeam;
    const o: UpgradeOffers = { sel: null, all: null, cities: null, camps: null };
    if (!human) return o;
    if (w.stock.gold[human] >= RULES.economy.unitGold) {
      if (this.selList.length) o.sel = this.affordUnits(this.selList);
      o.all = this.affordUnits(this.myUnits());
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
      const r = w.upgradeUnits(act === 'sel' ? this.selList : this.myUnits());
      if (r.count) {
        this.hud.message(`${r.count} 人升为高级形态，花费黄金 ${Math.round(r.cost)}`, 'good');
        this.sound.ui('order');
      } else this.sound.ui('deny');
    } else {
      const list = this.mySites(act === 'cities' ? 'city' : 'camp').filter(s => w.upgradeSite(s));
      if (list.length) {
        this.hud.message(list.map(s => `${s.name} 升到 ${s.level} 级`).join('、'), 'good');
        this.sound.ui('order');
      } else this.sound.ui('deny');
    }
    this.refreshUi();
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
    this.hud.updateSelection(this.selList, this.selSite, this.screenUnits());
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
   * 画面上的框选：框住的己方单位，加上框扫到的卡片——兵种卡片的屏幕内这个兵种、编队卡片的这一队，合并成一次选择
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
    this.hud.cards.setGroups(this.groups.flatMap((_, g) => {
      const slots = this.groupAlive(g);
      return slots.length ? [{ g, slots }] : [];
    }));
  }

  /**
   * 兵种卡片代表的人：屏幕内的这些兵种，加上已选着、但不在屏幕内的同兵种（卡片也给这部分人出，选它不该把他们丢掉）。
   * 点卡片、拖卡片、画面框扫到卡片都按这个口径
   */
  private typeUnits(types: number[]): number[] {
    if (!types.length) return [];
    const w = this.world, want = new Set(types);
    const list = this.screenUnits().filter(s => want.has(w.type[s]));
    const got = new Set(list);
    for (const s of this.selList) if (want.has(w.type[s]) && !got.has(s)) list.push(s);
    return list;
  }

  /** 第 g 队里还活着、能操控的人 */
  private groupAlive(g: number): number[] {
    const grp = this.groups[g], w = this.world;
    return grp ? grp.slots.filter((s, i) => w.controllable(s) && w.uid[s] === grp.uids[i]) : [];
  }

  /** 选中第 g 队；jump 时镜头再跳到这队的重心（连按两次数字键、双击编队卡片） */
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
   * 卡片拖到地面或小地图上松开：兵种卡片是屏幕内这个兵种（连同选着、但不在屏幕内的同兵种），编队卡片是这一队；
   * 选中这批人并攻击移动到松开处（松在敌方建筑上则直接攻打它，同攻击移动指令）
   */
  private dropCard(kind: 'type' | 'group', id: number, x: number, y: number, target: 'view' | 'mini'): void {
    if (!this.world.humanTeam) return;
    if (kind === 'group') this.selectGroup(id, false);
    else this.pickTypes([id], 'replace');
    if (this.mode) this.setMode('');
    if (!this.selList.length) return;
    let p: { x: number; y: number };
    if (target === 'mini') {
      const r = this.hud.minimap.getBoundingClientRect();
      p = this.minimap.toWorld(x - r.left, y - r.top);
    } else {
      const c = this.canvas.getBoundingClientRect();
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
        this.hud.updateSelection(this.selList, this.selSite, this.screenUnits());
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
      this.hud.updateSelection(this.selList, this.selSite, this.screenUnits());
    }
    this.setMode('');
  }

  private issueMove(x: number, y: number, amove: boolean, fx = 0, fy = 0): void {
    if (!this.selList.length) return;
    this.world.orderMove(this.selList, x, y, amove, fx, fy);
    this.sound.ui(amove ? 'attack' : 'order');
    if (amove) this.renderer.addMarker(x, y, 1, 0.45, 0.25);
    else this.renderer.addMarker(x, y, 0.4, 1, 0.45);
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
    const p = this.renderer.screenToWorld(sx, sy);
    const enemy = this.unitAt(sx, sy, 3 - human, true);
    if (enemy >= 0) {
      w.orderAttackUnit(this.selList, enemy);
      this.sound.ui('attack');
      this.renderer.addMarker(w.x[enemy], w.y[enemy], 1, 0.25, 0.2);
      return;
    }
    if (this.attackBuildingAt(p.x, p.y, force)) return;
    this.issueMove(p.x, p.y, false);
  }

  // ------------------------------------------------------------------ 移动版
  /** 按「界面」设置与设备方向重新判定用哪套布局，变了就切换 */
  private applyLayout(): void {
    const on = isMobileUi(this.uiMode, this.portraitQuery.matches);
    if (on === this.mobile) return;
    this.mobile = on;
    this.touch.cancel();
    this.mouse.out = null;
    this.mouse.inside = false;
    this.hud.setMobile(on);
    // 移动版没有锁定鼠标；回到桌面版按偏好恢复
    this.pointer.setEnabled(!on && loadPref('lockMouse') === '1');
    if (this.mode) this.setMode(this.mode);
    this.minimap.resize();
  }

  /**
   * 点一下：指令模式里在那里执行；点己方单位是选中；否则有选中部队时照右键的语义下令（点地面移动、点敌军或敌方建筑攻击，
   * 点据点处是派人过去，可占领：不能把据点优先，否则部队的选择会被清掉）；没选部队时点据点是选中据点、点空地是取消选择
   */
  private touchTap(x: number, y: number): void {
    if (this.mode) return this.modeClick(x, y);
    const human = this.world.humanTeam;
    if (!human) return;
    if (this.unitAt(x, y, human, false) >= 0 || !this.selList.length) this.clickSelect(x, y, false);
    else this.rightClick(x, y, false);
  }

  /** 长按：已选部队攻击移动到那里（点在敌方建筑上则直接攻打） */
  private touchHold(x: number, y: number): void {
    if (this.mode || !this.world.humanTeam || !this.selList.length) return;
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
    if (running) {
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
        this.hud.showGameOver(human ? e.winner === human : null, () => this.onExit());
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
