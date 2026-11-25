import { describe, expect, it } from 'vitest';
import { AU_RANGED_TAKEN, ELITE, EXPAND_RULES, SIZES, SITE_CAMP, SITE_CITY, UNITS, UNIT_BY_KEY, expandUnit, isContentUnit, unitKind } from '../../src/sim/defs';
import { unitUpgradeCost } from '../../src/sim/systems/economy';
import { createGame } from '../../src/sim/setup';
import { auraEffect, auraPct, tier3Perks, unitTip } from '../../src/ui/hud';

describe('兵种提示', () => {
  it('第一行是名称与类别，第二行是说明，随后是生命、攻击、攻速与射程护甲', () => {
    for (const d of UNITS.filter(d => d.tier === 0 && isContentUnit(d))) {
      const lines = unitTip(d).split('\n');
      expect(lines[0], d.key).toBe(`${d.name}（${unitKind(d)}）`);
      expect(lines[1], d.key).toBe(d.desc);
      expect(lines[2], d.key).toContain(`生命 ${d.hp}`);
      expect(lines[2], d.key).toContain(`攻击 ${d.main.lvDmg[0]}`);
      expect(lines[2], d.key).toContain(`攻速 ${d.main.lvCd[0]}s`);
      expect(lines[3], d.key).toContain(`护甲 ${d.armM}/${d.armP}`);
      expect(lines[4], d.key).toContain(`体型 ${SIZES[d.size].name}`);
    }
  });

  it('近战写「近战」，远程写射程数值', () => {
    const melee = UNIT_BY_KEY.dao, ranged = UNIT_BY_KEY.nu;
    expect(unitTip(melee)).toContain('射程 近战');
    expect(unitTip(ranged)).toContain(`射程 ${ranged.main.range}`);
  });

  it('近战武器的攻击距离比贴身长的，射程一栏写「近战 距离」：长戟兵写「近战 22」，贴身的写「近战」', () => {
    for (const k of ['ji', 'yari', 'auxilia', 'spara']) expect(unitTip(UNIT_BY_KEY[k]), k).toContain('射程 近战 22');
    for (const d of UNITS.filter(d => d.tier === 0 && isContentUnit(d) && d.melee)) {
      const line = unitTip(d).split('\n')[3];
      if (d.main.range > 7) expect(line, d.key).toContain(`射程 近战 ${d.main.range}`);
      else expect(line.startsWith('射程 近战　'), d.key).toBe(true);
    }
    expect(unitTip(UNIT_BY_KEY.dao).split('\n')[3]).toContain('射程 近战　护甲');
    // 高级形态的攻击距离与初级一样
    expect(unitTip(UNITS[UNIT_BY_KEY.ji.elite])).toContain('射程 近战 22');
  });

  it('范围杀伤的兵种在攻击后标注「范围」', () => {
    for (const d of UNITS.filter(d => d.tier === 0 && isContentUnit(d))) {
      expect(unitTip(d).split('\n')[2].includes('（范围）'), d.key).toBe(d.main.splash > 0);
    }
  });

  it('特殊动作：冲锋、拒马、举盾、夜战各按兵种带的能力列出', () => {
    for (const d of UNITS.filter(d => d.tier === 0 && isContentUnit(d))) {
      const tip = unitTip(d), ab = d.abilities;
      expect(tip.includes('冲锋：'), d.key).toBe(!!ab.charge);
      expect(tip.includes('拒马：'), d.key).toBe(!!ab.brace);
      expect(tip.includes('举盾：'), d.key).toBe(!!ab.shield);
      expect(tip.includes('夜间可打火把'), d.key).toBe(!!ab.torch);
      if (ab.shield) expect(tip).toContain(`−${Math.round(ab.shield.block * 100)}%`);
    }
  });

  it('工程类写「工程类」，其余写烧不动城墙', () => {
    for (const d of UNITS.filter(d => d.tier === 0 && isContentUnit(d))) {
      expect(unitTip(d).includes('工程类：'), d.key).toBe(!!d.siege);
      expect(unitTip(d).includes('烧不动城墙'), d.key).toBe(!d.siege);
      expect(unitTip(d), d.key).not.toContain('箭楼');
    }
  });

  it('初级形态写升级花费与高级形态名；高级形态写「高级形态」且没有升级一行', () => {
    const d = UNIT_BY_KEY.dao, e = UNITS[d.elite];
    const tip = unitTip(d);
    expect(tip).toContain(`可花 ${unitUpgradeCost(d)} 黄金升为「${e.name}」`);
    expect(tip).toContain(`生命 ×${ELITE.hp}`);
    expect(tip).toContain(`攻击 ×${ELITE.dmg}`);
    expect(tip).toContain(`护甲 +${ELITE.armor}`);
    const etip = unitTip(e);
    expect(etip.split('\n').at(-1)).toBe('高级形态');
    expect(etip).not.toContain('可花');
  });

  it('对建筑倍率不低于 2 才写出来', () => {
    for (const d of UNITS.filter(d => d.tier === 0 && isContentUnit(d))) {
      expect(unitTip(d).includes(`对建筑 ×${d.vsBld}`), d.key).toBe(d.vsBld >= 2);
    }
  });
});

