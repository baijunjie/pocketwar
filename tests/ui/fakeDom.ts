// ---------------------------------------------------------------------------------------------------------------------
// 极简假 DOM：项目没装 jsdom / happy-dom，界面类（Joystick、CardBar）的指针交互靠它在 node 里测。
// 只实现这些类用到的那一小部分接口：类名、样式、子节点、事件、布局矩形（由测试自己设）、指针捕获。
// ---------------------------------------------------------------------------------------------------------------------

export interface FakeRect { left: number; top: number; width: number; height: number; right: number; bottom: number }

export function rectOf(left: number, top: number, width: number, height: number): FakeRect {
  return { left, top, width, height, right: left + width, bottom: top + height };
}

export class FakeEl extends EventTarget {
  readonly classList: { add(...c: string[]): void; remove(...c: string[]): void; toggle(c: string, force?: boolean): boolean; contains(c: string): boolean };
  /** 普通属性（transform 等）直接读写；CSS 变量走 setProperty / getPropertyValue（不进可枚举属性） */
  readonly style: Record<string, string> & { setProperty(k: string, v: string): void; getPropertyValue(k: string): string } = (() => {
    const vars = new Map<string, string>();
    const st: Record<string, unknown> = {};
    Object.defineProperty(st, 'setProperty', { value: (k: string, v: string) => vars.set(k, v) });
    Object.defineProperty(st, 'getPropertyValue', { value: (k: string) => vars.get(k) ?? '' });
    return st as never;
  })();
  readonly dataset: Record<string, string> = {};
  readonly attrs: Record<string, string> = {};
  readonly children: FakeEl[] = [];
  parent: FakeEl | null = null;
  hidden = false;
  /** 按钮之类的 disabled（假 DOM 不做原生的禁用语义，只是个可读写的标志） */
  disabled = false;
  private html = '';
  textContent = '';
  scrollLeft = 0;
  offsetWidth = 0;
  rect: FakeRect = rectOf(0, 0, 0, 0);
  /** 当前持有指针捕获的 pointerId（没有是 null） */
  captured: number | null = null;
  readonly captureCalls: number[] = [];
  private readonly cls = new Set<string>();

  constructor(readonly tagName = 'div') {
    super();
    const cls = this.cls;
    this.classList = {
      add: (...c) => c.forEach(x => cls.add(x)),
      remove: (...c) => c.forEach(x => cls.delete(x)),
      toggle: (c, force) => {
        const on = force ?? !cls.has(c);
        if (on) cls.add(c); else cls.delete(c);
        return on;
      },
      contains: c => cls.has(c),
    };
  }

  /** 只认「一串不带属性、不嵌套的标签」（如 `<b>1</b><i></i>`），解析成子节点；别的内容只当字符串记着 */
  get innerHTML(): string { return this.html; }
  set innerHTML(v: string) {
    this.html = v;
    for (const c of this.children.splice(0)) c.parent = null;
    if (!/^(<(\w+)>[^<]*<\/\2>)+$/.test(v)) return;
    for (const m of v.matchAll(/<(\w+)>([^<]*)<\/\1>/g)) {
      const c = new FakeEl(m[1]);
      c.textContent = m[2];
      this.appendChild(c);
    }
  }
  get lastElementChild(): FakeEl | null { return this.children[this.children.length - 1] ?? null; }

  get className(): string { return [...this.cls].join(' '); }
  set className(v: string) {
    this.cls.clear();
    for (const c of v.split(/\s+/)) if (c) this.cls.add(c);
  }

  appendChild<T extends FakeEl>(c: T): T {
    c.remove();
    c.parent = this;
    this.children.push(c);
    return c;
  }
  append(...cs: FakeEl[]): void { cs.forEach(c => this.appendChild(c)); }
  remove(): void {
    if (!this.parent) return;
    this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = null;
  }
  setAttribute(k: string, v: string): void { this.attrs[k] = v; }
  removeAttribute(k: string): void { delete this.attrs[k]; }
  getBoundingClientRect(): FakeRect { return this.rect; }
  setPointerCapture(id: number): void { this.captured = id; this.captureCalls.push(id); }
  hasPointerCapture(id: number): boolean { return this.captured === id; }
  releasePointerCapture(id: number): void { if (this.captured === id) this.captured = null; }

  /** 只认 `.类名` 与 `.a .b`（取最后一段的类名向上找），够这里用 */
  closest(sel: string): FakeEl | null {
    const last = sel.trim().split(/\s+/).pop()!.replace(/^\./, '');
    for (let n: FakeEl | null = this; n; n = n.parent) if (n.classList.contains(last)) return n;
    return null;
  }
  /** 只认 `.类名`，深度优先 */
  querySelector(sel: string): FakeEl | null {
    const cls = sel.replace(/^\./, '');
    for (const c of this.children) {
      if (c.classList.contains(cls)) return c;
      const r = c.querySelector(sel);
      if (r) return r;
    }
    return null;
  }
  cloneNode(deep = false): FakeEl {
    const c = new (this.constructor as new (tag: string) => FakeEl)(this.tagName);
    c.className = this.className;
    Object.assign(c.dataset, this.dataset);
    Object.assign(c.style, this.style);
    c.html = this.html;
    c.offsetWidth = this.offsetWidth;
    if (deep) for (const k of this.children) c.appendChild(k.cloneNode(true));
    return c;
  }
}

export class FakeCanvas extends FakeEl {
  constructor() { super('canvas'); }
}

/** 装上假的 document / window / HTMLCanvasElement（用 vi.stubGlobal），返回 window 与可设置的 elementFromPoint */
export function installFakeDom(vi: { stubGlobal(name: string, v: unknown): unknown }): {
  win: EventTarget & { setTimeout: typeof setTimeout };
  hit: { fn: (x: number, y: number) => unknown };
} {
  const hit = { fn: (_x: number, _y: number): unknown => null };
  const win = Object.assign(new EventTarget(), {
    setTimeout: ((f: () => void, ms?: number) => globalThis.setTimeout(f, ms)) as unknown as typeof setTimeout,
  });
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', {
    createElement: (tag: string) => (tag === 'canvas' ? new FakeCanvas() : new FakeEl(tag)),
    elementFromPoint: (x: number, y: number) => hit.fn(x, y),
  });
  vi.stubGlobal('HTMLCanvasElement', FakeCanvas);
  return { win, hit };
}

/** 造一个指针事件并派发到 target：事件的 target 就是 target 自己（假 DOM 不冒泡，需要冒泡的在测试里直接派发到按下的那个子节点，由监听方向上找） */
export function firePointer(
  on: FakeEl, type: string, init: { clientX?: number; clientY?: number; pointerId?: number; button?: number; buttons?: number; shiftKey?: boolean } = {},
  /** 事件监听挂在 on 上，但 e.target 是这个子节点（模拟冒泡） */
  target: FakeEl = on,
): Event {
  const e = new Event(type, { cancelable: true });
  const fields = { clientX: 0, clientY: 0, pointerId: 1, button: 0, buttons: 0, shiftKey: false, ctrlKey: false, metaKey: false, ...init };
  for (const [k, v] of Object.entries(fields)) Object.defineProperty(e, k, { value: v });
  Object.defineProperty(e, 'target', { value: target });
  on.dispatchEvent(e);
  return e;
}
