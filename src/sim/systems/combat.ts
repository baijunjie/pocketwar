/** 战斗结算：出手、伤害、阵亡、经验与升级、投射物、防御建筑（角楼、哨塔、主堡等）放箭 */
import {
  AU_RANGED_TAKEN, A_FIRE, A_MELEE, A_PIERCE, BK_TOWER, DT, LEVELS, PROJ_SPEED, P_BALL, P_BULLET, P_ROCKET, RULES, SITE_INFO, TR_BUSHIDO, TR_TESTUDO,
  T_FOREST, T_HILL, UnitDef, WR_AUX, WR_BUILDING, WR_MAIN, Weapon,
} from '../content';
import { FX_ARROW_HIT, FX_COLLAPSE, FX_DEATH, FX_EXPLODE, FX_HIT, FX_LEVEL, FX_SMOKE, ENG_CLOSE, GRID, MAX_CORPSE, MAX_PROJ, NONE, O_ATTACK, O_HOLD, O_IDLE, O_MOVE, S_ROUT, S_SHIELD, S_WALL, FX_FIRE, FX_SHOT } from '../state';
import type { Building, World } from '../world';
import { bldSkipped, canAttackBuilding, windRangeMul } from './targeting';

/** 防御建筑（角楼、哨塔、主堡等）开火时使用的「攻击者」数据 */
const TOWER_ATTACKER = { vs: null, vsBld: 0, siege: false };

/** 出手时枪口的烟：火药类投射物才有，返回烟的大小，0 表示不冒烟 */
function smokeSize(proj: number): number {
  return proj === P_BULLET ? 1 : proj === P_BALL || proj === P_ROCKET ? 2.2 : 0;
}

/** 按武器出手：主武器与对建筑武器共用 w.cd，副武器用 w.auxCd */
export function strike(w: World, i: number, d: UnitDef, wp: Weapon, tgt: number, tt: number): void {
  const lv = w.level[i];
  const main = wp.role === WR_MAIN;
  let dm = 1;
  // 加伤与高地加成只有主武器吃
  if (main && d.traits & TR_BUSHIDO) dm += 0.5 * (1 - w.hp[i] / w.maxHp[i]);
  const cd = wp.lvCd[lv] * (0.9 + w.rng.next() * 0.2);
  if (wp.role === WR_AUX) w.auxCd[i] = cd;
  else w.cd[i] = cd;
  w.atkAnim[i] = 0.3;
  const tm = w.team[i];
  const base = wp.lvDmg[lv];
  if (!wp.melee) {
    if (main && tt === T_HILL) dm *= 1.15;
    let tx: number, ty: number;
    if (tgt >= 0) {
      tx = w.x[tgt];
      ty = w.y[tgt];
    } else {
      const b = w.buildings[-tgt - 2];
      if (wp.role === WR_BUILDING) {
        // 扔火把：落在贴着自己的那一边
        const ux = w.x[i], uy = w.y[i];
        tx = ux < b.x0 ? b.x0 + 6 : ux > b.x1 ? b.x1 - 6 : ux;
        ty = uy < b.y0 ? b.y0 + 6 : uy > b.y1 ? b.y1 - 6 : uy;
      } else {
        tx = b.cx;
        ty = b.cy;
      }
    }
    spawnProj(w, w.x[i], w.y[i], tgt, tx, ty, wp.proj, base * dm, wp.atk, wp.splash, wp.pen, d.idx, tm, i);
    if (main) {
      w.addFx(FX_SHOT, w.x[i], w.y[i], wp.proj);
      const smoke = smokeSize(wp.proj);
      if (smoke > 0) w.addFx(FX_SMOKE, w.x[i] + w.facing[i] * 8, w.y[i] - 10, smoke);
    }
  } else {
    const dmg = base * dm;
    if (tgt >= 0) {
      if ((w.uid[i] + w.tickCount) % 3 === 0) w.addFx(FX_HIT, (w.x[i] + w.x[tgt]) / 2, (w.y[i] + w.y[tgt]) / 2 - 8, 0);
      if (wp.splash > 0) splashDamage(w, w.x[tgt], w.y[tgt], wp.splash, dmg, wp.atk, wp.pen, d, tm, i, false);
      else damageUnit(w, tgt, dmg, wp.atk, wp.pen, d.vs, tm, i);
    } else damageBuilding(w, w.buildings[-tgt - 2], dmg, wp.atk, d.vsBld, tm, d.siege);
  }
}

