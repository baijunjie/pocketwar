import { expect, it } from 'vitest';
import { BRIDGE_DECK_Y, Terrain, WATER_Y } from '../../src/render/terrain';
import { TILE, T_BRIDGE, T_DEEP, T_HILL, T_SHALLOW } from '../../src/sim/defs';
import { BRIDGE_WIDTH, type BridgeSpan } from '../../src/sim/map';
import { flatWorld } from '../helpers';

it.each([Math.PI / 4, -Math.PI / 5])('斜向浮桥与高岸衔接，地面不盖住桥面，河心深度保持（朝向 %s）', angle => {
  const { map } = flatWorld(24);
  map.height.fill(0.9);
  const x = 12.3, y = 12.7, dx = Math.cos(angle), dy = Math.sin(angle), length = 12;
  const halfLength = length / 2, halfWidth = BRIDGE_WIDTH / 2;
  const bed: BridgeSpan['bed'] = [];
  const bridgeTiles = map.terrain.slice();
  for (let ty = 0; ty < map.h; ty++) {
    for (let tx = 0; tx < map.w; tx++) {
      const ox = tx + 0.5 - x, oy = ty + 0.5 - y;
      const along = ox * dx + oy * dy, across = -ox * dy + oy * dx;
      const original = Math.abs(along) <= 2 ? T_DEEP : Math.abs(along) <= 3 ? T_SHALLOW : T_HILL;
      const cell = ty * map.w + tx;
      map.terrain[cell] = original;
      const fullyUnderDeck = Math.abs(along) <= halfLength - 0.75 && Math.abs(across) <= halfWidth - 0.75;
      bridgeTiles[cell] = fullyUnderDeck ? T_BRIDGE : original;
      if (fullyUnderDeck) bed.push([cell, original]);
    }
  }
  const natural = new Terrain(map, 4, 4, []);
  const bridged = new Terrain({ ...map, terrain: bridgeTiles, bridges: [{ x, y, dx, dy, length, bed }] }, 4, 4, []);
  const height = (terrain: Terrain, along: number, across: number): number =>
    terrain.heightAt((x + dx * along - dy * across) * TILE, (y + dy * along + dx * across) * TILE);
  try {
    for (const across of [-halfWidth, -0.75, 0, 0.75, halfWidth]) {
      for (const end of [-halfLength, halfLength]) {
        expect(height(natural, end, across)).toBeGreaterThan(BRIDGE_DECK_Y);
        const approach = height(bridged, end + Math.sign(end) * 0.001, across);
        expect(approach).toBeCloseTo(BRIDGE_DECK_Y, 0);
      }
      for (let along = -halfLength; along <= halfLength; along += 0.5) {
        expect(height(bridged, along, across), `桥面下方 (${along}, ${across})`).toBeLessThan(BRIDGE_DECK_Y);
      }
      const bedY = height(natural, 0, across);
      expect(bedY).toBeLessThan(WATER_Y);
      expect(height(bridged, 0, across)).toBeCloseTo(bedY, 5);
    }
  } finally {
    natural.dispose();
    bridged.dispose();
  }
});
