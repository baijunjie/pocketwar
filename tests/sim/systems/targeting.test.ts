import { describe, expect, it } from 'vitest';
import { BUILDINGS, RULES, SIZES, SITE_CAMP, SITE_CITY, TILE, T_HILL, UNIT_BY_KEY } from '../../../src/sim/defs';
import { BLD_SKIP_ALL, S_ROUT, S_WALL } from '../../../src/sim/state';
import { SCAN, canAttackBuilding, crowded, findBuilding, findWallFoe, foeSiteFighting, foeTargets, scan, wallSpotBad, windRangeMul } from '../../../src/sim/systems/targeting';
import { NONE } from '../../../src/sim/world';
import type { Site, World } from '../../../src/sim/world';
import { flatWorld, run } from '../../helpers';

const idx = (k: string): number => UNIT_BY_KEY[k].idx;

describe('canAttackBuilding：谁能攻击这座建筑', () => {
  const w = flatWorld();
  const mk = (key: string, owner: number) => w.addBuilding(BUILDINGS[key], 10, 10, owner, -1);

  it('立着的、不是自己的、可被攻击的建筑能打：敌方的与中立的军事建筑、城防', () => {
    expect(canAttackBuilding(mk('watchtower', 2), 1, false)).toBe(true);
    expect(canAttackBuilding(mk('watchtower', 0), 1, false)).toBe(true);
    expect(canAttackBuilding(mk('tower', 2), 1, false)).toBe(true);
    expect(canAttackBuilding(mk('wgate_h', 2), 1, false)).toBe(true);
    expect(canAttackBuilding(mk('palisade', 2), 1, false)).toBe(true);
  });

  it('自己的建筑不能打', () => {
    expect(canAttackBuilding(mk('watchtower', 1), 1, true)).toBe(false);
    expect(canAttackBuilding(mk('wall', 2), 2, true)).toBe(false);
  });

  it('倒了的建筑不能打', () => {
    const b = mk('watchtower', 2);
    b.alive = false;
    expect(canAttackBuilding(b, 1, true)).toBe(false);
  });

  it('普通建筑不可被攻击，工程类也不行；行营是例外', () => {
    for (const k of ['house', 'barracks', 'tent', 'farmstead', 'lumbercamp', 'quarry', 'goldmine']) {
      expect(canAttackBuilding(mk(k, 2), 1, true), k).toBe(false);
      expect(canAttackBuilding(mk(k, 0), 1, true), k).toBe(false);
    }
    expect(canAttackBuilding(mk('outpost', 2), 1, false)).toBe(true);
  });

  it('城防工事（石墙）只有工程类打得动；门楼、木栅人形单位也能打', () => {
    const wall = mk('wall', 2);
    expect(canAttackBuilding(wall, 1, false)).toBe(false);
    expect(canAttackBuilding(wall, 1, true)).toBe(true);
    expect(canAttackBuilding(mk('gate_h', 2), 1, false)).toBe(true);
  });
});

describe('索敌：优先打自己克制的兵种', () => {
  /** 在 (cx, cy) 摆一个单位，再在它周围摆几个敌人（血量无限、不动），跑一帧，返回它盯上的敌人 */
  function pick(me: string, foes: [string, number, number][]): string | null {
    const w = flatWorld();
    const cx = 60 * 20, cy = 60 * 20;
    const u = w.spawnUnit(idx(me), 1, cx, cy);
    const ids = foes.map(([k, dx, dy]) => {
      const e = w.spawnUnit(idx(k), 2, cx + dx, cy + dy);
      w.hp[e] = w.maxHp[e] = 1e7;
      w.orderStop([e], true);
      return e;
    });
    w.hp[u] = w.maxHp[u] = 1e7;
    run(w, 0.5);
    const t = w.target[u];
    if (t === NONE) return null;
    return foes[ids.indexOf(t)]?.[0] ?? null;
  }

  it('克制对方的兵种：比最近的敌人稍远一点也先打它（距离按 0.8 折算）', () => {
    const yari = UNIT_BY_KEY.yari, cav = UNIT_BY_KEY.tieqi, inf = UNIT_BY_KEY.dao;
    expect(yari.vs[cav.idx]).toBeGreaterThan(1.05);
    expect(yari.vs[inf.idx]).toBeLessThanOrEqual(1.05);
    expect(pick('yari', [['dao', 80, 0], ['tieqi', 0, 90]])).toBe('tieqi');
  });

  it('被对方克制的兵种：比最近的敌人稍近一点也后打它（距离按 1.15 折算）', () => {
    const cav = UNIT_BY_KEY.tieqi, yari = UNIT_BY_KEY.yari, inf = UNIT_BY_KEY.dao;
    expect(cav.vs[yari.idx]).toBeLessThan(0.95);
    expect(cav.vs[inf.idx]).toBeGreaterThanOrEqual(0.95);
    expect(pick('tieqi', [['yari', 80, 0], ['dao', 0, 90]])).toBe('dao');
  });

  it('差得很远时还是先打近的', () => {
    expect(pick('yari', [['dao', 60, 0], ['tieqi', 0, 140]])).toBe('dao');
  });
});

