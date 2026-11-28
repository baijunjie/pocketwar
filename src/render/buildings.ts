/** 代码建模的建筑：原点在占地中心的地面，+X 向东、+Z 向南，单位为世界像素（每格 32） */
import * as THREE from 'three';
import { BUILDINGS, TILE } from '../sim/defs';
import { Col, ball, box, cone, cyl, join, xf } from './prims';
import { BRIDGE_WIDTH } from '../sim/map';
import { BRIDGE_DECK_Y } from './terrain';

const STONE = 0x9c978c, STONE_D = 0x7d786e, STONE_L = 0xb4afa3, PLASTER = 0xd9cfb8, TIMBER = 0x5a4028, WOOD = 0x8a6a42;
const THATCH = 0xb59a58, TILE_RED = 0xa9523a, TILE_GREY = 0x4c5356, CANVAS = 0xd8cfb4, MUD = 0xc7a877, IRON = 0x4a4d54;

type G = THREE.BufferGeometry;

/** 双坡屋顶：屋脊沿 X 方向 */
function gable(w: number, d: number, h: number, color: Col, y: number, over = 2): G {
  const hw = w / 2 + over, hd = d / 2 + over;
  const v = [
    // 两个坡面
    -hw, 0, hd, hw, 0, hd, hw, h, 0, -hw, 0, hd, hw, h, 0, -hw, h, 0,
    hw, 0, -hd, -hw, 0, -hd, -hw, h, 0, hw, 0, -hd, -hw, h, 0, hw, h, 0,
    // 山墙
    hw, 0, hd, hw, 0, -hd, hw, h, 0, -hw, 0, -hd, -hw, 0, hd, -hw, h, 0,
    // 底面
    -hw, 0, -hd, hw, 0, -hd, hw, 0, hd, -hw, 0, -hd, hw, 0, hd, -hw, 0, hd,
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(v), 3));
  g.computeVertexNormals();
  const c = new THREE.Color(color);
  const col = new Float32Array(v.length);
  for (let i = 0; i < v.length; i += 3) c.toArray(col, i);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g.translate(0, y, 0);
}

/** 四坡 / 攒尖屋顶 */
function hip(w: number, d: number, h: number, color: Col, y: number, over = 3): G {
  const g = cone(Math.SQRT1_2, 1, color, 0, 0.5, 0, 4);
  g.rotateY(Math.PI / 4);
  g.scale(w + over * 2, h, d + over * 2);
  g.computeVertexNormals();
  return g.translate(0, y, 0);
}

/** 带雉堞的方台 */
function battlement(w: number, d: number, y: number, color: Col, n = 3, mh = 5): G[] {
  const out: G[] = [];
  const m = 5;
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1) - 0.5;
    out.push(box(m, mh, 3, color, t * (w - m), y + mh / 2, d / 2 - 1.5), box(m, mh, 3, color, t * (w - m), y + mh / 2, -d / 2 + 1.5));
    if (i > 0 && i < n - 1) out.push(box(3, mh, m, color, w / 2 - 1.5, y + mh / 2, t * (d - m)), box(3, mh, m, color, -w / 2 + 1.5, y + mh / 2, t * (d - m)));
  }
  return out;
}

/**
 * 城墙 / 木栅：按四邻连接情况生成（位掩码：1 北，2 东，4 南，8 西）。
 * @param out 石墙朝城外的那几条边（同样的位掩码）：只有正面砌垛口，朝城内的一面敞开，士兵从那边上下
 * @param lv 据点等级，2 级起：木栅加高并钉上横木、朝外架拒马；石墙垛口加高，外沿搭一道带顶的木战棚
 */
