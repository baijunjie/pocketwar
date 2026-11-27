import { describe, expect, it } from 'vitest';
import { DT, RULES, T_MOUNTAIN, TILE, UNIT_BY_KEY } from '../../../src/sim/defs';
import { GRID, NONE, O_AMOVE, O_IDLE, S_ROUT } from '../../../src/sim/state';
import { OPENING, STEP, detourPasses, findOpening, prowlGap, prowlPivot, prowlProgress, prowlStep, shooting, spotFree, startWait } from '../../../src/sim/systems/detour';
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

describe('findOpening：整圈没有空位的短时记忆', () => {
  /** 敌群四周全被贴满的场景，再加一个同队的追击者 me2；gap 是西面正对着目标 foes[0][1] 的那个己方兵 */
  const full = () => {
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
    let gap = -1, gapE = -1;
    for (let gx = -2; gx <= 2; gx++) {
      for (let gy = -2; gy <= 2; gy++) {
        if (Math.abs(gx) < 2 && Math.abs(gy) < 2) continue;
        const u = w.spawnUnit(idx('legion'), 1, cx + gx * S, cy + gy * S);
        if (gx === -2 && gy === 0) gap = u;
        if (gx === 2 && gy === 0) gapE = u;
      }
    }
    const me = w.spawnUnit(idx('legion'), 1, cx - 4 * S, cy);
    const me2 = w.spawnUnit(idx('legion'), 1, cx - 4 * S, cy + 2 * S);
    w.tick();
    w.fxN = 0;
    return { w, foes, me, me2, gap, gapE, tgt: foes[0][1] };
  };
  /** 让出一个位置（不推进多少时间：只跑一帧让网格更新） */
  const free = (w: World, u: number): void => {
    w.removeUnit(u);
    w.tick();
    w.fxN = 0;
  };

  it('对照：没有记忆时，让出一个位置后马上找得到', () => {
    const { w, me2, gap, tgt } = full();
    free(w, gap);
    expect(findOpening(w, me2, tgt)).toBe(true);
  });

  it('整圈没有空位：16 帧内别人再为同一个目标找，直接算没有，即使这时已经让出了位置', () => {
    const { w, me, me2, gap, tgt } = full();
    expect(findOpening(w, me, tgt)).toBe(false);
    free(w, gap);
    expect(findOpening(w, me2, tgt)).toBe(false);
    // 过了 16 帧：不再沿用，重新搜索就找得到（用时间点而不是真的跑 16 帧，免得两边的兵挪进空位）
    w.tickCount += 16;
    expect(findOpening(w, me2, tgt)).toBe(true);
  });

  it('记忆只对同一个目标有效：别的目标照常搜索', () => {
    const { w, foes, me, me2, gapE, tgt } = full();
    expect(findOpening(w, me, tgt)).toBe(false);
    free(w, gapE);
    expect(findOpening(w, me2, foes[2][1])).toBe(true);
  });

  it('带限定条件的搜索不读记忆：指定归属、离岗范围、过滤函数各自照常搜索', () => {
    const { w, me, me2, gap, tgt } = full();
    expect(findOpening(w, me, tgt)).toBe(false);
    free(w, gap);
    expect(findOpening(w, me2, tgt, tgt), 'only').toBe(true);
    expect(findOpening(w, me2, tgt, NONE, Infinity, 1e12), 'leash2').toBe(true);
    expect(findOpening(w, me2, tgt, NONE, Infinity, 0, () => true), 'keep').toBe(true);
  });

  it('带限定条件的搜索不写记忆：它没找到空位，之后不带限定的搜索照常找得到', () => {
    for (const mode of ['only', 'leash2', 'keep'] as const) {
      const { w, me, me2, gap, tgt } = full();
      const none = mode === 'only' ? findOpening(w, me, tgt, tgt)
        : mode === 'leash2' ? findOpening(w, me, tgt, NONE, Infinity, 1e12)
          : findOpening(w, me, tgt, NONE, Infinity, 0, () => true);
      expect(none, mode).toBe(false);
      free(w, gap);
      expect(findOpening(w, me2, tgt), mode).toBe(true);
    }
  });

  it('没找到是因为空位离得太远没去看（速度 × 绕行时限很小）：不记，之后别人照常找得到', () => {
    const { w, foes, me, me2, gapE } = full();
    free(w, gapE);
    // 东面让出的位置离西侧的目标很远；给一个小得走不到的速度，没有空位在代价之内
    const west = foes[0][1];
    expect(findOpening(w, me, west, NONE, 1), '嫌远没看').toBe(false);
    expect(findOpening(w, me2, west), '别人照常搜索').toBe(true);
  });
});


