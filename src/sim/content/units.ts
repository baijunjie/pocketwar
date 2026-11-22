/**
 * 兵种表。加一个兵种 = 在这里加一行 U(...)：
 *   阵营、key、名称、类别、属性（没写的取类别缺省值）、说明。
 * 新类别用 defineClass，新体型在 rules.ts 里 defineSize。模型在 src/render/models/catalog.ts 里按 key 登记。
 */
import {
  A_PIERCE, A_SIEGE, ChargeSpec, P_ARROW, P_BALL, P_BIGBOLT, P_BOLT, P_BULLET, P_JAVELIN, P_ROCKET, P_STONE, ShieldSpec,
  TR_BUSHIDO, TR_FIREMOVE, TR_TESTUDO, TR_TRAMPLE, defineClass, defineUnit as U,
} from './types';

const charge = (impact: number): ChargeSpec => ({ impact, minDist: 130, speedMul: 1.3, duration: 5, maxHits: 3, cooldown: 14 });
const shield = (block: number): ShieldSpec => ({ block, speedMul: 0.8 });

// ---------- 类别：缺省体型、克制关系、特殊动作 ----------
defineClass('inf', '步兵', { vs: { spear: 1.25 }, abilities: { torch: true } });
defineClass('spear', '枪兵', {
  vs: { cav: 2.4, cavr: 2, ele: 2 }, abilities: { brace: { dmg: 24, speedMul: 0.15 }, torch: true },
});
defineClass('ranged', '远程', { vsBld: 0.3 });
defineClass('cav', '骑兵', {
  size: 'medium', marchMul: 0.55, vsBld: 0.6, vision: 380, alert: 420, acq: 230,
  vs: { ranged: 1.4, siege: 2, spear: 0.8 }, abilities: { torch: true },
});
defineClass('cavr', '骑射', { size: 'medium', marchMul: 0.55, vsBld: 0.3, vision: 400, alert: 380 });
defineClass('ele', '战象', { size: 'huge', marchMul: 0.8, vsBld: 3, humanoid: false, siege: true, vs: { cav: 1.5, cavr: 1.5, inf: 1.2 } });
defineClass('siege', '器械', { size: 'large', marchMul: 1, atk: A_SIEGE, humanoid: false, siege: true });

// 中国：弩与火器之国，人多势众
U('china', 'ji', '长戟兵', 'spear', { hp: 65, pace: 56, dmg: 8, cd: 1.3, armM: 1, armP: 1, vs: { cav: 2.5 } }, '结阵拒马，克制骑兵');
U('china', 'dao', '刀盾兵', 'inf', { abilities: { shield: shield(0.4) }, hp: 78, pace: 56, dmg: 9, cd: 1.1, armM: 3, armP: 4 }, '持盾近战，攻守均衡');
U('china', 'nu', '弩兵', 'ranged', { hp: 45, pace: 54, dmg: 21, cd: 2.8, range: 235, proj: P_BOLT, pen: 0.6, armP: 1 }, '强弩破甲，装填较慢');
U('china', 'liannu', '连弩兵', 'ranged', { hp: 45, pace: 56, dmg: 6, cd: 0.6, range: 150, armP: 1 }, '连发箭雨，射程偏短');
U('china', 'tieqi', '铁骑', 'cav', { hp: 150, pace: 116, dmg: 14, cd: 1.3, armM: 3, armP: 2, discipline: 4, abilities: { charge: charge(32) } }, '重装骑兵，冲锋陷阵');
U('china', 'huojian', '火箭车', 'siege', { hp: 110, pace: 45, dmg: 42, cd: 5.5, range: 330, minRange: 90, splash: 36, proj: P_ROCKET, vsBld: 1.5 }, '火箭齐发，范围杀伤');
U('china', 'pili', '霹雳车', 'siege', { hp: 170, pace: 35, dmg: 55, cd: 7.5, range: 450, minRange: 120, splash: 28, proj: P_STONE, vsBld: 4 }, '抛石攻城，摧毁城防');

