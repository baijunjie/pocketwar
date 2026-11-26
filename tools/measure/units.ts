/**
 * 对战测量工具：基准单位与按级数造变体。
 * 开发工具，不属于游戏本体：游戏运行时（src/）不引用本目录。
 * 这里的「位置」只是对战测量的概念：兵种在标准混编军里占的位置。
 */
import {
  ARCHETYPES, ARCHETYPE_INDEX, DIMS, EXPAND_RULES, LEVELS, Levels, Panel, SHIELD_SPEED_MUL, SIZES, WR_AUX, STEP, TILE, applyLevels, auxWeapon, levelTables, linkWeapons, weaponLevels, TraitUse, UNITS, UnitDef, expandUnit, isContentUnit, linkMatchups, registerUnit, traitMix, archetypePower,
} from '../../src/sim/defs';

export { DIMS, STEP };
export type { Levels };
export type { Dim } from '../../src/sim/defs';

/**
 * 标准混编军里的位置：按原型分，带长柄的近战步兵单独一个位置。兵种测量都按位置。
 * trait 是位置要求带的特性，位置基准 = 原型基准 + 这个特性。
 * ref 是这个位置在标准混编军里顶替的位置（缺省是自己）：标准混编军的人数构成只按自己的位置排，
 * 顶替的位置不进标准混编军，它的兵种实测在「把 ref 位置整个换成它的基准」的标准混编军上量，参照组也是这支军队。
 */
export const POSITIONS: Record<string, { arch: string; trait?: string; name: string; ref?: string }> = {
  inf: { arch: 'inf', name: '近战步兵' },
  spear: { arch: 'inf', trait: 'polearm', name: '近战步兵（长柄）' },
  ranged: { arch: 'ranged', name: '远程步兵' },
  cav: { arch: 'cav', name: '近战骑兵' },
  cavr: { arch: 'cavr', name: '远程骑兵' },
  siege: { arch: 'siege', name: '抛射器械' },
  ele: { arch: 'vehicle', name: '载具' },
  bolt: { arch: 'bolt', name: '直射器械', ref: 'siege' },
};

/** 兵种所在的位置：同原型，带位置要求的特性就归带特性的位置，否则归不带的 */
export function positionOf(d: UnitDef): string {
  const arch = ARCHETYPES[d.arch];
  const has = (t: string): boolean => d.ownTraits.includes(t) || (arch.base.traits ?? []).some(u => (typeof u === 'string' ? u : u[0]) === t);
  const cands = Object.entries(POSITIONS).filter(([, p]) => p.arch === arch.key);
  const hit = cands.find(([, p]) => p.trait && has(p.trait)) ?? cands.find(([, p]) => !p.trait);
  if (!hit) throw new Error(`没有对应的位置：${arch.key}`);
  return hit[0];
}

/** 正式兵种（不含测量工具登记的基准单位与变体） */
export const contentUnits = (): UnitDef[] => UNITS.filter(isContentUnit);

/**
 * 各位置的基准单位：原型基准面板，带上位置要求的特性（枪兵的位置是近战步兵基准加长柄），不带兵种特有的特性。
 * 键是位置 key（inf、spear、ranged、cav、cavr、siege、ele、bolt），登记在兵种表里，下标排在正式兵种之后。
 */
export const BASE: Record<string, UnitDef> = {};
for (const [key, pos] of Object.entries(POSITIONS)) {
  const d = expandUnit({
    faction: 'china', key: `base_${key}`, name: `基准${pos.name}`, arch: pos.arch,
    spec: { traits: pos.trait ? [pos.trait] : [] }, desc: '',
  }, EXPAND_RULES, false)[0];
  // 基准单位是位置的零点：位置要求的特性（长柄）不计点，战力估值取原型基准（对战里士气按战力估值算，见 systems/morale.ts）
  d.points = 0;
  d.power = archetypePower(ARCHETYPES[ARCHETYPE_INDEX[pos.arch]]);
  d.probe = true;
  registerUnit(d);
  BASE[key] = d;
}

/**
 * 标准混编军的位置表：每个位置（key 同 BASE）占的人数比例，现有四阵营开局编制的平均。只在校准时显式更新。
 * 顶替别的位置的位置（直射器械顶替器械位）不在表里，见 slotOf
 */
export const REF_SHARE: Readonly<Record<string, number>> = { inf: 0.26, spear: 0.22, ranged: 0.31, cav: 0.12, cavr: 0.05, siege: 0.03, ele: 0.01 };
export const SLOTS = Object.keys(REF_SHARE);

/** 位置在标准混编军里占哪个位置的人数：顶替别的位置的（POSITIONS 的 ref）是被顶替的那个，其余是自己 */
export const slotOf = (pos: string): string => POSITIONS[pos].ref ?? pos;

/**
 * 位置的参照组改动：顶替别的位置的，把被顶替的位置整个换成它的基准单位（返回 { 被顶替的位置: 改动 }）；
 * 标准混编军本来就有的位置返回空对象，参照组就是标准混编军本身
 */
export function proxySlots(pos: string): Record<string, { unit: string }> {
  return slotOf(pos) === pos ? {} : { [slotOf(pos)]: { unit: BASE[pos].key } };
}

/** 标准混编军每人平均占几份兵力：Σ 位置人数比例 × 该位置原型的兵力占用 */
export const refForcePerHead = (): number =>
  SLOTS.reduce((p, k) => p + REF_SHARE[k] * ARCHETYPES[ARCHETYPE_INDEX[POSITIONS[k].arch]].force, 0);

