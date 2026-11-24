import { describe, expect, it } from 'vitest';
import { ARCHETYPES } from '../../../src/sim/defs';
import { Measurer } from '../../../tools/measure/measure';
import { Job, Runner } from '../../../tools/measure/runner';
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
