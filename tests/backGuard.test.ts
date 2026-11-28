import { describe, expect, it, vi } from 'vitest';
import { BackGuard, EDGE_SWIPE_SURFACES, EDGE_SWIPE_ZONE, blocksEdgeSwipe, inEdgeZone } from '../src/backGuard';
import type { GuardWindow } from '../src/backGuard';

type Ev = 'popstate' | 'pointerdown' | 'pointerup' | 'keydown';

/**
 * 假的 window：维护一份历史记录栈（第 0 条是页面本身）。pushState 压栈并换成新记录的 state；
 * back() 弹回前一条：先把 state 换成前一条的 state，再调 popstate 监听（真实浏览器里 popstate 触发时 history.state 已经是弹回去的那条）；
 * 已经在第 0 条时再 back 就是离开了页面（left 计数）。监听按注册时的 capture 记录，摘的时候 capture 对不上就摘不掉，和真实浏览器一致。
 */
function fakeWindow(opts: { rejectPush?: boolean; /** 有值就带 navigator.userActivation（isActive 取这个值，之后可用 setActive 改）；不给就是没有这个接口的老浏览器 */ active?: boolean; noActivationApi?: boolean } = {}) {
  const entries: unknown[] = [null];
  let at = 0;
  let pushes = 0;
  let left = 0;
  const regs = new Map<Ev, { fn: () => void; capture: boolean }[]>();
  const list = (t: Ev) => regs.get(t) ?? [];
  const activation = { isActive: opts.active ?? false };
  const win: GuardWindow = {
    ...(opts.active !== undefined ? { navigator: { userActivation: activation } } : opts.noActivationApi ? { navigator: {} } : {}),
    history: {
      get state() { return entries[at]; },
      pushState(data: unknown) {
        pushes++;
        if (opts.rejectPush) throw new Error('SecurityError');
        entries.length = at + 1;
        entries.push(data);
        at++;
      },
    },
    addEventListener(type, fn, capture) {
      if (!list(type).some(r => r.fn === fn && r.capture === capture)) regs.set(type, [...list(type), { fn, capture }]);
    },
    removeEventListener(type, fn, capture) {
      regs.set(type, list(type).filter(r => !(r.fn === fn && r.capture === capture)));
    },
  };
  const fire = (t: Ev): void => {
    for (const r of [...list(t)]) r.fn();
  };
  return {
    win,
    get pushes() { return pushes; },
    get depth() { return at; },
    get left() { return left; },
    count: (t: Ev) => list(t).length,
    setActive(v: boolean) { activation.isActive = v; },
    /** 所有已注册的监听是不是都以 capture = true 注册的 */
    get allCapture() { return [...regs.values()].flat().every(r => r.capture); },
    get total() { return [...regs.values()].flat().length; },
    /** 用户操作（pointerdown / pointerup / keydown） */
    act: fire,
    back() {
      if (at > 0) at--;
      else left++;
      fire('popstate');
    },
    /** 只触发 popstate，不动历史（pushState 被拒绝的环境里用） */
    pop() { fire('popstate'); },
  };
}

