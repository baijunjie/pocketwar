/** 模拟层共用的常量：容量上限、指令、状态位、特效种类。不依赖任何模块 */
export const MAX_UNITS = 8192;
export const MAX_PROJ = 4096;
export const MAX_CORPSE = 2048;
export const NONE = -1;
export const O_IDLE = 0, O_MOVE = 1, O_AMOVE = 2, O_ATTACK = 3, O_HOLD = 4;
/**
 * 交手状态（World.engaged）：没在交手；正在出手（近战是贴身肉搏，远程是在射程内射击）；
 * 近战武器隔着贴身距离出手（长兵器，多在后排）
 */
export const ENG_NONE = 0, ENG_CLOSE = 1, ENG_REACH = 2;
export const GRID = 40;
export const COARSE = 320;
export const VIS_CELL = 64;

/** 单位状态位（state[]）：渲染层据此选动作，系统据此改数值 */
export const S_COMBAT = 1, S_CHARGE = 2, S_BRACE = 4, S_SHIELD = 8, S_TORCH = 16, S_ROUT = 32, S_WALL = 64;

export const FX_HIT = 1, FX_EXPLODE = 2, FX_SMOKE = 3, FX_DEATH = 4, FX_COLLAPSE = 5, FX_ARROW_HIT = 6, FX_LEVEL = 7,
  FX_IMPACT = 8, FX_FIRE = 9;
/** 远程出手（只用来出声，参数是投射物种类） */
export const FX_SHOT = 10;
/** 兵种升为高级形态、建筑落成 / 据点升级 */
export const FX_UPGRADE = 11, FX_BUILT = 12;
