import { describe, expect, it } from 'vitest';
import { A_PIERCE, A_SIEGE, ARCHETYPES, HP_SCALE, POSITIONS } from '../../../src/sim/defs';
import { BASE, REF_SHARE, SLOTS, proxySlots, refCounts, refForce, refForcePerHead, slotOf } from '../../../tools/measure/units';

describe('测量工具：位置与顶替', () => {
  it('每个位置都有基准单位；顶替别的位置的位置（直射器械）顶替器械位，其余各占自己', () => {
    expect(Object.keys(BASE).sort()).toEqual(Object.keys(POSITIONS).sort());
    expect(slotOf('bolt')).toBe('siege');
    for (const pos of Object.keys(POSITIONS)) if (pos !== 'bolt') expect(slotOf(pos), pos).toBe(pos);
  });

  it('顶替的位置只给出「被顶替位置换成自己基准单位」的改动，别的位置给空对象', () => {
    expect(proxySlots('bolt')).toEqual({ siege: { unit: BASE.bolt.key } });
    for (const pos of Object.keys(POSITIONS)) if (pos !== 'bolt') expect(proxySlots(pos), pos).toEqual({});
  });
});

describe('测量工具：直射器械不进标准混编军的人数构成', () => {
  it('位置表里没有直射器械，比例之和为 1，标准混编军位置与位置表同一批', () => {
    expect(Object.keys(REF_SHARE)).not.toContain('bolt');
    expect(SLOTS).not.toContain('bolt');
    expect(Object.values(REF_SHARE).reduce((n, x) => n + x, 0)).toBeCloseTo(1, 9);
    expect(SLOTS).toEqual(Object.keys(REF_SHARE));
  });

  it('每人平均占用只按位置表里的位置算：器械位按抛射器械的占用 6.4，直射器械不参与', () => {
    const siege = ARCHETYPES.find(a => a.key === 'siege')!.force;
    const forceOf = (arch: string): number => ARCHETYPES.find(a => a.key === arch)!.force;
    const want = 0.26 * forceOf('inf') + 0.22 * forceOf('inf') + 0.31 * forceOf('ranged') + 0.12 * forceOf('cav') + 0.05 * forceOf('cavr') + 0.03 * siege + 0.01 * forceOf('vehicle');
    expect(siege).toBe(6.4);
    expect(refForcePerHead()).toBeCloseTo(want, 9);
  });

  it('标准混编军的人数构成不变：每个位置的人数与位置表一致，器械位的人数不因直射器械占用 1 而变', () => {
    for (const heads of [100, 300, 1000]) {
      const c = refCounts(refForce(heads));
      expect(Object.keys(c), `${heads}`).toEqual(SLOTS);
      expect(c.siege, `${heads} 人的 siege`).toBe(Math.max(1, Math.round(heads * REF_SHARE.siege)));
    }
  });
});

describe('测量工具：直射器械基准单位', () => {
  it('基准单位取原型基准面板：生命乘全局倍率，穿刺伤害、无范围杀伤、破甲 0；抛射器械基准是攻城伤害、范围杀伤 30', () => {
    const bolt = ARCHETYPES.find(a => a.key === 'bolt')!.panel;
    const d = BASE.bolt;
    expect(d.hp).toBe(Math.round(bolt.hp * HP_SCALE));
    expect([d.dmg, d.cd, d.range]).toEqual([bolt.dmg, bolt.cd, bolt.range]);
    expect(d.atk).toBe(A_PIERCE);
    expect(d.splash).toBe(0);
    expect(d.pen).toBe(0);
    expect(BASE.siege.atk).toBe(A_SIEGE);
    expect(BASE.siege.splash).toBe(30);
  });
});
