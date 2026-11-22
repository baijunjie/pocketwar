/**
 * 模型登记表：兵种用哪个模型、长什么样，全在这里。换素材只改这个文件。
 *
 * 每一项是一份「模型说明」，kind 决定由哪个构建器来做：
 *   foot / horse      代码建模的士兵、骑兵（human 给出盔甲、武器等外观）
 *   elephant / onager / trebuchet / ballista / rocket / cannon   代码建模的战象与器械
 *   gltf              任意带骨骼动画的 glTF 模型（见 GltfSpec）
 * 键是 UnitDef.model（缺省等于兵种 key），所以多个兵种可以共用一个模型，也可以随时改指向。
 */
import type { HumanLook } from './human';
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

export type { HumanLook };
