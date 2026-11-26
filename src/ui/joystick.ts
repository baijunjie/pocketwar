/**
 * 移动版的镜头摇杆：按住往哪边推，读数就指向哪边（屏幕方向），推得越远越大。
 * 这里只管 DOM 与指针，镜头怎么动由读它的一方决定。
 */
import { stickVector } from '../touchInput';

export class Joystick {
  readonly el: HTMLDivElement;
  /** 当前读数：屏幕方向（x 向右、y 向下为正），长度 0～1；没按着时是 0 */
  x = 0;
  y = 0;
  private readonly knob: HTMLElement;
  private id = -1;
  private readonly onBlur = (): void => this.reset();

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'joy';
    // 只能用手指推，读屏软件操作不了：镜头另有键盘与小地图可用
    this.el.setAttribute('aria-hidden', 'true');
    this.knob = document.createElement('i');
    this.el.appendChild(this.knob);
    this.el.addEventListener('pointerdown', e => {
      if (e.button !== 0 || this.id >= 0) return;
      this.id = e.pointerId;
      this.el.setPointerCapture(e.pointerId);
      this.el.classList.add('on');
      this.push(e);
      e.preventDefault();
    });
    this.el.addEventListener('pointermove', e => {
      if (e.pointerId === this.id) this.push(e);
    });
    const end = (e: PointerEvent): void => {
      if (e.pointerId === this.id) this.reset();
    };
    this.el.addEventListener('pointerup', end);
    this.el.addEventListener('pointercancel', end);
    this.el.addEventListener('lostpointercapture', end);
    this.el.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('blur', this.onBlur);
  }

  /** 松手回中：读数归零（切换界面、窗口失去焦点时也调） */
  reset(): void {
    this.id = -1;
    this.x = this.y = 0;
    this.el.classList.remove('on');
    this.knob.style.transform = '';
  }

  destroy(): void {
    window.removeEventListener('blur', this.onBlur);
  }

  private push(e: PointerEvent): void {
    const r = this.el.getBoundingClientRect();
    const radius = r.width / 2;
    const dx = e.clientX - (r.left + radius), dy = e.clientY - (r.top + r.height / 2);
    const v = stickVector(dx, dy, radius);
    this.x = v.x;
    this.y = v.y;
    // 摇杆头跟着手指，但不出底座：最远到自己贴着底座的边
    const reach = radius - this.knob.offsetWidth / 2, d = Math.hypot(dx, dy);
    const k = d > reach && d > 0 ? reach / d : 1;
    this.knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
  }
}
