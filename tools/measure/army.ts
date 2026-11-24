/** 对战测量工具：军队描述。描述是可序列化的纯数据，工作进程收到后在本进程里建出兵种下标列表。 */
import { FACTIONS, FactionId, TraitUse, UNITS, UNIT_BY_KEY } from '../../src/sim/defs';
import { armyList } from '../../src/sim/setup';
import { BASE, Dim, DIMS, Levels, SLOTS, refCounts, variant } from './units';

/** 标准混编军里一个位置的改动 */
export interface SlotSpec {
  /** 把这个位置整个换成该现有兵种（兵种 key）；缺省是该位置的基准单位 */
  unit?: string;
  /** 这个位置全员的维度级数 */
  levels?: Levels;
  /** 这个位置全员再加上的特性（位置基准本来没有的） */
  traits?: TraitUse[];
  /** 这个位置多（负数是少）几个人 */
  add?: number;
}

export type ArmySpec =
  /** 标准混编军：size 是兵力份数；按位置表混编基准单位，可以逐个位置改动，或全军一起加减级数 */
  | { type: 'ref'; size: number; slots?: Record<string, SlotSpec>; all?: Levels }
  /**
   * 阵营的标准军：size 是每方兵力份数，按该阵营开局编制生成，含兵员倍率。
   * 调平时的试算可以改：manpower 换掉阵营的兵员级数；all 给全军每个兵种加减级数；swap 把这个兵种换成它所属位置的基准单位
   */
  | { type: 'faction'; faction: FactionId; size: number; manpower?: number; all?: Levels; swap?: string };

export const refSpec = (size: number, all?: Levels): ArmySpec => ({ type: 'ref', size, all });

const addLevels = (a: Levels | undefined, b: Levels | undefined): Levels => {
  const out: Levels = { ...a };
  for (const k of DIMS) if (b?.[k]) out[k] = (out[k] ?? 0) + b[k]!;
  return out;
};

/** 按描述建出一支军队：兵种下标列表 */
export function buildArmy(spec: ArmySpec): number[] {
  if (spec.type === 'faction') {
    const f = FACTIONS[spec.faction];
    const list = armyList(spec.manpower === undefined ? f : { ...f, manpower: spec.manpower }, spec.size);
    if (!spec.all && !spec.swap) return list;
    const map = new Map<number, number>();
    const to = (i: number): number => {
      let j = map.get(i);
      if (j === undefined) {
        const d = UNITS[i];
        const from = d.key === spec.swap ? BASE[d.position] : d;
        j = spec.all && DIMS.some(k => spec.all![k]) ? variant(from, spec.all).idx : from.idx;
        map.set(i, j);
      }
      return j;
    };
    return list.map(to);
  }
  const out: number[] = [];
  const counts = refCounts(spec.size);
  for (const slot of SLOTS) {
    const sp = spec.slots?.[slot];
    const n = counts[slot] + (sp?.add ?? 0);
    const base = sp?.unit ? UNIT_BY_KEY[sp.unit] : BASE[slot];
    if (!base) throw new Error(`没有这个兵种：${sp?.unit ?? slot}`);
    const levels = addLevels(sp?.levels, spec.all);
    const d = DIMS.some(k => levels[k]) || sp?.traits?.length ? variant(base, levels, sp?.traits) : base;
    for (let i = 0; i < n; i++) out.push(d.idx);
  }
  return out;
}

/** 解析命令行里的级数写法：`hp=6,out=-2` */
export function parseLevels(s: string): Levels {
  const out: Levels = {};
  for (const kv of s.split(',')) {
    const [k, v] = kv.split('=');
    if (!DIMS.includes(k as Dim) || !Number.isFinite(Number(v))) throw new Error(`级数写法不对：${kv}`);
    out[k as Dim] = Number(v);
  }
  return out;
}
