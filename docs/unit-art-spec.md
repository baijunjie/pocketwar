# 兵种模型素材规范

兵种模型素材（`public/assets/units/`）与渲染代码之间的约定。做素材、换素材、改模型加载代码前读。
画风要求与现成素材调研见 [art-assets.md](art-assets.md)。

## 原则

- **与颜色无关**：模型本身不带队伍色。要染队伍色的部位（衣、披风、羽饰、盾面、旗）用名字以 `team` 开头的材质，
  底色画成浅的中性灰白；游戏里把队伍色乘上这部分的明度（`队伍色 × 底色明度`），所以同一个模型可以染成任何颜色。
  其余部位（金属、皮革、木头、皮肤、马的毛色）是真实颜色，不随队伍变。
- **与文明绑定**：每个兵种一份模型，放在所属阵营的目录下，盔甲、头盔、兵器、服饰体现该文明（见下面「各阵营特色」）。
- **可替换**：模型与动作由清单 `public/assets/units/manifest.json` 登记，换素材只换文件、改清单，不改代码。
  清单里没登记的模型 id 退回代码建模（`src/render/models/catalog.ts`）。素材加载失败或烘焙出错时同样退回代码建模（控制台报错），
  高级形态的素材坏了先借初级形态的素材。

## 目录

```
public/assets/units/
  manifest.json          清单：模型 id → 规格
  anims/human.glb        共用人形动作库：标准人形骨架 + 全部人形动作（可带一个参考网格，不会被画出来）
  anims/horse.glb        马：骨架、网格、动作（毛色是真实颜色；马甲用 team 材质或真实颜色）
  <阵营>/<模型 id>.glb   兵种网格：china / japan / rome / persia
tools/art/               生成素材的脚本（Blender Python），素材必须能由脚本重新生成
```

模型 id 就是兵种的 `UnitDef.model`（缺省等于兵种 key，如 `legion`）；高级形态是 `<id>_e`，没登记时沿用初级形态的模型。

## 通用格式

- GLB（glTF 2.0 二进制），单位米，+Y 朝上，模型面朝 +Z，原点在两脚之间的地面（器械、战象在底面中心）。
- 颜色：材质的 baseColor（因子或贴图）都可以；渲染时按顶点取色，所以颜色变化要落在面上，不靠贴图细节。
  不用法线贴图、透明、自发光。
- 面数上限（三角形，含兵器盾牌）：步兵 2000，骑手 1800，马 2600，战象 5000，器械 3000。千人同屏，超了会掉帧。
- 骨骼：每个模型（骑兵按骑手、马分别计）不超过 48 根。每个顶点最多两根骨骼影响有效，超出的权重会被丢掉，
  蒙皮按两根设计。
- 动作首尾要能无缝循环（循环动作）；位移原地化（不带根运动），一个循环前进多少米写进清单的 `stride`。

## 人形

- 全部人形兵种（步兵、骑手、战象上的人）用同一副骨架，骨骼名与绑定姿势和 `anims/human.glb` 完全一致；
  兵种 GLB 只带蒙皮网格，动作从动作库按骨骼名套上去。兵种 GLB 里也可以自带动作，同名时以兵种自带的为准。
- 推荐骨骼名：`root hips spine chest neck head shoulder.L/R upper_arm.L/R forearm.L/R hand.L/R thigh.L/R shin.L/R foot.L/R toe.L/R`，
  另有挂兵器的 `weapon.R`、`weapon.L`（盾挂 `weapon.L`），披风、裙摆、羽饰可加次级骨骼。
- 兵器、盾牌：做成网格，全部权重绑在 `weapon.R` / `weapon.L` 上，或作为这两根骨骼的子节点。
- 动作库按「持械姿态」分组，动作名是 `<姿态>.<动作>`。查找顺序：清单 `clips` 指定的；`<姿态>.<动作>`；
  沿下面「标准动作」表的缺省退路在本姿态里找，但不退到待命（如 `sword_shield.attackMoveL` 没有就用 `sword_shield.attackMove`、再用 `sword_shield.attack`）；
  再找不带前缀的通用动作 `<动作>`；都没有才用本姿态的 `idle`。通用动作只放适用于所有姿态的（如 `die`）。姿态由清单的 `set` 指定，例如：
  `sword_shield`（剑盾）、`spear_shield`、`spear`（双手长枪）、`polearm`（长柄刀戟）、`katana`（双手刀）、
  `javelin`（标枪）、`bow`、`longbow`、`crossbow`、`gun`、`ride_lance`、`ride_sword`、`ride_bow`。

### 标准动作

