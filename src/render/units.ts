/** 单位绘制：每个（队伍，兵种）一批，实例属性给出位置、朝向与动画行 */
import * as THREE from 'three';
import { unitMaterials } from './materials';
import { Clip, UnitModel } from './rig';

export class UnitBatch {
  readonly mesh: THREE.Mesh;
  count = 0;
  private cap = 0;
  private inst = new Float32Array(0);
  private anim = new Float32Array(0);
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
    const inst = new Float32Array(cap * 4), anim = new Float32Array(cap * 4);
    inst.set(this.inst);
    anim.set(this.anim);
    this.inst = inst;
    this.anim = anim;
    this.cap = cap;
    const a = new THREE.InstancedBufferAttribute(inst, 4), b = new THREE.InstancedBufferAttribute(anim, 4);
    a.setUsage(THREE.DynamicDrawUsage);
    b.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('aInst', a);
    this.geo.setAttribute('aAnim', b);
  }

  begin(): void {
    this.count = 0;
  }

  /** @param phase 动画进度 0..1 */
  add(x: number, y: number, z: number, yaw: number, clip: Clip, phase: number, flash = 0, scale = 1, shade = 1): void {
    if (this.count >= this.cap) this.grow(this.cap * 2);
    const o = this.count++ * 4;
    const f = phase <= 0 ? 0 : phase >= 1 ? clip.n - 1 : (phase * clip.n) | 0;
    this.inst[o] = x;
    this.inst[o + 1] = y;
    this.inst[o + 2] = z;
    this.inst[o + 3] = yaw;
    this.anim[o] = clip.start + f;
    this.anim[o + 1] = flash;
    this.anim[o + 2] = scale;
    this.anim[o + 3] = shade;
  }

  end(): void {
    this.geo.instanceCount = this.count;
    this.mesh.visible = this.count > 0;
    for (const k of ['aInst', 'aAnim']) {
      const a = this.geo.getAttribute(k) as THREE.InstancedBufferAttribute;
      a.clearUpdateRanges();
      a.addUpdateRange(0, this.count * 4);
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
