import { afterEach, expect, it, vi } from 'vitest';
import { Sound } from '../../src/audio/sound';
import { flatWorld } from '../helpers';

class AudioNodeStub {
  private output?: AudioNodeStub;

  connect<T extends AudioNodeStub>(output: T): T {
    this.output = output;
    return output;
  }

  gainAt(time: number): number {
    return this.output?.gainAt(time) ?? 1;
  }
}

class GainStub extends AudioNodeStub {
  private ramp?: { start: number; from: number; to: number; fade: number };
  readonly gain = {
    value: 1,
    setTargetAtTime: (to: number, start: number, fade: number) => {
      this.ramp = { from: this.localGainAt(start), to, start, fade };
    },
  };

  private localGainAt(time: number): number {
    if (!this.ramp) return this.gain.value;
    const { from, to, start, fade } = this.ramp;
    return to + (from - to) * Math.exp(-Math.max(0, time - start) / fade);
  }

  gainAt(time: number): number {
    return this.localGainAt(time) * super.gainAt(time);
  }
}

class AudioContextStub {
  static last: AudioContextStub;
  readonly state = 'running';
  readonly sampleRate = 8000;
  readonly destination = new AudioNodeStub();
  private readonly sources: AudioNodeStub[] = [];
  currentTime = 0;

  constructor() {
    AudioContextStub.last = this;
  }

  createBuffer(_channels: number, length: number) {
    const samples = new Float32Array(length);
    return { getChannelData: () => samples };
  }

  createBufferSource() {
    const src = Object.assign(new AudioNodeStub(), { start() {} });
    this.sources.push(src);
    return src;
  }

  createDynamicsCompressor() {
    return Object.assign(new AudioNodeStub(), { threshold: { value: 0 }, ratio: { value: 0 } });
  }

  createBiquadFilter() {
    return Object.assign(new AudioNodeStub(), { frequency: { value: 0 }, Q: { value: 0 } });
  }

  createGain() { return new GainStub(); }
  async close() {}

  get sourceGain(): number {
    return this.sources.reduce((sum, src) => sum + src.gainAt(this.currentTime), 0);
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('风声随风力增强，停风后平滑淡出', () => {
  vi.stubGlobal('window', { AudioContext: AudioContextStub });
  vi.stubGlobal('localStorage', { getItem: () => null });
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  const sound = new Sound();
  sound.unlock();
  const ctx = AudioContextStub.last;
  const world = flatWorld(8);
  const setWind = (force: number) => {
    world.env.wind = force;
    sound.update(world, 0, 0, 100, 1, () => 0);
  };

  try {
    setWind(0);
    expect(ctx.sourceGain).toBe(0);

    setWind(0.4);
    ctx.currentTime += 4;
    const lightWind = ctx.sourceGain;
    expect(lightWind).toBeGreaterThan(0);

    setWind(1);
    ctx.currentTime += 4;
    const strongWind = ctx.sourceGain;
    expect(strongWind).toBeGreaterThan(lightWind);

    setWind(0);
    expect(ctx.sourceGain).toBeCloseTo(strongWind, 6);
    ctx.currentTime += 0.5;
    expect(ctx.sourceGain).toBeGreaterThan(0);
    expect(ctx.sourceGain).toBeLessThan(strongWind);
    ctx.currentTime += 7;
    expect(ctx.sourceGain).toBeCloseTo(0, 5);
  } finally {
    sound.dispose();
  }
});
