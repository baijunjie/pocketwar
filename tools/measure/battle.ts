/** 对战测量工具：测量规程里的一场对战。 */
import { T_GRASS, TILE } from '../../src/sim/defs';
import { GameMap } from '../../src/sim/map';
import { World } from '../../src/sim/world';

/** 规程：双方相距、残部重新寻敌的间隔（秒）、最长时间（秒） */
export const PROTOCOL = { gap: 1400, reseek: 10, maxSecs: 420, mapSize: 160 } as const;

export function flatMap(n: number): GameMap {
  return {
    seed: 1, w: n, h: n, terrain: new Uint8Array(n * n).fill(T_GRASS), height: new Float32Array(n * n),
    dirt: new Uint8Array(n * n), sites: [], buildings: [], props: new Float32Array(0), propChunk: new Int32Array(1),
    chunkW: 0, chunkH: 0, spawn: [], deploy: [],
  };
}

export interface Result {
  /** 双方剩余生命占开局的比例 */
  fa: number;
  fb: number;
  /** 优势：fa − fb，正值 a 占优 */
  adv: number;
  /** 打了多少秒 */
  secs: number;
}

/**
 * 平地对冲：a 在左、b 在右，都攻击移动到中点；关掉昼夜天气与迷雾，每 10 秒让残部继续寻敌，最长 420 秒。
 * 相同的两支军队与种子，结果完全一致。
 */
export function battle(a: number[], b: number[], seed: number): Result {
  const N = PROTOCOL.mapSize;
  const w = new World(flatMap(N), seed);
  w.fog = false;
  w.env.enabled = false;
  const cx = (N * TILE) / 2, cy = (N * TILE) / 2;
  const g1 = w.spawnGroup(1, a, cx - PROTOCOL.gap / 2, cy, 1, 0);
  const g2 = w.spawnGroup(2, b, cx + PROTOCOL.gap / 2, cy, -1, 0);
  const h0 = [0, 0, 0];
  for (const s of g1) h0[1] += w.maxHp[s];
  for (const s of g2) h0[2] += w.maxHp[s];
  w.orderMove(g1, cx, cy, true);
  w.orderMove(g2, cx, cy, true);
  const period = PROTOCOL.reseek * 30;
  let t = 0;
  for (; t < 30 * PROTOCOL.maxSecs && w.teamCount[1] > 0 && w.teamCount[2] > 0; t++) {
    w.tick();
    w.fxN = 0;
    w.events.length = 0;
    if (t % period === period - 1) {
      for (const tm of [1, 2]) {
        const mine: number[] = [];
        let ex = 0, ey = 0, en = 0;
        for (let i = 0; i < w.n; i++) {
          if (!w.alive[i]) continue;
          if (w.team[i] === tm) mine.push(i);
          else { ex += w.x[i]; ey += w.y[i]; en++; }
        }
        if (en) w.orderMove(mine, ex / en, ey / en, true);
      }
    }
  }
  const h = [0, 0, 0];
  for (let i = 0; i < w.n; i++) if (w.alive[i]) h[w.team[i]] += Math.max(0, w.hp[i]);
  const fa = h[1] / h0[1], fb = h[2] / h0[2];
  return { fa, fb, adv: fa - fb, secs: t / 30 };
}

/** 一个样本：同一对阵换边各打一场，取 a 方优势的平均 */
export function sample(a: number[], b: number[], seed: number): { adv: number; wins: number; secs: number } {
  const r1 = battle(a, b, seed), r2 = battle(b, a, seed + 5000);
  return { adv: (r1.adv - r2.adv) / 2, wins: ((r1.adv > 0 ? 1 : 0) + (r2.adv < 0 ? 1 : 0)) / 2, secs: (r1.secs + r2.secs) / 2 };
}
