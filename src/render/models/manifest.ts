/**
 * 兵种模型素材清单（public/assets/units/manifest.json）：模型 id → 用哪份 glTF、套哪个动作库与持械姿态。
 * 格式与素材要求见 docs/unit-art-spec.md。本文件只做解析与查找，不碰 three.js，可在 Node 里测试。
 */

import { CLIP_FALLBACK, STD_ACTIONS, StdAction } from './actions';

/** 素材里的动作：名字，可再给截取的时长（秒） */
export type ClipRef = string | { name: string; seconds?: number };

/** 一份骨骼模型 */
export interface RigPart {
  /** 相对 public/assets/ 的路径 */
  src: string;
  /** 动作库名（清单 libraries 的键）；不写只用模型自带的动作 */
  anims?: string;
  /** 持械姿态：动作库里的动作名前缀，如 sword_shield → sword_shield.attack */
  set?: string;
  /** 标准动作名 → 素材里的动作名，优先于按 set 查找 */
  clips?: Partial<Record<StdAction, ClipRef>>;
}

interface Common {
  /** 整体缩放，缺省 1（素材按米做） */
  scale?: number;
  /** 不按 scale，而是等比缩放到这个高度（米）；预览来路不明的素材时用 */
  height?: number;
  /** 模型自身朝向与「前方 = +X」的夹角（弧度），缺省 π/2（glTF 惯例面朝 +Z） */
  yaw?: number;
  /** walk、run 一个循环前进的米数 */
  stride?: { walk?: number; run?: number };
  /** 头像取景高度（米） */
  portrait?: number;
}

export interface RigSpec extends RigPart, Common {
  kind: 'rig';
}

export interface MountedSpec extends Common {
  kind: 'mounted';
  /** 骑手：人形骨架，ride_* 姿态 */
  rider: RigPart;
  /** 坐骑；seat 是骑手根节点跟随的骨骼名，缺省 saddle */
  mount: RigPart & { seat?: string };
}

export type AssetSpec = RigSpec | MountedSpec;

export interface Manifest {
  /** 动作库名 → 路径（相对 public/assets/） */
  libraries: Record<string, string>;
  models: Record<string, AssetSpec>;
}

export const EMPTY_MANIFEST: Manifest = { libraries: {}, models: {} };

const isNum = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v) && v > 0;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function checkPart(p: unknown, where: string, libs: Record<string, string>): void {
  if (!isObj(p) || typeof p.src !== 'string' || !p.src) throw new Error(`${where}：缺少 src`);
  if (p.anims !== undefined && !(typeof p.anims === 'string' && p.anims in libs)) throw new Error(`${where}：没有动作库「${String(p.anims)}」`);
  if (p.set !== undefined && typeof p.set !== 'string') throw new Error(`${where}：set 要是字符串`);
  if (p.clips !== undefined) {
    if (!isObj(p.clips)) throw new Error(`${where}：clips 要是对象`);
    for (const [k, v] of Object.entries(p.clips)) {
      if (!(STD_ACTIONS as readonly string[]).includes(k)) throw new Error(`${where}：clips 里「${k}」不是标准动作名`);
      const ok = typeof v === 'string' ? v !== '' : isObj(v) && typeof v.name === 'string' && (v.seconds === undefined || isNum(v.seconds));
      if (!ok) throw new Error(`${where}：clips 里「${k}」要是动作名，或 { name, seconds }`);
    }
  }
  if (p.seat !== undefined && typeof p.seat !== 'string') throw new Error(`${where}：seat 要是骨骼名`);
}

function checkCommon(m: Record<string, unknown>, where: string): void {
  for (const k of ['scale', 'height', 'portrait']) if (m[k] !== undefined && !isNum(m[k])) throw new Error(`${where}：${k} 要是正数`);
  if (m.yaw !== undefined && typeof m.yaw !== 'number') throw new Error(`${where}：yaw 要是数字`);
  if (m.stride !== undefined) {
    if (!isObj(m.stride)) throw new Error(`${where}：stride 要是 { walk, run }`);
    for (const k of ['walk', 'run']) if (m.stride[k] !== undefined && !isNum(m.stride[k])) throw new Error(`${where}：stride.${k} 要是正数`);
  }
}

