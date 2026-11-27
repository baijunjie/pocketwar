import { describe, expect, it } from 'vitest';
import { compactNum, effectText, mulPct } from '../../src/ui/unitText';

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

describe('mulPct 倍率相对 1 的增减', () => {
  it('大于 1 写「+」、小于 1 写「−」（U+2212）', () => {
    expect(mulPct(1.15)).toBe('+15%');
    expect(mulPct(0.5)).toBe('−50%');
    expect(mulPct(1.12)).toBe('+12%');
    expect(mulPct(0.75)).toBe('−25%');
    expect(mulPct(0.5).charCodeAt(0)).toBe(0x2212);
    expect(mulPct(0.5)).not.toContain('-');
  });

  it('百分数四舍五入取整', () => {
    expect(mulPct(1.126)).toBe('+13%');
    expect(mulPct(0.854)).toBe('−15%');
    expect(mulPct(2)).toBe('+100%');
  });

  it('取整为 0 的保留一位小数，符号按数值本身判断', () => {
    expect(mulPct(1.004)).toBe('+0.4%');
    expect(mulPct(0.996)).toBe('−0.4%');
    expect(mulPct(0.999)).toBe('−0.1%');
  });
});

describe('effectText 单位身上的一项增减益', () => {
  it('写成「来源 数值 增减」', () => {
    expect(effectText({ source: '城墙', stat: '所受远程伤害', mul: 0.5, good: true })).toBe('城墙 所受远程伤害 −50%');
    expect(effectText({ source: '顺风', stat: '速度', mul: 1.15, good: true })).toBe('顺风 速度 +15%');
    expect(effectText({ source: '逆风', stat: '射程', mul: 0.85, good: false })).toBe('逆风 射程 −15%');
  });
});
