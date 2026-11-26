import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { A_MELEE, A_PIERCE, A_SIEGE, ARCHETYPES, DIM_PRICE, HP_SCALE, P_BIGBOLT, RULES, TRAITS, UNITS, UNIT_BY_KEY, UNIT_POINT_LIMITS, tagBit, unitKind } from '../src/sim/defs';
import { damageUnit } from '../src/sim/systems/combat';
import { flatWorld } from './helpers';

/** 每个兵种原来的类别 */
const OLD_CLASS: Record<string, string> = {
  ji: 'spear', dao: 'inf', nu: 'ranged', liannu: 'ranged', tieqi: 'cav', huojian: 'siege', pili: 'siege',
  yari: 'spear', samurai: 'inf', yumi: 'ranged', teppo: 'ranged', kiba: 'cav', sohei: 'inf', ozutsu: 'siege',
  legion: 'inf', auxilia: 'spear', velites: 'ranged', sagitt: 'ranged', equites: 'cav', scorpio: 'siege', onager: 'siege',
  spara: 'spear', immortal: 'inf', kamandar: 'ranged', asvaran: 'cavr', cataphract: 'cav', elephant: 'ele', mangonel: 'siege',
};
/** 原来的类别对应的原型 */
const OLD_CLASS_ARCH: Record<string, string> = { inf: 'inf', spear: 'inf', ranged: 'ranged', cav: 'cav', cavr: 'cavr', ele: 'vehicle', siege: 'siege' };
/** 器械按武器体系拆成两个原型后，归直射器械的兵种（其余器械归抛射器械） */
const BOLT_UNITS = ['scorpio'];

describe('类别改为原型', () => {
  it('七个类别落成七个原型：枪兵并入近战步兵并带长柄，器械拆成抛射器械与直射器械', () => {
    expect(ARCHETYPES.map(a => a.key)).toEqual(['inf', 'ranged', 'cav', 'cavr', 'vehicle', 'siege', 'bolt']);
    for (const d of UNITS) {
      const k = d.key.replace(/_e$/, ''), oldCls = OLD_CLASS[k];
      expect(ARCHETYPES[d.arch].key, d.key).toBe(BOLT_UNITS.includes(k) ? 'bolt' : OLD_CLASS_ARCH[oldCls]);
      const polearm = (d.tags & tagBit('polearm')) !== 0;
      expect(polearm, d.key).toBe(oldCls === 'spear');
      // 兵种带自己原型的标签
      expect(d.tags & tagBit(ARCHETYPES[d.arch].key), d.key).not.toBe(0);
    }
  });

  it('原型自带的行为：近战骑兵冲锋、远程骑兵边走边射、载具践踏；近战的原型射程为 0，远程的大于 0', () => {
    for (const d of UNITS) {
      const a = ARCHETYPES[d.arch];
      expect(a.ranged, d.key).toBe(!d.melee);
      if (a.key === 'cav') expect(d.abilities.charge, d.key).toBeDefined();
      else expect(d.abilities.charge, d.key).toBeUndefined();
    }
    expect(UNIT_BY_KEY.asvaran.traits).toBe(4);
    expect(UNIT_BY_KEY.elephant.traits).toBe(0);
  });

  it('长柄特性：立枪拒马，各枪兵对骑兵的倍率可以不同；僧兵、投矛散兵、蝎弩的克制记在特性上', () => {
    expect(TRAITS.polearm.abilities?.brace).toBeDefined();
    expect(UNIT_BY_KEY.ji.abilities.brace).toBeDefined();
    expect(UNIT_BY_KEY.dao.abilities.brace).toBeUndefined();
    const vs = (a: string, t: string): number => UNIT_BY_KEY[a].vs[UNIT_BY_KEY[t].idx];
    expect(vs('ji', 'tieqi')).toBeCloseTo(2.5);
    expect(vs('auxilia', 'equites')).toBeCloseTo(2.4);
    expect(vs('ji', 'yari')).toBeCloseTo(1);
    expect(vs('dao', 'ji')).toBeCloseTo(1.25);
    expect(vs('tieqi', 'ji')).toBeCloseTo(0.8);
    expect(vs('elephant', 'ji')).toBeCloseTo(1);
    expect(vs('sohei', 'tieqi')).toBeCloseTo(1.6);
    expect(vs('velites', 'elephant')).toBeCloseTo(2.5);
    expect(vs('scorpio', 'elephant')).toBeCloseTo(2);
  });

  it('界面显示原型名，带长柄的跟在后面；类别名「枪兵」不再出现', () => {
    expect(unitKind(UNIT_BY_KEY.dao)).toBe('近战步兵');
    expect(unitKind(UNIT_BY_KEY.ji)).toBe('近战步兵·长柄');
    expect(unitKind(UNIT_BY_KEY.elephant)).toBe('载具');
    expect(unitKind(UNIT_BY_KEY.onager)).toBe('抛射器械');
    expect(unitKind(UNIT_BY_KEY.scorpio)).toBe('直射器械');
    for (const d of UNITS) expect(unitKind(d)).not.toContain('枪兵');
  });
});

