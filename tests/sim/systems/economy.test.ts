import { describe, expect, it } from 'vitest';
import { BUILDINGS, RULES, SITE_CAMP, SITE_CITY, SITE_FARM, SITE_INFO, SITE_OUTPOST, SITE_TOWN } from '../../../src/sim/defs';
import { canUpgradeSite, setSiteLevel, siteUpgradeCost, towerAt, upgradeSite } from '../../../src/sim/systems/economy';
import { flatWorld } from '../../helpers';

describe('据点等级表', () => {
  it('1–3 级：2 级生命 ×1.3、护甲 +2、箭矢伤害 ×1.25、射程 ×1.05；3 级 ×1.6、+3、×1.5、×1.1；升到 3 级的花费是升到 2 级的 1.5 倍', () => {
    expect(RULES.economy.siteLevels).toEqual([
      { hp: 1, armor: 0, dmg: 1, range: 1, cost: 0 },
      { hp: 1.3, armor: 2, dmg: 1.25, range: 1.05, cost: 1 },
      { hp: 1.6, armor: 3, dmg: 1.5, range: 1.1, cost: 1.5 },
    ]);
  });

  it('炮弹：单发伤害 36、爆炸半径 20', () => {
    expect(RULES.economy.shell).toEqual({ dmg: 36, splash: 20 });
  });
});

describe('建筑在某一级的火力', () => {
  const L = RULES.economy.siteLevels;

  it('1 级与不放箭的建筑原样返回', () => {
    expect(towerAt(BUILDINGS.tower, 1)).toBe(BUILDINGS.tower.tower);
    expect(towerAt(BUILDINGS.gate_h, 1)).toBeNull();
    for (const lv of [2, 3]) {
      expect(towerAt(BUILDINGS.gate_h, lv)).toBeNull();
      expect(towerAt(BUILDINGS.house, lv)).toBeNull();
      expect(towerAt(BUILDINGS.wall, lv)).toBeNull();
    }
  });

  it('2 级：伤害与射程按等级表提高，间隔、箭数不变，没有炮弹', () => {
    for (const k of ['tower', 'keep', 'keep_town', 'watchtower', 'cmdtent']) {
      const d = BUILDINGS[k], t = towerAt(d, 2)!;
      expect(t.dmg, k).toBeCloseTo(d.tower!.dmg * 1.25, 9);
      expect(t.range, k).toBeCloseTo(d.tower!.range * 1.05, 9);
      expect(t.cd, k).toBe(d.tower!.cd);
      expect(t.arrows, k).toBe(d.tower!.arrows);
      expect(t.shells ?? 0, k).toBe(0);
    }
  });

  it('3 级：伤害与射程按 3 级的表；角楼加 1 发炮弹，主堡加 2 发，箭数不变；哨塔、中军帐箭数 ×3，没有炮弹', () => {
    const at = (k: string) => towerAt(BUILDINGS[k], 3)!;
    for (const k of ['tower', 'keep', 'keep_town', 'watchtower', 'cmdtent']) {
      expect(at(k).dmg, k).toBeCloseTo(BUILDINGS[k].tower!.dmg * L[2].dmg, 9);
      expect(at(k).range, k).toBeCloseTo(BUILDINGS[k].tower!.range * L[2].range, 9);
    }
    expect([at('tower').arrows, at('tower').shells]).toEqual([2, 1]);
    expect([at('keep').arrows, at('keep').shells]).toEqual([4, 2]);
    expect([at('keep_town').arrows, at('keep_town').shells]).toEqual([4, 2]);
    expect([at('watchtower').arrows, at('watchtower').shells ?? 0]).toEqual([3, 0]);
    expect([at('cmdtent').arrows, at('cmdtent').shells ?? 0]).toEqual([6, 0]);
  });

  it('没有 3 级特殊能力的放箭建筑（资源点自建的哨塔）3 级也只是按表加伤害与射程', () => {
    const d = BUILDINGS.arrowtower, t = towerAt(d, 3)!;
    expect(t.arrows).toBe(d.tower!.arrows);
    expect(t.shells ?? 0).toBe(0);
  });
});

