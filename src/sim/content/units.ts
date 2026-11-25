/**
 * 兵种表。加一个兵种 = 在这里加一行 U(...)：
 *   阵营、key、名称、原型、属性（没写的取原型缺省值）、说明。
 *   生命、输出、节奏、护甲、机动、射程、攻击距离、纪律、冲击、破甲、范围杀伤、举盾这些点数维度只填相对原型基准的级数（lv），
 *   面板由原型基准与阶梯算出，按价目表计点；只影响攻城的对建筑倍率、最近射程，以及投射物外观、碰撞半径这些字段不计点，直接填。
 * 兵种的特殊能力用特性（traits）挂上去，特性在下面用 defineTrait 定义，带标签、克制、受击修正、特殊动作、副武器或伤害类型，按价目表计点。
 * 每个兵种自动带一个高级形态（key 加 _e，数值加成见 rules.ts 的 ELITE），名称缺省是「重甲 + 原名」。
 * 新原型用 defineArchetype，新体型在 rules.ts 里 defineSize。模型在 src/render/models/catalog.ts 里按 key 登记。
 */
import {
  A_PIERCE, A_SIEGE, ChargeSpec, P_ARROW, P_BALL, P_BIGBOLT, P_BOLT, P_BULLET, P_JAVELIN, P_ROCKET, P_STONE,
  TR_BUSHIDO, TR_FIREMOVE, TR_TESTUDO, defineArchetype, defineTrait, defineUnit as U,
} from './types';
import type { Dim } from './points';

/** 近战骑兵自带的冲锋；冲撞伤害是点数维度（冲击），由原型基准与兵种的冲击级数算出，这里的 impact 只是占位 */
const charge: ChargeSpec = { impact: 0, minDist: 90, speedMul: 1.3, duration: 5, maxHits: 3, cooldown: 8 };

// ---------- 原型：行为、体型、对其它原型的固定克制、缺省属性与自带特性 ----------
// panel 是原型基准面板（基础单位，点数 0）：取该原型原来各兵种各维度的几何中位数（护甲取中位数，近战步兵把原来的步兵与枪兵合在一起取），
// 兵种的面板由它按 lv 里写的级数算出；生命是展开前的数，展开时再乘全局生命倍率（见 rules.ts 的 HP_SCALE）。
// dims 是原型开放的维度。minRange、proj 不计点，原型只给缺省值；范围杀伤（panel.splash）是点数维度，抛射器械的基准是 30。
// 器械按武器体系分两个原型：抛射器械（抛石、火炮、火箭）打攻城伤害、落点范围杀伤；直射器械（重弩）打穿刺伤害、单体直射追踪，不开范围杀伤。
// 主武器是近战武器的原型开放攻击距离，是远程武器的开放射程。
const COMMON: Dim[] = ['hp', 'out', 'cad', 'armM', 'armP', 'spd', 'disc'];
const MELEE: Dim[] = [...COMMON, 'reach'];
const RANGED: Dim[] = [...COMMON, 'rng'];
defineArchetype('inf', '近战步兵', {
  ranged: false, force: 1, base: { abilities: { torch: true } }, dims: [...MELEE, 'block'],
  panel: { hp: 78, dmg: 9, cd: 1.2, armM: 2, armP: 3, pace: 58, range: 0, reach: 0, discipline: 0, impact: 0, pen: 0, splash: 0, block: 0 },
});
defineArchetype('ranged', '远程步兵', {
  ranged: true, force: 0.76, base: { vsBld: 0.3 }, dims: [...RANGED, 'pen'],
  panel: { hp: 42, dmg: 9, cd: 1.9, armM: 0, armP: 0, pace: 58, range: 235, reach: 0, discipline: 0, impact: 0, pen: 0, splash: 0, block: 0 },
});
defineArchetype('cav', '近战骑兵', {
  ranged: false, force: 3.75, counter: { ranged: 1.4, siege: 2, bolt: 2 }, dims: [...MELEE, 'imp'],
  base: { size: 'medium', marchMul: 0.55, mobile: true, vsBld: 0.6, vision: 380, alert: 420, acq: 230, abilities: { torch: true, charge } },
  panel: { hp: 150, dmg: 15, cd: 1.27, armM: 3, armP: 2, pace: 117, range: 0, reach: 0, discipline: 0, impact: 135, pen: 0, splash: 0, block: 0 },
});
defineArchetype('cavr', '远程骑兵', {
  ranged: true, force: 1.5, dims: RANGED,
  base: { size: 'medium', marchMul: 0.55, mobile: true, vsBld: 0.3, vision: 400, alert: 380, traits: ['firemove'] },
  panel: { hp: 95, dmg: 9, cd: 1.8, armM: 1, armP: 1, pace: 131, range: 195, reach: 0, discipline: 0, impact: 0, pen: 0, splash: 0, block: 0 },
});
defineArchetype('vehicle', '载具', {
  ranged: false, force: 6.3, counter: { cav: 1.5, cavr: 1.5, inf: 1.2 }, dims: MELEE,
  base: { size: 'huge', marchMul: 0.8, vsBld: 3, humanoid: false, siege: true, traits: ['trample'] },
  panel: { hp: 460, dmg: 28, cd: 2, armM: 3, armP: 4, pace: 89, range: 0, reach: 0, discipline: 0, impact: 0, pen: 0, splash: 0, block: 0 },
});
defineArchetype('siege', '抛射器械', {
  ranged: true, force: 6.4, dims: [...RANGED, 'pen', 'splash'],
  base: { size: 'large', marchMul: 1, atk: A_SIEGE, humanoid: false, siege: true, elitePrefix: '包铁', minRange: 100, proj: P_STONE },
  panel: { hp: 150, dmg: 53.5, cd: 7.5, armM: 0, armP: 0, pace: 35, range: 425, reach: 0, discipline: 0, impact: 0, pen: 0, splash: 30, block: 0 },
});
// 直射器械的基准取它唯一的兵种蝎弩迁到原型之前的重弩面板（生命 100、单发 90、间隔 4.5 秒、射程 400、机动 42），
// 伤害类型取远程缺省的穿刺；破甲与其它原型一样基准为 0，由兵种按级数加。
// 兵力占用 1：人数测量不显著，取「器械位整个换成它」的实测折算的初值（取法见 docs/unit-stat-model.md「兵力占用」）
defineArchetype('bolt', '直射器械', {
  ranged: true, force: 1, dims: [...RANGED, 'pen'],
  base: { size: 'large', marchMul: 1, humanoid: false, siege: true, elitePrefix: '包铁', minRange: 60, proj: P_BIGBOLT },
  panel: { hp: 100, dmg: 90, cd: 4.5, armM: 0, armP: 0, pace: 42, range: 400, reach: 0, discipline: 0, impact: 0, pen: 0, splash: 0, block: 0 },
});