describe('BackGuard 拦住返回', () => {
  it('start() 开始监听 popstate 与用户操作（pointerdown、pointerup、keydown）共 4 个，都以 capture 注册，此时不垫记录', () => {
    const f = fakeWindow();
    const g = new BackGuard(() => {}, f.win);
    expect(f.total).toBe(0);
    g.start();
    expect(f.pushes).toBe(0);
    expect(f.depth).toBe(0);
    expect(f.count('popstate')).toBe(1);
    expect(f.count('pointerdown')).toBe(1);
    expect(f.count('pointerup')).toBe(1);
    expect(f.count('keydown')).toBe(1);
    expect(f.total).toBe(4);
    expect(f.allCapture).toBe(true);
  });

  it('重复 start() 不重复监听', () => {
    const f = fakeWindow();
    const g = new BackGuard(() => {}, f.win);
    g.start();
    g.start();
    g.start();
    expect(f.total).toBe(4);
    expect(f.pushes).toBe(0);
  });

  it('用户操作（pointerdown、pointerup 或 keydown）时当前记录不是垫的就垫一条', () => {
    for (const t of ['pointerdown', 'pointerup', 'keydown'] as const) {
      const f = fakeWindow();
      new BackGuard(() => {}, f.win).start();
      f.act(t);
      expect(f.pushes, t).toBe(1);
      expect(f.depth, t).toBe(1);
      expect(f.win.history.state, t).not.toBeNull();
    }
  });

  it('已经垫着时操作不再垫：连续多次操作只垫一次', () => {
    const f = fakeWindow();
    new BackGuard(() => {}, f.win).start();
    for (let i = 0; i < 5; i++) f.act('pointerup');
    f.act('keydown');
    f.act('pointerdown');
    expect(f.pushes).toBe(1);
    expect(f.depth).toBe(1);
  });

  it('返回时调一次 onBlocked，当下不垫，页面不离开', () => {
    const f = fakeWindow();
    const onBlocked = vi.fn();
    new BackGuard(onBlocked, f.win).start();
    f.act('pointerup');
    f.back();
    expect(onBlocked).toHaveBeenCalledTimes(1);
    expect(f.pushes).toBe(1);
    expect(f.depth).toBe(0);
    expect(f.left).toBe(0);
  });

  it('返回 → 操作 → 返回 → 操作…每次都拦得住（页面一直没离开），操作时才垫回来', () => {
    const f = fakeWindow();
    const onBlocked = vi.fn();
    new BackGuard(onBlocked, f.win).start();
    f.act('pointerup');
    for (let i = 1; i <= 5; i++) {
      f.back();
      expect(onBlocked).toHaveBeenCalledTimes(i);
      expect(f.left).toBe(0);
      // 弹掉之后、玩家再操作之前没有垫着的记录
      expect(f.win.history.state).toBeNull();
      f.act(i % 2 ? 'keydown' : 'pointerup');
      expect(f.depth).toBe(1);
      expect(f.pushes).toBe(i + 1);
    }
  });

  it('返回后没操作又返回：第二次返回时没有垫着的记录（已知代价），onBlocked 仍然每次调用', () => {
    const f = fakeWindow();
    const onBlocked = vi.fn();
    new BackGuard(onBlocked, f.win).start();
    f.act('pointerup');
    f.back();
    expect(f.win.history.state).toBeNull();
    expect(f.depth).toBe(0);
    f.back();
    expect(onBlocked).toHaveBeenCalledTimes(2);
    // 期间没有再垫过
    expect(f.pushes).toBe(1);
  });

  it('start() 之后、玩家还没操作就返回：没有垫着的记录，不垫，但回调照调', () => {
    const f = fakeWindow();
    const onBlocked = vi.fn();
    new BackGuard(onBlocked, f.win).start();
    f.back();
    expect(onBlocked).toHaveBeenCalledTimes(1);
    expect(f.pushes).toBe(0);
  });

  it('当前记录已经是垫的那条（上一局留下的）时操作不再垫：start → 操作 → stop → 新的 BackGuard start → 操作，总共只垫一次', () => {
    const f = fakeWindow();
    const a = new BackGuard(() => {}, f.win);
    a.start();
    f.act('pointerup');
    a.stop();
    const b = new BackGuard(() => {}, f.win);
    b.start();
    expect(f.pushes).toBe(1);
    f.act('pointerup');
    f.act('keydown');
    expect(f.pushes).toBe(1);
    expect(f.depth).toBe(1);
  });

  it('反复开局、操作、结束也不越垫越多', () => {
    const f = fakeWindow();
    for (let i = 0; i < 5; i++) {
      const g = new BackGuard(() => {}, f.win);
      g.start();
      f.act('pointerup');
      g.stop();
    }
    expect(f.pushes).toBe(1);
    expect(f.depth).toBe(1);
  });

  it('停止后返回弹掉了垫的那条，下一局开始后第一次操作时再垫', () => {
    const f = fakeWindow();
    const a = new BackGuard(() => {}, f.win);
    a.start();
    f.act('pointerup');
    a.stop();
    f.back();
    expect(f.depth).toBe(0);
    const b = new BackGuard(() => {}, f.win);
    b.start();
    expect(f.pushes).toBe(1);
    f.act('keydown');
    expect(f.pushes).toBe(2);
    expect(f.depth).toBe(1);
  });

  it('stop() 摘掉全部监听（popstate、pointerdown、pointerup、keydown，capture 与注册时一致）', () => {
    const f = fakeWindow();
    const g = new BackGuard(() => {}, f.win);
    g.start();
    g.stop();
    expect(f.total).toBe(0);
  });

  it('stop() 之后的操作不再垫、popstate 不再回调', () => {
    const f = fakeWindow();
    const onBlocked = vi.fn();
    const g = new BackGuard(onBlocked, f.win);
    g.start();
    g.stop();
    f.act('pointerdown');
    f.act('pointerup');
    f.act('keydown');
    f.back();
    f.pop();
    expect(f.pushes).toBe(0);
    expect(onBlocked).not.toHaveBeenCalled();
  });

  it('stop() 不清历史里垫着的那条', () => {
    const f = fakeWindow();
    const g = new BackGuard(() => {}, f.win);
    g.start();
    f.act('pointerup');
    g.stop();
    expect(f.depth).toBe(1);
    expect(f.win.history.state).not.toBeNull();
  });

  it('没 start 过就 stop、重复 stop 无副作用', () => {
    const f = fakeWindow();
    const g = new BackGuard(() => {}, f.win);
    g.stop();
    expect(f.pushes).toBe(0);
    expect(f.total).toBe(0);
    g.start();
    g.stop();
    g.stop();
    expect(f.pushes).toBe(0);
    expect(f.total).toBe(0);
  });

  it('stop() 之后可以再 start()', () => {
    const f = fakeWindow();
    const onBlocked = vi.fn();
    const g = new BackGuard(onBlocked, f.win);
    g.start();
    g.stop();
    g.start();
    expect(f.total).toBe(4);
    f.act('pointerup');
    expect(f.pushes).toBe(1);
    f.back();
    expect(onBlocked).toHaveBeenCalledTimes(1);
  });

  it('pushState 抛异常时不往外抛：操作与 popstate 处理都照常完成', () => {
    const f = fakeWindow({ rejectPush: true });
    const onBlocked = vi.fn();
    const g = new BackGuard(onBlocked, f.win);
    expect(() => g.start()).not.toThrow();
    expect(f.total).toBe(4);
    expect(() => f.act('pointerup')).not.toThrow();
    expect(() => f.act('keydown')).not.toThrow();
    expect(() => f.act('pointerdown')).not.toThrow();
    expect(() => f.pop()).not.toThrow();
    expect(onBlocked).toHaveBeenCalledTimes(1);
    expect(() => f.pop()).not.toThrow();
    expect(onBlocked).toHaveBeenCalledTimes(2);
    expect(() => g.stop()).not.toThrow();
    expect(f.total).toBe(0);
  });
});

