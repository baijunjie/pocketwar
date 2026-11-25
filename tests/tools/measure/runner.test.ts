import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildArmy, refSpec } from '../../../tools/measure/army';
import { sample } from '../../../tools/measure/battle';
import { bundleWorker, defaultWorkers, inProcessRunner, readPerfCores, runJob } from '../../../tools/measure/runner';
import { seedList } from '../../../tools/measure/stats';

describe('测量工具：对阵的运行', () => {
  const job = { a: refSpec(20), b: refSpec(20, { hp: -3 }), seeds: seedList(0, 2) };

  it('一个对阵的样本与种子同序，每个样本等于单独打那个种子', () => {
    const got = runJob(job);
    expect(got.length).toBe(2);
    const a = buildArmy(job.a), b = buildArmy(job.b);
    job.seeds.forEach((s, i) => expect(got[i]).toEqual(sample(a, b, s)));
  });

  it('没有种子时样本为空', () => {
    expect(runJob({ ...job, seeds: [] })).toEqual([]);
  });

  it('单进程运行器：结果与输入同序，没有对阵时返回空', async () => {
    const r = inProcessRunner();
    const other = { a: refSpec(20, { hp: 3 }), b: refSpec(20), seeds: seedList(5, 1) };
    const out = await r.run([job, other]);
    expect(out).toEqual([runJob(job), runJob(other)]);
    expect(await r.run([])).toEqual([]);
    r.close();
  });
});

describe('测量工具：缺省的工作进程数', () => {
  const logical = () => 12;

  it('读得到性能核数就取性能核数', () => {
    expect(defaultWorkers(() => 8, logical)).toBe(8);
    expect(defaultWorkers(() => 1, logical)).toBe(1);
  });

  it('读不到性能核数（undefined）时回退到逻辑核数', () => {
    expect(defaultWorkers(() => undefined, logical)).toBe(12);
  });

  it('读到的不是正整数（0、负数、NaN、小数、无穷）时回退到逻辑核数', () => {
    for (const bad of [0, -4, NaN, 4.5, Infinity]) {
      expect(defaultWorkers(() => bad, logical)).toBe(12);
    }
  });

  it('结果至少为 1：逻辑核数异常（0、负数、NaN）时也返回 1', () => {
    for (const bad of [0, -2, NaN]) {
      expect(defaultWorkers(() => undefined, () => bad)).toBe(1);
    }
    expect(defaultWorkers(() => NaN, () => 0)).toBe(1);
  });

  it('性能核数有效时不受逻辑核数影响', () => {
    expect(defaultWorkers(() => 6, () => 0)).toBe(6);
    expect(defaultWorkers(() => 6, () => NaN)).toBe(6);
  });

  it('读性能核数：读不到返回 undefined，读到返回正整数', () => {
    const got = readPerfCores();
    if (got !== undefined) {
      expect(Number.isInteger(got)).toBe(true);
      expect(got).toBeGreaterThan(0);
    }
  });

  it('不传参数时用本机数据，结果是正整数', () => {
    const n = defaultWorkers();
    expect(Number.isInteger(n)).toBe(true);
    expect(n).toBeGreaterThanOrEqual(1);
  });
});

describe('测量工具：打包文件的清理（bundleWorker）', () => {
  const dir = fileURLToPath(new URL('../../../tools/measure/out/', import.meta.url));
  /** 一定不存在的进程号（超出常见系统的进程号上限，kill 0 号信号报 ESRCH） */
  const DEAD = 2 ** 31 - 2;

  it('打包前删掉进程已不在的旧打包文件；本进程的、不匹配命名的文件不动；产出本进程的打包文件', () => {
    mkdirSync(dir, { recursive: true });
    const mine = [
      `worker-${DEAD}-0.mjs`, `worker-${DEAD}-37.mjs`, // 进程不在：删
      `worker-${process.pid}-99999.mjs`, // 本进程：留
      `worker-${DEAD}-0.txt`, `worker-x-0.mjs`, `other-${DEAD}-0.mjs`, `worker-${DEAD}.mjs`, // 不匹配命名：留
    ];
    let out = '';
    try {
      for (const f of mine) writeFileSync(dir + f, '// 测试造的假文件\n');
      out = bundleWorker();
      expect(out.startsWith(dir)).toBe(true);
      expect(out).toMatch(new RegExp(`worker-${process.pid}-\\d+\\.mjs$`));
      expect(existsSync(out)).toBe(true);
      expect(existsSync(dir + mine[0])).toBe(false);
      expect(existsSync(dir + mine[1])).toBe(false);
      for (const f of mine.slice(2)) expect(existsSync(dir + f), f).toBe(true);
    } finally {
      for (const f of mine) rmSync(dir + f, { force: true });
      if (out) rmSync(out, { force: true });
    }
  }, 60000);
});
