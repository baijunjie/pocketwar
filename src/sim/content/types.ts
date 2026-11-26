/**
 * 内容层的类型与注册表。
 * 「内容」= 可替换的数据：兵种、原型、特性、体型、阵营、建筑、据点、规则数值。
 * 「系统」（src/sim/systems）= 固定算法，只读这些表，不认识任何具体兵种。
 */

import { DIMS, Dim, LEVEL_RANGES, Levels, Panel, applyLevels, levelPoints, panelPower, powerFromPoints } from './points';

export const TILE = 32;
export const TICK_RATE = 30;
export const DT = 1 / TICK_RATE;

// ---------- 地形 ----------
export const T_DEEP = 0, T_SHALLOW = 1, T_GRASS = 2, T_FOREST = 3, T_HILL = 4, T_MOUNTAIN = 5,
  T_ROAD = 6, T_BRIDGE = 7, T_FARM = 8;
/** 寻路代价 ×10，0 表示不可通行 */
export const TERRAIN_COST = [0, 26, 10, 16, 13, 0, 8, 8, 10];
export const TERRAIN_SPEED = [0, 0.5, 1, 0.7, 0.85, 0, 1.2, 1.1, 0.95];

// ---------- 攻击与投射物 ----------
export const A_MELEE = 0, A_PIERCE = 1, A_SIEGE = 2, A_FIRE = 3;
export const P_ARROW = 0, P_BOLT = 1, P_BULLET = 2, P_JAVELIN = 3, P_STONE = 4, P_ROCKET = 5,
  P_BALL = 6, P_BIGBOLT = 7, P_TORCH = 8;
export const PROJ_SPEED = [430, 520, 1200, 340, 300, 380, 560, 620, 210];
/** 抛物线高度占射程的比例 */
export const PROJ_ARC = [0.16, 0.07, 0, 0.14, 0.42, 0.28, 0.1, 0.03, 0.4];

/** 被动特性（位标志） */
export const TR_BUSHIDO = 1, TR_TESTUDO = 2, TR_FIREMOVE = 4;

export type FactionId = 'china' | 'japan' | 'rome' | 'persia';

// ---------- 体型 ----------
export interface SizeDef {
  key: string;
  name: string;
  radius: number;
  /** 体型越大越慢：实际速度 = 基准机动 pace × speedMul */
  speedMul: number;
  /** 粮草消耗（份/分钟） */
  upkeep: number;
  /** 近战时最多同时被几个敌人围攻 */
  slots: number;
  /** 在森林里的速度倍率（骑马的进了林子跑不起来） */
  forestMul: number;
}
export const SIZES: SizeDef[] = [];
export const SIZE_INDEX: Record<string, number> = {};
export function defineSize(s: SizeDef): void {
  SIZE_INDEX[s.key] = SIZES.length;
  SIZES.push(s);
}

// ---------- 特殊动作（进入战斗状态时触发） ----------
/** 冲锋：隔着一段距离发现敌人时加速突进，撞上的敌人受到冲撞伤害 */
export interface ChargeSpec {
  /** 冲撞伤害 */
  impact: number;
  /** 起冲的最短距离 */
  minDist: number;
  speedMul: number;
  /** 最长持续（秒） */
  duration: number;
  /** 一次冲锋最多撞几个敌人 */
  maxHits: number;
  cooldown: number;
}
/** 拒马：发现有敌人冲过来时立枪，撞上来的敌人受伤并被拦停 */
export interface BraceSpec {
  /** 反伤（还要乘以对来敌兵种的克制倍率） */
  dmg: number;
  speedMul: number;
}
/** 举盾时的移动速度倍率（全兵种统一，不计点） */
export const SHIELD_SPEED_MUL = 0.8;
/** 举盾：遇到远程敌人时举盾，移动稍慢，远程减伤。减免比例是点数维度（举盾），由级数算出 */
export interface ShieldSpec {
  /** 远程伤害减免 0..1 */
  block: number;
  speedMul: number;
}
export interface Abilities {
  charge?: ChargeSpec;
  brace?: BraceSpec;
  shield?: ShieldSpec;
  /** 夜里可以打火把 */
  torch?: boolean;
}

/** 特性上写的副武器：接敌途中投出，不随等级与高级形态加成 */
export interface AuxAttack {
  dmg: number;
  range: number;
  cd: number;
  proj: number;
}

// ---------- 武器 ----------
/** 武器的用途：决定何时用它 */
export const WR_MAIN = 0; // 主武器：持续交战用，决定站位（够不着就上前，够着了停下打）
export const WR_AUX = 1; // 副武器：按距离选用
export const WR_BUILDING = 2; // 对建筑：目标是建筑时代替主武器（人形单位的火把）

export interface Weapon {
  role: number;
  /** 近战：出手直接结算；否则发投射物 */
  melee: boolean;
  /** 伤害类型 A_* */
  atk: number;
  /** 攻击距离：自己与目标身体边缘的间距不超过它就够得着（建筑按贴边的点算） */
  range: number;
  minRange: number;
  proj: number;
  pen: number;
  /** 范围杀伤半径，0 是单体；近战武器大于 0 时出手即以目标为中心杀伤 */
  splash: number;
  /** 按等级展开的单次伤害与间隔，下标为等级 */
  lvDmg: number[];
  lvCd: number[];
}

