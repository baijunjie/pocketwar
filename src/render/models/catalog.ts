/**
 * 代码建模的登记表：素材清单（public/assets/units/manifest.json）没登记的兵种用这里的说明建模。
 * 换成美术素材改清单，不改这里（见 docs/unit-art-spec.md）。
 *
 * 每一项是一份「模型说明」，kind 决定由哪个构建器来做：
 *   foot / horse      代码建模的士兵、骑兵（human 给出盔甲、武器等外观）
 *   elephant / onager / trebuchet / ballista / rocket / cannon   代码建模的战象与器械
 * 键是 UnitDef.model（缺省等于兵种 key），所以多个兵种可以共用一个模型，也可以随时改指向。
 */
import { FactionId, UNITS } from '../../sim/defs';
import type { Armor, Helm, HumanLook } from './human';
import type { ModelSpec } from './spec';

const STEEL = 0xaab0b8, DARK = 0x34323a, BRONZE = 0xb8923e, LACQUER = 0x3a2226, LEATHER = 0x6e5136;
const RED = 0xc0392b, GOLD = 0xd9b44a, CREAM = 0xe8dcc0;

export const MODELS: Record<string, ModelSpec> = {
  // 中国：札甲、红缨盔、长戟强弩
  ji: { kind: 'foot', human: { weapon: 'halberd', armor: 'lamellar', armorColor: 0x5c554c, helm: 'tassel', helmColor: 0x6e675e, plume: RED, skirt: 0.3 } },
  dao: { kind: 'foot', human: { weapon: 'sword', shield: 'round', shieldColor: 0x7a2a22, armor: 'lamellar', armorColor: 0x8a7650, helm: 'tassel', helmColor: 0x8a7650, plume: RED, skirt: 0.3 } },
  nu: { kind: 'foot', human: { weapon: 'crossbow', helm: 'futou', skirt: 0.5, quiver: true, legs: 0x3c3a36 } },
  liannu: { kind: 'foot', human: { weapon: 'crossbow', armor: 'lamellar', armorColor: 0x3c3a40, helm: 'futou', skirt: 0.35, quiver: true } },
  tieqi: { kind: 'horse', coat: 0x3d2a1e, barding: 0x7a2a24,
    human: { weapon: 'lance', armor: 'lamellar', armorColor: 0x57514e, helm: 'tassel', helmColor: 0x57514e, plume: RED, pauldron: 0x57514e } },
  huojian: { kind: 'rocket' },
  pili: { kind: 'trebuchet' },
  // 日本：阵笠、背旗、太刀铁炮
  yari: { kind: 'foot', human: { weapon: 'spear', armor: 'do', armorColor: DARK, helm: 'jingasa', helmColor: 0x2a2a30, banner: true, skirt: 0.25, legs: 0x2e2c34 } },
  samurai: { kind: 'foot', human: { weapon: 'katana', armor: 'do', armorColor: LACQUER, helm: 'kabuto', helmColor: 0x2a2226, plume: GOLD, pauldron: LACQUER, banner: true, skirt: 0.32, skirtColor: LACQUER, size: 1.05 } },
  yumi: { kind: 'foot', human: { weapon: 'longbow', helm: 'jingasa', helmColor: 0x2a2a30, quiver: true, skirt: 0.25, legs: 0x2e2c34 } },
  teppo: { kind: 'foot', human: { weapon: 'gun', armor: 'do', armorColor: DARK, helm: 'jingasa', helmColor: 0x2a2a30, skirt: 0.25, legs: 0x2e2c34 } },
  kiba: { kind: 'horse', coat: 0x6a4428,
    human: { weapon: 'katana', armor: 'do', armorColor: LACQUER, helm: 'kabuto', helmColor: 0x2a2226, plume: GOLD, pauldron: LACQUER, banner: true } },
  sohei: { kind: 'foot', human: { weapon: 'naginata', helm: 'cowl', tunic: 0xe6e0d0, skirt: 0.6, skirtColor: 0x2e2c34, cape: false } },
  ozutsu: { kind: 'cannon' },
  // 罗马：环片甲、大方盾、短剑
  legion: { kind: 'foot', human: { weapon: 'sword', shield: 'scutum', armor: 'bands', helm: 'crest', helmColor: STEEL, plume: RED, legs: 'skin', skirt: 0.3, size: 1.03 } },
  auxilia: { kind: 'foot', human: { weapon: 'spear', shield: 'oval', armor: 'mail', armorColor: 0x8c8f94, helm: 'galea', helmColor: BRONZE, legs: 'skin', skirt: 0.3 } },
  velites: { kind: 'foot', human: { weapon: 'javelin', shield: 'small', shieldColor: LEATHER, helm: 'none', legs: 'skin', skirt: 0.32 } },
  sagitt: { kind: 'foot', human: { weapon: 'bow', armor: 'mail', armorColor: 0x8c8f94, helm: 'cone', helmColor: STEEL, quiver: true, legs: 'skin', skirt: 0.3 } },
  equites: { kind: 'horse', coat: 0x7a4a2a,
    human: { weapon: 'lance', shield: 'oval', armor: 'mail', armorColor: 0x8c8f94, helm: 'crest', helmColor: BRONZE, plume: RED, cape: true, legs: 'skin' } },
  scorpio: { kind: 'ballista' },
  onager: { kind: 'onager' },
  // 波斯：软帽长袍、藤牌、鳞甲重骑
  spara: { kind: 'foot', human: { weapon: 'spear', shield: 'wicker', helm: 'tiara', plume: GOLD, skirt: 0.5, legs: 0xb07a3c } },
  immortal: { kind: 'foot', human: { weapon: 'spear', shield: 'oval', shieldColor: 0x8a5a2a, armor: 'scale', armorColor: BRONZE, helm: 'tiara', plume: CREAM, quiver: true, skirt: 0.55, legs: 0x6e3460, size: 1.03 } },
  kamandar: { kind: 'foot', human: { weapon: 'bow', helm: 'tiara', plume: GOLD, quiver: true, skirt: 0.45, legs: 0xb07a3c } },
  asvaran: { kind: 'horse', coat: 0xc9b08a, human: { weapon: 'bow', helm: 'tiara', plume: GOLD, quiver: true, legs: 0xb07a3c } },
  cataphract: { kind: 'horse', coat: 0x3a3030, barding: 0x9aa0a8, size: 1.05,
    human: { weapon: 'lance', armor: 'scale', armorColor: STEEL, helm: 'scalecap', helmColor: STEEL, plume: GOLD, pauldron: STEEL } },
  elephant: { kind: 'elephant' },
  mangonel: { kind: 'onager' },
};

