/**
 * 视野与战争迷雾。每队一张可见格图；单位的 seen 位记录它被哪一队看见，索敌只能选看得见的敌人。
 * 夜里视野缩小；打着火把的单位自己看得更远，但也会在更远处被敌人发现。
 */
import { RULES } from '../content';
import { NONE, S_TORCH, VIS_CELL } from '../state';
import type { World } from '../world';

export function updateVision(w: World): void {
  const st = w.visStamp, vw = w.vw, vh = w.vh;
  const E = RULES.env;
  const vm = w.env.visionMul;
  const lit = vm > E.torchVision ? vm : E.torchVision;
  const n = w.n, alive = w.alive, team = w.team, state = w.state, defs = w.defs, type = w.type;
  for (let tm = 1; tm <= 2; tm++) {
    const vis = w.teamVis[tm];
    vis.fill(0);
    st.fill(0);
    const stamp = (cx: number, cy: number, r: number): void => {
      const c = cy * vw + cx;
      if (st[c] >= r) return;
      st[c] = r;
      for (let dy = -r; dy <= r; dy++) {
        const yy = cy + dy;
        if (yy < 0 || yy >= vh) continue;
        const span = Math.floor(Math.sqrt(r * r + r - dy * dy));
        let xa = cx - span, xb = cx + span;
        if (xa < 0) xa = 0;
        if (xb >= vw) xb = vw - 1;
        const row = yy * vw;
        for (let xx = xa; xx <= xb; xx++) vis[row + xx] = 1;
      }
    };
    for (let i = 0; i < n; i++) {
      if (!alive[i] || team[i] !== tm) continue;
      const r = Math.round((defs[type[i]].vision * (state[i] & S_TORCH ? lit : vm)) / VIS_CELL);
      stamp((w.x[i] / VIS_CELL) | 0, (w.y[i] / VIS_CELL) | 0, r < 1 ? 1 : r);
    }
    // 建筑有常明的灯火，视野不受昼夜影响
    for (const b of w.buildings) {
      if (!b.alive || b.owner !== tm) continue;
      stamp((b.cx / VIS_CELL) | 0, (b.cy / VIS_CELL) | 0, b.def.tower ? 6 : 3);
    }
  }
  for (let i = 0; i < n; i++) {
    if (!alive[i]) continue;
    const tm = team[i], en = 3 - tm;
    let bits = 1 << tm;
    if (w.teamVis[en][((w.y[i] / VIS_CELL) | 0) * vw + ((w.x[i] / VIS_CELL) | 0)]) bits |= 1 << en;
    else if (state[i] & S_TORCH && w.findEnemy(w.x[i], w.y[i], tm, E.torchSeen, 0, false) !== NONE) bits |= 1 << en;
    w.seen[i] = bits;
  }
  // 玩家看到的那一张
  const h = w.humanTeam;
  if (!w.fog || !h) {
    if (w.vis[0] !== 1 || w.explored[0] !== 1) {
      w.vis.fill(1);
      w.explored.fill(1);
    }
    return;
  }
  const src = w.teamVis[h], ex = w.explored;
  w.vis.set(src);
  for (let i = 0; i < src.length; i++) if (src[i]) ex[i] = 1;
}

export function refreshVision(w: World): void {
  w.vis[0] = 0;
  updateVision(w);
}
