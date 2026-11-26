import { describe, expect, it } from 'vitest';
import { BUILDINGS, TILE, T_MOUNTAIN, UNIT_BY_KEY } from '../../../src/sim/defs';
import { O_AMOVE } from '../../../src/sim/state';
import type { World } from '../../../src/sim/world';
import { flatWorld } from '../../helpers';

const idx = (k: string): number => UNIT_BY_KEY[k].idx;
const mid = (t: number): number => (t + 0.5) * TILE;

describe('新指令清掉追击的状态（含远程主动挑的墙顶敌兵）', () => {
  /** 一个攻击移动的近战，留着上一个追击目标的判断记录与「刚判出绕不过去」的重试间隔；另有一个敌兵和一座敌方行营可供下指令 */
  const scene = () => {
    const w = flatWorld();
    const me = w.spawnUnit(idx('dao'), 1, mid(60), mid(60));
    w.hp[me] = w.maxHp[me] = 1e9;
    const far = w.addBuilding(BUILDINGS.outpost, 70, 70, 2, -1);
    const foe = w.spawnUnit(idx('legion'), 2, mid(80), mid(40));
    w.hp[foe] = w.maxHp[foe] = 1e9;
    w.orderStop([foe], true);
    w.orderMove([me], mid(60), mid(30), true);
    // 追击的判断记录（模拟上一个追击目标）
    w.wayUid[me] = 777;
    w.wayNoT[me] = 1.5;
    // 远程主动挑的墙顶敌兵的记录
    w.wallUid[me] = 888;
    return { w, me, far, foe };
  };
  const clean = (w: World, me: number): void => {
    expect(w.wayUid[me]).toBe(0);
    expect(w.wayNoT[me]).toBe(0);
    expect(w.wallUid[me]).toBe(0);
  };

  it('移动命令', () => {
    const { w, me } = scene();
    w.orderMove([me], mid(50), mid(50), false);
    clean(w, me);
  });

  it('攻击移动命令', () => {
    const { w, me } = scene();
    w.orderMove([me], mid(50), mid(50), true);
    clean(w, me);
  });

  it('停止与坚守', () => {
    const a = scene();
    a.w.orderStop([a.me], false);
    clean(a.w, a.me);
    const b = scene();
    b.w.orderStop([b.me], true);
    clean(b.w, b.me);
  });

  it('攻击某个敌兵', () => {
    const { w, me, foe } = scene();
    w.orderAttackUnit([me], foe);
    clean(w, me);
  });

  it('攻击某座建筑', () => {
    const { w, me, far } = scene();
    w.orderAttackBuilding([me], far);
    clean(w, me);
    expect(w.target[me]).toBe(-far.id - 2);
  });
});

describe('新指令作废「挤不到跟前而放下的建筑」记录', () => {
  /** 一个刚放下一座建筑、跳过倒计时还在走的近战；另有一个敌兵和一座敌方行营可供下指令 */
  const scene = () => {
    const w = flatWorld();
    const me = w.spawnUnit(idx('dao'), 1, mid(60), mid(60));
    w.hp[me] = w.maxHp[me] = 1e9;
    const far = w.addBuilding(BUILDINGS.outpost, 70, 70, 2, -1);
    const foe = w.spawnUnit(idx('legion'), 2, mid(80), mid(40));
    w.hp[foe] = w.maxHp[foe] = 1e9;
    w.orderStop([foe], true);
    w.bldSkip[me] = far.id;
    w.bldSkipT[me] = 6;
    return { w, me, far, foe };
  };

  it('场景前提：下指令之前倒计时是正的', () => {
    const { w, me } = scene();
    expect(w.bldSkipT[me]).toBeGreaterThan(0);
  });

  it('移动命令', () => {
    const { w, me } = scene();
    w.orderMove([me], mid(50), mid(50), false);
    expect(w.bldSkipT[me]).toBe(0);
  });

  it('攻击移动命令', () => {
    const { w, me } = scene();
    w.orderMove([me], mid(50), mid(50), true);
    expect(w.bldSkipT[me]).toBe(0);
  });

  it('停止与坚守', () => {
    const a = scene();
    a.w.orderStop([a.me], false);
    expect(a.w.bldSkipT[a.me]).toBe(0);
    const b = scene();
    b.w.orderStop([b.me], true);
    expect(b.w.bldSkipT[b.me]).toBe(0);
  });

  it('攻击某个敌兵', () => {
    const { w, me, foe } = scene();
    w.orderAttackUnit([me], foe);
    expect(w.bldSkipT[me]).toBe(0);
  });

  it('攻击某座建筑（包括刚放下的那一座）：记录作废，指定的建筑照打', () => {
    const { w, me, far } = scene();
    w.orderAttackBuilding([me], far);
    expect(w.bldSkipT[me]).toBe(0);
    expect(w.target[me]).toBe(-far.id - 2);
  });
});

