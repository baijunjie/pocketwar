import { describe, expect, it } from 'vitest';
import {
  ARCHETYPES, A_FIRE, A_MELEE, A_PIERCE, A_SIEGE, ELITE, EXPAND_RULES, LEVELS, LevelRules, P_TORCH, RULES, STEP, TRAITS, UNITS, UNIT_BY_KEY, WR_AUX, WR_BUILDING, WR_MAIN, Weapon,
  applyLevels, auxWeapon, expandUnit, isContentUnit, linkWeapons, torchWeapon, traitMix, weaponLevels,
} from '../../../src/sim/defs';

const tier0 = UNITS.filter(d => d.tier === 0 && isContentUnit(d));
const lvN = LEVELS.thresholds.length;
const contact = RULES.combat.meleeContact;
/** 按原型基准与级数展开一个临时兵种（不登记进兵种表），返回 [初级, 高级] */
const build = (arch: string, spec: object = {}): ReturnType<typeof expandUnit> => expandUnit({ faction: 'china', key: 't', name: 't', arch, spec, desc: '' }, EXPAND_RULES);

describe('武器表：每个兵种的主武器、副武器与对建筑武器', () => {
  it('每个兵种恰有一把主武器，melee 等于主武器是否近战，主武器的近战与否跟着原型走；初级与高级形态都一样', () => {
    for (const d of UNITS.filter(isContentUnit)) {
      expect(d.weapons.filter(w => w.role === WR_MAIN).length, d.key).toBe(1);
      expect(d.weapons, d.key).toContain(d.main);
      expect(d.main.role, d.key).toBe(WR_MAIN);
      expect(d.melee, d.key).toBe(d.main.melee);
      expect(d.melee, d.key).toBe(!ARCHETYPES[d.arch].ranged);
    }
  });

  it('按用途取好：副武器只有军团步兵（重标枪）与不死军（副弓）有，对建筑武器只有人形单位有（战象与器械没有）', () => {
    for (const d of UNITS.filter(isContentUnit)) {
      const key = d.key.replace(/_e$/, '');
      expect(!!d.aux, d.key).toBe(key === 'legion' || key === 'immortal');
      expect(!!d.torch, d.key).toBe(d.humanoid);
      expect(d.weapons.length, d.key).toBe(1 + (d.aux ? 1 : 0) + (d.torch ? 1 : 0));
      if (d.aux) expect(d.aux.role, d.key).toBe(WR_AUX);
      if (d.torch) expect(d.torch.role, d.key).toBe(WR_BUILDING);
    }
    for (const k of ['elephant', 'huojian', 'pili', 'ozutsu', 'onager', 'mangonel', 'scorpio']) expect(UNIT_BY_KEY[k].torch, k).toBeNull();
    expect(UNIT_BY_KEY.dao.torch).not.toBeNull();
    expect(UNIT_BY_KEY.tieqi.torch).not.toBeNull();
  });

  it('主武器的数值来自原型面板：伤害随等级乘 1 + LEVELS.dmg × 级，间隔随等级缩短，高级形态的伤害再乘攻击倍率', () => {
    for (const d of tier0) {
      const p = applyLevels(ARCHETYPES[d.arch].panel, d.lv);
      const e = UNITS[d.elite];
      expect(d.main.lvDmg.length, d.key).toBe(lvN);
      expect(d.main.lvCd.length, d.key).toBe(lvN);
      for (let l = 0; l < lvN; l++) {
        expect(d.main.lvDmg[l], `${d.key} ${l}`).toBeCloseTo(p.dmg * (1 + LEVELS.dmg * l), 9);
        expect(d.main.lvCd[l], `${d.key} ${l}`).toBeCloseTo(p.cd * (1 - LEVELS.cd * l), 9);
        expect(e.main.lvDmg[l], `${e.key} ${l}`).toBeCloseTo(d.main.lvDmg[l] * ELITE.dmg, 9);
        expect(e.main.lvCd[l], `${e.key} ${l}`).toBeCloseTo(d.main.lvCd[l], 9);
      }
      expect(d.main.pen, d.key).toBeCloseTo(p.pen, 9);
      expect(e.main.pen, d.key).toBeCloseTo(p.pen, 9);
    }
  });

  it('主武器是远程武器的，攻击距离是射程；是近战武器的，攻击距离是贴身距离加攻击距离维度（每级 15 像素）', () => {
    expect(contact).toBe(7);
    expect(STEP.reach).toBe(15);
    for (const d of tier0) {
      const p = applyLevels(ARCHETYPES[d.arch].panel, d.lv);
      for (const x of [d, UNITS[d.elite]]) {
        expect(x.main.range, x.key).toBe(d.melee ? contact + STEP.reach * (d.lv.reach ?? 0) : p.range);
      }
    }
  });

  it('长戟兵、足轻枪兵、辅助矛兵、持盾矛兵的攻击距离是 22，其余近战兵种是贴身（7）；远程兵种的攻击距离是射程', () => {
    for (const k of ['ji', 'yari', 'auxilia', 'spara']) {
      expect(UNIT_BY_KEY[k].lv.reach, k).toBe(1);
      expect(UNIT_BY_KEY[k].main.range, k).toBe(22);
      expect(UNITS[UNIT_BY_KEY[k].elite].main.range, `${k}_e`).toBe(22);
    }
    for (const d of tier0) {
      if (['ji', 'yari', 'auxilia', 'spara'].includes(d.key)) continue;
      if (d.melee) expect(d.main.range, d.key).toBe(7);
      else expect(d.main.range, d.key).toBeGreaterThan(contact);
    }
    expect(UNIT_BY_KEY.nu.main.range).toBe(235);
  });

  it('战象的主武器是近战、带半径 28 的范围杀伤（践踏），其余近战兵种单体；抛射器械的范围杀伤来自面板', () => {
    const el = UNIT_BY_KEY.elephant;
    expect(el.melee).toBe(true);
    expect(el.main.splash).toBe(28);
    expect(el.main.atk).toBe(A_MELEE);
    expect(UNITS[el.elite].main.splash).toBe(28);
    for (const d of tier0) if (d.melee && d.key !== 'elephant') expect(d.main.splash, d.key).toBe(0);
    for (const k of ['huojian', 'pili', 'ozutsu', 'onager', 'mangonel']) expect(UNIT_BY_KEY[k].main.splash, k).toBeGreaterThan(0);
  });

  it('副武器来自特性：远程、穿刺、单体，伤害与间隔各级相同，也不吃高级形态的攻击倍率', () => {
    for (const [k, trait] of [['legion', 'pilum'], ['immortal', 'sidebow']] as const) {
      const a = TRAITS[trait].aux!;
      for (const d of [UNIT_BY_KEY[k], UNITS[UNIT_BY_KEY[k].elite]]) {
        const w = d.aux!;
        expect(w.melee, d.key).toBe(false);
        expect(w.atk, d.key).toBe(A_PIERCE);
        expect([w.range, w.proj, w.splash, w.pen, w.minRange], d.key).toEqual([a.range, a.proj, 0, 0, 0]);
        expect(w.lvDmg, d.key).toEqual(Array(lvN).fill(a.dmg));
        expect(w.lvCd, d.key).toEqual(Array(lvN).fill(a.cd));
      }
    }
    // 主武器随等级涨，副武器不涨
    const legion = UNIT_BY_KEY.legion;
    expect(legion.main.lvDmg[lvN - 1]).toBeGreaterThan(legion.main.lvDmg[0]);
  });

  it('对建筑武器（火把）：火伤害，距离是 torchRange，伤害随等级乘 1 + LEVELS.dmg × 级、不吃高级形态倍率，间隔各级相同', () => {
    const S = RULES.siege;
    for (const d of tier0.filter(x => x.humanoid)) {
      for (const x of [d, UNITS[d.elite]]) {
        const t = x.torch!;
        expect([t.atk, t.proj, t.range, t.melee, t.splash, t.pen], x.key).toEqual([A_FIRE, P_TORCH, S.torchRange, false, 0, 0]);
        for (let l = 0; l < lvN; l++) {
          expect(t.lvDmg[l], `${x.key} ${l}`).toBeCloseTo(S.torchDmg * (1 + LEVELS.dmg * l), 9);
          expect(t.lvCd[l], `${x.key} ${l}`).toBe(S.torchCd);
        }
      }
    }
  });

  it('特性改主武器的字段：践踏给范围杀伤、穿刺攻击改伤害类型，没有特性时不改；多个特性的改动叠加', () => {
    expect(TRAITS.trample.main).toEqual({ splash: 28 });
    expect(TRAITS.pierce.main).toEqual({ atk: A_PIERCE });
    expect(traitMix([]).main).toEqual({});
    expect(traitMix(['pierce']).main).toEqual({ atk: A_PIERCE });
    expect(traitMix(['trample', 'pierce']).main).toEqual({ splash: 28, atk: A_PIERCE });
  });
});

