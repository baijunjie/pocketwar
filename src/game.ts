/** 一局游戏：主循环、镜头、选择与指令输入 */
import { DT, FactionDef, SITE_INFO } from './sim/defs';
import { Game, GameOptions, createGame } from './sim/setup';
import { MAX_UNITS, S_ROUT, World } from './sim/world';
import { Minimap } from './render/minimap';
import { Renderer } from './render/renderer';
import { Hud } from './ui/hud';

type Mode = '' | 'amove' | 'rally';

export class GameApp {
  readonly world: World;
  readonly renderer: Renderer;
  private readonly game: Game;
  private readonly hud: Hud;
  private readonly minimap: Minimap;
  private readonly box: HTMLDivElement;
  private readonly sel = new Uint8Array(MAX_UNITS);
  private selList: number[] = [];
  private selUid: number[] = [];
  private readonly groups: { slots: number[]; uids: number[] }[] = [];
  private speed = 1;
  private lastSpeed = 1;
  private acc = 0;
  private last = 0;
  private raf = 0;
  private mode: Mode = '';
  private readonly keys = new Set<string>();
  private mouse = { x: 0, y: 0, inside: false };
  private drag: { x: number; y: number; active: boolean } | null = null;
  private pan: { x: number; y: number; rotate: boolean } | null = null;
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
      selectType: (t, remove) => this.selectType(t, remove),
      setSpeed: s => this.setSpeed(s),
      focus: (x, y) => this.focus(x, y),
      exit: () => this.onExit(),
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
    this.hud.update();
    this.hud.updateSelection([]);
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    for (const f of this.cleanup) f();
    this.hud.destroy();
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
    this.on(cv, 'pointerdown', e => {
      cv.focus();
      if (this.hud.helpOpen) return;
      const p = this.local(e);
      if (e.button === 1) {
        this.pan = { x: p.x, y: p.y, rotate: e.altKey || e.shiftKey };
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
        else this.rightClick(p.x, p.y, e.ctrlKey || e.metaKey);
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
      const d = this.drag;
      if (d && e.button === 0) {
        this.drag = null;
        this.box.style.display = 'none';
        if (d.active) this.boxSelect(d.x, d.y, p.x, p.y, e.shiftKey);
        else this.clickSelect(p.x, p.y, e.shiftKey);
      }
    });
    this.on(cv, 'pointerleave', () => {
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
      this.keys.add(k);
      if (e.repeat) return;
      const human = this.world.humanTeam;
      if (k.startsWith('Arrow') || k === ' ') e.preventDefault();
      if (k === 'Escape') {
        if (this.hud.helpOpen) this.hud.toggleHelp();
        else if (this.mode) this.setMode('');
        else this.setSelection([]);
      } else if (k === 'F1' || k === '?') {
        e.preventDefault();
        this.hud.toggleHelp();
      } else if (k === ' ' || k === 'p') this.setSpeed(this.speed ? 0 : this.lastSpeed);
      else if (k === '=' || k === '+') this.setSpeed(Math.min(4, Math.max(1, this.speed * 2)));
      else if (k === '-') this.setSpeed(Math.max(1, this.speed / 2));
      else if (!human) return;
      else if (k === 'a' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this.command('all');
      } else if (k === 'a') this.command('amove');
      else if (k === 's') this.command('stop');
      else if (k === 'h') this.command('hold');
      else if (k === 'r') this.command('rally');
      else if (k === 't') this.command('torch');
      else if (e.code.startsWith('Digit')) {
        // 用物理键位判断：Mac 上 Option+数字 输出的是特殊字符，Cmd+数字 又会被浏览器拿去切标签页
        const g = Number(e.code.slice(5));
        if (e.ctrlKey || e.metaKey || e.altKey) {
          e.preventDefault();
          this.groups[g] = { slots: this.selList.slice(), uids: this.selUid.slice() };
          this.hud.message(`已编为第 ${g} 队（${this.selList.length} 人）`, 'info');
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
    });
  }

  private local(e: MouseEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private setMode(m: Mode): void {
    this.mode = m;
    this.canvas.style.cursor = m ? 'crosshair' : 'default';
    this.hud.setMode(m === 'amove' ? '攻击移动：左键指定目的地（右键取消）' : m === 'rally' ? '集结点：左键指定位置（右键取消）' : '');
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
    this.hud.updateSelection(list);
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
      if (!add) this.setSelection([]);
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
  private command(c: 'amove' | 'stop' | 'hold' | 'rally' | 'all' | 'torch'): void {
    const w = this.world;
    if (!w.humanTeam) return;
    if (c === 'all') {
      const list: number[] = [];
      for (let i = 0; i < w.n; i++) if (w.controllable(i) && w.team[i] === w.humanTeam) list.push(i);
      this.setSelection(list);
    } else if (c === 'rally') this.setMode(this.mode === 'rally' ? '' : 'rally');
    else if (!this.selList.length) return;
    else if (c === 'amove') this.setMode(this.mode === 'amove' ? '' : 'amove');
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
    if (this.mode === 'amove') this.issueMove(x, y, true);
    else if (this.mode === 'rally') {
      const w = this.world;
      w.rally[w.humanTeam] = { x, y };
      this.renderer.addMarker(x, y, 1, 0.9, 0.3);
    }
    this.setMode('');
  }

  private issueMove(x: number, y: number, amove: boolean): void {
    if (!this.selList.length) return;
    this.world.orderMove(this.selList, x, y, amove);
    if (amove) this.renderer.addMarker(x, y, 1, 0.45, 0.25);
    else this.renderer.addMarker(x, y, 0.4, 1, 0.45);
  }

  private rightClick(sx: number, sy: number, force: boolean): void {
    const w = this.world;
    const human = w.humanTeam;
    if (!human || !this.selList.length) return;
    const p = this.renderer.screenToWorld(sx, sy);
    const enemy = this.unitAt(sx, sy, 3 - human, true);
    if (enemy >= 0) {
      w.orderAttackUnit(this.selList, enemy);
      this.renderer.addMarker(w.x[enemy], w.y[enemy], 1, 0.25, 0.2);
      return;
    }
    if (p.x > 0 && p.y > 0 && p.x < w.W && p.y < w.H) {
      const bid = w.nav.bld[w.cellAt(p.x, p.y)];
      if (bid >= 0) {
        const b = w.buildings[bid];
        if (b.alive && b.owner !== human && (b.owner !== 0 || force) && (!w.fog || w.isExplored(b.cx, b.cy))) {
          if (b.def.fort && !this.selList.some(s => w.defs[w.type[s]].siege)) {
            this.hud.message(`${b.def.name}只有器械和战象能破坏`, 'info');
            return;
          }
          w.orderAttackBuilding(this.selList, b);
          this.renderer.addMarker(b.cx, b.cy, 1, 0.25, 0.2);
          return;
        }
      }
    }
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
    this.drainEvents();

    this.renderer.render(Math.min(1, this.acc / DT), running ? real * Math.min(this.speed, 2) : 0, this.sel, this.selList.length <= 40);
    this.mmTimer -= real;
    if (this.mmTimer <= 0) {
      this.mmTimer = 0.1;
      this.minimap.draw(this.renderer.viewQuad(), 0.1);
    }
    this.uiTimer -= real;
    if (this.uiTimer <= 0) {
      this.uiTimer = 0.25;
      this.hud.update();
      this.hud.updateSelection(this.selList);
      this.hud.setDebug(`${Math.round(this.fps)} FPS · 模拟 ${simMs.toFixed(1)}ms · ${w.teamCount[1] + w.teamCount[2]} 单位`);
    }
  };

  private updateCamera(dt: number): void {
    const cam = this.renderer.cam, k = this.keys;
    let dx = 0, dy = 0;
    if (k.has('ArrowLeft')) dx -= 1;
    if (k.has('ArrowRight')) dx += 1;
    if (k.has('ArrowUp')) dy -= 1;
    if (k.has('ArrowDown')) dy += 1;
    // 全屏时启用屏幕边缘滚动
    if (document.fullscreenElement && this.mouse.inside && !this.drag && !this.pan) {
      const m = 14;
      if (this.mouse.x < m) dx -= 1;
      else if (this.mouse.x > this.renderer.viewW - m) dx += 1;
      if (this.mouse.y < m) dy -= 1;
      else if (this.mouse.y > this.renderer.viewH - m) dy += 1;
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
        this.hud.message(e.rain ? '下雨了：火把点不着，行军变慢，士气下降' : '雨停了', 'info');
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
        else if (e.team === human) this.hud.message(`已占领 ${s.name}${e.repaired ? '并修复' : ''}，将定时获得${SITE_INFO[s.type].provides}`, 'good', s.x, s.y);
        else if (e.from === human) this.hud.message(`${s.name} 失守！`, 'bad', s.x, s.y);
        else this.hud.message(`敌军占领了 ${s.name}`, 'info', s.x, s.y);
      } else if (e.kind === 'reinforce') {
        if (e.team === human) {
          const sp = w.map.spawn[human];
          this.hud.message(`援军抵达：${e.count} 人（${s.name}）`, 'good', sp.x, sp.y);
          this.minimap.pings.push({ x: sp.x, y: sp.y, t: 0, color: '#fff' });
        }
      } else if (e.kind === 'razed') {
        this.hud.message(`${s.name} 已成废墟，重新占领后才会修复`, e.team === human ? 'info' : 'bad', s.x, s.y);
      }
    }
    w.events.length = 0;
  }
}
