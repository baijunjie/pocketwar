import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { POSITIONS, UNITS } from '../src/sim/defs';
import { ArmySpec, buildArmy, refSpec } from '../tools/measure/army';
import { battle, sample } from '../tools/measure/battle';
import { Measurer } from '../tools/measure/measure';
import { Job, Runner, inProcessRunner, poolRunner } from '../tools/measure/runner';
import { pairedDiff, seedList, significant, stat, withinSe } from '../tools/measure/stats';
import { BASE, REF_SHARE, STEP, proxySlots, refForce, slotOf, variant } from '../tools/measure/units';

describe('对战测量：军队与变体', () => {
  it('标准混编军按位置表混编基准单位，规模按兵力份数计（100 人的标准混编军是 refForce(100) 份）', () => {
    const army = buildArmy(refSpec(refForce(100)));
    expect(army.length).toBe(100);
    const count = (key: string) => army.filter(i => i === BASE[key].idx).length;
    for (const [slot, share] of Object.entries(REF_SHARE)) expect(count(slot)).toBe(Math.max(1, Math.round(100 * share)));
  });

  it('位置可以加人、换兵种、加减级数', () => {
    const base = buildArmy(refSpec(refForce(100)));
    const more = buildArmy({ type: 'ref', size: refForce(100), slots: { inf: { add: 5 } } });
    expect(more.length).toBe(base.length + 5);
    const swapped = buildArmy({ type: 'ref', size: refForce(100), slots: { inf: { unit: 'samurai' } } });
    expect(swapped.some(i => UNITS[i].key === 'samurai')).toBe(true);
    const leveled = buildArmy(refSpec(refForce(100), { hp: 3 }));
    const hpOf = (army: number[], key: string) => UNITS[army.find(i => UNITS[i].key.startsWith(`base_${key}`))!].hp;
    expect(hpOf(base, 'inf')).toBe(BASE.inf.hp);
    expect(UNITS[leveled[0]].hp).toBe(Math.round(BASE.inf.hp * STEP.hp ** 3));
  });

  it('变体按阶梯步长算，同一兵种同一组级数只造一次', () => {
    const v = variant(BASE.inf, { hp: 4, out: 2, cad: 1, armM: 2 });
    expect(v.hp).toBe(Math.round(BASE.inf.hp * STEP.hp ** 4));
    expect(v.main.lvCd[0]).toBeCloseTo((BASE.inf.main.lvCd[0] * STEP.cad) / STEP.out ** 2);
    expect(v.main.lvDmg[0]).toBeCloseTo(BASE.inf.main.lvDmg[0] * STEP.cad);
    expect(v.armM).toBe(BASE.inf.armM + 2);
    const n = UNITS.length;
    expect(variant(BASE.inf, { hp: 4, out: 2, cad: 1, armM: 2 })).toBe(v);
    expect(UNITS.length).toBe(n);
  });

  it('变体的等级展开、索敌距离随面板重算；加特性时合入标签与克制', () => {
    const v = variant(BASE.ranged, { hp: 4, rng: 2 });
    expect(v.lvHp[0]).toBe(v.hp);
    expect(v.lvHp[0]).toBeGreaterThan(BASE.ranged.lvHp[0]);
    expect(v.main.range).toBeGreaterThan(BASE.ranged.main.range);
    expect(v.acq).toBe(v.main.range + 40);
    const t = variant(BASE.inf, {}, ['naginata']);
    expect(t.vs[BASE.cav.idx]).toBeGreaterThan(BASE.inf.vs[BASE.cav.idx]);
  });

  it('每个基准单位都不带兵种特有的特性与点数', () => {
    for (const d of Object.values(BASE)) {
      expect(d.discipline).toBe(0);
      expect(d.main.pen).toBe(0);
      expect(d.aux).toBeNull();
    }
  });
});

