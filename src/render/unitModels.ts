/** 各兵种的立体模型：代码建模的士兵与器械、战象，加上素材包里的马 */
import * as THREE from 'three';
import { asset } from './assets';
import { Human, HumanLook } from './human';
import { ball, box, cone, cyl, join, xf } from './prims';
import { Puppet, RigBuilder, UnitModel, skinnedBox } from './rig';

/** 每米对应的世界像素：士兵身高约 1.75 米 */
const M = 10;

interface Look {
  kind: 'foot' | 'horse' | 'elephant' | 'onager' | 'trebuchet' | 'ballista' | 'rocket' | 'cannon';
  human?: HumanLook;
  coat?: number;
  /** 马甲颜色 */
  barding?: number;
  size?: number;
}

const STEEL = 0xaab0b8, DARK = 0x34323a, BRONZE = 0xb8923e, LACQUER = 0x3a2226, LEATHER = 0x6e5136;
const RED = 0xc0392b, GOLD = 0xd9b44a, CREAM = 0xe8dcc0;

export const LOOKS: Record<string, Look> = {
  // 中国：札甲、红缨盔、长戟强弩
  ji: { kind: 'foot', human: { weapon: 'halberd', armor: 'lamellar', armorColor: 0x5c554c, helm: 'tassel', helmColor: 0x6e675e, plume: RED, skirt: 0.3 } },
  dao: { kind: 'foot', human: { weapon: 'sword', shield: 'round', shieldColor: 0x7a2a22, armor: 'lamellar', armorColor: 0x8a7650, helm: 'tassel', helmColor: 0x8a7650, plume: RED, skirt: 0.3 } },
  nu: { kind: 'foot', human: { weapon: 'crossbow', helm: 'futou', skirt: 0.5, quiver: true, legs: 0x3c3a36 } },
  liannu: { kind: 'foot', human: { weapon: 'crossbow', armor: 'lamellar', armorColor: 0x3c3a40, helm: 'futou', skirt: 0.35, quiver: true } },
  tieqi: { kind: 'horse', coat: 0x3d2a1e, barding: 0x7a2a24,
    human: { weapon: 'lance', armor: 'lamellar', armorColor: 0x57514e, helm: 'tassel', helmColor: 0x57514e, plume: RED, pauldron: 0x57514e } },
  huojian: { kind: 'rocket' },
  pili: { kind: 'trebuchet' },
  // 日本：阵笠、背旗、太刀铁炮
  yari: { kind: 'foot', human: { weapon: 'spear', armor: 'do', armorColor: DARK, helm: 'jingasa', helmColor: 0x2a2a30, banner: true, skirt: 0.25, legs: 0x2e2c34 } },
  samurai: { kind: 'foot', human: { weapon: 'katana', armor: 'do', armorColor: LACQUER, helm: 'kabuto', helmColor: 0x2a2226, plume: GOLD, pauldron: LACQUER, banner: true, skirt: 0.32, skirtColor: LACQUER, size: 1.05 } },
  yumi: { kind: 'foot', human: { weapon: 'longbow', helm: 'jingasa', helmColor: 0x2a2a30, quiver: true, skirt: 0.25, legs: 0x2e2c34 } },
  teppo: { kind: 'foot', human: { weapon: 'gun', armor: 'do', armorColor: DARK, helm: 'jingasa', helmColor: 0x2a2a30, skirt: 0.25, legs: 0x2e2c34 } },
  kiba: { kind: 'horse', coat: 0x6a4428,
    human: { weapon: 'katana', armor: 'do', armorColor: LACQUER, helm: 'kabuto', helmColor: 0x2a2226, plume: GOLD, pauldron: LACQUER, banner: true } },
  sohei: { kind: 'foot', human: { weapon: 'naginata', helm: 'cowl', tunic: 0xe6e0d0, skirt: 0.6, skirtColor: 0x2e2c34, cape: false } },
  ozutsu: { kind: 'cannon' },
  // 罗马：环片甲、大方盾、短剑
  legion: { kind: 'foot', human: { weapon: 'sword', shield: 'scutum', armor: 'bands', helm: 'crest', helmColor: STEEL, plume: RED, legs: 'skin', skirt: 0.3, size: 1.03 } },
  auxilia: { kind: 'foot', human: { weapon: 'spear', shield: 'oval', armor: 'mail', armorColor: 0x8c8f94, helm: 'galea', helmColor: BRONZE, legs: 'skin', skirt: 0.3 } },
  velites: { kind: 'foot', human: { weapon: 'javelin', shield: 'small', shieldColor: LEATHER, helm: 'none', legs: 'skin', skirt: 0.32 } },
  sagitt: { kind: 'foot', human: { weapon: 'bow', armor: 'mail', armorColor: 0x8c8f94, helm: 'cone', helmColor: STEEL, quiver: true, legs: 'skin', skirt: 0.3 } },
  equites: { kind: 'horse', coat: 0x7a4a2a,
    human: { weapon: 'lance', shield: 'oval', armor: 'mail', armorColor: 0x8c8f94, helm: 'crest', helmColor: BRONZE, plume: RED, cape: true, legs: 'skin' } },
  scorpio: { kind: 'ballista' },
  onager: { kind: 'onager' },
  // 波斯：软帽长袍、藤牌、鳞甲重骑
  spara: { kind: 'foot', human: { weapon: 'spear', shield: 'wicker', helm: 'tiara', plume: GOLD, skirt: 0.5, legs: 0xb07a3c } },
  immortal: { kind: 'foot', human: { weapon: 'spear', shield: 'oval', shieldColor: 0x8a5a2a, armor: 'scale', armorColor: BRONZE, helm: 'tiara', plume: CREAM, quiver: true, skirt: 0.55, legs: 0x6e3460, size: 1.03 } },
  kamandar: { kind: 'foot', human: { weapon: 'bow', helm: 'tiara', plume: GOLD, quiver: true, skirt: 0.45, legs: 0xb07a3c } },
  asvaran: { kind: 'horse', coat: 0xc9b08a, human: { weapon: 'bow', helm: 'tiara', plume: GOLD, quiver: true, legs: 0xb07a3c } },
  cataphract: { kind: 'horse', coat: 0x3a3030, barding: 0x9aa0a8, size: 1.05,
    human: { weapon: 'lance', armor: 'scale', armorColor: STEEL, helm: 'scalecap', helmColor: STEEL, plume: GOLD, pauldron: STEEL } },
  elephant: { kind: 'elephant' },
  mangonel: { kind: 'onager' },
};

