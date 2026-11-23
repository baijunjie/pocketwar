/** 开局：生成地图、摆放建筑与据点、部署双方部队 */
import { COMMANDERS, Commander } from './ai';
import { BUILDINGS, FACTIONS, FactionDef, FactionId, SITE_CAMP, SITE_HQ, SITE_INFO, TILE, UNIT_BY_KEY } from './defs';
import { generateMap } from './map';
import { RNG } from './rng';
import { initSupply } from './systems/supply';
import { World } from './world';

export interface GameOptions {
  seed: number;
  /** [玩家, 敌方] */
  factions: [FactionId, FactionId];
  /** 每方初始兵力 */
  armySize: number;
  /** 0 简单 1 普通 2 困难 */
  difficulty: number;
  fog: boolean;
  /** 观战：双方都由 AI 指挥 */
  spectate: boolean;
  mapSize?: number;
  /** 昼夜与天气，缺省开启 */
  environment?: boolean;
  /** 粮草，缺省开启 */
  supply?: boolean;
  /** 电脑一方用哪套指挥算法（见 ai/commander.ts），缺省 strategic */
  ai?: string;
}

export interface Game {
  world: World;
  ais: Commander[];
  opts: GameOptions;
}

/** 按阵营编制生成兵种下标列表 */
export function armyList(f: FactionDef, total: number): number[] {
  const out: number[] = [];
  for (const [key, frac] of f.army) {
    const n = Math.max(1, Math.round(frac * total * f.armyMult));
    const idx = UNIT_BY_KEY[key].idx;
    for (let k = 0; k < n; k++) out.push(idx);
  }
  return out;
}

export function createGame(opts: GameOptions): Game {
  const map = generateMap(opts.seed, opts.mapSize ?? 320);
  const world = new World(map, opts.seed);
  const rng = new RNG(opts.seed + 77);
  world.humanTeam = opts.spectate ? 0 : 1;
  world.fog = opts.fog && !opts.spectate;
  world.env.enabled = opts.environment !== false;
  world.factions = [null, FACTIONS[opts.factions[0]], FACTIONS[opts.factions[1]]];

  for (const s of map.sites) {
    const site = world.addSite(s.type, s.type === SITE_HQ ? `${world.factions[s.owner]!.name}大本营` : s.name,
      s.tx * TILE, s.ty * TILE, s.owner);
    site.timer = SITE_INFO[s.type].interval * rng.range(0.6, 1);
    for (const [tx, ty] of s.slots ?? []) site.slots.push({ tx, ty, bld: -1 });
  }
  for (const spec of map.buildings) {
    const style = spec.def === 'keep' ? world.factions[spec.owner]!.id : '';
    const b = world.addBuilding(BUILDINGS[spec.def], spec.tx, spec.ty, spec.owner, spec.site, style);
    const site = world.sites[spec.site];
    site.buildings.push(b.id);
    if (spec.main) site.main = b.id;
  }
  world.sealWalls();

  const aiSizeMult = [0.8, 1, 1.2][opts.difficulty];
  const ais: Commander[] = [];
  const makeAI = COMMANDERS[opts.ai ?? 'strategic'];
  for (let tm = 1; tm <= 2; tm++) {
    const fac = world.factions[tm]!;
    const isAI = tm === 2 || opts.spectate;
    const size = Math.round(opts.armySize * (tm === 2 && !opts.spectate ? aiSizeMult : 1));
    world.unitCap[tm] = Math.min(3600, Math.max(320, Math.round(size * 1.5)));
    world.reinfMult[tm] = tm === 2 && !opts.spectate ? [0.8, 1, 1.25][opts.difficulty] : 1;
    const dp = map.deploy[tm];
    world.rally[tm] = { x: dp.x, y: dp.y };
    // 洗牌后切分，保证各队兵种构成相近
    const list = armyList(fac, size);
    for (let i = list.length - 1; i > 0; i--) {
      const j = rng.int(0, i);
      [list[i], list[j]] = [list[j], list[i]];
    }
    let cursor = 0;
    const take = (frac: number): number[] => {
      const n = Math.round(list.length * frac);
      const part = list.slice(cursor, cursor + n);
      cursor += n;
      return part;
    };
    const hq = world.sites.find(s => s.type === SITE_HQ && s.owner === tm)!;
    const camp = world.sites.find(s => s.type === SITE_CAMP && s.owner === tm);
    const ai = isAI ? makeAI(world, tm, opts.spectate ? 1 : opts.difficulty) : null;
    if (ai) ais.push(ai);
    if (camp) {
      const g = world.spawnGroup(tm, take(0.08), camp.x, camp.y + 40, dp.dx, dp.dy);
      ai?.addGroup(g, true);
    }
    if (ai) {
      // 大本营的守备队：弓弩手开局就登城驻守
      const home = world.spawnGroup(tm, take(0.16), hq.x, hq.y + 70, dp.dx, dp.dy);
      ai.addGroup(home, true);
      world.orderGarrison(home);
      const rest = list.length - cursor;
      const lx = -dp.dy, ly = dp.dx;
      for (let k = 0; k < 3; k++) {
        const part = k === 2 ? list.slice(cursor) : take(rest / 3 / list.length);
        const off = (k - 1) * 17 * TILE;
        ai.addGroup(world.spawnGroup(tm, part, dp.x + lx * off, dp.y + ly * off, dp.dx, dp.dy), false);
      }
      world.onReinforce = chain(world.onReinforce, tm, ai);
    } else {
      world.spawnGroup(tm, list.slice(cursor), dp.x, dp.y, dp.dx, dp.dy);
    }
  }
  for (let tm = 1; tm <= 2; tm++) world.armyBase[tm] = world.upkeep[tm];
  if (opts.supply !== false) initSupply(world);
  world.systems.find(s => s.name === 'environment')!.run(world);
  world.refreshVision();
  return { world, ais, opts };
}

function chain(prev: World['onReinforce'], tm: number, ai: Commander): World['onReinforce'] {
  return (team, slots) => {
    prev?.(team, slots);
    if (team === tm) ai.addReinforcements(slots);
  };
}