/** 强度对比式：打击强度 d 对上有效护甲 armor（已计破甲）后的伤害。单位与建筑共用，不设保底 */
export function mitigate(d: number, armor: number): number {
  return d > 0 ? d * d / (d + RULES.combat.armorScale * armor) : 0;
}

export function damageUnit(w: World, j: number, raw: number, atk: number, pen: number, vs: ArrayLike<number> | null, ateam: number,
  aslot: number): void {
  const td = w.defs[w.type[j]];
  const lv = w.level[j];
  let arm = atk === A_MELEE ? td.lvArmM[lv] : atk === A_PIERCE ? td.lvArmP[lv] : 0;
  // 雪天在据点之外：手脚冻僵，防御打折
  if (w.env.snowing && !w.sheltered[j]) arm *= RULES.env.snowArmor;
  const routed = (w.state[j] & S_ROUT) !== 0;
  // 溃兵不计护甲；其余按强度对比式：打击强度 d 对上护甲，没有保底
  const d0 = vs ? raw * vs[td.idx] : raw;
  let dmg = routed ? d0 * RULES.morale.routDamage : mitigate(d0, arm * (1 - pen));
  if (atk === A_PIERCE) {
    if (td.traits & TR_TESTUDO) dmg *= 0.65;
    dmg *= w.aura[AU_RANGED_TAKEN][j];
    const sh = td.abilities.shield;
    if (sh) {
      if (w.state[j] & S_SHIELD) dmg *= 1 - sh.block;
      // 挨了箭就把盾举起来（正在近战肉搏的腾不出手）
      if (w.engaged[j] !== ENG_CLOSE || !td.melee) w.shieldT[j] = RULES.combat.shieldHold;
    }
    if (w.map.terrain[w.cellAt(w.x[j], w.y[j])] === T_FOREST) dmg *= 0.75;
    // 城墙上有垛口掩护
    if (w.state[j] & S_WALL) dmg *= RULES.siege.wallCover;
  }
  // 等级的防御加成
  if (lv > 0) dmg /= 1 + LEVELS.def * lv;
  w.hp[j] -= dmg;
  w.flash[j] = 0.12;
  w.combatT[j] = RULES.combat.linger;
  const live = aslot >= 0 && w.alive[aslot] === 1 && w.team[aslot] !== w.team[j];
  if (live) {
    // 记下最近打过它的两个人，阵亡时算助攻
    const o = j * 2, u = w.uid[aslot];
    if (w.hitBy[o] !== aslot || w.hitByUid[o] !== u) {
      w.hitBy[o + 1] = w.hitBy[o];
      w.hitByUid[o + 1] = w.hitByUid[o];
      w.hitByTick[o + 1] = w.hitByTick[o];
      w.hitBy[o] = aslot;
      w.hitByUid[o] = u;
    }
    w.hitByTick[o] = w.tickCount;
  }
  if (w.hp[j] <= 0) {
    kill(w, j, ateam, live ? aslot : NONE);
    return;
  }
  // 挨打还击
  if (w.target[j] !== NONE || w.order[j] === O_MOVE || w.order[j] === O_ATTACK || w.ignoreT[j] > 0 || w.state[j] & S_ROUT) return;
  if (live) {
    // 待命的近战单位不去追岗位之外的射手，免得被一路引走
    if (w.order[j] === O_IDLE && td.melee
      && (w.x[aslot] - w.homeX[j]) ** 2 + (w.y[aslot] - w.homeY[j]) ** 2 > RULES.combat.leash ** 2) return;
    w.target[j] = aslot;
    w.targetUid[j] = w.uid[aslot];
  } else if (aslot < NONE && w.order[j] !== O_HOLD && (td.melee || td.humanoid || td.vsBld >= 2)) {
    // 被哨塔射中：打得动它、离岗位又不远，就上去拆
    const b = w.buildings[-aslot - 2];
    if (!canAttackBuilding(b, w.team[j], td.siege)) return;
    // 刚因为挤不到跟前而放下的那座不回头去拆（放下两座之后是哪座都不去），否则塔楼每射中一次就把人叫回来一次
    if (bldSkipped(w, j, b.id)) return;
    if (w.order[j] === O_IDLE && (b.cx - w.homeX[j]) ** 2 + (b.cy - w.homeY[j]) ** 2 > RULES.combat.leash ** 2) return;
    w.target[j] = aslot;
  }
}

