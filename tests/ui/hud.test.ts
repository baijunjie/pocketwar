import { describe, expect, it } from 'vitest';
import { ELITE, SIZES, SITE_CAMP, SITE_CITY, UNITS, UNIT_BY_KEY, isContentUnit, unitKind } from '../../src/sim/defs';
import { unitUpgradeCost } from '../../src/sim/systems/economy';
import { createGame } from '../../src/sim/setup';
import { tier3Perks, unitTip } from '../../src/ui/hud';

describe('兵种提示', () => {
  it('第一行是名称与类别，第二行是说明，随后是生命、攻击、攻速与射程护甲', () => {
    for (const d of UNITS.filter(d => d.tier === 0 && isContentUnit(d))) {
      const lines = unitTip(d).split('\n');
      expect(lines[0], d.key).toBe(`${d.name}（${unitKind(d)}）`);
      expect(lines[1], d.key).toBe(d.desc);
      expect(lines[2], d.key).toContain(`生命 ${d.hp}`);
      expect(lines[2], d.key).toContain(`攻击 ${d.dmg}`);
      expect(lines[2], d.key).toContain(`攻速 ${d.cd}s`);
      expect(lines[3], d.key).toContain(`护甲 ${d.armM}/${d.armP}`);
      expect(lines[4], d.key).toContain(`体型 ${SIZES[d.size].name}`);
    }
  });

  it('近战写「近战」，远程写射程数值', () => {
    const melee = UNIT_BY_KEY.dao, ranged = UNIT_BY_KEY.nu;
    expect(unitTip(melee)).toContain('射程 近战');
    expect(unitTip(ranged)).toContain(`射程 ${ranged.range}`);
  });

  it('范围杀伤的兵种在攻击后标注「范围」', () => {
    for (const d of UNITS.filter(d => d.tier === 0 && isContentUnit(d))) {
      expect(unitTip(d).split('\n')[2].includes('（范围）'), d.key).toBe(d.splash > 0);
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
