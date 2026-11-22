import { T_GRASS } from '../src/sim/defs';
import { GameMap } from '../src/sim/map';
import { World } from '../src/sim/world';

/** 一块空旷平地，没有据点和建筑；默认关掉昼夜天气，需要时自己打开 */
export function flatWorld(n = 120, seed = 7): World {
  const map: GameMap = {
    seed: 1, w: n, h: n, terrain: new Uint8Array(n * n).fill(T_GRASS), height: new Float32Array(n * n),
    dirt: new Uint8Array(n * n), sites: [], buildings: [], props: new Float32Array(0), propChunk: new Int32Array(1),
    chunkW: 0, chunkH: 0, spawn: [], deploy: [],
  };
  const w = new World(map, seed);
  w.fog = false;
  w.env.enabled = false;
  return w;
}

export function run(w: World, secs: number): void {
  for (let t = 0; t < secs * 30; t++) {
    w.tick();
    w.fxN = 0;
  }
}

/** 没在交手的单位：平均每秒转过多少弧度、白跑了多少路（路程减去净位移） */
export function spinStats(w: World, slots: number[], secs: number): { turn: number; wander: number; idle: number } {
  const n = slots.length;
  const turn = new Float64Array(n), path = new Float64Array(n), x0 = new Float64Array(n), y0 = new Float64Array(n);
  const samples = new Float64Array(n);
  slots.forEach((s, k) => {
    x0[k] = w.x[s];
    y0[k] = w.y[s];
  });
  for (let t = 0; t < secs * 30; t++) {
    const pd = slots.map(s => w.dir[s]), px = slots.map(s => w.x[s]), py = slots.map(s => w.y[s]);
    w.tick();
    w.fxN = 0;
    slots.forEach((s, k) => {
      if (!w.alive[s] || w.engaged[s]) return;
      let d = w.dir[s] - pd[k];
      if (d > Math.PI) d -= Math.PI * 2;
      else if (d < -Math.PI) d += Math.PI * 2;
      turn[k] += Math.abs(d);
      path[k] += Math.hypot(w.x[s] - px[k], w.y[s] - py[k]);
      samples[k]++;
    });
  }
  let tSum = 0, wSum = 0, cnt = 0;
  slots.forEach((s, k) => {
    if (!w.alive[s] || samples[k] < secs * 15) return;
    const sec = samples[k] / 30;
    tSum += turn[k] / sec;
    wSum += Math.max(0, path[k] - Math.hypot(w.x[s] - x0[k], w.y[s] - y0[k])) / sec;
    cnt++;
  });
  return { turn: cnt ? tSum / cnt : 0, wander: cnt ? wSum / cnt : 0, idle: cnt };
}
