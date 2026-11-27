import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AU_RANGED_TAKEN, ELITE, EXPAND_RULES, SIZES, SITE_CAMP, SITE_CITY, UNITS, UNIT_BY_KEY, expandUnit, isContentUnit, unitKind } from '../../src/sim/defs';
import { unitUpgradeCost } from '../../src/sim/systems/economy';
import { createGame } from '../../src/sim/setup';
import { Hud, tier3Perks } from '../../src/ui/hud';
import type { HudCallbacks } from '../../src/ui/hud';
import { FakeEl, firePointer, installFakeDom, rectOf } from './fakeDom';
import { auraEffect, auraPct, unitTip } from '../../src/ui/unitText';

// 头像要 WebGL，测试里用不上
vi.mock('../../src/render/portrait', () => ({ unitPortrait: () => ({ toDataURL: () => '' }) }));

describe('兵种提示', () => {
  it('第一行是名称与类别，第二行是说明，随后是生命、攻击、攻速与射程护甲', () => {
    for (const d of UNITS.filter(d => d.tier === 0 && isContentUnit(d))) {
      const lines = unitTip(d).split('\n');
      expect(lines[0], d.key).toBe(`${d.name}（${unitKind(d)}）`);
      expect(lines[1], d.key).toBe(d.desc);
      expect(lines[2], d.key).toContain(`生命 ${d.hp}`);
      expect(lines[2], d.key).toMatch(/攻击 \d+(\.\d)?[　（]/);
      expect(lines[2], d.key).toMatch(/攻速 \d+(\.\d)?s$/);
      expect(lines[3], d.key).toContain(`护甲 ${d.armM}/${d.armP}`);
      expect(lines[4], d.key).toContain(`体型 ${SIZES[d.size].name}`);
    }
  });

  it('攻击与攻速保留一位小数（四舍五入），整数不带小数点：长戟兵「攻击 7.8　攻速 1.3s」', () => {
    const stat = (k: string): string => unitTip(UNIT_BY_KEY[k]).split('\n')[2].replace('（范围）', '');
    // 无限小数
    expect(stat('ji')).toBe('生命 ' + UNIT_BY_KEY.ji.hp + '　攻击 7.8　攻速 1.3s');
    expect(stat('nu')).toContain('攻击 20.8　攻速 2.8s');
    expect(stat('cataphract')).toContain('攻速 1.3s');
    expect(stat('ozutsu')).toContain('攻击 61.5　攻速 7.8s');
    expect(stat('onager')).toContain('攻击 53.5　攻速 7.9s');
    // 本来就是整数或一位小数
    expect(stat('yari')).toBe('生命 ' + UNIT_BY_KEY.yari.hp + '　攻击 9　攻速 1.2s');
    expect(stat('scorpio')).toContain('攻击 90　攻速 4.5s');
    expect(stat('elephant')).toContain('攻击 28　攻速 2s');
    expect(stat('yumi')).toContain('攻击 9　攻速 1.9s');
  });

  it('高级形态的攻击与攻速同样保留一位小数', () => {
    const stat = (k: string): string => unitTip(UNITS[UNIT_BY_KEY[k].elite]).split('\n')[2].replace('（范围）', '');
    expect(stat('ji')).toContain('攻击 9.8　攻速 1.3s');
    expect(stat('dao')).toContain('攻击 11.3　攻速 1.1s');
    expect(stat('yari')).toContain('攻击 11.3　攻速 1.2s');
    expect(stat('scorpio')).toContain('攻击 112.5　攻速 4.5s');
    expect(stat('elephant')).toContain('攻击 35　攻速 2s');
  });

  it('所有兵种（初级与高级）的攻击、攻速都不超过一位小数，且与数值的四舍五入一致，带范围杀伤的在攻击后标「（范围）」', () => {
    const fmt = (v: number): string => v.toFixed(1).replace(/\.0$/, '');
    for (const d of UNITS.filter(isContentUnit)) {
      const line = unitTip(d).split('\n')[2];
      expect(line, d.key).toBe(`生命 ${d.hp}　攻击 ${fmt(d.main.lvDmg[0])}${d.main.splash ? '（范围）' : ''}　攻速 ${fmt(d.main.lvCd[0])}s`);
      expect(line, d.key).not.toMatch(/\d\.\d{2,}/);
    }
  });

  it('冲锋的冲撞伤害保留一位小数（四舍五入）：罗马骑兵 125、铁甲骑兵 157.5，本来是整数的骑兵不变', () => {
    const charge = (d: typeof UNITS[number]): string => unitTip(d).split('\n').find(l => l.startsWith('冲锋：'))!;
    for (const k of ['equites', 'cataphract', 'tieqi', 'kiba']) {
      const d = UNIT_BY_KEY[k];
      for (const f of [d, UNITS[d.elite]]) {
        const want = { equites: '125', cataphract: '157.5', tieqi: '135', kiba: '135' }[k]!;
        expect(charge(f), f.key).toBe(`冲锋：远距离接敌时突进，冲撞伤害 ${want}`);
      }
    }
  });

  it('所有带冲锋的兵种（初级与高级），冲撞伤害都不超过一位小数且与数值的四舍五入一致', () => {
    const fmt = (v: number): string => v.toFixed(1).replace(/\.0$/, '');
    for (const d of UNITS.filter(d => isContentUnit(d) && d.abilities.charge)) {
      const line = unitTip(d).split('\n').find(l => l.startsWith('冲锋：'))!;
      expect(line, d.key).toBe(`冲锋：远距离接敌时突进，冲撞伤害 ${fmt(d.abilities.charge!.impact)}`);
      expect(line, d.key).not.toMatch(/\d\.\d{2,}/);
    }
  });

  it('近战写「近战」，远程写射程数值', () => {
    const melee = UNIT_BY_KEY.dao, ranged = UNIT_BY_KEY.nu;
    expect(unitTip(melee)).toContain('射程 近战');
    expect(unitTip(ranged)).toContain(`射程 ${ranged.main.range}`);
  });

  it('近战武器的攻击距离比贴身长的，射程一栏写「近战 距离」：长戟兵写「近战 22」，贴身的写「近战」', () => {
    for (const k of ['ji', 'yari', 'auxilia', 'spara']) expect(unitTip(UNIT_BY_KEY[k]), k).toContain('射程 近战 22');
    for (const d of UNITS.filter(d => d.tier === 0 && isContentUnit(d) && d.melee)) {
      const line = unitTip(d).split('\n')[3];
      if (d.main.range > 7) expect(line, d.key).toContain(`射程 近战 ${d.main.range}`);
      else expect(line.startsWith('射程 近战　'), d.key).toBe(true);
    }
    expect(unitTip(UNIT_BY_KEY.dao).split('\n')[3]).toContain('射程 近战　护甲');
    // 高级形态的攻击距离与初级一样
    expect(unitTip(UNITS[UNIT_BY_KEY.ji.elite])).toContain('射程 近战 22');
  });

  it('范围杀伤的兵种在攻击后标注「范围」', () => {
    for (const d of UNITS.filter(d => d.tier === 0 && isContentUnit(d))) {
      expect(unitTip(d).split('\n')[2].includes('（范围）'), d.key).toBe(d.main.splash > 0);
    }
  });

  it('特殊动作：冲锋、拒马、举盾、夜战各按兵种带的能力列出', () => {
    for (const d of UNITS.filter(d => d.tier === 0 && isContentUnit(d))) {
      const tip = unitTip(d), ab = d.abilities;
      expect(tip.includes('冲锋：'), d.key).toBe(!!ab.charge);
      expect(tip.includes('拒马：'), d.key).toBe(!!ab.brace);
      expect(tip.includes('举盾：'), d.key).toBe(!!ab.shield);
      expect(tip.includes('夜间可打火把'), d.key).toBe(!!ab.torch);
      if (ab.shield) expect(tip).toContain(`−${Math.round(ab.shield.block * 100)}%`);
    }
  });

  it('工程类写「工程类」，其余写烧不动城墙', () => {
    for (const d of UNITS.filter(d => d.tier === 0 && isContentUnit(d))) {
      expect(unitTip(d).includes('工程类：'), d.key).toBe(!!d.siege);
      expect(unitTip(d).includes('烧不动城墙'), d.key).toBe(!d.siege);
      expect(unitTip(d), d.key).not.toContain('箭楼');
    }
  });

  it('初级形态写升级花费与高级形态名；高级形态写「高级形态」且没有升级一行', () => {
    const d = UNIT_BY_KEY.dao, e = UNITS[d.elite];
    const tip = unitTip(d);
    expect(tip).toContain(`可花 ${unitUpgradeCost(d)} 黄金升为「${e.name}」`);
    expect(tip).toContain(`生命 ×${ELITE.hp}`);
    expect(tip).toContain(`攻击 ×${ELITE.dmg}`);
    expect(tip).toContain(`护甲 +${ELITE.armor}`);
    const etip = unitTip(e);
    expect(etip.split('\n').at(-1)).toBe('高级形态');
    expect(etip).not.toContain('可花');
  });

  it('对建筑倍率不低于 2 才写出来', () => {
    for (const d of UNITS.filter(d => d.tier === 0 && isContentUnit(d))) {
      expect(unitTip(d).includes(`对建筑 ×${d.vsBld}`), d.key).toBe(d.vsBld >= 2);
    }
  });
});

