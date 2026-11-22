/** 模型素材：加载 glTF，并把调色板贴图烘成顶点色，统一成「位置 + 法线 + 顶点色」的几何体 */
import * as THREE from 'three';
import { GLTF, GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const cache = new Map<string, GLTF>();
const pixels = new Map<unknown, ImageData>();
let pending: Promise<void> | null = null;

function manifest(): string[] {
  return ['quaternius/horse.glb'];
}

/** 预加载全部模型；可重复调用 */
export function loadAssets(onProgress?: (done: number, total: number) => void): Promise<void> {
  if (pending) return pending;
  const loader = new GLTFLoader();
  const list = manifest();
  let done = 0;
  pending = Promise.all(list.map(async p => {
    cache.set(p, await loader.loadAsync(`${import.meta.env.BASE_URL}assets/${p}`));
    onProgress?.(++done, list.length);
  })).then(() => undefined);
  return pending;
}

export function asset(path: string): GLTF {
  const g = cache.get(path);
  if (!g) throw new Error(`模型未加载：${path}`);
  return g;
}

function imageData(img: unknown): ImageData {
  let d = pixels.get(img);
  if (!d) {
    const src = img as ImageBitmap;
    const cv = document.createElement('canvas');
    cv.width = src.width;
    cv.height = src.height;
    const c = cv.getContext('2d', { willReadFrequently: true })!;
    c.drawImage(src, 0, 0);
    d = c.getImageData(0, 0, cv.width, cv.height);
    pixels.set(img, d);
  }
  return d;
}

const tmpColor = new THREE.Color();

/** 取出网格的几何体副本（未变换），附带线性空间顶点色；去掉贴图坐标等无关属性 */
export function coloredGeometry(mesh: THREE.Mesh): THREE.BufferGeometry {
  const src = mesh.geometry;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', src.getAttribute('position').clone());
  let nor = src.getAttribute('normal');
  if (!nor) {
    src.computeVertexNormals();
    nor = src.getAttribute('normal');
  }
  g.setAttribute('normal', nor.clone());
  for (const k of ['skinIndex', 'skinWeight']) {
    const a = src.getAttribute(k);
    if (a) g.setAttribute(k, a.clone());
  }
  const n = g.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const uv = src.getAttribute('uv');
  const paint = (mat: THREE.Material, from: number, to: number, index: THREE.BufferAttribute | null): void => {
    const m = mat as THREE.MeshStandardMaterial;
    const img = m.map ? imageData(m.map.image) : null;
    for (let k = from; k < to; k++) {
      const v = index ? index.getX(k) : k;
      if (img && uv) {
        let u = uv.getX(v), w = uv.getY(v);
        u -= Math.floor(u);
        w -= Math.floor(w);
        const px = Math.min(img.width - 1, (u * img.width) | 0), py = Math.min(img.height - 1, (w * img.height) | 0);
        const o = (py * img.width + px) * 4;
        tmpColor.setRGB(img.data[o] / 255, img.data[o + 1] / 255, img.data[o + 2] / 255, THREE.SRGBColorSpace);
        tmpColor.multiply(m.color);
      } else tmpColor.copy(m.color);
      col[v * 3] = tmpColor.r;
      col[v * 3 + 1] = tmpColor.g;
      col[v * 3 + 2] = tmpColor.b;
    }
  };
  const index = src.getIndex();
  if (src.groups.length && mats.length > 1) {
    for (const gr of src.groups) paint(mats[gr.materialIndex ?? 0], gr.start, gr.start + gr.count, index);
  } else paint(mats[0], 0, index ? index.count : n, index);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (index) g.setIndex(index.clone());
  return g;
}

/** 合并若干几何体（要求属性集合一致），统一转成非索引以便拼接 */
export function mergeGeometries(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const parts = list.map(g => (g.getIndex() ? g.toNonIndexed() : g));
  const out = new THREE.BufferGeometry();
  const names = Object.keys(parts[0].attributes);
  for (const name of names) {
    const size = parts[0].getAttribute(name).itemSize;
    let total = 0;
    for (const p of parts) total += p.getAttribute(name).count;
    const arr = new Float32Array(total * size);
    let o = 0;
    for (const p of parts) {
      const a = p.getAttribute(name);
      for (let i = 0; i < a.count; i++) for (let k = 0; k < size; k++) arr[o++] = a.getComponent(i, k);
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  return out;
}

export type Recolor = (c: THREE.Color, x: number, y: number, z: number) => void;

/** 改写几何体的顶点色（坐标为几何体自身的局部坐标） */
export function recolor(g: THREE.BufferGeometry, fn: Recolor): THREE.BufferGeometry {
  const col = g.getAttribute('color') as THREE.BufferAttribute, pos = g.getAttribute('position');
  for (let i = 0; i < col.count; i++) {
    tmpColor.fromBufferAttribute(col, i);
    fn(tmpColor, pos.getX(i), pos.getY(i), pos.getZ(i));
    col.setXYZ(i, tmpColor.r, tmpColor.g, tmpColor.b);
  }
  return g;
}
