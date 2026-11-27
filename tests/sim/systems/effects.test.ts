import { describe, expect, it } from 'vitest';
import {
  AURA_KINDS, AU_RANGED_TAKEN, BUILDINGS, RULES, TERRAIN_NAMES, TERRAIN_SPEED, TILE, UNITS, UNIT_BY_KEY,
  T_FARM, T_FOREST, T_GRASS, T_HILL, T_ROAD, T_SHALLOW, isContentUnit,
} from '../../../src/sim/defs';
import { NONE, S_WALL } from '../../../src/sim/state';
import { terrainSpeedMul, unitEffects, weatherSpeedMul } from '../../../src/sim/systems/effects';
import type { UnitEffect } from '../../../src/sim/systems/effects';
import type { World } from '../../../src/sim/world';
import { flatWorld } from '../../helpers';

const C = (120 * TILE) / 2;
const MELEE = UNIT_BY_KEY.dao.idx;
const RANGED = UNIT_BY_KEY.yumi.idx; // 人形，带火把
const ENGINE = UNIT_BY_KEY.onager.idx; // 器械，没有火把，用主武器打建筑
/** 森林里被减速的体型（forestMul 小于 1）与不减的体型各取一个内容兵种 */
const SLOW_FOREST = UNITS.find(d => isContentUnit(d) && d.tier === 0 && d.forestMul < 1)!;
const FREE_FOREST = UNITS.find(d => isContentUnit(d) && d.tier === 0 && d.forestMul === 1)!;

/** 整块地图铺同一种地形的世界 */
const terrainWorld = (t: number): World => flatWorld(120, 7, (terrain) => terrain.fill(t));
const put = (w: World, type: number, team = 1, x = C, y = C): number => w.spawnUnit(type, team, x, y);
const pick = (fx: UnitEffect[], source: string, stat: string): UnitEffect | undefined => fx.find(e => e.source === source && e.stat === stat);
const windOn = (w: World, force: number, dir: number): void => {
  w.env.wind = force;
  w.env.windDir = dir;
};
/** 给单位设速度：大小 spd，方向 ang（弧度，0 朝东） */
const move = (w: World, i: number, spd: number, ang: number): void => {
  w.vx[i] = Math.cos(ang) * spd;
  w.vy[i] = Math.sin(ang) * spd;
};

describe('unitEffects：没有任何效果的单位', () => {
  it('草地上、无天气无风无光环：空数组', () => {
    const w = flatWorld();
    expect(unitEffects(w, put(w, MELEE))).toEqual([]);
    expect(unitEffects(w, put(w, RANGED))).toEqual([]);
  });
});

