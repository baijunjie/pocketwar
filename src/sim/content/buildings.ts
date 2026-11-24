/** 建筑数据表 */
import { BK_GATE, BK_HOUSE, BK_KEEP, BK_MAIN, BK_TOWER, BK_WALL, BR_COMMON, BR_DEFENSE, BR_MILITARY, BuildingDef, BuildingRole, TowerDef } from './types';

export const BUILDINGS: Record<string, BuildingDef> = {};
function bld(key: string, name: string, role: BuildingRole, kind: number, w: number, h: number, hp: number, armM: number, armP: number,
  breach: number, tall: number, wood: boolean, tower: TowerDef | null = null, top = 0): void {
  // role：军事建筑（会放箭，占领前要拆光）、城防（只挡路）、普通建筑（不可被攻击）。
  // 石墙是城防工事：火把烧不动，只有工程类单位能破坏。角楼、哨塔、主堡、中军帐能放箭，也能被烧毁
  const fort = !wood && kind === BK_WALL;
  BUILDINGS[key] = { key, name, kind, role, hittable: role !== BR_COMMON, w, h, hp, armM, armP, breach, tower, tall, wood, fort, top };
}
// 城墙两格厚（地图上铺两圈），墙顶与角楼顶可以站人
bld('wall', '城墙', BR_DEFENSE, BK_WALL, 1, 1, 1400, 4, 14, 2500, 22, false, null, 26);
// 石城门四格宽（大部队进出不至于挤成一路），两格深与城墙齐平
bld('gate_h', '门楼', BR_DEFENSE, BK_GATE, 4, 2, 2400, 4, 14, 450, 40, false);
bld('gate_v', '门楼', BR_DEFENSE, BK_GATE, 2, 4, 2400, 4, 14, 450, 40, false);
const TURRET: TowerDef = { range: 290, dmg: 24, cd: 0.9, arrows: 2 };
bld('tower', '角楼', BR_MILITARY, BK_TOWER, 2, 2, 2400, 4, 14, 900, 46, false, TURRET, 40);
// 主堡的火力相当于 2 座角楼：射程、单支伤害、间隔与角楼相同，每轮 4 支箭
const KEEP_FIRE: TowerDef = { ...TURRET, arrows: TURRET.arrows * 2 };
bld('keep', '主堡', BR_MILITARY, BK_KEEP, 4, 4, 6000, 5, 15, 900, 84, false, KEEP_FIRE);
bld('keep_town', '主堡', BR_MILITARY, BK_KEEP, 3, 3, 4000, 4, 12, 900, 44, false, KEEP_FIRE);
bld('house', '民居', BR_COMMON, BK_HOUSE, 2, 2, 450, 2, 8, 800, 26, false);
bld('barracks', '兵营', BR_COMMON, BK_HOUSE, 3, 2, 1000, 3, 10, 800, 28, false);
bld('palisade', '木栅', BR_DEFENSE, BK_WALL, 1, 1, 420, 2, 9, 350, 14, true);
bld('wgate_h', '营门', BR_DEFENSE, BK_GATE, 2, 1, 650, 2, 9, 280, 18, true);
bld('wgate_v', '营门', BR_DEFENSE, BK_GATE, 1, 2, 650, 2, 9, 280, 18, true);
const POST: TowerDef = { range: 250, dmg: 18, cd: 1.1, arrows: 1 };
bld('watchtower', '哨塔', BR_MILITARY, BK_TOWER, 1, 1, 700, 2, 9, 500, 40, true, POST);
bld('tent', '营帐', BR_COMMON, BK_HOUSE, 2, 2, 200, 1, 6, 700, 20, true);
// 中军帐的火力相当于 2 座哨塔：射程、单支伤害、间隔与哨塔相同，每轮 2 支箭
bld('cmdtent', '中军帐', BR_MILITARY, BK_MAIN, 3, 2, 500, 1, 6, 700, 26, true, { ...POST, arrows: POST.arrows * 2 });
// 资源点的主建筑、玩家用木材搭的哨塔与临时据点
bld('farmstead', '谷仓', BR_COMMON, BK_MAIN, 2, 2, 600, 2, 8, 800, 30, true);
bld('lumbercamp', '伐木棚', BR_COMMON, BK_MAIN, 2, 2, 600, 2, 8, 800, 24, true);
bld('quarry', '采石棚', BR_COMMON, BK_MAIN, 2, 2, 700, 3, 9, 800, 26, false);
bld('goldmine', '矿洞', BR_COMMON, BK_MAIN, 2, 2, 800, 3, 10, 800, 26, false);
bld('arrowtower', '哨塔', BR_MILITARY, BK_TOWER, 1, 1, 600, 2, 9, 500, 40, true, POST);
bld('outpost', '行营', BR_COMMON, BK_MAIN, 2, 2, 500, 2, 8, 700, 24, true);
// 行营是临时据点唯一的建筑，打掉它就是摧毁这座据点，所以例外地可以被攻击
BUILDINGS.outpost.hittable = true;

// 据点升到 3 级：城池的角楼变炮楼（每轮加 1 发炮弹）、主堡加 2 发；营寨的哨塔变连弩哨塔、中军帐，箭矢数量 ×3
BUILDINGS.tower.tier3 = { name: '炮楼', shells: 1 };
BUILDINGS.keep.tier3 = BUILDINGS.keep_town.tier3 = { name: '主堡', shells: 2 };
BUILDINGS.watchtower.tier3 = { name: '连弩哨塔', arrowMul: 3 };
BUILDINGS.cmdtent.tier3 = { name: '中军帐', arrowMul: 3 };