// 日本：精锐近战与铁炮
U('japan', 'yari', '足轻枪兵', 'spear', { hp: 58, pace: 60, dmg: 9, cd: 1.2, armM: 1, armP: 1, vs: { cav: 2.5 } }, '长枪足轻，克制骑兵');
U('japan', 'samurai', '武士', 'inf', { hp: 110, pace: 60, dmg: 17, cd: 1.05, armM: 4, armP: 3, discipline: 10, traits: TR_BUSHIDO }, '精锐剑士，愈战愈勇');
U('japan', 'yumi', '弓足轻', 'ranged', { hp: 42, pace: 58, dmg: 9, cd: 1.9, range: 265 }, '和弓射程最远');
U('japan', 'teppo', '铁炮足轻', 'ranged', { hp: 42, pace: 54, dmg: 46, cd: 4.8, range: 205, proj: P_BULLET, pen: 0.8, vsBld: 0.5 }, '火绳枪威力巨大，装填极慢');
U('japan', 'kiba', '骑马武者', 'cav', { hp: 150, pace: 120, dmg: 17, cd: 1.2, armM: 3, armP: 2, discipline: 8, abilities: { charge: charge(29) }, traits: TR_BUSHIDO }, '骑乘武士，突击凶猛');
U('japan', 'sohei', '僧兵', 'inf', { hp: 82, pace: 64, dmg: 12, cd: 1.2, armM: 1, armP: 1, vs: { cav: 1.6, cavr: 1.4 } }, '薙刀僧兵，步骑皆可敌');
U('japan', 'ozutsu', '大筒', 'siege', { hp: 140, pace: 35, dmg: 60, cd: 7.5, range: 420, minRange: 90, splash: 22, proj: P_BALL, vsBld: 3.5 }, '火炮轰击城墙');

// 罗马：重装军团与攻城器械
U('rome', 'legion', '军团步兵', 'inf', { hp: 108, pace: 54, dmg: 12, cd: 1.15, armM: 4, armP: 5, traits: TR_TESTUDO, discipline: 10, abilities: { shield: shield(0.5) }, aux: { dmg: 26, range: 95, cd: 14, proj: P_JAVELIN } }, '大盾重甲，接敌前投掷重标枪');
U('rome', 'auxilia', '辅助矛兵', 'spear', { abilities: { shield: shield(0.35) }, hp: 68, pace: 58, dmg: 8, cd: 1.25, armM: 2, armP: 2 }, '辅助军团，掩护侧翼');
U('rome', 'velites', '投矛散兵', 'ranged', { hp: 46, pace: 66, dmg: 13, cd: 2.0, range: 135, proj: P_JAVELIN, vs: { ele: 2.5, cav: 1.3 } }, '轻装标枪手，克制战象');
U('rome', 'sagitt', '弓箭手', 'ranged', { hp: 42, pace: 58, dmg: 8, cd: 1.9, range: 240 }, '辅助弓兵');
U('rome', 'equites', '骑兵', 'cav', { hp: 125, pace: 118, dmg: 12, cd: 1.25, armM: 2, armP: 2, abilities: { charge: charge(22) } }, '中型骑兵，追击包抄');
U('rome', 'scorpio', '蝎弩', 'siege', { hp: 100, pace: 42, dmg: 90, cd: 4.5, range: 400, minRange: 60, proj: P_BIGBOLT, atk: A_PIERCE, pen: 0.8, vsBld: 0.5, radius: 10, vs: { ele: 2 } }, '重型弩炮，远程狙杀');
U('rome', 'onager', '投石机', 'siege', { hp: 170, pace: 35, dmg: 52, cd: 7.5, range: 440, minRange: 110, splash: 32, proj: P_STONE, vsBld: 4 }, '野驴投石机，攻城利器');

// 波斯：骑兵、弓手与战象
U('persia', 'spara', '持盾矛兵', 'spear', { abilities: { shield: shield(0.45) }, hp: 55, pace: 58, dmg: 7, cd: 1.3, armM: 1, armP: 3 }, '藤盾矛兵，人数众多');
U('persia', 'immortal', '不死军', 'inf', { hp: 90, pace: 60, dmg: 12, cd: 1.1, armM: 3, armP: 3, discipline: 8, abilities: { shield: shield(0.35) }, aux: { dmg: 7, range: 170, cd: 2.4, proj: P_ARROW } }, '王家卫队，弓矛兼备');
U('persia', 'kamandar', '弓箭手', 'ranged', { hp: 40, pace: 58, dmg: 8, cd: 1.7, range: 245 }, '箭如飞蝗');
U('persia', 'asvaran', '骑射手', 'cavr', { hp: 95, pace: 131, dmg: 9, cd: 1.8, range: 195, armM: 1, armP: 1, traits: TR_FIREMOVE }, '边走边射，来去如风');
U('persia', 'cataphract', '铁甲骑兵', 'cav', { hp: 182, pace: 102, dmg: 16, cd: 1.35, armM: 5, armP: 4, discipline: 6, abilities: { charge: charge(36) } }, '人马俱甲的超重骑兵');
U('persia', 'elephant', '战象', 'ele', { hp: 460, pace: 89, dmg: 28, cd: 2.0, armM: 3, armP: 4, traits: TR_TRAMPLE, vision: 360 }, '践踏敌阵，冲毁城门');
U('persia', 'mangonel', '投石车', 'siege', { hp: 160, pace: 35, dmg: 48, cd: 7.5, range: 430, minRange: 110, splash: 34, proj: P_STONE, vsBld: 4 }, '抛石攻城');