describe('unitEffects：地形', () => {
  it('道路 / 桥是增益，浅水 / 农田是减益，来源写地形名、数值是 TERRAIN_SPEED', () => {
    for (const [t, good] of [[T_ROAD, true], [T_SHALLOW, false], [T_FARM, false]] as const) {
      const w = terrainWorld(t);
      const fx = unitEffects(w, put(w, MELEE));
      expect(fx, TERRAIN_NAMES[t]).toHaveLength(1);
      expect(fx[0].source).toBe(TERRAIN_NAMES[t]);
      expect(fx[0].stat).toBe('速度');
      expect(fx[0].mul).toBeCloseTo(TERRAIN_SPEED[t], 6);
      expect(fx[0].good, TERRAIN_NAMES[t]).toBe(good);
    }
  });

  it('林地：速度 ×0.7 乘体型的 forestMul（减益）、所受远程伤害 ×forestCover（增益）；近战远程都一样，不列射程', () => {
    const w = terrainWorld(T_FOREST);
    for (const d of [SLOW_FOREST, FREE_FOREST]) {
      const fx = unitEffects(w, put(w, d.idx));
      expect(fx, d.key).toHaveLength(2);
      const spd = pick(fx, '林地', '速度')!;
      expect(spd.mul, d.key).toBeCloseTo(TERRAIN_SPEED[T_FOREST] * d.forestMul, 6);
      expect(spd.good).toBe(false);
      const cover = pick(fx, '林地', '所受远程伤害')!;
      expect(cover.mul).toBe(RULES.combat.forestCover);
      expect(cover.good).toBe(true);
    }
    expect(SLOW_FOREST.forestMul).toBeLessThan(1);
    const fxRanged = unitEffects(w, put(w, RANGED));
    expect(fxRanged.some(e => e.stat === '射程')).toBe(false);
  });

  it('丘陵：近战只有速度减益；远程另有射程 ×hillRange、攻击 ×hillDmg 两项增益', () => {
    const w = terrainWorld(T_HILL);
    const melee = unitEffects(w, put(w, MELEE));
    expect(melee).toHaveLength(1);
    expect(melee[0]).toMatchObject({ source: '丘陵', stat: '速度', good: false });
    expect(melee[0].mul).toBeCloseTo(TERRAIN_SPEED[T_HILL], 6);

    const fx = unitEffects(w, put(w, RANGED));
    expect(fx).toHaveLength(3);
    expect(pick(fx, '丘陵', '速度')!.good).toBe(false);
    expect(pick(fx, '丘陵', '射程')).toMatchObject({ mul: RULES.combat.hillRange, good: true });
    expect(pick(fx, '丘陵', '攻击')).toMatchObject({ mul: RULES.combat.hillDmg, good: true });
  });
});

describe('unitEffects：城墙', () => {
  it('远程单位在墙上：射程 ×wallRange、所受远程伤害 ×wallCover，都是增益', () => {
    const w = flatWorld();
    const u = put(w, RANGED);
    w.state[u] |= S_WALL;
    const fx = unitEffects(w, u);
    expect(fx).toHaveLength(2);
    expect(pick(fx, '城墙', '射程')).toMatchObject({ mul: RULES.siege.wallRange, good: true });
    expect(pick(fx, '城墙', '所受远程伤害')).toMatchObject({ mul: RULES.siege.wallCover, good: true });
    expect(RULES.siege.wallCover).toBeLessThan(1);
  });

  it('近战单位在墙上：只有所受远程伤害，不列射程', () => {
    const w = flatWorld();
    const u = put(w, MELEE);
    w.state[u] |= S_WALL;
    const fx = unitEffects(w, u);
    expect(fx).toHaveLength(1);
    expect(fx[0]).toMatchObject({ source: '城墙', stat: '所受远程伤害', mul: RULES.siege.wallCover, good: true });
  });

  it('在墙上时不列脚下地形的速度与丘陵射程', () => {
    for (const t of [T_FOREST, T_HILL, T_ROAD]) {
      const w = terrainWorld(t);
      const u = put(w, RANGED);
      w.state[u] |= S_WALL;
      const fx = unitEffects(w, u);
      expect(pick(fx, TERRAIN_NAMES[t], '速度'), TERRAIN_NAMES[t]).toBeUndefined();
      expect(pick(fx, TERRAIN_NAMES[t], '射程'), TERRAIN_NAMES[t]).toBeUndefined();
      expect(pick(fx, '城墙', '射程'), TERRAIN_NAMES[t]).toMatchObject({ mul: RULES.siege.wallRange });
    }
  });

  it('墙下是林地：林地所受远程伤害 ×forestCover 照列（与城墙掩护并列，各一项），近战远程都一样', () => {
    const w = terrainWorld(T_FOREST);
    for (const type of [MELEE, RANGED]) {
      const u = put(w, type);
      w.state[u] |= S_WALL;
      const fx = unitEffects(w, u);
      expect(pick(fx, '林地', '所受远程伤害')).toMatchObject({ mul: RULES.combat.forestCover, good: true });
      expect(pick(fx, '城墙', '所受远程伤害')).toMatchObject({ mul: RULES.siege.wallCover, good: true });
      expect(fx.filter(e => e.stat === '所受远程伤害')).toHaveLength(2);
    }
  });

  it('墙下是丘陵：远程单位仍列「丘陵 攻击 ×hillDmg」；近战不列', () => {
    const w = terrainWorld(T_HILL);
    const ranged = put(w, RANGED);
    const melee = put(w, MELEE);
    w.state[ranged] |= S_WALL;
    w.state[melee] |= S_WALL;
    expect(pick(unitEffects(w, ranged), '丘陵', '攻击')).toMatchObject({ mul: RULES.combat.hillDmg, good: true });
    expect(pick(unitEffects(w, melee), '丘陵', '攻击')).toBeUndefined();
  });
});