| 动作 | 循环 | 说明 |
|---|---|---|
| `idle` | 是 | 待命，持械站立，呼吸、重心轻微移动，2–4 秒 |
| `ready` | 是 | 交战中的戒备姿态（有攻击目标、站着没出手时），缺省退 `idle` |
| `walk` | 是 | 行军，步子小、上身挺直 |
| `run` | 是 | 奔跑 |
| `attack` | 否 | 出手。游戏在命中的那一刻开始播放，所以第 0.1–0.15 秒内就要打到，之后收势；全长 0.6–1.0 秒。站着出手、播过 0.3 秒后自己开始移动就打断；出手时就在移动的（边跑边打）不打断 |
| `attack2` / `attack3` / `attack4` | 否 | 另外几种站着出手的攻击（如劈、刺、盾击；弓手换不同的拉弓节奏），要求同 `attack`。每次出手从 `attack` 与这几种里随机挑一种（尽量不与上一次相同），所以每个姿态（含 `ride_*`）至少做 `attack`、`attack2`、`attack3` 三种；缺的退回 `attack` |
| `attackMove` | 是 | 边跑边打（骑射、标枪手边走边投），缺省退 `attack` |
| `attackMoveL/R/BL/BR` | 否 | 骑射手回身射击：上身朝左 90°、右 90°、左后 140°、右后 140°，缺省退 `attackMove` |
| `die` | 否 | 阵亡倒地，1–1.5 秒，停在最后一帧（尸体会留在地上） |
| `charge` | 是 | 冲锋（长枪放平、俯身前冲），缺省退 `run` |
| `brace` | 是 | 立枪拒马（枪尾抵地斜指前方），缺省退 `ready`、`idle` |
| `guard` / `guardWalk` | 是 | 举盾站立 / 举盾行进（罗马龟甲阵），缺省退 `ready`、`idle` / `walk` |

不同动作之间游戏会做 0.2 秒左右的过渡，各动作的起止姿态不必严格相同，但持械姿态要一致。

## 骑兵

- 骑手是一份人形 GLB（同一副人形骨架），用 `ride_*` 姿态的动作；马用 `anims/horse.glb`。
- 马的骨架里要有一根 `saddle` 骨骼，头部在鞍座上骑手胯下那一点。骑手 GLB 的原点（根节点）对齐到它：跟它的位置，
  并随它相对绑定姿势的转动而转动（不看骨骼的轴向）。所以 `ride_*` 动作里骑手的胯部要摆在原点附近、两腿跨开坐着。
- 马的动作名：`idle`、`walk`（行军，做成快步：对局里骑兵行军 3–6 米/秒，慢步只能快放成碎步）、`run`（袭步）、`die`。骑兵的每个标准动作由「骑手动作 + 马的动作」
  拼成：`walk / guardWalk` 配马 `walk`，`run / charge / attackMove*` 配马 `run`，`die` 配马 `die`，其余配马 `idle`。
- 马甲：清单可指定另一份披甲的马（`mount.src`），高级形态常用。

## 战象与器械

一份自带动作的 GLB（`idle`、`walk`、`attack`、`die`，器械的 `walk` 是推行），象背上的人直接做进同一份网格。

## 预览

`npm run dev` 后打开 `/?view=units&f=rome`：每个兵种把它有的标准动作排成一排，相邻兵种轮流染成几种队伍色；
`&k=legion` 只看一个兵种（连同高级形态），`&clip=attack` 只放一个动作，`&tint=c0392b` 指定队伍色。
清单写错时页面直接显示错误。未登记进清单的 GLB 可用 `/?view=units&gltf=units/rome/legion.glb&anims=units/anims/human.glb&set=sword_shield` 先看。

## 清单

```json
{
  "version": 1,
  "libraries": { "human": "units/anims/human.glb" },
  "models": {
    "legion": { "kind": "rig", "src": "units/rome/legion.glb", "anims": "human", "set": "sword_shield",
                "stride": { "walk": 1.5, "run": 2.6 } },
    "equites": { "kind": "mounted",
                 "rider": { "src": "units/rome/equites.glb", "anims": "human", "set": "ride_lance" },
                 "mount": { "src": "units/anims/horse.glb" },
                 "stride": { "walk": 1.8, "run": 4.2 } },
    "onager": { "kind": "rig", "src": "units/rome/onager.glb" }
  }
}
```

- 路径相对 `public/assets/`。
- `kind: "rig"`：单份骨骼模型。`anims` 是 `libraries` 里的动作库名，`set` 是持械姿态；不写 `anims` 时只用模型自带的动作。
- `clips`（可选）：标准动作名 → 素材里的动作名，覆盖上面的查找规则，如 `{ "attack": "sword_shield.thrust" }`。
- `stride`：`walk`、`run` 一个循环前进的米数，游戏按它让脚步与位移对上。
  对局里移动动作按「里程 ÷ stride」推进，素材自身的时长只影响预览页；做移动动作前先按对局速度算步频，
  动作时长取 stride ÷ 对局速度，预览与对局才一致。
- `scale`（可选）：整体缩放，缺省 1；素材按真实尺寸做时不写。`portrait`（可选）：头像取景高度（米）。
- 高级形态登记成 `<id>_e`，没有就用初级形态的。

## 各阵营特色（罗马为首批试点）

- **罗马**（共和末至帝国初）：军团兵——帝国盔（带护颊、护颈、横向或纵向羽冠）、环片甲、红色短袍、弧形长方大盾（scutum，盾面 team 色加金属边与盾心）、短剑 gladius、凉鞋；
  辅助兵——锁子甲、椭圆盾、长矛；投矛散兵——无甲短袍、狼皮头饰、小圆盾、标枪；弓手——锁子甲、尖盔、复合弓；骑兵——锁子甲、带羽冠骑兵盔、椭圆盾、长矛、马鞍下的鞍褥用 team 色。
  蝎弩、野驴投石机按罗马样式。高级形态加厚甲、披风（team 色）、更华丽的头盔。
- 中国（汉唐）、日本（战国）、波斯（阿契美尼德至萨珊）在试点验收后再做，特色另行细化。
