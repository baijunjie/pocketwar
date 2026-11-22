import { describe, expect, it } from 'vitest';
import { FACTIONS, FACTION_IDS, FactionId, SITE_HQ, TILE, T_DEEP, T_GRASS, T_MOUNTAIN, UNIT_BY_KEY } from '../src/sim/defs';
import { GameMap, generateMap } from '../src/sim/map';
import { DIR_NONE } from '../src/sim/nav';
import { armyList, createGame } from '../src/sim/setup';
import { O_IDLE, World } from '../src/sim/world';

function ascii(map: ReturnType<typeof generateMap>, step = 4): string {
  const ch = '~-.f^M=#"';
  let out = '';
  for (let y = 0; y < map.h; y += step) {
    for (let x = 0; x < map.w; x += step) out += ch[map.terrain[y * map.w + x]];
    out += '\n';
  }
  return out;
}

describe('地图生成', () => {
  it('同一种子结果一致，且据点齐全', () => {
    const a = generateMap(42), b = generateMap(42);
    expect(a.terrain).toEqual(b.terrain);
    expect(a.sites.length).toBe(17);
    expect(a.sites.filter(s => s.type === SITE_HQ).length).toBe(2);
    expect(a.buildings.length).toBeGreaterThan(400);
    if (import.meta.env.VITE_DUMP) console.log(ascii(a));
  }, 30000);

  it('多个种子下所有据点、出兵口都与双方大本营连通', () => {
    for (const seed of [1, 7, 42, 1234, 99999]) {
      const g = createGame({ seed, factions: ['china', 'rome'], armySize: 100, difficulty: 1, fog: false, spectate: true });
      const w = g.world;
      for (const tm of [1, 2]) {
        const hq = w.sites.find(s => s.type === SITE_HQ && s.owner === tm)!;
        const f = w.nav.getField(tm, w.cellAt(hq.x, hq.y), 0);
        expect(f.pending).toBe(true);
        w.nav.finish(f);
        expect(f.pending).toBe(false);
        for (const s of w.sites) expect(f.dirs[w.cellAt(s.x, s.y)], `seed ${seed} site ${s.name}`).not.toBe(DIR_NONE);
        for (const t of [1, 2]) expect(f.dirs[w.cellAt(w.map.spawn[t].x, w.map.spawn[t].y)]).not.toBe(DIR_NONE);
        expect(f.dirs[w.cellAt(w.map.deploy[tm].x, w.map.deploy[tm].y)]).not.toBe(DIR_NONE);
      }
    }
  }, 60000);

  it('地形比例合理', () => {
    const m = generateMap(42);
    let mount = 0, water = 0;
    for (const t of m.terrain) {
      if (t === T_MOUNTAIN) mount++;
      if (t === T_DEEP) water++;
    }
    expect(mount / m.terrain.length).toBeLessThan(0.1);
    expect(water / m.terrain.length).toBeLessThan(0.1);
  });
});

describe('单位行为', () => {
  const mk = (): World => createGame({ seed: 5, factions: ['china', 'japan'], armySize: 60, difficulty: 1, fog: false, spectate: false }).world;

  it('移动指令：部队抵达目的地并恢复待命', () => {
    const w = mk();
    const mine: number[] = [];
    for (let i = 0; i < w.n; i++) if (w.alive[i] && w.team[i] === 1) mine.push(i);
    const dp = w.map.deploy[1];
    const tx = dp.x + dp.dx * 900, ty = dp.y + dp.dy * 900;
    const field = mine.filter(s => Math.hypot(w.x[s] - dp.x, w.y[s] - dp.y) < 600);
    w.orderMove(field, tx, ty, false);
    for (let t = 0; t < 30 * 90; t++) w.tick();
    let arrived = 0;
    for (const s of field) if (w.alive[s] && w.order[s] === O_IDLE && Math.hypot(w.x[s] - tx, w.y[s] - ty) < 400) arrived++;
    expect(arrived).toBeGreaterThan(field.length * 0.9);
  });

  it('两军相遇会交战并产生伤亡', () => {
    const w = mk();
    const a = w.spawnGroup(1, Array(80).fill(UNIT_BY_KEY.dao.idx), 5000, 5000, 1, 0);
    const b = w.spawnGroup(2, Array(80).fill(UNIT_BY_KEY.yari.idx), 5300, 5000, -1, 0);
    w.orderMove(a, 5300, 5000, true);
    w.orderMove(b, 5000, 5000, true);
    for (let t = 0; t < 30 * 40; t++) w.tick();
    expect(w.lost[1] + w.lost[2]).toBeGreaterThan(40);
  });

  it('攻击建筑：器械能摧毁城墙并打开通路', () => {
    const w = mk();
    const hq = w.sites.find(s => s.type === SITE_HQ && s.owner === 2)!;
    const gate = hq.buildings.map(id => w.buildings[id]).find(b => b.gate)!;
    const siege = w.spawnGroup(1, Array(12).fill(UNIT_BY_KEY.pili.idx), gate.cx, gate.cy + 14 * TILE, 0, -1);
    const v0 = w.nav.version;
    w.orderAttackBuilding(siege, gate);
    for (let t = 0; t < 30 * 60 && gate.alive; t++) w.tick();
    expect(gate.alive).toBe(false);
    expect(w.nav.version).toBeGreaterThan(v0);
    expect(w.nav.block[1][gate.ty * w.map.w + gate.tx]).toBe(0);
  });

  it('占领据点后定时从后方获得援军', () => {
    const w = mk();
    const s = w.sites.find(x => x.owner === 0 && x.radius > 0 && x.type >= 4)!;
    w.spawnGroup(1, Array(20).fill(UNIT_BY_KEY.ji.idx), s.x, s.y + 30, 0, -1);
    const before = w.arrived[1];
    for (let t = 0; t < 30 * 20; t++) w.tick();
    expect(s.owner).toBe(1);
    expect(w.events.some(e => e.kind === 'captured' && e.site === s.id)).toBe(true);
    s.timer = 1;
    for (let t = 0; t < 30 * 3; t++) w.tick();
    expect(w.arrived[1]).toBeGreaterThan(before);
  });

  it('主堡被毁即分出胜负', () => {
    const w = mk();
    const hq = w.sites.find(s => s.type === SITE_HQ && s.owner === 2)!;
    w.damageBuilding(w.buildings[hq.main], 1e6, 2, 1, 1);
    expect(w.winner).toBe(1);
  });
});

