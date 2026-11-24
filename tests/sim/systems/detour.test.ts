import { describe, expect, it } from 'vitest';
import { RULES, T_MOUNTAIN, TILE, UNIT_BY_KEY } from '../../../src/sim/defs';
import { S_ROUT } from '../../../src/sim/state';
import { OPENING, detourPasses, findOpening } from '../../../src/sim/systems/detour';
import type { World } from '../../../src/sim/world';
import { flatWorld } from '../../helpers';

const N = 120;
const C = (N * TILE) / 2;
const idx = (k: string): number => UNIT_BY_KEY[k].idx;

describe('findOpening：敌群外缘的空位', () => {
  /**
   * 3×3 的敌方方阵（血量无限、原地待命），中心在 (C + 200, C)，间距 S = 两个身位；
   * 己方在方阵外圈 5×5 的格点上贴满一圈（open 指定哪几列 / 行不放），i 是外圈后面一个身位远的追击者。
   */
  const scene = (opts: { seed?: number; paint?: (t: Uint8Array, n: number) => void; skip?: (gx: number, gy: number) => boolean } = {}) => {
    const w = flatWorld(N, opts.seed ?? 7, opts.paint);
    const probe = w.spawnUnit(idx('legion'), 2, 0, 0);
    const rr = w.rad[probe];
    w.removeUnit(probe);
    const S = 2 * rr;
    const cx = C + 200, cy = C;
    const foes: number[][] = [];
    for (let gx = -1; gx <= 1; gx++) {
      foes.push([]);
      for (let gy = -1; gy <= 1; gy++) foes[gx + 1].push(w.spawnUnit(idx('legion'), 2, cx + gx * S, cy + gy * S));
    }
    const all = foes.flat();
    for (const e of all) w.hp[e] = w.maxHp[e] = 1e9;
    w.orderStop(all, true);
    const ring: number[] = [];
    for (let gx = -2; gx <= 2; gx++) {
      for (let gy = -2; gy <= 2; gy++) {
        if (Math.abs(gx) < 2 && Math.abs(gy) < 2) continue;
        if (opts.skip?.(gx, gy)) continue;
        ring.push(w.spawnUnit(idx('legion'), 1, cx + gx * S, cy + gy * S));
      }
    }
    // 追击者在西侧外圈再往后一个身位
    const me = w.spawnUnit(idx('legion'), 1, cx - 4 * S, cy);
    // 跑一帧让索敌用的网格、可见性建起来（全体原地，位置几乎不动）
    w.tick();
    w.fxN = 0;
    return { w, foes, all, ring, me, S, cx, cy };
  };

  /** 点 (x, y) 上没有任何除 me 以外的单位压着 */
  const nobodyAt = (w: World, me: number, x: number, y: number): boolean => {
    for (let j = 0; j < w.n; j++) {
      if (!w.alive[j] || j === me) continue;
      if (Math.hypot(w.x[j] - x, w.y[j] - y) < (w.rad[j] + w.rad[me]) * 0.9) return false;
    }
    return true;
  };

  it('敌群西、北、南三面都被我方贴满、东面空着：空位在东面，属于外缘的敌兵，且上面没有人', () => {
    const { w, foes, all, me, S, cx } = scene({ skip: (gx) => gx === 2 });
    const tgt = foes[0][1];
    expect(findOpening(w, me, tgt)).toBe(true);
    expect(OPENING.x).toBeGreaterThan(cx + S / 2);
    expect(all).toContain(OPENING.foe);
    // 中间那个敌兵四周都是自己人，轮不到它
    expect(OPENING.foe).not.toBe(foes[1][1]);
    expect(nobodyAt(w, me, OPENING.x, OPENING.y)).toBe(true);
    // 对照：有人站着的点（目标自己的位置）这个判定要给出「有人」
    expect(nobodyAt(w, me, w.x[tgt], w.y[tgt])).toBe(false);
    // 空位贴着它所属的敌兵：离得不比身位和远多少
    const f = OPENING.foe;
    expect(Math.hypot(OPENING.x - w.x[f], OPENING.y - w.y[f])).toBeLessThan(w.rad[f] + w.rad[me] + 8);
    // 绕行圆的圆心在敌群中央，半径罩得住整个敌群
    expect(Math.hypot(OPENING.cx - cx, OPENING.cy - C)).toBeLessThan(S);
    expect(OPENING.r).toBeGreaterThan(S);
  });

  it('敌群四周全被贴满：没有空位', () => {
    const { w, foes, me } = scene();
    expect(findOpening(w, me, foes[0][1])).toBe(false);
    expect(findOpening(w, me, foes[2][1])).toBe(false);
  });

  it('只让出东面，但东面是不可通行地形：没有空位；同样的摆法地形平坦时找得到', () => {
    const open = scene({ skip: (gx) => gx === 2 });
    expect(findOpening(open.w, open.me, open.foes[0][1])).toBe(true);
    // 东面一整片山：敌群东边缘外一个身位起都是不可通行格
    const east = open.cx + 2 * open.S + 2;
    const blocked = scene({
      skip: (gx) => gx === 2,
      paint: (t, n) => {
        for (let ty = 0; ty < n; ty++) for (let tx = Math.floor(east / TILE); tx < n; tx++) t[ty * n + tx] = T_MOUNTAIN;
      },
    });
    expect(findOpening(blocked.w, blocked.me, blocked.foes[0][1])).toBe(false);
  });

  it('only 为真时空位只属于传入的目标', () => {
    const { w, foes, me } = scene({ skip: (gx) => gx === 2 });
    const west = foes[0][1], east = foes[2][1];
    // 不限定时能找到；限定为四周都堵死的西侧敌兵就没有
    expect(findOpening(w, me, west)).toBe(true);
    expect(findOpening(w, me, west, west)).toBe(false);
    // 限定为东侧敌兵：找得到，且空位属于它
    expect(findOpening(w, me, west, east)).toBe(true);
    expect(OPENING.foe).toBe(east);
    expect(OPENING.x).toBeGreaterThan(w.x[east]);
    expect(nobodyAt(w, me, OPENING.x, OPENING.y)).toBe(true);
  });

  it('传入 keep 时空位只属于 keep 判为真的敌兵：全判假找不到，不传不受限', () => {
    const { w, foes, me } = scene({ skip: (gx) => gx === 2 });
    const tgt = foes[0][1];
    const east = new Set(foes[2]);
    // 空位都在东面，属于东列；keep 只放行西、中两列：找不到
    expect(findOpening(w, me, tgt, -1, Infinity, 0, f => !east.has(f))).toBe(false);
    // 只放行东列：找得到，且空位属于东列
    expect(findOpening(w, me, tgt, -1, Infinity, 0, f => east.has(f))).toBe(true);
    expect(east.has(OPENING.foe)).toBe(true);
    // 全判假：找不到
    expect(findOpening(w, me, tgt, -1, Infinity, 0, () => false)).toBe(false);
    // 不传：不受限
    expect(findOpening(w, me, tgt)).toBe(true);
  });

  it('溃逃的敌兵不计入敌群，也不会成为空位的所属者', () => {
    const { w, foes, me } = scene({ skip: (gx) => gx === 2 });
    const tgt = foes[0][1];
    expect(findOpening(w, me, tgt)).toBe(true);
    // 东列三个标成溃兵：空位只可能属于他们，现在没有了（他们仍站在原地占着位）
    for (const e of foes[2]) w.state[e] |= S_ROUT;
    expect(findOpening(w, me, tgt)).toBe(false);
  });
});

