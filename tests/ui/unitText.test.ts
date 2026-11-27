import { describe, expect, it } from 'vitest';
import { compactNum } from '../../src/ui/unitText';

describe('compactNum 窄地方的人数与资源', () => {
  it('不到 1000 原样写', () => {
    expect(compactNum(0)).toBe('0');
    expect(compactNum(7)).toBe('7');
    expect(compactNum(999)).toBe('999');
  });

  it('先向下取整：带小数的数按整数部分算', () => {
    expect(compactNum(12.9)).toBe('12');
    expect(compactNum(999.9)).toBe('999');
    expect(compactNum(1000.9)).toBe('1k');
  });

  it('1000～9999 写「x.yk」，向下取一位小数，整千不带小数点', () => {
    expect(compactNum(1000)).toBe('1k');
    expect(compactNum(1099)).toBe('1k');
    expect(compactNum(1100)).toBe('1.1k');
    expect(compactNum(1426)).toBe('1.4k');
    expect(compactNum(1999)).toBe('1.9k');
    expect(compactNum(2000)).toBe('2k');
    expect(compactNum(9999)).toBe('9.9k');
  });

  it('不小于 10000 写「Nk」，向下取整', () => {
    expect(compactNum(10000)).toBe('10k');
    expect(compactNum(12999)).toBe('12k');
    expect(compactNum(99999)).toBe('99k');
    expect(compactNum(123456)).toBe('123k');
  });

  it('向下取、不把没到的数写大', () => {
    for (const v of [1999, 5999, 9999, 19999, 54321]) {
      const s = compactNum(v);
      expect(Number(s.replace('k', '')) * 1000, String(v)).toBeLessThanOrEqual(v);
    }
  });
});
