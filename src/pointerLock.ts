/**
 * 锁定鼠标模式：光标出不了画面，像 PC 上的 RTS 那样甩到边就卷屏。
 *
 * 浏览器锁定指针后系统光标不动、事件的 clientX/Y 不变，只剩 movementX/Y。这里自己维护一个虚拟光标（夹在视口内、用 DOM 画），
 * 并在 window 的捕获阶段拦下真实的鼠标事件，改成发往虚拟光标下的元素的合成事件：游戏与界面的其余代码照常读 clientX/Y、
 * 用 setPointerCapture、靠 :hover 与 title，一概不用知道有锁定这回事。
 * 合成事件靠 `synth` 标记让自己的捕获层放行。顶层不碰 DOM（纯函数在文件开头），Node 里可直接 import 测试。
 */
import SWORD from './ui/sword.svg?raw';

/** 虚拟光标累加鼠标位移后夹在视口内：贴边后继续推也只停在最外一个像素，贴边卷屏靠这个一直触发 */
export function moveCursor(x: number, y: number, mx: number, my: number, w: number, h: number): { x: number; y: number } {
  return {
    x: Math.min(Math.max(0, w - 1), Math.max(0, x + mx)),
    y: Math.min(Math.max(0, h - 1), Math.max(0, y + my)),
  };
}

/** 两次点击隔多久以内、离多远以内算连击（毫秒、像素） */
export const CLICK_GAP = 400;
export const CLICK_DIST = 6;

export interface ClickRecord {
  t: number;
  x: number;
  y: number;
  count: number;
}

/** 这一次点击是连击的第几下：和上一次间隔短、位置近算接着数，否则从 1 起。点在不同元素上的由调用方传 null */
export function nextClickCount(prev: ClickRecord | null, t: number, x: number, y: number): number {
  if (!prev || t - prev.t > CLICK_GAP || Math.hypot(x - prev.x, y - prev.y) > CLICK_DIST) return 1;
  return prev.count + 1;
}

/** 提示框的位置：默认在光标右下，放不下就翻到左 / 上，再不行贴着视口边 */
export function tipPosition(x: number, y: number, tw: number, th: number, w: number, h: number): { x: number; y: number } {
  const ox = 14, oy = 20;
  const px = x + ox + tw <= w ? x + ox : x - 6 - tw;
  const py = y + oy + th <= h ? y + oy : y - 6 - th;
  return { x: Math.max(0, Math.min(px, w - tw)), y: Math.max(0, Math.min(py, h - th)) };
}

/** 悬停多久后显示提示框（秒） */
const TIP_DELAY = 0.5;
/** 连续请求失败这么多次后，这一局不再自动请求 */
const MAX_FAILS = 3;

/** 捕获层要接管的事件：锁定期间真实的这些事件一律不往下传，需要的由合成事件代替 */
const INTERCEPT = [
  'pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'click', 'dblclick', 'contextmenu', 'wheel',
  'pointerover', 'pointerout', 'pointerenter', 'pointerleave',
  'mousedown', 'mouseup', 'mousemove', 'mouseover', 'mouseout', 'mouseenter', 'mouseleave', 'auxclick',
] as const;

/** `navigator.keyboard` 还不在标准类型里（Chrome / Edge 有） */
interface KeyboardLock {
  lock(keys: string[]): Promise<void>;
  unlock(): void;
}

/** 指令模式的十字准星；平时的光标是 SWORD，与样式表里的剑形指针同一张图，热点在剑尖（左上角） */
const CROSS = '<svg viewBox="0 0 24 24" width="24" height="24"><path d="M12 2v7M12 15v7M2 12h7M15 12h7" stroke="#000" stroke-width="4" stroke-linecap="round"/><path d="M12 2v7M12 15v7M2 12h7M15 12h7" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>';

function ancestors(e: Element | null): Element[] {
  const out: Element[] = [];
  for (; e; e = e.parentElement) out.push(e);
  return out;
}

export class PointerLock {
  /** 设置里的开关：开着才会在点画面时请求锁定 */
  enabled: boolean;
  /** 虚拟光标在视口里的位置（锁定期间 clientX/Y 都取这个） */
  x = 0;
  y = 0;

