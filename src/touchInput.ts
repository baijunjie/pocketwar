/**
 * 触屏输入的纯判定，不碰 DOM：移动版界面何时启用、画面上单指 / 双指手势的分类（`TouchGestures`）、
 * 卡片带上起手的方向判定、拖卡片时落点相对手指的偏移、摇杆的读数、小地图圆内的判定、抽屉的滑动方向。
 * 由 `game.ts`、`hud.ts`、`ui/cardBar.ts`、`ui/joystick.ts` 接到事件上。
 */

/** 「界面」设置：自动按设备判断，桌面 / 移动是手动指定（在电脑上调试移动版用） */
export type UiMode = 'auto' | 'desktop' | 'mobile';

export function asUiMode(v: string | null): UiMode {
  return v === 'desktop' || v === 'mobile' ? v : 'auto';
}

/** auto：主要指针是触屏且竖屏（`matchMedia('(pointer: coarse) and (orientation: portrait)')` 为真）时用移动版 */
export function isMobileUi(mode: UiMode, coarsePortrait: boolean): boolean {
  return mode === 'auto' ? coarsePortrait : mode === 'mobile';
}

/** 手指按下后移动不超过这么多像素仍算「没动」（手指按在屏幕上总会有点抖） */
export const TAP_SLOP = 10;
/** 长按：按住不动这么久（毫秒）算长按 */
export const HOLD_MS = 500;
/** 卡片带上起手：位移超过这么多像素才判方向 */
export const CARD_SLOP = 8;
/** 卡片带上起手：横向位移超过竖向的这么多倍才算滚动卡片带（约 34° 以内的横滑），其余都算拖卡片 */
export const CARD_SCROLL_BIAS = 1.5;
/** 拖卡片时落点（剑尖）离手指这么多像素：手指上方立着卡片，剑尖要从卡片顶上再伸出去一截 */
export const DROP_REACH = 100;
/** 拖卡片时手指离屏幕底这么多像素以内，剑开始向小地图那一侧放倒 */
export const DROP_TURN_BAND = 150;
/** 拖卡片时手指离按下处这么多像素以上，松手才下令：剑一出来剑尖就在画面里，起手就松开（没按准的一下点按）不该变成命令 */
export const DROP_ARM = 28;
/** 摇杆的死区：推出不到半径的这个比例不算推（手指按上去总会偏一点） */
export const STICK_DEAD = 0.12;
/** 摇杆读数对推出距离的幂：大于 1 时中段偏慢，小幅度推好微调 */
export const STICK_CURVE = 1.5;
/** 抽屉里 / 把手上横向滑出这么多像素算一次滑动 */
export const SWIPE_MIN = 28;

export interface Pt {
  x: number;
  y: number;
}