const WOOD = 0x8a6a42, WOOD_D = 0x5a4028, IRON = 0x55585e, ROPE = 0xc8b48a;

function foot(L: Look, team: THREE.Color): UnitModel {
  const rb = new RigBuilder();
  rb.root.scale.setScalar(M);
  const h = new Human(rb, rb.root, L.human!, team);
  rb.clip('idle', 2.4, (_t, k) => h.pose('idle', k), 10);
  rb.clip('move', 1.0, (_t, k) => h.pose('move', k));
  rb.clip('attack', 0.5, (_t, k) => h.pose('attack', k));
  rb.clip('die', 0.5, (_t, k) => h.pose('die', k));
  return rb.build();
}

const SEAT_T = 0.6, SEAT_X = 0, SEAT_Y = -2.5;

function horse(L: Look, team: THREE.Color): UnitModel {
  const rb = new RigBuilder();
  const hp = new Puppet(asset('quaternius/horse.glb'));
  rb.root.add(hp.scene);
  const sz = L.size ?? 1;
  hp.scene.rotation.y = Math.PI / 2;
  const hb = skinnedBox(hp.scene);
  const size = hb.getSize(new THREE.Vector3());
  hp.scene.scale.multiplyScalar((2.0 * M * sz) / size.y);
  const coat = new THREE.Color(L.coat ?? 0x6a4428);
  const armor = L.barding !== undefined ? new THREE.Color(L.barding) : null;
  const hsl = { h: 0, s: 0, l: 0 };
  rb.addSkinned(hp.scene, boneOf => c => {
    // 原模型是栗色马：按明度换成指定毛色；披甲的马把躯干换成甲色
    c.getHSL(hsl);
    const bone = boneOf();
    const bodyPart = /Torso|Body|Back|Neck|Shoulder/.test(bone);
    if (hsl.s > 0.2 && hsl.l > 0.08) {
      if (armor && bodyPart) c.copy(armor).multiplyScalar(0.7 + hsl.l);
      else c.copy(coat).multiplyScalar(0.6 + hsl.l * 1.4);
    }
  });
  const seat = new THREE.Group();
  rb.root.add(seat);
  seat.scale.setScalar(M * sz);
  const r = new Human(rb, seat, L.human!, team, true);
  // 骑手坐在马背中段、肩胛稍后的位置，随马背起伏
  const rear = hp.node('Torso'), front = hp.node('Torso3');
  const wp = new THREE.Vector3(), wf = new THREE.Vector3();
  const sit = (): void => {
    rb.root.updateMatrixWorld(true);
    rear.getWorldPosition(wp);
    front.getWorldPosition(wf);
    wp.lerp(wf, SEAT_T);
    seat.position.set(wp.x + SEAT_X * sz, wp.y + SEAT_Y * sz, wp.z);
  };
  rb.clip('idle', 3.33, (t, k) => {
    hp.pose([{ clip: 'Idle', t }]);
    r.pose('idle', k);
    sit();
  }, 8);
  rb.clip('move', 0.58, (t, k) => {
    hp.pose([{ clip: 'Gallop', t }]);
    r.pose('move', k);
    sit();
  });
  rb.clip('attack', 0.5, (t, k) => {
    hp.pose([{ clip: 'Idle', t }]);
    r.pose('attack', k);
    sit();
  });
  rb.clip('attackMove', 0.5, (_t, k) => {
    hp.pose([{ clip: 'Gallop', t: k * 0.58 }]);
    r.pose('attack', k);
    sit();
  });
  rb.clip('die', 0.8, (_t, k) => {
    hp.pose([{ clip: 'Death', t: Math.min(0.98, k * 1.05) }]);
    r.pose('die', k);
    sit();
    r.body.position.y -= k * 0.5;
  });
  return rb.build();
}

