import { describe, expect, it } from 'vitest';
import { SITE_CAMP, SITE_CITY, SITE_FARM, SITE_INFO, UNIT_BY_KEY } from '../../../src/sim/defs';
import { StrategicAI } from '../../../src/sim/ai/strategic';
import { createGame } from '../../../src/sim/setup';
import type { Site, World } from '../../../src/sim/world';

const start = () => {
  const g = createGame({ seed: 5, factions: ['china', 'japan'], armySize: 120, difficulty: 1, fog: false, spectate: false, environment: false, supply: false });
  return { w: g.world, ai: g.ais[0] as StrategicAI };
};
/** 把 AI 的非守备队里第一队搬到 (x, y)，原样返回它 */
const field = (w: World, ai: StrategicAI, x: number, y: number) => {
  const grp = ai.groups.find(g => !g.guard && g.slots.length > 0)!;
  expect(grp).toBeTruthy();
  grp.slots.forEach((s, k) => {
    w.x[s] = x + (k % 8) * 14;
    w.y[s] = y + Math.floor(k / 8) * 14;
    w.orderStop([s], true);
  });
  grp.cx = grp.slots.reduce((p, s) => p + w.x[s], 0) / grp.slots.length;
  grp.cy = grp.slots.reduce((p, s) => p + w.y[s], 0) / grp.slots.length;
  return grp;
};
/** 在群旁边压上足够多的敌军（战力是它的 3 倍） */
const pressure = (w: World, cx: number, cy: number, power: number): void => {
  const d = UNIT_BY_KEY.dao;
  for (let k = 0, got = 0; got < power * 3; k++, got += d.power) w.spawnUnit(d.idx, 1, cx + 120 + (k % 10) * 12, cy + Math.floor(k / 10) * 12);
};
/** 记录 AI 下的移动令（目的地与参与的单位） */
const spyMoves = (w: World) => {
  const calls: { slots: number[]; x: number; y: number }[] = [];
  const orig = w.orderMove.bind(w);
  w.orderMove = (units, x, y, amove, fx, fy) => {
    calls.push({ slots: units.slice(), x, y });
    orig(units, x, y, amove, fx, fy);
  };
  return calls;
};

describe('电脑：开局', () => {
  it('开局的守备队守开局城池：在城池旁，弓弩手上了城墙', () => {
    const { w, ai } = start();
    const home = w.sites.find(s => s.type === SITE_CITY && s.owner === 2)!;
    const guards = ai.groups.filter(g => g.guard);
    expect(guards.length).toBeGreaterThan(0);
    const near = guards.filter(g => Math.hypot(g.ax - home.x, g.ay - home.y) < SITE_INFO[SITE_CITY].radius);
    expect(near.length).toBeGreaterThan(0);
    expect(near.some(g => g.slots.some(s => w.pmode[s] !== 0))).toBe(true);
  });

  it('开局电脑所有据点的集结点都在出发阵地，玩家的没有', () => {
    const { w } = start();
    const dp = w.map.deploy[2];
    for (const s of w.sites) {
      if (s.owner === 2) expect(s.rally, s.name).toEqual({ x: dp.x, y: dp.y });
      else expect(s.rally, s.name).toBeNull();
    }
  });
});

describe('电脑：撤退以最近的己方城池为锚点', () => {
  it('战斗群被打残、敌军逼近时，撤向离它最近的己方城池，而不是开局城池', () => {
    const { w, ai } = start();
    const home = w.sites.find(s => s.type === SITE_CITY && s.owner === 2)!;
    // 再给电脑一座离战场近得多的城池
    const forward = w.sites.find(s => s.type === SITE_CAMP && s.owner === 0)!;
    const fwd = w.addSite(SITE_CITY, '前沿城', forward.x, forward.y, 2);
    const grp = field(w, ai, forward.x + 300, forward.y);
    grp.power0 = 1e9;
    // 敌军压上来
    pressure(w, grp.cx, grp.cy, grp.slots.reduce((p, s) => p + w.defs[w.type[s]].power, 0));
    const calls = spyMoves(w);
    w.tickCount = 1000;
    ai.update();
    const mine = new Set(grp.slots);
    const retreat = calls.find(c => c.slots.some(s => mine.has(s)) && Math.abs(c.y - (fwd.y + 60)) < 1);
    expect(retreat, '撤向前沿城').toBeTruthy();
    expect(retreat!.x).toBeCloseTo(fwd.x, 0);
    expect(calls.some(c => c.slots.some(s => mine.has(s)) && Math.abs(c.y - (home.y + 60)) < 1 && Math.abs(c.x - home.x) < 1)).toBe(false);
  });

  it('没有城池时撤向最近的营寨', () => {
    const { w, ai } = start();
    for (const s of w.sites) if (s.owner === 2 && s.type === SITE_CITY) s.owner = 1;
    const camp = w.sites.find(s => s.type === SITE_CAMP && s.owner === 2)!;
    const grp = field(w, ai, camp.x + 500, camp.y + 300);
    grp.power0 = 1e9;
    pressure(w, grp.cx, grp.cy, grp.slots.reduce((p, s) => p + w.defs[w.type[s]].power, 0));
    const calls = spyMoves(w);
    w.tickCount = 1000;
    ai.update();
    const mine = new Set(grp.slots);
    const retreat = calls.find(c => c.slots.some(s => mine.has(s)) && Math.abs(c.y - (camp.y + 60)) < 1 && Math.abs(c.x - camp.x) < 1);
    expect(retreat).toBeTruthy();
  });
});

describe('电脑：给营寨选兵种', () => {
  it('指挥官提供选兵种的办法，选出的是本文明兵种表里的兵种', () => {
    const { w, ai } = start();
    const camp = w.sites.find(s => s.type === SITE_CAMP && s.owner === 2) as Site;
    const u = ai.pickCampUnit(camp);
    expect(w.defs[u].faction).toBe('japan');
    expect(w.defs[u].tier).toBe(0);
  });
});

describe('电脑：总攻的目标是敌方的城池与营寨', () => {
  it('总攻时向离战斗群最近的敌方城池或营寨推进，不去打离得更近的资源点', () => {
    const { w, ai } = start();
    const enemyCamp = w.sites.find(s => s.type === SITE_CAMP && s.owner === 1)!;
    const enemyCity = w.sites.find(s => s.type === SITE_CITY && s.owner === 1)!;
    const farm = w.sites.find(s => s.type === SITE_FARM)!;
    farm.owner = 1;
    // 战斗群在敌营寨旁（但还在 250 以外），资源点离得更近
    const px = enemyCamp.x + 600, py = enemyCamp.y;
    farm.x = px - 150;
    farm.y = py;
    const grp = field(w, ai, px, py);
    grp.mode = 3;
    const camps = (s: Site) => Math.hypot(s.x - grp.cx, s.y - grp.cy);
    expect(camps(enemyCamp)).toBeLessThan(camps(enemyCity));
    expect(camps(farm)).toBeLessThan(camps(enemyCamp));
    const calls = spyMoves(w);
    w.tickCount = 1000;
    ai.update();
    const mine = new Set(grp.slots);
    const mv = calls.find(c => c.slots.some(s => mine.has(s)));
    expect(mv).toBeTruthy();
    expect(mv!.x).toBeCloseTo(enemyCamp.x, 0);
    expect(mv!.y).toBeCloseTo(enemyCamp.y + 24, 0);
  });
});
