/** 代码建模的士兵：真人比例的骨架与肢体，盔甲、头盔、盾牌、武器按兵种拼装，动作由程序生成 */
import * as THREE from 'three';
import { ball, box, cone, cyl, join, tube, xf } from './prims';
import { RigBuilder } from './rig';

export type Weapon = 'sword' | 'katana' | 'spear' | 'halberd' | 'naginata' | 'lance' | 'javelin' | 'bow' | 'longbow'
  | 'crossbow' | 'gun';
export type Helm = 'none' | 'tassel' | 'jingasa' | 'kabuto' | 'galea' | 'crest' | 'cone' | 'tiara' | 'cowl' | 'futou'
  | 'straw' | 'scalecap';
export type Armor = 'none' | 'lamellar' | 'bands' | 'mail' | 'scale' | 'do';
export type Shield = 'round' | 'scutum' | 'oval' | 'wicker' | 'small';

export interface HumanLook {
  weapon: Weapon;
  /** 上衣颜色，缺省为队伍色 */
  tunic?: number;
  /** 裤/腿的颜色；'skin' 表示光腿 */
  legs?: number | 'skin';
  armor?: Armor;
  armorColor?: number;
  /** 下摆（裙甲 / 长袍）长度，0 表示没有 */
  skirt?: number;
  skirtColor?: number;
  pauldron?: number;
  helm?: Helm;
  helmColor?: number;
  plume?: number;
  shield?: Shield;
  shieldColor?: number;
  banner?: boolean;
  quiver?: boolean;
  cape?: boolean;
  size?: number;
}

const SKIN = 0xd2a27c, WOOD = 0x7a5a36, WOOD_D = 0x4e3a26, IRON = 0xaab0b8, BOOT = 0x3a2c22;
const POLE = new Set<Weapon>(['spear', 'halberd', 'naginata', 'lance', 'javelin']);
export const isRanged = (w: Weapon): boolean => w === 'bow' || w === 'longbow' || w === 'crossbow' || w === 'gun';

/** 武器：握持点在原点，沿 +Y 伸出（单位：米） */
function weaponGeo(w: Weapon): THREE.BufferGeometry {
  switch (w) {
    case 'sword': return join(box(0.012, 0.6, 0.05, 0xd5dae0, 0, 0.38, 0), box(0.03, 0.03, 0.16, 0xb08a3e, 0, 0.07, 0),
      tube(0.016, 0.016, 0.14, WOOD_D, 0, 0, 0, 5));
    case 'katana': return join(xf(box(0.01, 0.72, 0.032, 0xe0e4e8), { rx: -0.05, t: [0, 0.46, 0] }), tube(0.035, 0.035, 0.012, 0x2a2a2e, 0, 0.1, 0, 6),
      tube(0.015, 0.015, 0.22, 0x2e2428, 0, 0, 0, 5));
    case 'spear': return join(tube(0.014, 0.014, 2.3, WOOD, 0, 0.25, 0, 5), cone(0.03, 0.2, IRON, 0, 1.5, 0, 4));
    case 'lance': return join(tube(0.016, 0.018, 3.0, WOOD, 0, 0.5, 0, 5), cone(0.032, 0.24, IRON, 0, 2.12, 0, 4));
    case 'javelin': return join(tube(0.011, 0.011, 1.3, WOOD, 0, 0.15, 0, 5), cone(0.022, 0.2, IRON, 0, 0.9, 0, 4));
    case 'halberd': return join(tube(0.015, 0.015, 2.3, WOOD_D, 0, 0.25, 0, 5), cone(0.028, 0.26, IRON, 0, 1.53, 0, 4),
      box(0.012, 0.05, 0.2, IRON, 0, 1.36, 0.1), box(0.012, 0.2, 0.04, IRON, 0, 1.4, 0.2), tube(0.03, 0.03, 0.06, 0xc0392b, 0, 1.28, 0, 5));
    case 'naginata': return join(tube(0.015, 0.015, 1.7, WOOD_D, 0, 0.2, 0, 5), xf(box(0.01, 0.5, 0.05, 0xe0e4e8), { rx: -0.1, t: [0, 1.3, 0.02] }),
      tube(0.025, 0.025, 0.03, 0xb08a3e, 0, 1.05, 0, 5));
    case 'bow': return bowGeo(1.25, 0x6a4a2c);
    case 'longbow': return bowGeo(1.95, 0x3a2a22);
    case 'crossbow': return join(box(0.04, 0.7, 0.045, WOOD_D, 0, 0.18, 0), box(0.03, 0.03, 0.72, WOOD, 0, 0.5, 0),
      box(0.004, 0.004, 0.7, 0xe8e2d0, 0, 0.42, 0), box(0.05, 0.03, 0.1, IRON, 0, 0.1, 0));
    case 'gun': return join(tube(0.014, 0.016, 0.95, 0x3a3a40, 0, 0.45, 0, 5), box(0.04, 0.5, 0.05, WOOD_D, 0, 0.12, 0),
      xf(box(0.04, 0.22, 0.07, WOOD_D), { rx: 0.5, t: [0, -0.18, -0.05] }));
  }
}

