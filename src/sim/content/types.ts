/**
 * 内容层的类型与注册表。
 * 「内容」= 可替换的数据：兵种、类别、体型、阵营、建筑、据点、规则数值。
 * 「系统」（src/sim/systems）= 固定算法，只读这些表，不认识任何具体兵种。
 */

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
export const TR_BUSHIDO = 1, TR_TESTUDO = 2, TR_FIREMOVE = 4, TR_TRAMPLE = 8;

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
  /** 反伤（还要乘以对来敌类别的克制倍率） */
  dmg: number;
  speedMul: number;
}
/** 举盾：遇到远程敌人时举盾，移动稍慢，远程减伤 */
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

export interface AuxAttack {
  dmg: number;
  range: number;
  cd: number;
  proj: number;
}

// ---------- 兵种类别 ----------
export interface ClassDef {
  idx: number;
  key: string;
  name: string;
  /** 该类别的缺省属性 */
  base: UnitSpec;
}
export const CLASSES: ClassDef[] = [];
export const CLASS_INDEX: Record<string, number> = {};
export function defineClass(key: string, name: string, base: UnitSpec): number {
  const idx = CLASSES.length;
  CLASSES.push({ idx, key, name, base });
  CLASS_INDEX[key] = idx;
  return idx;
}

// ---------- 兵种 ----------
/** 定义兵种时填写的字段；没填的取类别缺省值，再取全局缺省值 */
export interface UnitSpec {
  /** 体型 key，决定碰撞半径、速度折扣、粮草消耗 */
  size?: string;
  /** 覆盖体型给出的碰撞半径 */
  radius?: number;
  /** 默认队列的排次：0 最前。不填则按速度与射程推算（快的在前） */
  row?: number;
  hp?: number;
  /** 基准机动（未计体型折扣的奔跑速度，像素/秒） */
  pace?: number;
  /** 行军（非战斗状态）速度占奔跑速度的比例 */
  marchMul?: number;
  dmg?: number;
  atk?: number;
  /** 0 为近战 */
  range?: number;
  minRange?: number;
  cd?: number;
  armM?: number;
  armP?: number;
  /** 破甲比例 0..1 */
  pen?: number;
  splash?: number;
  proj?: number;
  /** 对各类别的伤害倍率：类别 key → 倍率 */
  vs?: Record<string, number>;
  vsBld?: number;
  aux?: AuxAttack | null;
  traits?: number;
  abilities?: Abilities;
  vision?: number;
  /** 警戒距离：这个范围内出现敌人即进入战斗状态 */
  alert?: number;
  /** 近战单位的索敌距离（远程按射程推算） */
  acq?: number;
  /** 纪律：士气基准的加减值 */
  discipline?: number;
  /** 人形单位（骑兵也算）：打建筑时改为投掷火把。缺省 true */
  humanoid?: boolean;
  /** 工程类：能破坏城邦的石墙。缺省 false */
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
  cls: number;
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
  dmg: number;
  atk: number;
  range: number;
  minRange: number;
  cd: number;
  armM: number;
  armP: number;
  pen: number;
  splash: number;
  proj: number;
  /** [类别下标] 伤害倍率 */
  vs: number[];
  vsBld: number;
  aux: AuxAttack | null;
  traits: number;
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
  /** 对应的高级 / 初级形态的兵种下标，没有则为 -1 */
  elite: number;
  basic: number;
  // ---- 按等级展开的数值，下标为等级 0..N-1 ----
  lvHp: number[];
  lvDmg: number[];
  lvArmM: number[];
  lvArmP: number[];
  lvCd: number[];
  /** 士气低于此值即溃逃；负数表示死战不退 */
  lvRout: number[];
}

export const UNITS: UnitDef[] = [];
export const UNIT_BY_KEY: Record<string, UnitDef> = {};

/** 登记阶段暂存，finalizeContent() 时统一展开（这样类别、规则可以按任意顺序定义） */
interface Pending {
  faction: FactionId;
  key: string;
  name: string;
  cls: string;
  spec: UnitSpec;
  desc: string;
}
const pending: Pending[] = [];