// ---------- 特性 ----------
defineTrait('bushido', { name: '武士道', flag: TR_BUSHIDO });
defineTrait('testudo', { name: '龟甲阵', flag: TR_TESTUDO });
defineTrait('firemove', { name: '边走边射', flag: TR_FIREMOVE });
// 践踏：近战攻击以目标为中心杀伤半径内的敌人
defineTrait('trample', { name: '践踏', main: { splash: 28 } });
// 长柄：立枪拒马，克制骑兵与载具。克制与受击修正合起来保持原来枪兵的行为：
// 长柄互打 ×1，步兵打长柄 ×1.25，骑兵打长柄 ×0.8，载具打长柄 ×1（载具对近战步兵的 ×1.2 被抵消）。
defineTrait('polearm', {
  name: '长柄', tags: ['polearm'],
  abilities: { brace: { dmg: 60, speedMul: 0.15 } },
  counter: { cav: 2.4, cavr: 2, vehicle: 2, polearm: 0.8 },
  hitMod: { inf: 1.25, cav: 0.8, vehicle: 1 / 1.2 },
});
// 兵种特有的克制
defineTrait('naginata', { name: '薙刀', counter: { cav: 1.6, cavr: 1.4 } });
defineTrait('javelin', { name: '标枪', counter: { vehicle: 2.5, cav: 1.3 } });
defineTrait('ballista', { name: '重弩', counter: { vehicle: 2 } });
// 副武器：接敌途中投出
defineTrait('pilum', { name: '重标枪', aux: { dmg: 26, range: 95, cd: 14, proj: P_JAVELIN } });
defineTrait('sidebow', { name: '副弓', aux: { dmg: 7, range: 170, cd: 2.4, proj: P_ARROW } });
// 穿刺攻击：抛射器械改打穿刺伤害（吃远程护甲与举盾、龟甲阵、林地减免；抛射器械的基准是无视护甲的攻城伤害）
defineTrait('pierce', { name: '穿刺攻击', main: { atk: A_PIERCE } });

// 光环：盾牌掩护身边的友军（不含自己），所受远程伤害 −20%。待定挂到哪些持盾步兵，先在近战步兵与长柄两个位置计价
defineTrait('cover', { name: '盾墙掩护', aura: { kind: 'rangedTaken', radius: 60, value: 0.8 }, priceAt: ['inf', 'spear'] });

// 中国：弩与火器之国，人多势众
U('china', 'ji', '长戟兵', 'inf', { lv: { hp: -1, cad: -1, out: -4, armM: -1, armP: -2, spd: -1, reach: 1 }, traits: [['polearm', { cav: 2.5 }]] }, '结阵拒马，克制骑兵');
U('china', 'dao', '刀盾兵', 'inf', { lv: { out: 2, armM: 1, armP: 1, spd: -1, block: 12 } }, '持盾近战，攻守均衡');
U('china', 'nu', '弩兵', 'ranged', { lv: { hp: 1, cad: 6, out: 9, armP: 1, spd: -2, pen: 6 }, proj: P_BOLT }, '强弩破甲，装填较慢');
U('china', 'liannu', '连弩兵', 'ranged', { lv: { hp: 1, cad: -3, out: 12, armP: 1, spd: -1, rng: -6 } }, '连发箭雨，射程偏短');
U('china', 'tieqi', '铁骑', 'cav', { lv: { out: -2, disc: 2 } }, '重装骑兵，冲锋陷阵');
U('china', 'huojian', '火箭车', 'siege', { lv: { hp: -6, cad: -2, out: 1, spd: 6, rng: -6, splash: 3 }, minRange: 90, proj: P_ROCKET, vsBld: 1.5 }, '火箭齐发，范围杀伤');
U('china', 'pili', '霹雳车', 'siege', { lv: { hp: 3, out: 1, rng: 1, splash: -1 }, minRange: 120, proj: P_STONE, vsBld: 4 }, '抛石攻城，摧毁城防');

