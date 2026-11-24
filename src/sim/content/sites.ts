/** 据点类型：占领圈、援军、粮草与资源产量、升级花费 */
import { SiteInfo } from './types';

const city = { category: 'city', material: 'stone', haven: true, counts: true, towerSlots: 0, regen: true, reinf: 'full', reinfForce: 0 } as const;
/** 资源点：不出援军、不能休整，占领后自动采集；可以用木材建哨塔 */
const res = {
  category: 'resource', material: 'wood', haven: false, counts: false, towerSlots: 4, regen: false, radius: 150, interval: 0, reinf: null,
  reinfScale: 0, reinfForce: 0, captureTime: 6, upgradeCost: 0, food: 0,
} as const;

export const SITE_INFO: SiteInfo[] = [
  // 城池与城镇共用一张全兵种援军表，城镇每批是城池的 0.6 倍
  { label: '城池', radius: 300, interval: 55, reinfScale: 1, value: 3, provides: '全兵种援军', food: 40, captureTime: 30, upgradeCost: 320, ...city },
  { label: '城镇', radius: 220, interval: 60, reinfScale: 0.6, value: 2, provides: '全兵种援军', food: 18, captureTime: 22, upgradeCost: 220, ...city },
  // 营寨：每座每批出占领方选定的一个兵种，人数 = 份数 × 难度倍率（只有电脑一方）÷ 兵力占用。
  // 数值由来：全图 12 座营寨的总出兵速率与总产粮，与原营地、村庄、马场、工坊按座数加权相当；每批 11.6 份是占位起点
  {
    label: '营寨', radius: 170, interval: 66, reinf: 'pick', reinfScale: 0, reinfForce: 11.6, value: 1.4, provides: '一种兵种的援军', food: 11.2, captureTime: 13,
    upgradeCost: 127, category: 'camp', material: 'wood', haven: true, counts: true, towerSlots: 0, regen: true,
  },
  { label: '农庄', value: 1.1, provides: '粮食', ...res, food: 14 },
  { label: '伐木场', value: 1, provides: '木材', ...res, yields: { wood: 60 } },
  { label: '采石场', value: 1, provides: '石料', ...res, yields: { stone: 50 } },
  { label: '金矿', value: 1.3, provides: '黄金', ...res, yields: { gold: 80 } },
  {
    label: '临时据点', radius: 150, interval: 0, reinf: null, reinfScale: 0, reinfForce: 0, value: 0, provides: '休整', food: 0, captureTime: 0, upgradeCost: 0,
    category: 'outpost', material: 'wood', haven: true, counts: false, towerSlots: 0, regen: true,
  },
];

export const SITE_CATEGORY_NAMES = { city: '城池', camp: '营寨', resource: '资源点', outpost: '临时据点' };