describe('BackGuard 用户激活', () => {
  const events = ['pointerdown', 'pointerup', 'keydown'] as const;

  it('浏览器有 userActivation 且此刻没激活：操作不垫（不调 pushState，当前记录保持未标记）', () => {
    for (const t of events) {
      const f = fakeWindow({ active: false });
      new BackGuard(() => {}, f.win).start();
      f.act(t);
      expect(f.pushes, t).toBe(0);
      expect(f.depth, t).toBe(0);
      expect(f.win.history.state, t).toBeNull();
    }
  });

  it('此刻有激活：照常垫，已经垫着不重复垫', () => {
    for (const t of events) {
      const f = fakeWindow({ active: true });
      new BackGuard(() => {}, f.win).start();
      f.act(t);
      f.act(t);
      expect(f.pushes, t).toBe(1);
      expect(f.depth, t).toBe(1);
    }
  });

  it('激活不在时的操作不垫，随后激活在时的操作照常垫上', () => {
    const f = fakeWindow({ active: false });
    new BackGuard(() => {}, f.win).start();
    f.act('keydown');
    f.act('pointerdown');
    expect(f.pushes).toBe(0);
    f.setActive(true);
    f.act('pointerup');
    expect(f.pushes).toBe(1);
    expect(f.depth).toBe(1);
    expect(f.win.history.state).not.toBeNull();
  });

  it('没有 navigator、或 navigator 没有 userActivation（老浏览器）：照常垫', () => {
    const none = fakeWindow();
    new BackGuard(() => {}, none.win).start();
    none.act('pointerup');
    expect(none.pushes).toBe(1);
    const old = fakeWindow({ noActivationApi: true });
    new BackGuard(() => {}, old.win).start();
    old.act('pointerup');
    expect(old.pushes).toBe(1);
  });

  it('返回被拦下后的第一下操作没激活（不垫）、第二下有激活（垫回）', () => {
    const f = fakeWindow({ active: true });
    const onBlocked = vi.fn();
    new BackGuard(onBlocked, f.win).start();
    f.act('pointerup');
    expect(f.depth).toBe(1);
    f.back();
    expect(onBlocked).toHaveBeenCalledTimes(1);
    expect(f.win.history.state).toBeNull();
    // 第一下没激活（比如按了 Esc）
    f.setActive(false);
    f.act('keydown');
    expect(f.pushes).toBe(1);
    expect(f.win.history.state).toBeNull();
    // 第二下有激活
    f.setActive(true);
    f.act('pointerdown');
    expect(f.pushes).toBe(2);
    expect(f.depth).toBe(1);
    expect(f.win.history.state).not.toBeNull();
    // 又被拦得住
    f.back();
    expect(onBlocked).toHaveBeenCalledTimes(2);
    expect(f.left).toBe(0);
  });

  it('激活不在时 pushState 也不会被试探着调用（即使会抛异常）', () => {
    const f = fakeWindow({ active: false, rejectPush: true });
    new BackGuard(() => {}, f.win).start();
    f.act('pointerup');
    expect(f.pushes).toBe(0);
  });
});

