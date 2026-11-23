/** 实例化四边形：贴地标记、朝向镜头的粒子与血条、屏幕尺寸的文字、沿轴拉伸的箭矢 */
import * as THREE from 'three';

export interface Sprite {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  w: number;
  h: number;
}

/** 简单的搁架式贴图集 */
export class Atlas {
  readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private x = 2;
  private y = 2;
  private rowH = 0;
  texture: THREE.CanvasTexture | null = null;

  constructor(readonly size = 1024) {
    this.canvas.width = this.canvas.height = size;
    this.ctx = this.canvas.getContext('2d')!;
  }

  add(w: number, h: number, scale: number, draw: (c: CanvasRenderingContext2D) => void): Sprite {
    const pw = Math.ceil(w * scale), ph = Math.ceil(h * scale);
    if (this.x + pw + 2 > this.size) {
      this.x = 2;
      this.y += this.rowH + 2;
      this.rowH = 0;
    }
    const c = this.ctx;
    c.save();
    c.translate(this.x, this.y);
    c.scale(scale, scale);
    draw(c);
    c.restore();
    const s = { u0: this.x / this.size, v0: this.y / this.size, u1: (this.x + pw) / this.size, v1: (this.y + ph) / this.size, w, h };
    this.x += pw + 2;
    this.rowH = Math.max(this.rowH, ph);
    return s;
  }

  finish(): THREE.CanvasTexture {
    const t = new THREE.CanvasTexture(this.canvas);
    t.flipY = false;
    t.premultiplyAlpha = true;
    t.colorSpace = THREE.SRGBColorSpace;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    this.texture = t;
    return t;
  }
}

export const Q_BILLBOARD = 0, Q_GROUND = 1, Q_SCREEN = 2, Q_AXIS = 3;

const VS = `
attribute vec3 aPos;
attribute vec4 aSize;  // 宽, 高, 锚点 x, 锚点 y
attribute vec4 aUV;
attribute vec4 aColor;
attribute vec4 aAxis;  // 模式 1：x 为绕 Y 的旋转；模式 3：xyz 为轴向。w 为模式
uniform vec2 uView;
varying vec2 vUV;
varying vec4 vColor;
void main(){
  vec2 c = uv - aSize.zw;
  vec2 sz = aSize.xy;
  int mode = int(aAxis.w + 0.5);
  vec4 clip;
  if (mode == 1) {
    float cs = cos(aAxis.x), sn = sin(aAxis.x);
    vec2 l = c * sz;
    vec3 p = aPos + vec3(l.x * cs - l.y * sn, 0.0, l.x * sn + l.y * cs);
    clip = projectionMatrix * viewMatrix * vec4(p, 1.0);
  } else if (mode == 2) {
    clip = projectionMatrix * viewMatrix * vec4(aPos, 1.0);
    clip.xy += c * sz / uView * 2.0 * clip.w * vec2(1.0, -1.0);
  } else if (mode == 3) {
    vec3 ax = normalize(aAxis.xyz);
    vec3 side = normalize(cross(ax, cameraPosition - aPos));
    vec3 p = aPos + ax * c.x * sz.x + side * c.y * sz.y;
    clip = projectionMatrix * viewMatrix * vec4(p, 1.0);
  } else {
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    vec3 p = aPos + right * c.x * sz.x - up * c.y * sz.y;
    clip = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }
  gl_Position = clip;
  vUV = mix(aUV.xy, aUV.zw, uv);
  vColor = aColor;
}`;
const FS = `
uniform sampler2D uTex;
varying vec2 vUV;
varying vec4 vColor;
void main(){
  vec4 t = texture2D(uTex, vUV);
  gl_FragColor = t * vColor;
  if (gl_FragColor.a < 0.004) discard;
}`;

const STRIDE = 19;

