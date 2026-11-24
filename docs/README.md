# 总索引

## 项目地图

- [project-map.md](project-map.md)：代码在哪个目录、各目录管什么，`sim` / `render` / `ui` 之间怎么分工与读写对方的状态。

## 产品文档（游戏现在是什么样，规则与数值以这里为准）

- [product/match.md](product/match.md)：对局整体——概述、主菜单设置、地图构成、开局部署、电脑对手难度与行为限制、胜负。
- [product/factions.md](product/factions.md)：四阵营的特点与倍率，全部兵种数值表，开局编制，各类据点出的援军。
- [product/units.md](product/units.md)：兵种通用规则——类别与克制、体型、等级与经验、高级形态、特殊动作、兵种特性。
- [product/movement.md](product/movement.md)：行军——地形速度、行军与战斗状态、人与人的推挤（自己人穿过、不往自己人身上挤）、编队行军与纵队、默认队列、指定朝向。
- [product/combat.md](product/combat.md)：战斗——伤害公式与倍率、高地与林地、寻敌（挤不进战线时往两侧绕）、自动打建筑、守军、待命与坚守。
- [product/morale.md](product/morale.md)：士气加减、溃逃阈值、溃兵恢复与逃散。
- [product/environment.md](product/environment.md)：迷雾与视野、昼夜、火把、雨雪、风。
- [product/economy.md](product/economy.md)：粮草产耗与断粮，木 / 石 / 金的产量与用处，电脑怎么花资源。
- [product/sites.md](product/sites.md)：据点——城邦与营寨、资源点与箭塔、升级、临时据点、占领、休整修复、废墟、援军。
- [product/siege.md](product/siege.md)：攻城与城防——防御建筑放箭、火把与器械打建筑、驻守城墙、全部建筑数值表。
- [product/controls.md](product/controls.md)：操作与界面——选择、指令、编队、镜头与跟随、各面板、小地图、场景标记、音效、观战与结算。

## 编码规范

- [coding-standards.md](coding-standards.md)：写代码、审查改动时对照——模拟层与渲染界面的分层、content / systems 分工、几处要同改的规则、材质与插值、可点元素、测试断言。

## 开发记忆（开工前按主题读）

- [memory/render-ui.md](memory/render-ui.md)：改渲染前读——three.js 版本锁定与升级时要核对的着色器补丁、渲染提速先从哪下手。
- [memory/verification.md](memory/verification.md)：测性能、复现或量化模拟层行为、验画面或音效前读——怎么量帧率、背靠背比较、比模拟耗时要用打包后的代码测、无头复现脚本怎么跑与看队形出图、动态效果与音效怎么验。

## 开发计划（临时文档，做完即删）

- TODO [plans/20261124-兵种数值建模/README.md](plans/20261124-兵种数值建模/README.md)：兵种数值建模——统一伤害公式、原型与标签、以对战实测定点数、按兵力占用计兵力、以实测强度定阵营预算并用循环赛验收的方案总览，七个里程碑的清单、原型验证的实测数字与待定项。
- TODO [plans/20261124-据点规范化/README.md](plans/20261124-据点规范化/README.md)：据点规范化——城池、营寨、资源点三类的建筑构成与火力，军事建筑、城防、普通建筑三种角色，拆光军事建筑才能占领，1–3 级升级，分据点集结点，矩形据点范围，取消大本营改为丢光城池营寨判负；五个里程碑的清单，以及与兵种数值建模计划的先后。

## 专题

- [art-assets.md](art-assets.md)：画风要求（写实、真人比例）与现成 CC0 模型素材的调研结论；找素材或换模型前读。
