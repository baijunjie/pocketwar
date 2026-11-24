/**
 * 对战测量工具：五种测量与标尺。
 * 都是「被测的一方对标准混编军」的优势，换算成点数：1 点 = 标准混编军全军生命加 1 级。
 * 换算规程：让对手（标准混编军）全军生命 −6 级，使被测一方落在优势曲线的线性段；
 * 同一批种子再量被测一方全军生命 ±3 级，得到当地斜率；点数 = 优势的增量 ÷ 斜率。
 * 顶替别的位置的位置（POSITIONS 的 ref，如直射器械顶替器械位）的参照组不是标准混编军本身，而是把被顶替的位置整个换成它的基准单位的那支，
 * 增量相对这支参照组算（斜率仍用标准混编军的），所以它的基准单位正好是 0 点。
 */
import { ARCHETYPES, ARCHETYPE_INDEX, FACTION_IDS, FactionId, MANPOWER_STEP, POSITIONS } from '../../src/sim/defs';
import { ArmySpec, SlotSpec, refSpec } from './army';
import { Job, Runner, Sample } from './runner';
import { proxySlots, refCounts, refForce, slotOf } from './units';
import { Stat, pairedDiff, seedList, significant, stat } from './stats';
import { Levels } from './units';

/** 对手让几级生命；斜率取被测一方全军生命 ±几级 */
export const HANDICAP = -6;
export const SLOPE_LEVELS = 3;
/** 人少的位置：量不准，规模与样本数都加大 */
export const SPARSE_SLOTS = ['cavr', 'siege', 'ele'];

/**
 * 五种测量缺省的规模与样本数。规模是兵力份数：标准混编军按 100 人、300 人的人数构成折算（refForce）。
 * 阵营的两项（faction、roundRobin）的规模是基准份数：阵营一方出「基准份数 × 兵员倍率」（与主菜单的「每方兵力」同一个量），
 * 阵营测量的对手是同样份数的标准混编军。取 300 人标准混编军的份数，与其它测量同一量级。
 */
export const DEFAULTS = {
  dim: { size: refForce(100), n: 48 },
  sparse: { size: refForce(300), n: 96 },
  count: { size: refForce(300), n: 96 },
  unit: { size: refForce(100), n: 48 },
  faction: { size: refForce(300), n: 48 },
  roundRobin: { size: refForce(300), n: 24 },
  ladder: { size: refForce(100), n: 48 },
};

export interface Row {
  kind: 'dim' | 'trait' | 'count' | 'unit' | 'faction' | 'roundrobin' | 'rr-mean' | 'ladder';
  label: string;
  size: number;
  n: number;
  /** 被测一方对对手的优势（均值与标准误） */
  adv: number;
  advSe: number;
  /** 胜率 */
  win: number;
  /** 相对基线（标准混编军对同一对手）的优势增量 */
  delta?: number;
  deltaSe?: number;
  /** 当地斜率：每级全军生命的优势 */
  slope?: number;
  points?: number;
  pointsSe?: number;
  /** 增量的绝对值不小于两倍标准误 */
  significant?: boolean;
  /** 逐个样本的优势（只有 pair 给出，供同一批种子上配对比较） */
  advs?: number[];
  /** 被测的东西：位置与维度级数、特性或兵种，供汇总价目表与兵种实测表用 */
  meta?: { slot: string; levels?: Levels; trait?: string; unit?: string; manpower?: number };
}

/** 兵力占用核对的一行：这个原型加了几人、每人值几点、相对近战步兵的比值 */
export interface ForceRow {
  arch: string;
  added: number;
  row: Row;
  perHead: number;
  ratio: number;
  ratioSe: number;
}

/** 阵营标准军的试算改动 */
export type FactionMod = { manpower?: number; all?: Levels; swap?: string };
const modLabel = (m: FactionMod): string => [
  m.manpower !== undefined ? `兵员=${m.manpower}` : '',
  m.all ? Object.entries(m.all).map(([k, v]) => `${k}=${v}`).join(',') : '',
  m.swap ? `${m.swap}→基准` : '',
].filter(Boolean).join(' ');

interface Series {
  advs: number[];
  stat: Stat;
  win: number;
}

export class Measurer {
  private cache = new Map<string, Promise<Series>>();
  constructor(private runner: Runner) {}

  /** a 对 b 打一批种子；相同的对阵、种子只跑一次 */
  versus(a: ArmySpec, b: ArmySpec, seeds: number[]): Promise<Series> {
    const key = JSON.stringify([a, b, seeds]);
    let hit = this.cache.get(key);
    if (!hit) {
      const job: Job = { a, b, seeds };
      hit = this.runner.run([job]).then(([s]) => toSeries(s));
      this.cache.set(key, hit);
    }
    return hit;
  }