describe('性能与整局推演', () => {
  it('3000 单位混战：单帧模拟耗时在预算内', () => {
    const g = createGame({ seed: 9, factions: ['rome', 'persia'], armySize: 1500, difficulty: 1, fog: true, spectate: false });
    const w = g.world;
    // 把双方主力拉到同一处开战
    const all: number[][] = [[], [], []];
    for (let i = 0; i < w.n; i++) if (w.alive[i]) all[w.team[i]].push(i);
    const cx = w.W / 2, cy = w.H / 2 + 900;
    for (const tm of [1, 2]) {
      for (const s of all[tm]) {
        w.x[s] = cx + (tm === 1 ? -500 : 500) + ((s * 37) % 700) - 350;
        w.y[s] = cy + ((s * 91) % 900) - 450;
      }
      w.orderMove(all[tm], cx, cy, true);
    }
    const total = w.teamCount[1] + w.teamCount[2];
    expect(total).toBeGreaterThan(2500);
    let worst = 0, sum = 0;
    const N = 300;
    for (let t = 0; t < N; t++) {
      const t0 = performance.now();
      w.tick();
      const dt = performance.now() - t0;
      sum += dt;
      if (t > 5 && dt > worst) worst = dt;
    }
    console.log(`units=${total} avg=${(sum / N).toFixed(2)}ms worst=${worst.toFixed(2)}ms lost=${w.lost[1]}/${w.lost[2]}`);
    expect(sum / N).toBeLessThan(12);
  });

  it('AI 对 AI：开局 6 分钟内会争夺据点并交战', () => {
    const g = createGame({ seed: 100, factions: ['china', 'japan'], armySize: 200, difficulty: 1, fog: false, spectate: true });
    const w = g.world;
    for (let t = 0; t < 30 * 60 * 6 && !w.winner; t++) {
      w.tick();
      for (const ai of g.ais) ai.update();
      w.fxN = 0;
    }
    const owned = [0, 0, 0];
    for (const s of w.sites) owned[s.owner]++;
    expect(owned[1] + owned[2]).toBeGreaterThan(6);
    expect(w.lost[1] + w.lost[2]).toBeGreaterThan(30);
    expect(w.arrived[1] + w.arrived[2]).toBeGreaterThan(30);
  }, 120000);
});

