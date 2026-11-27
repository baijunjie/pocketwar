import { P_ARROW, P_BIGBOLT, P_BOLT, P_JAVELIN, P_STONE, P_TORCH, TILE, T_SHALLOW } from '../sim/content';
import {
  FX_ARROW_HIT, FX_BUILT, FX_COLLAPSE, FX_DEATH, FX_EXPLODE, FX_HIT, FX_IMPACT, FX_LEVEL, FX_SHOT, FX_SMOKE, FX_UPGRADE,
} from '../sim/state';
import type { World } from '../sim/world';
import type { Sound } from './sound';

type Mixer = Pick<Sound, 'oneShot' | 'bed' | 'music'>;
type Pan = (x: number, y: number) => number;

interface Cue {
  path: string;
  gain: number;
  gap: number;
  variants?: number;
}

const cues = {
  blade: { path: 'field/blade-clash', gain: 0.38, gap: 0.17, variants: 3 },
  shield: { path: 'field/shield-impact', gain: 0.40, gap: 0.21, variants: 2 },
  bow: { path: 'field/bow-release', gain: 0.30, gap: 0.22, variants: 2 },
  air: { path: 'field/arrow-pass', gain: 0.32, gap: 0.32, variants: 2 },
  pierce: { path: 'field/arrow-impact', gain: 0.34, gap: 0.24, variants: 2 },
  siege: { path: 'field/siege-release', gain: 0.48, gap: 0.40, variants: 2 },
  musket: { path: 'field/musket-report', gain: 0.48, gap: 0.31, variants: 2 },
  cannon: { path: 'field/cannon-report', gain: 0.64, gap: 0.52, variants: 2 },
  boulder: { path: 'field/boulder-impact', gain: 0.55, gap: 0.43, variants: 2 },
  charge: { path: 'field/cavalry-impact', gain: 0.50, gap: 0.30, variants: 2 },
  fall: { path: 'field/soldier-fall', gain: 0.24, gap: 0.32, variants: 2 },
  torch: { path: 'signals/torch-swing', gain: 0.29, gap: 1.05 },
  collapse: { path: 'environment/stone-wall-collapse', gain: 0.69, gap: 0.95 },
  bell: { path: 'signals/watch-bell', gain: 0.16, gap: 5.0 },
} satisfies Record<string, Cue>;

function eventCue(kind: number, arg: number): Cue | undefined {
  switch (kind) {
    case FX_HIT: return arg ? cues.shield : cues.blade;
    case FX_SHOT:
      switch (arg) {
        case P_ARROW: case P_BOLT: return cues.bow;
        case P_STONE: case P_BIGBOLT: return cues.siege;
        case P_JAVELIN: return cues.air;
        case P_TORCH: return cues.torch;
        default: return undefined; // 火药武器由同时发出的硝烟事件出声。
      }
    case FX_SMOKE: return arg > 1.5 ? cues.cannon : cues.musket;
    case FX_ARROW_HIT: return arg ? cues.shield : cues.pierce;
    case FX_EXPLODE: return cues.boulder;
    case FX_IMPACT: return cues.charge;
    case FX_DEATH: return cues.fall;
    case FX_COLLAPSE: return cues.collapse;
    case FX_LEVEL: case FX_UPGRADE: case FX_BUILT: return cues.bell;
  }
}

function proximity(x: number, y: number, camX: number, camY: number, radius: number): number {
  const dx = x - camX, dy = y - camY;
  const d2 = dx * dx + dy * dy;
  return d2 >= radius * radius ? 0 : (1 - Math.sqrt(d2) / radius) ** 1.5;
}

interface Nearby {
  count: number;
  weight: number;
  x: number;
  y: number;
}

function nearby(): Nearby { return { count: 0, weight: 0, x: 0, y: 0 }; }

function include(group: Nearby, weight: number, x: number, y: number): void {
  group.count++;
  if (weight > group.weight) {
    group.weight = weight;
    group.x = x;
    group.y = y;
  }
}

export class Battlefield {
  private readonly voices = new Map<Cue, Nearby & { next: number; variant: number }>();
  private nextScene = 0;
  private battleUntil = -1;
  private nextThunder = 0;