  /** 多个对阵一起派下去（并行度靠这个），返回与输入同序 */
  versusAll(pairs: { a: ArmySpec; b: ArmySpec }[], seeds: number[]): Promise<Series[]> {
    return Promise.all(pairs.map(p => this.versus(p.a, p.b, seeds)));
  }

  /** 当地斜率：对手让 6 级时，被测一方（标准混编军）全军生命 ±3 级的优势之差 ÷ 级数差 */
  async slope(size: number, n: number): Promise<{ slope: number; se: number }> {
    const seeds = seedList(0, n), opp = refSpec(size, { hp: HANDICAP });
    const [hi, lo] = await this.versusAll([
      { a: refSpec(size, { hp: SLOPE_LEVELS }), b: opp },
      { a: refSpec(size, { hp: -SLOPE_LEVELS }), b: opp },
    ], seeds);
    const d = 2 * SLOPE_LEVELS;
    return { slope: (hi.stat.mean - lo.stat.mean) / d, se: Math.hypot(hi.stat.se, lo.stat.se) / d };
  }

  /** 被测一方对让了 6 级的标准混编军，相对参照组（缺省是标准混编军本身）的增量，换算成点数 */
  async points(kind: Row['kind'], label: string, test: ArmySpec, size: number, n: number, meta?: Row['meta'], ref: ArmySpec = refSpec(size)): Promise<Row> {
    const seeds = seedList(0, n), opp = refSpec(size, { hp: HANDICAP });
    const [t, base, sl] = await Promise.all([this.versus(test, opp, seeds), this.versus(ref, opp, seeds), this.slope(size, n)]);
    const diff = pairedDiff(t.advs, base.advs);
    const points = diff.mean / sl.slope;
    const pointsSe = Math.hypot(diff.se / sl.slope, (points * sl.se) / sl.slope);
    return {
      kind, label, size, n, adv: t.stat.mean, advSe: t.stat.se, win: t.win,
      delta: diff.mean, deltaSe: diff.se, slope: sl.slope, points, pointsSe, significant: significant(diff), meta,
    };
  }

  /**
   * 在位置 pos 上做改动 sp 的被测军队与参照组。标准混编军本来就有的位置：被测军队改这个位置，参照组是标准混编军；
   * 顶替别的位置的：被顶替的位置先整个换成它的基准单位（sp 里给了兵种就换成那个兵种）再改，参照组是只换不改的那支
   */
  private armies(pos: string, sp: SlotSpec, size: number): { test: ArmySpec; ref: ArmySpec } {
    const proxy = proxySlots(pos), slot = slotOf(pos);
    const test: ArmySpec = { type: 'ref', size, slots: { [slot]: { ...proxy[slot], ...sp } } };
    return { test, ref: Object.keys(proxy).length ? { type: 'ref', size, slots: proxy } : refSpec(size) };
  }

  /** 位置量价时缺省的规模与样本数：人少的位置（按它在标准混编军里占的位置）加大 */
  private sparse(pos: string, d: { size: number; n: number }, opts?: { size?: number; n?: number }): { size: number; n: number } {
    const x = SPARSE_SLOTS.includes(slotOf(pos)) ? DEFAULTS.sparse : d;
    return { size: opts?.size ?? x.size, n: opts?.n ?? x.n };
  }

  /** 维度测量：标准混编军里某个位置全员某维度加减若干级 */
  dimension(pos: string, levels: Levels, opts?: { size?: number; n?: number }): Promise<Row> {
    const { size, n } = this.sparse(pos, DEFAULTS.dim, opts);
    const label = `${pos}:${Object.entries(levels).map(([k, v]) => `${k}=${v}`).join(',')}`;
    const a = this.armies(pos, { levels }, size);
    return this.points('dim', label, a.test, size, n, { slot: pos, levels }, a.ref);
  }

  /** 特性测量：位置基准带上这个特性与不带的差 */
  trait(pos: string, trait: string, opts?: { size?: number; n?: number }): Promise<Row> {
    const { size, n } = this.sparse(pos, DEFAULTS.dim, opts);
    const a = this.armies(pos, { traits: [trait] }, size);
    return this.points('trait', `${pos}:+${trait}`, a.test, size, n, { slot: pos, trait }, a.ref);
  }

  /** 人数测量：标准混编军里某个位置加若干人 */
  count(pos: string, add: number, opts?: { size?: number; n?: number }): Promise<Row> {
    return this.countSlots({ [pos]: add }, opts);
  }

