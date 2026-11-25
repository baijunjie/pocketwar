/** 据点：占领进度、休整与修缮、定时援军。溃兵不参与占领 */
import { BR_MILITARY, FactionDef, RULES, SITE_INFO, TILE, UNITS, UnitDef, forceList, headcount, isContentUnit, reinforceMult } from '../content';
import { NONE, S_ROUT } from '../state';
import type { Building, Site, World } from '../world';
import { canRally } from '../rally';
import { fightState, siteContains } from '../siteArea';
import { setSiteLevel } from './economy';
import { autoGarrison, shiftPosts } from './garrison';
import { SITE_EVERY } from './index';

export function updateSites(w: World): void {
  const sites = w.sites;
  const flag2 = RULES.capture.flagRadius ** 2;
  const step = SITE_EVERY / 30;
  const heal = RULES.site.unitRegen * step;
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
      // 据点范围内的人数（有围墙的是围墙矩形，没有的是占领圈）：用于占领前的肃清和「据点是否在交战」
      const inside = siteContains(s, ux, uy);
      if (inside) s.count[w.team[i]]++;
      // 在自家据点里（资源点不算据点）：雪天有遮蔽，不在战斗中就慢慢养伤
      if (s.owner === w.team[i] && SITE_INFO[s.type].haven && inside) {
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
    // 据点不在交战时，建筑自行修复；手里有石料（城池）/ 木材（营寨）时修得快得多，同时少量消耗。
    // 倒塌的建筑同样按这个速度重建：腾空了脚下就立起来，修满之前不放箭（down）。后来花木材搭的哨塔不在此列，要重新花木材建。
    // 中立据点一样会修（没有资源，只有原速）；资源点没有恢复能力。
    if (info.regen && !fightState(w, s, calm).fighting) {
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
        const fast = s.owner > 0 && stock[s.owner] > 0;
        const gain = Math.min(b.maxHp - b.hp, b.maxHp * mend * (fast ? E.repairBoost : 1));
        b.hp += gain;
        if (b.hp >= b.maxHp) b.down = false;
        if (fast) stock[s.owner] = Math.max(0, stock[s.owner] - (gain * E.repairCost) / 100);
      }
    }
    if (info.captureTime > 0) {
      // 占领：先肃清守军（据点范围内没有敌人），再派人站到中央旗帜下，读秒走完即告占领。
      // 读秒期间敌人回到据点范围内只是暂停；旗下一旦没有自己人，读秒清零。
      // 军事建筑没拆光就占不了，见 defenseLocked。
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
    // 中央建筑倒了只是不出援军（计时暂停），立起来之后接着走
    if (s.owner && info.reinf && !reinfPaused(w, s)) {
      s.timer -= step;
      if (s.timer <= 0) {
        if (w.teamCount[s.owner] < w.unitCap[s.owner]) {
          s.timer = s.interval;
          reinforce(w, s);
          // 出了一批，电脑接着给营寨选下一批的兵种
          autoPick(w, s);
        } else s.timer = 5;
      }
    }
  }
  checkDefeat(w);
}

/** 据点的援军暂停了：它有主人、出援军，而中央建筑被毁（计时暂停，立起来之后接着走）；界面也按它写「援军暂停」 */
export function reinfPaused(w: World, s: Site): boolean {
  return !!s.owner && !!SITE_INFO[s.type].reinf && s.main >= 0 && !w.buildings[s.main].alive;
}

/** 一方曾经有过城池与营寨（SiteInfo.counts）、现在全部丢失即判负；资源点和临时据点不算。从没有过的不判，免得没有这类据点的世界一开局就结算 */
function checkDefeat(w: World): void {
  if (w.winner) return;
  const left = [0, 0, 0];
  for (const s of w.sites) if (s.owner && !s.gone && SITE_INFO[s.type].counts) left[s.owner]++;
  for (let tm = 1; tm <= 2; tm++) {
    if (left[tm] > 0) w.heldSites[tm] = true;
    if (left[tm] > 0 || !w.heldSites[tm]) continue;
    w.winner = 3 - tm;
    w.events.push({ kind: 'gameover', winner: w.winner });
    return;
  }
}

/** 倒塌的建筑上站着敌兵（溃兵也算；中立方没有自己人，任何兵都算）：先不重建，免得把敌人关在墙里 */
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

/** 据点里还立着的、不是 tm 的（敌方的或中立的）军事建筑（会放箭的，含资源点自建的哨塔）有几座；城防与普通建筑不算 */
export function militaryLeft(w: World, s: Site, tm: number): number {
  let n = 0;
  for (const id of s.buildings) {
    const b = w.buildings[id];
    if (b.alive && b.owner !== tm && b.def.role === BR_MILITARY) n++;
  }
  return n;
}

