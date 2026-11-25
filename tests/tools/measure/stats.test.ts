import { describe, expect, it } from 'vitest';
import { SEQ, conditionalPower, looks, normCdf, pairedDiff, regressionDelta, seedList, significant, stat, stopRule, withinSe } from '../../../tools/measure/stats';

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

  it('显著：增量为 0 一律不显著，标准误也为 0 时同样；增量不为 0、标准误为 0 算显著', () => {
    expect(significant({ mean: 0, se: 0 })).toBe(false);
    expect(significant({ mean: 0, se: 0.03 })).toBe(false);
    expect(significant({ mean: 0.001, se: 0 })).toBe(true);
    expect(significant({ mean: -0.001, se: 0 })).toBe(true);
  });

  it('两个均值差在合成标准误 k 倍以内：k 缺省 3，可以改，恰好等于也算在内', () => {
    const a = { mean: 0, se: 0.03, n: 4 }, b = { mean: 0.15, se: 0.04 };
    expect(withinSe(a, b)).toBe(true);
    expect(withinSe(a, b, 2)).toBe(false);
    expect(withinSe(a, { mean: -0.15, se: 0.04 })).toBe(true);
  });
});

describe('序贯检验：正态分布函数', () => {
  it('normCdf：0 处为 0.5，1.96 处约 0.975，关于 0 对称，单调增，两端趋于 0 与 1', () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 6);
    expect(normCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normCdf(1)).toBeCloseTo(0.8413, 3);
    expect(normCdf(-1.96)).toBeCloseTo(0.025, 3);
    for (const x of [0.3, 1, 2.5, 4]) expect(normCdf(x) + normCdf(-x)).toBeCloseTo(1, 6);
    let prev = -1;
    for (let x = -5; x <= 5; x += 0.5) {
      expect(normCdf(x)).toBeGreaterThan(prev);
      prev = normCdf(x);
    }
    expect(normCdf(-8)).toBeLessThan(1e-6);
    expect(normCdf(8)).toBeGreaterThan(1 - 1e-6);
  });
});

describe('序贯检验：条件功效', () => {
  it('信息比例为 1（或更大）时退化为 |z| ≥ 2 的 0/1，恰好 2 算达标，正负对称', () => {
    for (const t of [1, 1.5]) {
      expect(conditionalPower(1.99, t)).toBe(0);
      expect(conditionalPower(2, t)).toBe(1);
      expect(conditionalPower(-2, t)).toBe(1);
      expect(conditionalPower(-1.99, t)).toBe(0);
      expect(conditionalPower(0, t)).toBe(0);
    }
  });

  it('按当前趋势外推打满：z 为 2、打到一半时约 0.88；z 为 0、打到一半时接近 0；z 很大时接近 1', () => {
    expect(conditionalPower(2, 0.5)).toBeCloseTo(0.879, 2);
    expect(conditionalPower(0, 0.5)).toBeCloseTo(0.0047, 3);
    expect(conditionalPower(8, 0.2)).toBeGreaterThan(0.999);
  });

  it('随 |z| 单调增，取值在 0 到 1 之间，正负 z 对称', () => {
    for (const t of [0.1, 1 / 3, 0.5, 0.9]) {
      let prev = -1;
      for (let z = 0; z <= 6; z += 0.25) {
        const p = conditionalPower(z, t);
        expect(p).toBeGreaterThanOrEqual(prev);
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(1);
        expect(conditionalPower(-z, t)).toBeCloseTo(p, 12);
        prev = p;
      }
    }
  });

  it('同一个 z，打得越多（t 越大）、剩下越少时，z 不到 2 的功效越低', () => {
    expect(conditionalPower(1, 0.9)).toBeLessThan(conditionalPower(1, 0.3));
  });
});

describe('序贯检验：各批的组数', () => {
  it('规程常量：每批 16 组', () => {
    expect(SEQ.batch).toBe(16);
  });

  it('looks：16 的倍数里小于上限的各批，再加上上限', () => {
    expect(looks(48)).toEqual([16, 32, 48]);
    expect(looks(96)).toEqual([16, 32, 48, 64, 80, 96]);
    expect(looks(20)).toEqual([16, 20]);
    expect(looks(16)).toEqual([16]);
    expect(looks(17)).toEqual([16, 17]);
    expect(looks(2)).toEqual([2]);
    expect(looks(1)).toEqual([1]);
  });
});

