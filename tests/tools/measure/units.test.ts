import { describe, expect, it } from 'vitest';
import { AU_RANGED_TAKEN, A_PIERCE, A_SIEGE, ARCHETYPES, HP_SCALE, POSITIONS, RULES, STEP, TRAITS } from '../../../src/sim/defs';
import { BASE, REF_SHARE, SLOTS, proxySlots, refCounts, refForce, refForcePerHead, slotOf, variant } from '../../../tools/measure/units';

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
    expect([d.main.lvDmg[0], d.main.lvCd[0], d.main.range]).toEqual([bolt.dmg, bolt.cd, bolt.range]);
    expect(d.main.atk).toBe(A_PIERCE);
    expect(d.main.splash).toBe(0);
    expect(d.main.pen).toBe(0);
    expect(BASE.siege.main.atk).toBe(A_SIEGE);
    expect(BASE.siege.main.splash).toBe(30);
  });
});

describe('测量工具：变体带上光环特性', () => {
  it('加光环特性的变体带着这个特性的光环，登记成探测单位；基准本身与不加特性的变体没有光环', () => {
    const v = variant(BASE.inf, {}, ['cover']);
    expect(v.auras).toEqual([{ name: TRAITS.cover.name, kind: AU_RANGED_TAKEN, radius: 60, value: 0.8 }]);
    expect(v.probe).toBe(true);
    expect(BASE.inf.auras).toEqual([]);
    expect(variant(BASE.inf, { hp: 1 }).auras).toEqual([]);
  });

  it('在已带光环的单位上改级数、再加别的特性，原有的光环保留，不重复', () => {
    const v = variant(BASE.inf, {}, ['cover']);
    expect(variant(v, { hp: 2 }).auras).toEqual(v.auras);
    expect(variant(v, {}, ['pilum']).auras).toEqual(v.auras);
  });
});

describe('测量工具：变体按武器模型改面板', () => {
  it('攻击距离加级：近战基准的主武器攻击距离在贴身距离上加每级 15 像素，不改伤害与间隔，也不动基准本身', () => {
    const contact = RULES.combat.meleeContact;
    expect(BASE.inf.main.range).toBe(contact);
    const v = variant(BASE.inf, { reach: 1 });
    expect(v.main.range).toBe(contact + STEP.reach);
    expect(v.melee).toBe(true);
    expect(v.lv.reach).toBe(1);
    expect([v.main.lvDmg[0], v.main.lvCd[0]]).toEqual([BASE.inf.main.lvDmg[0], BASE.inf.main.lvCd[0]]);
    expect(BASE.inf.main.range).toBe(contact);
    // 在已有攻击距离的变体上再加，是累加
    expect(variant(v, { reach: 1 }).main.range).toBe(contact + 2 * STEP.reach);
    expect(variant(v, { reach: 1 }).lv.reach).toBe(2);
    // 别的维度的变体沿用基准的攻击距离
    expect(variant(BASE.inf, { hp: 2 }).main.range).toBe(contact);
    expect(variant(v, { hp: 2 }).main.range).toBe(contact + STEP.reach);
  });

  it('远程基准射程加级照旧、不受攻击距离影响；特性改主武器：穿刺攻击把抛射器械的主武器改成穿刺伤害，基准不变', () => {
    expect(variant(BASE.ranged, { rng: 4 }).main.range).toBeGreaterThan(BASE.ranged.main.range);
    expect(BASE.siege.main.atk).toBe(A_SIEGE);
    const v = variant(BASE.siege, {}, ['pierce']);
    expect(v.main.atk).toBe(A_PIERCE);
    expect(BASE.siege.main.atk).toBe(A_SIEGE);
  });

  it('加副武器特性的变体带副武器，不改基准的武器表', () => {
    const v = variant(BASE.inf, {}, ['pilum']);
    expect(v.aux).not.toBeNull();
    expect(v.aux!.range).toBe(TRAITS.pilum.aux!.range);
    expect(v.main).not.toBe(BASE.inf.main);
    expect(BASE.inf.aux).toBeNull();
  });
});
