/** 战略 AI：把部队编成若干战斗群，争夺据点、回防、时机成熟后总攻敌方主堡 */
import { SITE_HQ, SITE_INFO } from '../content';
import { O_ATTACK, S_ROUT } from '../state';
import type { Site, World } from '../world';
import { Commander } from './commander';

const M_IDLE = 0, M_MARCH = 1, M_DEFEND = 2, M_ASSAULT = 3, M_RETREAT = 4;

interface Group {
  id: number;
  slots: number[];
  uids: number[];
  mode: number;
  obj: number;
  power: number;
  power0: number;
  cx: number;
  cy: number;
  lastOrder: number;
  guard: boolean;
  ax: number;
  ay: number;
}

export class StrategicAI implements Commander {
  groups: Group[] = [];
  private pool: number[] = [];
  private poolUid: number[] = [];
  private poolSince = 0;
  private nextThink = 0;
  private gid = 1;
  private enemies: number[] = [];

  /** @param level 0 简单 1 普通 2 困难 */
  constructor(readonly w: World, readonly team: number, readonly level: number) {
    this.nextThink = 30 + team * 7;
  }

  addGroup(slots: number[], guard: boolean): void {
    if (!slots.length) return;
    const w = this.w;
    let cx = 0, cy = 0;
    for (const s of slots) {
      cx += w.x[s];
      cy += w.y[s];
    }
    cx /= slots.length;
    cy /= slots.length;
    this.groups.push({
      id: this.gid++, slots: slots.slice(), uids: slots.map(s => w.uid[s]), mode: M_IDLE, obj: -1,
      power: 0, power0: 0, cx, cy, lastOrder: -9999, guard, ax: cx, ay: cy,
    });
  }

  /** 新到的援军先进待命池，攒够一队再出发 */
  addReinforcements(slots: number[]): void {
    if (!this.pool.length) this.poolSince = this.w.tickCount;
    for (const s of slots) {
      this.pool.push(s);
      this.poolUid.push(this.w.uid[s]);
    }
  }

  update(): void {
    if (this.w.tickCount < this.nextThink || this.w.winner) return;
    this.nextThink = this.w.tickCount + [75, 45, 30][this.level];
    this.think();
  }

  private enemyNear(px: number, py: number, r: number): number {
    const w = this.w;
    let p = 0;
    const r2 = r * r;
    for (const j of this.enemies) {
      const dx = w.x[j] - px, dy = w.y[j] - py;
      if (dx * dx + dy * dy < r2) p += w.defs[w.type[j]].power;
    }
    return p;
  }

  private enemyCentroid(px: number, py: number, r: number): { x: number; y: number } | null {
    const w = this.w;
    let sx = 0, sy = 0, n = 0;
    const r2 = r * r;
    for (const j of this.enemies) {
      const dx = w.x[j] - px, dy = w.y[j] - py;
      if (dx * dx + dy * dy < r2) {
        sx += w.x[j];
        sy += w.y[j];
        n++;
      }
    }
    return n ? { x: sx / n, y: sy / n } : null;
  }

