import { describe, expect, it, vi } from 'vitest';
import { ATTACK_COMMIT, BLEND, BLEND_ATTACK, STALE, UnitAnim } from '../../src/render/unitAnim';
import type { Clip } from '../../src/render/rig';

const clip = (start: number, n = 30): Clip => ({ start, n, seconds: n / 30 });
const IDLE = clip(0), RUN = clip(100), ATK = clip(200);

describe('UnitAnim.attackTime', () => {
  it('从没出过手时不在攻击中', () => {
    const a = new UnitAnim(2);
    expect(a.attackTime(0, 0, 5, 0.8, false)).toBe(-1);
    expect(a.attackTime(0, 0, 6, 0.8, true)).toBe(-1);
  });

  it('atkAnim 上升那一刻起计时，之后播满全长，不受 atkAnim 衰减影响', () => {
    const a = new UnitAnim(1);
    expect(a.attackTime(0, 0.3, 10, 0.8, false)).toBeCloseTo(0, 6);
    expect(a.attackTime(0, 0.2, 10.1, 0.8, false)).toBeCloseTo(0.1, 6);
    expect(a.attackTime(0, 0, 10.5, 0.8, false)).toBeCloseTo(0.5, 6);
    expect(a.attackTime(0, 0, 10.79, 0.8, false)).toBeCloseTo(0.79, 6);
  });

  it('播够全长后返回 -1', () => {
    const a = new UnitAnim(1);
    a.attackTime(0, 0.3, 10, 0.8, false);
    expect(a.attackTime(0, 0, 10.81, 0.8, false)).toBe(-1);
    expect(a.attackTime(0, 0, 20, 0.8, false)).toBe(-1);
  });

  it('atkAnim 只是在递减时不会重新计时', () => {
    const a = new UnitAnim(1);
    a.attackTime(0, 0.3, 10, 0.8, false);
    a.attackTime(0, 0.25, 10.05, 0.8, false);
    expect(a.attackTime(0, 0.2, 10.1, 0.8, false)).toBeCloseTo(0.1, 6);
  });

  it('再次出手（atkAnim 重新上升）从头计时', () => {
    const a = new UnitAnim(1);
    a.attackTime(0, 0.3, 10, 0.8, false);
    a.attackTime(0, 0, 10.9, 0.8, false);
    expect(a.attackTime(0, 0.3, 11, 0.8, false)).toBeCloseTo(0, 6);
    expect(a.attackTime(0, 0, 11.4, 0.8, false)).toBeCloseTo(0.4, 6);
  });

  it('上一次还没播完时再次出手也重新计时', () => {
    const a = new UnitAnim(1);
    a.attackTime(0, 0.3, 10, 0.8, false);
    a.attackTime(0, 0.05, 10.25, 0.8, false);
    expect(a.attackTime(0, 0.3, 10.375, 0.8, false)).toBeCloseTo(0, 6);
    expect(a.attackTime(0, 0, 10.625, 0.8, false)).toBeCloseTo(0.25, 6);
  });

  it('出手那一刻就算在攻击中（返回约 0，不是 -1），与时刻的小数无关', () => {
    for (const t of [10.3, 123.456, 1000.1, 5000.7]) {
      const a = new UnitAnim(1);
      expect(a.attackTime(0, 0.3, t, 0.8, false), `t=${t}`).toBeGreaterThanOrEqual(0);
    }
  });

  it('移动时，已播过 ATTACK_COMMIT 秒的攻击被打断', () => {
    const a = new UnitAnim(1);
    a.attackTime(0, 0.3, 10, 0.9, false);
    expect(a.attackTime(0, 0, 10 + ATTACK_COMMIT + 0.01, 0.9, true)).toBe(-1);
    expect(a.attackTime(0, 0, 10.8, 0.9, true)).toBe(-1);
  });

  it('移动时，还没播过 ATTACK_COMMIT 秒的攻击继续播', () => {
    const a = new UnitAnim(1);
    a.attackTime(0, 0.3, 10, 0.9, true);
    expect(a.attackTime(0, 0.2, 10 + ATTACK_COMMIT - 0.01, 0.9, true)).toBeCloseTo(ATTACK_COMMIT - 0.01, 6);
  });

  it('被移动打断后不再续播：就算又停下来，这一段攻击也不会接着播', () => {
    const a = new UnitAnim(1);
    a.attackTime(0, 0.3, 10, 0.9, false);
    expect(a.attackTime(0, 0, 10.5, 0.9, true)).toBe(-1);
    expect(a.attackTime(0, 0, 10.6, 0.9, false)).toBe(-1);
    expect(a.attackTime(0, 0, 10.7, 0.9, false)).toBe(-1);
  });

  it('被打断后再次出手照常从头播', () => {
    const a = new UnitAnim(1);
    a.attackTime(0, 0.3, 10, 0.9, false);
    a.attackTime(0, 0, 10.5, 0.9, true);
    expect(a.attackTime(0, 0.3, 11, 0.9, false)).toBeCloseTo(0, 6);
    expect(a.attackTime(0, 0, 11.25, 0.9, false)).toBeCloseTo(0.25, 6);
  });

  it('出手时就在移动的攻击（边跑边打）不被起步打断：整段播完', () => {
    const a = new UnitAnim(1);
    expect(a.attackTime(0, 0.3, 10, 0.9, true)).toBeCloseTo(0, 6);
    expect(a.attackTime(0, 0.2, 10.2, 0.9, true)).toBeCloseTo(0.2, 6);
    expect(a.attackTime(0, 0, 10 + ATTACK_COMMIT + 0.01, 0.9, true)).toBeCloseTo(ATTACK_COMMIT + 0.01, 6);
    expect(a.attackTime(0, 0, 10.8, 0.9, true)).toBeCloseTo(0.8, 6);
    expect(a.attackTime(0, 0, 10.95, 0.9, true)).toBe(-1);
  });

  it('出手时在移动，中途停下再动也照常播', () => {
    const a = new UnitAnim(1);
    a.attackTime(0, 0.3, 10, 0.9, true);
    expect(a.attackTime(0, 0, 10.4, 0.9, false)).toBeCloseTo(0.4, 6);
    expect(a.attackTime(0, 0, 10.6, 0.9, true)).toBeCloseTo(0.6, 6);
  });

  it('下一次出手时站着：又按站着出手处理，播过 ATTACK_COMMIT 秒后移动会打断', () => {
    const a = new UnitAnim(1);
    a.attackTime(0, 0.3, 10, 0.9, true);
    a.attackTime(0, 0, 10.9, 0.9, true);
    expect(a.attackTime(0, 0.3, 12, 0.9, false)).toBeCloseTo(0, 6);
    expect(a.attackTime(0, 0, 12 + ATTACK_COMMIT + 0.01, 0.9, true)).toBe(-1);
  });

  it('下一次出手时在移动：不再被打断，哪怕上一次是站着出手', () => {
    const a = new UnitAnim(1);
    a.attackTime(0, 0.3, 10, 0.9, false);
    a.attackTime(0, 0, 10.9, 0.9, false);
    a.attackTime(0, 0.3, 12, 0.9, true);
    expect(a.attackTime(0, 0, 12.6, 0.9, true)).toBeCloseTo(0.6, 6);
  });

  it('是否边跑边打只看出手那一刻，之后 atkAnim 衰减不改变它；各槽位互不影响', () => {
    const a = new UnitAnim(2);
    a.attackTime(0, 0.3, 10, 0.9, true);
    a.attackTime(1, 0.3, 10, 0.9, false);
    a.attackTime(0, 0.2, 10.1, 0.9, true);
    expect(a.attackTime(0, 0, 10.6, 0.9, true)).toBeCloseTo(0.6, 6);
    expect(a.attackTime(1, 0, 10.6, 0.9, true)).toBe(-1);
  });

  it('没在移动时，播过 ATTACK_COMMIT 秒的攻击照常播完', () => {
    const a = new UnitAnim(1);
    a.attackTime(0, 0.3, 10, 0.9, false);
    expect(a.attackTime(0, 0, 10.7, 0.9, false)).toBeCloseTo(0.7, 6);
  });

  it('各槽位互不影响', () => {
    const a = new UnitAnim(2);
    a.attackTime(0, 0.3, 10, 0.8, false);
    expect(a.attackTime(1, 0, 10.2, 0.8, false)).toBe(-1);
    expect(a.attackTime(0, 0, 10.2, 0.8, false)).toBeCloseTo(0.2, 6);
  });
});

