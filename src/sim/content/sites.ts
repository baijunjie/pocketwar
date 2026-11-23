/** 据点类型：占领圈、援军、粮草与资源产量、升级花费 */
import { SiteInfo } from './types';

const fort = { category: 'fort', material: 'stone', haven: true, counts: true, towerSlots: 0, razeFirst: true } as const;
const camp = { category: 'camp', material: 'wood', haven: true, counts: true, towerSlots: 0, razeFirst: true } as const;
/** 资源点：不出援军、不能休整，占领后自动采集；可以用木材建箭塔 */
const res = {
  category: 'resource', material: 'wood', haven: false, counts: false, towerSlots: 4, razeFirst: false, radius: 150, interval: 0, reinf: null,
  captureTime: 6, upgradeCost: 0, food: 0,
} as const;

export const SITE_INFO: SiteInfo[] = [
  { label: '大本营', radius: 0, interval: 50, reinf: 'base', value: 0, provides: '基础援军', food: 40, captureTime: 0, upgradeCost: 400, ...fort },
  { label: '城池', radius: 300, interval: 55, reinf: 'elite', value: 3, provides: '精锐援军', food: 26, captureTime: 30, upgradeCost: 320, ...fort },
  { label: '城镇', radius: 220, interval: 60, reinf: 'mixed', value: 2, provides: '步弓混编', food: 18, captureTime: 22, upgradeCost: 220, ...fort },
  { label: '营地', radius: 180, interval: 70, reinf: 'levy', value: 1.2, provides: '步兵', food: 10, captureTime: 15, upgradeCost: 160, ...camp },
  { label: '村庄', radius: 170, interval: 50, reinf: 'levy', value: 1.4, provides: '步兵', food: 16, captureTime: 12, upgradeCost: 110, ...camp, towerSlots: 4 },
  { label: '马场', radius: 160, interval: 65, reinf: 'cav', value: 1.6, provides: '骑兵', food: 9, captureTime: 12, upgradeCost: 110, ...camp },
  { label: '工坊', radius: 160, interval: 90, reinf: 'siege', value: 1.5, provides: '攻城器械', food: 6, captureTime: 12, upgradeCost: 110, ...camp },
  { label: '农庄', value: 1.1, provides: '粮食', ...res, food: 14 },
  { label: '伐木场', value: 1, provides: '木材', ...res, yields: { wood: 60 } },
  { label: '采石场', value: 1, provides: '石料', ...res, yields: { stone: 50 } },
  { label: '金矿', value: 1.3, provides: '黄金', ...res, yields: { gold: 80 } },
  {
    label: '临时据点', radius: 150, interval: 0, reinf: null, value: 0, provides: '休整', food: 0, captureTime: 0, upgradeCost: 0,
    category: 'outpost', material: 'wood', haven: true, counts: false, towerSlots: 0, razeFirst: false,
  },
];

export const SITE_CATEGORY_NAMES = { fort: '城邦', camp: '营寨', resource: '资源点', outpost: '临时据点' };
