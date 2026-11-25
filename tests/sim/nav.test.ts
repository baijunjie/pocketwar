import { describe, expect, it } from 'vitest';
import { T_GRASS, T_MOUNTAIN } from '../../src/sim/defs';
import { DIRX, DIRY, DIR_HERE, DIR_NONE, Nav } from '../../src/sim/nav';
import type { NavBuilding } from '../../src/sim/nav';

/** n×n 的平地，blocked 里的格子是矿山（不可通行）；最外一圈本来就不可通行 */
function grid(n: number, blocked: number[][] = []): Nav {
  const t = new Uint8Array(n * n).fill(T_GRASS);
  for (const [x, y] of blocked) t[y * n + x] = T_MOUNTAIN;
  return new Nav(n, n, t);
}

let nextId = 1;
/** 一座 1 格厚、len 格长的建筑，归 owner：wall 为真时是本方能走上去的城墙顶，gate 为真是城门 */
function strip(nav: Nav, tx: number, ty: number, len: number, owner: number, opt: { wall?: boolean; gate?: boolean } = {}): NavBuilding {
  const b: NavBuilding = {
    id: nextId++, tx, ty, w: len, h: 1, owner, alive: true, gate: !!opt.gate, hittable: true, breach: 5, climb: opt.wall ? 3 : 0,
  };
  nav.refresh(b);
  return b;
}

const cell = (nav: Nav, x: number, y: number): number => y * nav.w + x;

describe('canStepDiag：斜着迈一步', () => {
  const n = 12;
  /** 四个斜向：a 在 (5, 5)，b 在 a 的斜对角；角格是与 a 同行、与 b 同列的那格，以及与 b 同行、与 a 同列的那格 */
  const diags = [[1, 1], [-1, 1], [-1, -1], [1, -1]];

  it('四格都空：四个斜向都能走', () => {
    const nav = grid(n);
    for (const [dx, dy] of diags) expect(nav.canStepDiag(1, cell(nav, 5, 5), cell(nav, 5 + dx, 5 + dy))).toBe(true);
  });

  it('两格本身或擦过的任一角格不可通行：不能斜着走（不擦着障碍角穿过）', () => {
    for (const [dx, dy] of diags) {
      const a = [5, 5], b = [5 + dx, 5 + dy], c1 = [5 + dx, 5], c2 = [5, 5 + dy];
      for (const bad of [a, b, c1, c2]) {
        const nav = grid(n, [bad]);
        expect(nav.canStepDiag(1, cell(nav, a[0], a[1]), cell(nav, b[0], b[1]))).toBe(false);
      }
    }
  });

  it('规则对称：四格的 16 种阻挡组合下，a→b 与 b→a 结果相同，且只有四格全空才能走', () => {
    for (const [dx, dy] of diags) {
      const cells = [[5, 5], [5 + dx, 5 + dy], [5 + dx, 5], [5, 5 + dy]];
      for (let mask = 0; mask < 16; mask++) {
        const nav = grid(n, cells.filter((_, k) => mask & (1 << k)));
        const a = cell(nav, 5, 5), b = cell(nav, 5 + dx, 5 + dy);
        expect(nav.canStepDiag(1, b, a)).toBe(nav.canStepDiag(1, a, b));
        expect(nav.canStepDiag(1, a, b)).toBe(mask === 0);
      }
    }
  });

  it('四格同在墙顶才能走：墙顶与地面之间只能正着上下，不能斜着；整块墙顶上斜着走不受限', () => {
    const nav = grid(n);
    // 2 格厚的墙顶：(4..7, 5) 与 (4..7, 6)
    strip(nav, 4, 5, 4, 1, { wall: true });
    strip(nav, 4, 6, 4, 1, { wall: true });
    // 墙顶内部斜着走
    expect(nav.canStepDiag(1, cell(nav, 5, 5), cell(nav, 6, 6))).toBe(true);
    expect(nav.canStepDiag(1, cell(nav, 6, 5), cell(nav, 5, 6))).toBe(true);
    // 墙顶边缘斜着下到地面：目标格与一个角格在地面
    expect(nav.canStepDiag(1, cell(nav, 5, 6), cell(nav, 6, 7))).toBe(false);
    expect(nav.canStepDiag(1, cell(nav, 6, 7), cell(nav, 5, 6))).toBe(false);
    // 墙端：沿墙端斜着上
    expect(nav.canStepDiag(1, cell(nav, 3, 4), cell(nav, 4, 5))).toBe(false);
    expect(nav.canStepDiag(1, cell(nav, 4, 5), cell(nav, 3, 4))).toBe(false);
    // 地面上斜着走照旧
    expect(nav.canStepDiag(1, cell(nav, 9, 9), cell(nav, 10, 10))).toBe(true);
  });

  it('按队伍分别判断：己方城门格对己方畅通、对敌方不通', () => {
    const nav = grid(n);
    strip(nav, 5, 5, 1, 1, { gate: true });
    const a = cell(nav, 4, 4), b = cell(nav, 5, 5);
    expect(nav.canStepDiag(1, a, b)).toBe(true);
    expect(nav.canStepDiag(2, a, b)).toBe(false);
  });
});