export function wallGeo(mask: number, wood: boolean, out = 0, lv = 1): G {
  const parts: G[] = [];
  const half = TILE / 2;
  const dirs: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  if (wood) {
    const log = (x: number, z: number, h: number): void => {
      parts.push(cyl(2.6, 2.9, h, WOOD, x, h / 2, z, 5), cone(2.6, 4, 0xa98a5a, x, h + 2, z, 5));
    };
    const up = lv >= 2 ? 7 : 0;
    log(0, 0, 19 + up);
    dirs.forEach(([dx, dz], k) => {
      if (!(mask & (1 << k))) return;
      log(dx * 6, dz * 6, 17 + up);
      log(dx * 11.5, dz * 11.5, 18.5 + up);
      parts.push(box(dx ? half : 1.5, 2, dz ? half : 1.5, TIMBER, dx * half / 2, 11, dz * half / 2));
      if (lv >= 2) parts.push(box(dx ? half : 2.2, 2.4, dz ? half : 2.2, IRON, dx * half / 2, 18, dz * half / 2), box(dx ? half : 2, 2, dz ? half : 2, TIMBER, dx * half / 2, 5, dz * half / 2));
    });
    if (lv >= 2) {
      // 没有接着木栅的那两侧就是栅外 / 栅内：各架一排斜插的尖木
      dirs.forEach(([dx, dz], k) => {
        if (mask & (1 << k)) return;
        for (const s of [-1, 1]) {
          parts.push(xf(cone(1.5, 15, 0xa98a5a, 0, 0, 0, 4), { rz: -dx * 1.05, rx: dz * 1.05, t: [dx * 8 + (dz ? s * 7 : 0), 5, dz * 8 + (dx ? s * 7 : 0)] }));
        }
      });
    }
    return join(...parts);
  }
  // 石墙：每格一整块，两圈拼成两格厚的墙体；墙顶就是驻守单位站的高度（BuildingDef.top）
  const H = 26;
  parts.push(box(TILE, H, TILE, STONE, 0, H / 2, 0), box(TILE, 1, TILE, STONE_D, 0, H - 0.4, 0));
  dirs.forEach(([dx, dz], k) => {
    if (!(out & (1 << k))) return;
    const ex = dx * (half - 1.75), ez = dz * (half - 1.75);
    // 女墙与垛口
    parts.push(box(dx ? 3.5 : TILE, 3, dz ? 3.5 : TILE, STONE_L, ex, H + 1.5, ez));
    for (const s of [-1, 1]) parts.push(box(dx ? 3.5 : 9, 4.5, dz ? 3.5 : 9, STONE_L, ex + (dz ? s * 8 : 0), H + 5.2, ez + (dx ? s * 8 : 0)));
    // 墙脚收分
    parts.push(box(dx ? 3 : TILE, 6, dz ? 3 : TILE, STONE_D, dx * (half + 0.6), 3, dz * (half + 0.6)));
    if (lv >= 2) {
      // 升级：墙脚再包一层条石，垛口上搭木战棚（立柱 + 斜顶），远看整道墙高出一截
      parts.push(box(dx ? 5 : TILE, 11, dz ? 5 : TILE, STONE_L, dx * (half + 1.6), 5.5, dz * (half + 1.6)));
      for (const s of [-1, 1]) parts.push(box(1.6, 9, 1.6, TIMBER, ex + (dz ? s * 14 : 0), H + 8, ez + (dx ? s * 14 : 0)));
      parts.push(xf(box(dx ? 9 : TILE + 1, 1.4, dz ? 9 : TILE + 1, 0x6e4a36), { rz: -dx * 0.28, rx: dz * 0.28, t: [dx * (half - 1), H + 12.6, dz * (half - 1)] }));
    }
  });
  return join(...parts);
}

/** 旌旗：一根高杆挂一幅竖长的幡，升级后的据点主建筑四角各立一面 */
function banner(x: number, z: number, h: number, c1: Col = 0xb0483a, c2: Col = 0xd9b44a): G[] {
  return [cyl(0.7, 0.9, h, TIMBER, x, h / 2, z, 5), box(7, h * 0.42, 0.6, c1, x + 4.2, h * 0.74, z), box(7, 2, 0.8, c2, x + 4.2, h * 0.95, z),
    box(7, 2, 0.8, c2, x + 4.2, h * 0.54, z), cone(1.4, 4, c2, x, h + 2, z, 5)];
}

/** 火炮：炮口朝南（+Z），底座在原点的地面 */
function cannon(x: number, y: number, z: number, s = 1): G[] {
  const p: G[] = [box(15, 4, 24, TIMBER, 0, 6, 0), box(11, 5, 6, WOOD, 0, 9.5, -8)];
  for (const sx of [-1, 1]) p.push(xf(cyl(5.5, 5.5, 2.6, WOOD, 0, 0, 0, 8), { rz: Math.PI / 2, t: [sx * 8.8, 5.5, 2] }), xf(cyl(1.4, 1.4, 3.4, IRON, 0, 0, 0, 6), { rz: Math.PI / 2, t: [sx * 8.8, 5.5, 2] }));
  p.push(xf(cyl(3.1, 4.6, 28, IRON, 0, 0, 0, 8), { rx: Math.PI / 2 - 0.12, t: [0, 12, 5] }), xf(cyl(4.2, 4.2, 2.2, 0x2a2a2e, 0, 0, 0, 8), { rx: Math.PI / 2 - 0.12, t: [0, 13.6, 17.5] }),
    ball(4.8, IRON, 0, 12, -9, 6));
  return p.map(g => xf(g, { s, t: [x, y, z] }));
}

/** 连弩：弩臂朝南（+Z），弩身上方一个装箭的匣子 */
function ballista(x: number, y: number, z: number, s = 1): G[] {
  const p: G[] = [cyl(1.6, 2.2, 11, TIMBER, 0, 5.5, 0, 5), box(3, 2, 24, WOOD, 0, 12, 3), box(6, 5, 9, TIMBER, 0, 16, -2)];
  for (const sx of [-1, 1]) p.push(xf(box(15, 1.8, 2.2, TIMBER), { ry: sx * 0.32, t: [sx * 7.2, 12.5, 11] }), xf(box(0.7, 0.7, 13, IRON), { t: [sx * 1.5, 12.8, 5] }));
  p.push(box(30, 0.5, 0.5, PLASTER, 0, 12.5, 3), box(0.7, 0.7, 17, IRON, 0, 13.3, 6), box(0.7, 0.7, 17, IRON, 0, 18.5, -1));
  return p.map(g => xf(g, { s, t: [x, y, z] }));
}

