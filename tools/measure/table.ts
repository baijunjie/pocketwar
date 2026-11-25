/** 对战测量工具：把测量结果输出成表格文件（TSV）与终端里的对齐文本。 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Row } from './measure';

const COLS: [string, (r: Row) => string][] = [
  ['kind', r => r.kind],
  ['label', r => r.label],
  ['size', r => String(r.size)],
  ['n', r => String(r.n)],
  ['adv', r => num(r.adv, 3)],
  ['adv_se', r => num(r.advSe, 3, false)],
  ['win', r => (Number.isNaN(r.win) ? '' : (r.win * 100).toFixed(0) + '%')],
  ['delta', r => num(r.delta, 3)],
  ['delta_se', r => num(r.deltaSe, 3, false)],
  ['slope', r => num(r.slope, 4)],
  ['points', r => num(r.points, 2)],
  ['points_se', r => num(r.pointsSe, 2, false)],
  ['significant', r => (r.significant === undefined ? '' : r.significant ? 'yes' : 'no')],
  ['stop', r => r.stop ?? ''],
];

function num(x: number | undefined, k: number, signed = true): string {
  if (x === undefined) return '';
  return (signed && x >= 0 ? '+' : '') + x.toFixed(k);
}

export function toTsv(rows: Row[]): string {
  return [COLS.map(c => c[0]).join('\t'), ...rows.map(r => COLS.map(c => c[1](r)).join('\t'))].join('\n') + '\n';
}

export function writeTsv(rows: Row[], file: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, toTsv(rows));
}

/** 终端里看的：去掉全空的列，按列宽对齐；不显著的点数后面标「不显著」 */
export function toText(rows: Row[]): string {
  const cols = COLS.filter(c => rows.some(r => c[1](r) !== ''));
  const cells = rows.map(r => cols.map(c => c[1](r)));
  const widths = cols.map((c, i) => Math.max(c[0].length, ...cells.map(r => r[i].length)));
  const line = (r: string[]) => r.map((x, i) => x.padEnd(widths[i])).join('  ').trimEnd();
  return [line(cols.map(c => c[0])), ...cells.map(line)].join('\n');
}
