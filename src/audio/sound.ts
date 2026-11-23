/**
 * 音效：全部用 Web Audio 现场合成（噪声 + 振荡器 + 滤波），不依赖任何音频文件。
 * 战斗声来自模拟层每帧抛出的特效事件（world.fx），按离镜头的远近定音量、按屏幕左右定声像；
 * 同一种声音在很短的时间内只响一次（把这段时间里的事件合并成一声，事件越多越响），千人混战也不会爆音。
 * 环境声（风、雨）是常驻的噪声链路，音量跟着天气和镜头高度走（无风、无雨时为 0）；雨声是粉红噪声打底加一层稀疏的雨点。
 */
import {
  FX_ARROW_HIT, FX_COLLAPSE, FX_DEATH, FX_EXPLODE, FX_FIRE, FX_HIT, FX_IMPACT, FX_LEVEL, FX_SHOT, FX_SMOKE, World,
} from '../sim/world';

interface Voice {
  /** 两次触发之间的最短间隔（秒） */
  gap: number;
  play(s: Sound, t: number, gain: number, pan: number, a: number): void;
}

const KEY = 'fengyan.sound';

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private rainGain: GainNode | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private readonly last = new Float64Array(16);
  private readonly accN = new Float32Array(16);
  private readonly accG = new Float32Array(16);
  private readonly accP = new Float32Array(16);
  private readonly accA = new Float32Array(16);
  private wind = 0;
  enabled = true;

  constructor() {
    try {
      this.enabled = localStorage.getItem(KEY) !== '0';
    } catch {
      // 读不到设置就按默认开启
    }
  }

  /** 浏览器要求先有用户操作才能出声：第一次点击 / 按键时调用 */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 6;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? 0.9 : 0;
    this.master.connect(comp);
    // 两秒白噪声，所有带噪声成分的声音共用
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // 雨：一层低沉的「沙沙」打底（粉红噪声，削掉刺耳的高频），再叠一层稀疏的雨点声
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;
    this.rainGain.connect(this.master);
    const wash = this.loop(this.pinkNoise(6));
    const washLp = ctx.createBiquadFilter();
    washLp.type = 'lowpass';
    washLp.frequency.value = 2600;
    washLp.Q.value = 0.3;
    const washHp = ctx.createBiquadFilter();
    washHp.type = 'highpass';
    washHp.frequency.value = 180;
    wash.connect(washLp).connect(washHp).connect(this.rainGain);
    const drops = this.loop(this.dropNoise(7));
    const dropLp = ctx.createBiquadFilter();
    dropLp.type = 'lowpass';
    dropLp.frequency.value = 5200;
    const dropGain = ctx.createGain();
    dropGain.gain.value = 0.55;
    drops.connect(dropLp).connect(dropGain).connect(this.rainGain);
    // 风：带通噪声，中心频率和音量缓慢起伏
    const wind = this.loop();
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 380;
    this.windFilter.Q.value = 0.9;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    wind.connect(this.windFilter).connect(this.windGain).connect(this.master);
  }

  private loop(buf: AudioBuffer | null = this.noise): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.start(0, Math.random() * 1.5);
    return src;
  }

  /** 粉红噪声（每倍频程能量相等，听起来比白噪声柔和得多）；首尾交叠一小段，循环时听不出接缝 */
  private pinkNoise(secs: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * secs), fade = Math.floor(ctx.sampleRate * 0.25);
    const raw = new Float32Array(len + fade);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < raw.length; i++) {
      const wn = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + wn * 0.0555179;
      b1 = 0.99332 * b1 + wn * 0.0750759;
      b2 = 0.969 * b2 + wn * 0.153852;
      b3 = 0.8665 * b3 + wn * 0.3104856;
      b4 = 0.55 * b4 + wn * 0.5329522;
      b5 = -0.7616 * b5 - wn * 0.016898;
      raw[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + wn * 0.5362) * 0.11;
      b6 = wn * 0.115926;
    }
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = raw[i];
    for (let i = 0; i < fade; i++) {
      const k = i / fade;
      d[i] = raw[i] * Math.sqrt(k) + raw[len + i] * Math.sqrt(1 - k);
    }
    return buf;
  }

  /** 雨点：一段里随机撒上很多极短的「嗒」声（几毫秒的衰减噪声，轻重、音色各不相同） */
  private dropNoise(secs: number): AudioBuffer {
    const ctx = this.ctx!;
    const sr = ctx.sampleRate, len = Math.floor(sr * secs);
    const buf = ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    const count = Math.floor(secs * 90);
    for (let n = 0; n < count; n++) {
      const at = Math.floor(Math.random() * len);
      const dur = Math.floor(sr * (0.003 + Math.random() * 0.012));
      const amp = 0.05 + Math.random() ** 3 * 0.4;
      // 一阶低通的截止随机：有的闷（打在泥地上），有的脆（打在瓦和甲上）
      const a = 0.15 + Math.random() * 0.6;
      let y = 0;
      for (let i = 0; i < dur; i++) {
        y += ((Math.random() * 2 - 1) - y) * a;
        d[(at + i) % len] += y * amp * Math.exp((-5 * i) / dur);
      }
    }
    return buf;
  }

  toggle(): boolean {
    this.enabled = !this.enabled;
    try {
      localStorage.setItem(KEY, this.enabled ? '1' : '0');
    } catch {
      // 存不了就只在本次生效
    }
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.enabled ? 0.9 : 0, this.ctx.currentTime, 0.05);
    return this.enabled;
  }

  dispose(): void {
    void this.ctx?.close();
    this.ctx = null;
  }

  // ------------------------------------------------------------------ 合成用的小零件
  /** 一段噪声：经滤波（频率可滑动）后按指数衰减 */
  burst(t: number, dur: number, gain: number, pan: number, type: BiquadFilterType, f0: number, f1 = f0, q = 1, attack = 0.004): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.out(pan));
    src.start(t, Math.random() * 1.5, dur + 0.05);
  }

  /** 一个音：频率可滑动，按指数衰减 */
  tone(t: number, dur: number, gain: number, pan: number, type: OscillatorType, f0: number, f1 = f0, attack = 0.003): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.out(pan));
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private out(pan: number): AudioNode {
    const ctx = this.ctx!;
    if (!ctx.createStereoPanner || Math.abs(pan) < 0.03) return this.master!;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    p.connect(this.master!);
    return p;
  }

  // ------------------------------------------------------------------ 每帧
  /**
   * 在渲染器取走特效事件之前调用。
   * @param camX, camY 镜头注视点；radius 听得见的范围；toPan 世界坐标 → 声像（−1 左 … 1 右）
   */
  update(w: World, camX: number, camY: number, radius: number, zoom: number, toPan: (x: number, y: number) => number): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const fog = w.fog && w.humanTeam !== 0;
    const { accN, accG, accP, accA } = this;
    for (let k = 0; k < w.fxN; k++) {
      const o = k * 4;
      const kind = w.fx[o];
      if (!VOICES[kind]) continue;
      const x = w.fx[o + 1], y = w.fx[o + 2];
      const d = Math.hypot(x - camX, y - camY);
      if (d > radius) continue;
      if (fog && !w.isVisible(x, y)) continue;
      const g = (1 - d / radius) ** 1.5;
      accN[kind]++;
      if (g > accG[kind]) {
        // 以最近的那一下为准
        accG[kind] = g;
        accP[kind] = toPan(x, y);
        accA[kind] = w.fx[o + 3];
      }
    }
    // 镜头拉远后整体小声一些
    const zk = Math.max(0.3, Math.min(1, zoom / 1.1));
    for (let kind = 1; kind < 16; kind++) {
      const n = accN[kind];
      if (!n) continue;
      const v = VOICES[kind]!;
      if (now - this.last[kind] < v.gap) continue;
      this.last[kind] = now;
      const gain = accG[kind] * zk * Math.min(1, 0.55 + n * 0.12);
      if (gain > 0.02) v.play(this, now + 0.005, gain, accP[kind], accA[kind]);
      accN[kind] = accG[kind] = 0;
    }

    // ---- 环境声 ----
    const env = w.env;
    // 雨声是垫在底下的：音量压得很低，镜头拉高了更轻
    this.rainGain!.gain.setTargetAtTime(env.rain * (0.09 + 0.05 * zk), now, 0.8);
    // 风：只在刮风时有（env.wind 为 0 就静音），风越大越响，镜头越高越明显；强弱缓慢起伏
    this.wind += 0.016;
    const gust = 0.6 + 0.4 * Math.sin(this.wind * 0.37) * Math.sin(this.wind * 0.11 + 1.3);
    const high = Math.max(0, Math.min(1, (1.2 - zoom) / 0.9));
    this.windGain!.gain.setTargetAtTime(env.wind * (0.06 + high * 0.07 + env.rain * 0.03) * gust, now, 0.5);
    this.windFilter!.frequency.setTargetAtTime(280 + gust * 200 + env.wind * 220, now, 0.6);
  }

  /** 界面与号令的提示音 */
  ui(kind: 'order' | 'attack' | 'select' | 'deny'): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime + 0.005;
    if (kind === 'order') {
      // 令旗插地：一声闷鼓
      this.tone(t, 0.16, 0.22, 0, 'sine', 150, 70);
      this.burst(t, 0.05, 0.08, 0, 'lowpass', 1200, 400);
    } else if (kind === 'attack') {
      this.tone(t, 0.14, 0.2, 0, 'sine', 190, 80);
      this.tone(t + 0.09, 0.16, 0.2, 0, 'sine', 170, 70);
    } else if (kind === 'select') {
      this.burst(t, 0.03, 0.05, 0, 'bandpass', 2400, 2400, 2);
    } else {
      this.tone(t, 0.12, 0.1, 0, 'square', 140, 110);
    }
  }
}