/** 升级后加在建筑上的东西：四角的旌旗；3 级的主堡朝南挑出两座炮台，中军帐前架两座连弩 */
function fortify(key: string, style: string, lv: number): G[] {
  const fp: Record<string, [number, number, number]> = {
    keep: [118, 118, style === 'japan' ? 96 : 78], keep_town: [84, 60, 50], cmdtent: [80, 48, 34], barracks: [88, 50, 34],
  };
  const f = fp[key];
  if (!f) return [];
  const [w, d, h] = f;
  const p: G[] = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.push(...banner(sx * (w / 2 + 3), sz * (d / 2 + 3), h));
  if (lv >= 3 && (key === 'keep' || key === 'keep_town')) {
    // 炮台：贴着南墙挑出的木台，下面两根立柱撑到地面，台上一门火炮
    const hy = Math.round(h * 0.55), px = w * 0.28, pz = d / 2 + 11;
    for (const sx of [-1, 1]) {
      p.push(box(30, 3, 26, WOOD, sx * px, hy, pz), box(30, 5, 1.4, TIMBER, sx * px, hy + 4, pz + 12.5), box(1.4, 5, 26, TIMBER, sx * px + 14.3, hy + 4, pz), box(1.4, 5, 26, TIMBER, sx * px - 14.3, hy + 4, pz));
      for (const dx of [-12, 12]) p.push(cyl(1.8, 2.2, hy, TIMBER, sx * px + dx, hy / 2, pz + 10, 5));
      p.push(...cannon(sx * px, hy + 1.5, pz - 2, 1.1));
    }
  }
  if (lv >= 3 && key === 'cmdtent') {
    for (const sx of [-1, 1]) {
      p.push(box(22, 6, 18, WOOD, sx * (w / 2 - 4), 3, d / 2 + 12), ...ballista(sx * (w / 2 - 4), 6, d / 2 + 12, 1.1));
    }
  }
  return p;
}

function house(w: number, d: number, wallH: number, roofH: number, wall: Col, roof: Col, framed = true): G[] {
  const p = [box(w, wallH, d, wall, 0, wallH / 2, 0), gable(w, d, roofH, roof, wallH), box(5, wallH * 0.62, 0.8, TIMBER, w * 0.18, wallH * 0.31, d / 2 + 0.2)];
  if (framed) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.push(box(1.6, wallH, 1.6, TIMBER, sx * (w / 2 - 0.4), wallH / 2, sz * (d / 2 - 0.4)));
    p.push(box(w + 0.6, 1.4, d + 0.6, TIMBER, 0, wallH - 0.7, 0));
  }
  p.push(box(4, 3.5, 0.8, 0x3a3630, -w * 0.22, wallH * 0.6, d / 2 + 0.2));
  return p;
}

function keep(style: string): G {
  const p: G[] = [];
  if (style === 'china') {
    // 高台 + 重檐大殿
    p.push(xf(cyl(Math.SQRT1_2, Math.SQRT1_2 * 1.08, 1, STONE, 0, 0.5, 0, 4), { ry: Math.PI / 4, s: [112, 24, 112] }), ...battlement(112, 112, 24, STONE_L, 7));
    p.push(box(30, 24, 8, STONE_D, 0, 12, 58), box(14, 15, 9, TIMBER, 0, 7.5, 58.5));
    p.push(box(78, 20, 54, 0x9c3a2c, 0, 34, 0), hip(86, 62, 12, TILE_GREY, 44, 9), box(96, 1.5, 72, 0x3c4245, 0, 44.5, 0));
    for (let i = -3; i <= 3; i++) p.push(cyl(1.6, 1.6, 20, 0x7a2a20, i * 12.5, 34, 28.5, 5), cyl(1.6, 1.6, 20, 0x7a2a20, i * 12.5, 34, -28.5, 5));
    p.push(box(54, 14, 36, 0x9c3a2c, 0, 62, 0), hip(60, 42, 16, TILE_GREY, 69, 8), box(68, 1.5, 50, 0x3c4245, 0, 69.5, 0), box(40, 2.5, 2.5, 0xc9a227, 0, 85, 0));
  } else if (style === 'japan') {
    // 石垣 + 三层天守
    p.push(xf(cyl(Math.SQRT1_2 * 0.82, Math.SQRT1_2, 1, STONE_D, 0, 0.5, 0, 4), { ry: Math.PI / 4, s: [116, 28, 116] }));
    const tiers: [number, number, number][] = [[84, 18, 28], [62, 16, 56], [42, 14, 82]];
    for (const [w, h, y] of tiers) {
      p.push(box(w, h, w, 0xeeeae0, 0, y + h / 2, 0), box(w + 0.5, 3, w + 0.5, 0x3a3a3e, 0, y + 1.5, 0), hip(w, w, 10, 0x3d4246, y + h, 9), box(w + 20, 1.2, w + 20, 0x2e3235, 0, y + h + 0.6, 0));
    }
    p.push(gable(42, 30, 12, 0x3d4246, 96, 5), box(2, 5, 2, 0xc9a227, 22, 110, 0), box(2, 5, 2, 0xc9a227, -22, 110, 0));
  } else if (style === 'rome') {
    // 石砌营垒 + 红瓦指挥所 + 柱廊
    p.push(box(116, 26, 116, STONE_L, 0, 13, 0), ...battlement(116, 116, 26, STONE, 8));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.push(box(26, 40, 26, STONE, sx * 50, 20, sz * 50), ...battlement(26, 26, 40, STONE_L, 3).map(g => g.translate(sx * 50, 0, sz * 50)));
    p.push(box(70, 24, 50, 0xe6ddc8, 0, 38, -6), gable(70, 50, 18, TILE_RED, 50, 4));
    for (let i = -3; i <= 3; i++) p.push(cyl(2.2, 2.4, 22, 0xf0ece0, i * 10, 37, 26, 6));
    p.push(box(74, 3, 12, 0xf0ece0, 0, 49.5, 26), box(16, 18, 8, TIMBER, 0, 9, 58.5));
  } else {
    // 泥砖宫城 + 琉璃穹顶
    p.push(box(114, 32, 114, MUD, 0, 16, 0), ...battlement(114, 114, 32, 0xd8bc8e, 8));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.push(cyl(15, 17, 42, 0xbf9f6c, sx * 52, 21, sz * 52, 8), cyl(16.5, 15, 4, 0xd8bc8e, sx * 52, 44, sz * 52, 8));
    p.push(box(60, 20, 60, 0xd8bc8e, 0, 42, 0), xf(ball(24, 0x2a9d95, 0, 0, 0, 10), { s: [1, 1.15, 1], t: [0, 54, 0] }), cone(3, 9, 0xc9a227, 0, 84, 0, 6));
    p.push(box(26, 30, 6, 0xd8bc8e, 0, 15, 58), box(14, 22, 7, 0x2a6f8a, 0, 11, 58.5), box(118, 3, 118, 0x2a9d95, 0, 26, 0).scale(1, 1, 1));
  }
  return join(...p);
}

