/**
 * 标准动作的定义：渲染器只认这些动作名，素材与代码建模都烘成这些名字。
 * 动作的含义、时长要求见 docs/unit-art-spec.md「标准动作」。不碰 three.js，可在 Node 里测试。
 */

export const STD_ACTIONS = ['idle', 'ready', 'walk', 'run', 'attack', 'attack2', 'attack3', 'attack4', 'attackMove', 'attackMoveL', 'attackMoveR',
  'attackMoveBL', 'attackMoveBR', 'die', 'charge', 'brace', 'guard', 'guardWalk'] as const;
export type StdAction = (typeof STD_ACTIONS)[number];

/** 站着出手的几种攻击：每次出手随机挑一种（缺的退回 attack，同一段只算一种） */
export const ATTACK_VARIANTS: StdAction[] = ['attack', 'attack2', 'attack3', 'attack4'];

/** 播一遍就停的动作（其余首尾相接循环） */
export const ONE_SHOT = new Set<string>([...ATTACK_VARIANTS, 'attackMoveL', 'attackMoveR', 'attackMoveBL', 'attackMoveBR', 'die']);

/**
 * 骑射手边跑边射时骑手上身的扭转（绕竖轴，弧度；正值 = 模型绕 +Y 转，即从行进方向往左手边转）。
 * 每个角度烘一个「attackMove 名」的动作，渲染层按目标方位挑最接近的那个；没有的退回 attackMove。
 */
export const TWIST_CLIPS: [StdAction, number][] = [
  ['attackMoveL', Math.PI / 2], ['attackMoveR', -Math.PI / 2],
  ['attackMoveBL', Math.PI * 0.78], ['attackMoveBR', -Math.PI * 0.78],
];

/** 缺少某个动作时依次退到哪些动作 */
export const CLIP_FALLBACK: Record<string, StdAction[]> = {
  ready: ['idle'],
  attackMoveL: ['attackMove', 'attack', 'idle'],
  attackMoveR: ['attackMove', 'attack', 'idle'],
  attackMoveBL: ['attackMove', 'attack', 'idle'],
  attackMoveBR: ['attackMove', 'attack', 'idle'],
  walk: ['run', 'idle'],
  run: ['walk', 'idle'],
  attack: ['idle'],
  attack2: ['attack', 'idle'],
  attack3: ['attack', 'idle'],
  attack4: ['attack', 'idle'],
  attackMove: ['attack', 'idle'],
  die: ['idle'],
  charge: ['run', 'walk', 'idle'],
  brace: ['ready', 'idle'],
  guard: ['ready', 'idle'],
  guardWalk: ['walk', 'run', 'idle'],
};

/** 骑兵的每个动作配坐骑的哪个动作 */
export function mountAction(std: StdAction): 'idle' | 'walk' | 'run' | 'die' {
  if (std === 'walk' || std === 'guardWalk') return 'walk';
  if (std === 'run' || std === 'charge' || std.startsWith('attackMove')) return 'run';
  if (std === 'die') return 'die';
  return 'idle';
}
