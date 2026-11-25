/** 对战测量工具：统计。与对战分开，只处理样本数组。 */

/** 样本的种子表：第 from 个起取 n 个。与原型相同，同一批种子在不同测量里重复使用，差值才有配对的好处 */
export const seedList = (from: number, n: number): number[] => Array.from({ length: n }, (_, i) => 101 + (from + i) * 37);

export interface Stat {
  mean: number;
  /** 均值的标准误 */
  se: number;
  n: number;
}

export function stat(xs: number[]): Stat {
  const n = xs.length, mean = xs.reduce((p, c) => p + c, 0) / n;
  const sd = Math.sqrt(xs.reduce((p, c) => p + (c - mean) ** 2, 0) / Math.max(1, n - 1));
  return { mean, se: sd / Math.sqrt(n), n };
}

/** 同一批种子上两组样本逐个相减，再求统计（配对差，噪声小于各自标准误的合成） */
export function pairedDiff(a: number[], b: number[]): Stat {
  return stat(a.map((x, i) => x - b[i]));
}

/**
 * 序贯检验里的增量：被测军队只打了前 n 组（t），参照组打满了上限（bAll，前 n 组与 t 同种子配对）。
 * 用双重抽样的回归估计：增量 = mean(t) − β·(mean(b) − mean(bAll)) − mean(bAll)，b 是 bAll 的前 n 组，β = cov(t, b) ÷ var(b)（按这 n 对估）。
 * 两边结果高度相关（改动小）时 β≈1，退化成配对差；不相关时 β≈0，退化成被测军队对打满的参照组直接相减。
 * 不直接用前 n 组的配对差，是因为参照组被同规模的所有格子共用：前 n 组的偶然偏差会同时进入所有在第 n 组停下的格子，
 * 又因为「看起来差得大」才提前停，偏差被放大（实测前 16 组的参照组偏低，让在 16 组停下的一批格子普遍偏高约 1 点）。
 * 标准误² = var(t − βb) ÷ n + (β − 1)²·var(b) ÷ N（残差与 b 不相关，交叉项为 0；忽略 β 的估计误差）
 * 均值按 (mean(t) − mean(bAll)) − β·(mean(b) − mean(bAll)) 的次序算：t 与 b 逐组相同时 β = 1，两个括号逐位相等，增量是精确的 0，
 * 停止判断才会走「标准误为 0、均值为 0」的不显著分支（换个次序，浮点舍入会留下 1e-17 这样的非零均值，被判成显著）
 */
export function regressionDelta(t: number[], bAll: number[]): Stat {
  const n = t.length, N = bAll.length, b = bAll.slice(0, n);
  const mt = stat(t).mean, mb = stat(b).mean, ref = stat(bAll), mB = ref.mean;
  let cov = 0, vb = 0;
  for (let i = 0; i < n; i++) {
    cov += (t[i] - mt) * (b[i] - mb);
    vb += (b[i] - mb) ** 2;
  }
  // 参照组前 n 组全相同时 β 无从估计，按配对差（β = 1）处理
  const beta = vb > 0 ? cov / vb : 1;
  const se = Math.hypot(stat(t.map((x, i) => x - beta * b[i])).se, (beta - 1) * ref.se);
  return { mean: (mt - mB) - beta * (mb - mB), se, n };
}

/** 增量的绝对值小于两倍标准误即不显著；增量为 0 一律不显著（样本全相同、标准误也是 0 时） */
export const significant = (s: { mean: number; se: number }): boolean => s.mean !== 0 && Math.abs(s.mean) >= SEQ.z * s.se;

/** 两个均值之差是否在两边标准误合成后的 k 倍以内 */
export const withinSe = (a: Stat, b: { mean: number; se: number }, k = 3): boolean =>
  Math.abs(a.mean - b.mean) <= k * Math.hypot(a.se, b.se);

/**
 * 序贯检验（样本够了就停）的规程：每批 batch 组，每批打完看增量（回归估计，见 regressionDelta）的 z = |均值| ÷ 标准误，t = 已打组数 ÷ 上限。
 * - 显著即停：打到上限的 effMinT（一半）以后，z ≥ max(effFloor, z ÷ √t)，O'Brien-Fleming 型（早期门槛高、打满时回到 z）；下限 effFloor 保证提前停下的格子相对标准误不超过 1 ÷ effFloor。
 *   一半之前不因显著而停：各格共用同一批种子、误差相关，实测在第一批（16 组）就因显著停下的格子平均高估 22%–32%，一半以后停下的没有可见偏差
 * - 不显著即停：照现在的均值打满上限，末批 z ≥ 2 的概率（按当前趋势的条件功效）低于 futility
 * - 打满上限：照旧按 z ≥ 2 判显著
 * 选这组门槛的依据（蒙特卡洛：无效果时误判显著的比例与固定样本数相当，判断与打满时的一致率，期望样本数）见 docs/unit-stat-model.md
 */
export const SEQ = { batch: 16, effMinT: 0.5, effFloor: 3.5, futility: 0.05, z: 2 } as const;

/** 停止原因：显著即停、不显著即停、打满上限 */
export type Stop = 'sig' | 'futile' | 'cap';

/** 标准正态分布函数（Abramowitz–Stegun 7.1.26 的误差函数近似，误差小于 1.5e-7；纯算术，结果确定） */
export function normCdf(x: number): number {
  const z = Math.abs(x) / Math.SQRT2, k = 1 / (1 + 0.3275911 * z);
  const erf = 1 - k * (0.254829592 + k * (-0.284496736 + k * (1.421413741 + k * (-1.453152027 + k * 1.061405429)))) * Math.exp(-z * z);
  return x >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

/** 按当前趋势的条件功效：已打到信息比例 t、z 值为 z 时，照现在的均值打满，末批 |z| ≥ SEQ.z 的概率 */
export function conditionalPower(z: number, t: number): number {
  if (t >= 1) return Math.abs(z) >= SEQ.z ? 1 : 0;
  // 打满时的 z 服从 N(z ÷ √t, 1 − t)：已打部分贡献 z√t，剩下 1 − t 按当前估计的效应 z ÷ √t 外推
  const m = Math.abs(z) / Math.sqrt(t), s = Math.sqrt(1 - t);
  return 1 - normCdf((SEQ.z - m) / s) + normCdf((-SEQ.z - m) / s);
}

/** 第 n 组打完后要不要停：返回停止原因，继续打返回 undefined。cap 是样本上限；d 是到第 n 组为止的增量（回归估计，见 regressionDelta） */
export function stopRule(d: Stat, cap: number): Stop | undefined {
  if (d.n >= cap) return 'cap';
  // 标准误为 0（被测军队与参照组逐组相差同一个数）：均值为 0 就是没有效果，不为 0 就是确定的效果，都不必再打
  if (d.se === 0) return d.mean === 0 ? 'futile' : 'sig';
  const z = Math.abs(d.mean) / d.se, t = d.n / cap;
  if (t >= SEQ.effMinT && z >= Math.max(SEQ.effFloor, SEQ.z / Math.sqrt(t))) return 'sig';
  if (conditionalPower(z, t) < SEQ.futility) return 'futile';
  return undefined;
}

/** 序贯检验看结果的各个组数：每批 SEQ.batch 组，最后一批补到上限 */
export function looks(cap: number): number[] {
  const out: number[] = [];
  for (let n = SEQ.batch; n < cap; n += SEQ.batch) out.push(n);
  out.push(cap);
  return out;
}
