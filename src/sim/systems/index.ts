/**
 * 系统管线。World.tick() 按顺序执行这里列出的系统；每个系统只做一件事，彼此通过世界状态交换数据。
 * 想换掉某个算法（比如换一套士气规则），替换 world.systems 里对应的那一项即可。
 */
import type { World } from '../world';
import { AURA_EVERY, updateAuras } from './aura';
import { updateProjectiles, updateTowers } from './combat';
import { ECON_EVERY, updateEconomy } from './economy';
import { updateEnvironment } from './environment';
import { buildGrid } from './grid';
import { updateMarches } from './march';
import { MORALE_EVERY, updateMorale } from './morale';
import { updateSites } from './sites';
import { updateSupply } from './supply';
import { updateUnits } from './units';
import { updateVision } from './vision';

export interface System {
  name: string;
  /** 每隔多少帧执行一次，以及在周期内的哪一帧 */
  every: number;
  phase: number;
  run(w: World): void;
}

export const ENV_EVERY = 10, SITE_EVERY = 15, SUPPLY_EVERY = 30, VISION_EVERY = 6;

export function defaultSystems(): System[] {
  return [
    { name: 'environment', every: ENV_EVERY, phase: 0, run: updateEnvironment },
    { name: 'grid', every: 1, phase: 0, run: buildGrid },
    // 光环在出手与投射物结算之前：本帧的伤害按刚判定的加成算
    { name: 'aura', every: AURA_EVERY, phase: 0, run: updateAuras },
    { name: 'march', every: 1, phase: 0, run: updateMarches },
    { name: 'units', every: 1, phase: 0, run: updateUnits },
    { name: 'projectiles', every: 1, phase: 0, run: updateProjectiles },
    { name: 'towers', every: 1, phase: 0, run: updateTowers },
    { name: 'sites', every: SITE_EVERY, phase: 0, run: updateSites },
    { name: 'supply', every: SUPPLY_EVERY, phase: 7, run: updateSupply },
    { name: 'economy', every: ECON_EVERY, phase: 5, run: updateEconomy },
    { name: 'morale', every: MORALE_EVERY, phase: 3, run: updateMorale },
    { name: 'vision', every: VISION_EVERY, phase: 1, run: updateVision },
    { name: 'nav', every: 1, phase: 0, run: w => w.nav.maintain(w.tickCount) },
  ];
}
