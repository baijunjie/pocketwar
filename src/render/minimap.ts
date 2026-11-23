/** 小地图（Canvas 2D） */
import { World } from '../sim/world';

export class Minimap {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly base: HTMLCanvasElement;
  private readonly fogCv: HTMLCanvasElement;
  private readonly fogCtx: CanvasRenderingContext2D;
  private readonly fogImg: ImageData;
  private readonly size: number;
  pings: { x: number; y: number; t: number; color: string }[] = [];

  constructor(readonly canvas: HTMLCanvasElement, private readonly world: World, miniColors: Uint8ClampedArray,
    private readonly colors: string[]) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.size = canvas.clientWidth || 220;
    canvas.width = canvas.height = this.size * dpr;
    this.ctx = canvas.getContext('2d')!;
    this.ctx.scale(dpr, dpr);
    const map = world.map;
    this.base = document.createElement('canvas');
    this.base.width = map.w;
    this.base.height = map.h;
    this.base.getContext('2d')!.putImageData(new ImageData(miniColors as Uint8ClampedArray<ArrayBuffer>, map.w, map.h), 0, 0);
    this.fogCv = document.createElement('canvas');
    this.fogCv.width = world.vw;
    this.fogCv.height = world.vh;
    this.fogCtx = this.fogCv.getContext('2d')!;
    this.fogImg = this.fogCtx.createImageData(world.vw, world.vh);
  }

  /** 小地图上的像素位置 → 世界坐标 */
  toWorld(mx: number, my: number): { x: number; y: number } {
    return { x: (mx / this.size) * this.world.W, y: (my / this.size) * this.world.H };
  }

  /** @param view 屏幕四角落在地面上的位置 */
  draw(view: { x: number; y: number }[], dt: number): void {
    const c = this.ctx, w = this.world, S = this.size;
    const k = S / w.W;
    c.imageSmoothingEnabled = true;
    c.drawImage(this.base, 0, 0, S, S);
    // 建筑
    const fog = w.fog && w.humanTeam !== 0;
    for (const b of w.buildings) {
      if (!b.alive || (fog && !w.isExplored(b.cx, b.cy))) continue;
      c.fillStyle = b.owner ? this.colors[b.owner] : '#3c3830';
      c.globalAlpha = b.def.kind <= 2 ? 0.9 : 0.6;
      c.fillRect(b.x0 * k, b.y0 * k, Math.max(1, b.w * 32 * k), Math.max(1, b.h * 32 * k));
    }
    c.globalAlpha = 1;
    // 迷雾
    if (fog) {
      const d = this.fogImg.data, vis = w.vis, ex = w.explored;
      for (let i = 0; i < vis.length; i++) {
        d[i * 4] = 6;
        d[i * 4 + 1] = 8;
        d[i * 4 + 2] = 12;
        d[i * 4 + 3] = vis[i] ? 0 : ex[i] ? 100 : 165;
      }
      this.fogCtx.putImageData(this.fogImg, 0, 0);
      c.drawImage(this.fogCv, 0, 0, S, S);
    }
    // 单位
    const human = w.humanTeam;
    for (let tm = 2; tm >= 1; tm--) {
      c.fillStyle = this.colors[tm];
      for (let i = 0; i < w.n; i++) {
        if (!w.alive[i] || w.team[i] !== tm) continue;
        if (fog && tm !== human && !w.unitVisible(i)) continue;
        c.fillRect(w.x[i] * k - 1, w.y[i] * k - 1, 2, 2);
      }
    }
    // 据点
    for (const s of w.sites) {
      const x = s.x * k, y = s.y * k;
      const r = s.type <= 1 ? 5 : 4;
      c.fillStyle = s.disabled ? '#444' : this.colors[s.owner];
      c.strokeStyle = '#fff';
      c.lineWidth = 1.2;
      c.beginPath();
      if (s.type <= 2) c.rect(x - r, y - r, r * 2, r * 2);
      else {
        c.moveTo(x, y - r - 1);
        c.lineTo(x + r + 1, y);
        c.lineTo(x, y + r + 1);
        c.lineTo(x - r - 1, y);
        c.closePath();
      }
      c.fill();
      c.stroke();
    }
    // 提示
    for (let i = this.pings.length - 1; i >= 0; i--) {
      const p = this.pings[i];
      p.t += dt;
      if (p.t > 3) {
        this.pings.splice(i, 1);
        continue;
      }
      const ph = (p.t * 1.5) % 1;
      c.strokeStyle = p.color;
      c.globalAlpha = 1 - ph;
      c.lineWidth = 2;
      c.beginPath();
      c.arc(p.x * k, p.y * k, 4 + ph * 12, 0, Math.PI * 2);
      c.stroke();
      c.globalAlpha = 1;
    }
    // 视野框
    c.strokeStyle = '#fff';
    c.lineWidth = 1.2;
    c.save();
    c.beginPath();
    c.rect(0, 0, S, S);
    c.clip();
    c.beginPath();
    view.forEach((p, i) => (i ? c.lineTo(p.x * k, p.y * k) : c.moveTo(p.x * k, p.y * k)));
    c.closePath();
    c.stroke();
    c.restore();
  }
}
