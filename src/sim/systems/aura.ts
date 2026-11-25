/**
 * 光环：带光环特性的单位让半径内的其他己方单位获得加成。系统只读兵种上的光环数据（UnitDef.auras），不认具体兵种。
 * 每隔 RULES.aura.interval 秒重新判定一次：先把所有人恢复为无加成，再由每个存活、未溃逃的来源给范围内的己方单位写入加成，
 * 同类光环取最强的一个（不叠加）。来源自己不受益；受益者溃逃时照样受益。
 */
import { AURA_KINDS, RULES, TICK_RATE, auraStronger } from '../content';
import { GRID, S_ROUT } from '../state';
import type { World } from '../world';

/** 每隔多少帧判定一次（由规则表的秒数换算，至少 1 帧） */
export const AURA_EVERY = Math.max(1, Math.round(RULES.aura.interval * TICK_RATE));

export function updateAuras(w: World): void {
  const n = w.n, alive = w.alive, defs = w.defs, type = w.type;
  for (let k = 0; k < AURA_KINDS.length; k++) w.aura[k].fill(AURA_KINDS[k].neutral, 0, n);
  const gw = w.gw, gh = w.gh, cs = w.cellStart, items = w.items;
  for (let i = 0; i < n; i++) {
    if (!alive[i]) continue;
    const auras = defs[type[i]].auras;
    if (!auras.length || w.state[i] & S_ROUT) continue;
    const tm = w.team[i], sx = w.x[i], sy = w.y[i];
    for (const a of auras) {
      const buf = w.aura[a.kind], r = a.radius, r2 = r * r;
      let gx0 = ((sx - r) / GRID) | 0, gx1 = ((sx + r) / GRID) | 0;
      let gy0 = ((sy - r) / GRID) | 0, gy1 = ((sy + r) / GRID) | 0;
      if (gx0 < 0) gx0 = 0;
      if (gy0 < 0) gy0 = 0;
      if (gx1 >= gw) gx1 = gw - 1;
      if (gy1 >= gh) gy1 = gh - 1;
      for (let gy = gy0; gy <= gy1; gy++) {
        const k1 = cs[gy * gw + gx1 + 1];
        for (let k = cs[gy * gw + gx0]; k < k1; k++) {
          const j = items[k];
          if (j === i || !alive[j] || w.team[j] !== tm) continue;
          const dx = w.x[j] - sx, dy = w.y[j] - sy;
          if (dx * dx + dy * dy > r2) continue;
          if (auraStronger(a.kind, a.value, buf[j])) buf[j] = a.value;
        }
      }
    }
  }
}
