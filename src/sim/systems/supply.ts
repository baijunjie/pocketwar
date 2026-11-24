/** 粮草：据点产粮、部队吃粮，断粮后饥饿程度上升并压低士气 */
import { RULES, SITE_INFO } from '../content';
import type { World } from '../world';

/** 开局部队就位后调用：以当前全军口粮为基准定出存粮与粮仓上限 */
export function initSupply(w: World): void {
  for (let tm = 1; tm <= 2; tm++) {
    w.upkeep0[tm] = w.upkeep[tm];
    w.food[tm] = w.upkeep0[tm] * RULES.supply.startMinutes;
    w.foodCap[tm] = w.upkeep0[tm] * RULES.supply.capMinutes;
    w.hunger[tm] = 0;
  }
  updateSupply(w, 0);
}

/** 一个据点每分钟给某队产多少粮 */
export function siteFood(w: World, type: number, tm: number): number {
  return (SITE_INFO[type].food * w.upkeep0[tm]) / 100;
}

export function updateSupply(w: World, seconds = 1): void {
  const S = RULES.supply;
  for (let tm = 1; tm <= 2; tm++) {
    if (w.upkeep0[tm] <= 0) continue;
    let prod = 0;
    for (const s of w.sites) if (s.owner === tm) prod += siteFood(w, s.type, tm);
    const cons = w.upkeep[tm];
    w.foodIn[tm] = prod;
    w.foodOut[tm] = cons;
    w.food[tm] = Math.max(0, Math.min(w.foodCap[tm], w.food[tm] + ((prod - cons) / 60) * seconds));
    const was = w.hunger[tm] > 0.15;
    if (w.food[tm] <= 0 && cons > prod) {
      // 缺口越大饿得越狠：产量只够一半人吃，饥饿程度最多涨到 0.5
      const short = 1 - prod / cons;
      w.hunger[tm] = w.hunger[tm] < short ? Math.min(short, w.hunger[tm] + seconds / S.starveTime)
        : Math.max(short, w.hunger[tm] - seconds / S.recoverTime);
    } else w.hunger[tm] = Math.max(0, w.hunger[tm] - seconds / S.recoverTime);
    const now = w.hunger[tm] > 0.15;
    if (was !== now) w.events.push({ kind: 'hunger', team: tm, on: now });
  }
}