export class Quads {
  readonly mesh: THREE.Mesh;
  private data: Float32Array;
  private buf: THREE.InstancedInterleavedBuffer;
  private readonly geo = new THREE.InstancedBufferGeometry();
  private cap: number;
  n = 0;
  readonly uniforms: { uTex: THREE.IUniform; uView: THREE.IUniform<THREE.Vector2> };

  /** @param ground 贴地层：在不透明队列里紧跟地形绘制，不做深度测试 */
  /** @param opts.lift 贴在桥面、墙顶这类模型表面上的标记：做深度测试，并用深度偏移避免与表面打架 */
  constructor(tex: THREE.Texture, opts: { ground?: boolean; overlay?: boolean; lift?: boolean } = {}, cap = 1024) {
    this.cap = cap;
    this.data = new Float32Array(cap * STRIDE);
    this.geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]), 3));
    this.geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), 2));
    this.geo.setIndex([0, 2, 1, 1, 2, 3]);
    this.buf = this.bindBuffer();
    this.uniforms = { uTex: { value: tex }, uView: { value: new THREE.Vector2(1, 1) } };
    const mat = new THREE.ShaderMaterial({
      vertexShader: VS, fragmentShader: FS, uniforms: this.uniforms, side: THREE.DoubleSide,
      depthWrite: false, depthTest: !opts.ground && !opts.overlay,
      transparent: !opts.ground,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    if (opts.lift) {
      mat.polygonOffset = true;
      mat.polygonOffsetFactor = -4;
      mat.polygonOffsetUnits = -8;
    }
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = opts.ground ? -1 : opts.overlay ? 20 : opts.lift ? 9 : 10;
  }

  private bindBuffer(): THREE.InstancedInterleavedBuffer {
    const b = new THREE.InstancedInterleavedBuffer(this.data, STRIDE);
    b.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('aPos', new THREE.InterleavedBufferAttribute(b, 3, 0));
    this.geo.setAttribute('aSize', new THREE.InterleavedBufferAttribute(b, 4, 3));
    this.geo.setAttribute('aUV', new THREE.InterleavedBufferAttribute(b, 4, 7));
    this.geo.setAttribute('aColor', new THREE.InterleavedBufferAttribute(b, 4, 11));
    this.geo.setAttribute('aAxis', new THREE.InterleavedBufferAttribute(b, 4, 15));
    return b;
  }

  begin(): void {
    this.n = 0;
  }

  /** 颜色为显示空间的非预乘值；ax, ay 为锚点（0..1） */
  add(mode: number, s: Sprite, x: number, y: number, z: number, w: number, h: number, r: number, g: number, b: number, a: number,
    ax = 0.5, ay = 0.5, p0 = 0, p1 = 0, p2 = 0): void {
    if (this.n >= this.cap) {
      this.cap *= 2;
      const d = new Float32Array(this.cap * STRIDE);
      d.set(this.data);
      this.data = d;
      this.buf = this.bindBuffer();
    }
    const d = this.data, o = this.n++ * STRIDE;
    d[o] = x;
    d[o + 1] = y;
    d[o + 2] = z;
    d[o + 3] = w;
    d[o + 4] = h;
    d[o + 5] = ax;
    d[o + 6] = ay;
    d[o + 7] = s.u0;
    d[o + 8] = s.v0;
    d[o + 9] = s.u1;
    d[o + 10] = s.v1;
    d[o + 11] = r * a;
    d[o + 12] = g * a;
    d[o + 13] = b * a;
    d[o + 14] = a;
    d[o + 15] = p0;
    d[o + 16] = p1;
    d[o + 17] = p2;
    d[o + 18] = mode;
  }

  end(viewW: number, viewH: number): void {
    this.geo.instanceCount = this.n;
    this.mesh.visible = this.n > 0;
    this.uniforms.uView.value.set(viewW, viewH);
    this.buf.clearUpdateRanges();
    this.buf.addUpdateRange(0, this.n * STRIDE);
    this.buf.needsUpdate = true;
  }

  dispose(): void {
    this.geo.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