/** 双指从 (a0, b0) 移到 (a1, b1)：缩放倍数、转角（弧度，屏幕上顺时针为正）、前后两个中点 */
export interface Pinch {
  scale: number;
  turn: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function pinchOf(a0: Pt, b0: Pt, a1: Pt, b1: Pt): Pinch {
  const d0 = Math.hypot(b0.x - a0.x, b0.y - a0.y), d1 = Math.hypot(b1.x - a1.x, b1.y - a1.y);
  let turn = Math.atan2(b1.y - a1.y, b1.x - a1.x) - Math.atan2(b0.y - a0.y, b0.x - a0.x);
  // 角度差折回 (−π, π]：两指连线转过 ±π 的分界线时不能当成转了一整圈
  turn -= Math.round(turn / (Math.PI * 2)) * Math.PI * 2;
  return {
    // 两指几乎重合时距离不稳，不缩放
    scale: d0 < 1 || d1 < 1 ? 1 : d1 / d0,
    turn: d0 < 1 || d1 < 1 ? 0 : turn,
    x0: (a0.x + b0.x) / 2, y0: (a0.y + b0.y) / 2, x1: (a1.x + b1.x) / 2, y1: (a1.y + b1.y) / 2,
  };
}

/**
 * 卡片带上按住卡片后的起手方向：位移还没到 slop 是 wait；到了以后横向明显占主导（超过竖向的 bias 倍）是 scroll（横向滚动卡片带），
 * 否则是 drag（拖卡片下令）。偏向 drag：拇指往上拖多半是斜着起手的，判成滚动卡片就不跟手；
 * 判成 scroll 之后手指竖向离开了卡片带，由调用方改判为 drag
 */
export function cardIntent(dx: number, dy: number, slop = CARD_SLOP, bias = CARD_SCROLL_BIAS): 'wait' | 'drag' | 'scroll' {
  if (Math.hypot(dx, dy) < slop) return 'wait';
  return Math.abs(dx) > Math.abs(dy) * bias ? 'scroll' : 'drag';
}

/**
 * 拖卡片时落点（剑尖）相对手指的偏移：剑从手指伸出去 reach 像素，剑尖始终在手指外面看得见的地方，不贴回手指下。
 * 平时竖直朝上；手指进到屏幕底以上 band 像素以内时，剑随手指下移逐渐往 side 那一侧放倒（1 向右、−1 向左），到屏幕底时水平朝那一侧：
 * 手指够不到屏幕外，剑一直朝上的话贴着屏幕底的小地图下半截指不到。side 取小地图所在的一侧，手指落在另一侧的摇杆一带，
 * 整张小地图都指得到
 */
export function dropOffset(y: number, bottom: number, side: 1 | -1 = 1, reach = DROP_REACH, band = DROP_TURN_BAND): Pt {
  const turn = band > 0 ? Math.max(0, Math.min(1, (band - (bottom - y)) / band)) : 0;
  const a = (turn * Math.PI) / 2;
  return { x: side * reach * Math.sin(a), y: -reach * Math.cos(a) };
}

/**
 * 摇杆读数：手指相对摇杆中心偏了 (dx, dy)，摇杆半径 radius。返回方向同偏移、长度 0～1 的向量：
 * 死区内是 0，推到半径处（及以外）是 1，中间按 curve 次幂上升
 */
export function stickVector(dx: number, dy: number, radius: number, dead = STICK_DEAD, curve = STICK_CURVE): Pt {
  const d = Math.hypot(dx, dy);
  const m = radius > 0 ? d / radius : 0;
  if (m <= dead) return { x: 0, y: 0 };
  const k = Math.min(1, (m - dead) / (1 - dead)) ** curve / d;
  return { x: dx * k, y: dy * k };
}

/**
 * 点 (x, y) 在不在矩形 r 的内切圆里。小地图的画布是方的、地图画成圆的（圆外的角上还画着风向标，不能把画布裁圆）：
 * 移动版里方形的四角紧挨着摇杆，手指落在圆外不该算点中小地图
 */
export function inInscribedCircle(x: number, y: number, r: { left: number; top: number; width: number; height: number }): boolean {
  return Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2)) <= Math.min(r.width, r.height) / 2;
}

/** 一次滑动的方向：横向或纵向占主导且位移够 min，否则 null */
export function swipeDir(dx: number, dy: number, min = SWIPE_MIN): 'left' | 'right' | 'up' | 'down' | null {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < min) return null;
  if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? 'left' : 'right';
  return dy < 0 ? 'up' : 'down';
}

export interface TouchHandlers {
  /** 点一下 */
  tap(x: number, y: number): void;
  /** 长按（按住没怎么动满 HOLD_MS） */
  hold(x: number, y: number): void;
  /** 单指拖动是不是框选（指令模式里拖动不框选，也不触发别的） */
  canBox(): boolean;
  /** 框选拖动中 / 结束：commit 为 false 是被打断（来了第二根手指、取消），不该选 */
  box(x0: number, y0: number, x1: number, y1: number, done: boolean, commit: boolean): void;
  /** 双指：两根手指每次移动 */
  pinch(p: Pinch): void;
}

