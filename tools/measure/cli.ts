/**
 * 对战测量工具入口（npm run measure 以 vite-node --script 运行本文件；被导入时不执行，见文件末尾）。用法（项目根目录）：
 *   npm run measure -- [选项] <命令> [参数…]
 * 选项：--workers N（并行进程数，缺省 4，1 为本进程）、--size N（兵力份数）、--n N（覆盖缺省规模与样本数）、--out 文件（写 TSV）
 * 命令：
 *   base                          打印各原型的基准单位面板
 *   ladder [级数…]                标尺：全军生命加减若干级对标准混编军的优势（缺省 -12 … +12）
 *   dim <位置> <级数>…            维度测量，级数写法 hp=8 或 hp=4,out=2；位置是 inf spear ranged cav cavr siege ele
 *   count <位置> <增减人数>…      人数测量
 *   countslots <位置=人数,…>      人数测量的多位置写法：几个位置同时各加若干人，如 inf=47,spear=40
 *   force                         兵力占用核对：给每个原型加人量每人的价值，输出各原型相对近战步兵的比值与现用的兵力占用
 *   unit <位置> <兵种key>…        兵种测量：该位置整个换成这个现有兵种
 *   uvar <兵种key> <级数>…        兵种测量的试算：在这个兵种上再加减级数（写法同 dim），量它的点数
 *   faction [阵营…]               阵营测量（参考用，缺省四个阵营）
 *   roundrobin [阵营…]            循环赛（参考用，缺省四个阵营）
 *   breakdown [阵营…]             阵营点数（不跑对战）：各阵营每个兵种的份数之比、点数（估算）与贡献（其中战略维度的部分）、参考的实测点数，
 *                                 兵员成本、合计、与预算的差额、补到预算要的兵员级数
 *   fmod <阵营:改动>…             阵营测量（参考用，不作门槛）的试算，如 japan:manpower=1.5、rome:hp=2（全军加级）、persia:swap=elephant，改动可用逗号连写
 *   pair <阵营A> <阵营B> [<A的改动> [<B的改动>]]  两个阵营对冲一组（参考用，循环赛同一批种子），改动写法同 fmod，- 表示不改
 *   prices [--resume | --derive | --reuse]  重量价目表（全部位置、维度、特性），写 price-measurements.json 与 src/sim/content/prices.json；
 *                                 中断后用 --resume 接着量（读 tools/measure/out/price-rows.jsonl）；
 *                                 --derive 不跑对战，按 price-measurements.json 里已有的测量重新汇总、只重写 prices.json
 *                                 （汇总规则或地板价变了而测量没变时用；测量指纹过期时报错，要先重量）；
 *                                 --reuse 沿用 price-measurements.json 里标签还在清单上的旧测量，只量新增的格子，
 *                                 用在测量指纹变了而已有格子的对战没变的时候；要先有与当前测量指纹、当前旧测量都对得上的抽测通过记录，否则报错
 *   prices --check <标签…>        抽测：按现在的定义重量这几格（标签如 siege:hp=8、inf:+pilum、manpower:+8），与 price-measurements.json 里的旧测量逐位比较；
 *                                 每格相同、且抽样覆盖要沿用的格子（每个位置一格维度格、每个特性格、兵员一格），才写通过记录 tools/measure/out/price-check-pass.json（见 reuse.ts）
 *   manpower                      量兵员每级的价格（标准混编军每个位置按兵员加 8 级加人），并入 price-measurements.json 与 prices.json
 *   units                         量全部现有兵种的实测点数（参考，用来发现估算的偏差），写 tools/measure/data/unit-points.json
 *   report                        对照兵种实测表与估算点数，列出相差超过 1 点的兵种（不跑对战）
 *   budget [--write]              阵营预算（不跑对战）：按规则重算 FACTION_BUDGET 与各阵营补到预算的兵员级数，--write 写回 points.ts 与 factions.ts
 *   reinf [阵营…] [--write]       援军预算（不跑对战）：按规则重算 REINF_BUDGET 与各阵营补到预算的援军级数，列出援军表的构成，--write 写回
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARCHETYPES, ARCHETYPE_INDEX, FACTION_IDS, FactionId } from '../../src/sim/defs';
import { parseLevels } from './army';
import { Measurer, Row } from './measure';
import { inProcessRunner, poolRunner } from './runner';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { measureFingerprint, pricingFingerprint, unitsFingerprint } from './fingerprint';
import { MANPOWER_PROBE, derivePrices, measurePrices, priceJobs } from './price';
import { toText, writeTsv } from './table';
import { BASE } from './units';
import { BUDGET_BASE_MANPOWER, factionBudgetOf, factionPoints, floorLevel, manpowerForBudget, reinfBudgetOf, reinfLevelForBudget, reinfPoints } from './faction';
import { FACTIONS as FACS, FACTION_BUDGET, REINF_BUDGET, UNIT_BY_KEY, forceList, manpowerMult, reinforceMult } from '../../src/sim/defs';
import type { FactionMod } from './measure';
import { PRICES_FILE, PRICE_ROWS_FILE, UNIT_POINTS_FILE, estimateGaps, measureUnits, readUnitPoints } from './unitpoints';
import { CHECK_PASS_FILE, CheckPass, checkPass, compareRows, reuseGate } from './reuse';

/** 命令行入口：argv 是去掉 node 与脚本路径之后的参数 */
export async function main(argv: string[]): Promise<void> {
  const args = argv.slice();
  const opt = (name: string): string | undefined => {
    const i = args.indexOf(`--${name}`);
    if (i < 0) return undefined;
    const v = args[i + 1];
    args.splice(i, 2);
    return v;
  };
  const workers = Number(opt('workers') ?? 4);
  const sizeOpt = opt('size'), nOpt = opt('n'), out = opt('out');
  const o = { size: sizeOpt ? Number(sizeOpt) : undefined, n: nOpt ? Number(nOpt) : undefined };
  const [cmd, ...rest] = args;

  if (cmd === 'base') {
    for (const d of Object.values(BASE)) {
      console.log(`${d.name}\thp ${d.hp}\tdmg ${d.dmg.toFixed(1)}\tcd ${d.cd.toFixed(2)}\tarm ${d.armM}/${d.armP}\tspd ${d.speed}\trange ${d.range}`);
    }
    return;
  }
  if (cmd === 'report') {
    const f = readUnitPoints();
    // 估算点数按现在的兵种定义算；实测表是参考，兵种定义变了没重量时标出来
    if (f.fingerprint !== unitsFingerprint()) console.log('（兵种实测表是按旧的兵种定义量的，实测一列仅供参考；重量用 npm run measure -- units）\n');
    for (const [k, u] of Object.entries(f.units)) if (UNIT_BY_KEY[k]) u.estimate = UNIT_BY_KEY[k].points;
    for (const [k, u] of Object.entries(f.units)) {
      console.log(`${k.padEnd(11)}${u.position.padEnd(8)}实测 ${u.points.toFixed(2).padStart(6)} ±${u.se.toFixed(2)}${u.significant ? '' : '（不显著）'}  估算 ${u.estimate.toFixed(2).padStart(6)}`);
    }
    console.log('\n估算与实测相差超过 1 点的兵种：');
    for (const g of estimateGaps(f)) console.log(`  ${g.key.padEnd(11)}实测 ${g.measured.toFixed(2)}  估算 ${g.estimate.toFixed(2)}  差 ${g.diff >= 0 ? '+' : ''}${g.diff.toFixed(2)}`);
    return;
  }
  if (cmd === 'breakdown') {
    // 兵种实测表（参考）：与估算点数并列，标出相差超过 1 点的
    let ref: Record<string, number> = {};
    try {
      ref = Object.fromEntries(Object.entries(readUnitPoints().units).map(([k, u]) => [k, u.points]));
    } catch { /* 没有实测表时只列估算 */ }
    console.log(`预算 ${FACTION_BUDGET}（兵种点数是估算点数；「实测」一列取兵种实测表作参考，* 表示与估算相差超过 1 点）`);
    for (const id of (rest.length ? rest : FACTION_IDS) as FactionId[]) {
      const f = FACS[id];
      const p = factionPoints(f);
      console.log(`\n${id}  兵员 ${f.manpower} 级（×${manpowerMult(f).toFixed(3)}）`);
      for (const u of p.units) {
        const m = ref[u.key];
        const mt = m === undefined ? '' : `  实测 ${m.toFixed(2).padStart(6)}${Math.abs(m - u.points) > 1 ? '*' : ''}`;
        console.log(`  ${u.key.padEnd(11)}${u.position.padEnd(7)}比重 ${u.share.toFixed(3)}  份数比 ${u.ratio.toFixed(2).padStart(5)}  点数 ${u.points.toFixed(2).padStart(6)}  贡献 ${u.contrib.toFixed(2).padStart(6)}（其中战略 ${u.strategic.toFixed(2)}）${mt}`);
      }
      const need = manpowerForBudget(f, FACTION_BUDGET);
      console.log(`  兵种合计 ${p.unitSum.toFixed(2)}（其中战略 ${p.strategic.toFixed(2)}）  兵员 ${p.manpowerCost.toFixed(2)}  阵营点数 ${p.total.toFixed(2)}  差预算 ${(p.total - FACTION_BUDGET).toFixed(2)}  补到预算的兵员级数 ${(Math.floor(need * 100) / 100).toFixed(2)}`);
    }
    return;
  }
  if (cmd === 'budget') {
    budget(rest.includes('--write'));
    return;
  }
  if (cmd === 'reinf') {
    await reinf(rest.includes('--write'), rest.filter(x => x !== '--write'));
    return;
  }
  const runner = workers > 1 ? poolRunner(workers) : inProcessRunner();
  const m = new Measurer(runner);
  const t0 = Date.now();
  try {
    let rows: Row[] = [];
    const factions = (rest.length ? rest : FACTION_IDS) as FactionId[];
    if (cmd === 'ladder') rows = await m.ladder(rest.length ? rest.map(Number) : [-12, -10, -8, -6, -4, -2, 0, 2, 4, 6, 8, 10, 12], o);
    else if (cmd === 'dim') rows = await Promise.all(rest.slice(1).map(l => m.dimension(rest[0], parseLevels(l), o)));
    else if (cmd === 'count') rows = await Promise.all(rest.slice(1).map(a => m.count(rest[0], Number(a), o)));
    else if (cmd === 'countslots') rows = [await m.countSlots(Object.fromEntries(rest[0].split(',').map(kv => kv.split('=')).map(([k, v]) => [k, Number(v)])), o)];
    else if (cmd === 'force') {
      const res = await m.force(o);
      rows = res.map(r => r.row);
      for (const r of res) {
        const cur = ARCHETYPES[ARCHETYPE_INDEX[r.arch]].force;
        console.error(`${r.arch.padEnd(8)}加 ${String(r.added).padStart(2)} 人  ${r.row.points!.toFixed(2).padStart(6)} ±${r.row.pointsSe!.toFixed(2)}${r.row.significant ? '' : '（不显著）'}  每人 ${r.perHead.toFixed(3)}  相对近战步兵 ${r.ratio.toFixed(2)} ±${r.ratioSe.toFixed(2)}  现用 ${cur}`);
      }
    } else if (cmd === 'uvar') rows = await Promise.all(rest.slice(1).map(l => m.unit(UNIT_BY_KEY[rest[0]].position, rest[0], { ...o, levels: parseLevels(l) })));
    else if (cmd === 'unit') rows = await Promise.all(rest.slice(1).map(u => m.unit(rest[0], u, o)));
    else if (cmd === 'faction') rows = await Promise.all(factions.map(f => m.faction(f, o)));
    else if (cmd === 'roundrobin') rows = await m.roundRobin({ ...o, factions });
    else if (cmd === 'fmod') {
      rows = await Promise.all(rest.map(s => {
        const [id, mod] = s.split(':');
        return m.faction(id as FactionId, { ...o, mod: mod ? parseMod(mod) : undefined });
      }));
    } else if (cmd === 'pair') {
      const [a, b, ma, mb] = rest;
      rows = [await m.pair(a as FactionId, b as FactionId, { ...o, modA: ma && ma !== '-' ? parseMod(ma) : undefined, modB: mb && mb !== '-' ? parseMod(mb) : undefined })];
      delete rows[0].advs;
    }
    else if (cmd === 'prices' && rest.includes('--check')) {
      // 抽测：重量指定的格子，与提交的旧测量逐位比较（判断测量指纹变化后已有格子的对战是否没变），通过才写通过记录
      const labels = rest.filter(x => x !== '--check');
      if (!labels.length) throw new Error('prices --check 要给出要抽测的标签');
      const old = readOldRows();
      const jobs = priceJobs(m, o);
      rows = await Promise.all(labels.map(l => {
        const j = jobs.find(x => x.label === l);
        if (!j) throw new Error(`价目表的测量清单里没有 ${l}`);
        return j.run();
      }));
      const checks = compareRows(old, rows);
      for (const c of checks) console.error(`${c.label}\t${c.status === 'missing' ? '旧测量里没有' : c.status === 'same' ? '逐位相同' : `不同：旧 ${c.old} 新 ${c.now}`}`);
      console.error(`${checks.filter(c => c.status === 'same').length} / ${checks.length} 格逐位相同`);
      const r = checkPass(old, jobs.map(j => j.label), checks, measureFingerprint());
      if (!('pass' in r)) throw new Error(`抽测不通过，没有写通过记录：${r.reason}`);
      mkdirSync(dirname(CHECK_PASS_FILE), { recursive: true });
      writeFileSync(CHECK_PASS_FILE, JSON.stringify(r.pass, null, 1) + '\n');
      console.error(`抽测通过，已写通过记录 ${CHECK_PASS_FILE}（测量指纹 ${r.pass.fingerprint}），可以用 prices --reuse 沿用旧测量`);
    } else if (cmd === 'prices' && rest.includes('--derive')) {
      // 不跑对战：按 price-measurements.json 里已有的测量重新汇总价目表（汇总规则或地板价变了而测量没变时用）
      const old = readFreshRows();
      writeFileSync(PRICES_FILE, JSON.stringify({ fingerprint: pricingFingerprint(), ...derivePrices(old.rows) }, null, 1) + '\n');
      console.error(`已按 ${old.rows.length} 条测量重新汇总价目表，汇总指纹 ${pricingFingerprint()}`);
    } else if (cmd === 'prices') {
      const log = 'tools/measure/out/price-rows.jsonl';
      mkdirSync(dirname(log), { recursive: true });
      let done: Row[] = [];
      // 沿用旧测量：要有与当前测量指纹、当前旧测量都对得上的抽测通过记录（prices --check），否则在动中断记录之前就报错
      let reused: Row[] = [];
      if (rest.includes('--reuse')) {
        const old = readOldRows();
        const gate = reuseGate(readCheckPass(), { fingerprint: measureFingerprint(), old, planned: priceJobs(m, o).map(j => j.label) });
        if (!gate.ok) throw new Error(`prices --reuse 不放行：${gate.reason}`);
        reused = old;
      }
      if (rest.includes('--resume')) {
        try {
          done = readFileSync(log, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as Row);
        } catch { /* 没有中断的记录 */ }
      } else writeFileSync(log, '');
      done = [...done, ...reused];
      rows = await measurePrices(m, r => {
        appendFileSync(log, JSON.stringify(r) + '\n');
        console.error(`${r.label}\t${r.points!.toFixed(2)} ±${r.pointsSe!.toFixed(2)}${r.significant ? '' : '（不显著）'}`);
      }, done, o);
      writeFileSync(PRICE_ROWS_FILE, JSON.stringify({ fingerprint: measureFingerprint(), rows }, null, 1) + '\n');
      writeFileSync(PRICES_FILE, JSON.stringify({ fingerprint: pricingFingerprint(), ...derivePrices(rows) }, null, 1) + '\n');
    } else if (cmd === 'manpower') {
      const r = await m.manpower(MANPOWER_PROBE, o);
      rows = [r];
      const old = readFreshRows();
      const all = [...old.rows.filter(x => x.meta?.manpower === undefined), r];
      writeFileSync(PRICE_ROWS_FILE, JSON.stringify({ fingerprint: measureFingerprint(), rows: all }, null, 1) + '\n');
      writeFileSync(PRICES_FILE, JSON.stringify({ fingerprint: pricingFingerprint(), ...derivePrices(all) }, null, 1) + '\n');
      console.error(`兵员：实际加 ${r.meta!.manpower!.toFixed(2)} 级，${r.points!.toFixed(2)} ±${r.pointsSe!.toFixed(2)} 点，每级 ${(r.points! / r.meta!.manpower!).toFixed(3)}`);
    } else if (cmd === 'units') {
      const f = await measureUnits(m, r => console.error(`${r.label}\t${r.points!.toFixed(2)} ±${r.pointsSe!.toFixed(2)}`));
      writeFileSync(UNIT_POINTS_FILE, JSON.stringify(f, null, 1) + '\n');
      console.error(`已写入 ${UNIT_POINTS_FILE}，指纹 ${f.fingerprint}`);
    }
    else throw new Error(`不认识的命令：${cmd ?? ''}，见本文件头部的用法`);
    console.log(toText(rows));
    if (out) writeTsv(rows, resolve(out));
    console.error(`耗时 ${((Date.now() - t0) / 1000).toFixed(0)} 秒${out ? `，已写入 ${out}` : ''}`);
  } finally {
    runner.close();
  }
}