  private think(): void {
    const w = this.w, tm = this.team, en = 3 - tm, tick = w.tickCount;
    // ---- 整理编组 ----
    for (const g of this.groups) {
      let k = 0, live = 0, cx = 0, cy = 0, p = 0;
      for (let m = 0; m < g.slots.length; m++) {
        const s = g.slots[m];
        if (!w.alive[s] || w.uid[s] !== g.uids[m]) continue;
        g.slots[k] = s;
        g.uids[k++] = g.uids[m];
        // 溃兵暂时指挥不动：留在编组里，但不计入战力与位置
        if (w.state[s] & S_ROUT) continue;
        live++;
        cx += w.x[s];
        cy += w.y[s];
        p += w.defs[w.type[s]].power;
      }
      g.slots.length = g.uids.length = k;
      k = live;
      if (k) {
        g.cx = cx / k;
        g.cy = cy / k;
      }
      g.power = p;
      if (g.power0 < p) g.power0 = p;
    }
    this.groups = this.groups.filter(g => g.slots.length > 0);
    {
      let k = 0;
      for (let m = 0; m < this.pool.length; m++) {
        const s = this.pool[m];
        if (!w.alive[s] || w.uid[s] !== this.poolUid[m]) continue;
        this.pool[k] = s;
        this.poolUid[k++] = this.poolUid[m];
      }
      this.pool.length = this.poolUid.length = k;
      if (k >= 24 || (k > 0 && tick - this.poolSince > 30 * 40)) {
        this.addGroup(this.pool, false);
        this.pool = [];
        this.poolUid = [];
      }
    }
    // 残部并入最近的野战群
    const field = this.groups.filter(g => !g.guard);
    for (const g of field) {
      if (g.slots.length >= 8 || field.length < 2) continue;
      let best: Group | null = null, bd = 1e18;
      for (const o of field) {
        if (o === g || o.slots.length < 8) continue;
        const d = (o.cx - g.cx) ** 2 + (o.cy - g.cy) ** 2;
        if (d < bd) {
          bd = d;
          best = o;
        }
      }
      if (best) {
        best.slots.push(...g.slots);
        best.uids.push(...g.uids);
        best.lastOrder = -9999;
        g.slots.length = 0;
      }
    }
    this.groups = this.groups.filter(g => g.slots.length > 0);

    // ---- 敌情 ----
    this.enemies.length = 0;
    let enTotal = 0, myTotal = 0;
    for (let i = 0; i < w.n; i++) {
      if (!w.alive[i] || w.state[i] & S_ROUT) continue;
      const p = w.defs[w.type[i]].power;
      if (w.team[i] === en) {
        this.enemies.push(i);
        enTotal += p;
      } else myTotal += p;
    }
    const hq = w.sites.find(s => s.type === SITE_HQ && s.owner === tm)!;
    const ehq = w.sites.find(s => s.type === SITE_HQ && s.owner === en)!;
    const hqThreat = this.enemyNear(hq.x, hq.y, 760);
    const assigned = new Map<number, number>();
    for (const g of this.groups) if (g.mode === M_MARCH || g.mode === M_DEFEND) assigned.set(g.obj, (assigned.get(g.obj) ?? 0) + g.power);
    const capturable = w.sites.filter(s => s.type !== SITE_HQ && s.owner !== tm);
    const assaultReady = capturable.length === 0 || myTotal > enTotal * [1.6, 1.25, 1.05][this.level]
      || w.time > [900, 600, 420][this.level];

    for (const g of this.groups) {
      if (g.guard) {
        // 守备队：敌军逼近则出击，否则回到岗位
        const c = this.enemyCentroid(g.ax, g.ay, 620);
        if (c) {
          if (tick - g.lastOrder > 150) {
            w.orderMove(g.slots, c.x, c.y, true);
            g.lastOrder = tick;
            g.mode = M_DEFEND;
          }
        } else if (g.mode === M_DEFEND) {
          w.orderMove(g.slots, g.ax, g.ay, true);
          g.mode = M_IDLE;
        }
        continue;
      }
      const near = this.enemyNear(g.cx, g.cy, 460);
      if (g.mode === M_RETREAT) {
        if ((g.cx - hq.x) ** 2 + (g.cy - hq.y) ** 2 < 520 * 520) {
          this.addReinforcements(g.slots);
          g.slots.length = 0;
        } else if (tick - g.lastOrder > 300) {
          w.orderMove(g.slots, hq.x, hq.y + 60, false);
          g.lastOrder = tick;
        }
        continue;
      }
      if (g.power < g.power0 * 0.3 && near > g.power * 1.2 && g.mode !== M_DEFEND) {
        g.mode = M_RETREAT;
        w.orderMove(g.slots, hq.x, hq.y + 60, false);
        g.lastOrder = tick;
        continue;
      }
      // 回防大本营
      if (hqThreat > 5 && g.mode !== M_DEFEND && (g.cx - hq.x) ** 2 + (g.cy - hq.y) ** 2 < 3400 * 3400) {
        g.mode = M_DEFEND;
        g.obj = hq.id;
        g.lastOrder = -9999;
      }
      if (g.mode === M_DEFEND) {
        const s = w.sites[g.obj];
        const c = this.enemyCentroid(s.x, s.y, 760);
        if (!c) g.mode = M_IDLE;
        else if (tick - g.lastOrder > 240) {
          w.orderMove(g.slots, c.x, c.y, true);
          g.lastOrder = tick;
        }
        if (g.mode === M_DEFEND) continue;
      }
      if (g.mode === M_MARCH) {
        const s = w.sites[g.obj];
        if (s.owner === tm) g.mode = M_IDLE;
      }
      if (g.mode === M_IDLE) this.choose(g, capturable, assigned, assaultReady);
      if (g.mode === M_MARCH && tick - g.lastOrder > 30 * 16) {
        const s = w.sites[g.obj];
        w.orderMove(g.slots, s.x, s.y + 24, true);
        g.lastOrder = tick;
      } else if (g.mode === M_ASSAULT) {
        const keep = w.buildings[ehq.main];
        const d2 = (g.cx - keep.cx) ** 2 + (g.cy - keep.cy) ** 2;
        if (tick - g.lastOrder > 30 * 14) {
          g.lastOrder = tick;
          if (d2 < 420 * 420 && keep.alive && this.enemyNear(keep.cx, keep.cy, 320) < g.power * 0.6) {
            // 兵临城下：近战与器械直取主堡，远程继续清剿
            const hitters = g.slots.filter(s => {
              const d = w.defs[w.type[s]];
              return d.range === 0 || d.vsBld >= 2;
            });
            w.orderAttackBuilding(hitters, keep);
            const rest = g.slots.filter(s => w.order[s] !== O_ATTACK);
            if (rest.length) w.orderMove(rest, ehq.x, ehq.y + 24, true);
          } else w.orderMove(g.slots, ehq.x, ehq.y + 24, true);
        }
      }
    }
    this.groups = this.groups.filter(g => g.slots.length > 0);
  }

