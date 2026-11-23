/** 建筑数据表 */
import { BK_GATE, BK_HOUSE, BK_KEEP, BK_MAIN, BK_TOWER, BK_WALL, BuildingDef, TowerDef } from './types';

export const BUILDINGS: Record<string, BuildingDef> = {};
function bld(key: string, name: string, kind: number, w: number, h: number, hp: number, armM: number, armP: number,
  breach: number, tall: number, wood: boolean, tower: TowerDef | null = null, top = 0): void {
  // 石墙是城防工事：火把烧不动，只有工程类单位能破坏。角楼、门楼、望楼能放箭，也能被烧毁
  const fort = !wood && kind === BK_WALL;
  BUILDINGS[key] = { key, name, kind, w, h, hp, armM, armP, breach, tower, tall, wood, fort, top };
}
// 城墙两格厚（地图上铺两圈），墙顶与角楼顶可以站人
bld('wall', '城墙', BK_WALL, 1, 1, 1400, 4, 14, 2500, 22, false, null, 26);
bld('gate_h', '门楼', BK_GATE, 2, 2, 2400, 4, 14, 450, 40, false, { range: 270, dmg: 20, cd: 1 });
bld('gate_v', '门楼', BK_GATE, 2, 2, 2400, 4, 14, 450, 40, false, { range: 270, dmg: 20, cd: 1 });
bld('tower', '角楼', BK_TOWER, 2, 2, 2400, 4, 14, 900, 46, false, { range: 290, dmg: 24, cd: 0.9 }, 40);
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