function wheel(r: number, x: number, z: number, color = WOOD_D): THREE.BufferGeometry {
  return join(xf(cyl(r, r, 1.6, color, 0, 0, 0, 10), { rx: Math.PI / 2, t: [x, r, z] }),
    xf(cyl(r * 0.25, r * 0.25, 2.2, IRON, 0, 0, 0, 6), { rx: Math.PI / 2, t: [x, r, z] }));
}

/** 器械通用的走动 / 损毁动作 */
function engineClips(rb: RigBuilder, body: THREE.Group, fire: (k: number) => void, rest: () => void): void {
  rb.clip('idle', 0.1, () => {
    body.position.set(0, 0, 0);
    body.rotation.set(0, 0, 0);
    rest();
  });
  rb.clip('move', 0.5, (_t, k) => {
    rest();
    body.position.set(0, Math.abs(Math.sin(k * Math.PI * 2)) * 0.4, 0);
    body.rotation.z = Math.sin(k * Math.PI * 2) * 0.015;
  });
  rb.clip('attack', 0.5, (_t, k) => {
    body.position.set(0, 0, 0);
    body.rotation.set(0, 0, 0);
    fire(k);
  });
  rb.clip('die', 0.4, (_t, k) => {
    rest();
    body.position.set(0, -k * 2.5, 0);
    body.rotation.x = k * 0.6;
  });
}

/** 扭力投石机（野驴）：低矮车架 + 一根甩臂 */
function onager(team: THREE.Color): UnitModel {
  const rb = new RigBuilder();
  const body = new THREE.Group(), armG = new THREE.Group();
  rb.root.add(body);
  body.add(armG);
  armG.position.set(-2, 8, 0);
  rb.addRigid(join(
    box(30, 2.5, 3, WOOD, 0, 6, 7), box(30, 2.5, 3, WOOD, 0, 6, -7), box(3, 2.5, 17, WOOD_D, 13, 6, 0), box(3, 2.5, 17, WOOD_D, -13, 6, 0),
    box(2.5, 14, 2.5, WOOD_D, 4, 13, 7), box(2.5, 14, 2.5, WOOD_D, 4, 13, -7), box(3.5, 3.5, 17, WOOD, 4, 20, 0),
    box(5, 2, 15, team as unknown as number, 4, 20, 0).translate(0.3, 0, 0),
    xf(cyl(2.2, 2.2, 15, ROPE, 0, 0, 0, 6), { rx: Math.PI / 2, t: [-2, 8, 0] }),
    wheel(5, 10, 9.5), wheel(5, 10, -9.5), wheel(5, -10, 9.5), wheel(5, -10, -9.5),
  ), body);
  rb.addRigid(join(xf(cyl(1.1, 1.4, 24, WOOD, 0, 12, 0, 5), {}), xf(cyl(3, 2, 2.5, IRON, 0, 24, 0, 6), {})), armG);
  const rest = (): void => {
    armG.rotation.z = 1.25;
  };
  engineClips(rb, body, k => {
    armG.rotation.z = k < 0.25 ? 1.25 - (k / 0.25) * 1.55 : -0.3 + ((k - 0.25) / 0.75) * 1.55;
  }, rest);
  return rb.build();
}

