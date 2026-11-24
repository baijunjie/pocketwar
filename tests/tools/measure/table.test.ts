import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Row } from '../../../tools/measure/measure';
import { toText, toTsv, writeTsv } from '../../../tools/measure/table';

const COLS = ['kind', 'label', 'size', 'n', 'adv', 'adv_se', 'win', 'delta', 'delta_se', 'slope', 'points', 'points_se', 'significant'];

const full: Row = {
  kind: 'dim', label: 'inf:hp=+8', size: 100, n: 48, adv: 0.1234, advSe: 0.0123, win: 0.625,
  delta: -0.05, deltaSe: 0.01, slope: 0.0312, points: 2.5, pointsSe: 0.21, significant: true,
};
const bare: Row = { kind: 'ladder', label: 'hp=0', size: 30, n: 2, adv: -0.5, advSe: 0.1, win: NaN };

describe('测量结果表：TSV', () => {
  it('第一行是列名，每个 Row 一行，列用制表符分隔，以换行结尾', () => {
    const lines = toTsv([full, bare]).split('\n');
    expect(lines[0].split('\t')).toEqual(COLS);
    expect(lines.length).toBe(4);
    expect(lines[3]).toBe('');
    for (const l of lines.slice(0, 3)) expect(l.split('\t').length).toBe(COLS.length);
  });

  it('数值：带符号的列非负时前面加 +，标准误不带符号；胜率写成百分比，缺的字段留空', () => {
    const [a, b] = toTsv([full, bare]).split('\n').slice(1, 3).map(l => l.split('\t'));
    expect(a).toEqual(['dim', 'inf:hp=+8', '100', '48', '+0.123', '0.012', '63%', '-0.050', '0.010', '+0.0312', '+2.50', '0.21', 'yes']);
    // 没有增量、斜率、点数；胜率不是数则留空；优势为负不加 +
    expect(b).toEqual(['ladder', 'hp=0', '30', '2', '-0.500', '0.100', '', '', '', '', '', '', '']);
  });

  it('显著性：false 写 no，没有这个字段留空', () => {
    const cell = (r: Row): string => toTsv([r]).split('\n')[1].split('\t')[12];
    expect(cell({ ...full, significant: false })).toBe('no');
    expect(cell({ ...full, significant: undefined })).toBe('');
  });

  it('没有行时只有列名', () => {
    expect(toTsv([])).toBe(COLS.join('\t') + '\n');
  });

  it('writeTsv 把 TSV 写进文件，目录不存在时先建出来', () => {
    // 写到被忽略的缓存目录里，层级是多层，覆盖「先建目录」；重复运行时直接覆盖
    const file = resolve('node_modules/.cache/measure-table-test/a/b/out.tsv');
    writeTsv([full], file);
    expect(readFileSync(file, 'utf8')).toBe(toTsv([full]));
    writeTsv([bare], file);
    expect(readFileSync(file, 'utf8')).toBe(toTsv([bare]));
  });
});

describe('测量结果表：终端文本', () => {
  it('去掉所有行都为空的列，保留有内容的列', () => {
    const head = toText([bare]).split('\n')[0].split(/\s+/);
    expect(head).toEqual(['kind', 'label', 'size', 'n', 'adv', 'adv_se']);
    const head2 = toText([bare, full]).split('\n')[0].split(/\s+/);
    expect(head2).toEqual(COLS);
  });

  it('按列宽对齐：同一列的内容从同一位置开始，行尾没有多余空格', () => {
    const lines = toText([full, { ...bare, label: 'x' }]).split('\n');
    expect(lines.length).toBe(3);
    const at = lines[0].indexOf('size');
    expect(at).toBeGreaterThan(0);
    // 第二、三行 size 列的内容都从表头 size 的位置开始
    expect(lines[1].slice(at).startsWith('100')).toBe(true);
    expect(lines[2].slice(at).startsWith('30')).toBe(true);
    for (const l of lines) expect(l).toBe(l.trimEnd());
  });
});
