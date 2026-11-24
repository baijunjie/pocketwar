/**
 * 据点范围：有围墙的据点（城池、营寨）是围墙圈出的矩形（含墙、门本身），没有围墙的（资源点、临时据点）是占领圈。
 * 占领前的肃清、交战判定、休整与雪天遮蔽、守军警戒、扎营选址、电脑判断据点附近的敌情都按它算；
 * 旗帜区（站到旗下读秒）另按旗帜半径算，不在此列。
 */
import type { Site } from './world';

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