describe('据点满级解锁：tier3Perks', () => {
  const w = createGame({
    seed: 5, factions: ['china', 'japan'], armySize: 60, difficulty: 1, fog: false, spectate: false, environment: false, supply: false,
  }).world;

  it('按据点里建筑的 tier3 推出：城池解锁炮弹，营寨解锁连弩，每种建筑一项', () => {
    const city = w.sites.find(s => s.type === SITE_CITY)!, camp = w.sites.find(s => s.type === SITE_CAMP)!;
    const uc = tier3Perks(w, city).flatMap(p => p.unlocks), uk = tier3Perks(w, camp).flatMap(p => p.unlocks);
    expect(uc).toContain('炮弹');
    expect(uk).toContain('连弩');
    for (const s of [city, camp]) {
      const keys = tier3Perks(w, s).map(p => p.def.key);
      expect(new Set(keys).size).toBe(keys.length);
      for (const p of tier3Perks(w, s)) expect(p.def.tier3).toBeTruthy();
    }
  });
});

describe('光环的显示', () => {
  const coverUnit = expandUnit({ faction: 'china', key: 't_cover_tip', name: '盾卫', arch: 'inf', spec: { traits: ['cover'] }, desc: '持盾掩护' }, EXPAND_RULES, false)[0];

  it('auraEffect：所受远程伤害倍率 0.8 写成「所受远程伤害 −20%」，0.6 是 −40%', () => {
    const a = { name: '盾墙掩护', kind: AU_RANGED_TAKEN, radius: 60 };
    expect(auraEffect({ ...a, value: 0.8 })).toBe('所受远程伤害 −20%');
    expect(auraEffect({ ...a, value: 0.6 })).toBe('所受远程伤害 −40%');
  });

  it('auraPct：相对无加成值的增减，比无加成小为「−」、大为「+」', () => {
    const a = { name: 'x', kind: AU_RANGED_TAKEN, radius: 60 };
    expect(auraPct({ ...a, value: 0.8 })).toBe('−20%');
    expect(auraPct({ ...a, value: 0.6 })).toBe('−40%');
    expect(auraPct({ ...a, value: 1.2 })).toBe('+20%');
    expect(auraPct({ ...a, value: 0.3 })).toBe('−70%');
  });

  it('auraPct：取整为 0 的保留一位小数，正负号按数值本身判断，不显示成「+0%」', () => {
    const a = { name: 'x', kind: AU_RANGED_TAKEN, radius: 60 };
    expect(auraPct({ ...a, value: 0.996 })).toBe('−0.4%');
    expect(auraPct({ ...a, value: 0.999 })).toBe('−0.1%');
    expect(auraPct({ ...a, value: 1.004 })).toBe('+0.4%');
    expect(auraPct({ ...a, value: 0.996 })).not.toContain('+');
  });

  it('auraEffect 是「种类名 + 空格 + auraPct」', () => {
    const a = { name: 'x', kind: AU_RANGED_TAKEN, radius: 60 };
    for (const value of [0.8, 0.996, 0.5]) expect(auraEffect({ ...a, value })).toBe(`所受远程伤害 ${auraPct({ ...a, value })}`);
  });

  it('兵种提示列出光环：特性名、半径与加成', () => {
    const tip = unitTip(coverUnit);
    expect(tip).toContain('光环「盾墙掩护」：半径 60 内的其他友军所受远程伤害 −20%');
  });

  it('没有光环的兵种不显示光环这一行', () => {
    for (const d of UNITS.filter(d => d.tier === 0 && isContentUnit(d) && !d.auras.length)) expect(unitTip(d), d.key).not.toContain('光环');
  });

  it('带光环的兵种提示里每个光环一行', () => {
    const d = { ...coverUnit, auras: [coverUnit.auras[0], { ...coverUnit.auras[0], name: '另一个', radius: 90, value: 0.5 }] };
    const lines = unitTip(d).split('\n').filter(l => l.startsWith('光环'));
    expect(lines).toEqual([
      '光环「盾墙掩护」：半径 60 内的其他友军所受远程伤害 −20%',
      '光环「另一个」：半径 90 内的其他友军所受远程伤害 −50%',
    ]);
  });
});

