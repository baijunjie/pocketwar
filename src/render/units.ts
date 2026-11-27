/**
 * 单位绘制：每个模型一批（双方共用，队伍色是实例属性），实例属性给出位置、朝向、动画行、队伍色与动作过渡。
 */
import * as THREE from 'three';
import { unitMaterials } from './materials';
import { Clip, UnitModel } from './rig';

/** 动画进度（0..1）→ 骨骼贴图里带小数的帧行：循环动作在相邻帧之间插值，非循环动作停在末帧 */
export function clipRow(clip: Clip, phase: number): number {
  const p = phase <= 0 ? 0 : phase >= 1 ? 1 : phase;
  return clip.start + p * clip.n;
}

/** 各实例属性的分量数 */
const ATTRS = { aInst: 4, aAnim: 4, aTint: 3, aBlend: 2 } as const;
type AttrName = keyof typeof ATTRS;

export class UnitBatch {
  readonly mesh: THREE.Mesh;
  count = 0;
  private cap = 0;
  private readonly data = {} as Record<AttrName, Float32Array>;
  private readonly geo = new THREE.InstancedBufferGeometry();
  readonly clips: Record<string, Clip>;

  constructor(readonly model: UnitModel, shadows = true) {
    const g = model.geometry;
    for (const k of Object.keys(g.attributes)) this.geo.setAttribute(k, g.getAttribute(k));
    this.geo.setIndex(g.getIndex());
    const { lit, depth } = unitMaterials(model.bones, model.influences);
    this.mesh = new THREE.Mesh(this.geo, lit);
    this.mesh.customDepthMaterial = depth;
    this.mesh.castShadow = shadows;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.clips = model.clips;
    this.grow(64);
  }

  private grow(cap: number): void {
    for (const k of Object.keys(ATTRS) as AttrName[]) {
      const arr = new Float32Array(cap * ATTRS[k]);
      if (this.data[k]) arr.set(this.data[k]);
      this.data[k] = arr;
      const a = new THREE.InstancedBufferAttribute(arr, ATTRS[k]);
      a.setUsage(THREE.DynamicDrawUsage);
      this.geo.setAttribute(k, a);
    }
    this.cap = cap;
  }

  begin(): void {
    this.count = 0;
  }

  /**
   * @param row 带小数的帧行（见 clipRow）
   * @param tint 队伍色（线性 rgb）
   * @param prevRow 上一个动作冻结时的帧行，blend 是它的权重（0 = 不过渡）
   */
  add(x: number, y: number, z: number, yaw: number, row: number, tint: ArrayLike<number>, flash = 0, scale = 1, shade = 1,
    prevRow = 0, blend = 0): void {
    if (this.count >= this.cap) this.grow(this.cap * 2);
    const i = this.count++;
    const { aInst, aAnim, aTint, aBlend } = this.data;
    let o = i * 4;
    aInst[o] = x;
    aInst[o + 1] = y;
    aInst[o + 2] = z;
    aInst[o + 3] = yaw;
    aAnim[o] = row;
    aAnim[o + 1] = flash;
    aAnim[o + 2] = scale;
    aAnim[o + 3] = shade;
    o = i * 3;
    aTint[o] = tint[0];
    aTint[o + 1] = tint[1];
    aTint[o + 2] = tint[2];
    o = i * 2;
    aBlend[o] = prevRow;
    aBlend[o + 1] = blend;
  }

  end(): void {
    this.geo.instanceCount = this.count;
    this.mesh.visible = this.count > 0;
    for (const k of Object.keys(ATTRS) as AttrName[]) {
      const a = this.geo.getAttribute(k) as THREE.InstancedBufferAttribute;
      a.clearUpdateRanges();
      a.addUpdateRange(0, this.count * ATTRS[k]);
      a.needsUpdate = true;
    }
  }

  dispose(): void {
    this.geo.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.customDepthMaterial?.dispose();
    this.model.geometry.dispose();
    this.model.bones.dispose();
  }
}
