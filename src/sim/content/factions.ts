/** 阵营：配色、初始编制、各类据点提供的援军 */
import { FactionDef, FactionId } from './types';

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