/**
 * Hud 的构造会拼出整页界面（大量 innerHTML、按选择器取子节点）：这里用宽松的假节点——取不到的选择器当场造一个挂上去。
 * 只测移动版新增的部分：取消选择按钮、缩放条接线、摇杆位置设置、观战与销毁时根元素上的类。
 */
class HudEl extends FakeEl {
  /** 为 true 时取不到的选择器返回 null（像真的 DOM），构造完成后用来验证「没有这个元素」的情形 */
  static strict = false;
  contains(n: unknown): boolean {
    for (let x = n as FakeEl | null; x; x = x.parent) if (x === this) return true;
    return false;
  }
  override querySelector(sel: string): FakeEl | null {
    const classes = sel.split('.').filter(Boolean);
    const tag = /^[a-z]/.test(sel) ? sel.split('.')[0] : '';
    const hit = (n: FakeEl): boolean => (!tag || n.tagName === tag) && classes.filter((_, i) => tag ? i > 0 : true).every(c => n.classList.contains(c));
    const walk = (n: FakeEl): FakeEl | null => {
      for (const c of n.children) {
        if (hit(c)) return c;
        const r = walk(c);
        if (r) return r;
      }
      return null;
    };
    const found = walk(this);
    if (found || HudEl.strict) return found;
    const e = new HudEl(tag || 'div');
    e.className = tag ? classes.slice(1).join(' ') : classes.join(' ');
    this.appendChild(e);
    return e;
  }
  /** 纯文本的 innerHTML（如按钮上的「左」）同时当文字内容 */
  override get innerHTML(): string { return super.innerHTML; }
  override set innerHTML(v: string) {
    super.innerHTML = v;
    if (!v.includes('<')) this.textContent = v;
  }
  lastChild = null;
  focus(): void {}
  blur(): void {}
}

