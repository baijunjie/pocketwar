import { T_GRASS } from '../src/sim/defs';
import { GameMap } from '../src/sim/map';
import { World } from '../src/sim/world';
import type { TowerDef, TowerWeapon } from '../src/sim/defs';

/**
 * 一块空旷平地，没有据点和建筑；默认关掉昼夜天气，需要时自己打开。paint 可以在建世界之前改地形。
 * 测试自己摆城墙时，摆完要调 w.sealWalls() 才有城内格、围墙范围和垛口。
 */
export function flatWorld(n = 120, seed = 7, paint?: (terrain: Uint8Array, n: number) => void): World {
  const terrain = new Uint8Array(n * n).fill(T_GRASS);
  paint?.(terrain, n);
  const map: GameMap = {
    seed: 1, w: n, h: n, terrain, height: new Float32Array(n * n),
    dirt: new Uint8Array(n * n), sites: [], buildings: [], props: new Float32Array(0), propChunk: new Int32Array(1),
    chunkW: 0, chunkH: 0, spawn: [], deploy: [],
  };
  const w = new World(map, seed);
  w.fog = false;
  w.env.enabled = false;
  return w;
}

/**
 * 长时间同步的模拟循环里定期让出事件循环（每 every 个 tick 一次），免得 vitest worker 与主进程的通信超时报 Unhandled Error。
 * 用法：循环里 `await breathe(t)`，所在用例要写成 async。
 */
export async function breathe(t: number, every = 600): Promise<void> {
  if (t % every === every - 1) await new Promise<void>(r => setTimeout(r, 0));
}

export function run(w: World, secs: number): void {
  for (let t = 0; t < secs * 30; t++) {
    w.tick();
    w.fxN = 0;
  }
}

/**
 * 没在交手的单位：平均每秒转过多少弧度、白跑了多少路（路程减去净位移）。
 * 用血量无限的靶子时，靶子会被人群推着走，围着它的人跟着漂，这部分也算进白跑。
 */
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

/** 建筑火力里的箭（fan 武器） */
export function arrowsOf(t: TowerDef | null): TowerWeapon {
  return t!.weapons.find(x => x.fan)!;
}

/** 建筑火力里的炮弹（非 fan 武器），没有就是 undefined */
export function shellFire(t: TowerDef | null): TowerWeapon | undefined {
  return t!.weapons.find(x => !x.fan);
}