describe('findOpening：待命单位只看离岗位在追击范围内的敌兵', () => {
  it('敌群东列离岗位超出 leash2 时，空位（都在东面）不算；放宽到够得着就找得到', () => {
    const w = flatWorld(N, 7);
    const probe = w.spawnUnit(idx('legion'), 2, 0, 0);
    const S = 2 * w.rad[probe];
    w.removeUnit(probe);
    const cx = C + 200, cy = C;
    const foes: number[][] = [];
    for (let gx = -1; gx <= 1; gx++) {
      foes.push([]);
      for (let gy = -1; gy <= 1; gy++) foes[gx + 1].push(w.spawnUnit(idx('legion'), 2, cx + gx * S, cy + gy * S));
    }
    const all = foes.flat();
    for (const e of all) w.hp[e] = w.maxHp[e] = 1e9;
    w.orderStop(all, true);
    // 西、北、南三面贴满己方，东面空着
    for (let gx = -2; gx <= 1; gx++) {
      for (let gy = -2; gy <= 2; gy++) {
        if (Math.abs(gx) < 2 && Math.abs(gy) < 2) continue;
        w.spawnUnit(idx('legion'), 1, cx + gx * S, cy + gy * S);
      }
    }
    const me = w.spawnUnit(idx('legion'), 1, cx - 4 * S, cy);
    w.tick();
    w.fxN = 0;
    const tgt = foes[0][1];
    const homeD = Math.hypot(w.x[foes[2][1]] - w.homeX[me], w.y[foes[2][1]] - w.homeY[me]);
    const westD = Math.hypot(w.x[foes[0][1]] - w.homeX[me], w.y[foes[0][1]] - w.homeY[me]);
    expect(homeD).toBeGreaterThan(westD + S);
    // 范围只盖到西列和中列：东面的空位都属于东列，找不到
    const near = ((westD + homeD) / 2) ** 2;
    expect(findOpening(w, me, tgt, -1, Infinity, near)).toBe(false);
    // 范围盖到东列：找得到，且空位属于东列
    expect(findOpening(w, me, tgt, -1, Infinity, (homeD + 2 * S) ** 2)).toBe(true);
    expect(foes[2]).toContain(OPENING.foe);
    // 不设范围（leash2 为 0）：不限制
    expect(findOpening(w, me, tgt)).toBe(true);
  });
});