function addXp(w: World, i: number, amount: number): void {
  const th = LEVELS.thresholds;
  w.xp[i] += amount;
  let lv = w.level[i];
  const d = w.defs[w.type[i]];
  while (lv + 1 < th.length && w.xp[i] >= th[lv + 1]) {
    lv++;
    // 升级：生命上限提高，并补上新增的那部分
    const gain = d.lvHp[lv] - d.lvHp[lv - 1];
    w.hp[i] += gain;
    w.maxHp[i] += gain;
    w.morale[i] = Math.min(100, w.morale[i] + 10);
    w.addFx(FX_LEVEL, w.x[i], w.y[i], lv);
  }
  w.level[i] = lv;
}

export function kill(w: World, j: number, ateam: number, killer: number): void {
  const tm = w.team[j];
  const d = w.defs[w.type[j]];
  w.lost[tm]++;
  w.kills[ateam]++;
  // 经验：击杀者拿全额，最近打过它的其他人算助攻
  if (killer >= 0) addXp(w, killer, d.xpValue);
  const win = RULES.xp.assistWindow * 30;
  for (let k = 0; k < 2; k++) {
    const a = w.hitBy[j * 2 + k];
    if (a < 0 || a === killer || !w.alive[a] || w.uid[a] !== w.hitByUid[j * 2 + k]) continue;
    if (w.tickCount - w.hitByTick[j * 2 + k] <= win) addXp(w, a, d.xpValue * RULES.xp.assist);
  }
  // 战友阵亡对附近的人是一次冲击
  const mc = RULES.morale.cell;
  w.mShock[tm][((w.y[j] / mc) | 0) * w.mw + ((w.x[j] / mc) | 0)] += RULES.morale.shock;
  const c = w.corpseN++ % MAX_CORPSE;
  w.cX[c] = w.x[j];
  w.cY[c] = w.y[j];
  w.cType[c] = w.type[j];
  w.cTeam[c] = tm;
  w.cFace[c] = w.facing[j];
  w.cDir[c] = w.dir[j];
  w.cTick[c] = w.tickCount;
  w.addFx(FX_DEATH, w.x[j], w.y[j], w.rad[j]);
  w.removeUnit(j);
}

export function splashDamage(w: World, cx: number, cy: number, radius: number, dmg: number, atk: number, pen: number,
  ad: { vs: ArrayLike<number> | null; vsBld: number; siege: boolean }, ateam: number, aslot: number, hitBuilding: boolean): void {
  const gw = w.gw, gh = w.gh, cs = w.cellStart, items = w.items;
  const reach = radius + 15;
  let gx0 = ((cx - reach) / GRID) | 0, gx1 = ((cx + reach) / GRID) | 0;
  let gy0 = ((cy - reach) / GRID) | 0, gy1 = ((cy + reach) / GRID) | 0;
  if (gx0 < 0) gx0 = 0;
  if (gy0 < 0) gy0 = 0;
  if (gx1 >= gw) gx1 = gw - 1;
  if (gy1 >= gh) gy1 = gh - 1;
  for (let gy = gy0; gy <= gy1; gy++) {
    const k1 = cs[gy * gw + gx1 + 1];
    for (let k = cs[gy * gw + gx0]; k < k1; k++) {
      const j = items[k];
      if (!w.alive[j] || w.team[j] === ateam) continue;
      const dist = Math.hypot(w.x[j] - cx, w.y[j] - cy) - w.rad[j];
      if (dist > radius) continue;
      damageUnit(w, j, dmg * (1 - 0.6 * Math.max(0, dist) / radius), atk, pen, ad.vs, ateam, aslot);
    }
  }
  if (hitBuilding && cx > 0 && cy > 0 && cx < w.W && cy < w.H) {
    const bid = w.nav.bld[w.cellAt(cx, cy)];
    if (bid >= 0 && w.buildings[bid].owner !== ateam) damageBuilding(w, w.buildings[bid], dmg, atk, ad.vsBld, ateam, ad.siege);
  }
}

