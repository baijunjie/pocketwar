/**
 * 资源及其用处：资源点自动采集；黄金把兵种升为高级形态，石料 / 木材升级据点，
 * 木材还能给资源点建哨塔、让部队在野外搭临时据点。
 */
import { BUILDINGS, BuildingDef, RES_KINDS, RULES, SITE_INFO, SITE_OUTPOST, TILE, T_BRIDGE, T_SHALLOW, TowerDef, UnitDef } from '../content';
import { FX_BUILT, FX_UPGRADE, S_ROUT } from '../state';
import { siteGap } from '../siteArea';
import type { Site, World } from '../world';

export const ECON_EVERY = 15;
/** 据点的最高等级（等级从 1 起，开局都是 1 级），由据点各级加成表的长度定 */
export const SITE_MAX_LEVEL = RULES.economy.siteLevels.length;

/** 已下令、部队正赶去搭的临时据点（木材下令时就扣，搭不成退还） */
export interface PendingBuild {
  team: number;
  x: number;
  y: number;
  tx: number;
  ty: number;
  slots: number[];
  uids: number[];
  /** 过了这个时刻（秒）还没搭起来就作罢 */
  until: number;
}

export function updateEconomy(w: World): void {
  const step = ECON_EVERY / 30;
  for (const k of RES_KINDS) w.income[k][1] = w.income[k][2] = 0;
  for (const s of w.sites) {
    if (!s.owner) continue;
    const y = SITE_INFO[s.type].yields;
    if (!y) continue;
    for (const k of RES_KINDS) {
      const v = y[k];
      // 黄金要养的是整支军队，所以产量随开局兵力走；木材、石料是固定数量
      if (v) w.income[k][s.owner] += k === 'gold' ? (v * w.armyBase[s.owner]) / 100 : v;
    }
  }
  for (const k of RES_KINDS) for (let tm = 1; tm <= 2; tm++) w.stock[k][tm] += (w.income[k][tm] / 60) * step;
  if (w.builds.length) updateBuilds(w);
}

// ------------------------------------------------------------------ 兵种升级
/** 把这个兵种升为高级形态要多少黄金；没有高级形态（或已经是）返回 0 */
export function unitUpgradeCost(d: UnitDef): number {
  return d.elite < 0 ? 0 : d.upkeep * RULES.economy.unitGold;
}

/**
 * 这些单位里能升级的，按先后次序排好：等级高的优先；同一等级里各兵种轮流，每轮每个兵种一人。
 */
export function upgradeQueue(w: World, units: number[]): number[] {
  const byLevel: Map<number, number[]>[] = [];
  for (const s of units) {
    if (!w.alive[s] || w.state[s] & S_ROUT) continue;
    const d = w.defs[w.type[s]];
    if (d.elite < 0) continue;
    const lv = w.level[s];
    const types = (byLevel[lv] ??= new Map<number, number[]>());
    let list = types.get(d.idx);
    if (!list) types.set(d.idx, (list = []));
    list.push(s);
  }
  const out: number[] = [];
  for (let lv = byLevel.length - 1; lv >= 0; lv--) {
    const types = byLevel[lv];
    if (!types) continue;
    const lists = [...types.keys()].sort((a, b) => a - b).map(t => types.get(t)!);
    for (let round = 0, any = true; any; round++) {
      any = false;
      for (const l of lists) if (round < l.length) {
        out.push(l[round]);
        any = true;
      }
    }
  }
  return out;
}

/** 这些单位全部升级要多少黄金、共几人 */
export function upgradeAllCost(w: World, units: number[]): { count: number; cost: number } {
  let count = 0, cost = 0;
  for (const s of units) {
    if (!w.alive[s] || w.state[s] & S_ROUT) continue;
    const c = unitUpgradeCost(w.defs[w.type[s]]);
    if (c > 0) {
      count++;
      cost += c;
    }
  }
  return { count, cost };
}