/** 特性改主武器的字段：伤害类型、范围杀伤半径 */
export interface MainTweak {
  atk?: number;
  splash?: number;
}

/** 副武器：穿刺、单体，各等级数值相同 */
export function auxWeapon(a: AuxAttack, levels: number): Weapon {
  return {
    role: WR_AUX, melee: false, atk: A_PIERCE, range: a.range, minRange: 0, proj: a.proj, pen: 0, splash: 0,
    lvDmg: Array(levels).fill(a.dmg), lvCd: Array(levels).fill(a.cd),
  };
}

/** 武器表与按用途取好的引用 */
export function linkWeapons(weapons: Weapon[]): Pick<UnitDef, 'weapons' | 'main' | 'aux' | 'torch' | 'melee'> {
  const main = weapons.find(w => w.role === WR_MAIN);
  if (!main) throw new Error('兵种没有主武器');
  return {
    weapons, main, aux: weapons.find(w => w.role === WR_AUX) ?? null, torch: weapons.find(w => w.role === WR_BUILDING) ?? null, melee: main.melee,
  };
}

// ---------- 标签 ----------
/** 标签：原型 key 与特性给兵种加的标签（如长柄），克制与受击修正都按标签命中；每个标签占一位 */
export const TAGS: string[] = [];
export function tagBit(key: string): number {
  let i = TAGS.indexOf(key);
  if (i < 0) {
    i = TAGS.length;
    if (i >= 31) throw new Error('标签超过 31 个');
    TAGS.push(key);
  }
  return 1 << i;
}

/** 一条倍率：目标（克制）或攻击方（受击修正）带 tag 里任一标签时乘上 mult */
export interface Mult {
  tag: number;
  mult: number;
}
/** 标签 key → 倍率 */
export type MultTable = Record<string, number>;
const multList = (t: MultTable | undefined): Mult[] => Object.entries(t ?? {}).map(([k, mult]) => ({ tag: tagBit(k), mult }));

// ---------- 原型 ----------
export interface ArchetypeDef {
  idx: number;
  key: string;
  name: string;
  /** 主武器是远程武器（兵种的射程必须大于 0）；否则是近战武器，攻击距离是贴身距离（RULES.combat.meleeContact）加面板的攻击距离 */
  ranged: boolean;
  /** 兵力占用：基准状态下每人占几份兵力（近战步兵为 1）；开局兵力与援军都按份数计，人数 = 份数 ÷ 兵力占用 */
  force: number;
  /** 原型固定克制：打带某个标签的目标的倍率，全阵营一样 */
  counter: MultTable;
  /** 原型固定的受击修正：被带某个标签的攻击方打的倍率 */
  hitMod: MultTable;
  /** 该原型的缺省属性（体型、冲锋等行为与自带特性、不计点的字段） */
  base: UnitSpec;
  /** 原型基准面板（基础单位，点数 0）：兵种的面板由它按级数算出 */
  panel: Panel;
  /** 开放哪些维度：兵种只能在这些维度上加减级数 */
  dims: Dim[];
  /** 为个别维度声明自己的级数范围；没声明的取 LEVEL_RANGES */
  ranges: Partial<Record<Dim, [number, number]>>;
}
export const ARCHETYPES: ArchetypeDef[] = [];
export const ARCHETYPE_INDEX: Record<string, number> = {};
export interface ArchetypeSpec {
  ranged: boolean;
  force: number;
  counter?: MultTable;
  hitMod?: MultTable;
  base?: UnitSpec;
  panel: Panel;
  dims: Dim[];
  ranges?: Partial<Record<Dim, [number, number]>>;
}
export function defineArchetype(key: string, name: string, a: ArchetypeSpec): number {
  const idx = ARCHETYPES.length;
  ARCHETYPES.push({ idx, key, name, ranged: a.ranged, force: a.force, counter: a.counter ?? {}, hitMod: a.hitMod ?? {}, base: a.base ?? {}, panel: a.panel, dims: a.dims, ranges: a.ranges ?? {} });
  ARCHETYPE_INDEX[key] = idx;
  tagBit(key);
  return idx;
}

/** 原型在某个维度上的级数范围：原型自己声明的，没声明的取全局初值 */
export function levelRange(arch: ArchetypeDef, dim: Dim): [number, number] {
  return arch.ranges[dim] ?? LEVEL_RANGES[dim];
}

// ---------- 光环 ----------
/**
 * 光环的加成种类。每种加成要在系统里有对应的结算点，所以种类是固定的表，不由内容层登记；下标即 World.aura 的下标。
 * 加成都是倍率（界面按相对 neutral 的增减百分比显示）。
 * neutral 是没有加成时的值；lowerStronger 为真时数值越小越强（同类光环取最强时取最小的）；
 * [min, max] 是特性上可填的数值范围，填的数还必须比 neutral 强
 */
export interface AuraKindDef {
  key: string;
  name: string;
  neutral: number;
  lowerStronger: boolean;
  min: number;
  max: number;
}
/** 所受远程伤害倍率：远程攻击（投射物）对受益者造成的伤害乘以它，与龟甲阵同一层 */
export const AU_RANGED_TAKEN = 0;
export const AURA_KINDS: readonly AuraKindDef[] = [
  { key: 'rangedTaken', name: '所受远程伤害', neutral: 1, lowerStronger: true, min: 0.3, max: 1 },
];
/** 光环半径（世界像素）的可填范围：小于最小的够不着身边的人，大于最大的一个人就罩住半个战场 */
export const AURA_RADIUS: [number, number] = [16, 240];

