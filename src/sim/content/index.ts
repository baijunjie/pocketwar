/** 内容层入口：按依赖顺序加载各张表并展开兵种 */
import { HP_SCALE, LEVELS } from './rules';
import './units';
import { CLASSES, finalizeUnits } from './types';

finalizeUnits(LEVELS, HP_SCALE);

export * from './types';
export * from './rules';
export * from './factions';
export * from './buildings';
export * from './sites';

/** [类别下标] 名称 */
export const CLASS_NAMES = CLASSES.map(c => c.name);
