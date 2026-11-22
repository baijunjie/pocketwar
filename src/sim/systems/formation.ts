/** 阵型：把一队单位排成横队 */
import type { World } from '../world';

/**
 * 阵型站位：按各兵种的默认排次（UnitDef.row）分行，快的在前、远程居后、器械殿后。
 * @param pos 若提供（单位槽位），按现有位置就近分配以减少交叉
 */
export function formation(w: World, defIdxs: number[], cx: number, cy: number, dx: number, dy: number, pos: number[] | null):
  { sx: Float32Array; sy: Float32Array; radius: number } {
  const n = defIdxs.length;
  const sx = new Float32Array(n), sy = new Float32Array(n);
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
  let dAcc = 0;
  for (let ri = 0; ri < rows.length; ri++) {
    const r = rows[ri];
    if (pos) r.sort((a, b) => lat[a] - lat[b]);
    let w = 0;
    for (const m of r) w += defs[defIdxs[m]].radius * 2 + 3;
    let xo = -w / 2;
    const fwd = depth / 2 - dAcc - rowDepth[ri] / 2;
    for (const m of r) {
      const sp = defs[defIdxs[m]].radius * 2 + 3;
      const l = xo + sp / 2;
      sx[m] = cx + lx * l + dx * fwd;
      sy[m] = cy + ly * l + dy * fwd;
      xo += sp;
    }
    dAcc += rowDepth[ri];
  }
  return { sx, sy, radius: Math.hypot(width, depth) / 2 };
}