export function upgradeUnits(w: World, units: number[]): { count: number; cost: number } {
  let count = 0, cost = 0;
  if (!units.length) return { count, cost };
  const tm = w.team[units[0]];
  const gold = w.stock.gold;
  for (const s of upgradeQueue(w, units)) {
    if (w.team[s] !== tm) continue;
    const d = w.defs[w.type[s]];
    const c = unitUpgradeCost(d);
    // 这一个升不起就跳过：后面便宜的兵种也许还升得起
    if (c > gold[tm] + 1e-6) continue;
    gold[tm] = Math.max(0, gold[tm] - c);
    const e = w.defs[d.elite];
    const ratio = w.hp[s] / w.maxHp[s];
    w.type[s] = e.idx;
    w.maxHp[s] = e.lvHp[w.level[s]];
    w.hp[s] = Math.max(1, w.maxHp[s] * ratio);
    w.addFx(FX_UPGRADE, w.x[s], w.y[s], w.rad[s]);
    count++;
    cost += c;
  }
  return { count, cost };
}

// ------------------------------------------------------------------ 据点升级
/** 把据点升到下一级要花多少（material 那种资源）；不能升级（资源点、已满级、无主）返回 0 */
export function siteUpgradeCost(s: Site): number {
  if (s.owner === 0 || s.gone || s.level >= SITE_MAX_LEVEL) return 0;
  return Math.round(SITE_INFO[s.type].upgradeCost * RULES.economy.siteLevels[s.level].cost);
}

export function canUpgradeSite(s: Site): boolean {
  return siteUpgradeCost(s) > 0;
}

export function upgradeSite(w: World, s: Site): boolean {
  const cost = siteUpgradeCost(s);
  if (cost <= 0) return false;
  const st = w.stock[SITE_INFO[s.type].material];
  if (st[s.owner] < cost) return false;
  st[s.owner] -= cost;
  setSiteLevel(w, s, s.level + 1);
  w.addFx(FX_BUILT, s.x, s.y, 3);
  return true;
}

/** 这座建筑在某一级时的火力：2 级起伤害、射程提高；3 级再按 tier3 加箭矢或炮弹。1 级与不放箭的建筑原样返回 */
export function towerAt(def: BuildingDef, lv: number): TowerDef | null {
  const t = def.tower;
  if (!t || lv <= 1) return t;
  const L = RULES.economy.siteLevels[lv - 1], p = lv >= SITE_MAX_LEVEL ? def.tier3 : undefined;
  return { range: t.range * L.range, dmg: t.dmg * L.dmg, cd: t.cd, arrows: t.arrows * (p?.arrowMul ?? 1), shells: p?.shells ?? 0 };
}

/** 设定据点等级（1–3）：建筑的生命上限、护甲、火力跟着变；升级时补上新增的生命 */
export function setSiteLevel(w: World, s: Site, lv: number): void {
  const L = RULES.economy.siteLevels[lv - 1];
  s.level = lv;
  for (const id of s.buildings) {
    const b = w.buildings[id];
    // 后来搭的哨塔、行营不随据点升级
    if (b.extra) continue;
    const max = Math.round(b.def.hp * L.hp);
    if (b.alive) b.hp = max > b.maxHp ? b.hp + (max - b.maxHp) : Math.min(b.hp, max);
    b.maxHp = max;
    b.lv = lv;
    b.armor = L.armor;
    b.tower = towerAt(b.def, lv);
  }
}

// ------------------------------------------------------------------ 资源点的哨塔
/** 据点里还立着的哨塔位数量 */
export function towerCount(w: World, s: Site): number {
  let n = 0;
  for (const sl of s.slots) if (sl.bld >= 0 && w.buildings[sl.bld].alive) n++;
  return n;
}

export function buildTower(w: World, s: Site): boolean {
  const E = RULES.economy;
  if (!s.owner || s.gone) return false;
  const slot = s.slots.find(sl => sl.bld < 0 || !w.buildings[sl.bld].alive);
  if (!slot || w.stock.wood[s.owner] < E.towerCost) return false;
  w.stock.wood[s.owner] -= E.towerCost;
  let b;
  if (slot.bld < 0) {
    b = w.addBuilding(BUILDINGS[E.towerKey], slot.tx, slot.ty, s.owner, s.id);
    b.extra = true;
    s.buildings.push(b.id);
    slot.bld = b.id;
  } else {
    // 原来那座被毁了：在废墟上重建
    b = w.buildings[slot.bld];
    b.alive = true;
    b.down = false;
    b.hp = b.maxHp;
    b.owner = s.owner;
    b.hitTick = -999;
    w.nav.refresh(b);
  }
  w.addFx(FX_BUILT, b.cx, b.cy, 1);
  return true;
}