describe('流场与 canStepDiag 共用同一个斜步规则', () => {
  /** 固定的伪随机障碍：约两成的格子是山 */
  function rocky(n: number): Nav {
    let s = 12345;
    const rnd = (): number => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const blocked: number[][] = [];
    for (let y = 1; y < n - 1; y++) {
      for (let x = 1; x < n - 1; x++) {
        // 留出墙顶那一带
        if (rnd() < 0.2 && !(x >= 2 && x <= 15 && y >= 16 && y <= 19)) blocked.push([x, y]);
      }
    }
    // 一对对角相邻的障碍：之间只有一个角点的缝隙
    blocked.push([10, 10], [11, 11]);
    const nav = grid(n, blocked);
    // 一道带城内一侧的墙顶：(3..14, 17) 是墙顶，其下方一行 (3..14, 18) 是城内地面
    strip(nav, 3, 17, 12, 1, { wall: true });
    for (let x = 3; x <= 14; x++) nav.inner[cell(nav, x, 18)] = 1;
    return nav;
  }

  it('流场给出的每个斜向都不擦障碍角、不斜着上下墙顶；每个正向都符合墙顶的上下规则', () => {
    const n = 24;
    const nav = rocky(n);
    const blk = nav.block[1], dk = nav.deck[1];
    let diag = 0, bad = 0, checked = 0;
    for (const goal of [[20, 20], [2, 2], [20, 3], [8, 12], [12, 15]]) {
      const g = cell(nav, goal[0], goal[1]);
      if (blk[g]) continue;
      const f = nav.getField(1, g, 0);
      nav.finish(f);
      for (let c = 0; c < nav.n; c++) {
        const d = f.dirs[c];
        if (d === DIR_NONE || d === DIR_HERE) continue;
        checked++;
        const x = c % n, y = (c / n) | 0;
        const nx = x + DIRX[d], ny = y + DIRY[d];
        const b = cell(nav, nx, ny);
        if (d & 1) {
          diag++;
          const c1 = cell(nav, nx, y), c2 = cell(nav, x, ny);
          const open = !blk[c] && !blk[b] && !blk[c1] && !blk[c2];
          const level = dk[b] === dk[c] && dk[c1] === dk[c] && dk[c2] === dk[c];
          if (!open || !level) bad++;
        } else if (!(dk[c] === dk[b] || (dk[c] === 1 && nav.inner[b] === 1))) bad++;
      }
    }
    // 场景有效：确有大量斜向，并且场里确有墙顶格
    expect(checked).toBeGreaterThan(100);
    expect(diag).toBeGreaterThan(20);
    expect(dk.some(v => v === 1)).toBe(true);
    expect(bad).toBe(0);
  });

  it('两格对角相邻的障碍之间只有一个角点缝隙：流场不会斜着从缝隙里穿过', () => {
    const n = 12;
    const nav = grid(n, [[5, 5], [6, 6]]);
    // 目标 (6, 5) 在东北，起点 (5, 6) 在西南：两格本身都空，直接斜着走要擦过 (5,5) 与 (6,6) 两个障碍角
    const g = cell(nav, 6, 5);
    const f = nav.getField(1, g, 0);
    nav.finish(f);
    const d = f.dirs[cell(nav, 5, 6)];
    expect(d).not.toBe(DIR_NONE);
    expect(d).not.toBe(DIRX.findIndex((dx, k) => dx === 1 && DIRY[k] === -1));
  });
});
