import { describe, expect, it } from 'vitest';
import { A_FIRE, A_MELEE, A_PIERCE, A_SIEGE, BUILDINGS, LEVELS, P_ARROW, P_BALL, P_TORCH, RULES, TILE, T_HILL, TowerDef, UNITS, UNIT_BY_KEY } from '../../../src/sim/defs';
import { damageUnit, mitigate, spawnProj, strike, updateProjectiles, updateTowers } from '../../../src/sim/systems/combat';
import { BASE, variant } from '../../../tools/measure/units';
import { BLD_SKIP_ALL, NONE } from '../../../src/sim/state';
import type { World } from '../../../src/sim/world';
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
    spawnProj(w, w.x[src], w.y[src], tgt, w.x[tgt], w.y[tgt], d.main.proj, d.main.lvDmg[0], d.main.atk, d.main.splash, d.main.pen, d.idx, 1, src);
    expect(w.pn).toBe(1);
    // 目标走出原来的瞄准点很远（远超任何范围杀伤半径）
    w.x[tgt] += 60;
    for (let t = 0; t < 200 && w.pn > 0; t++) updateProjectiles(w);
    expect(w.pn).toBe(0);
    expect(w.hp[tgt]).toBeLessThan(1e5);
    expect(w.hp[near]).toBe(1e5);
  });
});