  /** 人数测量的多位置写法：几个位置同时各加若干人（带长柄与不带长柄的近战步兵合在一起算时用）；顶替别的位置的位置照 armies 的做法 */
  countSlots(adds: Record<string, number>, opts?: { size?: number; n?: number }): Promise<Row> {
    const size = opts?.size ?? DEFAULTS.count.size, n = opts?.n ?? DEFAULTS.count.n;
    const slots: Record<string, SlotSpec> = {}, proxy: Record<string, SlotSpec> = {};
    for (const [pos, add] of Object.entries(adds)) {
      const slot = slotOf(pos);
      if (slots[slot]) throw new Error(`人数测量：${pos} 与别的位置占同一个标准混编军位置 ${slot}`);
      Object.assign(proxy, proxySlots(pos));
      slots[slot] = { ...proxySlots(pos)[slot], add };
    }
    const ref = Object.keys(proxy).length ? { type: 'ref' as const, size, slots: proxy } : refSpec(size);
    return this.points('count', Object.entries(adds).map(([k, a]) => `${k}:add=${a}`).join('+'), { type: 'ref', size, slots }, size, n, undefined, ref);
  }

  /**
   * 兵员测量：标准混编军每个位置都按兵员加 levels 级（人数 ×1.035^levels）加人，四舍五入到整人，
   * 量出值几点；实际加的兵力份数折回成兵员级数（meta.manpower），每级的价格 = 点数 ÷ 这个级数
   */
  async manpower(levels = 8, opts?: { size?: number; n?: number }): Promise<Row> {
    const size = opts?.size ?? DEFAULTS.count.size;
    const counts = refCounts(size);
    const adds: Record<string, number> = {};
    let base = 0, added = 0;
    for (const [k, c] of Object.entries(counts)) {
      const f = ARCHETYPES[ARCHETYPE_INDEX[POSITIONS[k].arch]].force;
      adds[k] = Math.round(c * (MANPOWER_STEP ** levels - 1));
      base += c * f;
      added += adds[k] * f;
    }
    const r = await this.countSlots(adds, opts);
    return { ...r, label: `manpower:+${levels}`, meta: { slot: 'all', manpower: Math.log(1 + added / base) / Math.log(MANPOWER_STEP) } };
  }

  /**
   * 兵力占用核对：给标准混编军的每个原型加人（不少于该原型现有人数的 30%，且至少 3 人；近战步兵的两个位置合在一起算），
   * 量出值几点，除以加的人数得每人的价值，各原型之比即兵力占用之比（近战步兵为 1）。
   */
  async force(opts?: { size?: number; n?: number }): Promise<ForceRow[]> {
    const size = opts?.size ?? DEFAULTS.count.size;
    const groups: [string, string[]][] = [
      ['inf', ['inf', 'spear']], ['ranged', ['ranged']], ['cav', ['cav']], ['cavr', ['cavr']], ['siege', ['siege']], ['vehicle', ['ele']], ['bolt', ['bolt']],
    ];
    const counts = refCounts(size);
    const plan = groups.map(([arch, slots]) => {
      const adds: Record<string, number> = {};
      // 顶替别的位置的（直射器械）按被顶替位置的人数算，加人时那个位置整个换成它（见 countSlots）
      for (const s of slots) adds[s] = Math.ceil(0.3 * counts[slotOf(s)]);
      // 至少 3 人：落在原型的合计上（有两个位置的，多出来的给第一个位置）
      const total = Object.values(adds).reduce((p, c) => p + c, 0);
      if (total < 3) adds[slots[0]] += 3 - total;
      return { arch, adds, total: Math.max(3, total) };
    });
    const rows = await Promise.all(plan.map(p => this.countSlots(p.adds, opts)));
    const per = rows.map((r, i) => ({ v: r.points! / plan[i].total, se: r.pointsSe! / plan[i].total }));
    const base = per[0];
    return plan.map((p, i) => {
      const ratio = per[i].v / base.v;
      const se = i === 0 ? 0 : Math.abs(ratio) * Math.hypot(per[i].se / per[i].v, base.se / base.v);
      return { arch: p.arch, added: p.total, row: rows[i], perHead: per[i].v, ratio, ratioSe: se };
    });
  }

  /** 兵种测量：标准混编军里某个位置整个换成某个兵种（现有兵种 key）；levels 是试算时在它上面再加减的级数 */
  unit(pos: string, unit: string, opts?: { size?: number; n?: number; levels?: Levels }): Promise<Row> {
    const { size, n } = this.sparse(pos, DEFAULTS.unit, opts);
    const lv = opts?.levels ? `|${Object.entries(opts.levels).map(([k, v]) => `${k}=${v}`).join(',')}` : '';
    const sp: SlotSpec = opts?.levels ? { unit, levels: opts.levels } : { unit };
    const a = this.armies(pos, sp, size);
    return this.points('unit', `${pos}:${unit}${lv}`, a.test, size, n, { slot: pos, unit }, a.ref);
  }

