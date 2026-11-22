/**
 * 规则数值：各系统的可调参数集中在这里，系统代码里不写死数字。
 * 每一项的玩法含义见 docs/gameplay.md；改了这里要同步改那份文档。
 */
import { LevelRules, defineSize } from './types';

// ---------- 体型：越大越慢、越吃粮、越容易被围 ----------
defineSize({ key: 'small', name: '小型', radius: 6, speedMul: 1, upkeep: 1, slots: 3, forestMul: 1 });
defineSize({ key: 'medium', name: '中型', radius: 9, speedMul: 0.9, upkeep: 2, slots: 4, forestMul: 0.75 });
defineSize({ key: 'large', name: '大型', radius: 12, speedMul: 0.8, upkeep: 2, slots: 5, forestMul: 1 });
defineSize({ key: 'huge', name: '巨型', radius: 15, speedMul: 0.7, upkeep: 4, slots: 6, forestMul: 1 });

/** 全局生命倍率：控制会战节奏（数值越大，两军对垒打得越久） */
export const HP_SCALE = 2.2;

export const LEVELS: LevelRules = {
  thresholds: [0, 40, 110, 240, 480],
  names: ['新兵', '老兵', '精锐', '悍卒', '宿将'],
  hp: 0.12,
  dmg: 0.08,
  armor: 0.5,
  cd: 0.04,
  rout: [30, 24, 17, 9, -1],
};

export const RULES = {
  xp: {
    /** 击杀者拿到目标经验值的全额，助攻者拿这个比例 */
    assist: 0.4,
    /** 多少秒内打过目标算助攻 */
    assistWindow: 6,
  },
  combat: {
    /** 视野内最后一次见到敌人后，战斗状态再维持多少秒 */
    linger: 5,
    /** 追不上 / 挤不进去多久后改找别的目标 */
    blockedAfter: 0.6,
    /** 没有别的目标可打时，在原地列队等多久再试 */
    waitBase: 1.5,
    waitMax: 4,
    /** 被判定够不着的目标，多少秒内不再选它 */
    avoidFor: 4,
    /** 目标已被围满时的选择惩罚（折算成距离） */
    crowdPenalty: 70,
    /** 溃兵排在仍在抵抗的敌人之后 */
    routPenalty: 90,
    /** 待命时追击离岗的最远距离 */
    leash: 330,
    /** 冲锋中的骑兵被立枪拦下后的停顿（秒） */
    braceStun: 0.8,
    /** 多远之内有敌人在冲锋，枪兵就立枪 */
    braceRadius: 190,
    braceHold: 1.4,
    shieldHold: 4,
  },
  morale: {
    base: 70,
    perLevel: 4,
    /** 回升 / 下降速度（点/秒） */
    rise: 4,
    fall: 9,
    /** 统计敌我兵力的格子边长（像素），取 3×3 格 */
    cell: 160,
    /** 局部敌我战力对比：全是敌人 −local，全是自己人 +local/3 */
    local: 30,
    /** 附近每战死一名战友的冲击，及其上限、每秒衰减比例 */
    shock: 2.2,
    shockMax: 20,
    shockDecay: 0.12,
    /** 全局战力对比 */
    global: 10,
    /** 除大本营外没有任何据点 */
    noSite: -8,
    /** 每多一个据点 */
    perSite: 2,
    siteMax: 8,
    /** 身处己方据点附近 */
    nearSite: 6,
    nearSiteRadius: 420,
    /** 断粮：按饥饿程度 0..1 线性扣减 */
    hunger: 34,
    surplus: 3,
    rain: -6,
    night: -3,
    /** 负伤：生命越低扣得越多 */
    wounded: 10,
    /** 身边每个溃兵的传染，及其上限 */
    contagion: 1.5,
    contagionMax: 12,
    /** 溃兵在据点重整后的士气，以及多少秒内不会再次溃逃 */
    rally: 55,
    steady: 25,
    /** 溃兵离己方据点多近算「逃回去了」 */
    rallyRadius: 110,
  },
  siege: {
    /** 人形单位打建筑时投掷火把：距离、伤害、间隔 */
    torchRange: 60,
    torchDmg: 16,
    torchCd: 2.2,
    /** 火把对木质建筑、石质建筑、石城门的伤害倍率（石墙与石箭楼完全烧不动） */
    wood: 1.5,
    stone: 0.5,
    gate: 0.3,
    /** 站在城墙上：射程倍率、所受远程伤害倍率 */
    wallRange: 1.15,
    wallCover: 0.6,
    /** 己方单位上墙的寻路代价（越大越倾向走城门） */
    climbCost: 60,
  },
  capture: {
    /** 旗帜区半径：进攻方要有人站在这里面 */
    flagRadius: 85,
  },
  env: {
    /** 一昼夜的长度（秒） */
    dayLength: 480,
    /** 开局时刻（0 = 午夜，0.5 = 正午） */
    startClock: 0.3,
    /** 日出、日落时刻，以及晨昏过渡的长度 */
    sunrise: 0.2,
    sunset: 0.8,
    twilight: 0.04,
    /** 夜里的视野倍率 */
    nightVision: 0.55,
    /** 打着火把时的视野倍率 */
    torchVision: 0.85,
    /** 敌人在这个距离内就能看到火把 */
    torchSeen: 480,
    /** 雨：首场雨最早 / 最晚何时来，一场下多久，两场之间隔多久（秒） */
    firstRain: [150, 420],
    rainLength: [70, 150],
    rainGap: [200, 420],
    rainSpeed: 0.85,
  },
  supply: {
    /** 开局存粮够全军吃几分钟 */
    startMinutes: 3,
    /** 粮仓上限（分钟） */
    capMinutes: 8,
    /** 断粮后饥饿程度涨满所需秒数；有粮后消退所需秒数 */
    starveTime: 45,
    recoverTime: 20,
    /** 存粮超过上限的这个比例时，士气有少量加成 */
    surplusAt: 0.5,
  },
};