/** 提交的旧价目测量（不看指纹，--check 与 --reuse 用） */
function readOldRows(): Row[] {
  return (JSON.parse(readFileSync(PRICE_ROWS_FILE, 'utf8')) as { rows: Row[] }).rows;
}

/** 抽测通过记录；没有就是 undefined */
function readCheckPass(): CheckPass | undefined {
  try {
    return JSON.parse(readFileSync(CHECK_PASS_FILE, 'utf8')) as CheckPass;
  } catch {
    return undefined;
  }
}

/** 阵营预算：按规则重算 FACTION_BUDGET 与各阵营补到预算的兵员级数（向下取到 0.01 级），write 时写回 */
function budget(write: boolean): void {
  const all = FACTION_IDS.map(id => FACS[id]);
  const b = Math.round(factionBudgetOf(all) * 1000) / 1000;
  console.log(`阵营预算 ${b}（现用 ${FACTION_BUDGET}；四阵营在迁移前兵员级数下阵营点数的中位数，四舍五入到 0.001）`);
  const levels: Record<string, number> = {};
  for (const f of all) {
    levels[f.id] = floorLevel(manpowerForBudget(f, b));
    const at = factionPoints({ ...f, manpower: BUDGET_BASE_MANPOWER[f.id] }).total;
    console.log(`  ${f.id.padEnd(7)}迁移前兵员级数 ${BUDGET_BASE_MANPOWER[f.id]} 时 ${at.toFixed(3)} 点；兵员级数 现用 ${f.manpower} → 补到预算 ${levels[f.id]}（${factionPoints({ ...f, manpower: levels[f.id] }).total.toFixed(3)} 点）`);
  }
  if (!write) return;
  const pf = 'src/sim/content/points.ts', ff = 'src/sim/content/factions.ts';
  writeFileSync(pf, readFileSync(pf, 'utf8').replace(/export const FACTION_BUDGET = [-\d.]+;/, `export const FACTION_BUDGET = ${b};`));
  let src = readFileSync(ff, 'utf8');
  for (const f of all) {
    const re = new RegExp(`(id: '${f.id}'[\\s\\S]*?manpower: )[-\\d.]+`);
    if (!re.test(src)) throw new Error(`factions.ts 里找不到 ${f.id} 的 manpower`);
    src = src.replace(re, `$1${levels[f.id]}`);
  }
  writeFileSync(ff, src);
  console.log('\n已写回 points.ts（FACTION_BUDGET）与 factions.ts（各阵营 manpower）');
}

