import { describe, expect, it } from 'vitest';
import { AU_RANGED_TAKEN, A_FIRE, A_MELEE, A_PIERCE, A_SIEGE, ARCHETYPES, BUILDINGS, RULES, TILE, UNITS, UNIT_BY_KEY, archetypePower } from '../src/sim/defs';
import { damageUnit, kill } from '../src/sim/systems/combat';
import { startRout } from '../src/sim/systems/morale';
import { S_WALL } from '../src/sim/world';
import { flatWorld } from './helpers';

const C = (120 * TILE) / 2;
const idx = (k: string): number => UNIT_BY_KEY[k].idx;
const c = RULES.combat.armorScale;
/** 强度对比式 */
const expectDmg = (d: number, armor: number): number => (d * d) / (d + c * armor);

/** 摆一个血量充足的靶子，打一下，返回掉了多少血（生命存在 Float32Array 里，血量取小一点才不丢小数） */
function hit(key: string, raw: number, atk: number, pen = 0, vs: number[] | null = null, setup?: (w: ReturnType<typeof flatWorld>, u: number) => void): number {
  const w = flatWorld();
  const u = w.spawnUnit(idx(key), 1, C, C);
  w.hp[u] = w.maxHp[u] = 1000;
  setup?.(w, u);
  damageUnit(w, u, raw, atk, pen, vs, 2, -1);
  return 1000 - w.hp[u];
}

describe('伤害公式：强度对比式', () => {
  const sam = UNIT_BY_KEY.samurai;

  it('系数登记为规则数值：2', () => {
    expect(c).toBe(2);
  });

  it('近战按近战护甲、远程按远程护甲：伤害 = d² ÷ (d + 2 × 护甲)', () => {
    expect(sam.armM).not.toBe(sam.armP);
    expect(hit('samurai', 20, A_MELEE)).toBeCloseTo(expectDmg(20, sam.armM), 3);
    expect(hit('samurai', 20, A_PIERCE)).toBeCloseTo(expectDmg(20, sam.armP), 3);
  });

  it('破甲按比例折掉护甲，全破甲时不减伤', () => {
    expect(hit('samurai', 20, A_MELEE, 0.5)).toBeCloseTo(expectDmg(20, sam.armM * 0.5), 3);
    expect(hit('samurai', 20, A_MELEE, 1)).toBeCloseTo(20, 3);
  });

  it('克制倍率进入打击强度，而不是在护甲结算之后再乘', () => {
    const vs = UNITS.map(() => 1.5);
    const got = hit('samurai', 20, A_MELEE, 0, vs);
    expect(got).toBeCloseTo(expectDmg(30, sam.armM), 3);
    // 打击强度翻倍，伤害的增幅超过单纯乘倍率（护甲被相对压低）
    expect(got).toBeGreaterThan(hit('samurai', 20, A_MELEE) * 1.5);
  });

  it('没有保底：很弱的打击对上高护甲，伤害就是公式算出的小数', () => {
    const got = hit('samurai', 1, A_MELEE);
    expect(got).toBeCloseTo(expectDmg(1, sam.armM), 3);
    expect(got).toBeLessThan(1);
    expect(got).toBeGreaterThan(0);
  });

  it('不计护甲的攻击（投石、火箭、火炮）按护甲 0 结算', () => {
    expect(hit('samurai', 20, A_SIEGE)).toBeCloseTo(20, 3);
  });

  it('溃兵不计护甲，只乘溃兵倍率', () => {
    const got = hit('samurai', 20, A_MELEE, 0, null, (w, u) => startRout(w, u));
    expect(got).toBeCloseTo(20 * RULES.morale.routDamage, 3);
  });

  it('举盾、龟甲阵、林地、垛口、等级防御这些后续倍率照旧乘在结算之后', () => {
    const base = expectDmg(20, UNIT_BY_KEY.legion.armP);
    expect(hit('legion', 20, A_PIERCE)).toBeCloseTo(base * 0.65, 3);
    // 城墙垛口只对远程生效
    const wall = hit('samurai', 20, A_PIERCE, 0, null, (w, u) => { w.state[u] |= S_WALL; });
    expect(wall).toBeCloseTo(expectDmg(20, sam.armP) * RULES.siege.wallCover, 3);
    const melee = hit('samurai', 20, A_MELEE, 0, null, (w, u) => { w.state[u] |= S_WALL; });
    expect(melee).toBeCloseTo(expectDmg(20, sam.armM), 3);
  });
});

