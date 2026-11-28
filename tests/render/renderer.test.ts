import { afterEach, expect, it, vi } from 'vitest';
import { InstancedBufferGeometry, Mesh, Scene } from 'three';
import { Renderer } from '../../src/render/renderer';
import { BRIDGE_DECK_Y } from '../../src/render/terrain';
import { TILE, T_BRIDGE, T_SHALLOW } from '../../src/sim/defs';
import { FACTIONS } from '../../src/sim/content/factions';
import type { FactionId } from '../../src/sim/content/types';
import { flatWorld } from '../helpers';

const submit = vi.hoisted(() => vi.fn<(scene: Scene) => void>());

vi.mock('three', async importOriginal => ({
  ...await importOriginal<typeof import('three')>(),
  WebGLRenderer: class {
    shadowMap = {};
    setPixelRatio() {}
    setSize() {}
    render = submit;
    dispose() {}
    forceContextLoss() {}
  },
}));

afterEach(() => {
  submit.mockReset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** 读取送到 WebGL 的实例，测试场景里只有风会提交半透明粒子。 */
function submittedStreaks() {
  const scene = submit.mock.lastCall![0];
  return scene.children.flatMap(node => {
    if (!(node instanceof Mesh) || !(node.geometry instanceof InstancedBufferGeometry) || !node.visible) return [];
    const geometry = node.geometry;
    const pos = geometry.getAttribute('aPos');
    const color = geometry.getAttribute('aColor');
    return Array.from({ length: geometry.instanceCount }, (_, i) => ({
      x: pos.getX(i), z: pos.getZ(i), opacity: color.getW(i),
    }));
  });
}

it('addMarker 返回新插入的标记，调用者可以用同一引用找到它', () => {
  const renderer = Object.create(Renderer.prototype) as Renderer;
  renderer.markers = [];
  const previous = renderer.addMarker(10, 20, 0, 1, 0);
  const marker = renderer.addMarker(30, 40, 1, 0, 0);

  expect(renderer.markers).toHaveLength(2);
  expect(renderer.markers[0]).toBe(previous);
  expect(renderer.markers[1]).toBe(marker);
  expect(marker).not.toBe(previous);
});

function terrainRenderer(world: ReturnType<typeof flatWorld>): Renderer {
  const noop = () => {};
  const canvasContext = {
    save: noop, restore: noop, translate: noop, scale: noop, fillRect: noop,
    beginPath: noop, closePath: noop, arc: noop, stroke: noop, fill: noop, setLineDash: noop,
    moveTo: noop, lineTo: noop, strokeText: noop, fillText: noop,
    createRadialGradient: () => ({ addColorStop: noop }),
  };
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => canvasContext }) });
  vi.stubGlobal('window', { devicePixelRatio: 1 });
  // 空场景使用没有单位模型的阵营，免去加载角色资源。
  world.factions[1] = world.factions[2] = { ...FACTIONS.china, id: 'renderer-test' as FactionId };
  const canvas = { clientWidth: 1000, clientHeight: 700 } as HTMLCanvasElement;
  const renderer = new Renderer(canvas, world);
  renderer.cam.x = world.W / 2;
  renderer.cam.y = world.H / 2;
  return renderer;
}

it('斜桥擦过浅水格时，桥板上的高度和屏幕拾取都落在桥面', () => {
  const size = 24, bridgeCell = 12 * size + 11;
  const world = flatWorld(size, 7, terrain => {
    terrain.fill(T_SHALLOW);
    terrain[bridgeCell] = T_BRIDGE;
  });
  const { map } = world;
  map.bridges = [{
    x: 12, y: 12, dx: Math.SQRT1_2, dy: -Math.SQRT1_2, length: 8,
    bed: [[bridgeCell, T_SHALLOW]],
  }];
  const renderer = terrainRenderer(world);
  try {
    const inside = 13.05 * TILE, outside = 13.5 * TILE;
    expect(map.terrain[world.cellAt(inside, inside)]).toBe(T_SHALLOW);
    expect(world.cellAt(inside, inside)).toBe(world.cellAt(outside, outside));
    expect(renderer.groundY(inside, inside)).toBeCloseTo(BRIDGE_DECK_Y, 4);
    expect(renderer.groundY(outside, outside)).toBeCloseTo(renderer.groundY(14 * TILE, 14 * TILE), 4);
    expect(renderer.groundY(outside, outside)).toBeLessThan(BRIDGE_DECK_Y);

    renderer.updateCamera();
    const screen = renderer.worldToScreen(inside, inside);
    expect(screen).not.toBeNull();
    const hit = renderer.screenToWorld(screen!.x, screen!.y);
    expect(hit.x).toBeCloseTo(inside, 3);
    expect(hit.y).toBeCloseTo(inside, 3);
  } finally {
    renderer.dispose();
  }
});

it('起风时气流顺着世界风向移动，转镜头后仍沿世界风向，停风时消失', () => {
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  const world = flatWorld();
  const renderer = terrainRenderer(world);
  const selection = new Uint8Array(0);
  const render = (dt = 0) => {
    renderer.render(0, dt, selection);
    return submittedStreaks();
  };

  try {
    expect(render()).toEqual([]);
    world.env.wind = 0.4;
    const lightWind = render().find(streak => streak.opacity > 0)!;
    expect(lightWind).toBeDefined();
    world.env.wind = 0.9;
    const strongerWind = render(1 / 60).find(streak => streak.opacity > 0)!;
    expect(strongerWind.opacity).toBeGreaterThan(lightWind.opacity);
    expect(strongerWind.x).toBeGreaterThan(lightWind.x);
    expect(strongerWind.z).toBeCloseTo(lightWind.z, 3);

    renderer.cam.yaw = Math.PI / 2;
    world.env.windDir = -Math.PI / 4;
    const turned = render(1 / 60).find(streak => streak.opacity > 0)!;
    const dx = turned.x - strongerWind.x, dz = turned.z - strongerWind.z;
    expect(dx).toBeGreaterThan(0);
    expect(dz).toBeCloseTo(-dx, 3);

    world.env.wind = 0;
    expect(render()).toEqual([]);
  } finally {
    renderer.dispose();
  }
});
