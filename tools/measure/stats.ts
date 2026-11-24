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

/** 增量的绝对值小于两倍标准误即不显著 */
export const significant = (s: { mean: number; se: number }): boolean => Math.abs(s.mean) >= 2 * s.se;

/** 两个均值之差是否在两边标准误合成后的 k 倍以内 */
export const withinSe = (a: Stat, b: { mean: number; se: number }, k = 3): boolean =>
  Math.abs(a.mean - b.mean) <= k * Math.hypot(a.se, b.se);
