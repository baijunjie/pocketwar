import { describe, expect, it } from 'vitest';
import { UNIT_BY_KEY } from '../../../src/sim/defs';
import { formation } from '../../../src/sim/systems/formation';
import { flatWorld } from '../../helpers';

const idx = (k: string): number => UNIT_BY_KEY[k].idx;
const CX = 1000, CY = 1500;

/** 混编：铁骑（最前档）、刀盾、弩兵、霹雳车（器械殿后） */
const mixed = (): number[] => [
  ...Array(12).fill(idx('pili')), ...Array(40).fill(idx('nu')), ...Array(70).fill(idx('dao')), ...Array(25).fill(idx('tieqi')),
];

describe('formation：把一队单位排成横队', () => {
  const w = flatWorld();
  /** 单个单位的间距：直径加 3 */
  const sp = (t: number): number => w.defs[t].radius * 2 + 3;

  it('按兵种档分排：档数小的（近战）在前，同一排只有同一档的兵种，器械殿后，各排的前后偏移从前到后递减', () => {
    const defs = mixed();
    const f = formation(w, defs, CX, CY, 1, 0, null);
    // 每个人所在排的兵种档：排与排之间档不降、同一排里档相同
    const rowRank = new Map<number, number>();
    defs.forEach((t, m) => {
      const r = f.row[m], rank = w.defs[t].row;
      if (rowRank.has(r)) expect(rank).toBe(rowRank.get(r));
      else rowRank.set(r, rank);
    });
    const rows = [...rowRank.keys()].sort((a, b) => a - b);
    expect(rows[0]).toBe(0);
    for (let k = 0; k < rows.length; k++) expect(rows[k]).toBe(k);
    for (let k = 1; k < rows.length; k++) expect(rowRank.get(rows[k])!).toBeGreaterThanOrEqual(rowRank.get(rows[k - 1])!);
    // 第一排是铁骑，最后一排是霹雳车
    expect(w.defs[defs[f.row.indexOf(0)]].key).toBe('tieqi');
    expect(w.defs[defs[f.row.indexOf(rows.length - 1)]].key).toBe('pili');
    // 各排的前后偏移（沿前进方向）从前到后严格递减，最前排在前面（偏移为正）
    expect(f.rowFa.length).toBe(rows.length);
    for (let k = 1; k < f.rowFa.length; k++) expect(f.rowFa[k]).toBeLessThan(f.rowFa[k - 1]);
    expect(f.rowFa[0]).toBeGreaterThan(0);
    expect(f.rowFa[f.rowFa.length - 1]).toBeLessThan(0);
  });

  it('各排的统计：人数、总宽（各人间距之和）、排深（最大间距）、最大半径、最慢的奔跑速度，与成员对得上', () => {
    const defs = mixed();
    const f = formation(w, defs, CX, CY, 1, 0, null);
    const R = f.rowW.length;
    expect(f.rowN.length).toBe(R);
    expect(f.rowD.length).toBe(R);
    expect(f.rowRad.length).toBe(R);
    expect(f.rowRun.length).toBe(R);
    expect(f.rowN.reduce((a, b) => a + b, 0)).toBe(defs.length);
    for (let r = 0; r < R; r++) {
      const mem = defs.map((t, m) => ({ t, m })).filter(e => f.row[e.m] === r);
      expect(f.rowN[r]).toBe(mem.length);
      expect(f.rowW[r]).toBeCloseTo(mem.reduce((a, e) => a + sp(e.t), 0), 6);
      expect(f.rowD[r]).toBeCloseTo(Math.max(...mem.map(e => sp(e.t))), 6);
      expect(f.rowRad[r]).toBe(Math.max(...mem.map(e => w.defs[e.t].radius)));
      expect(f.rowRun[r]).toBe(Math.min(...mem.map(e => w.defs[e.t].speed)));
      // 一排不超过队宽
      expect(f.rowW[r]).toBeLessThanOrEqual(f.width + 1e-6);
      // 每个成员的偏移就是所在排的偏移
      for (const e of mem) expect(f.fa[e.m]).toBeCloseTo(f.rowFa[r], 4);
    }
  });

  it('排内序号：从左往右（横向偏移从小到大）依次为 0、1、2……，排内以排的中线为中心左右对称铺开', () => {
    const defs = mixed();
    const f = formation(w, defs, CX, CY, 1, 0, null);
    for (let r = 0; r < f.rowW.length; r++) {
      const mem = defs.map((t, m) => m).filter(m => f.row[m] === r).sort((a, b) => f.col[a] - f.col[b]);
      mem.forEach((m, k) => expect(f.col[m]).toBe(k));
      for (let k = 1; k < mem.length; k++) expect(f.fl[mem[k]]).toBeGreaterThan(f.fl[mem[k - 1]]);
      // 最左的人左边缘在 −总宽/2，最右的人右边缘在 +总宽/2
      const first = mem[0], last = mem[mem.length - 1];
      expect(f.fl[first] - sp(defs[first]) / 2).toBeCloseTo(-f.rowW[r] / 2, 4);
      expect(f.fl[last] + sp(defs[last]) / 2).toBeCloseTo(f.rowW[r] / 2, 4);
    }
  });

  it('站位 = 中心 + 横向偏移 × 横向单位向量 + 前后偏移 × 朝向单位向量（朝向不必是单位向量，朝东时右手边是 +y）', () => {
    const defs = mixed();
    // 朝东：横向（右手边）是 +y
    const e = formation(w, defs, CX, CY, 1, 0, null);
    defs.forEach((_, m) => {
      expect(e.sx[m]).toBeCloseTo(CX + e.fa[m], 3);
      expect(e.sy[m]).toBeCloseTo(CY + e.fl[m], 3);
    });
    // 斜着、长度不是 1
    const hx = 3, hy = 4, l = 5;
    const d = formation(w, defs, CX, CY, hx, hy, null);
    defs.forEach((_, m) => {
      expect(d.sx[m]).toBeCloseTo(CX + (-hy / l) * d.fl[m] + (hx / l) * d.fa[m], 3);
      expect(d.sy[m]).toBeCloseTo(CY + (hx / l) * d.fl[m] + (hy / l) * d.fa[m], 3);
    });
    // 排的结构与朝向无关
    expect(d.rowN).toEqual(e.rowN);
    expect(d.width).toBeCloseTo(e.width, 6);
  });

  it('队宽、纵深、半径：纵深是各排排深之和，半径是队列外接圆半径，队宽不小于 48', () => {
    const f = formation(w, mixed(), CX, CY, 1, 0, null);
    expect(f.depth).toBeCloseTo(f.rowD.reduce((a, b) => a + b, 0), 6);
    expect(f.radius).toBeCloseTo(Math.hypot(f.width, f.depth) / 2, 6);
    const one = formation(w, [idx('dao')], CX, CY, 1, 0, null);
    expect(one.width).toBe(48);
    expect(one.rowN).toEqual([1]);
    expect(one.row[0]).toBe(0);
    expect(one.col[0]).toBe(0);
    expect(one.fl[0]).toBeCloseTo(0, 6);
  });

  it('没有朝向（零向量）：朝向地图上方（−y），最前排的 y 最小', () => {
    const f = formation(w, mixed(), CX, CY, 0, 0, null);
    const front = f.row.indexOf(0), back = f.row.indexOf(f.rowW.length - 1);
    expect(f.sy[front]).toBeLessThan(f.sy[back]);
    expect(f.sy[front]).toBeCloseTo(CY - f.fa[front], 3);
    // 朝上时右手边是 +x
    expect(f.sx[front]).toBeCloseTo(CX + f.fl[front], 3);
  });

  it('给了现有位置：同一排里按现在的横向位置从左到右分配站位（减少交叉）', () => {
    // 80 个刀盾随机撒在一片地里，朝东：横向就是 y
    const defs = Array(80).fill(idx('dao'));
    const slots = defs.map((t, i) => w.spawnUnit(t, 1, 600 + ((i * 37) % 200), 800 + ((i * 53) % 400)));
    const f = formation(w, defs, CX, CY, 1, 0, slots);
    for (let r = 0; r < f.rowW.length; r++) {
      const mem = defs.map((_, m) => m).filter(m => f.row[m] === r).sort((a, b) => f.col[a] - f.col[b]);
      for (let k = 1; k < mem.length; k++) expect(w.y[slots[mem[k]]]).toBeGreaterThanOrEqual(w.y[slots[mem[k - 1]]]);
    }
    // 靠前的排是现在在前面（x 更大）的人
    const meanX = (r: number): number => {
      const mem = defs.map((_, m) => m).filter(m => f.row[m] === r);
      return mem.reduce((a, m) => a + w.x[slots[m]], 0) / mem.length;
    };
    expect(meanX(0)).toBeGreaterThan(meanX(f.rowW.length - 1));
  });
});