describe('findOpening：敌群大到试不全时不写记忆', () => {
  /**
   * (2h+1)×(2h+1) 的敌方方阵（血量无限）被己方贴满一圈；me、me2 是西面的两个追击者；gap 是正对着西列中间敌兵 tgt 的那个己方兵。
   * 128 个以内能试全，超过就只试离自己最近的 128 个。
   */
  const big = (h: number) => {
    const w = flatWorld(N, 7);
    const probe = w.spawnUnit(idx('legion'), 2, 0, 0);
    const S = 2 * w.rad[probe];
    w.removeUnit(probe);
    const cx = C + 200, cy = C;
    const foes: number[] = [];
    let tgt = -1;
    for (let gx = -h; gx <= h; gx++) {
      for (let gy = -h; gy <= h; gy++) {
        const e = w.spawnUnit(idx('legion'), 2, cx + gx * S, cy + gy * S);
        if (gx === -h && gy === 0) tgt = e;
        foes.push(e);
      }
    }
    for (const e of foes) w.hp[e] = w.maxHp[e] = 1e9;
    w.orderStop(foes, true);
    let gap = -1;
    for (let gx = -h - 1; gx <= h + 1; gx++) {
      for (let gy = -h - 1; gy <= h + 1; gy++) {
        if (Math.abs(gx) <= h && Math.abs(gy) <= h) continue;
        const u = w.spawnUnit(idx('legion'), 1, cx + gx * S, cy + gy * S);
        if (gx === -h - 1 && gy === 0) gap = u;
      }
    }
    const me = w.spawnUnit(idx('legion'), 1, cx - (h + 4) * S, cy);
    const me2 = w.spawnUnit(idx('legion'), 1, cx - (h + 4) * S, cy + 2 * S);
    w.tick();
    w.fxN = 0;
    return { w, foes, me, me2, gap, tgt };
  };
  /** 整圈没空位、第一个人没找到之后让出一个位置，第二个人再找：返回第二个人的结果（true 表示没有沿用「没有空位」的记忆） */
  const second = (h: number): { n: number; found: boolean } => {
    const { w, foes, me, me2, gap, tgt } = big(h);
    expect(findOpening(w, me, tgt), '场景前提：整圈没有空位').toBe(false);
    w.removeUnit(gap);
    w.tick();
    w.fxN = 0;
    return { n: foes.length, found: findOpening(w, me2, tgt) };
  };

  it('对照：敌兵不超过 128 个（试得全）：记忆照常写，别人再找直接没有', () => {
    const r = second(5);
    expect(r.n).toBeLessThanOrEqual(128);
    expect(r.found).toBe(false);
  });

  it('敌兵超过 128 个（只试得了离自己最近的一部分）：不写记忆，别人再找照常搜索', () => {
    const r = second(7);
    expect(r.n).toBeGreaterThan(128);
    expect(r.found).toBe(true);
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

describe('shooting：是不是正在射击的远程单位', () => {
  const unit = (key: string, engaged: number) => {
    const w = flatWorld(N, 7);
    const j = w.spawnUnit(idx(key), 1, C, C);
    w.engaged[j] = engaged;
    return { w, j };
  };

  it('远程单位射程内有目标、正在交手：是', () => {
    const { w, j } = unit('sagitt', 1);
    expect(w.defs[w.type[j]].melee).toBe(false);
    expect(shooting(w, j)).toBe(true);
  });

  it('远程单位没在交手：不是', () => {
    const { w, j } = unit('sagitt', 0);
    expect(shooting(w, j)).toBe(false);
  });

  it('近战单位即使在交手：不是', () => {
    for (const key of ['legion', 'equites', 'elephant']) {
      const { w, j } = unit(key, 1);
      expect(w.defs[w.type[j]].melee, key).toBe(true);
      expect(shooting(w, j), key).toBe(false);
    }
  });
});

describe('startWait：等一会儿再挤', () => {
  const lone = () => {
    const w = flatWorld(N, 7);
    const i = w.spawnUnit(idx('legion'), 1, C, C);
    return { w, i };
  };

  it('等待时长 1.5 秒起，连续等的次数越多越久，不超过 4 秒；次数累加', () => {
    const { w, i } = lone();
    const secs: number[] = [];
    for (let k = 0; k < 6; k++) {
      startWait(w, i);
      secs.push(w.waitT[i]);
    }
    expect(secs[0]).toBeCloseTo(RULES.combat.waitBase, 5);
    for (let k = 1; k < secs.length; k++) expect(secs[k]).toBeGreaterThanOrEqual(secs[k - 1]);
    expect(secs[1]).toBeGreaterThan(secs[0]);
    expect(Math.max(...secs)).toBeLessThanOrEqual(RULES.combat.waitMax);
    expect(secs[5]).toBe(RULES.combat.waitMax);
    expect(w.waits[i]).toBe(6);
  });

  it('prowl 为假：站着等，游走状态清掉，时长规则同上', () => {
    const { w, i } = lone();
    w.prowl[i] = 1;
    startWait(w, i, false);
    expect(w.prowl[i]).toBe(0);
    expect(w.waitT[i]).toBeCloseTo(RULES.combat.waitBase, 5);
  });

  it('prowl 为真：游走，方向为 ±1，绕的敌兵与量好的距离、已走不动的计时都清零重来', () => {
    const { w, i } = lone();
    w.prowlPivot[i] = 5;
    w.prowlD[i] = 77;
    w.prowlStall[i] = 0.4;
    startWait(w, i, true);
    expect(Math.abs(w.prowl[i])).toBe(1);
    expect(w.prowlPivot[i]).toBe(NONE);
    expect(w.prowlD[i]).toBe(0);
    expect(w.prowlStall[i]).toBe(0);
    expect(w.waitT[i]).toBeCloseTo(RULES.combat.waitBase, 5);
  });

  it('头一回、身边没有人游走：按编号奇偶分左右，相邻编号往相反方向', () => {
    const w = flatWorld(N, 7);
    const a = w.spawnUnit(idx('legion'), 1, 200, 200);
    const b = w.spawnUnit(idx('legion'), 1, 1500, 1500);
    expect(Math.abs(a - b)).toBe(1);
    startWait(w, a, true);
    startWait(w, b, true);
    expect(Math.sign(w.prowl[a])).toBe(-Math.sign(w.prowl[b]));
  });

  it('身边没有人游走：沿用自己上一轮的方向（含刚掉过头的），与编号奇偶无关', () => {
    const w = flatWorld(N, 7);
    const ids = [w.spawnUnit(idx('legion'), 1, 200, 200), w.spawnUnit(idx('legion'), 1, 1500, 1500)];
    for (const i of ids) {
      for (const before of [1, -1, 2, -2]) {
        w.prowl[i] = before;
        startWait(w, i, true);
        expect(w.prowl[i], `编号 ${i} 上一轮 ${before}`).toBe(Math.sign(before));
      }
    }
  });

  describe('跟身边（所在格与相邻格）正在游走的自己人里多数的方向走', () => {
    /** i 与 n 个同队的人挤在一格里；跑一帧让网格建起来，再按 dirs 设他们的游走方向与等待倒计时 */
    const crowd = (dirs: number[], waiting = true) => {
      const w = flatWorld(N, 7);
      const i = w.spawnUnit(idx('legion'), 1, C, C);
      const mates = dirs.map((_, k) => w.spawnUnit(idx('legion'), 1, C + 6 + 6 * k, C + 3));
      w.tick();
      w.fxN = 0;
      mates.forEach((m, k) => {
        w.prowl[m] = dirs[k];
        w.waitT[m] = waiting ? 3 : 0;
      });
      return { w, i, mates };
    };

    it.each([
      ['往左的多', [-1, -1, 1], -1],
      ['往右的多', [1, 1, -1], 1],
      ['全往左', [-1, -1, -1], -1],
      ['全往右（含刚掉过头的）', [2, 1, 1], 1],
    ] as [string, number[], number][])('%s：跟多数', (_n, dirs, want) => {
      for (const own of [1, -1]) {
        const { w, i } = crowd(dirs);
        w.prowl[i] = own;
        startWait(w, i, true);
        expect(w.prowl[i], `自己上一轮 ${own}`).toBe(want);
      }
    });

    it('两边一样多：沿用自己上一轮的方向', () => {
      for (const own of [1, -1]) {
        const { w, i } = crowd([1, -1]);
        w.prowl[i] = own;
        startWait(w, i, true);
        expect(w.prowl[i]).toBe(own);
      }
    });

    it('身边的人没在等待、或是敌人、或隔着两格以上：不算', () => {
      // 没在等待的（waitT 为 0）：不算，沿用自己的方向
      const idle = crowd([-1, -1, -1], false);
      idle.w.prowl[idle.i] = 1;
      startWait(idle.w, idle.i, true);
      expect(idle.w.prowl[idle.i], '没在等待').toBe(1);
      // 敌人：不算
      const foe = crowd([-1, -1, -1]);
      for (const m of foe.mates) foe.w.team[m] = 2;
      foe.w.prowl[foe.i] = 1;
      startWait(foe.w, foe.i, true);
      expect(foe.w.prowl[foe.i], '敌人').toBe(1);
      // 隔着两格以上：不算
      const far = crowd([-1, -1, -1]);
      for (const m of far.mates) far.w.x[m] += 3 * GRID;
      far.w.tick();
      far.w.fxN = 0;
      for (const m of far.mates) {
        far.w.prowl[m] = -1;
        far.w.waitT[m] = 3;
      }
      far.w.prowl[far.i] = 1;
      startWait(far.w, far.i, true);
      expect(far.w.prowl[far.i], '太远').toBe(1);
    });
  });

  describe('据点里待命的近战守军不游走（免得被带出据点）', () => {
    it('待命（O_IDLE）且在据点内（sheltered 为 1）：站着等，但等待时长照常', () => {
      const { w, i } = lone();
      w.order[i] = O_IDLE;
      w.sheltered[i] = 1;
      w.prowl[i] = 1;
      startWait(w, i, true);
      expect(w.prowl[i]).toBe(0);
      expect(w.waitT[i]).toBeCloseTo(RULES.combat.waitBase, 5);
    });

    it('待命但不在据点内：游走', () => {
      const { w, i } = lone();
      w.order[i] = O_IDLE;
      w.sheltered[i] = 0;
      startWait(w, i, true);
      expect(Math.abs(w.prowl[i])).toBe(1);
    });

    it('在据点内但不是待命（攻击移动）：游走', () => {
      const { w, i } = lone();
      w.order[i] = O_AMOVE;
      w.sheltered[i] = 1;
      startWait(w, i, true);
      expect(Math.abs(w.prowl[i])).toBe(1);
    });
  });
});

describe('prowlPivot：游走的人量下与最近敌兵保持的距离', () => {
  const pair = () => {
    const w = flatWorld(N, 7);
    const i = w.spawnUnit(idx('legion'), 1, C, C);
    const e1 = w.spawnUnit(idx('legion'), 2, C + 100, C);
    const e2 = w.spawnUnit(idx('legion'), 2, C - 100, C);
    startWait(w, i, true);
    return { w, i, e1, e2 };
  };

  it('记下绕着走的敌兵；离得近时量到的距离不到一排人，就取至少隔开一排人的距离', () => {
    const { w, i, e1 } = pair();
    prowlPivot(w, i, e1, 5 * 5);
    expect(w.prowlPivot[i]).toBe(e1);
    expect(w.prowlD[i]).toBeCloseTo(w.rad[e1] + w.rad[i] * 3 + RULES.combat.meleeContact, 4);
  });

  it('量到的距离比一排人远：保持原来的距离', () => {
    const { w, i, e1 } = pair();
    prowlPivot(w, i, e1, 200 * 200);
    expect(w.prowlD[i]).toBeCloseTo(200, 4);
  });

  it('同时记下那个敌兵的 uid（之后下标被别的单位占用时靠它认出来）', () => {
    const { w, i, e1, e2 } = pair();
    prowlPivot(w, i, e1, 50 * 50);
    expect(w.prowlUid[i]).toBe(w.uid[e1]);
    prowlPivot(w, i, e2, 50 * 50);
    expect(w.prowlUid[i]).toBe(w.uid[e2]);
    expect(w.uid[e1]).not.toBe(w.uid[e2]);
  });

  it('只在头一次量：之后换了最近的敌兵，绕的对象跟着换，保持的距离不变', () => {
    const { w, i, e1, e2 } = pair();
    prowlPivot(w, i, e1, 200 * 200);
    prowlPivot(w, i, e2, 50 * 50);
    expect(w.prowlPivot[i]).toBe(e2);
    expect(w.prowlD[i]).toBeCloseTo(200, 4);
  });
});

describe('prowlStep：游走的一帧期望速度', () => {
  const SPD = 100;
  /** i 在 (px, py)，目标 tgt 在它正东 D 处，量好保持 D 的距离；dir 是游走方向 */
  const scene = (dir: number, opts: { px?: number; py?: number; D?: number; paint?: (t: Uint8Array, n: number) => void } = {}) => {
    const w = flatWorld(N, 7, opts.paint);
    const px = opts.px ?? C, py = opts.py ?? C, D = opts.D ?? 100;
    const i = w.spawnUnit(idx('legion'), 1, px, py);
    const tgt = w.spawnUnit(idx('legion'), 2, px + D, py);
    startWait(w, i, true);
    w.prowl[i] = dir;
    prowlPivot(w, i, tgt, D * D);
    return { w, i, tgt, D };
  };
  /** 速度在「绕敌兵的切线」与「远离敌兵的径向」上的分量（径向以远离为正，切线按逆时针算） */
  const split = (w: World, i: number, p: number): { tan: number; rad: number } => {
    const ax = w.x[i] - w.x[p], ay = w.y[i] - w.y[p], ad = Math.hypot(ax, ay);
    return { tan: (STEP.wx * -ay + STEP.wy * ax) / ad, rad: (STEP.wx * ax + STEP.wy * ay) / ad };
  };

  it('还没量好距离（prowlD 为 0）：这一帧站着', () => {
    const { w, i, tgt } = scene(1);
    w.prowlD[i] = 0;
    expect(prowlStep(w, i, tgt, SPD, w.cellAt(w.x[i], w.y[i]))).toBe(false);
  });

  it('距离正合适：沿切线走，速度 = 速度 × prowlSpeed', () => {
    const { w, i, tgt } = scene(1);
    expect(prowlStep(w, i, tgt, SPD, w.cellAt(w.x[i], w.y[i]))).toBe(true);
    expect(Math.hypot(STEP.wx, STEP.wy)).toBeCloseTo(SPD * RULES.combat.prowlSpeed, 3);
    const { tan, rad } = split(w, i, tgt);
    expect(Math.abs(rad)).toBeLessThan(1e-3);
    expect(Math.abs(tan)).toBeCloseTo(SPD * RULES.combat.prowlSpeed, 3);
  });

  it('方向正负相反：绕着转的方向相反', () => {
    const a = scene(1), b = scene(-1);
    prowlStep(a.w, a.i, a.tgt, SPD, a.w.cellAt(a.w.x[a.i], a.w.y[a.i]));
    const ta = split(a.w, a.i, a.tgt).tan;
    prowlStep(b.w, b.i, b.tgt, SPD, b.w.cellAt(b.w.x[b.i], b.w.y[b.i]));
    const tb = split(b.w, b.i, b.tgt).tan;
    expect(ta * tb).toBeLessThan(0);
    expect(Math.abs(ta)).toBeCloseTo(Math.abs(tb), 3);
  });

  it('保持距离：比量好的距离近就边绕边往外挪，远就往里靠，径向分量不超过切向分量', () => {
    for (const dir of [1, -1]) {
      const near = scene(dir);
      near.w.x[near.i] = w_x(near.w, near.tgt, 0.5 * near.D);
      prowlStep(near.w, near.i, near.tgt, SPD, near.w.cellAt(near.w.x[near.i], near.w.y[near.i]));
      const n = split(near.w, near.i, near.tgt);
      expect(n.rad, `太近 ${dir}`).toBeGreaterThan(0);
      expect(Math.abs(n.rad), `太近 ${dir}`).toBeLessThanOrEqual(Math.abs(n.tan) + 1e-3);

      const far = scene(dir);
      far.w.x[far.i] = w_x(far.w, far.tgt, 3 * far.D);
      prowlStep(far.w, far.i, far.tgt, SPD, far.w.cellAt(far.w.x[far.i], far.w.y[far.i]));
      const f = split(far.w, far.i, far.tgt);
      expect(f.rad, `太远 ${dir}`).toBeLessThan(0);
      expect(Math.abs(f.rad), `太远 ${dir}`).toBeLessThanOrEqual(Math.abs(f.tan) + 1e-3);
    }
  });

  it('绕的是 prowlPivot 记下的敌兵，不是目标', () => {
    const { w, i, tgt } = scene(1);
    // 另一个敌兵在正北，记成绕的对象：切线走的方向是东西向，不再是南北向
    const north = w.spawnUnit(idx('legion'), 2, w.x[i], w.y[i] - 100);
    prowlPivot(w, i, north, 100 * 100);
    prowlStep(w, i, tgt, SPD, w.cellAt(w.x[i], w.y[i]));
    expect(Math.abs(STEP.wx)).toBeGreaterThan(10 * Math.abs(STEP.wy));
  });

  it('绕的敌兵死了：改绕目标', () => {
    const { w, i, tgt } = scene(1);
    const north = w.spawnUnit(idx('legion'), 2, w.x[i], w.y[i] - 100);
    prowlPivot(w, i, north, 100 * 100);
    w.removeUnit(north);
    prowlStep(w, i, tgt, SPD, w.cellAt(w.x[i], w.y[i]));
    expect(Math.abs(STEP.wy)).toBeGreaterThan(10 * Math.abs(STEP.wx));
  });

  it('绕的敌兵死后下标被别的敌方单位占用（uid 对不上）：改绕目标，不绕那个无关的单位', () => {
    const { w, i, tgt } = scene(1);
    const north = w.spawnUnit(idx('legion'), 2, w.x[i], w.y[i] - 100);
    prowlPivot(w, i, north, 100 * 100);
    w.removeUnit(north);
    const other = w.spawnUnit(idx('legion'), 2, w.x[i], w.y[i] - 100);
    expect(other, '场景前提：新单位占了同一个下标').toBe(north);
    expect(w.uid[other]).not.toBe(w.prowlUid[i]);
    prowlStep(w, i, tgt, SPD, w.cellAt(w.x[i], w.y[i]));
    expect(Math.abs(STEP.wy)).toBeGreaterThan(10 * Math.abs(STEP.wx));
  });

  it('记的下标上是别的单位（自己人、uid 对不上）：改绕目标', () => {
    const { w, i, tgt } = scene(1);
    const mate = w.spawnUnit(idx('legion'), 1, w.x[i], w.y[i] - 100);
    w.prowlPivot[i] = mate;
    prowlStep(w, i, tgt, SPD, w.cellAt(w.x[i], w.y[i]));
    expect(Math.abs(STEP.wy)).toBeGreaterThan(10 * Math.abs(STEP.wx));
  });

  describe('往前看一小段，走不通就立即掉头', () => {
    const R = 50;
    /** 往 i 要走的方向（先在空地上试一次得知）的前方贴着一片山：i 离山的边 2 像素 */
    const walled = (dir: number) => {
      const probe = scene(dir);
      prowlStep(probe.w, probe.i, probe.tgt, SPD, probe.w.cellAt(probe.w.x[probe.i], probe.w.y[probe.i]));
      const up = STEP.wy < 0;
      const py = up ? R * TILE + 2 : (R + 1) * TILE - 2;
      const s = scene(dir, {
        px: R * TILE + TILE / 2, py,
        paint: (t, n) => {
          for (let ty = up ? 0 : R + 1; ty < (up ? R : n); ty++) for (let tx = 0; tx < n; tx++) t[ty * n + tx] = T_MOUNTAIN;
        },
      });
      return s;
    };

    it.each([1, -1])('前面是不可通行的地形（方向 %d）：返回 false，方向反过来并记下刚掉过头', dir => {
      const { w, i, tgt } = walled(dir);
      expect(prowlStep(w, i, tgt, SPD, w.cellAt(w.x[i], w.y[i]))).toBe(false);
      expect(w.prowl[i]).toBe(-2 * dir);
      expect(w.prowlStall[i]).toBe(0);
    });

    it.each([1, -1])('对照：前面是通路（方向 %d）：返回 true，方向不变', dir => {
      const { w, i, tgt } = scene(dir, { px: R * TILE + TILE / 2, py: R * TILE + 2 });
      // 平地上不论往哪边走都走得通
      expect(prowlStep(w, i, tgt, SPD, w.cellAt(w.x[i], w.y[i]))).toBe(true);
      expect(w.prowl[i]).toBe(dir);
    });
  });
});

/** 在目标正西、离它 d 处的 x 坐标（测试里把 i 摆到离目标不同的距离上） */
function w_x(w: World, tgt: number, d: number): number {
  return w.x[tgt] - d;
}

describe('prowlProgress：游走走不动就掉头，掉头后还走不动就站着等', () => {
  const WANT = 60;
  const setup = (dir = 1) => {
    const w = flatWorld(N, 7);
    const i = w.spawnUnit(idx('legion'), 1, C, C);
    startWait(w, i, true);
    w.prowl[i] = dir;
    return { w, i };
  };
  /** 一直报告这一帧没走动（走了 ratio 倍的想走距离），直到 prowl 变化或 max 帧，返回用掉的帧数 */
  const stall = (w: World, i: number, ratio = 0, max = 200): number => {
    const before = w.prowl[i];
    let n = 0;
    while (n < max && w.prowl[i] === before) {
      prowlProgress(w, i, WANT * DT * ratio, WANT);
      n++;
    }
    return n;
  };

  it('走得动（位移不低于想走的 30%）：计时清零，方向不变；刚掉过头的这时才算走起来了', () => {
    const { w, i } = setup();
    for (let k = 0; k < 10; k++) prowlProgress(w, i, 0, WANT);
    expect(w.prowlStall[i]).toBeGreaterThan(0);
    prowlProgress(w, i, WANT * DT * 0.5, WANT);
    expect(w.prowlStall[i]).toBe(0);
    expect(w.prowl[i]).toBe(1);
    for (const [before, after] of [[2, 1], [-2, -1], [-1, -1]]) {
      w.prowl[i] = before;
      prowlProgress(w, i, WANT * DT, WANT);
      expect(w.prowl[i]).toBe(after);
    }
  });

  it('位移一半的帧不算走不动：一直这样也不会掉头', () => {
    const { w, i } = setup();
    for (let k = 0; k < 300; k++) prowlProgress(w, i, WANT * DT * 0.5, WANT);
    expect(w.prowl[i]).toBe(1);
  });

  it('连续走不动约 prowlStallAfter 秒才掉头：之前不掉，掉头后方向反过来、记下刚掉过头、计时清零', () => {
    for (const dir of [1, -1]) {
      const { w, i } = setup(dir);
      const n = stall(w, i, 0.1);
      expect(n * DT, `方向 ${dir}`).toBeGreaterThanOrEqual(RULES.combat.prowlStallAfter);
      expect(n * DT, `方向 ${dir}`).toBeLessThanOrEqual(RULES.combat.prowlStallAfter + 3 * DT);
      expect(w.prowl[i]).toBe(-2 * dir);
      expect(w.prowlStall[i]).toBe(0);
    }
  });

  it('中间走动过一帧，走不动的计时重新算', () => {
    const { w, i } = setup();
    for (let k = 0; k < 12; k++) prowlProgress(w, i, 0, WANT);
    prowlProgress(w, i, WANT * DT, WANT);
    for (let k = 0; k < 12; k++) prowlProgress(w, i, 0, WANT);
    expect(w.prowl[i], '两段都不到 0.5 秒').toBe(1);
  });

  it('掉头后一步没走动又要掉头（两边都走不通）：这一轮改成站着等', () => {
    const { w, i } = setup(1);
    stall(w, i);
    expect(w.prowl[i]).toBe(-2);
    const n = stall(w, i);
    expect(w.prowl[i]).toBe(0);
    expect(n * DT).toBeGreaterThanOrEqual(RULES.combat.prowlStallAfter);
  });

  it('掉头之后走动过：下一次走不动还是掉头，不是站着', () => {
    const { w, i } = setup(1);
    stall(w, i);
    expect(w.prowl[i]).toBe(-2);
    prowlProgress(w, i, WANT * DT, WANT);
    expect(w.prowl[i]).toBe(-1);
    stall(w, i);
    expect(w.prowl[i]).toBe(2);
  });
});

describe('spotFree：ov 是允许的重叠像素', () => {
  const pair = () => {
    const w = flatWorld(N, 7);
    const i = w.spawnUnit(idx('legion'), 1, C - 300, C);
    const j = w.spawnUnit(idx('legion'), 2, C, C);
    w.tick();
    w.fxN = 0;
    return { w, i, j, ri: w.rad[i], rj: w.rad[j] };
  };

  it('点上没人：空', () => {
    const { w, i, ri } = pair();
    expect(spotFree(w, i, C + 200, C, ri)).toBe(true);
  });

  it('别人压在点上：不空；自己压在点上不算', () => {
    const { w, i, j, ri } = pair();
    expect(spotFree(w, i, w.x[j], w.y[j], ri)).toBe(false);
    expect(spotFree(w, i, w.x[i], w.y[i], ri)).toBe(true);
  });

  it('重叠不超过 ov 仍算空，超过就不空；缺省的 ov 是 detourOverlap', () => {
    const { w, i, j, ri, rj } = pair();
    const at = (overlap: number): [number, number] => [w.x[j] + (ri + rj - overlap), w.y[j]];
    const [x2, y2] = at(2);
    expect(spotFree(w, i, x2, y2, ri, 3), '重叠 2、允许 3').toBe(true);
    expect(spotFree(w, i, x2, y2, ri, 1), '重叠 2、允许 1').toBe(false);
    const [x6, y6] = at(6);
    expect(spotFree(w, i, x6, y6, ri, 3), '重叠 6、允许 3').toBe(false);
    expect(spotFree(w, i, x6, y6, ri, 8), '重叠 6、允许 8').toBe(true);
    // 缺省按 detourOverlap
    const [xd, yd] = at(RULES.combat.detourOverlap - 0.5);
    expect(spotFree(w, i, xd, yd, ri)).toBe(true);
    const [xe, ye] = at(RULES.combat.detourOverlap + 1.5);
    expect(spotFree(w, i, xe, ye, ri)).toBe(false);
  });
});

describe('prowlGap：游走路过时正对着的位置空出来了就返回那个敌兵', () => {
  const GAP_ANGLES = [-2, -1, 0, 1, 2];
  const STEP_A = 0.35;
  /**
   * 敌兵 e 在 (C + 100, C)，游走的 i 在它正西、离「贴着它的那一圈」extra 像素处（prowlPivot 记着 e）。
   * blocked 里的方向编号（-2 到 2，0 是正对）上各站一个己方兵，站的位置离那个点 push 像素（沿径向往外）。
   */
  const scene = (opts: {
    extra?: number; blocked?: number[]; push?: number; paint?: (t: Uint8Array, n: number) => void; seen?: boolean;
    ex?: number; ey?: number; ang?: number;
  } = {}) => {
    const w = flatWorld(N, 7, opts.paint);
    const ex = opts.ex ?? C + 100, ey = opts.ey ?? C, ang = opts.ang ?? Math.PI;
    const e = w.spawnUnit(idx('legion'), 2, ex, ey);
    w.hp[e] = w.maxHp[e] = 1e9;
    w.orderStop([e], true);
    const ri = w.rad[e], reach = 2 * ri + RULES.combat.detourGap;
    const extra = opts.extra ?? 8;
    const ix = ex + Math.cos(ang) * (reach + extra), iy = ey + Math.sin(ang) * (reach + extra);
    const i = w.spawnUnit(idx('legion'), 1, ix, iy);
    const pos = (opts.blocked ?? []).map(k => {
      const a = ang + k * STEP_A, r = reach + (opts.push ?? 0);
      return [ex + Math.cos(a) * r, ey + Math.sin(a) * r];
    });
    const bl = pos.map(([x, y]) => w.spawnUnit(idx('legion'), 1, x, y));
    // 跑一帧让网格与可见性建起来，再把 i 摆回原处并设成正在绕 e 游走
    w.tick();
    w.fxN = 0;
    w.x[i] = ix;
    w.y[i] = iy;
    // 挤在一起的几个人这一帧会被互相推开，摆回原处
    bl.forEach((u, k) => {
      w.x[u] = pos[k][0];
      w.y[u] = pos[k][1];
    });
    w.prowl[i] = 1;
    prowlPivot(w, i, e, 100 * 100);
    if (opts.seen === false) w.seen[e] = 0;
    return { w, i, e, bl, reach, ri };
  };

  it('正对的位置空着：返回绕着走的那个敌兵', () => {
    const { w, i, e } = scene();
    expect(w.seen[e] & 2, '场景前提：己方看得见').toBe(2);
    expect(prowlGap(w, i)).toBe(e);
  });

  it('正对和附近几个方向都被人占着：没有', () => {
    const { w, i } = scene({ blocked: GAP_ANGLES });
    expect(prowlGap(w, i)).toBe(NONE);
  });

  it('正对的被占着，偏一点的方向（两侧）有空位：也算', () => {
    // 相邻方向离得很近（隔着不到一个身位），占着一个就连带占着它旁边的；占着 0 号、-1 号，只剩 2 号空着
    const a = scene({ blocked: [-1, 0] });
    expect(prowlGap(a.w, a.i)).toBe(a.e);
    // 对称：占着 0 号、1 号，只剩 -2 号空着
    const b = scene({ blocked: [0, 1] });
    expect(prowlGap(b.w, b.i)).toBe(b.e);
    // 对照：连 2 号也占着，就没有了
    const c = scene({ blocked: [-1, 0, 2] });
    expect(prowlGap(c.w, c.i)).toBe(NONE);
  });

  it('重叠不超过 prowlFit 仍算空，超过就不算', () => {
    const w0 = flatWorld(N, 7);
    const r = w0.rad[w0.spawnUnit(idx('legion'), 1, 0, 0)];
    // 五个方向各站一个人，往外挪使占位与那个点重叠 overlap 像素
    const ok = scene({ blocked: GAP_ANGLES, push: 2 * r - (RULES.combat.prowlFit - 1) });
    expect(prowlGap(ok.w, ok.i), `重叠 ${RULES.combat.prowlFit - 1}`).toBe(ok.e);
    const bad = scene({ blocked: GAP_ANGLES, push: 2 * r - (RULES.combat.prowlFit + 3) });
    expect(prowlGap(bad.w, bad.i), `重叠 ${RULES.combat.prowlFit + 3}`).toBe(NONE);
  });

  it('只隔着一排（离那一圈不超过自己的直径 + prowlReach）：有；再远一点（隔着两排以上）：没有', () => {
    const w0 = flatWorld(N, 7);
    const r = w0.rad[w0.spawnUnit(idx('legion'), 1, 0, 0)];
    const lim = 2 * r + RULES.combat.prowlReach;
    const near = scene({ extra: lim - 2 });
    expect(prowlGap(near.w, near.i)).toBe(near.e);
    const far = scene({ extra: lim + 2 });
    expect(prowlGap(far.w, far.i)).toBe(NONE);
  });

  it('没在游走（prowl 为 0）：没有', () => {
    const { w, i } = scene();
    w.prowl[i] = 0;
    expect(prowlGap(w, i)).toBe(NONE);
  });

  it('绕的那个敌兵无效：没记（NONE）、死了、己方看不见：没有', () => {
    const none = scene();
    none.w.prowlPivot[none.i] = NONE;
    expect(prowlGap(none.w, none.i), '没记').toBe(NONE);
    const dead = scene();
    dead.w.removeUnit(dead.e);
    expect(prowlGap(dead.w, dead.i), '死了').toBe(NONE);
    const hidden = scene({ seen: false });
    expect(prowlGap(hidden.w, hidden.i), '看不见').toBe(NONE);
  });

  it('绕的敌兵死后下标被别的敌方单位占用（uid 对不上）：没有，不为那个无关的单位冲上去', () => {
    const { w, i, e } = scene();
    w.removeUnit(e);
    const other = w.spawnUnit(idx('legion'), 2, w.x[i] + 23, w.y[i]);
    expect(other, '场景前提：新单位占了同一个下标').toBe(e);
    w.tick();
    w.fxN = 0;
    expect(w.alive[e]).toBe(1);
    expect(prowlGap(w, i)).toBe(NONE);
  });

  it('记的下标上是自己人（uid 对不上）：没有', () => {
    const { w, i, e } = scene();
    w.team[e] = 1;
    w.uid[e] = w.uid[e] + 1000;
    expect(prowlGap(w, i)).toBe(NONE);
  });

  describe('位置落在走不通的地形里（敌兵贴着山站）：没人站也不算空位', () => {
    /**
     * 一格山，西边沿在敌兵西面 10 像素处：覆盖贴着敌兵西侧的那一圈位置的 y 范围里 yShift 以下的那些（山格 32 像素，
     * 敌兵在山格的东缘外、i 在山格里，直线的探点不落进山里，不会因为直线不通而返回没有）。
     * 山格的行：敌兵的 y 离山格上沿 yTop 像素。
     */
    const hug = (yTop: number, paint = true) => {
      const col = 50, row = 50;
      const ex = (col + 1) * TILE + 10, ey = row * TILE + yTop;
      return scene({
        ex, ey, extra: 20,
        paint: paint ? (t, n) => {
          t[row * n + col] = T_MOUNTAIN;
        } : undefined,
      });
    };

    it('整圈位置都在山里：没有；对照：同样的摆法没有山时有', () => {
      const walled = hug(16);
      expect(prowlGap(walled.w, walled.i)).toBe(NONE);
      const open = hug(16, false);
      expect(prowlGap(open.w, open.i)).toBe(open.e);
    });

    it('正对方向落在山里、旁边方向有可走的空位：仍返回该敌兵', () => {
      // 山格上沿在敌兵北面 4 像素：正对方向和南侧的位置在山里，北侧的在山格上面那一格，走得通
      const { w, i, e } = hug(4);
      expect(prowlGap(w, i)).toBe(e);
    });
  });

  describe('贴着地图边缘的敌兵外侧没有空位', () => {
    it('敌兵贴着地图北边缘站、自己在它北面：没有；对照：离边缘远时有', () => {
      // i 在敌兵正北；敌兵 y 为 17，那一圈位置的 y 在 2 到 5.5，都在 6 像素以内
      const edge = scene({ ex: C, ey: 17, ang: -Math.PI / 2, extra: 1 });
      expect(prowlGap(edge.w, edge.i)).toBe(NONE);
      const mid = scene({ ex: C, ey: 100, ang: -Math.PI / 2, extra: 1 });
      expect(prowlGap(mid.w, mid.i)).toBe(mid.e);
    });
  });

  it('与那个敌兵之间直线不通：没有；对照：同样的摆法没有障碍时有', () => {
    // 敌兵与 i 之间隔着一列山（整列不可通行格），两边各离山沿两三像素
    const col = 50;
    const geo = { ex: (col + 1) * TILE + 2, extra: 21 };
    const walled = scene({
      ...geo,
      paint: (t, n) => {
        for (let ty = 0; ty < n; ty++) t[ty * n + col] = T_MOUNTAIN;
      },
    });
    expect(walled.w.lineBlocked(walled.w.x[walled.i], walled.w.y[walled.i], walled.w.x[walled.e], walled.w.y[walled.e], 1), '场景前提：直线被山挡着').toBe(true);
    expect(prowlGap(walled.w, walled.i)).toBe(NONE);
    const open = scene(geo);
    expect(prowlGap(open.w, open.i)).toBe(open.e);
  });
});
