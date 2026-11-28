/**
 * 移动版摇杆上方横着的缩放条：左端最远、右端最近，两端标着 − / +，中间是带滑块的长条。
 * 按在长条上（及按住拖动）滑块中心跟着手指，直接定到那个位置；点一下 − / + 缩小 / 放大一档。
 * 这里只管 DOM 与指针，读写的是缩放条上的位置（0～1，见 camInput 的 zoomToFrac），镜头怎么缩放由回调决定。
 */
import { TAP_SLOP } from '../touchInput';

/** 点一下 − / +、按一下方向键挪多少（整条是 1） */
const STEP = 0.125;

export class ZoomSlider {
  readonly el: HTMLDivElement;
  private readonly track: HTMLElement;
  private frac = 0;
  /** 按着的手指：在长条上按下的是拖滑块（drag），在两端的 − / + 上按下的是点按（step 为 ±STEP，手指滑开就归零作废） */
  private press: { id: number; x: number; y: number; drag: boolean; step: number } | null = null;

  /** onChange：玩家把位置改到了 f（0～1） */
  constructor(private readonly onChange: (f: number) => void) {
    const e = (this.el = document.createElement('div'));
    e.className = 'zoom';
    e.setAttribute('role', 'slider');
    e.setAttribute('aria-label', '缩放');
    e.setAttribute('aria-orientation', 'horizontal');
    e.setAttribute('aria-valuemin', '0');
    e.setAttribute('aria-valuemax', '100');
    e.tabIndex = 0;
    e.innerHTML = '<b aria-hidden="true">−</b><span class="ztrack"><i></i></span><b aria-hidden="true">+</b>';
    this.track = e.querySelector<HTMLElement>('.ztrack')!;

    e.addEventListener('pointerdown', ev => {
      if (ev.button !== 0 || this.press) return;
      const r = this.track.getBoundingClientRect();
      const step = ev.clientX < r.left ? -STEP : ev.clientX > r.right ? STEP : 0;
      this.press = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, drag: !step, step };
      e.setPointerCapture(ev.pointerId);
      // 按着哪一段就亮哪一段：长条（拖滑块）亮整条，− / + 只亮那一端，看得出这一下是跳档还是定位
      if (step) (step < 0 ? e.firstElementChild : e.lastElementChild)!.classList.add('down');
      else e.classList.add('on');
      if (this.press.drag) this.drag(ev.clientX);
      ev.preventDefault();
    });
    e.addEventListener('pointermove', ev => {
      const p = this.press;
      if (!p || ev.pointerId !== p.id) return;
      if (p.drag) this.drag(ev.clientX);
      else if (p.step && Math.hypot(ev.clientX - p.x, ev.clientY - p.y) > TAP_SLOP) {
        p.step = 0;
        this.clearDown();
      }
    });
    e.addEventListener('pointerup', ev => {
      const p = this.press;
      if (!p || ev.pointerId !== p.id) return;
      this.end();
      if (p.step) this.set(this.frac + p.step);
    });
    const cancel = (ev: PointerEvent): void => {
      if (this.press && ev.pointerId === this.press.id) this.end();
    };
    e.addEventListener('pointercancel', cancel);
    e.addEventListener('lostpointercapture', cancel);
    e.addEventListener('contextmenu', ev => ev.preventDefault());
    e.addEventListener('keydown', ev => {
      const d = ev.key === 'ArrowUp' || ev.key === 'ArrowRight' ? STEP : ev.key === 'ArrowDown' || ev.key === 'ArrowLeft' ? -STEP : 0;
      if (!d) return;
      // 不让方向键再落到游戏的卷屏上
      ev.stopPropagation();
      ev.preventDefault();
      this.set(this.frac + d);
    });
    this.show(0);
  }

  /** 每帧：镜头被别的方式缩放（双指、滚轮）后滑块跟上；按着的时候以手指为准 */
  sync(f: number): void {
    if (!this.press && Math.abs(f - this.frac) > 1e-4) this.show(f);
  }

  /** 放掉正按着的手指（不改位置、不回调）：切换桌面 / 移动布局时调（桌面版缩放条被隐藏），免得按着的手指收不到抬起 */
  release(): void {
    if (this.press) this.end();
  }

  private end(): void {
    this.press = null;
    this.el.classList.remove('on');
    this.clearDown();
  }

  private clearDown(): void {
    this.el.firstElementChild!.classList.remove('down');
    this.el.lastElementChild!.classList.remove('down');
  }

  /** 手指的横向位置换成缩放条上的位置：滑块中心对着手指，左端 0、右端 1 */
  private drag(x: number): void {
    const r = this.track.getBoundingClientRect(), k = (this.track.firstElementChild as HTMLElement).offsetWidth;
    const span = r.width - k;
    if (span > 0) this.set((x - r.left - k / 2) / span);
  }

  private set(f: number): void {
    this.show(Math.max(0, Math.min(1, f)));
    this.onChange(this.frac);
  }

  private show(f: number): void {
    this.frac = f;
    this.track.style.setProperty('--f', String(f));
    this.el.setAttribute('aria-valuenow', String(Math.round(f * 100)));
  }
}