describe('按武器出手：strike', () => {
  const C = (120 * TILE) / 2;
  const idx = (k: string): number => UNIT_BY_KEY[k].idx;
  /** 一个攻击者与一个远处的靶子（队伍 2，血量近乎无限），投射物槽清空 */
  const scene = (key: string | number, hp = 1) => {
    const w = flatWorld();
    const a = w.spawnUnit(typeof key === 'number' ? key : idx(key), 1, C, C);
    w.maxHp[a] = 1e5;
    w.hp[a] = 1e5 * hp;
    const e = w.spawnUnit(idx('dao'), 2, C + 80, C);
    w.hp[e] = w.maxHp[e] = 1e5;
    w.pn = 0;
    return { w, a, e };
  };

  it('副武器单独一个冷却：出手后 auxCd 重置为副武器的间隔（±10%），主武器的 cd 不动', () => {
    const { w, a, e } = scene('legion');
    const d = UNIT_BY_KEY.legion;
    w.cd[a] = 0.25;
    w.auxCd[a] = 0;
    strike(w, a, d, d.aux!, e, 0);
    expect(w.cd[a]).toBe(0.25);
    expect(w.auxCd[a]).toBeGreaterThanOrEqual(d.aux!.lvCd[0] * 0.9);
    expect(w.auxCd[a]).toBeLessThanOrEqual(d.aux!.lvCd[0] * 1.1);
    expect(w.pn).toBe(1);
    expect(w.pTgt[0]).toBe(e);
  });

  it('主武器与对建筑武器共用 cd：出手后 cd 重置为那把武器的间隔（±10%），auxCd 不动', () => {
    const { w, a, e } = scene('legion');
    const d = UNIT_BY_KEY.legion;
    w.auxCd[a] = 3;
    strike(w, a, d, d.main, e, 0);
    expect(w.auxCd[a]).toBe(3);
    expect(w.cd[a]).toBeGreaterThanOrEqual(d.main.lvCd[0] * 0.9);
    expect(w.cd[a]).toBeLessThanOrEqual(d.main.lvCd[0] * 1.1);
    // 火把：间隔是 torchCd，同样占用 w.cd
    const b = w.addBuilding(BUILDINGS.outpost, 70, 58, 2, -1);
    w.cd[a] = 0;
    strike(w, a, d, d.torch!, -b.id - 2, 0);
    expect(w.auxCd[a]).toBe(3);
    expect(w.cd[a]).toBeGreaterThanOrEqual(RULES.siege.torchCd * 0.9);
    expect(w.cd[a]).toBeLessThanOrEqual(RULES.siege.torchCd * 1.1);
  });

  it('副武器的伤害不随等级、不随高级形态变：各等级发出的投射物伤害都是特性写的数，类型是穿刺', () => {
    for (const k of ['legion', 'legion_e']) {
      const d = UNIT_BY_KEY[k];
      for (let lv = 0; lv < LEVELS.thresholds.length; lv++) {
        const { w, a, e } = scene(d.idx);
        w.level[a] = lv;
        strike(w, a, d, d.aux!, e, 0);
        expect(w.pDmg[0], `${k} ${lv}`).toBe(26);
        expect(w.pAtk[0], `${k} ${lv}`).toBe(A_PIERCE);
      }
    }
    // 主武器随等级涨
    const d = UNIT_BY_KEY.nu;
    const lows: number[] = [];
    for (const lv of [0, 2]) {
      const { w, a, e } = scene('nu');
      w.level[a] = lv;
      strike(w, a, d, d.main, e, 0);
      lows.push(w.pDmg[0]);
    }
    expect(lows[0]).toBeCloseTo(d.main.lvDmg[0], 4);
    expect(lows[1]).toBeCloseTo(d.main.lvDmg[2], 4);
    expect(lows[1]).toBeGreaterThan(lows[0]);
  });

  it('远程主武器在高地 ×1.15，副武器、火把不吃', () => {
    const v = variant(BASE.ranged, {}, ['pilum']);
    const { w, a, e } = scene(v.idx);
    strike(w, a, v, v.main, e, 0);
    strike(w, a, v, v.main, e, T_HILL);
    strike(w, a, v, v.aux!, e, T_HILL);
    expect(w.pDmg[1] / w.pDmg[0]).toBeCloseTo(1.15, 5);
    expect(w.pDmg[2]).toBe(v.aux!.lvDmg[0]);
    const b = w.addBuilding(BUILDINGS.outpost, 70, 58, 2, -1);
    strike(w, a, v, v.torch!, -b.id - 2, T_HILL);
    expect(w.pDmg[3]).toBeCloseTo(RULES.siege.torchDmg, 4);
  });

  it('武士道的加伤只有主武器吃：生命一半时主武器伤害 ×1.25，副武器与火把照旧', () => {
    const v = variant(BASE.ranged, {}, ['bushido', 'pilum']);
    const full = scene(v.idx, 1), half = scene(v.idx, 0.5);
    strike(full.w, full.a, v, v.main, full.e, 0);
    strike(half.w, half.a, v, v.main, half.e, 0);
    expect(half.w.pDmg[0] / full.w.pDmg[0]).toBeCloseTo(1.25, 5);
    strike(half.w, half.a, v, v.aux!, half.e, 0);
    expect(half.w.pDmg[1]).toBe(v.aux!.lvDmg[0]);
    const b = half.w.addBuilding(BUILDINGS.outpost, 70, 58, 2, -1);
    strike(half.w, half.a, v, v.torch!, -b.id - 2, 0);
    expect(half.w.pDmg[2]).toBeCloseTo(RULES.siege.torchDmg, 4);
  });

  it('火把：火伤害的火把投射物，伤害 = torchDmg × (1 + LEVELS.dmg × 等级)，高级形态不乘攻击倍率', () => {
    for (const k of ['dao', 'dao_e']) {
      for (const lv of [0, 3]) {
        const d = UNIT_BY_KEY[k];
        const { w, a } = scene(d.idx);
        const b = w.addBuilding(BUILDINGS.outpost, 70, 58, 2, -1);
        w.level[a] = lv;
        strike(w, a, d, d.torch!, -b.id - 2, 0);
        expect(w.pn, k).toBe(1);
        expect(w.pType[0], k).toBe(P_TORCH);
        expect(w.pAtk[0], k).toBe(A_FIRE);
        expect(w.pDmg[0], `${k} ${lv}`).toBeCloseTo(RULES.siege.torchDmg * (1 + LEVELS.dmg * lv), 4);
        expect(w.pTgt[0], k).toBe(-b.id - 2);
      }
    }
  });

  it('践踏：战象打单位时以目标为中心杀伤半径 28 内的敌人，半径外的与己方不伤；打建筑仍是单体（周围敌人不受伤）；没有践踏的近战兵种只伤目标', () => {
    /** 把场上所有单位的冷却压住、跑一帧让空间网格登记好位置，之后手动出手 */
    const settle = (w: World): void => {
      for (let u = 0; u < w.n; u++) w.cd[u] = w.auxCd[u] = 1e9;
      w.tick();
    };
    const foe = (w: World, x: number, y: number): number => {
      const u = w.spawnUnit(idx('dao'), 2, x, y);
      w.hp[u] = w.maxHp[u] = 1e5;
      return u;
    };
    const d = UNIT_BY_KEY.elephant;
    const { w, a, e } = scene('elephant');
    w.x[e] = C + 20;
    const near = foe(w, C + 40, C), far = foe(w, C + 80, C), friend = w.spawnUnit(idx('dao'), 1, C + 30, C + 10);
    w.hp[friend] = w.maxHp[friend] = 1e5;
    const b = w.addBuilding(BUILDINGS.outpost, 70, 58, 2, -1);
    const by = foe(w, b.cx, b.cy);
    settle(w);
    for (const u of [e, near, far, by]) w.hp[u] = 1e5;
    strike(w, a, d, d.main, e, 0);
    expect(w.hp[e]).toBeLessThan(1e5);
    expect(w.hp[near]).toBeLessThan(1e5);
    expect(w.hp[far]).toBe(1e5);
    expect(w.hp[friend]).toBe(1e5);
    // 打建筑：只有建筑掉血，贴着建筑中心的敌人不受伤
    const hp0 = b.hp;
    strike(w, a, d, d.main, -b.id - 2, 0);
    expect(b.hp).toBeLessThan(hp0);
    expect(w.hp[by]).toBe(1e5);
    // 对照：刀盾兵没有范围杀伤，只伤目标
    const dao = UNIT_BY_KEY.dao;
    const s2 = scene('dao');
    const n2 = foe(s2.w, s2.w.x[s2.e] + 8, C);
    settle(s2.w);
    s2.w.hp[s2.e] = s2.w.hp[n2] = 1e5;
    strike(s2.w, s2.a, dao, dao.main, s2.e, 0);
    expect(s2.w.hp[s2.e]).toBeLessThan(1e5);
    expect(s2.w.hp[n2]).toBe(1e5);
  });

  it('主武器的伤害类型取武器上的：抛射器械的攻城伤害、穿刺攻击特性后改为穿刺', () => {
    const { w, a, e } = scene('onager');
    const d = UNIT_BY_KEY.onager;
    strike(w, a, d, d.main, e, 0);
    expect(w.pAtk[0]).toBe(A_SIEGE);
    expect(w.pSplash[0]).toBe(d.main.splash);
    const v = variant(BASE.siege, {}, ['pierce']);
    const s2 = scene(v.idx);
    strike(s2.w, s2.a, v, v.main, s2.e, 0);
    expect(s2.w.pAtk[0]).toBe(A_PIERCE);
  });
});

