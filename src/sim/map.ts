/** 程序化地图生成：地形、河流、据点（城池/营地/村庄等）、道路与植被 */
import {
  BUILDINGS, SITE_CAMP, SITE_CITY, SITE_HQ, SITE_RANCH, SITE_TOWN, SITE_VILLAGE, SITE_WORKSHOP, TILE,
  T_BRIDGE, T_DEEP, T_FARM, T_FOREST, T_GRASS, T_HILL, T_MOUNTAIN, T_ROAD, T_SHALLOW,
} from './defs';
import { RNG, fbm, hash2, vnoise } from './rng';

export interface BuildingSpec {
  def: string;
  tx: number;
  ty: number;
  owner: number;
  site: number;
  main: boolean;
}
export interface SiteSpec {
  type: number;
  name: string;
  /** 旗帜所在格（格点坐标，位于四格交界） */
  tx: number;
  ty: number;
  owner: number;
}
export interface DeployPoint {
  x: number;
  y: number;
  dx: number;
  dy: number;
}
export interface GameMap {
  seed: number;
  w: number;
  h: number;
  terrain: Uint8Array;
  height: Float32Array;
  /** 夯土地面权重（城内/村内） */
  dirt: Uint8Array;
  sites: SiteSpec[];
  buildings: BuildingSpec[];
  /** 树木与山石：每个 4 个数 (x, y, kind, scale)，按 8×8 格区块排序 */
  props: Float32Array;
  /** 区块 → props 起始下标（长度 = 区块数 + 1） */
  propChunk: Int32Array;
  chunkW: number;
  chunkH: number;
  /** [队伍] 后方援军入口（世界坐标） */
  spawn: { x: number; y: number }[];
  /** [队伍] 初始部队展开位置与朝向 */
  deploy: DeployPoint[];
}

export const CHUNK = 8;

const VILLAGE_NAMES = ['柳溪村', '石桥村', '麦田村', '青禾村', '白杨村', '枫林村'];
const CAMP_NAMES = ['前锋营', '北望营', '河湾营', '鹰嘴营', '松岗营', '虎牢营'];
const TOWN_NAMES = ['临河镇', '望山镇', '平川镇', '落雁镇'];
const RANCH_NAMES = ['西风马场', '草甸马场', '云岭马场'];
const SHOP_NAMES = ['黑石工坊', '铁炉工坊', '赤岩工坊'];

/** 各类据点的半占地（格） */
const HALF: Record<number, [number, number]> = {
  [SITE_HQ]: [13, 11],
  [SITE_CITY]: [15, 13],
  [SITE_TOWN]: [9, 8],
  [SITE_CAMP]: [7, 6],
  [SITE_VILLAGE]: [8, 8],
  [SITE_RANCH]: [6, 6],
  [SITE_WORKSHOP]: [6, 6],
};

