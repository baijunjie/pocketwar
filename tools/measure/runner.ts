/**
 * 对战测量工具：把一批对阵分给多个工作进程并行跑。
 * 对阵的描述是纯数据，工作进程（worker.ts）在自己的进程里建军队、打样本；
 * 一个对阵按种子切成小段分给不同进程，结果按种子顺序拼回，所以结果与进程数无关。
 * 工作进程跑的是 esbuild 打包后的 worker.ts，不用 vite-node 直接跑源码：vite-node 下热循环每读一次 import 进来的绑定都要过一层 getter，
 * 同一场对战打包后快约一倍，结果逐位相同。
 */
import { ChildProcess, execFileSync, spawn } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { buildSync } from 'esbuild';
import { readdirSync, rmSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { Job, Sample, runJob } from './job';

export type { Job, Sample };
export { runJob };

export interface Runner {
  /** 跑若干对阵，返回与输入同序的样本数组（每个对阵一个，样本与 seeds 同序） */
  run(jobs: Job[]): Promise<Sample[][]>;
  close(): void;
}

/** 单进程：测试与小规模用 */
export function inProcessRunner(): Runner {
  return { run: async jobs => jobs.map(runJob), close() {} };
}

/** 读本机性能核的物理核数（macOS 的 hw.perflevel0.physicalcpu）；读不到（别的系统、命令失败）返回 undefined */
export function readPerfCores(): number | undefined {
  try {
    return Number(execFileSync('sysctl', ['-n', 'hw.perflevel0.physicalcpu'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim());
  } catch {
    return undefined;
  }
}

/**
 * 缺省的工作进程数：本机性能核数；读不到或不是正整数时用逻辑核数；至少 1。
 * 能效核比性能核慢得多，进程开到能效核上，分到那里的分片会拖慢整批，所以只按性能核开
 */
export function defaultWorkers(perfCores: () => number | undefined = readPerfCores, logical: () => number = availableParallelism): number {
  const p = perfCores();
  if (p !== undefined && Number.isInteger(p) && p > 0) return p;
  return Math.max(1, Math.floor(logical()) || 1);
}

const CHUNK = 4;

let bundles = 0;
const BUNDLE_NAME = /^worker-(\d+)-\d+\.mjs$/;

/** 删掉 out/ 里进程已不在的打包文件：被中断（Ctrl+C、崩溃）的测量来不及在 close 时删 */
function removeStaleBundles(): void {
  const dir = fileURLToPath(new URL('./out/', import.meta.url));
  let files: string[] = [];
  try {
    files = readdirSync(dir);
  } catch {
    return;
  }
  for (const f of files) {
    const pid = Number(BUNDLE_NAME.exec(f)?.[1]);
    if (!pid || pid === process.pid || alive(pid)) continue;
    rmSync(dir + f, { force: true });
  }
}

/** 进程是否还在（发 0 号信号只检查、不打扰；没有权限也说明它在） */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as { code?: string }).code === 'EPERM';
  }
}

/**
 * 把 worker.ts 连同它引用的模拟层代码打成一个 Node 能直接跑的文件，返回文件路径。
 * 放在 out/（不进版本库），每个进程池按当前源码各打一份、文件名带进程号与序号：同时起的几个进程池（如并行跑的测试）不会读到别人写了一半的文件
 */
export function bundleWorker(): string {
  removeStaleBundles();
  const outfile = fileURLToPath(new URL(`./out/worker-${process.pid}-${bundles++}.mjs`, import.meta.url));
  buildSync({
    entryPoints: [fileURLToPath(new URL('./worker.ts', import.meta.url))],
    outfile, bundle: true, platform: 'node', format: 'esm', logLevel: 'warning',
  });
  return outfile;
}

/** 多进程：n 个工作进程，每个用 node 跑打包后的 worker.ts（见文件头） */
export function poolRunner(n: number): Runner {
  const bundle = bundleWorker();
  const procs: ChildProcess[] = [];
  const idle: ChildProcess[] = [];
  const pending = new Map<number, { resolve: (s: Sample[]) => void; reject: (e: Error) => void; proc: ChildProcess }>();
  const waiting: (() => void)[] = [];
  let nextId = 0;

  for (let i = 0; i < n; i++) {
    const p = spawn(process.execPath, [bundle], { stdio: ['pipe', 'pipe', 'inherit'] });
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
      rmSync(bundle, { force: true });
    },
  };
}
