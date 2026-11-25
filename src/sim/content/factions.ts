/**
 * 阵营：配色、开局编制、城池与城镇的全兵种援军（营寨的援军由占领方选一个兵种，份数记在据点类型上）。
 * 兵力按份数计：army 是兵种占全军兵力的比重（之和为 1），reinf 的数是兵力份数；人数 = 份数 ÷ 所属原型的兵力占用。
 */
import { FactionDef, FactionId } from './types';

export const FACTIONS: Record<FactionId, FactionDef> = {
  china: {
    id: 'china', name: '中国', motto: '万弩齐发',
    desc: '强弩与火器冠绝天下。正面箭阵压制，火箭车与霹雳车摧城拔寨。',
    traits: ['弩兵破甲 60%', '火箭车范围杀伤', '连弩兵速射箭雨'],
    color: [200, 52, 44], altColor: [70, 70, 78],
    army: [['ji', 0.139635], ['dao', 0.139636], ['nu', 0.132654], ['liannu', 0.06898], ['tieqi', 0.340362], ['huojian', 0.111708], ['pili', 0.067025]],
    manpower: 0.89, reinfLevel: 2.04,
    reinf: [['dao', 5], ['nu', 4.56], ['tieqi', 15], ['huojian', 6.4]],
  },
  japan: {
    id: 'japan', name: '日本', motto: '一所悬命',
    desc: '武士个体战力最强且愈战愈勇，铁炮一轮齐射足以击溃重甲。',
    traits: ['武士道：生命越低伤害越高', '铁炮破甲 80%', '和弓射程最远'],
    color: [52, 78, 160], altColor: [70, 70, 78],
    army: [['yari', 0.176314], ['samurai', 0.146929], ['yumi', 0.111666], ['teppo', 0.067], ['kiba', 0.330591], ['sohei', 0.073465], ['ozutsu', 0.094035]],
    manpower: -1.2, reinfLevel: 0.56,
    reinf: [['samurai', 6], ['yumi', 3.04], ['kiba', 15], ['ozutsu', 6.4]],
  },
  rome: {
    id: 'rome', name: '罗马', motto: '军团纪律',
    desc: '重装军团大盾坚甲，不惧箭雨；蝎弩与投石机提供攻城与远程火力。骑兵偏弱。',
    traits: ['龟甲阵：所受远程伤害 -35%', '军团步兵接敌前投掷重标枪', '蝎弩远程狙杀'],
    color: [214, 164, 30], altColor: [70, 70, 78],
    army: [['legion', 0.286716], ['auxilia', 0.127429], ['velites', 0.072635], ['sagitt', 0.084741], ['equites', 0.298661], ['scorpio', 0.027875], ['onager', 0.101943]],
    manpower: -6.21, reinfLevel: -0.55,
    reinf: [['legion', 6], ['sagitt', 3.04], ['equites', 7.5], ['onager', 6.4]],
  },
  persia: {
    id: 'persia', name: '波斯', motto: '万骑之王',
    desc: '骑射手边走边射，铁甲骑兵与战象冲垮敌阵。步兵单薄，胜在机动。',
    traits: ['骑射手可移动射击', '战象践踏并冲毁建筑', '铁甲骑兵最重的冲锋'],
    color: [30, 160, 150], altColor: [70, 70, 78],
    army: [['spara', 0.14882], ['immortal', 0.081174], ['kamandar', 0.113103], ['asvaran', 0.172495], ['cataphract', 0.304404], ['elephant', 0.115065], ['mangonel', 0.064939]],
    manpower: -0.43, reinfLevel: -2.64,
    reinf: [['immortal', 4], ['kamandar', 2.28], ['cataphract', 7.5], ['mangonel', 6.4]],
  },
};
export const FACTION_IDS: FactionId[] = ['china', 'japan', 'rome', 'persia'];