/** 人力抛石机（霹雳车）：高架 + 长杠杆 */
function trebuchet(team: THREE.Color): UnitModel {
  const rb = new RigBuilder();
  const body = new THREE.Group(), armG = new THREE.Group();
  rb.root.add(body);
  body.add(armG);
  armG.position.set(0, 30, 0);
  const parts = [box(34, 2.5, 3, WOOD, 0, 4, 9), box(34, 2.5, 3, WOOD, 0, 4, -9), box(3, 2.5, 21, WOOD_D, 14, 4, 0), box(3, 2.5, 21, WOOD_D, -14, 4, 0)];
  for (const z of [-9, 9]) {
    parts.push(xf(box(2.5, 30, 2.5, WOOD_D), { rz: 0.32, t: [-4.5, 17, z] }), xf(box(2.5, 30, 2.5, WOOD_D), { rz: -0.32, t: [4.5, 17, z] }));
  }
  parts.push(xf(cyl(1.2, 1.2, 22, IRON, 0, 0, 0, 6), { rx: Math.PI / 2, t: [0, 30, 0] }), box(4, 5, 4, team as unknown as number, 0, 34, 9), box(4, 5, 4, team as unknown as number, 0, 34, -9),
    wheel(4, 11, 11.5), wheel(4, 11, -11.5), wheel(4, -11, 11.5), wheel(4, -11, -11.5));
  rb.addRigid(join(...parts), body);
  rb.addRigid(join(cyl(1, 1.5, 46, WOOD, 0, 9, 0, 5), box(6, 6, 6, 0x6a6660, 0, -14, 0), cyl(0.3, 0.3, 12, ROPE, 0, 38, 0, 4), ball(2.2, 0x8a8782, 0, 44, 0, 5)), armG);
  const rest = (): void => {
    armG.rotation.z = 1.9;
  };
  engineClips(rb, body, k => {
    armG.rotation.z = k < 0.3 ? 1.9 - (k / 0.3) * 2.2 : -0.3 + ((k - 0.3) / 0.7) * 2.2;
  }, rest);
  return rb.build();
}

/** 蝎弩：支架上的大型弩 */
function ballista(team: THREE.Color): UnitModel {
  const rb = new RigBuilder();
  const body = new THREE.Group(), slide = new THREE.Group();
  rb.root.add(body);
  body.add(slide);
  const top = join(box(26, 2.2, 3, WOOD, 2, 0, 0), box(3.5, 6, 14, WOOD_D, 11, 0, 0), box(4, 7, 3, team as unknown as number, 11, 0, 6.5).translate(0, 0, 0.3), box(4, 7, 3, team as unknown as number, 11, 0, -6.5).translate(0, 0, -0.3),
    xf(box(1.2, 1.2, 13, WOOD), { ry: 0.5, t: [8, 0, 11] }), xf(box(1.2, 1.2, 13, WOOD), { ry: -0.5, t: [8, 0, -11] }));
  rb.addRigid(join(xf(top, { rz: 0.12, t: [0, 15, 0] }),
    xf(box(2, 15, 2, WOOD_D), { rz: 0.25, t: [-4, 7.5, 5] }), xf(box(2, 15, 2, WOOD_D), { rz: 0.25, t: [-4, 7.5, -5] }), xf(box(2, 15, 2, WOOD_D), { rz: -0.35, t: [7, 7.5, 0] }),
    box(18, 1.5, 12, WOOD_D, 1, 1, 0)), body);
  rb.addRigid(xf(join(xf(cyl(0.5, 0.5, 20, 0xd8d2c0, 0, 0, 0, 4), { rz: -Math.PI / 2 }), xf(cone(1.1, 4, IRON, 0, 0, 0, 4), { rz: -Math.PI / 2, t: [11, 0, 0] })), { rz: 0.12, t: [2, 17, 0] }), slide);
  engineClips(rb, body, k => {
    slide.scale.setScalar(k < 0.5 ? 0.001 : 1);
    body.position.x = -Math.sin(Math.min(1, k * 2) * Math.PI) * 1.5;
  }, () => slide.scale.setScalar(1));
  return rb.build();
}

