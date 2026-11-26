/**
 * 防止对局中误触系统 / 浏览器的「返回」而离开页面（单机对局不存档，离开就丢了）：
 * `BackGuard` 在浏览历史里垫一条记录，返回只弹掉它、页面不走；`blocksEdgeSwipe` 判定哪些边缘起手的触摸要拦下默认行为，
 * 让 iOS Safari 不把它当成边缘返回手势。由 `game.ts` 接到事件上。
 */

/** 垫进浏览历史的那条记录的标记 */
const MARK = 'pocketWarBackGuard';

/** `BackGuard` 用到的那部分 window，测试里换成假的 */
export interface GuardWindow {
  history: { readonly state: unknown; pushState(data: unknown, unused: string): void };
  /** 浏览器报告的「此刻有没有用户操作带来的激活」；老浏览器没有这个接口 */
  navigator?: { userActivation?: { readonly isActive: boolean } };
  addEventListener(type: GuardEvent, fn: () => void, capture: boolean): void;
  removeEventListener(type: GuardEvent, fn: () => void, capture: boolean): void;
}

type GuardEvent = 'popstate' | 'pointerdown' | 'pointerup' | 'keydown';

/**
 * 可能是「用户操作」的事件，垫记录只在这些事件里做。哪些真的带来激活因设备而异（鼠标是按下、手指是抬起，Esc 等按键不算），
 * 所以三种都听，垫之前再问浏览器此刻有没有激活
 */
const ACTIONS = ['pointerdown', 'pointerup', 'keydown'] as const;

function marked(state: unknown): boolean {
  return typeof state === 'object' && state !== null && (state as Record<string, unknown>)[MARK] === true;
}

/**
 * 对局期间拦住「返回」：往浏览历史里垫一条记录，返回（手势、按键、浏览器按钮）只是弹掉这一条，页面不离开；
 * 弹掉后，玩家下一次操作时再垫一条，所以一直有效。
 * 垫记录只在用户操作的事件里做，不在开始时、也不在被弹掉的当下做：Chrome 的后退会跳过「用户没操作就又加了一条记录」的历史记录，
 * 那样垫的记录等于没垫，返回直接越过它离开页面。代价是开始后、以及被拦下一次后，玩家还没再操作之前不设防
 */
export class BackGuard {
  private on = false;
  private readonly onPop = (): void => this.onBlocked();
  private readonly onAction = (): void => {
    // 这一下没带来激活（如 Esc、拖了很久才松开的鼠标）就不垫，等下一次：此时垫的记录会被后退跳过，
    // 而且它占着位置，之后有激活的操作也不会重垫。没有这个接口的浏览器照垫
    const act = this.win.navigator?.userActivation;
    if (act && !act.isActive) return;
    this.pad();
  };

  /** onBlocked：拦下了一次返回 */
  constructor(private readonly onBlocked: () => void, private readonly win: GuardWindow = window) {}

  start(): void {
    if (this.on) return;
    this.on = true;
    this.win.addEventListener('popstate', this.onPop, true);
    for (const type of ACTIONS) this.win.addEventListener(type, this.onAction, true);
  }

  /** 停止拦截。垫着的那条记录留在历史里（主动后退会触发一次异步的 popstate，不值得）：之后第一次返回弹掉它，第二次才离开页面 */
  stop(): void {
    if (!this.on) return;
    this.on = false;
    this.win.removeEventListener('popstate', this.onPop, true);
    for (const type of ACTIONS) this.win.removeEventListener(type, this.onAction, true);
  }

  /** 当前记录不是垫的那条才垫：已经垫着（含上一局留下的）就不动，不越垫越多 */
  private pad(): void {
    const h = this.win.history;
    try {
      if (!marked(h.state)) h.pushState({ [MARK]: true }, '');
    } catch {
      /* 个别环境（沙盒 iframe、短时间内调用过多）会拒绝 pushState：拦不了就算了，不影响游戏 */
    }
  }
}

/** 离屏幕左右边缘多少像素以内起手的触摸算「边缘起手」（iOS Safari 的边缘返回手势从这一带起手） */
export const EDGE_SWIPE_ZONE = 24;

/**
 * 这些界面自己用 pointer 事件处理手指（把手、画面、卡片带、摇杆与小地图），在屏幕边缘起手时可以放心拦下触摸的默认行为；
 * 靠 click 的按钮与面板不在此列：拦下 touchstart 的默认行为，浏览器就不再发 click
 */
export const EDGE_SWIPE_SURFACES = '.handle, canvas.view, .cardwrap, .mini';

/** 触摸在 x（视口坐标）起手、视口宽 width：是不是边缘起手 */
export function inEdgeZone(x: number, width: number, zone = EDGE_SWIPE_ZONE): boolean {
  return x < zone || x > width - zone;
}

/** 这次 touchstart 要不要拦下默认行为：有新按下的手指在屏幕左右边缘起手，且落在自己处理手指的界面上 */
export function blocksEdgeSwipe(e: { changedTouches: ArrayLike<{ clientX: number; target: EventTarget | null }> }, width: number): boolean {
  for (let i = 0; i < e.changedTouches.length; i++) {
    const t = e.changedTouches[i];
    if (!inEdgeZone(t.clientX, width)) continue;
    const el = t.target as { closest?: (sel: string) => unknown } | null;
    if (el?.closest?.(EDGE_SWIPE_SURFACES)) return true;
  }
  return false;
}
