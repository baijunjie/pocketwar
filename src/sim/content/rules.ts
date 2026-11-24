/**
 * 规则数值：各系统的可调参数集中在这里，系统代码里不写死数字。
 * 每一项的玩法含义见 docs/gameplay.md；改了这里要同步改那份文档。
 */
import { EliteRules, LevelRules, TowerDef, defineSize } from './types';

// ---------- 体型：越大越慢、越吃粮、越容易被围 ----------
defineSize({ key: 'small', name: '小型', radius: 6, speedMul: 1, upkeep: 1, slots: 3, forestMul: 1 });
defineSize({ key: 'medium', name: '中型', radius: 9, speedMul: 0.9, upkeep: 2, slots: 4, forestMul: 0.75 });
defineSize({ key: 'large', name: '大型', radius: 12, speedMul: 0.8, upkeep: 2, slots: 5, forestMul: 1 });
defineSize({ key: 'huge', name: '巨型', radius: 15, speedMul: 0.7, upkeep: 4, slots: 6, forestMul: 1 });

/** 全局生命倍率：控制会战节奏（数值越大，两军对垒打得越久） */
export const HP_SCALE = 2.2;

export const LEVELS: LevelRules = {
  thresholds: [0, 30, 80, 160, 300],
  names: ['新兵', '老兵', '精锐', '悍卒', '宿将'],
  // 每升一级攻击 +50%、受到的伤害按 1 + 0.5 × 级数 折算：5 级（宿将）攻击 ×3、防御 ×3
  hp: 0,
  dmg: 0.5,
  def: 0.5,
  armor: 0,
  cd: 0,
  rout: [30, 24, 17, 9, -1],
};