describe('UnitAnim.attackVariant', () => {
  /** 一次出手：按渲染器的顺序先 attackVariant 再 attackTime，随后 atkAnim 衰减几帧 */
  function swing(a: UnitAnim, n: number, t: number, rand?: () => number, slot = 0): number[] {
    const picks: number[] = [];
    for (const [k, aa] of [0.3, 0.2, 0.1, 0].entries()) {
      picks.push(a.attackVariant(slot, aa, n, rand));
      a.attackTime(slot, aa, t + k * 0.05, 0.8, false);
    }
    return picks;
  }

  /** 可重复的伪随机序列 */
  const lcg = (seed: number) => () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;

  it('种数不超过 1 时恒为 0', () => {
    const a = new UnitAnim(1);
    for (let k = 0; k < 20; k++) expect(swing(a, 1, 10 + k, () => 0.99)).toEqual([0, 0, 0, 0]);
    for (let k = 0; k < 5; k++) expect(a.attackVariant(0, 0.3 + k, 0, () => 0.5)).toBe(0);
  });

  it('每次出手都与上一次不同，且在 0..n-1 之内', () => {
    for (const n of [2, 3, 4]) {
      const a = new UnitAnim(1), rand = lcg(n);
      let prev = -1;
      for (let k = 0; k < 300; k++) {
        const v = swing(a, n, 10 + k, rand)[0];
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(n);
        if (prev >= 0) expect(v, `n=${n} 第 ${k} 次`).not.toBe(prev);
        prev = v;
      }
    }
  });

  it('rand 取极端值（0 与接近 1）也不重复上一次、不越界', () => {
    for (const r of [0, 0.5, 0.999999]) {
      const a = new UnitAnim(1);
      let prev = swing(a, 3, 10, () => r)[0];
      for (let k = 1; k < 10; k++) {
        const v = swing(a, 3, 10 + k, () => r)[0];
        expect(v).not.toBe(prev);
        expect(v).toBeLessThan(3);
        prev = v;
      }
    }
  });

  it('只有两种时一定交替', () => {
    const a = new UnitAnim(1), rand = lcg(7);
    const seq = Array.from({ length: 8 }, (_, k) => swing(a, 2, 10 + k, rand)[0]);
    for (let k = 1; k < seq.length; k++) expect(seq[k]).toBe(1 - seq[k - 1]);
  });

  it('多种时各种都会被挑到（rand 均匀时）', () => {
    const a = new UnitAnim(1), rand = lcg(42), seen = new Set<number>();
    for (let k = 0; k < 100; k++) seen.add(swing(a, 4, 10 + k, rand)[0]);
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
  });

  it('同一次出手期间（atkAnim 只是在衰减）一直返回同一种，不再调用 rand', () => {
    const a = new UnitAnim(1);
    const rand = vi.fn(() => 0.4);
    const picks = swing(a, 4, 10, rand);
    expect(new Set(picks).size).toBe(1);
    expect(rand).toHaveBeenCalledTimes(1);
    // 出手结束（aa = 0）之后，下一次出手前也保持不变
    expect(a.attackVariant(0, 0, 4, rand)).toBe(picks[0]);
    expect(rand).toHaveBeenCalledTimes(1);
  });

  it('rand 可注入：同样的序列得到同样的结果', () => {
    const run = (): number[] => {
      const a = new UnitAnim(1), rand = lcg(99);
      return Array.from({ length: 20 }, (_, k) => swing(a, 4, 10 + k, rand)[0]);
    };
    expect(run()).toEqual(run());
  });

  it('不传 rand 时用 Math.random', () => {
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const a = new UnitAnim(1);
    const v = swing(a, 4, 10)[0];
    expect(spy).toHaveBeenCalledTimes(1);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(4);
    spy.mockRestore();
  });

  it('各槽位各记各的上一次', () => {
    const a = new UnitAnim(2), rand = lcg(5);
    let p0 = swing(a, 3, 10, rand, 0)[0], p1 = swing(a, 3, 10, rand, 1)[0];
    for (let k = 1; k < 30; k++) {
      const v0 = swing(a, 3, 10 + k, rand, 0)[0], v1 = swing(a, 3, 10 + k, rand, 1)[0];
      expect(v0).not.toBe(p0);
      expect(v1).not.toBe(p1);
      p0 = v0;
      p1 = v1;
    }
  });
});

