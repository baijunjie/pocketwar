/**
 * 对战测量工具入口（npm run measure 以 vite-node --script 运行本文件；被导入时不执行，见文件末尾）。用法（项目根目录）：
 *   npm run measure -- [选项] <命令> [参数…]
 * 选项：--workers N（并行进程数，缺省为本机性能核数、读不到时为逻辑核数，1 为本进程）、--size N（兵力份数）、--n N（覆盖缺省样本数；换算点数的测量按序贯检验分批打、样本够了就停，这时它是上限）、--out 文件（写 TSV）
 * 命令：
 *   base                          打印各原型的基准单位面板
 *   ladder [级数…]                标尺：全军生命加减若干级对标准混编军的优势（缺省 -12 … +12）
 *   dim <位置> <级数>…            维度测量，级数写法 hp=8 或 hp=4,out=2；位置是 inf spear ranged cav cavr siege ele
 *   trait <位置> <特性key>…       特性测量：该位置全员带上这个特性与不带的差
 *   count <位置> <增减人数>…      人数测量
 *   countslots <位置=人数,…>      人数测量的多位置写法：几个位置同时各加若干人，如 inf=47,spear=40
 *   force                         兵力占用核对：给每个原型加人量每人的价值，输出各原型相对近战步兵的比值与现用的兵力占用
 *   unit <位置> <兵种key>…        兵种测量：该位置整个换成这个现有兵种
 *   uvar <兵种key> <级数>…        兵种测量的试算：在这个兵种上再加减级数（写法同 dim），量它的点数
 *   faction [阵营…]               阵营测量（参考用，缺省四个阵营）
 *   roundrobin [阵营…]            循环赛（参考用，缺省四个阵营）
 *   breakdown [阵营…]             阵营点数（不跑对战）：各阵营每个兵种的比重、兵种点数与贡献，兵员成本、合计、与预算的差额、补到预算要的兵员级数
 *   fmod <阵营:改动>…             阵营测量（参考用，不作门槛）的试算，如 japan:manpower=1.5、rome:hp=2（全军加级）、persia:swap=elephant，改动可用逗号连写
 *   pair <阵营A> <阵营B> [<A的改动> [<B的改动>]]  两个阵营对冲一组（参考用，循环赛同一批种子），改动写法同 fmod，- 表示不改
 *   budget [--write]              按固定的 FACTION_BUDGET 算各阵营补到预算的兵员级数（不跑对战），--write 只写回 factions.ts 的 manpower
 *   reinf [阵营…] [--write]       按固定的 REINF_BUDGET 算各阵营补到预算的援军级数（不跑对战），列出援军表的构成，--write 只写回 factions.ts 的 reinfLevel
 * 对战测量命令（ladder、dim、trait、count、unit 等）只作参考，不写任何文件。
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARCHETYPES, ARCHETYPE_INDEX, FACTION_IDS, FactionId } from '../../src/sim/defs';
import { parseLevels } from './army';
import { Measurer, Row } from './measure';
import { defaultWorkers, inProcessRunner, poolRunner } from './runner';
import { readFileSync, writeFileSync } from 'node:fs';
import { toText, writeTsv } from './table';
import { BASE, positionOf } from './units';
import {
  FACTIONS as FACS, FACTION_BUDGET, REINF_BUDGET, UNIT_BY_KEY, factionPoints, floorLevel, forceList, manpowerForBudget, manpowerMult, reinfLevelForBudget, reinfPoints, reinforceMult,
} from '../../src/sim/defs';
import type { FactionMod } from './measure';

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
  const workersOpt = opt('workers');
  const workers = workersOpt ? Number(workersOpt) : defaultWorkers();
  const sizeOpt = opt('size'), nOpt = opt('n'), out = opt('out');
  const o = { size: sizeOpt ? Number(sizeOpt) : undefined, n: nOpt ? Number(nOpt) : undefined };
  const [cmd, ...rest] = args;

  if (cmd === 'base') {
    for (const d of Object.values(BASE)) {
      console.log(`${d.name}\thp ${d.hp}\tdmg ${d.main.lvDmg[0].toFixed(1)}\tcd ${d.main.lvCd[0].toFixed(2)}\tarm ${d.armM}/${d.armP}\tspd ${d.speed}\trange ${d.melee ? 0 : d.main.range}`);
    }
    return;
  }
  if (cmd === 'breakdown') {
    console.log(`预算 ${FACTION_BUDGET}`);
    for (const id of (rest.length ? rest : FACTION_IDS) as FactionId[]) {
      const f = FACS[id];
      const p = factionPoints(f);
      console.log(`\n${id}  兵员 ${f.manpower} 级（×${manpowerMult(f).toFixed(3)}）`);
      for (const u of p.units) {
        console.log(`  ${u.key.padEnd(11)}比重 ${u.share.toFixed(3)}  点数 ${u.points.toFixed(2).padStart(6)}  贡献 ${u.contrib.toFixed(2).padStart(6)}`);
      }
      const need = floorLevel(manpowerForBudget(f, FACTION_BUDGET));
      console.log(`  兵种合计 ${p.unitSum.toFixed(2)}  兵员 ${p.manpowerCost.toFixed(2)}  阵营点数 ${p.total.toFixed(2)}  差预算 ${(p.total - FACTION_BUDGET).toFixed(2)}  补到预算的兵员级数 ${need.toFixed(2)}`);
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
  console.error(`工作进程 ${workers > 1 ? `${workers} 个` : '无（本进程跑）'}${workersOpt ? '' : '（缺省：本机性能核数，读不到时为逻辑核数）'}`);
  const t0 = Date.now();
  try {
    let rows: Row[] = [];
    const factions = (rest.length ? rest : FACTION_IDS) as FactionId[];
    if (cmd === 'ladder') rows = await m.ladder(rest.length ? rest.map(Number) : [-12, -10, -8, -6, -4, -2, 0, 2, 4, 6, 8, 10, 12], o);
    else if (cmd === 'dim') rows = await Promise.all(rest.slice(1).map(l => m.dimension(rest[0], parseLevels(l), o)));
    else if (cmd === 'trait') rows = await Promise.all(rest.slice(1).map(t => m.trait(rest[0], t, o)));
    else if (cmd === 'count') rows = await Promise.all(rest.slice(1).map(a => m.count(rest[0], Number(a), o)));
    else if (cmd === 'countslots') rows = [await m.countSlots(Object.fromEntries(rest[0].split(',').map(kv => kv.split('=')).map(([k, v]) => [k, Number(v)])), o)];
    else if (cmd === 'force') {
      const res = await m.force(o);
      rows = res.map(r => r.row);
      for (const r of res) {
        const cur = ARCHETYPES[ARCHETYPE_INDEX[r.arch]].force;
        console.error(`${r.arch.padEnd(8)}加 ${String(r.added).padStart(2)} 人  ${r.row.points!.toFixed(2).padStart(6)} ±${r.row.pointsSe!.toFixed(2)}${r.row.significant ? '' : '（不显著）'}  每人 ${r.perHead.toFixed(3)}  相对近战步兵 ${r.ratio.toFixed(2)} ±${r.ratioSe.toFixed(2)}  现用 ${cur}`);
      }
    } else if (cmd === 'uvar') rows = await Promise.all(rest.slice(1).map(l => m.unit(positionOf(UNIT_BY_KEY[rest[0]]), rest[0], { ...o, levels: parseLevels(l) })));
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
    else throw new Error(`不认识的命令：${cmd ?? ''}，见本文件头部的用法`);
    console.log(toText(rows));
    if (out) writeTsv(rows, resolve(out));
    console.error(`耗时 ${((Date.now() - t0) / 1000).toFixed(0)} 秒${out ? `，已写入 ${out}` : ''}`);
  } finally {
    runner.close();
  }
}

/** 把各阵营某个字段（兵员级数 manpower 或援军级数 reinfLevel）的新值写回 factions.ts，别的字段不动 */
function writeBack(field: 'manpower' | 'reinfLevel', levels: Record<string, number>): void {
  const ff = 'src/sim/content/factions.ts';
  let src = readFileSync(ff, 'utf8');
  for (const id of FACTION_IDS) {
    const re = new RegExp(`(id: '${id}'[\\s\\S]*?${field}: )[-\\d.]+`);
    if (!re.test(src)) throw new Error(`factions.ts 里找不到 ${id} 的 ${field}`);
    src = src.replace(re, `$1${levels[id]}`);
  }
  writeFileSync(ff, src);
  console.log(`\n已写回 factions.ts（各阵营 ${field}）`);
}

