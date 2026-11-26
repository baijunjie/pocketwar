import { afterEach, describe, expect, it, vi } from 'vitest';
import { FACTION_BUDGET, FACTION_IDS, FACTIONS, RULES, UNITS, factionPoints, isContentUnit, manpowerForBudget, reinfPoints } from '../src/sim/defs';

/** 把对象里所有数（含数组里的）乘上 k，其余原样 */
function scaled<T>(v: T, k: number): T {
  if (typeof v === 'number') return (v * k) as T;
  if (Array.isArray(v)) return v.map(x => scaled(x, k)) as T;
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([n, x]) => [n, scaled(x, k)])) as T;
  return v;
}

afterEach(() => {
  vi.doUnmock('../src/sim/content/rules');
  vi.resetModules();
});

describe('点数只由兵种的级数、特性、编制比重与单价决定，不随战斗、行军规则变', () => {
  it('把规则表（RULES 的各节）里的数值整体乘 1.3 后重新加载：每个兵种的点数、各阵营的阵营点数与援军点数都不变', async () => {
    vi.resetModules();
    vi.doMock('../src/sim/content/rules', async () => {
      const real = await vi.importActual<typeof import('../src/sim/content/rules')>('../src/sim/content/rules');
      const rules = scaled(real.RULES, 1.3);
      return { ...real, RULES: rules };
    });
    const defs = await import('../src/sim/defs');
    // 确认改动确实生效了，不是拿同一份规则比
    expect(defs.RULES.combat.armorScale).toBeCloseTo(RULES.combat.armorScale * 1.3, 9);
    expect(defs.RULES.march).not.toEqual(RULES.march);
    expect(defs.RULES.combat.meleeContact).toBeCloseTo(RULES.combat.meleeContact * 1.3, 9);

    const before = UNITS.filter(isContentUnit).map(d => [d.key, d.points]);
    const after = defs.UNITS.filter(defs.isContentUnit).map(d => [d.key, d.points]);
    expect(after).toEqual(before);
    for (const id of FACTION_IDS) {
      expect(defs.factionPoints(defs.FACTIONS[id]).total, id).toBe(factionPoints(FACTIONS[id]).total);
      expect(defs.reinfPoints(defs.FACTIONS[id]).total, id).toBe(reinfPoints(FACTIONS[id]).total);
      expect(defs.manpowerForBudget(defs.FACTIONS[id], FACTION_BUDGET), id).toBe(manpowerForBudget(FACTIONS[id], FACTION_BUDGET));
    }
  });
});
