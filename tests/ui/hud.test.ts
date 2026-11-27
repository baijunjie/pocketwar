import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AU_RANGED_TAKEN, ELITE, EXPAND_RULES, SIZES, SITE_CAMP, SITE_CITY, UNITS, UNIT_BY_KEY, expandUnit, isContentUnit, unitKind } from '../../src/sim/defs';
import { unitUpgradeCost } from '../../src/sim/systems/economy';
import { createGame } from '../../src/sim/setup';
import { Hud, tier3Perks } from '../../src/ui/hud';
import type { HudCallbacks, UpgradeChoice } from '../../src/ui/hud';
import { FakeCanvas, FakeEl, firePointer, installFakeDom, rectOf } from './fakeDom';
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
    const byIndex = /^button\[data-i="(\d+)"\]$/.exec(sel);
    if (byIndex) return this.children.find(c => c.tagName === 'button' && c.dataset.i === byIndex[1]) ?? null;
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
    if (this.classList.contains('upmenu')) {
      this.setMenuHtml(v);
      return;
    }
    super.innerHTML = v;
    if (!v.includes('<')) this.textContent = v;
  }
  /** 假 DOM 的 closest 只认类名与标签名；升级菜单的按钮用 `button[data-i]`，这里补上 */
  override closest(sel: string): FakeEl | null {
    if (sel !== 'button[data-i]') return super.closest(sel);
    for (let n: FakeEl | null = this; n; n = n.parent) if (n.tagName === 'button' && n.dataset.i !== undefined) return n;
    return null;
  }
  /** 升级弹出框（.upmenu）的 innerHTML 解析成真节点（h3、p、button[data-i]>b+i），才能测原地刷新与焦点；焦点在被换掉的旧节点上时落回 body（null） */
  private setMenuHtml(v: string): void {
    const doc = document as unknown as { activeElement?: FakeEl | null };
    const wasIn = this.contains(doc.activeElement);
    super.innerHTML = v;
    for (const c of this.children.splice(0)) c.parent = null;
    for (const m of v.matchAll(/<h3>([^<]*)<\/h3>|<p>([^<]*)<\/p>|<button data-i="(\d+)"( disabled)?><b>([^<]*)<\/b><i>([^<]*)<\/i><\/button>/g)) {
      if (m[1] !== undefined || m[2] !== undefined) {
        const t = new HudEl(m[1] !== undefined ? 'h3' : 'p');
        t.textContent = m[1] ?? m[2];
        this.appendChild(t);
        continue;
      }
      const b = new HudEl('button');
      b.dataset.i = m[3];
      b.disabled = !!m[4];
      const bold = new HudEl('b'), sub = new HudEl('i');
      bold.textContent = m[5];
      sub.textContent = m[6];
      b.append(bold, sub);
      this.appendChild(b);
    }
    if (wasIn) doc.activeElement = null;
  }
  override querySelectorAll(sel: string): FakeEl[] {
    if (sel === 'button[data-i]') return this.children.filter(c => c.tagName === 'button' && c.dataset.i !== undefined);
    return super.querySelectorAll(sel);
  }
  lastChild = null;
  focus(): void {
    (document as unknown as { activeElement?: FakeEl | null }).activeElement = this;
  }
  blur(): void {
    const doc = document as unknown as { activeElement?: FakeEl | null };
    if (doc.activeElement === this) doc.activeElement = null;
  }
}

