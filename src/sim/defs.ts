/** 静态数据：地形、兵种、阵营、建筑、据点 */

export const TILE = 32;
export const TICK_RATE = 30;
export const DT = 1 / TICK_RATE;

// ---------- 地形 ----------
export const T_DEEP = 0, T_SHALLOW = 1, T_GRASS = 2, T_FOREST = 3, T_HILL = 4, T_MOUNTAIN = 5,
  T_ROAD = 6, T_BRIDGE = 7, T_FARM = 8;
/** 寻路代价 ×10，0 表示不可通行 */
export const TERRAIN_COST = [0, 26, 10, 16, 13, 0, 8, 8, 10];
export const TERRAIN_SPEED = [0, 0.5, 1, 0.7, 0.85, 0, 1.2, 1.1, 0.95];

// ---------- 兵种 ----------
export const C_INF = 0, C_SPEAR = 1, C_RANGED = 2, C_CAV = 3, C_CAVR = 4, C_ELE = 5, C_SIEGE = 6;
export const CLASS_NAMES = ['步兵', '枪兵', '远程', '骑兵', '骑射', '战象', '器械'];
export const A_MELEE = 0, A_PIERCE = 1, A_SIEGE = 2;
export const P_ARROW = 0, P_BOLT = 1, P_BULLET = 2, P_JAVELIN = 3, P_STONE = 4, P_ROCKET = 5,
  P_BALL = 6, P_BIGBOLT = 7;
export const PROJ_SPEED = [430, 520, 1200, 340, 300, 380, 560, 620];
/** 抛物线高度占射程的比例 */
export const PROJ_ARC = [0.16, 0.07, 0, 0.14, 0.42, 0.28, 0.1, 0.03];

export const TR_BUSHIDO = 1, TR_TESTUDO = 2, TR_FIREMOVE = 4, TR_TRAMPLE = 8, TR_BRACE = 16;

export type FactionId = 'china' | 'japan' | 'rome' | 'persia';

export interface AuxAttack {
  dmg: number;
  range: number;
  cd: number;
  proj: number;
}

export interface UnitDef {
  idx: number;
  key: string;
  name: string;
  faction: FactionId;
  cls: number;
  /** 阵型排次：0 前排，数值越大越靠后 */
  row: number;
  hp: number;
  speed: number;
  radius: number;
  dmg: number;
  atk: number;
  /** 0 为近战 */
  range: number;
  minRange: number;
  cd: number;
  armM: number;
  armP: number;
  /** 破甲比例 0..1 */
  pen: number;
  splash: number;
  proj: number;
  /** 对各兵种类别的伤害倍率 */
  vs: number[];
  vsBld: number;
  charge: number;
  aux: AuxAttack | null;
  traits: number;
  vision: number;
  /** 索敌距离 */
  acq: number;
  /** 沿行军路线向前探查障碍的格数 */
  lookK: number;
  /** AI 估算战力 */
  power: number;
  desc: string;
}

type ClsKey = 'inf' | 'spear' | 'ranged' | 'cav' | 'cavr' | 'ele' | 'siege';
const CLS_KEYS: ClsKey[] = ['inf', 'spear', 'ranged', 'cav', 'cavr', 'ele', 'siege'];
type Stat = Partial<Omit<UnitDef, 'vs'>> & { vs?: Partial<Record<ClsKey, number>> };

/** 全局生命倍率：控制会战节奏（数值越大，两军对垒打得越久） */
const HP_SCALE = 2.2;

export const UNITS: UnitDef[] = [];
export const UNIT_BY_KEY: Record<string, UnitDef> = {};

const CLS_BASE: Stat[] = [
  { radius: 6, row: 0, vs: { spear: 1.25 } },
  { radius: 6, row: 0, vs: { cav: 2.4, cavr: 2, ele: 2 }, traits: TR_BRACE },
  { radius: 6, row: 2, vsBld: 0.3 },
  { radius: 9, row: 1, vsBld: 0.6, vision: 380, vs: { ranged: 1.4, siege: 2, spear: 0.8 } },
  { radius: 9, row: 2, vsBld: 0.3, vision: 400 },
  { radius: 15, row: 1, vsBld: 3, vs: { cav: 1.5, cavr: 1.5, inf: 1.2 } },
  { radius: 12, row: 3, atk: A_SIEGE },
];