describe('unitEffects：天气', () => {
  it('下雨：雨天 速度 ×rainSpeed（减益），没有护甲项', () => {
    const w = flatWorld();
    w.env.raining = true;
    const fx = unitEffects(w, put(w, MELEE));
    expect(fx).toHaveLength(1);
    expect(fx[0]).toMatchObject({ source: '雨天', stat: '速度', mul: RULES.env.rainSpeed, good: false });
  });

  it('下雪、没在自家据点：雪天 速度 ×snowSpeed 与 护甲 ×snowArmor，都是减益', () => {
    const w = flatWorld();
    w.env.snowing = true;
    const fx = unitEffects(w, put(w, MELEE));
    expect(fx).toHaveLength(2);
    expect(pick(fx, '雪天', '速度')).toMatchObject({ mul: RULES.env.snowSpeed, good: false });
    expect(pick(fx, '雪天', '护甲')).toMatchObject({ mul: RULES.env.snowArmor, good: false });
  });

  it('下雪、在自家据点庇护（sheltered）：只有速度，没有护甲', () => {
    const w = flatWorld();
    w.env.snowing = true;
    const u = put(w, MELEE);
    w.sheltered[u] = 1;
    const fx = unitEffects(w, u);
    expect(fx).toHaveLength(1);
    expect(fx[0]).toMatchObject({ source: '雪天', stat: '速度', mul: RULES.env.snowSpeed });
  });

  it('不下雨不下雪：没有天气项', () => {
    const w = flatWorld();
    expect(unitEffects(w, put(w, MELEE))).toEqual([]);
  });
});

