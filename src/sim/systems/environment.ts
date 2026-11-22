/** 昼夜与天气：推进时刻、算出天光与视野倍率，按随机日程下雨 */
import { DT, RULES } from '../content';
import type { World } from '../world';
import { ENV_EVERY } from './index';

const smooth = (a: number, b: number, v: number): number => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** 某一时刻（0..1）的天光 */
export function lightAt(clock: number): number {
  const E = RULES.env;
  return Math.min(smooth(E.sunrise - E.twilight, E.sunrise + E.twilight, clock),
    1 - smooth(E.sunset - E.twilight, E.sunset + E.twilight, clock));
}

export function updateEnvironment(w: World): void {
  const env = w.env, E = RULES.env;
  if (!env.enabled) {
    env.light = env.visionMul = 1;
    env.night = env.raining = false;
    env.rain = 0;
    return;
  }
  const dt = ENV_EVERY * DT;
  env.clock = (E.startClock + w.time / E.dayLength) % 1;
  env.light = lightAt(env.clock);
  env.visionMul = E.nightVision + (1 - E.nightVision) * env.light;
  const night = env.light < 0.4;
  if (night !== env.night) {
    env.night = night;
    w.events.push({ kind: 'daynight', night });
  }
  if (w.time >= env.nextWeather) {
    env.raining = !env.raining;
    const span = env.raining ? E.rainLength : E.rainGap;
    env.nextWeather = w.time + span[0] + w.rng.next() * (span[1] - span[0]);
    w.events.push({ kind: 'weather', rain: env.raining });
  }
  env.rain = Math.max(0, Math.min(1, env.rain + (env.raining ? dt : -dt) / 6));
}