function def(faction: FactionId, key: string, name: string, cls: number, s: Stat, desc: string): void {
  const base = CLS_BASE[cls];
  const vs = [1, 1, 1, 1, 1, 1, 1];
  for (const src of [base.vs, s.vs]) {
    if (!src) continue;
    for (let i = 0; i < 7; i++) {
      const v = src[CLS_KEYS[i]];
      if (v !== undefined) vs[i] = v;
    }
  }
  const range = s.range ?? 0;
  const d: UnitDef = {
    idx: UNITS.length, key, name, faction, cls,
    row: base.row ?? 0,
    hp: 60, speed: 56, radius: base.radius ?? 6,
    dmg: 8, atk: range > 0 ? A_PIERCE : A_MELEE, range, minRange: 0, cd: 1.2,
    armM: 0, armP: 0, pen: 0, splash: 0, proj: P_ARROW,
    vsBld: 1, charge: 0, aux: null, traits: 0, vision: 320,
    acq: 0, lookK: 1, power: 1, desc,
    ...base, ...s, vs,
  };
  d.traits = (base.traits ?? 0) | (s.traits ?? 0);
  if (cls === C_SIEGE) d.vision = Math.max(d.vision, d.range);
  d.acq = d.range > 0 ? d.range + (cls === C_SIEGE ? 0 : 40) : cls === C_CAV ? 230 : 170;
  d.lookK = d.range > 60 ? Math.min(14, Math.floor(d.range / TILE)) : 1;
  d.power = Math.sqrt((d.hp / 60) * (d.dmg / d.cd / 6.5)) * (d.range > 0 ? 1.15 : 1) * (d.splash > 0 ? 1.6 : 1);
  d.hp = Math.round(d.hp * HP_SCALE);
  UNITS.push(d);
  UNIT_BY_KEY[key] = d;
}

// 中国：弩与火器之国，人多势众
def('china', 'ji', '长戟兵', C_SPEAR, { hp: 65, speed: 56, dmg: 8, cd: 1.3, armM: 1, armP: 1, vs: { cav: 2.5 } }, '结阵拒马，克制骑兵');
def('china', 'dao', '刀盾兵', C_INF, { hp: 78, speed: 56, dmg: 9, cd: 1.1, armM: 3, armP: 4 }, '持盾近战，攻守均衡');
def('china', 'nu', '弩兵', C_RANGED, { hp: 45, speed: 54, dmg: 21, cd: 2.8, range: 235, proj: P_BOLT, pen: 0.6, armP: 1 }, '强弩破甲，装填较慢');
def('china', 'liannu', '连弩兵', C_RANGED, { hp: 45, speed: 56, dmg: 6, cd: 0.6, range: 150, armP: 1 }, '连发箭雨，射程偏短');
def('china', 'tieqi', '铁骑', C_CAV, { hp: 150, speed: 104, dmg: 14, cd: 1.3, armM: 3, armP: 2, charge: 32 }, '重装骑兵，冲锋陷阵');
def('china', 'huojian', '火箭车', C_SIEGE, { hp: 110, speed: 36, dmg: 42, cd: 5.5, range: 330, minRange: 90, splash: 36, proj: P_ROCKET, vsBld: 1.5 }, '火箭齐发，范围杀伤');
def('china', 'pili', '霹雳车', C_SIEGE, { hp: 170, speed: 28, dmg: 55, cd: 7.5, range: 450, minRange: 120, splash: 28, proj: P_STONE, vsBld: 4 }, '抛石攻城，摧毁城防');

// 日本：精锐近战与铁炮
def('japan', 'yari', '足轻枪兵', C_SPEAR, { hp: 58, speed: 60, dmg: 9, cd: 1.2, armM: 1, armP: 1, vs: { cav: 2.5 } }, '长枪足轻，克制骑兵');
def('japan', 'samurai', '武士', C_INF, { hp: 110, speed: 60, dmg: 17, cd: 1.05, armM: 4, armP: 3, traits: TR_BUSHIDO }, '精锐剑士，愈战愈勇');
def('japan', 'yumi', '弓足轻', C_RANGED, { hp: 42, speed: 58, dmg: 9, cd: 1.9, range: 265 }, '和弓射程最远');
def('japan', 'teppo', '铁炮足轻', C_RANGED, { hp: 42, speed: 54, dmg: 46, cd: 4.8, range: 205, proj: P_BULLET, pen: 0.8, vsBld: 0.5 }, '火绳枪威力巨大，装填极慢');
def('japan', 'kiba', '骑马武者', C_CAV, { hp: 150, speed: 108, dmg: 17, cd: 1.2, armM: 3, armP: 2, charge: 29, traits: TR_BUSHIDO }, '骑乘武士，突击凶猛');
def('japan', 'sohei', '僧兵', C_INF, { hp: 82, speed: 64, dmg: 12, cd: 1.2, armM: 1, armP: 1, vs: { cav: 1.6, cavr: 1.4 } }, '薙刀僧兵，步骑皆可敌');
def('japan', 'ozutsu', '大筒', C_SIEGE, { hp: 140, speed: 28, dmg: 60, cd: 7.5, range: 420, minRange: 90, splash: 22, proj: P_BALL, vsBld: 3.5 }, '火炮轰击城墙');

