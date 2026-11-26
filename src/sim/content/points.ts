/**
 * 点数：兵种按「原型基准 + 各维度级数 + 特性」描述，点数是兵种强弱的统一尺度。
 * 1 点 = 标准混编军全军生命加 1 级（×1.05）带来的战果变化。兵种点数像给人物加属性点一样按价目表计账（估算点数），
 * 阵营点数、单兵种上下限、战力估值都用它；价目表在原型基准上实测一次（tools/measure 的「prices」命令生成，不手改），
 * 不依赖具体兵种。兵种整体的对战实测（tools/measure/data/unit-points.json）只作参考，用来发现估算的偏差。
 */
import prices from './prices.json';

// ---------- 维度与阶梯 ----------
/** 各维度的级数；没写的为 0。级数都相对原型基准 */
export interface Levels {
  /** 生命 */ hp?: number;
  /** 输出：攻击间隔缩短，单次伤害不变 */ out?: number;
  /** 节奏：单次伤害与间隔同乘 */ cad?: number;
  /** 近战护甲 */ armM?: number;
  /** 远程护甲 */ armP?: number;
  /** 机动 */ spd?: number;
  /** 射程 */ rng?: number;
  /** 攻击距离：近战武器比贴身多够得着几排 */ reach?: number;
  /** 纪律 */ disc?: number;
  /** 冲击：冲撞伤害 */ imp?: number;
  /** 治疗：神职落地后启用，兵种表里还没有治疗量 */ heal?: number;
  /** 破甲：打击时无视目标护甲的比例 */ pen?: number;
  /** 范围杀伤：落点的杀伤半径 */ splash?: number;
  /** 举盾：举盾时远程伤害的减免比例（大于 0 才有举盾） */ block?: number;
}
export type Dim = keyof Levels;
export const DIMS: Dim[] = ['hp', 'out', 'cad', 'armM', 'armP', 'spd', 'rng', 'reach', 'disc', 'imp', 'heal', 'pen', 'splash', 'block'];
export const DIM_NAMES: Record<Dim, string> = {
  hp: '生命', out: '输出', cad: '节奏', armM: '近战护甲', armP: '远程护甲', spd: '机动', rng: '射程', reach: '攻击距离', disc: '纪律', imp: '冲击', heal: '治疗',
  pen: '破甲', splash: '范围杀伤', block: '举盾',
};

/**
 * 阶梯的步长：护甲每级 +1，其余是倍率（纪律是士气基准的加数）。
 * 破甲、范围杀伤、举盾是加数（基准可以为 0）：破甲每级 +0.1，范围杀伤半径每级 +2，举盾减免每级 +0.05。
 * 攻击距离也是加数，每级 +15 像素，即多够得着一排：攻击距离的价值不随距离连续变化，只在够得着隔一排自己人的敌人时跳一档
 * （小型单位贴身站一排约占 14 像素，对面隔着一排自己人的敌人离自己的身体边缘 17…21），所以一级就取一排，不设中间档
 */
export const STEP = { hp: 1.05, out: 1.05, cad: 1.15, spd: 1.03, rng: 1.04, reach: 15, disc: 2, imp: 1.08, heal: 1.05, pen: 0.1, splash: 2, block: 0.05 };

/**
 * 级数范围：兵种每个维度的级数都要落在里面（原型可以为个别维度另行声明，见 levelRange）。
 * 射程由初值 −4…+6 放宽到 −6…+6：现有 14 个开放射程的兵种里有 3 个越限（超过两成），按规则放宽到八成落在范围内，
 * 离得最远的两个（投矛散兵 −14、连弩兵 −11）去掉后下限取火箭车的 −6，这两个仍算越限、收进范围。
 * 破甲 0…8（0…80%）、举盾 0…14（0…70%）、范围杀伤 −15…+5（半径 0…40，抛射器械基准 30）：按现有兵种的分布定，覆盖全部现有兵种。
 * 攻击距离 0…+2（最多隔两排自己人出手）：基准就是贴身，没有负级数
 */
