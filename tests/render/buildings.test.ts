import { describe, expect, it } from 'vitest';
import { BUILDINGS, BR_MILITARY } from '../../src/sim/defs';
import { buildingGeo, flagHeight, lookLevel, wallGeo } from '../../src/render/buildings';

const verts = (g: { getAttribute(n: string): { count: number } }): number => g.getAttribute('position').count;
const KEYS = Object.keys(BUILDINGS).filter(k => k !== 'wall' && k !== 'palisade');
const ARMED = ['tower', 'keep', 'keep_town', 'watchtower', 'cmdtent'];

describe('建筑外观档位', () => {
  it('房屋类（民居、营帐）升级没有变化，永远是 1 档', () => {
    for (const k of ['house', 'tent']) for (const lv of [1, 2, 3]) expect(lookLevel(k, lv), `${k} ${lv}`).toBe(1);
  });

  it('炮楼、主堡、哨塔、中军帐有三档（3 级换上火炮或连弩）', () => {
    for (const k of ARMED) {
      expect([1, 2, 3].map(lv => lookLevel(k, lv)), k).toEqual([1, 2, 3]);
    }
  });

  it('其余建筑（门楼、兵营、资源点建筑等）2 级起加固、3 级与 2 级同一档', () => {
    for (const k of ['gate_h', 'gate_v', 'wgate_h', 'wgate_v', 'barracks']) {
      expect([1, 2, 3].map(lv => lookLevel(k, lv)), k).toEqual([1, 2, 2]);
    }
  });

  it('会放箭、3 级有特殊能力的军事建筑正是三档的那几种', () => {
    for (const k of KEYS) {
      const b = BUILDINGS[k];
      if (b.tier3) expect(lookLevel(k, 3), k).toBe(3);
      else if (b.role !== BR_MILITARY) expect(lookLevel(k, 3), k).toBeLessThan(3);
    }
  });
});

describe('旗杆高度', () => {
  it('不挂旗的建筑为 0：城墙、民居、未知的建筑', () => {
    for (const k of ['wall', 'palisade', 'house', 'tent', 'no_such_building']) expect(flagHeight(k, ''), k).toBe(0);
  });

  it('主堡、角楼、门楼、哨塔、中军帐、各资源点主建筑都挂旗', () => {
    for (const k of ['keep', 'keep_town', 'tower', 'gate_h', 'gate_v', 'watchtower', 'cmdtent', 'farmstead', 'lumbercamp', 'quarry', 'goldmine', 'arrowtower', 'outpost']) {
      expect(flagHeight(k, 'china'), k).toBeGreaterThan(0);
    }
  });

  it('主堡的旗杆高度随文明的样式变；没有专属样式的取同一个缺省高度', () => {
    const hs = ['japan', 'china', 'rome', 'persia'].map(s => flagHeight('keep', s));
    for (const h of hs) expect(h).toBeGreaterThan(0);
    expect(new Set(hs).size).toBeGreaterThan(1);
    expect(flagHeight('keep', 'unknown_style')).toBe(flagHeight('keep', 'persia'));
  });

  it('角楼与门楼 2 级起加高，3 级与 2 级一样；其余建筑不随等级变', () => {
    for (const k of ['tower', 'gate_h', 'gate_v']) {
      expect(flagHeight(k, '', 2), k).toBeGreaterThan(flagHeight(k, '', 1));
      expect(flagHeight(k, '', 3), k).toBe(flagHeight(k, '', 2));
    }
    for (const k of ['keep', 'watchtower', 'cmdtent']) expect(flagHeight(k, 'china', 3), k).toBe(flagHeight(k, 'china', 1));
  });

  it('等级缺省按 1 级', () => {
    expect(flagHeight('tower', '')).toBe(flagHeight('tower', '', 1));
  });
});

describe('建筑模型随等级', () => {
  it('每种建筑 1–3 级都能生成非空的几何体', () => {
    for (const k of KEYS) for (const lv of [1, 2, 3]) expect(verts(buildingGeo(k, 'china', 0, lv)), `${k} ${lv}`).toBeGreaterThan(0);
  });

  it('同一档共用一份模型：档位相同的等级，顶点数一样', () => {
    for (const k of KEYS) {
      for (const [a, b] of [[1, 2], [2, 3]]) {
        if (lookLevel(k, a) === lookLevel(k, b)) {
          expect(verts(buildingGeo(k, 'china', 0, b)), `${k} ${a}→${b}`).toBe(verts(buildingGeo(k, 'china', 0, a)));
        }
      }
    }
  });

  it('2 级起加固：能升级的据点里档位升高的建筑，比 1 级多出零件（资源点不能升级，不在此列）', () => {
    const RESOURCE = ['farmstead', 'lumbercamp', 'quarry', 'goldmine', 'arrowtower', 'outpost'];
    for (const k of KEYS.filter(k => !RESOURCE.includes(k))) {
      if (lookLevel(k, 2) > 1) expect(verts(buildingGeo(k, 'china', 0, 2)), k).toBeGreaterThan(verts(buildingGeo(k, 'china', 0, 1)));
    }
  });

  it('石墙与木栅 2 级起加固：有连接时零件更多；没有连接的石墙（没有朝外的边）等级不影响', () => {
    expect(verts(wallGeo(5, true, 0, 2))).toBeGreaterThan(verts(wallGeo(5, true, 0, 1)));
    expect(verts(wallGeo(0, true, 0, 2))).toBeGreaterThan(verts(wallGeo(0, true, 0, 1)));
    expect(verts(wallGeo(5, false, 1, 2))).toBeGreaterThan(verts(wallGeo(5, false, 1, 1)));
    expect(verts(wallGeo(5, false, 0, 2))).toBe(verts(wallGeo(5, false, 0, 1)));
  });
});
