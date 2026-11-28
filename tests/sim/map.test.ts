import { describe, expect, it } from 'vitest';
import { TILE, TERRAIN_SPEED, T_BRIDGE, T_DEEP, T_SHALLOW } from '../../src/sim/defs';
import { BRIDGE_WIDTH, generateMap } from '../../src/sim/map';
import { World } from '../../src/sim/world';

describe('浮桥生成', () => {
  it.each([1, 42, 1234])('种子 %i 的浮桥垂直于当地河道，能从一岸直达另一岸', seed => {
    const map = generateMap(seed);
    const world = new World(map, seed);
    expect(map.bridges?.length).toBeGreaterThan(0);

    const footprint = new Set<number>();
    for (const { x, y, dx, dy, length, bed } of map.bridges ?? []) {
      // 河道总体由西北向东南。取河段两侧的深水截面重建局部流向。
      const deepCenter = (diagonal: number): [number, number] => {
        let sumX = 0, sumY = 0, count = 0;
        for (let tx = Math.floor(x) - 18; tx <= Math.floor(x) + 18; tx++) {
          const ty = diagonal - tx - 1;
          if (map.terrain[ty * map.w + tx] !== T_DEEP || Math.abs(ty - y) > 18) continue;
          sumX += tx + 0.5;
          sumY += ty + 0.5;
          count++;
        }
        expect(count, `深水截面 ${diagonal}`).toBeGreaterThan(0);
        return [sumX / count, sumY / count];
      };
      const [upX, upY] = deepCenter(Math.round(x + y) - 12);
      const [downX, downY] = deepCenter(Math.round(x + y) + 12);
      const flowX = downX - upX, flowY = downY - upY;
      const deviation = Math.abs(flowX * dx + flowY * dy) / Math.hypot(flowX, flowY);
      expect(Math.hypot(dx, dy)).toBeCloseTo(1, 6);
      expect(deviation, `桥址 (${x}, ${y})`).toBeLessThan(Math.sin(Math.PI / 18));

      for (const [cell] of bed) {
        expect(map.terrain[cell]).toBe(T_BRIDGE);
        expect(footprint.has(cell)).toBe(false);
        footprint.add(cell);
        const tx = cell % map.w, ty = Math.floor(cell / map.w);
        for (const cornerX of [tx, tx + 1]) {
          for (const cornerY of [ty, ty + 1]) {
            const ox = cornerX - x, oy = cornerY - y;
            expect(Math.abs(ox * dx + oy * dy)).toBeLessThanOrEqual(length / 2 + 1e-6);
            expect(Math.abs(-ox * dy + oy * dx)).toBeLessThanOrEqual(BRIDGE_WIDTH / 2 + 1e-6);
          }
        }
      }
      const approach = length / 2 + 0.5;
      const ax = (x - dx * approach) * TILE, ay = (y - dy * approach) * TILE;
      const bx = (x + dx * approach) * TILE, by = (y + dy * approach) * TILE;
      for (const team of [1, 2]) {
        expect(world.lineBlocked(ax, ay, bx, by, team), `过桥 (${x}, ${y})`).toBe(false);
      }
    }
    const bridgeCells = Array.from(map.terrain.keys()).filter(cell => map.terrain[cell] === T_BRIDGE);
    expect(new Set(bridgeCells)).toEqual(footprint);
  }, 15000);

  it('小地图的斜桥边缘也没有树石等装饰物', () => {
    const map = generateMap(38, 160);
    const bridges = map.bridges ?? [];
    expect(bridges.length).toBeGreaterThan(0);
    expect(map.props.length).toBeGreaterThan(0);

    const onBridge: [number, number][] = [];
    for (let i = 0; i < map.props.length; i += 4) {
      const x = map.props[i] / TILE, y = map.props[i + 1] / TILE;
      const insideDeck = bridges.some(span => {
        const ox = x - span.x, oy = y - span.y;
        const along = ox * span.dx + oy * span.dy;
        const across = -ox * span.dy + oy * span.dx;
        return Math.abs(along) <= span.length / 2 && Math.abs(across) <= BRIDGE_WIDTH / 2;
      });
      if (insideDeck) onBridge.push([x, y]);
    }
    expect(onBridge).toEqual([]);
  });

  it('新地图仍有可涉水的浅滩，深水仍会挡路', () => {
    const map = generateMap(42);
    const world = new World(map, map.seed);
    const inside = (cell: number): boolean => {
      const x = cell % map.w, y = Math.floor(cell / map.w);
      return x > 0 && x < map.w - 1 && y > 0 && y < map.h - 1;
    };
    const ford = map.terrain.findIndex((terrain, cell) => terrain === T_SHALLOW && inside(cell));
    const deep = map.terrain.findIndex((terrain, cell) => terrain === T_DEEP && inside(cell));
    expect(ford).toBeGreaterThan(0);
    expect(deep).toBeGreaterThan(0);
    expect(world.nav.base[ford]).toBeGreaterThan(0);
    expect(world.nav.base[deep]).toBe(0);
    expect(TERRAIN_SPEED[map.terrain[ford]]).toBeLessThan(TERRAIN_SPEED[T_BRIDGE]);
  });
});