describe('对战测量：对战与统计', () => {
  const a = buildArmy(refSpec(24)), b = buildArmy(refSpec(24, { hp: -4 }));

  it('同一对阵同一种子，结果完全一致', () => {
    expect(battle(a, b, 101)).toEqual(battle(a, b, 101));
    expect(sample(a, b, 138)).toEqual(sample(a, b, 138));
  });

  it('统计函数', () => {
    expect(seedList(0, 3)).toEqual([101, 138, 175]);
    const s = stat([1, 2, 3, 4]);
    expect(s.mean).toBe(2.5);
    expect(s.se).toBeCloseTo(Math.sqrt(1.6667 / 4), 3);
    expect(pairedDiff([3, 4, 5], [1, 2, 3])).toMatchObject({ mean: 2, se: 0 });
    expect(significant({ mean: 0.05, se: 0.03 })).toBe(false);
    expect(significant({ mean: 0.07, se: 0.03 })).toBe(true);
    expect(withinSe({ mean: 0.1, se: 0.01, n: 5 }, { mean: 0.13, se: 0.01 })).toBe(true);
    expect(withinSe({ mean: 0.1, se: 0.01, n: 5 }, { mean: 0.2, se: 0.01 })).toBe(false);
  });
});

describe('对战测量：测量冒烟', () => {
  const opts = { size: 30, n: 2 };

  it('标尺随全军生命单调上升；维度测量给出点数、斜率与显著性标注', async () => {
    const m = new Measurer(inProcessRunner());
    const [lo, hi] = await m.ladder([-12, 12], opts);
    expect(hi.adv).toBeGreaterThan(lo.adv);
    const r = await m.dimension('inf', { hp: 8 }, opts);
    expect(r.slope).toBeGreaterThan(0);
    expect(Number.isFinite(r.points)).toBe(true);
    expect(typeof r.significant).toBe('boolean');
  }, 60000);

  it('兵种测量、人数测量、阵营测量、循环赛都能跑通', async () => {
    const m = new Measurer(inProcessRunner());
    expect((await m.unit('inf', 'samurai', opts)).label).toBe('inf:samurai');
    expect((await m.count('inf', 2, opts)).kind).toBe('count');
    expect((await m.faction('china', opts)).kind).toBe('faction');
    const rr = await m.roundRobin({ ...opts, factions: ['china', 'japan', 'rome'] });
    expect(rr.filter(r => r.kind === 'roundrobin').length).toBe(3);
    expect(rr.filter(r => r.kind === 'rr-mean').length).toBe(3);
  }, 120000);

  it('多进程与单进程的结果逐样本一致', async () => {
    const job = { a: refSpec(24), b: refSpec(24, { hp: -4 }), seeds: seedList(0, 5) };
    const [single] = await inProcessRunner().run([job]);
    const pool = poolRunner(2);
    try {
      const [multi] = await pool.run([job]);
      expect(multi).toEqual(single);
    } finally {
      pool.close();
    }
  }, 120000);
});