/** 弓：弓背向前（+X）弯出，握持点在中点 */
function bowGeo(len: number, color: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const seg = 6, half = len / 2;
  for (let i = 0; i < seg; i++) {
    const a0 = -1 + (2 * i) / seg, a1 = -1 + (2 * (i + 1)) / seg;
    const y0 = a0 * half, y1 = a1 * half;
    const x0 = (1 - a0 * a0) * len * 0.16, x1 = (1 - a1 * a1) * len * 0.16;
    const l = Math.hypot(y1 - y0, x1 - x0);
    parts.push(xf(box(0.022, l, 0.03, color), { rz: -Math.atan2(x1 - x0, y1 - y0), t: [(x0 + x1) / 2, (y0 + y1) / 2, 0] }));
  }
  parts.push(box(0.004, len, 0.004, 0xe8e2d0, 0, 0, 0));
  return join(...parts);
}

function helmGeo(h: Helm, metal: number, plume: number, team: THREE.Color): THREE.BufferGeometry | null {
  // 原点在头顶中心（头是半径约 0.11 的椭球）
  const dome = (c: number, r = 0.125, sy = 0.85): THREE.BufferGeometry => paintDome(r, sy, c);
  switch (h) {
    case 'tassel': return join(dome(metal), box(0.1, 0.12, 0.26, metal, -0.07, -0.1, 0), cyl(0.008, 0.008, 0.1, metal, 0, 0.13, 0, 4), ball(0.035, plume, 0, 0.2, 0, 5));
    case 'jingasa': return join(cone(0.26, 0.11, metal, 0, 0.02, 0, 10), cyl(0.012, 0.012, 0.02, 0xc9a227, 0, 0.08, 0, 5));
    case 'straw': return join(cone(0.27, 0.13, 0xcdb37a, 0, 0.03, 0, 10));
    case 'kabuto': return join(dome(metal, 0.13, 0.9), xf(cyl(0.2, 0.26, 0.1, metal, 0, 0, 0, 8), { s: [1.1, 1, 1], t: [-0.06, -0.09, 0] }),
      xf(box(0.012, 0.2, 0.03, plume), { rx: 0.6, t: [0.11, 0.1, 0.07] }), xf(box(0.012, 0.2, 0.03, plume), { rx: -0.6, t: [0.11, 0.1, -0.07] }));
    case 'galea': return join(dome(metal), box(0.07, 0.11, 0.25, metal, -0.09, -0.09, 0), box(0.03, 0.12, 0.03, metal, 0.05, -0.11, 0.1), box(0.03, 0.12, 0.03, metal, 0.05, -0.11, -0.1));
    case 'crest': return join(dome(metal), box(0.07, 0.11, 0.25, metal, -0.09, -0.09, 0), box(0.03, 0.12, 0.03, metal, 0.05, -0.11, 0.1), box(0.03, 0.12, 0.03, metal, 0.05, -0.11, -0.1),
      box(0.26, 0.09, 0.035, plume, -0.01, 0.13, 0));
    case 'cone': return join(cone(0.125, 0.2, metal, 0, 0.05, 0, 8), box(0.07, 0.1, 0.24, metal, -0.08, -0.08, 0));
    case 'scalecap': return join(cone(0.125, 0.22, metal, 0, 0.06, 0, 8), xf(cyl(0.13, 0.17, 0.16, metal, 0, 0, 0, 8), { t: [-0.02, -0.12, 0] }), ball(0.03, plume, 0, 0.19, 0, 5));
    case 'tiara': return join(xf(ball(0.135, plume, 0, 0, 0, 7), { s: [1.05, 0.95, 1], t: [-0.015, -0.01, 0] }), box(0.05, 0.16, 0.24, plume, -0.1, -0.12, 0));
    case 'cowl': return join(xf(ball(0.15, 0xece6d6, 0, 0, 0, 7), { s: [1, 1, 1], t: [-0.02, -0.04, 0] }), xf(cyl(0.15, 0.2, 0.16, 0xece6d6, 0, 0, 0, 7), { t: [-0.02, -0.17, 0] }));
    case 'futou': return join(xf(ball(0.125, 0x26262c, 0, 0, 0, 6), { s: [1, 0.7, 1], t: [0, -0.01, 0] }), box(0.07, 0.07, 0.09, 0x26262c, -0.07, 0.06, 0),
      box(0.012, 0.02, 0.44, 0x26262c, -0.11, -0.02, 0));
    default: return team ? null : null;
  }
}

