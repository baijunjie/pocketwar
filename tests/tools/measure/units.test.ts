import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AU_RANGED_TAKEN, A_PIERCE, A_SIEGE, ARCHETYPES, HP_SCALE, RULES, STEP, TRAITS, UNIT_BY_KEY, archetypePower } from '../../../src/sim/defs';
import { BASE, POSITIONS, REF_SHARE, SLOTS, contentUnits, positionOf, proxySlots, refCounts, refForce, refForcePerHead, slotOf, variant } from '../../../tools/measure/units';

describe('测量工具：兵种所在的位置', () => {
  it('同原型里，带位置要求的特性（长柄）就归带特性的位置，其余归不带的：四个长柄兵种归 spear，别的近战步兵归 inf', () => {
    for (const k of ['ji', 'yari', 'auxilia', 'spara']) expect(positionOf(UNIT_BY_KEY[k]), k).toBe('spear');
    for (const k of ['dao', 'samurai', 'legion', 'sohei']) expect(positionOf(UNIT_BY_KEY[k]), k).toBe('inf');
  });

  it('其余原型各归自己的位置：弩兵与弓手 ranged、骑兵 cav、骑射手 cavr、抛射器械 siege、战象 ele、蝎弩 bolt', () => {
    expect(positionOf(UNIT_BY_KEY.nu)).toBe('ranged');
    expect(positionOf(UNIT_BY_KEY.tieqi)).toBe('cav');
    expect(positionOf(UNIT_BY_KEY.asvaran)).toBe('cavr');
    expect(positionOf(UNIT_BY_KEY.onager)).toBe('siege');
    expect(positionOf(UNIT_BY_KEY.elephant)).toBe('ele');
    expect(positionOf(UNIT_BY_KEY.scorpio)).toBe('bolt');
  });

  it('每个正式兵种与它的高级形态都有位置，位置的原型与兵种的原型一致', () => {
    for (const d of contentUnits()) expect(POSITIONS[positionOf(d)].arch, d.key).toBe(ARCHETYPES[d.arch].key);
  });
});

describe('测量工具：基准单位是点数的零点', () => {
  it('各位置基准单位的点数为 0、战力估值等于原型基准的估值；带长柄的 spear 基准也是 0 点', () => {
    for (const [pos, d] of Object.entries(BASE)) {
      expect(d.points, pos).toBe(0);
      expect(d.power, pos).toBeCloseTo(archetypePower(ARCHETYPES.find(a => a.key === POSITIONS[pos].arch)!), 9);
    }
    expect(BASE.spear.ownTraits).toContain('polearm');
    expect(BASE.spear.points).toBe(0);
  });

  it('基准单位不是正式兵种：不计入 contentUnits', () => {
    const keys = new Set(contentUnits().map(d => d.key));
    for (const d of Object.values(BASE)) expect(keys.has(d.key), d.key).toBe(false);
  });
});

describe('游戏本体不依赖测量工具', () => {
  it('src/ 下没有任何文件引用 tools/ 目录', () => {
    const files = readdirSync('src', { recursive: true }).filter(n => /\.tsx?$/.test(n)).map(n => `src/${n}`);
    expect(files.length).toBeGreaterThan(0);
    const bad = files.filter(f => /(?:from\s+|import\s*\(\s*|import\s+)['"][^'"]*\btools\//.test(readFileSync(f, 'utf8')));
    expect(bad).toEqual([]);
  });
});

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
