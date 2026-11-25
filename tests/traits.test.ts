import { describe, expect, it } from 'vitest';
import {
  AURA_KINDS, AURA_RADIUS, AU_RANGED_TAKEN, A_PIERCE, A_SIEGE, ARCHETYPES, EXPAND_RULES, LEVEL_RANGES, P_ARROW, P_JAVELIN, PRICES, SHIELD_SPEED_MUL, STEP, TRAITS, UNITS, UNIT_BY_KEY, applyLevels, auraStronger, defineTrait, estimatePoints, expandUnit, positionTraits, traitMix,
} from '../src/sim/defs';
import { contentUnits } from '../tools/measure/fingerprint';
import { pricedTraits } from '../tools/measure/price';

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

describe('价目表覆盖全部计点的维度与特性', () => {
  it('每个位置每个开放维度都有价目（破甲、举盾没有负级数，减级价目为 0）', () => {
    const pos = { inf: 'inf', spear: 'inf', ranged: 'ranged', siege: 'siege', bolt: 'bolt' } as Record<string, string>;
    for (const [p, a] of Object.entries(pos)) {
      for (const dim of ARCHETYPES.find(x => x.key === a)!.dims.filter(k => k !== 'heal')) expect(PRICES.dims[p][dim], `${p} ${dim}`).toBeDefined();
    }
    for (const p of ['inf', 'spear']) expect(PRICES.dims[p].block![1]).toBe(0);
    for (const p of ['ranged', 'siege', 'bolt']) expect(PRICES.dims[p].pen![1]).toBe(0);
  });

  it('直射器械各开放维度都有价目，没有范围杀伤；抛射器械的范围杀伤价目还在；位置基准自带的穿刺攻击、重弩不在抛射器械的价目里', () => {
    for (const dim of ARCHETYPES.find(x => x.key === 'bolt')!.dims.filter(k => k !== 'heal')) expect(PRICES.dims.bolt[dim], `bolt ${dim}`).toBeDefined();
    expect(PRICES.dims.bolt.splash).toBeUndefined();
    expect(PRICES.dims.siege.splash).toBeDefined();
    expect(PRICES.traits.bolt.ballista).toBeDefined();
    expect(PRICES.traits.siege?.ballista).toBeUndefined();
    expect(PRICES.traits.siege?.pierce).toBeUndefined();
  });

  it('兵种用到的特性（位置基准本来没有的）在价目表里都有一格（不显著的照规程记 0）', () => {
    for (const { slot, trait } of pricedTraits()) expect(PRICES.traits[slot]?.[trait], `${slot} ${trait}`).toBeDefined();
    expect(pricedTraits()).toEqual(expect.arrayContaining([{ slot: 'inf', trait: 'pilum' }, { slot: 'inf', trait: 'sidebow' }, { slot: 'bolt', trait: 'ballista' }]));
    // 蝎弩迁走后抛射器械没有兵种再带重弩与穿刺攻击，不再测它们
    expect(pricedTraits()).not.toContainEqual({ slot: 'siege', trait: 'ballista' });
    expect(pricedTraits()).not.toContainEqual({ slot: 'siege', trait: 'pierce' });
  });
});

