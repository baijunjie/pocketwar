/**
 * 指纹：测量结果依赖的兵种定义、规则与测量规程摘成一个哈希，存在结果文件里。
 * 兵种定义或规则变了而结果没重新生成时，指纹对不上，测试失败。
 * 只看会影响对战的东西：兵种面板与特性、原型、规则表（不含经济、补给、据点、占领、昼夜天气、攻城与城墙）、等级、体型、测量规程。
 * 没算进去的是系统代码本身（改了结算算法也会让结果过期，那种情况要自己想到重新生成）。
 */
import { createHash } from 'node:crypto';
import {
  ARCHETYPES, ELITE, HP_SCALE, LEVELS, PRICES, RULES, SIZES, STEP, TRAITS, UNITS, UnitDef, isContentUnit,
} from '../../src/sim/defs';
import { DECIDED, PROTOCOL } from './battle';
import { DEFAULTS, HANDICAP, SLOPE_LEVELS, SPARSE_SLOTS } from './measure';
import { FLOOR_DIMS, FLOOR_RATIO, MANPOWER_PROBE, PROBE } from './price';
import { SEQ, seedList } from './stats';
import { POSITIONS, REF_SHARE } from './units';

/** 键排序后序列化，函数略过 */
function stable(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(stable).join(',')}]`;
  if (x && typeof x === 'object') {
    return `{${Object.keys(x).sort().filter(k => typeof (x as Record<string, unknown>)[k] !== 'function')
      .map(k => `${JSON.stringify(k)}:${stable((x as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(x) ?? 'null';
}

/**
 * 不影响平地对冲的规则表：经济、补给、据点、占领、昼夜天气，以及 siege（火把打建筑、城墙驻守与垛口，战场上没有建筑与城墙）。
 * 测量规程是平地、无建筑、无据点，这几张表变了测量结果不会变。
 */
const IRRELEVANT_RULES = ['economy', 'supply', 'site', 'capture', 'env', 'siege'];
const TEXT_FIELDS = ['name', 'desc', 'model', 'faction'];

/** 正式兵种（不含测量工具登记的基准单位与变体） */
export const contentUnits = (): UnitDef[] => UNITS.filter(isContentUnit);

export function hash(parts: unknown): string {
  return createHash('sha1').update(stable(parts)).digest('hex').slice(0, 16);
}

/**
 * 测量指纹：价目表的测量结果（price-measurements.json）依赖的东西——规则、等级、体型、原型、特性、位置与标准混编军，
 * 以及测量规程（对战规程与提前收兵、序贯检验、让级与斜率、各测量的规模与样本上限、种子、测价的级数、兵员测几级）。它变了，测量就要重量
 */
export function measureFingerprint(): string {
  const rules: Record<string, unknown> = { ...RULES };
  for (const k of IRRELEVANT_RULES) delete rules[k];
  return hash({
    rules, LEVELS, ELITE, HP_SCALE, STEP, SIZES, ARCHETYPES, TRAITS, POSITIONS, REF_SHARE,
    protocol: { ...PROTOCOL, DECIDED, SEQ, HANDICAP, SLOPE_LEVELS, SPARSE_SLOTS, DEFAULTS, seeds: seedList(0, 4) },
    probes: { PROBE, MANPOWER_PROBE },
  });
}

/**
 * 汇总指纹：价目表（prices.json）在测量指纹之上，再依赖汇总时的地板价规则。
 * 汇总规则本身（derivePrices）改了由测试直接核对「按提交的测量重新汇总等于提交的价目表」，不靠指纹
 */
export function pricingFingerprint(): string {
  return hash({ measure: measureFingerprint(), floor: { FLOOR_DIMS, FLOOR_RATIO } });
}

/** 兵种定义的指纹（不含名称、说明、模型这些不影响对战的字段） */
export function unitsFingerprint(): string {
  const units = contentUnits().map(d => {
    const o: Record<string, unknown> = { ...d };
    for (const k of TEXT_FIELDS) delete o[k];
    return o;
  });
  // 价目表影响战力估值（士气）；它自己的指纹字段与兵员价格（只用来算阵营点数）不进哈希
  const { fingerprint: _f, manpower: _m, ...prices } = PRICES;
  return hash({ pricing: pricingFingerprint(), units, prices });
}
