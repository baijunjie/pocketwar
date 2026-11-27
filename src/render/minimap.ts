/** 小地图（Canvas 2D） */
import { SITE_CITY, SITE_INFO } from '../sim/defs';
import { O_AMOVE, O_ATTACK, O_MOVE, S_ROUT } from '../sim/state';
import { World } from '../sim/world';

export class Minimap {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly base: HTMLCanvasElement;
  private readonly fogCv: HTMLCanvasElement;
  private readonly fogCtx: CanvasRenderingContext2D;
  private readonly fogImg: ImageData;
  private size: number;
  private dpr = 1;
  pings: { x: number; y: number; t: number; color: string }[] = [];
  /** 镜头的水平转角：小地图跟着转，屏幕的「上」就是小地图的「上」 */
  yaw = 0;
  /** 行进路线虚线的流动相位 */
  private flow = 0;
  private readonly routes = new Map<number, { sx: number; sy: number; n: number; dx: number; dy: number; amove: boolean }>();

  constructor(readonly canvas: HTMLCanvasElement, private readonly world: World, miniColors: Uint8ClampedArray,
    private readonly colors: string[]) {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.size = canvas.clientWidth || 220;
    canvas.width = canvas.height = this.size * this.dpr;
    this.ctx = canvas.getContext('2d')!;
    this.ctx.scale(this.dpr, this.dpr);
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

  /** 画布的显示尺寸变了（移动版里它按下半屏剩下的空间放大）：按新尺寸重设画布分辨率 */
  resize(): void {
    const s = this.canvas.clientWidth;
    if (!s || s === this.size) return;
    this.size = s;
    this.canvas.width = this.canvas.height = s * this.dpr;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
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
      const r = s.type === SITE_CITY ? 5 : 4;
      const cat = SITE_INFO[s.type].category;
      c.fillStyle = this.colors[s.owner];
      c.strokeStyle = cat === 'resource' ? '#ffe08a' : '#fff';
      c.lineWidth = 1.2;
      c.beginPath();
      if (cat === 'city') c.rect(x - r, y - r, r * 2, r * 2);
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
    this.drawWeather();
    this.drawWind();
  }

  /**
   * 圆外空角里的角标底圆（right：右上角，否则左上角），画完把原点挪到圆心并缩放到半径 13 的坐标，接着按这个尺度画图标（调用方负责 save / restore）。
   * 角上的空地沿对角线只有半径的 √2−1 倍：小地图小时角标跟着缩小、往角里收，不压到地图圆面上
   */
  private cornerBadge(right: boolean, fill = 'rgba(12, 10, 8, 0.78)'): void {
    const c = this.ctx, S = this.size;
    // 角标外沿离角落（沿对角线）不超过空地减 1px：(r + 2)·√2 + r ≤ (√2 − 1)·S/2 − 1
    const r = Math.max(6, Math.min(13, ((Math.SQRT2 - 1) * (S / 2) - 1 - 2 * Math.SQRT2) / (Math.SQRT2 + 1)));
    const off = r + 2, cx = right ? S - off : off;
    c.fillStyle = fill;
    c.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    c.lineWidth = 1;
    c.beginPath();
    c.arc(cx, off, r, 0, Math.PI * 2);
    c.fill();
    c.stroke();
    c.translate(cx, off);
    c.scale(r / 13, r / 13);
  }

  /** 左上角（圆外的空角）画天气：雪、雨、晴（白天太阳、夜里月亮），夜里底色偏蓝 */
  private drawWeather(): void {
    const env = this.world.env, c = this.ctx;
    c.save();
    this.cornerBadge(false, env.night ? 'rgba(28, 36, 72, 0.85)' : undefined);
    c.lineCap = 'round';
    if (env.snowing) {
      // 六瓣雪花
      c.strokeStyle = '#e6eef8';
      c.lineWidth = 1.6;
      c.beginPath();
      for (let i = 0; i < 3; i++) {
        const a = (i * Math.PI) / 3 + Math.PI / 2, dx = Math.cos(a) * 7, dy = Math.sin(a) * 7;
        c.moveTo(-dx, -dy);
        c.lineTo(dx, dy);
      }
      c.stroke();
    } else if (env.raining) {
      // 三道斜着落下的雨
      c.strokeStyle = '#a9c8ea';
      c.lineWidth = 1.8;
      c.beginPath();
      for (const x of [-5, 0, 5]) {
        const y = x === 0 ? -1 : 1;
        c.moveTo(x + 2, y - 5);
        c.lineTo(x - 2, y + 4);
      }
      c.stroke();
    } else if (env.night) {
      // 月牙：亮圆挖掉偏右上的一块（裁在亮圆以内，挖的那个圆伸出去的部分不画）
      c.fillStyle = '#e8e2c4';
      c.beginPath();
      c.arc(0, 0, 7, 0, Math.PI * 2);
      c.clip();
      c.beginPath();
      c.arc(0, 0, 7, 0, Math.PI * 2);
      c.arc(3.5, -2.5, 6, 0, Math.PI * 2);
      c.fill('evenodd');
    } else {
      // 太阳：圆心加一圈光芒
      c.fillStyle = c.strokeStyle = '#f0c64a';
      c.beginPath();
      c.arc(0, 0, 4, 0, Math.PI * 2);
      c.fill();
      c.lineWidth = 1.6;
      c.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4, cs = Math.cos(a), sn = Math.sin(a);
        c.moveTo(cs * 6.5, sn * 6.5);
        c.lineTo(cs * 9, sn * 9);
      }
      c.stroke();
    }
    c.restore();
  }

  /** 右上角（圆外的空角）画风向：箭头指向风吹去的方向，随小地图一起转；无风不画 */
  private drawWind(): void {
    const env = this.world.env, k = env.wind;
    if (k <= 0.02) return;
    const c = this.ctx;
    const a = env.windDir + this.yaw;
    c.save();
    this.cornerBadge(true);
    c.rotate(a);
    // 风越大箭头越长、越亮
    const len = 5 + k * 4;
    c.strokeStyle = c.fillStyle = k < 0.45 ? '#cfe6ff' : k < 0.75 ? '#ffe08a' : '#ff9a6a';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(-len, 0);
    c.lineTo(len - 3, 0);
    c.stroke();
    c.beginPath();
    c.moveTo(len + 2, 0);
    c.lineTo(len - 4, -4);
    c.lineTo(len - 4, 4);
    c.closePath();
    c.fill();
    c.restore();
  }

  /** 编队从队列最前排画一条；不在编队里的按目的地归堆，从这一堆人的重心画起 */
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