/** 特性上写的光环：半径内光环来源以外的己方单位获得加成（kind 是 AURA_KINDS 的 key） */
export interface AuraSpec {
  kind: string;
  radius: number;
  value: number;
}
/** 展开到兵种上的光环：kind 换成 AURA_KINDS 的下标，name 是特性的显示名（供界面显示） */
export interface UnitAura {
  name: string;
  kind: number;
  radius: number;
  value: number;
}

/** 加成 a 是否比 b 强（同类光环取最强的一个） */
export function auraStronger(kind: number, a: number, b: number): boolean {
  return AURA_KINDS[kind].lowerStronger ? a < b : a > b;
}

function checkAura(key: string, a: AuraSpec): void {
  const k = AURA_KINDS.find(x => x.key === a.kind);
  if (!k) throw new Error(`特性 ${key}：未知光环加成种类 ${a.kind}`);
  if (!(a.radius >= AURA_RADIUS[0] && a.radius <= AURA_RADIUS[1])) throw new Error(`特性 ${key}：光环半径 ${a.radius} 越出范围 ${AURA_RADIUS[0]}…${AURA_RADIUS[1]}`);
  if (!(a.value >= k.min && a.value <= k.max)) throw new Error(`特性 ${key}：光环数值 ${a.value} 越出范围 ${k.min}…${k.max}`);
  if (!(k.lowerStronger ? a.value < k.neutral : a.value > k.neutral)) throw new Error(`特性 ${key}：光环数值 ${a.value} 没有加成（无加成为 ${k.neutral}）`);
}

// ---------- 特性 ----------
/** 特性：挂在兵种上的命名能力，带自己的参数 */
export interface TraitDef {
  key: string;
  name: string;
  /** 系统里按位判断的被动特性标志（TR_*） */
  flag: number;
  /** 给兵种加的标签 */
  tags: string[];
  /** 给兵种加的特殊动作 */
  abilities?: Abilities;
  /** 克制：打带某个标签的目标的倍率；兵种可以在使用特性时覆盖其中的数值 */
  counter: MultTable;
  /** 受击修正：被带某个标签的攻击方打的倍率（小于 1 是抗性，大于 1 是弱点） */
  hitMod: MultTable;
  /** 副武器（接敌途中投出的重标枪、弓） */
  aux?: AuxAttack;
  /** 改主武器的字段：伤害类型（如抛射器械的穿刺攻击）、范围杀伤半径（如战象的践踏） */
  main?: MainTweak;
  /** 光环：让身边的己方单位获得加成 */
  aura?: AuraSpec;
  /** 点数：兵种每带一个（原型缺省自带的除外）就加这么多，可以为负（减值，退点） */
  points: number;
}
export const TRAITS: Record<string, TraitDef> = {};
export interface TraitSpec {
  name: string;
  flag?: number;
  tags?: string[];
  abilities?: Abilities;
  counter?: MultTable;
  hitMod?: MultTable;
  aux?: AuxAttack;
  main?: MainTweak;
  aura?: AuraSpec;
  /** 点数，必填，可为负 */
  points: number;
}
export function defineTrait(key: string, t: TraitSpec): void {
  if (TRAITS[key]) throw new Error(`特性重复：${key}`);
  if (!Number.isFinite(t.points)) throw new Error(`特性 ${key}：点数 points 必填，且要是有限数`);
  for (const tag of t.tags ?? []) tagBit(tag);
  if (t.aura) checkAura(key, t.aura);
  TRAITS[key] = {
    key, name: t.name, flag: t.flag ?? 0, tags: t.tags ?? [], abilities: t.abilities, counter: t.counter ?? {}, hitMod: t.hitMod ?? {}, aux: t.aux, main: t.main,
    ...(t.aura ? { aura: { ...t.aura } } : {}), points: t.points,
  };
}
/** 兵种使用特性：只写 key，或写 [key, 覆盖的克制倍率] */
export type TraitUse = string | [string, MultTable];

// ---------- 兵种 ----------
/** 定义兵种时填写的字段；没填的取原型缺省值，再取全局缺省值。点数维度的面板只填级数（lv） */
export interface UnitSpec {
  /** 体型 key，决定碰撞半径、速度折扣、粮草消耗 */
  size?: string;
  /** 覆盖体型给出的碰撞半径 */
  radius?: number;
  /** 默认队列的排次：0 最前。不填则按速度与射程推算（快的在前） */
  row?: number;
  /** 行军（非战斗状态）速度占奔跑速度的比例 */
  marchMul?: number;
  atk?: number;
  minRange?: number;
  proj?: number;
  vsBld?: number;
  /** 特性（原型的缺省特性在前，兵种自己的在后） */
  traits?: TraitUse[];
  /** 各点数维度（生命、输出、节奏、护甲、机动、射程、攻击距离、纪律、冲击、破甲、范围杀伤、举盾）相对原型基准的级数 */
  lv?: Levels;
  abilities?: Abilities;
  vision?: number;
  /** 警戒距离：这个范围内出现敌人即进入战斗状态 */
  alert?: number;
  /** 近战单位的索敌距离（远程按射程推算） */
  acq?: number;
  /** 人形单位（骑兵也算）：打建筑时改为投掷火把。缺省 true */
  humanoid?: boolean;
  /** 工程类：能破坏城池的石墙。缺省 false */
  siege?: boolean;
  /** 能边移动边攻击（骑兵）。其余单位出手时必须站定。缺省 false */
  mobile?: boolean;
  /** 渲染层用哪个模型，缺省与兵种 key 相同 */
  model?: string;
  /** 高级形态的名称；不填则在原名前加 elitePrefix */
  eliteName?: string;
  elitePrefix?: string;
}

