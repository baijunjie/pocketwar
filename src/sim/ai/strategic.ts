/** 战略 AI：把部队编成若干战斗群，争夺据点、回防、时机成熟后总攻敌方的城池与营寨 */
import { BR_MILITARY, RULES, SITE_INFO } from '../content';
import { O_ATTACK, S_ROUT } from '../state';
import type { Building, Site, World } from '../world';
import { canUpgradeSite, siteUpgradeCost, towerCount } from '../systems/economy';
import { siteGap } from '../siteArea';
import { Commander } from './commander';
import { pickCampUnit } from './picker';

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
  /** 正在拆的据点军事建筑；-1 = 没有 */
  bld: number;
  guard: boolean;
  ax: number;
  ay: number;
}

function nearestSite(list: Site[], x: number, y: number): Site | null {
  let best: Site | null = null, bd = 1e18;
  for (const s of list) {
    const d = (s.x - x) ** 2 + (s.y - y) ** 2;
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  return best;
}

export class StrategicAI implements Commander {
  groups: Group[] = [];
  private pool: number[] = [];
  private poolUid: number[] = [];
  private poolSince = 0;
  private nextThink = 0;
  private gid = 1;
  private enemies: number[] = [];
  /** 下一笔木材该拿去建哨塔（否则拿去升级营寨） */
  private towerTurn = true;

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
      power: 0, power0: 0, cx, cy, lastOrder: -9999, bld: -1, guard, ax: cx, ay: cy,
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

  pickCampUnit(site: Site): number {
    return pickCampUnit(this.w, this.team, site);
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

  /** 据点范围外 margin 以内的敌军战力（范围是围墙矩形或占领圈，见 siteArea.ts） */
  private enemyNearSite(s: Site, margin: number): number {
    const w = this.w;
    let p = 0;
    for (const j of this.enemies) if (siteGap(s, w.x[j], w.y[j]) < margin) p += w.defs[w.type[j]].power;
    return p;
  }

  /** 据点范围外 margin 以内敌军的重心 */
  private enemyCentroidSite(s: Site, margin: number): { x: number; y: number } | null {
    const w = this.w;
    let sx = 0, sy = 0, n = 0;
    for (const j of this.enemies) {
      if (siteGap(s, w.x[j], w.y[j]) >= margin) continue;
      sx += w.x[j];
      sy += w.y[j];
      n++;
    }
    return n ? { x: sx / n, y: sy / n } : null;
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
    // 撤退与回防以离战斗群最近的己方城池为锚点，没有城池时用最近的营寨
    const anchors = w.sites.filter(s => s.owner === tm && !s.gone && SITE_INFO[s.type].counts);
    const cities = anchors.filter(s => SITE_INFO[s.type].category === 'city');
    const homes = cities.length ? cities : anchors;
    // 总攻的目标：敌方的城池与营寨
    const targets = w.sites.filter(s => s.owner === en && !s.gone && SITE_INFO[s.type].counts);
    const assigned = new Map<number, number>();
    for (const g of this.groups) if (g.mode === M_MARCH || g.mode === M_DEFEND) assigned.set(g.obj, (assigned.get(g.obj) ?? 0) + g.power);
    const capturable = w.sites.filter(s => SITE_INFO[s.type].captureTime > 0 && s.owner !== tm && !s.gone);
    this.spend();
    const assaultReady = capturable.length === 0 || myTotal > enTotal * [1.6, 1.25, 1.05][this.level]
      || w.time > [900, 600, 420][this.level];

    for (const g of this.groups) {
      if (g.guard) {
        // 守备队：敌军逼近则出击，否则回到岗位
        const c = this.enemyCentroid(g.ax, g.ay, 620);
        if (c) {
          if (tick - g.lastOrder > 150) {
            // 城墙上的弓弩手留在垛口上，不跟着出击
            w.orderMove(g.slots.filter(s => w.pmode[s] === 0), c.x, c.y, true);
            g.lastOrder = tick;
            g.mode = M_DEFEND;
          }
        } else if (g.mode === M_DEFEND) {
          w.orderMove(g.slots.filter(s => w.pmode[s] === 0), g.ax, g.ay, true);
          g.mode = M_IDLE;
        }
        continue;
      }
      const home = nearestSite(homes, g.cx, g.cy);
      if (!home) continue;
      const near = this.enemyNear(g.cx, g.cy, 460);
      if (g.mode === M_RETREAT) {
        if ((g.cx - home.x) ** 2 + (g.cy - home.y) ** 2 < 520 * 520) {
          this.addReinforcements(g.slots);
          g.slots.length = 0;
        } else if (tick - g.lastOrder > 300) {
          w.orderMove(g.slots, home.x, home.y + 60, false);
          g.lastOrder = tick;
        }
        continue;
      }
      if (g.power < g.power0 * 0.3 && near > g.power * 1.2 && g.mode !== M_DEFEND) {
        g.mode = M_RETREAT;
        w.orderMove(g.slots, home.x, home.y + 60, false);
        g.lastOrder = tick;
        continue;
      }
      // 回防最近的城池
      if (this.enemyNearSite(home, 460) > 5 && g.mode !== M_DEFEND && (g.cx - home.x) ** 2 + (g.cy - home.y) ** 2 < 3400 * 3400) {
        g.mode = M_DEFEND;
        g.obj = home.id;
        g.lastOrder = -9999;
      }
      if (g.mode === M_DEFEND) {
        const s = w.sites[g.obj];
        const c = this.enemyCentroidSite(s, 460);
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
      if (g.mode === M_MARCH && (tick - g.lastOrder > 30 * 16 || this.towerDown(g))) {
        this.pushSite(g, w.sites[g.obj]);
        g.lastOrder = tick;
      } else if (g.mode === M_ASSAULT) {
        const tgt = nearestSite(targets, g.cx, g.cy) ?? nearestSite(capturable, g.cx, g.cy);
        if (!tgt) {
          g.mode = M_IDLE;
          continue;
        }
        if (tick - g.lastOrder > 30 * 14 || this.towerDown(g)) {
          g.lastOrder = tick;
          this.pushSite(g, tgt);
        }
      }
    }
    this.groups = this.groups.filter(g => g.slots.length > 0);
  }

  /** 战斗群正在拆的那座军事建筑已经倒了：不必等下一轮指令，马上换下一座 */
  private towerDown(g: Group): boolean {
    return g.bld >= 0 && !this.w.buildings[g.bld].alive;
  }

  /**
   * 向据点 s 推进：攻占先拆军事建筑（敌方的、中立的都一样），再肃清、站到旗下读秒。
   * 队伍到了据点（据点范围外 250 以内）、守军不强时，近战与器械去拆离得最近的一座，其余继续清剿；没到、或拆光了就往旗下走。
   */
  private pushSite(g: Group, s: Site): void {
    const w = this.w, tm = this.team;
    let foe: Building | null = null, bd = 1e18;
    for (const id of s.buildings) {
      const b = w.buildings[id];
      if (!b.alive || b.owner === tm || b.def.role !== BR_MILITARY) continue;
      const d2 = (g.cx - b.cx) ** 2 + (g.cy - b.cy) ** 2;
      if (d2 < bd) {
        bd = d2;
        foe = b;
      }
    }
    g.bld = -1;
    const arrived = siteGap(s, g.cx, g.cy) < 250;
    if (foe && arrived && this.enemyNear(foe.cx, foe.cy, 320) < g.power * 0.6) {
      g.bld = foe.id;
      const hitters = g.slots.filter(sl => {
        const d = w.defs[w.type[sl]];
        return d.range === 0 || d.vsBld >= 2;
      });
      w.orderAttackBuilding(hitters, foe);
      const rest = g.slots.filter(sl => w.order[sl] !== O_ATTACK);
      if (rest.length) w.orderMove(rest, s.x, s.y + 24, true);
    } else w.orderMove(g.slots, s.x, s.y + 24, true);
  }

  /** 把攒下的资源花掉：黄金升级部队（老兵优先），石料 / 木材升级据点，富余的木材给资源点添哨塔 */
  private spend(): void {
    const w = this.w, tm = this.team;
    if (w.stock.gold[tm] >= RULES.economy.unitGold * 12) {
      const mine: number[] = [];
      for (let i = 0; i < w.n; i++) if (w.alive[i] && w.team[i] === tm) mine.push(i);
      w.upgradeUnits(mine);
    }
    // 木材两头用：升一座营寨、建一座哨塔，轮着来（不然木材永远先被升级花光）
    if (this.towerTurn && w.stock.wood[tm] >= RULES.economy.towerCost) {
      let built = false, any = false;
      for (const s of w.sites) {
        if (s.owner !== tm || !s.slots.length || towerCount(w, s) >= s.slots.length) continue;
        any = true;
        if (w.buildTower(s)) {
          built = true;
          break;
        }
      }
      if (built || !any) this.towerTurn = false;
    }
    // 逐级升：先把各据点都升到同一级，再往上；同级的挑价值高的
    let best: Site | null = null;
    for (const s of w.sites) {
      if (s.owner !== tm || !canUpgradeSite(s)) continue;
      const info = SITE_INFO[s.type];
      if (w.stock[info.material][tm] < siteUpgradeCost(s) || (info.material === 'wood' && this.towerTurn)) continue;
      if (!best || s.level < best.level || (s.level === best.level && info.value > SITE_INFO[best.type].value)) best = s;
    }
    if (best && w.upgradeSite(best) && SITE_INFO[best.type].material === 'wood') this.towerTurn = true;
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
      if (s.owner !== tm || s.count[en] === 0) continue;
      const threat = this.enemyNearSite(s, 220);
      if (g.power < threat * 0.5 || (assigned.get(s.id) ?? 0) > threat * 1.5) continue;
      const sc = (SITE_INFO[s.type].value * 1.6) / (500 + Math.hypot(s.x - g.cx, s.y - g.cy));
      if (sc > bs) {
        bs = sc;
        best = s;
        defend = true;
      }
    }
    for (const s of capturable) {
      const def = this.enemyNearSite(s, 220);
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