  /**
   * 阵营测量：某阵营的标准军（size 份 × 兵员倍率）对同样 size 份的标准混编军。
   * mod 是调平试算用的改动（换兵员级数、全军加减级数、某兵种换成位置基准），见 ArmySpec
   */
  faction(faction: FactionId, opts?: { size?: number; n?: number; mod?: FactionMod }): Promise<Row> {
    const size = opts?.size ?? DEFAULTS.faction.size, n = opts?.n ?? DEFAULTS.faction.n;
    const label = faction + (opts?.mod ? ` ${modLabel(opts.mod)}` : '');
    return this.points('faction', label, { type: 'faction', faction, size, ...opts?.mod }, size, n);
  }

  /** 两个阵营标准军对冲一组（循环赛里的一组），可以给双方各加试算的改动；与循环赛同一批种子 */
  async pair(a: FactionId, b: FactionId, opts?: { size?: number; n?: number; modA?: FactionMod; modB?: FactionMod }): Promise<Row> {
    const size = opts?.size ?? DEFAULTS.roundRobin.size, n = opts?.n ?? DEFAULTS.roundRobin.n;
    const [r] = await this.versusAll([{
      a: { type: 'faction', faction: a, size, ...opts?.modA }, b: { type: 'faction', faction: b, size, ...opts?.modB },
    }], seedList(0, n));
    const la = a + (opts?.modA ? `(${modLabel(opts.modA)})` : ''), lb = b + (opts?.modB ? `(${modLabel(opts.modB)})` : '');
    return { kind: 'roundrobin', label: `${la}|${lb}`, size, n, adv: r.stat.mean, advSe: r.stat.se, win: r.win, advs: r.advs };
  }

  /** 标尺：被测一方全军生命加减若干级，对标准混编军的优势曲线 */
  async ladder(levels: number[], opts?: { size?: number; n?: number }): Promise<Row[]> {
    const size = opts?.size ?? DEFAULTS.ladder.size, n = opts?.n ?? DEFAULTS.ladder.n;
    const seeds = seedList(0, n);
    const out = await this.versusAll(levels.map(L => ({ a: refSpec(size, { hp: L }), b: refSpec(size) })), seeds);
    return levels.map((L, i) => ({ kind: 'ladder', label: `all:hp=${L}`, size, n, adv: out[i].stat.mean, advSe: out[i].stat.se, win: out[i].win }));
  }

  /** 循环赛：各阵营的标准军两两对冲，输出每组对阵的优势与各阵营的平均优势 */
  async roundRobin(opts?: { size?: number; n?: number; factions?: FactionId[] }): Promise<Row[]> {
    const size = opts?.size ?? DEFAULTS.roundRobin.size, n = opts?.n ?? DEFAULTS.roundRobin.n;
    const ids = opts?.factions ?? FACTION_IDS;
    const seeds = seedList(0, n);
    const pairs: [FactionId, FactionId][] = [];
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) pairs.push([ids[i], ids[j]]);
    const res = await this.versusAll(pairs.map(([a, b]) => ({ a: { type: 'faction', faction: a, size }, b: { type: 'faction', faction: b, size } })), seeds);
    const rows: Row[] = pairs.map(([a, b], i) => ({
      kind: 'roundrobin', label: `${a}|${b}`, size, n, adv: res[i].stat.mean, advSe: res[i].stat.se, win: res[i].win,
    }));
    // 各阵营的平均优势：对其余各阵营优势的平均（标准误按各组独立合成）
    for (const f of ids) {
      const xs: { mean: number; se: number }[] = [];
      pairs.forEach(([a, b], i) => {
        if (a === f) xs.push({ mean: res[i].stat.mean, se: res[i].stat.se });
        else if (b === f) xs.push({ mean: -res[i].stat.mean, se: res[i].stat.se });
      });
      const m = xs.reduce((p, c) => p + c.mean, 0) / xs.length;
      rows.push({
        kind: 'rr-mean', label: f, size, n, adv: m, advSe: Math.sqrt(xs.reduce((p, c) => p + c.se ** 2, 0)) / xs.length, win: NaN,
      });
    }
    return rows;
  }
}

function toSeries(samples: Sample[]): Series {
  const advs = samples.map(s => s.adv);
  return { advs, stat: stat(advs), win: samples.reduce((p, s) => p + s.wins, 0) / samples.length };
}
