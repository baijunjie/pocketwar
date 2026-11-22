/** 建筑数据表 */
import { BK_GATE, BK_HOUSE, BK_KEEP, BK_MAIN, BK_TOWER, BK_WALL, BuildingDef, TowerDef } from './types';

export const BUILDINGS: Record<string, BuildingDef> = {};
function bld(key: string, name: string, kind: number, w: number, h: number, hp: number, armM: number, armP: number,
  breach: number, tall: number, wood: boolean, tower: TowerDef | null = null): void {
  // 石质的墙与箭楼是城防工事；石墙够厚，墙顶可以站人
  const fort = !wood && (kind === BK_WALL || kind === BK_TOWER);
  BUILDINGS[key] = { key, name, kind, w, h, hp, armM, armP, breach, tower, tall, wood, fort, top: fort && kind === BK_WALL ? 26 : 0 };
}
bld('wall', '城墙', BK_WALL, 1, 1, 1400, 4, 14, 2500, 22, false);
bld('gate_h', '城门', BK_GATE, 2, 1, 2000, 4, 14, 450, 28, false);
bld('gate_v', '城门', BK_GATE, 1, 2, 2000, 4, 14, 450, 28, false);
bld('tower', '箭楼', BK_TOWER, 2, 2, 2400, 4, 14, 900, 46, false, { range: 290, dmg: 24, cd: 0.9 });
bld('keep', '主堡', BK_KEEP, 4, 4, 9000, 5, 15, 900, 84, false, { range: 310, dmg: 30, cd: 0.6 });
bld('citadel', '内城', BK_MAIN, 4, 4, 6000, 5, 15, 900, 70, false, { range: 300, dmg: 26, cd: 0.7 });
bld('hall', '镇公所', BK_MAIN, 3, 3, 3000, 4, 12, 900, 44, false);
bld('house', '民居', BK_HOUSE, 2, 2, 450, 2, 8, 800, 26, false);
bld('barracks', '兵营', BK_HOUSE, 3, 2, 1000, 3, 10, 800, 28, false);
bld('palisade', '木栅', BK_WALL, 1, 1, 420, 2, 9, 350, 14, true);
bld('wgate_h', '营门', BK_GATE, 2, 1, 650, 2, 9, 280, 18, true);
bld('wgate_v', '营门', BK_GATE, 1, 2, 650, 2, 9, 280, 18, true);
bld('watchtower', '望楼', BK_TOWER, 1, 1, 700, 2, 9, 500, 40, true, { range: 250, dmg: 18, cd: 1.1 });
bld('tent', '营帐', BK_HOUSE, 2, 2, 200, 1, 6, 700, 20, true);
bld('cmdtent', '中军帐', BK_MAIN, 3, 2, 500, 1, 6, 700, 26, true);
bld('granary', '粮仓', BK_MAIN, 2, 2, 700, 2, 8, 800, 34, true);
bld('stable', '马厩', BK_MAIN, 3, 2, 800, 2, 8, 800, 26, true);
bld('workshop', '工坊', BK_MAIN, 3, 2, 900, 3, 9, 800, 30, false);
bld('farmhouse', '农舍', BK_HOUSE, 2, 2, 350, 1, 7, 800, 24, true);
