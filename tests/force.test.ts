import { describe, expect, it } from 'vitest';
import { ARCHETYPES, FACTIONS, FACTION_IDS, SITE_CAMP, SITE_INFO, UNIT_BY_KEY, UNITS, forceList, forceOf, headcount, isContentUnit, manpowerMult, reinforceMult } from '../src/sim/defs';
import { MENU_SIZES, UNIT_CAP_PER_FORCE, armyList, createGame } from '../src/sim/setup';
import { buildArmy } from '../tools/measure/army';
import { SLOTS, REF_SHARE, refCounts, refForce, refForcePerHead } from '../tools/measure/units';

const archForce = (key: string): number => ARCHETYPES.find(a => a.key === key)!.force;
const countBy = (list: number[]): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const i of list) out[UNITS[i].key] = (out[UNITS[i].key] ?? 0) + 1;
  return out;
};

describe('兵力占用', () => {
  it('每个原型一个值，近战步兵为 1，其余都为正；兵种的占用取自所属原型', () => {
    expect(archForce('inf')).toBe(1);
    for (const a of ARCHETYPES) expect(a.force, a.key).toBeGreaterThan(0);
    for (const d of UNITS.filter(isContentUnit)) expect(forceOf(d), d.key).toBe(ARCHETYPES[d.arch].force);
    // 同一原型的兵种占用相同：带长柄的近战步兵与不带的一样
    expect(forceOf(UNIT_BY_KEY.ji)).toBe(forceOf(UNIT_BY_KEY.dao));
  });

  it('直射器械的占用为 1：营寨每批 11.6 份出 12 人，份数不够 1 份也出 1 人', () => {
    expect(archForce('bolt')).toBe(1);
    expect(forceOf(UNIT_BY_KEY.scorpio)).toBe(1);
    expect(SITE_INFO[SITE_CAMP].reinfForce).toBe(11.6);
    expect(headcount(UNIT_BY_KEY.scorpio, 11.6)).toBe(12);
    expect(headcount(UNIT_BY_KEY.scorpio, 0.2)).toBe(1);
    // 抛射器械的占用不变
    expect(archForce('siege')).toBe(6.4);
  });

  it('份数换算成人数：份数 ÷ 占用，四舍五入，每个兵种至少 1 人', () => {
    const inf = UNIT_BY_KEY.dao, siege = UNIT_BY_KEY.huojian, ranged = UNIT_BY_KEY.nu;
    expect(headcount(inf, 25)).toBe(25);
    expect(headcount(ranged, 10)).toBe(Math.round(10 / archForce('ranged')));
    expect(headcount(siege, archForce('siege') * 3)).toBe(3);
    expect(headcount(siege, archForce('siege') * 3.4)).toBe(3);
    expect(headcount(siege, archForce('siege') * 3.6)).toBe(4);
    // 份数不够一个人也出 1 个
    expect(headcount(siege, 0.1)).toBe(1);
    expect(headcount(inf, 0)).toBe(1);
  });

  it('兵种表按倍率换算成兵种下标列表：每项各自换算、各至少 1 人', () => {
    const table: [string, number][] = [['dao', 5], ['nu', 6], ['huojian', 1]];
    const c = countBy(forceList(table, 2));
    expect(c.dao).toBe(10);
    expect(c.nu).toBe(headcount(UNIT_BY_KEY.nu, 12));
    expect(c.huojian).toBe(headcount(UNIT_BY_KEY.huojian, 2));
    const tiny = countBy(forceList(table, 0.001));
    expect(tiny).toEqual({ dao: 1, nu: 1, huojian: 1 });
  });
});

