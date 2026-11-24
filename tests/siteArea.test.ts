import { describe, expect, it } from 'vitest';
import { BR_MILITARY, BUILDINGS, SITE_CAMP, SITE_FARM, SITE_INFO, TILE, UNIT_BY_KEY } from '../src/sim/defs';
import { createGame } from '../src/sim/setup';
import { siteContains, siteGap } from '../src/sim/siteArea';
import { orderOutpost } from '../src/sim/systems/economy';
import { fightState } from '../src/sim/systems/sites';
import type { Site, World } from '../src/sim/world';
import { flatWorld, run } from './helpers';

const idx = (k: string): number => UNIT_BY_KEY[k].idx;
const game = (): World => createGame({
  seed: 5, factions: ['china', 'japan'], armySize: 60, difficulty: 1, fog: false, spectate: false, environment: false, supply: false,
}).world;
const clear = (w: World): void => {
  for (let i = 0; i < w.n; i++) if (w.alive[i]) w.removeUnit(i);
};
/** 血量无限、原地坚守的单位 */
const tank = (w: World, tm: number, key: string, x: number, y: number): number => {
  const u = w.spawnUnit(idx(key), tm, x, y);
  w.hp[u] = w.maxHp[u] = 1e7;
  w.orderStop([u], true);
  return u;
};