export const LEVEL_RANGES: Record<Dim, [number, number]> = {
  hp: [-6, 12], out: [-6, 12], cad: [-8, 8], armM: [-3, 8], armP: [-3, 8], spd: [-4, 6], rng: [-6, 6], reach: [0, 2], disc: [-3, 6], imp: [-3, 6], heal: [-4, 8],
  pen: [0, 8], splash: [-15, 5], block: [0, 14],
};

/** 单兵种上下限：兵种点数（估算点数，UnitDef.points）要落在里面 */
export const UNIT_POINT_LIMITS: [number, number] = [-2, 5];

/**
 * 阵营点数预算：每个阵营的阵营点数（tools/measure/faction.ts 的 factionPoints）不超过它。
 * 取现有四阵营阵营点数的中位数（兵员级数取迁移前阵营特色倍率换算的级数）；阵营的差额用兵员级数补
 */
export const FACTION_BUDGET = 4.685;

/**
 * 援军预算：每个阵营的援军点数（tools/measure/faction.ts 的 reinfPoints，全兵种援军表按与开局同一套算法计点）不超过它。
 * 取现有阵营援军点数（援军级数按 0，即援军倍率 1）的中位数；阵营的差额用援军级数补。
 * 价目或兵种表变了（含援军表与阵营增减）按 npm run measure -- reinf --write 重算
 */
export const REINF_BUDGET = 4.448;

/** 点数维度上的面板：原型基准。生命是展开前的数（不含全局生命倍率） */
export interface Panel {
  hp: number;
  dmg: number;
  cd: number;
  armM: number;
  armP: number;
  /** 基准机动（未计体型折扣的奔跑速度） */
  pace: number;
  /** 0 为近战 */
  range: number;
  /** 近战武器的攻击距离比贴身距离多出的部分，0 是贴身 */
  reach: number;
  discipline: number;
  /** 冲撞伤害，0 表示没有冲锋 */
  impact: number;
  /** 破甲比例 */
  pen: number;
  /** 范围杀伤半径，0 是单体 */
  splash: number;
  /** 举盾的远程减免比例，0 是不举盾 */
  block: number;
}

/** 加数阶梯累加的浮点误差收到六位小数（0.1 × 6 = 0.6000000000000001） */
const round6 = (x: number): number => Math.round(x * 1e6) / 1e6;

/** 在基准面板上按级数算出面板 */
export function applyLevels(b: Panel, L: Levels): Panel {
  const cad = STEP.cad ** (L.cad ?? 0);
  return {
    hp: b.hp * STEP.hp ** (L.hp ?? 0),
    dmg: b.dmg * cad,
    cd: b.cd * cad / STEP.out ** (L.out ?? 0),
    armM: b.armM + (L.armM ?? 0),
    armP: b.armP + (L.armP ?? 0),
    pace: b.pace * STEP.spd ** (L.spd ?? 0),
    range: b.range > 0 ? Math.round(b.range * STEP.rng ** (L.rng ?? 0)) : 0,
    reach: b.reach + STEP.reach * (L.reach ?? 0),
    discipline: b.discipline + STEP.disc * (L.disc ?? 0),
    impact: b.impact * STEP.imp ** (L.imp ?? 0),
    pen: round6(b.pen + STEP.pen * (L.pen ?? 0)),
    splash: b.splash + STEP.splash * (L.splash ?? 0),
    block: round6(b.block + STEP.block * (L.block ?? 0)),
  };
}

// ---------- 位置 ----------
/**
 * 标准混编军里的位置：按原型分，带长柄的近战步兵单独一个位置。价目表与兵种测量都按位置。
 * trait 是位置要求带的特性，位置基准 = 原型基准 + 这个特性。
 * ref 是这个位置在标准混编军里顶替的位置（缺省是自己）：标准混编军的人数构成只按自己的位置排，
 * 顶替的位置不进标准混编军，它的价目与兵种实测在「把 ref 位置整个换成它的基准」的标准混编军上量，参照组也是这支军队。
 */
