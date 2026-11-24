/** 电脑给营寨选兵种：让全军的兵种构成向本文明的开局编制回归 */
import { SITE_INFO, UNITS, UNIT_BY_KEY, forceOf } from '../content';
import { factionUnits } from '../systems/sites';
import type { Site, World } from '../world';

/**
 * 选「在场兵力占比低于开局编制比重最多」的兵种（占比按兵力份数算）。
 * 在场兵力 = 这一队活着的兵（高级形态算在初级形态上）+ 本队其它营寨已选、还没出的下一批；
 * 后者让几座营寨同时选时不扎堆选同一个兵种。比重相同取兵种表里靠前的。
 */
export function pickCampUnit(w: World, team: number, site: Site): number {
  const fac = w.factions[team]!;
  const force = new Map<number, number>();
  let total = 0;
  const add = (idx: number, f: number): void => {
    force.set(idx, (force.get(idx) ?? 0) + f);
    total += f;
  };
  for (let i = 0; i < w.n; i++) {
    if (!w.alive[i] || w.team[i] !== team) continue;
    const d = UNITS[w.type[i]];
    add(d.tier ? d.basic : d.idx, forceOf(d));
  }
  for (const o of w.sites) {
    const info = SITE_INFO[o.type];
    if (o === site || o.gone || o.owner !== team || info.reinf !== 'pick' || o.pick < 0) continue;
    add(o.pick, info.reinfForce);
  }
  const target = new Map(fac.army.map(([key, share]) => [UNIT_BY_KEY[key].idx, share]));
  let best = factionUnits(fac)[0].idx, gap = -Infinity;
  for (const d of factionUnits(fac)) {
    const want = target.get(d.idx) ?? 0;
    const have = total > 0 ? (force.get(d.idx) ?? 0) / total : 0;
    if (want - have > gap + 1e-12) {
      gap = want - have;
      best = d.idx;
    }
  }
  return best;
}
