/**
 * 士气与溃逃。每个单位的士气朝一个「应有水平」靠拢，这个水平由局部兵力对比、伤亡、全局形势、
 * 据点、粮草、天气等因素加减得出；跌破该等级的阈值就溃逃。
 */
import { DT, RULES, SITE_HQ, TILE } from '../content';
import { NONE, O_IDLE, O_MOVE, S_CHARGE, S_ROUT } from '../state';
import type { World } from '../world';

export const MORALE_EVERY = 16;

/** 当前环境给全队士气带来的加减（不含单位自身与局部因素），界面用它列出原因 */
export function teamMoraleFactors(w: World, tm: number): { key: string; label: string; value: number }[] {
  const M = RULES.morale;
  const out: { key: string; label: string; value: number }[] = [];
  const tot = w.power[1] + w.power[2];
  if (tot > 0) {
    const g = Math.round((w.power[tm] / tot - 0.5) * 2 * M.global);
    if (g) out.push({ key: 'global', label: g > 0 ? '兵力占优' : '兵力劣势', value: g });
  }
  let own = 0, any = false;
  for (const s of w.sites) {
    if (s.type === SITE_HQ) continue;
    any = true;
    if (s.owner === tm && !s.disabled) own++;
  }
  if (any) {
    if (own === 0) out.push({ key: 'sites', label: '没有据点', value: M.noSite });
    else out.push({ key: 'sites', label: `据点 ×${own}`, value: Math.min(M.siteMax, M.perSite * own) });
  }
  if (w.upkeep0[tm] > 0) {
    if (w.hunger[tm] > 0.01) out.push({ key: 'food', label: '断粮', value: -Math.round(w.hunger[tm] * M.hunger) });
    else if (w.food[tm] > w.foodCap[tm] * RULES.supply.surplusAt) out.push({ key: 'food', label: '粮草充足', value: M.surplus });
  }
  if (w.env.raining) out.push({ key: 'rain', label: '下雨', value: M.rain });
  if (w.env.night) out.push({ key: 'night', label: '夜间', value: M.night });
  return out;
}

export function updateMorale(w: World): void {
  const M = RULES.morale;
  const dtS = MORALE_EVERY * DT;
  const mw = w.mw, mh = w.mh, mc = M.cell;
  const decay = 1 - M.shockDecay * dtS;
  for (let tm = 1; tm <= 2; tm++) {
    const sh = w.mShock[tm];
    for (let c = 0; c < sh.length; c++) sh[c] *= decay;
    w.mPow[tm].fill(0);
    w.mRout[tm].fill(0);
    w.mCharge[tm].fill(0);
    w.power[tm] = 0;
  }
  const n = w.n, alive = w.alive, team = w.team, state = w.state, defs = w.defs, type = w.type;
  for (let i = 0; i < n; i++) {
    if (!alive[i]) continue;
    const tm = team[i];
    const c = ((w.y[i] / mc) | 0) * mw + ((w.x[i] / mc) | 0);
    if (state[i] & S_ROUT) {
      w.mRout[tm][c]++;
      continue;
    }
    const p = defs[type[i]].power * (1 + 0.15 * w.level[i]);
    w.mPow[tm][c] += p;
    w.power[tm] += p;
    if (state[i] & S_CHARGE) {
      w.mCharge[tm][c] = 1;
      const t = w.target[i];
      if (t >= 0) w.mCharge[tm][((w.y[t] / mc) | 0) * mw + ((w.x[t] / mc) | 0)] = 1;
    }
  }
  const teamBase = [0, 0, 0];
  for (let tm = 1; tm <= 2; tm++) for (const f of teamMoraleFactors(w, tm)) teamBase[tm] += f.value;

  const sum = [0, 0, 0], cnt = [0, 0, 0];
  const routed = [0, 0, 0], rx = [0, 0, 0], ry = [0, 0, 0];
  const near2 = M.nearSiteRadius * M.nearSiteRadius;
  for (let i = 0; i < n; i++) {
    if (!alive[i]) continue;
    if (w.steadyT[i] > 0) w.steadyT[i] -= dtS;
    if (state[i] & S_ROUT) continue;
    const tm = team[i], en = 3 - tm;
    const d = defs[type[i]];
    const ux = w.x[i], uy = w.y[i];
    const cx = (ux / mc) | 0, cy = (uy / mc) | 0;
    let al = 0, ep = 0, shock = 0, rout = 0;
    for (let yy = cy - 1; yy <= cy + 1; yy++) {
      if (yy < 0 || yy >= mh) continue;
      for (let xx = cx - 1; xx <= cx + 1; xx++) {
        if (xx < 0 || xx >= mw) continue;
        const c = yy * mw + xx;
        al += w.mPow[tm][c];
        ep += w.mPow[en][c];
        shock += w.mShock[tm][c];
        rout += w.mRout[tm][c];
      }
    }
    const lv = w.level[i];
    let target = M.base + d.discipline + lv * M.perLevel + teamBase[tm];
    if (ep > 0) {
      const r = al / (al + ep) - 0.5;
      target += r >= 0 ? (r * 2 * M.local) / 3 : r * 2 * M.local;
    }
    target -= Math.min(M.shockMax, shock);
    target -= M.wounded * (1 - w.hp[i] / w.maxHp[i]);
    target -= Math.min(M.contagionMax, M.contagion * rout);
    for (const s of w.sites) {
      if (s.owner !== tm || s.disabled) continue;
      const dx = s.x - ux, dy = s.y - uy;
      if (dx * dx + dy * dy < near2) {
        target += M.nearSite;
        break;
      }
    }
    let m = w.morale[i];
    if (target > m) m = Math.min(target, m + M.rise * dtS);
    else m = Math.max(target, m - M.fall * dtS);
    m = m < 0 ? 0 : m > 100 ? 100 : m;
    w.morale[i] = m;
    sum[tm] += m;
    cnt[tm]++;
    if (m < d.lvRout[lv] && w.steadyT[i] <= 0) {
      startRout(w, i);
      routed[tm]++;
      rx[tm] += ux;
      ry[tm] += uy;
    }
  }
  for (let tm = 1; tm <= 2; tm++) {
    if (cnt[tm]) w.avgMorale[tm] = sum[tm] / cnt[tm];
    if (routed[tm]) w.events.push({ kind: 'rout', team: tm, count: routed[tm], x: rx[tm] / routed[tm], y: ry[tm] / routed[tm] });
  }
}

