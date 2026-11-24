import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { POSITIONS } from '../../../src/sim/defs';
import { Measurer, Row } from '../../../tools/measure/measure';
import { MANPOWER_PROBE, measurePrices, priceJobs, pricedTraits } from '../../../tools/measure/price';
import { Job, Runner } from '../../../tools/measure/runner';
import { PRICE_ROWS_FILE } from '../../../tools/measure/unitpoints';

/** 记下派出的对阵，样本给确定的值，不跑真正的对战 */
function recorder(): { runner: Runner; jobs: Job[] } {
  const jobs: Job[] = [];
  return {
    jobs,
    runner: { run: async js => js.map(j => (jobs.push(j), j.seeds.map((_, i) => ({ adv: JSON.stringify(j.a).length / 1000 + i / 100, wins: 0, secs: 0 })))), close() {} },
  };
}
const opts = { size: 60, n: 2 };
const labelsOf = (m: Measurer): string[] => priceJobs(m, opts).map(j => j.label);

describe('价目表的测量清单：priceJobs', () => {
  const m = new Measurer(recorder().runner);
  const labels = labelsOf(m);

  it('标签不重复；每个位置的每个开放维度都在清单上，级数按规程（生命 ±8、节奏 ±4、护甲 +4 与 −3、破甲只量 +8）', () => {
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels).toEqual(expect.arrayContaining(['inf:hp=8', 'inf:hp=-8', 'siege:cad=4', 'siege:cad=-4', 'cav:armM=4', 'cav:armM=-3', 'siege:pen=8', 'siege:splash=4', 'siege:splash=-15']));
    expect(labels).not.toContain('siege:pen=null');
    for (const pos of Object.keys(POSITIONS)) expect(labels.some(l => l.startsWith(`${pos}:hp=`)), pos).toBe(true);
    expect(labels).toContain(`manpower:+${MANPOWER_PROBE}`);
  });

  it('直射器械：各开放维度加减各一格（破甲只量加级）与重弩特性，共 18 格，没有范围杀伤', () => {
    const bolt = labels.filter(l => l.startsWith('bolt:'));
    expect(bolt.sort()).toEqual([
      'bolt:+ballista',
      'bolt:armM=-3', 'bolt:armM=4', 'bolt:armP=-3', 'bolt:armP=4',
      'bolt:cad=-4', 'bolt:cad=4',
      'bolt:disc=-8', 'bolt:disc=8',
      'bolt:hp=-8', 'bolt:hp=8',
      'bolt:out=-8', 'bolt:out=8',
      'bolt:pen=8',
      'bolt:rng=-4', 'bolt:rng=4',
      'bolt:spd=-4', 'bolt:spd=4',
    ].sort());
  });

  it('抛射器械不再量重弩与穿刺攻击（没有兵种带），要量的特性都是某个位置里有兵种带的', () => {
    expect(labels).not.toContain('siege:+ballista');
    expect(labels).not.toContain('siege:+pierce');
    expect(pricedTraits()).toContainEqual({ slot: 'bolt', trait: 'ballista' });
    for (const { slot, trait } of pricedTraits()) expect(labels, `${slot}:+${trait}`).toContain(`${slot}:+${trait}`);
  });

  it('每格的标签就是跑出来的行的标签（抽测与沿用旧测量都按标签对应）', async () => {
    for (const j of priceJobs(m, opts)) expect((await j.run()).label, j.label).toBe(j.label);
  });

  it('提交的价目测量恰好覆盖清单：每格都有，没有多出已不在清单上的旧格（如 siege:+pierce）', () => {
    const rows = (JSON.parse(readFileSync(PRICE_ROWS_FILE, 'utf8')) as { rows: Row[] }).rows;
    expect(rows.map(r => r.label).sort()).toEqual([...labels].sort());
  });
});

describe('重量价目表：沿用旧测量（measurePrices 的 done）', () => {
  const stub = (label: string): Row => ({ kind: 'dim', label, size: 1, n: 1, adv: 0, advSe: 0, win: 0, points: 0, significant: false });

  it('done 里已有的格不再量，其余才派对战；结果与清单同序，沿用的就是原来那一行', async () => {
    const { runner, jobs } = recorder();
    const m = new Measurer(runner);
    const labels = labelsOf(m);
    const fresh = 'bolt:+ballista';
    const done = labels.filter(l => l !== fresh).map(stub);
    const seen: string[] = [];
    const out = await measurePrices(m, r => seen.push(r.label), done, opts);
    expect(out.map(r => r.label)).toEqual(labels);
    expect(seen).toEqual([fresh]);
    expect(jobs.length).toBeGreaterThan(0);
    // 只有新增的那格派了对战：被测军队里把器械位换成了直射器械并加了重弩
    expect(jobs.some(j => JSON.stringify(j.a).includes('ballista'))).toBe(true);
    for (const r of out) if (r.label !== fresh) expect(r).toBe(done.find(x => x.label === r.label));
  });

  it('done 里不在清单上的行丢掉；done 里什么都没有时全部现量', async () => {
    const { runner } = recorder();
    const m = new Measurer(runner);
    const labels = labelsOf(m);
    const all = labels.map(stub);
    const out = await measurePrices(m, undefined, [...all, stub('siege:+pierce')], opts);
    expect(out.map(r => r.label)).toEqual(labels);
    expect(out.length).toBe(all.length);
    for (const r of out) expect(r).toBe(all.find(x => x.label === r.label));
    const seen: string[] = [];
    const rec = recorder();
    const full = await measurePrices(new Measurer(rec.runner), r => seen.push(r.label), [], opts);
    expect(seen.sort()).toEqual([...labels].sort());
    expect(full.map(r => r.label)).toEqual(labels);
  });
});
