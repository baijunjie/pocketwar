/** 立体地形：格子数据 → 高度场网格；地表颜色仍由片元着色器按权重图程序化生成 */
import * as THREE from 'three';
import {
  T_BRIDGE, T_DEEP, T_FARM, T_FOREST, T_HILL, T_MOUNTAIN, T_ROAD, T_SHALLOW, TILE,
} from '../sim/defs';
import { GameMap } from '../sim/map';
import { shared } from './materials';

export const WATER_Y = -3.2;

const COLOR_FS = `
uniform sampler2D uA, uB;
uniform float uSnow;
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
}
float fbm(vec2 p){ return noise(p)*0.5 + noise(p*2.03)*0.3 + noise(p*4.1)*0.2; }
vec3 groundColor(vec3 w3){
  vec2 wp = w3.xz;
  vec2 warp = vec2(noise(wp*0.03), noise(wp*0.03 + 31.7)) - 0.5;
  vec2 uv = (wp + warp * 22.0) / uMap;
  vec4 a = texture2D(uA, uv), b = texture2D(uB, uv);
  float n1 = fbm(wp * 0.02), n2 = noise(wp * 0.35), n3 = noise(wp * 0.09 + 7.0);
  vec3 col = mix(vec3(0.33,0.50,0.20), vec3(0.46,0.60,0.25), n1);
  col = mix(col, vec3(0.55,0.62,0.30), smoothstep(0.55, 0.85, n3) * 0.45);
  vec3 forest = mix(vec3(0.20,0.34,0.15), vec3(0.27,0.42,0.18), n1);
  vec3 hill = mix(vec3(0.50,0.56,0.28), vec3(0.60,0.61,0.35), n1);
  vec3 rock = mix(vec3(0.47,0.45,0.42), vec3(0.66,0.64,0.60), n3);
  vec3 dirt = mix(vec3(0.60,0.50,0.35), vec3(0.68,0.58,0.42), n3);
  vec3 road = mix(vec3(0.66,0.56,0.39), vec3(0.74,0.65,0.48), n2);
  float fs = step(0.5, fract((wp.y + sin(wp.x * 0.02) * 3.0) / 7.0));
  vec3 farm = mix(vec3(0.70,0.63,0.29), vec3(0.55,0.59,0.25), fs);
  col = mix(col, forest, smoothstep(0.15, 0.7, a.r + (n3 - 0.5) * 0.3));
  col = mix(col, hill, smoothstep(0.2, 0.8, a.g + (n3 - 0.5) * 0.3));
  col = mix(col, rock, smoothstep(0.25, 0.75, a.b + (n2 - 0.5) * 0.2));
  col = mix(col, farm, smoothstep(0.4, 0.6, b.g));
  col = mix(col, dirt, b.a * 0.9 * (0.75 + 0.25 * n3));
  col = mix(col, road, smoothstep(0.3, 0.6, b.r + (n3 - 0.5) * 0.25));
  col *= 0.92 + 0.16 * n2;
  // 积雪：先从草地白起，路面和夯土踩得多，白得慢一些
  float tracks = max(smoothstep(0.3, 0.6, b.r), b.a * 0.7);
  col = mix(col, vec3(0.86, 0.89, 0.94) * (0.94 + 0.06 * n2), clamp(uSnow * (1.15 - 0.45 * tracks) - 0.25 * n3 * (1.0 - uSnow), 0.0, 0.9));
  // 岸边沙土与水下河床
  float shore = smoothstep(1.5, -1.5, w3.y);
  col = mix(col, vec3(0.74,0.68,0.50), shore * step(0.02, a.a));
  col = mix(col, vec3(0.30,0.36,0.30), smoothstep(-3.0, -9.0, w3.y));
  return col * col; // 近似转到线性空间
}
`;

