/** 通用的缓动函数（不依赖任何模块） */

/** 平滑阶跃：t ≤ 0 为 0，t ≥ 1 为 1，中间按 3t² − 2t³ 过渡，两端斜率为 0 */
export const smooth = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
