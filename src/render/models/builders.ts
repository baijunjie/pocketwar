/** 代码建模的构建器：士兵、骑兵（马用素材包里的模型）、器械、战象 */
import * as THREE from 'three';
import { asset } from '../assets';
import { ball, box, cone, cyl, join, xf } from '../prims';
import { Puppet, RigBuilder, UnitModel, skinnedBox } from '../rig';
import { Human } from './human';
import { TWIST_CLIPS } from './actions';
import { DEFAULT_MOUNT, FootSpec, HorseSpec } from './spec';

/** 每米对应的世界像素：士兵身高约 1.75 米 */
export const M = 10;

const WOOD = 0x8a6a42, WOOD_D = 0x5a4028, IRON = 0x55585e, ROPE = 0xc8b48a;

export function foot(L: FootSpec, team: THREE.Color): UnitModel {
  const rb = new RigBuilder();
  rb.root.scale.setScalar(M);
  const h = new Human(rb, rb.root, L.human, team);
  rb.clip('idle', 2.4, (_t, k) => h.pose('idle', k), 10);
  rb.clip('walk', 1.0, (_t, k) => h.pose('walk', k));
  rb.clip('run', 1.0, (_t, k) => h.pose('run', k));
  rb.clip('attack', 0.5, (_t, k) => h.pose('attack', k));
  rb.clip('die', 0.5, (_t, k) => h.pose('die', k));
  if (h.canBrace) rb.clip('brace', 0.1, () => h.pose('brace', 0));
  if (L.human.shield) {
    rb.clip('guard', 0.1, () => h.pose('guard', 0));
    rb.clip('guardWalk', 1.0, (_t, k) => h.pose('guardWalk', k));
  }
  return rb.build({ walk: 15, run: 28.4, guardWalk: 15 });
}

const SEAT_T = 0.6, SEAT_X = 0, SEAT_Y = -2.5;

