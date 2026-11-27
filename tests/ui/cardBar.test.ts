import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { World } from '../../src/sim/world';
import { CardBar, allCardPicked } from '../../src/ui/cardBar';
import type { CardBarCallbacks } from '../../src/ui/cardBar';
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
  let area: FakeEl, overlay: FakeEl, view: FakeCanvas, mini: FakeCanvas;
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
  const down = (target: FakeEl | null, x: number, y: number, init: { button?: number; id?: number } = {}): Event =>
    firePointer(area, 'pointerdown', { clientX: x, clientY: y, pointerId: init.id ?? 1, button: init.button ?? 0, buttons: 1 }, target ?? (bar.roster as unknown as FakeEl));
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

  let cbs: CardBarCallbacks;
  /** 建 CardBar 并把两排卡片放进 area（真实的 hud 也是这样挂的）；topbar 是传给构造函数的顶栏 */
  const build = (topbar: FakeEl | null = null): void => {
    bar = new CardBar({} as World, () => '', mini as unknown as HTMLCanvasElement, overlay as unknown as HTMLElement, cbs,
      area as unknown as HTMLElement, topbar as unknown as HTMLElement | null);
    area.appendChild(bar.groupRow as unknown as FakeEl);
    area.appendChild(bar.roster as unknown as FakeEl);
    card = mkCard({ t: '3' });
    groupCard = mkCard({ g: '2' }, 'gcard');
    allCard = mkCard({ all: '1' }, 'acard');
    offCard = mkCard({ all: '1' }, 'acard', 'off');
    (bar.roster as unknown as FakeEl).append(allCard, card, offCard);
    (bar.groupRow as unknown as FakeEl).append(groupCard);
  };

  /** 换成传了顶栏的 CardBar：CardBar 销毁时不摘 area 上的监听，所以连 area 一起换新的 */
  const rebuild = (topbar: FakeEl | null, mobile: boolean): void => {
    bar.destroy();
    area = new FakeEl();
    area.rect = rectOf(0, 500, 400, 100);
    build(topbar);
    bar.mobile = mobile;
  };

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
    // 小地图画布是方的：左上 (120, 620)、边长 180，内切圆圆心 (210, 710)、半径 90
    mini.rect = rectOf(120, 620, 180, 180);
    dom.hit.fn = (_x, y) => (y < 500 ? view : y > 600 && y <= 800 ? mini : area);
    cbs = {
      pickTypes: (types, mode) => calls.push(`types ${types.join(',')} ${mode}`),
      pickAll: mode => calls.push(`all ${mode}`),
      selectGroup: (g, jump) => calls.push(`group ${g} ${jump}`),
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
        // 手指贴着屏幕底：落点在手指右边，落在小地图圆内
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

      it('手指贴着屏幕底也指得到小地图圆的下半截：落点是 mini，没有 nodrop', () => {
        // 手指 y=790 时落点约 (x + 99, 780)，在小地图圆内
        down(card, 110, 550);
        move(110, 790);
        expect(ghost()!.classList.contains('nodrop')).toBe(false);
        up(110, 790);
        expect(drops).toHaveLength(1);
        expect(drops[0].target).toBe('mini');
        expect(drops[0].y).toBeGreaterThan(770);
      });

      it('落点在小地图画布方形的角上（内切圆外）不算小地图：影子和剑 nodrop，松手不下令', () => {
        // 同一个落点（约 (209, 780)）：小地图画布在它右边（落点在画布左下角）、在它左边（落点在右下角）都在圆外
        for (const r of [rectOf(210, 620, 180, 180), rectOf(30, 620, 180, 180)]) {
          mini.rect = r;
          down(card, 110, 550);
          move(110, 790);
          expect(ghost()!.classList.contains('nodrop'), `${r.left}`).toBe(true);
          expect(sword()!.classList.contains('nodrop'), `${r.left}`).toBe(true);
          up(110, 790);
          expect(drops, `${r.left}`).toEqual([]);
          expect(overlay.children).toHaveLength(0);
        }
      });

      it('小地图不是正方形时按短边的一半作半径、圆心在矩形中心', () => {
        mini.rect = rectOf(0, 600, 400, 200);
        // 手指 (110, 700)：落点约 (160, 613)，离圆心 (200, 700) 约 95 < 100：圆内
        down(card, 110, 550);
        move(110, 700);
        expect(ghost()!.classList.contains('nodrop')).toBe(false);
        // 手指 (40, 700)：落点约 (90, 613)，离圆心约 140：圆外（按宽的一半 200 算就成了圆内）
        move(40, 700);
        expect(ghost()!.classList.contains('nodrop')).toBe(true);
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

      it('mapSide = −1：松手的落点用向左放倒的剑尖（落在小地图圆内就是 mini）；mapSide = 1 同一手指位置落点在圆外、不下令', () => {
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

      it('在按钮上按下被忽略：不捕获指针、不阻止默认行为、没有 hot', () => {
        const e = down(btn, 30, 550);
        expect(area.captured).toBeNull();
        expect(e.defaultPrevented).toBe(false);
        for (const c of [card, allCard, groupCard]) expect(c.classList.contains('hot')).toBe(false);
      });

      it('按在按钮的子节点（<b>✕</b>）上同样忽略', () => {
        const inner = new FakeEl('b');
        btn.appendChild(inner);
        const e = down(inner, 30, 550);
        expect(area.captured).toBeNull();
        expect(e.defaultPrevented).toBe(false);
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
      pickTypes: () => {}, pickAll: () => {}, selectGroup: () => {}, dropCard: () => {},
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
