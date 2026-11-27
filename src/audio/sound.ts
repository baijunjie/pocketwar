import type { World } from '../sim/world';
import { Battlefield } from './battlefield';

const KEY = 'fengyan.sound';
const CACHE_BYTES = 48 * 1024 * 1024;
const MAX_SHOTS = 20;

interface Voice {
  source: AudioBufferSourceNode;
  gain: GainNode;
  panner?: StereoPannerNode;
}

interface Bed {
  gain: number;
  pan: number;
  voice?: Voice;
}

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly battlefield = new Battlefield();
  private readonly buffers = new Map<string, AudioBuffer>();
  private bufferBytes = 0;
  private readonly loading = new Map<string, Promise<AudioBuffer | null>>();
  private readonly retryAfter = new Map<string, number>();
  private readonly abort = new AbortController();
  private readonly beds = new Map<string, Bed>();
  private readonly sources = new Set<AudioScheduledSourceNode>();
  private readonly shots = new Set<AudioBufferSourceNode>();
  private readonly pending = new Map<string, { gain: number; pan: number; time: number }>();
  private requestedMusic?: string;
  private playingMusic?: string;
  private ending?: string;
  private finished = false;
  private paused = false;
  enabled = true;

  constructor() {
    try {
      this.enabled = localStorage.getItem(KEY) !== '0';
    } catch {
      // 读不到设置就按默认开启
    }
  }

  /** 浏览器只允许在用户操作后启动或恢复音频。 */
  unlock(): void {
    if (this.abort.signal.aborted) return;
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      let ctx: AudioContext | undefined;
      try {
        ctx = new AC();
        const compressor = ctx.createDynamicsCompressor();
        compressor.threshold.value = -16;
        compressor.ratio.value = 5;
        compressor.connect(ctx.destination);
        const master = ctx.createGain();
        master.gain.value = this.enabled ? 0.9 : 0;
        master.connect(compressor);
        this.master = master;
        this.ctx = ctx;
      } catch {
        // 设备忙或达到浏览器上下文数量上限时仍能开局，下次手势再试。
        void ctx?.close().catch(() => {});
        return;
      }
    }
    if (!this.paused && this.ctx.state !== 'running') {
      void this.ctx.resume().then(() => this.playEnding()).catch(() => {});
    } else {
      this.playEnding();
    }
  }

  private get audible(): boolean {
    return this.enabled && !this.paused && this.ctx?.state === 'running' && !this.abort.signal.aborted;
  }

  private load(path: string): Promise<AudioBuffer | null> {
    const cached = this.buffers.get(path);
    if (cached) {
      this.buffers.delete(path);
      this.buffers.set(path, cached);
      return Promise.resolve(cached);
    }
    const pending = this.loading.get(path);
    if (pending) return pending;
    const ctx = this.ctx!;
    const job = (async () => {
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}audio/${path}.mp3`, { signal: this.abort.signal });
        if (!response.ok) throw new Error(String(response.status));
        const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
        if (this.abort.signal.aborted) return null;
        this.buffers.set(path, buffer);
        this.bufferBytes += buffer.length * buffer.numberOfChannels * 4;
        // 两首长配乐解码后的体积远大于 MP3；正在播放的节点自己持有缓冲区。
        while (this.bufferBytes > CACHE_BYTES && this.buffers.size > 1) {
          const [oldest, old] = this.buffers.entries().next().value!;
          this.buffers.delete(oldest);
          this.bufferBytes -= old.length * old.numberOfChannels * 4;
        }
        return buffer;
      } catch {
        if (!this.abort.signal.aborted) this.retryAfter.set(path, performance.now() + 5000);
        return null;
      } finally {
        this.loading.delete(path);
      }
    })();
    this.loading.set(path, job);
    return job;
  }

  private voice(buffer: AudioBuffer, gain: number, pan: number, loop: boolean): Voice {
    const ctx = this.ctx!;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = loop;
    const volume = ctx.createGain();
    volume.gain.value = gain;
    source.connect(volume);
    const panner = ctx.createStereoPanner?.();
    if (panner) {
      panner.pan.value = Math.max(-1, Math.min(1, pan));
      volume.connect(panner).connect(this.master!);
    } else {
      volume.connect(this.master!);
    }
    source.onended = () => {
      this.sources.delete(source);
      this.shots.delete(source);
      source.disconnect();
      volume.disconnect();
      panner?.disconnect();
    };
    this.sources.add(source);
    if (!loop) this.shots.add(source);
    source.start();
    return { source, gain: volume, panner };
  }

  oneShot(path: string, gain: number, pan = 0): void {
    if (!this.audible || this.finished || gain <= 0 || this.shots.size >= MAX_SHOTS) return;
    const now = performance.now();
    if (now < (this.retryAfter.get(path) ?? 0)) return;
    const shot = { gain, pan, time: now };
    const previous = this.pending.get(path);
    if (previous) {
      Object.assign(previous, shot);
      return;
    }
    this.pending.set(path, shot);
    void this.load(path).then(buffer => {
      if (this.pending.get(path) !== shot) return;
      this.pending.delete(path);
      // 冷启动时即便解码慢，也不能把早已过去的刀剑与炮击积压到同一帧补放。
      if (buffer && this.audible && performance.now() - shot.time < 350 && this.shots.size < MAX_SHOTS) {
        this.voice(buffer, shot.gain, shot.pan, false);
      }
    });
  }

  bed(path: string, gain: number, pan = 0): void {
    if (!this.audible || this.finished) return;
    const now = this.ctx!.currentTime;
    const bed = this.beds.get(path);
    if (gain <= 0) {
      if (bed?.voice) {
        bed.voice.gain.gain.setTargetAtTime(0, now, 0.12);
        bed.voice.source.stop(now + 0.65);
      }
      this.beds.delete(path);
      return;
    }
    if (bed) {
      if (bed.gain !== gain) bed.voice?.gain.gain.setTargetAtTime(gain, now, 0.22);
      if (bed.pan !== pan) bed.voice?.panner?.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), now, 0.15);
      bed.gain = gain;
      bed.pan = pan;
      return;
    }
    if (performance.now() < (this.retryAfter.get(path) ?? 0)) return;
    const next: Bed = { gain, pan };
    this.beds.set(path, next);
    void this.load(path).then(buffer => {
      if (this.beds.get(path) !== next) return;
      if (!buffer || !this.audible) {
        this.beds.delete(path);
        return;
      }
      next.voice = this.voice(buffer, 0, next.pan, true);
      next.voice.gain.gain.setTargetAtTime(next.gain, this.ctx!.currentTime, 0.22);
      if (path === this.requestedMusic && this.playingMusic !== path) {
        if (this.playingMusic) this.bed(this.playingMusic, 0);
        this.playingMusic = path;
      }
    });
  }

  /** 新曲加载时旧曲持续演奏。若战况先恢复，保留旧曲的播放位置。 */
  music(path: string, gain: number): void {
    if (!this.audible || this.finished) return;
    if (this.requestedMusic !== path && this.requestedMusic !== this.playingMusic && this.requestedMusic) {
      this.beds.delete(this.requestedMusic);
    }
    this.requestedMusic = path;
    this.bed(path, gain);
  }

  update(w: World, camX: number, camY: number, radius: number, zoom: number, toPan: (x: number, y: number) => number): void {
    if (this.audible && !this.finished) this.battlefield.update(this, w, camX, camY, radius, zoom, toPan);
  }

  ui(kind: 'order' | 'attack' | 'select' | 'deny'): void {
    if (!this.audible || this.finished) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const pitch = { order: 150, attack: 190, select: 550, deny: 110 }[kind];
    const osc = ctx.createOscillator();
    const level = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(pitch, t);
    osc.frequency.exponentialRampToValueAtTime(pitch * 0.64, t + 0.09);
    level.gain.value = kind === 'select' ? 0.035 : 0.13;
    level.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    osc.connect(level).connect(this.master!);
    this.sources.add(osc);
    osc.onended = () => { this.sources.delete(osc); osc.disconnect(); level.disconnect(); };
    osc.start(t);
    osc.stop(t + 0.13);
  }

  private stopScene(): void {
    this.pending.clear();
    for (const source of this.sources) source.stop();
    this.sources.clear();
    this.shots.clear();
    this.beds.clear();
    this.playingMusic = undefined;
    this.requestedMusic = undefined;
  }

  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    if (!this.ctx) return;
    if (paused) {
      this.pending.clear();
      void this.ctx.suspend().catch(() => {});
    } else {
      void this.ctx.resume().then(() => this.playEnding()).catch(() => {});
    }
  }

  toggle(): boolean {
    this.enabled = !this.enabled;
    try {
      localStorage.setItem(KEY, this.enabled ? '1' : '0');
    } catch {
      // 存不了就只在本次生效
    }
    if (!this.enabled) this.stopScene();
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.enabled ? 0.9 : 0, this.ctx.currentTime, 0.025);
    if (this.enabled) this.unlock();
    return this.enabled;
  }

  finish(won: boolean | null): void {
    if (this.finished) return;
    this.finished = true;
    this.stopScene();
    if (won !== null) this.ending = won ? 'music/victory' : 'music/retreat';
    this.playEnding();
  }

  private playEnding(): void {
    const path = this.ending;
    if (!path || !this.audible || performance.now() < (this.retryAfter.get(path) ?? 0)) return;
    void this.load(path).then(buffer => {
      if (!buffer || !this.audible || this.ending !== path) return;
      this.ending = undefined;
      this.voice(buffer, 0.46, 0, false);
    });
  }

  dispose(): void {
    this.abort.abort();
    this.ending = undefined;
    this.stopScene();
    this.buffers.clear();
    this.bufferBytes = 0;
    if (this.ctx) void this.ctx.close().catch(() => {});
    this.ctx = null;
    this.master = null;
  }
}
