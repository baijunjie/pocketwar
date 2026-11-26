import { describe, expect, it } from 'vitest';
import {
  AURA_KINDS, AURA_RADIUS, DIM_PRICE, AU_RANGED_TAKEN, A_PIERCE, A_SIEGE, ARCHETYPES, EXPAND_RULES, LEVEL_RANGES, P_ARROW, P_JAVELIN, SHIELD_SPEED_MUL, STEP, TRAITS, UNITS, UNIT_BY_KEY, applyLevels, auraStronger, defineTrait, expandUnit, levelPoints, traitMix,
} from '../src/sim/defs';
import { contentUnits } from '../tools/measure/units';

// 改为计点之前兵种表里直接填的数：破甲、范围杀伤半径、举盾减免、副武器
const BEFORE = {
  pen: { nu: 0.6, teppo: 0.8, scorpio: 0.8 } as Record<string, number>,
  // 与迁移前直接填的数一致；蝎弩迁到直射器械，没有范围杀伤
  splash: { huojian: 36, pili: 28, ozutsu: 22, onager: 32, mangonel: 34 } as Record<string, number>,
  block: { dao: 0.6, legion: 0.7, auxilia: 0.55, spara: 0.65, immortal: 0.55 } as Record<string, number>,
  aux: {
    legion: { dmg: 26, range: 95, cd: 14, proj: P_JAVELIN },
    immortal: { dmg: 7, range: 170, cd: 2.4, proj: P_ARROW },
  } as Record<string, object>,
};

describe('破甲、范围杀伤、举盾按维度计点', () => {
  it('三个维度是加数阶梯：破甲每级 +0.1、范围杀伤半径每级 +2、举盾减免每级 +0.05；抛射器械的基准范围杀伤 30，其余基准为 0', () => {
    expect([STEP.pen, STEP.splash, STEP.block]).toEqual([0.1, 2, 0.05]);
    const siege = ARCHETYPES.find(a => a.key === 'siege')!;
    expect(siege.panel.splash).toBe(30);
    for (const a of ARCHETYPES) {
      expect(a.panel.pen, a.key).toBe(0);
      expect(a.panel.block, a.key).toBe(0);
      if (a.key !== 'siege') expect(a.panel.splash, a.key).toBe(0);
    }
    const p = applyLevels(siege.panel, { pen: 6, splash: -15 });
    expect(p.pen).toBe(0.6);
    expect(p.splash).toBe(0);
    expect(applyLevels(ARCHETYPES[0].panel, { block: 13 }).block).toBe(0.65);
  });

  it('开放给有人用的原型：近战步兵开举盾，远程步兵开破甲，抛射器械开破甲与范围杀伤，直射器械只开破甲；级数范围覆盖全部现有兵种', () => {
    const dims = (k: string): string[] => ARCHETYPES.find(a => a.key === k)!.dims;
    expect(dims('inf')).toContain('block');
    expect(dims('ranged')).toContain('pen');
    expect(dims('siege')).toEqual(expect.arrayContaining(['pen', 'splash']));
    expect(dims('bolt')).toContain('pen');
    expect(dims('bolt')).not.toContain('splash');
    expect(LEVEL_RANGES.pen).toEqual([0, 8]);
    expect(LEVEL_RANGES.splash).toEqual([-15, 5]);
    expect(LEVEL_RANGES.block).toEqual([0, 14]);
  });

  it('迁移前后每个兵种的破甲、范围杀伤、举盾与副武器不变（偏差为 0，在半个步长以内）', () => {
    for (const d of contentUnits().filter(u => u.tier === 0)) {
      expect(d.main.pen, `${d.key} 破甲`).toBe(BEFORE.pen[d.key] ?? 0);
      const isSiege = ARCHETYPES[d.arch].key === 'siege';
      expect(d.melee ? 0 : d.main.splash, `${d.key} 范围杀伤`).toBe(BEFORE.splash[d.key] ?? 0);
      if (isSiege) expect(d.key in BEFORE.splash, d.key).toBe(true);
      const block = BEFORE.block[d.key];
      if (block) expect(d.abilities.shield, `${d.key} 举盾`).toEqual({ block, speedMul: SHIELD_SPEED_MUL });
      else expect(d.abilities.shield, `${d.key} 举盾`).toBeUndefined();
      const a = d.aux;
      expect(a && { dmg: a.lvDmg[0], range: a.range, cd: a.lvCd[0], proj: a.proj }, `${d.key} 副武器`).toEqual(BEFORE.aux[d.key] ?? null);
      // 高级形态同样
      const e = UNITS[d.elite];
      expect([e.main.pen, e.main.splash, e.abilities.shield, e.aux], d.key).toEqual([d.main.pen, d.main.splash, d.abilities.shield, d.aux]);
    }
  });

  it('兵种表里不能再直接填破甲、范围杀伤、举盾、副武器', () => {
    const mk = (spec: object, arch = 'inf'): unknown => () => expandUnit({ faction: 'china', key: 't', name: 't', arch, spec, desc: '' }, EXPAND_RULES, false);
    expect(mk({ pen: 0.5 }, 'ranged')).toThrow('点数维度');
    expect(mk({ splash: 20 }, 'siege')).toThrow('点数维度');
    expect(mk({ abilities: { shield: { block: 0.5, speedMul: 0.8 } } })).toThrow('lv.block');
    expect(mk({ aux: { dmg: 1, range: 1, cd: 1, proj: 0 } })).toThrow('特性');
    // 没开放的原型不能用
    expect(mk({ lv: { pen: 2 } }, 'cav')).toThrow('没有开放维度');
    expect(mk({ lv: { block: 15 } })).toThrow('越出范围');
  });
});

