import { Matrix3, Vector2 } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Minimap } from '../../src/render/minimap';
import { flatWorld } from '../helpers';

describe('Minimap', () => {
  const world = flatWorld(8);
  const side = 160;
  let canvas: { clientWidth: number; width: number; height: number };
  let minimap: Minimap;
  let frames: { corners: Vector2[]; clip: Vector2[] | null }[];

  beforeEach(() => {
    frames = [];
    const noop = (): void => {};
    let transform = new Matrix3();
    let path: Vector2[] | null = null;
    let clip: Vector2[] | null = null;
    const saved: { matrix: Matrix3; clip: Vector2[] | null }[] = [];
    const cornersOf = (x: number, y: number, w: number, h: number): Vector2[] =>
      [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(([px, py]) => new Vector2(px, py).applyMatrix3(transform));
    const context = {
      drawImage: (_image: unknown, x: number, y: number, w: number, h: number) => {
        frames.push({ corners: cornersOf(x, y, w, h), clip });
      },
      scale: (x: number, y: number) => transform.multiply(new Matrix3().makeScale(x, y)),
      setTransform: (a: number, b: number, c: number, d: number, e: number, f: number) => transform.set(a, c, e, b, d, f, 0, 0, 1),
      translate: (x: number, y: number) => transform.multiply(new Matrix3().makeTranslation(x, y)),
      rotate: (yaw: number) => transform.multiply(new Matrix3().makeRotation(yaw)),
      save: () => { saved.push({ matrix: transform.clone(), clip }); },
      restore: () => {
        const state = saved.pop()!;
        transform = state.matrix;
        clip = state.clip;
      },
      beginPath: () => { path = null; },
      rect: (x: number, y: number, w: number, h: number) => { path = cornersOf(x, y, w, h); },
      clip: () => { clip = path; },
      fillRect: noop, closePath: noop, arc: noop, fill: noop, stroke: noop, moveTo: noop, lineTo: noop,
    };
    const bufferContext = {
      putImageData: noop,
      createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    };
    vi.stubGlobal('window', { devicePixelRatio: 2 });
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => bufferContext }) });
    vi.stubGlobal('ImageData', class {});
    const element = { clientWidth: side, width: 0, height: 0, getContext: () => context };
    canvas = element;
    minimap = new Minimap(element as unknown as HTMLCanvasElement, world, new Uint8ClampedArray(world.map.w * world.map.h * 4), []);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('方形地形绕画布中心跟随镜头旋转，尺寸固定且四角始终在画布内', () => {
    const angles = [0, Math.PI / 8, Math.PI / 4, Math.PI / 2, Math.PI, Math.PI * 2];
    for (const yaw of angles) {
      minimap.yaw = yaw;
      minimap.draw([], 0);
      expect([canvas.width, canvas.height]).toEqual([side * 2, side * 2]);
    }

    expect(frames).toHaveLength(angles.length);
    const originalWidth = frames[0].corners[0].distanceTo(frames[0].corners[1]);
    expect(originalWidth).toBeGreaterThan(0);
    for (const [index, { corners }] of frames.entries()) {
      const [tl, tr, br] = corners;
      expect(tl.distanceTo(tr)).toBeCloseTo(originalWidth);
      expect(tr.distanceTo(br)).toBeCloseTo(originalWidth);
      expect((tl.x + br.x) / 2).toBeCloseTo(canvas.width / 2);
      expect((tl.y + br.y) / 2).toBeCloseTo(canvas.height / 2);
      expect((tr.x - tl.x) / originalWidth).toBeCloseTo(Math.cos(angles[index]));
      expect((tr.y - tl.y) / originalWidth).toBeCloseTo(Math.sin(angles[index]));
      for (const { x, y } of corners) {
        expect(Math.min(x, y)).toBeGreaterThanOrEqual(-1e-6);
        expect(Math.max(x, y)).toBeLessThanOrEqual(canvas.width + 1e-6);
      }
    }
  });

  it('裁切区域随地形一起旋转，边界与方形地形重合', () => {
    for (const yaw of [0, Math.PI / 4]) {
      minimap.yaw = yaw;
      minimap.draw([], 0);
    }
    for (const frame of frames) expect(frame.clip).toEqual(frame.corners);
  });

  it('旋转前后都能点中同一个偏离地图中心的世界坐标', () => {
    // 方形地图的对角线等于画布边长，选取地图宽 1/4、高 3/4 的位置。
    const d = side / (4 * Math.SQRT2);
    for (const [yaw, x, y] of [[0, side / 2 - d, side / 2 + d], [Math.PI / 2, side / 2 - d, side / 2 - d],
      [Math.PI / 4, side / 4, side / 2]]) {
      minimap.yaw = yaw;
      const result = minimap.toWorld(x, y);
      expect(result.x, 'x').toBeCloseTo(world.W / 4);
      expect(result.y, 'y').toBeCloseTo(world.H * 3 / 4);
    }
  });

  it('空白区的点落到地图的最近边缘', () => {
    expect(minimap.toWorld(0, side / 2)).toEqual({ x: 0, y: world.H / 2 });
    expect(minimap.toWorld(side, side)).toEqual({ x: world.W, y: world.H });
    minimap.yaw = Math.PI / 4;
    const top = minimap.toWorld(side / 2, 0);
    expect(top.x).toBeCloseTo(0);
    expect(top.y).toBeCloseTo(0);
  });

  it('布局改变时方形画布按新尺寸更新，且新中心仍指向地图中心', () => {
    canvas.clientWidth = 104;
    minimap.resize();
    expect([canvas.width, canvas.height]).toEqual([208, 208]);
    minimap.yaw = Math.PI / 4;
    expect(minimap.toWorld(52, 52)).toEqual({ x: world.W / 2, y: world.H / 2 });
  });
});
