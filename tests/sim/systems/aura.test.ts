import { describe, expect, it } from 'vitest';
import {
  AURA_KINDS, AU_RANGED_TAKEN, A_PIERCE, EXPAND_RULES, RULES, TICK_RATE, TILE, UNIT_BY_KEY, expandUnit, registerUnit,
} from '../../../src/sim/defs';
import { AURA_EVERY, updateAuras } from '../../../src/sim/systems/aura';
import { damageUnit, kill } from '../../../src/sim/systems/combat';
import { buildGrid } from '../../../src/sim/systems/grid';
import { defaultSystems } from '../../../src/sim/systems';
import { startRout } from '../../../src/sim/systems/morale';
import type { World } from '../../../src/sim/world';
import { flatWorld } from '../../helpers';

const C = (120 * TILE) / 2;
const NEUTRAL = AURA_KINDS[AU_RANGED_TAKEN].neutral;

// 测试用的光环兵种：用真特性 cover 展开（点数已声明），再把光环数据换成要测的半径与倍率；登记成 probe，不混进正式兵种
function probeUnit(key: string, radius: number, value: number): number {
  const [d] = expandUnit({ faction: 'china', key, name: key, arch: 'inf', spec: { traits: ['cover'] }, desc: '' }, EXPAND_RULES, false);
  d.probe = true;
  d.auras = [{ name: key, kind: AU_RANGED_TAKEN, radius, value }];
  registerUnit(d);
  return d.idx;
}
const WEAK = probeUnit('t_weak', 60, 0.8);
const STRONG = probeUnit('t_strong', 60, 0.6);
const BIG = probeUnit('t_big', 120, 0.7);
const PLAIN = UNIT_BY_KEY.samurai.idx;

const buf = (w: World): Float32Array => w.aura[AU_RANGED_TAKEN];
/** 重建网格后更新一次光环 */
function refresh(w: World): void {
  buildGrid(w);
  updateAuras(w);
}

describe('光环更新：作用范围与对象', () => {
  it('半径内其他己方单位得到特性写的倍率；半径外、敌方、来源自己保持无加成', () => {
    const w = flatWorld();
    const src = w.spawnUnit(WEAK, 1, C, C);
    const near = w.spawnUnit(PLAIN, 1, C + 40, C);
    const diag = w.spawnUnit(PLAIN, 1, C - 30, C + 40); // 距离 50，斜向
    const far = w.spawnUnit(PLAIN, 1, C + 70, C);
    const farDiag = w.spawnUnit(PLAIN, 1, C - 50, C - 50); // 距离约 70.7
    const enemy = w.spawnUnit(PLAIN, 2, C + 20, C);
    refresh(w);
    expect(buf(w)[near]).toBeCloseTo(0.8, 6);
    expect(buf(w)[diag]).toBeCloseTo(0.8, 6);
    expect(buf(w)[far]).toBe(NEUTRAL);
    expect(buf(w)[farDiag]).toBe(NEUTRAL);
    expect(buf(w)[enemy]).toBe(NEUTRAL);
    expect(buf(w)[src]).toBe(NEUTRAL);
  });

  it('没有来源时所有人都是无加成', () => {
    const w = flatWorld();
    const a = w.spawnUnit(PLAIN, 1, C, C), b = w.spawnUnit(PLAIN, 1, C + 10, C);
    refresh(w);
    expect(buf(w)[a]).toBe(NEUTRAL);
    expect(buf(w)[b]).toBe(NEUTRAL);
  });

  it('敌方的来源只罩敌方自己人，不罩我方', () => {
    const w = flatWorld();
    w.spawnUnit(WEAK, 2, C, C);
    const mine = w.spawnUnit(PLAIN, 1, C + 20, C);
    const theirs = w.spawnUnit(PLAIN, 2, C - 20, C);
    refresh(w);
    expect(buf(w)[mine]).toBe(NEUTRAL);
    expect(buf(w)[theirs]).toBeCloseTo(0.8, 6);
  });

  it('光环来源之间互相罩住（来源只是不罩自己）', () => {
    const w = flatWorld();
    const a = w.spawnUnit(WEAK, 1, C, C), b = w.spawnUnit(WEAK, 1, C + 30, C);
    refresh(w);
    expect(buf(w)[a]).toBeCloseTo(0.8, 6);
    expect(buf(w)[b]).toBeCloseTo(0.8, 6);
  });

  it('半径取特性上的值：半径 120 的光环罩得到 100 远的人，半径 60 的罩不到', () => {
    const w = flatWorld();
    w.spawnUnit(BIG, 1, C, C);
    w.spawnUnit(WEAK, 1, C, C + 300);
    const a = w.spawnUnit(PLAIN, 1, C + 100, C);
    const b = w.spawnUnit(PLAIN, 1, C + 100, C + 300);
    refresh(w);
    expect(buf(w)[a]).toBeCloseTo(0.7, 6);
    expect(buf(w)[b]).toBe(NEUTRAL);
  });

  it('贴着地图边缘的来源也能正确更新（不越界）', () => {
    const w = flatWorld();
    w.spawnUnit(WEAK, 1, 5, 5);
    const a = w.spawnUnit(PLAIN, 1, 30, 20);
    const edge = 120 * TILE - 5;
    w.spawnUnit(WEAK, 1, edge, edge);
    const b = w.spawnUnit(PLAIN, 1, edge - 20, edge - 20);
    expect(() => refresh(w)).not.toThrow();
    expect(buf(w)[a]).toBeCloseTo(0.8, 6);
    expect(buf(w)[b]).toBeCloseTo(0.8, 6);
  });
});

