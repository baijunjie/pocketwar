import { afterEach, expect, it, vi } from 'vitest';
import { FX_HIT } from '../../src/sim/state';
import { Sound } from '../../src/audio/sound';
import { flatWorld } from '../helpers';

class NodeStub {
  private output?: NodeStub;
  connect<T extends NodeStub>(target: T): T { this.output = target; return target; }
  disconnect(): void { this.output = undefined; }
  gainAt(time: number): number { return this.output?.gainAt(time) ?? 1; }
}

class GainStub extends NodeStub {
  private ramp?: { start: number; from: number; to: number; fade: number };
  readonly gain = {
    value: 1,
    setTargetAtTime: (to: number, start: number, fade: number) => {
      this.ramp = { from: this.localGain(start), to, start, fade };
    },
  };

  private localGain(time: number): number {
    if (!this.ramp) return this.gain.value;
    const { from, to, start, fade } = this.ramp;
    return to + (from - to) * Math.exp(-Math.max(0, time - start) / fade);
  }

  gainAt(time: number): number { return this.localGain(time) * super.gainAt(time); }
}

class SourceStub extends NodeStub {
  loop = false;
  buffer?: { path: string };
  started = false;
  onended?: () => void;
  stoppedAt = Infinity;
  start(): void { this.started = true; }
  stop(at = 0): void { this.stoppedAt = at; }
  gainAt(time: number): number {
    return this.started && time < this.stoppedAt ? super.gainAt(time) : 0;
  }
}

class AudioContextStub {
  static last: AudioContextStub;
  readonly destination = new NodeStub();
  readonly sources: SourceStub[] = [];
  state = 'running';
  currentTime = 0;
  readonly decodeAudioData = vi.fn(async (data: ArrayBuffer) => ({
    path: new TextDecoder().decode(data), length: 512, numberOfChannels: 2,
  }));

  constructor() { AudioContextStub.last = this; }
  createBufferSource() {
    const source = new SourceStub();
    this.sources.push(source);
    return source;
  }
  createDynamicsCompressor() { return Object.assign(new NodeStub(), { threshold: { value: 0 }, ratio: { value: 0 } }); }
  createGain() { return new GainStub(); }
  async suspend() { this.state = 'suspended'; }
  async resume() { this.state = 'running'; }
  async close() { this.state = 'closed'; }
  playing(path: string): SourceStub[] {
    return this.sources.filter(s => s.buffer?.path.endsWith('/' + path + '.mp3') && s.started && s.stoppedAt > this.currentTime);
  }
}

const settle = () => new Promise<void>(resolve => setTimeout(resolve, 0));
function response(path: string) { return { ok: true, arrayBuffer: async () => new TextEncoder().encode(path).buffer }; }
function setup(unlock = true) {
  const storage = new Map<string, string>();
  vi.stubGlobal('window', { AudioContext: AudioContextStub });
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, v: string) => storage.set(key, v),
  });
  const fetch = vi.fn(async (path: string) => response(path));
  vi.stubGlobal('fetch', fetch);
  const sound = new Sound();
  if (unlock) sound.unlock();
  return { sound, fetch };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('风声随风力增强，停风后平滑淡出', async () => {
  const { sound } = setup();
  const ctx = AudioContextStub.last;
  const world = flatWorld(8);
  const path = 'environment/wind-open-field-loop';
  const gain = () => ctx.sources.filter(s => s.buffer?.path.endsWith(path + '.mp3')).reduce((sum, s) => sum + s.gainAt(ctx.currentTime), 0);
  const setWind = async (force: number) => {
    world.env.wind = force;
    world.time += 2;
    sound.update(world, 0, 0, 100, 1, () => 0);
    await settle();
  };
  await setWind(0);
  expect(gain()).toBe(0);
  await setWind(0.4);
  ctx.currentTime += 4;
  const light = gain();
  expect(light).toBeGreaterThan(0);
  await setWind(1);
  ctx.currentTime += 4;
  const strong = gain();
  expect(strong).toBeGreaterThan(light);
  expect(ctx.playing(path)).toHaveLength(1);
  await setWind(0);
  expect(gain()).toBeCloseTo(strong, 5);
  ctx.currentTime += 0.5;
  expect(gain()).toBeGreaterThan(0);
  expect(gain()).toBeLessThan(strong);
  ctx.currentTime += 7;
  expect(gain()).toBeCloseTo(0, 5);
  sound.dispose();
});

it('相同短音只下载并解码一次，冷加载的密集触发合并，缓存命中后能再次发声', async () => {
  const { sound, fetch } = setup();
  const path = 'field/blade-clash-1';
  sound.oneShot(path, 0.2);
  sound.oneShot(path, 0.3);
  await settle();
  const ctx = AudioContextStub.last;
  expect(ctx.playing(path)).toHaveLength(1);
  sound.oneShot(path, 0.3);
  await settle();
  expect(ctx.playing(path)).toHaveLength(2);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(ctx.decodeAudioData).toHaveBeenCalledTimes(1);
});

