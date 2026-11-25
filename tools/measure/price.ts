/**
 * 价目表：每个位置、每个开放维度一格，含义是「该位置全员加 1 级值几点」，加级与减级分开记。
 * 全部用维度测量按固定规程重量；规则见 docs 里的开发计划，这里是实现。
 */
import {
  ARCHETYPES, ARCHETYPE_INDEX, Dim, POSITIONS, PriceTable, TRAITS, UNITS, isContentUnit, positionTraits,
} from '../../src/sim/defs';
import { Measurer, Row } from './measure';

/**
 * 各维度量几级：生命、输出、纪律、冲击 ±8，节奏、机动、射程 ±4，护甲 +4 与 −3；
 * 破甲 +8、举盾 +12（基准为 0、没有负级数，只量加级，减级价目记 0），范围杀伤 +4 与 −15（−15 即半径降到 0）
 */
export const PROBE: Record<string, [number, number | null]> = {
  hp: [8, -8], out: [8, -8], disc: [8, -8], imp: [8, -8],
  cad: [4, -4], spd: [4, -4], rng: [4, -4],
  armM: [4, -3], armP: [4, -3],
  pen: [8, null], block: [12, null], splash: [4, -15],
};

/** 兵员量几级：标准混编军每个位置都按兵员加 8 级加人，量一次，加级减级同价 */
export const MANPOWER_PROBE = 8;

/** 机动、射程、纪律在平地会战里量不出价值，加级价目取实测值与地板价中较大的一个（减级不计点，见 points.ts 的 STRATEGIC_DIMS） */
export const FLOOR_DIMS: Dim[] = ['spd', 'rng', 'disc'];
/** 地板价 = 同位置生命价目的这个比例 */
export const FLOOR_RATIO = 1 / 3;

/** 位置开放的维度（来自原型），去掉还不能量的治疗 */
export function openDims(pos: string): Dim[] {
  const a = ARCHETYPES[ARCHETYPE_INDEX[POSITIONS[pos].arch]];
  return a.dims.filter(k => k !== 'heal');
}

/**
 * 需要量价的特性：某个位置里有兵种带它，而位置基准本来没有；
 * 以及特性自己声明要计价的位置（TraitDef.priceAt，有没有兵种带都计价），位置基准本来就带它的除外
 */
export function pricedTraits(): { slot: string; trait: string }[] {
  const out: { slot: string; trait: string }[] = [];
  const add = (slot: string, trait: string): void => {
    if (!out.some(o => o.slot === slot && o.trait === trait)) out.push({ slot, trait });
  };
  for (const d of UNITS) {
    if (d.tier !== 0 || !isContentUnit(d)) continue;
    // ownTraits 已经去掉了原型与位置基准本来就带的特性
    for (const t of d.ownTraits) add(d.position, t);
  }
  for (const t of Object.values(TRAITS)) {
    for (const slot of t.priceAt) if (!positionTraits(slot).includes(t.key)) add(slot, t.key);
  }
  return out;
}

/** 价目表的一项测量：标签（如 siege:hp=8、bolt:+ballista、manpower:+8）与跑它的函数 */
export interface PriceJob {
  label: string;
  run: () => Promise<Row>;
}

/** 价目表要量的全部测量：每个位置每个开放维度加减各一次，每个要计价的特性一次，兵员一次 */
export function priceJobs(m: Measurer, opts?: { size?: number; n?: number }): PriceJob[] {
  const jobs: PriceJob[] = [];
  for (const pos of Object.keys(POSITIONS)) {
    for (const dim of openDims(pos)) {
      for (const lv of PROBE[dim]) if (lv !== null) jobs.push({ label: `${pos}:${dim}=${lv}`, run: () => m.dimension(pos, { [dim]: lv }, opts) });
    }
  }
  for (const { slot, trait } of pricedTraits()) jobs.push({ label: `${slot}:+${trait}`, run: () => m.trait(slot, trait, opts) });
  jobs.push({ label: `manpower:+${MANPOWER_PROBE}`, run: () => m.manpower(MANPOWER_PROBE, opts) });
  return jobs;
}

/**
 * 重量全部价目。done 里已有的（按标签）不再量：用来接着中断的那次往下跑，或沿用经抽测核对过对战没变的旧测量（见 cli 的 prices --reuse）；
 * done 里不在这次要量的清单上的行（如已经没有兵种带的特性）丢掉
 */
export async function measurePrices(m: Measurer, onRow?: (r: Row) => void, done: Row[] = [], opts?: { size?: number; n?: number }): Promise<Row[]> {
  return Promise.all(priceJobs(m, opts).map(j => {
    const old = done.find(r => r.label === j.label);
    return old ? Promise.resolve(old) : j.run().then(r => {
      onRow?.(r);
      return r;
    });
  }));
}

/** 由测量结果汇总价目表（纯函数，不跑对战） */
export function derivePrices(rows: Row[]): Omit<PriceTable, 'fingerprint'> {
  const dims: PriceTable['dims'] = {}, traits: PriceTable['traits'] = {};
  // 每格 = 量出的点数 ÷ 级数；不显著的记 0
  const cell = (pos: string, dim: Dim, sign: 1 | -1): number => {
    const r = rows.find(x => x.meta?.slot === pos && x.meta.levels && (x.meta.levels[dim] ?? 0) * sign > 0);
    if (!r) throw new Error(`缺测量：${pos} ${dim} ${sign > 0 ? '加级' : '减级'}`);
    // `|| 0` 把 0 ÷ 负级数得到的 −0 归一成 0（JSON 存不下 −0）
    return (r.significant ? r.points! / r.meta!.levels![dim]! : 0) || 0;
  };
  for (const pos of Object.keys(POSITIONS)) {
    const t: PriceTable['dims'][string] = (dims[pos] = {});
    const dd = openDims(pos);
    // 加级价目为负按 0：加一级不能倒找点数（结果为负多是噪声，如远程骑兵的近战护甲）。
    // 减级价目为负（减一级反而更强，如抛射器械的节奏）照记：减级时它是收点数而不是退点数，按 0 反而让人白拿
    for (const dim of dd) t[dim] = [Math.max(0, cell(pos, dim, 1)), PROBE[dim][1] === null ? 0 : cell(pos, dim, -1)];
    // 地板价只作用于加级价目：取实测值与同位置生命加级价目的三分之一中较大的一个
    for (const dim of FLOOR_DIMS) {
      if (!t[dim]) continue;
      t[dim] = [Math.max(t[dim]![0], t.hp![0] * FLOOR_RATIO), t[dim]![1]];
    }
  }
  for (const r of rows) {
    if (r.kind !== 'trait') continue;
    (traits[r.meta!.slot] ??= {})[r.meta!.trait!] = r.significant ? r.points! : 0;
  }
  // 兵员每级的价格 = 点数 ÷ 实际加的兵员级数；不显著记 0
  const mp = rows.find(r => r.meta?.manpower !== undefined);
  if (!mp) throw new Error('缺测量：兵员');
  return { dims, traits, manpower: mp.significant ? mp.points! / mp.meta!.manpower! : 0 };
}
