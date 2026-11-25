import { describe, expect, it } from 'vitest';
import { A_PIERCE, A_SIEGE, BUILDINGS, P_ARROW, P_BALL, RULES, shellWeapon } from '../../../src/sim/defs';

describe('炮弹武器 shellWeapon', () => {
  it('攻城伤害、带范围杀伤、不扇形（全打最近的敌人），数值取 RULES.economy.shell，发数由参数给出', () => {
    const sh = RULES.economy.shell;
    for (const n of [1, 2, 5]) {
      expect(shellWeapon(n)).toEqual({ atk: A_SIEGE, dmg: sh.dmg, proj: P_BALL, pen: 0, splash: sh.splash, burst: n, fan: false });
    }
  });
});

describe('建筑火力：主堡与中军帐由角楼与哨塔推导', () => {
  const arrows = (k: string) => BUILDINGS[k].tower!.weapons;

  it('角楼与哨塔是单把穿刺箭武器：箭是 fan 武器，角楼每轮 2 支、哨塔 1 支', () => {
    for (const [k, burst] of [['tower', 2], ['watchtower', 1]] as const) {
      expect(arrows(k), k).toHaveLength(1);
      expect(arrows(k)[0], k).toMatchObject({ atk: A_PIERCE, proj: P_ARROW, pen: 0, splash: 0, fan: true, burst });
    }
  });

  it('主堡的火力 = 角楼的火力、每轮箭数 ×2：射程、单支伤害、间隔与角楼相同', () => {
    const t = BUILDINGS.tower.tower!;
    for (const k of ['keep', 'keep_town']) {
      const f = BUILDINGS[k].tower!;
      expect([f.range, f.cd], k).toEqual([t.range, t.cd]);
      expect(f.weapons, k).toEqual(t.weapons.map(wp => ({ ...wp, burst: wp.burst * 2 })));
      expect(f.weapons[0].burst, k).toBe(4);
    }
  });

  it('中军帐的火力 = 哨塔的火力、每轮箭数 ×2：射程、单支伤害、间隔与哨塔相同', () => {
    const t = BUILDINGS.watchtower.tower!, f = BUILDINGS.cmdtent.tower!;
    expect([f.range, f.cd]).toEqual([t.range, t.cd]);
    expect(f.weapons).toEqual(t.weapons.map(wp => ({ ...wp, burst: wp.burst * 2 })));
    expect(f.weapons[0].burst).toBe(2);
  });

  it('推导不改被推导的那座：角楼仍是每轮 2 支、哨塔仍是 1 支，与主堡、中军帐不共用武器对象', () => {
    expect(arrows('tower')[0].burst).toBe(2);
    expect(arrows('watchtower')[0].burst).toBe(1);
    expect(arrows('keep')[0]).not.toBe(arrows('tower')[0]);
    expect(arrows('cmdtent')[0]).not.toBe(arrows('watchtower')[0]);
  });
});
