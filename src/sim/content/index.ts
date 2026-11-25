/** 内容层入口：按依赖顺序加载各张表并展开兵种 */
import { ELITE, HP_SCALE, LEVELS, RULES } from './rules';
import './units';
import { ARCHETYPES, ExpandRules, TRAITS, UnitDef, finalizeUnits, tagBit } from './types';

export const EXPAND_RULES: ExpandRules = {
  levels: LEVELS, hpScale: HP_SCALE, elite: ELITE, xp: RULES.xp,
  meleeContact: RULES.combat.meleeContact,
  torch: { range: RULES.siege.torchRange, dmg: RULES.siege.torchDmg, cd: RULES.siege.torchCd },
};
finalizeUnits(EXPAND_RULES);

export * from './types';
export * from './points';
export * from './force';
export * from './rules';
export * from './factions';
export * from './buildings';
export * from './sites';

/** [原型下标] 名称 */
export const ARCHETYPE_NAMES = ARCHETYPES.map(a => a.name);

/** 界面上显示的兵种类型：原型名，带标签的特性再跟在后面，如「近战步兵·长柄」 */
export function unitKind(d: UnitDef): string {
  const tagged = Object.values(TRAITS).filter(t => t.tags.length && t.tags.every(k => d.tags & tagBit(k)));
  return [ARCHETYPES[d.arch].name, ...tagged.map(t => t.name)].join('·');
}
