import { describe, expect, it, vi } from 'vitest';
import type { Row } from '../../../tools/measure/measure';
import { CHECK_PASS_FILE, checkPass, compareRows, coverageGaps, groupOf, reuseGate, reusedGroups, rowsDigest } from '../../../tools/measure/reuse';

const row = (label: string, points: number, extra: Partial<Row> = {}): Row => ({
  kind: 'dim', label, size: 449, n: 96, adv: 0.3, advSe: 0.01, win: 1, points, ...extra,
});
const OLD = [row('inf:hp=8', 2.5), row('inf:hp=-8', -2.4), row('siege:hp=8', 0.36), row('siege:+pierce', -0.4), row('inf:+pilum', 2.1), row('manpower:+8', 6.77)];
/** 这次的清单：siege:+pierce 已不在清单上（没有兵种带它了），bolt 是新增的位置 */
const PLANNED = ['inf:hp=8', 'inf:hp=-8', 'siege:hp=8', 'bolt:hp=8', 'inf:+pilum', 'bolt:+ballista', 'manpower:+8'];
const FP = 'abcdef0123456789';

describe('抽测：compareRows 逐位比较', () => {
  it('整行序列化后相同才算相同；点数一样而别的字段不同也算不同', () => {
    const r = compareRows(OLD, [row('inf:hp=8', 2.5), row('siege:hp=8', 0.36, { advSe: 0.011 }), row('inf:hp=-8', -2.3)]);
    expect(r).toEqual([
      { label: 'inf:hp=8', status: 'same' },
      { label: 'siege:hp=8', status: 'differ', old: 0.36, now: 0.36 },
      { label: 'inf:hp=-8', status: 'differ', old: -2.4, now: -2.3 },
    ]);
  });

  it('旧测量里没有的格子记为 missing；没有要比的格子时结果为空', () => {
    expect(compareRows(OLD, [row('bolt:hp=8', 0.34)])).toEqual([{ label: 'bolt:hp=8', status: 'missing', now: 0.34 }]);
    expect(compareRows(OLD, [])).toEqual([]);
  });
});

describe('抽测的抽样规则：每个要沿用的位置一格维度格、每个特性格、兵员一格', () => {
  it('维度格按位置分组，特性格各自一组，兵员一格是 manpower', () => {
    expect(['siege:hp=8', 'siege:splash=-15', 'bolt:+ballista', 'manpower:+8'].map(groupOf)).toEqual(['siege', 'siege', 'bolt:+ballista', 'manpower']);
  });

  it('要沿用的组只算旧测量里标签还在清单上的；新增的位置与已不在清单上的格子不算', () => {
    expect(reusedGroups(OLD, PLANNED).sort()).toEqual(['inf', 'inf:+pilum', 'manpower', 'siege']);
  });

  it('没抽到的组列出来；位置抽到一格维度格就够，特性格不能拿同位置的维度格顶', () => {
    expect(coverageGaps(OLD, PLANNED, ['inf:hp=-8']).sort()).toEqual(['inf:+pilum', 'manpower', 'siege']);
    expect(coverageGaps(OLD, PLANNED, ['inf:hp=-8', 'siege:hp=8', 'inf:+pilum', 'manpower:+8'])).toEqual([]);
  });
});

describe('抽测通过记录：checkPass', () => {
  const allSame = compareRows(OLD, [row('inf:hp=8', 2.5), row('siege:hp=8', 0.36), row('inf:+pilum', 2.1), row('manpower:+8', 6.77)]);

  it('每格相同且覆盖全部要沿用的组才给记录，记下测量指纹、旧测量摘要与抽测结果', () => {
    const r = checkPass(OLD, PLANNED, allSame, FP);
    expect(r).toEqual({ pass: { fingerprint: FP, rows: rowsDigest(OLD), checks: allSame } });
  });

  it('有一格不同或旧测量里没有就不通过，原因里写出是哪几格', () => {
    const bad = compareRows(OLD, [row('inf:hp=8', 2.4), row('siege:hp=8', 0.36), row('manpower:+8', 6.77), row('bolt:hp=8', 0.3)]);
    const r = checkPass(OLD, PLANNED, bad, FP);
    expect('reason' in r && r.reason).toContain('inf:hp=8');
    expect('reason' in r && r.reason).toContain('bolt:hp=8');
  });

  it('全部相同但漏了某个要沿用的位置也不通过', () => {
    const r = checkPass(OLD, PLANNED, allSame.filter(c => c.label !== 'manpower:+8'), FP);
    expect('reason' in r && r.reason).toContain('manpower');
  });

  it('旧测量的摘要随内容变（改一个数就不同），与对象键的顺序无关', () => {
    expect(rowsDigest(OLD)).toBe(rowsDigest(OLD.map(r => ({ ...r }))));
    expect(rowsDigest([row('inf:hp=8', 2.51), ...OLD.slice(1)])).not.toBe(rowsDigest(OLD));
  });
});

describe('--reuse 的放行判断：reuseGate', () => {
  const checks = compareRows(OLD, [row('inf:hp=8', 2.5), row('siege:hp=8', 0.36), row('inf:+pilum', 2.1), row('manpower:+8', 6.77)]);
  const pass = (checkPass(OLD, PLANNED, checks, FP) as { pass: Parameters<typeof reuseGate>[0] }).pass!;
  const ctx = { fingerprint: FP, old: OLD, planned: PLANNED };

  it('通过记录与当前测量指纹、当前旧测量都对得上才放行', () => {
    expect(reuseGate(pass, ctx)).toEqual({ ok: true });
  });

  it('没有通过记录：不放行，提示先 --check', () => {
    const r = reuseGate(undefined, ctx);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toContain(CHECK_PASS_FILE);
    expect(!r.ok && r.reason).toContain('prices --check');
  });

  it('测量指纹不符（抽测之后定义又变了）：不放行', () => {
    const r = reuseGate(pass, { ...ctx, fingerprint: '0000000000000000' });
    expect(!r.ok && r.reason).toContain('测量指纹');
  });

  it('旧测量换了一份（抽测之后测量文件变了）：不放行', () => {
    const r = reuseGate(pass, { ...ctx, old: [row('inf:hp=8', 2.6), ...OLD.slice(1)] });
    expect(!r.ok && r.reason).toContain('旧测量');
  });

  it('手改过的记录（混进不同的格子、或抽样不够）：不放行', () => {
    expect(reuseGate({ ...pass, checks: [...pass.checks, { label: 'inf:hp=-8', status: 'differ', old: -2.4, now: -2.3 }] }, ctx).ok).toBe(false);
    expect(reuseGate({ ...pass, checks: pass.checks.slice(0, 1) }, ctx).ok).toBe(false);
  });
});

describe('测量工具的命令行入口', () => {
  it('被导入时不执行：不跑命令、不退出进程，只导出 main', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const cli = await import('../../../tools/measure/cli');
      expect(typeof cli.main).toBe('function');
      await new Promise(r => setTimeout(r, 0));
      expect(exit).not.toHaveBeenCalled();
      expect(err).not.toHaveBeenCalled();
    } finally {
      exit.mockRestore();
      err.mockRestore();
    }
  });
});
