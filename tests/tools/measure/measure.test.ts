import { describe, expect, it } from 'vitest';
import { ARCHETYPES } from '../../../src/sim/defs';
import { ArmySpec, refSpec } from '../../../tools/measure/army';
import { Measurer } from '../../../tools/measure/measure';
import { Job, Runner } from '../../../tools/measure/runner';
import { seedList } from '../../../tools/measure/stats';
import { BASE, refCounts, refForce } from '../../../tools/measure/units';

/** 记下派出的对阵，样本给确定的值，不跑真正的对战 */
function recorder(): { runner: Runner; jobs: Job[] } {
  const jobs: Job[] = [];
  return {
    jobs,
    runner: { run: async js => js.map(j => (jobs.push(j), j.seeds.map((_, i) => ({ adv: JSON.stringify(j.a).length / 1000 + i / 100, wins: 0, secs: 0 })))), close() {} },
  };
}

describe('兵力占用核对：Measurer.force', () => {
  const size = refForce(1000);

  it('每个原型各出一行（含直射器械），近战步兵为基准；直射器械加的人数按被顶替的器械位人数算，且那个位置整个换成直射器械基准', async () => {
    const { runner, jobs } = recorder();
    const rows = await new Measurer(runner).force({ size, n: 2 });
    expect(rows.map(r => r.arch)).toEqual(['inf', 'ranged', 'cav', 'cavr', 'siege', 'vehicle', 'bolt']);
    expect(rows[0].ratio).toBeCloseTo(1, 12);
    const siegeCount = refCounts(size).siege;
    const add = Math.max(3, Math.ceil(0.3 * siegeCount));
    expect(siegeCount).toBeGreaterThan(10);
    const bolt = rows.find(r => r.arch === 'bolt')!;
    expect(bolt.added).toBe(add);
    expect(bolt.row.label).toBe(`bolt:add=${add}`);
    expect(jobs.map(j => j.a)).toContainEqual({ type: 'ref', size, slots: { siege: { unit: BASE.bolt.key, add } } });
    // 参照组是器械位换成直射器械基准、不加人的那支
    expect(jobs.map(j => j.a)).toContainEqual({ type: 'ref', size, slots: { siege: { unit: BASE.bolt.key } } });
    // 抛射器械照旧：在标准混编军上加人，不换兵种
    const siege = rows.find(r => r.arch === 'siege')!;
    expect(siege.row.label).toBe(`siege:add=${siege.added}`);
    expect(jobs.map(j => j.a)).toContainEqual({ type: 'ref', size, slots: { siege: { add: siege.added } } });
    for (const a of ARCHETYPES) expect(rows.some(r => r.arch === a.key), a.key).toBe(true);
  });
});

/**
 * 假运行器：不跑对战，样本由对阵与种子序号算出（与派发的分段无关，前缀一致）。
 * 基础优势按双方全军生命级数之差算（每级 0.05，所以当地斜率是 0.05），extra 再按军队与种子序号叠加
 */
function fake(extra: (a: ArmySpec, i: number) => number = () => 0, perLevel = 0.05): { runner: Runner; jobs: Job[]; seedsOf: (pred: (j: Job) => boolean) => number[] } {
  const jobs: Job[] = [];
  const lv = (s: ArmySpec): number => (s.type === 'ref' ? s.all?.hp ?? 0 : 0);
  return {
    jobs,
    seedsOf: pred => jobs.filter(pred).flatMap(j => j.seeds),
    runner: {
      run: async js => js.map(j => (jobs.push(j), j.seeds.map(seed => ({ adv: perLevel * (lv(j.a) - lv(j.b)) + extra(j.a, (seed - 101) / 37), wins: 0, secs: 0 })))),
      close() {},
    },
  };
}

