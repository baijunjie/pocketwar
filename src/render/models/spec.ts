/**
 * 模型说明的类型，以及把说明变成可绘制模型的总入口。
 *
 * 模型从两处来：素材清单 public/assets/units/manifest.json 登记的 glTF（优先，见 manifest.ts 与 docs/unit-art-spec.md），
 * 没登记的退回 catalog.ts 里代码建模的说明。模型与队伍色无关：要染色的部位在烘焙时标进 aTeam，绘制时按实例上色。
 *
 * 渲染器只认 UnitModel 上的「标准动作名」（actions.ts 的 STD_ACTIONS），不关心模型是代码拼的还是 glTF 读的。
 * 缺少的动作按 CLIP_FALLBACK 退到相近的动作，所以新素材只要有待命、移动、攻击、阵亡就能用。
 */
import { TEAM_MARK, UnitModel } from '../rig';
import { M, cannon, ballista, elephant, foot, horse, onager, rocketCart, trebuchet } from './builders';
import { MODELS } from './catalog';
import { mountedModel, rigModel } from './gltf';
import type { HumanLook } from './human';
import { loadAssets } from '../assets';
import { AssetSpec, EMPTY_MANIFEST, Manifest, manifestAssets, manifestEntry, parseManifest, withoutAssets } from './manifest';

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
export type ModelSpec = FootSpec | HorseSpec | EngineSpec;

let manifest: Manifest = EMPTY_MANIFEST;

/**
 * 读取素材清单；没有清单时只用代码建模。须在 modelAssets() 之前调用。
 * 清单写错时整份不用（全部退回代码建模），在控制台报错并返回错误，不让游戏起不来。
 */
export async function loadModelManifest(): Promise<Error | null> {
  const res = await fetch(`${import.meta.env.BASE_URL}assets/units/manifest.json`).catch(() => null);
  // 开发服务器对不存在的文件会回 index.html，按内容类型判断
  if (!res?.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null;
  try {
    manifest = parseManifest(await res.json());
    return null;
  } catch (e) {
    console.error('素材清单 manifest.json 有误，改用代码建模：', e);
    return e as Error;
  }
}

/**
 * 读清单并预加载全部模型素材。清单登记的文件加载失败时，用到它的模型改走退路（高级形态先借初级形态的素材，否则代码建模；
 * 控制台报错），不让游戏起不来；只在清单登记、没有代码建模的模型没有退路，到烘焙时报「没有登记模型」。
 * @returns 加载失败的文件
 */
export async function loadUnitModels(): Promise<string[]> {
  await loadModelManifest();
  const list = modelAssets();
  const res = await Promise.allSettled(list.map(f => loadAssets([f])));
  const failed = list.filter((_, k) => res[k].status === 'rejected');
  if (!failed.length) return [];
  // 代码建模自己要的素材（马）也坏了就没有退路，照样报错
  const code = codeAssets();
  if (failed.some(f => code.has(f))) throw new Error(`模型素材加载失败：${failed.join('、')}`);
  console.error('这些模型素材加载失败，用到它们的兵种改用退路：', failed);
  manifest = withoutAssets(manifest, new Set(failed));
  return failed;
}

/** 运行时登记 / 替换某个代码建模的模型（也可以直接改 catalog.ts） */
export function registerModel(id: string, spec: ModelSpec): void {
  MODELS[id] = spec;
}

/** 模型 id 用的是清单里的素材还是代码建模 */
export function modelSpec(id: string): AssetSpec | ModelSpec {
  const s = manifestEntry(manifest, id) ?? MODELS[id];
  if (!s) throw new Error(`没有登记模型：${id}`);
  return s;
}

/** 代码建模要用的素材文件（骑兵的马） */
function codeAssets(): Set<string> {
  const set = new Set<string>();
  for (const s of Object.values(MODELS)) if (s.kind === 'horse') set.add(s.mount ?? DEFAULT_MOUNT);
  return set;
}

/** 要预加载的全部素材文件 */
export function modelAssets(): string[] {
  return [...new Set([...manifestAssets(manifest), ...codeAssets()])];
}

/** 烘焙失败、已退回代码建模的素材模型 id */
const broken = new Set<string>();

/**
 * 实际用哪份说明：清单素材优先；素材烘焙出错过的退回代码建模。
 * 高级形态的素材坏了（加载失败或烘焙出错）先沿用初级形态的素材，初级也坏了才退代码建模，与加载失败的退路一致。
 */
function effectiveSpec(id: string): AssetSpec | ModelSpec {
  if (!broken.has(id)) return modelSpec(id);
  const base = id.endsWith('_e') ? id.slice(0, -2) : null;
  const b = base && manifest.models[id] && !broken.has(base) ? manifestEntry(manifest, base) : undefined;
  // 都没有时回到清单条目重烘一次，让烘焙出错的原错误报出来
  return b ?? MODELS[id] ?? modelSpec(id);
}

/**
 * 烘焙一个模型（与队伍无关，双方共用）。
 * @param strict 素材模型烘焙出错时直接抛出（预览页用）；缺省在控制台报错并走退路（见 effectiveSpec）
 */
export function buildUnitModel(id: string, strict = false): UnitModel {
  const L = effectiveSpec(id);
  if (L.kind === 'rig' || L.kind === 'mounted') {
    try {
      return L.kind === 'rig' ? rigModel(manifest, L) : mountedModel(manifest, L);
    } catch (e) {
      if (strict) throw e;
      // 没有退路（借不到初级形态的素材、也没有代码建模）就照样报错
      const base = id.endsWith('_e') ? id.slice(0, -2) : null;
      // 只有 id_e 有自己的清单条目时才有得借；没登记的本来就在用初级形态的素材
      const borrow = base && manifest.models[id] && !broken.has(id) && !broken.has(base) && manifestEntry(manifest, base);
      if (!borrow && !MODELS[id]) throw e;
      console.error(`模型 ${id} 的素材烘焙出错，改用退路：`, e);
      // 已在用退路（高级形态借初级形态的素材）还出错，就是初级形态的素材坏了
      if (broken.has(id)) broken.add(id.slice(0, -2));
      broken.add(id);
      return buildUnitModel(id);
    }
  }
  // 代码建模把队伍色部位画成 TEAM_MARK，烘焙时换成 aTeam
  const team = TEAM_MARK;
  switch (L.kind) {
    case 'foot': return foot(L, team);
    case 'horse': return horse(L, team);
    case 'elephant': return elephant(team, L.armored);
    case 'onager': return onager(team, L.armored);
    case 'trebuchet': return trebuchet(team, L.armored);
    case 'ballista': return ballista(team, L.armored);
    case 'rocket': return rocketCart(team, L.armored);
    case 'cannon': return cannon(team, L.armored);
  }
}

/** 头像取景高度（世界像素） */
export function portraitHeight(id: string, modelHeight: number): number {
  const L = effectiveSpec(id);
  if (L.kind === 'foot') return 19 * (L.human.size ?? 1);
  if (L.kind === 'horse') return 28 * (L.size ?? 1);
  if (L.kind === 'rig' || L.kind === 'mounted') return L.portrait !== undefined ? L.portrait * M : Math.min(modelHeight, L.kind === 'mounted' ? 28 : 46);
  return Math.min(modelHeight, 46);
}
