import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { World } from '../../src/sim/world';
import { CardBar } from '../../src/ui/cardBar';
import type { CardBarCallbacks } from '../../src/ui/cardBar';
import { FakeCanvas, FakeEl, firePointer, installFakeDom, rectOf } from './fakeDom';

/*
 * 屏幕布局（竖屏）：画面 y < 500；卡片带 [500, 600]；小地图 (600, 800]；overlay 的底是 800。
 * 移动版落点 = 手指 y − 抬起量：手指在 y=300 离卡片带 200px，抬起量封顶 72，落点在 228；
 * 手指在 y=480 离卡片带 20px，抬起量 10，落点 470；手指在 y=700 抬起量 min(72, 50, 50) = 50，落点 650。
 */
describe('CardBar 拖卡片', () => {
  let calls: string[];
  let drops: { kind: string; id: number; x: number; y: number; target: string }[];
  let area: FakeEl, overlay: FakeEl, view: FakeCanvas, mini: FakeCanvas;
  let bar: CardBar;
  let card: FakeEl, groupCard: FakeEl, allCard: FakeEl, offCard: FakeEl;
  let dom: ReturnType<typeof installFakeDom>;

  const mkCard = (data: Record<string, string>, ...classes: string[]): FakeEl => {
    const c = new FakeEl();
    c.className = ['ucard', ...classes].join(' ');
    c.offsetWidth = 60;
    Object.assign(c.dataset, data);
    const sel = new FakeEl('span');
    sel.className = 'sel';
    c.appendChild(sel);
    return c;
  };
  const down = (target: FakeEl | null, x: number, y: number, init: { button?: number; id?: number } = {}): Event =>
    firePointer(area, 'pointerdown', { clientX: x, clientY: y, pointerId: init.id ?? 1, button: init.button ?? 0, buttons: 1 }, target ?? (bar.roster as unknown as FakeEl));
  const move = (x: number, y: number, buttons = 1): Event => firePointer(area, 'pointermove', { clientX: x, clientY: y, buttons });
  const up = (x: number, y: number): Event => firePointer(area, 'pointerup', { clientX: x, clientY: y, buttons: 0 });
  const ghost = (): FakeEl | undefined => overlay.children.find(c => c.classList.contains('ghost'));
  const sword = (): FakeEl | undefined => overlay.children.find(c => c.classList.contains('dragptr'));

  beforeEach(() => {
    vi.useFakeTimers();
    dom = installFakeDom(vi);
    calls = [];
    drops = [];
    area = new FakeEl();
    area.rect = rectOf(0, 500, 400, 100);
    overlay = new FakeEl();
    overlay.rect = rectOf(0, 0, 400, 800);
    view = new FakeCanvas();
    view.className = 'view';
    mini = new FakeCanvas();
    mini.className = 'minimap';
    // 小地图画布是方的：左上 (60, 620)、边长 180，内切圆圆心 (150, 710)、半径 90
    mini.rect = rectOf(60, 620, 180, 180);
    dom.hit.fn = (_x, y) => (y < 500 ? view : y > 600 && y <= 800 ? mini : area);
    const cb: CardBarCallbacks = {
      pickTypes: (types, mode) => calls.push(`types ${types.join(',')} ${mode}`),
      pickAll: mode => calls.push(`all ${mode}`),
      selectGroup: (g, jump) => calls.push(`group ${g} ${jump}`),
      dropCard: (kind, id, x, y, target) => drops.push({ kind, id, x, y, target }),
    };
    bar = new CardBar({} as World, () => '', mini as unknown as HTMLCanvasElement, overlay as unknown as HTMLElement, cb, area as unknown as HTMLElement);
    // 两排卡片放进 area（真实的 hud 也是这样挂的）
    area.appendChild(bar.groupRow as unknown as FakeEl);
    area.appendChild(bar.roster as unknown as FakeEl);
    card = mkCard({ t: '3' });
    groupCard = mkCard({ g: '2' }, 'gcard');
    allCard = mkCard({ all: '1' }, 'acard');
    offCard = mkCard({ all: '1' }, 'acard', 'off');
    (bar.roster as unknown as FakeEl).append(allCard, card, offCard);
    (bar.groupRow as unknown as FakeEl).append(groupCard);
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
      it('overlay 里出现卡片的影子和一把剑；影子去掉了选中态与「选 N」角标', () => {
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
        // 原卡片还在
        expect(card.parent).not.toBeNull();
      });

      it('落点是 (手指 x, 手指 y − 抬起量)：剑在落点，影子在落点右下方 22px', () => {
        down(card, 100, 550);
        move(120, 300);
        expect(sword()!.style.transform).toBe('translate(120px, 228px)');
        expect(ghost()!.style.transform).toBe('translate(142px, 250px) scale(0.8)');
      });

      it('手指刚离开卡片带时抬得少：y=480 落点在 470', () => {
        down(card, 100, 550);
        move(100, 480);
        expect(sword()!.style.transform).toBe('translate(100px, 470px)');
        expect(ghost()!.style.transform).toBe('translate(122px, 492px) scale(0.8)');
      });

      it('往下进小地图一侧也抬起：y=700 落点在 650', () => {
        down(card, 100, 550);
        move(100, 700);
        expect(sword()!.style.transform).toBe('translate(100px, 650px)');
      });

      it('手指到屏幕底时落点也在屏幕底', () => {
        down(card, 100, 550);
        move(100, 800);
        expect(sword()!.style.transform).toBe('translate(100px, 800px)');
      });

      it('跟着手指移动更新', () => {
        down(card, 100, 550);
        move(100, 300);
        move(200, 100);
        expect(sword()!.style.transform).toBe('translate(200px, 50px)');
        expect(ghost()!.style.transform).toBe('translate(222px, 72px) scale(0.8)');
      });

      it('接近屏幕顶时抬起量降下来，手指到屏幕顶时落点也在屏幕顶', () => {
        down(card, 100, 550);
        move(100, 20);
        expect(sword()!.style.transform).toBe('translate(100px, 10px)');
        move(100, 0);
        expect(sword()!.style.transform).toBe('translate(100px, 0px)');
        move(100, -30);
        expect(sword()!.style.transform).toBe('translate(100px, -30px)');
      });

      it('屏幕顶不在 0 时按 overlay 的顶算', () => {
        overlay.rect = rectOf(0, 100, 400, 700);
        down(card, 100, 550);
        move(100, 120);
        expect(sword()!.style.transform).toBe('translate(100px, 110px)');
        move(100, 100);
        expect(sword()!.style.transform).toBe('translate(100px, 100px)');
      });

      it('影子右边放得下就在落点右下方 22px，到右边界刚好放下还是右下方', () => {
        // 影子宽 60 × 0.8 = 48：x + 22 + 48 = 400 刚好放下
        down(card, 100, 550);
        move(330, 300);
        expect(ghost()!.style.transform).toBe('translate(352px, 250px) scale(0.8)');
      });

      it('右边放不下（会伸出 overlay 右边）就翻到落点左下方，y 不变，剑不动', () => {
        down(card, 100, 550);
        move(340, 300);
        expect(ghost()!.style.transform).toBe('translate(270px, 250px) scale(0.8)');
        expect(sword()!.style.transform).toBe('translate(340px, 228px)');
        move(331, 300);
        expect(ghost()!.style.transform).toBe('translate(261px, 250px) scale(0.8)');
        // 回到左边又翻回右下方
        move(200, 300);
        expect(ghost()!.style.transform).toBe('translate(222px, 250px) scale(0.8)');
      });

      it('翻到左下方后要等右边空出至少 40px 才翻回右下方（回差）：影子宽 48，x=290 才翻回', () => {
        down(card, 340, 550);
        move(340, 300);
        expect(ghost()!.style.transform).toBe('translate(270px, 250px) scale(0.8)');
        // 右边只空出 30px：仍在左下方
        move(300, 300);
        expect(ghost()!.style.transform).toBe('translate(230px, 250px) scale(0.8)');
        move(315, 300);
        expect(ghost()!.style.transform).toBe('translate(245px, 250px) scale(0.8)');
        // 刚好空出 40px：翻回右下方
        move(290, 300);
        expect(ghost()!.style.transform).toBe('translate(312px, 250px) scale(0.8)');
        // 翻回以后又回到「放得下就是右下方」：x=300 右边空 30px，不翻
        move(300, 300);
        expect(ghost()!.style.transform).toBe('translate(322px, 250px) scale(0.8)');
        // 再往右放不下才翻
        move(331, 300);
        expect(ghost()!.style.transform).toBe('translate(261px, 250px) scale(0.8)');
      });

      it('每次新的拖拽从没翻开始：上次松手时在左下方，这次在回差区间里仍是右下方', () => {
        down(card, 340, 550);
        move(340, 300);
        up(340, 300);
        down(card, 300, 550);
        move(300, 300);
        expect(ghost()!.style.transform).toBe('translate(322px, 250px) scale(0.8)');
      });

      it('取消后再拖同样从没翻开始', () => {
        down(card, 340, 550);
        move(340, 300);
        firePointer(area, 'pointercancel', { pointerId: 1 });
        down(card, 300, 550);
        move(300, 300);
        expect(ghost()!.style.transform).toBe('translate(322px, 250px) scale(0.8)');
      });

      it('翻到左下方后 nodrop 照常按落点判断', () => {
        down(card, 380, 550);
        move(380, 570);
        expect(ghost()!.classList.contains('nodrop')).toBe(true);
        move(380, 300);
        expect(ghost()!.classList.contains('nodrop')).toBe(false);
      });

      it('落点在画面上时影子和剑都没有 nodrop；在小地图上也没有', () => {
        down(card, 100, 550);
        move(100, 300);
        expect(ghost()!.classList.contains('nodrop')).toBe(false);
        expect(sword()!.classList.contains('nodrop')).toBe(false);
        move(100, 700);
        expect(ghost()!.classList.contains('nodrop')).toBe(false);
        expect(sword()!.classList.contains('nodrop')).toBe(false);
      });

      it('落点处不是画面也不是小地图（落在卡片带上）时影子和剑都有 nodrop，回到画面上就去掉', () => {
        down(card, 100, 550);
        move(100, 570);
        expect(ghost()!.classList.contains('nodrop')).toBe(true);
        expect(sword()!.classList.contains('nodrop')).toBe(true);
        move(100, 300);
        expect(ghost()!.classList.contains('nodrop')).toBe(false);
        expect(sword()!.classList.contains('nodrop')).toBe(false);
      });

      it('判断落点用的是落点坐标，不是手指坐标', () => {
        // 命中检测点到的是落点 (100, 228)，不是手指 (100, 300)
        const seen: [number, number][] = [];
        dom.hit.fn = (x, y) => {
          seen.push([x, y]);
          return y < 500 ? view : null;
        };
        down(card, 100, 550);
        move(100, 300);
        expect(seen[seen.length - 1]).toEqual([100, 228]);
      });

      it('落点在小地图画布方形的四角（内切圆外）不算小地图：影子和剑 nodrop，松手不下令', () => {
        // 手指 y=700 时落点 y=650（离圆心 60px 高）；x=225 离圆心 hypot(75, 60) ≈ 96 > 90
        for (const x of [75, 225]) {
          down(card, x, 550);
          move(x, 700);
          expect(ghost()!.classList.contains('nodrop'), `x=${x}`).toBe(true);
          expect(sword()!.classList.contains('nodrop'), `x=${x}`).toBe(true);
          up(x, 700);
          expect(drops, `x=${x}`).toEqual([]);
          expect(overlay.children).toHaveLength(0);
        }
        // 下面两角：手指 y=780 时抬起量 10，落点 y=770
        for (const x of [65, 235]) {
          down(card, x, 550);
          move(x, 780);
          expect(ghost()!.classList.contains('nodrop'), `x=${x}`).toBe(true);
          up(x, 780);
          expect(drops, `x=${x}`).toEqual([]);
        }
        // 上面两角：手指 y=640 时抬起量 20，落点 y=620
        for (const x of [65, 235]) {
          down(card, x, 550);
          move(x, 640);
          expect(ghost()!.classList.contains('nodrop'), `x=${x}`).toBe(true);
          up(x, 640);
          expect(drops, `x=${x}`).toEqual([]);
        }
      });

      it('落点在小地图内切圆里仍是小地图（含靠近圆边的位置）', () => {
        down(card, 210, 550);
        move(210, 700);
        expect(ghost()!.classList.contains('nodrop')).toBe(false);
        expect(sword()!.classList.contains('nodrop')).toBe(false);
        up(210, 700);
        expect(drops).toEqual([{ kind: 'type', id: 3, x: 210, y: 650, target: 'mini' }]);
      });

      it('小地图不是正方形时按短边的一半作半径、圆心在矩形中心', () => {
        mini.rect = rectOf(0, 600, 400, 200);
        down(card, 200, 550);
        move(200, 700);
        expect(ghost()!.classList.contains('nodrop')).toBe(false);
        // 落点 (350, 650)：离圆心 (200, 700) 约 158 > 100
        move(350, 700);
        expect(ghost()!.classList.contains('nodrop')).toBe(true);
        move(280, 700);
        expect(ghost()!.classList.contains('nodrop')).toBe(false);
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

    describe('松手', () => {
      it('落点在画面上：回调 dropCard，传落点坐标而不是手指坐标', () => {
        down(card, 100, 550);
        move(120, 300);
        up(120, 300);
        expect(drops).toEqual([{ kind: 'type', id: 3, x: 120, y: 228, target: 'view' }]);
        expect(calls).toEqual([]);
      });

      it('落点在小地图上：target 是 mini', () => {
        down(card, 100, 550);
        move(150, 700);
        up(150, 700);
        expect(drops).toEqual([{ kind: 'type', id: 3, x: 150, y: 650, target: 'mini' }]);
      });

      it('松手点与最后一次移动点不同时按松手点算落点', () => {
        down(card, 100, 550);
        move(100, 300);
        up(180, 200);
        expect(drops).toEqual([{ kind: 'type', id: 3, x: 180, y: 128, target: 'view' }]);
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
        move(100, 570);
        up(100, 570);
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
        expect(drops).toEqual([{ kind: 'type', id: 3, x: 140, y: 425, target: 'view' }]);
      });

      it('同一次拖动里影子回到卡片带内再松手：取消', () => {
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

    it('右键不触发', () => {
      down(card, 100, 550, { button: 2 });
      expect(card.classList.contains('hot')).toBe(false);
      expect(area.captured).toBeNull();
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

    it('不做圆内判定：落在小地图方形的四角照旧算小地图', () => {
      for (const [x, y] of [[65, 625], [235, 625], [65, 790], [235, 790]]) {
        down(card, x, 550);
        move(x, y);
        expect(ghost()!.classList.contains('nodrop'), `${x},${y}`).toBe(false);
        up(x, y);
      }
      expect(drops.map(d => [d.x, d.y, d.target])).toEqual([[65, 625, 'mini'], [235, 625, 'mini'], [65, 790, 'mini'], [235, 790, 'mini']]);
    });

    it('靠右边也始终在鼠标右下方 14px，不翻转', () => {
      down(card, 390, 550);
      move(390, 300);
      expect(ghost()!.style.transform).toBe('translate(404px, 314px) scale(0.8)');
    });

    it('点按选中', () => {
      down(card, 100, 550);
      up(100, 550);
      expect(calls).toEqual(['types 3 replace']);
    });
  });
});
