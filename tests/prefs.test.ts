import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadPref, savePref } from '../src/prefs';

function fakeStorage(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    map: m,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('玩家偏好存取', () => {
  it('存什么读回什么', () => {
    vi.stubGlobal('localStorage', fakeStorage());
    savePref('wheel', 'trackpad');
    expect(loadPref('wheel')).toBe('trackpad');
    savePref('wheel', 'mouse');
    expect(loadPref('wheel')).toBe('mouse');
    savePref('empty', '');
    expect(loadPref('empty')).toBe('');
  });

  it('实际的 localStorage 键是 fengyan. 加上传入的键', () => {
    const st = fakeStorage();
    vi.stubGlobal('localStorage', st);
    savePref('lockMouse', '1');
    expect([...st.map.keys()]).toEqual(['fengyan.lockMouse']);
    expect(st.map.get('fengyan.lockMouse')).toBe('1');
  });

  it('读已有的 fengyan. 键（如 fengyan.sound）', () => {
    vi.stubGlobal('localStorage', fakeStorage({ 'fengyan.sound': 'off' }));
    expect(loadPref('sound')).toBe('off');
  });

  it('不同的键互不干扰', () => {
    vi.stubGlobal('localStorage', fakeStorage());
    savePref('a', '1');
    savePref('b', '2');
    expect(loadPref('a')).toBe('1');
    expect(loadPref('b')).toBe('2');
  });

  it('没存过读到 null', () => {
    vi.stubGlobal('localStorage', fakeStorage());
    expect(loadPref('nothing')).toBeNull();
  });

  it('不带前缀的同名键不算存过', () => {
    vi.stubGlobal('localStorage', fakeStorage({ sound: 'off' }));
    expect(loadPref('sound')).toBeNull();
  });

  it('localStorage 不存在：load 返回 null、save 不抛错', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(loadPref('x')).toBeNull();
    expect(() => savePref('x', '1')).not.toThrow();
  });

  it('localStorage 抛异常：load 返回 null、save 不抛错', () => {
    const boom = () => { throw new Error('denied'); };
    vi.stubGlobal('localStorage', { getItem: boom, setItem: boom });
    expect(loadPref('x')).toBeNull();
    expect(() => savePref('x', '1')).not.toThrow();
  });
});
