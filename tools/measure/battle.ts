/** 对战测量工具：测量规程里的一场对战。 */
import { T_GRASS, TILE } from '../../src/sim/defs';
import { GameMap } from '../../src/sim/map';
import { S_ROUT } from '../../src/sim/state';
import { World } from '../../src/sim/world';

/** 规程：双方相距、残部重新寻敌的间隔（秒）、最长时间（秒） */
export const PROTOCOL = { gap: 1400, reseek: 10, maxSecs: 420, mapSize: 160 } as const;

/**
 * 胜负已分就收兵：每 every 秒判一次，败方作战生命（存活且未溃逃的单位的生命 ÷ 开局总生命）不超过 loserMax、
 * 且胜方作战生命至少是败方的 ratio 倍，就结束这一场。标定依据见 docs/unit-stat-model.md
 */
export const DECIDED = { every: 1, loserMax: 0.05, ratio: 4 } as const;

/** 由双方作战生命判胜负是否已分：已分返回胜方（1 或 2），未分返回 0 */
export function decidedWinner(fa: number, fb: number): 0 | 1 | 2 {
  const lo = Math.min(fa, fb), hi = Math.max(fa, fb);
  if (hi <= 0 || lo > DECIDED.loserMax || hi < DECIDED.ratio * lo) return 0;
  return fa > fb ? 1 : 2;
}

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
  /** 胜负已分、提前收兵（见 DECIDED） */
  early: boolean;
}

/**
 * 平地对冲：a 在左、b 在右，都攻击移动到中点；关掉昼夜天气与迷雾，每 10 秒让残部继续寻敌，最长 420 秒。
 * 胜负已分就收兵（DECIDED）：败方剩下的生命（含溃兵）记 0——收尾时残兵与溃兵几乎都会被歼灭；胜方按当时剩余（含溃兵）记，不外推收尾的损失。
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
  const period = PROTOCOL.reseek * 30, check = DECIDED.every * 30;
  let t = 0, winner: 0 | 1 | 2 = 0;
  for (; t < 30 * PROTOCOL.maxSecs && w.teamCount[1] > 0 && w.teamCount[2] > 0 && !winner; t++) {
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
    if (t % check === check - 1) {
      const f = [0, 0, 0];
      for (let i = 0; i < w.n; i++) if (w.alive[i] && !(w.state[i] & S_ROUT)) f[w.team[i]] += Math.max(0, w.hp[i]);
      winner = decidedWinner(f[1] / h0[1], f[2] / h0[2]);
    }
  }
  const h = [0, 0, 0];
  for (let i = 0; i < w.n; i++) if (w.alive[i]) h[w.team[i]] += Math.max(0, w.hp[i]);
  if (winner) h[3 - winner] = 0;
  const fa = h[1] / h0[1], fb = h[2] / h0[2];
  return { fa, fb, adv: fa - fb, secs: t / 30, early: winner !== 0 };
}

/** 一个样本：同一对阵换边各打一场，取 a 方优势的平均 */
export function sample(a: number[], b: number[], seed: number): { adv: number; wins: number; secs: number } {
  const r1 = battle(a, b, seed), r2 = battle(b, a, seed + 5000);
  return { adv: (r1.adv - r2.adv) / 2, wins: ((r1.adv > 0 ? 1 : 0) + (r2.adv < 0 ? 1 : 0)) / 2, secs: (r1.secs + r2.secs) / 2 };
}
