/**
 * 对战测量工具：一个对阵（纯数据）与在本进程里跑它。
 * 工作进程（worker.ts）只引用本文件，不引用 runner.ts：打包工作进程时不把 esbuild 与进程池一起打进去。
 */
import { ArmySpec, buildArmy } from './army';
import { sample } from './battle';

export interface Job {
  a: ArmySpec;
  b: ArmySpec;
  seeds: number[];
}
/** 一个样本（换边各一场）的结果 */
export interface Sample {
  adv: number;
  wins: number;
  secs: number;
}

/** 在本进程里跑一个对阵 */
export function runJob(job: Job): Sample[] {
  const a = buildArmy(job.a), b = buildArmy(job.b);
  return job.seeds.map(s => sample(a, b, s));
}