/** 阵营预算：各阵营补到固定预算 FACTION_BUDGET 的兵员级数（向下取到 0.01 级），write 时只写回 factions.ts 的 manpower */
function budget(write: boolean): void {
  const all = FACTION_IDS.map(id => FACS[id]);
  console.log(`阵营预算 ${FACTION_BUDGET}（固定常量）`);
  const levels: Record<string, number> = {};
  for (const f of all) {
    levels[f.id] = floorLevel(manpowerForBudget(f, FACTION_BUDGET));
    console.log(`  ${f.id.padEnd(7)}兵员级数 现用 ${f.manpower} → 补到预算 ${levels[f.id]}（${factionPoints({ ...f, manpower: levels[f.id] }).total.toFixed(3)} 点）`);
  }
  if (!write) return;
  writeBack('manpower', levels);
}

/**
 * 援军点数（不跑对战）：各阵营全兵种援军表每个兵种的份数、点数、贡献，援军成本、合计、与援军预算的差额。
 * 各阵营的援军级数 = 补到固定的援军预算 REINF_BUDGET 的级数（向下取到 0.01）。
 * --write 只把各阵营援军级数写回 factions.ts（兵种点数或援军表变了之后重算用）
 */
async function reinf(write: boolean, ids: string[]): Promise<void> {
  const all = FACTION_IDS.map(id => FACS[id]);
  console.log(`援军预算 ${REINF_BUDGET}（固定常量）`);
  const levels: Record<string, number> = {};
  for (const f of all) {
    levels[f.id] = floorLevel(reinfLevelForBudget(f, REINF_BUDGET));
    if (ids.length && !ids.includes(f.id)) continue;
    const at0 = reinfPoints({ reinf: f.reinf, reinfLevel: 0 });
    const cur = reinfPoints(f);
    console.log(`\n${f.id}  援军级数 现用 ${f.reinfLevel}（×${reinforceMult(f).toFixed(3)}）→ 补到预算 ${levels[f.id]}`);
    const total = f.reinf.reduce((n, [, x]) => n + x, 0);
    for (const u of cur.units) {
      console.log(`  ${u.key.padEnd(11)}份数 ${(u.share * total).toFixed(2).padStart(6)}  比重 ${u.share.toFixed(3)}  点数 ${u.points.toFixed(2).padStart(6)}  贡献 ${u.contrib.toFixed(2).padStart(6)}`);
    }
    const next = reinfPoints({ reinf: f.reinf, reinfLevel: levels[f.id] });
    console.log(`  兵种合计 ${cur.unitSum.toFixed(2)}  援军 ${cur.manpowerCost.toFixed(2)}  援军点数 ${cur.total.toFixed(2)}（级数 0 时 ${at0.total.toFixed(2)}）  差预算 ${(cur.total - REINF_BUDGET).toFixed(2)}`);
    const counts = (lv: number): string => {
      const c = new Map<number, number>();
      for (const i of forceList(f.reinf, 1.035 ** lv)) c.set(i, (c.get(i) ?? 0) + 1);
      return f.reinf.map(([k]) => `${k} ${c.get(UNIT_BY_KEY[k].idx)}`).join('、');
    };
    console.log(`  补到预算后援军点数 ${next.total.toFixed(2)}  每批人数 级数 0：${counts(0)}  →  级数 ${levels[f.id]}：${counts(levels[f.id])}（共 ${forceList(f.reinf, 1.035 ** levels[f.id]).length} 人）`);
  }
  if (!write) return;
  writeBack('reinfLevel', levels);
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
