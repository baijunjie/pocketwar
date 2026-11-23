/** 据点：占领进度、休整与修缮、定时援军。溃兵不参与占领 */
import { RULES, SITE_INFO, TILE, UNIT_BY_KEY } from '../content';
import { NONE, S_ROUT } from '../state';
import type { Building, Site, World } from '../world';
import { setSiteLevel } from './economy';
import { autoGarrison, shiftPosts } from './garrison';
import { SITE_EVERY } from './index';

export function updateSites(w: World): void {
  const sites = w.sites;
  const flag2 = RULES.capture.flagRadius ** 2;
  const step = SITE_EVERY / 30;
  const heal = RULES.site.unitRegen * step;
  const rest2 = RULES.site.hqRadius ** 2;
  for (const s of sites) s.count[1] = s.count[2] = s.flag[1] = s.flag[2] = 0;
  for (let i = 0; i < w.n; i++) {
    if (!w.alive[i]) continue;
    w.sheltered[i] = 0;
    if (w.state[i] & S_ROUT) continue;
    const ux = w.x[i], uy = w.y[i];
    const encl = w.enclosure.length ? w.enclosure[w.cellAt(ux, uy)] : -1;
    for (const s of sites) {
      if (s.gone) continue;
      const dx = ux - s.x, dy = uy - s.y;
      const d2 = dx * dx + dy * dy;
      // 圈内人数（大本营按休整半径）：用于占领和「据点是否在交战」
      if (d2 < (s.radius > 0 ? s.radius * s.radius : rest2)) s.count[w.team[i]]++;
      // 在自家据点里（有城墙、木栅的按围墙之内算；没有围墙的按占领圈，大本营按休整半径；资源点不算据点）：
      // 雪天有遮蔽，不在战斗中就慢慢养伤
      const inside = s.walled ? encl === s.id : d2 < (s.radius > 0 ? s.radius * s.radius : rest2);
      if (s.owner === w.team[i] && !s.disabled && SITE_INFO[s.type].haven && inside) {
        w.sheltered[i] = 1;
        w.shelterSite[i] = s.id;
        if (w.combatT[i] <= 0 && w.target[i] === NONE && w.hp[i] < w.maxHp[i]) w.hp[i] = Math.min(w.maxHp[i], w.hp[i] + w.maxHp[i] * heal);
      }
      if (d2 < flag2) s.flag[w.team[i]]++;
    }
  }
  autoGarrison(w);
  shiftPosts(w);
  const calm = RULES.site.bldCalm * 30, mend = RULES.site.bldRegen * step;
  const E = RULES.economy;
  for (const s of sites) {
    if (s.gone) continue;
    const info = SITE_INFO[s.type];
    // 据点不在交战时，建筑自行修复（废墟要等重新占领）；手里有石料（城邦）/ 木材（营寨）时修得快得多，同时少量消耗。
    // 倒塌的建筑同样按这个速度重建：腾空了脚下就立起来，修满之前不放箭（down）。后来花木材搭的箭塔不在此列，要重新花木材建。
    if (s.owner && !s.disabled && !siteFighting(w, s, calm)) {
      const stock = w.stock[info.material];
      for (const id of s.buildings) {
        const b = w.buildings[id];
        if (b.hp >= b.maxHp || (!b.alive && (b.extra || foeOnFootprint(w, b, s.owner)))) continue;
        if (!b.alive) {
          b.alive = true;
          b.down = true;
          b.owner = s.owner;
          b.hp = 0;
          w.nav.refresh(b);
          evict(w, b);
        }
        const fast = stock[s.owner] > 0;
        const gain = Math.min(b.maxHp - b.hp, b.maxHp * mend * (fast ? E.repairBoost : 1));
        b.hp += gain;
        if (b.hp >= b.maxHp) b.down = false;
        if (fast) stock[s.owner] = Math.max(0, stock[s.owner] - (gain * E.repairCost) / 100);
      }
    }
    if (info.captureTime > 0) {
      // 占领：先肃清守军（圈内没有敌人），再派人站到中央旗帜下，读秒走完即告占领。
      // 读秒期间敌人回到圈内只是暂停；旗下一旦没有自己人，读秒清零。
      // 守备还在（对方的箭塔还立着、敌占据点的主建筑没倒）就占不了，见 defenseLocked。
      const ct = s.capTeam;
      if (ct) {
        if (s.flag[ct] === 0) {
          s.capTeam = 0;
          s.cap = 0;
        } else if (s.count[3 - ct] === 0 && !defenseLocked(w, s, ct)) {
          s.cap += step / info.captureTime;
          if (s.cap >= 1) captureSite(w, s, ct);
        }
      }
      if (!s.capTeam) {
        for (let t = 1; t <= 2; t++) {
          if (t !== s.owner && s.flag[t] > 0 && s.count[3 - t] === 0 && !defenseLocked(w, s, t)) {
            s.capTeam = t;
            s.cap = 0;
            break;
          }
        }
      }
    }
    if (s.owner && !s.disabled && info.reinf) {
      s.timer -= step;
      if (s.timer <= 0) {
        if (w.teamCount[s.owner] < w.unitCap[s.owner]) {
          s.timer = s.interval;
          reinforce(w, s);
        } else s.timer = 5;
      }
    }
  }
}

/** 据点在交战：有建筑最近挨过打，或圈内有敌方单位（溃兵不算） */
function siteFighting(w: World, s: Site, calm: number): boolean {
  return fightState(w, s, calm).fighting;
}