describe('光环更新：同类取最强，不叠加', () => {
  it('同时被 0.8 与 0.6 两个光环罩住，结果是 0.6，不是 0.48', () => {
    const w = flatWorld();
    w.spawnUnit(WEAK, 1, C - 20, C);
    w.spawnUnit(STRONG, 1, C + 20, C);
    const a = w.spawnUnit(PLAIN, 1, C, C);
    refresh(w);
    expect(buf(w)[a]).toBeCloseTo(0.6, 6);
  });

  it('与来源的遍历顺序无关：强的先生成、弱的后生成，结果同样是 0.6', () => {
    const w = flatWorld();
    w.spawnUnit(STRONG, 1, C + 20, C);
    w.spawnUnit(WEAK, 1, C - 20, C);
    const a = w.spawnUnit(PLAIN, 1, C, C);
    refresh(w);
    expect(buf(w)[a]).toBeCloseTo(0.6, 6);
  });

  it('两个同样的光环扎堆也只算一个：0.8 不变成 0.64', () => {
    const w = flatWorld();
    w.spawnUnit(WEAK, 1, C - 20, C);
    w.spawnUnit(WEAK, 1, C + 20, C);
    w.spawnUnit(WEAK, 1, C, C + 20);
    const a = w.spawnUnit(PLAIN, 1, C, C);
    refresh(w);
    expect(buf(w)[a]).toBeCloseTo(0.8, 6);
  });

  it('只在弱光环范围内的人拿弱的，两个都罩得到的拿强的', () => {
    const w = flatWorld();
    w.spawnUnit(STRONG, 1, C, C);
    w.spawnUnit(WEAK, 1, C + 100, C);
    const both = w.spawnUnit(PLAIN, 1, C + 50, C);   // 离强 50、离弱 50
    const onlyWeak = w.spawnUnit(PLAIN, 1, C + 150, C);
    refresh(w);
    expect(buf(w)[both]).toBeCloseTo(0.6, 6);
    expect(buf(w)[onlyWeak]).toBeCloseTo(0.8, 6);
  });
});