/**
 * 援军点数（不跑对战）：各阵营全兵种援军表每个兵种的份数、点数、贡献（其中战略维度的部分），援军成本、合计、与援军预算的差额。
 * 援军预算 = 各阵营援军点数（援军级数按 0）的中位数，各阵营的援军级数 = 补到预算的级数（向下取到 0.01）。
 * --write 把算出的援军预算与各阵营援军级数写回 points.ts 与 factions.ts（价目、兵种表、援军表变了之后重算用）
 */
async function reinf(write: boolean, ids: string[]): Promise<void> {
  const all = FACTION_IDS.map(id => FACS[id]);
  const budget = Math.round(reinfBudgetOf(all) * 1000) / 1000;
  console.log(`援军预算 ${budget}（现用 ${REINF_BUDGET}；各阵营援军级数按 0 的援军点数中位数，四舍五入到 0.001）`);
  const levels: Record<string, number> = {};
  for (const f of all) {
    levels[f.id] = floorLevel(reinfLevelForBudget(f, budget));
    if (ids.length && !ids.includes(f.id)) continue;
    const at0 = reinfPoints({ reinf: f.reinf, reinfLevel: 0 });
    const cur = reinfPoints(f);
    console.log(`\n${f.id}  援军级数 现用 ${f.reinfLevel}（×${reinforceMult(f).toFixed(3)}）→ 补到预算 ${levels[f.id]}`);
    const total = f.reinf.reduce((n, [, x]) => n + x, 0);
    for (const u of cur.units) {
      console.log(`  ${u.key.padEnd(11)}${u.position.padEnd(7)}份数 ${(u.share * total).toFixed(2).padStart(6)}  比重 ${u.share.toFixed(3)}  份数比 ${u.ratio.toFixed(2).padStart(5)}  点数 ${u.points.toFixed(2).padStart(6)}  贡献 ${u.contrib.toFixed(2).padStart(6)}（其中战略 ${u.strategic.toFixed(2)}）`);
    }
    const next = reinfPoints({ reinf: f.reinf, reinfLevel: levels[f.id] });
    console.log(`  兵种合计 ${cur.unitSum.toFixed(2)}（其中战略 ${cur.strategic.toFixed(2)}）  援军 ${cur.manpowerCost.toFixed(2)}  援军点数 ${cur.total.toFixed(2)}（级数 0 时 ${at0.total.toFixed(2)}）  差预算 ${(cur.total - budget).toFixed(2)}`);
    const counts = (lv: number): string => {
      const c = new Map<number, number>();
      for (const i of forceList(f.reinf, 1.035 ** lv)) c.set(i, (c.get(i) ?? 0) + 1);
      return f.reinf.map(([k]) => `${k} ${c.get(UNIT_BY_KEY[k].idx)}`).join('、');
    };
    console.log(`  补到预算后援军点数 ${next.total.toFixed(2)}  每批人数 级数 0：${counts(0)}  →  级数 ${levels[f.id]}：${counts(levels[f.id])}（共 ${forceList(f.reinf, 1.035 ** levels[f.id]).length} 人）`);
  }
  if (!write) return;
  const pf = 'src/sim/content/points.ts', ff = 'src/sim/content/factions.ts';
  writeFileSync(pf, readFileSync(pf, 'utf8').replace(/export const REINF_BUDGET = [-\d.]+;/, `export const REINF_BUDGET = ${budget};`));
  let src = readFileSync(ff, 'utf8');
  for (const f of all) {
    const re = new RegExp(`(id: '${f.id}'[\\s\\S]*?reinfLevel: )[-\\d.]+`);
    if (!re.test(src)) throw new Error(`factions.ts 里找不到 ${f.id} 的 reinfLevel`);
    src = src.replace(re, `$1${levels[f.id]}`);
  }
  writeFileSync(ff, src);
  console.log('\n已写回 points.ts（REINF_BUDGET）与 factions.ts（各阵营 reinfLevel）');
}