/**
 * 据点的交战状态与原因（界面显示用）：圈内敌兵数；建筑最近一次挨打距今几秒（没挨过为 -1）；
 * 还要几秒才转为平静（圈内有敌兵时为 -1：要等敌兵离开或被消灭）。
 */
export function fightState(w: World, s: Site, calm = RULES.site.bldCalm * 30): { fighting: boolean; foes: number; hitAgo: number; calmIn: number } {
  const foes = s.owner ? s.count[3 - s.owner] : 0;
  let last = -1;
  for (const id of s.buildings) last = Math.max(last, w.buildings[id].hitTick);
  const ago = w.tickCount - last;
  const hit = last >= 0 && ago <= calm;
  return { fighting: foes > 0 || hit, foes, hitAgo: last >= 0 ? ago / 30 : -1, calmIn: foes > 0 ? -1 : hit ? (calm - ago) / 30 : 0 };
}

/** 废墟上站着敌兵（溃兵也算）：先不重建，免得把敌人关在墙里 */
function foeOnFootprint(w: World, b: Building, owner: number): boolean {
  for (let i = 0; i < w.n; i++) {
    if (!w.alive[i] || w.team[i] === owner) continue;
    const x = w.x[i], y = w.y[i];
    if (x > b.x0 - 8 && x < b.x1 + 8 && y > b.y0 - 8 && y < b.y1 + 8) return true;
  }
  return false;
}

/**
 * 建筑立起来时，把压在脚下、走不出来的单位挪到最近的空地上。
 * 城门对自家人是通的，站在门洞里的自家人不用挪。敌兵站在废墟上时根本不会重建（foeOnFootprint）。
 */
function evict(w: World, b: Building): void {
  for (let i = 0; i < w.n; i++) {
    if (!w.alive[i]) continue;
    const x = w.x[i], y = w.y[i];
    if (x <= b.x0 || x >= b.x1 || y <= b.y0 || y >= b.y1) continue;
    const tm = w.team[i], c = w.cellAt(x, y);
    // 自家的墙顶对自家人不算「挡路」，但地面上的人上不了墙顶，同样要挪
    if (!w.nav.block[tm][c] && !w.nav.deck[tm][c]) continue;
    const nc = w.nav.nearestFree(tm, c, 6);
    if (nc === c) continue;
    const mw = w.map.w;
    w.x[i] = w.px[i] = (nc % mw + 0.5) * TILE;
    w.y[i] = w.py[i] = (((nc / mw) | 0) + 0.5) * TILE;
  }
}

/**
 * 守备还在，tm 不能读秒：
 * - 别人（非中立）的箭塔还立着；
 * - 敌占的城邦、营寨，主建筑还立着（拆毁主建筑后据点成为废墟，才能占领）。
 */
function defenseLocked(w: World, s: Site, tm: number): boolean {
  if (SITE_INFO[s.type].razeFirst && s.owner !== 0 && s.owner !== tm && s.main >= 0 && w.buildings[s.main].alive) return true;
  for (const sl of s.slots) {
    if (sl.bld < 0) continue;
    const b = w.buildings[sl.bld];
    if (b.alive && b.owner !== 0 && b.owner !== tm) return true;
  }
  return false;
}

function captureSite(w: World, s: Site, tm: number): void {
  const from = s.owner;
  s.owner = tm;
  s.cap = 0;
  s.capTeam = 0;
  s.timer = s.interval * 0.6;
  // 易主后等级降回，要重新升级
  if (s.level) setSiteLevel(w, s, 0);
  // 新主人把被毁的建筑修好，废墟重新成为据点（后来搭的箭塔不在此列，要重新花木材建）
  let repaired = false;
  for (const id of s.buildings) {
    const b = w.buildings[id];
    if (b.extra && !b.alive) continue;
    b.owner = tm;
    const wasDown = !b.alive;
    if (!b.alive || b.down) {
      repaired ||= !b.alive;
      b.alive = true;
      b.down = false;
      b.hp = b.maxHp;
    }
    w.nav.refresh(b);
    if (wasDown) evict(w, b);
  }
  s.disabled = false;
  w.events.push({ kind: 'captured', site: s.id, team: tm, from, repaired });
}

/** 援军在出兵的据点里出现；设了集结点就开赴集结点，没设就留在据点里驻守（远程的会自动登城） */
function reinforce(w: World, s: Site): void {
  const tm = s.owner;
  const fac = w.factions[tm];
  if (!fac) return;
  const kind = SITE_INFO[s.type].reinf;
  if (!kind) return;
  const list = fac.reinf[kind];
  const mult = fac.reinfMult * w.reinfMult[tm];
  const idxs: number[] = [];
  for (const [key, cnt] of list) {
    const n = Math.max(1, Math.round(cnt * mult));
    for (let k = 0; k < n; k++) idxs.push(UNIT_BY_KEY[key].idx);
  }
  const r = w.rally[tm];
  // 据点中心多半是主建筑，往南挪一点免得全挤进建筑里（spawnGroup 会把落在建筑上的人挪到最近的空地）
  const sx = s.x, sy = s.y + RULES.site.spawnOff;
  const fx = r ? r.x - sx : 0, fy = r ? r.y - sy : 1;
  const slots = w.spawnGroup(tm, idxs, sx, sy, fx, fy);
  if (!slots.length) return;
  w.arrived[tm] += slots.length;
  if (r) w.orderMove(slots, r.x + (w.rng.next() - 0.5) * 160, r.y + (w.rng.next() - 0.5) * 160, true);
  w.events.push({ kind: 'reinforce', site: s.id, team: tm, count: slots.length });
  w.onReinforce?.(tm, slots);
}