// 罗马：重装军团与攻城器械
def('rome', 'legion', '军团步兵', C_INF, { hp: 108, speed: 54, dmg: 12, cd: 1.15, armM: 4, armP: 5, traits: TR_TESTUDO, aux: { dmg: 26, range: 95, cd: 14, proj: P_JAVELIN } }, '大盾重甲，接敌前投掷重标枪');
def('rome', 'auxilia', '辅助矛兵', C_SPEAR, { hp: 68, speed: 58, dmg: 8, cd: 1.25, armM: 2, armP: 2 }, '辅助军团，掩护侧翼');
def('rome', 'velites', '投矛散兵', C_RANGED, { hp: 46, speed: 66, dmg: 13, cd: 2.0, range: 135, proj: P_JAVELIN, vs: { ele: 2.5, cav: 1.3 } }, '轻装标枪手，克制战象');
def('rome', 'sagitt', '弓箭手', C_RANGED, { hp: 42, speed: 58, dmg: 8, cd: 1.9, range: 240 }, '辅助弓兵');
def('rome', 'equites', '骑兵', C_CAV, { hp: 125, speed: 106, dmg: 12, cd: 1.25, armM: 2, armP: 2, charge: 22 }, '中型骑兵，追击包抄');
def('rome', 'scorpio', '蝎弩', C_SIEGE, { hp: 100, speed: 34, dmg: 90, cd: 4.5, range: 400, minRange: 60, proj: P_BIGBOLT, atk: A_PIERCE, pen: 0.8, vsBld: 0.5, radius: 10, vs: { ele: 2 } }, '重型弩炮，远程狙杀');
def('rome', 'onager', '投石机', C_SIEGE, { hp: 170, speed: 28, dmg: 52, cd: 7.5, range: 440, minRange: 110, splash: 32, proj: P_STONE, vsBld: 4 }, '野驴投石机，攻城利器');

// 波斯：骑兵、弓手与战象
def('persia', 'spara', '持盾矛兵', C_SPEAR, { hp: 55, speed: 58, dmg: 7, cd: 1.3, armM: 1, armP: 3 }, '藤盾矛兵，人数众多');
def('persia', 'immortal', '不死军', C_INF, { hp: 90, speed: 60, dmg: 12, cd: 1.1, armM: 3, armP: 3, aux: { dmg: 7, range: 170, cd: 2.4, proj: P_ARROW } }, '王家卫队，弓矛兼备');
def('persia', 'kamandar', '弓箭手', C_RANGED, { hp: 40, speed: 58, dmg: 8, cd: 1.7, range: 245 }, '箭如飞蝗');
def('persia', 'asvaran', '骑射手', C_CAVR, { hp: 95, speed: 118, dmg: 9, cd: 1.8, range: 195, armM: 1, armP: 1, traits: TR_FIREMOVE }, '边走边射，来去如风');
def('persia', 'cataphract', '铁甲骑兵', C_CAV, { hp: 182, speed: 92, dmg: 16, cd: 1.35, armM: 5, armP: 4, charge: 36 }, '人马俱甲的超重骑兵');
def('persia', 'elephant', '战象', C_ELE, { hp: 460, speed: 62, dmg: 28, cd: 2.0, armM: 3, armP: 4, traits: TR_TRAMPLE, vision: 360 }, '践踏敌阵，冲毁城门');
def('persia', 'mangonel', '投石车', C_SIEGE, { hp: 160, speed: 28, dmg: 48, cd: 7.5, range: 430, minRange: 110, splash: 34, proj: P_STONE, vsBld: 4 }, '抛石攻城');

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