describe('UnitAnim.claim', () => {
  it('uid 变了（槽位换了一个单位）才清状态，即使兵种相同', () => {
    const a = new UnitAnim(1);
    a.claim(0, 101);
    a.attackTime(0, 0.3, 10, 0.8, false);
    a.claim(0, 101);
    expect(a.attackTime(0, 0, 10.2, 0.8, false)).toBeCloseTo(0.2, 6);
    a.claim(0, 102);
    expect(a.attackTime(0, 0, 10.3, 0.8, false)).toBe(-1);
  });

  it('换兵种时清掉正在播的攻击', () => {
    const a = new UnitAnim(1);
    a.claim(0, 1);
    a.attackTime(0, 0.3, 10, 0.8, false);
    a.claim(0, 2);
    expect(a.attackTime(0, 0, 10.2, 0.8, false)).toBe(-1);
  });

  it('兵种没变时不清状态', () => {
    const a = new UnitAnim(1);
    a.claim(0, 1);
    a.attackTime(0, 0.3, 10, 0.8, false);
    a.claim(0, 1);
    expect(a.attackTime(0, 0, 10.2, 0.8, false)).toBeCloseTo(0.2, 6);
  });

  it('换兵种后第一次绘制不做过渡', () => {
    const a = new UnitAnim(1);
    a.claim(0, 1);
    a.blend(0, IDLE, 5, 1, false);
    a.blend(0, IDLE, 6, 1.1, false);
    a.claim(0, 2);
    a.blend(0, RUN, 100, 1.2, false);
    expect(a.outWeight).toBe(0);
  });
});