describe('攻击距离维度：只开给主武器是近战武器的原型', () => {
  it('近战步兵、近战骑兵、载具开放攻击距离，远程原型与器械不开放', () => {
    for (const a of ARCHETYPES) expect(a.dims.includes('reach'), a.key).toBe(!a.ranged);
  });

  it('每级多 15 像素：0 级是贴身 7，+1 是 22，+2 是 37；初级与高级形态一致', () => {
    for (const arch of ['inf', 'cav', 'vehicle']) {
      for (const [lv, want] of [[0, 7], [1, 22], [2, 37]]) {
        const [a, e] = build(arch, { lv: { reach: lv } });
        expect([a.main.range, e.main.range], `${arch} +${lv}`).toEqual([want, want]);
        expect(a.melee, arch).toBe(true);
      }
    }
  });

  it('主武器是远程武器的原型填攻击距离报错，近战原型填射程也报错', () => {
    for (const arch of ['ranged', 'cavr', 'siege', 'bolt']) expect(() => build(arch, { lv: { reach: 1 } }), arch).toThrow('没有开放维度');
    for (const arch of ['inf', 'cav', 'vehicle']) expect(() => build(arch, { lv: { rng: 1 } }), arch).toThrow('没有开放维度');
  });

  it('级数范围 0…+2：没有负级数，越出范围报错', () => {
    expect(() => build('inf', { lv: { reach: -1 } })).toThrow('越出范围');
    expect(() => build('inf', { lv: { reach: 3 } })).toThrow('越出范围');
    expect(() => build('inf', { lv: { reach: 2 } })).not.toThrow();
    expect(() => build('inf', { lv: { reach: 0 } })).not.toThrow();
  });

  it('面板里的攻击距离是点数维度，兵种不能直接填绝对数值', () => {
    expect(() => build('inf', { reach: 22 })).toThrow('点数维度');
  });

  it('攻击距离只改主武器的距离，不动副武器、火把与伤害间隔', () => {
    const [base] = build('inf', {});
    const [long] = build('inf', { lv: { reach: 1 } });
    expect(long.main.lvDmg).toEqual(base.main.lvDmg);
    expect(long.main.lvCd).toEqual(base.main.lvCd);
    expect(long.torch!.range).toBe(base.torch!.range);
    expect(long.hp).toBe(base.hp);
  });
});