type Phase = 'pending' | 'box' | 'idle';

/**
 * 画面上的手指手势：
 * 单指按下后没怎么动抬起是点；按住不动满 HOLD_MS 是长按；拖出 TAP_SLOP 是框选（指令模式里什么都不做）；
 * 来了第二根手指就转成双指缩放 / 旋转 / 平移，打断单指手势，并且直到全部手指抬起前不再触发单指手势（捏完剩一根手指不该变成点或框选）。
 * 坐标由调用方换算好（画布内）。
 */
export class TouchGestures {
  private readonly pts = new Map<number, Pt>();
  private phase: Phase = 'idle';
  private start: Pt = { x: 0, y: 0 };
  /** 本轮出现过第二根手指：直到全部抬起才算下一轮 */
  private multi = false;
  private pair: [number, number] | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly h: TouchHandlers, private readonly slop = TAP_SLOP, private readonly holdMs = HOLD_MS) {}

  down(id: number, x: number, y: number): void {
    this.pts.set(id, { x, y });
    if (this.pts.size === 1 && !this.multi) {
      this.phase = 'pending';
      this.start = { x, y };
      this.clearTimer();
      this.timer = setTimeout(() => {
        this.timer = null;
        const p = this.pts.get(id);
        if (this.phase !== 'pending' || !p) return;
        this.phase = 'idle';
        this.h.hold(p.x, p.y);
      }, this.holdMs);
    } else if (this.pts.size >= 2 && !this.pair) {
      this.interrupt();
      this.multi = true;
      const [a, b] = [...this.pts.keys()];
      this.pair = [a, b];
    }
  }

  move(id: number, x: number, y: number): void {
    const p = this.pts.get(id);
    if (!p) return;
    const old = { x: p.x, y: p.y };
    p.x = x;
    p.y = y;
    if (this.pair) {
      const [ia, ib] = this.pair;
      if (id !== ia && id !== ib) return;
      const a = this.pts.get(ia), b = this.pts.get(ib);
      if (!a || !b) return;
      const prevA = id === ia ? old : a, prevB = id === ib ? old : b;
      this.h.pinch(pinchOf(prevA, prevB, a, b));
      return;
    }
    if (this.multi) return;
    if (this.phase === 'pending' && Math.hypot(x - this.start.x, y - this.start.y) > this.slop) {
      this.clearTimer();
      this.phase = this.h.canBox() ? 'box' : 'idle';
    }
    if (this.phase === 'box') this.h.box(this.start.x, this.start.y, x, y, false, true);
  }

  up(id: number, x: number, y: number): void {
    const p = this.pts.get(id);
    if (!p) return;
    this.pts.delete(id);
    if (this.pts.size === 0) {
      const phase = this.phase;
      const solo = !this.multi;
      this.reset();
      if (!solo) return;
      if (phase === 'pending') this.h.tap(x, y);
      else if (phase === 'box') this.h.box(this.start.x, this.start.y, x, y, true, true);
    } else if (this.pair && (id === this.pair[0] || id === this.pair[1])) {
      // 双指里抬起一根：剩下的手指不再驱动缩放
      this.pair = null;
    }
  }

  /** 被系统打断（pointercancel、窗口失去焦点）：放弃手上的手势，不触发点与框选 */
  cancel(): void {
    this.interrupt();
    this.reset();
    this.pts.clear();
  }

  /** 打断单指手势：收起拖动中的框，长按计时作废 */
  private interrupt(): void {
    this.clearTimer();
    if (this.phase === 'box') this.h.box(this.start.x, this.start.y, this.start.x, this.start.y, true, false);
    this.phase = 'idle';
  }

  private reset(): void {
    this.clearTimer();
    this.phase = 'idle';
    this.multi = false;
    this.pair = null;
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