describe('UnitAnim.blend', () => {
  it('首次绘制不过渡，权重为 0', () => {
    const a = new UnitAnim(1);
    a.blend(0, RUN, 100.5, 3, false);
    expect(a.outWeight).toBe(0);
    const b = new UnitAnim(1);
    b.blend(0, ATK, 200, 3, true);
    expect(b.outWeight).toBe(0);
  });

  it('动作不变时一直没有过渡', () => {
    const a = new UnitAnim(1);
    for (let k = 0; k < 20; k++) {
      a.blend(0, IDLE, k * 0.5, k * 0.05, false);
      expect(a.outWeight).toBe(0);
    }
  });

  it('换动作：冻结上一帧画出的行，权重从 1 开始', () => {
    const a = new UnitAnim(1);
    a.blend(0, IDLE, 3.5, 1.0, false);
    a.blend(0, IDLE, 4.25, 1.1, false);
    a.blend(0, RUN, 100, 1.2, false);
    expect(a.outRow).toBeCloseTo(4.25, 6);
    expect(a.outWeight).toBeCloseTo(1, 6);
  });

  it(`过渡期内冻结行不变，权重单调下降，${BLEND} 秒后降到 0`, () => {
    const a = new UnitAnim(1);
    a.blend(0, IDLE, 7, 1.0, false);
    a.blend(0, RUN, 100, 1.1, false);
    const ws: number[] = [a.outWeight];
    for (let k = 1; k <= 10; k++) {
      a.blend(0, RUN, 100 + k, 1.1 + (BLEND * k) / 10, false);
      expect(a.outRow).toBe(7);
      ws.push(a.outWeight);
    }
    for (let k = 1; k < ws.length; k++) expect(ws[k]).toBeLessThanOrEqual(ws[k - 1]);
    expect(ws[0]).toBeCloseTo(1, 6);
    expect(ws[5]).toBeGreaterThan(0);
    expect(ws[5]).toBeLessThan(1);
    expect(ws[10]).toBeCloseTo(0, 6);
  });

  it('平滑：过渡一半时权重在 0 与 1 之间，且离开起点的头一小步没有突降', () => {
    const a = new UnitAnim(1);
    a.blend(0, IDLE, 7, 1.0, false);
    a.blend(0, RUN, 100, 1.1, false);
    a.blend(0, RUN, 100.1, 1.1 + BLEND / 2, false);
    expect(a.outWeight).toBeGreaterThan(0.2);
    expect(a.outWeight).toBeLessThan(0.8);
    a.blend(0, RUN, 100.2, 1.1 + BLEND * 0.02, false);
    expect(a.outWeight).toBeGreaterThan(0.9);
  });

  it('过渡结束之后权重保持 0', () => {
    const a = new UnitAnim(1);
    a.blend(0, IDLE, 7, 1.0, false);
    a.blend(0, RUN, 100, 1.1, false);
    for (const dt of [BLEND + 0.001, BLEND + 0.05, 5]) {
      a.blend(0, RUN, 105, 1.1 + dt, false);
      expect(a.outWeight).toBe(0);
    }
  });

  it('换到攻击用更短的过渡 BLEND_ATTACK', () => {
    expect(BLEND_ATTACK).toBeLessThan(BLEND);
    const a = new UnitAnim(1);
    a.blend(0, IDLE, 7, 1.0, false);
    a.blend(0, ATK, 200, 1.1, true);
    expect(a.outWeight).toBeCloseTo(1, 6);
    a.blend(0, ATK, 201, 1.1 + BLEND_ATTACK + 0.005, true);
    expect(a.outWeight).toBe(0);

    const b = new UnitAnim(1);
    b.blend(0, IDLE, 7, 1.0, false);
    b.blend(0, RUN, 100, 1.1, false);
    b.blend(0, RUN, 101, 1.1 + BLEND_ATTACK + 0.005, false);
    expect(b.outWeight).toBeGreaterThan(0);
  });

  it('过渡中途再换动作：从当前画出来的姿势重新过渡，权重回到 1', () => {
    const a = new UnitAnim(1);
    a.blend(0, IDLE, 10, 1.0, false);
    a.blend(0, RUN, 100, 1.1, false);
    a.blend(0, RUN, 101, 1.12, false);
    a.blend(0, ATK, 200, 1.13, true);
    expect(a.outWeight).toBeCloseTo(1, 6);
    // 冻结的是前面实际画出来的姿势：要么是淡出中的旧动作（行 10），要么是新动作（行 101）
    expect([10, 101]).toContain(a.outRow);
  });

  it('同一段攻击重新起手：即使还是同一个动作，下一次 blend 也从上一帧做 BLEND_ATTACK 过渡', () => {
    const a = new UnitAnim(1);
    a.attackTime(0, 0.3, 1.0, 0.8, false);
    a.blend(0, ATK, 200, 1.0, true);
    a.attackTime(0, 0.2, 1.1, 0.8, false);
    a.blend(0, ATK, 203, 1.1, true);
    expect(a.outWeight).toBe(0);
    a.attackTime(0, 0.1, 1.2, 0.8, false);
    a.blend(0, ATK, 206, 1.2, true);
    expect(a.outWeight).toBe(0);
    // 动作播到 1.2 秒时（行 206）再次出手
    a.attackTime(0, 0.3, 1.3, 0.8, false);
    a.blend(0, ATK, 200, 1.3, true);
    expect(a.outRow).toBe(206);
    expect(a.outWeight).toBeCloseTo(1, 6);
    a.attackTime(0, 0.25, 1.3 + BLEND_ATTACK / 2, 0.8, false);
    a.blend(0, ATK, 201, 1.3 + BLEND_ATTACK / 2, true);
    expect(a.outWeight).toBeGreaterThan(0);
    expect(a.outWeight).toBeLessThan(1);
    a.attackTime(0, 0.2, 1.3 + BLEND_ATTACK + 0.01, 0.8, false);
    a.blend(0, ATK, 202, 1.3 + BLEND_ATTACK + 0.01, true);
    expect(a.outWeight).toBe(0);
  });

  it('只是 atkAnim 在衰减的同一段攻击不触发额外过渡', () => {
    const a = new UnitAnim(1);
    a.attackTime(0, 0.3, 1.0, 0.8, false);
    a.blend(0, ATK, 200, 1.0, true);
    for (let k = 1; k <= 5; k++) {
      const t = 1 + k * 0.05;
      a.attackTime(0, 0.3 - k * 0.05, t, 0.8, false);
      a.blend(0, ATK, 200 + k, t, true);
      expect(a.outWeight).toBe(0);
    }
  });

  it('隔了超过 STALE 秒才再画（出画面后回来），不从那么久以前的姿势过渡', () => {
    const a = new UnitAnim(1);
    a.blend(0, IDLE, 7, 1.0, false);
    a.blend(0, RUN, 100, 1.0 + STALE + 0.5, false);
    expect(a.outWeight).toBe(0);
  });

  it('间隔不超过 STALE 秒时照常过渡（掉帧、卡一下也不会跳变），包括超过 BLEND 的间隔', () => {
    expect(STALE).toBeGreaterThan(BLEND);
    for (const gap of [0.1, BLEND + 0.3, STALE - 0.01]) {
      const a = new UnitAnim(1);
      a.blend(0, IDLE, 7, 1.0, false);
      a.blend(0, RUN, 100, 1.0 + gap, false);
      expect(a.outWeight, `gap=${gap}`).toBeGreaterThan(0.9);
      expect(a.outRow).toBe(7);
    }
  });

  it('隔了很久再画之后，下一次换动作又能正常过渡', () => {
    const a = new UnitAnim(1);
    a.blend(0, IDLE, 7, 1.0, false);
    a.blend(0, RUN, 100, 10, false);
    a.blend(0, RUN, 101, 10.05, false);
    a.blend(0, IDLE, 8, 10.1, false);
    expect(a.outWeight).toBeCloseTo(1, 6);
    expect(a.outRow).toBe(101);
  });

  it('时间很大时（出手起点精度）也不丢出手第一帧，过渡仍按秒算', () => {
    const t = 86400.3;
    const a = new UnitAnim(1);
    a.blend(0, IDLE, 7, t - 0.05, false);
    expect(a.attackTime(0, 0.3, t, 0.8, false)).toBeGreaterThanOrEqual(0);
    a.blend(0, ATK, 200, t, true);
    expect(a.outWeight).toBeCloseTo(1, 4);
    a.blend(0, ATK, 201, t + BLEND_ATTACK / 2, true);
    expect(a.outWeight).toBeGreaterThan(0.3);
    expect(a.outWeight).toBeLessThan(0.7);
  });

  it('各槽位互不影响', () => {
    const a = new UnitAnim(2);
    a.blend(0, IDLE, 7, 1.0, false);
    a.blend(1, IDLE, 8, 1.0, false);
    a.blend(0, RUN, 100, 1.1, false);
    expect(a.outWeight).toBeGreaterThan(0);
    a.blend(1, IDLE, 9, 1.1, false);
    expect(a.outWeight).toBe(0);
  });
});
