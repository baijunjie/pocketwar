/** 战斗结算：出手、伤害、阵亡、经验与升级、投射物、箭楼 */
import {
  A_FIRE, A_MELEE, A_PIERCE, BK_TOWER, DT, LEVELS, P_TORCH, PROJ_SPEED, P_BALL, P_BULLET, P_ROCKET, RULES, SITE_HQ, TR_BUSHIDO, TR_TESTUDO, TR_TRAMPLE,
  T_FOREST, T_HILL, UnitDef,
} from '../content';
import { FX_ARROW_HIT, FX_COLLAPSE, FX_DEATH, FX_EXPLODE, FX_HIT, FX_LEVEL, FX_SMOKE, GRID, MAX_CORPSE, MAX_PROJ, NONE, O_ATTACK, O_IDLE, O_MOVE, S_ROUT, S_SHIELD, S_WALL, FX_FIRE, FX_SHOT } from '../state';
import type { Building, World } from '../world';

/** 箭楼 / 主堡开火时使用的「攻击者」数据 */
const TOWER_ATTACKER = { vs: new Array<number>(64).fill(1), vsBld: 0, siege: false };

export function attack(w: World, i: number, d: UnitDef, tgt: number, tt: number): void {
  const lv = w.level[i];
  let dm = 1;
  if (d.traits & TR_BUSHIDO) dm += 0.5 * (1 - w.hp[i] / w.maxHp[i]);
  w.cd[i] = d.lvCd[lv] * (0.9 + w.rng.next() * 0.2);
  w.atkAnim[i] = 0.3;
  const tm = w.team[i];
  const base = d.lvDmg[lv];
  if (tgt < 0 && d.humanoid) {
    // 人打建筑：扔火把
    const S = RULES.siege;
    const b = w.buildings[-tgt - 2];
    const ux = w.x[i], uy = w.y[i];
    w.cd[i] = S.torchCd * (0.9 + w.rng.next() * 0.2);
    spawnProj(w, ux, uy, tgt, ux < b.x0 ? b.x0 + 6 : ux > b.x1 ? b.x1 - 6 : ux, uy < b.y0 ? b.y0 + 6 : uy > b.y1 ? b.y1 - 6 : uy,
      P_TORCH, S.torchDmg * (1 + LEVELS.dmg * lv), A_FIRE, 0, 0, d.idx, tm, i);
    return;
  }
  if (d.range > 0) {
    if (tt === T_HILL) dm *= 1.15;
    let tx: number, ty: number;
    if (tgt >= 0) {
      tx = w.x[tgt];
      ty = w.y[tgt];
    } else {
      const b = w.buildings[-tgt - 2];
      tx = b.cx;
      ty = b.cy;
    }
    spawnProj(w, w.x[i], w.y[i], tgt, tx, ty, d.proj, base * dm, d.atk, d.splash, d.pen, d.idx, tm, i);
    w.addFx(FX_SHOT, w.x[i], w.y[i], d.proj);
    if (d.proj === P_BULLET || d.proj === P_BALL || d.proj === P_ROCKET) {
      w.addFx(FX_SMOKE, w.x[i] + w.facing[i] * 8, w.y[i] - 10, d.proj === P_BULLET ? 1 : 2.2);
    }
  } else {
    const dmg = base * dm;
    if (tgt >= 0) {
      if ((w.uid[i] + w.tickCount) % 3 === 0) w.addFx(FX_HIT, (w.x[i] + w.x[tgt]) / 2, (w.y[i] + w.y[tgt]) / 2 - 8, 0);
      if (d.traits & TR_TRAMPLE) splashDamage(w, w.x[tgt], w.y[tgt], 28, dmg, A_MELEE, 0, d, tm, i, false);
      else damageUnit(w, tgt, dmg, A_MELEE, 0, d.vs, tm, i);
    } else damageBuilding(w, w.buildings[-tgt - 2], dmg, A_MELEE, d.vsBld, tm, d.siege);
  }
}