/** 空旷平地上两军对冲，返回胜方与其剩余兵力占比 */
function duel(a: FactionId, b: FactionId, size: number): { winner: number; left: number; secs: number } {
  const N = 160;
  const map: GameMap = {
    seed: 1, w: N, h: N, terrain: new Uint8Array(N * N).fill(T_GRASS), height: new Float32Array(N * N),
    dirt: new Uint8Array(N * N), sites: [], buildings: [], props: new Float32Array(0), propChunk: new Int32Array(1),
    chunkW: 0, chunkH: 0, spawn: [], deploy: [],
  };
  const w = new World(map, 7);
  w.fog = false;
  w.factions = [null, FACTIONS[a], FACTIONS[b]];
  const cy = (N * TILE) / 2, cx = (N * TILE) / 2;
  const g1 = w.spawnGroup(1, armyList(FACTIONS[a], size), cx - 700, cy, 1, 0);
  const g2 = w.spawnGroup(2, armyList(FACTIONS[b], size), cx + 700, cy, -1, 0);
  const p0 = [0, 0, 0];
  for (const s of g1) p0[1] += w.defs[w.type[s]].power;
  for (const s of g2) p0[2] += w.defs[w.type[s]].power;
  w.orderMove(g1, cx, cy, true);
  w.orderMove(g2, cx, cy, true);
  let t = 0;
  for (; t < 30 * 420 && w.teamCount[1] > 0 && w.teamCount[2] > 0; t++) {
    w.tick();
    w.fxN = 0;
    // 打完一轮后让残部继续寻敌
    if (t % 300 === 299) {
      for (const tm of [1, 2]) {
        const mine: number[] = [];
        let ex = 0, ey = 0, en = 0;
        for (let i = 0; i < w.n; i++) {
          if (!w.alive[i]) continue;
          if (w.team[i] === tm) mine.push(i);
          else {
            ex += w.x[i];
            ey += w.y[i];
            en++;
          }
        }
        if (en) w.orderMove(mine, ex / en, ey / en, true);
      }
    }
  }
  const p = [0, 0, 0];
  for (let i = 0; i < w.n; i++) if (w.alive[i]) p[w.team[i]] += w.defs[w.type[i]].power;
  const f1 = p[1] / p0[1], f2 = p[2] / p0[2];
  return f1 >= f2 ? { winner: 1, left: f1 - f2, secs: t / 30 } : { winner: 2, left: f2 - f1, secs: t / 30 };
}

// 阵营平衡统计，耗时较长：
//   VITE_BALANCE=duel npx vitest run -t 平衡   平地对冲
//   VITE_BALANCE=1 npx vitest run -t 平衡      AI 对 AI 打完整局
describe.runIf(import.meta.env.VITE_BALANCE === 'duel')('平衡：对冲', () => {
  it('各阵营两两对冲', () => {
    const score: Record<string, number> = {};
    const lines: string[] = [];
    for (let a = 0; a < 4; a++) {
      for (let b = a + 1; b < 4; b++) {
        const fa = FACTION_IDS[a], fb = FACTION_IDS[b];
        const r1 = duel(fa, fb, 400), r2 = duel(fb, fa, 400);
        // 正值表示 fa 占优
        const adv = ((r1.winner === 1 ? r1.left : -r1.left) + (r2.winner === 2 ? r2.left : -r2.left)) / 2;
        score[fa] = (score[fa] ?? 0) + adv;
        score[fb] = (score[fb] ?? 0) - adv;
        lines.push(`${fa} vs ${fb}: ${adv >= 0 ? fa : fb} +${Math.abs(adv * 100).toFixed(0)}%  (${r1.secs.toFixed(0)}s / ${r2.secs.toFixed(0)}s)`);
      }
    }
    console.log(lines.join('\n'));
    console.log(FACTION_IDS.map(f => `${f}: ${(score[f] * 100 / 3).toFixed(0)}%`).join('  '));
  }, 600000);
});

describe.runIf(import.meta.env.VITE_BALANCE && import.meta.env.VITE_BALANCE !== 'duel')('平衡', () => {
  it('各阵营组合 AI 对 AI 打完整局', () => {
    // VITE_BALANCE 为轮数；VITE_ROUND0 为起始轮次（换一批地图种子，便于多进程并行跑）
    const rounds = Number(import.meta.env.VITE_BALANCE) || 1;
    const r0 = Number(import.meta.env.VITE_ROUND0) || 0;
    const wins: Record<string, number> = {}, games: Record<string, number> = {};
    for (let r = r0; r < r0 + rounds; r++) {
      for (let a = 0; a < 4; a++) {
        for (let b = 0; b < 4; b++) {
          if (a === b) continue;
          const g = createGame({ seed: 100 + r * 31 + a * 4 + b, factions: [FACTION_IDS[a], FACTION_IDS[b]], armySize: 300, difficulty: 1, fog: false, spectate: true });
          const w = g.world;
          let t = 0;
          for (; t < 30 * 60 * 40 && !w.winner; t++) {
            w.tick();
            for (const ai of g.ais) ai.update();
            w.fxN = 0;
            w.events.length = 0;
          }
          const fa = FACTION_IDS[a], fb = FACTION_IDS[b];
          games[fa] = (games[fa] ?? 0) + 1;
          games[fb] = (games[fb] ?? 0) + 1;
          if (w.winner) {
            const fw = w.winner === 1 ? fa : fb;
            wins[fw] = (wins[fw] ?? 0) + 1;
          }
          console.log(`${fa} vs ${fb}: winner=${w.winner} t=${(t / 30 / 60).toFixed(1)}min units=${w.teamCount[1]}/${w.teamCount[2]} lost=${w.lost[1]}/${w.lost[2]} fields=${w.nav.computed}`);
        }
      }
    }
    console.log(FACTION_IDS.map(f => `${f}: ${wins[f] ?? 0}/${games[f]}`).join('  '));
  }, 3600000);
});