/** 高级形态（花黄金升级）相对初级形态的加成 */
export const ELITE: EliteRules = { hp: 1.35, dmg: 1.25, armor: 2, prefix: '重甲' };

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
    braceHold: 2.5,
    shieldHold: 6,
    /** 站定出手的单位只有被挤到重叠超过这个比例（两者半径和的占比）才会让位 */
    plantGive: 0.7,
    /** 自动挑建筑打时，会放箭的建筑按这个倍率折算距离平方（越小越优先） */
    armedFirst: 0.35,
    /** 人形单位自动去打建筑的最小搜索距离（索敌距离更远的按索敌距离） */
    bldSeek: 160,
  },
  vision: {
    /** 建筑提供的视野（像素）：会放箭的箭塔 / 塔楼看得远得多 */
    building: 192,
    tower: 560,
  },
  march: {
    /** 编队行军：部队离各自的队列位置平均不超过 lagFull 时全速前进，超过 lagStop 时领队原地等待 */
    lagFull: 30,
    lagStop: 110,
    /** 队列位置落到自己身后超过这么远（变阵收窄时常见）：原地等位置走过来，不往回跑 */
    waitAhead: 14,
    /** 领队转向的角速度上限（弧度/秒） */
    turn: 1.4,
    /** 队列转弯半径：不小于半个队宽，也不小于 turnR；离终点不到一个队宽时不限 */
    turnR: 40,
    /** 朝向转得慢时，领队脚下的方向最多偏离朝向这么多（弧度），横队斜着侧移跟上路线 */
    slide: 0.6,
    /** 领队沿路线往前看多远来拉直折线：队宽 × lookK，至少 lookMin */
    lookK: 0.75,
    lookMin: 96,
    /** 下令时部队散得太开（离重心的均方根距离超过这个值）就不编队，各走各的 */
    maxSpread: 520,
    /** 攻击移动时，交手的成员超过这个比例领队就停下 */
    holdFight: 0.15,
    /** 行迹每隔多远记一点（队列位置沿行迹往后排） */
    trailStep: 12,
    /** 量路宽：在领队身前这几处各往两侧量一次，取最窄的 */
    probe: [0, 48, 112, 176],
    /** 队列两侧与障碍之间留的余量 */
    margin: 10,
    /** 收窄成纵队时纵深不超过这个长度；再窄的路就摆不下了，摆不下的人各自寻路 */
    maxDepth: 640,
    /** 两侧的空当比现在的队列宽出这个倍数、并且领队走过了「纵深 × widenAfter」的路程之后，才重新展开 */
    widen: 1.25,
    widenAfter: 0.8,
    /** 分步展开：每一步纵深最多缩短这么多，全队跟上（平均掉队不超过 lagFull）且隔了这么多帧才走下一步 */
    widenStep: 48,
    widenEvery: 30,
    /** 离目的地不到 giveUpNear、又有 giveUpAfter 秒没再靠近：就地算到达（不再在人堆边上来回挤） */
    giveUpNear: 320,
    giveUpAfter: 5,
    /** 队列中线向窄路正中靠拢的快慢（每帧的比例） */
    shiftRate: 0.08,
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
    /** 溃逃途中士气回升到「溃逃阈值 + recover」即当场恢复指挥，之后 steadyField 秒内不会再次溃逃 */
    recover: 12,
    steadyField: 10,
    /** 溃兵丢盔弃甲：护甲不算，受到的伤害再乘这个倍率 */
    routDamage: 1.6,
  },
  siege: {
    /** 人形单位打建筑时投掷火把：距离、伤害、间隔 */
    torchRange: 60,
    torchDmg: 16,
    torchCd: 2.2,
    /** 火把对木质建筑、石质建筑、门楼与角楼的伤害倍率（石墙完全烧不动） */
    wood: 1.5,
    stone: 0.5,
    gate: 0.3,
    /** 站在城墙上：射程倍率、所受远程伤害倍率 */
    wallRange: 1.15,
    wallCover: 0.6,
    /** 己方单位上墙的寻路代价（越大越倾向走城门）；只能从城内一侧上下 */
    climbCost: 60,
    /** 垛口位到墙根（城内空地）最多隔几格墙顶 */
    slotReach: 5,
    /** 每格墙顶站几个人，以及各站位相对格子中心的位置（[往城外, 沿墙]，像素） */
    slotCap: 3,
    slotSubs: [[7, -9], [7, 9], [-7, 0]] as [number, number][],
    /** 墙上的守军：敌人在射程（含城墙加成）的这个比例以内就不挪；挪过去至少要近这么多像素才挪 */
    shiftInRange: 0.95,
    shiftGain: 48,
    /** 换到隔着门楼的另一段墙要下墙绕路，至少要近这么多像素才换 */
    shiftFar: 200,
  },
  site: {
    /** 己方据点内、不在战斗中的单位每秒恢复的生命比例 */
    unitRegen: 0.012,
    /** 大本营没有占领圈：离中心这么近就算在据点里 */
    hqRadius: 400,
    /** 援军在据点中心往南多远处出现 */
    spawnOff: 70,
    /** 在自家据点里待命的守军的警戒距离（与塔楼的视野相当）：远程的会上前迎击这么远的敌人 */
    alarm: 560,
    /** 据点里待命的近战守军挨了敌方远程的打，这么多秒内会出击追打那个射手（否则不出据点） */
    provoke: 6,
    /** 据点建筑多少秒没挨打后开始自行修复，以及每秒修复的比例 */
    bldCalm: 15,
    bldRegen: 0.006,
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
    /** 雪：一场降水是雪的概率；雪天的行军速度、视野倍率（与夜晚叠乘），以及据点之外的单位护甲打几折 */
    snowChance: 0.22,
    snowSpeed: 0.75,
    snowVision: 0.7,
    snowArmor: 0.5,
    /**
     * 风：不是一直有。每隔 windCheck 秒掷一次，晴天 windDry、雨雪天 windWet 的概率起风（降水开始时立刻再掷一次）；
     * 一阵风刮 windLength 秒，风力在 windForce 之间随机，风向会慢慢偏转。
     * 顺风行军最多快 windSpeed（正顶风慢同样多，侧风不影响）。
     */
    windCheck: [60, 150],
    windDry: 0.25,
    windWet: 0.8,
    windLength: [60, 160],
    windForce: [0.4, 1],
    windSpeed: 0.15,
    /** 远程：顺风射程最多长 windRange（正顶风短同样多，侧风不变），都要乘风力 */
    windRange: 0.15,
    /**
     * 直射的箭、弩、标枪不再必中：落空的概率 = 风力 × 距离系数（windMissDist 处为 1）×
     * （windMiss × 侧风分量 + windHeadMiss × 顶风分量）。落空的箭顺风偏到目标旁边。
     */
    windMiss: 0.45,
    windHeadMiss: 0.12,
    windMissDist: 320,
    /** 抛射器械（投石、火炮等）的落点顺风偏移：每飞 100 像素偏 windDrift × 100 × 风力 */
    windDrift: 0.08,
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
  economy: {
    /** 兵种升为高级形态：每份口粮（体型）花多少黄金 */
    unitGold: 10,
    /** 据点升级后：建筑生命倍率、护甲加成、箭塔伤害与射程倍率 */
    siteHp: 1.6,
    siteArmor: 3,
    towerDmg: 1.5,
    towerRange: 1.1,
    /** 升级后的据点，主建筑若原本不会放箭，就添一队弓手 */
    mainTower: { range: 240, dmg: 16, cd: 1.2, arrows: 1 } as TowerDef,
    /** 升级后每轮放箭数量的倍数 */
    towerArrows: 2,
    /** 有石料 / 木材时建筑自修加快到几倍，以及每修复 100 点生命消耗多少 */
    repairBoost: 4,
    repairCost: 1,
    /** 资源点的箭塔：用哪种建筑、每座花多少木材 */
    towerKey: 'arrowtower',
    towerCost: 50,
    /** 临时据点：用哪种建筑、花多少木材、每方最多几座、部队离多近才能搭起来、下令后多久搭不成就作罢 */
    outpostKey: 'outpost',
    outpostCost: 90,
    outpostMax: 3,
    outpostReach: 90,
    outpostTimeout: 150,
  },
};