describe('据点范围：有围墙的是围墙矩形，没有围墙的是占领圈', () => {
  it('矩形取围墙（含墙、门本身）的包围盒；包含判定与距离按矩形算，没有围墙的按圆算', () => {
    const w = game();
    for (const s of w.sites) {
      if (s.rect) {
        const r = s.rect;
        expect(r.x0).toBeLessThan(s.x);
        expect(r.x1).toBeGreaterThan(s.x);
        expect(r.y0).toBeLessThan(s.y);
        expect(r.y1).toBeGreaterThan(s.y);
        // 围墙矩形比占领圈大：圈外的角落也在据点里
        expect(siteContains(s, r.x0 + 4, r.y0 + 4)).toBe(true);
        expect(Math.hypot(r.x0 + 4 - s.x, r.y0 + 4 - s.y)).toBeGreaterThan(s.radius);
        // 边缘外一点就出去了，距离按到矩形的距离算
        expect(siteContains(s, r.x1 + 1, s.y)).toBe(false);
        expect(siteGap(s, r.x1 + 40, s.y)).toBeCloseTo(40, 5);
        expect(siteGap(s, r.x1 + 30, r.y1 + 40)).toBeCloseTo(50, 5);
        expect(siteGap(s, s.x, s.y)).toBe(0);
      } else {
        expect(s.rect).toBeNull();
        expect(siteContains(s, s.x + s.radius - 1, s.y)).toBe(true);
        expect(siteContains(s, s.x + s.radius + 1, s.y)).toBe(false);
        expect(siteGap(s, s.x + s.radius + 25, s.y)).toBeCloseTo(25, 5);
      }
    }
    // 城池、营寨都有围墙，资源点没有
    for (const s of w.sites) expect(s.rect !== null).toBe(SITE_INFO[s.type].category === 'city' || SITE_INFO[s.type].category === 'camp');
  });

  it('占领：矩形内的敌人（哪怕在占领圈外）挡住读秒，矩形外的敌人不影响', () => {
    const w = game();
    clear(w);
    const s = w.sites.find(x => x.type === SITE_CAMP && x.owner === 0)!;
    const r = s.rect!;
    for (const id of s.buildings) if (w.buildings[id].def.role === BR_MILITARY) w.damageBuilding(w.buildings[id], 1e9, 0, 1, 1);
    tank(w, 1, 'yari', s.x, s.y + 16);
    const T = SITE_INFO[s.type].captureTime;
    // 敌人站在矩形的角落（比占领圈远）：挡住读秒
    const foe = tank(w, 2, 'yari', r.x1 - 10, r.y1 - 10);
    expect(Math.hypot(w.x[foe] - s.x, w.y[foe] - s.y)).toBeGreaterThan(s.radius);
    run(w, T + 3);
    expect(s.cap).toBe(0);
    expect(s.owner).toBe(0);
    // 挪到矩形外一点：不再影响，读秒走完
    w.x[foe] = w.px[foe] = r.x1 + 40;
    w.y[foe] = w.py[foe] = r.y1 + 40;
    w.homeX[foe] = w.x[foe];
    w.homeY[foe] = w.y[foe];
    run(w, T + 3);
    expect(s.owner).toBe(1);
  }, 30000);

  it('交战判定：矩形内有敌兵算交战，矩形外的不算', () => {
    const w = game();
    clear(w);
    const s = w.sites.find(x => x.type === SITE_CAMP && x.owner === 1)!;
    const r = s.rect!;
    for (const id of s.buildings) w.buildings[id].tower = null;
    const foe = tank(w, 2, 'yari', r.x0 + 10, r.y0 + 10);
    run(w, 1);
    expect(fightState(w, s).foes).toBe(1);
    expect(fightState(w, s).fighting).toBe(true);
    w.x[foe] = w.px[foe] = r.x0 - 30;
    w.y[foe] = w.py[foe] = r.y0 - 30;
    w.homeX[foe] = w.x[foe];
    w.homeY[foe] = w.y[foe];
    run(w, 1);
    expect(fightState(w, s).foes).toBe(0);
    expect(fightState(w, s).fighting).toBe(false);
  }, 30000);

  it('休整：己方据点的围墙矩形内（含占领圈外的角落）回血，矩形外不回', () => {
    const w = game();
    clear(w);
    const s = w.sites.find(x => x.type === SITE_CAMP && x.owner === 1)!;
    const r = s.rect!;
    const inn = tank(w, 1, 'yari', r.x0 + 40, r.y0 + 40);
    const out = tank(w, 1, 'yari', r.x0 - 40, r.y0 - 40);
    expect(Math.hypot(w.x[inn] - s.x, w.y[inn] - s.y)).toBeGreaterThan(s.radius);
    for (const u of [inn, out]) w.maxHp[u] = 1000, w.hp[u] = 500;
    run(w, 10);
    expect(w.hp[inn]).toBeGreaterThan(500);
    expect(w.hp[out]).toBe(500);
  }, 30000);

  it('资源点（没有围墙）仍按占领圈：圈内回不回血不论，肃清与交战按圆算', () => {
    const w = game();
    clear(w);
    const s = w.sites.find(x => x.type === SITE_FARM)!;
    s.owner = 1;
    for (const id of s.buildings) w.buildings[id].owner = 1;
    tank(w, 2, 'yari', s.x + s.radius - 10, s.y);
    run(w, 1);
    expect(fightState(w, s).foes).toBe(1);
  });
});

describe('其余按据点范围判断远近的地方', () => {
  it('扎营选址：离围墙矩形不到 60 就算太近，不再按占领圈半径估', () => {
    const w = flatWorld();
    const s = w.addSite(SITE_CAMP, '营', 60 * TILE, 60 * TILE, 0);
    // 两座对角的木栅就围出一个 20×16 格的矩形（tx 50..69，ty 52..67）
    for (const [tx, ty] of [[50, 52], [69, 67]]) s.buildings.push(w.addBuilding(BUILDINGS.palisade, tx, ty, 0, s.id).id);
    w.sealWalls();
    const r = s.rect!;
    expect(r.x1).toBe(70 * TILE);
    w.stock.wood[1] = 1000;
    const u = w.spawnUnit(idx('yari'), 1, 20 * TILE, 20 * TILE);
    const midY = s.y;
    // 占领圈半径 180，圈外 60 以内也是「太近」：从圆算，x1+40 离中心 360+，早就在圈外 60 之外
    expect(orderOutpost(w, [u], r.x1 + 40, midY)).toBe('near');
    expect(orderOutpost(w, [u], r.x1 + 110, midY)).toBeNull();
  });
});