describe('findWallFoe：远程单位去打墙顶上的敌兵，挑哪一个', () => {
  const C = 60 * TILE;
  const WALL_TY = 60;
  const WALL_Y = WALL_TY * TILE + 10;
  const nu = UNIT_BY_KEY.nu;

  /**
   * 一排敌方城墙，我方站定的弩兵 asker 在墙正南 gap 远；foes 给出各个敌兵在墙顶的 x。
   * 跑一帧让索敌网格与墙顶标志就位，再把可见性都置为己方看得见。
   */
  const scene = (foes: number[], gap = 500): { w: World; asker: number; ids: number[] } => {
    const w = flatWorld();
    for (let tx = 20; tx <= 100; tx++) w.addBuilding(BUILDINGS.wall, tx, WALL_TY, 2, -1);
    w.sealWalls();
    const asker = w.spawnUnit(idx('nu'), 1, C, WALL_Y + gap);
    w.orderStop([asker], true);
    const ids = foes.map(x => {
      const e = w.spawnUnit(idx('yumi'), 2, x, WALL_Y);
      w.orderStop([e], true);
      return e;
    });
    w.tick();
    w.fxN = 0;
    for (const e of ids) w.seen[e] |= 2;
    return { w, asker, ids };
  };
  const find = (w: World, asker: number, leash = 0, inFight = false): number =>
    findWallFoe(w, asker, 1, w.x[asker], w.y[asker], nu, leash, inFight);

  it('场景前提：敌兵都在墙顶', () => {
    const { w, ids } = scene([C - 100, C + 100]);
    for (const e of ids) expect(w.state[e] & S_WALL).toBe(S_WALL);
  });

  it('没有墙上的敌兵：什么也不挑', () => {
    const { w, asker } = scene([]);
    expect(find(w, asker)).toBe(NONE);
  });

  it('多个墙上敌兵取最近的', () => {
    const { w, asker, ids } = scene([C + 300, C - 40, C - 400]);
    expect(find(w, asker)).toBe(ids[1]);
  });

  it('不挑：地面上的敌兵、己方自己站在墙上的人、己方看不见的、已溃逃的', () => {
    const { w, asker, ids } = scene([C - 100, C + 100, C + 200]);
    const ground = w.spawnUnit(idx('yumi'), 2, C, WALL_Y + 300);
    const mineOnWall = w.spawnUnit(idx('yumi'), 1, C, WALL_Y);
    w.orderStop([ground, mineOnWall], true);
    w.tick();
    w.fxN = 0;
    expect(w.state[mineOnWall] & S_WALL).toBe(S_WALL);
    expect(w.state[ground] & S_WALL).toBe(0);
    w.seen[ground] |= 2;
    w.seen[mineOnWall] |= 2;
    w.seen[ids[0]] = 4;
    w.state[ids[1]] = S_ROUT | S_WALL;
    // 剩下 ids[2]
    expect(find(w, asker)).toBe(ids[2]);
    w.seen[ids[2]] = 4;
    expect(find(w, asker)).toBe(NONE);
  });

  it('离自己超过 wallSeek 的不挑，不超过的挑（按直线距离算，不是按方框）', () => {
    // 敌兵在人的东北：横纵各差 d，直线距离 d × √2 落在 wallSeek 两侧，但都在边长 2 × wallSeek 的方框之内
    const reach = (extra: number): number => (RULES.combat.wallSeek + extra) / Math.SQRT2;
    const out = scene([C + reach(50)], reach(50));
    expect(find(out.w, out.asker)).toBe(NONE);
    const inn = scene([C + reach(-50)], reach(-50));
    expect(find(inn.w, inn.asker)).toBe(inn.ids[0]);
    // 正北方向也一样
    const edge = RULES.combat.wallSeek;
    const far = scene([C], edge + 50);
    expect(find(far.w, far.asker)).toBe(NONE);
  });

  it('leash 大于 0 时，离岗位超过 leash 的不挑；岗位不是人此刻的位置', () => {
    const { w, asker, ids } = scene([C], 600);
    // 岗位就在人所在的地方，离敌兵约 600
    expect(find(w, asker, 500)).toBe(NONE);
    expect(find(w, asker, 700)).toBe(ids[0]);
    expect(find(w, asker, 0)).toBe(ids[0]);
    // 人离敌兵近，岗位离敌兵远：按岗位算
    w.homeY[asker] = WALL_Y + 900;
    expect(find(w, asker, 700)).toBe(NONE);
    expect(find(w, asker, 1000)).toBe(ids[0]);
  });

  describe('inFight：只挑所在据点在交战的、或自己正在打己方的人的', () => {
    it('不在任何据点范围内、又没在打己方的人：不挑；传 false 时照挑', () => {
      const { w, asker, ids } = scene([C]);
      expect(find(w, asker, 0, false)).toBe(ids[0]);
      expect(find(w, asker, 0, true)).toBe(NONE);
    });

    it('它正在打己方的人：挑；它在打的是别的（建筑、没有目标）：不挑', () => {
      const { w, asker, ids } = scene([C - 100, C + 100]);
      w.target[ids[1]] = asker;
      expect(find(w, asker, 0, true)).toBe(ids[1]);
      const b = w.addBuilding(BUILDINGS.house, 30, 70, 1, -1);
      w.target[ids[1]] = -b.id - 2;
      expect(find(w, asker, 0, true)).toBe(NONE);
    });
  });

  describe('走到刚好进射程的那一点走不通或有塔：不挑，转挑下一个', () => {
    // 近的一个 A 在人的正前偏西，远的一个 B 偏东；A 的落点（离墙约一个射程、偏南）旁放障碍
    const A = C - 100, B = C + 400;
    const pointY = WALL_TY + 7;
    const picks = (put: (w: World) => void): { got: number; a: number; b: number } => {
      const { w, asker, ids } = scene([A, B]);
      put(w);
      return { got: find(w, asker), a: ids[0], b: ids[1] };
    };

    it('对照：什么障碍也没有时挑近的 A', () => {
      const r = picks(() => {});
      expect(r.got).toBe(r.a);
    });

    it('A 的落点在城墙里：挑 B', () => {
      const r = picks(w => {
        for (let tx = 50; tx <= 62; tx++) w.addBuilding(BUILDINGS.wall, tx, pointY, 2, -1);
      });
      expect(r.got).toBe(r.b);
    });

    it.each([2, 0])('A 的落点在箭塔射程里（箭塔属于 %i 方）：挑 B', owner => {
      const r = picks(w => {
        w.addBuilding(BUILDINGS.watchtower, 55, pointY, owner, -1);
      });
      expect(r.got).toBe(r.b);
    });

    it('己方的箭塔不算', () => {
      const r = picks(w => {
        w.addBuilding(BUILDINGS.watchtower, 55, pointY, 1, -1);
      });
      expect(r.got).toBe(r.a);
    });

    it('所有候选都走不通：什么也不挑', () => {
      const r = picks(w => {
        for (let tx = 20; tx <= 100; tx++) w.addBuilding(BUILDINGS.wall, tx, pointY, 2, -1);
      });
      expect(r.got).toBe(NONE);
    });
  });
});