/**
 * 高级形态的模型（id 是原模型加 _e）：不用逐个登记，按阵营的重甲样式从初级形态推出来——
 * 人换上全身甲（胸背甲、甲裙、臂甲、腿甲、护颈、重盔），马披全身马甲，器械包铁加挡板，战象披甲。
 * 想给某个兵种单独设计，直接在上面的表里登记「key_e」即可，这里不会覆盖。
 */
const HEAVY: Record<FactionId, { armor: Armor; metal: number; dark: number; trim: number; helm: Helm }> = {
  china: { armor: 'lamellar', metal: 0x4c5058, dark: 0x34373d, trim: GOLD, helm: 'tassel' },
  japan: { armor: 'do', metal: 0x26242c, dark: 0x19181d, trim: GOLD, helm: 'kabuto' },
  rome: { armor: 'bands', metal: 0xc6ccd4, dark: 0x9299a2, trim: GOLD, helm: 'crest' },
  persia: { armor: 'scale', metal: 0xcfa94e, dark: 0x9a7a34, trim: CREAM, helm: 'scalecap' },
};
const LIGHT_HELMS = new Set<Helm>(['none', 'futou', 'straw', 'tiara', 'cowl', 'jingasa', 'cone', 'galea']);

function heavyLook(L: HumanLook, f: FactionId): HumanLook {
  const H = HEAVY[f];
  return {
    ...L,
    armor: L.armor && L.armor !== 'none' && L.armor !== 'mail' ? L.armor : H.armor,
    armorColor: H.metal, pauldron: H.metal, plate: H.metal, trim: H.trim, vambrace: H.metal, cuisse: H.dark, greaves: H.metal, aventail: H.dark,
    helm: LIGHT_HELMS.has(L.helm ?? 'none') ? H.helm : L.helm, helmColor: H.metal, plume: L.plume ?? RED,
    skirt: Math.max(L.skirt ?? 0.22, 0.36),
    legs: L.legs === 'skin' || L.legs === undefined ? 0x3a3630 : L.legs,
    cape: true, capeTeam: true, size: (L.size ?? 1) * 1.05,
  };
}

for (const d of UNITS) {
  if (d.tier !== 1) continue;
  const base = MODELS[UNITS[d.basic].model];
  if (!base || MODELS[d.model]) continue;
  const H = HEAVY[d.faction];
  MODELS[d.model] = base.kind === 'foot' ? { ...base, human: heavyLook(base.human, d.faction) }
    : base.kind === 'horse' ? { ...base, human: heavyLook(base.human, d.faction), barding: H.metal, bardingFull: true, size: (base.size ?? 1) * 1.04 }
    : { ...base, armored: true };
}

export type { HumanLook };
