/**
 * 模型说明的类型，以及把说明变成可绘制模型的总入口。
 *
 * 渲染器只认 UnitModel 上的「标准动作名」，不关心模型是代码拼的还是 glTF 读的：
 *   idle 待命　walk 行军　run 奔跑　attack 攻击　die 阵亡（这五个建议都有）
 *   attackMove 边跑边打　charge 冲锋　brace 立枪　guard 举盾站立　guardWalk 举盾行进（可选）
 * 缺少的动作按 CLIP_FALLBACK 退到相近的动作，所以新素材只要有待命、移动、攻击、阵亡就能用。
 */
import * as THREE from 'three';
import { asset } from '../assets';
import { Puppet, RigBuilder, UnitModel, skinnedBox } from '../rig';
import { M, cannon, ballista, elephant, foot, horse, onager, rocketCart, trebuchet } from './builders';
import { MODELS } from './catalog';
import type { HumanLook } from './human';

export const DEFAULT_MOUNT = 'quaternius/horse.glb';

export interface FootSpec {
  kind: 'foot';
  human: HumanLook;
}
export interface HorseSpec {
  kind: 'horse';
  human: HumanLook;
  coat?: number;
  /** 马甲颜色 */
  barding?: number;
  /** 全身马甲：连马头、四腿上半截一起披甲 */
  bardingFull?: boolean;
  size?: number;
  /** 坐骑模型的素材路径，缺省用仓库里的那匹马 */
  mount?: string;
}
export interface EngineSpec {
  kind: 'elephant' | 'onager' | 'trebuchet' | 'ballista' | 'rocket' | 'cannon';
  /** 高级形态：包铁、加挡板（战象披甲） */
  armored?: boolean;
}
/** 直接使用一个带骨骼动画的 glTF / GLB 模型 */
export interface GltfSpec {
  kind: 'gltf';
  /** 相对 public/assets/ 的路径 */
  src: string;
  /** 模型应有的高度（米）；按包围盒等比缩放 */
  height: number;
  /** 模型自身朝向与「前方 = +X」的夹角（弧度）。多数素材面朝 +Z，填 Math.PI / 2 */
  yaw?: number;
  /** 标准动作名 → 素材里的动画名；可以再给出截取的时长（秒） */
  clips: Partial<Record<string, string | { name: string; seconds?: number }>>;
  /** 走 / 跑一个动画循环前进多少米，用来让脚步和位移对上 */
  stride?: { walk?: number; run?: number };
  /** 把素材里色相落在这个区间（0..1）的颜色换成队伍色 */
  teamHue?: [number, number];
  /** 头像取景高度（米），缺省等于 height */
  portrait?: number;
}
export type ModelSpec = FootSpec | HorseSpec | EngineSpec | GltfSpec;

export const CLIP_FALLBACK: Record<string, string[]> = {
  walk: ['run', 'idle'],
  run: ['walk', 'idle'],
  attack: ['idle'],
  attackMove: ['attack', 'idle'],
  die: ['idle'],
  charge: ['run', 'walk', 'idle'],
  brace: ['idle'],
  guard: ['idle'],
  guardWalk: ['walk', 'run', 'idle'],
};

/** 运行时登记 / 替换某个模型（也可以直接改 catalog.ts） */
export function registerModel(id: string, spec: ModelSpec): void {
  MODELS[id] = spec;
}

export function modelSpec(id: string): ModelSpec {
  const s = MODELS[id];
  if (!s) throw new Error(`没有登记模型：${id}`);
  return s;
}

/** 登记表里用到的全部素材文件 */
export function modelAssets(): string[] {
  const set = new Set<string>();
  for (const s of Object.values(MODELS)) {
    if (s.kind === 'gltf') set.add(s.src);
    else if (s.kind === 'horse') set.add(s.mount ?? DEFAULT_MOUNT);
  }
  return [...set];
}

/** 把任意 glTF 骨骼模型烘成 UnitModel */
export function gltfModel(L: GltfSpec, team: THREE.Color): UnitModel {
  const rb = new RigBuilder();
  const p = new Puppet(asset(L.src));
  rb.root.add(p.scene);
  p.scene.rotation.y = L.yaw ?? 0;
  const size = skinnedBox(p.scene).getSize(new THREE.Vector3());
  p.scene.scale.multiplyScalar((L.height * M) / (size.y || 1));
  const hsl = { h: 0, s: 0, l: 0 };
  const hue = L.teamHue;
  rb.addSkinned(p.scene, hue ? () => c => {
    c.getHSL(hsl);
    if (hsl.s > 0.25 && hsl.h >= hue[0] && hsl.h <= hue[1]) c.copy(team).multiplyScalar(0.5 + hsl.l);
  } : undefined);
  const names = [...p.durations.keys()];
  if (!names.length) throw new Error(`${L.src} 里没有动画`);
  for (const [std, src] of Object.entries(L.clips)) {
    if (!src) continue;
    const name = typeof src === 'string' ? src : src.name;
    const dur = p.durations.get(name);
    if (dur === undefined) throw new Error(`${L.src} 里没有动画「${name}」，可用的有：${names.join('、')}`);
    const seconds = (typeof src === 'string' ? undefined : src.seconds) ?? dur;
    // 阵亡动作停在最后一帧，别的动作首尾相接
    const last = std === 'die' ? dur * 0.98 : Infinity;
    rb.clip(std, Math.max(0.1, seconds), t => p.pose([{ clip: name, t: Math.min(t, last) }]), std === 'idle' ? 10 : 30);
  }
  return rb.build({ walk: (L.stride?.walk ?? 1.4) * M, run: (L.stride?.run ?? 2.8) * M });
}

export function buildUnitModel(id: string, teamRgb: [number, number, number]): UnitModel {
  const L = modelSpec(id);
  const team = new THREE.Color().setRGB(teamRgb[0] / 255, teamRgb[1] / 255, teamRgb[2] / 255, THREE.SRGBColorSpace);
  switch (L.kind) {
    case 'foot': return foot(L, team);
    case 'horse': return horse(L, team);
    case 'elephant': return elephant(team, L.armored);
    case 'onager': return onager(team, L.armored);
    case 'trebuchet': return trebuchet(team, L.armored);
    case 'ballista': return ballista(team, L.armored);
    case 'rocket': return rocketCart(team, L.armored);
    case 'cannon': return cannon(team, L.armored);
    case 'gltf': return gltfModel(L, team);
  }
}

/** 头像取景高度（世界像素） */
export function portraitHeight(id: string, modelHeight: number): number {
  const L = modelSpec(id);
  if (L.kind === 'foot') return 19 * (L.human.size ?? 1);
  if (L.kind === 'horse') return 28 * (L.size ?? 1);
  if (L.kind === 'gltf') return (L.portrait ?? L.height) * M;
  return Math.min(modelHeight, 46);
}