describe('inEdgeZone 边缘起手', () => {
  const W = 400;

  it('常量：离边缘 24px 以内', () => {
    expect(EDGE_SWIPE_ZONE).toBe(24);
  });

  it('左边缘 zone 以内为真，刚到 zone 不算', () => {
    expect(inEdgeZone(0, W)).toBe(true);
    expect(inEdgeZone(10, W)).toBe(true);
    expect(inEdgeZone(EDGE_SWIPE_ZONE - 1, W)).toBe(true);
    expect(inEdgeZone(EDGE_SWIPE_ZONE, W)).toBe(false);
  });

  it('右边缘 zone 以内为真，刚到 width − zone 不算', () => {
    expect(inEdgeZone(W, W)).toBe(true);
    expect(inEdgeZone(W - 10, W)).toBe(true);
    expect(inEdgeZone(W - EDGE_SWIPE_ZONE + 1, W)).toBe(true);
    expect(inEdgeZone(W - EDGE_SWIPE_ZONE, W)).toBe(false);
  });

  it('中间不是边缘', () => {
    expect(inEdgeZone(200, W)).toBe(false);
    expect(inEdgeZone(100, W)).toBe(false);
    expect(inEdgeZone(300, W)).toBe(false);
  });

  it('可以指定 zone', () => {
    expect(inEdgeZone(40, W, 50)).toBe(true);
    expect(inEdgeZone(40, W, 30)).toBe(false);
    expect(inEdgeZone(W - 40, W, 50)).toBe(true);
    expect(inEdgeZone(W - 40, W, 30)).toBe(false);
    expect(inEdgeZone(0, W, 0)).toBe(false);
  });
});

describe('EDGE_SWIPE_SURFACES', () => {
  it('是选择器，包含把手、画面画布、卡片带、独立的编队行、摇杆与小地图所在的容器', () => {
    const parts = EDGE_SWIPE_SURFACES.split(',').map(s => s.trim());
    expect(new Set(parts)).toEqual(new Set(['.handle', 'canvas.view', '.cardwrap', '.groupslots', '.mini']));
  });
});

