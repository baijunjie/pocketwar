/**
 * 点数：兵种按「原型基准 + 各维度级数 + 特性」描述，点数是兵种强弱的统一尺度，也是纯粹的配置资源。
 * 1 点 = 生命 1 级（×1.05）。价目是设计出来的固定规则：各维度一个单价（DIM_PRICE，所有原型共用，加级花点、减级退点同价），
 * 各特性在 defineTrait 里声明自己的点数；不由对战决定，不随战斗、行军代码变化，战场上谁强也不是平衡目标。
 * 兵种点数 = Σ 级数 × 维度单价 + Σ 兵种自己的特性点数；阵营点数 = Σ 兵力比重 × 兵种点数 + 兵员级数 × 兵员单价，
 * 各阵营的点数上限相同（FACTION_BUDGET），差额由兵员级数补。
 */

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

/** 单兵种上下限：兵种点数（UnitDef.points）要落在里面 */
export const UNIT_POINT_LIMITS: [number, number] = [-12, 24];

/**
 * 维度单价：每级几点，所有原型共用，加级花点、减级退点同价。1 点 = 生命 1 级（×1.05）。
 * - 生命 1：定义。
 * - 输出 1：每秒伤害 ×1.05，对「生命 × 输出」的贡献与生命 ×1.05 相同。
 * - 近战护甲、远程护甲各 1：每级让对应类型的伤害少一成多（基准攻击 9 打护甲 2→3 少 13%），约合 3 级有效生命；
 *   攻击越重越不管用（攻击 15 约 2 级，冲撞与攻城伤害几乎不减），平均按 2 级，又只对近战或远程一类伤害有效，按一半场合。
 * - 节奏 0.5：每秒伤害不变，只是单发更重、更能打穿护甲（对护甲 2 的目标一级约多 4% 有效伤害，对无甲没有）。
 * - 机动、射程、纪律 0.5：不直接改变生命与输出。
 * - 冲击 0.5：冲锋只是骑兵输出的一部分。
 * - 破甲 0.5：对护甲 3 的目标约多 4% 伤害，对无甲没有。
 * - 举盾 0.5：每级再减 5% 远程伤害，约合 1 级对远程的有效生命，远程按一半场合。
 * - 范围杀伤 1.5：半径 30 时每级杀伤面积约 +14%，落点周围不总有那么多人，按一半多计。
 * - 攻击距离 8：后排隔着一排自己人也能出手，战线上同时出手的人最多翻倍；战线不总站得满两排、隔排也不是每个目标都够得着，
 *   按多一半计，ln 1.5 ÷ ln 1.05 ≈ 8 级输出。
 * - 治疗 1：未启用，占位。
 */
export const DIM_PRICE: Record<Dim, number> = {
  hp: 1, out: 1, cad: 0.5, armM: 1, armP: 1, spd: 0.5, rng: 0.5, disc: 0.5, imp: 0.5, pen: 0.5, block: 0.5, splash: 1.5, reach: 8, heal: 1,
};

/**
 * 兵员单价：每级兵员（人数 ×1.035）几点。人数 ×1.035 使全军总生命与总输出各 ×1.035，
 * 各合 ln 1.035 ÷ ln 1.05 ≈ 0.7 级，按生命、输出各 1 点计。援军级数同价。
 */
export const MANPOWER_PRICE = 1.4;

/**
 * 阵营点数预算：每个阵营的阵营点数（Σ 兵力比重 × 兵种点数 + 兵员级数 × 兵员单价，见 budget.ts）不超过它。
 * 固定常量，兵种或单价变了预算不动，由各阵营自己的兵员级数补差
 */
export const FACTION_BUDGET = 5.5;

/** 援军预算：每个阵营的援军点数（全兵种援军表按与开局同一套算法计点，级数换成援军级数，见 budget.ts）不超过它；差额由援军级数补 */
export const REINF_BUDGET = 5.5;

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

/** 各维度级数 × 维度单价之和 */
export function levelPoints(L: Levels): number {
  let pts = 0;
  for (const k of DIMS) if (L[k]) pts += L[k]! * DIM_PRICE[k];
  return pts;
}

/** 面板的战力估值（原型基准用）：生命与每秒伤害乘积的平方根，远程、范围杀伤加成 */
export function panelPower(hp: number, dmg: number, cd: number, ranged: boolean, splash: boolean): number {
  return Math.sqrt((hp / 60) * (dmg / cd / 6.5)) * (ranged ? 1.15 : 1) * (splash ? 1.6 : 1);
}

/** 战力估值 = 原型基准的战力估值 × 1.05 的（点数 ÷（生命单价 + 输出单价））次方，即把点数折成「生命与输出各加几级」 */
export function powerFromPoints(basePower: number, points: number): number {
  return basePower * 1.05 ** (points / (DIM_PRICE.hp + DIM_PRICE.out));
}