describe('unitEffects：风对行军速度', () => {
  const setup = (force: number, dir: number, spd: number, ang: number): { w: World; fx: UnitEffect[] } => {
    const w = flatWorld();
    const u = put(w, MELEE);
    windOn(w, force, dir);
    move(w, u, spd, ang);
    return { w, fx: unitEffects(w, u) };
  };
  const speedOf = (fx: UnitEffect[]): UnitEffect[] => fx.filter(e => e.stat === '速度');

  it('顺风：风向与行进同向，倍率 1 + wind × windSpeed，来源「顺风」增益', () => {
    const { fx } = setup(1, 0, 100, 0);
    expect(speedOf(fx)).toHaveLength(1);
    expect(fx[0]).toMatchObject({ source: '顺风', stat: '速度', good: true });
    expect(fx[0].mul).toBeCloseTo(1 + RULES.env.windSpeed, 6);
  });

  it('逆风：行进与风向相反，倍率 1 − wind × windSpeed，来源「逆风」减益', () => {
    const { fx } = setup(1, 0, 100, Math.PI);
    expect(fx[0]).toMatchObject({ source: '逆风', stat: '速度', good: false });
    expect(fx[0].mul).toBeCloseTo(1 - RULES.env.windSpeed, 6);
  });

  it('风力越小倍率越近 1；斜着走按夹角余弦折算', () => {
    const half = setup(0.5, 0, 100, 0).fx[0];
    expect(half.mul).toBeCloseTo(1 + RULES.env.windSpeed * 0.5, 6);
    const oblique = setup(1, 0, 100, Math.PI / 3).fx[0];
    expect(oblique.source).toBe('顺风');
    expect(oblique.mul).toBeCloseTo(1 + RULES.env.windSpeed * 0.5, 6);
    const obliqueBack = setup(1, 0, 100, (Math.PI * 2) / 3).fx[0];
    expect(obliqueBack.source).toBe('逆风');
    expect(obliqueBack.mul).toBeCloseTo(1 - RULES.env.windSpeed * 0.5, 6);
  });

  it('风向不是 0 时同样按夹角算（风朝南、人朝南是顺风）', () => {
    const { fx } = setup(1, Math.PI / 2, 100, Math.PI / 2);
    expect(fx[0]).toMatchObject({ source: '顺风', good: true });
    expect(fx[0].mul).toBeCloseTo(1 + RULES.env.windSpeed, 6);
  });

  it('正侧风（与风向垂直）不列', () => {
    expect(speedOf(setup(1, 0, 100, Math.PI / 2).fx)).toEqual([]);
    expect(speedOf(setup(1, 0, 100, -Math.PI / 2).fx)).toEqual([]);
  });

  it('站着不动（速度不超过 2 像素/秒）不列速度，起步到 3 就列', () => {
    expect(speedOf(setup(1, 0, 0, 0).fx)).toEqual([]);
    expect(speedOf(setup(1, 0, 1.5, 0).fx)).toEqual([]);
    expect(speedOf(setup(1, 0, 3, 0).fx)).toHaveLength(1);
  });

  it('没有风（wind 为 0）不列；风太小、倍率离 1 不到 1% 的也不列', () => {
    expect(setup(0, 0, 100, 0).fx).toEqual([]);
    const tiny = (0.01 * 0.5) / RULES.env.windSpeed;
    expect(speedOf(setup(tiny, 0, 100, 0).fx)).toEqual([]);
    const enough = (0.01 * 2) / RULES.env.windSpeed;
    expect(speedOf(setup(enough, 0, 100, 0).fx)).toHaveLength(1);
  });
});

