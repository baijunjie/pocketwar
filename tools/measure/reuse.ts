/**
 * 沿用旧价目测量的核对（prices --check / --reuse）。
 * 测量指纹变了而已有格子的对战其实没变时（新增原型、位置、改名称），不必全部重量：先用 --check 按现在的定义重量一批抽样格子，
 * 与提交的旧测量逐位比较；全部相同且抽样覆盖了每个要沿用的位置与兵员，才写下通过记录。--reuse 只认与当前测量指纹、
 * 当前旧测量内容都对得上的通过记录，否则报错要求先 --check：沿用不经核对，过期测量就会被写上新指纹、当成有效。
 * 本文件只有纯函数（读写文件在 cli.ts）。
 */
import { hash } from './fingerprint';
import type { Row } from './measure';

/**
 * 通过记录放在 out/（不进版本库）：它证明的是「本机这份旧测量在当前定义下抽测逐位相同」，只在接下来的 --reuse 之前有用；
 * --reuse 一写回测量文件，记录里的旧测量摘要就对不上、自然作废。抽测结果与结论写进提交说明与 docs/unit-stat-model.md
 */
export const CHECK_PASS_FILE = 'tools/measure/out/price-check-pass.json';

/** 一格抽测的结果：与旧测量逐位相同、不同，或旧测量里没有这一格 */
export interface RowCheck {
  label: string;
  status: 'same' | 'differ' | 'missing';
  /** 旧测量与这次重量的点数（不同时供显示） */
  old?: number;
  now?: number;
}

/** 通过记录：当前测量指纹、抽测时旧测量的摘要、抽测的格子与结果 */
export interface CheckPass {
  fingerprint: string;
  rows: string;
  checks: RowCheck[];
}

/** 逐位比较：fresh 的每一格与 old 里同标签的一格整行序列化后相同才算相同 */
export function compareRows(old: readonly Row[], fresh: readonly Row[]): RowCheck[] {
  return fresh.map(r => {
    const was = old.find(x => x.label === r.label);
    if (!was) return { label: r.label, status: 'missing', now: r.points };
    return JSON.stringify(was) === JSON.stringify(r)
      ? { label: r.label, status: 'same' }
      : { label: r.label, status: 'differ', old: was.points, now: r.points };
  });
}

/**
 * 标签所属的组：维度格按位置分组（siege:hp=8 → siege），特性格各自一组（inf:+pilum），兵员一格是 manpower。
 * 同一位置的维度格共用位置基准单位，基准单位又在标准混编军里，它变了这些格都跟着变，抽一格就能发现；
 * 特性是各自的定义，只影响自己那一格，所以每格都要抽
 */
export function groupOf(label: string): string {
  const [pos, what = ''] = label.split(':');
  return pos === 'manpower' ? 'manpower' : what.startsWith('+') ? label : pos;
}

/** 要沿用的旧测量分属的组：旧测量里标签还在这次清单上的格子，按 groupOf 分组 */
export function reusedGroups(old: readonly Row[], planned: readonly string[]): string[] {
  return [...new Set(old.filter(r => planned.includes(r.label)).map(r => groupOf(r.label)))];
}

/** 抽样规则：每个要沿用的组至少抽测一格（每个位置一格维度格、每个特性格、兵员一格）；返回没抽到的组 */
export function coverageGaps(old: readonly Row[], planned: readonly string[], checked: readonly string[]): string[] {
  const hit = new Set(checked.map(groupOf));
  return reusedGroups(old, planned).filter(g => !hit.has(g));
}

/** 旧测量的摘要：通过记录据此认定抽测的是哪一份旧测量 */
export const rowsDigest = (old: readonly Row[]): string => hash(old);

/** 抽测通过才给出记录：每格逐位相同、抽样覆盖了全部要沿用的组；否则返回不通过的原因 */
export function checkPass(old: readonly Row[], planned: readonly string[], checks: readonly RowCheck[], fingerprint: string):
  { pass: CheckPass } | { reason: string } {
  const bad = checks.filter(c => c.status !== 'same');
  if (bad.length) return { reason: `抽测有 ${bad.length} 格与旧测量不同或旧测量里没有：${bad.map(c => c.label).join('、')}` };
  const gaps = coverageGaps(old, planned, checks.map(c => c.label));
  if (gaps.length) return { reason: `抽样没覆盖这些要沿用的位置：${gaps.join('、')}（每个位置一格维度格、每个特性格、兵员一格）` };
  return { pass: { fingerprint, rows: rowsDigest(old), checks: [...checks] } };
}

/** --reuse 的放行判断：通过记录存在、测量指纹与旧测量摘要都对得上、记录本身满足通过条件 */
export function reuseGate(pass: CheckPass | undefined, ctx: { fingerprint: string; old: readonly Row[]; planned: readonly string[] }):
  { ok: true } | { ok: false; reason: string } {
  const again = '先运行 npm run measure -- prices --check <标签…> 抽测通过';
  if (!pass) return { ok: false, reason: `没有抽测通过的记录（${CHECK_PASS_FILE}），${again}` };
  if (pass.fingerprint !== ctx.fingerprint) return { ok: false, reason: `通过记录的测量指纹 ${pass.fingerprint} 与现在的 ${ctx.fingerprint} 不符，${again}` };
  if (pass.rows !== rowsDigest(ctx.old)) return { ok: false, reason: `通过记录抽测的不是现在这份旧测量，${again}` };
  const r = checkPass(ctx.old, ctx.planned, pass.checks, ctx.fingerprint);
  return 'pass' in r ? { ok: true } : { ok: false, reason: `通过记录不满足通过条件：${r.reason}，${again}` };
}