describe('序贯检验：停止判断', () => {
  /** 配对差统计：均值、标准误、已打组数 */
  const d = (mean: number, se: number, n: number) => ({ mean, se, n });

  it('打满上限就停（n ≥ cap），不论显著与否、标准误是否为 0', () => {
    expect(stopRule(d(0, 1, 48), 48)).toBe('cap');
    expect(stopRule(d(10, 1, 48), 48)).toBe('cap');
    expect(stopRule(d(0, 0, 48), 48)).toBe('cap');
    expect(stopRule(d(5, 0, 2), 2)).toBe('cap');
    expect(stopRule(d(0, 1, 60), 48)).toBe('cap');
  });

  it('标准误为 0：均值为 0 是不显著即停，均值不为 0（含负）是显著即停', () => {
    expect(stopRule(d(0, 0, 16), 96)).toBe('futile');
    expect(stopRule(d(0.01, 0, 16), 96)).toBe('sig');
    expect(stopRule(d(-0.01, 0, 16), 96)).toBe('sig');
  });

  it('显著即停：只在 t ≥ 0.5 以后，z 不低于 3.5（与 2 ÷ √t 中较大的那个）；负均值按绝对值', () => {
    // 上限 48：打了 32 组，t = 2/3
    expect(stopRule(d(3.5, 1, 32), 48)).toBe('sig');
    expect(stopRule(d(-3.5, 1, 32), 48)).toBe('sig');
    expect(stopRule(d(3.4, 1, 32), 48)).toBeUndefined();
    // 上限 96：打了 48 组，t 恰好 0.5，门槛是下限 3.5（2 ÷ √0.5 ≈ 2.83 更低）
    expect(stopRule(d(3.4, 1, 48), 96)).toBeUndefined();
    expect(stopRule(d(3.5, 1, 48), 96)).toBe('sig');
    expect(stopRule(d(-3.5, 1, 48), 96)).toBe('sig');
    expect(stopRule(d(10, 1, 64), 96)).toBe('sig');
  });

  it('t = 0.5 是显著即停的分界：恰好 0.5 可以停，不到 0.5 时 z 再大也不因显著而停', () => {
    expect(SEQ.effMinT).toBe(0.5);
    // 上限 48：24 组恰好一半
    expect(stopRule(d(3.5, 1, 24), 48)).toBe('sig');
    expect(stopRule(d(3.5, 1, 23), 48)).toBeUndefined();
    // 上限 96：第一批 16 组（t = 1/6）、32 组（t = 1/3）都不行
    for (const n of [16, 32]) {
      expect(stopRule(d(5, 1, n), 96)).toBeUndefined();
      expect(stopRule(d(50, 1, n), 96)).toBeUndefined();
      expect(stopRule(d(-50, 1, n), 96)).toBeUndefined();
    }
    // 上限 48：第一批 16 组（t = 1/3）不行
    expect(stopRule(d(50, 1, 16), 48)).toBeUndefined();
  });

  it('t 不到 0.5 时仍可不显著即停；标准误为 0 且均值非 0 照旧立即显著即停', () => {
    expect(stopRule(d(0.2, 1, 16), 48)).toBe('futile');
    expect(stopRule(d(0, 1, 16), 96)).toBe('futile');
    expect(stopRule(d(0.01, 0, 16), 96)).toBe('sig');
    expect(stopRule(d(-0.01, 0, 16), 48)).toBe('sig');
  });

  it('不显著即停：按当前趋势打满的条件功效低于 0.05；功效不低于 0.05 就继续', () => {
    // 上限 48、打了 16 组：z = 0.2 时功效约 0.02，z = 0.5 时约 0.08
    expect(conditionalPower(0.2, 1 / 3)).toBeLessThan(0.05);
    expect(conditionalPower(0.5, 1 / 3)).toBeGreaterThan(0.05);
    expect(stopRule(d(0.2, 1, 16), 48)).toBe('futile');
    expect(stopRule(d(-0.2, 1, 16), 48)).toBe('futile');
    expect(stopRule(d(0.5, 1, 16), 48)).toBeUndefined();
    // 中间地带（z 约为 2）继续打
    expect(stopRule(d(2, 1, 16), 48)).toBeUndefined();
    expect(stopRule(d(2, 1, 32), 48)).toBeUndefined();
  });

  it('同样的 z，打到越后面越容易判不显著：打了 32 组、上限 48 时 z = 0.5 就不显著即停', () => {
    expect(stopRule(d(0.5, 1, 16), 48)).toBeUndefined();
    expect(stopRule(d(0.5, 1, 32), 48)).toBe('futile');
  });

  it('标准误按比例放大缩小不改变判断（只看 z）', () => {
    expect(stopRule(d(0.035, 0.01, 16), 48)).toBe(stopRule(d(3.5, 1, 16), 48));
    expect(stopRule(d(0.002, 0.01, 16), 48)).toBe(stopRule(d(0.2, 1, 16), 48));
  });
});

