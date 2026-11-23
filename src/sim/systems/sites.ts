/** 据点：占领进度、休整与修缮、定时援军。溃兵不参与占领 */
import { RULES, SITE_INFO, UNIT_BY_KEY } from '../content';
import { NONE, S_ROUT } from '../state';
import type { Building, Site, World } from '../world';
import { setSiteLevel } from './economy';
import { autoGarrison } from './garrison';
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
    for (const s of sites) {
      if (s.gone) continue;
      const dx = ux - s.x, dy = uy - s.y;
      const d2 = dx * dx + dy * dy;
      // 圈内人数（大本营按休整半径）：用于占领和「据点是否在交战」
      if (d2 < (s.radius > 0 ? s.radius * s.radius : rest2)) s.count[w.team[i]]++;
      // 在自家据点里（大本营没有占领圈，另按休整半径算；资源点不算据点）：雪天有遮蔽，不在战斗中就慢慢养伤
      if (s.owner === w.team[i] && !s.disabled && SITE_INFO[s.type].haven && d2 < (s.radius > 0 ? s.radius * s.radius : rest2)) {
        w.sheltered[i] = 1;
        w.shelterSite[i] = s.id;
        if (w.combatT[i] <= 0 && w.target[i] === NONE && w.hp[i] < w.maxHp[i]) w.hp[i] = Math.min(w.maxHp[i], w.hp[i] + w.maxHp[i] * heal);
      }
      if (d2 < flag2) s.flag[w.team[i]]++;
    }
  }
  autoGarrison(w);
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
        if (b.hp >= b.maxHp || (!b.alive && (b.extra || !footprintClear(w, b)))) continue;
        if (!b.alive) {
          b.alive = true;
          b.down = true;
          b.owner = s.owner;
          b.hp = 0;
          w.nav.refresh(b);
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
  if (s.count[3 - s.owner] > 0) return true;
  for (const id of s.buildings) if (w.tickCount - w.buildings[id].hitTick <= calm) return true;
  return false;
}

/** 建筑脚下没有任何单位（重建时立起来不能把人压在里面） */
function footprintClear(w: World, b: Building): boolean {
  const x0 = b.x0 - 8, x1 = b.x1 + 8, y0 = b.y0 - 8, y1 = b.y1 + 8;
  for (let i = 0; i < w.n; i++) {
    if (!w.alive[i]) continue;
    const x = w.x[i], y = w.y[i];
    if (x > x0 && x < x1 && y > y0 && y < y1) return false;
  }
  return true;
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
    if (!b.alive || b.down) {
      repaired ||= !b.alive;
      b.alive = true;
      b.down = false;
      b.hp = b.maxHp;
    }
    w.nav.refresh(b);
  }
  s.disabled = false;
  w.events.push({ kind: 'captured', site: s.id, team: tm, from, repaired });
}

/** 援军从己方后方入场，开赴集结点 */
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
  const sp = w.map.spawn[tm];
  const r = w.rally[tm];
  const slots = w.spawnGroup(tm, idxs, sp.x, sp.y, r.x - sp.x, r.y - sp.y);
  if (!slots.length) return;
  w.arrived[tm] += slots.length;
  w.orderMove(slots, r.x + (w.rng.next() - 0.5) * 160, r.y + (w.rng.next() - 0.5) * 160, true);
  w.events.push({ kind: 'reinforce', site: s.id, team: tm, count: slots.length });
  w.onReinforce?.(tm, slots);
}