describe('Measurer.versus：按前缀取样本与续打', () => {
  const a = refSpec(30), b = refSpec(30, { hp: -6 });
  const idx = (seed: number) => (seed - 101) / 37;
  const mk = () => fake((s, i) => i / 100);
  const expected = (n: number): number[] => seedList(0, n).map(s => 0.3 + idx(s) / 100);
  const same = (got: number[], want: number[]): void => {
    expect(got.length).toBe(want.length);
    got.forEach((x, i) => expect(x).toBeCloseTo(want[i], 12));
  };

  it('要前 n 组：只派种子表的前 n 个种子，样本与种子同序', async () => {
    const f = mk();
    const r = await new Measurer(f.runner).versus(a, b, 5);
    expect(f.jobs.map(j => j.seeds)).toEqual([seedList(0, 5)]);
    same(r.advs, expected(5));
    expect(r.stat.n).toBe(5);
  });

  it('先要 16 组再要 32 组：第二次只派 seedList(16, 16)，两次结果的前缀一致', async () => {
    const f = mk();
    const m = new Measurer(f.runner);
    const r16 = await m.versus(a, b, 16);
    const r32 = await m.versus(a, b, 32);
    expect(f.jobs.map(j => j.seeds)).toEqual([seedList(0, 16), seedList(16, 16)]);
    expect(r16.advs.length).toBe(16);
    expect(r32.advs.length).toBe(32);
    expect(r32.advs.slice(0, 16)).toEqual(r16.advs);
    same(r32.advs, expected(32));
    expect(r32.stat.n).toBe(32);
  });

  it('要更少的、或同样多的不再派，返回前缀', async () => {
    const f = mk();
    const m = new Measurer(f.runner);
    const r32 = await m.versus(a, b, 32);
    const r10 = await m.versus(a, b, 10);
    const again = await m.versus(a, b, 32);
    expect(f.jobs.length).toBe(1);
    expect(r10.advs).toEqual(r32.advs.slice(0, 10));
    expect(r10.stat.n).toBe(10);
    expect(again.advs).toEqual(r32.advs);
  });

  it('不同的对阵各打各的，不共用缓存', async () => {
    const f = mk();
    const m = new Measurer(f.runner);
    await m.versus(a, b, 4);
    await m.versus(a, refSpec(30, { hp: -3 }), 4);
    await m.versus(refSpec(30, { hp: 1 }), b, 4);
    expect(f.jobs.map(j => j.seeds)).toEqual([seedList(0, 4), seedList(0, 4), seedList(0, 4)]);
  });

  it('不等前一次打完就续要：同时发出的几次请求，每个种子只派一次，结果都按各自的 n 取前缀', async () => {
    const f = mk();
    const m = new Measurer(f.runner);
    const [r8, r32, r16] = await Promise.all([m.versus(a, b, 8), m.versus(a, b, 32), m.versus(a, b, 16)]);
    expect(f.jobs.flatMap(j => j.seeds)).toEqual(seedList(0, 32));
    expect(r8.advs.length).toBe(8);
    expect(r16.advs.length).toBe(16);
    expect(r32.advs.length).toBe(32);
    expect(r32.advs.slice(0, 8)).toEqual(r8.advs);
    expect(r32.advs.slice(0, 16)).toEqual(r16.advs);
  });

  it('versusAll：每个对阵都取前 n 组，结果与输入同序', async () => {
    const f = mk();
    const out = await new Measurer(f.runner).versusAll([{ a, b }, { a: refSpec(30, { hp: 2 }), b }], 3);
    expect(out.map(r => r.advs.length)).toEqual([3, 3]);
    expect(out[1].advs[0]).toBeCloseTo(0.05 * 8, 12);
    expect(f.jobs.every(j => j.seeds.join() === seedList(0, 3).join())).toBe(true);
  });

  it('标尺与循环赛按样本数 n 取种子表的前 n 组', async () => {
    const f = mk();
    const m = new Measurer(f.runner);
    const rows = await m.ladder([-3, 3], { size: 30, n: 4 });
    expect(rows.map(r => r.n)).toEqual([4, 4]);
    expect(f.jobs.map(j => j.seeds)).toEqual([seedList(0, 4), seedList(0, 4)]);
  });
});

