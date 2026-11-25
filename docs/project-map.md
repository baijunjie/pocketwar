# 项目地图

浏览器里的单机千人会战即时战略（Vite + TypeScript + three.js）。模拟层与渲染、界面分离：`src/sim/` 不依赖 DOM，可在 Node 里无头运行；其余层读它的状态。

## 模块

| 路径 | 职责 |
|------|------|
| `src/main.ts` | 入口：菜单与对局的切换，加载模型素材后启动对局 |
| `src/game.ts` | 一局游戏：主循环、镜头、选择与指令输入，把模拟、渲染、界面、音效串起来 |
| `src/sim/` | 纯逻辑的模拟层（世界状态、地图、寻路、开局部署） |
| `src/sim/world.ts` | 世界状态（单位、建筑、据点、投射物、环境、补给）与系统管线 `World.tick()` |
| `src/sim/state.ts` | 模拟层共用常量：容量上限、指令、状态位、特效种类，不依赖任何模块 |
| `src/sim/map.ts`、`src/sim/nav.ts`、`src/sim/rng.ts`、`src/sim/setup.ts` | 程序化地图生成；通行网格与流场寻路；可复现随机数；开局建图、摆放据点与部署双方部队 |
| `src/sim/siteArea.ts` | 据点范围判定：有围墙的据点（城池、营寨）按围墙矩形，没有的（资源点、临时据点）按占领圈，提供点在范围内与到范围边缘距离，以及据点是否在交战（`fightState`，选址、索敌、修复共用，放这里免得索敌与据点系统互相引用） |
| `src/sim/rally.ts` | 集结点：哪些据点能设（只有出援军的）、玩家指令作用于哪几座，界面、渲染与指令共用 |
| `src/sim/defs.ts` | 兼容入口，转出 `content/` 的静态数据 |
| `src/sim/content/` | 只放数据：原型、特性（可带光环，加成种类是 `types.ts` 里固定的表 `AURA_KINDS`）、兵种、体型、等级、阵营、建筑（按军事、城防、普通分角色）、据点（城池、营寨、资源点、临时据点四大类）与全部规则数值（`types.ts` 提供登记函数）；`units.ts` 依次定义原型、特性与兵种表 |
| `src/sim/content/points.ts`、`force.ts`、`prices.json` | 点数与兵力：`points.ts` 管点数维度、阶梯、级数范围、价目表估算点数与阵营、援军预算；`force.ts` 管兵力占用与兵员、援军倍率；`prices.json` 是价目表，由测量工具生成、不手改 |
| `src/sim/systems/` | 只放算法：每个文件一个系统，由 `index.ts` 的管线顺序调用；系统里不写死数字、不认具体兵种 |
| `src/sim/systems/sites.ts`、`economy.ts`、`targeting.ts` | 据点逻辑所在：`sites.ts` 管占领（军事建筑拆光才能读秒）、休整、按据点的援军（营寨按占领方所选兵种出）与集结点、丢光城池与营寨判负；`economy.ts` 管据点三级升级、资源点哨塔与临时据点；`targeting.ts` 的 `canAttackBuilding` 判定建筑能否被攻击 |
| `src/sim/systems/units.ts`、`detour.ts`、`around.ts` | 单位每帧行为（`units.ts`）及它调用的两块接敌辅助：`detour.ts` 近战被挡时绕到敌群外缘的空位，`around.ts` 追击时绕开小障碍的局部寻路；索敌（含远程去打墙顶敌兵）在 `targeting.ts` |
| `src/sim/systems/aura.ts` | 光环：定期重新判定，由带光环特性的存活单位给半径内的其他己方单位写入加成（`World.aura`），伤害结算读它 |
| `src/sim/ai/` | 指挥官接口与登记表（`commander.ts`），战略 AI（`strategic.ts`），以及电脑给营寨选兵种的办法（`picker.ts`） |
| `src/render/` | three.js 渲染层：把模拟状态每帧写进实例缓冲并绘制 |
| `src/render/renderer.ts` | 场景、镜头、拾取，各绘制部件的总管 |
| `src/render/terrain.ts` | 高度场地形、河水、战争迷雾贴图 |
| `src/render/units.ts`、`src/render/rig.ts` | 单位按（队伍，兵种）实例化绘制；骨骼动画烘焙成贴图 |
| `src/render/buildings.ts` | 代码建模的建筑、围墙、树石、桥 |
| `src/render/quads.ts`、`src/render/portrait.ts`、`src/render/minimap.ts` | 贴地标记、粒子、血条与文字；兵种头像；小地图 |
| `src/render/assets.ts`、`src/render/materials.ts`、`src/render/prims.ts` | glTF 加载与几何处理；材质补丁（迷雾、骨骼贴图动画）；代码生成的基本体 |
| `src/render/models/` | 模型：`catalog.ts` 登记兵种用哪个模型（换素材改这里），`spec.ts` 说明格式与总入口，`builders.ts`、`human.ts` 代码建模 |
| `src/ui/` | 主菜单（`menu.ts`）与游戏内界面（`hud.ts`） |
| `src/audio/sound.ts` | 音效：Web Audio 现场合成，战斗声取自模拟层的特效事件 |
| `src/dev/viewer.ts` | 开发用预览页（兵种与动画、静态素材、glTF） |
| [`tools/measure/`](../tools/measure/README.md) | 对战测量工具（开发用，游戏运行时不引用）：无头对战量出兵种点数与价目表，核对阵营点数与预算；生成 `content/prices.json` 与自带的实测表 |
| `tests/` | 无头测试（模拟层与测量工具） |

## 层间约定

- `content/` 与 `systems/` 的分工：加兵种、调数值只动 `content/`，换算法只动 `systems/`；`World` 只存状态。
- 模拟层的世界是平的，地形高度只存在于渲染层；模拟坐标 `(x, y)` 对应 three.js 的 `(x, z)`，单位为世界像素。
- 渲染层读模拟状态：单位的状态位与朝向、`seen`（被哪一队看见）、`env`（天光、雨势）；特效事件队列 `World.fx` 由渲染与音效消费。