describe('回归估计增量：regressionDelta', () => {
  const mean = (xs: number[]): number => xs.reduce((p, c) => p + c, 0) / xs.length;
  const variance = (xs: number[]): number => {
    const m = mean(xs);
    return xs.reduce((p, c) => p + (c - m) ** 2, 0) / (xs.length - 1);
  };
  /** 按需求给的公式独立算一遍 */
  const reference = (t: number[], bAll: number[]) => {
    const n = t.length, N = bAll.length, b = bAll.slice(0, n);
    const mt = mean(t), mb = mean(b), mB = mean(bAll);
    const vb = variance(b);
    const beta = vb === 0 ? 1 : t.reduce((p, x, i) => p + (x - mt) * (b[i] - mb), 0) / (n - 1) / vb;
    return {
      mean: mt - beta * (mb - mB) - mB,
      se: Math.sqrt(variance(t.map((x, i) => x - beta * b[i])) / n + (beta - 1) ** 2 * variance(bAll) / N),
      n,
    };
  };

  const bAll = [0.31, 0.27, 0.35, 0.22, 0.4, 0.29, 0.33, 0.25, 0.38, 0.3, 0.26, 0.36];

  it('被测军队与参照组前 n 组完全相同：增量 0、标准误 0，n 是被测军队的组数', () => {
    const r = regressionDelta(bAll.slice(0, 8), bAll);
    expect(r.mean).toBeCloseTo(0, 12);
    expect(r.se).toBeCloseTo(0, 12);
    expect(r.n).toBe(8);
  });

  it('被测军队与参照组前 n 组逐组相同：增量是精确的 0（不是舍入误差），标准误精确为 0，停止规则判不显著即停，significant 为 false；样本均值跨 0、前 n 组与全部组均值相差悬殊也一样', () => {
    // 固定的线性同余伪随机序列：值落在 −0.135 ～ +0.165 之间
    let seed = 12345;
    const rand = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    let cases = 0;
    for (let k = 0; k < 60; k++) {
      const n = [16, 32, 48][k % 3], N = 96;
      const all = Array.from({ length: N }, () => -0.135 + 0.3 * rand());
      // 一半的用例让前 n 组整体偏移，使前 n 组均值与全部组均值相差悬殊
      if (k % 2) for (let i = 0; i < n; i++) all[i] = Math.min(0.165, Math.max(-0.135, all[i] + (k % 4 === 1 ? 0.12 : -0.12)));
      const r = regressionDelta(all.slice(0, n), all);
      expect(r.mean, `case ${k}`).toBe(0);
      expect(r.se, `case ${k}`).toBe(0);
      expect(r.n).toBe(n);
      expect(stopRule(r, N), `case ${k}`).toBe('futile');
      expect(significant(r), `case ${k}`).toBe(false);
      cases++;
    }
    expect(cases).toBe(60);
  });

  it('被测军队 = 参照组前 n 组 + 常数 c：增量正好是 c、标准误 0（退化为配对差），不论参照组全部有多少组', () => {
    for (const c of [0.1, -0.25]) {
      const r = regressionDelta(bAll.slice(0, 6).map(x => x + c), bAll);
      expect(r.mean).toBeCloseTo(c, 12);
      expect(r.se).toBeCloseTo(0, 12);
    }
  });

  it('被测军队与参照组无关（β = 0）：增量 = mean(t) − mean(bAll)，se² = var(t) ÷ n + var(bAll) ÷ N', () => {
    const t = [3, 3, 1, 1], all = [1, -1, 1, -1, 2, 0, 2, 0];
    const r = regressionDelta(t, all);
    expect(r.mean).toBeCloseTo(2 - 0.5, 12);
    expect(r.se ** 2).toBeCloseTo((4 / 3) / 4 + (10 / 7) / 8, 12);
    expect(r.n).toBe(4);
  });

  it('参照组打满就是 n 组（n = N）：增量等于配对差的均值', () => {
    const t = [0.5, 0.2, 0.9, 0.1, 0.7, 0.4];
    const all = bAll.slice(0, 6);
    expect(regressionDelta(t, all).mean).toBeCloseTo(pairedDiff(t, all).mean, 12);
  });

  it('参照组前 n 组全相同（方差为 0）时 β 按 1 处理：增量 = mean(t) − 前 n 组均值，标准误只剩配对差部分', () => {
    const t = [1, 2, 3, 4];
    const r = regressionDelta(t, [5, 5, 5, 5, 1, 9]);
    expect(r.mean).toBeCloseTo(2.5 - 5, 12);
    expect(r.se).toBeCloseTo(Math.sqrt(variance(t) / 4), 12);
  });

  it('一般情形与公式一致：增量与标准误', () => {
    const t = [0.5, 0.2, 0.9, 0.1, 0.7, 0.4, 0.6, 0.35];
    const r = regressionDelta(t, bAll), want = reference(t, bAll);
    expect(r.mean).toBeCloseTo(want.mean, 12);
    expect(r.se).toBeCloseTo(want.se, 12);
    expect(r.n).toBe(8);
    expect(r.se).toBeGreaterThan(0);
  });

  it('结果只依赖输入：同样的输入两次结果完全一样，也不改动传入的数组', () => {
    const t = [0.5, 0.2, 0.9, 0.1], all = [...bAll], tCopy = [...t];
    expect(regressionDelta(t, all)).toEqual(regressionDelta(t, all));
    expect(t).toEqual(tCopy);
    expect(all).toEqual(bAll);
  });
});