export function horse(L: HorseSpec, team: THREE.Color): UnitModel {
  const rb = new RigBuilder();
  const hp = new Puppet(asset(L.mount ?? DEFAULT_MOUNT));
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
    const bodyPart = L.bardingFull ? !/Lower|Tail|Ear/.test(bone) : /Torso|Body|Back|Neck|Shoulder/.test(bone);
    if (hsl.s > 0.2 && hsl.l > 0.08) {
      if (armor && bodyPart) c.copy(armor).multiplyScalar(0.7 + hsl.l);
      else c.copy(coat).multiplyScalar(0.6 + hsl.l * 1.4);
    }
  });
  const seat = new THREE.Group();
  rb.root.add(seat);
  seat.scale.setScalar(M * sz);
  const r = new Human(rb, seat, L.human, team, true);
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
  const walkLen = hp.durations.get('Walk') ?? 1;
  rb.clip('walk', walkLen, (t, k) => {
    hp.pose([{ clip: 'Walk', t }]);
    r.pose('walk', k);
    sit();
  });
  rb.clip('run', 0.58, (t, k) => {
    hp.pose([{ clip: 'Gallop', t }]);
    r.pose('run', k);
    sit();
  });
  rb.clip('charge', 0.58, (t, k) => {
    hp.pose([{ clip: 'Gallop', t }]);
    r.pose('charge', k);
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
  // 弓骑：马照常向前奔，骑手扭身朝侧面、身后放箭
  if (L.human.weapon === 'bow' || L.human.weapon === 'longbow') {
    for (const [name, twist] of TWIST_CLIPS) {
      rb.clip(name, 0.5, (_t, k) => {
        hp.pose([{ clip: 'Gallop', t: k * 0.58 }]);
        r.pose('attack', k, twist);
        sit();
      });
    }
  }
  rb.clip('die', 0.8, (_t, k) => {
    hp.pose([{ clip: 'Death', t: Math.min(0.98, k * 1.05) }]);
    r.pose('die', k);
    sit();
    r.body.position.y -= k * 0.5;
  });
  return rb.build({ walk: 21, run: 35, charge: 35 });
}

function wheel(r: number, x: number, z: number, color = WOOD_D): THREE.BufferGeometry {
  return join(xf(cyl(r, r, 1.6, color, 0, 0, 0, 10), { rx: Math.PI / 2, t: [x, r, z] }),
    xf(cyl(r * 0.25, r * 0.25, 2.2, IRON, 0, 0, 0, 6), { rx: Math.PI / 2, t: [x, r, z] }));
}

/** 包铁器械的挡板：立在车前的一面铁皮木盾，中间一道队伍色 */
function mantlet(team: THREE.Color, x: number, y: number, w: number, h: number): THREE.BufferGeometry[] {
  return [
    xf(box(1.6, h, w, 0x4a4d54), { rz: -0.12, t: [x, y + h / 2, 0] }), xf(box(1.9, 2.2, w + 0.6, team as unknown as number), { rz: -0.12, t: [x + 0.2, y + h * 0.62, 0] }),
    xf(box(2, 1.2, w + 0.8, 0x2e3035), { rz: -0.12, t: [x, y + h - 0.3, 0] }), xf(box(2, 1.2, w + 0.8, 0x2e3035), { rz: -0.12, t: [x, y + 1, 0] }),
    xf(box(1.4, h * 0.9, 1.4, WOOD_D), { rz: 0.5, t: [x - h * 0.24, y + h * 0.42, w * 0.3] }), xf(box(1.4, h * 0.9, 1.4, WOOD_D), { rz: 0.5, t: [x - h * 0.24, y + h * 0.42, -w * 0.3] }),
  ];
}

/** 器械通用的走动 / 损毁动作 */
function engineClips(rb: RigBuilder, body: THREE.Group, fire: (k: number) => void, rest: () => void): void {
  rb.clip('idle', 0.1, () => {
    body.position.set(0, 0, 0);
    body.rotation.set(0, 0, 0);
    rest();
  });
  rb.clip('walk', 0.5, (_t, k) => {
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
export function onager(team: THREE.Color, armored = false): UnitModel {
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
    ...(armored ? [...mantlet(team, 19, 3, 24, 20), box(30.5, 3, 1, IRON, 0, 6, 8.7), box(30.5, 3, 1, IRON, 0, 6, -8.7), box(4.2, 15, 1, IRON, 4, 13, 8.5), box(4.2, 15, 1, IRON, 4, 13, -8.5)] : []),
  ), body);
  rb.addRigid(join(xf(cyl(1.1, 1.4, 24, WOOD, 0, 12, 0, 5), {}), xf(cyl(3, 2, 2.5, IRON, 0, 24, 0, 6), {})), armG);
  const rest = (): void => {
    armG.rotation.z = 1.25;
  };
  engineClips(rb, body, k => {
    armG.rotation.z = k < 0.25 ? 1.25 - (k / 0.25) * 1.55 : -0.3 + ((k - 0.25) / 0.75) * 1.55;
  }, rest);
  return rb.build({ walk: 35 });
}

/** 人力抛石机（霹雳车）：高架 + 长杠杆 */
export function trebuchet(team: THREE.Color, armored = false): UnitModel {
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
  if (armored) parts.push(...mantlet(team, 21, 2, 28, 24), box(34.5, 3, 1, IRON, 0, 4, 10.8), box(34.5, 3, 1, IRON, 0, 4, -10.8),
    box(12, 14, 0.8, IRON, 0, 12, 10.6), box(12, 14, 0.8, IRON, 0, 12, -10.6));
  rb.addRigid(join(...parts), body);
  rb.addRigid(join(cyl(1, 1.5, 46, WOOD, 0, 9, 0, 5), box(6, 6, 6, 0x6a6660, 0, -14, 0), cyl(0.3, 0.3, 12, ROPE, 0, 38, 0, 4), ball(2.2, 0x8a8782, 0, 44, 0, 5)), armG);
  const rest = (): void => {
    armG.rotation.z = 1.9;
  };
  engineClips(rb, body, k => {
    armG.rotation.z = k < 0.3 ? 1.9 - (k / 0.3) * 2.2 : -0.3 + ((k - 0.3) / 0.7) * 2.2;
  }, rest);
  return rb.build({ walk: 35 });
}

/** 蝎弩：支架上的大型弩 */
export function ballista(team: THREE.Color, armored = false): UnitModel {
  const rb = new RigBuilder();
  const body = new THREE.Group(), slide = new THREE.Group();
  rb.root.add(body);
  body.add(slide);
  const top = join(box(26, 2.2, 3, WOOD, 2, 0, 0), box(3.5, 6, 14, WOOD_D, 11, 0, 0), box(4, 7, 3, team as unknown as number, 11, 0, 6.5).translate(0, 0, 0.3), box(4, 7, 3, team as unknown as number, 11, 0, -6.5).translate(0, 0, -0.3),
    xf(box(1.2, 1.2, 13, WOOD), { ry: 0.5, t: [8, 0, 11] }), xf(box(1.2, 1.2, 13, WOOD), { ry: -0.5, t: [8, 0, -11] }));
  rb.addRigid(join(xf(top, { rz: 0.12, t: [0, 15, 0] }),
    xf(box(2, 15, 2, WOOD_D), { rz: 0.25, t: [-4, 7.5, 5] }), xf(box(2, 15, 2, WOOD_D), { rz: 0.25, t: [-4, 7.5, -5] }), xf(box(2, 15, 2, WOOD_D), { rz: -0.35, t: [7, 7.5, 0] }),
    box(18, 1.5, 12, WOOD_D, 1, 1, 0),
    // 包铁：弩臂两侧各一面护盾，中间留出射口
    ...(armored ? [box(1.5, 15, 9, 0x4a4d54, 15, 12, 9), box(1.5, 15, 9, 0x4a4d54, 15, 12, -9), box(1.8, 2, 9.4, team as unknown as number, 15.1, 15, 9), box(1.8, 2, 9.4, team as unknown as number, 15.1, 15, -9),
      box(1.5, 5, 27, 0x4a4d54, 15, 2.5, 0), box(19, 1, 13, IRON, 1, 2.2, 0)] : [])), body);
  rb.addRigid(xf(join(xf(cyl(0.5, 0.5, 20, 0xd8d2c0, 0, 0, 0, 4), { rz: -Math.PI / 2 }), xf(cone(1.1, 4, IRON, 0, 0, 0, 4), { rz: -Math.PI / 2, t: [11, 0, 0] })), { rz: 0.12, t: [2, 17, 0] }), slide);
  engineClips(rb, body, k => {
    slide.scale.setScalar(k < 0.5 ? 0.001 : 1);
    body.position.x = -Math.sin(Math.min(1, k * 2) * Math.PI) * 1.5;
  }, () => slide.scale.setScalar(1));
  return rb.build({ walk: 35 });
}

export function rocketCart(team: THREE.Color, armored = false): UnitModel {
  const rb = new RigBuilder();
  const body = new THREE.Group();
  rb.root.add(body);
  const parts = [box(26, 2.5, 13, WOOD, 0, 8, 0), box(14, 2, 2, WOOD_D, -19, 8, 4), box(14, 2, 2, WOOD_D, -19, 8, -4), wheel(7, -2, 8.5), wheel(7, -2, -8.5)];
  // 火箭匣：斜向上的方箱，前端露出一排排箭簇
  const rack = [box(18, 10, 12, WOOD_D, 0, 0, 0), box(18.5, 2, 12.5, team as unknown as number, 0, 5.5, 0), box(18.5, 2, 12.5, team as unknown as number, 0, -5.5, 0)];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
    rack.push(xf(cone(0.9, 4, 0xe8e2d0, 0, 0, 0, 4), { rz: -Math.PI / 2, t: [10.5, -3 + j * 3, -4.5 + i * 3] }));
  }
  if (armored) rack.push(box(19, 10.6, 0.8, 0x4a4d54, 0, 0, 6.5), box(19, 10.6, 0.8, 0x4a4d54, 0, 0, -6.5), box(1, 11, 13.4, IRON, -9, 0, 0), box(1, 11, 13.4, IRON, 3, 0, 0));
  parts.push(xf(join(...rack), { rz: 0.5, t: [3, 17, 0] }), xf(box(2, 12, 2, WOOD_D), { rz: -0.3, t: [8, 11, 0] }));
  if (armored) parts.push(box(27, 4.5, 1, 0x4a4d54, 0, 8, 7), box(27, 4.5, 1, 0x4a4d54, 0, 8, -7), box(1.4, 9, 14, 0x4a4d54, 13.5, 8, 0));
  rb.addRigid(join(...parts), body);
  engineClips(rb, body, k => {
    body.position.x = -Math.sin(k * Math.PI) * 2;
  }, () => undefined);
  return rb.build({ walk: 35 });
}

export function cannon(team: THREE.Color, armored = false): UnitModel {
  const rb = new RigBuilder();
  const body = new THREE.Group();
  rb.root.add(body);
  const parts = [box(26, 3.5, 7, WOOD_D, -4, 7, 0), box(7, 5, 10, team as unknown as number, -2, 9.5, 0), wheel(7.5, 0, 6.5, WOOD), wheel(7.5, 0, -6.5, WOOD)];
  parts.push(xf(cyl(2.3, 3.2, 26, 0x3a3a40, 0, 0, 0, 8), { rz: -Math.PI / 2 + 0.18, t: [7, 13, 0] }));
  parts.push(xf(cyl(3, 3, 1.8, 0x55585e, 0, 0, 0, 8), { rz: -Math.PI / 2 + 0.18, t: [19, 15.2, 0] }));
  parts.push(xf(cyl(3.4, 3.4, 1.8, 0x55585e, 0, 0, 0, 8), { rz: -Math.PI / 2 + 0.18, t: [-4, 11, 0] }));
  // 包铁：炮口两侧各一面防盾
  if (armored) parts.push(box(1.6, 17, 8.5, 0x4a4d54, 13, 11, 8), box(1.6, 17, 8.5, 0x4a4d54, 13, 11, -8), box(1.9, 2, 9, team as unknown as number, 13.1, 15, 8), box(1.9, 2, 9, team as unknown as number, 13.1, 15, -8),
    box(27, 4.5, 0.8, IRON, -4, 7, 4), box(27, 4.5, 0.8, IRON, -4, 7, -4));
  rb.addRigid(join(...parts), body);
  engineClips(rb, body, k => {
    body.position.x = -Math.sin(Math.min(1, k * 1.6) * Math.PI) * 5;
  }, () => undefined);
  return rb.build({ walk: 35 });
}

export function elephant(team: THREE.Color, armored = false): UnitModel {
  const rb = new RigBuilder();
  const SKIN = 0x7d7873, SKIN_D = 0x66625e, IVORY = 0xf0e8d2, PLATE = 0xb9984a, PLATE_D = 0x8a7034;
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
    rb.addRigid(armored ? join(cyl(5, 4.4, 13, SKIN_D, 0, -5.5, 0, 7), cyl(5.6, 5.2, 9, PLATE, 0, -4, 0, 7)) : cyl(5, 4.4, 13, SKIN_D, 0, -5.5, 0, 7), l);
    rb.addRigid(join(cyl(4.2, 4.6, 11, SKIN_D, 0, -5.5, 0, 7), cyl(4.9, 4.9, 1.5, 0x55524e, 0, -10.5, 0, 7),
      ...(armored ? [cyl(4.9, 5.2, 6, PLATE, 0, -4, 0, 7)] : [])), s);
  }
  rb.addRigid(join(
    xf(ball(16, SKIN, 0, 0, 0, 9), { s: [1.3, 0.95, 0.82] }), xf(ball(12, SKIN, 0, 0, 0, 7), { s: [1, 1, 0.85], t: [-10, 1, 0] }),
    box(27, 1.2, 27, T, 0, 13.5, 0), box(25, 14, 0.8, T, 0, 7, 13.2), box(25, 14, 0.8, T, 0, 7, -13.2), box(27, 1.5, 28, 0xd9b44a, 0, 12.3, 0),
    // 象舆
    box(19, 2, 16, 0x7a5a36, -1, 15.5, 0), box(19, 6, 1.2, 0x8a6a3c, -1, 19, 8), box(19, 6, 1.2, 0x8a6a3c, -1, 19, -8), box(1.2, 6, 16, 0x8a6a3c, 8.5, 19, 0), box(1.2, 6, 16, 0x8a6a3c, -10.5, 19, 0),
    box(1, 12, 1, 0x5a4028, 8, 24, 7.5), box(1, 12, 1, 0x5a4028, 8, 24, -7.5), box(1, 12, 1, 0x5a4028, -10, 24, 7.5), box(1, 12, 1, 0x5a4028, -10, 24, -7.5), box(22, 1.5, 19, T, -1, 30.5, 0),
    xf(cyl(0.8, 0.5, 13, SKIN_D, 0, 0, 0, 4), { rz: 0.5, t: [-23, -3, 0] }),
    // 披甲：身侧垂下两大片鳞甲，胸前、臀后各一片，象舆四面挂盾
    ...(armored ? [box(34, 19, 1.2, PLATE, 0, 1, 13.9), box(34, 19, 1.2, PLATE, 0, 1, -13.9), box(34, 1.6, 1.6, PLATE_D, 0, -8, 14), box(34, 1.6, 1.6, PLATE_D, 0, -8, -14),
      box(34, 1.6, 1.6, PLATE_D, 0, 3, 14), box(34, 1.6, 1.6, PLATE_D, 0, 3, -14),
      box(1.4, 16, 24, PLATE, 19.5, 0, 0), box(1.4, 15, 24, PLATE, -21.5, 1, 0),
      xf(cyl(4, 4, 1, T, 0, 0, 0, 8), { rx: Math.PI / 2, t: [-5, 19, 9] }), xf(cyl(4, 4, 1, T, 0, 0, 0, 8), { rx: Math.PI / 2, t: [4, 19, 9] }),
      xf(cyl(4, 4, 1, T, 0, 0, 0, 8), { rx: Math.PI / 2, t: [-5, 19, -9] }), xf(cyl(4, 4, 1, T, 0, 0, 0, 8), { rx: Math.PI / 2, t: [4, 19, -9] })] : []),
  ), body);
  rb.addRigid(join(
    xf(ball(10, SKIN, 0, 0, 0, 8), { s: [1, 1.08, 0.92], t: [3, 0, 0] }),
    xf(box(1.2, 15, 12, SKIN_D), { ry: 0.55, rx: 0.1, t: [-1, 1, 11] }), xf(box(1.2, 15, 12, SKIN_D), { ry: -0.55, rx: -0.1, t: [-1, 1, -11] }),
    xf(cone(1.5, 15, IVORY, 0, 0, 0, 5), { rz: -2.0, t: [14, -7, 4.5] }), xf(cone(1.5, 15, IVORY, 0, 0, 0, 5), { rz: -2.0, t: [14, -7, -4.5] }),
    box(8, 1, 10, T, 5, 10.5, 0), box(1, 8, 9, T, 12.5, 5, 0),
    // 披甲：额甲、面甲与牙套
    ...(armored ? [xf(box(1.6, 15, 15, PLATE), { rz: -0.25, t: [13, 3, 0] }), box(13, 1.6, 17, PLATE, 5, 10.2, 0), box(1.8, 3, 16, PLATE_D, 14, 9, 0),
      xf(cyl(2, 1.7, 7, PLATE_D, 0, 0, 0, 5), { rz: -2.0, t: [11.5, -5.8, 4.5] }), xf(cyl(2, 1.7, 7, PLATE_D, 0, 0, 0, 5), { rz: -2.0, t: [11.5, -5.8, -4.5] })] : []),
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
  rb.clip('walk', 1.0, (_t, k) => {
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
  return rb.build({ walk: 35 });
}