// 日本：精锐近战与铁炮
U('japan', 'yari', '足轻枪兵', 'inf', { lv: { hp: -4, armM: -1, armP: -2, spd: 1, reach: 1 }, traits: [['polearm', { cav: 2.5 }]] }, '长枪足轻，克制骑兵');
U('japan', 'samurai', '武士', 'inf', { lv: { hp: 1, cad: 3, out: 9, armM: 2, spd: 1, disc: 5 }, traits: ['bushido'] }, '精锐剑士，愈战愈勇');
U('japan', 'yumi', '弓足轻', 'ranged', { lv: { rng: 3 } }, '和弓射程最远');
U('japan', 'teppo', '铁炮足轻', 'ranged', { lv: { hp: -5, cad: 8, out: 12, spd: -2, rng: -3, pen: 8 }, proj: P_BULLET, vsBld: 0.5 }, '火绳枪威力巨大，装填极慢');
U('japan', 'kiba', '骑马武者', 'cav', { lv: { cad: 1, out: 4, spd: 1, disc: 4 }, traits: ['bushido'] }, '骑乘武士，突击凶猛');
U('japan', 'sohei', '僧兵', 'inf', { lv: { hp: 1, cad: 2, out: 6, armM: -1, armP: -2, spd: 3 }, traits: ['naginata'] }, '薙刀僧兵，步骑皆可敌');
U('japan', 'ozutsu', '大筒', 'siege', { lv: { hp: -1, cad: 1, out: 2, splash: -4 }, minRange: 90, proj: P_BALL, vsBld: 3.5 }, '火炮轰击城墙');

// 罗马：重装军团与攻城器械
U('rome', 'legion', '军团步兵', 'inf', { lv: { out: 5, armM: 2, armP: 2, spd: -2, disc: 5, block: 14 }, traits: ['testudo', 'pilum'] }, '大盾重甲，接敌前投掷重标枪');
U('rome', 'auxilia', '辅助矛兵', 'inf', { lv: { hp: -3, cad: -1, out: -3, armP: -1, block: 11, reach: 1 }, traits: ['polearm'] }, '辅助军团，掩护侧翼');
U('rome', 'velites', '投矛散兵', 'ranged', { lv: { hp: 2, cad: 3, out: 6, spd: 4, rng: -6 }, proj: P_JAVELIN, traits: ['javelin'] }, '轻装标枪手，克制战象');
U('rome', 'sagitt', '弓箭手', 'ranged', { lv: { cad: -1, out: -2, rng: 1 } }, '辅助弓兵');
U('rome', 'equites', '骑兵', 'cav', { lv: { hp: -4, cad: -2, out: -4, armM: -1, imp: -1 }, eliteName: '重装骑兵' }, '中型骑兵，追击包抄');
U('rome', 'scorpio', '蝎弩', 'bolt', { lv: { pen: 8 }, vsBld: 0.5, radius: 10, traits: ['ballista'] }, '重型弩炮，远程狙杀');
U('rome', 'onager', '投石机', 'siege', { lv: { hp: 3, out: -1, rng: 1, splash: 1 }, minRange: 110, proj: P_STONE, vsBld: 4 }, '野驴投石机，攻城利器');

// 波斯：骑兵、弓手与战象
U('persia', 'spara', '持盾矛兵', 'inf', { lv: { hp: -3, cad: -1, out: -6, block: 13, reach: 1 }, traits: ['polearm'] }, '藤盾矛兵，人数众多');
U('persia', 'immortal', '不死军', 'inf', { traits: ['sidebow'], lv: { hp: -1, cad: 2, out: 8, armM: 1, disc: 4, block: 11 } }, '王家卫队，弓矛兼备');
U('persia', 'kamandar', '弓箭手', 'ranged', { lv: { hp: -1, cad: -1, rng: 1 } }, '箭如飞蝗');
U('persia', 'asvaran', '骑射手', 'cavr', { lv: {} }, '边走边射，来去如风');
U('persia', 'cataphract', '铁甲骑兵', 'cav', { lv: { hp: 4, armM: 2, armP: 2, spd: -4, disc: 3, imp: 2 }, eliteName: '具装铁骑' }, '人马俱甲的超重骑兵');
U('persia', 'elephant', '战象', 'vehicle', { lv: {}, vision: 360 }, '践踏敌阵，冲毁城门');
U('persia', 'mangonel', '投石车', 'siege', { lv: { hp: 1, cad: -1, out: -2, splash: 2 }, minRange: 110, proj: P_STONE, vsBld: 4 }, '抛石攻城');
