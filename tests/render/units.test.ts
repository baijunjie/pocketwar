import { describe, expect, it } from 'vitest';
import { clipRow } from '../../src/render/units';
import type { Clip } from '../../src/render/rig';

describe('clipRow', () => {
  const clip: Clip = { start: 10, n: 30, seconds: 1 };

  it('进度 0..1 对应 start + p * n', () => {
    expect(clipRow(clip, 0)).toBe(10);
    expect(clipRow(clip, 0.5)).toBeCloseTo(25, 9);
    expect(clipRow(clip, 1)).toBe(40);
    expect(clipRow(clip, 0.25)).toBeCloseTo(17.5, 9);
  });

  it('带小数，供帧间插值', () => {
    const r = clipRow(clip, 0.0123);
    expect(r).not.toBe(Math.round(r));
    expect(r).toBeCloseTo(10 + 0.0123 * 30, 9);
  });

  it('越界的进度夹在首末帧', () => {
    expect(clipRow(clip, -0.3)).toBe(10);
    expect(clipRow(clip, 1.7)).toBe(40);
    expect(clipRow(clip, -Infinity)).toBe(10);
    expect(clipRow(clip, Infinity)).toBe(40);
  });

  it('start 为 0 时同样成立', () => {
    expect(clipRow({ start: 0, n: 10, seconds: 0.5 }, 0.5)).toBeCloseTo(5, 9);
  });
});
