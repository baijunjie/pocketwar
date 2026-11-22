# 烽烟

浏览器里的千人会战即时战略。不建造、不采集：开局即拥有整支军队，调兵遣将、争夺据点、攻破敌方主堡。

- 四个阵营：中国、日本、罗马、波斯，各有 7 个兵种与专属特性
- 全 3D 画面：透视镜头可平移、缩放、旋转，立体地形与河流，实时光照与阴影
- 同屏数千单位：模拟层用 SoA + 空间网格 + 共享流场寻路；渲染层把骨骼动画烘焙进贴图，每个兵种一次实例化绘制
- 程序化大地图（320×320 格）：河流、浅滩、桥、森林、丘陵、山脉；城池、城镇、营地、村庄、马场、工坊
- 所有建筑均可破坏；城墙挡路时部队会自动攻城
- 占领据点后，援军定时从己方后方入场；据点同时产粮，粮草不足士气就垮
- 士气与溃逃、等级与经验、行军 / 战斗两种状态，骑兵冲锋、枪兵立枪、盾兵举盾
- 昼夜与天气：夜里视野缩小、可打火把，下雨拖慢行军
- 城邦的石墙可以驻守，只有器械和战象能破；士兵打建筑是扔火把
- 单机对战 AI，另有观战模式（AI 对 AI）
- 士兵、器械、战象、建筑、树石全部由代码按真人比例建模并生成动作，四个阵营各有盔甲、头盔、盾牌与主堡样式；只有马用了一个 CC0 模型（见「素材」）

## 运行

```bash
npm install
npm run dev      # 开发服务器
npm run build    # 类型检查并打包到 dist/
npm test         # 无头模拟测试
```

需要支持 WebGL2 的桌面浏览器。

开发用预览页：`/?view=units` 查看全部兵种模型与动作（`&k=legion` 只看某个兵种）；
`/?view=gltf&gltf=quaternius/horse.glb` 预览任意 glTF 模型经通用流程烘焙后的样子。

调试用直达参数：`/?f=china&e=japan&size=600&seed=42&fog=0&spectate=1`
（`f`/`e` 取 `china`、`japan`、`rome`、`persia`；`d` 为难度 0–2）。

## 操作

| 操作 | 作用 |
|---|---|
| 左键点击 / 拖框 | 选择部队（Shift 加选，双击选中屏幕内同类） |
| 右键地面 | 移动，自动列阵：近战在前、远程居后、器械殿后 |
| 右键敌军 / 敌方建筑 | 攻击（Ctrl+右键强攻中立建筑） |
| A + 左键 | 攻击移动：沿途遇敌即战，遇墙自动破城 |
| S / H | 停止 / 坚守 |
| R + 左键 | 设置援军集结点 |
| T | 点燃 / 熄灭所选部队的火把（夜间） |
| Ctrl 或 Alt+数字 / 数字 | 编队 / 选中编队（连按两次跳转镜头） |
| Ctrl+A | 选中全军 |
| 方向键、中键拖动、小地图 | 移动镜头；滚轮缩放；全屏时可用屏幕边缘滚动 |
| Q / E、Alt（或 Shift）+ 中键拖动 | 旋转镜头；上下拖动调整俯角 |
| 空格、+ − | 暂停、调速 |

## 规则摘要

完整规则与全部数值见 [docs/gameplay.md](docs/gameplay.md)。

- **胜负**：摧毁敌方大本营的主堡。
- **据点**：先肃清占领圈内的守军，再派人站到中央旗帜下读秒；敌人回来读秒暂停，旗下没人则清零。
  占领后定时出援军、产粮，被毁的建筑一并修复。城池出精锐、城镇出步弓混编、营地与村庄出步兵、马场出骑兵、工坊出攻城器械。
- **城邦与营寨**：士兵和骑兵打建筑是扔火把，营寨的木栅一烧就垮；城邦的石墙和箭楼只有器械与战象能破。
  己方单位可以上自家城墙驻守。