describe('防御建筑按武器表放一轮', () => {
  const C = (120 * TILE) / 2;
  const volley = (extra: Partial<TowerDef>, foes: number) => {
    const w = flatWorld();
    w.env.wind = 0;
    const b = w.addBuilding(BUILDINGS.tower, 60, 60, 1, -1);
    b.tower = {
      range: 400, cd: 1.5, weapons: [
        { atk: A_PIERCE, dmg: 10, proj: P_ARROW, pen: 0, splash: 0, burst: 3, fan: true },
        { atk: A_SIEGE, dmg: 30, proj: P_BALL, pen: 0, splash: 20, burst: 2, fan: false },
      ], ...extra,
    };
    const ids: number[] = [];
    for (let k = 0; k < foes; k++) {
      const e = w.spawnUnit(UNIT_BY_KEY.dao.idx, 2, b.cx + 80 + 70 * k, b.cy);
      w.hp[e] = w.maxHp[e] = 1e5;
      ids.push(e);
    }
    w.tick();
    w.pn = 0;
    b.cd = 0;
    updateTowers(w);
    const arrows: number[] = [], shells: number[] = [];
    for (let p = 0; p < w.pn; p++) (w.pType[p] === P_ARROW ? arrows : shells).push(w.pTgt[p]);
    return { w, b, ids, arrows, shells, C };
  };

  it('箭（fan 武器）一轮 burst 支，由近及远各射一个目标；炮弹（非 fan）全打最近的敌人，爆炸带范围杀伤', () => {
    const { w, ids, arrows, shells } = volley({}, 4);
    expect(arrows).toEqual([ids[0], ids[1], ids[2]]);
    expect(shells).toEqual([ids[0], ids[0]]);
    for (let p = 0; p < w.pn; p++) {
      if (w.pType[p] === P_BALL) {
        expect(w.pSplash[p]).toBe(20);
        expect(w.pAtk[p]).toBe(A_SIEGE);
        expect(w.pDmg[p]).toBe(30);
      } else {
        expect(w.pSplash[p]).toBe(0);
        expect(w.pAtk[p]).toBe(A_PIERCE);
        expect(w.pDmg[p]).toBe(10);
      }
    }
  });

  it('目标不够时余下的箭都射最近那个；整座建筑共用一个冷却', () => {
    const { b, ids, arrows, shells } = volley({}, 2);
    expect(arrows).toEqual([ids[0], ids[1], ids[0]]);
    expect(shells).toEqual([ids[0], ids[0]]);
    expect(b.cd).toBe(1.5);
    const one = volley({}, 1);
    expect(one.arrows).toEqual([one.ids[0], one.ids[0], one.ids[0]]);
  });

  it('没有炮弹武器的建筑只放箭；射程里没有敌人不放，冷却短暂重置', () => {
    const w = volley({ weapons: [{ atk: A_PIERCE, dmg: 10, proj: P_ARROW, pen: 0, splash: 0, burst: 1, fan: true }] }, 2);
    expect(w.arrows.length).toBe(1);
    expect(w.shells.length).toBe(0);
    const none = volley({}, 0);
    expect(none.w.pn).toBe(0);
    expect(none.b.cd).toBeGreaterThan(0);
  });
});

