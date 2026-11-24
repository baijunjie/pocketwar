/**
 * 指挥官接口：一方部队由谁来下令。模拟层只认这个接口，具体算法可以随意替换或新增。
 */
import type { Site, World } from '../world';

export interface Commander {
  /** 每个模拟帧调用一次；自行决定多久思考一次 */
  update(): void;
  /** 开局分到的一队兵；guard 表示守备队 */
  addGroup(slots: number[], guard: boolean): void;
  /** 新到的援军 */
  addReinforcements(slots: number[]): void;
  /** 给自己的一座营寨选出哪个兵种的援军，返回兵种下标；缺省的指挥官不选，营寨出缺省兵种 */
  pickCampUnit?(site: Site): number;
}

export type CommanderFactory = (w: World, team: number, level: number) => Commander;

/** 已登记的指挥算法；GameOptions.ai 按名字选用 */
export const COMMANDERS: Record<string, CommanderFactory> = {};
export function registerCommander(name: string, make: CommanderFactory): void {
  COMMANDERS[name] = make;
}