describe('升级花费与条件', () => {
  const site = (type: number, owner = 1) => flatWorld().addSite(type, 's', 100, 100, owner);

  it('城池类、营寨：1 级升 2 级花 upgradeCost，2 级升 3 级是它的 1.5 倍（四舍五入），3 级满了为 0', () => {
    for (const type of [SITE_CITY, SITE_TOWN, SITE_CAMP]) {
      const s = site(type), c = SITE_INFO[type].upgradeCost;
      expect(c).toBeGreaterThan(0);
      expect(siteUpgradeCost(s), SITE_INFO[type].label).toBe(c);
      s.level = 2;
      expect(siteUpgradeCost(s), SITE_INFO[type].label).toBe(Math.round(c * 1.5));
      s.level = 3;
      expect(siteUpgradeCost(s), SITE_INFO[type].label).toBe(0);
    }
  });

  it('无主、已毁的据点与资源点、临时据点都升不了级，花费为 0', () => {
    expect(siteUpgradeCost(site(SITE_CITY, 0))).toBe(0);
    const gone = site(SITE_CAMP);
    gone.gone = true;
    expect(siteUpgradeCost(gone)).toBe(0);
    expect(siteUpgradeCost(site(SITE_FARM))).toBe(0);
    expect(siteUpgradeCost(site(SITE_OUTPOST))).toBe(0);
  });

  it('canUpgradeSite 等价于「还有下一级要花钱」', () => {
    const s = site(SITE_CITY);
    expect(canUpgradeSite(s)).toBe(true);
    s.level = 3;
    expect(canUpgradeSite(s)).toBe(false);
    expect(canUpgradeSite(site(SITE_FARM))).toBe(false);
    expect(canUpgradeSite(site(SITE_CITY, 0))).toBe(false);
  });

  it('升级扣的是据点所属一方的石料（城池）或木材（营寨），钱不够不扣也不升；够了升一级', () => {
    const w = flatWorld();
    const city = w.addSite(SITE_CITY, 'c', 100, 100, 1), camp = w.addSite(SITE_CAMP, 'k', 500, 100, 2);
    w.stock.stone[1] = SITE_INFO[SITE_CITY].upgradeCost - 1;
    expect(upgradeSite(w, city)).toBe(false);
    expect(city.level).toBe(1);
    expect(w.stock.stone[1]).toBe(SITE_INFO[SITE_CITY].upgradeCost - 1);
    w.stock.stone[1] += 1;
    // 对方的石料与木材不能替它付
    w.stock.stone[2] = 1e6;
    expect(upgradeSite(w, city)).toBe(true);
    expect([city.level, w.stock.stone[1], w.stock.stone[2]]).toEqual([2, 0, 1e6]);
    w.stock.wood[1] = 1e6;
    w.stock.wood[2] = SITE_INFO[SITE_CAMP].upgradeCost;
    expect(upgradeSite(w, camp)).toBe(true);
    expect([camp.level, w.stock.wood[2], w.stock.wood[1]]).toEqual([2, 0, 1e6]);
  });

  it('设定等级：升级时补上新增的生命、降级时生命不超过新上限；后搭的建筑不随等级变', () => {
    const w = flatWorld();
    const s = w.addSite(SITE_CAMP, 'k', 300, 300, 1);
    const b = w.addBuilding(BUILDINGS.watchtower, 10, 10, 1, s.id);
    s.buildings.push(b.id);
    const extra = w.addBuilding(BUILDINGS.arrowtower, 14, 10, 1, s.id);
    extra.extra = true;
    s.buildings.push(extra.id);
    setSiteLevel(w, s, 3);
    expect(b.maxHp).toBe(Math.round(BUILDINGS.watchtower.hp * 1.6));
    expect(b.hp).toBe(b.maxHp);
    expect([b.lv, b.armor]).toEqual([3, 3]);
    expect([extra.lv, extra.maxHp, extra.armor, extra.tower]).toEqual([1, BUILDINGS.arrowtower.hp, 0, BUILDINGS.arrowtower.tower]);
    setSiteLevel(w, s, 1);
    expect(b.maxHp).toBe(BUILDINGS.watchtower.hp);
    expect(b.hp).toBe(BUILDINGS.watchtower.hp);
    expect([b.lv, b.armor, b.tower]).toEqual([1, 0, BUILDINGS.watchtower.tower]);
  });
});