  private choose(g: Group, capturable: Site[], assigned: Map<number, number>, assaultReady: boolean): void {
    const w = this.w, tm = this.team, en = 3 - tm;
    if (assaultReady && (g.id % 3 !== 0 || capturable.length === 0)) {
      g.mode = M_ASSAULT;
      g.obj = -1;
      g.lastOrder = -9999;
      return;
    }
    const hungry = w.upkeep0[tm] > 0 && w.foodIn[tm] < w.foodOut[tm];
    let best: Site | null = null, bs = 0, defend = false;
    // 己方据点遭袭
    for (const s of w.sites) {
      if (s.owner !== tm || s.type === SITE_HQ || s.disabled || s.count[en] === 0) continue;
      const threat = this.enemyNear(s.x, s.y, 520);
      if (g.power < threat * 0.5 || (assigned.get(s.id) ?? 0) > threat * 1.5) continue;
      const sc = (SITE_INFO[s.type].value * 1.6) / (500 + Math.hypot(s.x - g.cx, s.y - g.cy));
      if (sc > bs) {
        bs = sc;
        best = s;
        defend = true;
      }
    }
    for (const s of capturable) {
      const def = this.enemyNear(s.x, s.y, 520);
      const dist = Math.hypot(s.x - g.cx, s.y - g.cy);
      // 缺粮时更看重产粮多的据点
      let sc = (SITE_INFO[s.type].value + (hungry ? SITE_INFO[s.type].food / 8 : 0)) / (600 + dist);
      if (def > g.power * 0.8) sc *= 0.3;
      if (assigned.has(s.id) && assigned.get(s.id)! > def * 1.2 + 2) sc *= 0.25;
      if (s.owner === en) sc *= 1.15;
      if (sc > bs) {
        bs = sc;
        best = s;
        defend = false;
      }
    }
    if (!best) {
      g.mode = M_ASSAULT;
      g.lastOrder = -9999;
      return;
    }
    g.mode = defend ? M_DEFEND : M_MARCH;
    g.obj = best.id;
    g.lastOrder = -9999;
    assigned.set(best.id, (assigned.get(best.id) ?? 0) + g.power);
  }
}
