import { describe, expect, it } from 'vitest';
import { pairedDiff, seedList, significant, stat, withinSe } from '../../../tools/measure/stats';

describe('测量统计：边界', () => {
  it('种子表：第 from 个起取 n 个，步长 37；换起点的两段不重叠，接起来与一整段相同', () => {
    expect(seedList(0, 0)).toEqual([]);
    expect([...seedList(0, 3), ...seedList(3, 2)]).toEqual(seedList(0, 5));
    expect(seedList(2, 1)).toEqual([101 + 2 * 37]);
  });

  it('只有一个样本：均值是它自己，标准误为 0', () => {
    expect(stat([0.7])).toEqual({ mean: 0.7, se: 0, n: 1 });
  });

  it('标准误 = 样本标准差（n−1）÷ √n，样本数记在 n 里', () => {
    const s = stat([2, 4, 4, 4, 5, 5, 7, 9]);
    expect(s.n).toBe(8);
    expect(s.mean).toBe(5);
    expect(s.se).toBeCloseTo(Math.sqrt(32 / 7) / Math.sqrt(8), 9);
  });

  it('配对差逐个相减：两组之差的变化小于各自变化时，标准误比不配对小', () => {
    const a = [10, 20, 30, 40], b = [9, 19, 29, 39];
    const d = pairedDiff(a, b);
    expect(d.mean).toBe(1);
    expect(d.se).toBe(0);
    expect(stat(a).se).toBeGreaterThan(d.se);
  });

  it('显著：恰好两倍标准误算显著，负增量按绝对值判断', () => {
    expect(significant({ mean: 0.06, se: 0.03 })).toBe(true);
    expect(significant({ mean: -0.06, se: 0.03 })).toBe(true);
    expect(significant({ mean: -0.059, se: 0.03 })).toBe(false);
  });

  it('两个均值差在合成标准误 k 倍以内：k 缺省 3，可以改，恰好等于也算在内', () => {
    const a = { mean: 0, se: 0.03, n: 4 }, b = { mean: 0.15, se: 0.04 };
    expect(withinSe(a, b)).toBe(true);
    expect(withinSe(a, b, 2)).toBe(false);
    expect(withinSe(a, { mean: -0.15, se: 0.04 })).toBe(true);
  });
});