export interface UnitDef {
  idx: number;
  key: string;
  name: string;
  faction: FactionId;
  /** 原型下标（ARCHETYPES） */
  arch: number;
  /** 各维度相对原型基准的级数 */
  lv: Levels;
  /** 兵种自己的特性（不含原型缺省自带的），按它们的点数计点 */
  ownTraits: string[];
  /** 兵种点数 = Σ 级数 × 维度单价 + Σ 兵种自己的特性点数；阵营点数与单兵种上下限都用它 */
  points: number;
  /** 标签位（原型标签加特性给的标签） */
  tags: number;
  /** 克制：原型固定克制加特性给的克制 */
  counter: Mult[];
  /** 受击修正：原型固定的加特性给的 */
  hitMod: Mult[];
  size: number;
  radius: number;
  /** 默认队列排次：0 前排，数值越大越靠后 */
  row: number;
  /** 一级时的生命 */
  hp: number;
  pace: number;
  /** 战斗状态下的奔跑速度 */
  speed: number;
  /** 行军速度 */
  walk: number;
  forestMul: number;
  /** 武器表：兵种出手只按武器，数值都在这里 */
  weapons: Weapon[];
  /** 主武器（必有） */
  main: Weapon;
  /** 副武器 */
  aux: Weapon | null;
  /** 对建筑武器（人形单位的火把） */
  torch: Weapon | null;
  /** 主武器是近战 */
  melee: boolean;
  armM: number;
  armP: number;
  /**
   * [目标兵种下标] 本兵种打它的克制倍率（原型固定克制 × 命中的克制 × 目标命中的受击修正，全部相乘）。
   * 展开兵种时预先算好，出手与索敌只查表；新增兵种后用 linkMatchups 补齐。
   */
  vs: number[];
  vsBld: number;
  traits: number;
  /** 光环（来自特性）：系统只读这里，不认兵种 */
  auras: UnitAura[];
  abilities: Abilities;
  vision: number;
  alert: number;
  /** 索敌距离 */
  acq: number;
  /** 沿行军路线向前探查障碍的格数 */
  lookK: number;
  /** AI 估算战力 */
  power: number;
  upkeep: number;
  /** 被击杀时给予的经验 */
  xpValue: number;
  discipline: number;
  humanoid: boolean;
  siege: boolean;
  mobile: boolean;
  model: string;
  desc: string;
  /** 0 初级形态，1 高级形态 */
  tier: number;
  /** 测量工具（tools/measure）造出来登记进兵种表的基准单位或变体，不是正式兵种；正式兵种没有这个标记，用 isContentUnit 判断 */
  probe?: true;
  /** 对应的高级 / 初级形态的兵种下标，没有则为 -1 */
  elite: number;
  basic: number;
  // ---- 按等级展开的数值，下标为等级 0..N-1 ----
  lvHp: number[];
  lvArmM: number[];
  lvArmP: number[];
  /** 士气低于此值即溃逃；负数表示死战不退 */
  lvRout: number[];
}

export const UNITS: UnitDef[] = [];
export const UNIT_BY_KEY: Record<string, UnitDef> = {};

/** 登记阶段暂存，finalizeContent() 时统一展开（这样原型、特性、规则可以按任意顺序定义） */
const pending: UnitInput[] = [];

export function defineUnit(faction: FactionId, key: string, name: string, arch: string, spec: UnitSpec, desc: string): void {
  if (pending.some(p => p.key === key) || UNIT_BY_KEY[key]) throw new Error(`兵种重复：${key}`);
  pending.push({ faction, key, name, arch, spec, desc });
}

export interface LevelRules {
  /** 各级所需累计经验；长度即等级数 */
  thresholds: number[];
  names: string[];
  /** 每升一级的加成 */
  hp: number;
  dmg: number;
  /** 防御：受到的伤害除以 1 + def × 级数 */
  def: number;
  armor: number;
  cd: number;
  /** 各级的溃逃士气阈值，负数 = 死战 */
  rout: number[];
}

/** 高级形态相对初级形态的加成 */
export interface EliteRules {
  hp: number;
  dmg: number;
  /** 近战与远程护甲各加多少 */
  armor: number;
  prefix: string;
}

/** 被击杀时给出的经验值：按原型 key 取，高级形态再乘倍率 */
export interface XpValueRules {
  value: Record<string, number>;
  elite: number;
}