function paintDome(r: number, sy: number, c: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(r, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2 + 0.25);
  g.scale(1, sy, 1);
  g.translate(0, -r * sy * 0.82, 0);
  return ballFrom(g, c);
}
function ballFrom(g: THREE.BufferGeometry, c: number): THREE.BufferGeometry {
  const out = g.toNonIndexed();
  out.deleteAttribute('uv');
  const col = new THREE.Color(c);
  const n = out.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.toArray(arr, i * 3);
  out.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return out;
}

function shieldGeo(s: Shield, color: THREE.Color | number): THREE.BufferGeometry {
  // 盾面朝 +Z（左臂外侧），原点在握把处
  const c = color as number;
  switch (s) {
    case 'round': return join(xf(cyl(0.3, 0.3, 0.03, c, 0, 0, 0, 10), { rx: Math.PI / 2 }), xf(cyl(0.3, 0.3, 0.012, 0x6a5a40, 0, 0, 0, 10), { rx: Math.PI / 2, s: [1.05, 1.05, 1], t: [0, 0, -0.012] }),
      xf(ball(0.06, 0xc9a227, 0, 0, 0, 5), { s: [1, 1, 0.6], t: [0, 0, 0.03] }));
    case 'small': return join(xf(cyl(0.21, 0.21, 0.03, c, 0, 0, 0, 8), { rx: Math.PI / 2 }), xf(ball(0.05, IRON, 0, 0, 0, 5), { s: [1, 1, 0.6], t: [0, 0, 0.03] }));
    case 'oval': return join(xf(cyl(0.3, 0.3, 0.03, c, 0, 0, 0, 10), { rx: Math.PI / 2, s: [0.75, 1.45, 1] }), xf(ball(0.06, IRON, 0, 0, 0, 5), { s: [1, 1.6, 0.6], t: [0, 0, 0.03] }));
    case 'scutum': {
      const parts: THREE.BufferGeometry[] = [];
      for (let i = -2; i <= 2; i++) parts.push(xf(box(0.13, 1.0, 0.025, c), { ry: -i * 0.3, t: [i * 0.115, 0, -Math.abs(i) * Math.abs(i) * 0.018] }));
      parts.push(xf(ball(0.07, 0xc9a227, 0, 0, 0, 5), { s: [1, 1, 0.6], t: [0, 0, 0.03] }), box(0.03, 0.9, 0.012, 0xc9a227, 0, 0, 0.018));
      return join(...parts);
    }
    case 'wicker': return join(box(0.52, 1.25, 0.03, 0xb8894a, 0, 0, 0), box(0.54, 0.05, 0.04, 0x7a5a36, 0, 0.6, 0), box(0.54, 0.05, 0.04, 0x7a5a36, 0, -0.6, 0),
      box(0.54, 0.05, 0.04, 0x7a5a36, 0, 0, 0), box(0.3, 0.3, 0.035, c, 0, 0.3, 0.002));
  }
}