describe('直射器械原型与蝎弩', () => {
  const bolt = ARCHETYPES.find(a => a.key === 'bolt')!, siege = ARCHETYPES.find(a => a.key === 'siege')!;
  const scorpio = UNIT_BY_KEY.scorpio;

  it('直射器械基准：生命 100（展开时乘全局倍率）、单发 90、间隔 4.5 秒、射程 400、最近 60，兵力占用 1；不带范围杀伤也不开这个维度，抛射器械不受影响', () => {
    expect(bolt.ranged).toBe(true);
    expect(bolt.force).toBe(1);
    expect(bolt.panel).toMatchObject({ hp: 100, dmg: 90, cd: 4.5, range: 400, pen: 0, splash: 0 });
    expect(bolt.base.minRange).toBe(60);
    expect(bolt.dims).not.toContain('splash');
    expect(bolt.dims).toContain('pen');
    expect(siege.panel.splash).toBe(30);
    expect(siege.dims).toContain('splash');
    expect(siege.force).toBe(6.4);
  });

  it('蝎弩属于直射器械：生命 220、单发 90、间隔 4.5 秒、射程 400（最近 60）、破甲 80%、穿刺伤害、无范围杀伤，只挂「重弩」特性', () => {
    expect(ARCHETYPES[scorpio.arch].key).toBe('bolt');
    expect(bolt.panel.hp * HP_SCALE).toBeCloseTo(220, 9);
    expect(scorpio.hp).toBe(220);
    expect(scorpio.main.lvDmg[0]).toBe(90);
    expect(scorpio.main.lvCd[0]).toBe(4.5);
    expect(scorpio.main.range).toBe(400);
    expect(scorpio.main.minRange).toBe(60);
    expect(scorpio.main.pen).toBeCloseTo(0.8, 12);
    expect(scorpio.main.atk).toBe(A_PIERCE);
    expect(scorpio.main.splash).toBe(0);
    expect(scorpio.main.proj).toBe(P_BIGBOLT);
    expect(scorpio.ownTraits).toEqual(['ballista']);
    // 点数 = 破甲 +8 的单价 + 重弩特性点数（其余维度都是基准），且在单兵种点数上下限内
    expect(scorpio.points).toBeCloseTo(DIM_PRICE.pen * 8 + TRAITS.ballista.points, 9);
    expect(scorpio.points).toBeGreaterThanOrEqual(UNIT_POINT_LIMITS[0]);
    expect(scorpio.points).toBeLessThanOrEqual(UNIT_POINT_LIMITS[1]);
    // 抛射器械的兵种仍是攻城伤害与范围杀伤
    expect(UNIT_BY_KEY.onager.main.atk).toBe(A_SIEGE);
    expect(UNIT_BY_KEY.onager.main.splash).toBeGreaterThan(0);
    // 践踏：近战武器带范围杀伤，面板的范围杀伤仍是 0
    expect(UNIT_BY_KEY.elephant.melee).toBe(true);
    expect(UNIT_BY_KEY.elephant.main.splash).toBe(28);
  });

  it('经验值按原型常量：直射器械 26（基准战力估值的 10 倍），高级形态乘 1.3', () => {
    expect(RULES.xp.value.bolt).toBe(26);
    expect(scorpio.xpValue).toBe(26);
    expect(UNITS[scorpio.elite].xpValue).toBe(Math.round(26 * RULES.xp.elite));
  });

  it('克制：骑兵克制直射器械的倍率与克制抛射器械相同（蝎弩原先归器械）；重弩只加打载具的倍率，别的不变', () => {
    expect(UNIT_BY_KEY.tieqi.vs[scorpio.idx]).toBeCloseTo(UNIT_BY_KEY.tieqi.vs[UNIT_BY_KEY.onager.idx], 12);
    expect(UNIT_BY_KEY.tieqi.vs[scorpio.idx]).toBeCloseTo(2);
    expect(scorpio.vs[UNIT_BY_KEY.elephant.idx]).toBeCloseTo(2);
    expect(scorpio.vs[UNIT_BY_KEY.dao.idx]).toBeCloseTo(1);
    expect(scorpio.vs[UNIT_BY_KEY.tieqi.idx]).toBeCloseTo(1);
  });
});

describe('克制查询：伤害结算走统一的倍率表', () => {
  it('伤害结算按攻击方兵种对目标兵种的倍率', () => {
    const w = flatWorld();
    const C = w.W / 2;
    const target = w.spawnUnit(UNIT_BY_KEY.ji.idx, 2, C, C), other = w.spawnUnit(UNIT_BY_KEY.dao.idx, 2, C + 200, C);
    for (const u of [target, other]) w.hp[u] = w.maxHp[u] = 1000;
    // 同样面板的两个目标：刀盾兵 与 长戟兵（长柄），被刀盾兵打的倍率不同
    const row = UNIT_BY_KEY.dao.vs;
    expect(row[UNIT_BY_KEY.ji.idx]).toBeCloseTo(1.25);
    expect(row[UNIT_BY_KEY.dao.idx]).toBe(1);
    const before = w.hp[target];
    damageUnit(w, target, 100, A_MELEE, 1, row, 1, -1);
    // 破甲 1：不计护甲，伤害 = 打击强度 = 100 × 1.25
    expect(before - w.hp[target]).toBeCloseTo(125, 3);
  });
});

describe('系统代码只读原型、标签与特性', () => {
  it('src/sim/systems 与 src/sim/ai 里不出现具体兵种 key 或原型 key', () => {
    const keys = [...UNITS.map(d => d.key.replace(/_e$/, '')), ...ARCHETYPES.map(a => a.key)];
    const files = ['systems', 'ai'].flatMap(dir => readdirSync(`src/sim/${dir}`, { recursive: false }).map(f => `src/sim/${dir}/${f}`));
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      for (const k of new Set(keys)) expect(text, `${f} 提到 '${k}'`).not.toMatch(new RegExp(`['"\`]${k}(_e)?['"\`]`));
    }
  });
});