/** 原型加上特性之后的标签、克制、受击修正、被动特性标志与特殊动作 */
export function composeTraits(arch: ArchetypeDef, uses: TraitUse[]): {
  tags: number; counter: Mult[]; hitMod: Mult[]; flags: number; abilities: Abilities; aux: AuxAttack | null; main: MainTweak; auras: UnitAura[];
} {
  const mix = traitMix(uses);
  return {
    tags: tagBit(arch.key) | mix.tags, counter: [...multList(arch.counter), ...mix.counter], hitMod: [...multList(arch.hitMod), ...mix.hitMod],
    flags: mix.flags, abilities: mix.abilities, aux: mix.aux, main: mix.main, auras: mix.auras,
  };
}

/** 一组特性给兵种带来的标签、克制、受击修正、被动特性标志与特殊动作 */
export function traitMix(uses: TraitUse[]): {
  tags: number; counter: Mult[]; hitMod: Mult[]; flags: number; abilities: Abilities; aux: AuxAttack | null; main: MainTweak; auras: UnitAura[];
} {
  let tags = 0, flags = 0;
  const counter: Mult[] = [], hitMod: Mult[] = [];
  const abilities: Abilities = {};
  let aux: AuxAttack | null = null;
  const main: MainTweak = {};
  const auras: UnitAura[] = [];
  for (const u of uses) {
    const [key, over] = typeof u === 'string' ? [u, {}] : u;
    const t = TRAITS[key];
    if (!t) throw new Error(`未知特性：${key}`);
    for (const tag of t.tags) tags |= tagBit(tag);
    flags |= t.flag;
    counter.push(...multList({ ...t.counter, ...over }));
    hitMod.push(...multList(t.hitMod));
    Object.assign(abilities, t.abilities);
    if (t.aux) aux = t.aux;
    if (t.main) Object.assign(main, t.main);
    if (t.aura) auras.push({ name: t.name, kind: AURA_KINDS.findIndex(k => k.key === t.aura!.kind), radius: t.aura.radius, value: t.aura.value });
  }
  return { tags, counter, hitMod, flags, abilities, aux, main, auras };
}

/** 攻击方 a 打目标 t 的倍率：原型固定克制 × a 命中 t 标签的克制 × t 命中 a 标签的受击修正 */
export function matchup(a: UnitDef, t: UnitDef): number {
  let m = 1;
  for (const c of a.counter) if (c.tag & t.tags) m *= c.mult;
  for (const h of t.hitMod) if (h.tag & a.tags) m *= h.mult;
  // 连乘有浮点误差（如 1.2 ÷ 1.2），收到六位小数
  return Math.round(m * 1e6) / 1e6;
}

/** 新兵种已经进了 UNITS 之后，补齐它对所有兵种的倍率与所有兵种对它的倍率 */
export function linkMatchups(d: UnitDef): void {
  d.vs = UNITS.map(t => matchup(d, t));
  for (const u of UNITS) if (u !== d) u.vs[d.idx] = matchup(u, d);
}

/** 一个待展开的兵种 */
export interface UnitInput {
  faction: FactionId;
  key: string;
  name: string;
  /** 原型 key */
  arch: string;
  spec: UnitSpec;
  desc: string;
}

/** 展开兵种用到的全局规则 */
export interface ExpandRules {
  levels: LevelRules;
  /** 全局生命倍率 */
  hpScale: number;
  elite: EliteRules;
  xp: XpValueRules;
  /** 近战武器的攻击距离（贴身距离） */
  meleeContact: number;
  /** 对建筑武器（火把）的距离、伤害、间隔 */
  torch: { range: number; dmg: number; cd: number };
}

/** 原型基准的战力估值（面板的估值式，不含点数） */
export function archetypePower(arch: ArchetypeDef): number {
  const p = arch.panel;
  return panelPower(p.hp, p.dmg, p.cd, p.range > 0, p.splash > 0);
}

/**
 * 把一个兵种展开成 UnitDef：面板由原型基准按级数算出，特性合成标签与克制。
 * withElite 为真时紧跟着生成它的高级形态（两个都没有登记进 UNITS，登记用 registerUnit）。
 */
