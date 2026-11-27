/** 清单登记的 glTF 素材烘成 UnitModel：单份骨骼模型（rig）与骑手 + 坐骑（mounted） */
import * as THREE from 'three';
import { asset } from '../assets';
import { Puppet, RigBuilder, UnitModel, skinnedBox } from '../rig';
import { ONE_SHOT, STD_ACTIONS, StdAction, mountAction } from './actions';
import { M } from './builders';
import { AssetSpec, Manifest, MountedSpec, RigPart, RigSpec, resolveClip } from './manifest';

const IDLE_FPS = 15, FPS = 30;
/** 非循环动作取到素材时长的这么多为止：取到整段时长会被 Puppet 取模回第 0 帧 */
const END = 0.999;

function puppet(m: Manifest, p: RigPart): Puppet {
  return new Puppet(asset(p.src), p.anims ? [asset(m.libraries[p.anims])] : []);
}

/** 素材根的朝向：前方转到 +X */
function face(p: Puppet, s: AssetSpec): void {
  p.scene.rotation.y = s.yaw ?? Math.PI / 2;
}

/** 素材的缩放：米换成世界像素；给了 height 时改为等比缩放到这个高度（按 ref 量） */
function scaleOf(s: AssetSpec, ref: Puppet): number {
  if (!s.height) return M * (s.scale ?? 1);
  ref.scene.scale.setScalar(1);
  const h = skinnedBox(ref.scene).getSize(new THREE.Vector3()).y || 1;
  return (s.height * M) / h;
}

function strides(s: AssetSpec, walk: number, run: number): Record<string, number> {
  const w = (s.stride?.walk ?? walk) * M, r = (s.stride?.run ?? run) * M;
  return { walk: w, guardWalk: w, run: r, charge: r };
}

/** 动作里找不到要报出素材里有哪些，方便对名字 */
function missing(src: string, name: string, p: Puppet): Error {
  return new Error(`${src} 里没有动作「${name}」，可用的有：${[...p.durations.keys()].join('、')}`);
}

/** 一个标准动作对应素材里哪段动作、录多长；同一段（名字与时长都相同）只录一次，其余标准动作名指过去 */
function plan(src: string, p: Puppet, part: RigPart, std: StdAction): { name: string; dur: number; seconds: number; key: string } | null {
  const c = resolveClip(part, std, n => p.durations.has(n));
  if (!c) return null;
  const dur = p.durations.get(c.name);
  if (dur === undefined) throw missing(src, c.name, p);
  const seconds = Math.max(0.1, c.seconds ?? dur);
  // 循环与否也算进去：同一段素材当循环与当非循环录出来的末帧不同
  return { name: c.name, dur, seconds, key: `${c.name}|${seconds}|${ONE_SHOT.has(std)}` };
}

export function rigModel(m: Manifest, s: RigSpec): UnitModel {
  const rb = new RigBuilder();
  const p = puppet(m, s);
  rb.root.add(p.scene);
  face(p, s);
  p.scene.scale.setScalar(scaleOf(s, p));
  rb.addSkinned(p.scene);
  const done = new Map<string, string>();
  for (const std of STD_ACTIONS) {
    const c = plan(s.src, p, s, std);
    if (!c) continue;
    const same = done.get(c.key);
    if (same) {
      rb.alias(std, same);
      continue;
    }
    done.set(c.key, std);
    const last = ONE_SHOT.has(std) ? c.dur * END : Infinity;
    rb.clip(std, c.seconds, t => p.pose([{ clip: c.name, t: Math.min(t, last) }]), std === 'idle' ? IDLE_FPS : FPS);
  }
  if (!done.size) throw new Error(`${s.src} 里没有任何标准动作，可用的有：${[...p.durations.keys()].join('、')}`);
  return rb.build(strides(s, 1.4, 2.8));
}

export function mountedModel(m: Manifest, s: MountedSpec): UnitModel {
  const rb = new RigBuilder();
  const horse = puppet(m, s.mount);
  rb.root.add(horse.scene);
  const rider = puppet(m, s.rider);
  const seatG = new THREE.Group();
  rb.root.add(seatG);
  seatG.add(rider.scene);
  // 给了 height 时按马量出缩放，骑手用同一个比例
  const k0 = scaleOf(s, horse);
  for (const p of [horse, rider]) {
    face(p, s);
    p.scene.scale.setScalar(k0);
  }
  rb.addSkinned(horse.scene);
  rb.addSkinned(rider.scene);

  // 骑手的根对齐 saddle 骨骼：跟它的位置，并随它相对绑定姿势的转动而转动（不依赖骨骼轴向的约定）
  const seat = horse.node(s.mount.seat ?? 'saddle');
  rb.root.updateMatrixWorld(true);
  const rest = seat.getWorldQuaternion(new THREE.Quaternion()).invert();
  const q = new THREE.Quaternion();
  const sit = (): void => {
    rb.root.updateMatrixWorld(true);
    seat.getWorldPosition(seatG.position);
    seatG.quaternion.multiplyQuaternions(seat.getWorldQuaternion(q), rest);
  };

  const done = new Map<string, string>();
  for (const std of STD_ACTIONS) {
    const rc = plan(s.rider.src, rider, s.rider, std);
    if (!rc) continue;
    const want = mountAction(std);
    const mc = plan(s.mount.src, horse, s.mount, want) ?? plan(s.mount.src, horse, s.mount, 'idle');
    if (!mc) throw missing(s.mount.src, want, horse);
    const key = `${rc.key}/${mc.key}`;
    const same = done.get(key);
    if (same) {
      rb.alias(std, same);
      continue;
    }
    done.set(key, std);
    const once = ONE_SHOT.has(std), moving = want === 'walk' || want === 'run';
    // 循环动作要让马与骑手首尾都接得上：移动类以马的步子为一个循环、骑手压进去；原地的以骑手为准、马压进去
    const seconds = once ? (std === 'die' ? Math.max(rc.seconds, mc.seconds) : rc.seconds) : moving ? mc.seconds : rc.seconds;
    rb.clip(std, seconds, (t, k) => {
      // 马是否停在末帧看马自己的动作：骑手回身射箭（只播一遍）时马照样循环着跑
      horse.pose([{ clip: mc.name, t: want === 'die' ? Math.min(t, mc.dur * END) : once ? t % mc.seconds : k * mc.seconds }]);
      sit();
      rider.pose([{ clip: rc.name, t: once ? Math.min(t, rc.dur * END) : k * rc.seconds }]);
    }, std === 'idle' ? IDLE_FPS : FPS);
  }
  if (!done.size) throw new Error(`${s.rider.src} 里没有任何标准动作`);
  return rb.build(strides(s, 2.0, 4.0));
}
