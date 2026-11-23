/** 一局游戏：主循环、镜头、选择与指令输入 */
import { DT, FactionDef, RES_NAMES, RULES, SITE_INFO } from './sim/defs';
import { Game, GameOptions, createGame } from './sim/setup';
import { canUpgradeSite, unitUpgradeCost, upgradeAllCost, upgradeQueue } from './sim/systems/economy';
import { MAX_UNITS, S_ROUT, Site, World } from './sim/world';
import { Minimap } from './render/minimap';
import { Renderer } from './render/renderer';
import { Hud, UpgradeAction, UpgradeOffers } from './ui/hud';
import { Sound } from './audio/sound';

type Mode = '' | 'amove' | 'rally' | 'outpost';
/** 界面上能交互的元素：鼠标停在这些上面时不边缘卷屏 */
const INTERACTIVE = 'button, canvas, input, select, a, .site, .chip, .ucard, .card';

/** 离屏幕边缘多少像素以内开始卷屏 */
const EDGE_ZONE = 72;

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
  /** ui：鼠标正停在界面面板上（此时不卷屏；面板与屏幕边缘之间的空隙照常卷） */
  private mouse = { x: 0, y: 0, inside: false, ui: false };
  private drag: { x: number; y: number; active: boolean } | null = null;
  private pan: { x: number; y: number; rotate: boolean } | null = null;
  /** 右键按下的位置：拖出一段距离就是在指定队列朝向 */
  private rdrag: { sx: number; sy: number; x: number; y: number; active: boolean } | null = null;
  private readonly cam0 = { yaw: 0, pitch: 0.8 };
  private lastClick = { t: 0, type: -1 };
  private lastGroup = { t: 0, g: -1 };
  private uiTimer = 0;
  private mmTimer = 0;
  private over = false;
  private fps = 60;
  private readonly cleanup: (() => void)[] = [];

  constructor(private readonly root: HTMLElement, private readonly canvas: HTMLCanvasElement, opts: GameOptions,
    private readonly onExit: () => void) {
    this.game = createGame(opts);
    const w = (this.world = this.game.world);
    this.renderer = new Renderer(canvas, w);
    const rgb = this.renderer.teamRgb;
    this.hud = new Hud(root, w, rgb, {
      command: c => this.command(c),
      upgrade: a => this.upgrade(a),
      selectSite: id => this.selectSite(id),
      siteAction: (act, id) => this.siteAction(act, id),
      selectType: (t, remove) => this.selectType(t, remove),
      setSpeed: s => this.setSpeed(s),
      focus: (x, y) => this.focus(x, y),
      exit: () => this.onExit(),
      toggleSound: () => this.sound.toggle(),
      soundOn: () => this.sound.enabled,
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
    this.refreshUi();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    for (const f of this.cleanup) f();
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
          const s = this.box.style;
          s.display = 'block';
          s.left = `${Math.min(d.x, p.x)}px`;
          s.top = `${Math.min(d.y, p.y)}px`;
          s.width = `${Math.abs(p.x - d.x)}px`;
          s.height = `${Math.abs(p.y - d.y)}px`;
        }
      }
    });
    this.on(cv, 'pointerup', e => {
      const p = this.local(e);
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
        if (d.active) this.boxSelect(d.x, d.y, p.x, p.y, e.shiftKey);
        else this.clickSelect(p.x, p.y, e.shiftKey);
      }
    });
    // 鼠标位置在整个窗口上跟踪，并记下它是不是停在界面面板上
    this.on(window, 'pointermove', e => {
      const p = this.local(e);
      this.mouse.x = p.x;
      this.mouse.y = p.y;
      this.mouse.inside = p.x >= 0 && p.y >= 0 && p.x <= this.renderer.viewW && p.y <= this.renderer.viewH;
      // 只读的面板（顶栏文字、提示条等）不挡卷屏；按钮、列表项、小地图这类能交互的才挡
      const t = e.target as Element | null;
      this.mouse.ui = t !== cv && !!t?.closest?.(INTERACTIVE);
    });
    this.on(document.documentElement, 'pointerleave', () => {
      this.mouse.inside = false;
    });
    this.on(cv, 'wheel', e => {
      e.preventDefault();
      const cam = this.renderer.cam;
      const p = this.local(e);
      const before = this.renderer.screenToWorld(p.x, p.y);
      cam.zoom *= Math.exp(-e.deltaY * 0.0015);
      this.renderer.clampCam();
      const after = this.renderer.screenToWorld(p.x, p.y);
      cam.x += before.x - after.x;
      cam.y += before.y - after.y;
      this.renderer.clampCam();
    }, { passive: false });

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
      if (k.startsWith('Arrow') || k === ' ') e.preventDefault();
      if (k === 'Escape') {
        if (this.hud.helpOpen) this.hud.toggleHelp();
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
      else if (!human) return;
      else if (k === 'a' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this.command('all');
      } else if (k === 'f') this.command('amove');
      else if (k === 'x') this.command('stop');
      else if (k === 'h') this.command('hold');
      else if (k === 'r') this.command('rally');
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
          this.setSelection(slots.slice());
          this.hud.message(`第 ${g} 队追加 ${added} 人，共 ${slots.length} 人`, 'info');
        } else {
          const grp = this.groups[g];
          if (!grp) return;
          const w = this.world;
          const alive = grp.slots.filter((s, i) => w.controllable(s) && w.uid[s] === grp.uids[i]);
          this.setSelection(alive);
          const now = performance.now();
          if (this.lastGroup.g === g && now - this.lastGroup.t < 400 && alive.length) {
            let cx = 0, cy = 0;
            for (const s of alive) {
              cx += w.x[s];
              cy += w.y[s];
            }
            this.focus(cx / alive.length, cy / alive.length);
          }
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
    });
  }

  private local(e: MouseEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private setMode(m: Mode): void {
    this.mode = m;
    this.canvas.style.cursor = m ? 'crosshair' : 'default';
    this.hud.setMode(m === 'amove' ? '攻击移动：左键指定目的地（右键取消）' : m === 'rally' ? '集结点：左键指定位置（右键取消）'
      : m === 'outpost' ? `扎营：左键指定临时据点的位置，所选部队会赶去搭建（木材 ${RULES.economy.outpostCost}，右键取消）` : '');
  }

  private setSpeed(s: number): void {
    if (s > 0) this.lastSpeed = s;
    this.speed = s;
    this.hud.setSpeed(s);
  }

  private focus(x: number, y: number): void {
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
    this.hud.updateSelection(list, this.selSite);
  }

  private selectSite(id: number): void {
    if (id >= 0 && this.selList.length) this.setSelection([]);
    this.selSite = this.renderer.selSite = id;
    this.hud.updateSelection(this.selList, id);
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

  /** 屏幕内的己方单位 */
  private unitsOnScreen(): number[] {
    const w = this.world, rd = this.renderer, human = w.humanTeam;
    rd.updateCamera();
    const out: number[] = [];
    for (let i = 0; i < w.n; i++) {
      if (!w.controllable(i) || w.team[i] !== human) continue;
      const p = rd.worldToScreen(w.x[i], w.y[i], 8);
      if (p && p.x > 0 && p.y > 0 && p.x < rd.viewW && p.y < rd.viewH) out.push(i);
    }
    return out;
  }

  /** 屏幕内还能升级的己方据点（城邦或营寨） */
  private sitesOnScreen(category: 'fort' | 'camp'): Site[] {
    const w = this.world, rd = this.renderer;
    return w.sites.filter(s => {
      if (s.owner !== w.humanTeam || SITE_INFO[s.type].category !== category || !canUpgradeSite(s)) return false;
      const p = rd.worldToScreen(s.x, s.y);
      return !!p && p.x > 0 && p.y > 0 && p.x < rd.viewW && p.y < rd.viewH;
    });
  }

  /** 此刻该出现哪些升级按钮 */
  private offers(): UpgradeOffers {
    const w = this.world, human = w.humanTeam;
    const o: UpgradeOffers = { sel: null, all: null, forts: null, camps: null };
    if (!human) return o;
    const gold = w.stock.gold[human];
    if (gold >= RULES.economy.unitGold) {
      if (this.selList.length) {
        // 按升级的先后次序往下数，看黄金够升几个
        let left = gold, count = 0, cost = 0;
        const q = upgradeQueue(w, this.selList);
        for (const s of q) {
          const c = unitUpgradeCost(w.defs[w.type[s]]);
          if (c > left + 1e-6) continue;
          left -= c;
          cost += c;
          count++;
        }
        if (count) o.sel = { count, cost, total: q.length };
      }
      const all = upgradeAllCost(w, this.unitsOnScreen());
      if (all.count && all.cost <= gold + 1e-6) o.all = all;
    }
    for (const cat of ['fort', 'camp'] as const) {
      const list = this.sitesOnScreen(cat);
      if (!list.length) continue;
      const cost = list.reduce((a, s) => a + SITE_INFO[s.type].upgradeCost, 0);
      if (cost <= w.stock[cat === 'fort' ? 'stone' : 'wood'][human]) o[cat === 'fort' ? 'forts' : 'camps'] = { count: list.length, cost };
    }
    return o;
  }

  private upgrade(act: UpgradeAction): void {
    const w = this.world;
    if (!w.humanTeam) return;
    if (act === 'sel' || act === 'all') {
      const r = w.upgradeUnits(act === 'sel' ? this.selList : this.unitsOnScreen());
      if (r.count) {
        this.hud.message(`${r.count} 人升为高级形态，花费黄金 ${Math.round(r.cost)}`, 'good');
        this.sound.ui('order');
      } else this.sound.ui('deny');
    } else {
      const list = this.sitesOnScreen(act === 'forts' ? 'fort' : 'camp').filter(s => w.upgradeSite(s));
      if (list.length) {
        this.hud.message(`${list.map(s => s.name).join('、')} 已升级`, 'good');
        this.sound.ui('order');
      } else this.sound.ui('deny');
    }
    this.refreshUi();
  }

  private siteAction(act: 'upgrade' | 'tower', id: number): void {
    const w = this.world, s = w.sites[id];
    if (!s || s.owner !== w.humanTeam) return;
    const info = SITE_INFO[s.type];
    if (act === 'upgrade') {
      if (w.upgradeSite(s)) this.hud.message(`${s.name} 已升级：建筑更坚固，箭塔更强`, 'good', s.x, s.y);
      else this.hud.message(`${RES_NAMES[info.material]}不足，升级 ${s.name} 需要 ${info.upgradeCost}`, 'info');
    } else if (w.buildTower(s)) this.hud.message(`${s.name} 建起一座箭塔`, 'good', s.x, s.y);
    else this.hud.message(`木材不足，建箭塔需要 ${RULES.economy.towerCost}`, 'info');
    this.sound.ui('order');
    this.refreshUi();
  }

  private refreshUi(): void {
    this.hud.update();
    this.hud.updateSelection(this.selList, this.selSite);
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

  private boxSelect(x0: number, y0: number, x1: number, y1: number, add: boolean): void {
    const w = this.world;
    const human = w.humanTeam;
    if (!human) return;
    const ax = Math.min(x0, x1), ay = Math.min(y0, y1), bx = Math.max(x0, x1), by = Math.max(y0, y1);
    const rd = this.renderer;
    rd.updateCamera();
    const list = add ? this.selList.slice() : [];
    const have = new Set(list);
    for (let i = 0; i < w.n; i++) {
      if (!w.controllable(i) || w.team[i] !== human || have.has(i)) continue;
      const p = rd.worldToScreen(w.x[i], w.y[i], 8);
      if (p && p.x >= ax && p.x <= bx && p.y >= ay && p.y <= by) list.push(i);
    }
    this.setSelection(list);
  }

  private selectType(defIdx: number, remove: boolean): void {
    const w = this.world;
    this.setSelection(this.selList.filter(s => (w.type[s] === defIdx) !== remove));
  }

  // ------------------------------------------------------------------ 指令
  private command(c: 'amove' | 'stop' | 'hold' | 'rally' | 'all' | 'torch' | 'outpost'): void {
    const w = this.world;
    if (!w.humanTeam) return;
    if (c === 'all') {
      const list: number[] = [];
      for (let i = 0; i < w.n; i++) if (w.controllable(i) && w.team[i] === w.humanTeam) list.push(i);
      this.setSelection(list);
    } else if (c === 'rally') this.setMode(this.mode === 'rally' ? '' : 'rally');
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
      const w = this.world;
      w.rally[w.humanTeam] = { x, y };
      this.renderer.addMarker(x, y, 1, 0.9, 0.3, false);
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
   * @param force 中立建筑也打
   */
  private attackBuildingAt(x: number, y: number, force: boolean): boolean {
    const w = this.world;
    const human = w.humanTeam;
    if (!human || !this.selList.length || !(x > 0 && y > 0 && x < w.W && y < w.H)) return false;
    const bid = w.nav.bld[w.cellAt(x, y)];
    if (bid < 0) return false;
    const b = w.buildings[bid];
    if (!b.alive || b.owner === human || (b.owner === 0 && !force) || (w.fog && !w.isExplored(b.cx, b.cy))) return false;
    if (b.def.fort && !this.selList.some(s => w.defs[w.type[s]].siege)) {
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
    // 鼠标移到屏幕边缘卷屏：越靠近边缘越快
    if (this.mouse.inside && !this.mouse.ui && !this.drag && !this.pan && !this.rdrag?.active && !this.hud.helpOpen && document.hasFocus()) {
      const m = EDGE_ZONE, vw = this.renderer.viewW, vh = this.renderer.viewH;
      const edge = (v: number): number => (v >= m ? 0 : 0.25 + 0.75 * (1 - Math.max(0, v) / m) ** 2);
      dx += edge(vw - this.mouse.x) - edge(this.mouse.x);
      dy += edge(vh - this.mouse.y) - edge(this.mouse.y);
    }
    if (dx || dy) {
      const sp = (1100 / cam.zoom) * dt;
      this.renderer.moveCam(dx * sp, dy * sp);
    }
    // Q / E 旋转镜头
    const rot = (k.has('q') ? 1 : 0) - (k.has('e') ? 1 : 0);
    if (rot) cam.yaw += rot * 1.5 * dt;
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
        this.hud.message(e.night ? '入夜：视野缩小，可点火把（T）' : '天亮了', 'info');
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
          this.hud.message(`已占领 ${s.name}${e.repaired ? '并修复' : ''}，${info.reinf ? `将定时获得${info.provides}` : `开始采集${info.provides}`}`, 'good', s.x, s.y);
        }
        else if (e.from === human) this.hud.message(`${s.name} 失守！`, 'bad', s.x, s.y);
        else this.hud.message(`敌军占领了 ${s.name}`, 'info', s.x, s.y);
      } else if (e.kind === 'reinforce') {
        if (e.team === human) {
          const sp = w.map.spawn[human];
          this.hud.message(`援军抵达：${e.count} 人（${s.name}）`, 'good', sp.x, sp.y);
          this.minimap.pings.push({ x: sp.x, y: sp.y, t: 0, color: '#fff' });
        }
      } else if (e.kind === 'razed') {
        if (s.gone) this.hud.message(e.team === human ? '敌方的临时据点已被摧毁' : '我方一座临时据点被摧毁', e.team === human ? 'good' : 'bad', s.x, s.y);
        else this.hud.message(`${s.name} 已成废墟，重新占领后才会修复`, e.team === human ? 'info' : 'bad', s.x, s.y);
      }
    }
    w.events.length = 0;
  }
}