describe('伤害公式：光环的所受远程伤害倍率', () => {
  const aura = (v: number) => (w: ReturnType<typeof flatWorld>, u: number): void => { w.aura[AU_RANGED_TAKEN][u] = v; };

  it('远程攻击（穿刺）的伤害乘受害者当前的倍率', () => {
    const base = hit('samurai', 20, A_PIERCE);
    expect(hit('samurai', 20, A_PIERCE, 0, null, aura(0.8))).toBeCloseTo(base * 0.8, 3);
    expect(hit('samurai', 20, A_PIERCE, 0, null, aura(0.5))).toBeCloseTo(base * 0.5, 3);
  });

  it('无加成值 1 时伤害不变', () => {
    expect(hit('samurai', 20, A_PIERCE, 0, null, aura(1))).toBeCloseTo(hit('samurai', 20, A_PIERCE), 5);
  });

  it('近战与不计护甲的攻城伤害不受影响', () => {
    expect(hit('samurai', 20, A_MELEE, 0, null, aura(0.5))).toBeCloseTo(hit('samurai', 20, A_MELEE), 5);
    expect(hit('samurai', 20, A_SIEGE, 0, null, aura(0.5))).toBeCloseTo(20, 3);
  });

  it('与龟甲阵、城墙垛口同一层相乘', () => {
    const testudo = hit('legion', 20, A_PIERCE);
    expect(hit('legion', 20, A_PIERCE, 0, null, aura(0.8))).toBeCloseTo(testudo * 0.8, 3);
    const wall = hit('samurai', 20, A_PIERCE, 0, null, (w, u) => { w.state[u] |= S_WALL; });
    expect(hit('samurai', 20, A_PIERCE, 0, null, (w, u) => { w.state[u] |= S_WALL; aura(0.8)(w, u); })).toBeCloseTo(wall * 0.8, 3);
  });

  it('只看受害者自己的加成，旁边别人的加成不影响它', () => {
    const w = flatWorld();
    const a = w.spawnUnit(idx('samurai'), 1, C, C), b = w.spawnUnit(idx('samurai'), 1, C + 10, C);
    w.hp[a] = w.maxHp[a] = w.hp[b] = w.maxHp[b] = 1000;
    w.aura[AU_RANGED_TAKEN][a] = 0.5;
    damageUnit(w, b, 20, A_PIERCE, 0, null, 2, -1);
    expect(1000 - w.hp[b]).toBeCloseTo(hit('samurai', 20, A_PIERCE), 3);
  });
});

describe('伤害公式：建筑', () => {
  function build(key: string) {
    const w = flatWorld();
    const b = w.addBuilding(BUILDINGS[key], 40, 40, 2, -1);
    b.hp = b.maxHp = 1e6;
    return { w, b };
  }

  it('计护甲的攻击：打击强度 = 攻击 × 对建筑倍率，同一条公式', () => {
    const { w, b } = build('keep_town');
    w.damageBuilding(b, 40, A_MELEE, 2, 1);
    expect(1e6 - b.hp).toBeCloseTo(expectDmg(80, BUILDINGS.keep_town.armM), 5);
    const p = build('keep_town');
    p.w.damageBuilding(p.b, 40, A_PIERCE, 2, 1);
    expect(1e6 - p.b.hp).toBeCloseTo(expectDmg(80, BUILDINGS.keep_town.armP), 5);
  });

  it('据点升级的护甲加成算进护甲项；不计护甲的攻击不看护甲', () => {
    const { w, b } = build('keep_town');
    b.armor = 3;
    w.damageBuilding(b, 40, A_MELEE, 1, 1);
    expect(1e6 - b.hp).toBeCloseTo(expectDmg(40, BUILDINGS.keep_town.armM + 3), 5);
    const s = build('keep_town');
    s.b.armor = 3;
    s.w.damageBuilding(s.b, 40, A_SIEGE, 1, 1);
    expect(1e6 - s.b.hp).toBeCloseTo(40, 5);
  });

  it('没有保底：很弱的打击对上高护甲，伤害是公式算出的小数', () => {
    const { w, b } = build('keep_town');
    w.damageBuilding(b, 1, A_PIERCE, 1, 1);
    const got = 1e6 - b.hp;
    expect(got).toBeCloseTo(expectDmg(1, BUILDINGS.keep_town.armP), 5);
    expect(got).toBeLessThan(0.5);
  });

  it('火把按建筑材质的倍率结算，不走护甲', () => {
    const wood = build('palisade');
    wood.w.damageBuilding(wood.b, 30, A_FIRE, 1, 1);
    expect(1e6 - wood.b.hp).toBeCloseTo(30 * RULES.siege.wood, 5);
    const stone = build('keep_town');
    stone.w.damageBuilding(stone.b, 30, A_FIRE, 1, 1);
    expect(1e6 - stone.b.hp).toBeCloseTo(30 * RULES.siege.stone, 5);
  });
});

describe('经验值只看原型', () => {
  const tier0 = UNITS.filter(d => d.tier === 0);

  it('初级形态的经验值是所属原型的登记值，同一原型的兵种相同，与自身强弱无关；带长柄的与不带的一样', () => {
    for (const d of tier0) expect(d.xpValue, d.key).toBe(RULES.xp.value[ARCHETYPES[d.arch].key]);
    const inf = tier0.filter(d => ARCHETYPES[d.arch].key === 'inf');
    expect(inf.length).toBeGreaterThan(5);
    // 同一原型里面板强弱不同（战力估值不同），经验值仍然一样
    expect(new Set(inf.map(d => d.power.toFixed(3))).size).toBeGreaterThan(1);
    expect(new Set(inf.map(d => d.xpValue)).size).toBe(1);
  });

  it('登记值是原型基准战力估值的 10 倍（取整）', () => {
    for (const a of ARCHETYPES) expect(RULES.xp.value[a.key], a.key).toBe(Math.round(archetypePower(a) * 10));
  });

  it('高级形态在初级形态的基础上乘统一倍率', () => {
    expect(RULES.xp.elite).toBe(1.3);
    for (const d of tier0) expect(UNITS[d.elite].xpValue, d.key).toBe(Math.round(d.xpValue * RULES.xp.elite));
  });

  it('战力估值（士气与 AI 用）仍随兵种自身数值变', () => {
    for (const d of tier0) expect(UNITS[d.elite].power, d.key).toBeGreaterThan(d.power);
  });

  it('击杀者拿全额，且拿到的就是被击杀者所属类别的经验值', () => {
    const w = flatWorld();
    const killer = w.spawnUnit(idx('samurai'), 1, C, C), victim = w.spawnUnit(idx('nu'), 2, C + 20, C);
    w.xp[killer] = 0;
    kill(w, victim, 1, killer);
    expect(w.xp[killer]).toBe(RULES.xp.value.ranged);
  });
});
