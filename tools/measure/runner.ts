/**
 * 对战测量工具：把一批对阵分给多个工作进程并行跑。
 * 对阵的描述是纯数据，工作进程（worker.ts）在自己的进程里建军队、打样本；
 * 一个对阵按种子切成小段分给不同进程，结果按种子顺序拼回，所以结果与进程数无关。
 */
import { ChildProcess, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
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

export interface Runner {
  /** 跑若干对阵，返回与输入同序的样本数组（每个对阵一个，样本与 seeds 同序） */
  run(jobs: Job[]): Promise<Sample[][]>;
  close(): void;
}

/** 单进程：测试与小规模用 */
export function inProcessRunner(): Runner {
  return { run: async jobs => jobs.map(runJob), close() {} };
}

const CHUNK = 4;

/** 多进程：n 个工作进程，每个跑 `vite-node worker.ts` */
export function poolRunner(n: number): Runner {
  const workerFile = fileURLToPath(new URL('./worker.ts', import.meta.url));
  // 按本工作树的 node_modules 定位：工作树里没装依赖时 vitest 能沿上级目录找到依赖照跑，这里的工作进程却起不来，报「工作进程退出（1）」
  const viteNode = fileURLToPath(new URL('../../node_modules/vite-node/vite-node.mjs', import.meta.url));
  const procs: ChildProcess[] = [];
  const idle: ChildProcess[] = [];
  const pending = new Map<number, { resolve: (s: Sample[]) => void; reject: (e: Error) => void; proc: ChildProcess }>();
  const waiting: (() => void)[] = [];
  let nextId = 0;

  for (let i = 0; i < n; i++) {
    const p = spawn(process.execPath, [viteNode, workerFile], { stdio: ['pipe', 'pipe', 'inherit'] });
    createInterface({ input: p.stdout! }).on('line', line => {
      const msg = JSON.parse(line) as { id: number; samples?: Sample[]; error?: string };
      const job = pending.get(msg.id);
      if (!job) return;
      pending.delete(msg.id);
      if (msg.error) job.reject(new Error(msg.error));
      else job.resolve(msg.samples!);
      idle.push(job.proc);
      waiting.shift()?.();
    });
    p.on('exit', code => {
      for (const [id, job] of pending) if (job.proc === p) { pending.delete(id); job.reject(new Error(`工作进程退出（${code}）`)); }
    });
    procs.push(p);
    idle.push(p);
  }

  async function dispatch(job: Job): Promise<Sample[]> {
    while (!idle.length) await new Promise<void>(r => waiting.push(r));
    const proc = idle.pop()!;
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject, proc });
      proc.stdin!.write(JSON.stringify({ id, job }) + '\n');
    });
  }

  return {
    async run(jobs) {
      return Promise.all(jobs.map(async job => {
        const parts: Job[] = [];
        for (let i = 0; i < job.seeds.length; i += CHUNK) parts.push({ ...job, seeds: job.seeds.slice(i, i + CHUNK) });
        return (await Promise.all(parts.map(dispatch))).flat();
      }));
    },
    close() {
      for (const p of procs) p.kill();
    },
  };
}