describe('开局编制与援军按兵力份数表达', () => {
  it('阵营编制是兵种占全军兵力的比重，之和为 1；编制与援军只用本阵营的兵种', () => {
    for (const id of FACTION_IDS) {
      const f = FACTIONS[id];
      expect(f.army.reduce((n, [, x]) => n + x, 0), id).toBeCloseTo(1, 6);
      for (const [k] of [...f.army, ...f.reinf]) expect(UNIT_BY_KEY[k].faction, k).toBe(id);
    }
  });

  it('开局：人数 = 份数 × 兵员倍率 × 比重 ÷ 兵力占用，每个兵种至少 1 人', () => {
    for (const id of FACTION_IDS) {
      const f = FACTIONS[id];
      const c = countBy(armyList(f, 600));
      for (const [k, share] of f.army) expect(c[k], `${id} ${k}`).toBe(headcount(UNIT_BY_KEY[k], 600 * manpowerMult(f) * share));
      // 份数很少时每个兵种也有 1 人
      for (const n of Object.values(countBy(armyList(f, 1)))) expect(n).toBeGreaterThanOrEqual(1);
      expect(Object.keys(countBy(armyList(f, 1))).length).toBe(f.army.length);
    }
  });

  it('罗马的蝎弩改按占用 1 换算后，其余兵种的比重整体归一：与蝎弩的比值是原来的比值 ÷ 原占用 6.4；850 份时罗马开局蝎弩约 19 人，比重之和仍为 1', () => {
    const rome = FACTIONS.rome;
    const share = (k: string): number => rome.army.find(([x]) => x === k)![1];
    // 迁移前的比重（蝎弩按器械占用 6.4 折算）
    expect(share('scorpio') / share('legion')).toBeCloseTo(0.15506 / 0.249204 / 6.4, 4);
    expect(share('scorpio') / share('equites')).toBeCloseTo(0.15506 / 0.259587 / 6.4, 4);
    expect(share('onager') / share('legion')).toBeCloseTo(0.088606 / 0.249204, 4);
    expect(rome.army.reduce((n, [, x]) => n + x, 0)).toBeCloseTo(1, 6);
    expect(countBy(armyList(rome, 850)).scorpio).toBe(19);
  });

  // 按人头计兵力时（每方兵力 300、600、1000、1500 人）各阵营的开局总人数
  const BEFORE: Record<string, number[]> = {
    china: [303, 605, 1007, 1512], japan: [279, 559, 931, 1395], rome: [263, 525, 875, 1310], persia: [257, 515, 855, 1286],
  };

  it('主菜单档位按份数表达：四个阵营在各档的开局总人数与按人头计时同一档相差不到 5%', () => {
    expect(MENU_SIZES.length).toBe(4);
    MENU_SIZES.forEach((size, i) => {
      const now = FACTION_IDS.reduce((n, id) => n + armyList(FACTIONS[id], size).length, 0);
      const was = FACTION_IDS.reduce((n, id) => n + BEFORE[id][i], 0);
      expect(Math.abs(now / was - 1), `${size} 份`).toBeLessThan(0.05);
    });
  });

  it('援军：兵种人数 = 份数 × 援军倍率 ÷ 兵力占用，每个兵种至少 1 人', () => {
    for (const id of FACTION_IDS) {
      const f = FACTIONS[id];
      const mult = reinforceMult(f);
      const c = countBy(forceList(f.reinf, mult));
      for (const [k, n] of f.reinf) expect(c[k], `${id} ${k}`).toBe(headcount(UNIT_BY_KEY[k], n * mult));
    }
  });

  it('每方人数上限 = 每方兵力份数 × 1.06（电脑一方先按难度调整），不低于 320、不高于 3600；850 份时与按人头计时 600 人一档的上限相同', () => {
    const cap = (armySize: number, difficulty = 1): number[] =>
      createGame({ seed: 5, factions: ['china', 'japan'], armySize, difficulty, fog: false, spectate: false, environment: false, supply: false }).world.unitCap;
    expect(UNIT_CAP_PER_FORCE).toBe(1.06);
    expect(cap(850).slice(1)).toEqual([901, 901]);
    expect(cap(850, 2).slice(1)).toEqual([901, Math.round(Math.round(850 * 1.2) * 1.06)]);
    expect(cap(60).slice(1)).toEqual([320, 320]);
    expect(cap(4000).slice(1)).toEqual([3600, 3600]);
  }, 30000);
});

describe('测量工具的规模以兵力份数计', () => {
  it('标准混编军每份兵力的人数构成不变：份数换算回 100 人 / 300 人时每个位置的人数与位置表一致', () => {
    for (const heads of [100, 300]) {
      const c = refCounts(refForce(heads));
      for (const k of SLOTS) expect(c[k], `${heads} 人的 ${k}`).toBe(Math.max(1, Math.round(heads * REF_SHARE[k])));
    }
    expect(refForcePerHead()).toBeGreaterThan(1);
  });

  it('按份数建标准混编军：总份数接近规模，每个位置至少 1 人', () => {
    const list = buildArmy({ type: 'ref', size: 40 });
    expect(list.length).toBeGreaterThan(0);
    const per = countBy(list);
    expect(Object.keys(per).length).toBe(SLOTS.length);
  });

  it('阵营的标准军按份数建：与开局同一函数', () => {
    expect(buildArmy({ type: 'faction', faction: 'china', size: 300 })).toEqual(armyList(FACTIONS.china, 300));
  });
});