describe('wallSpotBad：风对停下的位置与箭塔射程的影响', () => {
  const C = 60 * TILE;
  const WALL_TY = 60;
  const WALL_Y = WALL_TY * TILE + 10;
  const nu = UNIT_BY_KEY.nu;
  const K = RULES.env.windRange;

  /** 墙顶一个敌兵 e（在 x = C），弩兵 asker 在它正南 500 处；返回与它们的 wallSpotBad */
  const scene = (paint?: (t: Uint8Array, n: number) => void): { w: World; e: number; asker: number; bad: () => boolean } => {
    const w = flatWorld(120, 7, paint);
    for (let tx = 20; tx <= 100; tx++) w.addBuilding(BUILDINGS.wall, tx, WALL_TY, 2, -1);
    w.sealWalls();
    const asker = w.spawnUnit(idx('nu'), 1, C, WALL_Y + 500);
    const e = w.spawnUnit(idx('yumi'), 2, C, WALL_Y);
    w.orderStop([asker, e], true);
    w.tick();
    w.fxN = 0;
    return { w, e, asker, bad: () => wallSpotBad(w, 1, e, w.x[asker], w.y[asker], nu) };
  };
  const wind = (w: World, dir: number, force: number): void => {
    w.env.enabled = true;
    w.env.nextWeather = w.env.nextWind = 1e9;
    w.env.windy = force > 0;
    w.env.wind = w.env.windTarget = force;
    w.env.windDir = dir;
  };
  /** 弩兵朝北射，风朝南吹是顶风、朝北吹是顺风、朝东吹是侧风 */
  const HEAD = Math.PI / 2, TAIL = -Math.PI / 2, SIDE = 0;

  describe('顶风时停下的位置更靠近目标', () => {
    /** 无风时停下的那一点离敌兵多远；顶风时近 range × K 左右（超过一格） */
    const stopAt = (w: World, e: number, mul: number): number => nu.main.range * mul + w.rad[e] + nu.radius;
    /** 在顶风时停下的那一点所在的格子盖一排城墙（无风时停下的点比它靠南一格以上） */
    const wallAtHeadwindStop = (w: World, e: number): void => {
      const ty = ((w.y[e] + stopAt(w, e, 1 - K)) / TILE) | 0;
      for (let tx = 20; tx <= 100; tx++) w.addBuilding(BUILDINGS.wall, tx, ty, 2, -1);
    };

    it('同一摆位：无风时安全，顶风时那一点进了城墙而不该去；顺风、侧风不受影响', () => {
      const { w, e, bad } = scene();
      wallAtHeadwindStop(w, e);
      expect(nu.main.range * K, '顶风与无风的停点差超过一格').toBeGreaterThan(TILE);
      expect(windRangeMul(w, 0, -1)).toBe(1);
      expect(bad(), '无风').toBe(false);
      wind(w, SIDE, 1);
      expect(bad(), '侧风').toBe(false);
      wind(w, TAIL, 1);
      expect(bad(), '顺风').toBe(false);
      wind(w, HEAD, 1);
      expect(bad(), '顶风').toBe(true);
    });

    it('风力小一半，停点只近一半：差不到一格时仍然安全', () => {
      const { w, e, bad } = scene();
      wallAtHeadwindStop(w, e);
      // 风力 0.3：停点只比无风时近 range × K × 0.3，不到一格，仍在盖了城墙的那一格之外
      expect(nu.main.range * K * 0.3).toBeLessThan(TILE * 0.5);
      wind(w, HEAD, 0.3);
      expect(bad()).toBe(false);
    });
  });

  describe('顺风时箭塔的有效射程更长', () => {
    /** 无风时停下的那一点 (px, py)；在它正西 d 处放一座敌方哨塔（格子中心离那一点的距离落在 [lo, hi] 里的那一格） */
    const towerAt = (w: World, e: number, lo: number, hi: number): void => {
      const px = w.x[e], py = w.y[e] + nu.main.range + w.rad[e] + nu.radius;
      const ty = (py / TILE) | 0;
      for (let tx = 0; tx < 60; tx++) {
        const d = Math.hypot(px - (tx + 0.5) * TILE, py - (ty + 0.5) * TILE);
        if (d >= lo && d <= hi) {
          w.addBuilding(BUILDINGS.watchtower, tx, ty, 2, -1);
          return;
        }
      }
      throw new Error('没找到合适的格子');
    };
    const R = BUILDINGS.watchtower.tower!.range;

    it('塔离那一点比射程远一点：无风、顶风安全，顺风那一点进了塔的射程而不该去', () => {
      const { w, e, bad } = scene();
      towerAt(w, e, R * 1.03, R * (1 + K) * 0.97);
      expect(bad(), '无风').toBe(false);
      // 塔在那一点正西：朝东吹是塔射向那一点的顺风；朝西吹是顶风。东西向的风不改变弩兵朝北射时停下的位置
      wind(w, Math.PI, 1);
      expect(bad(), '朝西吹，对塔是顶风').toBe(false);
      wind(w, 0, 1);
      expect(bad(), '朝东吹，对塔是顺风').toBe(true);
    });
  });
});