  private readonly cursor = document.createElement('div');
  private readonly tip = document.createElement('div');
  /** 自己派发的合成事件：捕获层看到这些就放行 */
  private readonly synth = new WeakSet<Event>();
  /** 按下时的目标：松开前独占后续的 move / up（代替真正的 setPointerCapture） */
  private captured: Element | null = null;
  private down: { el: Element; button: number } | null = null;
  private lastClick: (ClickRecord & { el: Element }) | null = null;
  /** 悬停链：虚拟光标下的元素及其祖先，都带着 `.hover`（CSS 的 :hover 对合成事件不生效） */
  private chain: Element[] = [];
  private hoverEl: Element | null = null;
  /** 最近一次真实的指针事件：合成事件的 pointerId、修饰键等字段照抄它 */
  private last: PointerEvent | null = null;
  /** 触发锁定的那次点击：它的 pointerup / click 不往下传，免得当成一次选择 */
  private swallowing = false;
  /** 请求锁定失败的状态：连续失败次数、是否已放弃自动请求、当前这次请求是否还没出结果 */
  private fails = 0;
  private gaveUp = false;
  private pending = false;
  private raf = 0;
  private tipTimer = 0;
  private tipSource: Element | null = null;
  private cursorKind = '';
  private patched: { set: Element['setPointerCapture']; release: Element['releasePointerCapture'] } | null = null;
  private readonly cleanup: (() => void)[] = [];

  constructor(private readonly canvas: HTMLCanvasElement, enabled: boolean, private readonly onChange: (locked: boolean) => void,
    /** 请求锁定失败：giveUp 为 true 表示连续失败太多、不再自动请求 */ private readonly onFail: (giveUp: boolean) => void) {
    this.enabled = enabled;
    this.cursor.className = 'vcursor';
    this.cursor.hidden = true;
    this.cursor.innerHTML = SWORD + CROSS;
    this.tip.className = 'lock-tip';
    this.tip.hidden = true;
    document.body.append(this.cursor, this.tip);
    this.cleanup.push(() => this.cursor.remove(), () => this.tip.remove());

    for (const type of INTERCEPT) {
      const fn = (e: Event): void => this.intercept(e);
      window.addEventListener(type, fn, { capture: true, passive: false });
      this.cleanup.push(() => window.removeEventListener(type, fn, true));
    }
    const on = (target: EventTarget, type: string, fn: () => void): void => {
      target.addEventListener(type, fn);
      this.cleanup.push(() => target.removeEventListener(type, fn));
    };
    on(document, 'pointerlockchange', () => this.lockChanged());
    // 旧版 Safari / Firefox 的 requestPointerLock 不返回 Promise，失败只发这个事件
    on(document, 'pointerlockerror', () => this.lockFailed());
    on(document, 'fullscreenchange', () => this.syncKeyboard());
    on(window, 'blur', () => this.resetPress());
    this.syncKeyboard();
  }

  get locked(): boolean {
    return document.pointerLockElement !== null;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (on) {
      this.fails = 0;
      this.gaveUp = false;
    }
    if (!on && this.locked) document.exitPointerLock();
    this.syncKeyboard();
  }

  destroy(): void {
    if (this.locked) document.exitPointerLock();
    this.enabled = false;
    this.syncKeyboard();
    this.teardown();
    cancelAnimationFrame(this.raf);
    for (const f of this.cleanup) f();
  }

  /** 锁定期间虚拟光标的位置，没锁定是 null */
  get virtualPos(): { x: number; y: number } | null {
    return this.locked ? { x: this.x, y: this.y } : null;
  }

  /** 指令模式切换了画面上的光标样式：重读虚拟光标下的样式 */
  refreshCursor(): void {
    this.cursorKind = '';
    if (this.locked && this.hoverEl) this.drawCursor(this.hoverEl);
  }

  // ------------------------------------------------------------------ 锁定与解锁

  private requestLock(): void {
    // 必须在用户手势里调；Chrome 在用户按 Esc 退出后约 1 秒内再请求会失败，失败就等下一次点击
    this.pending = true;
    try {
      void Promise.resolve(document.documentElement.requestPointerLock()).catch(() => this.lockFailed());
    } catch {
      this.lockFailed();
    }
  }

  /** Promise 被拒与 pointerlockerror 两条路都会来：一次请求只算一次失败 */
  private lockFailed(): void {
    if (!this.pending) return;
    this.pending = false;
    this.swallowing = false;
    if (++this.fails >= MAX_FAILS) this.gaveUp = true;
    this.onFail(this.gaveUp);
  }