export function expandUnit(p: UnitInput, R: ExpandRules, withElite = true): UnitDef[] {
  const ai = ARCHETYPE_INDEX[p.arch];
  if (ai === undefined) throw new Error(`未知原型：${p.arch}`);
  const arch = ARCHETYPES[ai], base = arch.base, s = p.spec;
  for (const k of ['hp', 'dmg', 'cd', 'armM', 'armP', 'pace', 'range', 'reach', 'discipline', 'impact', 'pen', 'splash']) {
    if (k in s) throw new Error(`${p.key}：${k} 是点数维度，兵种只填级数（lv）`);
  }
  if (s.abilities?.shield) throw new Error(`${p.key}：举盾是点数维度，兵种只填级数（lv.block）`);
  if ('aux' in s) throw new Error(`${p.key}：副武器用特性挂上去（traits）`);
  if ('atk' in s) throw new Error(`${p.key}：伤害类型用特性改（traits），兵种不直接填`);
  const L = s.lv ?? {};
  for (const k of DIMS) if (L[k] && !arch.dims.includes(k)) throw new Error(`${p.key}：原型 ${arch.key} 没有开放维度 ${k}`);
  for (const k of DIMS) {
    const [lo, hi] = levelRange(arch, k);
    if ((L[k] ?? 0) < lo || (L[k] ?? 0) > hi) throw new Error(`${p.key}：${k} 的级数 ${L[k]} 越出范围 ${lo}…${hi}`);
  }
  const m: UnitSpec = { ...base, ...s };
  const uses = [...(base.traits ?? []), ...(s.traits ?? [])];
  const mix = composeTraits(arch, uses);
  const traitKeys = uses.map(u => (typeof u === 'string' ? u : u[0]));
  const panel = applyLevels(arch.panel, L);
  if (panel.armM < 0 || panel.armP < 0) throw new Error(`${p.key}：护甲低于 0`);
  const abilities: Abilities = { ...base.abilities, ...mix.abilities, ...s.abilities };
  if (panel.block > 0) abilities.shield = { block: panel.block, speedMul: SHIELD_SPEED_MUL };
  if (arch.panel.impact > 0) {
    if (!abilities.charge) throw new Error(`${p.key}：原型 ${arch.key} 有冲击基准但没有冲锋`);
    abilities.charge = { ...abilities.charge, impact: panel.impact };
  } else if (L.imp) throw new Error(`${p.key}：原型 ${arch.key} 没有冲锋，不能加冲击级数`);
  const size = SIZE_INDEX[m.size ?? 'small'];
  if (size === undefined) throw new Error(`未知体型：${m.size}`);
  const sz = SIZES[size];
  const range = panel.range, pace = panel.pace;
  const speed = Math.round(pace * sz.speedMul);
  const siege = m.siege ?? false;
  const n = R.levels.thresholds.length;
  const xpBase = R.xp.value[arch.key];
  if (xpBase === undefined) throw new Error(`原型 ${arch.key} 没有登记经验值`);
  if (arch.ranged !== (range > 0)) throw new Error(`${p.key}：原型 ${arch.key} 是${arch.ranged ? '远程' : '近战'}，射程是 ${range}`);
  // 兵种自己的特性：用到的特性里去掉原型缺省自带的。特性点数不依赖兵种改写的克制倍率
  const carried = (base.traits ?? []).map(u => (typeof u === 'string' ? u : u[0]));
  const ownTraits = traitKeys.filter(t => !carried.includes(t));
  const points = levelPoints(L) + ownTraits.reduce((n, t) => n + TRAITS[t].points, 0);
  const power0 = powerFromPoints(archetypePower(arch), points);
  const base0: Omit<UnitDef, 'weapons' | 'main' | 'aux' | 'torch' | 'melee'> = {
    idx: UNITS.length, key: p.key, name: p.name, faction: p.faction, arch: ai, lv: { ...L }, ownTraits, points,
    tags: mix.tags, counter: mix.counter, hitMod: mix.hitMod, size,
    radius: m.radius ?? sz.radius,
    // 近战在前、远程在后，同一档里快的在前；器械殿后
    row: m.row ?? (speed < 45 ? 4 : (arch.ranged ? 2 : 0) + (speed >= 85 ? 0 : 1)),
    hp: 0, pace, speed, walk: Math.round(speed * (m.marchMul ?? 0.65)), forestMul: sz.forestMul,
    armM: 0, armP: 0,
    vs: [], vsBld: m.vsBld ?? 1,
    traits: mix.flags,
    auras: mix.auras,
    abilities,
    vision: Math.max(m.vision ?? 320, siege ? range : 0),
    alert: 0, acq: 0, lookK: range > 60 ? Math.min(14, Math.floor(range / TILE)) : 1,
    power: 0, upkeep: sz.upkeep, xpValue: 0,
    discipline: panel.discipline, humanoid: m.humanoid ?? true, siege, mobile: m.mobile ?? false, model: m.model ?? p.key, desc: p.desc,
    tier: 0, elite: -1, basic: -1,
    lvHp: [], lvArmM: [], lvArmP: [], lvRout: R.levels.rout.slice(0, n),
  };
  base0.acq = arch.ranged ? range + (siege ? 0 : 40) : m.acq ?? 170;
  base0.alert = Math.max(m.alert ?? 300, base0.acq);
  // 初级与高级两个形态：除了生命、攻击、护甲、名称与模型，其余完全一样；等级与高级形态是全兵种统一的倍率，不计点
  const out: UnitDef[] = [];
  for (let tier = 0; tier < (withElite ? 2 : 1); tier++) {
    const E = R.elite, lv = R.levels;
    const hp0 = panel.hp * (tier ? E.hp : 1), dmg = panel.dmg * (tier ? E.dmg : 1);
    const armM = panel.armM + (tier ? E.armor : 0), armP = panel.armP + (tier ? E.armor : 0);
    const hp = Math.round(hp0 * R.hpScale);
    // 武器在两个形态之间各造各的：只有主武器吃高级形态的攻击倍率，副武器与火把不吃
    const main: Weapon = {
      role: WR_MAIN, melee: !arch.ranged, atk: mix.main.atk ?? m.atk ?? (arch.ranged ? A_PIERCE : A_MELEE),
      range: arch.ranged ? range : R.meleeContact + panel.reach, minRange: m.minRange ?? 0, proj: m.proj ?? P_ARROW, pen: panel.pen,
      splash: mix.main.splash ?? panel.splash, ...weaponLevels(dmg, panel.cd, lv),
    };
    const weapons = [main];
    if (mix.aux) weapons.push(auxWeapon(mix.aux, n));
    if (base0.humanoid) weapons.push(torchWeapon(R.torch, lv));
    const d: UnitDef = {
      ...base0, ...linkWeapons(weapons), hp, armM, armP, tier,
      power: power0 * (tier ? Math.sqrt(E.hp * E.dmg) : 1),
      xpValue: Math.round(xpBase * (tier ? R.xp.elite : 1)),
      lvHp: [], lvArmM: [], lvArmP: [],
    };
    if (tier) {
      d.key = `${p.key}_e`;
      d.name = m.eliteName ?? `${m.elitePrefix ?? E.prefix}${p.name}`;
      d.model = `${base0.model}_e`;
    }
    Object.assign(d, levelTables(d, lv));
    out.push(d);
  }
  return out;
}

