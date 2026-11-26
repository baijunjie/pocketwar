/**
 * 镜头输入的纯判定：边缘卷屏的速度、鼠标从哪条边离开网页、滚轮事件来自鼠标滚轮还是触控板。
 * 不碰 DOM 状态，便于单元测试；由 `game.ts` 接到事件上。
 */

/** 离屏幕边缘多少像素以内开始卷屏：只认最外沿，贴边的面板留出的边框加内边距不小于它，按钮不会被卷屏抢走 */
export const EDGE_ZONE = 6;

/**
 * 鼠标离开网页时，最后的位置离边缘多少像素以内算「从这条边出去」：
 * 鼠标甩得快时，离开前最后一次 pointermove 可能还在离边几十像素处
 */
export const EXIT_BAND = 64;

/** 一个方向上的卷屏速度系数（0～1）：v 是鼠标到这条边的距离，贴边或越过边是 1，到卷屏区内侧降到 0.5 */
export function edgeSpeed(v: number, zone = EDGE_ZONE): number {
  if (v >= zone) return 0;
  return 0.5 + 0.5 * (1 - Math.max(0, v) / zone);
}

/**
 * 鼠标离开网页时往哪个方向续卷（-1 / 0 / 1）。一条轴算「从这条边出去」：最后位置在卷屏区以内（贴着边滑出去时，
 * 最后一次移动可能只沿着边），或在 band 以内且最后一次移动严格朝着这条边（甩得快时最后一次 pointermove 离边还有几十像素）。
 * 两条轴都算时，只有都在卷屏区以内（真正从角上出去）才两轴都续，否则只留离边更近的那条：
 * 往上冲进左上角的标签栏时，横向的一点抖动不该带着镜头斜着往左卷。都不沾（比如从中间切到别的窗口）返回 null。
 */
export function exitDirection(x: number, y: number, mx: number, my: number, w: number, h: number,
  band = EXIT_BAND, zone = EDGE_ZONE): { dx: number; dy: number } | null {
  const axis = (p: number, m: number, size: number): { dir: number; gap: number } => {
    const lo = p, hi = size - 1 - p;
    if (lo < zone || (lo <= band && m < 0)) return { dir: -1, gap: lo };
    if (hi < zone || (hi <= band && m > 0)) return { dir: 1, gap: hi };
    return { dir: 0, gap: Infinity };
  };
  const ax = axis(x, mx, w), ay = axis(y, my, h);
  if (!ax.dir && !ay.dir) return null;
  if (ax.dir && ay.dir && !(ax.gap < zone && ay.gap < zone)) {
    return ax.gap <= ay.gap ? { dx: ax.dir, dy: 0 } : { dx: 0, dy: ay.dir };
  }
  return { dx: ax.dir, dy: ay.dir };
}

/** 滚轮 / 双指滑动怎么解释：auto 按事件特征自动判断，trackpad 一律当触控板，mouse 一律当鼠标滚轮 */
export type WheelMode = 'auto' | 'trackpad' | 'mouse';

/** 存下来的字符串还原成滚轮模式：没存过或不认识的按自动 */
export function asWheelMode(v: string | null): WheelMode {
  return v === 'trackpad' || v === 'mouse' ? v : 'auto';
}

/** 判定 wheel 事件用到的字段（`wheelDeltaY` 是非标准字段，Chrome 与 Safari 有） */
export interface WheelSample {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  wheelDeltaY?: number;
}

/**
 * 单个 wheel 事件像不像触控板。网页拿不到设备类型，只能按特征猜：
 * - 按行 / 按页计量（deltaMode ≠ 0，Firefox 的鼠标滚轮）是鼠标；
 * - 带横向分量的是触控板（鼠标滚轮只有竖向，Shift+滚轮被浏览器转成横向的除外，那时误判成平移也无妨）；
 * - Chrome、Safari 上触控板的 wheelDeltaY 恰好是 −3 × deltaY，鼠标滚轮不是（一格固定 ±120）；
 * - 没有 wheelDeltaY 的浏览器：带小数且幅度小的是触控板，滚轮一格的幅度大（几十到一百多像素）。
 */
export function looksLikeTrackpad(e: WheelSample): boolean {
  if (e.deltaMode !== 0) return false;
  if (e.deltaX !== 0) return true;
  if (e.deltaY === 0) return false;
  if (e.wheelDeltaY !== undefined && e.wheelDeltaY !== 0) return e.wheelDeltaY === -3 * e.deltaY;
  return !Number.isInteger(e.deltaY) && Math.abs(e.deltaY) < 50;
}

/** 两次 wheel 事件隔多久以上算新的一串（一次滑动连同惯性是一串） */
export const WHEEL_BURST_GAP = 0.3;

/**
 * 自动模式下的判定：同一串 wheel 事件按头一个事件定性，串中途出现触控板特征（如横向分量）就改判为触控板，
 * 不会改回鼠标：免得惯性滚动的尾巴被误判，一串里平移、缩放来回跳。
 */
export class WheelClassifier {
  private last = -Infinity;
  private pad = false;

  /** now 单位为秒 */
  classify(e: WheelSample, mode: WheelMode, now: number): 'trackpad' | 'mouse' {
    if (mode !== 'auto') return mode;
    const fresh = now - this.last > WHEEL_BURST_GAP;
    this.last = now;
    const pad = looksLikeTrackpad(e);
    if (fresh) this.pad = pad;
    else if (pad) this.pad = true;
    return this.pad ? 'trackpad' : 'mouse';
  }
}