export const FACTIONS: Record<FactionId, FactionDef> = {
  china: {
    id: 'china', name: '中国', motto: '万弩齐发',
    desc: '强弩与火器冠绝天下，兵员充足。正面箭阵压制，火箭车与霹雳车摧城拔寨。',
    traits: ['弩兵破甲 60%', '火箭车范围杀伤', '援军人数 +25%'],
    color: [200, 52, 44], altColor: [70, 70, 78],
    army: [['ji', 0.2], ['dao', 0.2], ['nu', 0.25], ['liannu', 0.13], ['tieqi', 0.13], ['huojian', 0.025], ['pili', 0.015]],
    armyMult: 1.06, reinfMult: 1.25,
    reinf: {
      base: [['ji', 5], ['nu', 4]],
      levy: [['ji', 5], ['dao', 3]],
      mixed: [['dao', 5], ['nu', 5], ['liannu', 2]],
      cav: [['tieqi', 6]],
      siege: [['huojian', 2], ['pili', 1]],
      elite: [['dao', 6], ['nu', 6], ['tieqi', 4]],
    },
  },
  japan: {
    id: 'japan', name: '日本', motto: '一所悬命',
    desc: '武士个体战力最强且愈战愈勇，铁炮一轮齐射足以击溃重甲。兵少而精。',
    traits: ['武士道：生命越低伤害越高', '铁炮破甲 80%', '和弓射程最远'],
    color: [52, 78, 160], altColor: [70, 70, 78],
    army: [['yari', 0.24], ['samurai', 0.2], ['yumi', 0.2], ['teppo', 0.12], ['kiba', 0.12], ['sohei', 0.1], ['ozutsu', 0.02]],
    armyMult: 0.93, reinfMult: 1.07,
    reinf: {
      base: [['yari', 6], ['yumi', 4]],
      levy: [['yari', 8]],
      mixed: [['yari', 5], ['yumi', 5], ['teppo', 3]],
      cav: [['kiba', 6]],
      siege: [['ozutsu', 1], ['teppo', 5]],
      elite: [['samurai', 10], ['sohei', 5]],
    },
  },
  rome: {
    id: 'rome', name: '罗马', motto: '军团纪律',
    desc: '重装军团大盾坚甲，不惧箭雨；蝎弩与投石机提供攻城与远程火力。骑兵偏弱。',
    traits: ['龟甲阵：所受远程伤害 -35%', '军团步兵接敌前投掷重标枪', '蝎弩远程狙杀'],
    color: [214, 164, 30], altColor: [70, 70, 78],
    army: [['legion', 0.36], ['auxilia', 0.16], ['velites', 0.12], ['sagitt', 0.14], ['equites', 0.1], ['scorpio', 0.035], ['onager', 0.02]],
    armyMult: 0.935, reinfMult: 0.94,
    reinf: {
      base: [['legion', 5], ['auxilia', 4]],
      levy: [['auxilia', 7], ['velites', 2]],
      mixed: [['legion', 5], ['sagitt', 5]],
      cav: [['equites', 7]],
      siege: [['scorpio', 2], ['onager', 1]],
      elite: [['legion', 13]],
    },
  },
  persia: {
    id: 'persia', name: '波斯', motto: '万骑之王',
    desc: '骑射手边走边射，铁甲骑兵与战象冲垮敌阵。步兵单薄，胜在机动。',
    traits: ['骑射手可移动射击', '战象践踏并冲毁建筑', '铁甲骑兵最重的冲锋'],
    color: [30, 160, 150], altColor: [70, 70, 78],
    army: [['spara', 0.22], ['immortal', 0.12], ['kamandar', 0.22], ['asvaran', 0.17], ['cataphract', 0.12], ['elephant', 0.027], ['mangonel', 0.015]],
    armyMult: 0.96, reinfMult: 1,
    reinf: {
      base: [['spara', 6], ['kamandar', 4]],
      levy: [['spara', 6], ['kamandar', 3]],
      mixed: [['immortal', 4], ['kamandar', 6]],
      cav: [['asvaran', 4], ['cataphract', 2]],
      siege: [['mangonel', 1], ['elephant', 1]],
      elite: [['immortal', 6], ['cataphract', 3], ['elephant', 1]],
    },
  },
};
export const FACTION_IDS: FactionId[] = ['china', 'japan', 'rome', 'persia'];