describe('Hud 移动版新增的界面', () => {
  let host: HudEl;
  let cb: Record<string, ReturnType<typeof vi.fn>>;
  let store: Map<string, string>;
  let hud: Hud | null;
  const world = createGame({
    seed: 5, factions: ['china', 'japan'], armySize: 60, difficulty: 1, fog: false, spectate: false, environment: false, supply: false,
  }).world;
  const watchWorld = createGame({
    seed: 5, factions: ['china', 'japan'], armySize: 60, difficulty: 1, fog: false, spectate: true, environment: false, supply: false,
  }).world;

  const walk = (n: FakeEl, f: (x: FakeEl) => void): void => {
    f(n);
    n.children.forEach(c => walk(c, f));
  };
  const find = (pred: (x: FakeEl) => boolean): FakeEl | null => {
    let r: FakeEl | null = null;
    walk(host, x => {
      if (!r && pred(x)) r = x;
    });
    return r;
  };
  const mk = (w = world, rgb: [number, number, number][] = [[0, 0, 0], [200, 0, 0], [0, 0, 200]]): Hud => {
    const callbacks = new Proxy({} as Record<string, ReturnType<typeof vi.fn>>, {
      get: (t, k: string) => (t[k] ??= vi.fn(k === 'soundOn' || k === 'toggleSound' ? () => false : undefined)),
    });
    cb = callbacks;
    hud = new Hud(host as unknown as HTMLElement, w, rgb, callbacks as unknown as HudCallbacks);
    return hud;
  };
  const desel = (): FakeEl => find(x => x.classList.contains('desel') && x.tagName === 'button')!;
  /** 设置里「摇杆位置」那一行的左 / 右按钮 */
  const stickBtns = (): { left: FakeEl; right: FakeEl } => {
    const row = find(x => x.classList.contains('srow') && x.innerHTML.includes('摇杆位置'))!;
    expect(row).toBeTruthy();
    const [left, right] = row.children[row.children.length - 1].children;
    return { left, right };
  };
  const tapOn = (b: FakeEl): void => { firePointer(b, 'pointerdown'); firePointer(b, 'pointerup'); };

  beforeEach(() => {
    installFakeDom(vi);
    host = new HudEl();
    store = new Map();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });
    vi.stubGlobal('document', {
      createElement: (tag: string) => (tag === 'canvas' ? new HudEl('canvas') : new HudEl(tag)),
      documentElement: {},
      elementFromPoint: () => null,
    });
    hud = null;
    HudEl.strict = false;
  });

  afterEach(() => {
    hud?.destroy();
    vi.unstubAllGlobals();
  });

  describe('观战', () => {
    it('观战时根上加 watch 类，没有「取消选择」按钮；有玩家时没有 watch 类', () => {
      mk(watchWorld);
      expect(host.classList.contains('watch')).toBe(true);
      expect(find(x => x.classList.contains('desel'))).toBeNull();
      hud!.destroy();
      hud = null;
      host = new HudEl();
      mk(world);
      expect(host.classList.contains('watch')).toBe(false);
    });
  });

  describe('取消选择按钮', () => {
    it('有玩家时卡片带（cardwrap）最前面是一个 mobile-only 的 button.desel', () => {
      mk();
      const b = desel();
      expect(b).toBeTruthy();
      expect(b.classList.contains('mobile-only')).toBe(true);
      expect(b.parent!.classList.contains('cardwrap')).toBe(true);
      expect(b.parent!.children[0]).toBe(b);
    });

    it('点一下回调 command(\'deselect\')', () => {
      mk();
      hud!.updateSelection([0, 1]);
      tapOn(desel());
      expect(cb.command).toHaveBeenCalledTimes(1);
      expect(cb.command).toHaveBeenCalledWith('deselect');
    });

    it('没选部队也没选据点时 disabled、点了不回调；选了部队或选了据点时可用', () => {
      mk();
      hud!.updateSelection([]);
      expect(desel().disabled).toBe(true);
      tapOn(desel());
      expect(cb.command).not.toHaveBeenCalled();
      hud!.updateSelection([0]);
      expect(desel().disabled).toBe(false);
      hud!.updateSelection([]);
      expect(desel().disabled).toBe(true);
      hud!.updateSelection([], 0);
      expect(desel().disabled).toBe(false);
    });
  });

  describe('取消选择：有选择或处于指令模式时可按', () => {
    /** 指令面板里的「取消选择」按钮 */
    const panelDesel = (): FakeEl => (hud as unknown as { cmdBtns: Map<string, FakeEl> }).cmdBtns.get('deselect')!;
    const both = (): boolean[] => [panelDesel().disabled, desel().disabled];

    it('没选东西、不在指令模式：两个按钮都 disabled', () => {
      mk();
      hud!.updateSelection([]);
      expect(both()).toEqual([true, true]);
    });

    it('选了部队或选了据点：两个按钮都可用', () => {
      mk();
      hud!.updateSelection([0, 1]);
      expect(both()).toEqual([false, false]);
      hud!.updateSelection([], 0);
      expect(both()).toEqual([false, false]);
      hud!.updateSelection([]);
      expect(both()).toEqual([true, true]);
    });

    it('处于指令模式（setMode 传了非空文字）：没选东西也可按；setMode 立即刷新，不必等 updateSelection', () => {
      mk();
      hud!.updateSelection([]);
      hud!.setMode('指令模式：点地面下令');
      expect(both()).toEqual([false, false]);
      hud!.setMode('');
      expect(both()).toEqual([true, true]);
    });

    it('指令模式下 updateSelection 不把按钮又禁用；退出模式后有选择就仍可按', () => {
      mk();
      hud!.setMode('指令模式');
      hud!.updateSelection([]);
      expect(both()).toEqual([false, false]);
      hud!.updateSelection([0]);
      hud!.setMode('');
      expect(both()).toEqual([false, false]);
      hud!.updateSelection([]);
      expect(both()).toEqual([true, true]);
    });

    it('指令模式里没选东西也能点卡片带的「取消选择」：回调 command(\'deselect\')', () => {
      mk();
      hud!.updateSelection([]);
      hud!.setMode('指令模式');
      tapOn(desel());
      expect(cb.command).toHaveBeenCalledWith('deselect');
    });
  });

  describe('setMode 与提示条高度', () => {
    const tipEl = (): FakeEl => (hud as unknown as { modeTip: FakeEl }).modeTip;
    const tip = (): string => hud!.root.style.getPropertyValue('--tip');

    it('有提示时根元素的 --tip = 提示条高度 + 2px，没有提示时 0px，随提示变化', () => {
      mk();
      tipEl().offsetHeight = 40;
      hud!.setMode('指令模式');
      expect(tip()).toBe('42px');
      tipEl().offsetHeight = 64;
      hud!.setMode('指令模式：两行的长提示');
      expect(tip()).toBe('66px');
      hud!.setMode('');
      expect(tip()).toBe('0px');
    });

    it('提示条文字与显示随 setMode 变化，根上不再加 has-mode 类', () => {
      mk();
      hud!.setMode('指令模式');
      expect(tipEl().textContent).toBe('指令模式');
      expect(tipEl().style.display).toBe('block');
      expect(hud!.root.classList.contains('has-mode')).toBe(false);
      hud!.setMode('');
      expect(tipEl().style.display).toBe('none');
      expect(hud!.root.classList.contains('has-mode')).toBe(false);
    });
  });

  describe('卡片拖拽避开顶栏', () => {
    it('Hud 把自己的顶栏（.topbar）传给 CardBar', () => {
      mk();
      const tb = (hud as unknown as { cards: { topbar: FakeEl | null } }).cards.topbar;
      expect(tb).toBeTruthy();
      expect(tb!.classList.contains('topbar')).toBe(true);
      expect(host.contains(tb)).toBe(true);
    });
  });

  describe('战报 message', () => {
    const feedMsgs = (): FakeEl[] => (hud as unknown as { feed: FakeEl }).feed.children;

    it('给了 x、y（点了能跳镜头）的战报带 go 类，点一下回调 focus(x, y)', () => {
      mk();
      hud!.message('据点失守', 'bad', 12, 34);
      const m = feedMsgs()[0];
      expect(m.classList.contains('go')).toBe(true);
      expect(m.classList.contains('msg')).toBe(true);
      expect(m.classList.contains('bad')).toBe(true);
      m.onclick!(new Event('click'));
      expect(cb.focus).toHaveBeenCalledWith(12, 34);
    });

    it('x、y 为 0 也算给了（带 go 类）', () => {
      mk();
      hud!.message('原点', 'info', 0, 0);
      expect(feedMsgs()[0].classList.contains('go')).toBe(true);
    });

    it('没给 x、y（或只给一个）的战报不带 go 类，也不能点', () => {
      mk();
      hud!.message('开战', 'good');
      expect(feedMsgs()[0].classList.contains('go')).toBe(false);
      expect(feedMsgs()[0].onclick).toBeNull();
      hud!.message('只有 x', 'info', 5);
      expect(feedMsgs()[0].classList.contains('go')).toBe(false);
    });
  });

  describe('把手', () => {
    const handles = (): string[] => {
      const r: string[] = [];
      walk(host, x => {
        if (x.classList.contains('handle')) r.push(x.classList.contains('left') ? 'left' : x.classList.contains('right') ? 'right' : '?');
      });
      return r;
    };

    it('有玩家时左右两个把手', () => {
      mk();
      expect(handles().sort()).toEqual(['left', 'right']);
    });

    it('观战时只有左侧把手', () => {
      mk(watchWorld);
      expect(handles()).toEqual(['left']);
    });

    it('观战时 openDrawer 与 setMobile 没有右把手也不出错，左把手的 aria-expanded 照常更新', () => {
      mk(watchWorld);
      HudEl.strict = true;
      expect(() => hud!.openDrawer('left')).not.toThrow();
      expect(() => hud!.openDrawer('right')).not.toThrow();
      expect(() => hud!.openDrawer(null)).not.toThrow();
      expect(() => hud!.setMobile(true)).not.toThrow();
      hud!.openDrawer('left');
      const left = find(x => x.classList.contains('handle') && x.classList.contains('left'))!;
      expect(left.attrs['aria-expanded']).toBe('true');
      hud!.openDrawer(null);
      expect(left.attrs['aria-expanded']).toBe('false');
    });
  });

  describe('顶栏数值', () => {
    const boxOf = (cls: string): FakeEl => find(x => x.classList.contains(cls))!;
    const resHtml = (): string => boxOf('res').innerHTML;
    const resNum = (k: 'wood' | 'stone' | 'gold'): string => new RegExp(`class="r-${k}"[^>]*>[^<]*<b>([^<]*)</b>`).exec(resHtml())![1];
    const setFood = (food: number, foodIn: number, foodOut: number): void => {
      world.upkeep0[1] = 1;
      world.food[1] = food;
      world.foodIn[1] = foodIn;
      world.foodOut[1] = foodOut;
    };
    afterEach(() => {
      for (const k of ['wood', 'stone', 'gold'] as const) world.stock[k][1] = 0;
      world.upkeep0[1] = 0;
      world.food[1] = 0;
      world.foodIn[1] = 0;
      world.foodOut[1] = 0;
    });

    it('移动版：木 / 石 / 金存量上千缩写（1426 → 1.4k，12999 → 12k，不到 1000 原样）', () => {
      world.stock.wood[1] = 1426;
      world.stock.stone[1] = 12999;
      world.stock.gold[1] = 999;
      mk().setMobile(true);
      hud!.update();
      expect(resNum('wood')).toBe('1.4k');
      expect(resNum('stone')).toBe('12k');
      expect(resNum('gold')).toBe('999');
    });

    it('桌面版：存量原样写完整数字', () => {
      world.stock.wood[1] = 1426;
      world.stock.stone[1] = 12999;
      world.stock.gold[1] = 999.7;
      mk();
      hud!.update();
      expect(resNum('wood')).toBe('1426');
      expect(resNum('stone')).toBe('12999');
      expect(resNum('gold')).toBe('999');
    });

    it('移动版粮草写成「粮 存量（带符号的每分钟净收支）」：粮 1.9k（-33）、正数带 +', () => {
      setFood(1999, 10, 43);
      mk().setMobile(true);
      hud!.update();
      expect(boxOf('food').textContent).toBe('粮 1.9k（-33）');
      setFood(250, 40, 35);
      hud!.update();
      expect(boxOf('food').textContent).toBe('粮 250（+5）');
    });

    it('移动版净收支为 0 写（+0）', () => {
      setFood(500, 20, 20);
      mk().setMobile(true);
      hud!.update();
      expect(boxOf('food').textContent).toBe('粮 500（+0）');
    });

    it('桌面版粮草不变：「粮草 N（±M/分）」，存量不缩写', () => {
      setFood(1999, 10, 43);
      mk();
      hud!.update();
      expect(boxOf('food').textContent).toBe('粮草 1999（-33/分）');
      setFood(250, 40, 35);
      hud!.update();
      expect(boxOf('food').textContent).toBe('粮草 250（+5/分）');
    });

    it('阵营牌 span.tag 带 title=阵营名', () => {
      mk();
      hud!.update();
      const html = boxOf('counts').innerHTML;
      const tags = [...html.matchAll(/<span class="tag"[^>]*title="([^"]*)">([^<]*)<\/span>/g)];
      expect(tags).toHaveLength(2);
      for (const [, title, text] of tags) {
        expect(title).toBeTruthy();
        expect(title).toBe(text);
      }
      expect(tags[0][1]).toBe(world.factions[1]!.name);
      expect(tags[1][1]).toBe(world.factions[2]!.name);
    });
  });

  describe('updateSelection 把 allPicked 传给卡片', () => {
    it('allPicked 为 true：全选卡片带 on、人数写选中的人数', () => {
      mk();
      const sel = [0, 1, 2];
      hud!.updateSelection(sel, -1, [], true);
      const html = (hud as unknown as { cards: { roster: FakeEl } }).cards.roster.innerHTML;
      expect(html).toMatch(/class="ucard acard on" data-all="1"[\s\S]*?<b>3<\/b>/);
    });

    it('allPicked 默认为 false：全选卡片写屏幕内人数、屏幕内没人时 off', () => {
      mk();
      hud!.updateSelection([0, 1, 2], -1, []);
      const html = (hud as unknown as { cards: { roster: FakeEl } }).cards.roster.innerHTML;
      expect(html).toMatch(/class="ucard acard off" data-all="1"[\s\S]*?<b>0<\/b>/);
    });
  });

  describe('缩放条', () => {
    it('摇杆列（joycol）里缩放条在摇杆上方；在长条上按下 / 拖动时回调 zoomTo(f)，点 + 端 / − 端放大 / 缩小一档', () => {
      mk();
      const col = find(x => x.classList.contains('joycol'))!;
      expect(col.classList.contains('mobile-only')).toBe(true);
      expect(col.children[0]).toBe(hud!.zoom.el as unknown as FakeEl);
      expect(col.children[1]).toBe(hud!.stick.el as unknown as FakeEl);
      const zoom = hud!.zoom.el as unknown as FakeEl;
      // 长条横向 [40, 200]，滑块宽 40：手指在 x = 120 是 0.5
      const track = zoom.querySelector('.ztrack')!;
      track.rect = rectOf(40, 0, 160, 40);
      const thumb = new HudEl('i');
      thumb.offsetWidth = 40;
      track.appendChild(thumb);
      firePointer(zoom, 'pointerdown', { clientX: 120, clientY: 20, buttons: 1 });
      expect(cb.zoomTo).toHaveBeenCalledTimes(1);
      expect(cb.zoomTo.mock.calls[0][0]).toBeCloseTo(0.5);
      firePointer(zoom, 'pointermove', { clientX: 180, clientY: 20, buttons: 1 });
      expect(cb.zoomTo.mock.calls[1][0]).toBeCloseTo(1);
      firePointer(zoom, 'pointerup', { pointerId: 1 });
      // 点右端的 +：+0.125，夹在 1
      cb.zoomTo.mockClear();
      firePointer(zoom, 'pointerdown', { clientX: 230, clientY: 20, buttons: 1 });
      firePointer(zoom, 'pointerup', { pointerId: 1 });
      expect(cb.zoomTo).toHaveBeenCalledWith(1);
      // 同步到 0.5 后点左端的 −：0.375
      hud!.zoom.sync(0.5);
      firePointer(zoom, 'pointerdown', { clientX: 10, clientY: 20, buttons: 1 });
      firePointer(zoom, 'pointerup', { pointerId: 1 });
      expect(cb.zoomTo.mock.calls.at(-1)![0]).toBeCloseTo(0.375);
    });
  });

  describe('摇杆位置', () => {
    const cardsOf = (): { mapSide: number } => (hud as unknown as { cards: { mapSide: number } }).cards;

    it('设置里有 mobile-only 的「摇杆位置」一行，左 / 右两个按钮；默认选「左」：不带 stick-right、mapSide 为 1', () => {
      mk();
      const row = find(x => x.classList.contains('srow') && x.innerHTML.includes('摇杆位置'))!;
      expect(row.classList.contains('mobile-only')).toBe(true);
      const { left, right } = stickBtns();
      expect(left.textContent).toBe('左');
      expect(right.textContent).toBe('右');
      expect(left.classList.contains('on')).toBe(true);
      expect(right.classList.contains('on')).toBe(false);
      hud!.setMobile(true);
      expect(host.classList.contains('stick-right')).toBe(false);
      expect(cardsOf().mapSide).toBe(1);
    });

    it('选「右」：host 加 stick-right、mapSide 为 −1，存进 prefs 的 stickSide；再选「左」去掉类、mapSide 回 1', () => {
      mk();
      hud!.setMobile(true);
      const { left, right } = stickBtns();
      right.onclick!(new Event('click'));
      expect(host.classList.contains('stick-right')).toBe(true);
      expect(cardsOf().mapSide).toBe(-1);
      expect(store.get('fengyan.stickSide')).toBe('right');
      expect(right.classList.contains('on')).toBe(true);
      expect(left.classList.contains('on')).toBe(false);
      left.onclick!(new Event('click'));
      expect(host.classList.contains('stick-right')).toBe(false);
      expect(cardsOf().mapSide).toBe(1);
      expect(store.get('fengyan.stickSide')).toBe('left');
      expect(left.classList.contains('on')).toBe(true);
      expect(right.classList.contains('on')).toBe(false);
    });

    it('prefs 里记着「右」时下次进来默认选「右」，setMobile 时按记住的选择应用', () => {
      store.set('fengyan.stickSide', 'right');
      mk();
      expect(stickBtns().right.classList.contains('on')).toBe(true);
      expect(stickBtns().left.classList.contains('on')).toBe(false);
      hud!.setMobile(true);
      expect(host.classList.contains('stick-right')).toBe(true);
      expect(cardsOf().mapSide).toBe(-1);
    });

    it('prefs 里是别的值时当作「左」', () => {
      store.set('fengyan.stickSide', 'middle');
      mk();
      hud!.setMobile(true);
      expect(host.classList.contains('stick-right')).toBe(false);
      expect(cardsOf().mapSide).toBe(1);
    });

    it('切到桌面版再切回来，仍按记住的选择', () => {
      mk();
      hud!.setMobile(true);
      stickBtns().right.onclick!(new Event('click'));
      hud!.setMobile(false);
      hud!.setMobile(true);
      expect(host.classList.contains('stick-right')).toBe(true);
      expect(cardsOf().mapSide).toBe(-1);
    });
  });

  describe('销毁', () => {
    it('destroy 把 host 上的 mobile / watch / stick-right 类都去掉', () => {
      mk(watchWorld);
      hud!.setMobile(true);
      stickBtns().right.onclick!(new Event('click'));
      for (const c of ['mobile', 'watch', 'stick-right']) expect(host.classList.contains(c), c).toBe(true);
      hud!.destroy();
      for (const c of ['mobile', 'watch', 'stick-right']) expect(host.classList.contains(c), c).toBe(false);
      hud = null;
    });
  });
});
