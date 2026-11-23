/** 昼夜与天气：推进时刻、算出天光与视野倍率，按随机日程下雨、下雪 */
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
    env.night = env.raining = env.snowing = false;
    env.rain = env.snow = env.wind = 0;
    env.windy = false;
    return;
  }
  const dt = ENV_EVERY * DT;
  env.clock = (E.startClock + w.time / E.dayLength) % 1;
  env.light = lightAt(env.clock);
  const night = env.light < 0.4;
  if (night !== env.night) {
    env.night = night;
    w.events.push({ kind: 'daynight', night });
  }
  if (w.time >= env.nextWeather) {
    // 晴天转雨或雪（雪少见），雨雪停了转晴
    const wet = env.raining || env.snowing;
    env.raining = env.snowing = false;
    if (!wet) {
      if (w.rng.next() < E.snowChance) env.snowing = true;
      else env.raining = true;
    }
    const span = wet ? E.rainGap : E.rainLength;
    env.nextWeather = w.time + span[0] + w.rng.next() * (span[1] - span[0]);
    w.events.push({ kind: 'weather', rain: env.raining, snow: env.snowing });
    // 下起雨雪：风多半跟着来
    if ((env.raining || env.snowing) && !env.windy) env.nextWind = w.time;
  }
  updateWind(w, dt);
  // 雪天看不远，和夜晚叠乘
  env.visionMul = (E.nightVision + (1 - E.nightVision) * env.light) * (env.snowing ? E.snowVision : 1);
  env.rain = Math.max(0, Math.min(1, env.rain + (env.raining ? dt : -dt) / 6));
  env.snow = Math.max(0, Math.min(1, env.snow + (env.snowing ? dt : -dt) / 6));
}

/** 风：按日程起风、停风，风力渐变，风向缓慢偏转 */
function updateWind(w: World, dt: number): void {
  const env = w.env, E = RULES.env, rng = w.rng;
  if (w.time >= env.nextWind) {
    const wet = env.raining || env.snowing;
    if (env.windy) {
      env.windy = false;
      env.nextWind = w.time + E.windCheck[0] + rng.next() * (E.windCheck[1] - E.windCheck[0]);
    } else if (rng.next() < (wet ? E.windWet : E.windDry)) {
      env.windy = true;
      if (env.wind <= 0) env.windDir = rng.next() * Math.PI * 2 - Math.PI;
      env.windTarget = E.windForce[0] + rng.next() * (E.windForce[1] - E.windForce[0]);
      env.nextWind = w.time + E.windLength[0] + rng.next() * (E.windLength[1] - E.windLength[0]);
    } else env.nextWind = w.time + E.windCheck[0] + rng.next() * (E.windCheck[1] - E.windCheck[0]);
  }
  const want = env.windy ? env.windTarget : 0;
  env.wind += Math.max(-dt / 8, Math.min(dt / 8, want - env.wind));
  if (env.wind < 0.001) env.wind = 0;
  if (env.wind > 0) {
    // 风向慢慢摆动（每分钟十几度）
    env.windDir += (rng.next() - 0.5) * dt * 0.08;
    if (env.windDir > Math.PI) env.windDir -= Math.PI * 2;
    else if (env.windDir < -Math.PI) env.windDir += Math.PI * 2;
  }
}
