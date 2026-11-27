import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { asset, coloredGeometry, luma, mergeGeometries, recolor } from '../../src/render/assets';
import { markTeam } from '../../src/render/rig';

afterEach(() => vi.unstubAllGlobals());

function mat(name: string, r: number, g: number, b: number): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial();
  m.name = name;
  m.color.setRGB(r, g, b);
  return m;
}

/** 一个三角形，位置给定，没有法线 */
function tri(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
  return g;
}

const colors = (g: THREE.BufferGeometry): number[][] => {
  const c = g.getAttribute('color');
  return Array.from({ length: c.count }, (_, i) => [c.getX(i), c.getY(i), c.getZ(i)]);
};

describe('luma', () => {
  it('线性空间明度：0.2126 R + 0.7152 G + 0.0722 B', () => {
    expect(luma(new THREE.Color(1, 1, 1))).toBeCloseTo(1, 6);
    expect(luma(new THREE.Color(0, 0, 0))).toBe(0);
    expect(luma(new THREE.Color(1, 0, 0))).toBeCloseTo(0.2126, 6);
    expect(luma(new THREE.Color(0, 1, 0))).toBeCloseTo(0.7152, 6);
    expect(luma(new THREE.Color(0, 0, 1))).toBeCloseTo(0.0722, 6);
  });
});

describe('asset', () => {
  it('没加载过的素材抛错并带路径', () => {
    expect(() => asset('units/none.glb')).toThrow(/units\/none\.glb/);
  });
});