/** 军事建筑没拆光，tm 就不能读秒占领 */
export function defenseLocked(w: World, s: Site, tm: number): boolean {
  return militaryLeft(w, s, tm) > 0;
}

function captureSite(w: World, s: Site, tm: number): void {
  const from = s.owner;
  s.owner = tm;
  // 集结点是前主人设的，作废；电脑占下据点就把它的集结点设回出发阵地，人类玩家的新据点援军留守
  const auto = w.autoRally[tm];
  s.rally = auto && canRally(s) ? { x: auto.x, y: auto.y } : null;
  s.cap = 0;
  s.capTeam = 0;
  s.timer = s.interval * 0.6;
  // 营寨的兵种选择属于占领方：回到新主人的缺省兵种，电脑再按自己的办法选
  resetPick(w, s);
  // 易主后等级降回，要重新升级
  if (s.level > 1) setSiteLevel(w, s, 1);
  // 新主人把被毁的建筑修好（后来搭的哨塔不在此列，要重新花木材建）
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
  w.events.push({ kind: 'captured', site: s.id, team: tm, from, repaired });
}

/** 援军在出兵的据点里出现；这个据点设了集结点就开赴集结点，没设就留在据点里驻守（远程的会自动登城） */
function reinforce(w: World, s: Site): void {
  const tm = s.owner;
  const fac = w.factions[tm];
  if (!fac) return;
  const info = SITE_INFO[s.type];
  if (!info.reinf) return;
  let idxs: number[];
  // 全兵种援军按阵营的援军倍率；营寨每批份数固定，只乘电脑的难度倍率
  if (info.reinf === 'full') idxs = forceList(fac.reinf, reinforceMult(fac) * w.reinfMult[tm] * info.reinfScale);
  else {
    const d = UNITS[pickedUnit(w, s)];
    idxs = Array(campBatch(w, s, tm, d)).fill(d.idx);
  }
  const r = s.rally;
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

// ---------- 营寨的兵种选择 ----------

/** 阵营的全部正式兵种（初级形态，按兵种表的顺序）：营寨可选的范围 */
export function factionUnits(f: FactionDef): UnitDef[] {
  return UNITS.filter(d => d.faction === f.id && d.tier === 0 && isContentUnit(d));
}

/** 营寨此刻出哪个兵种的援军（兵种下标）：所选的，没选或所选已不属于主人的文明时取主人文明兵种表里的第一个；据点无主时返回 -1 */
export function pickedUnit(w: World, s: Site): number {
  const fac = w.factions[s.owner];
  if (!fac) return -1;
  const list = factionUnits(fac);
  return list.some(d => d.idx === s.pick) ? s.pick : list[0].idx;
}

/** 营寨回到新主人的缺省兵种（兵种表里的第一个）；电脑再按它的办法选；不出「选定兵种」援军的据点没有选择 */
function resetPick(w: World, s: Site): void {
  s.pick = -1;
  if (SITE_INFO[s.type].reinf !== 'pick') return;
  s.pick = pickedUnit(w, s);
  autoPick(w, s);
}

/** 这一队有自动选兵种的办法（电脑）就让它给这座营寨选；不重置援军计时（占下时与刚出完一批时计时本来就是新的） */
function autoPick(w: World, s: Site): void {
  const f = w.autoPick[s.owner];
  if (!f || SITE_INFO[s.type].reinf !== 'pick') return;
  const unit = f(s);
  if (factionUnits(w.factions[s.owner]!).some(d => d.idx === unit)) s.pick = unit;
}

/** 「选定兵种」据点（营寨）每批援军出几个兵种 d 的人：每批份数固定，只乘电脑的难度倍率，选贵的兵种每批人就少 */
export function campBatch(w: World, s: Site, team: number, d: UnitDef): number {
  return headcount(d, SITE_INFO[s.type].reinfForce * w.reinfMult[team]);
}

/** 开局给营寨定缺省兵种、电脑再选一遍（对局创建时调用） */
export function initPicks(w: World): void {
  for (const s of w.sites) if (s.owner) resetPick(w, s);
}

/** 占领方给自己的营寨改选援军兵种；改选重置援军计时（选回现在这个兵种不算改选） */
export function pickUnit(w: World, s: Site, team: number, unit: number): boolean {
  const fac = w.factions[team];
  if (!fac || s.gone || s.owner !== team || SITE_INFO[s.type].reinf !== 'pick') return false;
  if (!factionUnits(fac).some(d => d.idx === unit)) return false;
  if (unit === pickedUnit(w, s)) return true;
  s.pick = unit;
  s.timer = s.interval;
  return true;
}