/** 溃兵往哪逃：最近的己方据点；一个都没有就逃向最近的地图边缘 */
function pickRefuge(w: World, i: number): void {
  const tm = w.team[i], ux = w.x[i], uy = w.y[i];
  let best = 1e18, id = -1;
  for (const s of w.sites) {
    if (s.owner !== tm || s.disabled) continue;
    const d = (s.x - ux) ** 2 + (s.y - uy) ** 2;
    if (d < best) {
      best = d;
      id = s.id;
    }
  }
  let tx: number, ty: number;
  if (id >= 0) {
    tx = w.sites[id].x;
    ty = w.sites[id].y;
  } else {
    const l = ux, r = w.W - ux, t = uy, b = w.H - uy;
    const m = Math.min(l, r, t, b);
    tx = m === l ? TILE * 1.5 : m === r ? w.W - TILE * 1.5 : ux;
    ty = m === l || m === r ? uy : m === t ? TILE * 1.5 : w.H - TILE * 1.5;
  }
  w.routSite[i] = id;
  const cell = w.nav.nearestFree(tm, w.cellAt(tx, ty));
  w.destX[i] = tx;
  w.destY[i] = ty;
  w.destCell[i] = cell;
  w.field[i] = w.lineBlocked(ux, uy, tx, ty, w.nav.block[tm]) ? w.nav.getField(tm, cell, w.tickCount) : null;
}

export function startRout(w: World, i: number): void {
  if (w.state[i] & S_ROUT) return;
  w.state[i] = S_ROUT;
  w.routing[w.team[i]]++;
  w.order[i] = O_MOVE;
  w.target[i] = w.otarget[i] = NONE;
  w.chargeT[i] = w.braceT[i] = w.shieldT[i] = w.waitT[i] = 0;
  w.grpSpeed[i] = 0;
  w.stuck[i] = 0;
  pickRefuge(w, i);
}

/** 逃到己方据点：重整旗鼓，恢复控制 */
export function rallyUnit(w: World, i: number): void {
  const tm = w.team[i];
  w.state[i] = 0;
  w.routing[tm]--;
  w.morale[i] = Math.max(w.morale[i], RULES.morale.rally);
  w.steadyT[i] = RULES.morale.steady;
  w.order[i] = O_IDLE;
  w.homeX[i] = w.x[i];
  w.homeY[i] = w.y[i];
  w.field[i] = null;
  w.stuck[i] = 0;
}

/**
 * 溃兵每帧的去向。返回 false 表示它已经离场（逃出地图）。
 * 结果写在 FLEE 里：朝哪个方向跑（单位向量），是否已到达。
 */
export const FLEE = { x: 0, y: 0 };
export function fleeStep(w: World, i: number, cell: number): boolean {
  const tm = w.team[i], ux = w.x[i], uy = w.y[i];
  let site = w.routSite[i];
  if (site >= 0) {
    const s = w.sites[site];
    if (s.owner !== tm || s.disabled) {
      pickRefuge(w, i);
      site = w.routSite[i];
    }
  } else if (((i + w.tickCount) & 63) === 0) {
    // 逃往地图边缘的途中，己方又有了据点就改去那里
    pickRefuge(w, i);
    site = w.routSite[i];
  }
  const dx = w.destX[i] - ux, dy = w.destY[i] - uy;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
  if (site >= 0) {
    if (dist < RULES.morale.rallyRadius) {
      rallyUnit(w, i);
      FLEE.x = FLEE.y = 0;
      return true;
    }
  } else if (dist < TILE * 1.5 || ux < TILE * 2 || uy < TILE * 2 || ux > w.W - TILE * 2 || uy > w.H - TILE * 2) {
    // 逃出战场：算作损失，但不是任何人的战果
    w.lost[tm]++;
    w.deserted[tm]++;
    w.removeUnit(i);
    return false;
  }
  let f = w.field[i];
  if (f) {
    if (f.dead) f = w.field[i] = w.nav.getField(tm, f.cell, w.tickCount);
    f.lastUse = w.tickCount;
    const dir = f.dirs[cell];
    if (dir < 8) {
      const k = dir & 1 ? 0.7071 : 1;
      FLEE.x = DX[dir] * k;
      FLEE.y = DY[dir] * k;
      return true;
    }
  }
  FLEE.x = dx / dist;
  FLEE.y = dy / dist;
  if (!f && w.stuck[i] > 1) {
    w.field[i] = w.nav.getField(tm, w.destCell[i], w.tickCount);
    w.stuck[i] = 0;
  }
  return true;
}
const DX = [1, 1, 0, -1, -1, -1, 0, 1], DY = [0, 1, 1, 1, 0, -1, -1, -1];