/** 是否正式兵种：兵种表里除了兵种定义展开的，还有测量工具登记的基准单位与变体（带 probe 标记），据点出兵、界面列表只认正式兵种 */
export const isContentUnit = (d: UnitDef): boolean => !d.probe;

/** 按等级展开的生命与护甲（下标为等级） */
export function levelTables(d: Pick<UnitDef, 'hp' | 'armM' | 'armP'>, lv: LevelRules): Pick<UnitDef, 'lvHp' | 'lvArmM' | 'lvArmP'> {
  const t = { lvHp: [] as number[], lvArmM: [] as number[], lvArmP: [] as number[] };
  for (let l = 0; l < lv.thresholds.length; l++) {
    t.lvHp.push(Math.round(d.hp * (1 + lv.hp * l)));
    t.lvArmM.push(d.armM + lv.armor * l);
    t.lvArmP.push(d.armP + lv.armor * l);
  }
  return t;
}

/** 主武器按等级展开的单次伤害与间隔（下标为等级）：按等级规则逐级加成 */
export function weaponLevels(dmg: number, cd: number, lv: LevelRules): Pick<Weapon, 'lvDmg' | 'lvCd'> {
  const t = { lvDmg: [] as number[], lvCd: [] as number[] };
  for (let l = 0; l < lv.thresholds.length; l++) {
    t.lvDmg.push(dmg * (1 + lv.dmg * l));
    t.lvCd.push(cd * (1 - lv.cd * l));
  }
  return t;
}

/** 对建筑武器（火把）：伤害随等级加成，不乘高级形态倍率，间隔各级相同 */
export function torchWeapon(t: ExpandRules['torch'], lv: LevelRules): Weapon {
  const n = lv.thresholds.length;
  return {
    role: WR_BUILDING, melee: false, atk: A_FIRE, range: t.range, minRange: 0, proj: P_TORCH, pen: 0, splash: 0,
    lvDmg: Array.from({ length: n }, (_, l) => t.dmg * (1 + lv.dmg * l)), lvCd: Array(n).fill(t.cd),
  };
}

/** 把展开好的兵种登记进兵种表：排在已有兵种之后，并补齐克制倍率表。高级形态跟在初级形态后面传入 */
export function registerUnit(...ds: UnitDef[]): void {
  for (const d of ds) {
    d.idx = UNITS.length;
    if (d.tier) {
      d.basic = d.idx - 1;
      UNITS[d.basic].elite = d.idx;
    }
    UNITS.push(d);
    UNIT_BY_KEY[d.key] = d;
    linkMatchups(d);
  }
}

/** 把登记的兵种展开成 UnitDef，每个兵种紧跟着生成它的高级形态 */
export function finalizeUnits(R: ExpandRules): void {
  for (const p of pending.splice(0)) registerUnit(...expandUnit(p, R));
}

// ---------- 阵营 ----------
export interface FactionDef {
  id: FactionId;
  name: string;
  motto: string;
  desc: string;
  traits: string[];
  color: [number, number, number];
  /** 镜像对战时敌方使用的替代色 */
  altColor: [number, number, number];
  /** 开局编制：兵种 key → 占全军兵力的比重，之和为 1 */
  army: [string, number][];
  /** 兵员级数：开局兵力份数的阵营级维度，每级 ×1.035（MANPOWER_STEP），可以取小数；兵员倍率只由它给出（见 manpowerMult） */
  manpower: number;
  /** 援军级数：城池、城镇援军份数的阵营级维度，每级 ×1.035（REINF_STEP），可以取小数；援军倍率只由它给出（见 reinforceMult）。营寨的每批份数固定，不受它影响 */
  reinfLevel: number;
  /** 城池、城镇的全兵种援军编成：兵种 key → 兵力份数（人数 = 份数 × 援军倍率 ÷ 兵力占用，每个兵种至少 1 人） */
  reinf: [string, number][];
}

// ---------- 建筑 ----------
export const BK_WALL = 0, BK_GATE = 1, BK_TOWER = 2, BK_KEEP = 3, BK_HOUSE = 4, BK_MAIN = 5;
/**
 * 建筑角色：军事建筑（会放箭，占领前必须拆光）、城防（只挡路，占领时不用拆）、
 * 普通建筑（不可被攻击，范围伤害也不伤它）
 */
