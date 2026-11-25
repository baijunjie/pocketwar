import { describe, expect, it } from 'vitest';
import { RULES, TRAITS, UNITS, UNIT_BY_KEY, isContentUnit } from '../../../src/sim/defs';
import { contentUnits, hash, measureFingerprint, pricingFingerprint, unitsFingerprint } from '../../../tools/measure/fingerprint';
import * as price from '../../../tools/measure/price';

describe('指纹：哈希', () => {
  it('相同内容相同哈希，与对象键的书写顺序无关', () => {
    expect(hash({ a: 1, b: [1, 2, { c: 3, d: 4 }] })).toBe(hash({ b: [1, 2, { d: 4, c: 3 }], a: 1 }));
  });

  it('内容不同哈希不同：数值、数组顺序、嵌套值都算', () => {
    const h = hash({ a: 1, b: [1, 2] });
    expect(hash({ a: 2, b: [1, 2] })).not.toBe(h);
    expect(hash({ a: 1, b: [2, 1] })).not.toBe(h);
    expect(hash({ a: 1, b: [1, 2], c: 0 })).not.toBe(h);
  });

  it('函数不进哈希', () => {
    expect(hash({ a: 1, f: () => 1 })).toBe(hash({ a: 1 }));
  });

  it('哈希是 16 位十六进制', () => {
    expect(hash('x')).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('指纹：规则与兵种', () => {
  it('同一份内容两次结果一样', () => {
    expect(measureFingerprint()).toBe(measureFingerprint());
    expect(pricingFingerprint()).toBe(pricingFingerprint());
    expect(unitsFingerprint()).toBe(unitsFingerprint());
  });

  it('正式兵种不含测量工具登记的基准单位与变体', () => {
    const list = contentUnits();
    expect(list.length).toBeGreaterThan(0);
    for (const d of list) expect(d.probe, d.key).toBeUndefined();
    // 基准单位与变体都带 probe 标记，判断不靠 key 的写法
    expect(UNITS.filter(d => d.probe).length).toBeGreaterThan(0);
    for (const d of UNITS.filter(d => d.key.startsWith('base_') || d.key.includes('|'))) expect(isContentUnit(d), d.key).toBe(false);
  });

  it('不影响平地对冲的规则表（经济）变了，测量指纹不变；影响对战的（士气）变了，测量指纹变', () => {
    const before = measureFingerprint();
    const econ = RULES.economy as unknown as Record<string, number>;
    const key = Object.keys(econ).find(k => typeof econ[k] === 'number')!;
    const old = econ[key];
    try {
      econ[key] = old + 1;
      expect(measureFingerprint()).toBe(before);
    } finally {
      econ[key] = old;
    }
    const morale = RULES.morale as unknown as Record<string, number>;
    const mk = Object.keys(morale).find(k => typeof morale[k] === 'number')!;
    const mold = morale[mk];
    try {
      morale[mk] = mold + 1;
      expect(measureFingerprint()).not.toBe(before);
    } finally {
      morale[mk] = mold;
    }
    expect(measureFingerprint()).toBe(before);
  });

  it('汇总指纹建在测量指纹之上，再加地板价规则：地板价变了只有汇总指纹变', () => {
    const m = measureFingerprint(), p = pricingFingerprint();
    expect(p).not.toBe(m);
    price.FLOOR_DIMS.push('hp');
    try {
      expect(measureFingerprint()).toBe(m);
      expect(pricingFingerprint()).not.toBe(p);
    } finally {
      price.FLOOR_DIMS.pop();
    }
    expect([measureFingerprint(), pricingFingerprint()]).toEqual([m, p]);
  });

  it('测价的级数变了，测量指纹变，汇总指纹跟着变', () => {
    const m = measureFingerprint(), p = pricingFingerprint();
    const probe = price.PROBE.hp;
    try {
      price.PROBE.hp = [6, -6];
      expect(measureFingerprint()).not.toBe(m);
      expect(pricingFingerprint()).not.toBe(p);
    } finally {
      price.PROBE.hp = probe;
    }
    expect([measureFingerprint(), pricingFingerprint()]).toEqual([m, p]);
  });

  it('兵种的名称、说明不影响指纹，面板数值影响指纹', () => {
    const d = UNIT_BY_KEY[contentUnits()[0].key];
    const before = unitsFingerprint();
    const { name, desc, hp } = d;
    try {
      d.name = `${name}改`;
      d.desc = `${desc}改`;
      expect(unitsFingerprint()).toBe(before);
      d.hp = hp + 1;
      expect(unitsFingerprint()).not.toBe(before);
    } finally {
      d.name = name;
      d.desc = desc;
      d.hp = hp;
    }
    expect(unitsFingerprint()).toBe(before);
  });
});

describe('指纹：光环参数', () => {
  it('光环的半径、数值与更新间隔变了，测量指纹与价目指纹都跟着变（价目表随之过期）', () => {
    const a = TRAITS.cover.aura!, saved = { ...a }, interval = RULES.aura.interval;
    const m0 = measureFingerprint(), p0 = pricingFingerprint();
    try {
      a.value = 0.7;
      expect(measureFingerprint()).not.toBe(m0);
      expect(pricingFingerprint()).not.toBe(p0);
      a.value = saved.value;
      a.radius = 80;
      expect(measureFingerprint()).not.toBe(m0);
      expect(pricingFingerprint()).not.toBe(p0);
      a.radius = saved.radius;
      expect(measureFingerprint()).toBe(m0);
      RULES.aura.interval = 1;
      expect(measureFingerprint()).not.toBe(m0);
    } finally {
      Object.assign(a, saved);
      RULES.aura.interval = interval;
    }
  });
});