describe('被防御建筑射中：上去拆它（damageUnit 的还击）', () => {
  const mid = (t: number): number => (t + 0.5) * TILE;
  /** 己方待命的 dao 站在 (60, 60) 格；敌方行营 A 在 (64, 60)、B 在 (64, 66)，都在岗位的 leash 之内 */
  const scene = () => {
    const w = flatWorld();
    w.addBuilding(BUILDINGS.house, 20, 20, 1, -1);
    const a = w.addBuilding(BUILDINGS.outpost, 64, 60, 2, -1);
    const b = w.addBuilding(BUILDINGS.outpost, 64, 66, 2, -1);
    const j = w.spawnUnit(UNIT_BY_KEY.dao.idx, 1, mid(60), mid(60));
    w.hp[j] = w.maxHp[j] = 1e9;
    const hit = (bld: { id: number }): void => damageUnit(w, j, 1, A_PIERCE, 0, null, 2, -bld.id - 2);
    return { w, j, a, b, hit };
  };

  it('对照：没有跳过记录时，待命的人被射中就把那座建筑设为目标', () => {
    const { w, j, a, hit } = scene();
    expect(w.target[j]).toBe(NONE);
    hit(a);
    expect(w.target[j]).toBe(-a.id - 2);
  });

  it('攻击移动的人被射中同样去拆', () => {
    const { w, j, a, hit } = scene();
    w.orderMove([j], mid(100), mid(60), true);
    hit(a);
    expect(w.target[j]).toBe(-a.id - 2);
  });

  it('命令是移动、坚守，或手里已有目标：不改目标', () => {
    const m = scene();
    m.w.orderMove([m.j], mid(100), mid(60), false);
    m.hit(m.a);
    expect(m.w.target[m.j]).toBe(NONE);
    const h = scene();
    h.w.orderStop([h.j], true);
    h.hit(h.a);
    expect(h.w.target[h.j]).toBe(NONE);
    const t = scene();
    t.w.target[t.j] = -t.b.id - 2;
    t.hit(t.a);
    expect(t.w.target[t.j]).toBe(-t.b.id - 2);
  });

  it('待命时建筑离岗位超过 leash：不去', () => {
    const w = flatWorld();
    const far = w.addBuilding(BUILDINGS.outpost, 60 + Math.ceil(RULES.combat.leash / TILE) + 4, 60, 2, -1);
    const j = w.spawnUnit(UNIT_BY_KEY.dao.idx, 1, mid(60), mid(60));
    w.hp[j] = w.maxHp[j] = 1e9;
    damageUnit(w, j, 1, A_PIERCE, 0, null, 2, -far.id - 2);
    expect(w.target[j]).toBe(NONE);
  });

  describe('刚因为挤不到跟前而放下的建筑', () => {
    it('跳过期间被放下的那座射中：不还击，目标保持 NONE', () => {
      const { w, j, a, hit } = scene();
      w.bldSkip[j] = a.id;
      w.bldSkipT[j] = 5;
      hit(a);
      expect(w.target[j]).toBe(NONE);
    });

    it('攻击移动的人也一样不还击', () => {
      const { w, j, a, hit } = scene();
      w.orderMove([j], mid(100), mid(60), true);
      w.bldSkip[j] = a.id;
      w.bldSkipT[j] = 5;
      hit(a);
      expect(w.target[j]).toBe(NONE);
    });

    it('跳过期间被另一座建筑射中：照常还击', () => {
      const { w, j, a, b, hit } = scene();
      w.bldSkip[j] = a.id;
      w.bldSkipT[j] = 5;
      hit(b);
      expect(w.target[j]).toBe(-b.id - 2);
    });

    it('记的是 BLD_SKIP_ALL 且倒计时大于 0：被任何建筑射中都不还击', () => {
      const { w, j, a, b, hit } = scene();
      w.bldSkip[j] = BLD_SKIP_ALL;
      w.bldSkipT[j] = 5;
      hit(a);
      expect(w.target[j]).toBe(NONE);
      hit(b);
      expect(w.target[j]).toBe(NONE);
    });

    it('倒计时到 0 及以下：照常还击，哪怕记着这座的编号或 BLD_SKIP_ALL', () => {
      const keepsId = scene();
      keepsId.w.bldSkip[keepsId.j] = keepsId.a.id;
      keepsId.w.bldSkipT[keepsId.j] = 0;
      keepsId.hit(keepsId.a);
      expect(keepsId.w.target[keepsId.j]).toBe(-keepsId.a.id - 2);
      const keepsAll = scene();
      keepsAll.w.bldSkip[keepsAll.j] = BLD_SKIP_ALL;
      keepsAll.w.bldSkipT[keepsAll.j] = -0.5;
      keepsAll.hit(keepsAll.a);
      expect(keepsAll.w.target[keepsAll.j]).toBe(-keepsAll.a.id - 2);
    });

    it('别的单位不受这个单位的记录影响', () => {
      const { w, a } = scene();
      const k = w.spawnUnit(UNIT_BY_KEY.dao.idx, 1, mid(60), mid(61));
      w.hp[k] = w.maxHp[k] = 1e9;
      damageUnit(w, k, 1, A_PIERCE, 0, null, 2, -a.id - 2);
      expect(w.target[k]).toBe(-a.id - 2);
    });

    it('被敌兵打中的还击与跳过记录无关：照常以那个敌兵为目标', () => {
      const { w, j, a } = scene();
      const foe = w.spawnUnit(UNIT_BY_KEY.dao.idx, 2, mid(61), mid(60));
      w.hp[foe] = w.maxHp[foe] = 1e9;
      w.bldSkip[j] = a.id;
      w.bldSkipT[j] = 5;
      damageUnit(w, j, 1, A_MELEE, 0, null, 2, foe);
      expect(w.target[j]).toBe(foe);
      expect(w.targetUid[j]).toBe(w.uid[foe]);
      const w2 = scene();
      const foe2 = w2.w.spawnUnit(UNIT_BY_KEY.dao.idx, 2, mid(61), mid(60));
      w2.w.hp[foe2] = w2.w.maxHp[foe2] = 1e9;
      w2.w.bldSkip[w2.j] = BLD_SKIP_ALL;
      w2.w.bldSkipT[w2.j] = 5;
      damageUnit(w2.w, w2.j, 1, A_MELEE, 0, null, 2, foe2);
      expect(w2.w.target[w2.j]).toBe(foe2);
    });
  });
});