describe('wallSpotBad：停下的位置按高地算射程', () => {
  const C = 60 * TILE;
  const WALL_TY = 60;
  const WALL_Y = WALL_TY * TILE + 10;
  const nu = UNIT_BY_KEY.nu;

  /** hill：墙南 5 格起往南 6 排格子是高地；停在高地上射程长 12%，停点更靠南 */
  const bad = (hill: boolean): boolean => {
    const w = flatWorld(120, 7, (t, n) => {
      if (!hill) return;
      for (let ty = WALL_TY + 5; ty < WALL_TY + 12; ty++) for (let tx = 0; tx < n; tx++) t[ty * n + tx] = T_HILL;
    });
    for (let tx = 20; tx <= 100; tx++) w.addBuilding(BUILDINGS.wall, tx, WALL_TY, 2, -1);
    w.sealWalls();
    const asker = w.spawnUnit(idx('nu'), 1, C, WALL_Y + 500);
    const e = w.spawnUnit(idx('yumi'), 2, C, WALL_Y);
    w.orderStop([asker, e], true);
    w.tick();
    w.fxN = 0;
    // 在平地停点与高地停点之间找一个放敌方哨塔的格子：离高地停点在射程内、离平地停点在射程外，且不在弩兵走过去的那条线上
    const R = BUILDINGS.watchtower.tower!.range;
    const p0 = w.y[e] + nu.main.range + w.rad[e] + nu.radius, p1 = w.y[e] + nu.main.range * 1.12 + w.rad[e] + nu.radius;
    let found = false;
    for (let ty = 60; ty < 100 && !found; ty++) for (let tx = 40; tx < 80 && !found; tx++) {
      const cx = (tx + 0.5) * TILE, cy = (ty + 0.5) * TILE;
      if (Math.abs(cx - C) < 2 * TILE) continue;
      if (Math.hypot(cx - C, cy - p1) < R - 1 && Math.hypot(cx - C, cy - p0) > R + 1) {
        w.addBuilding(BUILDINGS.watchtower, tx, ty, 2, -1);
        found = true;
      }
    }
    expect(found, '找到放塔的格子').toBe(true);
    return wallSpotBad(w, 1, e, w.x[asker], w.y[asker], nu);
  };

  it('停点在高地上时射程长 12%：停得更远，那一点落进箭塔射程而不该去；平地上同一摆位安全', () => {
    expect(bad(false)).toBe(false);
    expect(bad(true)).toBe(true);
  });
});