  private lockChanged(): void {
    this.syncKeyboard();
    if (this.locked) {
      this.pending = false;
      this.fails = 0;
      this.patchCapture(true);
      this.setPos(this.x, this.y);
      this.cursor.hidden = false;
      const loop = (): void => {
        // 界面每秒重建几次列表：每帧重新判断一次悬停，新建出来的元素才能亮起
        if (this.last) this.hover(this.captured ?? this.under(), this.last);
        this.raf = requestAnimationFrame(loop);
      };
      this.raf = requestAnimationFrame(loop);
    } else {
      this.teardown();
    }
    this.onChange(this.locked);
  }

  /** 解锁后一切回到原生行为：清掉按下、悬停、提示与补丁 */
  private teardown(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.cursor.hidden = true;
    this.hideTip();
    this.resetPress();
    for (const el of this.chain) el.classList.remove('hover');
    this.chain = [];
    this.hoverEl = null;
    this.cursorKind = '';
    this.patchCapture(false);
  }

  /** 窗口失焦时按下的状态不会再收到松开：清掉，免得卡在拖动里 */
  private resetPress(): void {
    this.captured = null;
    this.down = null;
    this.lastClick = null;
  }

  /**
   * Esc 默认会先退出锁定、游戏收不到。锁定期间且全屏时（Chrome / Edge）用 Keyboard Lock 把 Esc 交给页面，此时浏览器改成长按 Esc 退出；
   * 不支持的浏览器与非全屏时只能接受「第一下 Esc 只解锁」。只在真正锁定时拦：没锁定时拦了，全屏就按 Esc 退不出来。
   */
  private syncKeyboard(): void {
    const kb = (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard;
    if (!kb) return;
    if (this.locked && document.fullscreenElement) kb.lock(['Escape']).catch(() => undefined);
    else kb.unlock();
  }

  /**
   * 合成事件不是真实的指针，浏览器不认它的 pointerId 时 setPointerCapture 会抛错。
   * 真正的「捕获」由 captured 实现：锁定期间给 Element 上的两个方法打补丁，调用者成为 captured（与真实捕获一致，
   * 按下时的元素可能在拖动中被界面重建、脱离文档，容器捕获的才收得到后续事件），调用本身不抛；解锁摘掉。
   * 没人调 setPointerCapture 时 captured 仍是按下时光标下的元素。
   */
  private patchCapture(on: boolean): void {
    const proto = Element.prototype;
    if (on && !this.patched) {
      const self = this;
      const set = proto.setPointerCapture, release = proto.releasePointerCapture;
      this.patched = { set, release };
      proto.setPointerCapture = function (id: number): void {
        self.captured = this;
        try {
          set.call(this, id);
        } catch {
          /* 合成事件的 pointerId */
        }
      };
      proto.releasePointerCapture = function (id: number): void {
        if (self.captured === this) self.captured = null;
        try {
          release.call(this, id);
        } catch {
          /* 同上 */
        }
      };
    } else if (!on && this.patched) {
      proto.setPointerCapture = this.patched.set;
      proto.releasePointerCapture = this.patched.release;
      this.patched = null;
    }
  }

  // ------------------------------------------------------------------ 拦截真实事件

  private intercept(e: Event): void {
    if (this.synth.has(e)) return;
    const type = e.type;
    if (!this.locked) {
      if (this.swallowing && (type === 'pointerup' || type === 'mouseup' || type === 'click')) {
        if (type === 'click') this.swallowing = false;
        e.stopImmediatePropagation();
      } else if (type === 'pointerdown') {
        this.swallowing = false;
        const p = e as PointerEvent;
        if (this.enabled && !this.gaveUp && p.button === 0 && p.target === this.canvas) {
          this.swallowing = true;
          const m = moveCursor(p.clientX, p.clientY, 0, 0, this.viewW(), this.viewH());
          this.x = m.x;
          this.y = m.y;
          this.last = p;
          // 只拦这一次：不让它到 canvas 当成选择，但同在 window 捕获阶段的监听（如收起设置面板）照常收到
          e.stopPropagation();
          this.requestLock();
        }
      }
      return;
    }
    e.stopImmediatePropagation();
    if (this.swallowing && (type === 'pointerup' || type === 'mouseup' || type === 'click')) {
      if (type === 'click') this.swallowing = false;
      return;
    }
    switch (type) {
      case 'pointermove': return this.onMove(e as PointerEvent);
      case 'pointerdown': return this.onDown(e as PointerEvent);
      case 'pointerup': return this.onUp(e as PointerEvent);
      case 'pointercancel': return this.onCancel(e as PointerEvent);
      case 'contextmenu':
        e.preventDefault();
        this.fire('contextmenu', this.under(), e as MouseEvent);
        return;
      case 'wheel':
        e.preventDefault();
        return this.onWheel(e as WheelEvent);
      default:
        // click / dblclick 由自己按按下与松开的位置派发，其余的真实事件丢弃
        if (type.startsWith('mouse')) e.preventDefault();
    }
  }

  private viewW(): number {
    return document.documentElement.clientWidth;
  }

  private viewH(): number {
    return document.documentElement.clientHeight;
  }

  private under(): Element {
    return document.elementFromPoint(this.x, this.y) ?? document.documentElement;
  }

  /** 更新虚拟光标坐标并立即挪光标元素：不等渲染帧，少一帧的延迟 */
  private setPos(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.cursor.style.transform = `translate(${x}px, ${y}px)`;
  }

  private onMove(e: PointerEvent): void {
    this.last = e;
    const m = moveCursor(this.x, this.y, e.movementX, e.movementY, this.viewW(), this.viewH());
    this.setPos(m.x, m.y);
    const target = this.captured ?? this.under();
    this.hover(target, e);
    this.fire('pointermove', target, e);
    this.armTip();
  }

  private onDown(e: PointerEvent): void {
    this.last = e;
    // 有的浏览器锁定后不补发那次点击的 click：残留的吞掉标记会让下一次的 up 被吞
    this.swallowing = false;
    this.hideTip();
    const t = this.under();
    this.hover(t, e);
    if (!this.captured) this.captured = t;
    if (!this.down) this.down = { el: t, button: e.button };
    e.preventDefault();
    this.fire('pointerdown', t, e);
  }

  private onUp(e: PointerEvent): void {
    this.last = e;
    const t = this.captured ?? this.under();
    this.fire('pointerup', t, e);
    const down = this.down;
    if (e.button === 0 && down?.button === 0) {
      this.down = null;
      // 点击落在按下与松开两处的共同祖先上，与浏览器一致
      const up = ancestors(this.under());
      const el = ancestors(down.el).find(a => up.includes(a));
      if (el) this.click(el, e);
    }
    if (e.buttons === 0) {
      this.captured = null;
      this.down = null;
      this.hover(this.under(), e);
    }
  }

  private onCancel(e: PointerEvent): void {
    const t = this.captured;
    this.resetPress();
    if (t) this.fire('pointercancel', t, e);
  }

  private click(el: Element, src: MouseEvent): void {
    const now = performance.now();
    const prev = this.lastClick?.el === el ? this.lastClick : null;
    const count = nextClickCount(prev, now, this.x, this.y);
    this.lastClick = { t: now, x: this.x, y: this.y, count, el };
    this.fire('click', el, src, { detail: count });
    if (count === 2) this.fire('dblclick', el, src, { detail: 2 });
  }

  private onWheel(e: WheelEvent): void {
    this.hideTip();
    const target = this.under();
    const ev = this.fire('wheel', target, e);
    if (ev.defaultPrevented) return;
    // 合成的 wheel 不会让浏览器去滚动：没人处理时自己找一个能滚的祖先滚
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.viewH() : 1;
    for (const a of ancestors(target)) {
      const oy = getComputedStyle(a).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && a.scrollHeight > a.clientHeight) {
        a.scrollTop += e.deltaY * unit;
        break;
      }
    }
  }