function rocketCart(team: THREE.Color): UnitModel {
  const rb = new RigBuilder();
  const body = new THREE.Group();
  rb.root.add(body);
  const parts = [box(26, 2.5, 13, WOOD, 0, 8, 0), box(14, 2, 2, WOOD_D, -19, 8, 4), box(14, 2, 2, WOOD_D, -19, 8, -4), wheel(7, -2, 8.5), wheel(7, -2, -8.5)];
  // 火箭匣：斜向上的方箱，前端露出一排排箭簇
  const rack = [box(18, 10, 12, WOOD_D, 0, 0, 0), box(18.5, 2, 12.5, team as unknown as number, 0, 5.5, 0), box(18.5, 2, 12.5, team as unknown as number, 0, -5.5, 0)];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
    rack.push(xf(cone(0.9, 4, 0xe8e2d0, 0, 0, 0, 4), { rz: -Math.PI / 2, t: [10.5, -3 + j * 3, -4.5 + i * 3] }));
  }
  parts.push(xf(join(...rack), { rz: 0.5, t: [3, 17, 0] }), xf(box(2, 12, 2, WOOD_D), { rz: -0.3, t: [8, 11, 0] }));
  rb.addRigid(join(...parts), body);
  engineClips(rb, body, k => {
    body.position.x = -Math.sin(k * Math.PI) * 2;
  }, () => undefined);
  return rb.build();
}

function cannon(team: THREE.Color): UnitModel {
  const rb = new RigBuilder();
  const body = new THREE.Group();
  rb.root.add(body);
  const parts = [box(26, 3.5, 7, WOOD_D, -4, 7, 0), box(7, 5, 10, team as unknown as number, -2, 9.5, 0), wheel(7.5, 0, 6.5, WOOD), wheel(7.5, 0, -6.5, WOOD)];
  parts.push(xf(cyl(2.3, 3.2, 26, 0x3a3a40, 0, 0, 0, 8), { rz: -Math.PI / 2 + 0.18, t: [7, 13, 0] }));
  parts.push(xf(cyl(3, 3, 1.8, 0x55585e, 0, 0, 0, 8), { rz: -Math.PI / 2 + 0.18, t: [19, 15.2, 0] }));
  parts.push(xf(cyl(3.4, 3.4, 1.8, 0x55585e, 0, 0, 0, 8), { rz: -Math.PI / 2 + 0.18, t: [-4, 11, 0] }));
  rb.addRigid(join(...parts), body);
  engineClips(rb, body, k => {
    body.position.x = -Math.sin(Math.min(1, k * 1.6) * Math.PI) * 5;
  }, () => undefined);
  return rb.build();
}