// ------------------------------------------------------------------ 临时据点
export type OutpostError = 'none' | 'wood' | 'max' | 'ground' | 'near';

/** 某队现有（含正在搭的）临时据点数 */
export function outpostCount(w: World, tm: number): number {
  let n = 0;
  for (const s of w.sites) if (s.type === SITE_OUTPOST && s.owner === tm && !s.gone) n++;
  for (const p of w.builds) if (p.team === tm) n++;
  return n;
}

/** 这块地能不能搭：平地、没有建筑、不在别的据点里 */
function outpostSpot(w: World, tx: number, ty: number, cx: number, cy: number): OutpostError | null {
  const d = BUILDINGS[RULES.economy.outpostKey];
  const mw = w.map.w;
  for (let y = ty; y < ty + d.h; y++) for (let x = tx; x < tx + d.w; x++) {
    if (x < 2 || y < 2 || x >= mw - 2 || y >= w.map.h - 2) return 'ground';
    const c = y * mw + x, t = w.map.terrain[c];
    if (w.nav.base[c] === 0 || t === T_SHALLOW || t === T_BRIDGE || w.nav.bld[c] >= 0) return 'ground';
  }
  for (const s of w.sites) {
    if (s.gone) continue;
    if (siteGap(s, cx, cy) < 60) return 'near';
  }
  for (const p of w.builds) if ((p.x - cx) ** 2 + (p.y - cy) ** 2 < 200 * 200) return 'near';
  return null;
}

/** 派部队去 (x, y) 搭临时据点。成功返回 null，否则返回原因 */
export function orderOutpost(w: World, units: number[], x: number, y: number): OutpostError | null {
  const E = RULES.economy;
  const live = units.filter(s => w.alive[s] && !(w.state[s] & S_ROUT));
  if (!live.length) return 'none';
  const tm = w.team[live[0]];
  if (w.stock.wood[tm] < E.outpostCost) return 'wood';
  if (outpostCount(w, tm) >= E.outpostMax) return 'max';
  const d = BUILDINGS[E.outpostKey];
  const tx = Math.round(x / TILE - d.w / 2), ty = Math.round(y / TILE - d.h / 2);
  const cx = (tx + d.w / 2) * TILE, cy = (ty + d.h / 2) * TILE;
  const bad = outpostSpot(w, tx, ty, cx, cy);
  if (bad) return bad;
  w.stock.wood[tm] -= E.outpostCost;
  w.builds.push({ team: tm, x: cx, y: cy, tx, ty, slots: live.slice(), uids: live.map(s => w.uid[s]), until: w.time + E.outpostTimeout });
  // 部队开到工地南侧，免得被落成的营帐压在底下
  w.orderMove(live, cx, cy + (d.h * TILE) / 2 + 34, false);
  return null;
}

function updateBuilds(w: World): void {
  const E = RULES.economy;
  const reach2 = E.outpostReach * E.outpostReach;
  for (let k = w.builds.length - 1; k >= 0; k--) {
    const p = w.builds[k];
    let any = false, there = false;
    for (let m = 0; m < p.slots.length; m++) {
      const s = p.slots[m];
      if (!w.alive[s] || w.uid[s] !== p.uids[m] || w.state[s] & S_ROUT) continue;
      any = true;
      if ((w.x[s] - p.x) ** 2 + (w.y[s] - p.y) ** 2 < reach2) {
        there = true;
        break;
      }
    }
    if (!there && any && w.time <= p.until) continue;
    w.builds.splice(k, 1);
    let site = -1;
    if (there && !outpostSpot(w, p.tx, p.ty, p.x, p.y)) {
      const s = w.addSite(SITE_OUTPOST, SITE_INFO[SITE_OUTPOST].label, p.x, p.y, p.team);
      const b = w.addBuilding(BUILDINGS[E.outpostKey], p.tx, p.ty, p.team, s.id);
      b.extra = true;
      s.buildings.push(b.id);
      s.main = b.id;
      site = s.id;
      w.addFx(FX_BUILT, p.x, p.y, 2);
    } else w.stock.wood[p.team] += E.outpostCost;
    w.events.push({ kind: 'outpost', site, team: p.team, x: p.x, y: p.y, built: site >= 0 });
  }
}
