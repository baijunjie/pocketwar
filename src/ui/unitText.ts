/** 兵种的文字说明：悬停提示（兵种卡片、营寨选兵、主菜单、详情面板共用）与面板数值的写法 */
import { AURA_KINDS, ELITE, RULES, SIZES, UNITS, UnitAura, UnitDef, unitKind } from '../sim/defs';
import { unitUpgradeCost } from '../sim/systems/economy';

/** 光环加成相对无加成值的增减，如「−20%」：正负号按数值本身判断，取整成 0 的保留一位小数 */
export function auraPct(a: UnitAura): string {
  const k = AURA_KINDS[a.kind];
  const r = a.value / k.neutral - 1;
  const abs = Math.abs(r) * 100;
  return `${r < 0 ? '−' : '+'}${Math.round(abs) || Math.round(abs * 10) / 10}%`;
}

/** 光环的加成写成「所受远程伤害 −20%」 */
export function auraEffect(a: UnitAura): string {
  return `${AURA_KINDS[a.kind].name} ${auraPct(a)}`;
}

/** 面板与兵种提示的数值保留一位小数（级数算出来的攻击、间隔、冲撞伤害是无限小数） */
export const num = (v: number): string => String(Math.round(v * 10) / 10);

/** 射程一栏：远程写射程；近战写「近战」，攻击距离比贴身长的再写出距离 */
export function rangeText(d: UnitDef): string {
  if (!d.melee) return String(d.main.range);
  return d.main.range > RULES.combat.meleeContact ? `近战 ${d.main.range}` : '近战';
}

export function unitTip(d: UnitDef): string {
  const lines = [
    `${d.name}（${unitKind(d)}）`, d.desc,
    `生命 ${d.hp}　攻击 ${num(d.main.lvDmg[0])}${d.main.splash ? '（范围）' : ''}　攻速 ${num(d.main.lvCd[0])}s`,
    `射程 ${rangeText(d)}　护甲 ${d.armM}/${d.armP}`,
    `体型 ${SIZES[d.size].name}　行军 ${d.walk}　奔跑 ${d.speed}　口粮 ${d.upkeep}`,
  ];
  const ab = d.abilities;
  if (ab.charge) lines.push(`冲锋：远距离接敌时突进，冲撞伤害 ${num(ab.charge.impact)}`);
  if (ab.brace) lines.push(`拒马：敌人冲来时立枪，反伤 ${ab.brace.dmg}`);
  if (ab.shield) lines.push(`举盾：遇远程敌人时远程伤害 −${Math.round(ab.shield.block * 100)}%，移动稍慢`);
  for (const a of d.auras) lines.push(`光环「${a.name}」：半径 ${a.radius} 内的其他友军${auraEffect(a)}`);
  if (ab.torch) lines.push('夜间可打火把');
  lines.push(d.siege ? '工程类：能破坏城墙与城门' : '打建筑时投掷火把，烧不动城墙');
  if (d.vsBld >= 2) lines.push(`对建筑 ×${d.vsBld}`);
  if (d.elite >= 0) lines.push(`可花 ${unitUpgradeCost(d)} 黄金升为「${UNITS[d.elite].name}」：生命 ×${ELITE.hp}、攻击 ×${ELITE.dmg}、护甲 +${ELITE.armor}`);
  else if (d.tier) lines.push('高级形态');
  return lines.join('\n');
}
