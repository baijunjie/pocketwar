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
| `src/sim/defs.ts` | 兼容入口，转出 `content/` 的静态数据 |
| `src/sim/content/` | 只放数据：兵种、类别、体型、等级、阵营、建筑、据点与全部规则数值（`types.ts` 提供登记函数） |
| `src/sim/systems/` | 只放算法：每个文件一个系统，由 `index.ts` 的管线顺序调用；系统里不写死数字、不认具体兵种 |
| `src/sim/ai/` | 指挥官接口与登记表（`commander.ts`），以及战略 AI（`strategic.ts`） |
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
| `tests/` | 无头测试（模拟层） |

## 层间约定

- `content/` 与 `systems/` 的分工：加兵种、调数值只动 `content/`，换算法只动 `systems/`；`World` 只存状态。
- 模拟层的世界是平的，地形高度只存在于渲染层；模拟坐标 `(x, y)` 对应 three.js 的 `(x, z)`，单位为世界像素。
- 渲染层读模拟状态：单位的状态位与朝向、`seen`（被哪一队看见）、`env`（天光、雨势）；特效事件队列 `World.fx` 由渲染与音效消费。