/** @param canFort 攻击者是否为工程类；不是的话打不动石质城防（城墙） */
export function damageBuilding(w: World, b: Building, raw: number, atk: number, vsBld: number, ateam: number,
  canFort = true): void {
  if (!b.alive) return;
  const def = b.def;
  // 普通建筑不可被攻击（投射物与范围伤害也不伤它）；城防工事只有工程类打得动
  if (!def.hittable || (def.fort && !canFort)) return;
  const S = RULES.siege;
  const arm = atk === A_MELEE ? def.armM + b.armor : atk === A_PIERCE ? def.armP + b.armor : 0;
  // 火把：木头一点就着，石头房子烧得慢，门楼与角楼更慢
  const dmg = atk === A_FIRE ? raw * (def.wood ? S.wood : b.gate || def.kind === BK_TOWER ? S.gate : S.stone) : mitigate(raw * vsBld, arm);
  b.hp -= dmg;
  b.hitTick = w.tickCount;
  if (b.hp <= 0) destroyBuilding(w, b, ateam);
}

function destroyBuilding(w: World, b: Building, ateam: number): void {
  b.alive = false;
  b.hp = 0;
  w.nav.refresh(b);
  w.addFx(FX_COLLAPSE, b.cx, b.cy, Math.max(b.w, b.h));
  if (b.site < 0) return;
  const s = w.sites[b.site];
  // 中央建筑被毁只会终止援军（见 updateSites），据点照旧归原主；只有临时据点例外：行营被毁，这座据点就没了
  if (s.main !== b.id || SITE_INFO[s.type].category !== 'outpost') return;
  s.gone = true;
  s.owner = s.capTeam = 0;
  s.cap = 0;
  for (const id of s.buildings) {
    const o = w.buildings[id];
    o.owner = 0;
    if (o.alive) w.nav.refresh(o);
  }
  w.events.push({ kind: 'razed', site: s.id, team: ateam });
}