// ---------- 建筑 ----------
export const BK_WALL = 0, BK_GATE = 1, BK_TOWER = 2, BK_KEEP = 3, BK_HOUSE = 4, BK_MAIN = 5;
export interface TowerDef {
  range: number;
  dmg: number;
  cd: number;
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
}
export const BUILDINGS: Record<string, BuildingDef> = {};
function bld(key: string, name: string, kind: number, w: number, h: number, hp: number, armM: number, armP: number,
  breach: number, tall: number, wood: boolean, tower: TowerDef | null = null): void {
  BUILDINGS[key] = { key, name, kind, w, h, hp, armM, armP, breach, tower, tall, wood };
}
bld('wall', '城墙', BK_WALL, 1, 1, 1400, 4, 14, 600, 22, false);
bld('gate_h', '城门', BK_GATE, 2, 1, 2000, 4, 14, 450, 28, false);
bld('gate_v', '城门', BK_GATE, 1, 2, 2000, 4, 14, 450, 28, false);
bld('tower', '箭楼', BK_TOWER, 2, 2, 2400, 4, 14, 900, 46, false, { range: 290, dmg: 24, cd: 0.9 });
bld('keep', '主堡', BK_KEEP, 4, 4, 9000, 5, 15, 900, 84, false, { range: 310, dmg: 30, cd: 0.6 });
bld('citadel', '内城', BK_MAIN, 4, 4, 6000, 5, 15, 900, 70, false, { range: 300, dmg: 26, cd: 0.7 });
bld('hall', '镇公所', BK_MAIN, 3, 3, 3000, 4, 12, 900, 44, false);
bld('house', '民居', BK_HOUSE, 2, 2, 450, 2, 8, 800, 26, false);
bld('barracks', '兵营', BK_HOUSE, 3, 2, 1000, 3, 10, 800, 28, false);
bld('palisade', '木栅', BK_WALL, 1, 1, 420, 2, 9, 350, 14, true);
bld('wgate_h', '营门', BK_GATE, 2, 1, 650, 2, 9, 280, 18, true);
bld('wgate_v', '营门', BK_GATE, 1, 2, 650, 2, 9, 280, 18, true);
bld('watchtower', '望楼', BK_TOWER, 1, 1, 700, 2, 9, 500, 40, true, { range: 250, dmg: 18, cd: 1.1 });
bld('tent', '营帐', BK_HOUSE, 2, 2, 200, 1, 6, 700, 20, true);
bld('cmdtent', '中军帐', BK_MAIN, 3, 2, 500, 1, 6, 700, 26, true);
bld('granary', '粮仓', BK_MAIN, 2, 2, 700, 2, 8, 800, 34, true);
bld('stable', '马厩', BK_MAIN, 3, 2, 800, 2, 8, 800, 26, true);
bld('workshop', '工坊', BK_MAIN, 3, 2, 900, 3, 9, 800, 30, false);
bld('farmhouse', '农舍', BK_HOUSE, 2, 2, 350, 1, 7, 800, 24, true);

/** 箭楼/主堡开火时使用的"攻击者"数据 */
export const TOWER_ATTACKER = { vs: [1, 1, 1, 1, 1, 1, 1], vsBld: 0 };

// ---------- 据点 ----------
export const SITE_HQ = 0, SITE_CITY = 1, SITE_TOWN = 2, SITE_CAMP = 3, SITE_VILLAGE = 4, SITE_RANCH = 5,
  SITE_WORKSHOP = 6;
export interface SiteInfo {
  label: string;
  /** 占领圈半径（像素） */
  radius: number;
  /** 援军间隔（秒） */
  interval: number;
  reinf: ReinfKind;
  /** AI 评估的价值 */
  value: number;
  provides: string;
}
export const SITE_INFO: SiteInfo[] = [
  { label: '大本营', radius: 0, interval: 50, reinf: 'base', value: 0, provides: '基础援军' },
  { label: '城池', radius: 300, interval: 55, reinf: 'elite', value: 3, provides: '精锐援军' },
  { label: '城镇', radius: 220, interval: 60, reinf: 'mixed', value: 2, provides: '步弓混编' },
  { label: '营地', radius: 180, interval: 70, reinf: 'levy', value: 1.2, provides: '步兵' },
  { label: '村庄', radius: 170, interval: 50, reinf: 'levy', value: 1.4, provides: '步兵' },
  { label: '马场', radius: 160, interval: 65, reinf: 'cav', value: 1.6, provides: '骑兵' },
  { label: '工坊', radius: 160, interval: 90, reinf: 'siege', value: 1.5, provides: '攻城器械' },
];