describe('foeTargets：墙顶敌兵此刻在打 tm 一方的人', () => {
  const C = 60 * TILE;
  const make = () => {
    const w = flatWorld();
    const foe = w.spawnUnit(idx('yumi'), 2, C, C);
    const mine = w.spawnUnit(idx('dao'), 1, C + 100, C);
    const theirs = w.spawnUnit(idx('dao'), 2, C - 100, C);
    return { w, foe, mine, theirs };
  };

  it('手里的攻击目标是我方单位：真', () => {
    const { w, foe, mine } = make();
    w.target[foe] = mine;
    expect(foeTargets(w, foe, 1)).toBe(true);
  });

  it('没有目标：假', () => {
    const { w, foe } = make();
    expect(foeTargets(w, foe, 1)).toBe(false);
  });

  it('目标是别队的单位（对 tm 而言）：假', () => {
    const { w, foe, mine, theirs } = make();
    w.target[foe] = mine;
    expect(foeTargets(w, foe, 2)).toBe(false);
    w.target[foe] = theirs;
    expect(foeTargets(w, foe, 1)).toBe(false);
  });

  it('目标是建筑：假', () => {
    const { w, foe } = make();
    const b = w.addBuilding(BUILDINGS.watchtower, 70, 70, 1, -1);
    w.orderAttackBuilding([foe], b);
    expect(w.target[foe]).toBe(-b.id - 2);
    expect(foeTargets(w, foe, 1)).toBe(false);
  });
});

