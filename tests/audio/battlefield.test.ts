import { expect, it, vi } from 'vitest';
import { Battlefield } from '../../src/audio/battlefield';
import { BUILDINGS, P_ARROW, P_STONE, P_TORCH, UNIT_BY_KEY } from '../../src/sim/defs';
import { ENG_CLOSE, FX_COLLAPSE, FX_HIT, FX_SHOT, S_SHIELD } from '../../src/sim/state';
import { flatWorld } from '../helpers';

function scene() {
  const w = flatWorld();
  const field = new Battlefield();
  const levels = new Map<string, number>();
  const mixer = {
    oneShot: vi.fn<(path: string, gain: number, pan?: number) => void>(),
    bed: (path: string, gain: number) => { levels.set(path, gain); },
    music: (path: string, gain: number) => {
      for (const key of levels.keys()) if (key.startsWith('music/')) levels.delete(key);
      levels.set(path, gain);
    },
  };
  const update = (x = 500, y = 500, radius = 400, zoom = 1) => {
    field.update(mixer, w, x, y, radius, zoom, sx => Math.max(-1, Math.min(1, (sx - x) / radius)));
    w.fxN = 0;
  };
  return { w, mixer, update, level: (path: string) => levels.get(path) ?? 0 };
}

it('按镜头距离、缩放衰减，声像跟随最近可听见的交锋，一帧混战合并同类声音', () => {
  const hit = (dx: number, zoom: number) => {
    const { w, update, mixer } = scene();
    for (let i = 0; i < 50; i++) w.addFx(FX_HIT, 500 + dx, 500, 0);
    update(500, 500, 400, zoom);
    expect(mixer.oneShot).toHaveBeenCalledTimes(1);
    return mixer.oneShot.mock.calls[0];
  };
  const [, closeGain, left] = hit(-12, 1);
  const [, farGain, right] = hit(180, 1);
  expect(left).toBeLessThan(0);
  expect(right).toBeGreaterThan(0);
  expect(closeGain).toBeGreaterThan(farGain);
  expect(farGain).toBeGreaterThan(0);
  expect(hit(-12, 0.4)[1]).toBeLessThan(closeGain);
});

it('迷雾内和听觉范围外的战斗不会发声或换战斗配乐', () => {
  const { w, update, mixer, level } = scene();
  w.fog = true;
  w.humanTeam = 1;
  w.vis.fill(0);
  w.addFx(FX_HIT, 500, 500, 0);
  w.addFx(FX_HIT, 1600, 500, 0);
  update();
  expect(mixer.oneShot).not.toHaveBeenCalled();
  expect(level('music/deployment-loop')).toBeGreaterThan(0);
  expect(level('music/field-battle-loop')).toBe(0);
  w.vis.fill(1);
  w.addFx(FX_HIT, 1600, 500, 0);
  update();
  expect(mixer.oneShot).not.toHaveBeenCalled();
});

it('投射物按类型发声，举盾者受击使用盾击录音', () => {
  const { w, update, mixer } = scene();
  for (const kind of [P_ARROW, P_STONE, P_TORCH]) w.addFx(FX_SHOT, 500, 500, kind);
  w.addFx(FX_HIT, 500, 500, S_SHIELD);
  update();
  const paths = mixer.oneShot.mock.calls.map(([path]) => path);
  expect(paths).toEqual(expect.arrayContaining([
    expect.stringMatching(/^field\/bow-release-[12]$/), expect.stringMatching(/^field\/siege-release-[12]$/),
    expect.stringMatching(/^field\/shield-impact-[12]$/), 'signals/torch-swing',
  ]));
});

it('战斗配乐在可听见的战斗结束后回到部署配乐', () => {
  const { w, update, level } = scene();
  w.addFx(FX_HIT, 500, 500, 0);
  update();
  expect(level('music/field-battle-loop')).toBeGreaterThan(0);
  expect(level('music/deployment-loop')).toBe(0);
  w.time += 60;
  update();
  expect(level('music/field-battle-loop')).toBe(0);
  expect(level('music/deployment-loop')).toBeGreaterThan(0);
});