const WATER_VS = `
varying vec3 vWorld;
void main(){
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const WATER_FS = `
uniform sampler2D uFog, uA;
uniform vec2 uMap;
uniform float uFogOn, uTime;
varying vec3 vWorld;
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
}
void main(){
  vec2 wp = vWorld.xz;
  vec2 uv = wp / uMap;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) discard;
  float wd = texture2D(uA, uv).a;
  if (wd < 0.02) discard;
  float wv = noise(wp * 0.05 + vec2(uTime * 0.35, uTime * 0.2)) * 0.5 + noise(wp * 0.12 - vec2(uTime * 0.3, 0.0)) * 0.5;
  vec3 col = mix(vec3(0.36,0.66,0.68), vec3(0.10,0.31,0.50), smoothstep(0.3, 0.85, wd));
  col += (wv - 0.5) * 0.12;
  float glint = smoothstep(0.78, 0.9, noise(wp * 0.22 + vec2(uTime * 0.6, -uTime * 0.4)));
  col += glint * 0.16;
  float v = texture2D(uFog, uv).r;
  float k = v < 0.55 ? mix(0.44, 0.68, v / 0.55) : mix(0.68, 1.0, (v - 0.55) / 0.45);
  col *= mix(1.0, k, uFogOn);
  gl_FragColor = vec4(col, mix(0.55, 0.9, smoothstep(0.3, 0.9, wd)));
}`;

export class Terrain {
  readonly mesh: THREE.Mesh;
  readonly water: THREE.Mesh;
  /** 小地图用的地形底色（每格 RGB） */
  readonly miniColors: Uint8ClampedArray;
  /** 顶点高度，(w+1)×(h+1) */
  private readonly hv: Float32Array;
  private readonly vw1: number;
  private readonly fogData: Uint8Array<ArrayBuffer>;
  private readonly fogCur: Float32Array;
  private readonly fogTex: THREE.DataTexture;
  private readonly texA: THREE.DataTexture;
  private readonly texB: THREE.DataTexture;

  constructor(private readonly map: GameMap, private readonly fogW: number, private readonly fogH: number,
    flat: { tx: number; ty: number; w: number; h: number }[]) {
    const { w, h, terrain, height, dirt } = map;
    const n = w * h;
    // ---- 每格海拔 ----
    let elev: Float32Array = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = terrain[i], hg = height[i];
      elev[i] = t === T_DEEP || t === T_BRIDGE ? -15 : t === T_SHALLOW ? -6.5
        : t === T_MOUNTAIN ? 62 + hg * 90 : t === T_HILL ? 16 + hg * 22 : hg * 10;
    }
    const blurF = (src: Float32Array, keepWater: boolean): Float32Array => {
      const out = new Float32Array(n);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let s = 0, c = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const k = dx === 0 && dy === 0 ? 4 : dx === 0 || dy === 0 ? 2 : 1;
          s += src[yy * w + xx] * k;
          c += k;
        }
        const i = y * w + x;
        // 水面以下保持原深度，免得把河床抹平露出水面
        out[i] = keepWater && src[i] < 0 ? Math.min(src[i], s / c) : s / c;
      }
      return out;
    };
    elev = blurF(blurF(elev, true), true);
    // 建筑脚下铲平
    for (const f of flat) {
      let s = 0, c = 0;
      for (let y = f.ty; y < f.ty + f.h; y++) for (let x = f.tx; x < f.tx + f.w; x++) {
        s += elev[y * w + x];
        c++;
      }
      const lv = Math.max(0.5, s / c);
      for (let y = f.ty; y < f.ty + f.h; y++) for (let x = f.tx; x < f.tx + f.w; x++) elev[y * w + x] = lv;
    }
    // ---- 顶点高度：相邻四格取平均 ----
    const vw1 = (this.vw1 = w + 1), vh1 = h + 1;
    const hv = (this.hv = new Float32Array(vw1 * vh1));
    for (let y = 0; y < vh1; y++) for (let x = 0; x < vw1; x++) {
      let s = 0, c = 0;
      for (let dy = -1; dy <= 0; dy++) for (let dx = -1; dx <= 0; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        s += elev[yy * w + xx];
        c++;
      }
      hv[y * vw1 + x] = s / c;
    }
    const pos = new Float32Array(vw1 * vh1 * 3);
    for (let y = 0; y < vh1; y++) for (let x = 0; x < vw1; x++) {
      const o = (y * vw1 + x) * 3;
      pos[o] = x * TILE;
      pos[o + 1] = hv[y * vw1 + x];
      pos[o + 2] = y * TILE;
    }
    const idx = new Uint32Array(w * h * 6);
    let k = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const a = y * vw1 + x, b = a + 1, c = a + vw1, d = c + 1;
      idx[k++] = a;
      idx[k++] = c;
      idx[k++] = b;
      idx[k++] = b;
      idx[k++] = c;
      idx[k++] = d;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();

    // ---- 权重图 ----
    const forest = new Float32Array(n), hill = new Float32Array(n), mount = new Float32Array(n), water = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = terrain[i];
      forest[i] = t === T_FOREST ? 1 : 0;
      hill[i] = t === T_HILL ? 1 : t === T_MOUNTAIN ? 0.6 : 0;
      mount[i] = t === T_MOUNTAIN ? 1 : 0;
      water[i] = t === T_DEEP || t === T_BRIDGE ? 1 : t === T_SHALLOW ? 0.42 : 0;
    }
    const bf = blurF(forest, false), bh = blurF(hill, false), bm = blurF(mount, false), bw = blurF(water, false);
    const A = new Uint8Array(n * 4), B = new Uint8Array(n * 4);
    const mini = (this.miniColors = new Uint8ClampedArray(n * 4));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, o = i * 4;
      const t = terrain[i];
      const bridge = t === T_BRIDGE;
      A[o] = bf[i] * 255;
      A[o + 1] = bh[i] * 255;
      A[o + 2] = bm[i] * 255;
      A[o + 3] = bw[i] * 255;
      B[o] = t === T_ROAD ? 255 : 0;
      B[o + 1] = t === T_FARM ? 255 : 0;
      B[o + 3] = dirt[i];
      const x0 = Math.max(0, x - 1), x1 = Math.min(w - 1, x + 1), y0 = Math.max(0, y - 1), y1 = Math.min(h - 1, y + 1);
      const sh = Math.max(0, Math.min(1, 0.5 + (elev[y0 * w + x0] - elev[y1 * w + x1]) * 0.012));
      const kk = 0.7 + sh * 0.6;
      const c = t === T_DEEP ? [34, 78, 112] : t === T_SHALLOW ? [78, 140, 150] : t === T_FOREST ? [50, 86, 42]
        : t === T_HILL ? [140, 138, 86] : t === T_MOUNTAIN ? [128, 124, 118] : t === T_ROAD || bridge ? [170, 148, 106]
        : t === T_FARM ? [160, 150, 74] : dirt[i] > 100 ? [140, 122, 90] : [96, 132, 62];
      mini[o] = c[0] * kk;
      mini[o + 1] = c[1] * kk;
      mini[o + 2] = c[2] * kk;
      mini[o + 3] = 255;
    }
    const tex = (d: Uint8Array<ArrayBuffer>): THREE.DataTexture => {
      const t = new THREE.DataTexture(d, w, h, THREE.RGBAFormat);
      t.magFilter = t.minFilter = THREE.LinearFilter;
      t.needsUpdate = true;
      return t;
    };
    this.texA = tex(A);
    this.texB = tex(B);

    this.fogData = new Uint8Array(fogW * fogH).fill(255);
    this.fogCur = new Float32Array(fogW * fogH).fill(1);
    this.fogTex = new THREE.DataTexture(this.fogData, fogW, fogH, THREE.RedFormat);
    this.fogTex.magFilter = this.fogTex.minFilter = THREE.LinearFilter;
    this.fogTex.needsUpdate = true;
    shared.uFog.value = this.fogTex;
    shared.uMap.value.set(w * TILE, h * TILE);

    const mat = new THREE.MeshLambertMaterial();
    const uni = { uA: { value: this.texA }, uB: { value: this.texB } };
    mat.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, shared, uni);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWorld;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWorld = position;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform sampler2D uFog; uniform vec2 uMap; uniform float uFogOn; varying vec3 vWorld;\n${COLOR_FS}`)
        .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4(groundColor(vWorld), 1.0);')
        .replace('#include <dithering_fragment>', `#include <dithering_fragment>
          float fv = texture2D(uFog, clamp(vWorld.xz / uMap, 0.0, 1.0)).r;
          float fk = fv < 0.55 ? mix(0.44, 0.68, fv / 0.55) : mix(0.68, 1.0, (fv - 0.55) / 0.45);
          fk = mix(1.0, fk, uFogOn);
          gl_FragColor.rgb = mix(vec3(0.10, 0.12, 0.17), gl_FragColor.rgb * fk, 0.7 + 0.3 * fk);`);
    };
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;

    const wg = new THREE.PlaneGeometry(w * TILE, h * TILE);
    wg.rotateX(-Math.PI / 2);
    wg.translate((w * TILE) / 2, WATER_Y, (h * TILE) / 2);
    this.water = new THREE.Mesh(wg, new THREE.ShaderMaterial({
      vertexShader: WATER_VS, fragmentShader: WATER_FS, transparent: true, depthWrite: false,
      uniforms: { ...shared, uA: uni.uA },
    }));
    this.water.renderOrder = 1;
    this.water.frustumCulled = false;
  }

  /** 世界坐标处的地表高度（双线性插值） */
  heightAt(x: number, z: number): number {
    const w = this.map.w, h = this.map.h;
    let fx = x / TILE, fz = z / TILE;
    fx = fx < 0 ? 0 : fx > w - 0.001 ? w - 0.001 : fx;
    fz = fz < 0 ? 0 : fz > h - 0.001 ? h - 0.001 : fz;
    const ix = fx | 0, iz = fz | 0;
    const tx = fx - ix, tz = fz - iz;
    const o = iz * this.vw1 + ix, hv = this.hv;
    const a = hv[o] + (hv[o + 1] - hv[o]) * tx;
    const b = hv[o + this.vw1] + (hv[o + this.vw1 + 1] - hv[o + this.vw1]) * tx;
    return a + (b - a) * tz;
  }

  /** 迷雾：0 未探索 / 0.55 已探索 / 1 可见，随时间平滑过渡 */
  updateFog(on: boolean, vis: Uint8Array, explored: Uint8Array, dt: number): void {
    shared.uFogOn.value = on ? 1 : 0;
    if (!on) return;
    const cur = this.fogCur, data = this.fogData;
    const k = Math.min(1, dt * 5);
    for (let i = 0; i < cur.length; i++) {
      const target = vis[i] ? 1 : explored[i] ? 0.55 : 0;
      cur[i] += (target - cur[i]) * k;
    }
    const fw = this.fogW, fh = this.fogH;
    for (let y = 0; y < fh; y++) {
      const ya = y > 0 ? -fw : 0, yb = y < fh - 1 ? fw : 0;
      for (let x = 0; x < fw; x++) {
        const i = y * fw + x;
        const xa = x > 0 ? -1 : 0, xb = x < fw - 1 ? 1 : 0;
        const s = cur[i] * 4 + (cur[i + xa] + cur[i + xb] + cur[i + ya] + cur[i + yb]) * 2
          + cur[i + ya + xa] + cur[i + ya + xb] + cur[i + yb + xa] + cur[i + yb + xb];
        data[i] = s * 15.9375;
      }
    }
    this.fogTex.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.water.geometry.dispose();
    this.texA.dispose();
    this.texB.dispose();
    this.fogTex.dispose();
  }
}