describe('据点满级解锁：tier3Perks', () => {
  const w = createGame({
    seed: 5, factions: ['china', 'japan'], armySize: 60, difficulty: 1, fog: false, spectate: false, environment: false, supply: false,
  }).world;

  it('按据点里建筑的 tier3 推出：城池解锁炮弹，营寨解锁连弩，每种建筑一项', () => {
    const city = w.sites.find(s => s.type === SITE_CITY)!, camp = w.sites.find(s => s.type === SITE_CAMP)!;
    const uc = tier3Perks(w, city).flatMap(p => p.unlocks), uk = tier3Perks(w, camp).flatMap(p => p.unlocks);
    expect(uc).toContain('炮弹');
    expect(uk).toContain('连弩');
    for (const s of [city, camp]) {
      const keys = tier3Perks(w, s).map(p => p.def.key);
      expect(new Set(keys).size).toBe(keys.length);
      for (const p of tier3Perks(w, s)) expect(p.def.tier3).toBeTruthy();
    }
  });
});

describe('光环的显示', () => {
  const coverUnit = expandUnit({ faction: 'china', key: 't_cover_tip', name: '盾卫', arch: 'inf', spec: { traits: ['cover'] }, desc: '持盾掩护' }, EXPAND_RULES, false)[0];

  it('auraEffect：所受远程伤害倍率 0.8 写成「所受远程伤害 −20%」，0.6 是 −40%', () => {
    const a = { name: '盾墙掩护', kind: AU_RANGED_TAKEN, radius: 60 };
    expect(auraEffect({ ...a, value: 0.8 })).toBe('所受远程伤害 −20%');
    expect(auraEffect({ ...a, value: 0.6 })).toBe('所受远程伤害 −40%');
  });

  it('auraPct：相对无加成值的增减，比无加成小为「−」、大为「+」', () => {
    const a = { name: 'x', kind: AU_RANGED_TAKEN, radius: 60 };
    expect(auraPct({ ...a, value: 0.8 })).toBe('−20%');
    expect(auraPct({ ...a, value: 0.6 })).toBe('−40%');
    expect(auraPct({ ...a, value: 1.2 })).toBe('+20%');
    expect(auraPct({ ...a, value: 0.3 })).toBe('−70%');
  });

  it('auraPct：取整为 0 的保留一位小数，正负号按数值本身判断，不显示成「+0%」', () => {
    const a = { name: 'x', kind: AU_RANGED_TAKEN, radius: 60 };
    expect(auraPct({ ...a, value: 0.996 })).toBe('−0.4%');
    expect(auraPct({ ...a, value: 0.999 })).toBe('−0.1%');
    expect(auraPct({ ...a, value: 1.004 })).toBe('+0.4%');
    expect(auraPct({ ...a, value: 0.996 })).not.toContain('+');
  });

  it('auraEffect 是「种类名 + 空格 + auraPct」', () => {
    const a = { name: 'x', kind: AU_RANGED_TAKEN, radius: 60 };
    for (const value of [0.8, 0.996, 0.5]) expect(auraEffect({ ...a, value })).toBe(`所受远程伤害 ${auraPct({ ...a, value })}`);
  });

  it('兵种提示列出光环：特性名、半径与加成', () => {
    const tip = unitTip(coverUnit);
    expect(tip).toContain('光环「盾墙掩护」：半径 60 内的其他友军所受远程伤害 −20%');
  });

  it('没有光环的兵种不显示光环这一行', () => {
    for (const d of UNITS.filter(d => d.tier === 0 && isContentUnit(d) && !d.auras.length)) expect(unitTip(d), d.key).not.toContain('光环');
  });

  it('带光环的兵种提示里每个光环一行', () => {
    const d = { ...coverUnit, auras: [coverUnit.auras[0], { ...coverUnit.auras[0], name: '另一个', radius: 90, value: 0.5 }] };
    const lines = unitTip(d).split('\n').filter(l => l.startsWith('光环'));
    expect(lines).toEqual([
      '光环「盾墙掩护」：半径 60 内的其他友军所受远程伤害 −20%',
      '光环「另一个」：半径 90 内的其他友军所受远程伤害 −50%',
    ]);
  });
});