export const POSITIONS: Record<string, { arch: string; trait?: string; name: string; ref?: string }> = {
  inf: { arch: 'inf', name: '近战步兵' },
  spear: { arch: 'inf', trait: 'polearm', name: '近战步兵（长柄）' },
  ranged: { arch: 'ranged', name: '远程步兵' },
  cav: { arch: 'cav', name: '近战骑兵' },
  cavr: { arch: 'cavr', name: '远程骑兵' },
  siege: { arch: 'siege', name: '抛射器械' },
  ele: { arch: 'vehicle', name: '载具' },
  bolt: { arch: 'bolt', name: '直射器械', ref: 'siege' },
};

/** 兵种所在的位置：同原型，带位置要求的特性就归带特性的位置，否则归不带的 */
export function positionOf(archKey: string, hasTrait: (trait: string) => boolean): string {
  const cands = Object.entries(POSITIONS).filter(([, p]) => p.arch === archKey);
  const hit = cands.find(([, p]) => p.trait && hasTrait(p.trait)) ?? cands.find(([, p]) => !p.trait);
  if (!hit) throw new Error(`没有对应的位置：${archKey}`);
  return hit[0];
}

// ---------- 价目表 ----------
export interface PriceTable {
  /** 生成时原型基准、特性与规则的指纹 */
  fingerprint?: string;
  /** 位置 → 维度 → [加级每级几点, 减级每级几点]；减级的数是「每少一级少几点」，估算时乘以负的级数 */
  dims: Record<string, Partial<Record<Dim, [number, number]>>>;
  /** 位置 → 特性 → 点数（位置基准带上它与不带它之差） */
  traits: Record<string, Record<string, number>>;
  /** 阵营的兵员每级几点（加级减级同价，全阵营共用）：标准混编军每个位置都按兵员加级加人量出 */
  manpower: number;
}
export const PRICES = prices as unknown as PriceTable;

/**
 * 战略维度：机动、射程、纪律。平地会战里量不出价值（价目取地板价），只按高于基准的级数 × 加级价目计，
 * 低于基准不计、不退点。理由：这三样加级的好处在平地量不出，不计就能白堆；减级的损失只在整局里，不能倒找点数
 */
export const STRATEGIC_DIMS: Dim[] = ['spd', 'rng', 'disc'];

/** 一个维度的点数：加级 × 加级价目，减级 × 减级价目；战略维度减级不计 */
export function dimPoints(k: Dim, lv: number, p: [number, number]): number {
  if (lv > 0) return p[0] * lv;
  return STRATEGIC_DIMS.includes(k) ? 0 : p[1] * lv;
}

/**
 * 兵种点数（估算点数）= Σ 各维度的点数 + 特性价目。traits 是兵种自己的特性（不含位置基准本来就带的）。
 * 用到的维度或特性在价目表里没有条目（显式记 0 的不算）直接报错：缺格按 0 会让人白拿
 */
export function estimatePoints(pos: string, L: Levels, traits: string[], table: PriceTable = PRICES): number {
  let pts = 0;
  const dims = table.dims[pos];
  for (const k of DIMS) {
    const lv = L[k];
    if (!lv) continue;
    const p = dims?.[k];
    if (!p) throw new Error(`价目表缺格：${pos} 的 ${k}`);
    pts += dimPoints(k, lv, p);
  }
  for (const t of traits) {
    const v = table.traits[pos]?.[t];
    if (v === undefined) throw new Error(`价目表缺格：${pos} 的特性 ${t}`);
    pts += v;
  }
  return pts;
}

/** 面板的战力估值（原型基准用）：生命与每秒伤害乘积的平方根，远程、范围杀伤加成 */
export function panelPower(hp: number, dmg: number, cd: number, ranged: boolean, splash: boolean): number {
  return Math.sqrt((hp / 60) * (dmg / cd / 6.5)) * (ranged ? 1.15 : 1) * (splash ? 1.6 : 1);
}

/** 战力估值 = 原型基准的战力估值 × 1.05 的（点数 ÷（生命价目 + 输出价目））次方，即把点数折成「生命与输出各加几级」 */
export function powerFromPoints(basePower: number, pos: string, points: number, table: PriceTable = PRICES): number {
  const d = table.dims[pos];
  const unit = (d?.hp?.[0] ?? 0) + (d?.out?.[0] ?? 0);
  return unit > 0.01 ? basePower * 1.05 ** (points / unit) : basePower;
}