describe('光环特性：定义与校验', () => {
  let seq = 0;
  /** 用不会冲突的 key 定义一个光环特性，返回 key */
  const def = (aura: { kind: string; radius: number; value: number }, priceAt?: string[]): string => {
    const key = `t_aura_${seq++}`;
    defineTrait(key, { name: key, aura, ...(priceAt ? { priceAt } : {}) });
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

  it('合法的光环定义成功，特性上保留半径、种类与数值；没写 priceAt 时是空表', () => {
    const k = def(ok);
    expect(TRAITS[k].aura).toEqual(ok);
    expect(TRAITS[k].priceAt).toEqual([]);
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
    expect(() => defineTrait(key, { name: key, aura: { ...ok, radius: 5 } })).toThrow();
    expect(TRAITS[key]).toBeUndefined();
  });

  it('priceAt 写了不存在的位置报错，写了存在的位置成功并保留', () => {
    expect(() => def(ok, ['no_such_position'])).toThrow();
    expect(() => def(ok, ['inf', 'no_such_position'])).toThrow();
    const k = def(ok, ['inf', 'spear']);
    expect(TRAITS[k].priceAt).toEqual(['inf', 'spear']);
  });

  it('不带光环的特性没有 aura 字段', () => {
    expect(TRAITS.testudo.aura).toBeUndefined();
  });
});

describe('光环特性：盾墙掩护与展开到兵种', () => {
  const expand = (key: string, arch: string, traits: string[]) =>
    expandUnit({ faction: 'china', key, name: key, arch, spec: { traits }, desc: '' }, EXPAND_RULES, true);

  it('盾墙掩护：所受远程伤害 −20%、半径 60，价目先在近战步兵与长柄两个位置计', () => {
    expect(TRAITS.cover.aura).toEqual({ kind: 'rangedTaken', radius: 60, value: 0.8 });
    expect(TRAITS.cover.priceAt).toEqual(['inf', 'spear']);
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

  it('估算点数按所在位置的价目计入：近战步兵与长柄位置各取各的价格', () => {
    const inf = expand('t_cover_inf2', 'inf', ['cover'])[0];
    expect(inf.position).toBe('inf');
    expect(inf.ownTraits).toEqual(['cover']);
    expect(inf.points).toBeCloseTo(PRICES.traits.inf.cover, 9);
    const spear = expand('t_cover_spear', 'inf', ['polearm', 'cover'])[0];
    expect(spear.position).toBe('spear');
    expect(spear.ownTraits).toEqual(['cover']);
    expect(spear.points).toBeCloseTo(PRICES.traits.spear.cover, 9);
  });

  it('价目与其它维度加在一起：加了生命级数的带光环兵种，点数 = 维度点数 + 光环价', () => {
    const d = expandUnit({ faction: 'china', key: 't_cover_lv', name: 't', arch: 'inf', spec: { traits: ['cover'], lv: { hp: 2 } }, desc: '' }, EXPAND_RULES, false)[0];
    expect(d.points).toBeCloseTo(estimatePoints('inf', { hp: 2 }, []) + PRICES.traits.inf.cover, 9);
  });

  it('在价目表里没有价格的位置挂光环特性直接报错，不按 0 白拿', () => {
    expect(() => expand('t_cover_cav', 'cav', ['cover'])).toThrow('价目表缺格');
  });
});

describe('光环特性：价目表与测价清单', () => {
  it('价目表里有盾墙掩护在近战步兵与长柄位置的价格；价格是有限的非负数', () => {
    for (const pos of ['inf', 'spear']) {
      const v = PRICES.traits[pos]?.cover;
      expect(v, pos).toBeDefined();
      expect(Number.isFinite(v) && v >= 0, pos).toBe(true);
    }
  });

  it('pricedTraits 含 inf:cover 与 spear:cover，且每项只出现一次', () => {
    const list = pricedTraits();
    expect(list).toContainEqual({ slot: 'inf', trait: 'cover' });
    expect(list).toContainEqual({ slot: 'spear', trait: 'cover' });
    const keys = list.map(o => `${o.slot}:${o.trait}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('priceAt 声明的位置里，位置基准本来就带的特性不进清单，其余照常进', () => {
    const key = 't_aura_price_decl';
    defineTrait(key, { name: key, aura: { kind: 'rangedTaken', radius: 60, value: 0.8 }, priceAt: ['spear', 'ranged'] });
    const list = pricedTraits();
    expect(list).toContainEqual({ slot: 'spear', trait: key });
    expect(list).toContainEqual({ slot: 'ranged', trait: key });
    expect(list).not.toContainEqual({ slot: 'inf', trait: key });
    // 长柄位置的基准自带 polearm：临时让 polearm 声明在长柄与近战步兵两处计价，长柄那处不进清单
    const saved = TRAITS.polearm.priceAt;
    try {
      TRAITS.polearm.priceAt = ['spear', 'inf'];
      const l = pricedTraits();
      expect(l).not.toContainEqual({ slot: 'spear', trait: 'polearm' });
      expect(l).toContainEqual({ slot: 'inf', trait: 'polearm' });
    } finally {
      TRAITS.polearm.priceAt = saved;
    }
  });
});

describe('位置基准自带的特性：positionTraits', () => {
  it('长柄位置含 polearm，近战步兵位置没有，远程骑兵含 firemove，载具含 trample', () => {
    expect(positionTraits('spear')).toContain('polearm');
    expect(positionTraits('inf')).toEqual([]);
    expect(positionTraits('cavr')).toContain('firemove');
    expect(positionTraits('ele')).toContain('trample');
  });

  it('兵种的 ownTraits 不含位置基准自带的特性', () => {
    const d = expandUnit({ faction: 'china', key: 't_own', name: 't', arch: 'inf', spec: { traits: ['polearm', 'cover'] }, desc: '' }, EXPAND_RULES, false)[0];
    expect(d.position).toBe('spear');
    expect(d.ownTraits).toEqual(['cover']);
  });
});

describe('priceAt：有没有兵种带都计价', () => {
  it('与带它的兵种所在位置取并集：兵种带它的位置照常计价，priceAt 另加的位置也计，不重复', () => {
    expect(pricedTraits()).toContainEqual({ slot: 'inf', trait: 'pilum' });
    const saved = TRAITS.pilum.priceAt;
    try {
      TRAITS.pilum.priceAt = ['inf', 'ranged'];
      const l = pricedTraits();
      expect(l.filter(o => o.slot === 'inf' && o.trait === 'pilum')).toHaveLength(1);
      expect(l).toContainEqual({ slot: 'ranged', trait: 'pilum' });
    } finally {
      TRAITS.pilum.priceAt = saved;
    }
  });
});