describe('武器的构造函数', () => {
  const lv: LevelRules = { thresholds: [0, 10, 20], names: ['a', 'b', 'c'], hp: 0, dmg: 0.5, def: 0, armor: 0, cd: 0.1, rout: [1, 1, 1] };

  it('weaponLevels：伤害乘 1 + dmg × 级，间隔乘 1 − cd × 级', () => {
    const t = weaponLevels(10, 2, lv);
    expect(t.lvDmg).toEqual([10, 15, 20]);
    expect(t.lvCd[0]).toBe(2);
    expect(t.lvCd[1]).toBeCloseTo(1.8, 12);
    expect(t.lvCd[2]).toBeCloseTo(1.6, 12);
  });

  it('torchWeapon：火伤害，伤害随等级涨，间隔与距离不变，有几级就展开几级', () => {
    const t = torchWeapon({ range: 60, dmg: 16, cd: 2.2 }, lv);
    expect([t.role, t.atk, t.proj, t.range, t.melee]).toEqual([WR_BUILDING, A_FIRE, P_TORCH, 60, false]);
    expect(t.lvDmg).toEqual([16, 24, 32]);
    expect(t.lvCd).toEqual([2.2, 2.2, 2.2]);
  });

  it('auxWeapon：穿刺、远程、单体，各级数值相同', () => {
    const w = auxWeapon({ dmg: 26, range: 95, cd: 14, proj: 3 }, 3);
    expect([w.role, w.atk, w.melee, w.range, w.proj, w.splash, w.pen]).toEqual([WR_AUX, A_PIERCE, false, 95, 3, 0, 0]);
    expect(w.lvDmg).toEqual([26, 26, 26]);
    expect(w.lvCd).toEqual([14, 14, 14]);
  });

  it('linkWeapons：按用途取出主武器、副武器、对建筑武器，缺的是 null；没有主武器报错', () => {
    const mk = (role: number, melee = false): Weapon => ({ role, melee, atk: A_MELEE, range: 1, minRange: 0, proj: 0, pen: 0, splash: 0, lvDmg: [1], lvCd: [1] });
    const main = mk(WR_MAIN, true), aux = mk(WR_AUX), torch = mk(WR_BUILDING);
    const all = linkWeapons([torch, main, aux]);
    expect([all.main, all.aux, all.torch, all.melee]).toEqual([main, aux, torch, true]);
    expect(all.weapons).toEqual([torch, main, aux]);
    const only = linkWeapons([mk(WR_MAIN)]);
    expect([only.aux, only.torch, only.melee]).toEqual([null, null, false]);
    expect(() => linkWeapons([aux, torch])).toThrow('兵种没有主武器');
  });
});
