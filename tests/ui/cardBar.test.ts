import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { World } from '../../src/sim/world';
import { CardBar, allCardPicked } from '../../src/ui/cardBar';
import type { CardBarCallbacks } from '../../src/ui/cardBar';
import { HOLD_MS, TAP_SLOP } from '../../src/touchInput';
import { FakeCanvas, FakeEl, firePointer, installFakeDom, rectOf } from './fakeDom';

/*
 * 屏幕布局（竖屏）：画面 y < 500；卡片带 [500, 600]；小地图 (600, 800]；overlay 的底是 800。
 * 移动版落点（剑尖）= 手指位置 + 偏移：手指离屏幕底 150px 以外（y ≤ 650）偏移是 (0, −100)，即落点在手指正上方 100px；
 * 手指到屏幕底时偏移是 (100, 0)，落点在手指右边 100px；中间逐渐放倒。
 * 影子卡片立在手指上方：缩放 0.9，宽 60 × 0.9 = 54，左上角 x = 手指 x − 27（夹在 overlay 内），y = 手指 y − 100 + 34 = 手指 y − 66。
 */
describe('CardBar 拖卡片', () => {
  let calls: string[];
  let drops: { kind: string; id: number; x: number; y: number; target: string }[];
  let holds: { kind: string; id: number; rect: unknown }[];
  let assigned: number[];
  let taps: unknown[];
  /** cardCount 回调返回的人数（默认 5） */
  let count = 5;
  /** cardCount 被调了几次 */
  let countCalls = 0;
  let area: FakeEl, overlay: FakeEl, view: FakeCanvas, mini: FakeCanvas;
  let groupButtons: FakeEl;
  let bar: CardBar;
  let card: FakeEl, groupCard: FakeEl, allCard: FakeEl, offCard: FakeEl;
  let dom: ReturnType<typeof installFakeDom>;

  const mkCard = (data: Record<string, string>, ...classes: string[]): FakeEl => {
    const c = new FakeEl();
    c.className = ['ucard', ...classes].join(' ');
    c.offsetWidth = 60;
    c.offsetHeight = 100;
    Object.assign(c.dataset, data);
    const sel = new FakeEl('span');
    sel.className = 'sel';
    c.appendChild(sel);
    return c;
  };
  const down = (target: FakeEl | null, x: number, y: number, init: { button?: number; id?: number; pointerType?: string } = {}): Event =>
    firePointer(area, 'pointerdown', { clientX: x, clientY: y, pointerId: init.id ?? 1, button: init.button ?? 0, buttons: 1, pointerType: init.pointerType }, target ?? (bar.roster as unknown as FakeEl));
  const move = (x: number, y: number, buttons = 1): Event => firePointer(area, 'pointermove', { clientX: x, clientY: y, buttons });
  const up = (x: number, y: number): Event => firePointer(area, 'pointerup', { clientX: x, clientY: y, buttons: 0 });
  const ghost = (): FakeEl | undefined => overlay.children.find(c => c.classList.contains('ghost'));
  const sword = (): FakeEl | undefined => overlay.children.find(c => c.classList.contains('dragptr'));
  /** 剑的 transform：`translate(x px, y px) rotate(deg deg)` */
  const swordAt = (): { x: number; y: number; deg: number } => {
    const m = /^translate\((-?[\d.e-]+)px, (-?[\d.e-]+)px\) rotate\((-?[\d.e-]+)deg\)$/.exec(sword()!.style.transform);
    expect(m, sword()!.style.transform).not.toBeNull();
    return { x: Number(m![1]), y: Number(m![2]), deg: Number(m![3]) };
  };
  /** 影子卡片的 transform：`translate(x px, y px) scale(k)` */
  const ghostAt = (): { x: number; y: number; k: number } => {
    const m = /^translate\((-?[\d.e-]+)px, (-?[\d.e-]+)px\) scale\((-?[\d.]+)\)$/.exec(ghost()!.style.transform);
    expect(m, ghost()!.style.transform).not.toBeNull();
    return { x: Number(m![1]), y: Number(m![2]), k: Number(m![3]) };
  };

  /**
   * 世界里的单位：0、1 是兵种 3，2、3 是兵种 5（满血、1 级）；编队 2 是 {2, 3}。
   * 亮着不看卡片上的 on 类，按最近一次 update 给的选择判断：兵种卡片看选中的人里有没有这个兵种，编队卡片看这一队是否全都选着，全选卡片看选中态。
   */
  const world = {
    humanTeam: 1,
    type: Uint8Array.from([3, 3, 5, 5]),
    hp: new Float32Array(4).fill(100), maxHp: new Float32Array(4).fill(100),
    level: new Uint8Array(4), morale: new Float32Array(4).fill(50),
  } as unknown as World;
  /** 让选择变成 sel（屏幕内就是这些人）；update 会重建卡片，把造的卡片再挂回去 */
  const select = (sel: number[], allPicked = false): void => {
    bar.update(sel, sel, allPicked);
    (bar.roster as unknown as FakeEl).append(allCard, card, offCard);
    (bar.groupRow as unknown as FakeEl).append(groupCard);
  };

  let cbs: CardBarCallbacks;
  /** 建 CardBar 并把两排卡片放进 area（真实的 hud 也是这样挂的）；topbar 是传给构造函数的顶栏 */
  const build = (topbar: FakeEl | null = null, buttons: FakeEl | null = null): void => {
    bar = new CardBar(world, () => '', mini as unknown as HTMLCanvasElement, overlay as unknown as HTMLElement, cbs,
      area as unknown as HTMLElement, topbar as unknown as HTMLElement | null, null, buttons as unknown as HTMLElement | null);
    area.appendChild(bar.groupRow as unknown as FakeEl);
    area.appendChild(bar.roster as unknown as FakeEl);
    card = mkCard({ t: '3' });
    groupCard = mkCard({ g: '2' }, 'gcard');
    allCard = mkCard({ all: '1' }, 'acard');
    offCard = mkCard({ all: '1' }, 'acard', 'off');
    (bar.roster as unknown as FakeEl).append(allCard, card, offCard);
    (bar.groupRow as unknown as FakeEl).append(groupCard);
    bar.setGroups([{ g: 2, slots: [2, 3] }]);
  };

  /** 换成传了顶栏的 CardBar：CardBar 销毁时不摘 area 上的监听，所以连 area 一起换新的 */
  const rebuild = (topbar: FakeEl | null, mobile: boolean, buttons: FakeEl | null = null): void => {
    bar.destroy();
    area = new FakeEl();
    area.rect = rectOf(0, 500, 400, 100);
    build(topbar, buttons);
    bar.mobile = mobile;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    dom = installFakeDom(vi);
    calls = [];
    drops = [];
    holds = [];
    assigned = [];
    taps = [];
    count = 5;
    countCalls = 0;
    area = new FakeEl();
    area.rect = rectOf(0, 500, 400, 100);
    groupButtons = new FakeEl();
    overlay = new FakeEl();
    overlay.rect = rectOf(0, 0, 400, 800);
    view = new FakeCanvas();
    view.className = 'view';
    mini = new FakeCanvas();
    mini.className = 'minimap';
    // 小地图画布是方的：左上 (120, 620)、边长 180
    mini.rect = rectOf(120, 620, 180, 180);
    dom.hit.fn = (_x, y) => (y < 500 ? view : y > 600 && y <= 800 ? mini : area);
    cbs = {
      pickTypes: (types, mode) => calls.push(`types ${types.join(',')} ${mode}`),
      pickAll: mode => calls.push(`all ${mode}`),
      selectGroup: (g, jump) => calls.push(`group ${g} ${jump}`),
      unpickCard: (kind, id) => calls.push(`unpick ${kind} ${id}`),
      tapButton: btn => taps.push(btn),
      cardCount: () => {
        countCalls++;
        return count;
      },
      holdCard: (kind, id, rect) => holds.push({ kind, id, rect }),
      holdGroup: g => assigned.push(g),
      dropCard: (kind, id, x, y, target) => drops.push({ kind, id, x, y, target }),
    };
    build();
  });

  afterEach(() => {
    bar.destroy();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe('移动版', () => {
    beforeEach(() => {
      bar.mobile = true;
    });

    describe('独立一行的移动版编队卡片', () => {
      let slot: FakeEl;
      let empty: FakeEl;
      const press = (b: FakeEl): void => {
        firePointer(groupButtons, 'pointerdown', { clientX: 150, clientY: 610, buttons: 1 }, b);
      };
      const tap = (b: FakeEl): void => { press(b); up(150, 610); };

      beforeEach(() => {
        rebuild(null, true, groupButtons);
        slot = new FakeEl('button');
        slot.className = 'slot has';
        slot.dataset.g = '2';
        empty = new FakeEl('button');
        empty.className = 'slot';
        empty.dataset.g = '3';
        groupButtons.append(slot, empty);
      });

      it('点已有队伍选中，连续点同队两次跳转', () => {
        tap(slot);
        tap(slot);
        expect(calls).toEqual(['group 2 false', 'group 2 true']);
        expect(taps).toEqual([]);
      });

      it('点已经选中的队伍取消选择，再点一下可双击跳转', () => {
        select([2, 3]);
        tap(slot);
        tap(slot);
        expect(calls).toEqual(['unpick group 2', 'group 2 true']);
      });

      it('短按空队不会开始拖动，抬起只触发该空队按钮', () => {
        press(empty);
        expect(area.captured).toBe(1);
        vi.advanceTimersByTime(HOLD_MS - 1);
        move(153, 612);
        expect(ghost()).toBeUndefined();
        up(153, 612);
        expect(taps).toEqual([empty]);
        expect(assigned).toEqual([]);
        expect(holds).toEqual([]);
        expect(drops).toEqual([]);
      });

      it('按着空队时它获得成员，松手不会覆盖刚编好的队伍', () => {
        press(empty);
        empty.classList.add('has');
        up(150, 610);
        expect(taps).toEqual([]);
        expect(calls).toEqual([]);
        expect(area.captured).toBeNull();
      });

      it('按着已选中的队伍时它失去成员，松手不取消选择或编队', () => {
        select([2, 3]);
        press(slot);
        slot.classList.remove('has');
        up(150, 610);
        expect(calls).toEqual([]);
        expect(taps).toEqual([]);
        expect(area.captured).toBeNull();
      });

      it('队员已全部阵亡、按钮状态尚未刷新时，松手保留当前选择', () => {
        select([2, 3]);
        press(slot);
        count = 0;
        expect(slot.classList.contains('has')).toBe(true);
        up(150, 610);
        expect(calls).toEqual([]);
        expect(taps).toEqual([]);
      });

      it('拖动编队时切成桌面布局会释放指针并取消下令', () => {
        press(slot);
        move(190, 400);
        expect(ghost()).toBeDefined();
        expect(area.captured).toBe(1);
        bar.mobile = false;
        expect(ghost()).toBeUndefined();
        expect(area.captured).toBeNull();
        up(190, 400);
        expect(drops).toEqual([]);
        expect(calls).toEqual([]);
      });

      it('已有队伍的轻微抖动仍算点按，纵向或横向拉开才会拖队伍下令', () => {
        press(slot);
        move(153, 612);
        expect(ghost()).toBeUndefined();
        up(153, 612);
        expect(calls).toEqual(['group 2 false']);
        press(slot);
        move(190, 610);
        expect(ghost()).toBeDefined();
        expect(area.scrollLeft).toBe(0);
        move(190, 400);
        up(190, 400);
        expect(drops).toEqual([{ kind: 'group', id: 2, x: 190, y: 300, target: 'view' }]);
      });

      it.each([false, true])('长按空队或已有队伍直接编队，松手不再触发 (%s)', occupied => {
        const button = occupied ? slot : empty;
        press(button);
        vi.advanceTimersByTime(HOLD_MS - 1);
        expect(assigned).toEqual([]);
        vi.advanceTimersByTime(1);
        expect(assigned).toEqual([Number(button.dataset.g)]);
        up(150, 610);
        expect(assigned).toHaveLength(1);
        expect(taps).toEqual([]);
        expect(holds).toEqual([]);
        expect(calls).toEqual([]);
      });

      it('按住空队后滑开，超过长按门槛也不会编队', () => {
        press(empty);
        move(150 + TAP_SLOP + 1, 610);
        vi.advanceTimersByTime(HOLD_MS);
        up(150 + TAP_SLOP + 1, 610);
        expect(assigned).toEqual([]);
        expect(taps).toEqual([]);
      });
    });

    describe('按中反馈', () => {
      it('在卡片上按下那张卡加 hot 类，松手后去掉', () => {
        down(card, 100, 550);
        expect(card.classList.contains('hot')).toBe(true);
        expect(allCard.classList.contains('hot')).toBe(false);
        up(100, 550);
        expect(card.classList.contains('hot')).toBe(false);
      });

      it('取消（pointercancel）后去掉', () => {
        down(card, 100, 550);
        firePointer(area, 'pointercancel', { pointerId: 1 });
        expect(card.classList.contains('hot')).toBe(false);
      });

      it('指针捕获丢失（lostpointercapture）后去掉', () => {
        down(card, 100, 550);
        firePointer(area, 'lostpointercapture', { pointerId: 1 });
        expect(card.classList.contains('hot')).toBe(false);
      });

      it('拖出去之后松手也去掉', () => {
        down(card, 100, 550);
        move(100, 300);
        up(100, 300);
        expect(card.classList.contains('hot')).toBe(false);
      });

      it('按在空隙上没有卡片加 hot', () => {
        down(null, 100, 550);
        for (const c of [card, allCard, groupCard]) expect(c.classList.contains('hot')).toBe(false);
      });
    });

    describe('按中反馈与起手', () => {
      it('判成滚动时立刻去掉 hot，滚动中不再亮着', () => {
        down(card, 200, 550);
        expect(card.classList.contains('hot')).toBe(true);
        move(150, 551);
        expect(card.classList.contains('hot')).toBe(false);
        move(100, 552);
        expect(card.classList.contains('hot')).toBe(false);
        up(100, 552);
        expect(card.classList.contains('hot')).toBe(false);
      });

      it('滚动后竖向离开卡片带改判成拖，也不再加回 hot', () => {
        down(card, 200, 550);
        move(150, 550);
        move(140, 450);
        expect(ghost()).toBeDefined();
        expect(card.classList.contains('hot')).toBe(false);
        move(140, 300);
        expect(card.classList.contains('hot')).toBe(false);
        up(140, 300);
        expect(card.classList.contains('hot')).toBe(false);
      });

      it('还在 wait（没到起手阈值）时保持 hot', () => {
        down(card, 200, 550);
        move(203, 551);
        expect(card.classList.contains('hot')).toBe(true);
      });

      it('判成拖时保持 hot 直到松手 / 取消', () => {
        down(card, 200, 550);
        move(200, 450);
        expect(ghost()).toBeDefined();
        expect(card.classList.contains('hot')).toBe(true);
        move(210, 300);
        expect(card.classList.contains('hot')).toBe(true);
        firePointer(area, 'pointercancel', { pointerId: 1 });
        expect(card.classList.contains('hot')).toBe(false);
      });

      it('只去掉被按那张的 hot，不影响框选时亮起的别的卡片', () => {
        allCard.classList.add('hot');
        down(card, 200, 550);
        move(150, 550);
        expect(allCard.classList.contains('hot')).toBe(true);
      });
    });

    describe('起手判定', () => {
      it('位移还没到起手阈值，不出影子也不滚动', () => {
        down(card, 100, 550);
        move(103, 548);
        expect(ghost()).toBeUndefined();
        expect(sword()).toBeUndefined();
        expect(area.scrollLeft).toBe(0);
      });

      it('横向明显占主导是滚动卡片带，scrollLeft 跟着手指，不出影子', () => {
        area.scrollLeft = 100;
        down(card, 200, 550);
        move(150, 552);
        expect(area.scrollLeft).toBe(150);
        expect(ghost()).toBeUndefined();
        move(260, 551);
        expect(area.scrollLeft).toBe(40);
        expect(ghost()).toBeUndefined();
      });

      it('斜着起手（横向略多）判成拖卡片：出影子与剑', () => {
        down(card, 100, 550);
        move(110, 542);
        expect(ghost()).toBeDefined();
        expect(sword()).toBeDefined();
        expect(area.scrollLeft).toBe(0);
      });

      it('竖直起手是拖卡片', () => {
        down(card, 100, 550);
        move(100, 520);
        expect(ghost()).toBeDefined();
      });

      it('判成滚动后手指竖向离开卡片带（上方）就改成拖卡片，scrollLeft 还原成按下时的值', () => {
        area.scrollLeft = 100;
        down(card, 200, 550);
        move(150, 550);
        expect(area.scrollLeft).toBe(150);
        expect(ghost()).toBeUndefined();
        move(140, 480);
        expect(area.scrollLeft).toBe(100);
        expect(ghost()).toBeDefined();
        expect(sword()).toBeDefined();
      });

      it('判成滚动后手指竖向离开卡片带（下方）同样改成拖卡片', () => {
        area.scrollLeft = 100;
        down(card, 200, 550);
        move(150, 550);
        move(150, 620);
        expect(area.scrollLeft).toBe(100);
        expect(ghost()).toBeDefined();
      });

      it('改成拖之后不再滚动：手指继续横向移动 scrollLeft 不变', () => {
        area.scrollLeft = 100;
        down(card, 200, 550);
        move(150, 550);
        move(150, 480);
        move(50, 480);
        move(250, 480);
        expect(area.scrollLeft).toBe(100);
      });

      it('滚动中手指仍在卡片带里（边界上）不改判', () => {
        down(card, 200, 550);
        move(150, 550);
        move(140, 500);
        move(120, 600);
        expect(ghost()).toBeUndefined();
        expect(area.scrollLeft).toBe(80);
      });

      it('按在卡片之间的空隙上只能滚动，离开卡片带也不会变成拖', () => {
        area.scrollLeft = 100;
        down(null, 200, 550);
        move(180, 550);
        expect(area.scrollLeft).toBe(120);
        move(180, 300);
        expect(ghost()).toBeUndefined();
        expect(sword()).toBeUndefined();
        expect(area.scrollLeft).toBe(120);
        up(180, 300);
        expect(drops).toEqual([]);
        expect(calls).toEqual([]);
      });

      it('空隙上竖直起手也不变成拖', () => {
        down(null, 200, 550);
        move(200, 300);
        expect(ghost()).toBeUndefined();
      });

      it('禁用的全选卡片（off）当作按在空隙上：不加 hot、拖不起来', () => {
        down(offCard, 200, 550);
        expect(offCard.classList.contains('hot')).toBe(false);
        move(200, 300);
        expect(ghost()).toBeUndefined();
        up(200, 300);
        expect(drops).toEqual([]);
      });
    });

    describe('拖卡片：影子、剑与落点', () => {
      it('overlay 里出现卡片的影子和一把剑；影子去掉了选中态与「选 N」角标；剑上设了 --reach 为 100px', () => {
        card.classList.add('on', 'hover');
        down(card, 100, 550);
        move(100, 300);
        const g = ghost()!;
        expect(g.classList.contains('ucard')).toBe(true);
        expect(g.classList.contains('on')).toBe(false);
        expect(g.classList.contains('hot')).toBe(false);
        expect(g.querySelector('.sel')).toBeNull();
        expect(g.dataset.t).toBe('3');
        expect(sword()!.className).toContain('dragptr');
        expect(sword()!.style.getPropertyValue('--reach')).toBe('100px');
        // 原卡片还在
        expect(card.parent).not.toBeNull();
      });

      it('手指离屏幕底 150px 以外：落点（剑尖）在手指正上方 100px，剑朝上（rotate 45deg）', () => {
        down(card, 100, 550);
        move(120, 300);
        const s = swordAt();
        expect(s.x).toBeCloseTo(120);
        expect(s.y).toBeCloseTo(200);
        expect(s.deg).toBeCloseTo(45);
      });

      it('不再与卡片带有关：手指还在卡片带里时落点就已经在手指上方 100px', () => {
        down(card, 100, 550);
        move(100, 520);
        const s = swordAt();
        expect(s.x).toBeCloseTo(100);
        expect(s.y).toBeCloseTo(420);
        move(100, 600);
        expect(swordAt().y).toBeCloseTo(500);
      });

      it('影子卡片立在手指上方：缩放 0.9、左右以手指居中、上沿在手指 y − 100 + 34', () => {
        down(card, 100, 550);
        move(120, 300);
        const g = ghostAt();
        expect(g.k).toBe(0.9);
        expect(g.x).toBeCloseTo(120 - 27);
        expect(g.y).toBeCloseTo(300 - 100 + 34);
      });

      it('手指贴近屏幕顶：影子上沿停在 overlay 上沿（不伸出屏幕），左右夹取不变，剑与落点不变', () => {
        down(card, 110, 550);
        // 手指 y = 100：上沿 100 − 66 = 34，还没到顶
        move(110, 100);
        expect(ghostAt().y).toBeCloseTo(34);
        // 手指 y = 50：上沿本来是 −16，停在 0
        move(110, 50);
        expect(ghostAt().y).toBeCloseTo(0);
        expect(ghostAt().x).toBeCloseTo(110 - 27);
        // 剑朝上，剑尖仍在手指上方 100px（超出屏幕顶）
        const s = swordAt();
        expect(s.x).toBeCloseTo(110);
        expect(s.y).toBeCloseTo(-50);
        move(110, 0);
        expect(ghostAt().y).toBeCloseTo(0);
        move(5, 0);
        expect(ghostAt().x).toBeCloseTo(0);
      });

      it('overlay 上沿不在 0 时，卡片上沿夹在 overlay 的上沿', () => {
        overlay.rect = rectOf(0, 30, 400, 770);
        down(card, 110, 550);
        move(110, 60);
        expect(ghostAt().y).toBeCloseTo(30);
        move(110, 200);
        expect(ghostAt().y).toBeCloseTo(200 - 66);
      });

      describe('顶栏（构造函数传入的 topbar）', () => {
        let topbar: FakeEl;
        beforeEach(() => {
          topbar = new FakeEl();
          topbar.className = 'panel topbar';
          topbar.rect = rectOf(0, 0, 400, 60);
          rebuild(topbar, true);
        });

        it('顶栏在 overlay 里但没传给构造函数时不生效；没传顶栏就只看 overlay 上沿', () => {
          rebuild(null, true);
          overlay.appendChild(topbar);
          down(card, 110, 550);
          move(110, 50);
          expect(ghostAt().y).toBeCloseTo(0);
        });

        it('卡片上沿不高于顶栏下沿：y = max(overlay 上沿, 顶栏下沿, 手指 y − 66)', () => {
          down(card, 110, 550);
          move(110, 100);
          expect(ghostAt().y).toBeCloseTo(60);
          move(110, 20);
          expect(ghostAt().y).toBeCloseTo(60);
          // 手指 y = 126：上沿刚好 60；再往下就跟手指
          move(110, 126);
          expect(ghostAt().y).toBeCloseTo(60);
          move(110, 200);
          expect(ghostAt().y).toBeCloseTo(134);
        });

        it('左右夹取、剑与落点不变', () => {
          down(card, 110, 550);
          move(110, 50);
          expect(ghostAt().x).toBeCloseTo(110 - 27);
          const s = swordAt();
          expect(s.x).toBeCloseTo(110);
          expect(s.y).toBeCloseTo(-50);
          move(5, 50);
          expect(ghostAt().x).toBeCloseTo(0);
        });

        it('顶栏下沿比 overlay 上沿还靠上时以 overlay 上沿为准', () => {
          topbar.rect = rectOf(0, -80, 400, 60);
          down(card, 110, 550);
          move(110, 50);
          expect(ghostAt().y).toBeCloseTo(0);
        });

        it('顶栏下沿在拖拽开始时取一次：拖拽中顶栏变了不影响这一次', () => {
          down(card, 110, 550);
          move(110, 300);
          topbar.rect = rectOf(0, 0, 400, 200);
          move(110, 100);
          expect(ghostAt().y).toBeCloseTo(60);
          up(110, 100);
          // 下一次拖拽开始时重新取
          down(card, 110, 550);
          move(110, 300);
          move(110, 100);
          expect(ghostAt().y).toBeCloseTo(200);
        });

        it('松手后的下一次拖拽拿到新的顶栏位置（顶栏变矮后上沿跟着降）', () => {
          topbar.rect = rectOf(0, 0, 400, 90);
          down(card, 110, 550);
          move(110, 100);
          expect(ghostAt().y).toBeCloseTo(90);
        });
      });

      it('影子不跟着落点走：手指在屏幕底时剑放倒朝右，影子仍按手指位置放', () => {
        down(card, 110, 550);
        move(110, 800);
        const g = ghostAt();
        expect(g.x).toBeCloseTo(110 - 27);
        expect(g.y).toBeCloseTo(800 - 66);
      });

      it('影子左右夹在 overlay 内，不伸出屏幕', () => {
        overlay.rect = rectOf(20, 0, 380, 800);
        down(card, 60, 550);
        move(25, 300);
        expect(ghostAt().x).toBeCloseTo(20);
        move(395, 300);
        // 右边界 400 − 54 = 346
        expect(ghostAt().x).toBeCloseTo(346);
        move(200, 300);
        expect(ghostAt().x).toBeCloseTo(173);
      });

      it('跟着手指移动更新', () => {
        down(card, 100, 550);
        move(100, 300);
        move(200, 100);
        const s = swordAt();
        expect(s.x).toBeCloseTo(200);
        expect(s.y).toBeCloseTo(0);
        expect(ghostAt().x).toBeCloseTo(173);
        expect(ghostAt().y).toBeCloseTo(34);
      });

      it('手指进到屏幕底以上 150px 以内，剑逐渐向右放倒：一半深度时 45 度（rotate 90deg）', () => {
        down(card, 110, 550);
        move(110, 725);
        const s = swordAt();
        expect(s.x).toBeCloseTo(110 + 100 * Math.SQRT1_2);
        expect(s.y).toBeCloseTo(725 - 100 * Math.SQRT1_2);
        expect(s.deg).toBeCloseTo(90);
        // 剑柄始终正对手指：从落点指回手指的方向 = rotate + 45
        expect(Math.atan2(725 - s.y, 110 - s.x) * 180 / Math.PI - 45).toBeCloseTo(s.deg);
      });

      it('手指到屏幕底时剑水平朝右（rotate 135deg），落点的 y 也在屏幕底', () => {
        down(card, 110, 550);
        move(110, 800);
        const s = swordAt();
        expect(s.x).toBeCloseTo(210);
        expect(s.y).toBeCloseTo(800);
        expect(s.deg).toBeCloseTo(135);
      });

      it('落点离手指始终是 100px，剑只朝上或朝右', () => {
        down(card, 110, 550);
        for (let y = 300; y <= 800; y += 25) {
          move(110, y);
          const s = swordAt();
          expect(Math.hypot(s.x - 110, s.y - y), `y=${y}`).toBeCloseTo(100);
          expect(s.x, `y=${y}`).toBeGreaterThanOrEqual(110 - 1e-9);
          expect(s.y, `y=${y}`).toBeLessThanOrEqual(y + 1e-9);
        }
      });

      it('落点在画面上时影子和剑都没有 nodrop；在小地图上也没有', () => {
        down(card, 110, 550);
        move(110, 300);
        expect(ghost()!.classList.contains('nodrop')).toBe(false);
        expect(sword()!.classList.contains('nodrop')).toBe(false);
        // 手指贴着屏幕底：落点在手指右边，落在小地图画布内
        move(110, 790);
        expect(ghost()!.classList.contains('nodrop')).toBe(false);
        expect(sword()!.classList.contains('nodrop')).toBe(false);
      });

      it('落点处不是画面也不是小地图（落在卡片带上）时影子和剑都有 nodrop，回到画面上就去掉', () => {
        down(card, 100, 550);
        // 手指 y=650：落点 y=550，在卡片带上
        move(100, 650);
        expect(ghost()!.classList.contains('nodrop')).toBe(true);
        expect(sword()!.classList.contains('nodrop')).toBe(true);
        move(100, 300);
        expect(ghost()!.classList.contains('nodrop')).toBe(false);
        expect(sword()!.classList.contains('nodrop')).toBe(false);
      });

      it('判断落点用的是落点坐标，不是手指坐标', () => {
        const seen: [number, number][] = [];
        dom.hit.fn = (x, y) => {
          seen.push([x, y]);
          return y < 500 ? view : null;
        };
        down(card, 100, 550);
        move(100, 300);
        const [x, y] = seen[seen.length - 1];
        expect(x).toBeCloseTo(100);
        expect(y).toBeCloseTo(200);
      });

      it('手指贴着屏幕底也指得到小地图的下半部：落点是 mini，没有 nodrop', () => {
        // 手指 y=790 时落点约 (x + 99, 780)，在小地图画布内
        down(card, 110, 550);
        move(110, 790);
        expect(ghost()!.classList.contains('nodrop')).toBe(false);
        up(110, 790);
        expect(drops).toHaveLength(1);
        expect(drops[0].target).toBe('mini');
        expect(drops[0].y).toBeGreaterThan(770);
      });

      it.each([true, false])('剑尖靠近小地图左下角时，按画布边界判定命中 (%s)', inside => {
        // 剑尖落在约 (209, 780)，分别在画布左缘以内和以外。
        mini.rect = rectOf(inside ? 205 : 215, 620, 180, 180);
        dom.hit.fn = (x, y) => {
          const r = mini.rect;
          return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom ? mini : null;
        };
        down(card, 110, 550);
        move(110, 790);
        expect(ghost()!.classList.contains('nodrop')).toBe(!inside);
        expect(sword()!.classList.contains('nodrop')).toBe(!inside);
        up(110, 790);
        if (inside) expect(drops).toMatchObject([{ kind: 'type', id: 3, target: 'mini' }]);
        else expect(drops).toEqual([]);
        expect(overlay.children).toHaveLength(0);
      });

      it('落在别的画布上（不是画面也不是小地图）是 nodrop', () => {
        const other = new FakeCanvas();
        other.className = 'other';
        dom.hit.fn = () => other;
        down(card, 100, 550);
        move(100, 300);
        expect(ghost()!.classList.contains('nodrop')).toBe(true);
      });

      it('全选卡片的影子把士气换回「拖去下令」', () => {
        const mor = new FakeEl('span');
        mor.className = 'nm mor bad';
        mor.textContent = '士气 30';
        allCard.appendChild(mor);
        down(allCard, 100, 550);
        move(100, 300);
        const m = ghost()!.querySelector('.mor');
        expect(m).toBeNull();
        const nm = ghost()!.children.find(c => c.textContent === '拖去下令');
        expect(nm).toBeDefined();
        expect(nm!.className).toBe('nm');
      });
    });

    describe('离开按下处才下令（DROP_ARM = 28）', () => {
      it('手指离按下处不到 28px：即使落点在画面上，影子和剑也有 nodrop', () => {
        down(card, 100, 550);
        move(100, 530);
        expect(ghost()).toBeDefined();
        expect(ghost()!.classList.contains('nodrop')).toBe(true);
        expect(sword()!.classList.contains('nodrop')).toBe(true);
      });

      it('到 28px 就算（含刚好 28），nodrop 去掉', () => {
        down(card, 100, 550);
        move(100, 530);
        move(100, 522);
        expect(ghost()!.classList.contains('nodrop')).toBe(false);
        expect(sword()!.classList.contains('nodrop')).toBe(false);
      });

      it('按直线距离算：斜着离开 20 横 20 竖（约 28.3）就够', () => {
        down(card, 100, 550);
        move(120, 530);
        expect(ghost()!.classList.contains('nodrop')).toBe(false);
      });

      it('不足 28px 松手：不下令（当作取消），影子和剑移除', () => {
        down(card, 100, 550);
        move(100, 530);
        up(100, 530);
        expect(drops).toEqual([]);
        expect(calls).toEqual([]);
        expect(overlay.children).toHaveLength(0);
      });

      it('够 28px 松手：照常下令，传落点坐标', () => {
        down(card, 100, 550);
        move(100, 522);
        up(100, 522);
        expect(drops).toHaveLength(1);
        expect(drops[0]).toMatchObject({ kind: 'type', id: 3, target: 'view' });
        expect(drops[0].x).toBeCloseTo(100);
        expect(drops[0].y).toBeCloseTo(422);
      });

      it('拖出去再拖回按下处附近松手：取消，影子和剑又带 nodrop', () => {
        down(card, 100, 550);
        move(100, 300);
        expect(ghost()!.classList.contains('nodrop')).toBe(false);
        move(105, 540);
        expect(ghost()!.classList.contains('nodrop')).toBe(true);
        up(105, 540);
        expect(drops).toEqual([]);
      });

      it('以按下处（不是滚动前的位置）为基准：滚动改拖后离按下处够远就能下令', () => {
        down(card, 200, 550);
        move(150, 550);
        move(150, 450);
        expect(ghost()!.classList.contains('nodrop')).toBe(false);
      });
    });

    describe('松手', () => {
      it('落点在画面上：回调 dropCard，传落点坐标而不是手指坐标', () => {
        down(card, 100, 550);
        move(120, 300);
        up(120, 300);
        expect(drops).toHaveLength(1);
        expect(drops[0]).toMatchObject({ kind: 'type', id: 3, target: 'view' });
        expect(drops[0].x).toBeCloseTo(120);
        expect(drops[0].y).toBeCloseTo(200);
        expect(calls).toEqual([]);
      });

      it('落点在小地图上：target 是 mini', () => {
        down(card, 110, 550);
        move(110, 790);
        up(110, 790);
        expect(drops).toHaveLength(1);
        expect(drops[0]).toMatchObject({ kind: 'type', id: 3, target: 'mini' });
        // 手指 y=790 离屏幕底 10px：转了 (150 − 10) / 150 的 90 度
        const a = (140 / 150) * Math.PI / 2;
        expect(drops[0].x).toBeCloseTo(110 + 100 * Math.sin(a));
        expect(drops[0].y).toBeCloseTo(790 - 100 * Math.cos(a));
      });

      it('松手点与最后一次移动点不同时按松手点算落点', () => {
        down(card, 100, 550);
        move(100, 300);
        up(180, 200);
        expect(drops).toHaveLength(1);
        expect(drops[0].x).toBeCloseTo(180);
        expect(drops[0].y).toBeCloseTo(100);
      });

      it('编队卡片与全选卡片的 kind / id', () => {
        down(groupCard, 100, 550);
        move(100, 300);
        up(100, 300);
        down(allCard, 100, 550);
        move(100, 300);
        up(100, 300);
        expect(drops.map(d => [d.kind, d.id])).toEqual([['group', 2], ['all', -1]]);
      });

      it('落点不在画面 / 小地图上就取消，不回调', () => {
        down(card, 100, 550);
        // 手指 y=650：落点 y=550，在卡片带上
        move(100, 650);
        up(100, 650);
        expect(drops).toEqual([]);
        expect(calls).toEqual([]);
      });

      it('松手 / 取消后影子和剑都从页面移除', () => {
        down(card, 100, 550);
        move(100, 300);
        up(100, 300);
        expect(overlay.children).toHaveLength(0);
        down(card, 100, 550);
        move(100, 300);
        expect(overlay.children).toHaveLength(2);
        firePointer(area, 'pointercancel', { pointerId: 1 });
        expect(overlay.children).toHaveLength(0);
      });

      it('取消后再松手不回调', () => {
        down(card, 100, 550);
        move(100, 300);
        firePointer(area, 'pointercancel', { pointerId: 1 });
        up(100, 300);
        expect(drops).toEqual([]);
      });

      it('窗口失去焦点取消拖拽', () => {
        down(card, 100, 550);
        move(100, 300);
        dom.win.dispatchEvent(new Event('blur'));
        expect(overlay.children).toHaveLength(0);
        expect(card.classList.contains('hot')).toBe(false);
      });

      it('按 Esc 取消拖拽', () => {
        down(card, 100, 550);
        move(100, 300);
        const e = new Event('keydown', { cancelable: true });
        Object.defineProperty(e, 'key', { value: 'Escape' });
        dom.win.dispatchEvent(e);
        expect(overlay.children).toHaveLength(0);
        up(100, 300);
        expect(drops).toEqual([]);
      });

      it('滚动卡片带后松手不算点也不下令', () => {
        down(card, 200, 550);
        move(100, 550);
        up(100, 550);
        expect(calls).toEqual([]);
        expect(drops).toEqual([]);
      });

      it('从卡片带滚动改成拖，在画面上松手能下令', () => {
        area.scrollLeft = 100;
        down(card, 200, 550);
        move(150, 550);
        move(140, 450);
        up(140, 450);
        expect(area.scrollLeft).toBe(100);
        expect(drops).toHaveLength(1);
        expect(drops[0]).toMatchObject({ kind: 'type', id: 3, target: 'view' });
        expect(drops[0].x).toBeCloseTo(140);
        expect(drops[0].y).toBeCloseTo(350);
      });

      it('同一次拖动里手指回到按下处附近再松手：取消', () => {
        down(card, 100, 550);
        move(100, 300);
        move(100, 560);
        up(100, 560);
        expect(drops).toEqual([]);
      });
    });

    describe('点按', () => {
      it('没拖动的点按仍然选中：兵种卡片 / 编队卡片 / 全选卡片', () => {
        down(card, 100, 550);
        up(100, 550);
        down(groupCard, 100, 550);
        up(100, 550);
        down(allCard, 100, 550);
        up(100, 550);
        expect(calls).toEqual(['types 3 replace', 'group 2 false', 'all replace']);
        expect(drops).toEqual([]);
      });

      it('点按时手指抖了几像素（没到起手阈值）仍是点按', () => {
        down(card, 100, 550);
        move(103, 552);
        up(103, 552);
        expect(calls).toEqual(['types 3 replace']);
      });
    });

    describe('mapSide：剑往小地图那一侧放倒', () => {
      it('默认是 1（右）', () => {
        expect(bar.mapSide).toBe(1);
      });

      it('mapSide = −1：手指到屏幕底时剑水平朝左，落点在手指左边 100px、y 在屏幕底', () => {
        bar.mapSide = -1;
        down(card, 210, 550);
        move(210, 800);
        const s = swordAt();
        expect(s.x).toBeCloseTo(110);
        expect(s.y).toBeCloseTo(800);
        expect(s.deg).toBeCloseTo(-45);
      });

      it('mapSide = −1：一半深度时向左 45 度，与 1 时左右镜像', () => {
        down(card, 210, 550);
        move(210, 725);
        const r = swordAt();
        up(210, 725);
        bar.mapSide = -1;
        down(card, 210, 550);
        move(210, 725);
        const l = swordAt();
        expect(l.x - 210).toBeCloseTo(-(r.x - 210));
        expect(l.y).toBeCloseTo(r.y);
      });

      it('mapSide = −1：手指离屏幕底 150px 以外时剑照旧竖直朝上', () => {
        bar.mapSide = -1;
        down(card, 210, 550);
        move(210, 400);
        const s = swordAt();
        expect(s.x).toBeCloseTo(210);
        expect(s.y).toBeCloseTo(300);
      });

      it('mapSide = −1：向左的剑尖落在小地图上，默认向右的剑尖落在画布外', () => {
        dom.hit.fn = (x, y) => {
          const r = mini.rect;
          return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom ? mini : null;
        };
        // 手指 (290, 750)：离屏幕底 50，转 60 度，偏移 (∓86.6, −50)
        down(card, 290, 550);
        move(290, 750);
        up(290, 750);
        expect(drops).toEqual([]);
        bar.mapSide = -1;
        down(card, 290, 550);
        move(290, 750);
        up(290, 750);
        expect(drops).toHaveLength(1);
        expect(drops[0]).toMatchObject({ kind: 'type', id: 3, target: 'mini' });
        expect(drops[0].x).toBeCloseTo(290 - 100 * Math.sin(Math.PI / 3));
        expect(drops[0].y).toBeCloseTo(750 - 50);
      });
    });

    describe('卡片带里的按钮（取消选择）', () => {
      let btn: FakeEl;
      beforeEach(() => {
        btn = new FakeEl('button');
        btn.className = 'desel';
        area.appendChild(btn);
      });

      const f = (type: string, id: number, x: number, y: number, target?: FakeEl, extra: { button?: number } = {}): Event =>
        firePointer(area, type, { clientX: x, clientY: y, pointerId: id, buttons: type === 'pointerup' ? 0 : 1, ...extra }, target);

      it('在按钮上按下：占住卡片带（busy）、按钮带 down 类、捕获指针、阻止默认行为、卡片没有 hot', () => {
        const e = down(btn, 30, 550);
        expect(bar.busy).toBe(true);
        expect(btn.classList.contains('down')).toBe(true);
        expect(area.captured).toBe(1);
        expect(e.defaultPrevented).toBe(true);
        for (const c of [card, allCard, groupCard]) expect(c.classList.contains('hot')).toBe(false);
      });

      it('按在按钮的子节点（<b>✕</b>）上同样受理，down 类加在按钮上', () => {
        const inner = new FakeEl('b');
        btn.appendChild(inner);
        down(inner, 30, 550);
        expect(bar.busy).toBe(true);
        expect(btn.classList.contains('down')).toBe(true);
        up(30, 550);
        expect(taps).toEqual([btn]);
      });

      it('同一指针抬起且没滑开：回调 tapButton(按钮)，去掉 down 类、释放指针、不再 busy', () => {
        down(btn, 30, 550);
        up(30, 550);
        expect(taps).toEqual([btn]);
        expect(btn.classList.contains('down')).toBe(false);
        expect(bar.busy).toBe(false);
        expect(area.captured).toBeNull();
        expect(calls).toEqual([]);
      });

      it('抬起时按钮已 disabled：不回调', () => {
        down(btn, 30, 550);
        btn.disabled = true;
        up(30, 550);
        expect(taps).toEqual([]);
        expect(btn.classList.contains('down')).toBe(false);
      });

      it('移动不超过 TAP_SLOP 仍是点；超过就只作废这一下点按：去掉 down 类、抬起不回调，卡片带仍归这根手指（busy 保持）直到抬起', () => {
        down(btn, 30, 550);
        move(30 + TAP_SLOP, 550);
        expect(btn.classList.contains('down')).toBe(true);
        up(30 + TAP_SLOP, 550);
        expect(taps).toEqual([btn]);
        taps.length = 0;
        down(btn, 30, 550);
        move(30 + TAP_SLOP + 1, 550);
        expect(btn.classList.contains('down')).toBe(false);
        expect(bar.busy).toBe(true);
        up(30 + TAP_SLOP + 1, 550);
        expect(taps).toEqual([]);
        expect(bar.busy).toBe(false);
      });

      it('作废之后第二指按卡片 / 按钮仍被忽略：拖卡片不出影子、不下令；第一指抬起后才恢复', () => {
        f('pointerdown', 1, 30, 550, btn);
        f('pointermove', 1, 80, 550);
        f('pointerdown', 2, 100, 550, card);
        f('pointermove', 2, 100, 300);
        f('pointerup', 2, 100, 300);
        f('pointerdown', 2, 30, 550, btn);
        f('pointerup', 2, 30, 550);
        expect(ghost()).toBeUndefined();
        expect(drops).toEqual([]);
        expect(calls).toEqual([]);
        expect(taps).toEqual([]);
        expect(bar.busy).toBe(true);
        f('pointerup', 1, 80, 550);
        expect(bar.busy).toBe(false);
        expect(taps).toEqual([]);
        down(card, 100, 550);
        move(100, 300);
        expect(ghost()).toBeDefined();
      });

      it.each([3, 5, 9])('buttons = %i（补按右键 / 中键…）：作废这一下点按，卡片带仍归这根手指', buttons => {
        down(btn, 30, 550);
        move(30, 550, buttons);
        expect(btn.classList.contains('down')).toBe(false);
        expect(bar.busy).toBe(true);
        up(30, 550);
        expect(taps).toEqual([]);
        expect(bar.busy).toBe(false);
      });

      it('补按别的键还清双击记录、结束冻结：单击亮着的全选（冻结）→ 按住按钮补按右键 → 350ms 内再单击全选是普通单击', () => {
        select([0], true);
        down(allCard, 100, 550);
        up(100, 550);
        expect(allCard.classList.contains('pending')).toBe(true);
        down(btn, 30, 550);
        move(30, 550, 3);
        expect(allCard.classList.contains('pending')).toBe(false);
        up(30, 550);
        down(allCard, 100, 550);
        up(100, 550);
        expect(calls).toEqual(['unpick all -1', 'unpick all -1']);
      });

      describe('按住按钮时的右键菜单（window contextmenu）', () => {
        /** window 上的 contextmenu；pointerId 不给就是没有这个字段（旧浏览器） */
        const menu = (pointerId?: number, init: { button?: number; buttons?: number } = { button: 2 }): Event => {
          const e = new Event('contextmenu', { cancelable: true });
          if (pointerId !== undefined) Object.defineProperty(e, 'pointerId', { value: pointerId });
          for (const [k, v] of Object.entries(init)) Object.defineProperty(e, k, { value: v });
          dom.win.dispatchEvent(e);
          return e;
        };
        const mouse = { pointerType: 'mouse' };
        const touch = { pointerType: 'touch' };

        it('按着按钮时收到 contextmenu：拦下菜单；只作废这一下（去掉 down、抬起不回调），卡片带仍归这根手指', () => {
          down(btn, 30, 550, mouse);
          const e = menu();
          expect(e.defaultPrevented).toBe(true);
          expect(btn.classList.contains('down')).toBe(false);
          expect(bar.busy).toBe(true);
          up(30, 550);
          expect(taps).toEqual([]);
          expect(bar.busy).toBe(false);
        });

        it('作废后其它指针按卡片 / 按钮仍被忽略，直到第一指抬起', () => {
          firePointer(area, 'pointerdown', { clientX: 30, clientY: 550, pointerId: 1, buttons: 1, ...mouse }, btn);
          menu();
          firePointer(area, 'pointerdown', { clientX: 100, clientY: 550, pointerId: 2, buttons: 1 }, card);
          firePointer(area, 'pointermove', { clientX: 100, clientY: 300, pointerId: 2, buttons: 1 });
          expect(ghost()).toBeUndefined();
          firePointer(area, 'pointerup', { clientX: 100, clientY: 300, pointerId: 2, buttons: 0 });
          expect(drops).toEqual([]);
          expect(bar.busy).toBe(true);
          firePointer(area, 'pointerup', { clientX: 30, clientY: 550, pointerId: 1, buttons: 0 });
          expect(bar.busy).toBe(false);
        });

        it('清双击记录、结束冻结：单击亮着的全选（冻结）→ 按住按钮 contextmenu → 350ms 内再单击全选是普通单击', () => {
          select([0], true);
          down(allCard, 100, 550);
          up(100, 550);
          expect(allCard.classList.contains('pending')).toBe(true);
          down(btn, 30, 550, mouse);
          menu();
          expect(allCard.classList.contains('pending')).toBe(false);
          up(30, 550);
          down(allCard, 100, 550);
          up(100, 550);
          expect(calls).toEqual(['unpick all -1', 'unpick all -1']);
        });

        it('按在卡片上收到 contextmenu：照旧取消这一按（影子消失、松手不下令）', () => {
          down(card, 100, 550, mouse);
          move(100, 300);
          expect(ghost()).toBeDefined();
          const e = menu();
          expect(e.defaultPrevented).toBe(true);
          expect(ghost()).toBeUndefined();
          expect(bar.busy).toBe(false);
          up(100, 300);
          expect(drops).toEqual([]);
        });

        const second = (id: number, target: FakeEl): void => {
          firePointer(area, 'pointerdown', { clientX: 200, clientY: 550, pointerId: id, buttons: 1 }, target);
          firePointer(area, 'pointerup', { clientX: 200, clientY: 550, pointerId: id, buttons: 0 });
        };

        it('左键按住按钮，另一指针在卡片带上按下抬起，400ms 后 contextmenu 仍被拦；占着的指针抬起 400ms 后不再拦', () => {
          firePointer(area, 'pointerdown', { clientX: 30, clientY: 550, pointerId: 1, buttons: 1 }, btn);
          second(2, card);
          vi.advanceTimersByTime(400);
          expect(menu().defaultPrevented).toBe(true);
          firePointer(area, 'pointerup', { clientX: 30, clientY: 550, pointerId: 1, buttons: 0 });
          vi.advanceTimersByTime(400);
          expect(menu().defaultPrevented).toBe(false);
        });

        it('左键按住卡片，另一指针在卡片带上按下抬起，400ms 后 contextmenu 仍被拦；占着的指针抬起 400ms 后不再拦', () => {
          firePointer(area, 'pointerdown', { clientX: 100, clientY: 550, pointerId: 1, buttons: 1 }, card);
          second(2, groupCard);
          vi.advanceTimersByTime(400);
          expect(menu().defaultPrevented).toBe(true);
          firePointer(area, 'pointerup', { clientX: 100, clientY: 550, pointerId: 1, buttons: 0 });
          vi.advanceTimersByTime(400);
          expect(menu().defaultPrevented).toBe(false);
        });

        it('鼠标按着，contextmenu 的 pointerId 与它相同：取消；pointerId 不同（另一只鼠标 / 别的指针）：只拦菜单，不改这一按', () => {
          down(card, 100, 550, mouse);
          move(100, 300);
          const e = menu(2);
          expect(e.defaultPrevented).toBe(true);
          expect(ghost()).toBeDefined();
          menu(1);
          expect(ghost()).toBeUndefined();
        });

        it('键盘菜单键（button -1、buttons 0，同一 pointerId、鼠标）：只拦菜单，不取消拖拽、不作废按钮、不结束冻结', () => {
          down(card, 100, 550, mouse);
          move(100, 300);
          const e = menu(1, { button: -1, buttons: 0 });
          expect(e.defaultPrevented).toBe(true);
          expect(ghost()).toBeDefined();
          up(100, 300);
          expect(drops).toHaveLength(1);
          select([0], true);
          down(allCard, 100, 550);
          up(100, 550);
          down(btn, 30, 550, mouse);
          menu(1, { button: -1, buttons: 0 });
          menu(1, { button: 0, buttons: 0 });
          expect(btn.classList.contains('down')).toBe(true);
          expect(allCard.classList.contains('pending')).toBe(true);
          up(30, 550);
          expect(taps).toEqual([btn]);
        });

        it('button 不是 2 但 buttons 含右键位（组合按键）也算右键：作废', () => {
          down(btn, 30, 550, mouse);
          menu(1, { button: 0, buttons: 2 });
          expect(btn.classList.contains('down')).toBe(false);
          up(30, 550);
          expect(taps).toEqual([]);
        });

        it('触摸拖卡片时鼠标（另一 pointerId）的 contextmenu 不取消拖拽：影子还在，松手照常下令', () => {
          down(card, 100, 550, touch);
          move(100, 300);
          const e = menu(2);
          expect(e.defaultPrevented).toBe(true);
          expect(ghost()).toBeDefined();
          up(100, 300);
          expect(drops).toHaveLength(1);
        });

        it('触摸按着的这一下，即使 contextmenu 带同一个 pointerId（长按弹菜单）也只拦菜单，不取消', () => {
          down(card, 100, 550, touch);
          move(100, 300);
          const e = menu(1);
          expect(e.defaultPrevented).toBe(true);
          expect(ghost()).toBeDefined();
          up(100, 300);
          expect(drops).toHaveLength(1);
        });

        it('触摸按住按钮时另一指针的 contextmenu 不作废：按钮仍是按下的样子，抬起照常触发；冻结与双击记录也不动', () => {
          select([0], true);
          down(allCard, 100, 550);
          up(100, 550);
          expect(allCard.classList.contains('pending')).toBe(true);
          down(btn, 30, 550, touch);
          const e = menu(2);
          expect(e.defaultPrevented).toBe(true);
          expect(btn.classList.contains('down')).toBe(true);
          expect(allCard.classList.contains('pending')).toBe(true);
          up(30, 550);
          expect(taps).toEqual([btn]);
        });

        it('触摸按着按钮，contextmenu 没有 pointerId：同样不作废', () => {
          down(btn, 30, 550, touch);
          menu();
          expect(btn.classList.contains('down')).toBe(true);
          up(30, 550);
          expect(taps).toEqual([btn]);
        });

        it('没按着时不拦；按完一阵（300ms）后也不再拦', () => {
          expect(menu().defaultPrevented).toBe(false);
          down(btn, 30, 550);
          up(30, 550);
          vi.advanceTimersByTime(400);
          expect(menu().defaultPrevented).toBe(false);
        });
      });

      it('只是滑开（不补按键）不结束冻结', () => {
        select([0], true);
        down(allCard, 100, 550);
        up(100, 550);
        down(btn, 30, 550);
        move(30 + TAP_SLOP + 1, 550);
        expect(allCard.classList.contains('pending')).toBe(true);
      });

      it('pointercancel / lostpointercapture 作废', () => {
        for (const t of ['pointercancel', 'lostpointercapture']) {
          down(btn, 30, 550);
          firePointer(area, t, { pointerId: 1 });
          expect(btn.classList.contains('down'), t).toBe(false);
          expect(bar.busy, t).toBe(false);
          up(30, 550);
        }
        expect(taps).toEqual([]);
      });

      it('disabled 的按钮不受理：不占卡片带、不加 down、不捕获', () => {
        btn.disabled = true;
        const e = down(btn, 30, 550);
        expect(bar.busy).toBe(false);
        expect(btn.classList.contains('down')).toBe(false);
        expect(area.captured).toBeNull();
        expect(e.defaultPrevented).toBe(false);
        up(30, 550);
        expect(taps).toEqual([]);
      });

      it('非主键按在按钮上不受理', () => {
        down(btn, 30, 550, { button: 2 });
        expect(bar.busy).toBe(false);
        expect(btn.classList.contains('down')).toBe(false);
      });

      it('按在按钮上不长按、不滚动、不拖卡片', () => {
        area.scrollLeft = 100;
        down(btn, 30, 550);
        vi.advanceTimersByTime(600);
        expect(holds).toEqual([]);
        move(30 + 5, 551);
        expect(area.scrollLeft).toBe(100);
        expect(ghost()).toBeUndefined();
      });

      it('一指拖全选卡片（出影子），另一指按按钮再先后松开：不触发；第一指松手照常下令', () => {
        f('pointerdown', 1, 100, 550, allCard);
        f('pointermove', 1, 100, 300);
        expect(ghost()).toBeDefined();
        f('pointerdown', 2, 30, 550, btn);
        expect(btn.classList.contains('down')).toBe(false);
        f('pointerup', 2, 30, 550);
        f('pointerup', 1, 100, 300);
        expect(taps).toEqual([]);
        expect(drops).toHaveLength(1);
        expect(drops[0]).toMatchObject({ kind: 'all' });
      });

      it('一指先按住按钮，另一指拖卡片：不出影子、不下令、不选中；第一指抬起才触发按钮', () => {
        f('pointerdown', 1, 30, 550, btn);
        f('pointerdown', 2, 100, 550, card);
        f('pointermove', 2, 100, 300);
        f('pointerup', 2, 100, 300);
        expect(ghost()).toBeUndefined();
        expect(drops).toEqual([]);
        expect(calls).toEqual([]);
        expect(btn.classList.contains('down')).toBe(true);
        f('pointerup', 1, 30, 550);
        expect(taps).toEqual([btn]);
      });

      it('点完按钮后卡片带恢复：下一下点卡片照常选中', () => {
        down(btn, 30, 550);
        up(30, 550);
        down(card, 100, 550);
        up(100, 550);
        expect(calls).toEqual(['types 3 replace']);
      });

      it('按在按钮上再拖也不滚动卡片带、不出影子、松手不下令也不选中', () => {
        area.scrollLeft = 100;
        down(btn, 30, 550);
        move(0, 552);
        expect(area.scrollLeft).toBe(100);
        move(30, 300);
        expect(ghost()).toBeUndefined();
        up(30, 300);
        expect(drops).toEqual([]);
        expect(calls).toEqual([]);
      });

      it('对照：按在卡片之间的空隙上照旧能滚动', () => {
        area.scrollLeft = 100;
        down(null, 30, 550);
        move(0, 552);
        expect(area.scrollLeft).not.toBe(100);
      });
    });

    it('右键不触发', () => {
      down(card, 100, 550, { button: 2 });
      expect(card.classList.contains('hot')).toBe(false);
      expect(area.captured).toBeNull();
    });
  });

  describe('拖拽中 overlay 的 dragging 类', () => {
    const dragging = (): boolean => overlay.classList.contains('dragging');
    const esc = (): void => {
      const e = new Event('keydown', { cancelable: true });
      Object.defineProperty(e, 'key', { value: 'Escape' });
      dom.win.dispatchEvent(e);
    };

    for (const mobile of [true, false]) {
      describe(mobile ? '移动版' : '桌面版', () => {
        beforeEach(() => {
          bar.mobile = mobile;
        });

        it('影子出现（拖出去）时加上，按下与还没拖出起手距离时没有', () => {
          expect(dragging()).toBe(false);
          down(card, 100, 550);
          expect(dragging()).toBe(false);
          move(101, 549);
          expect(ghost()).toBeUndefined();
          expect(dragging()).toBe(false);
          move(100, 300);
          expect(ghost()).toBeDefined();
          expect(dragging()).toBe(true);
        });

        it('松手去掉（下令与不下令两种都是）', () => {
          down(card, 100, 550);
          move(100, 300);
          up(100, 300);
          expect(dragging()).toBe(false);
          down(card, 100, 550);
          move(100, 300);
          move(100, 540);
          up(100, 540);
          expect(dragging()).toBe(false);
        });

        it('pointercancel、lostpointercapture、窗口失焦、Esc 都去掉', () => {
          const ends: [string, () => void][] = [
            ['pointercancel', () => firePointer(area, 'pointercancel', { pointerId: 1 })],
            ['lostpointercapture', () => firePointer(area, 'lostpointercapture', { pointerId: 1 })],
            ['blur', () => dom.win.dispatchEvent(new Event('blur'))],
            ['esc', esc],
          ];
          for (const [name, end] of ends) {
            down(card, 100, 550);
            move(100, 300);
            expect(dragging(), name).toBe(true);
            end();
            expect(dragging(), name).toBe(false);
            up(100, 300);
          }
        });

        it('按着左键再按右键（buttons 带 2）取消拖拽，去掉', () => {
          down(card, 100, 550);
          move(100, 300);
          expect(dragging()).toBe(true);
          move(100, 290, 3);
          expect(dragging()).toBe(false);
          expect(ghost()).toBeUndefined();
        });

        it('取消后可以再拖，再次加上', () => {
          down(card, 100, 550);
          move(100, 300);
          up(100, 300);
          down(card, 100, 550);
          move(100, 300);
          expect(dragging()).toBe(true);
        });
      });
    }

    it('移动版：横向滚动卡片带不加 dragging；滚动改成拖时才加', () => {
      bar.mobile = true;
      down(card, 200, 550);
      move(150, 551);
      expect(dragging()).toBe(false);
      move(150, 300);
      expect(dragging()).toBe(true);
      up(150, 300);
      expect(dragging()).toBe(false);
    });

    it('点按（没拖动）不加 dragging', () => {
      bar.mobile = true;
      down(card, 100, 550);
      up(100, 550);
      expect(dragging()).toBe(false);
    });
  });

  describe.each([[true, '移动版'], [false, '桌面版']])('单击亮着的卡片取消选中（mobile=%s，%s）', mobile => {
    type PointerInit = Parameters<typeof firePointer>[2];
    const tap = (c: FakeEl, init: PointerInit = {}): void => {
      firePointer(area, 'pointerdown', { clientX: 100, clientY: 550, buttons: 1, ...init }, c);
      firePointer(area, 'pointerup', { clientX: 100, clientY: 550, buttons: 0, ...init });
    };
    /** window 捕获阶段的 pointerdown（先于卡片带自己的 pointerdown） */
    const winDown = (target: FakeEl, button = 0): void => void firePointer(dom.win as unknown as FakeEl, 'pointerdown', { button }, target);
    const winKey = (key = 'a'): void => {
      const e = new Event('keydown', { cancelable: true });
      Object.defineProperty(e, 'key', { value: key });
      dom.win.dispatchEvent(e);
    };
    const roster = (): FakeEl => bar.roster as unknown as FakeEl;
    const groupRow = (): FakeEl => bar.groupRow as unknown as FakeEl;
    const pending = (c: FakeEl): boolean => c.classList.contains('pending');
    /**
     * 模拟补画：卡片行重建时旧卡片脱离页面（isConnected=false），挂上同一身份的新兵种卡片（带 data-fresh）；
     * replace = false 时重建后页面上没有兵种 3 的卡片
     */
    const hookRepaint = (replace = true): FakeEl => {
      const fresh = mkCard({ t: '3', fresh: '1' });
      fresh.rect = rectOf(150, 510, 60, 100);
      let html = '';
      Object.defineProperty(roster(), 'innerHTML', {
        configurable: true,
        get: () => html,
        set: (v: string) => {
          html = v;
          for (const c of roster().children.splice(0)) {
            c.parent = null;
            c.isConnected = false;
          }
          if (replace) roster().append(fresh);
        },
      });
      return fresh;
    };
    beforeEach(() => {
      bar.mobile = mobile;
    });

    describe('立即取消选中', () => {
      it('亮着的兵种卡片：单击立即回调 unpickCard，不走 pickTypes', () => {
        select([0, 1]);
        tap(card);
        expect(calls).toEqual(['unpick type 3']);
      });

      it('亮着的编队卡片：立即回调 unpickCard(group, 队号)', () => {
        select([2, 3]);
        tap(groupCard);
        expect(calls).toEqual(['unpick group 2']);
      });

      it('亮着的全选卡片：立即回调 unpickCard(all, -1)，不走 pickAll', () => {
        select([0], true);
        tap(allCard);
        expect(calls).toEqual(['unpick all -1']);
      });

      it('没亮着的卡片单击照旧立即选中', () => {
        tap(card);
        tap(groupCard);
        tap(allCard);
        expect(calls).toEqual(['types 3 replace', 'group 2 false', 'all replace']);
        expect(pending(card)).toBe(false);
      });

      it('按着 Shift / Ctrl / Meta 单击亮着的兵种卡片是加减选，不取消选中、不冻结', () => {
        select([0, 1]);
        tap(card, { shiftKey: true });
        vi.advanceTimersByTime(400);
        tap(card, { ctrlKey: true } as PointerInit);
        vi.advanceTimersByTime(400);
        tap(card, { metaKey: true } as PointerInit);
        expect(calls).toEqual(['types 3 toggle', 'types 3 toggle', 'types 3 toggle']);
        expect(pending(card)).toBe(false);
      });

      it('按着 Shift 单击亮着的全选卡片是加选', () => {
        select([0], true);
        tap(allCard, { shiftKey: true });
        expect(calls).toEqual(['all add']);
      });

      it('回调之前卡片带已冻住、那张卡片已带 pending：回调里触发的 update 不重建卡片', () => {
        let seen: { pending: boolean; kept: boolean } | null = null;
        cbs.unpickCard = () => {
          bar.update([], []);
          seen = { pending: pending(card), kept: card.parent === roster() };
        };
        select([0, 1]);
        tap(card);
        expect(seen).toEqual({ pending: true, kept: true });
      });
    });

    describe('冻结 350ms（DOUBLE_MS）', () => {
      it('时限内 update 不重建卡片；到时去掉 pending，按最近一次 update 的选择补画', () => {
        select([0, 1]);
        tap(card);
        bar.update([0], [0]);
        bar.update([2], [2]);
        vi.advanceTimersByTime(349);
        bar.update([2], [2]);
        expect(card.parent).toBe(roster());
        expect(groupCard.parent).toBe(groupRow());
        expect(pending(card)).toBe(true);
        vi.advanceTimersByTime(1);
        expect(pending(card)).toBe(false);
        expect(card.parent).toBeNull();
        // 补画用的是最近一次的 sel / screen：只剩兵种 5 的卡片
        expect(roster().innerHTML).toContain('data-t="5"');
        expect(roster().innerHTML).not.toContain('data-t="3"');
      });

      it('补画带上最近一次的 allPicked', () => {
        select([0], true);
        tap(allCard);
        bar.update([0], [0], true);
        vi.advanceTimersByTime(350);
        expect(roster().innerHTML).toMatch(/class="ucard acard on" data-all="1"/);
      });

      it('框选扫卡片期间（markCards 开着）到时只去掉 pending，不补画', () => {
        vi.stubGlobal('getComputedStyle', () => ({ transform: 'none' }));
        vi.stubGlobal('DOMMatrixReadOnly', class { m41 = 0; m42 = 0; });
        select([0, 1]);
        tap(card);
        bar.markCards({ ax: 1000, ay: 1000, bx: 1001, by: 1001 });
        vi.advanceTimersByTime(350);
        expect(pending(card)).toBe(false);
        expect(card.parent).toBe(roster());
      });

      it('超过时限的两次单击各自取消选中', () => {
        select([0, 1]);
        tap(card);
        vi.advanceTimersByTime(400);
        expect(pending(card)).toBe(false);
        tap(card);
        expect(calls).toEqual(['unpick type 3', 'unpick type 3']);
      });
    });

    describe('冻结期间又单击同一张卡片 = 双击', () => {
      it('兵种卡片：先解冻补画，再走双击（pickTypes map），不再回调 unpickCard', () => {
        cbs.unpickCard = (kind, id) => {
          calls.push(`unpick ${kind} ${id}`);
          bar.update([], []);
        };
        select([0, 1]);
        tap(card);
        vi.advanceTimersByTime(200);
        tap(card);
        expect(calls).toEqual(['unpick type 3', 'types 3 map']);
        expect(pending(card)).toBe(false);
        expect(card.parent).toBeNull();
        vi.advanceTimersByTime(2000);
        expect(calls).toHaveLength(2);
      });

      it('全选卡片：pickAll map', () => {
        select([0], true);
        tap(allCard);
        vi.advanceTimersByTime(200);
        tap(allCard);
        expect(calls).toEqual(['unpick all -1', 'all map']);
      });

      it('编队卡片：selectGroup(g, true)', () => {
        select([2, 3]);
        tap(groupCard);
        vi.advanceTimersByTime(200);
        tap(groupCard);
        expect(calls).toEqual(['unpick group 2', 'group 2 true']);
      });

      it('双击之后的第三下重新算单击', () => {
        select([0, 1]);
        tap(card);
        vi.advanceTimersByTime(100);
        tap(card);
        vi.advanceTimersByTime(100);
        tap(card);
        expect(calls).toEqual(['unpick type 3', 'types 3 map', 'unpick type 3']);
      });
    });

    describe('冻结期间在别处的输入立即解冻补画', () => {
      it('window 上不落在冻住那张卡片的 pointerdown（画面、按钮…）', () => {
        select([0, 1]);
        tap(card);
        winDown(new FakeEl());
        expect(pending(card)).toBe(false);
        expect(card.parent).toBeNull();
      });

      it('非主键按下，即使落在冻住的那张卡片上', () => {
        select([0, 1]);
        tap(card);
        winDown(card, 2);
        expect(pending(card)).toBe(false);
        expect(card.parent).toBeNull();
      });

      it('非修饰键的 keydown；单按 Shift / Control / Alt / Meta 不解冻', () => {
        select([0, 1]);
        tap(card);
        for (const k of ['Shift', 'Control', 'Alt', 'Meta']) winKey(k);
        expect(pending(card)).toBe(true);
        expect(card.parent).toBe(roster());
        winKey('a');
        expect(pending(card)).toBe(false);
        expect(card.parent).toBeNull();
      });

      it('主键按在冻住的那张卡片上不解冻', () => {
        select([0, 1]);
        tap(card);
        winDown(card);
        expect(pending(card)).toBe(true);
        expect(card.parent).toBe(roster());
      });

      it('按在另一张卡片上：解冻补画，那张按新选择处理（亮着就取消选中）', () => {
        select([0, 1, 2, 3]);
        tap(card);
        winDown(groupCard);
        expect(pending(card)).toBe(false);
        tap(groupCard);
        expect(calls).toEqual(['unpick type 3', 'unpick group 2']);
      });
    });

    describe('按中的卡片在补画中脱离页面：按身份换成新卡片', () => {
      /** 在旧卡片上的一按：事件目标仍是旧节点（落点是按下时定的），window 捕获先于卡片带 */
      const pressOld = (x = 100, y = 550): void => {
        winDown(card);
        down(card, x, y);
      };
      let fresh: FakeEl;
      beforeEach(() => {
        card.rect = rectOf(80, 510, 60, 100);
        cbs.unpickCard = (kind, id) => {
          calls.push(`unpick ${kind} ${id}`);
          bar.update([], []);
        };
        select([0, 1, 2, 3], true);
      });

      it('全军选中单击全选卡片，65ms 后按兵种卡片：这一按按新选择（没选中）处理，回调 pickTypes(replace)', () => {
        fresh = hookRepaint();
        tap(allCard);
        vi.advanceTimersByTime(65);
        pressOld();
        up(100, 550);
        expect(calls).toEqual(['unpick all -1', 'types 3 replace']);
      });

      it('拖出去时影子从新卡片克隆', () => {
        fresh = hookRepaint();
        tap(allCard);
        vi.advanceTimersByTime(65);
        pressOld();
        move(100, 300);
        expect(ghost()).toBeDefined();
        expect(ghost()!.dataset.fresh).toBe('1');
      });

      it('长按量的是新卡片的矩形', () => {
        fresh = hookRepaint();
        tap(allCard);
        vi.advanceTimersByTime(65);
        pressOld();
        vi.advanceTimersByTime(500);
        expect(holds).toHaveLength(1);
        expect(holds[0].rect).toEqual(fresh.rect);
        expect(holds[0].rect).not.toEqual(card.rect);
      });

      it('重建后页面上没有同一身份的卡片：这一按当作没按中卡片（不选中、不长按）', () => {
        hookRepaint(false);
        tap(allCard);
        vi.advanceTimersByTime(65);
        pressOld();
        vi.advanceTimersByTime(600);
        up(100, 550);
        expect(calls).toEqual(['unpick all -1']);
        expect(holds).toEqual([]);
      });

      it('没有脱离页面时照常用按中的这张', () => {
        winDown(card);
        down(card, 100, 550);
        vi.advanceTimersByTime(500);
        expect(holds).toHaveLength(1);
        expect(holds[0].rect).toEqual(card.rect);
      });
    });

    describe('冻结期间按住同一张卡片', () => {
      it('拖出去（出影子那一刻）：先解冻补画，影子从新卡片克隆', () => {
        select([0, 1]);
        const fresh = hookRepaint();
        tap(card);
        vi.advanceTimersByTime(100);
        down(card, 100, 550);
        expect(pending(card)).toBe(true);
        move(100, 300);
        expect(pending(card)).toBe(false);
        expect(ghost()).toBeDefined();
        expect(ghost()!.dataset.fresh).toBe(fresh.dataset.fresh);
      });

      it('按住后等冻结到时（卡片补画、旧节点脱离）再拖出去：影子取自新卡片', () => {
        select([0, 1]);
        const fresh = hookRepaint();
        tap(card);
        vi.advanceTimersByTime(100);
        down(card, 100, 550);
        vi.advanceTimersByTime(300);
        expect(pending(card)).toBe(false);
        expect(card.isConnected).toBe(false);
        move(100, 300);
        expect(ghost()).toBeDefined();
        expect(ghost()!.dataset.fresh).toBe(fresh.dataset.fresh);
      });

      it('补画后那张卡片没了：再拖不出影子，松手不回调 dropCard', () => {
        select([0, 1]);
        hookRepaint(false);
        tap(card);
        vi.advanceTimersByTime(100);
        down(card, 100, 550);
        vi.advanceTimersByTime(300);
        move(100, 300);
        expect(ghost()).toBeUndefined();
        expect(sword()).toBeUndefined();
        move(100, 250);
        up(100, 250);
        expect(ghost()).toBeUndefined();
        expect(drops).toEqual([]);
      });

      it('拖出去松手：到下令为止只取消了一次选中', () => {
        select([0, 1]);
        tap(card);
        vi.advanceTimersByTime(100);
        down(card, 100, 550);
        move(100, 300);
        up(100, 300);
        vi.advanceTimersByTime(2000);
        expect(calls).toEqual(['unpick type 3']);
      });

      it('长按到时按中的卡片已脱离页面、页面上也没有同身份的卡片：不回调 holdCard', () => {
        select([0, 1]);
        hookRepaint(false);
        tap(card);
        vi.advanceTimersByTime(100);
        down(card, 100, 550);
        vi.advanceTimersByTime(600);
        expect(holds).toEqual([]);
      });

      it('长按到时：量新卡片的矩形，去掉 pending', () => {
        select([0, 1]);
        const fresh = hookRepaint();
        tap(card);
        vi.advanceTimersByTime(100);
        down(card, 100, 550);
        vi.advanceTimersByTime(500);
        expect(pending(card)).toBe(false);
        expect(holds).toHaveLength(1);
        expect(holds[0].rect).toEqual(fresh.rect);
      });
    });

    describe('影子上的人数随 cardCount 刷新', () => {
      /** 兵种 / 编队卡片带 .n，全选卡片带 .ab 里的 b，影子是它们的克隆 */
      const withCounts = (): void => {
        for (const c of [card, groupCard]) {
          const n = new FakeEl('span');
          n.className = 'n';
          c.appendChild(n);
        }
        const ab = new FakeEl('span');
        ab.className = 'ab';
        ab.appendChild(new FakeEl('b'));
        allCard.appendChild(ab);
      };
      const num = (sel: string): string => ghost()!.querySelector(sel)!.textContent;
      beforeEach(withCounts);

      it('摆放影子（pointermove）时把人数写成 cardCount：兵种、编队卡片的 .n，全选卡片的 .ab b', () => {
        count = 7;
        down(card, 100, 550);
        move(100, 300);
        expect(num('.n')).toBe('7');
        up(100, 300);
        down(groupCard, 100, 550);
        move(100, 300);
        expect(num('.n')).toBe('7');
        up(100, 300);
        count = 4;
        down(allCard, 100, 550);
        move(100, 300);
        expect(num('.ab b')).toBe('4');
      });

      it('拖出影子那一刻算一次人数；之后 pointermove 只挪位置，沿用上次的数、不再调 cardCount', () => {
        down(card, 100, 550);
        expect(countCalls).toBe(0);
        move(100, 300);
        expect(countCalls).toBe(1);
        expect(num('.n')).toBe('5');
        count = 3;
        move(100, 290);
        move(100, 280);
        expect(countCalls).toBe(1);
        expect(num('.n')).toBe('5');
      });

      it('拖拽中 update()（卡片带冻着也一样）按 cardCount 刷新影子，不用等鼠标动', () => {
        down(card, 100, 550);
        move(100, 300);
        count = 2;
        bar.update([], []);
        expect(num('.n')).toBe('2');
      });

      it('人数变化要经 update 才反映：变 0 时影子与剑都 nodrop，人数回来后恢复；pointermove 本身不改', () => {
        down(card, 100, 550);
        move(100, 300);
        count = 0;
        move(100, 290);
        expect(ghost()!.classList.contains('nodrop')).toBe(false);
        bar.update([], []);
        expect(ghost()!.classList.contains('nodrop')).toBe(true);
        if (mobile) expect(sword()!.classList.contains('nodrop')).toBe(true);
        count = 5;
        move(100, 280);
        expect(ghost()!.classList.contains('nodrop')).toBe(true);
        bar.update([], []);
        expect(ghost()!.classList.contains('nodrop')).toBe(false);
        if (mobile) expect(sword()!.classList.contains('nodrop')).toBe(false);
      });

      it('起拖时就没有人：影子与剑一出来就是 nodrop', () => {
        count = 0;
        down(card, 100, 550);
        move(100, 300);
        expect(ghost()!.classList.contains('nodrop')).toBe(true);
        if (mobile) expect(sword()!.classList.contains('nodrop')).toBe(true);
        up(100, 300);
        expect(drops).toEqual([]);
      });

      it('cardCount 为 0 时松手不回调 dropCard', () => {
        down(card, 100, 550);
        move(100, 300);
        count = 0;
        move(100, 280);
        const before = countCalls;
        up(100, 280);
        expect(countCalls).toBe(before + 1);
        expect(drops).toEqual([]);
      });

      it('update() 让人数变成 0 时影子立刻 nodrop', () => {
        down(card, 100, 550);
        move(100, 300);
        expect(ghost()!.classList.contains('nodrop')).toBe(false);
        count = 0;
        bar.update([], []);
        expect(ghost()!.classList.contains('nodrop')).toBe(true);
      });

      it('有人时松手照常回调 dropCard', () => {
        down(card, 100, 550);
        move(100, 300);
        up(100, 300);
        expect(drops).toHaveLength(1);
      });

      it('destroy 后 update 不再改影子上的人数', () => {
        down(card, 100, 550);
        move(100, 300);
        const g = ghost()!;
        bar.destroy();
        count = 1;
        bar.update([], []);
        expect(g.querySelector('.n')!.textContent).toBe('5');
      });
    });

    describe('busy：卡片带上有一下按着', () => {
      it('平时 false；按在卡片上变 true，抬起变 false', () => {
        expect(bar.busy).toBe(false);
        down(card, 100, 550);
        expect(bar.busy).toBe(true);
        up(100, 550);
        expect(bar.busy).toBe(false);
      });

      it('拖、长按、滚动中都是 true；取消（pointercancel）后 false', () => {
        down(card, 100, 550);
        move(100, 300);
        expect(bar.busy).toBe(true);
        firePointer(area, 'pointercancel', { pointerId: 1 });
        expect(bar.busy).toBe(false);
        down(card, 100, 550);
        vi.advanceTimersByTime(500);
        expect(bar.busy).toBe(true);
        up(100, 550);
        expect(bar.busy).toBe(false);
      });

      it('右键按下不建立这一按，不算 busy', () => {
        down(card, 100, 550, { button: 2 });
        expect(bar.busy).toBe(false);
      });

      it('按在 off 的卡片上：移动版当作按在空隙上（能滚动）算 busy，桌面版被吃掉不算', () => {
        down(offCard, 330, 550);
        expect(bar.busy).toBe(mobile);
      });

      it('一下按着期间别的手指的按下抬起不改变它', () => {
        firePointer(area, 'pointerdown', { clientX: 100, clientY: 550, pointerId: 1, buttons: 1 }, card);
        firePointer(area, 'pointerdown', { clientX: 30, clientY: 550, pointerId: 2, buttons: 1 }, groupCard);
        firePointer(area, 'pointerup', { clientX: 30, clientY: 550, pointerId: 2, buttons: 0 });
        expect(bar.busy).toBe(true);
      });
    });

    describe('卡片带上已有一下按着时，卡片带里别的手指的 pointerdown 不打断第一指', () => {
      const winDown = (target: FakeEl, id: number): void => void firePointer(dom.win as unknown as FakeEl, 'pointerdown', { pointerId: id }, target);
      const f = (type: string, id: number, x: number, y: number, target?: FakeEl): Event =>
        firePointer(area, type, { clientX: x, clientY: y, pointerId: id, buttons: type === 'pointerup' ? 0 : 1 }, target);

      it('单击亮着的全选（冻结）→ 350ms 内再按住全选，第二指在卡片带里轻按另一张卡并抬起，第一指抬起：仍是双击', () => {
        select([0], true);
        tap(allCard);
        vi.advanceTimersByTime(100);
        f('pointerdown', 1, 100, 550, allCard);
        winDown(groupCard, 2);
        f('pointerdown', 2, 30, 550, groupCard);
        f('pointerup', 2, 30, 550);
        expect(pending(allCard)).toBe(true);
        expect(allCard.parent).toBe(roster());
        f('pointerup', 1, 100, 550);
        expect(calls).toEqual(['unpick all -1', 'all map']);
      });

      it('第二指落在卡片带外：照旧打断，第一指抬起是普通单击', () => {
        select([0], true);
        tap(allCard);
        vi.advanceTimersByTime(100);
        f('pointerdown', 1, 100, 550, allCard);
        winDown(new FakeEl(), 2);
        expect(pending(allCard)).toBe(false);
        f('pointerup', 1, 100, 550);
        expect(calls).toEqual(['unpick all -1', 'unpick all -1']);
      });

      it('没有按着的一下时，卡片带里另一张卡片的 pointerdown 照旧打断（原有行为）', () => {
        select([0], true);
        tap(allCard);
        winDown(groupCard, 2);
        expect(pending(allCard)).toBe(false);
      });
    });

    describe('卡片带一次只认一根手指', () => {
      const f = (type: string, id: number, x: number, y: number, target?: FakeEl, buttons = 1): Event =>
        firePointer(area, type, { clientX: x, clientY: y, pointerId: id, buttons: type === 'pointerup' ? 0 : buttons }, target);

      it('一指拖起兵种卡（出影子），另一指按另一张卡并抬起：不改影子、不选中那张；第一指松手按第一张下令', () => {
        f('pointerdown', 1, 100, 550, card);
        f('pointermove', 1, 100, 300);
        const g = ghost()!;
        const at = g.style.transform;
        f('pointerdown', 2, 30, 550, groupCard);
        f('pointermove', 2, 250, 300);
        f('pointerup', 2, 250, 300);
        expect(ghost()).toBe(g);
        expect(g.style.transform).toBe(at);
        expect(calls).toEqual([]);
        expect(area.captureCalls).toEqual([1]);
        f('pointerup', 1, 100, 300);
        expect(drops).toHaveLength(1);
        expect(drops[0]).toMatchObject({ kind: 'type', id: 3 });
      });

      it('一指按着卡片没动，另一指按别的卡片并抬起：不选中别的；第一指抬起才选中第一张', () => {
        f('pointerdown', 1, 100, 550, card);
        f('pointerdown', 2, 30, 550, groupCard);
        f('pointerup', 2, 30, 550);
        expect(calls).toEqual([]);
        f('pointerup', 1, 100, 550);
        expect(calls).toEqual(['types 3 replace']);
      });

      it('别的指针的 pointermove 不影响这一按：不触发滚动 / 不出影子 / 不取消长按', () => {
        area.scrollLeft = 100;
        f('pointerdown', 1, 100, 550, card);
        f('pointermove', 2, 300, 300);
        f('pointermove', 2, 0, 552);
        expect(ghost()).toBeUndefined();
        expect(area.scrollLeft).toBe(100);
        vi.advanceTimersByTime(500);
        expect(holds).toHaveLength(1);
      });

      it('别的指针的 pointercancel / lostpointercapture 不取消这一按', () => {
        f('pointerdown', 1, 100, 550, card);
        f('pointermove', 1, 100, 300);
        f('pointercancel', 2, 0, 0);
        f('lostpointercapture', 2, 0, 0);
        expect(ghost()).toBeDefined();
        f('pointerup', 1, 100, 300);
        expect(drops).toHaveLength(1);
      });

      it('按下它的那个指针的 pointercancel 照旧取消', () => {
        f('pointerdown', 1, 100, 550, card);
        f('pointermove', 1, 100, 300);
        f('pointercancel', 1, 0, 0);
        expect(ghost()).toBeUndefined();
      });

      it('第一指抬起之后，别的手指可以接着按', () => {
        f('pointerdown', 1, 100, 550, card);
        f('pointerup', 1, 100, 550);
        f('pointerdown', 2, 30, 550, groupCard);
        f('pointerup', 2, 30, 550);
        expect(calls).toEqual(['types 3 replace', 'group 2 false']);
      });
    });

    describe('按住左键时 buttons 带任何非左键位都按组合按键处理', () => {
      it.each([3, 5, 9])('buttons = %i：取消这一按（影子消失、松手不下令）', buttons => {
        down(card, 100, 550);
        move(100, 300);
        expect(ghost()).toBeDefined();
        move(100, 290, buttons);
        expect(ghost()).toBeUndefined();
        up(100, 290);
        expect(drops).toEqual([]);
      });

      it.each([3, 5, 9])('buttons = %i：清双击记录、结束冻结', buttons => {
        select([0], true);
        tap(allCard);
        expect(pending(allCard)).toBe(true);
        down(allCard, 100, 550);
        move(100, 550, buttons);
        expect(pending(allCard)).toBe(false);
        up(100, 550);
        tap(allCard);
        expect(calls).toEqual(['unpick all -1', 'unpick all -1']);
      });

      it('只有左键（buttons = 1）不算组合', () => {
        down(card, 100, 550);
        move(100, 300, 1);
        expect(ghost()).toBeDefined();
      });
    });

    describe('按住左键期间补按右键：打断连点、结束冻结', () => {
      it('pointermove 里 buttons & 2：单击亮着的全选（冻结）→ 按住左键、补按右键、松开 → 350ms 内再单击全选是普通单击', () => {
        select([0], true);
        tap(allCard);
        expect(pending(allCard)).toBe(true);
        down(allCard, 100, 550);
        move(100, 550, 3);
        expect(pending(allCard)).toBe(false);
        expect(allCard.parent).toBeNull();
        up(100, 550);
        tap(allCard);
        expect(calls).toEqual(['unpick all -1', 'unpick all -1']);
      });

      it('window 的 contextmenu 同样', () => {
        select([0], true);
        tap(allCard);
        down(allCard, 100, 550, { pointerType: 'mouse' });
        const e = new Event('contextmenu', { cancelable: true });
        Object.defineProperty(e, 'button', { value: 2 });
        dom.win.dispatchEvent(e);
        expect(pending(allCard)).toBe(false);
        up(100, 550);
        tap(allCard);
        expect(calls).toEqual(['unpick all -1', 'unpick all -1']);
      });

      it('没按右键时（对照）：同样的时间线第二下是双击', () => {
        select([0], true);
        tap(allCard);
        down(allCard, 100, 550);
        up(100, 550);
        expect(calls).toEqual(['unpick all -1', 'all map']);
      });

      it('不亮的卡片：点、按住左键补按右键、再点，不是双击', () => {
        tap(card);
        down(card, 100, 550);
        move(100, 550, 3);
        up(100, 550);
        tap(card);
        expect(calls).toEqual(['types 3 replace', 'types 3 replace']);
      });
    });

    describe('双击只认连续的两下主键点按', () => {
      const keyDown = (key: string): void => winKey(key);

      it('对照：连续单击同一张卡片是双击', () => {
        tap(allCard);
        vi.advanceTimersByTime(100);
        tap(allCard);
        expect(calls).toEqual(['all replace', 'all map']);
      });

      it('两下之间 window 上点了别处（画面空白、按钮…）：第二下是普通单击', () => {
        tap(allCard);
        vi.advanceTimersByTime(100);
        winDown(new FakeEl());
        tap(allCard);
        expect(calls).toEqual(['all replace', 'all replace']);
      });

      it('两下之间 window 上点了另一张卡片：第二下是普通单击', () => {
        tap(card);
        winDown(groupCard);
        tap(card);
        expect(calls).toEqual(['types 3 replace', 'types 3 replace']);
      });

      it('两下之间 window 上按在同一张卡片上（第二下自己的按下）不打断', () => {
        tap(card);
        vi.advanceTimersByTime(100);
        winDown(card);
        tap(card);
        expect(calls).toEqual(['types 3 replace', 'types 3 map']);
      });

      it('两下之间按右键（非主键，即使在同一张卡片上）：左、右、左是两次单击', () => {
        tap(allCard);
        winDown(allCard, 2);
        tap(allCard);
        expect(calls).toEqual(['all replace', 'all replace']);
      });

      it.each(['Shift', 'Control', 'Alt', 'Meta'])('两下之间单按 %s 不打断：仍是双击', key => {
        tap(card);
        vi.advanceTimersByTime(100);
        keyDown(key);
        tap(card);
        expect(calls).toEqual(['types 3 replace', 'types 3 map']);
      });

      it('两下之间按别的键（如 a、Escape）仍打断：第二下是普通单击', () => {
        for (const key of ['a', 'Escape']) {
          calls.length = 0;
          tap(card);
          keyDown(key);
          vi.advanceTimersByTime(100);
          tap(card);
          expect(calls, key).toEqual(['types 3 replace', 'types 3 replace']);
          vi.advanceTimersByTime(500);
        }
      });

      it('点全选 → 在同一张卡片上横滑（移动版判成滚动，桌面版拖出影子）→ 再点全选：普通单击', () => {
        tap(allCard);
        down(allCard, 200, 550);
        move(150, 551);
        up(150, 551);
        tap(allCard);
        expect(calls).toEqual(['all replace', 'all replace']);
      });

      it('点全选 → 拖出影子再松手 → 再点全选：普通单击', () => {
        tap(allCard);
        down(allCard, 100, 550);
        move(100, 300);
        up(100, 300);
        tap(allCard);
        expect(calls).toEqual(['all replace', 'all replace']);
      });
    });

    describe('destroy', () => {
      it('清掉冻结计时器：之后不再补画', () => {
        select([0, 1]);
        tap(card);
        bar.destroy();
        vi.advanceTimersByTime(2000);
        expect(card.parent).toBe(roster());
        expect(pending(card)).toBe(true);
      });

      it('摘掉 window 的 pointerdown 与 keydown 监听：之后它们不再打断双击、不再解冻', () => {
        tap(card);
        bar.destroy();
        winDown(new FakeEl());
        winKey('a');
        tap(card);
        expect(calls).toEqual(['types 3 replace', 'types 3 map']);
      });
    });

    it('从亮着的卡片上拖出去松手不是取消选中', () => {
      select([0, 1]);
      down(card, 100, 550);
      move(100, 300);
      up(100, 300);
      expect(calls.filter(c => c.startsWith('unpick'))).toEqual([]);
    });
  });

  describe.each([[true, '移动版'], [false, '桌面版']])('长按卡片（mobile=%s，%s）', mobile => {
    beforeEach(() => {
      bar.mobile = mobile;
      card.rect = rectOf(80, 510, 60, 100);
      groupCard.rect = rectOf(10, 510, 60, 100);
      allCard.rect = rectOf(300, 510, 60, 100);
    });

    it('按住不动满 500ms：回调 holdCard(兵种, 兵种 id, 卡片的矩形)', () => {
      down(card, 100, 550);
      vi.advanceTimersByTime(499);
      expect(holds).toEqual([]);
      vi.advanceTimersByTime(1);
      expect(holds).toHaveLength(1);
      expect(holds[0].kind).toBe('type');
      expect(holds[0].id).toBe(3);
      expect(holds[0].rect).toEqual(card.rect);
    });

    it('编队卡片：holdCard(group, 队号)；全选卡片：holdCard(all, -1)', () => {
      down(groupCard, 40, 550);
      vi.advanceTimersByTime(500);
      up(40, 550);
      down(allCard, 330, 550);
      vi.advanceTimersByTime(500);
      expect(holds.map(h => `${h.kind} ${h.id}`)).toEqual(['group 2', 'all -1']);
      expect(holds[0].rect).toEqual(groupCard.rect);
      expect(holds[1].rect).toEqual(allCard.rect);
    });

    it('亮着的卡片同样能长按', () => {
      select([0, 1]);
      down(card, 100, 550);
      vi.advanceTimersByTime(500);
      expect(holds).toHaveLength(1);
    });

    it('触发后按中的卡片去掉 hot', () => {
      down(card, 100, 550);
      vi.advanceTimersByTime(500);
      expect(card.classList.contains('hot')).toBe(false);
    });

    it('长按后抬起：不回调 pick / unpick / select，也不下令', () => {
      select([0, 1]);
      down(card, 100, 550);
      vi.advanceTimersByTime(500);
      up(100, 550);
      expect(calls).toEqual([]);
      expect(drops).toEqual([]);
    });

    it('长按后再移动：不出影子、不出剑、不滚动卡片带，抬起也不算点或拖放', () => {
      area.scrollLeft = 100;
      down(card, 100, 550);
      vi.advanceTimersByTime(500);
      move(60, 552);
      move(60, 300);
      expect(ghost()).toBeUndefined();
      expect(sword()).toBeUndefined();
      expect(area.scrollLeft).toBe(100);
      up(60, 300);
      expect(calls).toEqual([]);
      expect(drops).toEqual([]);
    });

    it('长按之后下一次点按照常工作', () => {
      down(card, 100, 550);
      vi.advanceTimersByTime(500);
      up(100, 550);
      vi.advanceTimersByTime(1000);
      down(card, 100, 550);
      up(100, 550);
      expect(calls).toEqual(['types 3 replace']);
      expect(holds).toHaveLength(1);
    });

    it('手指 / 鼠标抖动不到 6px 不影响长按', () => {
      down(card, 100, 550);
      move(103, 553);
      move(100, 555);
      vi.advanceTimersByTime(500);
      expect(holds).toHaveLength(1);
    });

    it('移动超过 CARD_SLOP（8px）就不触发，即使又回到按下处', () => {
      down(card, 100, 550);
      move(109, 550);
      move(100, 550);
      vi.advanceTimersByTime(600);
      expect(holds).toEqual([]);
    });

    it('拖出影子后不触发', () => {
      down(card, 100, 550);
      move(100, 300);
      expect(ghost()).toBeDefined();
      vi.advanceTimersByTime(600);
      expect(holds).toEqual([]);
    });

    it('没满 500ms 抬起：是点按，之后也不触发长按', () => {
      down(card, 100, 550);
      vi.advanceTimersByTime(300);
      up(100, 550);
      vi.advanceTimersByTime(600);
      expect(holds).toEqual([]);
      expect(calls).toEqual(['types 3 replace']);
    });

    it('pointercancel 之后不触发', () => {
      down(card, 100, 550);
      vi.advanceTimersByTime(300);
      firePointer(area, 'pointercancel', { pointerId: 1 });
      vi.advanceTimersByTime(600);
      expect(holds).toEqual([]);
    });

    it('lostpointercapture 之后不触发', () => {
      down(card, 100, 550);
      vi.advanceTimersByTime(300);
      firePointer(area, 'lostpointercapture', { pointerId: 1 });
      vi.advanceTimersByTime(600);
      expect(holds).toEqual([]);
    });

    it('按右键不触发', () => {
      down(card, 100, 550, { button: 2 });
      vi.advanceTimersByTime(600);
      expect(holds).toEqual([]);
    });

    it('按在空隙上不触发', () => {
      down(null, 30, 550);
      vi.advanceTimersByTime(600);
      expect(holds).toEqual([]);
    });

    it('按在变暗（off）的全选卡片上不触发', () => {
      offCard.rect = rectOf(300, 510, 60, 100);
      down(offCard, 330, 550);
      vi.advanceTimersByTime(600);
      expect(holds).toEqual([]);
    });

    it('一次按下只触发一次', () => {
      down(card, 100, 550);
      vi.advanceTimersByTime(3000);
      expect(holds).toHaveLength(1);
    });
  });

  describe('长按（仅移动版）', () => {
    beforeEach(() => {
      bar.mobile = true;
    });

    it('抖动 7px（没到 CARD_SLOP）仍触发长按', () => {
      down(card, 100, 550);
      move(105, 555);
      vi.advanceTimersByTime(500);
      expect(holds).toHaveLength(1);
    });

    it('判成滚动后不触发', () => {
      down(card, 200, 550);
      move(150, 551);
      vi.advanceTimersByTime(600);
      expect(holds).toEqual([]);
    });
  });

  describe('cardRect：卡片此刻的位置', () => {
    beforeEach(() => {
      card.rect = rectOf(80, 510, 60, 100);
      groupCard.rect = rectOf(10, 510, 60, 100);
      allCard.rect = rectOf(300, 510, 60, 100);
    });

    it('兵种卡片按 data-t、编队卡片按 data-g 匹配，返回它的 getBoundingClientRect', () => {
      expect(bar.cardRect('type', 3)).toBe(card.rect);
      expect(bar.cardRect('group', 2)).toBe(groupCard.rect);
    });

    it('全选卡片忽略 id', () => {
      expect(bar.cardRect('all', -1)).toBe(allCard.rect);
      expect(bar.cardRect('all', 99)).toBe(allCard.rect);
    });

    it('找不到（id 不对、kind 与卡片种类对不上）为 null', () => {
      expect(bar.cardRect('type', 7)).toBeNull();
      expect(bar.cardRect('group', 9)).toBeNull();
      expect(bar.cardRect('group', 3)).toBeNull();
      expect(bar.cardRect('type', 2)).toBeNull();
    });

    it('取的是此刻的位置：卡片的矩形变了跟着变', () => {
      card.rect = rectOf(200, 300, 60, 100);
      expect(bar.cardRect('type', 3)).toEqual(rectOf(200, 300, 60, 100));
    });

    it('cardsTop：编队行与兵种行所有卡片上沿的最小值（含上移的选中卡片）；没有卡片是 Infinity', () => {
      card.rect = rectOf(80, 510, 60, 100);
      groupCard.rect = rectOf(10, 480, 60, 100);
      allCard.rect = rectOf(300, 520, 60, 100);
      offCard.rect = rectOf(300, 530, 60, 100);
      expect(bar.cardsTop()).toBe(480);
      groupCard.rect = rectOf(10, 600, 60, 100);
      expect(bar.cardsTop()).toBe(510);
      bar.update([], []);
      expect(bar.cardsTop()).toBe(Infinity);
    });

    it('卡片被重建（脱离卡片行）后为 null', () => {
      bar.update([], []);
      expect(bar.cardRect('type', 3)).toBeNull();
      expect(bar.cardRect('group', 2)).toBeNull();
    });
  });

  describe('桌面版', () => {
    beforeEach(() => {
      bar.mobile = false;
    });

    it('按下不加 hot 类', () => {
      down(card, 100, 550);
      expect(card.classList.contains('hot')).toBe(false);
    });

    it('拖出去是影子，没有剑；落点就是鼠标位置，影子在鼠标右下方 14px', () => {
      down(card, 100, 550);
      move(120, 300);
      expect(ghost()).toBeDefined();
      expect(sword()).toBeUndefined();
      expect(ghost()!.style.transform).toBe('translate(134px, 314px) scale(0.8)');
      expect(ghost()!.classList.contains('nodrop')).toBe(false);
    });

    it('没有抬起：鼠标在卡片带里就是 nodrop，在画面上不是', () => {
      down(card, 100, 550);
      move(100, 540);
      expect(ghost()!.classList.contains('nodrop')).toBe(true);
      move(100, 480);
      expect(ghost()!.classList.contains('nodrop')).toBe(false);
      expect(ghost()!.style.transform).toBe('translate(114px, 494px) scale(0.8)');
    });

    it('松手回调传鼠标坐标', () => {
      down(card, 100, 550);
      move(120, 300);
      up(120, 300);
      expect(drops).toEqual([{ kind: 'type', id: 3, x: 120, y: 300, target: 'view' }]);
      expect(overlay.children).toHaveLength(0);
    });

    it('松在小地图上 target 是 mini', () => {
      down(card, 100, 550);
      move(120, 700);
      up(120, 700);
      expect(drops).toEqual([{ kind: 'type', id: 3, x: 120, y: 700, target: 'mini' }]);
    });

    it('横向拖动不会滚动卡片带，而是拖卡片', () => {
      down(card, 100, 550);
      move(300, 552);
      expect(area.scrollLeft).toBe(0);
      expect(ghost()).toBeDefined();
    });

    it('落在小地图画布的四角也算命中', () => {
      for (const [x, y] of [[65, 625], [235, 625], [65, 790], [235, 790]]) {
        down(card, x, 550);
        move(x, y);
        expect(ghost()!.classList.contains('nodrop'), `${x},${y}`).toBe(false);
        up(x, y);
      }
      expect(drops.map(d => [d.x, d.y, d.target])).toEqual([[65, 625, 'mini'], [235, 625, 'mini'], [65, 790, 'mini'], [235, 790, 'mini']]);
    });

    // 卡片 60 × 100，缩放 0.8 后 48 × 80；overlay 是 (0, 0) – (400, 800)
    describe('影子放不下时换边', () => {
      const at = (x: number, y: number): string => {
        down(card, x, 550);
        move(x, y);
        const t = ghost()!.style.transform;
        up(x, y);
        return t;
      };

      it('桌面版不受顶栏影响：鼠标靠近屏幕顶时影子照旧在鼠标下方 14px', () => {
        const topbar = new FakeEl();
        topbar.className = 'panel topbar';
        topbar.rect = rectOf(0, 0, 400, 60);
        rebuild(topbar, false);
        expect(at(100, 20)).toBe('translate(114px, 34px) scale(0.8)');
      });

      it('右边、下边都放得下：在鼠标右下方 14px', () => {
        expect(at(100, 300)).toBe('translate(114px, 314px) scale(0.8)');
      });

      it('右边放不下（卡片右沿会超出 overlay 右边界）：换到鼠标左边 14px，x = 鼠标 − 14 − 48', () => {
        expect(at(390, 300)).toBe('translate(328px, 314px) scale(0.8)');
      });

      it('右沿刚好贴着右边界还算放得下，再多 1px 就换边', () => {
        expect(at(338, 300)).toBe('translate(352px, 314px) scale(0.8)');
        expect(at(339, 300)).toBe('translate(277px, 314px) scale(0.8)');
      });

      it('底边放不下：换到鼠标上边 14px，y = 鼠标 − 14 − 80', () => {
        expect(at(100, 780)).toBe('translate(114px, 686px) scale(0.8)');
      });

      it('下沿刚好贴着底边还算放得下，再多 1px 就换边', () => {
        expect(at(100, 706)).toBe('translate(114px, 720px) scale(0.8)');
        expect(at(100, 707)).toBe('translate(114px, 613px) scale(0.8)');
      });

      it('两个方向各自判断：右下角两边都放不下，换到左上', () => {
        expect(at(390, 780)).toBe('translate(328px, 686px) scale(0.8)');
      });

      it('换边只动影子，落点仍是鼠标位置', () => {
        down(card, 390, 550);
        move(390, 300);
        up(390, 300);
        expect(drops).toHaveLength(1);
        expect(drops[0].x).toBeCloseTo(390);
        expect(drops[0].y).toBeCloseTo(300);
      });

      it('按 overlay 的边界算，不是固定的屏幕尺寸', () => {
        overlay.rect = rectOf(0, 0, 200, 500);
        expect(at(100, 300)).toBe('translate(114px, 314px) scale(0.8)');
        expect(at(150, 300)).toBe('translate(88px, 314px) scale(0.8)');
        expect(at(100, 420)).toBe('translate(114px, 326px) scale(0.8)');
      });
    });

    it('点按选中', () => {
      down(card, 100, 550);
      up(100, 550);
      expect(calls).toEqual(['types 3 replace']);
    });
  });
});

describe('CardBar.update 卡片上的人数与全选卡片', () => {
  // 世界里的单位：0～3 是兵种 0（4 个），4～6 是兵种 1（3 个），7～9 是兵种 2（3 个）；都满血、1 级、士气 50
  const TYPES = [0, 0, 0, 0, 1, 1, 1, 2, 2, 2];
  let area: FakeEl, bar: CardBar;
  const roster = (): string => (bar.roster as unknown as FakeEl).innerHTML;
  /** 兵种卡片上的人数：type 卡片 `data-t="t"` 里 `<span class="n">` */
  const typeN = (t: number): number | null => {
    const m = new RegExp(`data-t="${t}"[\\s\\S]*?<span class="n">(\\d+)</span>`).exec(roster());
    return m ? Number(m[1]) : null;
  };
  const hasType = (t: number): boolean => roster().includes(`data-t="${t}"`);
  const typeOn = (t: number): boolean => new RegExp(`class="ucard(?: elite)? on" data-t="${t}"`).test(roster());
  /** 全选卡片：类名与人数 */
  const all = (): { cls: string; n: number } => {
    const m = /class="ucard acard([^"]*)" data-all="1"[\s\S]*?<b>(\d+)<\/b>/.exec(roster());
    expect(m, roster()).not.toBeNull();
    return { cls: m![1], n: Number(m![2]) };
  };

  beforeEach(() => {
    installFakeDom(vi);
    area = new FakeEl();
    const n = TYPES.length;
    const w = {
      humanTeam: 1,
      type: Uint8Array.from(TYPES),
      hp: new Float32Array(n).fill(100), maxHp: new Float32Array(n).fill(100),
      level: new Uint8Array(n), morale: new Float32Array(n).fill(50),
    } as unknown as World;
    bar = new CardBar(w, () => '', new FakeCanvas() as unknown as HTMLCanvasElement, new FakeEl() as unknown as HTMLElement, {
      pickTypes: () => {}, pickAll: () => {}, selectGroup: () => {}, unpickCard: () => {}, cardCount: () => 0, holdCard: () => {}, dropCard: () => {},
    }, area as unknown as HTMLElement);
  });

  afterEach(() => {
    bar.destroy();
    vi.unstubAllGlobals();
  });

  describe('兵种卡片', () => {
    it('没选中的兵种：人数写屏幕内的人数，不带 on', () => {
      bar.update([], [0, 1, 4]);
      expect(typeN(0)).toBe(2);
      expect(typeN(1)).toBe(1);
      expect(typeOn(0)).toBe(false);
      expect(hasType(2)).toBe(false);
    });

    it('选中的兵种（sel 里有这个兵种）：人数写选中的人数，带 on，不随屏幕内人数变化', () => {
      bar.update([0, 1, 2], [0, 1, 2, 3, 4, 5]);
      expect(typeN(0)).toBe(3);
      expect(typeOn(0)).toBe(true);
      // 没选中的兵种仍按屏幕内
      expect(typeN(1)).toBe(2);
      expect(typeOn(1)).toBe(false);
      // 镜头移动，屏幕内只剩一个没选的、选中的全出了屏幕：选中兵种的人数不变，卡片还在
      bar.update([0, 1, 2], [4]);
      expect(typeN(0)).toBe(3);
      expect(hasType(0)).toBe(true);
      expect(typeN(1)).toBe(1);
    });

    it('屏幕内有同兵种的未选中者时，选中兵种仍只写选中的人数', () => {
      bar.update([0], [0, 1, 2, 3]);
      expect(typeN(0)).toBe(1);
    });

    it('选中的单位全不在屏幕内也有卡片', () => {
      bar.update([7, 8], []);
      expect(typeN(2)).toBe(2);
    });
  });

  describe('「选 N」角标', () => {
    const badges = (): string[] => [...roster().matchAll(/<span class="sel">([^<]*)<\/span>/g)].map(m => m[1]);
    /** 兵种卡片（从第一个 data-t 起）的 html */
    const typeCards = (): string => roster().slice(roster().indexOf('data-t='));

    it('兵种卡片没有「选 N」角标，不论选没选中', () => {
      bar.update([0, 1, 4], [0, 1, 2, 4]);
      expect(typeCards()).not.toContain('class="sel"');
      expect(typeCards()).not.toMatch(/选 \d+<\/span>/);
      bar.update([0, 1, 4], [0, 1, 2, 4], true);
      expect(typeCards()).not.toContain('class="sel"');
    });

    it('全选卡片：有选中、但不处于选中态（allPicked 为 false）时显示「选 N」', () => {
      bar.update([0, 1], [0, 1, 2]);
      expect(badges()).toEqual(['选 2']);
      bar.update([0, 1, 4], [0, 1, 2], false);
      expect(badges()).toEqual(['选 3']);
    });

    it('全选卡片处于选中态（allPicked 为 true）时不显示', () => {
      bar.update([0, 1], [0, 1, 2], true);
      expect(badges()).toEqual([]);
    });

    it('没有选中时不显示', () => {
      bar.update([], [0, 1, 2]);
      expect(badges()).toEqual([]);
    });

    it('allPicked 切换时角标跟着出现和消失', () => {
      bar.update([0, 1], [0, 1, 2], false);
      expect(badges()).toEqual(['选 2']);
      bar.update([0, 1], [0, 1, 2], true);
      expect(badges()).toEqual([]);
      bar.update([0, 1], [0, 1, 2], false);
      expect(badges()).toEqual(['选 2']);
    });
  });

  describe('卡片提示（title）末尾都有「按住不动：弹出升级选择」一行', () => {
    const HOLD_LINE = '\n按住不动：弹出升级选择';
    const titleOf = (html: string, attr: string): string => {
      const m = new RegExp(`${attr} title="([^"]*)"`).exec(html);
      expect(m, html).not.toBeNull();
      return m![1];
    };

    it('兵种卡片：没选中与选中时都是', () => {
      bar.update([], [0, 1, 4]);
      expect(titleOf(roster(), 'data-t="0"').endsWith(HOLD_LINE)).toBe(true);
      bar.update([0, 1], [0, 1, 4]);
      expect(titleOf(roster(), 'data-t="0"').endsWith(HOLD_LINE)).toBe(true);
    });

    it('全选卡片：没选中与处于选中态时都是', () => {
      bar.update([], [0, 1, 4]);
      expect(titleOf(roster(), 'data-all="1"').endsWith(HOLD_LINE)).toBe(true);
      bar.update([0, 1, 4], [0, 1, 4], true);
      expect(titleOf(roster(), 'data-all="1"').endsWith(HOLD_LINE)).toBe(true);
    });

    it('编队卡片：没选中这一队与选中了都是', () => {
      bar.setGroups([{ g: 2, slots: [0, 1] }]);
      const groups = (): string => (bar.groupRow as unknown as FakeEl).innerHTML;
      bar.update([], [0, 1]);
      expect(titleOf(groups(), 'data-g="2"').endsWith(HOLD_LINE)).toBe(true);
      bar.update([0, 1], [0, 1]);
      expect(titleOf(groups(), 'data-g="2"').endsWith(HOLD_LINE)).toBe(true);
    });
  });

  describe('全选卡片', () => {
    it('allPicked 为 true：带 on，人数写 sel.length（不是屏幕内的人数）', () => {
      bar.update([0, 1, 2, 4], [0, 1, 2, 3, 4, 5, 6], true);
      expect(all().cls).toContain(' on');
      expect(all().n).toBe(4);
    });

    it('allPicked 为 true 时屏幕内没人也写 sel.length、不变暗（不带 off）', () => {
      bar.update([0, 1, 2], [], true);
      const a = all();
      expect(a.cls).toContain(' on');
      expect(a.cls).not.toContain('off');
      expect(a.n).toBe(3);
    });

    it('allPicked 为 true 时 sel 的人数不随屏幕内的人数变化', () => {
      bar.update([0, 1], [0, 1, 2, 3], true);
      expect(all().n).toBe(2);
      bar.update([0, 1], [2], true);
      expect(all().n).toBe(2);
    });

    it('allPicked 为 false：人数写屏幕内的人数，不带 on', () => {
      bar.update([0], [0, 1, 4]);
      const a = all();
      expect(a.n).toBe(3);
      expect(a.cls).not.toContain('on');
      expect(a.cls).not.toContain('off');
    });

    it('allPicked 默认为 false', () => {
      bar.update([0], [0, 1, 4]);
      expect(all().n).toBe(3);
      expect(all().cls).not.toContain('on');
    });

    it('allPicked 为 false 时屏幕内没人变暗（带 off），人数写 0，选着的人在屏幕外也一样', () => {
      bar.update([0, 1], [], false);
      const a = all();
      expect(a.cls).toContain('off');
      expect(a.cls).not.toContain('on');
      expect(a.n).toBe(0);
    });

    it('不再自己按「屏幕内的人全都选着」判 on：allPicked 为 false 时即使屏幕内的人全选着也不带 on', () => {
      bar.update([0, 1, 4], [0, 1, 4], false);
      expect(all().cls).not.toContain('on');
      expect(all().n).toBe(3);
    });

    it('allPicked 为 true 与 false 之间切换，卡片跟着变', () => {
      bar.update([0, 1], [0, 1, 2], true);
      expect(all().cls).toContain(' on');
      bar.update([0, 1], [0, 1, 2], false);
      expect(all().cls).not.toContain(' on');
      expect(all().n).toBe(3);
    });
  });
});

describe('allCardPicked 选择变化那一刻全选卡片是否处于选中态（按屏幕判定）', () => {
  it('选择为空：不是选中态，不论屏幕内有没有人', () => {
    expect(allCardPicked([], [1, 2])).toBe(false);
    expect(allCardPicked([], [])).toBe(false);
  });

  it('屏幕内的己方单位全都被选着才是选中态（list 里多出别的人、顺序不同都算）', () => {
    expect(allCardPicked([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(allCardPicked([1, 2, 3, 9], [1, 2, 3])).toBe(true);
    expect(allCardPicked([3, 2, 1], [1, 2])).toBe(true);
  });

  it('屏幕内有人没被选着就不是选中态', () => {
    expect(allCardPicked([1, 2], [1, 2, 3])).toBe(false);
    expect(allCardPicked([9], [1])).toBe(false);
  });

  it('屏幕内没有己方单位不算选中态（选的全在屏幕外）', () => {
    expect(allCardPicked([1, 2], [])).toBe(false);
  });
});
