/** 代码建模的建筑：原点在占地中心的地面，+X 向东、+Z 向南，单位为世界像素（每格 32） */
import * as THREE from 'three';
import { TILE } from '../sim/defs';
import { Col, ball, box, cone, cyl, join, xf } from './prims';

const STONE = 0x9c978c, STONE_D = 0x7d786e, STONE_L = 0xb4afa3, PLASTER = 0xd9cfb8, TIMBER = 0x5a4028, WOOD = 0x8a6a42;
const THATCH = 0xb59a58, TILE_RED = 0xa9523a, TILE_GREY = 0x4c5356, CANVAS = 0xd8cfb4, MUD = 0xc7a877;

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

/** 城墙 / 木栅：按四邻连接情况生成（位掩码：1 北，2 东，4 南，8 西） */
export function wallGeo(mask: number, wood: boolean): G {
  const parts: G[] = [];
  const half = TILE / 2;
  const dirs: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  if (wood) {
    const log = (x: number, z: number, h: number): void => {
      parts.push(cyl(2.6, 2.9, h, WOOD, x, h / 2, z, 5), cone(2.6, 4, 0xa98a5a, x, h + 2, z, 5));
    };
    log(0, 0, 19);
    dirs.forEach(([dx, dz], k) => {
      if (!(mask & (1 << k))) return;
      log(dx * 6, dz * 6, 17);
      log(dx * 11.5, dz * 11.5, 18.5);
      parts.push(box(dx ? half : 1.5, 2, dz ? half : 1.5, TIMBER, dx * half / 2, 11, dz * half / 2));
    });
    return join(...parts);
  }
  const H = 26, T = 15;
  const straight = mask === 5 || mask === 10;
  if (!straight) {
    parts.push(box(T + 3, H + 4, T + 3, STONE_D, 0, (H + 4) / 2, 0));
    parts.push(...battlement(T + 3, T + 3, H + 4, STONE_L, 2, 4));
  }
  dirs.forEach(([dx, dz], k) => {
    if (!(mask & (1 << k))) return;
    const len = straight ? half : half - (T + 3) / 2;
    const c = straight ? half / 2 : (T + 3) / 2 + len / 2;
    parts.push(box(dx ? len : T, H, dz ? len : T, STONE, dx * c, H / 2, dz * c));
    // 外沿垛口
    for (const s of [-1, 1]) {
      parts.push(box(dx ? 6 : 3, 4.5, dz ? 6 : 3, STONE_L, dx * c + (dz ? s * (T / 2 - 1.5) : 0), H + 2.25, dz * c + (dx ? s * (T / 2 - 1.5) : 0)));
    }
  });
  return join(...parts);
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

/** @returns 建筑几何体；style 仅主堡使用，variant 用于民居等的外观变化 */
export function buildingGeo(key: string, style: string, variant: number): G {
  const p: G[] = [];
  switch (key) {
    case 'gate_h': case 'gate_v': case 'wgate_h': case 'wgate_v': {
      const wood = key.startsWith('w');
      if (wood) {
        p.push(cyl(3.2, 3.6, 26, WOOD, -27, 13, 0, 6), cyl(3.2, 3.6, 26, WOOD, 27, 13, 0, 6), box(60, 3, 4, TIMBER, 0, 24, 0), box(50, 17, 2, 0x7a5a36, 0, 9, 0),
          box(50, 1.5, 2.6, TIMBER, 0, 14, 0), box(50, 1.5, 2.6, TIMBER, 0, 5, 0));
      } else {
        p.push(box(15, 36, 22, STONE_D, -24.5, 18, 0), box(15, 36, 22, STONE_D, 24.5, 18, 0), box(64, 12, 20, STONE, 0, 30, 0), ...battlement(64, 22, 36, STONE_L, 6, 4.5),
          box(34, 23, 3, 0x5a4028, 0, 11.5, 0), box(34, 2, 3.6, 0x3a3a40, 0, 16, 0), box(34, 2, 3.6, 0x3a3a40, 0, 6, 0), box(1.2, 23, 3.6, 0x3a3a40, 0, 11.5, 0));
      }
      const g = join(...p);
      return key.endsWith('_v') ? g.rotateY(Math.PI / 2) : g;
    }
    case 'tower':
      p.push(xf(cyl(Math.SQRT1_2 * 0.9, Math.SQRT1_2, 1, STONE, 0, 0.5, 0, 4), { ry: Math.PI / 4, s: [52, 50, 52] }), box(54, 5, 54, STONE_D, 0, 52, 0), ...battlement(54, 54, 54.5, STONE_L, 4),
        box(3, 7, 1, 0x2a2a2e, 0, 34, 24.4), box(1, 7, 3, 0x2a2a2e, 24.4, 34, 0), box(3, 7, 1, 0x2a2a2e, 0, 34, -24.4), box(1, 7, 3, 0x2a2a2e, -24.4, 34, 0));
      break;
    case 'watchtower':
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.push(xf(cyl(1.5, 1.8, 34, TIMBER, 0, 17, 0, 5), { t: [sx * 9, 0, sz * 9] }));
      p.push(box(24, 2, 24, WOOD, 0, 26, 0), box(24, 6, 1.2, WOOD, 0, 30, 12), box(24, 6, 1.2, WOOD, 0, 30, -12), box(1.2, 6, 24, WOOD, 12, 30, 0), box(1.2, 6, 24, WOOD, -12, 30, 0),
        hip(24, 24, 9, THATCH, 38, 3), box(20, 1.2, 1.2, TIMBER, 0, 13, 9), box(20, 1.2, 1.2, TIMBER, 0, 13, -9));
      break;
    case 'keep': return keep(style);
    case 'citadel':
      p.push(box(92, 46, 92, STONE, 0, 23, 0), ...battlement(92, 92, 46, STONE_L, 7));
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.push(cyl(14, 15, 58, STONE_D, sx * 44, 29, sz * 44, 8), cone(16, 16, TILE_RED, sx * 44, 66, sz * 44, 8));
      p.push(box(52, 18, 52, STONE_D, 0, 55, 0), hip(52, 52, 18, TILE_RED, 64, 3), box(14, 20, 4, TIMBER, 0, 10, 46.5));
      break;
    case 'hall':
      p.push(box(80, 16, 56, STONE_L, 0, 8, 0), box(82, 14, 58, PLASTER, 0, 23, 0), gable(82, 58, 22, TILE_RED, 30, 4), box(84, 1.6, 60, TIMBER, 0, 16, 0),
        box(18, 44, 18, STONE, -26, 22, -14), hip(18, 18, 14, TILE_RED, 44, 2), box(10, 13, 2, TIMBER, 8, 6.5, 28.5));
      for (let i = -3; i <= 3; i++) p.push(box(1.5, 14, 0.8, TIMBER, i * 12, 23, 29.2));
      break;
    case 'house': {
      const roofs = [TILE_RED, THATCH, 0x8f4a36, 0x9a8a52], walls = [PLASTER, 0xcfc2a4, 0xe2d8c2, 0xc9bb9a];
      const g = join(...house(46, 34, 15, 13, walls[variant % 4], roofs[variant % 4]), box(5, 9, 5, STONE_D, -12, 24, -6));
      return variant & 2 ? g.rotateY(Math.PI / 2) : g;
    }
    case 'farmhouse': {
      const g = join(...house(44, 32, 12, 15, 0xcdbf9e, THATCH), box(18, 9, 16, WOOD, 28, 4.5, 4), gable(18, 16, 6, THATCH, 9, 1).translate(28, 0, 4));
      return variant & 1 ? g.rotateY(Math.PI / 2) : g;
    }
    case 'barracks':
      p.push(...house(84, 46, 16, 14, 0xcfc4a8, TILE_RED), box(86, 3, 48, STONE_D, 0, 1.5, 0));
      for (let i = -3; i <= 3; i++) p.push(box(4, 4, 0.8, 0x3a3630, i * 11, 10, 23.3));
      break;
    case 'workshop':
      p.push(...house(60, 44, 16, 13, 0xb9ab8e, 0x7a6a52, false).map(g => g.translate(-10, 0, 0)), box(8, 34, 8, STONE_D, -32, 17, -12), box(10, 3, 10, STONE, -32, 35, -12));
      for (const sz of [-1, 1]) p.push(cyl(1.3, 1.3, 13, TIMBER, 40, 6.5, sz * 16, 5));
      p.push(xf(box(26, 1.4, 40, WOOD), { rz: -0.2, t: [32, 15, 0] }), box(10, 5, 6, 0x3a3a40, 30, 2.5, 0), cyl(5, 5, 2, WOOD, 34, 6, 12, 8));
      break;
    case 'stable':
      p.push(box(88, 13, 3, WOOD, 0, 6.5, -24), box(3, 13, 50, WOOD, -43, 6.5, 0), box(3, 13, 50, WOOD, 43, 6.5, 0));
      for (let i = -2; i <= 2; i++) p.push(cyl(1.5, 1.5, 15, TIMBER, i * 21, 7.5, 24, 5), box(1.5, 8, 30, WOOD, i * 21, 4, -8));
      p.push(xf(box(94, 1.6, 58, THATCH), { rx: 0.14, t: [0, 17, 0] }), box(60, 1.4, 1.4, TIMBER, 0, 6, 24));
      break;
    case 'granary':
      p.push(cyl(21, 22, 22, 0xc9b890, 0, 13, 0, 10), cone(26, 17, THATCH, 0, 32.5, 0, 10), cyl(23, 23, 2, STONE_D, 0, 1, 0, 10), box(7, 11, 2, TIMBER, 0, 8, 21.5));
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

/** 旗杆顶端相对占地中心地面的高度；0 表示不挂旗 */
export function flagHeight(key: string, style: string): number {
  switch (key) {
    case 'keep': return style === 'japan' ? 112 : style === 'china' ? 88 : style === 'rome' ? 70 : 92;
    case 'citadel': return 84;
    case 'tower': return 60;
    case 'watchtower': return 48;
    case 'hall': return 60;
    case 'cmdtent': return 36;
    case 'granary': return 42;
    case 'stable': return 24;
    case 'workshop': return 38;
    case 'barracks': return 32;
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

/** 桥面：一格大小的木板桥段 */
export function bridgeGeo(): G {
  return join(box(TILE + 3, 2, TILE + 3, 0x8a7350, 0, 0, 0), box(TILE + 3, 0.4, 1, 0x6e5a3c, 0, 1.1, -8), box(TILE + 3, 0.4, 1, 0x6e5a3c, 0, 1.1, 8),
    cyl(2, 2, 18, TIMBER, -10, -9, -TILE / 2 + 2, 5), cyl(2, 2, 18, TIMBER, 10, -9, TILE / 2 - 2, 5));
}
