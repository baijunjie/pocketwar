/**
 * 兵种实测表（参考）：每个兵种相对标准混编军的实测点数，连同标准误存成数据文件提交，用来发现估算点数的偏差，不进账、不进门槛。
 * 文件里记着生成时兵种定义与规则的指纹，对不上说明表是按旧的兵种定义量的（report 命令会标出来）。
 */
import { readFileSync } from 'node:fs';
import { UNIT_BY_KEY, UNITS } from '../../src/sim/defs';
import { contentUnits, unitsFingerprint } from './fingerprint';
import { Measurer, Row } from './measure';

export const UNIT_POINTS_FILE = 'tools/measure/data/unit-points.json';
export const PRICE_ROWS_FILE = 'tools/measure/data/price-measurements.json';
export const PRICES_FILE = 'src/sim/content/prices.json';

export interface UnitPoint {
  position: string;
  /** 实测点数与标准误 */
  points: number;
  se: number;
  /** 增量的绝对值不小于两倍标准误 */
  significant: boolean;
  /** 估算点数（查价目表） */
  estimate: number;
  adv: number;
  advSe: number;
  /** 当地斜率：每级全军生命的优势 */
  slope: number;
  size: number;
  n: number;
}
export interface UnitPointsFile {
  fingerprint: string;
  units: Record<string, UnitPoint>;
}

/** 参与实测的兵种：全部初级形态的正式兵种 */
export const measuredUnits = (): string[] => contentUnits().filter(d => d.tier === 0).map(d => d.key);

/** 逐个量出现有兵种的点数 */
export async function measureUnits(m: Measurer, onRow?: (r: Row) => void): Promise<UnitPointsFile> {
  const keys = measuredUnits();
  const rows = await Promise.all(keys.map(async k => {
    const r = await m.unit(UNIT_BY_KEY[k].position, k);
    onRow?.(r);
    return r;
  }));
  const units: Record<string, UnitPoint> = {};
  keys.forEach((k, i) => {
    const r = rows[i];
    units[k] = {
      position: UNIT_BY_KEY[k].position, points: round(r.points!, 3), se: round(r.pointsSe!, 3), significant: r.significant!,
      estimate: round(UNIT_BY_KEY[k].points, 3), adv: round(r.adv, 4), advSe: round(r.advSe, 4), slope: round(r.slope!, 5), size: r.size, n: r.n,
    };
  });
  return { fingerprint: unitsFingerprint(), units };
}

const round = (x: number, k: number): number => Math.round(x * 10 ** k) / 10 ** k;

export function readUnitPoints(file = UNIT_POINTS_FILE): UnitPointsFile {
  return JSON.parse(readFileSync(file, 'utf8')) as UnitPointsFile;
}

/** 估算点数与实测点数相差超过 gap 点的兵种 */
export function estimateGaps(f: UnitPointsFile, gap = 1): { key: string; measured: number; estimate: number; diff: number }[] {
  return Object.entries(f.units)
    .map(([key, u]) => ({ key, measured: u.points, estimate: u.estimate, diff: u.estimate - u.points }))
    .filter(x => Math.abs(x.diff) > gap)
    .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
}
export { UNITS };
