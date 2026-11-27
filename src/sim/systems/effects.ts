/**
 * 单位此刻身上的增减益：城墙、地形、天气、风、光环带来的倍率，供界面的详情面板列出。
 * 只读世界状态，不改任何东西。地形与天气对移动速度的系数由这里的函数给出，units.ts、march.ts 与面板共用；
 * 风的倍率用 targeting.ts 的 windSpeedMul / windRangeMul，射程、伤害的倍率读与 units.ts、combat.ts 同一套 RULES。
 */
import { AURA_KINDS, RULES, TERRAIN_NAMES, TERRAIN_SPEED, T_FOREST, T_GRASS, T_HILL, UnitDef } from '../content';
import { S_WALL } from '../state';
import type { World } from '../world';
import { windRangeMul, windSpeedMul } from './targeting';

/** 地形对兵种移动速度的倍率（林地另乘体型的林地系数） */
export function terrainSpeedMul(tt: number, d: UnitDef): number {
  return tt === T_FOREST ? TERRAIN_SPEED[tt] * d.forestMul : TERRAIN_SPEED[tt];
}

/** 雨雪对移动速度的倍率 */
export function weatherSpeedMul(env: World['env']): number {
  return env.raining ? RULES.env.rainSpeed : env.snowing ? RULES.env.snowSpeed : 1;
}

export interface UnitEffect {
  /** 来源，如「城墙」「顺风」「林地」 */
  source: string;
  /** 影响的数值，如「射程」「所受远程伤害」 */
  stat: string;
  /** 相对无此效果时的倍率 */
  mul: number;
  /** 对这个单位有利（增益）还是不利（减益） */
  good: boolean;
}

/** 倍率与 1 相差不到这么多的不列（侧风、风刚起时的零头） */
const EPS = 0.01;
/** 速度低于这个（像素 / 秒）算站着，不按行进方向算顺风逆风 */
const MOVING = 2;

/** 单位 i 此刻生效的增减益（不含等级加成、兵种特性这些常驻的数值） */
export function unitEffects(w: World, i: number): UnitEffect[] {
  const out: UnitEffect[] = [];
  const add = (source: string, stat: string, mul: number, lowerBetter = false): void => {
    if (Math.abs(mul - 1) >= EPS) out.push({ source, stat, mul, good: lowerBetter ? mul < 1 : mul > 1 });
  };
  const d = w.defs[w.type[i]];
  const C = RULES.combat, E = RULES.env, env = w.env;
  const tt = w.map.terrain[w.cellAt(w.x[i], w.y[i])];
  const onWall = (w.state[i] & S_WALL) !== 0;

  if (onWall) {
    if (!d.melee) add('城墙', '射程', RULES.siege.wallRange);
    add('城墙', '所受远程伤害', RULES.siege.wallCover, true);
  } else {
    const name = TERRAIN_NAMES[tt];
    if (tt !== T_GRASS) add(name, '速度', terrainSpeedMul(tt, d));
    if (tt === T_HILL && !d.melee) add(name, '射程', C.hillRange);
  }
  // 林地掩护与高地加攻按脚下格子算，在不在墙上都生效（与 combat.ts 一致）
  if (tt === T_FOREST) add(TERRAIN_NAMES[tt], '所受远程伤害', C.forestCover, true);
  if (tt === T_HILL && !d.melee) add(TERRAIN_NAMES[tt], '攻击', C.hillDmg);

  add(env.raining ? '雨天' : '雪天', '速度', weatherSpeedMul(env));
  if (env.snowing && !w.sheltered[i]) add('雪天', '护甲', E.snowArmor);

  if (env.wind > 0) {
    const vx = w.vx[i], vy = w.vy[i];
    if (Math.hypot(vx, vy) > MOVING) {
      const f = windSpeedMul(env, vx, vy);
      add(f > 1 ? '顺风' : '逆风', '速度', f);
    }
    // 射程的风修正只在主武器射击时生效：拿火把打建筑（人形兵种都带火把）不乘风；
    // 用主武器打建筑的按建筑外框上离自己最近的点定方向（与 units.ts 的站位一致）
    const t = w.target[i];
    if (!d.melee && t !== -1 && !(t < -1 && d.torch)) {
      let tx: number, ty: number;
      const ux = w.x[i], uy = w.y[i];
      if (t >= 0) {
        tx = w.x[t];
        ty = w.y[t];
      } else {
        const b = w.buildings[-t - 2];
        tx = ux < b.x0 ? b.x0 : ux > b.x1 ? b.x1 : ux;
        ty = uy < b.y0 ? b.y0 : uy > b.y1 ? b.y1 : uy;
      }
      const m = windRangeMul(w, tx - ux, ty - uy);
      add(m > 1 ? '顺风' : '逆风', '射程', m);
    }
  }

  for (let k = 0; k < AURA_KINDS.length; k++) {
    const K = AURA_KINDS[k];
    add('光环', K.name, w.aura[k][i] / K.neutral, K.lowerStronger);
  }
  return out;
}