describe('副武器按特性计点', () => {
  it('重标枪、副弓是带副武器参数的特性；兵种挂上特性就有副武器', () => {
    expect(TRAITS.pilum.aux).toEqual(BEFORE.aux.legion);
    expect(TRAITS.sidebow.aux).toEqual(BEFORE.aux.immortal);
    expect(UNIT_BY_KEY.legion.ownTraits).toContain('pilum');
    expect(UNIT_BY_KEY.immortal.ownTraits).toContain('sidebow');
  });
});

describe('伤害类型按特性计点', () => {
  it('抛射器械基准打攻城伤害，穿刺攻击特性把它改成穿刺伤害；直射器械基准就是穿刺伤害，蝎弩不另挂特性；兵种表里不能直接填伤害类型', () => {
    expect(UNIT_BY_KEY.onager.main.atk).toBe(A_SIEGE);
    expect(TRAITS.pierce.main?.atk).toBe(A_PIERCE);
    expect(traitMix(['pierce']).main.atk).toBe(A_PIERCE);
    expect(UNIT_BY_KEY.scorpio.ownTraits).not.toContain('pierce');
    expect(UNIT_BY_KEY.scorpio.main.atk).toBe(A_PIERCE);
    expect(UNITS[UNIT_BY_KEY.scorpio.elite].main.atk).toBe(A_PIERCE);
    expect(() => expandUnit({ faction: 'china', key: 't', name: 't', arch: 'siege', spec: { atk: A_PIERCE } as object, desc: '' }, EXPAND_RULES, false)).toThrow('特性');
  });
});

describe('特性点数', () => {
  it('每个特性都声明点数（可为负）：穿刺攻击让抛射器械吃护甲，是减值', () => {
    for (const t of Object.values(TRAITS)) expect(Number.isFinite(t.points), t.key).toBe(true);
    expect(TRAITS.pierce.points).toBeLessThan(0);
  });

  it('defineTrait 的 points 缺失或不是有限数直接报错，不进特性表', () => {
    for (const [i, points] of [undefined, NaN, Infinity, -Infinity, null, '3'].entries()) {
      const key = `t_bad_points_${i}`;
      expect(() => defineTrait(key, { name: key, points } as never), `${points}`).toThrow('points');
      expect(TRAITS[key]).toBeUndefined();
    }
  });

  it('defineTrait 的 points 为 0、正数、负数都合法，原样存进特性表', () => {
    for (const [i, points] of [0, 2.5, -4].entries()) {
      const key = `t_ok_points_${i}`;
      defineTrait(key, { name: key, points });
      expect(TRAITS[key].points).toBe(points);
    }
  });

  it('直射器械没有范围杀伤；蝎弩的点数 = 破甲 8 级 + 重弩特性', () => {
    const bolt = ARCHETYPES.find(x => x.key === 'bolt')!;
    expect(bolt.dims).not.toContain('splash');
    expect(UNIT_BY_KEY.scorpio.points).toBeCloseTo(8 * DIM_PRICE.pen + TRAITS.ballista.points, 9);
  });
});