describe('对战测量：顶替别的位置的位置（直射器械顶替器械位）', () => {
  /** 记下派出的对阵，样本按被测一方的军队给一个确定的值：参照组与被测军队相同时增量为 0 */
  function recorder(): { runner: Runner; jobs: Job[] } {
    const jobs: Job[] = [];
    const advOf = (a: ArmySpec): number => JSON.stringify(a).length / 1000;
    return {
      jobs,
      runner: { run: async js => js.map(j => (jobs.push(j), j.seeds.map((_, i) => ({ adv: advOf(j.a) + i / 100, wins: 0, secs: 0 })))), close() {} },
    };
  }
  const size = refForce(300);

  it('直射器械的位置顶替标准混编军的器械位，不进标准混编军的人数构成', () => {
    expect(POSITIONS.bolt.ref).toBe('siege');
    expect(slotOf('bolt')).toBe('siege');
    expect(slotOf('siege')).toBe('siege');
    expect(Object.keys(REF_SHARE)).not.toContain('bolt');
    expect(proxySlots('bolt')).toEqual({ siege: { unit: BASE.bolt.key } });
    expect(proxySlots('inf')).toEqual({});
  });

  it('维度、特性、兵种测量：被测军队把器械位整个换成直射器械再改，参照组是只换不改的那支，人数与器械位相同', async () => {
    const { runner, jobs } = recorder();
    const m = new Measurer(runner);
    const ref = { type: 'ref', size, slots: { siege: { unit: BASE.bolt.key } } };
    const dim = await m.dimension('bolt', { hp: 8 }, { size, n: 2 });
    expect(dim.label).toBe('bolt:hp=8');
    expect(dim.meta).toEqual({ slot: 'bolt', levels: { hp: 8 } });
    const as = jobs.map(j => j.a);
    expect(as).toContainEqual({ type: 'ref', size, slots: { siege: { unit: BASE.bolt.key, levels: { hp: 8 } } } });
    expect(as).toContainEqual(ref);
    // 被测军队与标准混编军人数相同，器械位上全是直射器械基准的变体
    const test = buildArmy({ type: 'ref', size, slots: { siege: { unit: BASE.bolt.key, levels: { hp: 8 } } } });
    expect(test.length).toBe(buildArmy(refSpec(size)).length);
    expect(test.filter(i => UNITS[i].key.startsWith(`${BASE.bolt.key}|`)).length).toBe(buildArmy(refSpec(size)).filter(i => i === BASE.siege.idx).length);
    jobs.length = 0;
    await m.trait('bolt', 'ballista', { size, n: 2 });
    expect(jobs.map(j => j.a)).toContainEqual({ type: 'ref', size, slots: { siege: { unit: BASE.bolt.key, traits: ['ballista'] } } });
    jobs.length = 0;
    const u = await m.unit('bolt', 'scorpio', { size, n: 2 });
    expect(u.label).toBe('bolt:scorpio');
    // 参照组与前面同一支，已经跑过（同一对阵同一批种子只跑一次）
    expect(jobs.map(j => j.a)).toContainEqual({ type: 'ref', size, slots: { siege: { unit: 'scorpio' } } });
  });

  it('基准单位自己量出正好 0 点：参照组就是它', async () => {
    const m = new Measurer(recorder().runner);
    const r = await m.unit('bolt', BASE.bolt.key, { size, n: 2 });
    expect(r.delta).toBe(0);
    expect(Math.abs(r.points!)).toBe(0);
  });

  it('标准混编军本来就有的位置照旧：参照组是标准混编军本身', async () => {
    const { runner, jobs } = recorder();
    await new Measurer(runner).dimension('siege', { hp: 8 }, { size, n: 2 });
    expect(jobs.map(j => j.a)).toEqual(expect.arrayContaining([{ type: 'ref', size, slots: { siege: { levels: { hp: 8 } } } }, refSpec(size)]));
  });

  it('人数测量：加人加在被顶替的位置上，参照组同样换成直射器械；与被顶替的位置同时加人报错', async () => {
    const { runner, jobs } = recorder();
    const m = new Measurer(runner);
    const r = await m.count('bolt', 3, { size, n: 2 });
    expect(r.label).toBe('bolt:add=3');
    expect(jobs.map(j => j.a)).toEqual(expect.arrayContaining([
      { type: 'ref', size, slots: { siege: { unit: BASE.bolt.key, add: 3 } } },
      { type: 'ref', size, slots: { siege: { unit: BASE.bolt.key } } },
    ]));
    expect(() => m.countSlots({ siege: 1, bolt: 1 }, { size, n: 2 })).toThrow('同一个标准混编军位置');
  });
});

describe('对战测量：只是开发工具', () => {
  it('游戏本体（src/）不导入 tools/ 下的模块', () => {
    const files = readdirSync('src', { recursive: true }).filter(f => /\.(ts|js)$/.test(f));
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) expect(readFileSync(`src/${f}`, 'utf8'), f).not.toMatch(/from\s+['"][^'"]*tools\//);
  });
});