export function damageUnit(w: World, j: number, raw: number, atk: number, pen: number, vs: number[], ateam: number,
  aslot: number): void {
  const td = w.defs[w.type[j]];
  const lv = w.level[j];
  const arm = atk === A_MELEE ? td.lvArmM[lv] : atk === A_PIERCE ? td.lvArmP[lv] : 0;
  const routed = (w.state[j] & S_ROUT) !== 0;
  let dmg = routed ? raw * vs[td.cls] * RULES.morale.routDamage : raw * vs[td.cls] - arm * (1 - pen);
  if (atk === A_PIERCE) {
    if (td.traits & TR_TESTUDO) dmg *= 0.65;
    const sh = td.abilities.shield;
    if (sh) {
      if (w.state[j] & S_SHIELD) dmg *= 1 - sh.block;
      // 挨了箭就把盾举起来（正在近战肉搏的腾不出手）
      if (!w.engaged[j] || td.range > 0) w.shieldT[j] = RULES.combat.shieldHold;
    }
    if (w.map.terrain[w.cellAt(w.x[j], w.y[j])] === T_FOREST) dmg *= 0.75;
    // 城墙上有垛口掩护
    if (w.state[j] & S_WALL) dmg *= RULES.siege.wallCover;
  }
  if (dmg < 1) dmg = 1;
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
  if (live && w.target[j] === NONE && w.order[j] !== O_MOVE && w.order[j] !== O_ATTACK && w.ignoreT[j] <= 0
    && !(w.state[j] & S_ROUT)) {
    // 待命的近战单位不去追岗位之外的射手，免得被一路引走
    if (w.order[j] === O_IDLE && td.range === 0
      && (w.x[aslot] - w.homeX[j]) ** 2 + (w.y[aslot] - w.homeY[j]) ** 2 > RULES.combat.leash ** 2) return;
    w.target[j] = aslot;
    w.targetUid[j] = w.uid[aslot];
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
  ad: { vs: number[]; vsBld: number; siege: boolean }, ateam: number, aslot: number, hitBuilding: boolean): void {
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

/** @param canFort 攻击者是否为工程类；不是的话打不动城防工事（石墙、石箭楼） */
export function damageBuilding(w: World, b: Building, raw: number, atk: number, vsBld: number, ateam: number,
  canFort = true): void {
  if (!b.alive) return;
  const def = b.def;
  if (def.fort && !canFort) return;
  const S = RULES.siege;
  const arm = atk === A_MELEE ? def.armM : atk === A_PIERCE ? def.armP : 0;
  // 火把：木头一点就着，石头房子烧得慢，门楼与角楼更慢
  let dmg = atk === A_FIRE ? raw * (def.wood ? S.wood : b.gate || def.kind === BK_TOWER ? S.gate : S.stone) : raw * vsBld - arm;
  const min = atk === A_PIERCE ? 0.5 : 1;
  if (dmg < min) dmg = min;
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
  if (s.main !== b.id) return;
  if (s.type === SITE_HQ) {
    if (!w.winner) {
      w.winner = 3 - s.owner;
      w.events.push({ kind: 'gameover', winner: w.winner });
    }
  } else {
    // 主建筑被毁：据点成为无主的废墟，谁重新占领谁就把它修好
    s.disabled = true;
    s.owner = s.capTeam = 0;
    s.cap = 0;
    for (const id of s.buildings) {
      const o = w.buildings[id];
      o.owner = 0;
      if (o.alive) w.nav.refresh(o);
    }
    w.events.push({ kind: 'razed', site: s.id, team: ateam });
  }
}

// ---------------------------------------------------------------- 投射物
export function spawnProj(w: World, sx: number, sy: number, tgt: number, tx: number, ty: number, ptype: number, dmg: number,
  atk: number, splash: number, pen: number, defIdx: number, tm: number, src: number): void {
  if (w.pn >= MAX_PROJ) return;
  const p = w.pn++;
  if (splash > 0 && tgt >= 0) {
    // 抛射武器打预判落点，带散布
    const lead = Math.hypot(tx - sx, ty - sy) / PROJ_SPEED[ptype];
    tx += w.vx[tgt] * lead * 0.7 + (w.rng.next() - 0.5) * splash * 0.9;
    ty += w.vy[tgt] * lead * 0.7 + (w.rng.next() - 0.5) * splash * 0.9;
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
}

export function updateProjectiles(w: World): void {
  for (let p = 0; p < w.pn; p++) {
    w.pT[p] += DT;
    const tgt = w.pTgt[p];
    const splash = w.pSplash[p];
    const live = tgt >= 0 && w.alive[tgt] === 1 && w.uid[tgt] === w.pTgtUid[p];
    if (live && splash === 0) {
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
    } else if (live) {
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
    }
    p--;
  }
}

// ---------------------------------------------------------------- 箭楼
export function updateTowers(w: World): void {
  for (const b of w.armed) {
    if (!b.alive || b.owner === 0) continue;
    b.cd -= DT;
    if (b.cd > 0) continue;
    const tw = b.def.tower!;
    const e = w.findEnemy(b.cx, b.cy, b.owner, tw.range, 0);
    if (e === NONE) {
      b.cd = 0.4;
      continue;
    }
    b.cd = tw.cd;
    spawnProj(w, b.cx, b.y0 - b.def.tall * 0.6, e, w.x[e], w.y[e], 0, tw.dmg, A_PIERCE, 0, 0, -1, b.owner, NONE);
    w.addFx(FX_SHOT, b.cx, b.cy, 0);
  }
}