// ---------------------------------------------------------------- 投射物
export function spawnProj(w: World, sx: number, sy: number, tgt: number, tx: number, ty: number, ptype: number, dmg: number,
  atk: number, splash: number, pen: number, defIdx: number, tm: number, src: number): void {
  if (w.pn >= MAX_PROJ) return;
  const p = w.pn++;
  const env = w.env, E = RULES.env, wind = env.wind;
  let miss = 0;
  if (splash > 0 && tgt >= 0) {
    // 抛射武器打预判落点，带散布
    const lead = Math.hypot(tx - sx, ty - sy) / PROJ_SPEED[ptype];
    tx += w.vx[tgt] * lead * 0.7 + (w.rng.next() - 0.5) * splash * 0.9;
    ty += w.vy[tgt] * lead * 0.7 + (w.rng.next() - 0.5) * splash * 0.9;
  }
  if (wind > 0) {
    const wx = Math.cos(env.windDir), wy = Math.sin(env.windDir);
    const dx = tx - sx, dy = ty - sy, dist = Math.sqrt(dx * dx + dy * dy) || 1;
    if (splash > 0) {
      // 器械的落点整体顺风偏
      tx += wx * wind * E.windDrift * dist;
      ty += wy * wind * E.windDrift * dist;
    } else if (tgt >= 0 && atk !== A_FIRE) {
      // 直射的箭：侧风、顶风会让它偏出去落空
      const ux = dx / dist, uy = dy / dist;
      const along = ux * wx + uy * wy, cross = ux * wy - uy * wx;
      const p = wind * Math.min(1, dist / E.windMissDist) * (E.windMiss * Math.abs(cross) + E.windHeadMiss * Math.max(0, -along));
      if (w.rng.next() < p) {
        miss = 1;
        // 偏到目标的下风侧（垂直于弹道的那一侧），离目标足够远
        // 弹道的法向 n = (−uy, ux)；风在 n 上的分量是 −cross，往那一侧偏（正顶风时随机一侧）
        const c = -cross, side = c > 0.05 ? 1 : c < -0.05 ? -1 : w.rng.next() < 0.5 ? 1 : -1;
        const off = 18 + 26 * wind + w.rng.next() * 14;
        tx += -uy * side * off + wx * off * 0.3;
        ty += ux * side * off + wy * off * 0.3;
      }
    }
  }
  w.pType[p] = ptype;
  w.pSx[p] = sx;
  w.pSy[p] = sy;
  w.pTx[p] = tx;
  w.pTy[p] = ty;
  w.pT[p] = 0;
  w.pDur[p] = Math.max(0.08, Math.hypot(tx - sx, ty - sy) / PROJ_SPEED[ptype]);
  w.pDmg[p] = dmg;
  w.pAtk[p] = atk;
  w.pSplash[p] = splash;
  w.pPen[p] = pen;
  w.pDef[p] = defIdx;
  w.pTeam[p] = tm;
  w.pTgt[p] = tgt;
  w.pTgtUid[p] = tgt >= 0 ? w.uid[tgt] : 0;
  w.pSrc[p] = src;
  w.pSrcUid[p] = src >= 0 ? w.uid[src] : 0;
  w.pMiss[p] = miss;
}

export function updateProjectiles(w: World): void {
  for (let p = 0; p < w.pn; p++) {
    w.pT[p] += DT;
    const tgt = w.pTgt[p];
    const splash = w.pSplash[p];
    const live = tgt >= 0 && w.alive[tgt] === 1 && w.uid[tgt] === w.pTgtUid[p];
    const miss = w.pMiss[p] === 1;
    if (live && splash === 0 && !miss) {
      // 直射武器追踪目标
      w.pTx[p] = w.x[tgt];
      w.pTy[p] = w.y[tgt];
    }
    if (w.pT[p] < w.pDur[p]) continue;
    const tm = w.pTeam[p];
    const ad = w.pDef[p] >= 0 ? w.defs[w.pDef[p]] : TOWER_ATTACKER;
    let src = w.pSrc[p];
    if (src >= 0 && (!w.alive[src] || w.uid[src] !== w.pSrcUid[p])) src = NONE;
    const ix = w.pTx[p], iy = w.pTy[p];
    if (tgt < NONE) {
      const b = w.buildings[-tgt - 2];
      damageBuilding(w, b, w.pDmg[p], w.pAtk[p], ad.vsBld, tm, ad.siege);
      if (w.pAtk[p] === A_FIRE) w.addFx(FX_FIRE, ix, iy, 1);
      else if (splash > 0) {
        splashDamage(w, ix, iy, splash, w.pDmg[p], w.pAtk[p], w.pPen[p], ad, tm, src, false);
        w.addFx(FX_EXPLODE, ix, iy, splash);
      } else w.addFx(FX_ARROW_HIT, ix + (w.rng.next() - 0.5) * 20, iy + (w.rng.next() - 0.5) * 20, 0);
    } else if (splash > 0) {
      splashDamage(w, ix, iy, splash, w.pDmg[p], w.pAtk[p], w.pPen[p], ad, tm, src, true);
      w.addFx(FX_EXPLODE, ix, iy, splash);
    } else if (live && !miss) {
      damageUnit(w, tgt, w.pDmg[p], w.pAtk[p], w.pPen[p], ad.vs, tm, src);
    }
    // 删除：末尾元素补位
    const q = --w.pn;
    if (p !== q) {
      w.pType[p] = w.pType[q];
      w.pSx[p] = w.pSx[q];
      w.pSy[p] = w.pSy[q];
      w.pTx[p] = w.pTx[q];
      w.pTy[p] = w.pTy[q];
      w.pT[p] = w.pT[q];
      w.pDur[p] = w.pDur[q];
      w.pDmg[p] = w.pDmg[q];
      w.pAtk[p] = w.pAtk[q];
      w.pSplash[p] = w.pSplash[q];
      w.pPen[p] = w.pPen[q];
      w.pDef[p] = w.pDef[q];
      w.pTeam[p] = w.pTeam[q];
      w.pTgt[p] = w.pTgt[q];
      w.pTgtUid[p] = w.pTgtUid[q];
      w.pSrc[p] = w.pSrc[q];
      w.pSrcUid[p] = w.pSrcUid[q];
      w.pMiss[p] = w.pMiss[q];
    }
    p--;
  }
}