/**
 * @returns 建筑几何体；style 仅主堡使用，variant 用于民居等的外观变化
 * @param lv 所在据点的等级：2 级起在原样上加固（见各建筑的升级部分），3 级再架火炮或连弩（见 lookLevel）
 */
export function buildingGeo(key: string, style: string, variant: number, lv = 1): G {
  const g = baseGeo(key, style, variant, lv);
  const extra = lv >= 2 ? fortify(key, style, lv) : [];
  return extra.length ? join(g, ...extra) : g;
}

function baseGeo(key: string, style: string, variant: number, lv: number): G {
  const p: G[] = [];
  switch (key) {
    case 'gate_h': case 'gate_v': case 'wgate_h': case 'wgate_v': {
      const wood = key.startsWith('w');
      if (wood) {
        p.push(cyl(3.2, 3.6, 26, WOOD, -27, 13, 0, 6), cyl(3.2, 3.6, 26, WOOD, 27, 13, 0, 6), box(60, 3, 4, TIMBER, 0, 24, 0), box(50, 17, 2, 0x7a5a36, 0, 9, 0),
          box(50, 1.5, 2.6, TIMBER, 0, 14, 0), box(50, 1.5, 2.6, TIMBER, 0, 5, 0));
        // 升级：门上架一座带顶的敌楼，门板包铁
        if (lv >= 2) p.push(cyl(3.6, 4, 36, WOOD, -27, 18, 0, 6), cyl(3.6, 4, 36, WOOD, 27, 18, 0, 6), box(64, 2, 12, WOOD, 0, 27, 0), box(64, 5, 1.2, WOOD, 0, 30.5, 6), box(64, 5, 1.2, WOOD, 0, 30.5, -6),
          hip(64, 12, 8, 0x6e4a36, 37, 3), box(50, 2.4, 2.8, IRON, 0, 10, 0), box(50, 2.4, 2.8, IRON, 0, 2.5, 0), box(2.4, 17, 2.8, IRON, 0, 9, 0));
      } else {
        // 门楼：四格宽、两格深，与两格厚的城墙齐平；门洞贯通（约 2.4 格宽），两扇门板向内敞开
        const W = TILE * 4, D = TILE * 2, pier = 24, hole = W - pier * 2;
        p.push(box(pier, 40, D, STONE_D, -(W - pier) / 2, 20, 0), box(pier, 40, D, STONE_D, (W - pier) / 2, 20, 0), box(W, 14, D, STONE, 0, 33, 0),
          ...battlement(W, D, 40, STONE_L, 10, 4.5),
          box(56, 12, 24, 0xb0483a, 0, 46, 0), hip(56, 24, 10, TILE_GREY, 52, 5),
          box(hole, 2.4, 3.6, 0x3a3a40, 0, 26, 0));
        for (const sx of [-1, 1]) p.push(box(hole / 2 - 2, 25, 3, 0x5a4028, sx * (hole / 4 + 1), 13, 0), box(hole / 2 - 2, 2, 3.6, 0x3a3a40, sx * (hole / 4 + 1), 18, 0),
          box(hole / 2 - 2, 2, 3.6, 0x3a3a40, sx * (hole / 4 + 1), 7, 0));
        // 升级：城楼加一层重檐，两侧立旌旗
        if (lv >= 2) p.push(box(76, 10, 36, 0xb0483a, 0, 51, 0), hip(76, 36, 9, TILE_GREY, 56, 5), box(40, 9, 20, 0xb0483a, 0, 67, 0), hip(40, 20, 9, TILE_GREY, 71, 4),
          ...banner(-(W / 2 - 8), 28, 62), ...banner(W / 2 - 12, 28, 62));
      }
      const g = join(...p);
      return key.endsWith('_v') ? g.rotateY(Math.PI / 2) : g;
    }
    case 'tower':
      // 角楼：占满两格见方、与城墙严丝合缝，平顶比墙高一截，墙上的人可以直接走上来
      p.push(box(64, 37, 64, STONE, 0, 18.5, 0), box(67, 3, 67, STONE_D, 0, 38.5, 0), ...battlement(67, 67, 40, STONE_L, 5, 5),
        box(66, 5, 66, STONE_D, 0, 2.5, 0),
        box(3, 8, 1, 0x2a2a2e, 0, 24, 32.2), box(1, 8, 3, 0x2a2a2e, 32.2, 24, 0), box(3, 8, 1, 0x2a2a2e, 0, 24, -32.2), box(1, 8, 3, 0x2a2a2e, -32.2, 24, 0));
      // 升级：平顶上起一座四面敞开的箭亭（人仍然站在亭下），墙脚包条石
      if (lv >= 2) {
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.push(cyl(1.8, 2, 24, 0x7a2a20, sx * 25, 52, sz * 25, 6));
        p.push(box(72, 1.6, 72, 0x3c4245, 0, 64.6, 0), box(70, 12, 70, STONE_L, 0, 6, 0));
        if (lv >= 3) {
          // 3 级炮楼：箭亭的顶换成石砌炮台，台上架一门火炮，朝南
          p.push(box(72, 3, 72, STONE_D, 0, 66, 0), ...battlement(72, 72, 67.5, STONE_L, 5, 5), ...cannon(0, 67.5, 2, 1.5));
        } else p.push(hip(58, 58, 16, TILE_GREY, 64, 6), cone(2.4, 7, 0xc9a227, 0, 83, 0, 6));
      }
      break;
    case 'watchtower':
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.push(xf(cyl(1.5, 1.8, 34, TIMBER, 0, 17, 0, 5), { t: [sx * 9, 0, sz * 9] }));
      p.push(box(24, 2, 24, WOOD, 0, 26, 0), box(24, 6, 1.2, WOOD, 0, 30, 12), box(24, 6, 1.2, WOOD, 0, 30, -12), box(1.2, 6, 24, WOOD, 12, 30, 0), box(1.2, 6, 24, WOOD, -12, 30, 0),
        box(20, 1.2, 1.2, TIMBER, 0, 13, 9), box(20, 1.2, 1.2, TIMBER, 0, 13, -9));
      // 3 级连弩哨塔：顶棚拆去，平台上架一架连弩；其余等级顶着瓦（或茅草）顶
      if (lv < 3) p.push(hip(24, 24, 9, lv >= 2 ? 0x6e4a36 : THATCH, 38, 3));
      // 升级：护栏外挂一圈盾牌，塔脚加斜撑和一圈木板
      if (lv >= 2) {
        for (const s of [-1, 1]) p.push(box(7, 6, 1, 0x8a3a2c, s * 6, 30, 13), box(7, 6, 1, 0x8a3a2c, s * 6, 30, -13), box(1, 6, 7, 0x8a3a2c, 13, 30, s * 6), box(1, 6, 7, 0x8a3a2c, -13, 30, s * 6));
        p.push(box(21, 12, 21, WOOD, 0, 6, 0), box(22, 1.6, 22, IRON, 0, 12, 0));
        if (lv >= 3) p.push(...ballista(0, 27, 0, 1.15));
        else p.push(cone(1.6, 5, 0xc9a227, 0, 49, 0, 5));
      }
      break;
    case 'arrowtower':
      // 资源点的哨塔：方木塔身上挑出一圈战棚，尖顶
      p.push(box(15, 30, 15, WOOD, 0, 15, 0), box(16.5, 2, 16.5, TIMBER, 0, 10, 0), box(16.5, 2, 16.5, TIMBER, 0, 20, 0), box(24, 2, 24, TIMBER, 0, 30, 0),
        box(24, 7, 1.4, 0x7a5a36, 0, 34.5, 11.6), box(24, 7, 1.4, 0x7a5a36, 0, 34.5, -11.6), box(1.4, 7, 24, 0x7a5a36, 11.6, 34.5, 0), box(1.4, 7, 24, 0x7a5a36, -11.6, 34.5, 0),
        hip(22, 22, 13, 0x6e4a36, 44, 3), box(4, 6, 0.8, 0x2a2a2e, 0, 22, 7.7), box(0.8, 6, 4, 0x2a2a2e, 7.7, 22, 0));
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.push(cyl(1, 1, 8, TIMBER, sx * 10.5, 41, sz * 10.5, 4), xf(box(1.4, 9, 1.4, TIMBER), { rz: -sx * 0.7, t: [sx * 9.5, 27, sz * 7] }));
      break;
    case 'farmstead':
      // 谷仓：木板墙、草顶，旁边两垛草料
      p.push(...house(50, 36, 17, 17, 0x9a6b42, THATCH), box(12, 13, 1, TIMBER, 0, 6.5, 18.6), box(52, 2, 38, STONE_D, 0, 1, 0),
        xf(cyl(7, 8, 9, 0xcdb060, 0, 0, 0, 8), { t: [22, 4.5, -22] }), cone(8, 6, 0xcdb060, 22, 12, -22, 8),
        xf(cyl(6, 7, 8, 0xc4a658, 0, 0, 0, 8), { t: [-24, 4, 22] }), cone(7, 5, 0xc4a658, -24, 10.5, 22, 8));
      break;
    case 'lumbercamp': {
      // 伐木棚：敞开的料棚，棚下码着原木，棚外一架锯木架
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.push(cyl(1.6, 1.8, sz > 0 ? 15 : 21, TIMBER, sx * 22, (sz > 0 ? 15 : 21) / 2, sz * 14, 5));
      p.push(xf(box(52, 1.6, 36, 0x7a5a36), { rx: 0.2, t: [0, 19, 0] }));
      for (let i = 0; i < 4; i++) p.push(xf(cyl(3, 3, 38, 0x9a7a4a, 0, 0, 0, 7), { rz: Math.PI / 2, t: [-2, 3, -9 + i * 6.2] }));
      for (let i = 0; i < 3; i++) p.push(xf(cyl(3, 3, 38, 0xa9865a, 0, 0, 0, 7), { rz: Math.PI / 2, t: [-2, 8.4, -6 + i * 6.2] }));
      p.push(cyl(4.5, 5, 5, 0x6e5136, 26, 2.5, 24, 7), xf(box(1, 12, 0.8, 0xaab0b8), { rz: 0.5, t: [27, 9, 24] }),
        xf(cyl(2.6, 2.6, 22, 0x9a7a4a, 0, 0, 0, 7), { rz: Math.PI / 2, t: [-18, 8, 26] }), box(1.4, 8, 6, TIMBER, -26, 4, 26), box(1.4, 8, 6, TIMBER, -10, 4, 26));
      break;
    }
    case 'quarry': {
      // 采石棚：石砌工棚，旁边一架吊杆，地上码着切好的石料
      p.push(box(34, 15, 28, STONE, -10, 7.5, -10), gable(34, 28, 9, 0x5f6468, 15, 2).translate(-10, 0, -10), box(8, 10, 1, TIMBER, -10, 5, 4.4));
      const blocks: [number, number, number, number][] = [[18, 4, 14, 0], [18, 12, 14, 0.2], [10, 4, 24, 0.5], [24, 4, 24, 0.1], [17, 11.5, 24, -0.2], [-22, 4, 22, 0.3]];
      for (const [x, y, z, r] of blocks) p.push(xf(box(12, 8, 9, STONE_L), { ry: r, t: [x, y, z] }));
      p.push(xf(box(2, 34, 2, TIMBER), { rz: -0.5, t: [14, 16, -18] }), cyl(1.4, 1.8, 22, TIMBER, 4, 11, -18, 5), box(0.5, 16, 0.5, 0xc8b48a, 22, 22, -18), box(6, 5, 6, STONE_L, 22, 12, -18));
      break;
    }
    case 'goldmine': {
      // 矿洞：山石堆里开出的洞口，木架支护，洞前一辆装着矿石的小车
      const rock = (r: number, x: number, y: number, z: number, c: number): G => {
        const g = new THREE.DodecahedronGeometry(r, 0);
        g.deleteAttribute('uv');
        const arr = new Float32Array(g.getAttribute('position').count * 3);
        const col = new THREE.Color(c);
        for (let i = 0; i < arr.length; i += 3) col.clone().multiplyScalar(0.86 + ((i / 3) % 5) * 0.06).toArray(arr, i);
        g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
        return g.scale(1, 0.8, 1).translate(x, y, z);
      };
      p.push(rock(24, -4, 13, -8, 0x8a8780), rock(16, 16, 9, -12, 0x7c7972), rock(14, -22, 8, 2, 0x9a968c),
        box(15, 17, 6, 0x1c1a18, 0, 8.5, 11), box(2.4, 19, 3, TIMBER, -8.5, 9.5, 14), box(2.4, 19, 3, TIMBER, 8.5, 9.5, 14), box(22, 2.6, 3.4, TIMBER, 0, 19, 14),
        box(13, 5, 9, WOOD, 20, 6, 24), box(11, 3, 7, 0xe2b93a, 20, 9.5, 24), cyl(2.6, 2.6, 1.4, TIMBER, 15, 2.6, 29, 8).rotateX(0), cyl(2.6, 2.6, 1.4, TIMBER, 25, 2.6, 29, 8),
        xf(box(5, 4, 4, 0xe2b93a), { ry: 0.5, t: [-18, 2, 24] }), xf(box(4, 3, 4, 0xd4a82e), { ry: 0.2, t: [-12, 1.5, 27] }));
      break;
    }
    case 'outpost':
      // 行营：一顶大帐，帐前篝火与辎重，四角插着木桩
      p.push(cone(24, 26, CANVAS, 0, 13, -4, 10), cyl(24.4, 24.4, 3, 0xb0483a, 0, 1.5, -4, 10), cyl(0.9, 0.9, 7, TIMBER, 0, 28, -4, 4), box(9, 13, 1, 0x4a4036, 0, 6.5, 17.6),
        box(8, 6, 8, WOOD, 22, 3, 22), box(6, 5, 6, 0x7a5a36, 23, 8.5, 21), xf(cyl(4, 4, 8, 0x8a6a42, 0, 0, 0, 8), { rz: Math.PI / 2, t: [-22, 4, 23] }),
        cone(3, 4, 0x3a2c22, 0, 2, 27, 6), cone(1.8, 5, 0xe8842a, 0, 4.5, 27, 5));
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.push(cyl(1.6, 1.9, 13, WOOD, sx * 29, 6.5, sz * 29, 5), cone(1.6, 3.5, 0xa98a5a, sx * 29, 14.7, sz * 29, 5));
      break;
    case 'keep': return keep(style);
    case 'keep_town':
      p.push(box(80, 16, 56, STONE_L, 0, 8, 0), box(82, 14, 58, PLASTER, 0, 23, 0), gable(82, 58, 22, TILE_RED, 30, 4), box(84, 1.6, 60, TIMBER, 0, 16, 0),
        box(18, 44, 18, STONE, -26, 22, -14), hip(18, 18, 14, TILE_RED, 44, 2), box(10, 13, 2, TIMBER, 8, 6.5, 28.5));
      for (let i = -3; i <= 3; i++) p.push(box(1.5, 14, 0.8, TIMBER, i * 12, 23, 29.2));
      break;
    case 'house': {
      const roofs = [TILE_RED, THATCH, 0x8f4a36, 0x9a8a52], walls = [PLASTER, 0xcfc2a4, 0xe2d8c2, 0xc9bb9a];
      const g = join(...house(46, 34, 15, 13, walls[variant % 4], roofs[variant % 4]), box(5, 9, 5, STONE_D, -12, 24, -6));
      return variant & 2 ? g.rotateY(Math.PI / 2) : g;
    }
    case 'barracks':
      p.push(...house(84, 46, 16, 14, 0xcfc4a8, TILE_RED), box(86, 3, 48, STONE_D, 0, 1.5, 0));
      for (let i = -3; i <= 3; i++) p.push(box(4, 4, 0.8, 0x3a3630, i * 11, 10, 23.3));
      break;
    case 'tent': {
      const cv = [CANVAS, 0xcfc4a2, 0xe0d8c0, 0xc4b894][variant % 4];
      p.push(cone(21, 23, cv, 0, 11.5, 0, 8), cyl(0.8, 0.8, 5, TIMBER, 0, 25, 0, 4), box(7, 11, 1, 0x4a4036, 0, 5.5, 18.6).rotateY((variant % 4) * 0.8));
      break;
    }
    case 'cmdtent':
      p.push(box(76, 13, 44, CANVAS, 0, 6.5, 0), hip(76, 44, 15, 0xe6dcc0, 13, 3), box(80, 2.5, 48, 0xb0483a, 0, 12.5, 0), box(12, 11, 1, 0x4a4036, 0, 5.5, 22.2),
        cyl(1, 1, 8, TIMBER, 0, 31, 0, 4));
      break;
    default:
      p.push(box(40, 16, 40, PLASTER, 0, 8, 0));
  }
  return join(...p);
}