const sm = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** 周期关键帧（相位, 角度），相位 0 为该腿脚掌着地的瞬间 */
const THIGH: [number, number][] = [[0, 0.5], [0.15, 0.05], [0.36, -0.5], [0.55, 0.1], [0.78, 0.85], [1, 0.5]];
const KNEE: [number, number][] = [[0, -0.2], [0.13, -0.5], [0.36, -0.25], [0.56, -1.45], [0.72, -1.2], [0.92, -0.3], [1, -0.2]];
function key(keys: [number, number][], p: number): number {
  for (let i = 1; i < keys.length; i++) {
    if (p <= keys[i][0]) {
      const [p0, v0] = keys[i - 1], [p1, v1] = keys[i];
      const t = (p - p0) / (p1 - p0);
      return v0 + (v1 - v0) * (t * t * (3 - 2 * t));
    }
  }
  return keys[0][1];
}

export class Human {
  /** 整个人的根：原点在两脚之间的地面 */
  readonly body = new THREE.Group();
  private readonly hips = new THREE.Group();
  private readonly torso = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly arm = [new THREE.Group(), new THREE.Group()];
  private readonly fore = [new THREE.Group(), new THREE.Group()];
  private readonly grip = [new THREE.Group(), new THREE.Group()];
  private readonly leg = [new THREE.Group(), new THREE.Group()];
  private readonly shin = [new THREE.Group(), new THREE.Group()];
  private readonly pole: boolean;
  private readonly ranged: boolean;
  /** 武器拿在哪只手：0 右手，1 左手（弓） */
  private readonly wHand: number;