  update(s: Mixer, w: World, camX: number, camY: number, radius: number, zoom: number, pan: Pan): void {
    const scale = Math.max(0.30, Math.min(1, zoom / 1.1));
    const fog = w.fog && w.humanTeam !== 0;
    for (let i = 0; i < w.fxN * 4; i += 4) {
      const cue = eventCue(w.fx[i], w.fx[i + 3]);
      if (!cue) continue;
      let voice = this.voices.get(cue);
      if (voice && w.time < voice.next) continue;
      const x = w.fx[i + 1], y = w.fx[i + 2];
      const weight = proximity(x, y, camX, camY, radius);
      if (weight < 0.025 || (fog && !w.isVisible(x, y))) continue;
      if (!voice) {
        voice = { ...nearby(), next: 0, variant: 0 };
        this.voices.set(cue, voice);
      }
      include(voice, weight, x, y);
    }
    for (const [cue, voice] of this.voices) {
      if (!voice.count) continue;
      let path = cue.path;
      if (cue.variants) {
        voice.variant = (voice.variant % cue.variants) + 1;
        path += '-' + voice.variant;
      } else if (cue === cues.collapse) {
        // 事件保留建筑中心；倒塌后其占地已从寻路网格移除，建筑记录仍在。
        const b = w.buildings.find(b => !b.alive && b.cx === voice.x && b.cy === voice.y);
        if (b?.def.wood) path = 'environment/timber-building-collapse';
      }
      s.oneShot(path, scale * cue.gain * voice.weight * Math.min(1, 0.72 + voice.count * 0.07), pan(voice.x, voice.y));
      if (cue !== cues.bell) this.battleUntil = w.time + 6;
      voice.next = w.time + cue.gap;
      voice.count = voice.weight = 0;
    }

    const rain = w.env.rain;
    s.bed('environment/rain-grass-loop', 0.38 * rain * (1 - 0.8 * rain) * scale);
    s.bed('environment/rain-downpour-loop', 0.39 * Math.max(0, rain * 2 - 1) * scale);
    s.bed('environment/wind-open-field-loop', 0.25 * w.env.wind * scale);
    if (rain < 0.8) this.nextThunder = w.time + 18;
    else if (w.time >= this.nextThunder) {
      s.oneShot('environment/distant-thunder', 0.22 * scale, (Math.random() - 0.5) * 0.9);
      this.nextThunder = w.time + 30 + Math.random() * 34;
    }

    if (w.time < this.nextScene) return;
    this.nextScene = w.time + 0.2;
    const horses = nearby(), feet = nearby(), fighting = nearby(), fire = nearby(), water = nearby();
    const groundRadius = Math.min(radius, 670);
    for (let i = 0; i < w.n; i++) {
      if (!w.alive[i] || !w.unitVisible(i)) continue;
      const x = w.x[i], y = w.y[i], weight = proximity(x, y, camX, camY, groundRadius);
      if (weight < 0.025) continue;
      const def = w.defs[w.type[i]];
      if (w.engaged[i]) {
        this.battleUntil = w.time + 6;
        const target = w.target[i];
        if (target >= 0 && w.alive[target] && w.unitVisible(target)) {
          const edge = Math.hypot(x - w.x[target], y - w.y[target]) - def.radius - w.rad[target];
          const aux = def.aux;
          const weapon = aux && edge <= aux.range && aux.range < def.main.range ? aux : def.main;
          if (weapon.melee && edge <= weapon.range) include(fighting, weight, x, y);
        }
      }
      if (def.humanoid && w.vx[i] ** 2 + w.vy[i] ** 2 > 64) {
        include(def.mobile ? horses : feet, weight, x, y);
      }
    }
    for (const b of w.buildings) {
      if (!b.alive || b.hp >= b.maxHp * 0.35 || (fog && !w.isVisible(b.cx, b.cy))) continue;
      const weight = proximity(b.cx, b.cy, camX, camY, groundRadius);
      if (weight > 0) include(fire, weight, b.cx, b.cy);
    }
    const tx = Math.floor(camX / TILE), ty = Math.floor(camY / TILE);
    for (let y = Math.max(0, ty - 4); y <= Math.min(w.map.h - 1, ty + 4); y++) {
      for (let x = Math.max(0, tx - 4); x <= Math.min(w.map.w - 1, tx + 4); x++) {
        if (w.map.terrain[y * w.map.w + x] !== T_SHALLOW) continue;
        const wx = (x + 0.5) * TILE, wy = (y + 0.5) * TILE;
        if (fog && !w.isVisible(wx, wy)) continue;
        const weight = proximity(wx, wy, camX, camY, TILE * 4);
        if (weight > 0) include(water, weight, wx, wy);
      }
    }

    const bed = (path: string, group: Nearby, gain: number) =>
      s.bed(path, scale * group.weight * gain, group.count ? pan(group.x, group.y) : 0);
    bed('field/horse-gallop-loop', horses, horses.count < 4 ? 0.49 : 0);
    bed('field/cavalry-column-loop', horses, horses.count >= 4 ? 0.52 : 0);
    bed('field/infantry-march-loop', feet, 0.31 * Math.min(1, feet.count / 5));
    bed('field/melee-distant-loop', fighting, 0.32 * Math.min(1, fighting.count / 8));
    bed('environment/timber-fire-loop', fire, 0.46);
    bed('logistics/shallow-ford-loop', water, 0.22);
    const battle = w.time < this.battleUntil;
    s.music(battle ? 'music/field-battle-loop' : 'music/deployment-loop', battle ? 0.20 : 0.18);
  }
}