describe('unitEffects：风对远程射程', () => {
  /** 弓兵在 (C, C)，有风，朝 (C + dx, C + dy) 的敌兵射击 */
  const aimAt = (force: number, dir: number, dx: number, dy: number, type = RANGED): { w: World; u: number; fx: UnitEffect[] } => {
    const w = flatWorld();
    const u = put(w, type);
    const e = put(w, MELEE, 2, C + dx, C + dy);
    w.target[u] = e;
    windOn(w, force, dir);
    return { w, u, fx: unitEffects(w, u) };
  };

  it('射向顺风方向：射程 ×(1 + wind × windRange)，来源「顺风」增益；站着不动没有速度项', () => {
    const { fx } = aimAt(1, 0, 200, 0);
    expect(fx).toHaveLength(1);
    expect(fx[0]).toMatchObject({ source: '顺风', stat: '射程', good: true });
    expect(fx[0].mul).toBeCloseTo(1 + RULES.env.windRange, 6);
  });

  it('射向逆风方向：射程 ×(1 − wind × windRange)，来源「逆风」减益', () => {
    const { fx } = aimAt(1, 0, -200, 0);
    expect(fx[0]).toMatchObject({ source: '逆风', stat: '射程', good: false });
    expect(fx[0].mul).toBeCloseTo(1 - RULES.env.windRange, 6);
  });

  it('射向斜方向按夹角算；射向正侧方不列', () => {
    const { fx } = aimAt(0.6, 0, 100, 100);
    expect(fx[0].mul).toBeCloseTo(1 + RULES.env.windRange * 0.6 * Math.SQRT1_2, 6);
    expect(aimAt(1, 0, 0, 200).fx).toEqual([]);
  });

  it('近战单位有目标也不列射程', () => {
    expect(aimAt(1, 0, 200, 0, MELEE).fx).toEqual([]);
  });

  it('没有目标（NONE）不列射程；没有风也不列', () => {
    const w = flatWorld();
    const u = put(w, RANGED);
    windOn(w, 1, 0);
    expect(w.target[u]).toBe(NONE);
    expect(unitEffects(w, u)).toEqual([]);
    expect(aimAt(0, 0, 200, 0).fx).toEqual([]);
  });

  describe('目标是建筑（编码 −id−2）', () => {
    // 房子占 2×2 格：左上角在 (62, 60) 格，外框 x 62T..64T、y 60T..62T
    const house = (w: World) => w.addBuilding(BUILDINGS.house, 62, 60, 2, -1);

    it('人形远程（带火把）打建筑用火把，不乘风：不列风射程', () => {
      expect(UNITS[RANGED].torch).toBeTruthy();
      for (const dir of [0, Math.PI]) {
        const w = flatWorld();
        const u = put(w, RANGED, 1, C, C + 1);
        w.target[u] = -house(w).id - 2;
        windOn(w, 1, dir);
        expect(unitEffects(w, u), String(dir)).toEqual([]);
      }
    });

    it('不带火把的器械：朝建筑外框上离自己最近的点算，顺风 / 逆风按方向分', () => {
      expect(UNITS[ENGINE].torch).toBeFalsy();
      const w = flatWorld();
      const u = put(w, ENGINE, 1, C, C + 1); // 在房子东西向的正西，最近点在正东
      w.target[u] = -house(w).id - 2;
      windOn(w, 1, 0);
      const fx = unitEffects(w, u);
      expect(fx).toHaveLength(1);
      expect(fx[0]).toMatchObject({ source: '顺风', stat: '射程', good: true });
      expect(fx[0].mul).toBeCloseTo(1 + RULES.env.windRange, 6);

      windOn(w, 1, Math.PI);
      const back = unitEffects(w, u);
      expect(back[0]).toMatchObject({ source: '逆风', stat: '射程', good: false });
      expect(back[0].mul).toBeCloseTo(1 - RULES.env.windRange, 6);
    });

    it('最近点不是中心：器械在房子正西，风朝南吹时对它是侧风，不列（按中心算会偏出一个角度而列出）', () => {
      const w = flatWorld();
      const u = put(w, ENGINE, 1, C, C + 1);
      w.target[u] = -house(w).id - 2;
      windOn(w, 1, Math.PI / 2);
      expect(unitEffects(w, u)).toEqual([]);
    });

    it('器械在房子的斜角方向：朝外框最近的角点算', () => {
      const w = flatWorld();
      const u = put(w, ENGINE, 1, C, C - 3 * TILE); // 西北：最近点是角点 (62T, 60T)，相对 (+2T, +3T)
      w.target[u] = -house(w).id - 2;
      windOn(w, 1, 0);
      const fx = unitEffects(w, u);
      expect(fx).toHaveLength(1);
      expect(fx[0].source).toBe('顺风');
      expect(fx[0].mul).toBeCloseTo(1 + RULES.env.windRange * (2 / Math.hypot(2, 3)), 6);
    });
  });

  it('既在行进又有目标：速度与射程各一项，各自按自己的方向分顺风 / 逆风', () => {
    const w = flatWorld();
    const u = put(w, RANGED);
    const e = put(w, MELEE, 2, C - 200, C);
    w.target[u] = e;
    windOn(w, 1, 0);
    move(w, u, 100, 0); // 往东走顺风，朝西射逆风
    const fx = unitEffects(w, u);
    expect(pick(fx, '顺风', '速度')).toBeTruthy();
    expect(pick(fx, '逆风', '射程')).toBeTruthy();
    expect(fx).toHaveLength(2);
  });
});