/** 校验并取出清单；格式不对时抛出带位置的错误 */
export function parseManifest(json: unknown): Manifest {
  if (!isObj(json)) throw new Error('清单要是 JSON 对象');
  const libraries = json.libraries ?? {};
  const models = json.models ?? {};
  if (!isObj(libraries) || Object.values(libraries).some(v => typeof v !== 'string')) throw new Error('libraries 要是「名字 → 路径」');
  if (!isObj(models)) throw new Error('models 要是「模型 id → 规格」');
  const libs = libraries as Record<string, string>;
  for (const [id, m] of Object.entries(models)) {
    if (!isObj(m)) throw new Error(`模型 ${id}：规格要是对象`);
    checkCommon(m, `模型 ${id}`);
    if (m.kind === 'rig') checkPart(m, `模型 ${id}`, libs);
    else if (m.kind === 'mounted') {
      checkPart(m.rider, `模型 ${id} 的 rider`, libs);
      checkPart(m.mount, `模型 ${id} 的 mount`, libs);
    } else throw new Error(`模型 ${id}：kind 要是 rig 或 mounted`);
  }
  return { libraries: libs, models: models as Record<string, AssetSpec> };
}

/**
 * 某个标准动作在素材里叫什么：先看 clips 指定；再在本姿态里找「姿态.动作」，没有就沿 CLIP_FALLBACK
 * 找本姿态里相近的动作（如 sword_shield.attackMoveL → sword_shield.attack），但不退到待命；
 * 再找不带前缀的通用「动作」；都没有才用本姿态的待命。
 * 动作库里不带前缀的动作可能是为别的姿态做的（如弓手的回身射），所以排在本姿态的退路之后；
 * 待命排在通用动作之后，免得通用的阵亡动作被本姿态的站立盖掉。
 * @param has 素材（连同动作库）里有哪些动作
 */
export function resolveClip(part: RigPart, std: StdAction, has: (name: string) => boolean): { name: string; seconds?: number } | null {
  const given = part.clips?.[std];
  if (given) return typeof given === 'string' ? { name: given } : given;
  if (part.set) {
    for (const a of [std, ...(CLIP_FALLBACK[std] ?? [])]) {
      if (a === 'idle' && std !== 'idle') continue;
      if (has(`${part.set}.${a}`)) return { name: `${part.set}.${a}` };
    }
  }
  if (has(std)) return { name: std };
  if (part.set && has(`${part.set}.idle`)) return { name: `${part.set}.idle` };
  return null;
}

/** 清单里查模型：高级形态（id_e）没登记时沿用初级形态的 */
export function manifestEntry(m: Manifest, id: string): AssetSpec | undefined {
  return m.models[id] ?? (id.endsWith('_e') ? m.models[id.slice(0, -2)] : undefined);
}

/** 一条模型规格用到的素材文件 */
export function entryAssets(m: Manifest, s: AssetSpec): string[] {
  const out: string[] = [];
  const part = (p: RigPart): void => {
    out.push(p.src);
    if (p.anims) out.push(m.libraries[p.anims]);
  };
  if (s.kind === 'rig') part(s);
  else {
    part(s.rider);
    part(s.mount);
  }
  return out;
}

/** 去掉用到这些（加载失败的）文件的模型，它们退回代码建模 */
export function withoutAssets(m: Manifest, failed: Set<string>): Manifest {
  const models: Record<string, AssetSpec> = {};
  for (const [id, s] of Object.entries(m.models)) if (!entryAssets(m, s).some(f => failed.has(f))) models[id] = s;
  return { libraries: m.libraries, models };
}

/** 清单用到的全部素材文件 */
export function manifestAssets(m: Manifest): string[] {
  return [...new Set(Object.values(m.models).flatMap(s => entryAssets(m, s)))];
}