describe('光环更新：来源溃逃、阵亡与受益者溃逃', () => {
  it('来源溃逃后，下一次更新时加成消失', () => {
    const w = flatWorld();
    const src = w.spawnUnit(WEAK, 1, C, C);
    const a = w.spawnUnit(PLAIN, 1, C + 20, C);
    refresh(w);
    expect(buf(w)[a]).toBeCloseTo(0.8, 6);
    startRout(w, src);
    refresh(w);
    expect(buf(w)[a]).toBe(NEUTRAL);
  });

  it('来源阵亡后，下一次更新时加成消失', () => {
    const w = flatWorld();
    const src = w.spawnUnit(WEAK, 1, C, C);
    const a = w.spawnUnit(PLAIN, 1, C + 20, C);
    refresh(w);
    expect(buf(w)[a]).toBeCloseTo(0.8, 6);
    kill(w, src, 2, -1);
    refresh(w);
    expect(buf(w)[a]).toBe(NEUTRAL);
  });

  it('强来源没了，弱来源仍罩着的人退回弱的', () => {
    const w = flatWorld();
    w.spawnUnit(WEAK, 1, C - 20, C);
    const strong = w.spawnUnit(STRONG, 1, C + 20, C);
    const a = w.spawnUnit(PLAIN, 1, C, C);
    refresh(w);
    expect(buf(w)[a]).toBeCloseTo(0.6, 6);
    kill(w, strong, 2, -1);
    refresh(w);
    expect(buf(w)[a]).toBeCloseTo(0.8, 6);
  });

  it('受益者自己溃逃时照样受益，挨远程伤害仍乘光环倍率', () => {
    const w = flatWorld();
    w.spawnUnit(WEAK, 1, C, C);
    const a = w.spawnUnit(PLAIN, 1, C + 20, C);
    w.hp[a] = w.maxHp[a] = 1000;
    startRout(w, a);
    refresh(w);
    expect(buf(w)[a]).toBeCloseTo(0.8, 6);
    const before = w.hp[a];
    damageUnit(w, a, 20, A_PIERCE, 0, null, 2, -1);
    const withAura = before - w.hp[a];
    // 对照：同样的溃兵没有光环
    const w2 = flatWorld();
    const b = w2.spawnUnit(PLAIN, 1, C + 20, C);
    w2.hp[b] = w2.maxHp[b] = 1000;
    startRout(w2, b);
    damageUnit(w2, b, 20, A_PIERCE, 0, null, 2, -1);
    expect(withAura / (1000 - w2.hp[b])).toBeCloseTo(0.8, 3);
  });

  it('来源移走后，原来被罩住的人下一次更新时失去加成；走进来的人得到加成', () => {
    const w = flatWorld();
    const src = w.spawnUnit(WEAK, 1, C, C);
    const a = w.spawnUnit(PLAIN, 1, C + 20, C);
    const b = w.spawnUnit(PLAIN, 1, C + 300, C);
    refresh(w);
    w.x[src] = C + 300;
    refresh(w);
    expect(buf(w)[a]).toBe(NEUTRAL);
    expect(buf(w)[b]).toBeCloseTo(0.8, 6);
  });

  it('阵亡单位的槽位被新单位复用时不继承加成', () => {
    const w = flatWorld();
    w.spawnUnit(WEAK, 1, C, C);
    const a = w.spawnUnit(PLAIN, 1, C + 20, C);
    refresh(w);
    expect(buf(w)[a]).toBeCloseTo(0.8, 6);
    kill(w, a, 2, -1);
    const reuse = w.spawnUnit(PLAIN, 1, C + 500, C);
    expect(reuse).toBe(a);
    expect(buf(w)[reuse]).toBe(NEUTRAL);
  });
});

describe('光环定期更新：接入每帧管线', () => {
  it('间隔来自规则表的秒数换算成帧，至少 1 帧', () => {
    expect(AURA_EVERY).toBe(Math.max(1, Math.round(RULES.aura.interval * TICK_RATE)));
    expect(AURA_EVERY).toBeGreaterThan(1);
  });

  it('管线里按这个间隔跑，排在网格之后、行军、单位与投射物结算之前', () => {
    const names = defaultSystems().map(s => s.name);
    const aura = defaultSystems().find(s => s.name === 'aura')!;
    expect(aura.every).toBe(AURA_EVERY);
    for (const later of ['march', 'units', 'projectiles']) expect(names.indexOf('aura'), later).toBeLessThan(names.indexOf(later));
    expect(names.indexOf('aura')).toBeGreaterThan(names.indexOf('grid'));
  });

  it('不是每帧更新：到了间隔才写入加成，之后的变化也要等到下一个间隔才生效', () => {
    const w = flatWorld();
    const src = w.spawnUnit(WEAK, 1, C, C);
    const a = w.spawnUnit(PLAIN, 1, C + 20, C);
    // 刚生成时没有加成，更新点之前一直是无加成
    for (let t = 1; t < AURA_EVERY; t++) {
      w.tick();
      expect(buf(w)[a], `第 ${t} 帧`).toBe(NEUTRAL);
    }
    w.tick();
    expect(buf(w)[a]).toBeCloseTo(0.8, 6);
    // 来源阵亡后，到下一个更新点之前加成还在，之后消失（溃逃在没有敌人的世界里会立刻重整，所以用阵亡）
    kill(w, src, 2, -1);
    for (let t = 1; t < AURA_EVERY; t++) {
      w.tick();
      expect(buf(w)[a], `阵亡后第 ${t} 帧`).toBeCloseTo(0.8, 6);
    }
    w.tick();
    expect(buf(w)[a]).toBe(NEUTRAL);
  });
});

describe('新生成的单位', () => {
  it('光环加成初始为各种类的无加成值', () => {
    const w = flatWorld();
    const a = w.spawnUnit(PLAIN, 1, C, C);
    for (let k = 0; k < AURA_KINDS.length; k++) expect(w.aura[k][a], AURA_KINDS[k].key).toBe(AURA_KINDS[k].neutral);
  });
});
