/**
 * 让一个元素自己用 pointer 事件分辨「点一下」与「长按」，不靠手指触发的 click。
 * 给贴着屏幕边的触屏按钮用：边缘起手的触摸会被拦下默认行为（免得浏览器当成返回手势），那之后浏览器不再发 click。
 */
import { HOLD_MS, TAP_SLOP } from '../touchInput';

export interface PressHandlers {
  /** 按下后没怎么动就抬起 */
  tap(): void;
  /** 按住不动满 holdMs；不给就没有长按，按多久抬起都算点 */
  hold?(): void;
}

/** 按住期间元素带 `down` 类；元素 disabled 时不响应。返回解除绑定的函数 */
export function bindPress(el: HTMLElement, h: PressHandlers, holdMs = HOLD_MS, slop = TAP_SLOP): () => void {
  let press: { id: number; x: number; y: number } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const end = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    press = null;
    el.classList.remove('down');
  };
  const onDown = (e: PointerEvent): void => {
    if (press || e.button !== 0 || (el as HTMLButtonElement).disabled) return;
    press = { id: e.pointerId, x: e.clientX, y: e.clientY };
    el.classList.add('down');
    el.setPointerCapture(e.pointerId);
    if (h.hold) {
      timer = setTimeout(() => {
        timer = null;
        if (!press) return;
        end();
        h.hold!();
      }, holdMs);
    }
    e.preventDefault();
  };
  // 手指滑开了就不算点，也不算长按
  const onMove = (e: PointerEvent): void => {
    if (press && e.pointerId === press.id && Math.hypot(e.clientX - press.x, e.clientY - press.y) > slop) end();
  };
  const onUp = (e: PointerEvent): void => {
    if (!press || e.pointerId !== press.id) return;
    end();
    h.tap();
  };
  const onCancel = (e: PointerEvent): void => {
    if (press && e.pointerId === press.id) end();
  };
  // 键盘（Enter / 空格）与读屏软件的「激活」只发 click、不发 pointer 事件：detail 为 0 的 click 就是它们，当作点一下
  const onClick = (e: MouseEvent): void => {
    if (e.detail === 0 && !(el as HTMLButtonElement).disabled) h.tap();
  };
  // 触屏长按会弹系统菜单，时机正好与长按撞上
  const onMenu = (e: Event): void => e.preventDefault();
  el.addEventListener('click', onClick);
  el.addEventListener('contextmenu', onMenu);
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onCancel);
  el.addEventListener('lostpointercapture', onCancel);
  return () => {
    end();
    el.removeEventListener('click', onClick);
    el.removeEventListener('contextmenu', onMenu);
    el.removeEventListener('pointerdown', onDown);
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onCancel);
    el.removeEventListener('lostpointercapture', onCancel);
  };
}
