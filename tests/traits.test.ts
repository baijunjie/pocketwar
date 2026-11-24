import { describe, expect, it } from 'vitest';
import {
  A_PIERCE, A_SIEGE, ARCHETYPES, EXPAND_RULES, LEVEL_RANGES, P_ARROW, P_JAVELIN, PRICES, SHIELD_SPEED_MUL, STEP, TRAITS, UNITS, UNIT_BY_KEY, applyLevels, expandUnit, traitMix,
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
      expect(d.pen, `${d.key} 破甲`).toBe(BEFORE.pen[d.key] ?? 0);
      const isSiege = ARCHETYPES[d.arch].key === 'siege';
      expect(d.splash, `${d.key} 范围杀伤`).toBe(BEFORE.splash[d.key] ?? 0);
      if (isSiege) expect(d.key in BEFORE.splash, d.key).toBe(true);
      const block = BEFORE.block[d.key];
      if (block) expect(d.abilities.shield, `${d.key} 举盾`).toEqual({ block, speedMul: SHIELD_SPEED_MUL });
      else expect(d.abilities.shield, `${d.key} 举盾`).toBeUndefined();
      expect(d.aux, `${d.key} 副武器`).toEqual(BEFORE.aux[d.key] ?? null);
      // 高级形态同样
      const e = UNITS[d.elite];
      expect([e.pen, e.splash, e.abilities.shield, e.aux], d.key).toEqual([d.pen, d.splash, d.abilities.shield, d.aux]);
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
    expect(UNIT_BY_KEY.onager.atk).toBe(A_SIEGE);
    expect(TRAITS.pierce.atk).toBe(A_PIERCE);
    expect(traitMix(['pierce']).atk).toBe(A_PIERCE);
    expect(UNIT_BY_KEY.scorpio.ownTraits).not.toContain('pierce');
    expect(UNIT_BY_KEY.scorpio.atk).toBe(A_PIERCE);
    expect(UNITS[UNIT_BY_KEY.scorpio.elite].atk).toBe(A_PIERCE);
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
