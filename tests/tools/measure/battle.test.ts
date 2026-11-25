import { describe, expect, it } from 'vitest';
import { buildArmy, refSpec } from '../../../tools/measure/army';
import { DECIDED, PROTOCOL, battle, decidedWinner } from '../../../tools/measure/battle';
import { seedList } from '../../../tools/measure/stats';

describe('胜负已分：decidedWinner', () => {
  it('败方不超过 0.05 且胜方至少是败方 4 倍：返回胜方（1 是 fa，2 是 fb）', () => {
    expect(decidedWinner(0.5, 0.04)).toBe(1);
    expect(decidedWinner(0.04, 0.5)).toBe(2);
    expect(decidedWinner(1, 0.01)).toBe(1);
    expect(decidedWinner(0.01, 1)).toBe(2);
  });

  it('恰好 0.05、恰好 4 倍都算已分', () => {
    expect(decidedWinner(0.2, 0.05)).toBe(1);
    expect(decidedWinner(0.05, 0.2)).toBe(2);
    expect(decidedWinner(0.04, 0.16)).toBe(2);
  });

  it('败方刚过 0.05，或胜方刚不到 4 倍：未分', () => {
    expect(decidedWinner(1, 0.0501)).toBe(0);
    expect(decidedWinner(0.0501, 1)).toBe(0);
    expect(decidedWinner(0.19, 0.05)).toBe(0);
    expect(decidedWinner(0.05, 0.19)).toBe(0);
    expect(decidedWinner(0.039, 0.01)).toBe(0);
  });

  it('败方为 0、胜方大于 0 算已分，胜方再小也算', () => {
    expect(decidedWinner(0.3, 0)).toBe(1);
    expect(decidedWinner(0, 0.3)).toBe(2);
    expect(decidedWinner(0.0001, 0)).toBe(1);
    expect(decidedWinner(0, 0.0001)).toBe(2);
  });

  it('双方都为 0 不算已分；双方相等不算已分', () => {
    expect(decidedWinner(0, 0)).toBe(0);
    expect(decidedWinner(0.3, 0.3)).toBe(0);
    expect(decidedWinner(0.01, 0.01)).toBe(0);
    expect(decidedWinner(1, 1)).toBe(0);
  });

  it('规程常量：每秒判一次，败方不超过 0.05，胜方至少 4 倍', () => {
    expect(DECIDED).toEqual({ every: 1, loserMax: 0.05, ratio: 4 });
  });
});

describe('胜负已分：battle 收兵', () => {
  const grid = [
    { size: 20, hp: -6 },
    { size: 20, hp: 3 },
    { size: 8, hp: 0 },
  ];
  const seeds = seedList(0, 4);

  it('提前收兵：败方记 0、胜方非 0，adv 符号与胜方一致，没到时间上限；没提前收兵：一方死光或时间到', () => {
    let early = 0;
    for (const g of grid) {
      const a = buildArmy(refSpec(g.size)), b = buildArmy(refSpec(g.size, { hp: g.hp }));
      for (const seed of seeds) {
        const r = battle(a, b, seed);
        const tag = `${g.size}/${g.hp}/${seed}`;
        expect(r.fa, tag).toBeGreaterThanOrEqual(0);
        expect(r.fb, tag).toBeGreaterThanOrEqual(0);
        expect(r.adv, tag).toBeCloseTo(r.fa - r.fb, 12);
        expect(r.secs, tag).toBeGreaterThan(0);
        expect(r.secs, tag).toBeLessThanOrEqual(PROTOCOL.maxSecs);
        if (r.early) {
          early++;
          expect(Math.min(r.fa, r.fb), tag).toBe(0);
          expect(Math.max(r.fa, r.fb), tag).toBeGreaterThan(0);
          expect(Math.sign(r.adv), tag).toBe(r.fa > 0 ? 1 : -1);
          expect(r.secs, tag).toBeLessThan(PROTOCOL.maxSecs);
        } else {
          expect(r.fa === 0 || r.fb === 0 || r.secs === PROTOCOL.maxSecs, tag).toBe(true);
        }
      }
    }
    // 悬殊的对阵必然会提前收兵
    expect(early).toBeGreaterThan(0);
  }, 120000);

  it('生命差 6 级的对阵：强的一方赢、提前收兵，弱的一方记 0', () => {
    const strong = buildArmy(refSpec(20)), weak = buildArmy(refSpec(20, { hp: -6 }));
    const r = battle(strong, weak, seedList(0, 1)[0]);
    expect(r.early).toBe(true);
    expect(r.fb).toBe(0);
    expect(r.fa).toBeGreaterThan(0);
    expect(r.adv).toBe(r.fa);
    const flip = battle(weak, strong, seedList(0, 1)[0]);
    expect(flip.early).toBe(true);
    expect(flip.fa).toBe(0);
    expect(flip.fb).toBeGreaterThan(0);
    expect(flip.adv).toBe(-flip.fb);
  }, 60000);

  it('同样的军队与种子，结果完全一致（含 early）', () => {
    const a = buildArmy(refSpec(20)), b = buildArmy(refSpec(20, { hp: -6 }));
    expect(battle(a, b, 138)).toEqual(battle(a, b, 138));
  }, 60000);
});
