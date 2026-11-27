/**
 * 每个单位的动作状态（渲染层自己记，不进模拟层）：
 * - 攻击动作从出手那一刻播满全长，不受模拟层 atkAnim 只有 0.3 秒的限制；站着出手的播过 ATTACK_COMMIT 秒后自己开始移动就打断
 *   （打断后不再续播），出手时就在移动的（边跑边打）不打断；
 * - 换动作时，把换之前那一帧冻结下来，在 BLEND 秒内淡出，避免姿势跳变；同一段攻击重新起手也算换动作。
 * 时间用模拟时间（秒），暂停时动作一起停，加速时一起快。
 */
import type { Clip } from './rig';

/** 换动作的过渡时长（秒） */
export const BLEND = 0.2;
/** 换到攻击的过渡时长：命中已经发生，要很快到位 */
export const BLEND_ATTACK = 0.06;
/** 攻击动作播到这么久以后，开始移动就打断 */
export const ATTACK_COMMIT = 0.3;

/** 隔这么久（模拟时间，秒）没画它，就不从上次的姿势过渡：4 倍速下帧率掉到个位数也不误判 */
export const STALE = 1;

const NEVER = -1e9;

export class UnitAnim {
  /** 当前动作（骨骼贴图里的起始行），-1 = 还没画过 */
  private readonly cur: Int32Array;
  private readonly lastRow: Float32Array;
  /** 上次画它的时刻：隔了一阵才再画（出画面、进迷雾）就不从那么久以前的姿势过渡 */
  private readonly lastT: Float64Array;
  private readonly prevRow: Float32Array;
  private readonly blendT0: Float64Array;
  private readonly blendLen: Float32Array;
  private readonly atkT0: Float64Array;
  private readonly lastAa: Float32Array;
  /** 攻击重新起手：下一次 blend() 当作换了动作 */
  private readonly restart: Uint8Array;
  /** 这次攻击出手时就在移动（边跑边打）：不按起步打断 */
  private readonly atkRun: Uint8Array;
  /** 这次出手挑中的攻击动作序号（见 attackVariant） */
  private readonly atkVar: Uint8Array;
  private readonly owner: Uint32Array;
  /** blend() 的结果：上一个动作冻结的帧行与它的权重 */
  outRow = 0;
  outWeight = 0;

  constructor(cap: number) {
    this.cur = new Int32Array(cap).fill(-1);
    this.lastRow = new Float32Array(cap);
    this.lastT = new Float64Array(cap).fill(NEVER);
    this.prevRow = new Float32Array(cap);
    this.blendT0 = new Float64Array(cap);
    this.blendLen = new Float32Array(cap);
    this.atkT0 = new Float64Array(cap).fill(NEVER);
    this.lastAa = new Float32Array(cap);
    this.restart = new Uint8Array(cap);
    this.atkRun = new Uint8Array(cap);
    this.atkVar = new Uint8Array(cap);
    this.owner = new Uint32Array(cap);
  }

  /** @param uid 单位的唯一编号（World.uid）：槽位换了一个单位时清掉旧状态 */
  claim(i: number, uid: number): void {
    if (this.owner[i] === uid) return;
    this.owner[i] = uid;
    this.cur[i] = -1;
    this.atkT0[i] = NEVER;
    this.lastAa[i] = 0;
    this.restart[i] = 0;
  }

  /**
   * 这次出手用第几种攻击动作（0..n-1）：每次出手随机挑一种，尽量不与上一次相同。
   * 须在 attackTime 之前调用（出手那一刻在这里换）；n 是该兵种不同攻击动作的种数。
   */
  attackVariant(i: number, aa: number, n: number, rand: () => number = Math.random): number {
    if (n <= 1) return 0;
    if (aa > this.lastAa[i] + 1e-6) {
      const k = Math.floor(rand() * (n - 1));
      // 从「除上一次之外」的 n-1 种里挑
      this.atkVar[i] = k >= this.atkVar[i] ? k + 1 : k;
    }
    return this.atkVar[i] % n;
  }

  /**
   * 攻击动作播到第几秒；不在攻击中返回 -1。
   * @param aa 模拟层的 atkAnim（出手时置为正数，随后递减）
   * @param moving 自己在移动：站着出手的攻击播过 ATTACK_COMMIT 秒后就让位给移动动作；出手时就在移动的（边跑边打）不打断
   */
  attackTime(i: number, aa: number, t: number, seconds: number, moving: boolean): number {
    if (aa > this.lastAa[i] + 1e-6) {
      if (this.atkT0[i] > NEVER) this.restart[i] = 1;
      this.atkT0[i] = t;
      this.atkRun[i] = moving ? 1 : 0;
    }
    this.lastAa[i] = aa;
    const e = t - this.atkT0[i];
    if (e < 0 || e >= seconds) return -1;
    if (moving && !this.atkRun[i] && e >= ATTACK_COMMIT) {
      this.atkT0[i] = NEVER;
      return -1;
    }
    return e;
  }

  /** 记下这一帧画的动作与帧行，算出过渡（结果在 outRow / outWeight） */
  blend(i: number, clip: Clip, row: number, t: number, attack: boolean): void {
    const fresh = t - this.lastT[i] > STALE;
    this.lastT[i] = t;
    if (this.cur[i] !== clip.start || this.restart[i]) {
      this.restart[i] = 0;
      if (this.cur[i] >= 0 && !fresh) {
        this.prevRow[i] = this.lastRow[i];
        this.blendT0[i] = t;
        this.blendLen[i] = attack ? BLEND_ATTACK : BLEND;
      } else this.blendLen[i] = 0;
      this.cur[i] = clip.start;
    }
    const len = this.blendLen[i];
    const w = len > 0 ? 1 - (t - this.blendT0[i]) / len : 0;
    this.outRow = this.prevRow[i];
    this.outWeight = w > 0 ? w * w * (3 - 2 * w) : 0;
    // 记下实际画出来的姿势（过渡中途再换动作，就从这一帧接着过渡）
    this.lastRow[i] = this.outWeight > 0.5 ? this.prevRow[i] : row;
  }
}