describe('coloredGeometry', () => {
  it('只留位置、法线、顶点色，去掉贴图坐标等；没有法线时现算', () => {
    const g = tri();
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(6), 2));
    const out = coloredGeometry(new THREE.Mesh(g, mat('skin', 0.8, 0.5, 0.3)));
    expect(Object.keys(out.attributes).sort()).toEqual(['color', 'normal', 'position']);
    expect(out.getAttribute('normal').getZ(0)).toBeCloseTo(1, 6);
    expect(out.getAttribute('position')).not.toBe(g.getAttribute('position'));
  });

  it('蒙皮属性与索引保留', () => {
    const g = tri();
    g.setIndex([0, 1, 2]);
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Array(12).fill(0), 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
    const out = coloredGeometry(new THREE.Mesh(g, mat('skin', 0.8, 0.5, 0.3)));
    expect(out.getAttribute('skinIndex')).toBeDefined();
    expect(out.getAttribute('skinWeight')).toBeDefined();
    expect(out.getIndex()!.count).toBe(3);
  });

  it('没有贴图时顶点色就是材质颜色（线性）', () => {
    const out = coloredGeometry(new THREE.Mesh(tri(), mat('metal', 0.8, 0.5, 0.3)));
    for (const c of colors(out)) {
      expect(c[0]).toBeCloseTo(0.8, 6);
      expect(c[1]).toBeCloseTo(0.5, 6);
      expect(c[2]).toBeCloseTo(0.3, 6);
    }
  });

  it('team 开头的材质（不分大小写）：颜色换成按明度缩放的队伍色标记 (l, 0, l)', () => {
    for (const name of ['team_cloth', 'Team', 'TEAM_cape']) {
      const m = mat(name, 0.9, 0.8, 0.7);
      const out = coloredGeometry(new THREE.Mesh(tri(), m));
      const l = luma(m.color);
      for (const c of colors(out)) {
        expect(c[0], name).toBeCloseTo(l, 6);
        expect(c[1], name).toBe(0);
        expect(c[2], name).toBeCloseTo(l, 6);
      }
    }
  });

  it('team 材质太暗时明度不低于 1e-4，仍能被识别', () => {
    const out = coloredGeometry(new THREE.Mesh(tri(), mat('team_x', 0, 0, 0)));
    expect(colors(out)[0][0]).toBeCloseTo(1e-4, 8);
    markTeam(out);
    expect(out.getAttribute('aTeam').getX(0)).toBe(1);
  });

  it('名字里带 team 但不是开头的材质不算队伍色', () => {
    const out = coloredGeometry(new THREE.Mesh(tri(), mat('steam_pipe', 0.5, 0.4, 0.3)));
    expect(colors(out)[0][1]).toBeCloseTo(0.4, 6);
  });

  it('真实颜色的绿分量正好为 0 时抬成 1e-6，不会被当成队伍色标记；红、蓝不变', () => {
    for (const [r, b] of [[0.5, 0.5], [1, 1], [0.2, 0.2]]) {
      const out = coloredGeometry(new THREE.Mesh(tri(), mat('cloth', r, 0, b)));
      const c = colors(out)[0];
      expect(c[0]).toBeCloseTo(r, 6);
      expect(c[1]).toBeGreaterThan(0);
      expect(c[1]).toBeLessThan(1e-4);
      expect(c[2]).toBeCloseTo(b, 6);
      markTeam(out);
      expect(out.getAttribute('aTeam').getX(0), `${r},0,${b}`).toBe(0);
    }
  });

  it('绿分量不为 0 的真实颜色原样不动', () => {
    const out = coloredGeometry(new THREE.Mesh(tri(), mat('cloth', 0.5, 0.01, 0.5)));
    expect(colors(out)[0][1]).toBeCloseTo(0.01, 7);
  });

  it('多材质按 groups 分段上色', () => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(18), 3));
    g.addGroup(0, 3, 0);
    g.addGroup(3, 3, 1);
    const out = coloredGeometry(new THREE.Mesh(g, [mat('metal', 0.5, 0.5, 0.5), mat('team_cloth', 0.6, 0.6, 0.6)]));
    const c = colors(out);
    expect(c[0][1]).toBeCloseTo(0.5, 6);
    expect(c[2][1]).toBeCloseTo(0.5, 6);
    expect(c[3][1]).toBe(0);
    expect(c[5][1]).toBe(0);
  });

  it('贴图：按 uv（含超出 0..1 的重复）取像素、sRGB 转线性并乘上材质颜色', () => {
    // 2 × 1 的贴图：左红 (255,0,0)，右灰 (128,128,128)
    const data = new Uint8ClampedArray([255, 0, 0, 255, 128, 128, 128, 255]);
    vi.stubGlobal('document', {
      createElement: () => ({
        width: 0, height: 0,
        getContext: () => ({ drawImage() {}, getImageData: () => ({ width: 2, height: 1, data }) }),
      }),
    });
    const g = tri();
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0.25, 0.5, 0.75, 0.5, 1.75, 0.5]), 2));
    const m = mat('skin', 1, 1, 1);
    m.map = new THREE.Texture({ width: 2, height: 1 } as unknown as HTMLImageElement);
    const c = colors(coloredGeometry(new THREE.Mesh(g, m)));
    const gray = new THREE.Color().setRGB(128 / 255, 128 / 255, 128 / 255, THREE.SRGBColorSpace);
    expect(c[0][0]).toBeCloseTo(1, 5);
    expect(c[0][1]).toBeGreaterThan(0);
    expect(c[0][1]).toBeLessThan(1e-4);
    expect(c[1][0]).toBeCloseTo(gray.r, 5);
    expect(c[2][0]).toBeCloseTo(gray.r, 5);
    // 乘上材质颜色
    const dim = mat('skin', 0.5, 0.5, 0.5);
    dim.map = m.map;
    expect(colors(coloredGeometry(new THREE.Mesh(g, dim)))[1][0]).toBeCloseTo(gray.r * 0.5, 5);
  });
});

describe('mergeGeometries', () => {
  const part = (x: number, indexed: boolean): THREE.BufferGeometry => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([x, 0, 0, x + 1, 0, 0, x, 1, 0]), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(9).fill(x), 3));
    if (indexed) g.setIndex([0, 1, 2]);
    return g;
  };

  it('按顺序拼接各属性，结果不带索引（索引几何体先转成非索引）', () => {
    const out = mergeGeometries([part(0, true), part(5, false)]);
    expect(out.getIndex()).toBeNull();
    expect(out.getAttribute('position').count).toBe(6);
    expect(out.getAttribute('position').getX(3)).toBe(5);
    expect(out.getAttribute('color').getX(2)).toBe(0);
    expect(out.getAttribute('color').getX(4)).toBe(5);
  });
});

describe('recolor', () => {
  it('对每个顶点调用改色函数，给出该顶点的坐标，结果写回顶点色', () => {
    const g = tri();
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(9).fill(0.5), 3));
    const seen: number[][] = [];
    recolor(g, (c, x, y, z) => {
      seen.push([x, y, z]);
      c.setRGB(x, y, 0.25);
    });
    expect(seen).toEqual([[0, 0, 0], [1, 0, 0], [0, 1, 0]]);
    expect(colors(g)).toEqual([[0, 0, 0.25], [1, 0, 0.25], [0, 1, 0.25]]);
  });
});