  constructor(rb: RigBuilder, parent: THREE.Object3D, private readonly L: HumanLook, team: THREE.Color, private readonly mounted = false) {
    const { body, hips, torso, head, arm, fore, grip, leg, shin } = this;
    parent.add(body);
    body.add(hips);
    hips.position.y = 0.94;
    hips.add(torso);
    torso.add(head);
    head.position.set(0, 0.6, 0);
    for (let s = 0; s < 2; s++) {
      const z = s === 0 ? -1 : 1; // 0 右侧（-Z），1 左侧（+Z）
      torso.add(arm[s]);
      arm[s].position.set(0, 0.5, z * 0.215);
      arm[s].add(fore[s]);
      fore[s].position.set(0, -0.29, 0);
      fore[s].add(grip[s]);
      grip[s].position.set(0, -0.27, 0);
      hips.add(leg[s]);
      leg[s].position.set(0, 0, z * 0.095);
      leg[s].add(shin[s]);
      shin[s].position.set(0, -0.46, 0);
    }
    this.pole = POLE.has(L.weapon);
    this.ranged = isRanged(L.weapon);
    this.wHand = L.weapon === 'bow' || L.weapon === 'longbow' ? 1 : 0;

    const tunic = L.tunic !== undefined ? new THREE.Color(L.tunic) : team.clone();
    const tunicD = tunic.clone().multiplyScalar(0.72);
    const legC = L.legs === 'skin' ? SKIN : L.legs ?? 0x4a4038;
    const armorC = L.armorColor ?? 0x6a6660;
    const armored = L.armor !== undefined && L.armor !== 'none';
    const chestC: THREE.Color | number = armored ? armorC : tunic;
    const sleeve: THREE.Color | number = L.armor === 'mail' || L.armor === 'scale' ? armorC : tunic;

    // 躯干
    const torsoParts = [
      xf(tube(0.17, 0.15, 0.24, chestC as number, 0, 0, 0, 8), { s: [0.72, 1, 1], t: [0, 0.14, 0] }),
      xf(cyl(0.21, 0.17, 0.3, chestC as number, 0, 0, 0, 8), { s: [0.66, 1, 1], t: [0, 0.4, 0] }),
      tube(0.05, 0.055, 0.08, SKIN, 0, 0.58, 0, 6),
    ];
    if (L.armor === 'bands') {
      for (let i = 0; i < 4; i++) torsoParts.push(xf(tube(0.215, 0.215, 0.055, 0xc6ccd4, 0, 0, 0, 8), { s: [0.68, 1, 1], t: [0, 0.12 + i * 0.075, 0] }));
    } else if (L.armor === 'lamellar' || L.armor === 'do' || L.armor === 'scale') {
      const trim = L.armor === 'do' ? tunic : new THREE.Color(armorC).multiplyScalar(0.7);
      for (let i = 0; i < 3; i++) torsoParts.push(xf(tube(0.2, 0.2, 0.012, trim as unknown as number, 0, 0, 0, 8), { s: [0.69, 1, 1], t: [0, 0.14 + i * 0.12, 0] }));
    }
    if (L.cape) torsoParts.push(xf(box(0.03, 0.75, 0.42, tunicD as unknown as number), { rz: 0.08, t: [-0.15, 0.18, 0] }));
    if (L.quiver) torsoParts.push(xf(join(cyl(0.05, 0.045, 0.5, 0x6a4a2c, 0, 0, 0, 6), cyl(0.04, 0.04, 0.08, 0xe8e2d0, 0, 0.28, 0, 5)), { rx: 0.45, t: [-0.15, 0.3, -0.03] }));
    if (L.banner) {
      torsoParts.push(tube(0.012, 0.012, 1.5, 0x2a2420, -0.16, 0.95, 0, 4), box(0.012, 0.75, 0.3, tunic as unknown as number, -0.16, 1.3, 0.16),
        box(0.014, 0.1, 0.3, 0xf0ece0, -0.16, 1.3, 0.16));
    }
    rb.addRigid(join(...torsoParts), torso);

    // 腰胯与下摆
    const hipParts = [xf(cyl(0.155, 0.15, 0.16, legC as number, 0, 0, 0, 8), { s: [0.75, 1, 1], t: [0, 0.0, 0] })];
    const skirt = L.skirt ?? 0.22;
    if (skirt > 0 && !mounted) {
      hipParts.push(xf(tube(0.165, 0.165 + skirt * 0.35, skirt, (L.skirtColor ?? tunicD) as number, 0, 0, 0, 8), { s: [0.8, 1, 1], t: [0, 0.06 - skirt / 2, 0] }));
    } else if (skirt > 0) {
      hipParts.push(xf(tube(0.165, 0.2, 0.14, (L.skirtColor ?? tunicD) as number, 0, 0, 0, 8), { s: [0.8, 1, 1], t: [0, 0.0, 0] }));
    }
    hipParts.push(xf(cyl(0.165, 0.165, 0.045, 0x3a2c22, 0, 0, 0, 8), { s: [0.78, 1, 1], t: [0, 0.1, 0] }));
    rb.addRigid(join(...hipParts), hips);

    // 头
    const headParts = [xf(ball(0.11, SKIN, 0, 0, 0, 6), { s: [0.95, 1.12, 0.9], t: [0.005, 0.13, 0] })];
    const helm = helmGeo(L.helm ?? 'none', L.helmColor ?? 0x8e939a, L.plume ?? 0xc0392b, team);
    if (helm) headParts.push(helm.translate(0, 0.255, 0));
    else headParts.push(xf(ball(0.112, 0x2a221c, 0, 0, 0, 6), { s: [1, 0.75, 0.95], t: [-0.02, 0.19, 0] }));
    rb.addRigid(join(...headParts), head);

    // 四肢
    for (let s = 0; s < 2; s++) {
      const up = [tube(0.055, 0.047, 0.3, sleeve as number, 0, -0.14, 0, 6)];
      if (L.pauldron !== undefined) up.push(xf(box(0.16, 0.2, 0.13, L.pauldron), { t: [0, -0.07, (s === 0 ? -1 : 1) * 0.03] }));
      else up.push(ball(0.065, chestC as number, 0, 0, 0, 5));
      rb.addRigid(join(...up), arm[s]);
      rb.addRigid(join(tube(0.044, 0.036, 0.26, armored && L.armor !== 'bands' ? 0x4a3a2c : SKIN, 0, -0.13, 0, 6), ball(0.042, SKIN, 0, -0.28, 0, 5)), fore[s]);
      rb.addRigid(join(tube(0.078, 0.06, 0.46, legC as number, 0, -0.23, 0, 6)), leg[s]);
      rb.addRigid(join(tube(0.056, 0.042, 0.4, L.legs === 'skin' ? SKIN : BOOT, 0, -0.2, 0, 6), box(0.2, 0.07, 0.085, BOOT, 0.045, -0.445, 0)), shin[s]);
    }
    rb.addRigid(weaponGeo(L.weapon), grip[this.wHand]);
    if (L.shield) {
      const sc = L.shieldColor !== undefined ? L.shieldColor : (team as unknown as number);
      // 盾挂在左前臂外侧
      rb.addRigid(shieldGeo(L.shield, sc).translate(0, -0.12, 0.07), fore[1]);
    }
    body.scale.setScalar(L.size ?? 1);
  }