export const BR_MILITARY = 0, BR_DEFENSE = 1, BR_COMMON = 2;
export type BuildingRole = typeof BR_MILITARY | typeof BR_DEFENSE | typeof BR_COMMON;
/** 防御建筑的一把武器：每轮齐射 burst 发 */
export interface TowerWeapon {
  /** 伤害类型 A_* */
  atk: number;
  dmg: number;
  /** 投射物种类 P_* */
  proj: number;
  pen: number;
  /** 范围杀伤半径，0 是单体 */
  splash: number;
  /** 一轮放几发 */
  burst: number;
  /** 真：各发由近及远各射一个目标，目标不够时余下的都射最近那个；假：全打最近的敌人 */
  fan: boolean;
}
/** 防御建筑的火力：整座建筑共用一个射程与冷却，到点就把武器表里的武器依次齐射一轮 */
export interface TowerDef {
  range: number;
  cd: number;
  weapons: TowerWeapon[];
}
/** 某一级的据点加成（建筑的生命、护甲、箭伤、射程，以及升到这一级的花费） */
export interface SiteLevelSpec {
  hp: number;
  armor: number;
  dmg: number;
  range: number;
  /** 升到这一级的花费是 upgradeCost 的几倍（1 级不用升，填 0） */
  cost: number;
}
export interface TierThree {
  /** 3 级时的名称（角楼 → 炮楼） */
  name: string;
  /** 箭矢数量倍数，缺省 1 */
  arrowMul?: number;
  /** 每轮加几发炮弹，缺省 0 */
  shells?: number;
}
export interface BuildingDef {
  key: string;
  name: string;
  kind: number;
  role: BuildingRole;
  /** 能被攻击：普通建筑不能（临时据点的行营例外，它是唯一要打的目标） */
  hittable: boolean;
  w: number;
  h: number;
  hp: number;
  armM: number;
  armP: number;
  /** 寻路时穿过它的额外代价（×10） */
  breach: number;
  tower: TowerDef | null;
  /** 贴图在占地之上的高度（像素） */
  tall: number;
  wood: boolean;
  /** 城防工事（石墙）：人形单位的火把烧不动，只有工程类单位能破坏 */
  fort: boolean;
  /** 顶上可以站人（石墙、角楼）：己方单位能从城内一侧走上去驻守，站立高度（像素）；0 表示不能 */
  top: number;
  /** 所在据点升到 3 级后的变化；没有的话 3 级与 2 级相同 */
  tier3?: TierThree;
}

// ---------- 据点 ----------
export const SITE_CITY = 0, SITE_TOWN = 1, SITE_CAMP = 2,
  SITE_FARM = 3, SITE_LUMBER = 4, SITE_QUARRY = 5, SITE_MINE = 6, SITE_OUTPOST = 7;
/** 可以囤积的资源（粮食另算，见粮草） */
export type ResKind = 'wood' | 'stone' | 'gold';
export const RES_KINDS: ResKind[] = ['wood', 'stone', 'gold'];
export const RES_NAMES: Record<ResKind, string> = { wood: '木材', stone: '石料', gold: '黄金' };
/** 界面上的单字简称 */
export const RES_SHORT: Record<ResKind, string> = { wood: '木', stone: '石', gold: '金' };
export interface SiteInfo {
  label: string;
  /** 占领圈半径（像素），只用于没有围墙的据点（资源点、临时据点）；有围墙的据点（城池、营寨）的范围是围墙矩形，不看它（渲染只借它是否大于 0 判断有没有据点范围） */
  radius: number;
  /** 援军间隔（秒） */
  interval: number;
  /** 出哪种援军：full 出阵营的全兵种表，pick 出占领方选定的那一个兵种；null 表示不出援军 */
  reinf: 'full' | 'pick' | null;
  /** full 类：援军表里每个兵种的数量倍率（同一张表在不同规模的据点里按它缩放） */
  reinfScale: number;
  /** pick 类：每批援军的兵力份数（人数 = 份数 × 难度倍率（只有电脑一方）÷ 所选兵种的兵力占用，至少 1 人） */
  reinfForce: number;
  /** AI 评估的价值 */
  value: number;
  provides: string;
  /** 据点大类：城池有石墙，营寨有木栅；资源点只产资源；临时据点是部队自己搭的 */
  category: 'city' | 'camp' | 'resource' | 'outpost';
  /** 清空守军后，在旗帜下站多少秒才算占领；0 表示不能占领 */
  captureTime: number;
  /** 粮草产量：能养活「开局全军」的百分之几 */
  food: number;
  /** 每分钟的产出：木材、石料是绝对数量，黄金是「开局全军口粮」的百分之几 */
  yields?: Partial<Record<ResKind, number>>;
  /** 升级与加速修缮用哪种资源 */
  material: 'wood' | 'stone';
  /** 升级花费（material 那种资源）；0 表示不能升级 */
  upgradeCost: number;
  /** 算作可以落脚的据点：部队在里面休整回血、溃兵往这里逃、雪天有遮蔽 */
  haven: boolean;
  /** 计入「占有据点数」（士气）；一方此类据点全部丢失即判负 */
  counts: boolean;
  /** 可以建几座哨塔；军事建筑（含自建的哨塔）没拆光不能占领 */
  towerSlots: number;
  /** 建筑会自行修复、倒塌的自行重建（交战中停）；资源点没有恢复能力 */
  regen: boolean;
}
