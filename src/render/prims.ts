/** 代码生成的基本体（带顶点色），用来补素材包里没有的部件 */
import * as THREE from 'three';
import { mergeGeometries } from './assets';

export type Col = THREE.ColorRepresentation;

function paint(g: THREE.BufferGeometry, color: Col): THREE.BufferGeometry {
  const out = g.getIndex() ? g.toNonIndexed() : g;
  out.deleteAttribute('uv');
  const c = new THREE.Color(color);
  const n = out.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}

/** 长方体：中心在 (x, y, z) */
export function box(w: number, h: number, d: number, color: Col, x = 0, y = 0, z = 0): THREE.BufferGeometry {
  return paint(new THREE.BoxGeometry(w, h, d).translate(x, y, z), color);
}

/** 圆柱/圆台：沿 Y 轴，中心在 (x, y, z) */
export function cyl(rTop: number, rBot: number, h: number, color: Col, x = 0, y = 0, z = 0, seg = 8): THREE.BufferGeometry {
  return paint(new THREE.CylinderGeometry(rTop, rBot, h, seg).translate(x, y, z), color);
}

/** 不封口的圆管：肢体、杆子等两端看不见的地方用，省面数 */
export function tube(rTop: number, rBot: number, h: number, color: Col, x = 0, y = 0, z = 0, seg = 6): THREE.BufferGeometry {
  return paint(new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, true).translate(x, y, z), color);
}

export function cone(r: number, h: number, color: Col, x = 0, y = 0, z = 0, seg = 8): THREE.BufferGeometry {
  return paint(new THREE.ConeGeometry(r, h, seg).translate(x, y, z), color);
}

export function ball(r: number, color: Col, x = 0, y = 0, z = 0, seg = 6): THREE.BufferGeometry {
  return paint(new THREE.SphereGeometry(r, seg, Math.max(4, seg - 2)).translate(x, y, z), color);
}

export function xf(g: THREE.BufferGeometry, opts: { rx?: number; ry?: number; rz?: number; s?: number | [number, number, number];
  t?: [number, number, number] }): THREE.BufferGeometry {
  if (opts.s !== undefined) {
    const s = typeof opts.s === 'number' ? [opts.s, opts.s, opts.s] : opts.s;
    g.scale(s[0], s[1], s[2]);
  }
  if (opts.rx) g.rotateX(opts.rx);
  if (opts.ry) g.rotateY(opts.ry);
  if (opts.rz) g.rotateZ(opts.rz);
  if (opts.t) g.translate(opts.t[0], opts.t[1], opts.t[2]);
  return g;
}

export function join(...parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  return mergeGeometries(parts.map(p => {
    const g = p.getIndex() ? p.toNonIndexed() : p;
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') g.deleteAttribute(k);
    return g;
  }));
}