/** 废墟：按占地大小撒一堆碎块 */
export function rubbleGeo(w: number, h: number, wood: boolean): G {
  const p: G[] = [];
  const n = 5 + w * h * 3;
  let s = w * 7 + h * 13 + (wood ? 3 : 0);
  const rnd = (): number => {
    s = (s * 16807 + 11) % 2147483647;
    return (s & 0xffff) / 0xffff;
  };
  for (let i = 0; i < n; i++) {
    const sz = 3 + rnd() * 7;
    const c = wood ? [0x5a4028, 0x3a2c22, 0x6e5136][i % 3] : [STONE, STONE_D, 0x6a665e][i % 3];
    const g = wood ? box(sz * 2.2, 1.6, 2, c) : box(sz, sz * 0.6, sz * 0.8, c);
    p.push(xf(g, { ry: rnd() * 6.28, rz: (rnd() - 0.5) * 0.6, t: [(rnd() - 0.5) * w * TILE * 0.85, 1 + rnd() * 2.5, (rnd() - 0.5) * h * TILE * 0.85] }));
  }
  p.push(box(w * TILE * 0.8, 0.6, h * TILE * 0.8, 0x4a4640, 0, 0.3, 0));
  return join(...p);
}

/**
 * 这种建筑在某一级时的外观档位 1–3（同一档共用一份模型）：房屋类升级没有变化，永远是 1；
 * 其余 2 级起加固，其中炮楼、主堡、哨塔、中军帐 3 级再换上火炮或连弩。
 */