/** 读提交的价目测量；测量指纹与现在不符（规则、原型、特性、位置或测量规程变了）就报错，要先重量 */
function readFreshRows(): { fingerprint: string; rows: Row[] } {
  const f = JSON.parse(readFileSync(PRICE_ROWS_FILE, 'utf8')) as { fingerprint: string; rows: Row[] };
  if (f.fingerprint !== measureFingerprint()) {
    throw new Error(`${PRICE_ROWS_FILE} 的测量指纹 ${f.fingerprint} 与现在的 ${measureFingerprint()} 不符：测量已过期，先运行 npm run measure -- prices 重量`);
  }
  return f;
}

/** 试算改动的写法：manpower=1.5,hp=2,swap=samurai（hp 这类维度是全军加级） */
function parseMod(s: string): FactionMod {
  const mod: FactionMod = {};
  const lv: string[] = [];
  for (const kv of s.split(',')) {
    const [k, v] = kv.split('=');
    if (k === 'manpower') mod.manpower = Number(v);
    else if (k === 'swap') mod.swap = v;
    else lv.push(kv);
  }
  if (lv.length) mod.all = parseLevels(lv.join(','));
  return mod;
}

// 只在作为入口运行时执行（vite-node --script 与 node 都把脚本路径放在 argv[1]）；测试导入本文件时不执行
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(e => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
