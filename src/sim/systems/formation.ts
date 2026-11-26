/** 阵型：把一队单位排成横队 */
import type { World } from '../world';

/** formation() 的结果 */
export interface Formation {
  /** 每个单位的站位 */
  sx: Float32Array;
  sy: Float32Array;
  /** 每个单位相对队列中心沿前进方向、沿横向的偏移（编队行军时用） */
  fa: Float32Array;
  fl: Float32Array;
  /** 每个单位在第几排（0 是最前排）、排内第几个（从左往右，即横向偏移从小到大） */
  row: Int16Array;
  col: Int16Array;
  /** 各排的总宽（排里各人的间距之和）、排深（排里最大的间距）、人数、相对队列中心沿前进方向的偏移、最大半径、最慢的奔跑速度 */
  rowW: number[];
  rowD: number[];
  rowN: number[];
  rowFa: number[];
  rowRad: number[];
  rowRun: number[];
  radius: number;
  width: number;
  depth: number;
}

/**
 * 阵型站位：按各兵种的默认排次（UnitDef.row）分行，近战在前、远程居后、器械殿后，同一档里快的在前。
 * @param pos 若提供（单位槽位），按现有位置就近分配以减少交叉
 */
export function formation(w: World, defIdxs: number[], cx: number, cy: number, dx: number, dy: number, pos: number[] | null): Formation {
  const n = defIdxs.length;
  const sx = new Float32Array(n), sy = new Float32Array(n), fa = new Float32Array(n), fl = new Float32Array(n);
  const row = new Int16Array(n), col = new Int16Array(n);
  const dl = Math.hypot(dx, dy);
  if (dl < 1e-4) {
    dx = 0;
    dy = -1;
  } else {
    dx /= dl;
    dy /= dl;
  }
  const lx = -dy, ly = dx; // 横向
  const along = new Float32Array(n), lat = new Float32Array(n);
  if (pos) {
    for (let m = 0; m < n; m++) {
      const s = pos[m];
      along[m] = w.x[s] * dx + w.y[s] * dy;
      lat[m] = w.x[s] * lx + w.y[s] * ly;
    }
  }
  const defs = w.defs;
  const idx = Array.from({ length: n }, (_, i) => i);
  idx.sort((a, b) => defs[defIdxs[a]].row - defs[defIdxs[b]].row || along[b] - along[a] || a - b);
  let area = 0;
  for (let m = 0; m < n; m++) {
    const sp = defs[defIdxs[m]].radius * 2 + 3;
    area += sp * sp;
  }
  const width = Math.max(48, Math.sqrt(area * 2.6));
  // 分行
  const rows: number[][] = [];
  let cur: number[] = [], curW = 0, curRow = -1;
  for (const m of idx) {
    const d = defs[defIdxs[m]];
    const sp = d.radius * 2 + 3;
    if (cur.length && (curW + sp > width || d.row !== curRow)) {
      rows.push(cur);
      cur = [];
      curW = 0;
    }
    curRow = d.row;
    cur.push(m);
    curW += sp;
  }
  if (cur.length) rows.push(cur);
  let depth = 0;
  const rowDepth: number[] = [];
  for (const r of rows) {
    let mx = 0;
    for (const m of r) mx = Math.max(mx, defs[defIdxs[m]].radius * 2 + 3);
    rowDepth.push(mx);
    depth += mx;
  }
  const rowW: number[] = [], rowN: number[] = [], rowFa: number[] = [], rowRad: number[] = [], rowRun: number[] = [];
  let dAcc = 0;
  for (let ri = 0; ri < rows.length; ri++) {
    const r = rows[ri];
    if (pos) r.sort((a, b) => lat[a] - lat[b]);
    let w = 0, rad = 0, run = Infinity;
    for (const m of r) {
      const d = defs[defIdxs[m]];
      w += d.radius * 2 + 3;
      if (d.radius > rad) rad = d.radius;
      if (d.speed < run) run = d.speed;
    }
    let xo = -w / 2;
    const fwd = depth / 2 - dAcc - rowDepth[ri] / 2;
    for (let k = 0; k < r.length; k++) {
      const m = r[k];
      const sp = defs[defIdxs[m]].radius * 2 + 3;
      const l = xo + sp / 2;
      fa[m] = fwd;
      fl[m] = l;
      row[m] = ri;
      col[m] = k;
      sx[m] = cx + lx * l + dx * fwd;
      sy[m] = cy + ly * l + dy * fwd;
      xo += sp;
    }
    rowW.push(w);
    rowN.push(r.length);
    rowFa.push(fwd);
    rowRad.push(rad);
    rowRun.push(run);
    dAcc += rowDepth[ri];
  }
  return { sx, sy, fa, fl, row, col, rowW, rowD: rowDepth, rowN, rowFa, rowRad, rowRun, radius: Math.hypot(width, depth) / 2, width, depth };
}
