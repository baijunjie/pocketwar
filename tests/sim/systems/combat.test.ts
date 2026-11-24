import { describe, expect, it } from 'vitest';
import { A_FIRE, A_MELEE, A_PIERCE, BUILDINGS, RULES, UNIT_BY_KEY } from '../../../src/sim/defs';
import { mitigate, spawnProj, updateProjectiles } from '../../../src/sim/systems/combat';
import { flatWorld, run } from '../../helpers';

const K = RULES.combat.armorScale;

describe('强度对比式：mitigate', () => {
  it('伤害 = d² ÷ (d + 系数 × 护甲)', () => {
    expect(K).toBe(2);
    expect(mitigate(10, 5)).toBeCloseTo(100 / (10 + K * 5), 12);
    expect(mitigate(30, 0)).toBe(30);
    expect(mitigate(1, 100)).toBeCloseTo(1 / (1 + K * 100), 12);
  });

  it('没有打击强度（0 或负数）就没有伤害，不会出负数或 NaN', () => {
    expect(mitigate(0, 0)).toBe(0);
    expect(mitigate(0, 10)).toBe(0);
    expect(mitigate(-5, 3)).toBe(0);
  });

  it('护甲越高伤害越低但永远大于 0（没有保底、也不会打不动）；打击越强伤害越高，且一定低于打击强度（护甲为正时）', () => {
    let prev = Infinity;
    for (let a = 0; a <= 60; a += 5) {
      const v = mitigate(8, a);
      expect(v).toBeLessThanOrEqual(prev);
      expect(v).toBeGreaterThan(0);
      if (a > 0) expect(v).toBeLessThan(8);
      prev = v;
    }
    prev = 0;
    for (let d = 1; d <= 50; d += 7) {
      const v = mitigate(d, 6);
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
  });

  it('重击比快击穿甲：同样的每秒输出，单发更高的对高护甲伤害更高', () => {
    // 单发 30 每 3 秒 对 单发 10 每秒（每秒输出相同）
    const heavy = mitigate(30, 10) / 3, light = mitigate(10, 10) / 1;
    expect(heavy).toBeGreaterThan(light);
    // 无护甲时两者相同
    expect(mitigate(30, 0) / 3).toBeCloseTo(mitigate(10, 0) / 1, 12);
  });
});

describe('打建筑', () => {
  it('普通建筑不掉血，也不算「挨过打」（不会让据点进入交战）；行营可以被打', () => {
    const w = flatWorld();
    const house = w.addBuilding(BUILDINGS.house, 40, 40, 2, -1);
    const outpost = w.addBuilding(BUILDINGS.outpost, 50, 40, 2, -1);
    const tick = (b: { hitTick: number }) => b.hitTick;
    const t0 = tick(house);
    for (const atk of [A_MELEE, A_PIERCE, A_FIRE]) w.damageBuilding(house, 1e6, atk, 5, 1);
    expect(house.hp).toBe(house.maxHp);
    expect(tick(house)).toBe(t0);
    w.damageBuilding(outpost, 10, A_MELEE, 1, 1);
    expect(outpost.hp).toBeLessThan(outpost.maxHp);
  });

  it('近战打近战护甲、穿刺打远程护甲，建筑护甲加成（据点升级）算进去，没有保底', () => {
    const w = flatWorld();
    const b = w.addBuilding(BUILDINGS.tower, 40, 40, 2, -1);
    const d = BUILDINGS.tower;
    const hit = (atk: number, raw: number, vsBld = 1): number => {
      const hp = b.hp;
      w.damageBuilding(b, raw, atk, vsBld, 1);
      const lost = hp - b.hp;
      b.hp = hp;
      return lost;
    };
    expect(hit(A_MELEE, 40)).toBeCloseTo(mitigate(40, d.armM), 9);
    expect(hit(A_PIERCE, 40)).toBeCloseTo(mitigate(40, d.armP), 9);
    expect(hit(A_MELEE, 40, 3)).toBeCloseTo(mitigate(120, d.armM), 9);
    b.armor = 3;
    expect(hit(A_MELEE, 40)).toBeCloseTo(mitigate(40, d.armM + 3), 9);
    expect(hit(A_PIERCE, 0.2)).toBeCloseTo(mitigate(0.2, d.armP + 3), 9);
    expect(hit(A_PIERCE, 0.2)).toBeLessThan(0.2);
  });
});

describe('中立塔放箭', () => {
  it('不受视野限制：开着迷雾，双方都没有视野照样射得到范围内的兵', () => {
    const w = flatWorld();
    w.fog = true;
    const tw = w.addBuilding(BUILDINGS.watchtower, 60, 60, 0, -1);
    const u = w.spawnUnit(UNIT_BY_KEY.yari.idx, 1, tw.cx - 100, tw.cy);
    w.hp[u] = w.maxHp[u] = 1e7;
    w.orderStop([u], true);
    run(w, 6);
    expect(w.hp[u]).toBeLessThan(1e7);
  });

  it('射程之外不射', () => {
    const w = flatWorld();
    const tw = w.addBuilding(BUILDINGS.watchtower, 60, 60, 0, -1);
    const u = w.spawnUnit(UNIT_BY_KEY.yari.idx, 1, tw.cx - BUILDINGS.watchtower.tower!.range * 1.5, tw.cy);
    w.hp[u] = w.maxHp[u] = 1e7;
    w.orderStop([u], true);
    run(w, 6);
    expect(w.hp[u]).toBe(1e7);
  });

  it('倒塌后重建没修满之前不放箭', () => {
    const w = flatWorld();
    const tw = w.addBuilding(BUILDINGS.watchtower, 60, 60, 0, -1);
    tw.down = true;
    const u = w.spawnUnit(UNIT_BY_KEY.yari.idx, 1, tw.cx - 100, tw.cy);
    w.hp[u] = w.maxHp[u] = 1e7;
    w.orderStop([u], true);
    run(w, 6);
    expect(w.hp[u]).toBe(1e7);
  });
});

describe('直射器械的弹丸：直射追踪、不溅射', () => {
  it('蝎弩的弹丸追着目标飞：目标在弹丸飞行途中走开也照样命中；旁边贴着的单位不受伤', () => {
    const w = flatWorld();
    const C = w.W / 2;
    const d = UNIT_BY_KEY.scorpio;
    const src = w.spawnUnit(d.idx, 1, C, C);
    const tgt = w.spawnUnit(UNIT_BY_KEY.dao.idx, 2, C + 300, C), near = w.spawnUnit(UNIT_BY_KEY.dao.idx, 2, C + 300, C + 6);
    for (const u of [tgt, near]) w.hp[u] = w.maxHp[u] = 1e5;
    spawnProj(w, w.x[src], w.y[src], tgt, w.x[tgt], w.y[tgt], d.proj, d.dmg, d.atk, d.splash, d.pen, d.idx, 1, src);
    expect(w.pn).toBe(1);
    // 目标走出原来的瞄准点很远（远超任何范围杀伤半径）
    w.x[tgt] += 60;
    for (let t = 0; t < 200 && w.pn > 0; t++) updateProjectiles(w);
    expect(w.pn).toBe(0);
    expect(w.hp[tgt]).toBeLessThan(1e5);
    expect(w.hp[near]).toBe(1e5);
  });
});