export function generateMap(seed: number, size = 320): GameMap {
  const W = size, H = size, N = W * H;
  const rng = new RNG(seed);
  const terrain = new Uint8Array(N);
  const height = new Float32Array(N);
  const dirt = new Uint8Array(N);
  const sA = rng.int(1, 99999), sB = rng.int(1, 99999), sC = rng.int(1, 99999), sD = rng.int(1, 99999),
    sE = rng.int(1, 99999);

  // ---- 基础地形 ----
  const lake = new Float32Array(N), moist = new Float32Array(N);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const e = fbm(x * 0.015, y * 0.015, sA, 4);
      const rg = 1 - Math.abs(2 * fbm(x * 0.012, y * 0.012, sB, 3) - 1);
      height[i] = e * 0.55 + rg * rg * 0.45;
      lake[i] = fbm(x * 0.022, y * 0.022, sC, 3);
      moist[i] = fbm(x * 0.03, y * 0.03, sD, 3) + (hash2(x, y, sD) - 0.5) * 0.05;
    }
  }
  const pct = (arr: Float32Array, p: number): number => {
    const s = Float32Array.from(arr).sort();
    return s[Math.floor(p * (N - 1))];
  };
  const tM = pct(height, 0.935), tH = pct(height, 0.81);
  const tL0 = pct(lake, 0.03), tL1 = pct(lake, 0.05), tF = pct(moist, 0.74);
  for (let i = 0; i < N; i++) {
    const hgt = height[i];
    terrain[i] = hgt > tM ? T_MOUNTAIN : hgt > tH ? T_HILL
      : lake[i] < tL0 ? T_DEEP : lake[i] < tL1 ? T_SHALLOW
      : moist[i] > tF ? T_FOREST : T_GRASS;
  }

  // ---- 河流：沿西北-东南对角线蜿蜒，横亘在两军之间 ----
  const river = new Uint8Array(N);
  const sign = rng.next() < 0.5 ? -1 : 1;
  const fords = [0.2 + rng.range(-0.04, 0.04), 0.5 + rng.range(-0.05, 0.05), 0.8 + rng.range(-0.04, 0.04)];
  const steps = W * 3;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const off = sign * (34 + 26 * vnoise(t * 3.4, 0.5, sE));
    const cx = t * W + off * 0.7071, cy = t * H - off * 0.7071;
    const half = 2.3 + 1.3 * vnoise(t * 7, 3.5, sE);
    let ford = false;
    for (const f of fords) if (Math.abs(t - f) < 0.013) ford = true;
    const r = Math.ceil(half + 2);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = Math.round(cx) + dx, y = Math.round(cy) + dy;
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const d = Math.hypot(x - cx, y - cy);
        const i = y * W + x;
        if (d < half && !ford) {
          terrain[i] = T_DEEP;
          river[i] = 2;
        } else if (d < half + 1.5 && river[i] < 2) {
          if (ford && d < half) river[i] = 3; // 浅滩锁定，不再被相邻的深水段覆盖
          if (river[i] === 0) river[i] = 1;
          terrain[i] = T_SHALLOW;
        }
      }
    }
  }
  // 浅滩可能被相邻河段先写成深水：统一修正
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    let ford = false;
    for (const f of fords) if (Math.abs(t - f) < 0.011) ford = true;
    if (!ford) continue;
    const off = sign * (34 + 26 * vnoise(t * 3.4, 0.5, sE));
    const cx = t * W + off * 0.7071, cy = t * H - off * 0.7071;
    for (let dy = -5; dy <= 5; dy++) {
      for (let dx = -5; dx <= 5; dx++) {
        const x = Math.round(cx) + dx, y = Math.round(cy) + dy;
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        if (Math.hypot(x - cx, y - cy) < 4.2 && terrain[y * W + x] === T_DEEP) terrain[y * W + x] = T_SHALLOW;
      }
    }
  }

  // ---- 据点选址 ----
  interface Plan { type: number; fx: number; fy: number; owner: number }
  const side: Plan[] = [
    { type: SITE_HQ, fx: 0.13, fy: 0.87, owner: 1 },
    { type: SITE_CAMP, fx: 0.29, fy: 0.71, owner: 1 },
    { type: SITE_TOWN, fx: 0.25, fy: 0.42, owner: 0 },
    { type: SITE_CAMP, fx: 0.6, fy: 0.72, owner: 0 },
    { type: SITE_VILLAGE, fx: 0.1, fy: 0.62, owner: 0 },
    { type: SITE_VILLAGE, fx: 0.4, fy: 0.9, owner: 0 },
    { type: SITE_RANCH, fx: 0.08, fy: 0.3, owner: 0 },
    { type: SITE_WORKSHOP, fx: 0.74, fy: 0.9, owner: 0 },
  ];
  const plans: Plan[] = [];
  for (const p of side) {
    const jx = p.type === SITE_HQ ? 0 : rng.range(-0.025, 0.025), jy = p.type === SITE_HQ ? 0 : rng.range(-0.025, 0.025);
    plans.push({ ...p, fx: p.fx + jx, fy: p.fy + jy });
    plans.push({ type: p.type, fx: 1 - p.fx - jx, fy: 1 - p.fy - jy, owner: p.owner ? 3 - p.owner : 0 });
  }
  plans.push({ type: SITE_CITY, fx: 0.5, fy: 0.5, owner: 0 });

  const placed: { cx: number; cy: number; hw: number; hh: number }[] = [];
  const siteOk = (cx: number, cy: number, hw: number, hh: number): boolean => {
    const m = 5;
    if (cx - hw - m < 3 || cy - hh - m < 3 || cx + hw + m > W - 4 || cy + hh + m > H - 4) return false;
    for (let y = cy - hh - m; y <= cy + hh + m; y++) for (let x = cx - hw - m; x <= cx + hw + m; x++) if (river[y * W + x]) return false;
    for (const p of placed) {
      if (Math.abs(p.cx - cx) < p.hw + hw + 8 && Math.abs(p.cy - cy) < p.hh + hh + 8) return false;
    }
    return true;
  };
  const names = { v: 0, c: 0, t: 0, r: 0, s: 0 };
  const sites: SiteSpec[] = [];
  const centers: { cx: number; cy: number }[] = [];
  for (const p of plans) {
    const [hw, hh] = HALF[p.type];
    let cx = Math.round(p.fx * W), cy = Math.round(p.fy * H);
    if (!siteOk(cx, cy, hw, hh)) {
      let found = false;
      for (let r = 2; r <= 60 && !found; r += 2) {
        for (let a = 0; a < 16 && !found; a++) {
          const x = Math.round(cx + Math.cos((a / 16) * Math.PI * 2) * r), y = Math.round(cy + Math.sin((a / 16) * Math.PI * 2) * r);
          if (siteOk(x, y, hw, hh)) {
            cx = x;
            cy = y;
            found = true;
          }
        }
      }
    }
    placed.push({ cx, cy, hw, hh });
    centers.push({ cx, cy });
    const name = p.type === SITE_HQ ? '大本营' : p.type === SITE_CITY ? '天元城'
      : p.type === SITE_TOWN ? TOWN_NAMES[names.t++ % TOWN_NAMES.length]
      : p.type === SITE_CAMP ? CAMP_NAMES[names.c++ % CAMP_NAMES.length]
      : p.type === SITE_VILLAGE ? VILLAGE_NAMES[names.v++ % VILLAGE_NAMES.length]
      : p.type === SITE_RANCH ? RANCH_NAMES[names.r++ % RANCH_NAMES.length]
      : SHOP_NAMES[names.s++ % SHOP_NAMES.length];
    sites.push({ type: p.type, name, tx: cx, ty: cy, owner: p.owner });
  }

  // ---- 平整地基 ----
  const flatten = (cx: number, cy: number, hw: number, hh: number, pad: number): void => {
    for (let y = cy - hh - pad; y <= cy + hh + pad; y++) {
      for (let x = cx - hw - pad; x <= cx + hw + pad; x++) {
        if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) continue;
        const i = y * W + x;
        if (river[i]) continue;
        const ex = Math.max(0, Math.abs(x - cx) - hw), ey = Math.max(0, Math.abs(y - cy) - hh);
        const k = 1 - Math.min(1, Math.hypot(ex, ey) / pad);
        if (k <= 0) continue;
        // 只改地表类型，不动高度：明暗仍随原始起伏平滑过渡，不会出现方形色块
        if (k > 0.25 || terrain[i] === T_DEEP || terrain[i] === T_SHALLOW || terrain[i] === T_MOUNTAIN) terrain[i] = T_GRASS;
      }
    }
  };
  for (let s = 0; s < sites.length; s++) {
    const [hw, hh] = HALF[sites[s].type];
    flatten(centers[s].cx, centers[s].cy, hw, hh, 5);
  }

  // ---- 建筑布局 ----
  const occ = new Uint8Array(N); // 0 空 1 建筑 2 门 3 预留通道
  const buildings: BuildingSpec[] = [];
  const put = (def: string, tx: number, ty: number, owner: number, site: number, main = false): void => {
    const d = BUILDINGS[def];
    for (let y = ty; y < ty + d.h; y++) for (let x = tx; x < tx + d.w; x++) occ[y * W + x] = d.kind === 1 ? 2 : 1;
    buildings.push({ def, tx, ty, owner, site, main });
  };
  const free = (tx: number, ty: number, w: number, h: number): boolean => {
    for (let y = ty; y < ty + h; y++) for (let x = tx; x < tx + w; x++) {
      if (x < 2 || y < 2 || x >= W - 2 || y >= H - 2 || occ[y * W + x] !== 0) return false;
    }
    return true;
  };
  const reserve = (tx: number, ty: number, w: number, h: number): void => {
    for (let y = ty; y < ty + h; y++) for (let x = tx; x < tx + w; x++) if (occ[y * W + x] === 0) occ[y * W + x] = 3;
  };
  const dirtRect = (x0: number, y0: number, x1: number, y1: number, v: number): void => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) dirt[y * W + x] = Math.max(dirt[y * W + x], v);
  };
  const dirtDisc = (cx: number, cy: number, r: number, v: number): void => {
    for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
      const k = 1 - Math.hypot(x - cx, y - cy) / r;
      if (k > 0) dirt[y * W + x] = Math.max(dirt[y * W + x], Math.min(255, v * k * 1.6));
    }
  };

  const walled = (si: number, cx: number, cy: number, hw: number, hh: number, wood: boolean, owner: number): void => {
    const x0 = cx - hw, x1 = cx + hw - 1, y0 = cy - hh, y1 = cy + hh - 1;
    const wall = wood ? 'palisade' : 'wall', gh = wood ? 'wgate_h' : 'gate_h', gv = wood ? 'wgate_v' : 'gate_v';
    if (wood) {
      put('watchtower', x0, y0, owner, si); put('watchtower', x1, y0, owner, si);
      put('watchtower', x0, y1, owner, si); put('watchtower', x1, y1, owner, si);
    } else {
      put('tower', x0, y0, owner, si); put('tower', x1 - 1, y0, owner, si);
      put('tower', x0, y1 - 1, owner, si); put('tower', x1 - 1, y1 - 1, owner, si);
    }
    // 石墙两格厚（门楼、角楼都是 2×2，正好嵌在墙里），木栅一格
    const th = wood ? 1 : 2;
    put(gh, cx - 1, y0, owner, si); put(gh, cx - 1, y1 - th + 1, owner, si);
    put(gv, x0, cy - 1, owner, si); put(gv, x1 - th + 1, cy - 1, owner, si);
    for (let k = 0; k < th; k++) {
      for (let x = x0; x <= x1; x++) {
        if (!occ[(y0 + k) * W + x]) put(wall, x, y0 + k, owner, si);
        if (!occ[(y1 - k) * W + x]) put(wall, x, y1 - k, owner, si);
      }
      for (let y = y0; y <= y1; y++) {
        if (!occ[y * W + x0 + k]) put(wall, x0 + k, y, owner, si);
        if (!occ[y * W + x1 - k]) put(wall, x1 - k, y, owner, si);
      }
    }
    // 十字街与环墙马道
    reserve(cx - 1, y0 + th, 2, y1 - y0 + 1 - th * 2);
    reserve(x0 + th, cy - 1, x1 - x0 + 1 - th * 2, 2);
    reserve(x0 + th, y0 + th, x1 - x0 + 1 - th * 2, 1); reserve(x0 + th, y1 - th, x1 - x0 + 1 - th * 2, 1);
    reserve(x0 + th, y0 + th, 1, y1 - y0 + 1 - th * 2); reserve(x1 - th, y0 + th, 1, y1 - y0 + 1 - th * 2);
    dirtRect(x0, y0, x1, y1, 255);
    dirtDisc(cx, cy, Math.max(hw, hh) + 5, 120);
  };
  const mainAt = (def: string, tx: number, ty: number, owner: number, si: number): void => {
    const d = BUILDINGS[def];
    // 主建筑会压在十字街上：先清掉预留再放置，并在四周留出通道
    for (let y = ty; y < ty + d.h; y++) for (let x = tx; x < tx + d.w; x++) if (occ[y * W + x] === 3) occ[y * W + x] = 0;
    put(def, tx, ty, owner, si, true);
    reserve(tx - 1, ty - 1, d.w + 2, d.h + 2);
  };
  const fill = (si: number, cx: number, cy: number, hw: number, hh: number, defs: string[], density: number, owner: number): void => {
    for (let gy = cy - hh + 3; gy + 1 <= cy + hh - 4; gy += 3) {
      for (let gx = cx - hw + 3; gx + 1 <= cx + hw - 4; gx += 3) {
        if (rng.next() > density) continue;
        const def = rng.pick(defs);
        const d = BUILDINGS[def];
        if (free(gx, gy, d.w, d.h)) put(def, gx, gy, owner, si);
        else if (free(gx, gy, 2, 2)) put(defs[0], gx, gy, owner, si);
      }
    }
  };
  const scatter = (si: number, cx: number, cy: number, def: string, count: number, r0: number, r1: number): void => {
    const d = BUILDINGS[def];
    for (let n = 0, tries = 0; n < count && tries < 60; tries++) {
      const a = rng.range(0, Math.PI * 2), r = rng.range(r0, r1);
      const tx = Math.round(cx + Math.cos(a) * r), ty = Math.round(cy + Math.sin(a) * r);
      if (!free(tx - 1, ty - 1, d.w + 2, d.h + 2)) continue;
      put(def, tx, ty, 0, si);
      n++;
    }
  };
  const farms = (cx: number, cy: number): void => {
    for (let n = 0; n < 5; n++) {
      const a = rng.range(0, Math.PI * 2), r = rng.range(8, 12);
      const fx = Math.round(cx + Math.cos(a) * r), fy = Math.round(cy + Math.sin(a) * r);
      const fw = rng.int(4, 6), fh = rng.int(3, 5);
      for (let y = fy; y < fy + fh; y++) for (let x = fx; x < fx + fw; x++) {
        if (x < 2 || y < 2 || x >= W - 2 || y >= H - 2) continue;
        const i = y * W + x;
        if (occ[i] === 0 && (terrain[i] === T_GRASS || terrain[i] === T_FOREST) && !river[i]) terrain[i] = T_FARM;
      }
    }
  };

  for (let si = 0; si < sites.length; si++) {
    const s = sites[si];
    const { cx, cy } = centers[si];
    const [hw, hh] = HALF[s.type];
    switch (s.type) {
      case SITE_HQ:
        walled(si, cx, cy, hw, hh, false, s.owner);
        mainAt('keep', cx - 2, cy - 6, s.owner, si);
        if (free(cx + 3, cy + 2, 3, 2)) put('barracks', cx + 3, cy + 2, s.owner, si);
        if (free(cx - 6, cy + 2, 3, 2)) put('barracks', cx - 6, cy + 2, s.owner, si);
        fill(si, cx, cy, hw, hh, ['house', 'house', 'barracks'], 0.6, s.owner);
        break;
      case SITE_CITY:
        walled(si, cx, cy, hw, hh, false, 0);
        mainAt('citadel', cx - 2, cy - 6, 0, si);
        fill(si, cx, cy, hw, hh, ['house', 'house', 'house', 'barracks'], 0.8, 0);
        break;
      case SITE_TOWN:
        walled(si, cx, cy, hw, hh, false, 0);
        mainAt('hall', cx - 1, cy - 5, 0, si);
        fill(si, cx, cy, hw, hh, ['house'], 0.75, 0);
        break;
      case SITE_CAMP:
        walled(si, cx, cy, hw, hh, true, s.owner);
        mainAt('cmdtent', cx - 1, cy - 4, s.owner, si);
        fill(si, cx, cy, hw, hh, ['tent'], 0.7, s.owner);
        break;
      case SITE_VILLAGE:
        reserve(cx - 1, cy - 1, 3, 3);
        put('granary', cx - 1, cy - 4, 0, si, true);
        scatter(si, cx, cy, 'farmhouse', 7, 3.5, 7.5);
        farms(cx, cy);
        dirtDisc(cx, cy, 7, 170);
        break;
      case SITE_RANCH:
        reserve(cx - 1, cy - 1, 3, 3);
        put('stable', cx - 1, cy - 4, 0, si, true);
        scatter(si, cx, cy, 'farmhouse', 2, 3.5, 5.5);
        dirtDisc(cx, cy, 6, 200);
        break;
      default:
        reserve(cx - 1, cy - 1, 3, 3);
        put('workshop', cx - 1, cy - 4, 0, si, true);
        scatter(si, cx, cy, 'house', 3, 3.5, 5.5);
        dirtDisc(cx, cy, 6, 220);
        break;
    }
  }

  // ---- 出兵口与展开位置 ----
  const spawn = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }];
  const deploy: DeployPoint[] = [{ x: 0, y: 0, dx: 0, dy: 0 }, { x: 0, y: 0, dx: 0, dy: 0 }, { x: 0, y: 0, dx: 0, dy: 0 }];
  const spawnTiles: { cx: number; cy: number }[] = [];
  for (let si = 0; si < sites.length; si++) {
    const s = sites[si];
    if (s.type !== SITE_HQ) continue;
    const { cx, cy } = centers[si];
    const sx = s.owner === 1 ? 9 : W - 10, sy = s.owner === 1 ? H - 10 : 9;
    flatten(sx, sy, 3, 3, 3);
    spawn[s.owner] = { x: (sx + 0.5) * TILE, y: (sy + 0.5) * TILE };
    spawnTiles[s.owner] = { cx: sx, cy: sy };
    let dx = W / 2 - cx, dy = H / 2 - cy;
    const dl = Math.hypot(dx, dy);
    dx /= dl;
    dy /= dl;
    const px = Math.round(cx + dx * 32), py = Math.round(cy + dy * 32);
    flatten(px, py, 13, 13, 4);
    deploy[s.owner] = { x: px * TILE, y: py * TILE, dx, dy };
  }

  // ---- 道路 ----
  const roadCost = (i: number): number => {
    if (occ[i] === 1) return 0;
    const t = terrain[i];
    const base = t === T_ROAD || t === T_BRIDGE ? 0.35 : t === T_GRASS ? 1 : t === T_FARM ? 1.3 : t === T_FOREST ? 1.8
      : t === T_HILL ? 2.2 : t === T_SHALLOW ? 4.5 : t === T_DEEP ? 9 : 14;
    return base + hash2(i % W, (i / W) | 0, sE) * 0.5;
  };
  const gCost = new Float32Array(N);
  const from = new Int32Array(N);
  const heapK: number[] = [], heapV: number[] = [];
  const road = (ax: number, ay: number, bx: number, by: number): void => {
    gCost.fill(Infinity);
    heapK.length = 0;
    heapV.length = 0;
    const push = (k: number, v: number): void => {
      let i = heapK.length;
      heapK.push(k);
      heapV.push(v);
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heapK[p] <= k) break;
        heapK[i] = heapK[p];
        heapV[i] = heapV[p];
        i = p;
      }
      heapK[i] = k;
      heapV[i] = v;
    };
    const pop = (): number => {
      const top = heapV[0];
      const k = heapK.pop()!, v = heapV.pop()!;
      const n = heapK.length;
      if (n > 0) {
        let i = 0;
        for (;;) {
          let l = 2 * i + 1;
          if (l >= n) break;
          if (l + 1 < n && heapK[l + 1] < heapK[l]) l++;
          if (heapK[l] >= k) break;
          heapK[i] = heapK[l];
          heapV[i] = heapV[l];
          i = l;
        }
        heapK[i] = k;
        heapV[i] = v;
      }
      return top;
    };
    const start = ay * W + ax, goal = by * W + bx;
    gCost[start] = 0;
    from[start] = -1;
    push(0, start);
    while (heapK.length) {
      const c = pop();
      if (c === goal) break;
      const cx = c % W, cy = (c / W) | 0;
      for (let d = 0; d < 8; d++) {
        const nx = cx + [1, 1, 0, -1, -1, -1, 0, 1][d], ny = cy + [0, 1, 1, 1, 0, -1, -1, -1][d];
        if (nx < 2 || ny < 2 || nx >= W - 2 || ny >= H - 2) continue;
        const nc = ny * W + nx;
        const rc = roadCost(nc);
        if (rc === 0) continue;
        if ((d & 1) && (occ[cy * W + nx] === 1 || occ[ny * W + cx] === 1)) continue;
        const g = gCost[c] + rc * (d & 1 ? 1.4142 : 1);
        if (g < gCost[nc]) {
          gCost[nc] = g;
          from[nc] = c;
          push(g + Math.hypot(nx - bx, ny - by) * 0.35, nc);
        }
      }
    }
    if (gCost[goal] === Infinity) return;
    for (let c = goal; c >= 0; c = from[c]) {
      const x = c % W, y = (c / W) | 0;
      const t = terrain[c];
      if (t === T_DEEP || t === T_SHALLOW) {
        terrain[c] = T_BRIDGE;
        for (const [ox, oy] of [[1, 0], [0, 1]]) {
          const j = (y + oy) * W + x + ox;
          if (terrain[j] === T_DEEP || terrain[j] === T_SHALLOW) terrain[j] = T_BRIDGE;
        }
      } else {
        if (t === T_MOUNTAIN) {
          for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
            const j = (y + oy) * W + x + ox;
            if (terrain[j] === T_MOUNTAIN) terrain[j] = T_HILL;
          }
        }
        terrain[c] = T_ROAD;
      }
    }
  };
  // 最小生成树 + 若干环路，保证所有据点连通
  const nS = sites.length;
  const inTree = new Array<boolean>(nS).fill(false);
  inTree[0] = true;
  const edges: [number, number][] = [];
  const dS = (a: number, b: number): number => Math.hypot(centers[a].cx - centers[b].cx, centers[a].cy - centers[b].cy);
  for (let k = 1; k < nS; k++) {
    let ba = -1, bb = -1, bd = 1e9;
    for (let a = 0; a < nS; a++) {
      if (!inTree[a]) continue;
      for (let b = 0; b < nS; b++) {
        if (inTree[b]) continue;
        const d = dS(a, b);
        if (d < bd) {
          bd = d;
          ba = a;
          bb = b;
        }
      }
    }
    inTree[bb] = true;
    edges.push([ba, bb]);
  }
  const hasEdge = (a: number, b: number): boolean => edges.some(e => (e[0] === a && e[1] === b) || (e[0] === b && e[1] === a));
  const cityIdx = nS - 1;
  for (let a = 0; a < nS; a++) {
    // 每个据点再连向第二近的邻居；中央城池连向最近的四个
    const order = [...Array(nS).keys()].filter(b => b !== a).sort((p, q) => dS(a, p) - dS(a, q));
    const extra = a === cityIdx ? 4 : 2;
    for (let k = 0; k < extra; k++) if (!hasEdge(a, order[k]) && (a === cityIdx || rng.next() < 0.6)) edges.push([a, order[k]]);
  }
  for (const [a, b] of edges) road(centers[a].cx, centers[a].cy, centers[b].cx, centers[b].cy);
  for (let si = 0; si < nS; si++) {
    const s = sites[si];
    if (s.type === SITE_HQ) road(spawnTiles[s.owner].cx, spawnTiles[s.owner].cy, centers[si].cx, centers[si].cy);
  }

  // ---- 植被与山石 ----
  const chunkW = Math.ceil(W / CHUNK), chunkH = Math.ceil(H / CHUNK);
  const lists: number[][] = [];
  for (let i = 0; i < chunkW * chunkH; i++) lists.push([]);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const t = terrain[i];
      const ci = ((y / CHUNK) | 0) * chunkW + ((x / CHUNK) | 0);
      if (t === T_FOREST && occ[i] === 0) {
        // 林子留出空隙，免得树冠把林中的部队完全盖住
        const hv = hash2(x, y, sA);
        const n = hv < 0.2 ? 2 : hv < 0.75 ? 1 : 0;
        for (let k = 0; k < n; k++) {
          const px = (x + 0.15 + hash2(x + k * 7, y, sB) * 0.7) * TILE, py = (y + 0.2 + hash2(x, y + k * 13, sC) * 0.7) * TILE;
          const conifer = height[i] > tH - 0.06 || hash2(x >> 3, y >> 3, sD) < 0.25;
          const kind = conifer ? 3 + ((hash2(x, y, sE + k) * 2) | 0) : (hash2(x, y, sE + k) * 3) | 0;
          lists[ci].push(px, py, kind, 0.75 + hash2(x + k, y + k, sA + 5) * 0.4);
        }
      } else if (t === T_MOUNTAIN && hash2(x, y, sB) < 0.6) {
        const k = Math.min(1, (height[i] - tM) / 0.08);
        lists[ci].push((x + 0.5 + (hash2(x, y, sC) - 0.5) * 0.5) * TILE, (y + 0.7) * TILE, 5 + ((hash2(x, y, sD) * 3) | 0), 0.9 + k * 0.7);
      } else if ((t === T_GRASS || t === T_HILL) && occ[i] === 0 && dirt[i] === 0 && hash2(x, y, sC + 9) < 0.012) {
        // 零星孤树与碎石
        const rock = t === T_HILL && hash2(x, y, sA + 3) < 0.6;
        lists[ci].push((x + 0.5) * TILE, (y + 0.6) * TILE, rock ? 5 : (hash2(x, y, sE) * 3) | 0, rock ? 0.5 : 0.9);
      }
    }
  }
  const propChunk = new Int32Array(chunkW * chunkH + 1);
  let total = 0;
  for (let i = 0; i < lists.length; i++) {
    propChunk[i] = total / 4;
    total += lists[i].length;
  }
  propChunk[lists.length] = total / 4;
  const props = new Float32Array(total);
  let o = 0;
  for (const l of lists) {
    // 区块内按 y 排序，渲染时遮挡更自然
    const idx = [...Array(l.length / 4).keys()].sort((a, b) => l[a * 4 + 1] - l[b * 4 + 1]);
    for (const k of idx) {
      props[o++] = l[k * 4];
      props[o++] = l[k * 4 + 1];
      props[o++] = l[k * 4 + 2];
      props[o++] = l[k * 4 + 3];
    }
  }

  return { seed, w: W, h: H, terrain, height, dirt, sites, buildings, props, propChunk, chunkW, chunkH, spawn, deploy };
}