describe('unitEffects：光环', () => {
  const k = AU_RANGED_TAKEN;
  const name = AURA_KINDS[k].name;
  const withAura = (v: number): UnitEffect[] => {
    const w = flatWorld();
    const u = put(w, MELEE);
    w.aura[k][u] = v;
    return unitEffects(w, u);
  };

  it('所受远程伤害 ×0.8（该种类越小越强）：来源「光环」，增益', () => {
    const fx = withAura(0.8);
    expect(fx).toHaveLength(1);
    expect(fx[0]).toMatchObject({ source: '光环', stat: name, good: true });
    expect(fx[0].mul).toBeCloseTo(0.8 / AURA_KINDS[k].neutral, 6);
  });

  it('该种类 lowerStronger：值比无加成大算减益', () => {
    expect(AURA_KINDS[k].lowerStronger).toBe(true);
    const fx = withAura(1.25);
    expect(fx[0]).toMatchObject({ source: '光环', good: false });
  });

  it('等于无加成值、或与之相差不到 1%：不列', () => {
    expect(withAura(AURA_KINDS[k].neutral)).toEqual([]);
    expect(withAura(AURA_KINDS[k].neutral * 0.995)).toEqual([]);
  });
});

describe('unitEffects：多项叠加', () => {
  it('丘陵上的弓兵遇雨、顺风行军、带光环：各来源各一项，互不吞掉', () => {
    const w = terrainWorld(T_HILL);
    const u = put(w, RANGED);
    w.env.raining = true;
    windOn(w, 1, 0);
    move(w, u, 100, 0);
    w.aura[AU_RANGED_TAKEN][u] = 0.8;
    const fx = unitEffects(w, u);
    for (const [src, stat] of [['丘陵', '速度'], ['丘陵', '射程'], ['丘陵', '攻击'], ['雨天', '速度'], ['顺风', '速度'], ['光环', AURA_KINDS[AU_RANGED_TAKEN].name]]) {
      expect(pick(fx, src, stat), `${src}${stat}`).toBeTruthy();
    }
    expect(fx).toHaveLength(6);
  });

  it('列出的每一项倍率都离 1 至少 1%', () => {
    const w = terrainWorld(T_FOREST);
    const u = put(w, RANGED);
    w.env.snowing = true;
    windOn(w, 0.3, 0.4);
    move(w, u, 50, 1);
    for (const e of unitEffects(w, u)) expect(Math.abs(e.mul - 1), `${e.source}${e.stat}`).toBeGreaterThanOrEqual(0.01);
  });
});

describe('terrainSpeedMul：地形对速度的倍率', () => {
  it('等于 TERRAIN_SPEED[地形]，与兵种无关（林地以外）', () => {
    for (const t of [T_SHALLOW, T_GRASS, T_HILL, T_ROAD, T_FARM]) {
      expect(terrainSpeedMul(t, SLOW_FOREST), String(t)).toBe(TERRAIN_SPEED[t]);
      expect(terrainSpeedMul(t, FREE_FOREST), String(t)).toBe(TERRAIN_SPEED[t]);
    }
    expect(terrainSpeedMul(T_GRASS, UNITS[MELEE])).toBe(1);
  });

  it('林地再乘兵种的 forestMul', () => {
    expect(terrainSpeedMul(T_FOREST, FREE_FOREST)).toBeCloseTo(TERRAIN_SPEED[T_FOREST] * FREE_FOREST.forestMul, 9);
    expect(terrainSpeedMul(T_FOREST, SLOW_FOREST)).toBeCloseTo(TERRAIN_SPEED[T_FOREST] * SLOW_FOREST.forestMul, 9);
    expect(terrainSpeedMul(T_FOREST, SLOW_FOREST)).toBeLessThan(terrainSpeedMul(T_FOREST, FREE_FOREST));
  });
});

describe('weatherSpeedMul：雨雪对速度的倍率', () => {
  const env = (raining: boolean, snowing: boolean): World['env'] => ({ ...flatWorld().env, raining, snowing });

  it('雨是 rainSpeed、雪是 snowSpeed、都没有是 1', () => {
    expect(weatherSpeedMul(env(true, false))).toBe(RULES.env.rainSpeed);
    expect(weatherSpeedMul(env(false, true))).toBe(RULES.env.snowSpeed);
    expect(weatherSpeedMul(env(false, false))).toBe(1);
  });
});