// ---------------------------------------------------------------- 防御建筑放箭
/**
 * 防御建筑（角楼、哨塔等）找射击目标：有主的打对方的单位；中立的两边都打，且不受视野限制（中立方没有视野）。
 * 返回离这座建筑最近、距离不小于 minRange 的单位。
 */
function towerFind(w: World, b: Building, maxR: number, minRange: number): number {
  if (b.owner) return w.findEnemy(b.cx, b.cy, b.owner, maxR, minRange);
  const a = w.findEnemy(b.cx, b.cy, 1, maxR, minRange, false), c = w.findEnemy(b.cx, b.cy, 2, maxR, minRange, false);
  if (a === NONE || c === NONE) return a === NONE ? c : a;
  return (w.x[a] - b.cx) ** 2 + (w.y[a] - b.cy) ** 2 <= (w.x[c] - b.cx) ** 2 + (w.y[c] - b.cy) ** 2 ? a : c;
}

export function updateTowers(w: World): void {
  for (const b of w.armed) {
    const tw = b.tower;
    if (!tw || !b.alive || b.down) continue;
    b.cd -= DT;
    if (b.cd > 0) continue;
    // 顺风射得远、顶风射得近：先按最远的可能找，再按那个方向的实际射程核对
    const maxR = tw.range * (1 + RULES.env.windRange * w.env.wind);
    let e = towerFind(w, b, maxR, 0);
    if (e !== NONE) {
      const dx = w.x[e] - b.cx, dy = w.y[e] - b.cy;
      if (dx * dx + dy * dy > (tw.range * windRangeMul(w, dx, dy)) ** 2) e = NONE;
    }
    if (e === NONE) {
      b.cd = 0.4;
      continue;
    }
    b.cd = tw.cd;
    for (const wp of tw.weapons) {
      // fan：各发由近及远往外找（minRange 取上一个目标的距离），射程内找不到更多的就都射最近那个
      let tgt = e;
      for (let k = 0; k < wp.burst; k++) {
        spawnProj(w, b.cx, b.y0 - b.def.tall * 0.6, tgt, w.x[tgt], w.y[tgt], wp.proj, wp.dmg, wp.atk, wp.splash, wp.pen, -1, b.owner, -b.id - 2);
        if (!wp.fan || k + 1 >= wp.burst) continue;
        const near = Math.hypot(w.x[tgt] - b.cx, w.y[tgt] - b.cy) + 0.01;
        let nx = near < maxR ? towerFind(w, b, maxR, near) : NONE;
        if (nx !== NONE) {
          const dx = w.x[nx] - b.cx, dy = w.y[nx] - b.cy;
          if (dx * dx + dy * dy > (tw.range * windRangeMul(w, dx, dy)) ** 2) nx = NONE;
        }
        tgt = nx !== NONE ? nx : e;
      }
      w.addFx(FX_SHOT, b.cx, b.cy, wp.proj);
      const smoke = smokeSize(wp.proj);
      if (smoke > 0) w.addFx(FX_SMOKE, b.cx, b.cy - 10, smoke);
    }
  }
}