describe('foeSiteFighting：墙顶敌兵所在的据点正在交战', () => {
  const C = 60 * TILE;
  const WALL_TY = 60;
  const WALL_Y = WALL_TY * TILE + 10;

  /** 敌方城池（范围 ty 40..60），一个敌兵站在南墙顶、一个站在城外远处；返回据点与两个敌兵 */
  const scene = (): { w: World; site: Site; onWall: number; outside: number } => {
    const w = flatWorld();
    const site = w.addSite(SITE_CITY, '敌城', 30 * TILE, 40 * TILE, 2);
    for (let tx = 30; tx <= 90; tx++) site.buildings.push(w.addBuilding(BUILDINGS.wall, tx, WALL_TY, 2, site.id).id);
    site.buildings.push(w.addBuilding(BUILDINGS.wall, 30, 40, 2, site.id).id);
    w.sealWalls();
    const onWall = w.spawnUnit(idx('yumi'), 2, C, WALL_Y);
    const outside = w.spawnUnit(idx('yumi'), 2, C, WALL_Y + 800);
    w.orderStop([onWall, outside], true);
    return { w, site, onWall, outside };
  };

  it('据点平静：假', () => {
    const { w, onWall } = scene();
    run(w, 1);
    expect(foeSiteFighting(w, onWall)).toBe(false);
  });

  it('据点的建筑刚挨过打：真；挨打过去 bldCalm 秒之后又转为假', () => {
    const { w, site, onWall } = scene();
    w.damageBuilding(w.buildings[site.buildings[10]], 50, 1, 1, 1, true);
    expect(foeSiteFighting(w, onWall)).toBe(true);
    run(w, RULES.site.bldCalm + 1);
    expect(foeSiteFighting(w, onWall)).toBe(false);
  });

  it('据点范围里有对方（己方）的兵：真；兵走了之后转为假', () => {
    const { w, onWall } = scene();
    const q = w.spawnUnit(idx('dao'), 1, C - 400, WALL_TY * TILE - 150);
    w.orderStop([q], true);
    run(w, 1);
    expect(foeSiteFighting(w, onWall)).toBe(true);
    w.removeUnit(q);
    run(w, 1);
    expect(foeSiteFighting(w, onWall)).toBe(false);
  });

  it('不在任何据点范围内的敌兵：假，即使别的据点在交战', () => {
    const { w, site, outside, onWall } = scene();
    w.damageBuilding(w.buildings[site.buildings[10]], 50, 1, 1, 1, true);
    expect(foeSiteFighting(w, onWall)).toBe(true);
    expect(foeSiteFighting(w, outside)).toBe(false);
  });

  it('已消失（gone）的据点不算', () => {
    const { w, site, onWall } = scene();
    w.damageBuilding(w.buildings[site.buildings[10]], 50, 1, 1, 1, true);
    expect(foeSiteFighting(w, onWall)).toBe(true);
    site.gone = true;
    expect(foeSiteFighting(w, onWall)).toBe(false);
  });

  it('没有围墙的据点（占领圈）也按它的范围算', () => {
    const w = flatWorld();
    const site = w.addSite(SITE_CAMP, '营', C, C, 2);
    const e = w.spawnUnit(idx('yumi'), 2, C + 20, C);
    w.orderStop([e], true);
    expect(site.rect).toBeNull();
    const q = w.spawnUnit(idx('dao'), 1, C - 20, C);
    w.orderStop([q], true);
    run(w, 1);
    expect(foeSiteFighting(w, e)).toBe(true);
  });
});


describe('scan：已围满的目标加惩罚，攻击距离内的长兵器例外', () => {
  const C = (120 * TILE) / 2;
  /**
   * 己方 key 兵种在 (C, C)，敌方目标 A 在正东 dA 处（把它的围攻人数记满）、B 在正东 dB 处（没人围），都不出手；
   * 返回 scan 挑中的是 A 还是 B
   */
  const choose = (key: string, dA: number, dB: number, crowded = true): 'A' | 'B' => {
    const w = flatWorld();
    const a = w.spawnUnit(idx(key), 1, C, C);
    const A = w.spawnUnit(idx('dao'), 2, C + dA, C), B = w.spawnUnit(idx('dao'), 2, C + dB, C + 13);
    for (const u of [a, A, B]) {
      w.hp[u] = w.maxHp[u] = 1e5;
      w.cd[u] = 1e9;
    }
    w.orderStop([A, B], true);
    w.orderStop([a], true);
    // 走一帧让空间网格与视野登记好
    w.tick();
    if (crowded) w.crowd[A] = 250;
    scan(w, a, 1, w.x[a], w.y[a], 400, 300, UNIT_BY_KEY[key], NONE, 0);
    expect([A, B]).toContain(SCAN.pick);
    return SCAN.pick === A ? 'A' : 'B';
  };

  it('贴身兵种：目标围满就加惩罚，近处围满的目标让给稍远一点没人围的（哪怕已经贴着自己）', () => {
    expect(choose('dao', 100, 140)).toBe('B');
    expect(choose('dao', 14, 60)).toBe('B');
    // 对照：没围满就是挑最近的
    expect(choose('dao', 100, 140, false)).toBe('A');
    expect(choose('dao', 14, 60, false)).toBe('A');
  });

  it('长兵器（攻击距离 22）：目标已在自己的攻击距离内，围满了也不加惩罚，照挑最近的；攻击距离之外的照旧加惩罚', () => {
    for (const k of ['yari', 'ji', 'auxilia', 'spara']) {
      // 圆心距 27，身体边缘间距 15，在攻击距离以内
      expect(choose(k, 27, 60), k).toBe('A');
      // 圆心距 100，够不着，围满了就让给更远一点没人围的
      expect(choose(k, 100, 140), k).toBe('B');
      expect(choose(k, 100, 140, false), k).toBe('A');
    }
  });

  it('攻击距离的边界：边缘间距刚好 22 的在攻击距离内，多 1 像素就在外面', () => {
    const edge = UNIT_BY_KEY.yari.main.range, r = UNIT_BY_KEY.yari.radius + UNIT_BY_KEY.dao.radius;
    expect(choose('yari', r + edge - 0.5, r + edge + 40)).toBe('A');
    expect(choose('yari', r + edge + 1, r + edge + 41)).toBe('B');
  });
});

