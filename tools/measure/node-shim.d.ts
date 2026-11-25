/**
 * 本工具用到的那几个 Node 接口的最小类型声明。
 * 项目没有装 @types/node（游戏本体不跑在 Node 里，测试用的 Node 接口由 Vitest 带进来），这里只声明工具用到的部分，不另加依赖。
 */
declare const process: {
  argv: string[];
  pid: number;
  kill(pid: number, signal: number): void;
  execPath: string;
  stdin: unknown;
  stdout: { write(s: string): void };
  exit(code?: number): never;
};

declare module 'node:child_process' {
  export interface ChildProcess {
    stdin: { write(s: string): void } | null;
    stdout: unknown;
    kill(): void;
    on(ev: 'exit', cb: (code: number | null) => void): this;
  }
  export function spawn(cmd: string, args: string[], opts: { stdio: unknown[] }): ChildProcess;
  export function execFileSync(cmd: string, args: string[], opts: { encoding: 'utf8'; stdio: unknown[] }): string;
}
declare module 'node:readline' {
  export function createInterface(o: { input: unknown }): { on(ev: 'line', cb: (line: string) => void): unknown };
}
declare module 'node:url' {
  export function fileURLToPath(u: URL | string): string;
}
declare module 'node:fs' {
  export function mkdirSync(p: string, o?: { recursive: boolean }): void;
  export function writeFileSync(p: string, s: string): void;
  export function readFileSync(p: string, enc: 'utf8'): string;
  export function readdirSync(p: string, o?: { recursive: boolean }): string[];
}
declare module 'node:path' {
  export function resolve(...p: string[]): string;
  export function dirname(p: string): string;
}
declare module 'node:crypto' {
  export function createHash(alg: string): { update(s: string): { digest(enc: 'hex'): string } };
}
declare module 'node:fs' {
  export function appendFileSync(p: string, s: string): void;
  export function rmSync(p: string, o?: { force: boolean }): void;
  export function existsSync(p: string): boolean;
}
declare module 'node:os' {
  export function availableParallelism(): number;
}