- **士气**：敌众我寡、伤亡、断粮、淋雨都会压低士气，见底的部队变白溃逃，逃回己方据点才恢复指挥；老兵更稳，满级死战不退。
- **粮草**：据点产粮、部队吃粮，只靠大本营养不活全军。
- **昼夜天气**：夜里视野缩小，火把照得远但会暴露自己；下雨时火把点不着、行军变慢。
- **行军与战斗**：平时慢走、遇敌才跑；一起下令的部队按最慢的行军。骑兵远距离接敌会冲锋，枪兵见骑兵冲来会立枪，盾兵遇弓箭手会举盾。
- **等级**：击杀与助攻得经验，升级加生命和攻防，不加速度。
- **地形**：高地上的远程部队射程 +12%、伤害 +15%；森林使所受远程伤害 −25% 并拖慢骑兵；浅滩可涉水但减速；道路加速。
- **兵种克制**：枪兵克骑兵与战象，骑兵克远程与器械，刀剑步兵克枪兵。
- **伤害** = 攻击 × 克制倍率 − 护甲 ×（1 − 破甲），最低为 1。

## 目录

```
src/sim/          纯逻辑，不依赖 DOM，可在 Node 中无头运行
  content/        可替换的内容：数据表，不含算法
    types.ts        类型与登记函数（defineUnit / defineClass / defineSize）
    units.ts        兵种与类别
    rules.ts        体型、等级，以及士气、昼夜、粮草、攻坚等全部规则数值
    factions.ts  buildings.ts  sites.ts
  systems/        固定的算法：每个文件一个系统，由 World.tick() 按管线调用
    units.ts        单位每帧行为（行军 / 追击 / 攻击 / 溃逃 / 特殊动作）
    targeting.ts    索敌        combat.ts   伤害、经验、投射物、箭楼
    morale.ts       士气与溃逃  vision.ts   视野与战争迷雾
    environment.ts  昼夜天气    supply.ts   粮草
    sites.ts        占领与援军  orders.ts   指令   formation.ts  阵型
  ai/             指挥官接口与战略 AI（可登记别的算法）
  world.ts        世界状态与系统管线；state.ts 常量
  map.ts  nav.ts  setup.ts   地图生成、流场寻路、开局部署
src/render/       three.js 渲染
  models/         模型：catalog.ts 登记表（换素材改这里）、spec.ts 说明格式与 glTF 通用构建器、
                  builders.ts / human.ts 代码建模
  renderer.ts     场景、镜头、拾取，每帧把模拟状态写进实例缓冲
  terrain.ts      高度场地形、河水、战争迷雾贴图
  rig.ts          骨骼动画烘焙成贴图；units.ts 按兵种实例化绘制
  buildings.ts    代码建模的建筑、树石、桥
  quads.ts        贴地标记、粒子、血条、文字；portrait.ts 兵种头像；minimap.ts 小地图
src/dev/          模型预览页
src/ui/           主菜单与游戏内界面
src/game.ts       主循环、镜头、选择与指令输入
tests/            无头测试；VITE_BALANCE=1 npx vitest run -t 平衡 可跑阵营对战统计
```

### 加一个兵种 / 换一个模型

- **加兵种**：在 `src/sim/content/units.ts` 加一行 `U(阵营, key, 名称, 类别, { 属性 }, 说明)`，
  再在 `src/render/models/catalog.ts` 里用同一个 key 登记模型，并把它写进 `factions.ts` 的编制。
- **换模型**：改 `catalog.ts` 里那一项。用现成的 glTF 模型时写成
  `{ kind: 'gltf', src: '路径.glb', height: 1.8, clips: { idle: 'Idle', walk: 'Walk', run: 'Run', attack: 'Attack', die: 'Death' } }`，
  文件放进 `public/assets/`。缺的动作会自动退到相近的；先用 `/?view=gltf&gltf=路径.glb` 看效果。
- **调规则**：数值都在 `src/sim/content/rules.ts`，改完同步改 `docs/gameplay.md`。

## 素材

| 文件 | 来源 | 授权 |
|---|---|---|
| `public/assets/quaternius/horse.glb` | Quaternius「Horse」（Ultimate Animated Animals），取自 <https://poly.pizza/m/qvTrSG9pZF> | CC0 1.0 |

其余模型与贴图均由本仓库代码生成。运行时依赖 [three.js](https://threejs.org/)（MIT）。
