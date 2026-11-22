/** 空间网格：细格用于邻近查询，粗格用于「这一带有没有敌人」的快速排除 */
import { COARSE, GRID } from '../state';
import type { World } from '../world';

export function buildGrid(w: World): void {
  const cs = w.cellStart, cur = w.cellCur, gw = w.gw, cw = w.cw;
  cur.fill(0);
  w.pres[1].fill(0);
  w.pres[2].fill(0);
  const n = w.n;
  for (let i = 0; i < n; i++) {
    if (!w.alive[i]) continue;
    cur[((w.y[i] / GRID) | 0) * gw + ((w.x[i] / GRID) | 0)]++;
    w.pres[w.team[i]][((w.y[i] / COARSE) | 0) * cw + ((w.x[i] / COARSE) | 0)]++;
  }
  let acc = 0;
  const cells = cur.length;
  for (let c = 0; c < cells; c++) {
    cs[c] = acc;
    acc += cur[c];
    cur[c] = 0;
  }
  cs[cells] = acc;
  for (let i = 0; i < n; i++) {
    if (!w.alive[i]) continue;
    const c = ((w.y[i] / GRID) | 0) * gw + ((w.x[i] / GRID) | 0);
    w.items[cs[c] + cur[c]++] = i;
  }
}
