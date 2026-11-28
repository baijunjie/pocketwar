/**
 * 3000 单位混战的单帧模拟耗时。给 tests/sim.test.ts 的性能用例用：先用 esbuild 打包、再用单独的 node 进程跑，
 * 量到的才是玩家实际跑的那份代码的耗时。直接在 vitest 里计时会偏高好几倍：那里每次读 import 进来的绑定都要过一层 getter，
 * 热循环的开销被放大，放大多少还随代码怎么拆模块而变。
 * 同一场景跑两遍、只报第二遍：第一遍里引擎还在边跑边编译，耗时是稳定之后的两倍多，量的不是模拟本身。
 * 结果作为一行 JSON 打到标准输出：{ units, median, avg, worst, lost }（毫秒；worst 不计头几帧）。
 * median 是各帧耗时的中位数：机器上并行跑着别的任务时，个别帧会被抢占拖到几十上百毫秒，平均值跟着翻倍，中位数基本不动
 */
import { createGame } from '../../src/sim/setup';

const FRAMES = 300;

function battle(): { units: number; median: number; avg: number; worst: number; lost: number[] } {
  const g = createGame({ seed: 9, factions: ['rome', 'persia'], armySize: 2100, difficulty: 1, fog: true, spectate: false });
  const w = g.world;
  // 把双方主力拉到同一处开战
  const all: number[][] = [[], [], []];
  for (let i = 0; i < w.n; i++) if (w.alive[i]) all[w.team[i]].push(i);
  const cx = w.W / 2, cy = w.H / 2 + 900;
  for (const tm of [1, 2]) {
    for (const s of all[tm]) {
      w.x[s] = cx + (tm === 1 ? -500 : 500) + ((s * 37) % 700) - 350;
      w.y[s] = cy + ((s * 91) % 900) - 450;
    }
    w.orderMove(all[tm], cx, cy, true);
  }
  const units = w.teamCount[1] + w.teamCount[2];
  const frames: number[] = [];
  let worst = 0, sum = 0;
  for (let t = 0; t < FRAMES; t++) {
    const t0 = performance.now();
    w.tick();
    const dt = performance.now() - t0;
    // 特效缓冲平时由渲染层清空
    w.fxN = 0;
    frames.push(dt);
    sum += dt;
    if (t > 5 && dt > worst) worst = dt;
  }
  frames.sort((a, b) => a - b);
  return { units, median: frames[FRAMES >> 1], avg: sum / FRAMES, worst, lost: [w.lost[1], w.lost[2]] };
}

battle();
console.log(JSON.stringify(battle()));