export function lookLevel(key: string, lv: number): number {
  if (key === 'house' || key === 'tent') return 1;
  return Math.min(lv, BUILDINGS[key]?.tier3 ? 3 : 2);
}

/** 旗杆顶端相对占地中心地面的高度；0 表示不挂旗 */
export function flagHeight(key: string, style: string, lv = 1): number {
  if (lv >= 2 && (key === 'tower' || key === 'gate_h' || key === 'gate_v')) return key === 'tower' ? 104 : 96;
  switch (key) {
    case 'keep': return style === 'japan' ? 112 : style === 'china' ? 88 : style === 'rome' ? 70 : 92;
    case 'tower': return 66;
    case 'gate_h': case 'gate_v': return 80;
    case 'watchtower': return 48;
    case 'keep_town': return 60;
    case 'cmdtent': return 36;
    case 'barracks': return 32;
    case 'arrowtower': return 62;
    case 'farmstead': return 44;
    case 'lumbercamp': return 32;
    case 'quarry': return 36;
    case 'goldmine': return 40;
    case 'outpost': return 44;
    default: return 0;
  }
}

/** 树与山石（kind 与地图装饰物的编号一致：0–2 阔叶，3–4 针叶，5–7 山石） */
export function propGeo(kind: number): G {
  if (kind < 3) {
    const leaf = [0x4f7f38, 0x5d8a34, 0x447438][kind], leaf2 = [0x5f9040, 0x6c9a3c, 0x528442][kind];
    const blob = (r: number, x: number, y: number, z: number, c: number): G => {
      const g = new THREE.IcosahedronGeometry(r, 0);
      g.deleteAttribute('uv');
      const col = new THREE.Color(c);
      const arr = new Float32Array(g.getAttribute('position').count * 3);
      for (let i = 0; i < arr.length; i += 3) col.toArray(arr, i);
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      return g.scale(1, 0.85, 1).translate(x, y, z);
    };
    return join(cyl(1.6, 2.6, 18, 0x5a4530, 0, 9, 0, 5), blob(11, 0, 24, 0, leaf), blob(8, 7, 20, 3, leaf2), blob(8, -6, 21, -4, leaf), blob(7, -2, 30, 4, leaf2));
  }
  if (kind < 5) {
    const c = kind === 3 ? 0x2f5a3a : 0x386440;
    return join(cyl(1.3, 2, 10, 0x4e3c2a, 0, 5, 0, 5), cone(10, 14, c, 0, 14, 0, 6), cone(8, 13, c, 0, 22, 0, 6), cone(5.5, 12, 0x447048, 0, 30, 0, 6));
  }
  const g = new THREE.DodecahedronGeometry(1, 0);
  g.deleteAttribute('uv');
  const pos = g.getAttribute('position');
  const cols = [0x8a8780, 0x9a968c, 0x7c7972];
  const arr = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) new THREE.Color(cols[kind - 5]).multiplyScalar(0.85 + ((i * 7) % 5) * 0.06).toArray(arr, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  const sc: [number, number, number][] = [[13, 9, 11], [10, 13, 9], [15, 7, 12]];
  g.scale(...sc[kind - 5]).rotateY(kind * 1.3).translate(0, sc[kind - 5][1] * 0.45, 0);
  g.computeVertexNormals();
  return join(g, xf(box(8, 5, 7, cols[(kind - 4) % 3]), { ry: 0.6, rz: 0.2, t: [10, 2, 5] }));
}

/** 一座完整的浮桥，桥面沿本地 X 轴延伸，浮筒横置于桥面下方。 */
export function bridgeGeo(length: number): G {
  const width = BRIDGE_WIDTH * TILE;
  const parts: G[] = [];
  const planks = Math.ceil(length / 6);
  const plankWidth = length / planks;
  for (let i = 0; i < planks; i++) {
    const x = (i + 0.5) * plankWidth - length / 2;
    parts.push(box(plankWidth - 0.18, 1.8, width, i % 3 === 0 ? 0xa48258 : 0x97764e, x, BRIDGE_DECK_Y - 0.9));
  }
  for (const z of [-width / 2 + 2, width / 2 - 2]) {
    parts.push(box(length, 2.6, 2.6, TIMBER, 0, BRIDGE_DECK_Y - 2.2, z));
  }
  const floats = Math.ceil(length / (TILE * 1.35));
  for (let i = 0; i < floats; i++) {
    const x = ((i + 0.5) / floats - 0.5) * length;
    parts.push(xf(ball(1, 0x634831, 0, 0, 0, 10), { s: [9, 4, width / 2 + 7], t: [x, -3.6, 0] }));
  }
  return join(...parts);
}