describe('移动命令给编队成员记下所在的排与排内序号', () => {
  /** 一队混编（铁骑、刀盾、弩兵）围着 (60, 60) 格摆好，朝东，下令往东走 40 格 */
  const scene = () => {
    const w = flatWorld();
    const keys = [...Array(20).fill('tieqi'), ...Array(50).fill('dao'), ...Array(30).fill('nu')];
    const g = w.spawnGroup(1, keys.map(idx), mid(40), mid(60), 1, 0);
    w.orderMove(g, mid(80), mid(60), false);
    return { w, g };
  };

  it('走编队的成员：排号从最前排（队列偏移最大、即 0）往后依次增加，同一排的人队列偏移相同、不同排不同', () => {
    const { w, g } = scene();
    const gi = w.grp[g[0]];
    expect(gi).toBeGreaterThanOrEqual(0);
    expect(g.every(s => w.grp[s] === gi)).toBe(true);
    const byRow = new Map<number, Set<number>>();
    for (const s of g) {
      const r = w.marchRow[s];
      if (!byRow.has(r)) byRow.set(r, new Set());
      byRow.get(r)!.add(w.offA[s]);
    }
    const rows = [...byRow.keys()].sort((a, b) => a - b);
    // 排号连续、从 0 起；队伍的排数就是这些
    expect(rows).toEqual(rows.map((_, k) => k));
    expect(w.marches[gi].rows).toBe(rows.length);
    // 同一排只有一个队列偏移，往后的排偏移严格更小；最前排的偏移为 0
    for (const r of rows) expect(byRow.get(r)!.size).toBe(1);
    const offs = rows.map(r => [...byRow.get(r)!][0]);
    expect(offs[0]).toBe(0);
    for (let k = 1; k < offs.length; k++) expect(offs[k]).toBeLessThan(offs[k - 1]);
  });

  it('排内序号：同一排里从 0 起连续编号，横向偏移越小（越靠左）序号越小，不同的人序号不同', () => {
    const { w, g } = scene();
    const rows = new Set(g.map(s => w.marchRow[s]));
    for (const r of rows) {
      const mem = g.filter(s => w.marchRow[s] === r).sort((a, b) => w.marchCol[a] - w.marchCol[b]);
      mem.forEach((s, k) => expect(w.marchCol[s]).toBe(k));
      for (let k = 1; k < mem.length; k++) expect(w.offL[mem[k]]).toBeGreaterThan(w.offL[mem[k - 1]]);
    }
  });

  it('同一支队伍里，近战排在前、弩兵排在后：弩兵的排号都大于铁骑的', () => {
    const { w, g } = scene();
    const rowsOf = (key: string): number[] => g.filter(s => w.defs[w.type[s]].key === key).map(s => w.marchRow[s]);
    expect(Math.min(...rowsOf('nu'))).toBeGreaterThan(Math.max(...rowsOf('tieqi')));
  });
});

