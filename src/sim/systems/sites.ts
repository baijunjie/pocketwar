/** 据点：占领进度与定时援军。溃兵不参与占领 */
import { RULES, SITE_HQ, SITE_INFO, UNIT_BY_KEY } from '../content';
import { NONE, S_ROUT } from '../state';
import type { Site, World } from '../world';
import { SITE_EVERY } from './index';

export function updateSites(w: World): void {
  const sites = w.sites;
  const flag2 = RULES.capture.flagRadius ** 2;
  const step = SITE_EVERY / 30;
  const heal = RULES.site.unitRegen * step;
  const rest2 = RULES.site.hqRadius ** 2;
  for (const s of sites) s.count[1] = s.count[2] = s.flag[1] = s.flag[2] = 0;
  for (let i = 0; i < w.n; i++) {
    if (!w.alive[i] || w.state[i] & S_ROUT) continue;
    const ux = w.x[i], uy = w.y[i];
    for (const s of sites) {
      const dx = ux - s.x, dy = uy - s.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < s.radius * s.radius) s.count[w.team[i]]++;
      // 在自家据点里休整：不在战斗中就慢慢养伤（大本营没有占领圈，另按休整半径算）
      if (s.owner === w.team[i] && !s.disabled && d2 < (s.radius > 0 ? s.radius * s.radius : rest2) && w.combatT[i] <= 0
        && w.target[i] === NONE && w.hp[i] < w.maxHp[i]) {
        w.hp[i] = Math.min(w.maxHp[i], w.hp[i] + w.maxHp[i] * heal);
      }
      if (d2 < flag2) s.flag[w.team[i]]++;
    }
  }
  const calm = RULES.site.bldCalm * 30, mend = RULES.site.bldRegen * step;
  for (const s of sites) {
    // 一段时间没挨打的建筑自行修复（废墟要等重新占领）
    if (s.owner && !s.disabled) {
      for (const id of s.buildings) {
        const b = w.buildings[id];
        if (b.alive && b.hp < b.def.hp && w.tickCount - b.hitTick > calm) b.hp = Math.min(b.def.hp, b.hp + b.def.hp * mend);
      }
    }
    if (s.type !== SITE_HQ) {
      // 占领：先肃清守军（圈内没有敌人），再派人站到中央旗帜下，读秒走完即告占领。
      // 读秒期间敌人回到圈内只是暂停；旗下一旦没有自己人，读秒清零。
      const ct = s.capTeam;
      if (ct) {
        if (s.flag[ct] === 0) {
          s.capTeam = 0;
          s.cap = 0;
        } else if (s.count[3 - ct] === 0) {
          s.cap += step / SITE_INFO[s.type].captureTime;
          if (s.cap >= 1) captureSite(w, s, ct);
        }
      }
      if (!s.capTeam) {
        for (let t = 1; t <= 2; t++) {
          if (t !== s.owner && s.flag[t] > 0 && s.count[3 - t] === 0) {
            s.capTeam = t;
            s.cap = 0;
            break;
          }
        }
      }
    }
    if (s.owner && !s.disabled) {
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

function captureSite(w: World, s: Site, tm: number): void {
  const from = s.owner;
  s.owner = tm;
  s.cap = 0;
  s.capTeam = 0;
  s.timer = s.interval * 0.6;
  // 新主人把被毁的建筑修好，废墟重新成为据点
  let repaired = false;
  for (const id of s.buildings) {
    const b = w.buildings[id];
    b.owner = tm;
    if (!b.alive) {
      b.alive = true;
      b.hp = b.def.hp;
      repaired = true;
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
  const list = fac.reinf[SITE_INFO[s.type].reinf];
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