/**
 * 标准混编军的规模以兵力份数计：每个位置的人数 = 份数 × 人数比例 ÷ 每人平均占用，至少 1 人。
 * 人数构成就是 REF_SHARE，份数与兵力占用的取值无关地换算到同样的人数。
 */
export function refCounts(force: number): Record<string, number> {
  const per = refForcePerHead();
  return Object.fromEntries(SLOTS.map(k => [k, Math.max(1, Math.round(force * REF_SHARE[k] / per + 1e-9))]));
}

/** n 个人的标准混编军是多少份兵力（旧的按人头记的规模换算成份数；规模参数的缺省值用它写） */
export const refForce = (heads: number): number => Math.round(heads * refForcePerHead());

const variants = new Map<string, UnitDef>();

/** 兵种现在的点数维度面板（生命已乘全局倍率；没有冲锋的冲击为 0，不举盾的举盾为 0） */
function unitPanel(d: UnitDef): Panel {
  return {
    hp: d.hp, dmg: d.main.lvDmg[0], cd: d.main.lvCd[0], armM: d.armM, armP: d.armP, pace: d.pace, range: d.melee ? 0 : d.main.range,
    reach: d.melee ? d.main.range - EXPAND_RULES.meleeContact : 0, discipline: d.discipline,
    impact: d.abilities.charge?.impact ?? 0, pen: d.main.pen, splash: d.melee ? 0 : d.main.splash, block: d.abilities.shield?.block ?? 0,
  };
}

/**
 * 在某个兵种上按级数造一个变体，可以再加上特性（位置基准本来没有的）。
 * 同一兵种、同一组级数与特性只造一次：反复调用不会让兵种表越长越大，也不让同一次测量里的兵种下标随调用次数变。
 * 变体的面板直接在 from 的面板上算（不经原型基准），战力估值按生命与每秒伤害的比例随之变。
 */
export function variant(from: UnitDef, L: Levels, addTraits: TraitUse[] = []): UnitDef {
  const key = `${from.key}|${DIMS.filter(k => L[k]).map(k => `${k}=${L[k]}`).join(',')}|${addTraits.map(t => (typeof t === 'string' ? t : t[0])).join('+')}`;
  const hit = variants.get(key);
  if (hit) return hit;
  if (L.heal) throw new Error('治疗维度：兵种表里还没有治疗量字段，神职落地后再实现');
  // 武器复制后再改，不动 from 的
  const weapons = from.weapons.map(wp => ({ ...wp, lvDmg: [...wp.lvDmg], lvCd: [...wp.lvCd] }));
  const d: UnitDef = { ...from, ...linkWeapons(weapons), key, abilities: { ...from.abilities }, probe: true };
  // 面板在 from 的面板上按级数算，与兵种展开同一套阶梯（applyLevels）
  const p = applyLevels(unitPanel(from), L);
  d.hp = Math.round(p.hp);
  d.armM = p.armM;
  d.armP = p.armP;
  if (L.spd) {
    d.pace = p.pace;
    d.speed = Math.round(d.pace * SIZES[from.size].speedMul);
    d.walk = Math.round(d.speed * (from.walk / from.speed));
  }
  d.main.range = d.melee ? EXPAND_RULES.meleeContact + p.reach : p.range;
  d.discipline = p.discipline;
  if (d.abilities.charge) d.abilities.charge = { ...d.abilities.charge, impact: p.impact };
  d.main.pen = p.pen;
  if (L.splash) d.main.splash = p.splash;
  // 举盾减免为 0 就是不举盾
  if (p.block > 0) d.abilities.shield = { block: p.block, speedMul: SHIELD_SPEED_MUL };
  else delete d.abilities.shield;
  if (addTraits.length) {
    const mix = traitMix(addTraits);
    d.tags |= mix.tags;
    d.counter = [...from.counter, ...mix.counter];
    d.hitMod = [...from.hitMod, ...mix.hitMod];
    d.traits |= mix.flags;
    d.abilities = { ...mix.abilities, ...d.abilities };
    if (mix.aux) Object.assign(d, linkWeapons([...weapons.filter(wp => wp.role !== WR_AUX), auxWeapon(mix.aux, LEVELS.thresholds.length)]));
    Object.assign(d.main, mix.main);
    d.auras = [...from.auras, ...mix.auras];
  }
  Object.assign(d.main, weaponLevels(p.dmg, p.cd, LEVELS));
  const dps = (u: UnitDef): number => u.main.lvDmg[0] / u.main.lvCd[0];
  d.power = from.power * Math.sqrt((d.hp / from.hp) * (dps(d) / dps(from)));
  d.lv = { ...from.lv };
  for (const k of DIMS) if (L[k]) d.lv[k] = (d.lv[k] ?? 0) + L[k]!;
  // 按等级展开的数值、索敌距离都随面板重算
  Object.assign(d, levelTables(d, LEVELS));
  d.acq = d.melee ? d.acq : d.main.range + (d.siege ? 0 : 40);
  d.alert = Math.max(d.alert, d.acq);
  d.lookK = !d.melee && d.main.range > 60 ? Math.min(14, Math.floor(d.main.range / TILE)) : 1;
  UNITS.push(d);
  d.idx = UNITS.length - 1;
  d.elite = -1; d.basic = -1; d.tier = 0;
  linkMatchups(d);
  variants.set(key, d);
  return d;
}
