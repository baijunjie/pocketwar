/**
 * 据点范围：有围墙的据点（城池、营寨）是围墙圈出的矩形（含墙、门本身），没有围墙的（资源点、临时据点）是占领圈。
 * 占领前的肃清、交战判定、休整与雪天遮蔽、守军警戒、扎营选址、电脑判断据点附近的敌情都按它算；
 * 旗帜区（站到旗下读秒）另按旗帜半径算，不在此列。
 * 据点的交战状态 fightState 也放这里：选址、索敌、修复都要用，放这里免得 targeting 引用 sites 形成循环。
 */
import { RULES } from './content';
import type { Site, World } from './world';

/** 点在据点范围之内 */
export function siteContains(s: Site, x: number, y: number): boolean {
  const r = s.rect;
  if (r) return x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1;
  return (x - s.x) ** 2 + (y - s.y) ** 2 < s.radius * s.radius;
}

/** 点到据点范围边缘的距离（在范围之内为 0） */
export function siteGap(s: Site, x: number, y: number): number {
  const r = s.rect;
  if (r) {
    const dx = x < r.x0 ? r.x0 - x : x > r.x1 ? x - r.x1 : 0;
    const dy = y < r.y0 ? r.y0 - y : y > r.y1 ? y - r.y1 : 0;
    return Math.hypot(dx, dy);
  }
  return Math.max(0, Math.hypot(x - s.x, y - s.y) - s.radius);
}

/**
 * 据点是否在交战（fighting：有建筑最近挨过打，或据点范围内有敌方单位，溃兵不算）与原因（界面显示用）：据点范围内的敌兵数（中立据点范围内任何一方的兵都算）；建筑最近一次挨打距今几秒（没挨过为 -1）；
 * 还要几秒才转为平静（范围内有敌兵时为 -1：要等敌兵离开或被消灭）。
 */
export function fightState(w: World, s: Site, calm = RULES.site.bldCalm * 30): { fighting: boolean; foes: number; hitAgo: number; calmIn: number } {
  const foes = s.owner ? s.count[3 - s.owner] : s.count[1] + s.count[2];
  let last = -1;
  for (const id of s.buildings) last = Math.max(last, w.buildings[id].hitTick);
  const ago = w.tickCount - last;
  const hit = last >= 0 && ago <= calm;
  return { fighting: foes > 0 || hit, foes, hitAgo: last >= 0 ? ago / 30 : -1, calmIn: foes > 0 ? -1 : hit ? (calm - ago) / 30 : 0 };
}