describe('Hud 移动版新增的界面', () => {
  let host: HudEl;
  let cb: Record<string, ReturnType<typeof vi.fn>>;
  let store: Map<string, string>;
  let hud: Hud | null;
  let win: EventTarget;
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
      get: (t, k: string) => (t[k] ??= vi.fn(['soundOn', 'toggleSound', 'musicOn', 'toggleMusic'].includes(k) ? () => false : undefined)),
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
  /** 取消选择按钮的手指由卡片带（cardwrap）受理：事件派发在 cardwrap 上，目标是按钮 */
  const cardwrap = (): FakeEl => find(x => x.classList.contains('cardwrap'))!;
  const padDown = (id = 1, target: FakeEl = desel()): Event => firePointer(cardwrap(), 'pointerdown', { clientX: 20, clientY: 10, pointerId: id, buttons: 1 }, target);
  const padUp = (id = 1): Event => firePointer(cardwrap(), 'pointerup', { clientX: 20, clientY: 10, pointerId: id, buttons: 0 });
  const tapDesel = (id = 1): void => { padDown(id); padUp(id); };
  /** 键盘（Enter / 空格）与读屏软件的激活：只发 click，detail 为 0 */
  const clickDesel = (detail: number): void => {
    const e = new Event('click', { cancelable: true });
    Object.defineProperty(e, 'detail', { value: detail });
    desel().dispatchEvent(e);
  };

  beforeEach(() => {
    win = installFakeDom(vi).win;
    host = new HudEl();
    store = new Map();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });
    vi.stubGlobal('document', {
      createElement: (tag: string) => (tag === 'canvas' ? new HudEl('canvas') : new HudEl(tag)),
      documentElement: {},
      elementFromPoint: () => null,
      activeElement: null,
    });
    vi.stubGlobal('HTMLButtonElement', class { static [Symbol.hasInstance](x: unknown): boolean { return (x as FakeEl | null)?.tagName === 'button'; } });
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

  it('设置中的音效与音乐可独立切换，顶栏音效按钮及 M 的状态更新只同步音效', () => {
    const hud = mk();
    const buttons: FakeEl[] = [];
    walk(host, el => { if (el.attrs.role === 'switch') buttons.push(el); });
    const effects = buttons.find(b => b.attrs['aria-label'] === '音效')!;
    const music = buttons.find(b => b.attrs['aria-label'] === '音乐')!;
    const top = find(b => b.tagName === 'button' && b.textContent === '音效：关')!;
    expect(effects.attrs['aria-checked']).toBe('false');
    expect(music.attrs['aria-checked']).toBe('false');

    cb.toggleMusic.mockReturnValue(true);
    music.onclick!(new Event('click'));
    expect(cb.toggleMusic).toHaveBeenCalledTimes(1);
    expect(cb.toggleSound).not.toHaveBeenCalled();
    expect(music.attrs['aria-checked']).toBe('true');
    expect(effects.attrs['aria-checked']).toBe('false');

    cb.toggleSound.mockReturnValueOnce(true).mockReturnValueOnce(false);
    effects.onclick!(new Event('click'));
    expect(top.textContent).toBe('音效：开');
    expect(effects.attrs['aria-checked']).toBe('true');
    top.onclick!(new Event('click'));
    expect(effects.attrs['aria-checked']).toBe('false');

    hud.setSound(true);
    expect(top.textContent).toBe('音效：开');
    expect(effects.attrs['aria-checked']).toBe('true');
    expect(music.attrs['aria-checked']).toBe('true');
    expect(cb.toggleMusic).toHaveBeenCalledTimes(1);
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
      tapDesel();
      expect(cb.command).toHaveBeenCalledTimes(1);
      expect(cb.command).toHaveBeenCalledWith('deselect');
    });

    it('卡片带上有一根手指按着（cards.busy）时另一指点它不响应；那一下结束后恢复', () => {
      mk();
      hud!.setMobile(true);
      hud!.updateSelection([0, 1]);
      firePointer(cardwrap(), 'pointerdown', { clientX: 100, clientY: 10, pointerId: 1, buttons: 1 }, new HudEl());
      expect(hud!.cards.busy).toBe(true);
      tapDesel(2);
      expect(cb.command).not.toHaveBeenCalled();
      expect(desel().classList.contains('down')).toBe(false);
      firePointer(cardwrap(), 'pointerup', { clientX: 100, clientY: 10, pointerId: 1, buttons: 0 });
      expect(hud!.cards.busy).toBe(false);
      tapDesel();
      expect(cb.command).toHaveBeenCalledTimes(1);
      expect(cb.command).toHaveBeenCalledWith('deselect');
    });

    it('按下时占住卡片带：按钮带 down 类；抬起去掉；按住期间别的手指按卡片带不受理', () => {
      mk();
      hud!.updateSelection([0, 1]);
      padDown();
      expect(hud!.cards.busy).toBe(true);
      expect(desel().classList.contains('down')).toBe(true);
      padUp();
      expect(hud!.cards.busy).toBe(false);
      expect(desel().classList.contains('down')).toBe(false);
    });

    it('滑开超过 TAP_SLOP 作废：不回调', () => {
      mk();
      hud!.updateSelection([0, 1]);
      padDown();
      firePointer(cardwrap(), 'pointermove', { clientX: 20 + 11, clientY: 10, pointerId: 1, buttons: 1 });
      expect(desel().classList.contains('down')).toBe(false);
      padUp();
      expect(cb.command).not.toHaveBeenCalled();
    });

    it('键盘 / 读屏激活（click 的 detail 为 0）：回调 command(\'deselect\')；detail 非 0（指针的合成 click）不重复回调', () => {
      mk();
      hud!.updateSelection([0, 1]);
      clickDesel(1);
      expect(cb.command).not.toHaveBeenCalled();
      clickDesel(0);
      expect(cb.command).toHaveBeenCalledTimes(1);
      expect(cb.command).toHaveBeenCalledWith('deselect');
    });

    it('键盘激活：disabled 时不回调；卡片带上有一下按着（busy）时不回调', () => {
      mk();
      hud!.setMobile(true);
      hud!.updateSelection([]);
      clickDesel(0);
      expect(cb.command).not.toHaveBeenCalled();
      hud!.updateSelection([0, 1]);
      firePointer(cardwrap(), 'pointerdown', { clientX: 100, clientY: 10, pointerId: 1, buttons: 1 }, new HudEl());
      expect(hud!.cards.busy).toBe(true);
      clickDesel(0);
      expect(cb.command).not.toHaveBeenCalled();
    });

    it('按钮上的右键菜单被拦', () => {
      mk();
      const e = new Event('contextmenu', { cancelable: true });
      desel().dispatchEvent(e);
      expect(e.defaultPrevented).toBe(true);
    });

    it('没选部队也没选据点时 disabled、点了不回调；选了部队或选了据点时可用', () => {
      mk();
      hud!.updateSelection([]);
      expect(desel().disabled).toBe(true);
      tapDesel();
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
      tapDesel();
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

  describe('速度与暂停', () => {
    const ctl = (): FakeEl => find(x => x.classList.contains('ctl'))!;
    const buttons = (): FakeEl[] => ctl().children.filter(c => c.tagName === 'button');
    const pauseBtn = (): FakeEl => buttons().find(b => b.textContent === '暂停' || b.textContent === '继续')!;
    const speedBtn = (): FakeEl => find(x => x.tagName === 'button' && x.classList.contains('speed'))!;
    /** 点菜单里的按钮：按钮自己的 onclick，再冒泡到菜单的 click 监听 */
    const click = (b: FakeEl, own = true): void => {
      if (own) b.onclick!(new Event('click'));
      const e = new Event('click', { cancelable: true });
      Object.defineProperty(e, 'target', { value: b });
      ctl().dispatchEvent(e);
    };
    const openMenu = (): void => {
      find(x => x.classList.contains('menubtn'))!.onclick!(new Event('click'));
      expect(ctl().classList.contains('open')).toBe(true);
    };

    it('菜单里没有 暂停 / 1× / 2× / 4× 四个按钮，只有一个「暂停」和一个 .speed 速度按钮（默认「1×」）', () => {
      mk();
      const texts = buttons().map(b => b.textContent);
      expect(texts).toContain('暂停');
      expect(texts).not.toContain('2×');
      expect(texts).not.toContain('4×');
      expect(buttons().filter(b => /^\d×$/.test(b.textContent))).toEqual([speedBtn()]);
      expect(speedBtn().textContent).toBe('1×');
      expect(pauseBtn().classList.contains('on')).toBe(false);
    });

    it('setSpeed 驱动显示：运行中速度按钮写当前速度，暂停按钮不亮', () => {
      mk();
      for (const s of [2, 4, 1]) {
        hud!.setSpeed(s);
        expect(speedBtn().textContent).toBe(`${s}×`);
        expect(pauseBtn().textContent).toBe('暂停');
        expect(pauseBtn().classList.contains('on')).toBe(false);
      }
    });

    it('暂停中：暂停按钮写「继续」并带 on，速度按钮写暂停前的速度；恢复后还原', () => {
      mk();
      hud!.setSpeed(2);
      hud!.setSpeed(0);
      expect(pauseBtn().textContent).toBe('继续');
      expect(pauseBtn().classList.contains('on')).toBe(true);
      expect(speedBtn().textContent).toBe('2×');
      hud!.setSpeed(2);
      expect(pauseBtn().textContent).toBe('暂停');
      expect(pauseBtn().classList.contains('on')).toBe(false);
    });

    it('点速度按钮：回调 cycleSpeed()，不回调 togglePause()；下一档由 game 定，Hud 自己不调 setSpeed 的回调', () => {
      mk();
      speedBtn().onclick!(new Event('click'));
      speedBtn().onclick!(new Event('click'));
      expect(cb.cycleSpeed).toHaveBeenCalledTimes(2);
      expect(cb.togglePause).not.toHaveBeenCalled();
      expect(cb.setSpeed).not.toHaveBeenCalled();
    });

    it('点暂停（运行中或暂停中）：回调 togglePause()，不回调 cycleSpeed()', () => {
      mk();
      hud!.setSpeed(4);
      pauseBtn().onclick!(new Event('click'));
      hud!.setSpeed(0);
      pauseBtn().onclick!(new Event('click'));
      expect(cb.togglePause).toHaveBeenCalledTimes(2);
      expect(cb.cycleSpeed).not.toHaveBeenCalled();
      expect(cb.setSpeed).not.toHaveBeenCalled();
    });

    it('点速度按钮不收起菜单；点暂停等其它菜单按钮照旧收起', () => {
      mk();
      openMenu();
      click(speedBtn());
      expect(ctl().classList.contains('open')).toBe(true);
      click(speedBtn());
      expect(ctl().classList.contains('open')).toBe(true);
      click(pauseBtn());
      expect(ctl().classList.contains('open')).toBe(false);
      openMenu();
      click(buttons().find(b => b.textContent === '退出')!, false);
      expect(ctl().classList.contains('open')).toBe(false);
    });

    it('没有全屏接口：菜单里根本没有「全屏」按钮（不是 hidden 的）', () => {
      mk();
      expect(buttons().some(b => b.textContent === '全屏')).toBe(false);
      expect(find(x => x.textContent === '全屏')).toBeNull();
    });

    it('有全屏接口：菜单里有「全屏」按钮，点它回调 requestFullscreen，且不 hidden', () => {
      const requestFullscreen = vi.fn(() => Promise.resolve());
      vi.stubGlobal('document', {
        createElement: (tag: string) => (tag === 'canvas' ? new HudEl('canvas') : new HudEl(tag)),
        documentElement: { requestFullscreen },
        elementFromPoint: () => null,
      });
      mk();
      const fs = buttons().find(b => b.textContent === '全屏')!;
      expect(fs).toBeDefined();
      expect(fs.hidden).toBe(false);
      fs.onclick!(new Event('click'));
      expect(requestFullscreen).toHaveBeenCalledTimes(1);
    });
  });

  describe('详情面板的关闭', () => {
    const me = world.humanTeam;
    const mine = world.alive.reduce<number[]>((r, a, i) => (a && world.team[i] === me ? (r.push(i), r) : r), []);
    const [u1, u2] = [mine[0], mine.find(i => world.uid[i] !== world.uid[mine[0]])!];
    const site = world.sites.findIndex(s => !s.gone);
    const site2 = world.sites.findIndex((s, i) => !s.gone && i !== site);
    const detail = (): FakeEl => find(x => x.classList.contains('detail'))!;
    const dclose = (): FakeEl => find(x => x.classList.contains('dclose'))!;
    const dbody = (): FakeEl => find(x => x.classList.contains('dbody'))!;

    it('详情里有 mobile-only 的关闭按钮 button.dclose 与内容 .dbody；详情内容写在 .dbody 里', () => {
      mk();
      expect(dclose().tagName).toBe('button');
      expect(dclose().classList.contains('mobile-only')).toBe(true);
      expect(dclose().parent).toBe(detail());
      expect(dbody().parent).toBe(detail());
      hud!.updateSelection([u1]);
      expect(detail().hidden).toBe(false);
      expect(dbody().innerHTML).toContain('udetail');
    });

    it('点关闭：详情收起，不回调任何取消选择 / 重选', () => {
      mk();
      hud!.updateSelection([u1]);
      tapOn(dclose());
      expect(detail().hidden).toBe(true);
      expect(cb.command).not.toHaveBeenCalled();
      expect(cb.pickTypes).not.toHaveBeenCalled();
    });

    it('关闭后对同一个单位的定时 updateSelection 不再弹出', () => {
      mk();
      hud!.updateSelection([u1]);
      tapOn(dclose());
      hud!.updateSelection([u1]);
      hud!.updateSelection([u1]);
      expect(detail().hidden).toBe(true);
    });

    it('关闭后 reopenDetail，再 updateSelection 重新显示', () => {
      mk();
      hud!.updateSelection([u1]);
      tapOn(dclose());
      hud!.reopenDetail();
      hud!.updateSelection([u1]);
      expect(detail().hidden).toBe(false);
    });

    it('关闭后换选别的单位会显示', () => {
      mk();
      hud!.updateSelection([u1]);
      tapOn(dclose());
      hud!.updateSelection([u2]);
      expect(detail().hidden).toBe(false);
    });

    it('移动版关掉单位详情后 setMobile(false)：再 updateSelection 时详情照常显示', () => {
      mk();
      hud!.setMobile(true);
      hud!.updateSelection([u1]);
      tapOn(dclose());
      expect(detail().hidden).toBe(true);
      hud!.setMobile(false);
      hud!.updateSelection([u1]);
      expect(detail().hidden).toBe(false);
    });

    describe('detailQuiet：下令顺带换选择期间不打开详情', () => {
      const mini = (): FakeEl & { inert?: boolean } => find(x => x.classList.contains('mini') && x.classList.contains('panel'))!;

      it('quiet 时选中单个单位：详情不显示，.mini 不 inert，摇杆不被 reset', () => {
        mk();
        hud!.setMobile(true);
        const reset = vi.spyOn(hud!.stick, 'reset'), release = vi.spyOn(hud!.zoom, 'release');
        hud!.detailQuiet = true;
        hud!.updateSelection([u1]);
        expect(detail().hidden).toBe(true);
        expect(hud!.detailShown).toBe(false);
        expect(mini().inert).not.toBe(true);
        expect(reset).not.toHaveBeenCalled();
        expect(release).not.toHaveBeenCalled();
      });

      it('quiet 时选中据点同样不显示', () => {
        mk();
        hud!.detailQuiet = true;
        hud!.updateSelection([], site);
        expect(detail().hidden).toBe(true);
      });

      it('quiet 结束后同一单位仍不显示，reopenDetail 后显示', () => {
        mk();
        hud!.detailQuiet = true;
        hud!.updateSelection([u1]);
        hud!.detailQuiet = false;
        hud!.updateSelection([u1]);
        expect(detail().hidden).toBe(true);
        hud!.reopenDetail();
        hud!.updateSelection([u1]);
        expect(detail().hidden).toBe(false);
      });

      it('quiet 结束后换成别的单位照常显示', () => {
        mk();
        hud!.detailQuiet = true;
        hud!.updateSelection([u1]);
        hud!.detailQuiet = false;
        hud!.updateSelection([u2]);
        expect(detail().hidden).toBe(false);
      });

      it('详情原本显示着时 quiet 不影响：同一单位继续显示，换成别的单位照常显示并更新内容', () => {
        mk();
        hud!.updateSelection([u1]);
        hud!.detailQuiet = true;
        hud!.updateSelection([u1]);
        expect(detail().hidden).toBe(false);
        const before = dbody().innerHTML;
        hud!.updateSelection([u2]);
        expect(detail().hidden).toBe(false);
        expect(hud!.detailShown).toBe(true);
        expect(dbody().innerHTML).not.toBe(before);
      });

      it('quiet 默认关闭：不设时选中单位照常显示', () => {
        mk();
        expect(hud!.detailQuiet).toBe(false);
        hud!.updateSelection([u1]);
        expect(detail().hidden).toBe(false);
      });
    });

    describe('小地图块变 inert 的那一刻放掉摇杆与缩放条的手指', () => {
      it('移动版详情显示、小地图块从可交互变 inert：调 stick.reset() 与 zoom.release()', () => {
        mk();
        hud!.setMobile(true);
        const reset = vi.spyOn(hud!.stick, 'reset'), release = vi.spyOn(hud!.zoom, 'release');
        hud!.updateSelection([u1]);
        expect(reset).toHaveBeenCalledTimes(1);
        expect(release).toHaveBeenCalledTimes(1);
      });

      it('已经 inert 时的重复 updateSelection 不再调', () => {
        mk();
        hud!.setMobile(true);
        hud!.updateSelection([u1]);
        const reset = vi.spyOn(hud!.stick, 'reset'), release = vi.spyOn(hud!.zoom, 'release');
        hud!.updateSelection([u1]);
        hud!.updateSelection([u2]);
        expect(reset).not.toHaveBeenCalled();
        expect(release).not.toHaveBeenCalled();
      });

      it('inert 恢复时不调', () => {
        mk();
        hud!.setMobile(true);
        hud!.updateSelection([u1]);
        const reset = vi.spyOn(hud!.stick, 'reset'), release = vi.spyOn(hud!.zoom, 'release');
        hud!.suppressDetail();
        hud!.reopenDetail();
        hud!.updateSelection([]);
        expect(reset).not.toHaveBeenCalled();
        expect(release).not.toHaveBeenCalled();
      });

      it('桌面版显示详情不 inert，也不调', () => {
        mk();
        const reset = vi.spyOn(hud!.stick, 'reset'), release = vi.spyOn(hud!.zoom, 'release');
        hud!.updateSelection([u1]);
        expect(reset).not.toHaveBeenCalled();
        expect(release).not.toHaveBeenCalled();
      });

      it('桌面版详情显示着时切到移动版（立刻 inert）：调', () => {
        mk();
        hud!.updateSelection([u1]);
        const release = vi.spyOn(hud!.zoom, 'release');
        hud!.setMobile(true);
        expect(release).toHaveBeenCalledTimes(1);
      });
    });

    describe('suppressDetail / detailShown / 小地图块的 inert', () => {
      const mini = (): FakeEl & { inert?: boolean } => find(x => x.classList.contains('mini') && x.classList.contains('panel'))!;

      it('detailShown 随详情显示 / 收起', () => {
        mk();
        expect(hud!.detailShown).toBe(false);
        hud!.updateSelection([u1]);
        expect(hud!.detailShown).toBe(true);
        hud!.updateSelection([]);
        expect(hud!.detailShown).toBe(false);
      });

      it('suppressDetail：收起当前详情，同一对象的 updateSelection 不再弹出，reopenDetail 后再显示', () => {
        mk();
        hud!.updateSelection([u1]);
        hud!.suppressDetail();
        expect(detail().hidden).toBe(true);
        expect(hud!.detailShown).toBe(false);
        hud!.updateSelection([u1]);
        expect(detail().hidden).toBe(true);
        hud!.reopenDetail();
        hud!.updateSelection([u1]);
        expect(detail().hidden).toBe(false);
      });

      it('suppressDetail 之后换了对象会显示', () => {
        mk();
        hud!.updateSelection([u1]);
        hud!.suppressDetail();
        hud!.updateSelection([u2]);
        expect(detail().hidden).toBe(false);
      });

      it('没有详情时调 suppressDetail 不出错，也不影响之后选单位弹详情', () => {
        mk();
        hud!.suppressDetail();
        hud!.updateSelection([u1]);
        expect(detail().hidden).toBe(false);
      });

      it('移动版详情显示着：小地图块 inert；详情收起（关闭按钮、suppressDetail、取消选择）后恢复', () => {
        mk();
        hud!.setMobile(true);
        expect(mini().inert).not.toBe(true);
        hud!.updateSelection([u1]);
        expect(mini().inert).toBe(true);
        tapOn(dclose());
        expect(mini().inert).toBe(false);
        hud!.reopenDetail();
        hud!.updateSelection([u1]);
        expect(mini().inert).toBe(true);
        hud!.suppressDetail();
        expect(mini().inert).toBe(false);
        hud!.reopenDetail();
        hud!.updateSelection([u2]);
        expect(mini().inert).toBe(true);
        hud!.updateSelection([]);
        expect(mini().inert).toBe(false);
      });

      it('据点详情显示着同样 inert', () => {
        mk();
        hud!.setMobile(true);
        hud!.updateSelection([], site);
        expect(mini().inert).toBe(true);
      });

      it('桌面版详情显示着不 inert；移动版显示着时切到桌面版立刻恢复，切回移动版再设上', () => {
        mk();
        hud!.updateSelection([u1]);
        expect(mini().inert).not.toBe(true);
        hud!.setMobile(true);
        expect(mini().inert).toBe(true);
        hud!.setMobile(false);
        expect(mini().inert).toBe(false);
      });
    });

    describe('详情重画的条件', () => {
      it('单兵：同一单位升级成高级形态（兵种变了）后详情重画', () => {
        mk();
        const t = UNIT_BY_KEY.dao.idx, old = world.type[u1];
        world.type[u1] = t;
        try {
          hud!.updateSelection([u1]);
          expect(dbody().innerHTML).toContain('初级');
          world.type[u1] = UNIT_BY_KEY.dao.elite;
          hud!.updateSelection([u1]);
          expect(dbody().innerHTML).toContain('高级形态');
          expect(dbody().innerHTML).not.toContain('升级需');
        } finally {
          world.type[u1] = old;
        }
      });

      it('单兵：最大生命变了（hp 不变）也重画', () => {
        mk();
        hud!.updateSelection([u1]);
        const before = dbody().innerHTML, old = world.maxHp[u1];
        world.maxHp[u1] = old + 50;
        try {
          hud!.updateSelection([u1]);
          expect(dbody().innerHTML).not.toBe(before);
        } finally {
          world.maxHp[u1] = old;
        }
      });
    });

    describe('营寨详情的选兵一排（.picks）', () => {
      const camps = world.sites.filter(s => s.type === SITE_CAMP && !s.gone);
      const picks = (): FakeEl => dbody().children.find(c => c.classList.contains('picks'))!;
      /** 把营寨暂时改成我方（详情才会有选兵一排）；返回还原函数 */
      const own = (ss: typeof camps): (() => void) => {
        const olds = ss.map(s => [s, s.owner, s.name] as const);
        for (const s of ss) s.owner = world.humanTeam;
        return () => olds.forEach(([s, o, n]) => { s.owner = o; s.name = n; });
      };

      it('同一据点重建详情（内容变了）时保留 .picks 的 scrollLeft', () => {
        expect(camps.length).toBeGreaterThanOrEqual(2);
        const restore = own(camps.slice(0, 2));
        try {
          mk();
          hud!.updateSelection([], camps[0].id);
          picks().scrollLeft = 120;
          camps[0].name += '改';
          hud!.updateSelection([], camps[0].id);
          expect(picks().scrollLeft).toBe(120);
        } finally {
          restore();
        }
      });

      it('换了据点不继承上一个据点的 scrollLeft', () => {
        const restore = own(camps.slice(0, 2));
        try {
          mk();
          hud!.updateSelection([], camps[0].id);
          picks().scrollLeft = 120;
          hud!.updateSelection([], camps[1].id);
          expect(picks().scrollLeft).not.toBe(120);
        } finally {
          restore();
        }
      });
    });

    describe('内容滚回顶部', () => {
      /** 记录对 .dbody 的 scrollTop 赋值，以及赋值时详情是否已显示、内容是否已写入 */
      const watchScroll = (): { v: number; shown: boolean; written: boolean }[] => {
        const writes: { v: number; shown: boolean; written: boolean }[] = [];
        Object.defineProperty(dbody(), 'scrollTop', {
          configurable: true,
          get: () => 0,
          set: (v: number) => writes.push({ v, shown: !detail().hidden, written: dbody().innerHTML.includes('udetail') || dbody().innerHTML.length > 0 }),
        });
        return writes;
      };

      it('第一次显示（从隐藏状态）：scrollTop 归 0，且是在显示并写入内容之后', () => {
        mk();
        const w = watchScroll();
        hud!.updateSelection([u1]);
        expect(w).toEqual([{ v: 0, shown: true, written: true }]);
      });

      it('同一个对象的定时刷新不动 scrollTop', () => {
        mk();
        hud!.updateSelection([u1]);
        const w = watchScroll();
        hud!.updateSelection([u1]);
        hud!.updateSelection([u1]);
        expect(w).toEqual([]);
      });

      it('换了对象（单位换单位、单位换据点）：scrollTop 归 0', () => {
        mk();
        hud!.updateSelection([u1]);
        const w = watchScroll();
        hud!.updateSelection([u2]);
        expect(w.map(x => x.v)).toEqual([0]);
        hud!.updateSelection([], site);
        expect(w.map(x => x.v)).toEqual([0, 0]);
        expect(w.every(x => x.shown && x.written)).toBe(true);
      });

      it('关闭后重新打开（reopenDetail）同一个对象：从隐藏重新显示，scrollTop 归 0', () => {
        mk();
        hud!.updateSelection([u1]);
        tapOn(dclose());
        hud!.reopenDetail();
        const w = watchScroll();
        hud!.updateSelection([u1]);
        expect(w).toEqual([{ v: 0, shown: true, written: true }]);
      });

      it('取消选择后隐藏，再选同一个单位：重新显示，scrollTop 归 0', () => {
        mk();
        hud!.updateSelection([u1]);
        hud!.updateSelection([]);
        expect(detail().hidden).toBe(true);
        const w = watchScroll();
        hud!.updateSelection([u1]);
        expect(w.map(x => x.v)).toEqual([0]);
      });
    });

    describe('单兵详情的兵种标记', () => {
      const withType = (i: number, type: number, f: () => void): void => {
        const old = world.type[i];
        world.type[i] = type;
        try { f(); } finally { world.type[i] = old; }
      };

      it('初级：写「初级<i class="sep"> · </i><em>升级需 N 金</em>」', () => {
        mk();
        const t = UNIT_BY_KEY.dao.idx;
        withType(u1, t, () => {
          hud!.updateSelection([u1]);
          expect(dbody().innerHTML).toContain(`初级<i class="sep"> · </i><em>升级需 ${unitUpgradeCost(UNITS[t])} 金</em>`);
        });
      });

      it('高级形态：写「高级形态」，没有升级需要的金额', () => {
        mk();
        const t = UNIT_BY_KEY.dao.elite;
        withType(u1, t, () => {
          hud!.updateSelection([u1]);
          expect(dbody().innerHTML).toContain('高级形态');
          expect(dbody().innerHTML).not.toContain('升级需');
        });
      });
    });

    it('据点详情同样：关闭后同一据点不再弹出，reopenDetail 后显示，换据点显示', () => {
      mk();
      hud!.updateSelection([], site);
      expect(detail().hidden).toBe(false);
      tapOn(dclose());
      expect(detail().hidden).toBe(true);
      hud!.updateSelection([], site);
      expect(detail().hidden).toBe(true);
      hud!.updateSelection([], site2);
      expect(detail().hidden).toBe(false);
      tapOn(dclose());
      hud!.updateSelection([], site2);
      expect(detail().hidden).toBe(true);
      hud!.reopenDetail();
      hud!.updateSelection([], site2);
      expect(detail().hidden).toBe(false);
    });
  });

  describe('长按卡片的升级菜单', () => {
    const upMenu = (): HudEl => find(x => x.classList.contains('upmenu')) as HudEl;
    /** size 默认至少 1（有人）；0 是「当前没有人」 */
    const choice = (label: string, offer: UpgradeChoice['offer'], total: number, run: () => void = () => {}, need = 0, size = Math.max(total, 1)): UpgradeChoice =>
      ({ label, offer, total, need, size, run });
    /** CardBar 长按卡片时回调的 holdCard（Hud 自己接的那个） */
    const hold = (kind: 'type' | 'group' | 'all', id: number): void => {
      const bar = hud!.cards as unknown as { cb: { holdCard(k: string, i: number, r: unknown): void } };
      bar.cb.holdCard(kind, id, rectOf(100, 500, 60, 100));
    };
    const btnNodes = (): HudEl[] => (upMenu().children as HudEl[]).filter(c => c.tagName === 'button' && c.dataset.i !== undefined);
    const items = (): { i: number; disabled: boolean; label: string; sub: string }[] =>
      btnNodes().map(b => ({ i: Number(b.dataset.i), disabled: b.disabled, label: b.children[0].textContent, sub: b.children[1].textContent }));
    const title = (): string => upMenu().children.find(c => c.tagName === 'h3')?.textContent ?? '';
    /** 菜单里某一项上单独来的 click（detail 默认 1），目标是菜单里真的那个按钮 */
    const clickRaw = (i: number, detail = 1): void => {
      const b = btnNodes().find(x => x.dataset.i === String(i))!;
      const e = new Event('click', { cancelable: true });
      Object.defineProperty(e, 'detail', { value: detail });
      Object.defineProperty(e, 'target', { value: b });
      upMenu().dispatchEvent(e);
    };
    /** 指针按下：派发在框上，target 是按中的元素（默认框本身，即标题 / 空白处）；button 非 0 模拟非主键 */
    const press = (target?: FakeEl, id = 1, button = 0): void =>
      void firePointer(upMenu(), 'pointerdown', { pointerId: id, button }, target ?? btnNodes()[0]);
    /** 按在标题 / 空白处（不是任何项）的 pointerdown */
    const pressTitle = (id = 1): void => void firePointer(upMenu(), 'pointerdown', { pointerId: id }, upMenu().children.find(c => c.tagName === 'h3') ?? upMenu());
    /** window 捕获到的松开（取消用 pointercancel）：松开坐标处的元素是 over（elementFromPoint 的返回），事件目标默认就是它 */
    const release = (id = 1, over: FakeEl | null = upMenu(), target?: FakeEl, type = 'pointerup', button = 0): void => {
      (document as unknown as { elementFromPoint: unknown }).elementFromPoint = () => over;
      firePointer(win as unknown as FakeEl, type, { pointerId: id, clientX: 5, clientY: 5, button }, target ?? over ?? upMenu());
    };
    /** window 捕获到的 pointermove（按着时按坐标判是否出了框，补按别的键也在这里看出来） */
    const moveWin = (id: number, x: number, y: number, buttons = 1): void =>
      void firePointer(win as unknown as FakeEl, 'pointermove', { pointerId: id, clientX: x, clientY: y, buttons }, upMenu());
    /**
     * 点第 i 项：detail 非 0（指针）是按在这一项上、在原处松开，松开瞬间成交，不经过 click；
     * detail 为 0 是键盘 / 读屏激活，只发 click
     */
    const clickItem = (i: number, detail = 1): void => {
      const b = btnNodes().find(x => x.dataset.i === String(i))!;
      if (detail === 0) {
        clickRaw(i, 0);
        return;
      }
      press(b);
      release(1, b);
    };
    /** 升级框上的指针事件：pointerdown / pointerleave 派发在框上；pointerup / pointercancel 走 window 捕获，目标默认在框里，传 target 可模拟落在框外 */
    const pointerEvt = (type: string, id = 1, target?: FakeEl): void => {
      if (type === 'pointerup' || type === 'pointercancel') release(id, target ?? upMenu(), target, type);
      else firePointer(upMenu(), type, { pointerId: id }, type === 'pointerdown' ? btnNodes()[0] : undefined);
    };
    const outside = (): FakeEl => new HudEl();
    const down = (target: FakeEl): void => void firePointer(win as unknown as FakeEl, 'pointerdown', {}, target);

    it('平时收起；长按兵种卡片：用 (type, 兵种 id) 取升级项并弹出，标题是「<兵种名> · 升级」', () => {
      mk();
      expect(upMenu().hidden).toBe(true);
      cb.upgradeChoices.mockReturnValue([choice('升级这些人', { count: 5, cost: 300 }, 5)]);
      hold('type', 3);
      expect(cb.upgradeChoices).toHaveBeenCalledWith('type', 3);
      expect(upMenu().hidden).toBe(false);
      expect(title()).toBe(`${UNITS[3].name} · 升级`);
    });

    it('编队卡片标题「第 g 队 · 升级」，全选卡片「全选 · 升级」，并按各自的 (kind, id) 取升级项', () => {
      mk();
      cb.upgradeChoices.mockReturnValue([choice('升级这些人', { count: 1, cost: 10 }, 1)]);
      hold('group', 2);
      expect(cb.upgradeChoices).toHaveBeenLastCalledWith('group', 2);
      expect(title()).toBe('第 2 队 · 升级');
      hold('all', -1);
      expect(cb.upgradeChoices).toHaveBeenLastCalledWith('all', -1);
      expect(title()).toBe('全选 · 升级');
    });

    it('每项一个按钮：label 写粗体，副行按黄金够升几人写「count 人 · 金 cost」，不够全升写「count / total 人 · 金 cost」', () => {
      mk();
      cb.upgradeChoices.mockReturnValue([
        choice('甲', { count: 5, cost: 300 }, 5),
        choice('乙', { count: 3, cost: 200 }, 8),
      ]);
      hold('type', 3);
      expect(items()).toEqual([
        { i: 0, disabled: false, label: '甲', sub: '5 人 · 金 300' },
        { i: 1, disabled: false, label: '乙', sub: '3 / 8 人 · 金 200' },
      ]);
    });

    it('offer 为 null：按钮 disabled，写「total 人 · 黄金不足，升 1 人需 X」，X 取整；total 为 0：disabled，写「已是高级形态」', () => {
      mk();
      cb.upgradeChoices.mockReturnValue([
        choice('甲', null, 4, () => {}, 37.6),
        choice('乙', null, 0),
        choice('丙', { count: 2, cost: 50 }, 2),
      ]);
      hold('type', 3);
      expect(items()).toEqual([
        { i: 0, disabled: true, label: '甲', sub: '4 人 · 黄金不足，升 1 人需 38' },
        { i: 1, disabled: true, label: '乙', sub: '已是高级形态' },
        { i: 2, disabled: false, label: '丙', sub: '2 人 · 金 50' },
      ]);
    });

    it('所有项 total 都是 0：只显示一句「没有可升级的人（都已是高级形态）」，不放按钮', () => {
      mk();
      cb.upgradeChoices.mockReturnValue([choice('甲', null, 0), choice('乙', null, 0)]);
      hold('type', 3);
      expect(upMenu().hidden).toBe(false);
      expect(upMenu().children.find(c => c.tagName === 'p')!.textContent).toBe('没有可升级的人（都已是高级形态）');
      expect(items()).toEqual([]);
      expect(btnNodes()).toEqual([]);
    });

    it('upgradeChoices 返回空数组：不弹出', () => {
      mk();
      cb.upgradeChoices.mockReturnValue([]);
      hold('type', 3);
      expect(upMenu().hidden).toBe(true);
    });

    it('点一项：调它的 run() 并收起', () => {
      mk();
      const runs = [vi.fn(), vi.fn()];
      cb.upgradeChoices.mockReturnValue([choice('甲', { count: 1, cost: 1 }, 1, runs[0]), choice('乙', { count: 2, cost: 2 }, 2, runs[1])]);
      hold('type', 3);
      clickItem(1);
      expect(runs[0]).not.toHaveBeenCalled();
      expect(runs[1]).toHaveBeenCalledTimes(1);
      expect(upMenu().hidden).toBe(true);
    });

    it('点 disabled 的项不响应：不调 run、不收起', () => {
      mk();
      const run = vi.fn();
      cb.upgradeChoices.mockReturnValue([choice('甲', null, 4, run), choice('乙', { count: 1, cost: 1 }, 1)]);
      hold('type', 3);
      clickItem(0);
      expect(run).not.toHaveBeenCalled();
      expect(upMenu().hidden).toBe(false);
    });

    it('指针 click（detail 非 0）单独来不成交；键盘 / 读屏激活（detail 为 0）的 click 成交并收起', () => {
      mk();
      const run = vi.fn();
      cb.upgradeChoices.mockReturnValue([choice('甲', { count: 1, cost: 1 }, 1, run)]);
      hold('type', 3);
      clickRaw(0, 1);
      clickRaw(0, 2);
      expect(run).not.toHaveBeenCalled();
      expect(upMenu().hidden).toBe(false);
      clickRaw(0, 0);
      expect(run).toHaveBeenCalledTimes(1);
      expect(upMenu().hidden).toBe(true);
    });

    it('键盘激活 disabled 的项不响应', () => {
      mk();
      const run = vi.fn();
      cb.upgradeChoices.mockReturnValue([choice('甲', null, 1, run, 9)]);
      hold('type', 3);
      clickRaw(0, 0);
      expect(run).not.toHaveBeenCalled();
      expect(upMenu().hidden).toBe(false);
    });

    it('再次长按换成新的项：点的是新的项', () => {
      mk();
      const a = vi.fn(), b = vi.fn();
      cb.upgradeChoices.mockReturnValue([choice('甲', { count: 1, cost: 1 }, 1, a)]);
      hold('type', 3);
      cb.upgradeChoices.mockReturnValue([choice('乙', { count: 1, cost: 1 }, 1, b)]);
      hold('group', 1);
      clickItem(0);
      expect(a).not.toHaveBeenCalled();
      expect(b).toHaveBeenCalledTimes(1);
    });

    it('在菜单以外的地方 pointerdown（window 捕获）收起；在菜单里按不收起', () => {
      mk();
      cb.upgradeChoices.mockReturnValue([choice('甲', { count: 1, cost: 1 }, 1)]);
      hold('type', 3);
      const inner = new HudEl('button');
      upMenu().appendChild(inner);
      down(inner);
      expect(upMenu().hidden).toBe(false);
      down(outside());
      expect(upMenu().hidden).toBe(true);
    });

    describe('点在菜单以外收起时的拦截', () => {
      const shown = (): void => {
        cb.upgradeChoices.mockReturnValue([choice('甲', { count: 1, cost: 1 }, 1)]);
        hold('type', 3);
        expect(upMenu().hidden).toBe(false);
      };
      const press = (target: FakeEl): Event => firePointer(win as unknown as FakeEl, 'pointerdown', {}, target);
      const viewCanvas = (): FakeCanvas => {
        const c = new FakeCanvas();
        c.className = 'view';
        return c;
      };

      it('按在画面画布（canvas.view）上：收起，并 stopPropagation + preventDefault', () => {
        mk();
        shown();
        const e = press(viewCanvas());
        expect(upMenu().hidden).toBe(true);
        expect(e.defaultPrevented).toBe(true);
        expect(e.cancelBubble).toBe(true);
      });

      it('按在小地图画布（Hud 的 minimap）上：收起，并 stopPropagation + preventDefault', () => {
        mk();
        shown();
        const e = press(hud!.minimap as unknown as FakeEl);
        expect(upMenu().hidden).toBe(true);
        expect(e.defaultPrevented).toBe(true);
        expect(e.cancelBubble).toBe(true);
      });

      it('按在别的地方（别的卡片、没有 view 类的画布）：收起，但不拦', () => {
        mk();
        for (const t of [new HudEl(), (() => { const c = new FakeCanvas(); c.className = 'other'; return c; })()]) {
          shown();
          const e = press(t);
          expect(upMenu().hidden).toBe(true);
          expect(e.defaultPrevented).toBe(false);
          expect(e.cancelBubble).toBe(false);
        }
      });

      it('菜单已收起时按在画面上不拦', () => {
        mk();
        const e = press(viewCanvas());
        expect(e.defaultPrevented).toBe(false);
        expect(e.cancelBubble).toBe(false);
      });

      it('按在菜单里不拦也不收起', () => {
        mk();
        shown();
        const inner = new HudEl('button');
        upMenu().appendChild(inner);
        const e = press(inner);
        expect(upMenu().hidden).toBe(false);
        expect(e.defaultPrevented).toBe(false);
      });
    });

    describe('弹出位置', () => {
      const place = (): { x: number; y: number } => {
        const m = /^translate\((-?[\d.]+)px, (-?[\d.]+)px\)$/.exec(upMenu().style.transform);
        expect(m, upMenu().style.transform).not.toBeNull();
        return { x: Number(m![1]), y: Number(m![2]) };
      };
      /** 根在 (10, 20)，宽 rootW；弹出框 100 × 60；卡片带上沿 wrapTop；被长按的卡片 left 起、上沿 cardTop；左把手宽 handleW（none = 没有左把手） */
      /** 弹出框的自然高度 natural；有 max-height 时量到的高度是 min(natural, max-height)（假 DOM 不会自己限高） */
      const setMenuHeight = (natural: number): void => {
        Object.defineProperty(upMenu(), 'offsetHeight', {
          configurable: true,
          get: () => {
            const m = parseFloat(upMenu().style.maxHeight);
            return Number.isNaN(m) ? natural : Math.min(natural, m);
          },
        });
      };
      const open = (o: { mobile: boolean; rootW?: number; wrapTop?: number; cardLeft?: number; cardTop?: number; handleW?: number | 'none'; detailTop?: number; detailShown?: boolean; topbarBottom?: number; menuH?: number }): { x: number; y: number } => {
        // 一个用例里要开多次：每次换新的 Hud 与宿主，免得 find 找到上一个的元素
        hud?.destroy();
        host = new HudEl();
        HudEl.strict = false;
        mk();
        hud!.setMobile(o.mobile);
        hud!.root.getBoundingClientRect = () => rectOf(10, 20, o.rootW ?? 390, 800) as unknown as DOMRect;
        const handle = find(x => x.classList.contains('handle') && x.classList.contains('left'))!;
        if (o.handleW === 'none') {
          handle.remove();
          HudEl.strict = true;
        } else handle.rect = rectOf(0, 300, o.handleW ?? 22, 60);
        find(x => x.classList.contains('cardwrap'))!.rect = rectOf(0, o.wrapTop ?? 680, 390, 100);
        if (o.topbarBottom !== undefined) find(x => x.classList.contains('topbar'))!.rect = rectOf(0, 0, 390, o.topbarBottom);
        if (o.detailTop !== undefined) {
          const d = find(x => x.classList.contains('detail'))!;
          d.rect = rectOf(0, o.detailTop, 300, 200);
          d.hidden = !(o.detailShown ?? true);
        }
        upMenu().offsetWidth = 100;
        setMenuHeight(o.menuH ?? 60);
        cb.upgradeChoices.mockReturnValue([choice('甲', { count: 1, cost: 1 }, 1)]);
        const bar = hud!.cards as unknown as { cb: { holdCard(k: string, i: number, r: unknown): void } };
        bar.cb.holdCard('type', 3, rectOf(o.cardLeft ?? 100, o.cardTop ?? 700, 60, 100));
        return place();
      };

      it('移动版：水平居中在卡片上，底边在卡片带上沿之上 8px（不看卡片自己的上沿）', () => {
        expect(open({ mobile: true })).toEqual({ x: 70, y: 680 - 20 - 60 - 8 });
        expect(open({ mobile: true, cardTop: 650 })).toEqual({ x: 70, y: 680 - 20 - 60 - 8 });
      });

      it('移动版：左右夹在 edge = ceil(左把手宽 × 42 / 22) 之内（把手 22 + 向内命中延伸 20，按实际宽度等比）', () => {
        const left = (handleW: number): number => open({ mobile: true, handleW, cardLeft: 0 }).x;
        const right = (handleW: number): number => open({ mobile: true, handleW, cardLeft: 390 }).x;
        expect(left(22)).toBe(42);
        expect(left(20)).toBe(39);
        expect(left(24)).toBe(46);
        expect(right(22)).toBe(390 - 42 - 100);
        expect(right(24)).toBe(390 - 46 - 100);
      });

      it('移动版：edge 跟把手宽度走，不跟根的宽度走', () => {
        expect(open({ mobile: true, rootW: 600, cardLeft: 0 }).x).toBe(42);
        expect(open({ mobile: true, rootW: 300, cardLeft: 0 }).x).toBe(42);
      });

      it('移动版：没有左把手时 edge 为 0', () => {
        expect(open({ mobile: true, handleW: 'none', cardLeft: 0 }).x).toBe(0);
        expect(open({ mobile: true, handleW: 'none', cardLeft: 390 }).x).toBe(390 - 100);
      });

      it('移动版：y 不小于 edge', () => {
        expect(open({ mobile: true, wrapTop: 30 }).y).toBe(42);
        expect(open({ mobile: true, wrapTop: 30, handleW: 24 }).y).toBe(46);
        expect(open({ mobile: true, wrapTop: 30, handleW: 'none' }).y).toBe(0);
      });

      it('移动版：弹出框 maxWidth = 根宽 − 2 × edge；桌面版为空串', () => {
        open({ mobile: true });
        expect(upMenu().style.maxWidth).toBe(`${390 - 2 * 42}px`);
        open({ mobile: true, rootW: 300, handleW: 24 });
        expect(upMenu().style.maxWidth).toBe(`${300 - 2 * 46}px`);
        open({ mobile: true, handleW: 'none' });
        expect(upMenu().style.maxWidth).toBe('390px');
        open({ mobile: false });
        expect(upMenu().style.maxWidth).toBe('');
      });

      it('桌面版详情显示着：底边取卡片上沿与详情上沿的较小者，落在其上 8px（仍不低于 edge 8）', () => {
        expect(open({ mobile: false, detailTop: 600 }).y).toBe(600 - 20 - 60 - 8);
        expect(open({ mobile: false, detailTop: 800 }).y).toBe(700 - 20 - 60 - 8);
        expect(open({ mobile: false, detailTop: 700 }).y).toBe(700 - 20 - 60 - 8);
      });

      const detailEl = (): FakeEl => find(x => x.classList.contains('detail'))!;

      it('桌面版详情放不下（落在它上方会盖住顶栏 / 超出上沿）：详情加 yield 类，升级框只让开卡片', () => {
        expect(open({ mobile: false, detailTop: 40 }).y).toBe(700 - 20 - 60 - 8);
        expect(detailEl().classList.contains('yield')).toBe(true);
      });

      it('放得下时详情不加 yield；详情没显示时也不加', () => {
        open({ mobile: false, detailTop: 600 });
        expect(detailEl().classList.contains('yield')).toBe(false);
        open({ mobile: false, detailTop: 40, detailShown: false });
        expect(detailEl().classList.contains('yield')).toBe(false);
      });

      it('yield 之后升级框收起：yield 去掉', () => {
        open({ mobile: false, detailTop: 40 });
        expect(detailEl().classList.contains('yield')).toBe(true);
        hud!.closeUpgradeMenu();
        expect(detailEl().classList.contains('yield')).toBe(false);
      });

      it('yield 之后再放得下（详情挪到够下面）：下一次 update 去掉 yield，并落在详情上方', () => {
        open({ mobile: false, detailTop: 40 });
        expect(detailEl().classList.contains('yield')).toBe(true);
        detailEl().rect = rectOf(0, 600, 300, 200);
        hud!.update();
        expect(detailEl().classList.contains('yield')).toBe(false);
        expect(place().y).toBe(600 - 20 - 60 - 8);
      });

      it('桌面版上限 = max(8, 顶栏底边 − host.top + 8)：弹出框不盖顶栏', () => {
        expect(open({ mobile: false, cardTop: 40, topbarBottom: 100 }).y).toBe(100 - 20 + 8);
        expect(open({ mobile: false, cardTop: 40, topbarBottom: 0 }).y).toBe(8);
        // 够高时不受上限影响
        expect(open({ mobile: false, topbarBottom: 100 }).y).toBe(700 - 20 - 60 - 8);
      });

      it('放得下的判断也按顶栏上限：详情上方刚好差一点就放不下，yield', () => {
        // 详情 top 200：200 − 20 − 60 − 8 = 112；顶栏底边 120 → 上限 108，放得下
        open({ mobile: false, detailTop: 200, topbarBottom: 120 });
        expect(detailEl().classList.contains('yield')).toBe(false);
        // 顶栏底边 130 → 上限 118 > 112，放不下
        open({ mobile: false, detailTop: 200, topbarBottom: 130 });
        expect(detailEl().classList.contains('yield')).toBe(true);
      });

      describe('桌面矮屏：升级框限高滚动，不盖卡片', () => {
        const maxH = (): string => upMenu().style.maxHeight;

        it('放得下：maxHeight 为空', () => {
          open({ mobile: false });
          expect(maxH()).toBe('');
        });

        it('放不下：maxHeight = 可用高度 room = 基准 − host.top − 8 − 上限，按限高后的高度重新摆（底边仍在基准上方 8px）', () => {
          // 卡片上沿 700：room = 700 − 20 − 8 − 8 = 664
          const r = open({ mobile: false, menuH: 900 });
          expect(maxH()).toBe('664px');
          expect(r.y).toBe(700 - 20 - 664 - 8);
        });

        it('room 不到 64 时 maxHeight 取 64（矮到没有几十像素只好盖上）', () => {
          // 卡片上沿 100：room = 64；上沿 60：room = 24 → 64
          expect(open({ mobile: false, menuH: 200, cardTop: 100 }).y).toBe(8);
          expect(maxH()).toBe('64px');
          open({ mobile: false, menuH: 200, cardTop: 60 });
          expect(maxH()).toBe('64px');
        });

        it('上限按顶栏算：顶栏底边 100 时 room = 700 − 20 − 8 − 88 = 584', () => {
          const r = open({ mobile: false, menuH: 900, topbarBottom: 100 });
          expect(maxH()).toBe('584px');
          expect(r.y).toBe(88);
        });

        it('详情让开了放得下：room 按详情上沿算，够就不限高', () => {
          // 详情 600：600 − 20 − 500 − 8 = 72 ≥ 8，放得下；room = 600 − 20 − 8 − 8 = 564 ≥ 500
          open({ mobile: false, menuH: 500, detailTop: 600 });
          expect(maxH()).toBe('');
          expect(detailEl().classList.contains('yield')).toBe(false);
        });

        it('详情让不开（yield）后按卡片算 room', () => {
          open({ mobile: false, menuH: 900, detailTop: 600 });
          expect(detailEl().classList.contains('yield')).toBe(true);
          expect(maxH()).toBe('664px');
        });

        it('每次摆位先清掉旧的 maxHeight：之后放得下了就为空', () => {
          open({ mobile: false, menuH: 900 });
          expect(maxH()).toBe('664px');
          setMenuHeight(60);
          hud!.update();
          expect(maxH()).toBe('');
          expect(place().y).toBe(700 - 20 - 60 - 8);
        });

        it('限高状态下框内滚动位置在每次 update 重新摆位时不被重置（scrollTop 记下后还原）', () => {
          open({ mobile: false, menuH: 900 });
          expect(maxH()).toBe('664px');
          // 模拟真实浏览器：改 max-height 会让滚动位置被夹回 0
          const st = upMenu().style as unknown as Record<string, string>;
          let mh = st.maxHeight;
          Object.defineProperty(st, 'maxHeight', {
            configurable: true,
            get: () => mh,
            set: (v: string) => {
              mh = v;
              upMenu().scrollTop = 0;
            },
          });
          upMenu().scrollTop = 30;
          hud!.update();
          expect(maxH()).toBe('664px');
          expect(upMenu().scrollTop).toBe(30);
          hud!.update();
          expect(upMenu().scrollTop).toBe(30);
        });

        it('限高后滚到 30：不收起时 update 仍保持 30；收起再长按同一张卡或别的卡重开，滚动位置回到 0', () => {
          open({ mobile: false, menuH: 900 });
          const bar = hud!.cards as unknown as { cb: { holdCard(k: string, i: number, r: unknown): void } };
          upMenu().scrollTop = 30;
          hud!.update();
          hud!.update();
          expect(upMenu().scrollTop).toBe(30);
          hud!.closeUpgradeMenu();
          bar.cb.holdCard('type', 3, rectOf(100, 700, 60, 100));
          expect(upMenu().scrollTop).toBe(0);
          upMenu().scrollTop = 30;
          hud!.closeUpgradeMenu();
          bar.cb.holdCard('type', 5, rectOf(200, 700, 60, 100));
          expect(upMenu().scrollTop).toBe(0);
        });

        describe('阅读位置 upScroll 与露出焦点项', () => {
          /** 模拟真实浏览器：改 max-height 会让框里的滚动位置被夹回 0 */
          const clampOnMaxHeight = (): void => {
            const st = upMenu().style as unknown as Record<string, string>;
            let mh = st.maxHeight;
            Object.defineProperty(st, 'maxHeight', {
              configurable: true,
              get: () => mh,
              set: (v: string) => {
                mh = v;
                upMenu().scrollTop = 0;
              },
            });
          };
          /** 限高的桌面升级框里放 3 项（各 40 高，offsetTop 0 / 400 / 800；可视高度 300），返回三个按钮；之后同形状的 update 是原地刷新，节点不变 */
          const openThree = (): HudEl[] => {
            open({ mobile: false, menuH: 900 });
            cb.upgradeChoices.mockReturnValue([
              choice('甲', { count: 1, cost: 1 }, 1), choice('乙', { count: 1, cost: 2 }, 1), choice('丙', { count: 1, cost: 3 }, 1),
            ]);
            hud!.update();
            Object.assign(upMenu(), { clientHeight: 300, scrollHeight: 900 });
            const bs = btnNodes();
            bs.forEach((b, i) => Object.assign(b, { offsetTop: i * 400, offsetHeight: 40 }));
            clampOnMaxHeight();
            // 真实浏览器里 scrollTop 夹在 [0, 内容高 − 可视高]（这里内容 900、可视 300）
            let st = upMenu().scrollTop;
            Object.defineProperty(upMenu(), 'scrollTop', {
              configurable: true,
              get: () => st,
              set: (v: number) => { st = Math.max(0, Math.min(600, v)); },
            });
            return bs;
          };

          it('限高滚到 30 → 视口变大不限高（scrollTop 被夹为 0）→ 再限高：回到 30', () => {
            open({ mobile: false, menuH: 900 });
            clampOnMaxHeight();
            upMenu().scrollTop = 30;
            hud!.update();
            expect(upMenu().scrollTop).toBe(30);
            setMenuHeight(60);
            hud!.update();
            expect(maxH()).toBe('');
            expect(upMenu().scrollTop).toBe(0);
            hud!.update();
            expect(upMenu().scrollTop).toBe(0);
            setMenuHeight(900);
            hud!.update();
            expect(maxH()).toBe('664px');
            expect(upMenu().scrollTop).toBe(30);
          });

          /** 限高的高度变了（卡片带上移 100，room 变小）：这一次摆位要露出焦点 / 键盘按着的项 */
          const changeLimit = (): void => {
            find(x => x.classList.contains('cardwrap'))!.rect = rectOf(0, 580, 390, 100);
            hud!.update();
            expect(maxH()).toBe('564px');
          };

          it('限高的高度变了、焦点在下方看不见的项：滚到刚好露出它；之后限高不变的 update 不再动，玩家手动滚到哪就是哪', () => {
            const bs = openThree();
            bs[2].focus();
            changeLimit();
            expect(upMenu().scrollTop).toBe(800 + 40 - 300 + 3);
            hud!.update();
            expect(upMenu().scrollTop).toBe(543);
            upMenu().scrollTop = 100;
            hud!.update();
            expect(upMenu().scrollTop).toBe(100);
          });

          it('刚从不限高变成限高：同样露出焦点项', () => {
            const bs = openThree();
            setMenuHeight(60);
            hud!.update();
            expect(maxH()).toBe('');
            setMenuHeight(900);
            bs[2].focus();
            hud!.update();
            expect(maxH()).toBe('664px');
            expect(upMenu().scrollTop).toBe(543);
          });

          it('限高没变的常规 update：焦点在看不见的项也不滚（玩家自己滚着读别的项）', () => {
            const bs = openThree();
            bs[2].focus();
            upMenu().scrollTop = 0;
            hud!.update();
            hud!.update();
            expect(upMenu().scrollTop).toBe(0);
          });

          it('限高变了、焦点在上方滚出去的项：滚回到它的 offsetTop', () => {
            const bs = openThree();
            upMenu().scrollTop = 543;
            bs[1].focus();
            changeLimit();
            expect(upMenu().scrollTop).toBe(400 - 3);
          });

          it('焦点项已在可视范围内：不动', () => {
            const bs = openThree();
            upMenu().scrollTop = 350;
            bs[1].focus();
            changeLimit();
            expect(upMenu().scrollTop).toBe(350);
          });

          it('焦点在弹出框本身或框外：不为它滚动', () => {
            const bs = openThree();
            upMenu().scrollTop = 100;
            upMenu().focus();
            changeLimit();
            expect(upMenu().scrollTop).toBe(100);
            new HudEl().focus();
            find(x => x.classList.contains('cardwrap'))!.rect = rectOf(0, 530, 390, 100);
            hud!.update();
            expect(upMenu().scrollTop).toBe(100);
            expect(bs.length).toBe(3);
          });

          it('键盘按着的项优先于焦点所在的项：限高变了时露出按着的那项', () => {
            const bs = openThree();
            upMenu().scrollTop = 543;
            bs[2].focus();
            const e = new Event('keydown', { cancelable: true });
            Object.defineProperty(e, 'key', { value: ' ' });
            Object.defineProperty(e, 'target', { value: bs[2] });
            upMenu().dispatchEvent(e);
            // 按下时这项在可视范围里，所以这一按算数（设按着）；之后框被滚走、焦点挪到别的项
            upMenu().scrollTop = 0;
            bs[0].focus();
            changeLimit();
            expect(upMenu().scrollTop).toBe(543);
          });

          describe('键盘确认限高下看不见的项：第一下只滚出来', () => {
            let runs: ReturnType<typeof vi.fn>[];
            /** 三项各带 run；同形状的 update 原地换上这三个 run */
            const setupRuns = (): HudEl[] => {
              const bs = openThree();
              runs = [vi.fn(), vi.fn(), vi.fn()];
              cb.upgradeChoices.mockReturnValue([
                choice('甲', { count: 1, cost: 1 }, 1, runs[0]), choice('乙', { count: 1, cost: 2 }, 1, runs[1]), choice('丙', { count: 1, cost: 3 }, 1, runs[2]),
              ]);
              hud!.update();
              return bs;
            };
            const kd = (k: string, target: FakeEl, repeat = false): Event => {
              const e = new Event('keydown', { cancelable: true });
              Object.defineProperty(e, 'key', { value: k });
              Object.defineProperty(e, 'repeat', { value: repeat });
              Object.defineProperty(e, 'target', { value: target });
              const stop = vi.spyOn(e, 'stopPropagation');
              upMenu().dispatchEvent(e);
              Object.defineProperty(e, 'stopped', { value: stop.mock.calls.length > 0 });
              return e;
            };
            const stopped = (e: Event): boolean => (e as unknown as { stopped: boolean }).stopped;
            const ku = (k: string, target: FakeEl): void => {
              const e = new Event('keyup', { cancelable: true });
              Object.defineProperty(e, 'key', { value: k });
              Object.defineProperty(e, 'target', { value: target });
              win.dispatchEvent(e);
            };
            const locked = (): boolean => {
              const n = cb.upgradeChoices.mock.calls.length;
              hud!.update();
              return cb.upgradeChoices.mock.calls.length === n;
            };

            it('Enter：隐藏项上第一下只滚出来（preventDefault + stopPropagation，不设按着、不成交）；第二下照常确认（click detail 0 成交）', () => {
              const bs = setupRuns();
              upMenu().scrollTop = 0;
              const e1 = kd('Enter', bs[2]);
              expect(e1.defaultPrevented).toBe(true);
              expect(stopped(e1)).toBe(true);
              expect(upMenu().scrollTop).toBe(543);
              expect(locked()).toBe(false);
              ku('Enter', bs[2]);
              expect(runs[2]).not.toHaveBeenCalled();
              // 第二下：这一项已露出
              const e2 = kd('Enter', bs[2]);
              expect(e2.defaultPrevented).toBe(false);
              expect(stopped(e2)).toBe(true);
              expect(locked()).toBe(true);
              const c = new Event('click', { cancelable: true });
              Object.defineProperty(c, 'detail', { value: 0 });
              Object.defineProperty(c, 'target', { value: bs[2] });
              upMenu().dispatchEvent(c);
              expect(runs[2]).toHaveBeenCalledTimes(1);
              expect(upMenu().hidden).toBe(true);
            });

            it('空格：隐藏项上第一下 keyup 不成交；第二下 keyup 成交', () => {
              const bs = setupRuns();
              upMenu().scrollTop = 0;
              const e1 = kd(' ', bs[2]);
              expect(e1.defaultPrevented).toBe(true);
              expect(upMenu().scrollTop).toBe(543);
              ku(' ', bs[2]);
              expect(runs[2]).not.toHaveBeenCalled();
              expect(upMenu().hidden).toBe(false);
              kd(' ', bs[2]);
              ku(' ', bs[2]);
              expect(runs[2]).toHaveBeenCalledTimes(1);
              expect(upMenu().hidden).toBe(true);
            });

            it('上方滚出视野的项：第一下滚到它的 offsetTop', () => {
              const bs = setupRuns();
              upMenu().scrollTop = 543;
              const e = kd('Enter', bs[0]);
              expect(e.defaultPrevented).toBe(true);
              expect(upMenu().scrollTop).toBe(0);
              expect(locked()).toBe(false);
            });

            it('只露出一部分也算没整个露出：滚到整个露出', () => {
              const bs = setupRuns();
              upMenu().scrollTop = 520;
              const e = kd('Enter', bs[2]);
              expect(e.defaultPrevented).toBe(true);
              expect(upMenu().scrollTop).toBe(543);
            });

            it('可见的项照常：Enter 不 preventDefault、设按着；空格 preventDefault、设按着', () => {
              const bs = setupRuns();
              upMenu().scrollTop = 543;
              const e = kd('Enter', bs[2]);
              expect(e.defaultPrevented).toBe(false);
              expect(locked()).toBe(true);
              ku('Enter', bs[2]);
              const sp = kd(' ', bs[2]);
              expect(sp.defaultPrevented).toBe(true);
              expect(locked()).toBe(true);
              ku(' ', bs[2]);
              expect(runs[2]).toHaveBeenCalledTimes(1);
            });

            it('隐藏项上 Enter 第一下只滚出，随后自动重复的 Enter keydown 被 preventDefault + stopPropagation：不成交、不设按着、不再滚', () => {
              const bs = setupRuns();
              upMenu().scrollTop = 0;
              kd('Enter', bs[2]);
              expect(upMenu().scrollTop).toBe(543);
              upMenu().scrollTop = 100;
              const r = kd('Enter', bs[2], true);
              expect(r.defaultPrevented).toBe(true);
              expect(stopped(r)).toBe(true);
              expect(upMenu().scrollTop).toBe(100);
              expect(locked()).toBe(false);
              expect(runs[2]).not.toHaveBeenCalled();
              // 重复的 keydown 之后没有 click（被 preventDefault），也没有任何成交
              ku('Enter', bs[2]);
              expect(upMenu().hidden).toBe(false);
            });

            it('没有键盘按着时任何项上的自动重复 keydown（空格 / Enter）都被拦下，不成交、不设按着', () => {
              const bs = setupRuns();
              upMenu().scrollTop = 543;
              for (const k of [' ', 'Enter']) {
                const r = kd(k, bs[2], true);
                expect(r.defaultPrevented, k).toBe(true);
                expect(stopped(r), k).toBe(true);
                expect(locked(), k).toBe(false);
              }
              ku(' ', bs[2]);
              expect(runs[2]).not.toHaveBeenCalled();
            });

            it('有键盘按着时的自动重复行为不变：空格 preventDefault、Enter 不；都 stopPropagation；仍按着、确认对象不变', () => {
              const bs = setupRuns();
              upMenu().scrollTop = 543;
              kd(' ', bs[2]);
              const rs = kd(' ', bs[2], true);
              expect(rs.defaultPrevented).toBe(true);
              expect(stopped(rs)).toBe(true);
              expect(locked()).toBe(true);
              ku(' ', bs[2]);
              expect(runs[2]).toHaveBeenCalledTimes(1);
              hud!.closeUpgradeMenu();
            });

            it('已有键盘按着时的自动重复（Enter 也是）：一律 preventDefault 并 stopPropagation，仍按着', () => {
              const bs = setupRuns();
              upMenu().scrollTop = 543;
              kd('Enter', bs[2]);
              const re = kd('Enter', bs[2], true);
              expect(re.defaultPrevented).toBe(true);
              expect(stopped(re)).toBe(true);
              expect(locked()).toBe(true);
            });

            it('按住空格（可见项）后把框滚走使该项看不见，再按 Enter（非重复）：preventDefault、不成交、仍按着空格；松开 Enter 不结束；松开空格按原项成交', () => {
              const bs = setupRuns();
              upMenu().scrollTop = 543;
              kd(' ', bs[2]);
              upMenu().scrollTop = 0;
              const en = kd('Enter', bs[2]);
              expect(en.defaultPrevented).toBe(true);
              expect(stopped(en)).toBe(true);
              expect(runs[2]).not.toHaveBeenCalled();
              expect(locked()).toBe(true);
              // 确认对象与启动键没变：这一下不滚出、不改
              expect(upMenu().scrollTop).toBe(0);
              ku('Enter', bs[2]);
              expect(locked()).toBe(true);
              expect(runs[2]).not.toHaveBeenCalled();
              expect(upMenu().hidden).toBe(false);
              ku(' ', bs[2]);
              expect(runs[2]).toHaveBeenCalledTimes(1);
              expect(runs.slice(0, 2).every(r => !r.mock.calls.length)).toBe(true);
              expect(upMenu().hidden).toBe(true);
            });

            it('按着 Enter 时再按空格（非重复）同样 preventDefault 且不改启动键与确认对象：空格 keyup 不结束，Enter keyup 才结束', () => {
              const bs = setupRuns();
              upMenu().scrollTop = 543;
              kd('Enter', bs[2]);
              const sp = kd(' ', bs[1]);
              expect(sp.defaultPrevented).toBe(true);
              ku(' ', bs[1]);
              expect(locked()).toBe(true);
              expect(runs[1]).not.toHaveBeenCalled();
              ku('Enter', bs[2]);
              expect(locked()).toBe(false);
            });

            it('之前没按着时只有空格 preventDefault（Enter 靠原生激活）', () => {
              const bs = setupRuns();
              upMenu().scrollTop = 543;
              expect(kd('Enter', bs[2]).defaultPrevented).toBe(false);
              ku('Enter', bs[2]);
              expect(kd(' ', bs[2]).defaultPrevented).toBe(true);
            });

            it('离下边不到 3px（差 1px）的项：第一下只滚出来', () => {
              const bs = setupRuns();
              upMenu().scrollTop = 542;
              const e = kd('Enter', bs[2]);
              expect(e.defaultPrevented).toBe(true);
              expect(upMenu().scrollTop).toBe(543);
              expect(locked()).toBe(false);
            });

            it('离上边不到 3px（差 1px）的项：第一下只滚出来', () => {
              const bs = setupRuns();
              upMenu().scrollTop = 399;
              const e = kd('Enter', bs[1]);
              expect(e.defaultPrevented).toBe(true);
              expect(upMenu().scrollTop).toBe(397);
            });

            it('刚好留够 3px 的项算露出：照常确认', () => {
              const bs = setupRuns();
              upMenu().scrollTop = 543;
              expect(kd('Enter', bs[2]).defaultPrevented).toBe(false);
              expect(locked()).toBe(true);
              ku('Enter', bs[2]);
              upMenu().scrollTop = 397;
              expect(kd('Enter', bs[1]).defaultPrevented).toBe(false);
            });

            it('第一项上方不足 3px 但已滚到 0：视为露出，照常确认', () => {
              const bs = setupRuns();
              upMenu().scrollTop = 0;
              const e = kd('Enter', bs[0]);
              expect(e.defaultPrevented).toBe(false);
              expect(locked()).toBe(true);
            });

            it('最后一项下方不足 3px 但已到 maxScroll（内容高 − 可视高）：视为露出，照常确认', () => {
              const bs = setupRuns();
              Object.assign(bs[2], { offsetTop: 858, offsetHeight: 40 });
              upMenu().scrollTop = 600;
              const e = kd('Enter', bs[2]);
              expect(e.defaultPrevented).toBe(false);
              expect(locked()).toBe(true);
            });

            it('最后一项没滚到底时仍要滚：目标夹在 maxScroll', () => {
              const bs = setupRuns();
              Object.assign(bs[2], { offsetTop: 858, offsetHeight: 40 });
              upMenu().scrollTop = 560;
              const e = kd('Enter', bs[2]);
              expect(e.defaultPrevented).toBe(true);
              expect(upMenu().scrollTop).toBe(600);
            });

            it('限高时 ↓ / ↑：scrollTop ± 40，preventDefault + stopPropagation（不交给游戏挪镜头），记进阅读位置（之后 update 保持）', () => {
              const bs = setupRuns();
              upMenu().scrollTop = 0;
              const d1 = kd('ArrowDown', bs[0]);
              expect(d1.defaultPrevented).toBe(true);
              expect(stopped(d1)).toBe(true);
              expect(upMenu().scrollTop).toBe(40);
              kd('ArrowDown', bs[0]);
              expect(upMenu().scrollTop).toBe(80);
              const u = kd('ArrowUp', bs[0]);
              expect(u.defaultPrevented).toBe(true);
              expect(stopped(u)).toBe(true);
              expect(upMenu().scrollTop).toBe(40);
              hud!.update();
              hud!.update();
              expect(upMenu().scrollTop).toBe(40);
              // 框的目标是弹出框本身时也一样
              kd('ArrowDown', upMenu());
              expect(upMenu().scrollTop).toBe(80);
            });

            it('↑ 在顶、↓ 在底：夹住不越界', () => {
              const bs = setupRuns();
              upMenu().scrollTop = 0;
              kd('ArrowUp', bs[0]);
              expect(upMenu().scrollTop).toBe(0);
              upMenu().scrollTop = 600;
              kd('ArrowDown', bs[0]);
              expect(upMenu().scrollTop).toBe(600);
            });

            it('没限高时 ↓ / ↑ 不拦：不 preventDefault、照常冒泡，也不滚', () => {
              const bs = setupRuns();
              setMenuHeight(60);
              hud!.update();
              expect(maxH()).toBe('');
              for (const k of ['ArrowDown', 'ArrowUp']) {
                const e = kd(k, bs[0]);
                expect(e.defaultPrevented, k).toBe(false);
                expect(stopped(e), k).toBe(false);
              }
              expect(upMenu().scrollTop).toBe(0);
            });

            it('露出一项时多留 3px：下方越界滚到 底边 − 可视高度 + 3；上方越界滚到 offsetTop − 3', () => {
              const bs = setupRuns();
              upMenu().scrollTop = 0;
              kd('Enter', bs[2]);
              expect(upMenu().scrollTop).toBe(840 - 300 + 3);
              kd('Enter', bs[1]);
              expect(upMenu().scrollTop).toBe(400 - 3);
            });

            it('未限高照常：不检查是否露出，一按就确认', () => {
              const bs = setupRuns();
              setMenuHeight(60);
              hud!.update();
              expect(maxH()).toBe('');
              const e = kd(' ', bs[2]);
              expect(e.defaultPrevented).toBe(true);
              expect(upMenu().scrollTop).toBe(0);
              ku(' ', bs[2]);
              expect(runs[2]).toHaveBeenCalledTimes(1);
            });
          });

          it('新弹出归零：收起再长按，scrollTop 与记下的阅读位置都回到 0（之后 update 不再滚回去）', () => {
            const bs = openThree();
            bs[2].focus();
            changeLimit();
            expect(upMenu().scrollTop).toBe(543);
            hud!.closeUpgradeMenu();
            const bar = hud!.cards as unknown as { cb: { holdCard(k: string, i: number, r: unknown): void } };
            cb.upgradeChoices.mockReturnValue([
              choice('甲', { count: 1, cost: 1 }, 1), choice('乙', { count: 1, cost: 2 }, 1), choice('丙', { count: 1, cost: 3 }, 1),
            ]);
            bar.cb.holdCard('type', 3, rectOf(100, 700, 60, 100));
            expect(upMenu().scrollTop).toBe(0);
            hud!.update();
            expect(upMenu().scrollTop).toBe(0);
          });
        });

        it('没收起就再长按（重新弹出）：同样从顶上开始', () => {
          open({ mobile: false, menuH: 900 });
          const bar = hud!.cards as unknown as { cb: { holdCard(k: string, i: number, r: unknown): void } };
          upMenu().scrollTop = 30;
          bar.cb.holdCard('type', 3, rectOf(100, 700, 60, 100));
          expect(upMenu().scrollTop).toBe(0);
        });

        it('移动版不设 maxHeight', () => {
          open({ mobile: true, menuH: 900 });
          expect(maxH()).toBe('');
        });
      });

      it('移动版：上限仍是 edge，不碰 yield', () => {
        expect(open({ mobile: true, wrapTop: 30, topbarBottom: 100 }).y).toBe(42);
        open({ mobile: true, detailTop: 40 });
        expect(detailEl().classList.contains('yield')).toBe(false);
      });

      it('桌面版详情没显示：照旧按卡片上沿（详情的位置不管）', () => {
        expect(open({ mobile: false, detailTop: 600, detailShown: false }).y).toBe(700 - 20 - 60 - 8);
      });

      it('移动版不看详情：照旧按卡片带上沿', () => {
        expect(open({ mobile: true, detailTop: 300 }).y).toBe(680 - 20 - 60 - 8);
      });

      it('桌面版：底边在被按的卡片上沿之上 8px（不看卡片带），左右 edge 是 8', () => {
        expect(open({ mobile: false })).toEqual({ x: 70, y: 700 - 20 - 60 - 8 });
        expect(open({ mobile: false, wrapTop: 650 }).y).toBe(700 - 20 - 60 - 8);
        expect(open({ mobile: false, cardLeft: 0 }).x).toBe(8);
        expect(open({ mobile: false, cardLeft: 390 }).x).toBe(390 - 8 - 100);
        expect(open({ mobile: false, cardTop: 40 }).y).toBe(8);
      });
    });

    describe('开着时随 update() 刷新', () => {
      it('每次 update() 重新调 upgradeChoices，内容更新；点一项用的是最近一次刷新后的列表', () => {
        mk();
        const a = vi.fn(), b = vi.fn();
        cb.upgradeChoices.mockReturnValue([choice('甲', { count: 1, cost: 10 }, 1, a)]);
        hold('type', 3);
        const n = cb.upgradeChoices.mock.calls.length;
        cb.upgradeChoices.mockReturnValue([choice('乙', { count: 2, cost: 20 }, 3, b)]);
        hud!.update();
        expect(cb.upgradeChoices.mock.calls.length).toBe(n + 1);
        expect(cb.upgradeChoices).toHaveBeenLastCalledWith('type', 3);
        expect(items()).toEqual([{ i: 0, disabled: false, label: '乙', sub: '2 / 3 人 · 金 20' }]);
        clickItem(0);
        expect(a).not.toHaveBeenCalled();
        expect(b).toHaveBeenCalledTimes(1);
      });

      it('内容没变时不重写 innerHTML；只是人数、金额变了：原地改字与可用状态，按钮节点不变；各项变了才重建', () => {
        mk();
        cb.upgradeChoices.mockReturnValue([choice('甲', { count: 1, cost: 10 }, 1)]);
        hold('type', 3);
        const before = btnNodes()[0];
        let html = upMenu().innerHTML, writes = 0;
        Object.defineProperty(upMenu(), 'innerHTML', { configurable: true, get: () => html, set: (v: string) => { writes++; html = v; } });
        hud!.update();
        hud!.update();
        expect(writes).toBe(0);
        cb.upgradeChoices.mockReturnValue([choice('甲', { count: 1, cost: 11 }, 1)]);
        hud!.update();
        expect(writes).toBe(0);
        expect(btnNodes()[0]).toBe(before);
        expect(items()[0].sub).toBe('1 人 · 金 11');
        cb.upgradeChoices.mockReturnValue([choice('乙', { count: 1, cost: 11 }, 1)]);
        hud!.update();
        expect(writes).toBe(1);
      });

      it('每次刷新重新摆位置：弹出框宽度变了位置跟着变', () => {
        mk();
        hud!.root.getBoundingClientRect = () => rectOf(0, 0, 390, 800) as unknown as DOMRect;
        upMenu().offsetWidth = 100;
        cb.upgradeChoices.mockReturnValue([choice('甲', { count: 1, cost: 10 }, 1)]);
        hold('type', 3);
        // 桌面版：水平居中在卡片（left 100、宽 60）上
        expect(upMenu().style.transform).toMatch(/^translate\(80px, /);
        upMenu().offsetWidth = 120;
        hud!.update();
        expect(upMenu().style.transform).toMatch(/^translate\(70px, /);
      });

      describe('手指按在弹出框上期间不刷新', () => {
        const press = (type: 'pointerdown' | 'pointerup' | 'pointercancel' | 'pointerleave'): void => pointerEvt(type);
        const setup = (): void => {
          mk();
          hud!.root.getBoundingClientRect = () => rectOf(0, 0, 390, 800) as unknown as DOMRect;
          upMenu().offsetWidth = 100;
          cb.upgradeChoices.mockReturnValue([choice('甲', { count: 1, cost: 10 }, 1)]);
          hold('type', 3);
        };

        it('按下后、抬起前 update() 不重新取项、不改内容与位置；抬起后的下一次 update 照常刷新', () => {
          setup();
          const n = cb.upgradeChoices.mock.calls.length, at = upMenu().style.transform;
          press('pointerdown');
          cb.upgradeChoices.mockReturnValue([choice('乙', { count: 2, cost: 20 }, 2)]);
          upMenu().offsetWidth = 120;
          hud!.update();
          hud!.update();
          expect(cb.upgradeChoices.mock.calls.length).toBe(n);
          expect(items().map(x => x.label)).toEqual(['甲']);
          expect(upMenu().style.transform).toBe(at);
          press('pointerup');
          hud!.update();
          expect(items().map(x => x.label)).toEqual(['乙']);
          expect(upMenu().style.transform).not.toBe(at);
        });

        it.each(['pointercancel', 'pointerleave'] as const)('%s 也算按完了：之后的 update 照常刷新', t => {
          setup();
          press('pointerdown');
          cb.upgradeChoices.mockReturnValue([choice('乙', { count: 2, cost: 20 }, 2)]);
          hud!.update();
          expect(items().map(x => x.label)).toEqual(['甲']);
          press(t);
          hud!.update();
          expect(items().map(x => x.label)).toEqual(['乙']);
        });

        it('按着时收起会清掉按住状态：再次弹出后 update 照常刷新', () => {
          setup();
          press('pointerdown');
          hud!.closeUpgradeMenu();
          hold('type', 3);
          cb.upgradeChoices.mockReturnValue([choice('乙', { count: 2, cost: 20 }, 2)]);
          hud!.update();
          expect(items().map(x => x.label)).toEqual(['乙']);
        });
      });

      it('upgradeChoices 返回空数组时收起，之后不再自己弹出', () => {
        mk();
        cb.upgradeChoices.mockReturnValue([choice('甲', { count: 1, cost: 10 }, 1)]);
        hold('type', 3);
        cb.upgradeChoices.mockReturnValue([]);
        hud!.update();
        expect(upMenu().hidden).toBe(true);
        cb.upgradeChoices.mockReturnValue([choice('甲', { count: 1, cost: 10 }, 1)]);
        hud!.update();
        expect(upMenu().hidden).toBe(true);
      });

      it('菜单没开 / 已收起时 update() 不调 upgradeChoices', () => {
        mk();
        hud!.update();
        expect(cb.upgradeChoices).not.toHaveBeenCalled();
        cb.upgradeChoices.mockReturnValue([choice('甲', { count: 1, cost: 10 }, 1)]);
        hold('type', 3);
        hud!.closeUpgradeMenu();
        const n = cb.upgradeChoices.mock.calls.length;
        hud!.update();
        expect(cb.upgradeChoices.mock.calls.length).toBe(n);
        expect(upMenu().hidden).toBe(true);
      });
    });

    describe('size：当前没有人 / 已是高级形态', () => {
      it('size 为 0：按钮 disabled，副行写「当前没有人」；size > 0 且 total 为 0 写「已是高级形态」', () => {
        mk();
        cb.upgradeChoices.mockReturnValue([choice('甲', null, 0, () => {}, 0, 0), choice('乙', null, 0, () => {}, 0, 3), choice('丙', { count: 1, cost: 5 }, 1)]);
        hold('type', 3);
        expect(items()).toEqual([
          { i: 0, disabled: true, label: '甲', sub: '当前没有人' },
          { i: 1, disabled: true, label: '乙', sub: '已是高级形态' },
          { i: 2, disabled: false, label: '丙', sub: '1 人 · 金 5' },
        ]);
      });

      it('「没有可升级的人」那句只在所有项 total 为 0 且 size > 0 时出现', () => {
        mk();
        cb.upgradeChoices.mockReturnValue([choice('甲', null, 0, () => {}, 0, 2), choice('乙', null, 0, () => {}, 0, 4)]);
        hold('type', 3);
        expect(upMenu().children.some(c => c.tagName === 'p')).toBe(true);
        expect(btnNodes()).toEqual([]);
        // 有一项 size 为 0：不出现这句，按钮都放出来
        cb.upgradeChoices.mockReturnValue([choice('甲', null, 0, () => {}, 0, 0), choice('乙', null, 0, () => {}, 0, 4)]);
        hud!.update();
        expect(upMenu().children.some(c => c.tagName === 'p')).toBe(false);
        expect(items().map(x => x.sub)).toEqual(['当前没有人', '已是高级形态']);
      });

      it('所有项 size 都是 0：显示按钮「当前没有人」，不是那句话', () => {
        mk();
        cb.upgradeChoices.mockReturnValue([choice('甲', null, 0, () => {}, 0, 0)]);
        hold('type', 3);
        expect(upMenu().children.some(c => c.tagName === 'p')).toBe(false);
        expect(items()).toEqual([{ i: 0, disabled: true, label: '甲', sub: '当前没有人' }]);
      });
    });

    describe('键盘与焦点', () => {
      const key = (type: 'keydown' | 'keyup', k: string, target: FakeEl, repeat = false): { e: Event; stopped: boolean } => {
        const e = new Event(type, { cancelable: true });
        Object.defineProperty(e, 'key', { value: k });
        Object.defineProperty(e, 'repeat', { value: repeat });
        Object.defineProperty(e, 'target', { value: target });
        const stop = vi.spyOn(e, 'stopPropagation');
        // keydown 派发在框上；空格 / Enter 的 keyup 由 window 捕获（不论焦点此时在哪），目标是 target
        (type === 'keyup' ? win : upMenu()).dispatchEvent(e);
        return { e, stopped: stop.mock.calls.length > 0 };
      };
      /** window 捕获阶段的 keydown（Tab 取消键盘确认） */
      const winKeyDown = (k: string, shiftKey = false): void => {
        const e = new Event('keydown', { cancelable: true });
        Object.defineProperty(e, 'key', { value: k });
        Object.defineProperty(e, 'shiftKey', { value: shiftKey });
        win.dispatchEvent(e);
      };
      const active = (): unknown => (document as unknown as { activeElement: unknown }).activeElement;
      const two = (): UpgradeChoice[] => [choice('甲', { count: 1, cost: 10 }, 1), choice('乙', { count: 2, cost: 20 }, 2)];
      /** 一个用例里要开多次：每次换新的 Hud 与宿主，免得 find 找到上一个的元素 */
      const setup = (): void => {
        hud?.destroy();
        host = new HudEl();
        mk();
        cb.upgradeChoices.mockReturnValue(two());
        hold('type', 3);
      };

      it('弹出框 tabIndex 是 -1', () => {
        mk();
        expect((upMenu() as unknown as { tabIndex: number }).tabIndex).toBe(-1);
      });

      it('空格 / Enter keydown 在按钮上：设「按着」并 stopPropagation；空格 preventDefault（激活自己做），Enter 不 preventDefault；update 期间不刷新', () => {
        for (const k of [' ', 'Enter']) {
          setup();
          const { e, stopped } = key('keydown', k, btnNodes()[0]);
          expect(stopped, k).toBe(true);
          expect(e.defaultPrevented, k).toBe(k === ' ');
          const n = cb.upgradeChoices.mock.calls.length;
          cb.upgradeChoices.mockReturnValue([choice('甲', { count: 1, cost: 99 }, 1), choice('乙', { count: 2, cost: 20 }, 2)]);
          hud!.update();
          expect(cb.upgradeChoices.mock.calls.length, k).toBe(n);
          expect(items()[0].sub, k).toBe('1 人 · 金 10');
        }
      });

      it('Enter keyup：放开锁，update 照常刷新，不成交（原生按下即激活，走 click）', () => {
        setup();
        key('keydown', 'Enter', btnNodes()[0]);
        key('keyup', 'Enter', btnNodes()[0]);
        cb.upgradeChoices.mockReturnValue([choice('甲', { count: 1, cost: 99 }, 1), choice('乙', { count: 2, cost: 20 }, 2)]);
        hud!.update();
        expect(items()[0].sub).toBe('1 人 · 金 99');
        expect(upMenu().hidden).toBe(false);
      });

      describe('空格在 keyup 时直接成交', () => {
        const runs = (): ReturnType<typeof vi.fn>[] => runList;
        let runList: ReturnType<typeof vi.fn>[] = [];
        const setupRuns = (): void => {
          hud?.destroy();
          host = new HudEl();
          mk();
          runList = [vi.fn(), vi.fn()];
          cb.upgradeChoices.mockReturnValue([choice('甲', { count: 1, cost: 10 }, 1, runList[0]), choice('乙', { count: 2, cost: 20 }, 2, runList[1])]);
          hold('type', 3);
        };

        it('按着的那一项 run 并收起，别的项不调', () => {
          setupRuns();
          key('keydown', ' ', btnNodes()[1]);
          expect(runs()[1]).not.toHaveBeenCalled();
          key('keyup', ' ', btnNodes()[1]);
          expect(runs()[1]).toHaveBeenCalledTimes(1);
          expect(runs()[0]).not.toHaveBeenCalled();
          expect(upMenu().hidden).toBe(true);
        });

        it('keyup 成交后浏览器若再派发 click（detail 0）也不重复成交（框已收起）', () => {
          setupRuns();
          key('keydown', ' ', btnNodes()[0]);
          key('keyup', ' ', btnNodes()[0]);
          const b = btnNodes()[0];
          const e = new Event('click', { cancelable: true });
          Object.defineProperty(e, 'detail', { value: 0 });
          Object.defineProperty(e, 'target', { value: b });
          upMenu().dispatchEvent(e);
          expect(runs()[0]).toHaveBeenCalledTimes(1);
        });

        it('keydown 是重复的（repeat）不设按着：之后 keyup 不成交', () => {
          setupRuns();
          key('keydown', ' ', btnNodes()[0], true);
          key('keyup', ' ', btnNodes()[0]);
          expect(runs()[0]).not.toHaveBeenCalled();
          expect(upMenu().hidden).toBe(false);
        });

        it('之前没有按着（焦点是空格按下后才进来的）：keyup 不成交', () => {
          setupRuns();
          key('keyup', ' ', btnNodes()[0]);
          expect(runs()[0]).not.toHaveBeenCalled();
          expect(upMenu().hidden).toBe(false);
        });

        it('按钮已 disabled：keyup 不成交', () => {
          setupRuns();
          key('keydown', ' ', btnNodes()[0]);
          btnNodes()[0].disabled = true;
          key('keyup', ' ', btnNodes()[0]);
          expect(runs()[0]).not.toHaveBeenCalled();
          expect(upMenu().hidden).toBe(false);
        });

        it('目标是弹出框本身：keyup 不成交', () => {
          setupRuns();
          key('keydown', ' ', upMenu());
          key('keyup', ' ', upMenu());
          expect(runs()[0]).not.toHaveBeenCalled();
          expect(runs()[1]).not.toHaveBeenCalled();
        });
      });

      it('空格 / Enter：目标是弹出框本身时 preventDefault 并 stopPropagation', () => {
        setup();
        for (const k of [' ', 'Enter']) {
          const { e, stopped } = key('keydown', k, upMenu());
          expect(e.defaultPrevented, k).toBe(true);
          expect(stopped, k).toBe(true);
        }
      });

      it('别的键不拦、不设按着', () => {
        setup();
        const { e, stopped } = key('keydown', 'a', btnNodes()[0]);
        expect(stopped).toBe(false);
        expect(e.defaultPrevented).toBe(false);
        cb.upgradeChoices.mockReturnValue([choice('甲', { count: 1, cost: 99 }, 1), choice('乙', { count: 2, cost: 20 }, 2)]);
        hud!.update();
        expect(items()[0].sub).toBe('1 人 · 金 99');
      });

      describe('Tab 取消与 window blur', () => {
        const refreshes = (): boolean => {
          cb.upgradeChoices.mockReturnValue([choice('甲', { count: 1, cost: 77 }, 1, run0), choice('乙', { count: 2, cost: 20 }, 2, run1)]);
          hud!.update();
          return items()[0].sub === '1 人 · 金 77';
        };
        let run0: ReturnType<typeof vi.fn>, run1: ReturnType<typeof vi.fn>;
        const setupTwo = (): void => {
          hud?.destroy();
          host = new HudEl();
          mk();
          run0 = vi.fn();
          run1 = vi.fn();
          cb.upgradeChoices.mockReturnValue([choice('甲', { count: 1, cost: 10 }, 1, run0), choice('乙', { count: 2, cost: 20 }, 2, run1)]);
          hold('type', 3);
        };

        it('按着时按 Tab（含 Shift+Tab）：取消这一按、放开锁（update 刷新）；焦点移动不受影响', () => {
          for (const shift of [false, true]) {
            setupTwo();
            key('keydown', ' ', btnNodes()[0]);
            winKeyDown('Tab', shift);
            expect(refreshes(), `shift ${shift}`).toBe(true);
          }
        });

        it('按住空格后 Tab 到另一项再松开：不成交，也不买另一项', () => {
          setupTwo();
          btnNodes()[0].focus();
          key('keydown', ' ', btnNodes()[0]);
          winKeyDown('Tab');
          btnNodes()[1].focus();
          key('keyup', ' ', btnNodes()[1]);
          expect(run0).not.toHaveBeenCalled();
          expect(run1).not.toHaveBeenCalled();
          expect(upMenu().hidden).toBe(false);
        });

        it('Tab 之后在新焦点的那一项上重新按空格 / 松开：按那一项成交', () => {
          setupTwo();
          key('keydown', ' ', btnNodes()[0]);
          winKeyDown('Tab');
          key('keydown', ' ', btnNodes()[1]);
          key('keyup', ' ', btnNodes()[1]);
          expect(run1).toHaveBeenCalledTimes(1);
          expect(run0).not.toHaveBeenCalled();
        });

        it('没按着时按 Tab 什么也不发生', () => {
          setupTwo();
          winKeyDown('Tab');
          expect(upMenu().hidden).toBe(false);
          expect(refreshes()).toBe(true);
        });

        it('window blur 清按着与确认对象：之后的空格 keyup 不成交', () => {
          setupTwo();
          key('keydown', ' ', btnNodes()[0]);
          win.dispatchEvent(new Event('blur'));
          expect(refreshes()).toBe(true);
          key('keyup', ' ', btnNodes()[0]);
          expect(run0).not.toHaveBeenCalled();
        });

        it('收起清按着与确认对象：再弹出后的空格 keyup 不成交', () => {
          setupTwo();
          key('keydown', ' ', btnNodes()[0]);
          hud!.closeUpgradeMenu();
          cb.upgradeChoices.mockReturnValue([choice('甲', { count: 1, cost: 10 }, 1, run0)]);
          hold('type', 3);
          key('keyup', ' ', btnNodes()[0]);
          expect(run0).not.toHaveBeenCalled();
        });

        it('已按着时又来的（非重复）空格 keydown 不改确认对象：松开仍按最初那一项', () => {
          setupTwo();
          key('keydown', ' ', btnNodes()[0]);
          key('keydown', ' ', btnNodes()[1]);
          key('keyup', ' ', btnNodes()[1]);
          expect(run0).toHaveBeenCalledTimes(1);
          expect(run1).not.toHaveBeenCalled();
        });

        it('别的键的 keyup 不管：按着还在', () => {
          setupTwo();
          key('keydown', ' ', btnNodes()[0]);
          key('keyup', 'a', btnNodes()[0]);
          expect(refreshes()).toBe(false);
        });

        it('只有启动这次确认的那个键松开才结束它：先按住 Enter、后来空格松开的 keyup 不清按着、不成交', () => {
          setupTwo();
          key('keydown', 'Enter', btnNodes()[0]);
          key('keyup', ' ', btnNodes()[0]);
          expect(refreshes()).toBe(false);
          expect(run0).not.toHaveBeenCalled();
          expect(upMenu().hidden).toBe(false);
          key('keyup', 'Enter', btnNodes()[0]);
          expect(refreshes()).toBe(true);
        });

        it('按住空格期间 Enter 的 keyup 不管；空格松开才成交', () => {
          setupTwo();
          key('keydown', ' ', btnNodes()[0]);
          key('keyup', 'Enter', btnNodes()[0]);
          expect(refreshes()).toBe(false);
          expect(run0).not.toHaveBeenCalled();
          key('keyup', ' ', btnNodes()[0]);
          expect(run0).toHaveBeenCalledTimes(1);
        });

        it('已按着 Enter 时又按下空格（非重复）：不改启动键，空格 keyup 不结束，Enter keyup 才结束', () => {
          setupTwo();
          key('keydown', 'Enter', btnNodes()[0]);
          key('keydown', ' ', btnNodes()[1]);
          key('keyup', ' ', btnNodes()[1]);
          expect(run1).not.toHaveBeenCalled();
          expect(refreshes()).toBe(false);
          key('keyup', 'Enter', btnNodes()[0]);
          expect(refreshes()).toBe(true);
          expect(run0).not.toHaveBeenCalled();
        });

        it('keyup 的目标不论落在哪（画面、别的项）都按确认对象成交', () => {
          setupTwo();
          key('keydown', ' ', btnNodes()[0]);
          key('keyup', ' ', new HudEl());
          expect(run0).toHaveBeenCalledTimes(1);
          expect(run1).not.toHaveBeenCalled();
          expect(upMenu().hidden).toBe(true);
        });

        it('按住空格后鼠标在别的项按下、移出取消：松开空格仍按原项成交', () => {
          setupTwo();
          const [b0, b1] = btnNodes();
          key('keydown', ' ', b0);
          press(b1, 1);
          firePointer(upMenu(), 'pointerleave', { pointerId: 1 });
          release(1, null, new HudEl());
          expect(upMenu().hidden).toBe(false);
          key('keyup', ' ', b1);
          expect(run0).toHaveBeenCalledTimes(1);
          expect(run1).not.toHaveBeenCalled();
        });

        it('键鼠同时持锁：键盘先松开 → 按键盘的项成交并收起，之后指针松开不再成交', () => {
          setupTwo();
          const [b0, b1] = btnNodes();
          key('keydown', ' ', b0);
          press(b1, 1);
          key('keyup', ' ', b0);
          expect(run0).toHaveBeenCalledTimes(1);
          release(1, b1);
          expect(run1).not.toHaveBeenCalled();
        });

        it('键鼠同时持锁：指针先松开 → 按指针的项成交并收起，之后空格松开不再成交', () => {
          setupTwo();
          const [b0, b1] = btnNodes();
          key('keydown', ' ', b0);
          press(b1, 1);
          release(1, b1);
          expect(run1).toHaveBeenCalledTimes(1);
          key('keyup', ' ', b0);
          expect(run0).not.toHaveBeenCalled();
        });
      });

      describe('按着拆成键盘与指针两个状态，任一为真都不刷新', () => {
        /** 换个报价后 update：刷新了返回 true */
        let cost = 10;
        const refreshed = (): boolean => {
          cost += 1;
          cb.upgradeChoices.mockReturnValue([choice('甲', { count: 1, cost }, 1), choice('乙', { count: 2, cost: 20 }, 2)]);
          hud!.update();
          return items()[0].sub === `1 人 · 金 ${cost}`;
        };
        const ptr = (type: string): void => pointerEvt(type);
        const focusout = (related: FakeEl | null): void => {
          const e = new Event('focusout');
          Object.defineProperty(e, 'relatedTarget', { value: related });
          upMenu().dispatchEvent(e);
        };
        const kbdDown = (): void => void key('keydown', 'Enter', btnNodes()[0]);
        const kbdUp = (): void => void key('keyup', 'Enter', btnNodes()[0]);
        beforeEach(() => {
          cost = 10;
          setup();
        });

        it('键盘按着时指针事件（pointerup / pointercancel / pointerleave）不解锁', () => {
          kbdDown();
          for (const t of ['pointerup', 'pointercancel', 'pointerleave']) {
            ptr(t);
            expect(refreshed(), t).toBe(false);
          }
          kbdUp();
          expect(refreshed()).toBe(true);
        });

        it('指针按着时 focusout（relatedTarget 不在框里）与键盘的 keyup 不解锁', () => {
          ptr('pointerdown');
          focusout(null);
          focusout(new HudEl());
          kbdUp();
          expect(refreshed()).toBe(false);
          ptr('pointerup');
          expect(refreshed()).toBe(true);
        });

        it('两者各自松开：先松键盘仍锁着，再松指针才刷新；反过来同样', () => {
          kbdDown();
          ptr('pointerdown');
          kbdUp();
          expect(refreshed()).toBe(false);
          ptr('pointerup');
          expect(refreshed()).toBe(true);
          ptr('pointerdown');
          kbdDown();
          ptr('pointerleave');
          expect(refreshed()).toBe(false);
          kbdUp();
          expect(refreshed()).toBe(true);
        });

        it('window blur 两者都清', () => {
          kbdDown();
          ptr('pointerdown');
          win.dispatchEvent(new Event('blur'));
          expect(refreshed()).toBe(true);
        });

        it('收起两者都清：再次弹出后 update 照常刷新', () => {
          kbdDown();
          ptr('pointerdown');
          hud!.closeUpgradeMenu();
          cb.upgradeChoices.mockReturnValue(two());
          hold('type', 3);
          expect(refreshed()).toBe(true);
        });
      });

      it('原地刷新时正有焦点的按钮变成 disabled：焦点先移到弹出框本身', () => {
        setup();
        btnNodes()[0].focus();
        expect(active()).toBe(btnNodes()[0]);
        cb.upgradeChoices.mockReturnValue([choice('甲', null, 1, () => {}, 30), choice('乙', { count: 2, cost: 20 }, 2)]);
        hud!.update();
        expect(items()[0].disabled).toBe(true);
        expect(active()).toBe(upMenu());
      });

      it('原地刷新时焦点所在的按钮仍可点：焦点不动；变 disabled 的不是焦点所在的按钮：焦点不动', () => {
        setup();
        btnNodes()[1].focus();
        const focused = btnNodes()[1];
        cb.upgradeChoices.mockReturnValue([choice('甲', null, 1, () => {}, 30), choice('乙', { count: 2, cost: 25 }, 2)]);
        hud!.update();
        expect(active()).toBe(focused);
        expect(btnNodes()[1]).toBe(focused);
      });

      it('重建时焦点原在弹出框里的某一项：按 label 找新列表里同 label 且可点的那项给焦点（不按行号）', () => {
        setup();
        btnNodes()[1].focus();
        cb.upgradeChoices.mockReturnValue([choice('乙', { count: 2, cost: 20 }, 2), choice('丙', { count: 1, cost: 5 }, 1)]);
        hud!.update();
        const f = active() as FakeEl;
        expect(f.tagName).toBe('button');
        expect(f.parent).toBe(upMenu());
        expect(f.dataset.i).toBe('0');
        expect(f.children[0].textContent).toBe('乙');
      });

      it('重建后那一项没了、或同 label 但不能点：焦点给弹出框本身，不给别的项', () => {
        setup();
        btnNodes()[1].focus();
        cb.upgradeChoices.mockReturnValue([choice('甲', { count: 1, cost: 10 }, 1), choice('丙', { count: 1, cost: 5 }, 1)]);
        hud!.update();
        expect(active()).toBe(upMenu());
        hud!.closeUpgradeMenu();
        setup();
        btnNodes()[1].focus();
        cb.upgradeChoices.mockReturnValue([choice('乙', null, 2, () => {}, 40), choice('丙', { count: 1, cost: 5 }, 1)]);
        hud!.update();
        expect(active()).toBe(upMenu());
      });

      it('重建时焦点原在弹出框本身：仍给弹出框本身', () => {
        setup();
        upMenu().focus();
        cb.upgradeChoices.mockReturnValue([choice('丙', { count: 1, cost: 5 }, 1)]);
        hud!.update();
        expect(active()).toBe(upMenu());
      });

      it('重建时焦点原不在弹出框里：不动焦点', () => {
        setup();
        const other = new HudEl();
        other.focus();
        cb.upgradeChoices.mockReturnValue([choice('丙', { count: 1, cost: 5 }, 1)]);
        hud!.update();
        expect(active()).toBe(other);
      });
    });

    describe('指针锁只认按下的那个指针；指针点按在松开瞬间成交', () => {
      let cost = 10;
      let run: ReturnType<typeof vi.fn>;
      const ptr = (type: string, id = 1): void => pointerEvt(type, id);
      const refreshed = (): boolean => {
        cost += 1;
        cb.upgradeChoices.mockReturnValue([choice('甲', { count: 1, cost }, 1, run)]);
        hud!.update();
        return items()[0].sub === `1 人 · 金 ${cost}`;
      };
      beforeEach(() => {
        cost = 10;
        run = vi.fn();
        mk();
        cb.upgradeChoices.mockReturnValue([choice('甲', { count: 1, cost }, 1, run)]);
        hold('type', 3);
      });

      it('按在一项上、在原处松开：松开瞬间成交 run 并收起，不需要 click', () => {
        const b = btnNodes()[0];
        press(b);
        expect(run).not.toHaveBeenCalled();
        release(1, b);
        expect(run).toHaveBeenCalledTimes(1);
        expect(upMenu().hidden).toBe(true);
      });

      it('松开坐标处 elementFromPoint 返回的是该项里的子节点（<b>）：closest 找到同一个按钮，成交', () => {
        const b = btnNodes()[0];
        press(b);
        release(1, b.children[0]);
        expect(run).toHaveBeenCalledTimes(1);
      });

      it('指针产生的 click（detail 1 / 2）一律不理，不论前面有没有按下抬起', () => {
        clickRaw(0, 1);
        clickRaw(0, 2);
        expect(run).not.toHaveBeenCalled();
        press(btnNodes()[0]);
        release(1, upMenu());
        clickRaw(0, 1);
        expect(run).not.toHaveBeenCalled();
      });

      it('键盘 / 读屏激活（click 的 detail 为 0）照常成交', () => {
        clickRaw(0, 0);
        expect(run).toHaveBeenCalledTimes(1);
      });

      it('按住 → 移出 → 移回 → 松手：这一按作废，放开报价锁（update 照常刷新），松手不成交', () => {
        press(btnNodes()[0]);
        expect(refreshed()).toBe(false);
        ptr('pointerleave');
        expect(refreshed()).toBe(true);
        release(1, btnNodes()[0]);
        expect(run).not.toHaveBeenCalled();
        expect(upMenu().hidden).toBe(false);
      });

      it('作废的那一按之后，完整的一按照常成交', () => {
        press(btnNodes()[0]);
        ptr('pointerleave');
        release(1, btnNodes()[0]);
        expect(run).not.toHaveBeenCalled();
        clickItem(0);
        expect(run).toHaveBeenCalledTimes(1);
      });

      describe('持锁期间点外面', () => {
        const outsideDown = (target: FakeEl, id: number): Event => firePointer(win as unknown as FakeEl, 'pointerdown', { pointerId: id }, target);
        const viewCanvas = (): FakeCanvas => {
          const c = new FakeCanvas();
          c.className = 'view';
          return c;
        };

        it('有指针正按着升级框时另一指针按画面 / 小地图 / 别处：升级框仍开、事件未被拦；持锁指针原处松开照常成交', () => {
          const b = btnNodes()[0];
          press(b, 1);
          for (const t of [viewCanvas() as FakeEl, hud!.minimap as unknown as FakeEl, new HudEl()]) {
            const e = outsideDown(t, 2);
            expect(upMenu().hidden).toBe(false);
            expect(e.defaultPrevented).toBe(false);
            expect(e.cancelBubble).toBe(false);
          }
          release(1, b);
          expect(run).toHaveBeenCalledTimes(1);
        });

        it('没人按着时点外面照旧收起，落在画面 / 小地图上时拦下这一下，落在别处不拦（不论指针 id）', () => {
          for (const id of [1, 2]) {
            hold('type', 3);
            const e = outsideDown(viewCanvas(), id);
            expect(upMenu().hidden, `view ${id}`).toBe(true);
            expect(e.defaultPrevented).toBe(true);
            hold('type', 3);
            const m = outsideDown(hud!.minimap as unknown as FakeEl, id);
            expect(upMenu().hidden, `mini ${id}`).toBe(true);
            expect(m.defaultPrevented).toBe(true);
            hold('type', 3);
            const o = outsideDown(new HudEl(), id);
            expect(upMenu().hidden, `other ${id}`).toBe(true);
            expect(o.defaultPrevented).toBe(false);
          }
        });

        it('按着的那一按已作废（移出过）：另一指针按框外照常收起，落在画面上时照常拦', () => {
          press(btnNodes()[0], 1);
          firePointer(upMenu(), 'pointerleave', { pointerId: 1 });
          expect(upMenu().hidden).toBe(false);
          const e = outsideDown(viewCanvas(), 2);
          expect(upMenu().hidden).toBe(true);
          expect(e.defaultPrevented).toBe(true);
        });

        it('按着的那一按仍有效：另一指针按框外不收起（对照）', () => {
          press(btnNodes()[0], 1);
          outsideDown(viewCanvas(), 2);
          expect(upMenu().hidden).toBe(false);
        });

        it('持锁指针松开之后，另一指针点外面照旧收起', () => {
          const b = btnNodes()[0];
          press(b, 1);
          release(1, upMenu());
          expect(upMenu().hidden).toBe(false);
          outsideDown(new HudEl(), 2);
          expect(upMenu().hidden).toBe(true);
        });
      });

      describe('按坐标判出界与组合键', () => {
        beforeEach(() => {
          upMenu().rect = rectOf(0, 0, 100, 60);
        });

        it('触摸按住一项，pointermove 到框外（不发 pointerleave）：出界时就作废并放开报价锁；再回到原项松开也不成交', () => {
          const b = btnNodes()[0];
          press(b);
          expect(refreshed()).toBe(false);
          moveWin(1, 500, 30);
          expect(refreshed()).toBe(true);
          moveWin(1, 50, 30);
          release(1, b);
          expect(run).not.toHaveBeenCalled();
          expect(upMenu().hidden).toBe(false);
        });

        it('框的四条边外各一次都算出界', () => {
          for (const [x, y] of [[-1, 30], [101, 30], [50, -1], [50, 61]]) {
            hud!.closeUpgradeMenu();
            cb.upgradeChoices.mockReturnValue([choice('甲', { count: 1, cost: 1 }, 1, run)]);
            hold('type', 3);
            press(btnNodes()[0]);
            moveWin(1, x, y);
            release(1, btnNodes()[0]);
            expect(run, `${x},${y}`).not.toHaveBeenCalled();
          }
        });

        it('在框内（含边界）移动不作废：松开照常成交', () => {
          const b = btnNodes()[0];
          press(b);
          moveWin(1, 0, 0);
          moveWin(1, 100, 60);
          moveWin(1, 40, 20);
          expect(refreshed()).toBe(false);
          release(1, b);
          expect(run).toHaveBeenCalledTimes(1);
        });

        it('另一指针移到框外不作废持锁的这一按', () => {
          const b = btnNodes()[0];
          press(b, 1);
          moveWin(2, 500, 500);
          release(1, b);
          expect(run).toHaveBeenCalledTimes(1);
        });

        it.each([3, 5, 9])('左键按住一项，pointermove 带 buttons = %i（补按右键 / 中键…）：作废并放开报价锁，之后松开不成交', buttons => {
          const b = btnNodes()[0];
          press(b);
          moveWin(1, 50, 30, buttons);
          expect(refreshed()).toBe(true);
          release(1, b);
          expect(run).not.toHaveBeenCalled();
        });

        it('pointerup 的 button 不是 0（组合按键时最后松开的中键 / 右键）：不成交', () => {
          for (const button of [1, 2]) {
            hud!.closeUpgradeMenu();
            cb.upgradeChoices.mockReturnValue([choice('甲', { count: 1, cost: 1 }, 1, run)]);
            hold('type', 3);
            const b = btnNodes()[0];
            press(b);
            release(1, b, undefined, 'pointerup', button);
            expect(run, `button ${button}`).not.toHaveBeenCalled();
          }
        });

        it('收尾后摘掉 pointermove 监听：松开后的移动不影响下一按', () => {
          const b = btnNodes()[0];
          press(b);
          release(1, upMenu());
          moveWin(1, 500, 500);
          press(b);
          release(1, b);
          expect(run).toHaveBeenCalledTimes(1);
        });
      });

      it('松开处换了按钮 / 不在任何按钮上 / elementFromPoint 为 null：不成交，不收起', () => {
        const a = vi.fn(), c = vi.fn();
        cb.upgradeChoices.mockReturnValue([choice('甲', { count: 1, cost: 1 }, 1, a), choice('乙', { count: 1, cost: 2 }, 1, c)]);
        hold('type', 3);
        for (const over of [btnNodes()[1], upMenu().children.find(x => x.tagName === 'h3')!, upMenu(), null]) {
          press(btnNodes()[0]);
          release(1, over, over ?? upMenu());
          expect(a).not.toHaveBeenCalled();
          expect(c).not.toHaveBeenCalled();
          expect(upMenu().hidden).toBe(false);
        }
      });

      it('按住标题 / 空白处：什么也不登记，update 照常刷新；松开不成交', () => {
        pressTitle();
        expect(refreshed()).toBe(true);
        release(1, btnNodes()[0]);
        expect(run).not.toHaveBeenCalled();
        expect(upMenu().hidden).toBe(false);
      });

      it('按住标题时 selectionChanged 直接收起（没有按着确认撑着）', () => {
        pressTitle();
        hud!.selectionChanged();
        expect(upMenu().hidden).toBe(true);
      });

      it('按住 disabled 的项：不锁刷新，松开不成交；selectionChanged 照常收起', () => {
        cb.upgradeChoices.mockReturnValue([choice('甲', null, 1, run, 30)]);
        hold('type', 3);
        const b = btnNodes()[0];
        expect(b.disabled).toBe(true);
        press(b);
        cost += 1;
        cb.upgradeChoices.mockReturnValue([choice('甲', null, 1, run, 40)]);
        hud!.update();
        expect(items()[0].sub).toBe('1 人 · 黄金不足，升 1 人需 40');
        release(1, b);
        expect(run).not.toHaveBeenCalled();
        press(b);
        hud!.selectionChanged();
        expect(upMenu().hidden).toBe(true);
      });

      it('非左键按在项上：什么也不登记（不锁刷新）', () => {
        press(btnNodes()[0], 1, 2);
        expect(refreshed()).toBe(true);
      });

      it('按住标题时另一指针按在项上可登记并成交', () => {
        pressTitle(1);
        const b = btnNodes()[0];
        press(b, 2);
        expect(refreshed()).toBe(false);
        release(2, b);
        expect(run).toHaveBeenCalledTimes(1);
        expect(upMenu().hidden).toBe(true);
      });

      it('非主键按在一项上不成交', () => {
        const b = btnNodes()[0];
        press(b, 1, 2);
        release(1, b);
        expect(run).not.toHaveBeenCalled();
      });

      it('松开时那一项已 disabled、或已不在弹出框里：不成交', () => {
        const b = btnNodes()[0];
        press(b);
        b.disabled = true;
        release(1, b);
        expect(run).not.toHaveBeenCalled();
        b.disabled = false;
        press(b);
        b.remove();
        release(1, b);
        expect(run).not.toHaveBeenCalled();
      });

      it('pointercancel 结束这一按：解锁、不成交', () => {
        const b = btnNodes()[0];
        press(b);
        release(1, b, b, 'pointercancel');
        expect(run).not.toHaveBeenCalled();
        expect(refreshed()).toBe(true);
      });

      it('按住 → 移出 → 在框外松开（pointerup 或 pointercancel）：解锁、不成交，不留残留；之后完整的一按照常成交', () => {
        for (const t of ['pointerup', 'pointercancel']) {
          run.mockClear();
          press(btnNodes()[0]);
          ptr('pointerleave');
          release(1, null, new HudEl(), t);
          expect(refreshed(), t).toBe(true);
          expect(run, t).not.toHaveBeenCalled();
          clickItem(0);
          expect(run, t).toHaveBeenCalledTimes(1);
          cb.upgradeChoices.mockReturnValue([choice('甲', { count: 1, cost }, 1, run)]);
          hold('type', 3);
        }
      });

      it('框外松开之后在框里按下照常登记：报价锁照常工作，松开成交', () => {
        press(btnNodes()[0]);
        ptr('pointerleave');
        release(1, null, new HudEl());
        const b = btnNodes()[0];
        press(b);
        expect(refreshed()).toBe(false);
        release(1, b);
        expect(run).toHaveBeenCalledTimes(1);
      });

      it('同一指针的 pointerup 只处理一次：松开后 window 上的监听已摘，不会误清下一按', () => {
        press(btnNodes()[0]);
        release(1, upMenu());
        press(btnNodes()[0]);
        expect(refreshed()).toBe(false);
        release(1, upMenu());
        expect(refreshed()).toBe(true);
        release(1, upMenu());
        expect(refreshed()).toBe(true);
      });

      it('鼠标按住第一项时另一指针在第二项按下抬起（含 click）：不成交、不收起；鼠标随后在第一项上抬起：按第一项成交', () => {
        const a = vi.fn(), c = vi.fn();
        cb.upgradeChoices.mockReturnValue([choice('甲', { count: 1, cost: 10 }, 1, a), choice('乙', { count: 1, cost: 20 }, 1, c)]);
        hold('type', 3);
        const [b0, b1] = btnNodes();
        press(b0, 1);
        press(b1, 2);
        release(2, b1);
        clickRaw(1);
        expect(a).not.toHaveBeenCalled();
        expect(c).not.toHaveBeenCalled();
        expect(upMenu().hidden).toBe(false);
        release(1, b0);
        expect(a).toHaveBeenCalledTimes(1);
        expect(c).not.toHaveBeenCalled();
        expect(upMenu().hidden).toBe(true);
      });

      it('另一指针的抬起 / 取消 / 离开不解锁，也不作废这一按；它自己抬起才解锁', () => {
        press(btnNodes()[0], 1);
        press(btnNodes()[0], 2);
        for (const t of ['pointerup', 'pointercancel', 'pointerleave']) {
          ptr(t, 2);
          expect(refreshed(), t).toBe(false);
        }
        ptr('pointerup', 1);
        expect(refreshed()).toBe(true);
      });

      it('另一指针的离开不作废这一按：持锁指针原处松开照常成交', () => {
        const b = btnNodes()[0];
        press(b, 1);
        ptr('pointerleave', 2);
        release(1, b);
        expect(run).toHaveBeenCalledTimes(1);
      });

      it('已有按着的指针时不再接新的：第二指按下后第一指抬起就解锁', () => {
        press(btnNodes()[0], 1);
        press(btnNodes()[0], 2);
        ptr('pointerup', 1);
        expect(refreshed()).toBe(true);
      });

      it('window blur 清掉指针记录：之后另一个指针按下被接受，只认它的抬起', () => {
        press(btnNodes()[0], 1);
        win.dispatchEvent(new Event('blur'));
        expect(refreshed()).toBe(true);
        press(btnNodes()[0], 2);
        ptr('pointerup', 1);
        expect(refreshed()).toBe(false);
        ptr('pointerup', 2);
        expect(refreshed()).toBe(true);
      });

      it('收起清掉指针记录：再弹出后另一个指针按下被接受', () => {
        press(btnNodes()[0], 1);
        hud!.closeUpgradeMenu();
        cb.upgradeChoices.mockReturnValue([choice('甲', { count: 1, cost }, 1, run)]);
        hold('type', 3);
        press(btnNodes()[0], 2);
        ptr('pointerup', 1);
        expect(refreshed()).toBe(false);
        ptr('pointerup', 2);
        expect(refreshed()).toBe(true);
      });
    });

    describe('按着确认时：别的手指长按不重开；选择变化（selectionChanged）等这一按结束', () => {
      let run: ReturnType<typeof vi.fn>;
      const key = (type: 'keydown' | 'keyup', k: string, target: FakeEl): void => {
        const e = new Event(type, { cancelable: true });
        Object.defineProperty(e, 'key', { value: k });
        Object.defineProperty(e, 'target', { value: target });
        // keydown 派发在框上；keyup 由 window 捕获
        (type === 'keyup' ? win : upMenu()).dispatchEvent(e);
      };
      const winKeyDown = (k: string, shiftKey = false): void => {
        const e = new Event('keydown', { cancelable: true });
        Object.defineProperty(e, 'key', { value: k });
        Object.defineProperty(e, 'shiftKey', { value: shiftKey });
        win.dispatchEvent(e);
      };
      const withTimers = (f: () => void): void => {
        vi.useFakeTimers();
        try {
          f();
        } finally {
          vi.useRealTimers();
        }
      };
      beforeEach(() => {
        run = vi.fn();
        mk();
        cb.upgradeChoices.mockReturnValue([choice('甲', { count: 1, cost: 10 }, 1, run)]);
        hold('type', 3);
      });

      describe('showUpgradeMenu 持锁时直接返回', () => {
        it('有指针按着：别的手指长按同一卡片，内容与 upChoices 不变，不重新取项；持锁指针原处松开按原报价成交', () => {
          const other = vi.fn();
          const b = btnNodes()[0];
          press(b, 1);
          const n = cb.upgradeChoices.mock.calls.length;
          cb.upgradeChoices.mockReturnValue([choice('乙', { count: 2, cost: 99 }, 2, other)]);
          hold('type', 3);
          expect(cb.upgradeChoices.mock.calls.length).toBe(n);
          expect(items().map(x => x.label)).toEqual(['甲']);
          expect(btnNodes()[0]).toBe(b);
          release(1, b);
          expect(run).toHaveBeenCalledTimes(1);
          expect(other).not.toHaveBeenCalled();
        });

        it('有键盘按着：同样不重开、不改写', () => {
          key('keydown', ' ', btnNodes()[0]);
          const n = cb.upgradeChoices.mock.calls.length;
          cb.upgradeChoices.mockReturnValue([choice('乙', { count: 2, cost: 99 }, 2)]);
          hold('group', 2);
          expect(cb.upgradeChoices.mock.calls.length).toBe(n);
          expect(items().map(x => x.label)).toEqual(['甲']);
        });

        it('只剩作废的指针（移出过）：长按照常重开并改写；该指针随后的 pointerup 不成交、不收起新框', () => {
          const other = vi.fn();
          const b = btnNodes()[0];
          press(b, 1);
          firePointer(upMenu(), 'pointerleave', { pointerId: 1 });
          cb.upgradeChoices.mockReturnValue([choice('乙', { count: 2, cost: 99 }, 2, other)]);
          hold('type', 3);
          expect(items().map(x => x.label)).toEqual(['乙']);
          expect(upMenu().hidden).toBe(false);
          release(1, btnNodes()[0]);
          expect(run).not.toHaveBeenCalled();
          expect(other).not.toHaveBeenCalled();
          expect(upMenu().hidden).toBe(false);
        });

        it('重开后新框的指针锁已丢掉作废记录：update 照常刷新', () => {
          press(btnNodes()[0], 1);
          firePointer(upMenu(), 'pointerleave', { pointerId: 1 });
          cb.upgradeChoices.mockReturnValue([choice('乙', { count: 2, cost: 99 }, 2)]);
          hold('type', 3);
          cb.upgradeChoices.mockReturnValue([choice('乙', { count: 2, cost: 77 }, 2)]);
          hud!.update();
          expect(items()[0].sub).toBe('2 人 · 金 77');
        });

        it('没人按着时长按照常重开并改写', () => {
          cb.upgradeChoices.mockReturnValue([choice('乙', { count: 2, cost: 99 }, 2)]);
          hold('type', 3);
          expect(items().map(x => x.label)).toEqual(['乙']);
        });
      });

      describe('update() 时按着确认期间的摆位', () => {
        const at = (): string => upMenu().style.transform;
        /** 桌面版：弹出框 100 × 60，卡片 (100, 500)；期间详情出现在 300 处，弹出框该移到它上方 */
        const showDetail = (): void => {
          const d = find(x => x.classList.contains('detail'))!;
          d.rect = rectOf(0, 300, 300, 200);
          d.hidden = false;
        };
        beforeEach(() => {
          hud!.closeUpgradeMenu();
          hud!.root.getBoundingClientRect = () => rectOf(0, 0, 390, 800) as unknown as DOMRect;
          upMenu().offsetWidth = 100;
          upMenu().offsetHeight = 60;
          cb.upgradeChoices.mockReturnValue([choice('甲', { count: 1, cost: 10 }, 1, run)]);
          hold('type', 3);
        });

        it('只有键盘按着：内容不刷新，位置照常重新摆（详情出现后移到详情上方）', () => {
          expect(at()).toBe('translate(80px, 432px)');
          key('keydown', ' ', btnNodes()[0]);
          showDetail();
          cb.upgradeChoices.mockReturnValue([choice('甲', { count: 1, cost: 99 }, 1, run)]);
          hud!.update();
          expect(items()[0].sub).toBe('1 人 · 金 10');
          expect(at()).toBe('translate(80px, 232px)');
        });

        it('指针按着（锁住）：位置与内容都不动', () => {
          press(btnNodes()[0]);
          showDetail();
          cb.upgradeChoices.mockReturnValue([choice('甲', { count: 1, cost: 99 }, 1, run)]);
          hud!.update();
          expect(items()[0].sub).toBe('1 人 · 金 10');
          expect(at()).toBe('translate(80px, 432px)');
        });

        it('键盘与指针同时按着：位置不动（指针优先）', () => {
          key('keydown', ' ', btnNodes()[0]);
          press(btnNodes()[0]);
          showDetail();
          hud!.update();
          expect(at()).toBe('translate(80px, 432px)');
        });

        it('没人按着：内容与位置都照常刷新', () => {
          showDetail();
          cb.upgradeChoices.mockReturnValue([choice('甲', { count: 1, cost: 99 }, 1, run)]);
          hud!.update();
          expect(items()[0].sub).toBe('1 人 · 金 99');
          expect(at()).toBe('translate(80px, 232px)');
        });

        const cardwrapEl = (): FakeEl => find(x => x.classList.contains('cardwrap'))!;

        it('桌面：打开后卡片带上移 200（视口变了），没人按着时下一次 update 弹出框纵坐标跟着上移 200；横向挪动同样跟着', () => {
          expect(at()).toBe('translate(80px, 432px)');
          cardwrapEl().rect = rectOf(0, -200, 390, 100);
          hud!.update();
          expect(at()).toBe('translate(80px, 232px)');
          cardwrapEl().rect = rectOf(50, -200, 390, 100);
          hud!.update();
          expect(at()).toBe('translate(130px, 232px)');
        });

        it('只有键盘按着：同样跟着挪（内容仍锁住）', () => {
          key('keydown', ' ', btnNodes()[0]);
          cardwrapEl().rect = rectOf(0, -200, 390, 100);
          cb.upgradeChoices.mockReturnValue([choice('甲', { count: 1, cost: 99 }, 1, run)]);
          hud!.update();
          expect(at()).toBe('translate(80px, 232px)');
          expect(items()[0].sub).toBe('1 人 · 金 10');
        });

        it('指针按着：不动', () => {
          press(btnNodes()[0]);
          cardwrapEl().rect = rectOf(0, -200, 390, 100);
          hud!.update();
          expect(at()).toBe('translate(80px, 432px)');
        });

        it('卡片带没挪：update 不改位置', () => {
          hud!.update();
          hud!.update();
          expect(at()).toBe('translate(80px, 432px)');
        });

        describe('优先按那张卡此刻的位置摆', () => {
          /** 往 hud.cards.roster 里放一张真的兵种卡（兵种 3） */
          const addCard = (left: number, top: number): HudEl => {
            const c = new HudEl();
            c.className = 'ucard';
            c.dataset.t = '3';
            c.rect = rectOf(left, top, 60, 100);
            (hud!.cards.roster as unknown as FakeEl).appendChild(c);
            return c;
          };

          it('卡片还在：按它此刻的位置摆，卡片带内部换行 / 挪位后跟着那张卡', () => {
            const c = addCard(200, 300);
            hud!.update();
            expect(at()).toBe('translate(180px, 232px)');
            c.rect = rectOf(120, 150, 60, 100);
            hud!.update();
            expect(at()).toBe(`translate(${120 + 30 - 50}px, ${150 - 60 - 8}px)`);
          });

          it('卡片还在时不管卡片带的位置', () => {
            addCard(200, 300);
            cardwrapEl().rect = rectOf(0, -500, 390, 100);
            hud!.update();
            expect(at()).toBe('translate(180px, 232px)');
          });

          it('卡片不在了：回退到卡片带实时位置加弹出时记下的偏移', () => {
            const c = addCard(200, 300);
            hud!.update();
            c.remove();
            expect(at()).toBe('translate(180px, 232px)');
            hud!.update();
            expect(at()).toBe('translate(80px, 432px)');
            cardwrapEl().rect = rectOf(0, -200, 390, 100);
            hud!.update();
            expect(at()).toBe('translate(80px, 232px)');
          });

          const addTyped = (t: number, left: number, top: number): HudEl => {
            const c = addCard(left, top);
            c.dataset.t = String(t);
            return c;
          };

          it('桌面下排卡片长按：弹出框落在上排卡片之上（不盖住上排），横向仍对着长按的那张', () => {
            addCard(200, 500);
            addTyped(5, 20, 380);
            hud!.update();
            expect(at()).toBe(`translate(180px, ${380 - 60 - 8}px)`);
          });

          it('长按的卡片自己就是最高的：照旧在它之上', () => {
            addCard(200, 300);
            addTyped(5, 20, 380);
            hud!.update();
            expect(at()).toBe(`translate(180px, ${300 - 60 - 8}px)`);
          });

          it('详情显示着：取长按的卡片、最高的卡片、详情三者的最小值', () => {
            addCard(200, 500);
            addTyped(5, 20, 380);
            const d = find(x => x.classList.contains('detail'))!;
            d.hidden = false;
            d.rect = rectOf(0, 300, 300, 200);
            hud!.update();
            expect(at()).toBe(`translate(180px, ${300 - 60 - 8}px)`);
            d.rect = rectOf(0, 450, 300, 200);
            hud!.update();
            expect(at()).toBe(`translate(180px, ${380 - 60 - 8}px)`);
            d.hidden = true;
            d.rect = rectOf(0, 100, 300, 200);
            hud!.update();
            expect(at()).toBe(`translate(180px, ${380 - 60 - 8}px)`);
          });

          it('移动版不看别的卡片：纵向仍按卡片带上沿', () => {
            hud!.setMobile(true);
            cardwrapEl().rect = rectOf(0, 680, 390, 100);
            const bar = hud!.cards as unknown as { cb: { holdCard(k: string, i: number, r: unknown): void } };
            cb.upgradeChoices.mockReturnValue([choice('甲', { count: 1, cost: 10 }, 1, run)]);
            bar.cb.holdCard('type', 3, rectOf(100, 700, 60, 100));
            addCard(200, 700);
            addTyped(5, 20, 380);
            hud!.update();
            expect(at()).toBe(`translate(180px, ${680 - 60 - 8}px)`);
          });

          it('移动版：横向跟那张卡，纵向仍按卡片带上沿', () => {
            hud!.setMobile(true);
            cardwrapEl().rect = rectOf(0, 680, 390, 100);
            const bar = hud!.cards as unknown as { cb: { holdCard(k: string, i: number, r: unknown): void } };
            cb.upgradeChoices.mockReturnValue([choice('甲', { count: 1, cost: 10 }, 1, run)]);
            bar.cb.holdCard('type', 3, rectOf(100, 700, 60, 100));
            const c = addCard(200, 300);
            hud!.update();
            expect(at()).toBe(`translate(180px, ${680 - 60 - 8}px)`);
            c.rect = rectOf(120, 300, 60, 100);
            hud!.update();
            expect(at()).toBe(`translate(100px, ${680 - 60 - 8}px)`);
          });
        });

        it('移动版：纵向仍按卡片带上沿，不受卡片相对卡片带的 dy 影响；卡片带挪了跟着挪', () => {
          hud!.setMobile(true);
          const bar = hud!.cards as unknown as { cb: { holdCard(k: string, i: number, r: unknown): void } };
          cardwrapEl().rect = rectOf(0, 680, 390, 100);
          cb.upgradeChoices.mockReturnValue([choice('甲', { count: 1, cost: 10 }, 1, run)]);
          bar.cb.holdCard('type', 3, rectOf(100, 700, 60, 100));
          expect(at()).toBe(`translate(80px, ${680 - 60 - 8}px)`);
          hud!.closeUpgradeMenu();
          bar.cb.holdCard('type', 3, rectOf(100, 650, 60, 100));
          expect(at()).toBe(`translate(80px, ${680 - 60 - 8}px)`);
          cardwrapEl().rect = rectOf(0, 480, 390, 100);
          hud!.update();
          expect(at()).toBe(`translate(80px, ${480 - 60 - 8}px)`);
        });

        it('键盘按着时升级框已收起：update 不会把它摆出来', () => {
          key('keydown', ' ', btnNodes()[0]);
          hud!.closeUpgradeMenu();
          hud!.update();
          expect(upMenu().hidden).toBe(true);
        });
      });

      describe('键盘按着时别的指针点外面', () => {
        const active = (): unknown => (document as unknown as { activeElement: unknown }).activeElement;
        const outsideDown = (target: FakeEl, id = 2): Event => firePointer(win as unknown as FakeEl, 'pointerdown', { pointerId: id }, target);
        const viewCanvas = (): FakeCanvas => {
          const c = new FakeCanvas();
          c.className = 'view';
          return c;
        };

        it('键盘按着空格时另一指针按画面：框不收起、事件不拦；焦点被抢走也不影响，keyup 落在画面上仍按原项成交', () => {
          const b = btnNodes()[0];
          b.focus();
          key('keydown', ' ', b);
          const view = viewCanvas();
          const e = outsideDown(view);
          expect(upMenu().hidden).toBe(false);
          expect(e.defaultPrevented).toBe(false);
          expect(e.cancelBubble).toBe(false);
          // 画面把焦点抢走
          const other = new HudEl();
          other.focus();
          expect(active()).toBe(other);
          key('keyup', ' ', view);
          expect(run).toHaveBeenCalledTimes(1);
          expect(upMenu().hidden).toBe(true);
        });

        it('键盘按着时按小地图 / 别处同样不收起、不拦', () => {
          key('keydown', ' ', btnNodes()[0]);
          for (const t of [hud!.minimap as unknown as FakeEl, new HudEl()]) {
            const e = outsideDown(t);
            expect(upMenu().hidden).toBe(false);
            expect(e.defaultPrevented).toBe(false);
          }
        });

        it('不再有「还焦点」：被抢走的焦点不会被还回', () => {
          withTimers(() => {
            const b = btnNodes()[0];
            b.focus();
            key('keydown', ' ', b);
            outsideDown(viewCanvas());
            const other = new HudEl();
            other.focus();
            vi.advanceTimersByTime(0);
            expect(active()).toBe(other);
          });
        });

        it('键盘没按着时点外面照旧收起', () => {
          outsideDown(new HudEl());
          expect(upMenu().hidden).toBe(true);
        });
      });

      describe('selectionChanged', () => {
        it('升级框没开时什么也不做', () => {
          hud!.closeUpgradeMenu();
          const n = cb.upgradeChoices.mock.calls.length;
          hud!.selectionChanged();
          expect(upMenu().hidden).toBe(true);
          expect(cb.upgradeChoices.mock.calls.length).toBe(n);
        });

        it('没人按着：收起', () => {
          hud!.selectionChanged();
          expect(upMenu().hidden).toBe(true);
        });

        it('有指针按着：不收起；这一按成交就按原报价 run 并收起', () => {
          const b = btnNodes()[0];
          press(b);
          hud!.selectionChanged();
          expect(upMenu().hidden).toBe(false);
          release(1, b);
          expect(run).toHaveBeenCalledTimes(1);
          expect(upMenu().hidden).toBe(true);
        });

        it('有指针按着、这一按没成交（移出作废 / 松在别处 / 取消 / 按在标题上）：结束时收起', () => {
          const cases: [string, () => void][] = [
            ['移出作废', () => { press(btnNodes()[0]); firePointer(upMenu(), 'pointerleave', { pointerId: 1 }); hud!.selectionChanged(); release(1, btnNodes()[0]); }],
            ['松在别处', () => { const c = new FakeEl('button'); press(btnNodes()[0]); hud!.selectionChanged(); release(1, c); }],
            ['取消', () => { press(btnNodes()[0]); hud!.selectionChanged(); release(1, btnNodes()[0], undefined, 'pointercancel'); }],
            ['按在项上、松在标题上', () => { press(btnNodes()[0]); hud!.selectionChanged(); release(1, upMenu()); }],
            ['按在标题上（没登记）', () => { pressTitle(); hud!.selectionChanged(); release(1, upMenu()); }],
          ];
          for (const [name, f] of cases) {
            cb.upgradeChoices.mockReturnValue([choice('甲', { count: 1, cost: 10 }, 1, run)]);
            hold('type', 3);
            f();
            expect(upMenu().hidden, name).toBe(true);
          }
          expect(run).not.toHaveBeenCalled();
        });

        it('按着期间 selectionChanged 之前菜单一直开着；收起后过期标记清掉：再弹出的下一按没成交也不会被收起', () => {
          press(btnNodes()[0]);
          hud!.selectionChanged();
          expect(upMenu().hidden).toBe(false);
          release(1, upMenu());
          expect(upMenu().hidden).toBe(true);
          hold('type', 3);
          press(btnNodes()[0]);
          release(1, upMenu());
          expect(upMenu().hidden).toBe(false);
        });

        it('收起（closeUpgradeMenu）清掉过期标记', () => {
          press(btnNodes()[0]);
          hud!.selectionChanged();
          hud!.closeUpgradeMenu();
          hold('type', 3);
          press(btnNodes()[0]);
          release(1, upMenu());
          expect(upMenu().hidden).toBe(false);
        });

        it('键盘按着空格：selectionChanged 不收起；keyup 按原报价成交并收起', () => {
          key('keydown', ' ', btnNodes()[0]);
          hud!.selectionChanged();
          expect(upMenu().hidden).toBe(false);
          key('keyup', ' ', btnNodes()[0]);
          expect(run).toHaveBeenCalledTimes(1);
          expect(upMenu().hidden).toBe(true);
        });

        it('键盘按着 Enter：selectionChanged 不收起；keyup（没成交）立即收起，不等下一轮', () => {
          key('keydown', 'Enter', btnNodes()[0]);
          hud!.selectionChanged();
          expect(upMenu().hidden).toBe(false);
          key('keyup', 'Enter', btnNodes()[0]);
          expect(upMenu().hidden).toBe(true);
          expect(run).not.toHaveBeenCalled();
        });

        it('键盘按着确认期间选择变了，指针按下又移出松开：键盘还按着时不收起；空格松开照常成交', () => {
          key('keydown', ' ', btnNodes()[0]);
          press(btnNodes()[0], 1);
          hud!.selectionChanged();
          firePointer(upMenu(), 'pointerleave', { pointerId: 1 });
          release(1, null, new HudEl());
          expect(upMenu().hidden).toBe(false);
          key('keyup', ' ', btnNodes()[0]);
          expect(run).toHaveBeenCalledTimes(1);
          expect(upMenu().hidden).toBe(true);
        });

        it('指针这一按没成交且过期：键盘没在按着才收起（键盘按着就等它结束）', () => {
          press(btnNodes()[0], 1);
          key('keydown', 'Enter', btnNodes()[0]);
          hud!.selectionChanged();
          release(1, upMenu());
          expect(upMenu().hidden).toBe(false);
          key('keyup', 'Enter', btnNodes()[0]);
          expect(upMenu().hidden).toBe(true);
        });

        it('键盘按着 Enter 期间选择变了：Enter keyup 结束这一按并收起', () => {
          key('keydown', 'Enter', btnNodes()[0]);
          hud!.selectionChanged();
          expect(upMenu().hidden).toBe(false);
          key('keyup', 'Enter', btnNodes()[0]);
          expect(upMenu().hidden).toBe(true);
        });

        it('Tab 取消键盘确认时已过期且没有指针记录：当下同步收起，不等下一次 update', () => {
          key('keydown', ' ', btnNodes()[0]);
          hud!.selectionChanged();
          expect(upMenu().hidden).toBe(false);
          winKeyDown('Tab');
          expect(upMenu().hidden).toBe(true);
          expect(run).not.toHaveBeenCalled();
        });

        it('Tab 取消时有指针记录：不收起（等指针这一按结束再定）', () => {
          key('keydown', ' ', btnNodes()[0]);
          press(btnNodes()[0], 1);
          hud!.selectionChanged();
          winKeyDown('Tab');
          expect(upMenu().hidden).toBe(false);
          release(1, upMenu());
          expect(upMenu().hidden).toBe(true);
        });

        it('Tab 取消时没过期：不收起', () => {
          key('keydown', ' ', btnNodes()[0]);
          winKeyDown('Tab');
          expect(upMenu().hidden).toBe(false);
        });

        it('update()：过期但键盘还按着：不收起', () => {
          key('keydown', ' ', btnNodes()[0]);
          hud!.selectionChanged();
          hud!.update();
          expect(upMenu().hidden).toBe(false);
        });

        it('update()：过期，指针仍按着且没作废：不收起；松开没成交后收起', () => {
          press(btnNodes()[0]);
          hud!.selectionChanged();
          hud!.update();
          expect(upMenu().hidden).toBe(false);
          release(1, upMenu());
          expect(upMenu().hidden).toBe(true);
        });

        describe('作废的指针不再撑着过期的升级框', () => {
          let r0: ReturnType<typeof vi.fn>, r1: ReturnType<typeof vi.fn>;
          const setupTwo = (): void => {
            hud?.destroy();
            host = new HudEl();
            mk();
            r0 = vi.fn();
            r1 = vi.fn();
            cb.upgradeChoices.mockReturnValue([choice('甲', { count: 1, cost: 10 }, 1, r0), choice('乙', { count: 2, cost: 20 }, 2, r1)]);
            hold('type', 3);
          };
          const leave = (id = 1): void => void firePointer(upMenu(), 'pointerleave', { pointerId: id });

          it('已过期、键盘没按着时，指针移出（pointerleave）作废：当下收起', () => {
            setupTwo();
            press(btnNodes()[0]);
            hud!.selectionChanged();
            expect(upMenu().hidden).toBe(false);
            leave();
            expect(upMenu().hidden).toBe(true);
          });

          it('已过期、键盘没按着时，pointermove 出界或补按别的键作废：当下收起', () => {
            for (const move of [() => moveWin(1, 500, 30), () => moveWin(1, 50, 30, 5)]) {
              setupTwo();
              upMenu().rect = rectOf(0, 0, 100, 60);
              press(btnNodes()[0]);
              hud!.selectionChanged();
              move();
              expect(upMenu().hidden).toBe(true);
            }
          });

          it('指针作废后才 selectionChanged（键盘没按着）：直接收起', () => {
            setupTwo();
            press(btnNodes()[0]);
            leave();
            hud!.selectionChanged();
            expect(upMenu().hidden).toBe(true);
          });

          it('指针作废时键盘还按着：不收起', () => {
            setupTwo();
            key('keydown', ' ', btnNodes()[0]);
            press(btnNodes()[1]);
            hud!.selectionChanged();
            leave();
            expect(upMenu().hidden).toBe(false);
          });

          it('键鼠同按、选择变化、指针移出作废（键盘仍按着，不收起）、再 Tab：当下收起，之后 Enter / click(detail 0) 不能成交', () => {
            setupTwo();
            key('keydown', ' ', btnNodes()[0]);
            press(btnNodes()[1]);
            hud!.selectionChanged();
            leave();
            expect(upMenu().hidden).toBe(false);
            winKeyDown('Tab');
            expect(upMenu().hidden).toBe(true);
            // 收起后：Enter 的按下 / 松开与键盘激活的 click 都不会买到过期的项
            key('keydown', 'Enter', btnNodes()[0]);
            clickRaw(0, 0);
            clickRaw(1, 0);
            key('keyup', 'Enter', btnNodes()[0]);
            expect(r0).not.toHaveBeenCalled();
            expect(r1).not.toHaveBeenCalled();
          });

          it('指针作废后键盘 Enter 松开（没成交）：作废的指针不算还有人按着，收起', () => {
            setupTwo();
            key('keydown', 'Enter', btnNodes()[0]);
            press(btnNodes()[1]);
            hud!.selectionChanged();
            leave();
            expect(upMenu().hidden).toBe(false);
            key('keyup', 'Enter', btnNodes()[0]);
            expect(upMenu().hidden).toBe(true);
          });

          it('作废后升级框已收起：该指针随后的 pointerup 不报错、不成交', () => {
            setupTwo();
            const b = btnNodes()[0];
            press(b);
            leave();
            hud!.selectionChanged();
            expect(upMenu().hidden).toBe(true);
            expect(() => release(1, b)).not.toThrow();
            expect(r0).not.toHaveBeenCalled();
            expect(r1).not.toHaveBeenCalled();
          });

          it('update()：过期、键盘还按着、指针已作废：不收起', () => {
            setupTwo();
            key('keydown', ' ', btnNodes()[0]);
            press(btnNodes()[1]);
            hud!.selectionChanged();
            leave();
            expect(upMenu().hidden).toBe(false);
            hud!.update();
            expect(upMenu().hidden).toBe(false);
          });
        });

        it('update()：没过期时照常刷新、不收起', () => {
          hud!.update();
          expect(upMenu().hidden).toBe(false);
        });

        it('window blur：已过期就收起；没过期不收起', () => {
          press(btnNodes()[0]);
          win.dispatchEvent(new Event('blur'));
          expect(upMenu().hidden).toBe(false);
          hud!.closeUpgradeMenu();
          hold('type', 3);
          press(btnNodes()[0]);
          hud!.selectionChanged();
          win.dispatchEvent(new Event('blur'));
          expect(upMenu().hidden).toBe(true);
        });
      });
    });

    it('公开的 closeUpgradeMenu()：收起菜单，之后点不到旧的项', () => {
      mk();
      const run = vi.fn();
      cb.upgradeChoices.mockReturnValue([choice('甲', { count: 1, cost: 1 }, 1, run)]);
      hold('type', 3);
      hud!.closeUpgradeMenu();
      expect(upMenu().hidden).toBe(true);
      clickItem(0);
      expect(run).not.toHaveBeenCalled();
    });

    it('setMobile 时收起', () => {
      mk();
      cb.upgradeChoices.mockReturnValue([choice('甲', { count: 1, cost: 1 }, 1)]);
      hold('type', 3);
      hud!.setMobile(true);
      expect(upMenu().hidden).toBe(true);
    });

    it('收起之后点不到旧的项', () => {
      mk();
      const run = vi.fn();
      cb.upgradeChoices.mockReturnValue([choice('甲', { count: 1, cost: 1 }, 1, run)]);
      hold('type', 3);
      down(outside());
      clickItem(0);
      expect(run).not.toHaveBeenCalled();
    });
  });

  describe('ResizeObserver：顶栏高度写进 --topbar', () => {
    it('观察提示条与顶栏；回调里把 root 的 --topbar 设成顶栏高度 + 8px', () => {
      const observed: unknown[] = [];
      let cbk: (() => void) | null = null;
      vi.stubGlobal('ResizeObserver', class {
        constructor(f: () => void) { cbk = f; }
        observe(el: unknown): void { observed.push(el); }
        disconnect(): void {}
      });
      mk();
      const topbar = find(x => x.classList.contains('topbar'))!;
      expect(observed).toContain(topbar);
      topbar.offsetHeight = 40;
      cbk!();
      expect(hud!.root.style.getPropertyValue('--topbar')).toBe('48px');
      topbar.offsetHeight = 56;
      cbk!();
      expect(hud!.root.style.getPropertyValue('--topbar')).toBe('64px');
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