describe('Measurer.points：序贯检验分批', () => {
  const size = 30;
  const withAdd = (add: number): ArmySpec => ({ type: 'ref', size, slots: { inf: { add } } });
  const addOf = (s: ArmySpec): number => (s.type === 'ref' ? s.slots?.inf?.add ?? 0 : 0);
  const isTest = (j: Job): boolean => addOf(j.a) > 0;
  /** 被测军队只派了前 used 组；参照组（缺省标准混编军）对让级对手与斜率的两个对阵，各自派满 cap 组 */
  const expectSharedFull = (f: ReturnType<typeof fake>, cap: number, used: number, test: ArmySpec = withAdd(5)): void => {
    const per = new Map<string, number[]>();
    for (const j of f.jobs) per.set(JSON.stringify([j.a, j.b]), [...(per.get(JSON.stringify([j.a, j.b])) ?? []), ...j.seeds]);
    const opp = refSpec(size, { hp: -6 });
    expect(per.get(JSON.stringify([refSpec(size), opp]))).toEqual(seedList(0, cap));
    expect(per.get(JSON.stringify([refSpec(size, { hp: 3 }), opp]))).toEqual(seedList(0, cap));
    expect(per.get(JSON.stringify([refSpec(size, { hp: -3 }), opp]))).toEqual(seedList(0, cap));
    if (JSON.stringify(test) !== JSON.stringify(refSpec(size))) expect(per.get(JSON.stringify([test, opp]))).toEqual(seedList(0, used));
    expect(per.size).toBe(JSON.stringify(test) === JSON.stringify(refSpec(size)) ? 3 : 4);
  };

  it('被测军队比参照组强得多：第一批不因显著而停，上限 96 时打到 48 组（一半）才 sig 停，被测军队只派了前 48 组，参照组与斜率派满上限', async () => {
    // 每个种子有一点不同的小波动，配对差的均值远大于标准误
    const f = fake((s, i) => (addOf(s) ? 0.1 + ((i * 7) % 5) / 1000 : 0));
    const row = await new Measurer(f.runner).points('count', 'x', withAdd(5), size, 96);
    expect(row.stop).toBe('sig');
    expect(row.n).toBe(48);
    expect(row.significant).toBe(true);
    expect(row.delta!).toBeGreaterThan(0.09);
    expect(row.slope).toBeCloseTo(0.05, 12);
    expect(row.points!).toBeCloseTo(row.delta! / 0.05, 12);
    expectSharedFull(f, 96, 48);
    expect(f.jobs.filter(isTest).map(j => j.seeds)).toEqual([seedList(0, 16), seedList(16, 16), seedList(32, 16)]);
  });

  it('上限 48 时同样的强差距到 32 组（t ≥ 0.5 的第一批）sig 停', async () => {
    const f = fake((s, i) => (addOf(s) ? 0.1 + ((i * 7) % 5) / 1000 : 0));
    const row = await new Measurer(f.runner).points('count', 'x', withAdd(5), size, 48);
    expect(row.stop).toBe('sig');
    expect(row.n).toBe(32);
    expectSharedFull(f, 48, 32);
  });

  it('配对差全相同（标准误为 0）且均值非 0：16 组就 sig 停，不受一半之前不因显著而停的限制', async () => {
    // 每级 0.0625、增量 0.125 都能精确表示，浮点没有舍入误差，配对差逐个完全相等，标准误才是精确的 0
    const f = fake(s => (addOf(s) ? 0.125 : 0), 0.0625);
    const row = await new Measurer(f.runner).points('count', 'x', withAdd(5), size, 96);
    expect(row.stop).toBe('sig');
    expect(row.n).toBe(16);
    expectSharedFull(f, 96, 16);
  });

  it('被测军队与参照组完全相同：16 组就不显著即停，stop 是 futile，增量为 0、不显著，参照组与斜率派满上限', async () => {
    const f = fake();
    const row = await new Measurer(f.runner).points('count', 'x', refSpec(size), size, 96);
    expect(row.stop).toBe('futile');
    expect(row.n).toBe(16);
    expect(row.delta).toBe(0);
    expect(row.points).toBe(0);
    expect(row.significant).toBe(false);
    // 被测军队就是参照组：不另派，与参照组共用同一份样本
    expectSharedFull(f, 96, 16, refSpec(size));
  });

  it('上限不到 16 组：一次打满，stop 是 cap，n 等于上限', async () => {
    const f = fake((s, i) => (addOf(s) ? 0.1 + ((i * 7) % 5) / 1000 : 0));
    const row = await new Measurer(f.runner).points('count', 'x', withAdd(5), size, 2);
    expect(row.stop).toBe('cap');
    expect(row.n).toBe(2);
    expect(f.jobs.every(j => j.seeds.join() === seedList(0, 2).join())).toBe(true);
  });

  it('拿不准的样本一批批续打到上限：n 到上限、stop 是 cap，每一批续打的种子接着前一批，不重复派', async () => {
    // 配对差在 ±1 间交替、均值 0.3：z 一直不够显著、功效也不低，打到 48 组才停
    const f = fake((s, i) => (addOf(s) ? 0.003 + (i % 2 ? 0.01 : -0.01) : 0));
    const row = await new Measurer(f.runner).points('count', 'x', withAdd(5), size, 48);
    expect(row.stop).toBe('cap');
    expect(row.n).toBe(48);
    expect(f.jobs.filter(isTest).map(j => j.seeds)).toEqual([seedList(0, 16), seedList(16, 16), seedList(32, 16)]);
    // 参照组、对手、斜率用的也是同样的前 n 组：每个对阵派出的种子合起来正好是前 48 个
    const byArmy = new Map<string, number[]>();
    for (const j of f.jobs) byArmy.set(JSON.stringify([j.a, j.b]), [...(byArmy.get(JSON.stringify([j.a, j.b])) ?? []), ...j.seeds]);
    for (const seeds of byArmy.values()) expect(seeds).toEqual(seedList(0, 48));
  });

  it('提前停下时，行里的统计用的就是停下时的前 n 组', async () => {
    const f = fake((s, i) => (addOf(s) ? 0.1 + ((i * 7) % 5) / 1000 : 0));
    const m = new Measurer(f.runner);
    const row = await m.points('count', 'x', withAdd(5), size, 96);
    const direct = await m.versus(withAdd(5), refSpec(size, { hp: -6 }), row.n);
    expect(row.adv).toBeCloseTo(direct.stat.mean, 12);
    expect(row.advSe).toBeCloseTo(direct.stat.se, 12);
  });
});