describe('crowded：目标算不算围满', () => {
  const setup = (foeKey = 'dao') => {
    const w = flatWorld();
    const j = w.spawnUnit(idx(foeKey), 2, 500, 500);
    return { w, j, slots: SIZES[UNIT_BY_KEY[foeKey].size].slots };
  };

  it('围攻人数不到目标体型的位置数就没围满，不论攻击者是谁、多远', () => {
    const { w, j, slots } = setup();
    w.crowd[j] = slots - 1;
    for (const k of ['dao', 'yari']) for (const dist of [10, 27, 200]) expect(crowded(w, UNIT_BY_KEY[k], j, dist), `${k} ${dist}`).toBe(false);
  });

  it('贴身兵种：围满了就是围满，不管多近', () => {
    const { w, j, slots } = setup();
    w.crowd[j] = slots;
    for (const dist of [10, 27, 200]) expect(crowded(w, UNIT_BY_KEY.dao, j, dist), `${dist}`).toBe(true);
  });

  it('长兵器：围满了，但目标已在攻击距离内（身体边缘间距 ≤ 22）就不算围满，在攻击距离外才算', () => {
    const { w, j, slots } = setup();
    w.crowd[j] = slots + 2;
    for (const k of ['ji', 'yari', 'auxilia', 'spara']) {
      const d = UNIT_BY_KEY[k], base = w.rad[j] + d.radius;
      expect(crowded(w, d, j, base + 15), k).toBe(false);
      expect(crowded(w, d, j, base + d.main.range), k).toBe(false);
      expect(crowded(w, d, j, base + d.main.range + 1), k).toBe(true);
      expect(crowded(w, d, j, base + 100), k).toBe(true);
    }
  });

  it('围满的人数跟目标体型走：巨型目标（战象）要 6 个，小型的 3 个', () => {
    const el = setup('elephant');
    el.w.crowd[el.j] = SIZES[UNIT_BY_KEY.elephant.size].slots - 1;
    expect(crowded(el.w, UNIT_BY_KEY.dao, el.j, 50)).toBe(false);
    el.w.crowd[el.j] += 1;
    expect(crowded(el.w, UNIT_BY_KEY.dao, el.j, 50)).toBe(true);
    expect(SIZES[UNIT_BY_KEY.elephant.size].slots).toBeGreaterThan(SIZES[UNIT_BY_KEY.dao.size].slots);
  });
});