describe('findOpening：敌群很大时空位仍在真正空着的外缘', () => {
  /**
   * 15×15 的敌方方阵（225 个，超过一次试空位的敌兵数上限），中心在地图中央；
   * dir 这一面被己方贴满一排（再后面一排 i 在等），其余三面空着。
   */
  const bigScene = (dir: [number, number]) => {
    const w = flatWorld(N, 7);
    const probe = w.spawnUnit(idx('legion'), 2, 0, 0);
    const S = 2 * w.rad[probe];
    w.removeUnit(probe);
    const cx = C, cy = C, H = 7;
    const foes: number[] = [];
    for (let gx = -H; gx <= H; gx++) {
      for (let gy = -H; gy <= H; gy++) foes.push(w.spawnUnit(idx('legion'), 2, cx + gx * S, cy + gy * S));
    }
    for (const e of foes) w.hp[e] = w.maxHp[e] = 1e9;
    w.orderStop(foes, true);
    const [dx, dy] = dir;
    for (let k = -H; k <= H; k++) w.spawnUnit(idx('legion'), 1, cx + dx * (H + 1) * S - dy * k * S, cy + dy * (H + 1) * S + dx * k * S);
    const me = w.spawnUnit(idx('legion'), 1, cx + dx * (H + 4) * S, cy + dy * (H + 4) * S);
    w.tick();
    w.fxN = 0;
    // 贴满的那一排正对着的敌兵当目标
    const tgt = foes.reduce((b, e) => (w.x[e] - cx) * dx + (w.y[e] - cy) * dy > (w.x[b] - cx) * dx + (w.y[b] - cy) * dy
      && Math.abs((w.x[e] - cx) * -dy + (w.y[e] - cy) * dx) < S ? e : b, foes[0]);
    return { w, foes, me, tgt, S, cx, cy, H };
  };

  it.each([
    ['西', [-1, 0]],
    ['东', [1, 0]],
    ['北', [0, -1]],
    ['南', [0, 1]],
  ] as [string, [number, number]][])('%s面被贴满：找到的空位不在这一面，是外缘敌兵身边真正没人的点', (_name, dir) => {
    const { w, foes, me, tgt, S, cx, cy, H } = bigScene(dir);
    expect(foes.length).toBeGreaterThan(128);
    expect(findOpening(w, me, tgt)).toBe(true);
    const f = OPENING.foe;
    expect(foes).toContain(f);
    // 空位不在被贴满的这一面：要么没越过方阵朝这一面的边，要么已绕过贴满的那一排的尽头（拐角处真空着的点）
    const along = (OPENING.x - cx) * dir[0] + (OPENING.y - cy) * dir[1];
    const lateral = Math.abs(-(OPENING.x - cx) * dir[1] + (OPENING.y - cy) * dir[0]);
    if (along > H * S) expect(lateral).toBeGreaterThan(H * S);
    // 空位上没有任何别的单位
    for (let j = 0; j < w.n; j++) {
      if (!w.alive[j] || j === me) continue;
      expect(Math.hypot(w.x[j] - OPENING.x, w.y[j] - OPENING.y)).toBeGreaterThan((w.rad[j] + w.rad[me]) * 0.9);
    }
    // 所属敌兵在方阵边缘一圈（不是被围在中间的）
    const edge = Math.max(Math.abs(w.x[f] - cx), Math.abs(w.y[f] - cy));
    expect(edge).toBeGreaterThan((H - 1) * S);
  });
});

describe('detourPasses：绕行的人能不能穿过某个自己人', () => {
  const pair = () => {
    const w = flatWorld(N, 7);
    const i = w.spawnUnit(idx('legion'), 1, C, C);
    const j = w.spawnUnit(idx('legion'), 1, C + 5, C);
    return { w, i, j };
  };

  it('没在交手、没在绕行、自己也走得动：能穿过', () => {
    const { w, i, j } = pair();
    expect(detourPasses(w, i, j)).toBe(true);
  });

  it('对方站定出手（planted 为 1）：不能穿过', () => {
    const { w, i, j } = pair();
    w.planted[j] = 1;
    expect(detourPasses(w, i, j)).toBe(false);
  });

  it('对方在交手（骑兵交手时脚下可以动，不算站定，也不能穿过）：不能穿过', () => {
    const { w, i, j } = pair();
    w.engaged[j] = 1;
    expect(detourPasses(w, i, j)).toBe(false);
  });

  it('对方也在绕行：不能穿过', () => {
    const { w, i, j } = pair();
    w.detourT[j] = 3;
    expect(detourPasses(w, i, j)).toBe(false);
  });

  it('自己连续走不动已超过 detourStallAfter 的 detourPassStall 比例：不再穿过', () => {
    const { w, i, j } = pair();
    const C2 = RULES.combat;
    w.detourStall[i] = C2.detourStallAfter * C2.detourPassStall * 0.9;
    expect(detourPasses(w, i, j)).toBe(true);
    w.detourStall[i] = C2.detourStallAfter * C2.detourPassStall * 1.1;
    expect(detourPasses(w, i, j)).toBe(false);
  });
});
