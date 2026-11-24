/** 对战测量工具的工作进程：从标准输入逐行读对阵，打完把样本逐行写回标准输出。由 runner.ts 启动。 */
import { createInterface } from 'node:readline';
import { Job, runJob } from './runner';

createInterface({ input: process.stdin }).on('line', line => {
  const { id, job } = JSON.parse(line) as { id: number; job: Job };
  try {
    process.stdout.write(JSON.stringify({ id, samples: runJob(job) }) + '\n');
  } catch (e) {
    process.stdout.write(JSON.stringify({ id, error: String(e) }) + '\n');
  }
});