  /** 设置一只手臂：a 上臂前摆角，f 肘弯角，w 武器相对竖直的倾角（负值指向前方），out 外展 */
  private setArm(s: number, a: number, f: number, w = 0, out = 0.08): void {
    this.arm[s].rotation.set((s === 0 ? 1 : -1) * out, 0, a);
    this.fore[s].rotation.z = f;
    this.grip[s].rotation.z = w - a - f - this.torso.rotation.z;
  }

  /** 跑步循环：每条腿按「着地 → 支撑 → 蹬离 → 折叠前摆 → 伸出」的关键帧运动 */
  private legs(k: number, amp: number): void {
    for (let s = 0; s < 2; s++) {
      const p = (k + s * 0.5) % 1;
      this.leg[s].rotation.set(0, 0, key(THIGH, p) * amp);
      this.shin[s].rotation.z = key(KNEE, p) * amp;
    }
    // 支撑中期身体最低，腾空时最高
    this.hips.position.y = 0.94 - 0.035 * amp + Math.cos((k - 0.4) * Math.PI * 4) * 0.03 * amp;
  }

  private seat(): void {
    for (let s = 0; s < 2; s++) {
      this.leg[s].rotation.set((s === 0 ? 1 : -1) * 0.6, 0, 0.5);
      this.shin[s].rotation.z = -0.75;
    }
    this.hips.position.y = 0.62;
  }

  /** 持械待命的手臂姿势 */
  private carry(sway: number): void {
    const L = this.L;
    if (L.weapon === 'bow' || L.weapon === 'longbow') {
      this.setArm(1, 0.35 + sway, 0.55, 0.12);
      this.setArm(0, 0.05 - sway, 0.25);
    } else if (L.weapon === 'crossbow' || L.weapon === 'gun') {
      this.setArm(0, 0.25, 1.15, -0.85);
      this.setArm(1, 0.75, 0.75);
    } else if (this.pole) {
      this.setArm(0, 0.2 + sway * 0.5, 0.95, this.mounted ? -0.25 : 0.04);
      this.setArm(1, L.shield ? 0.3 : 0.05 - sway, L.shield ? 1.2 : 0.25);
    } else {
      this.setArm(0, 0.12 + sway, 0.55, -0.5);
      this.setArm(1, L.shield ? 0.3 : 0.05 - sway, L.shield ? 1.2 : 0.25);
    }
  }