describe('findBuilding：跳过刚因为挤不到跟前而放下的那座建筑', () => {
  const d = UNIT_BY_KEY.dao;
  /** 一座近的、一座远的敌方行营（编号都不是 0，免得和 bldSkip 的默认值 0 混在一起），一个站在近的那座旁边的己方近战 */
  const scene = () => {
    const w = flatWorld();
    w.addBuilding(BUILDINGS.house, 20, 20, 1, -1);
    const near = w.addBuilding(BUILDINGS.outpost, 60, 60, 2, -1);
    const far = w.addBuilding(BUILDINGS.outpost, 60, 66, 2, -1);
    const a = w.spawnUnit(idx('dao'), 1, near.x0 - 40, near.cy);
    return { w, a, near, far, find: () => findBuilding(w, a, w.x[a], w.y[a], 1, 300, d) };
  };

  it('对照：没有放下记录时挑近的那座', () => {
    const { near, far, find } = scene();
    expect(near.id).toBeGreaterThan(0);
    expect(find()).toBe(near.id);
    expect(far.id).not.toBe(near.id);
  });

  it('跳过倒计时大于 0：不返回记下的那座，改挑次优的', () => {
    const { w, a, near, far, find } = scene();
    w.bldSkip[a] = near.id;
    w.bldSkipT[a] = 5;
    expect(find()).toBe(far.id);
  });

  it('跳过倒计时大于 0、又没有别的可打的建筑：返回 -1', () => {
    const { w, a, near, far, find } = scene();
    w.damageBuilding(far, 1e9, 0, 1, 1);
    expect(far.alive).toBe(false);
    w.bldSkip[a] = near.id;
    w.bldSkipT[a] = 5;
    expect(find()).toBe(-1);
  });

  it('倒计时到 0 及以下：照常返回它', () => {
    const { w, a, near, find } = scene();
    w.bldSkip[a] = near.id;
    w.bldSkipT[a] = 0;
    expect(find()).toBe(near.id);
    w.bldSkipT[a] = -0.5;
    expect(find()).toBe(near.id);
  });

  it('只跳过记下的那座：记的是远的那座时，近的照挑', () => {
    const { w, a, near, far, find } = scene();
    w.bldSkip[a] = far.id;
    w.bldSkipT[a] = 5;
    expect(find()).toBe(near.id);
  });

  it('跳过记录是各单位自己的：别的单位照挑被某个单位放下的那座', () => {
    const { w, a, near } = scene();
    const b = w.spawnUnit(idx('dao'), 1, near.x0 - 40, near.cy + 10);
    w.bldSkip[a] = near.id;
    w.bldSkipT[a] = 5;
    expect(findBuilding(w, b, w.x[b], w.y[b], 1, 300, d)).toBe(near.id);
  });

  describe('接连两座都挤不进（bldSkip 记 BLD_SKIP_ALL）：这段时间里什么建筑都不挑', () => {
    it('倒计时大于 0：附近有多座可打的建筑也返回 -1', () => {
      const { w, a, find } = scene();
      w.addBuilding(BUILDINGS.outpost, 66, 60, 2, -1);
      w.bldSkip[a] = BLD_SKIP_ALL;
      w.bldSkipT[a] = 5;
      expect(find()).toBe(-1);
    });

    it('倒计时到 0 及以下：即使记的是 BLD_SKIP_ALL 也照常返回最近的', () => {
      const { w, a, near, find } = scene();
      w.bldSkip[a] = BLD_SKIP_ALL;
      w.bldSkipT[a] = 0;
      expect(find()).toBe(near.id);
      w.bldSkipT[a] = -0.5;
      expect(find()).toBe(near.id);
    });

    it('是各单位自己的记录：别的单位照挑', () => {
      const { w, a, near } = scene();
      const b = w.spawnUnit(idx('dao'), 1, near.x0 - 40, near.cy + 10);
      w.bldSkip[a] = BLD_SKIP_ALL;
      w.bldSkipT[a] = 5;
      expect(findBuilding(w, b, w.x[b], w.y[b], 1, 300, d)).toBe(near.id);
    });
  });
});

describe('scan 的 keep：只在认可的敌兵里挑，不影响警戒的 near', () => {
  const C = (120 * TILE) / 2;
  /** 己方 dao 在 (C, C)；敌方 A、B、F 分别在正东 100、200、450 处（F 在警戒距离之外），都不出手。scan 的警戒距离 400、索敌距离 300 */
  const setup = () => {
    const w = flatWorld();
    const a = w.spawnUnit(idx('dao'), 1, C, C);
    const [A, B, F] = [100, 200, 450].map((dx, k) => w.spawnUnit(idx('dao'), 2, C + dx, C + 13 * k));
    for (const u of [a, A, B, F]) {
      w.hp[u] = w.maxHp[u] = 1e5;
      w.cd[u] = 1e9;
    }
    w.orderStop([A, B, F], true);
    w.orderStop([a], true);
    // 走一帧让空间网格与视野登记好
    w.tick();
    const run1 = (keep?: (j: number) => boolean) => {
      scan(w, a, 1, w.x[a], w.y[a], 400, 300, UNIT_BY_KEY.dao, NONE, 0, keep);
      return { pick: SCAN.pick, near: SCAN.near };
    };
    return { A, B, F, run1 };
  };

  it('不传 keep：挑最近的，near 也是它', () => {
    const { A, run1 } = setup();
    expect(run1()).toEqual({ pick: A, near: A });
  });

  it('keep 认可全部：与不传时一样', () => {
    const { A, run1 } = setup();
    expect(run1(() => true)).toEqual({ pick: A, near: A });
  });

  it('keep 不认可最近的：挑通过它的、更远的那个；near 仍是最近的', () => {
    const { A, B, run1 } = setup();
    expect(run1(j => j === B)).toEqual({ pick: B, near: A });
  });

  it('keep 一个都不认可：pick 是 NONE，near 仍是警戒距离内最近的', () => {
    const { A, run1 } = setup();
    expect(run1(() => false)).toEqual({ pick: NONE, near: A });
  });

  it('keep 认可的敌兵在索敌距离之外：挑不到它，仍然 NONE', () => {
    const { A, F, run1 } = setup();
    expect(run1(j => j === F)).toEqual({ pick: NONE, near: A });
  });
});