describe('光环特性：定义与校验', () => {
  let seq = 0;
  /** 用不会冲突的 key 定义一个光环特性，返回 key */
  const def = (aura: { kind: string; radius: number; value: number }): string => {
    const key = `t_aura_${seq++}`;
    defineTrait(key, { name: key, aura, points: 0 });
    return key;
  };
  const ok = { kind: 'rangedTaken', radius: 60, value: 0.8 };

  it('加成种类表：所受远程伤害，无加成值 1、越小越强、可填 0.3…1；半径可填 16…240', () => {
    expect(AURA_KINDS[AU_RANGED_TAKEN]).toMatchObject({ key: 'rangedTaken', neutral: 1, lowerStronger: true, min: 0.3, max: 1 });
    expect(AURA_RADIUS).toEqual([16, 240]);
  });

  it('auraStronger：越小越强的种类里，小的更强，相等不算更强', () => {
    expect(auraStronger(AU_RANGED_TAKEN, 0.6, 0.8)).toBe(true);
    expect(auraStronger(AU_RANGED_TAKEN, 0.8, 0.6)).toBe(false);
    expect(auraStronger(AU_RANGED_TAKEN, 0.8, 0.8)).toBe(false);
    expect(auraStronger(AU_RANGED_TAKEN, 0.8, 1)).toBe(true);
  });

  it('合法的光环定义成功，特性上保留半径、种类与数值', () => {
    const k = def(ok);
    expect(TRAITS[k].aura).toEqual(ok);
  });

  it('范围边界上的值合法：半径 16 与 240，数值 0.3', () => {
    expect(() => def({ ...ok, radius: 16 })).not.toThrow();
    expect(() => def({ ...ok, radius: 240 })).not.toThrow();
    expect(() => def({ ...ok, value: 0.3 })).not.toThrow();
  });

  it('未知加成种类报错', () => {
    expect(() => def({ ...ok, kind: 'nope' })).toThrow();
  });

  it('半径越出 16…240 报错', () => {
    for (const radius of [15.9, 0, -5, 240.1, 1000, NaN]) expect(() => def({ ...ok, radius }), `${radius}`).toThrow();
  });

  it('数值越出种类范围报错', () => {
    for (const value of [0.29, 0, -1, 2, NaN]) expect(() => def({ ...ok, value }), `${value}`).toThrow();
  });

  it('数值不比无加成值强（1 或 1.1）报错', () => {
    expect(() => def({ ...ok, value: 1 })).toThrow();
    expect(() => def({ ...ok, value: 1.1 })).toThrow();
  });

  it('校验不通过的特性不进特性表', () => {
    const key = 't_aura_rejected';
    expect(() => defineTrait(key, { name: key, aura: { ...ok, radius: 5 }, points: 0 })).toThrow();
    expect(TRAITS[key]).toBeUndefined();
  });

  it('不带光环的特性没有 aura 字段', () => {
    expect(TRAITS.testudo.aura).toBeUndefined();
  });
});

describe('光环特性：盾墙掩护与展开到兵种', () => {
  const expand = (key: string, arch: string, traits: string[]) =>
    expandUnit({ faction: 'china', key, name: key, arch, spec: { traits }, desc: '' }, EXPAND_RULES, true);

  it('盾墙掩护：所受远程伤害 −20%、半径 60', () => {
    expect(TRAITS.cover.aura).toEqual({ kind: 'rangedTaken', radius: 60, value: 0.8 });
  });

  it('traitMix 合出各特性的光环（带特性名、种类下标）；没有光环的特性不出光环', () => {
    expect(traitMix(['cover']).auras).toEqual([{ name: TRAITS.cover.name, kind: AU_RANGED_TAKEN, radius: 60, value: 0.8 }]);
    expect(traitMix(['testudo']).auras).toEqual([]);
    expect(traitMix(['testudo', 'cover', 'pilum']).auras).toHaveLength(1);
    expect(traitMix([]).auras).toEqual([]);
  });

  it('兵种挂上光环特性后初级与高级形态都带光环，没挂的没有', () => {
    const [basic, elite] = expand('t_cover_inf', 'inf', ['cover']);
    for (const d of [basic, elite]) expect(d.auras).toEqual([{ name: TRAITS.cover.name, kind: AU_RANGED_TAKEN, radius: 60, value: 0.8 }]);
    for (const d of expand('t_plain_inf', 'inf', [])) expect(d.auras).toEqual([]);
  });

  it('特性点数计入兵种点数：近战步兵带盾墙掩护加它的点数，长柄是普通计点特性、与盾墙掩护各计各的', () => {
    const inf = expand('t_cover_inf2', 'inf', ['cover'])[0];
    expect(inf.ownTraits).toEqual(['cover']);
    expect(inf.points).toBeCloseTo(TRAITS.cover.points, 9);
    const spear = expand('t_cover_spear', 'inf', ['polearm', 'cover'])[0];
    expect(spear.ownTraits).toEqual(['polearm', 'cover']);
    expect(spear.points).toBeCloseTo(TRAITS.polearm.points + TRAITS.cover.points, 9);
  });

  it('与维度点数加在一起：加了生命级数的带光环兵种，点数 = 维度点数 + 光环点数', () => {
    const d = expandUnit({ faction: 'china', key: 't_cover_lv', name: 't', arch: 'inf', spec: { traits: ['cover'], lv: { hp: 2 } }, desc: '' }, EXPAND_RULES, false)[0];
    expect(d.points).toBeCloseTo(levelPoints({ hp: 2 }) + TRAITS.cover.points, 9);
  });

  it('原型缺省自带的特性不计点：远程骑兵的边走边射', () => {
    const d = expandUnit({ faction: 'china', key: 't_cavr', name: 't', arch: 'cavr', spec: {}, desc: '' }, EXPAND_RULES, false)[0];
    expect(d.ownTraits).toEqual([]);
    expect(d.points).toBe(0);
  });
});
