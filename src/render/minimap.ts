/** 小地图（Canvas 2D） */
import { SITE_INFO } from '../sim/defs';
import { O_AMOVE, O_ATTACK, O_MOVE, S_ROUT } from '../sim/state';
import { World } from '../sim/world';

export class Minimap {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly base: HTMLCanvasElement;
  private readonly fogCv: HTMLCanvasElement;
  private readonly fogCtx: CanvasRenderingContext2D;
  private readonly fogImg: ImageData;
  private readonly size: number;
  pings: { x: number; y: number; t: number; color: string }[] = [];
  /** 镜头的水平转角：小地图跟着转，屏幕的「上」就是小地图的「上」 */
  yaw = 0;
  /** 行进路线虚线的流动相位 */
  private flow = 0;
  private readonly routes = new Map<number, { sx: number; sy: number; n: number; dx: number; dy: number; amove: boolean }>();

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
    const S = this.size, h = S / 2;
    const cs = Math.cos(this.yaw), sn = Math.sin(this.yaw);
    // 把 draw() 里的「绕中心转 yaw」反过来
    const px = mx - h, py = my - h;
    const x = px * cs + py * sn + h, y = -px * sn + py * cs + h;
    const w = this.world;
    return { x: Math.min(w.W, Math.max(0, (x / S) * w.W)), y: Math.min(w.H, Math.max(0, (y / S) * w.H)) };
  }

  /** @param view 屏幕四角落在地面上的位置 */
  draw(view: { x: number; y: number }[], dt: number): void {
    const c = this.ctx, w = this.world, S = this.size;
    const k = S / w.W;
    c.imageSmoothingEnabled = true;
    c.clearRect(0, 0, S, S);
    c.save();
    // 圆形的小地图：随镜头旋转时不用缩小，四角落在圆外的部分裁掉
    c.beginPath();
    c.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
    c.clip();
    c.fillStyle = '#14110d';
    c.fillRect(0, 0, S, S);
    c.translate(S / 2, S / 2);
    c.rotate(this.yaw);
    c.translate(-S / 2, -S / 2);
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
    // 己方正在行进的部队：从部队到目的地一条流动的虚线
    this.drawRoutes(k, dt);
    // 据点
    for (const s of w.sites) {
      if (s.gone) continue;
      const x = s.x * k, y = s.y * k;
      const r = s.type <= 1 ? 5 : 4;
      const cat = SITE_INFO[s.type].category;
      c.fillStyle = s.disabled ? '#444' : this.colors[s.owner];
      c.strokeStyle = cat === 'resource' ? '#ffe08a' : '#fff';
      c.lineWidth = 1.2;
      c.beginPath();
      if (s.type <= 2) c.rect(x - r, y - r, r * 2, r * 2);
      // 资源点、临时据点：小圆点
      else if (cat === 'resource' || cat === 'outpost') c.arc(x, y, 3, 0, Math.PI * 2);
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
    view.forEach((p, i) => (i ? c.lineTo(p.x * k, p.y * k) : c.moveTo(p.x * k, p.y * k)));
    c.closePath();
    c.stroke();
    c.restore();
    c.restore();
  }

  /** 编队按领队画一条；不在编队里的按目的地归堆，从这一堆人的重心画起 */
  private drawRoutes(k: number, dt: number): void {
    const c = this.ctx, w = this.world, human = w.humanTeam;
    if (!human) return;
    const R = this.routes;
    R.clear();
    for (let i = 0; i < w.n; i++) {
      if (!w.alive[i] || w.team[i] !== human || w.state[i] & S_ROUT) continue;
      const o = w.order[i];
      if (o !== O_MOVE && o !== O_AMOVE && o !== O_ATTACK) continue;
      const gi = w.grp[i];
      let key: number, sx: number, sy: number, dx: number, dy: number;
      if (gi >= 0 && w.marches[gi].alive && !w.marches[gi].arrived) {
        const g = w.marches[gi];
        key = -1 - gi;
        sx = g.x; sy = g.y; dx = g.destX; dy = g.destY;
      } else {
        dx = w.destX[i]; dy = w.destY[i];
        key = Math.round(dx / 48) * 100003 + Math.round(dy / 48);
        sx = w.x[i]; sy = w.y[i];
      }
      const r = R.get(key);
      if (!r) R.set(key, { sx, sy, n: 1, dx, dy, amove: o !== O_MOVE });
      else if (key >= 0) { r.sx += sx; r.sy += sy; r.n++; }
    }
    if (!R.size) return;
    this.flow = (this.flow + dt * 24) % 1000;
    c.save();
    c.lineWidth = 1.4;
    c.setLineDash([4, 3]);
    c.lineDashOffset = -this.flow;
    for (const [key, r] of R) {
      const n = key >= 0 ? r.n : 1;
      const sx = (r.sx / n) * k, sy = (r.sy / n) * k, ex = r.dx * k, ey = r.dy * k;
      if ((ex - sx) ** 2 + (ey - sy) ** 2 < 9) continue;
      c.strokeStyle = r.amove ? 'rgba(255, 150, 110, 0.95)' : 'rgba(150, 255, 150, 0.95)';
      c.beginPath();
      c.moveTo(sx, sy);
      c.lineTo(ex, ey);
      c.stroke();
      c.fillStyle = c.strokeStyle;
      c.fillRect(ex - 1.5, ey - 1.5, 3, 3);
    }
    c.restore();
  }
}