it.each(['超时', '静音', '暂停', '销毁'] as const)('短音在加载后已经%s时丢弃', async reason => {
  const { sound, fetch } = setup();
  let release!: () => void;
  fetch.mockImplementationOnce(path => new Promise(resolve => { release = () => resolve(response(path)); }));
  const clock = vi.spyOn(performance, 'now').mockReturnValue(100);
  sound.oneShot('field/blade-clash-1', 0.2);
  if (reason === '超时') clock.mockReturnValue(2100);
  if (reason === '静音') { sound.toggle(); sound.toggle(); }
  if (reason === '暂停') { sound.setPaused(true); sound.setPaused(false); }
  if (reason === '销毁') { sound.dispose(); sound.unlock(); }
  release();
  await settle();
  expect(AudioContextStub.last.sources).toHaveLength(0);
});

it('暂停后不播放新的短音，恢复后能播放，静音设置跨对局保留', async () => {
  const { sound, fetch } = setup();
  sound.setPaused(true);
  expect(AudioContextStub.last.state).toBe('suspended');
  sound.oneShot('field/shield-impact-1', 0.3);
  expect(fetch).not.toHaveBeenCalled();
  sound.setPaused(false);
  sound.oneShot('field/shield-impact-1', 0.3);
  await settle();
  expect(AudioContextStub.last.playing('field/shield-impact-1')).toHaveLength(1);
  expect(sound.toggle()).toBe(false);
  expect(new Sound().enabled).toBe(false);
  expect(AudioContextStub.last.playing('field/shield-impact-1')).toHaveLength(0);
});

it.each([[true, 'music/victory'], [false, 'music/retreat']] as const)('结算 %s 终止循环，结算乐只响一次', async (won, path) => {
  const { sound } = setup();
  const ctx = AudioContextStub.last;
  sound.bed('music/deployment-loop', 0.3);
  await settle();
  expect(ctx.playing('music/deployment-loop')[0].loop).toBe(true);
  sound.finish(won);
  sound.finish(won);
  sound.unlock();
  sound.bed('music/field-battle-loop', 0.5);
  await settle();
  expect(ctx.playing('music/deployment-loop')).toHaveLength(0);
  expect(ctx.playing('music/field-battle-loop')).toHaveLength(0);
  expect(ctx.playing(path)).toHaveLength(1);
  expect(ctx.playing(path)[0].loop).toBe(false);
});

it('未解锁时不请求场景音，第一次操作可以听见已经到达的胜利结算', async () => {
  const { sound, fetch } = setup(false);
  sound.oneShot('signals/watch-bell', 0.4);
  sound.finish(true);
  expect(fetch).not.toHaveBeenCalled();
  sound.unlock();
  await settle();
  expect(AudioContextStub.last.playing('music/victory')).toHaveLength(1);
});

it('观战结束后迟到的环境音不会响，也不播放胜负配乐', async () => {
  const { sound, fetch } = setup();
  let release!: () => void;
  fetch.mockImplementationOnce(path => new Promise(resolve => { release = () => resolve(response(path)); }));
  sound.bed('environment/timber-fire-loop', 0.3);
  sound.finish(null);
  release();
  await settle();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(AudioContextStub.last.sources).toHaveLength(0);
});

it('同时涌入的短音限制并发，结束一批后新事件仍能播放', async () => {
  const { sound } = setup();
  const ctx = AudioContextStub.last;
  for (let i = 0; i < 80; i++) sound.oneShot('field/test-' + i, 0.2);
  await settle();
  expect(ctx.sources.length).toBeGreaterThan(0);
  expect(ctx.sources.length).toBeLessThan(80);
  for (const source of ctx.sources) source.onended?.();
  sound.oneShot('field/arrow-impact-1', 0.2);
  await settle();
  expect(ctx.playing('field/arrow-impact-1')).toHaveLength(1);
});

it('设备拒绝创建音频上下文时仍可解锁、更新与退出对局', () => {
  const { sound, fetch } = setup(false);
  vi.stubGlobal('window', { AudioContext: class { constructor() { throw new Error('音频设备不可用'); } } });
  expect(() => {
    sound.unlock();
    sound.update(flatWorld(8), 0, 0, 100, 1, () => 0);
    sound.dispose();
  }).not.toThrow();
  expect(fetch).not.toHaveBeenCalled();
});

it.each([false, true])('配乐冷切时先保留旧曲，目标反转 %s', async reverse => {
  const { sound, fetch } = setup();
  const ctx = AudioContextStub.last;
  const w = flatWorld(8);
  const update = () => { sound.update(w, 40, 40, 100, 1, () => 0); w.fxN = 0; };
  const original = 'music/deployment-loop', battle = 'music/field-battle-loop';
  let release!: () => void;
  fetch.mockImplementation(path => path.endsWith(battle + '.mp3')
    ? new Promise(resolve => { release = () => resolve(response(path)); })
    : Promise.resolve(response(path)));
  update();
  await settle();
  const first = ctx.playing(original)[0];
  expect(first).toBeDefined();
  ctx.currentTime = 1;
  w.time = 1;
  w.addFx(FX_HIT, 40, 40, 0);
  update();
  await settle();
  expect(release).toBeTypeOf('function');
  ctx.currentTime += 3;
  expect(first.gainAt(ctx.currentTime)).toBeGreaterThan(0);
  if (reverse) {
    w.time += 60;
    update();
  }
  release();
  await settle();
  ctx.currentTime += 5;
  if (reverse) {
    expect(ctx.playing(original)).toEqual([first]);
    expect(ctx.playing(battle)).toHaveLength(0);
  } else {
    expect(ctx.playing(battle)).toHaveLength(1);
    expect(ctx.playing(original)).toHaveLength(0);
  }
});
