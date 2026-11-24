/** 集结点：哪些据点能设（只有会出援军的）、玩家指令作用于哪几座。界面、渲染与指令共用，保证条件一致 */
import { SITE_INFO } from './content';
import type { Site, World } from './world';

/** 这座据点能设集结点：还在、而且会出援军（资源点与临时据点不出援军，设了也没用） */
export function canRally(s: Site): boolean {
  return !s.gone && !!SITE_INFO[s.type].reinf;
}

/** 己方据点 s 此刻有效的集结点；不是 team 的、或不出援军的据点没有 */
export function rallyPoint(s: Site, team: number): { x: number; y: number } | null {
  return s.owner === team && canRally(s) ? s.rally : null;
}

/** team 一方全部能设集结点的据点 */
export function rallySites(w: World, team: number): Site[] {
  return w.sites.filter(s => s.owner === team && canRally(s));
}