describe('行军途中又收到移动命令：什么时候沿用编队、什么时候重新整队', () => {
  const tick = (w: World, n: number): void => {
    for (let t = 0; t < n; t++) {
      w.tick();
      w.fxN = 0;
    }
  };
  /** 80 个刀盾从 (30, 70) 格朝东走了 8 秒（开阔地，路线朝 (120, 70) 格） */
  const underway = () => {
    const w = flatWorld(140, 7);
    const g = w.spawnGroup(1, Array(80).fill(idx('dao')), 30 * TILE, 70 * TILE, 1, 0);
    w.orderMove(g, 120 * TILE, 70 * TILE, false);
    const m = w.marches[w.grp[g[0]]];
    tick(w, 30 * 8);
    expect(m.arrived).toBe(false);
    return { w, g, m };
  };
  const layout = (w: World, g: number[]): number[][] => g.map(s => [w.grp[s], w.marchRow[s], w.marchCol[s], w.offA[s], w.offL[s]]);

  it('去同一处的重复命令：照旧沿用编队，不改成员的队列偏移与落点，只换攻击移动标志', () => {
    const { w, g, m } = underway();
    const before = layout(w, g), dest = g.map(s => [w.destX[s], w.destY[s]]), id = m.id;
    w.orderMove(g, 120 * TILE + 10, 70 * TILE - 10, true);
    expect(w.grp[g[0]]).toBe(id);
    expect(layout(w, g)).toEqual(before);
    expect(g.map(s => [w.destX[s], w.destY[s]])).toEqual(dest);
    expect(m.amove).toBe(true);
    expect(g.every(s => w.order[s] === O_AMOVE)).toBe(true);
  });

  describe('夹角：新路线的起始方向与最前排朝向的夹角不超过阈值（rerouteCos，现为 90°）才沿用，掉头的重新整队', () => {
    for (const [deg, keep] of [[30, true], [80, true], [100, false], [150, false], [180, false]] as const) {
      it(`${deg}°：${keep ? '沿用编队' : '重新整队（新编队，队列重排，最前排站着等位置）'}`, () => {
        const { w, g, m } = underway();
        const id = m.id, a = deg * Math.PI / 180;
        // 最前排朝东（探路点在笔直路线上），新目的地在最前排前方 40 格、偏 deg 度的地方
        const ty = m.y + Math.sin(a) * 40 * TILE;
        w.orderMove(g, m.x + Math.cos(a) * 40 * TILE, ty, false);
        const now = w.grp[g[0]];
        if (keep) {
          expect(now).toBe(id);
          expect(m.v).toBeGreaterThan(0);
        } else {
          expect(now).not.toBe(id);
          const nm = w.marches[now];
          expect(nm.v).toBe(0);
          expect(nm.destY).toBeCloseTo(ty, 0);
          // 重新整队：最前排的人队列偏移为 0
          expect(Math.max(...g.map(s => w.offA[s]))).toBe(0);
        }
      });
    }
  });

  describe('不满足条件的照原来的做法：重新整队（新编队，最前排站着等位置，落点按新队列重排）', () => {
    const cases: [string, (s: ReturnType<typeof underway>) => void][] = [
      ['命令里的人比编队少了几个', ({ w, g }) => w.orderMove(g.slice(0, 70), 90 * TILE, 100 * TILE, false)],
      ['命令里的人比编队多了一个', ({ w, g }) => {
        const extra = w.spawnUnit(idx('dao'), 1, 40 * TILE, 70 * TILE);
        w.orderMove([...g, extra], 90 * TILE, 100 * TILE, false);
      }],
      ['队伍散开（在打仗）', ({ w, g, m }) => {
        m.loose = true;
        w.orderMove(g, 90 * TILE, 100 * TILE, false);
      }],
      ['队首被建筑挡住', ({ w, g, m }) => {
        m.blocked = true;
        w.orderMove(g, 90 * TILE, 100 * TILE, false);
      }],
    ];
    for (const [label, act] of cases) {
      it(label, () => {
        const s = underway();
        const id = s.m.id;
        act(s);
        const now = s.w.grp[s.g[0]];
        expect(now).not.toBe(id);
        const nm = s.w.marches[now];
        expect(nm.v).toBe(0);
        expect(nm.destX).toBeCloseTo(90 * TILE, 0);
        expect(Math.max(...s.g.slice(0, 70).map(u => s.w.offA[u]))).toBe(0);
      });
    }

    it('到达后的收尾中：不沿用，重新整队', () => {
      const w = flatWorld(140, 7, (t, n) => {
        for (let x = 50; x <= 80; x++) for (let y = 35; y < 85; y++) if (y < 58 || y > 61) t[y * n + x] = T_MOUNTAIN;
      });
      const g = w.spawnGroup(1, Array(200).fill(idx('dao')), 25 * TILE, 60 * TILE, 1, 0);
      w.orderMove(g, 85 * TILE, 60 * TILE, false);
      const m = w.marches[w.grp[g[0]]];
      for (let t = 0; t < 30 * 100 && !m.tail; t++) tick(w, 1);
      tick(w, 3);
      expect(m.tail).toBe(true);
      // 收尾中有一部分成员已离队：命令只给还在编队里的人
      const inGrp = g.filter(s => w.grp[s] === m.id);
      expect(inGrp.length).toBeGreaterThan(1);
      w.orderMove(inGrp, 100 * TILE, 85 * TILE, false);
      const now = w.grp[inGrp[0]];
      expect(now).not.toBe(m.id);
      expect(w.marches[now].v).toBe(0);
      expect(w.marches[now].destX).toBeCloseTo(100 * TILE, 0);
    });
  });
});
