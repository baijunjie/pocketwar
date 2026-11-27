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
 * 逐帧观察一批单位里没在交手的（够不着敌人的），统计他们在等待中是在走还是站着：
 * - walkRatio：等待中（waitT > 0）的帧里，这一帧位移不低于奔跑速度 15% 的占比；
 * - frozen：平均每帧有多少人已连续不动超过 3 秒（不论是否在等待）；
 * - turnsPerSec：游走掉头的次数除以等待的人秒数；
 * - waitFrames：等待的人帧数（样本量）；
 * - idle：全程至少有一半时间没在交手的人数。
 * 用血量无限的靶子时，靶子会被人群推着走，围着它的人跟着漂；这里只看位移的有无，不受影响。
 */
export function watchProwl(w: World, slots: number[], secs: number): {
  walkRatio: number; frozen: number; turnsPerSec: number; waitFrames: number; idle: number;
} {
  const n = slots.length, frames = secs * 30;
  const still = new Int32Array(n), free = new Int32Array(n);
  let waitFrames = 0, walkFrames = 0, turns = 0, frozenSum = 0;
  for (let t = 0; t < frames; t++) {
    const px = slots.map(s => w.x[s]), py = slots.map(s => w.y[s]), pp = slots.map(s => w.prowl[s]);
    w.tick();
    w.fxN = 0;
    slots.forEach((s, k) => {
      if (!w.alive[s] || w.engaged[s]) {
        still[k] = 0;
        return;
      }
      free[k]++;
      const moved = Math.hypot(w.x[s] - px[k], w.y[s] - py[k]);
      const walking = moved >= w.defs[w.type[s]].speed * 0.15 / 30;
      still[k] = walking ? 0 : still[k] + 1;
      if (still[k] > 90) frozenSum++;
      if (w.waitT[s] > 0) {
        waitFrames++;
        if (walking) walkFrames++;
        if (Math.abs(w.prowl[s]) === 2 && Math.abs(pp[k]) !== 2) turns++;
      }
    });
  }
  return {
    walkRatio: waitFrames ? walkFrames / waitFrames : 0,
    frozen: frozenSum / frames,
    turnsPerSec: waitFrames ? turns / (waitFrames / 30) : 0,
    waitFrames,
    idle: free.filter(f => f >= frames / 2).length,
  };
}

/** 建筑火力里的箭（fan 武器） */
export function arrowsOf(t: TowerDef | null): TowerWeapon {
  return t!.weapons.find(x => x.fan)!;
}

/** 建筑火力里的炮弹（非 fan 武器），没有就是 undefined */
export function shellFire(t: TowerDef | null): TowerWeapon | undefined {
  return t!.weapons.find(x => !x.fan);
}