  // ------------------------------------------------------------------ 合成事件

  /** 派发一个 clientX/Y 为虚拟坐标、其余字段照抄真实事件的合成事件 */
  private fire(type: string, target: Element, src: MouseEvent, o: { detail?: number; related?: Element | null } = {}): Event {
    const pointerish = type.startsWith('pointer');
    const crossing = /(over|out|enter|leave)$/.test(type);
    const noBubble = type.endsWith('enter') || type.endsWith('leave');
    const move = crossing || type.endsWith('move');
    const init: PointerEventInit & { movementX?: number; movementY?: number } = {
      bubbles: !noBubble, cancelable: !noBubble, composed: true, view: window,
      clientX: this.x, clientY: this.y, screenX: src.screenX, screenY: src.screenY,
      button: move ? -1 : src.button, buttons: src.buttons,
      ctrlKey: src.ctrlKey, shiftKey: src.shiftKey, altKey: src.altKey, metaKey: src.metaKey,
      detail: o.detail ?? 0, relatedTarget: o.related ?? null,
      movementX: type.endsWith('move') ? src.movementX : 0, movementY: type.endsWith('move') ? src.movementY : 0,
    };
    let ev: Event;
    if (type === 'wheel') {
      const w = src as WheelEvent;
      ev = new WheelEvent(type, { ...init, deltaX: w.deltaX, deltaY: w.deltaY, deltaZ: w.deltaZ, deltaMode: w.deltaMode });
      // 构造出的 wheel 事件的 wheelDeltaY 一律是 −3 × deltaY，丢了鼠标滚轮与触控板的区别：照抄真实的
      const wd = (src as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY;
      if (wd !== undefined) Object.defineProperty(ev, 'wheelDeltaY', { value: wd });
    } else if (pointerish) {
      const p = (this.last ?? src) as PointerEvent;
      ev = new PointerEvent(type, { ...init, pointerId: p.pointerId, pointerType: p.pointerType, isPrimary: p.isPrimary,
        width: p.width, height: p.height, pressure: type === 'pointerup' || crossing ? 0 : p.pressure });
    } else {
      ev = new MouseEvent(type, init);
    }
    this.synth.add(ev);
    target.dispatchEvent(ev);
    return ev;
  }

  // ------------------------------------------------------------------ 悬停、光标与提示

  /** 悬停目标变了：派发 over / out / enter / leave，并给悬停链上的元素加减 `.hover` */
  private hover(target: Element, src: MouseEvent): void {
    if (target === this.hoverEl) return;
    const old = this.hoverEl, prev = this.chain, next = ancestors(target);
    this.hoverEl = target;
    this.chain = next;
    if (old) {
      this.fire('pointerout', old, src, { related: target });
      this.fire('mouseout', old, src, { related: target });
    }
    for (const el of prev) {
      if (next.includes(el)) continue;
      el.classList.remove('hover');
      this.fire('pointerleave', el, src, { related: target });
      this.fire('mouseleave', el, src, { related: target });
    }
    this.fire('pointerover', target, src, { related: old });
    this.fire('mouseover', target, src, { related: old });
    for (const el of next.slice().reverse()) {
      if (prev.includes(el)) continue;
      el.classList.add('hover');
      this.fire('pointerenter', el, src, { related: old });
      this.fire('mouseenter', el, src, { related: old });
    }
    this.drawCursor(target);
  }

  /** 光标样式跟着目标元素的 CSS cursor：十字（指令模式）画十字准星，其余画剑 */
  private drawCursor(target: Element): void {
    const kind = getComputedStyle(target).cursor === 'crosshair' ? 'cross' : 'sword';
    if (kind === this.cursorKind) return;
    this.cursorKind = kind;
    this.cursor.classList.toggle('cross', kind === 'cross');
  }

  /** 光标停住 0.5 秒后，显示虚拟光标下最近的带 title 的祖先的内容（原生 title 在锁定时浏览器不显示） */
  private armTip(): void {
    const src = this.hoverEl?.closest('[title]') ?? null;
    if (this.tipSource === src && !this.tip.hidden) {
      this.placeTip();
      return;
    }
    this.hideTip();
    if (!src) return;
    this.tipTimer = window.setTimeout(() => {
      const el = this.hoverEl?.closest('[title]');
      const text = el?.getAttribute('title');
      if (!el || !text || !this.locked) return;
      // 保留 title 里的换行，不吃 HTML
      this.tip.textContent = text;
      this.tip.hidden = false;
      this.tipSource = el;
      this.placeTip();
    }, TIP_DELAY * 1000);
  }

  private placeTip(): void {
    const p = tipPosition(this.x, this.y, this.tip.offsetWidth, this.tip.offsetHeight, this.viewW(), this.viewH());
    this.tip.style.transform = `translate(${p.x}px, ${p.y}px)`;
  }

  private hideTip(): void {
    clearTimeout(this.tipTimer);
    this.tip.hidden = true;
    this.tipSource = null;
  }
}
