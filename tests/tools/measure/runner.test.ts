import { describe, expect, it } from 'vitest';
import { buildArmy, refSpec } from '../../../tools/measure/army';
import { sample } from '../../../tools/measure/battle';
import { inProcessRunner, runJob } from '../../../tools/measure/runner';
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