describe('blocksEdgeSwipe 要不要拦下 touchstart 的默认行为', () => {
  const W = 400;
  /** 假元素：closest 只在自己属于 hits 里的某个界面选择器时命中（用 EDGE_SWIPE_SURFACES 里的各段判断） */
  const el = (cls: string[]): { closest(sel: string): unknown } => ({
    closest(sel: string) {
      return sel.split(',').map(s => s.trim()).some(part => cls.some(c => part === `.${c}` || part === `canvas.${c}` || part === c)) ? this : null;
    },
  });
  const surface = el(['view']);
  const other = el(['btn']);
  const touch = (clientX: number, target: unknown) => ({ clientX, target: target as EventTarget | null });
  const ev = (...ts: ReturnType<typeof touch>[]) => ({ changedTouches: ts });

  it('手指在边缘起手、且落在自己处理手指的界面上：要拦（左右两边）', () => {
    expect(blocksEdgeSwipe(ev(touch(5, surface)), W)).toBe(true);
    expect(blocksEdgeSwipe(ev(touch(W - 5, surface)), W)).toBe(true);
    expect(blocksEdgeSwipe(ev(touch(0, surface)), W)).toBe(true);
    expect(blocksEdgeSwipe(ev(touch(W, surface)), W)).toBe(true);
  });

  it('把手、卡片带、编队行、小地图容器上边缘起手同样要拦', () => {
    for (const c of ['handle', 'cardwrap', 'groupslots', 'mini']) {
      expect(blocksEdgeSwipe(ev(touch(3, el([c]))), W), c).toBe(true);
    }
  });

  it('手指不在边缘不拦，即使落在这些界面上', () => {
    expect(blocksEdgeSwipe(ev(touch(EDGE_SWIPE_ZONE, surface)), W)).toBe(false);
    expect(blocksEdgeSwipe(ev(touch(200, surface)), W)).toBe(false);
    expect(blocksEdgeSwipe(ev(touch(W - EDGE_SWIPE_ZONE, surface)), W)).toBe(false);
  });

  it('在边缘、落在这些界面里的按钮上同样要拦：这些按钮自己用 pointer 事件处理手指，不靠 click', () => {
    // 例如摇杆旁的「取消选择」和单独一行的编队卡片
    expect(blocksEdgeSwipe(ev(touch(5, el(['mini', 'button']))), W)).toBe(true);
    expect(blocksEdgeSwipe(ev(touch(W - 5, el(['mini', 'button']))), W)).toBe(true);
    expect(blocksEdgeSwipe(ev(touch(5, el(['groupslots', 'button']))), W)).toBe(true);
    expect(blocksEdgeSwipe(ev(touch(5, el(['mini']))), W)).toBe(true);
  });

  it('界面里的按钮不在边缘不拦', () => {
    expect(blocksEdgeSwipe(ev(touch(200, el(['mini', 'button']))), W)).toBe(false);
    expect(blocksEdgeSwipe(ev(touch(EDGE_SWIPE_ZONE, el(['mini', 'button']))), W)).toBe(false);
  });

  it('界面之外的按钮（不在 EDGE_SWIPE_SURFACES 里）即使在边缘也不拦', () => {
    expect(blocksEdgeSwipe(ev(touch(5, el(['button']))), W)).toBe(false);
  });

  it('在边缘但落在别的界面上（靠 click 的按钮）不拦', () => {
    expect(blocksEdgeSwipe(ev(touch(5, other)), W)).toBe(false);
    expect(blocksEdgeSwipe(ev(touch(W - 5, other)), W)).toBe(false);
  });

  it('target 为 null 或没有 closest 方法时不报错、不拦', () => {
    expect(blocksEdgeSwipe(ev(touch(5, null)), W)).toBe(false);
    expect(blocksEdgeSwipe(ev(touch(5, {})), W)).toBe(false);
  });

  it('没有新按下的手指（空列表）不拦', () => {
    expect(blocksEdgeSwipe(ev(), W)).toBe(false);
  });

  it('多根手指里只要有一根满足就拦', () => {
    expect(blocksEdgeSwipe(ev(touch(200, surface), touch(5, surface)), W)).toBe(true);
    expect(blocksEdgeSwipe(ev(touch(5, other), touch(W - 3, surface)), W)).toBe(true);
    expect(blocksEdgeSwipe(ev(touch(5, null), touch(5, surface)), W)).toBe(true);
  });

  it('多根手指都不满足不拦：一根在边缘按钮上、一根在中间的画面上', () => {
    expect(blocksEdgeSwipe(ev(touch(5, other), touch(200, surface)), W)).toBe(false);
  });

  it('视口宽度不同按各自的右边缘算', () => {
    expect(blocksEdgeSwipe(ev(touch(380, surface)), 400)).toBe(true);
    expect(blocksEdgeSwipe(ev(touch(380, surface)), 800)).toBe(false);
  });

  it('真实的选择器用在 closest 上：调用时传的就是 EDGE_SWIPE_SURFACES', () => {
    const closest = vi.fn(() => null);
    blocksEdgeSwipe(ev(touch(5, { closest })), W);
    expect(closest).toHaveBeenCalledWith(EDGE_SWIPE_SURFACES);
  });
});