  pose(action: 'idle' | 'move' | 'attack' | 'die', k: number): void {
    const { body, torso, head, L } = this;
    body.rotation.set(0, 0, 0);
    body.position.set(0, 0, 0);
    torso.rotation.set(0, 0, 0);
    head.rotation.set(0, 0, 0);
    if (this.mounted) this.seat();
    else this.legs(0, 0);
    const a = k * Math.PI * 2;
    if (action === 'idle') {
      torso.rotation.z = Math.sin(a) * 0.015;
      head.rotation.y = Math.sin(a) * 0.12;
      this.carry(Math.sin(a) * 0.02);
    } else if (action === 'move') {
      if (!this.mounted) this.legs(k, 1);
      torso.rotation.z = this.mounted ? -0.1 : -0.2;
      // 上身随对侧腿前摆而扭转，空着的手臂屈肘摆动
      const sw = this.mounted ? 0 : Math.sin(a + 1.2);
      torso.rotation.y = sw * 0.14;
      head.rotation.y = -sw * 0.1;
      this.carry(sw * 0.12);
      if (!this.mounted && !L.shield && !this.ranged) this.setArm(1, -sw * 0.75 + 0.1, 1.35);
    } else if (action === 'attack') {
      this.attack(k);
    } else {
      // 向后倒地
      const f = sm(0, 0.85, k);
      body.rotation.z = f * 1.5;
      body.position.y = f * 0.1;
      torso.rotation.z = -f * 0.15;
      head.rotation.z = f * 0.3;
      this.setArm(0, lerp(0.2, -0.9, f), 0.4, -1.2 * f, 0.4 * f);
      this.setArm(1, lerp(0.2, -0.7, f), 0.3, 0, 0.5 * f);
      if (!this.mounted) {
        this.leg[0].rotation.z = f * 0.35;
        this.shin[0].rotation.z = -f * 0.6;
        this.leg[1].rotation.z = -f * 0.1;
      }
    }
  }

  private attack(k: number): void {
    const { torso, L } = this;
    const w = L.weapon;
    // 出手很快，随后较慢地收势
    const hit = sm(0, 0.3, k), back = sm(0.45, 1, k);
    const p = hit * (1 - back);
    if (w === 'bow' || w === 'longbow') {
      torso.rotation.y = 0.9;
      this.head.rotation.y = -0.8;
      // 左手持弓前伸，右手拉弦后放
      this.arm[1].rotation.set(-0.15, 0, 1.45);
      this.fore[1].rotation.z = 0.08;
      this.grip[1].rotation.set(0, -0.9, -1.53);
      const draw = 1 - sm(0, 0.18, k) + sm(0.55, 1, k);
      this.setArm(0, 1.35, lerp(0.4, 2.1, draw), 0, 0.5);
    } else if (w === 'crossbow' || w === 'gun') {
      const kick = Math.sin(Math.min(1, k * 2.2) * Math.PI) * 0.12;
      torso.rotation.z = kick;
      this.setArm(0, 1.05, 0.75 + kick, -Math.PI / 2 - 0.02 + kick * 0.6);
      this.setArm(1, 1.25, 0.35);
    } else if (w === 'javelin') {
      torso.rotation.y = lerp(0.5, -0.4, p);
      torso.rotation.z = -0.15 * p;
      this.setArm(0, lerp(2.6, 1.3, p), lerp(1.4, 0.2, p), lerp(-1.2, -1.75, p));
      this.setArm(1, 0.6, 0.8);
    } else if (this.pole) {
      torso.rotation.z = -0.22 * p;
      torso.rotation.y = lerp(0.35, -0.25, p);
      this.setArm(0, lerp(-0.45, 1.25, p), lerp(1.75, 0.2, p), -Math.PI / 2 + (this.mounted ? -0.12 : 0.02));
      if (L.shield) this.setArm(1, 0.55, 1.25);
      else this.setArm(1, lerp(0.5, 1.3, p), lerp(1.3, 0.5, p));
      if (!this.mounted) {
        this.leg[1].rotation.z = 0.35 * p;
        this.shin[1].rotation.z = -0.3 * p;
        this.leg[0].rotation.z = -0.25 * p;
      }
    } else {
      // 劈砍：举过头顶后斜劈而下
      torso.rotation.y = lerp(0.45, -0.5, p);
      torso.rotation.z = -0.2 * p;
      this.setArm(0, lerp(2.7, 0.75, p), lerp(0.9, 0.15, p), lerp(0.75, -1.75, p), 0.25);
      if (L.shield) this.setArm(1, 0.6, 1.3);
      else if (w === 'katana') this.setArm(1, lerp(2.3, 0.9, p), lerp(1.3, 0.5, p), 0, -0.25);
      else this.setArm(1, 0.1, 0.5);
      if (!this.mounted) {
        this.leg[1].rotation.z = 0.3 * p;
        this.shin[1].rotation.z = -0.25 * p;
        this.leg[0].rotation.z = -0.2 * p;
      }
    }
  }
}