function elephant(team: THREE.Color): UnitModel {
  const rb = new RigBuilder();
  const SKIN = 0x7d7873, SKIN_D = 0x66625e, IVORY = 0xf0e8d2;
  const T = team as unknown as number;
  const body = new THREE.Group(), head = new THREE.Group(), trunk = new THREE.Group(), trunk2 = new THREE.Group();
  rb.root.add(body);
  rb.root.scale.setScalar(0.66);
  body.position.set(0, 27, 0);
  body.add(head);
  head.position.set(17, 5, 0);
  head.add(trunk);
  trunk.position.set(9, -3, 0);
  trunk.add(trunk2);
  trunk2.position.set(0, -11, 0);
  const legs: THREE.Group[] = [], shins: THREE.Group[] = [];
  for (const [x, z] of [[11, 7.5], [11, -7.5], [-12, 7.5], [-12, -7.5]]) {
    const l = new THREE.Group(), s = new THREE.Group();
    l.position.set(x, -5, z);
    body.add(l);
    l.add(s);
    s.position.set(0, -11, 0);
    legs.push(l);
    shins.push(s);
    rb.addRigid(cyl(5, 4.4, 13, SKIN_D, 0, -5.5, 0, 7), l);
    rb.addRigid(join(cyl(4.2, 4.6, 11, SKIN_D, 0, -5.5, 0, 7), cyl(4.9, 4.9, 1.5, 0x55524e, 0, -10.5, 0, 7)), s);
  }
  rb.addRigid(join(
    xf(ball(16, SKIN, 0, 0, 0, 9), { s: [1.3, 0.95, 0.82] }), xf(ball(12, SKIN, 0, 0, 0, 7), { s: [1, 1, 0.85], t: [-10, 1, 0] }),
    box(27, 1.2, 27, T, 0, 13.5, 0), box(25, 14, 0.8, T, 0, 7, 13.2), box(25, 14, 0.8, T, 0, 7, -13.2), box(27, 1.5, 28, 0xd9b44a, 0, 12.3, 0),
    // 象舆
    box(19, 2, 16, 0x7a5a36, -1, 15.5, 0), box(19, 6, 1.2, 0x8a6a3c, -1, 19, 8), box(19, 6, 1.2, 0x8a6a3c, -1, 19, -8), box(1.2, 6, 16, 0x8a6a3c, 8.5, 19, 0), box(1.2, 6, 16, 0x8a6a3c, -10.5, 19, 0),
    box(1, 12, 1, 0x5a4028, 8, 24, 7.5), box(1, 12, 1, 0x5a4028, 8, 24, -7.5), box(1, 12, 1, 0x5a4028, -10, 24, 7.5), box(1, 12, 1, 0x5a4028, -10, 24, -7.5), box(22, 1.5, 19, T, -1, 30.5, 0),
    xf(cyl(0.8, 0.5, 13, SKIN_D, 0, 0, 0, 4), { rz: 0.5, t: [-23, -3, 0] }),
  ), body);
  rb.addRigid(join(
    xf(ball(10, SKIN, 0, 0, 0, 8), { s: [1, 1.08, 0.92], t: [3, 0, 0] }),
    xf(box(1.2, 15, 12, SKIN_D), { ry: 0.55, rx: 0.1, t: [-1, 1, 11] }), xf(box(1.2, 15, 12, SKIN_D), { ry: -0.55, rx: -0.1, t: [-1, 1, -11] }),
    xf(cone(1.5, 15, IVORY, 0, 0, 0, 5), { rz: -2.0, t: [14, -7, 4.5] }), xf(cone(1.5, 15, IVORY, 0, 0, 0, 5), { rz: -2.0, t: [14, -7, -4.5] }),
    box(8, 1, 10, T, 5, 10.5, 0), box(1, 8, 9, T, 12.5, 5, 0),
  ), head);
  rb.addRigid(cyl(3.6, 2.6, 12, SKIN, 0, -5.5, 0, 6), trunk);
  rb.addRigid(cyl(2.6, 1.6, 12, SKIN, 0, -6, 0, 6), trunk2);
  const walk = (k: number, amp: number): void => {
    const a = k * Math.PI * 2;
    legs.forEach((l, i) => {
      const ph = a + (i === 0 || i === 3 ? 0 : Math.PI);
      l.rotation.z = Math.sin(ph) * amp;
      shins[i].rotation.z = -Math.max(0, Math.sin(ph - 1.8)) * amp * 1.3;
    });
    body.position.y = 27 + Math.abs(Math.cos(a)) * amp * 1.5;
  };
  const rest = (): void => {
    walk(0, 0);
    head.rotation.z = 0;
    trunk.rotation.z = 0.12;
    trunk2.rotation.z = 0.25;
    body.rotation.set(0, 0, 0);
  };
  rb.clip('idle', 2.5, (_t, k) => {
    rest();
    trunk.rotation.z = 0.12 + Math.sin(k * Math.PI * 2) * 0.12;
    trunk2.rotation.z = 0.25 + Math.sin(k * Math.PI * 2 + 1) * 0.2;
  }, 10);
  rb.clip('move', 1.0, (_t, k) => {
    rest();
    walk(k, 0.38);
    trunk2.rotation.z = 0.25 + Math.sin(k * Math.PI * 4) * 0.12;
  });
  rb.clip('attack', 0.5, (_t, k) => {
    rest();
    const s = Math.sin(Math.min(1, k * 1.4) * Math.PI);
    head.rotation.z = s * 0.45;
    trunk.rotation.z = 0.12 + s * 1.2;
    trunk2.rotation.z = 0.25 + s * 0.9;
  });
  rb.clip('die', 0.8, (_t, k) => {
    rest();
    body.rotation.x = k * 1.45;
    body.position.y = 27 - k * 13;
    legs.forEach(l => (l.rotation.z = k * 0.5));
  });
  return rb.build();
}

export function buildUnitModel(key: string, teamRgb: [number, number, number]): UnitModel {
  const L = LOOKS[key];
  const team = new THREE.Color().setRGB(teamRgb[0] / 255, teamRgb[1] / 255, teamRgb[2] / 255, THREE.SRGBColorSpace);
  switch (L.kind) {
    case 'foot': return foot(L, team);
    case 'horse': return horse(L, team);
    case 'elephant': return elephant(team);
    case 'onager': return onager(team);
    case 'trebuchet': return trebuchet(team);
    case 'ballista': return ballista(team);
    case 'rocket': return rocketCart(team);
    case 'cannon': return cannon(team);
  }
}
