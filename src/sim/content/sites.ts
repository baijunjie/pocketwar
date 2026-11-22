/** 据点类型：占领圈、援军、粮草产量 */
import { SiteInfo } from './types';

export const SITE_INFO: SiteInfo[] = [
  { label: '大本营', radius: 0, interval: 50, reinf: 'base', value: 0, provides: '基础援军', food: 40, category: 'fort', captureTime: 0 },
  { label: '城池', radius: 300, interval: 55, reinf: 'elite', value: 3, provides: '精锐援军', food: 26, category: 'fort', captureTime: 30 },
  { label: '城镇', radius: 220, interval: 60, reinf: 'mixed', value: 2, provides: '步弓混编', food: 18, category: 'fort', captureTime: 22 },
  { label: '营地', radius: 180, interval: 70, reinf: 'levy', value: 1.2, provides: '步兵', food: 10, category: 'camp', captureTime: 15 },
  { label: '村庄', radius: 170, interval: 50, reinf: 'levy', value: 1.4, provides: '步兵', food: 16, category: 'camp', captureTime: 12 },
  { label: '马场', radius: 160, interval: 65, reinf: 'cav', value: 1.6, provides: '骑兵', food: 9, category: 'camp', captureTime: 12 },
  { label: '工坊', radius: 160, interval: 90, reinf: 'siege', value: 1.5, provides: '攻城器械', food: 6, category: 'camp', captureTime: 12 },
];

export const SITE_CATEGORY_NAMES = { fort: '城邦', camp: '营寨' };