/** 各种特效事件对应的声音 */
const VOICES: (Voice | undefined)[] = [];
// 刀剑相击：几个不和谐的高频泛音 + 一点金属摩擦
VOICES[FX_HIT] = {
  gap: 0.06,
  play(s, t, g, p) {
    const f = 1500 + Math.random() * 1600;
    s.tone(t, 0.11, g * 0.1, p, 'triangle', f, f * 0.97);
    s.tone(t, 0.07, g * 0.06, p, 'square', f * 1.71, f * 1.68);
    s.burst(t, 0.045, g * 0.16, p, 'bandpass', 4200, 2600, 1.5, 0.002);
  },
};
// 放箭：弓弦一弹 + 箭离弦的嗖声；a 为投射物种类
VOICES[FX_SHOT] = {
  gap: 0.07,
  play(s, t, g, p, a) {
    if (a >= 4 && a !== 7) {
      // 投石机 / 火箭 / 火炮的抛射声（开火的轰响另由硝烟事件触发）
      s.burst(t, 0.3, g * 0.22, p, 'bandpass', 500, 180, 0.8, 0.03);
      s.tone(t, 0.16, g * 0.2, p, 'sine', 120, 60);
      return;
    }
    s.tone(t, 0.07, g * 0.1, p, 'triangle', 240 + Math.random() * 60, 140);
    s.burst(t + 0.01, 0.14, g * 0.14, p, 'bandpass', 2600, 900, 1.2, 0.015);
  },
};
// 中箭：笃的一声
VOICES[FX_ARROW_HIT] = {
  gap: 0.07,
  play(s, t, g, p) {
    s.burst(t, 0.03, g * 0.12, p, 'bandpass', 2200, 1400, 2, 0.002);
    s.tone(t, 0.05, g * 0.1, p, 'sine', 210, 120);
  },
};
// 火器开火：a 小是铁炮，大是火炮 / 火箭
VOICES[FX_SMOKE] = {
  gap: 0.08,
  play(s, t, g, p, a) {
    const big = a > 1.5;
    s.burst(t, big ? 0.45 : 0.2, g * (big ? 0.6 : 0.4), p, 'lowpass', big ? 1800 : 3200, big ? 200 : 600, 0.7, 0.002);
    s.tone(t, big ? 0.3 : 0.12, g * (big ? 0.5 : 0.25), p, 'sine', big ? 110 : 160, 45);
  },
};
// 爆炸、巨石落地
VOICES[FX_EXPLODE] = {
  gap: 0.1,
  play(s, t, g, p) {
    s.burst(t, 0.7, g * 0.7, p, 'lowpass', 900, 70, 0.7, 0.004);
    s.tone(t, 0.45, g * 0.6, p, 'sine', 85, 32);
  },
};
// 骑兵冲撞：沉闷的撞击 + 甲片哗啦一响
VOICES[FX_IMPACT] = {
  gap: 0.08,
  play(s, t, g, p) {
    s.tone(t, 0.2, g * 0.5, p, 'sine', 130, 48);
    s.burst(t, 0.12, g * 0.3, p, 'lowpass', 1100, 300, 0.8, 0.003);
    s.burst(t + 0.02, 0.09, g * 0.1, p, 'highpass', 3000, 3000, 0.7, 0.004);
  },
};
// 倒地
VOICES[FX_DEATH] = {
  gap: 0.12,
  play(s, t, g, p) {
    s.burst(t, 0.1, g * 0.14, p, 'lowpass', 420, 160, 0.8, 0.006);
  },
};
// 建筑垮塌：长长的轰隆声，夹着木石断裂
VOICES[FX_COLLAPSE] = {
  gap: 0.3,
  play(s, t, g, p) {
    s.burst(t, 1.4, g * 0.8, p, 'lowpass', 500, 60, 0.7, 0.03);
    s.tone(t, 0.6, g * 0.4, p, 'sine', 70, 30);
    for (let k = 0; k < 5; k++) s.burst(t + 0.1 + k * 0.17 + Math.random() * 0.08, 0.06, g * 0.2, p, 'bandpass', 1400 + Math.random() * 900, 800, 2, 0.002);
  },
};
// 火把砸中：呼的一声
VOICES[FX_FIRE] = {
  gap: 0.1,
  play(s, t, g, p) {
    s.burst(t, 0.4, g * 0.25, p, 'bandpass', 500, 1300, 0.8, 0.08);
    s.burst(t + 0.1, 0.05, g * 0.08, p, 'highpass', 2500, 2500, 1, 0.002);
  },
};
// 升级：两声清亮的钟音
VOICES[FX_LEVEL] = {
  gap: 0.25,
  play(s, t, g, p) {
    s.tone(t, 0.35, g * 0.1, p, 'sine', 880);
    s.tone(t + 0.09, 0.45, g * 0.1, p, 'sine', 1320);
  },
};