it('孤骑和骑队的行军声只由附近可见的移动骑兵贡献，步兵脚步独立', () => {
  const { w, update, level } = scene();
  w.fog = true;
  w.humanTeam = 1;
  const horses: number[] = [];
  for (let i = 0; i < 12; i++) {
    const slot = w.spawnUnit(UNIT_BY_KEY.equites.idx, 2, 501 + i, 500);
    w.vx[slot] = 25;
    horses.push(slot);
  }
  const tick = () => { w.time++; update(); };
  tick();
  expect(level('field/horse-gallop-loop')).toBe(0);
  expect(level('field/cavalry-column-loop')).toBe(0);
  w.seen[horses[0]] |= 1 << 1;
  tick();
  expect(level('field/horse-gallop-loop')).toBeGreaterThan(0);
  expect(level('field/cavalry-column-loop')).toBe(0);
  for (const i of horses) w.seen[i] |= 1 << 1;
  const foot = w.spawnUnit(UNIT_BY_KEY.dao.idx, 1, 480, 500);
  w.vx[foot] = 24;
  tick();
  expect(level('field/cavalry-column-loop')).toBeGreaterThan(0);
  expect(level('field/infantry-march-loop')).toBeGreaterThan(0);
  w.vx.fill(0);
  w.vy.fill(0);
  tick();
  expect(level('field/cavalry-column-loop')).toBe(0);
  expect(level('field/horse-gallop-loop')).toBe(0);
  expect(level('field/infantry-march-loop')).toBe(0);
});

it.each([['palisade', 'timber-building-collapse'], ['wall', 'stone-wall-collapse']] as const)(
  '%s 垮塌播放对应材质的声音', (key, sound) => {
    const { w, update, mixer } = scene();
    const building = w.addBuilding(BUILDINGS[key], 32, 32, 1, -1);
    building.alive = false;
    w.addFx(FX_COLLAPSE, building.cx, building.cy, 1);
    update(building.cx, building.cy);
    expect(mixer.oneShot.mock.calls.map(([path]) => path)).toEqual(['environment/' + sound]);
  },
);

it('小雨、暴雨和雨停切换环境录音', () => {
  const { w, update, level } = scene();
  w.env.rain = 0.2;
  update();
  expect(level('environment/rain-grass-loop')).toBeGreaterThan(0);
  expect(level('environment/rain-downpour-loop')).toBe(0);
  w.env.rain = 1;
  update();
  expect(level('environment/rain-downpour-loop')).toBeGreaterThan(0);
  w.env.rain = 0;
  update();
  expect(level('environment/rain-grass-loop')).toBe(0);
  expect(level('environment/rain-downpour-loop')).toBe(0);
});

it('同一近战兵围攻建筑、远距离投掷副武器和贴身交锋，只有贴身交锋产生肉搏背景声', () => {
  const { w, update, level } = scene();
  const attacker = w.spawnUnit(UNIT_BY_KEY.legion.idx, 1, 400, 400);
  const defender = w.spawnUnit(UNIT_BY_KEY.dao.idx, 2, 520, 400);
  const tower = w.addBuilding(BUILDINGS.tower, 26, 26, 2, -1);
  w.engaged[attacker] = ENG_CLOSE;
  w.target[attacker] = -tower.id - 2;
  update(400, 400);
  const path = 'field/melee-distant-loop';
  expect(level(path)).toBe(0);
  w.time++;
  w.target[attacker] = defender;
  w.targetUid[attacker] = w.uid[defender];
  w.auxCd[attacker] = 2;
  update(400, 400);
  expect(level(path)).toBe(0);
  w.time++;
  w.x[defender] = w.x[attacker] + w.rad[attacker] + w.rad[defender];
  w.auxCd[attacker] = 0;
  update(400, 400);
  expect(level(path)).toBeGreaterThan(0);
});
