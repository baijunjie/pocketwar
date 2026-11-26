import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { World } from '../../src/sim/world';
import { CardBar } from '../../src/ui/cardBar';
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