export function defineUnit(faction: FactionId, key: string, name: string, cls: string, spec: UnitSpec, desc: string): void {
  if (pending.some(p => p.key === key) || UNIT_BY_KEY[key]) throw new Error(`兵种重复：${key}`);
  pending.push({ faction, key, name, cls, spec, desc });
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

/** 把登记的兵种展开成 UnitDef，每个兵种紧跟着生成它的高级形态。hpScale 为全局生命倍率 */
export function finalizeUnits(lv: LevelRules, hpScale: number, elite: EliteRules): void {
  for (const p of pending.splice(0)) {
    const ci = CLASS_INDEX[p.cls];
    if (ci === undefined) throw new Error(`未知类别：${p.cls}`);
    const base = CLASSES[ci].base, s = p.spec;
    const m: UnitSpec = { ...base, ...s };
    const size = SIZE_INDEX[m.size ?? 'small'];
    if (size === undefined) throw new Error(`未知体型：${m.size}`);
    const sz = SIZES[size];
    const vs = CLASSES.map(c => s.vs?.[c.key] ?? base.vs?.[c.key] ?? 1);
    const range = m.range ?? 0;
    const pace = m.pace ?? 56;
    const speed = Math.round(pace * sz.speedMul);
    const cd = m.cd ?? 1.2;
    const splash = m.splash ?? 0;
    const siege = m.siege ?? false;
    const n = lv.thresholds.length;
    const base0: UnitDef = {
      idx: UNITS.length, key: p.key, name: p.name, faction: p.faction, cls: ci, size,
      radius: m.radius ?? sz.radius,
      // 近战在前、远程在后，同一档里快的在前；器械殿后
      row: m.row ?? (speed < 45 ? 4 : (range > 0 ? 2 : 0) + (speed >= 85 ? 0 : 1)),
      hp: 0, pace, speed, walk: Math.round(speed * (m.marchMul ?? 0.65)), forestMul: sz.forestMul,
      dmg: 0, atk: m.atk ?? (range > 0 ? A_PIERCE : A_MELEE), range, minRange: m.minRange ?? 0, cd,
      armM: 0, armP: 0, pen: m.pen ?? 0, splash, proj: m.proj ?? P_ARROW,
      vs, vsBld: m.vsBld ?? 1, aux: m.aux ?? null,
      traits: (base.traits ?? 0) | (s.traits ?? 0),
      abilities: { ...base.abilities, ...s.abilities },
      vision: Math.max(m.vision ?? 320, siege ? range : 0),
      alert: 0, acq: 0, lookK: range > 60 ? Math.min(14, Math.floor(range / TILE)) : 1,
      power: 0, upkeep: sz.upkeep, xpValue: 0,
      discipline: m.discipline ?? 0, humanoid: m.humanoid ?? true, siege, mobile: m.mobile ?? false, model: m.model ?? p.key, desc: p.desc,
      tier: 0, elite: -1, basic: -1,
      lvHp: [], lvDmg: [], lvArmM: [], lvArmP: [], lvCd: [], lvRout: lv.rout.slice(0, n),
    };
    base0.acq = range > 0 ? range + (siege ? 0 : 40) : m.acq ?? 170;
    base0.alert = Math.max(m.alert ?? 300, base0.acq);
    // 初级与高级两个形态：除了生命、攻击、护甲、名称与模型，其余完全一样
    for (let tier = 0; tier < 2; tier++) {
      const hp0 = (m.hp ?? 60) * (tier ? elite.hp : 1), dmg = (m.dmg ?? 8) * (tier ? elite.dmg : 1);
      const armM = (m.armM ?? 0) + (tier ? elite.armor : 0), armP = (m.armP ?? 0) + (tier ? elite.armor : 0);
      const power = Math.sqrt((hp0 / 60) * (dmg / cd / 6.5)) * (range > 0 ? 1.15 : 1) * (splash > 0 ? 1.6 : 1);
      const hp = Math.round(hp0 * hpScale);
      const d: UnitDef = {
        ...base0, idx: UNITS.length, hp, dmg, armM, armP, power, xpValue: Math.round(power * 10), tier,
        lvHp: [], lvDmg: [], lvArmM: [], lvArmP: [], lvCd: [],
      };
      if (tier) {
        d.key = `${p.key}_e`;
        d.name = m.eliteName ?? `${m.elitePrefix ?? elite.prefix}${p.name}`;
        d.model = `${base0.model}_e`;
        d.basic = d.idx - 1;
        UNITS[d.basic].elite = d.idx;
      }
      for (let l = 0; l < n; l++) {
        d.lvHp.push(Math.round(hp * (1 + lv.hp * l)));
        d.lvDmg.push(dmg * (1 + lv.dmg * l));
        d.lvArmM.push(armM + lv.armor * l);
        d.lvArmP.push(armP + lv.armor * l);
        d.lvCd.push(cd * (1 - lv.cd * l));
      }
      UNITS.push(d);
      UNIT_BY_KEY[d.key] = d;
    }
  }
}

// ---------- 阵营 ----------
export type ReinfKind = 'base' | 'levy' | 'mixed' | 'cav' | 'siege' | 'elite';
export interface FactionDef {
  id: FactionId;
  name: string;
  motto: string;
  desc: string;
  traits: string[];
  color: [number, number, number];
  /** 镜像对战时敌方使用的替代色 */
  altColor: [number, number, number];
  /** 初始部队构成：兵种 key → 占比 */
  army: [string, number][];
  /** 初始兵力倍率（平衡用） */
  armyMult: number;
  reinfMult: number;
  reinf: Record<ReinfKind, [string, number][]>;
}

// ---------- 建筑 ----------
export const BK_WALL = 0, BK_GATE = 1, BK_TOWER = 2, BK_KEEP = 3, BK_HOUSE = 4, BK_MAIN = 5;
export interface TowerDef {
  range: number;
  dmg: number;
  cd: number;
  /** 一轮同时放几支箭（各射一个目标，由近及远；目标不够时余下的都射最近那个） */
  arrows: number;
}
export interface BuildingDef {
  key: string;
  name: string;
  kind: number;
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
}

// ---------- 据点 ----------
export const SITE_HQ = 0, SITE_CITY = 1, SITE_TOWN = 2, SITE_CAMP = 3, SITE_VILLAGE = 4, SITE_RANCH = 5,
  SITE_WORKSHOP = 6, SITE_FARM = 7, SITE_LUMBER = 8, SITE_QUARRY = 9, SITE_MINE = 10, SITE_OUTPOST = 11;
/** 可以囤积的资源（粮食另算，见粮草） */
export type ResKind = 'wood' | 'stone' | 'gold';
export const RES_KINDS: ResKind[] = ['wood', 'stone', 'gold'];
export const RES_NAMES: Record<ResKind, string> = { wood: '木材', stone: '石料', gold: '黄金' };
/** 界面上的单字简称 */
export const RES_SHORT: Record<ResKind, string> = { wood: '木', stone: '石', gold: '金' };
export interface SiteInfo {
  label: string;
  /** 占领圈半径（像素） */
  radius: number;
  /** 援军间隔（秒） */
  interval: number;
  /** 出哪一类援军；null 表示不出援军 */
  reinf: ReinfKind | null;
  /** AI 评估的价值 */
  value: number;
  provides: string;
  /** 据点大类：城邦有石墙，营寨是木栅或不设防；资源点只产资源；临时据点是部队自己搭的 */
  category: 'fort' | 'camp' | 'resource' | 'outpost';
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
  /** 计入「占有据点数」（士气） */
  counts: boolean;
  /** 可以建几座箭塔；有敌方箭塔立着时不能占领 */
  towerSlots: number;
  /** 敌占时要先拆毁主建筑才能读秒（主建筑倒了据点即成废墟） */
  razeFirst: boolean;
}
