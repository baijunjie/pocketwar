# 项目地图

浏览器里的单机千人会战即时战略（Vite + TypeScript + three.js）。模拟层与渲染、界面分离：`src/sim/` 不依赖 DOM，可在 Node 里无头运行；其余层读它的状态。

## 模块

| 路径 | 职责 |
|------|------|
| `src/main.ts` | 入口：菜单与对局的切换，加载模型素材后启动对局 |
| `src/game.ts` | 一局游戏：主循环、镜头、选择与指令输入（含鼠标、触控板的镜头操作），把模拟、渲染、界面、音效串起来；还管桌面版与移动版竖屏界面的切换（主要指针是触屏且竖屏时自动进移动版，设置里「界面」可覆盖）与移动版上半屏的触屏输入，移动版不做边缘卷屏；还把卡片的取消选中、长按卡片时的升级选择（`upgradeChoices`，报价与成交按 uid 锁定那批人）、暂停与速度档（1 / 2 / 4 循环）这些回调实现给 `Hud` |
| `src/camInput.ts` | 镜头输入的纯判定，不碰 DOM：贴边卷屏速度、鼠标从哪条边离开网页的续卷方向、滚轮事件是鼠标还是触控板（`WheelClassifier`、`WheelMode`）、缩放范围（`ZOOM_MIN` / `ZOOM_MAX`，`render/renderer.ts` 的镜头限幅也用）与缩放条位置的换算（`zoomToFrac` / `fracToZoom`，按对数映射），由 `game.ts` 接到事件上 |
| `src/touchInput.ts` | 移动版触屏输入的纯判定，不碰 DOM：界面模式（`UiMode`、`asUiMode`、`isMobileUi`）、上半屏手势分类（`TouchGestures`：点、长按、单指框选、双指缩放旋转平移；`pinchOf`）、卡片带起手方向（`cardIntent`，偏向拖卡片）、拖卡片时落点（剑尖）相对手指的偏移（`dropOffset`：恒定距离，平时朝上，靠近屏幕底时往小地图那一侧放倒）、镜头摇杆读数（`stickVector`，死区与曲线）、点在不在矩形内切圆里（`inInscribedCircle`，移动版小地图只认圆内）、抽屉滑动方向（`swipeDir`），由 `game.ts`、`ui/cardBar.ts`、`ui/joystick.ts` 接到事件上 |
| `src/pointerLock.ts` | 锁定鼠标模式（`PointerLock`：Pointer Lock + 自绘光标）：在 window 捕获阶段拦下真实事件，改发给虚拟光标下元素的合成事件，自带 pointer capture、悬停、连击计数、提示框，全屏时用 Keyboard Lock 拦 Esc；文件开头是不碰 DOM 的纯函数；由 `game.ts` 创建，须早于 `Hud`（监听注册顺序决定它能拦住真实事件） |
| `src/backGuard.ts` | 防误触「返回」而离开页面（单机对局不存档）：`BackGuard`（`start` / `stop`）对局期间在浏览历史里垫一条记录，返回只弹掉它，玩家下一次操作时再垫回；`inEdgeZone`、`blocksEdgeSwipe` 判定哪些从屏幕边缘起手的 touchstart 要拦下默认行为（iOS Safari 的边缘返回手势，只对自己用 pointer 事件处理手指的界面生效）；由 `game.ts` 接到事件上 |
| `src/prefs.ts` | 玩家偏好的本地存储（`loadPref`、`savePref`，键统一 `fengyan.` 前缀），`game.ts` 与 `hud.ts` 共用 |
| `src/sim/` | 纯逻辑的模拟层（世界状态、地图、寻路、开局部署） |
| `src/sim/world.ts` | 世界状态（单位、建筑、据点、投射物、环境、补给）与系统管线 `World.tick()` |
| `src/sim/state.ts` | 模拟层共用常量：容量上限、指令、交手状态（`ENG_*`，`World.engaged` 的三态）、状态位、特效种类，不依赖任何模块 |
| `src/sim/ease.ts` | 通用缓动函数（平滑阶跃 `smooth`），不依赖任何模块 |
| `src/sim/map.ts`、`src/sim/nav.ts`、`src/sim/rng.ts`、`src/sim/setup.ts` | 程序化地图生成；通行网格与流场寻路；可复现随机数；开局建图、摆放据点与部署双方部队 |
| `src/sim/siteArea.ts` | 据点范围判定：有围墙的据点（城池、营寨）按围墙矩形，没有的（资源点、临时据点）按占领圈，提供点在范围内与到范围边缘距离，以及据点是否在交战（`fightState`，选址、索敌、修复共用，放这里免得索敌与据点系统互相引用） |
| `src/sim/rally.ts` | 集结点：哪些据点能设（只有出援军的）、玩家指令作用于哪几座，界面、渲染与指令共用 |
| `src/sim/defs.ts` | 兼容入口，转出 `content/` 的静态数据 |
| `src/sim/content/` | 只放数据：原型、特性（可带光环，加成种类是 `types.ts` 里固定的表 `AURA_KINDS`）、兵种、体型、等级、阵营、建筑（按军事、城防、普通分角色）、据点（城池、营寨、资源点、临时据点四大类）与全部规则数值（`types.ts` 提供登记函数；兵种的攻击由武器表 `UnitDef.weapons` 描述，类型与按用途取出的 `main`、`aux`、`torch` 都在这里，防御建筑的火力武器表见 `buildings.ts`）；`units.ts` 依次定义原型、特性与兵种表 |
| `src/sim/content/points.ts`、`budget.ts`、`force.ts` | 点数与兵力：`points.ts` 管点数维度、阶梯、级数范围、维度单价与兵员单价、阵营与援军的固定预算、单兵种点数上下限（特性的点数写在 `defineTrait` 的 `points` 上）；`budget.ts` 是阵营点数与援军点数的计账、补到预算的兵员级数与援军级数（纯函数）；`force.ts` 管兵力占用与兵员、援军倍率 |
| `src/sim/systems/` | 只放算法：每个文件一个系统，由 `index.ts` 的管线顺序调用；系统里不写死数字、不认具体兵种 |
| `src/sim/systems/sites.ts`、`economy.ts`、`targeting.ts` | 据点逻辑所在：`sites.ts` 管占领（军事建筑拆光才能读秒）、休整、按据点的援军（营寨按占领方所选兵种出）与集结点、丢光城池与营寨判负；`economy.ts` 管据点三级升级、资源点哨塔与临时据点；`targeting.ts` 的 `canAttackBuilding` 判定建筑能否被攻击、`crowded()` 判定目标是否已被围满 |
| `src/sim/systems/combat.ts` | 战斗结算：单位出手统一走 `strike()`（按武器表出手），以及伤害、阵亡、经验升级、投射物与防御建筑的放箭 |
| `src/sim/systems/units.ts`、`detour.ts`、`around.ts` | 单位每帧行为（`units.ts`）及它调用的两块接敌辅助：`detour.ts` 近战被挡时绕到敌群外缘的空位，连空位也没有时的等待与沿敌群外缘的游走，`around.ts` 追击时绕开小障碍的局部寻路；索敌（含远程去打墙顶敌兵）在 `targeting.ts` |
| `src/sim/systems/orders.ts`、`formation.ts`、`march.ts`、`marchTrail.ts`、`marchChoke.ts`、`marchSlots.ts` | 移动命令与编队行军：`orders.ts` 落实玩家指令（含行军途中改道能否沿用原编队的判断）；`formation.ts` 把一批人排成横队，给出每人的排与排内序号、各排的宽、深、最大半径、最慢奔跑速度；编队行军（弹性队列：过窄处按通道宽度收窄、折排，过后展开）拆在四个 `march*.ts`。一道命令里的部队共用两个看不见的点：**探路点**走在队列前方，照单个单位的最短路线沿流场前瞻，每隔一小段记一个行迹点；**最前排**是行迹上落后探路点一段路程的那一点，队列各排沿行迹往后排。`march.ts` 管编队对象、建立与重新整队、行军途中改道、探路点怎么走与每帧最前排走多快；`marchTrail.ts` 管行迹缓冲，以及每个行迹点上记的通道宽度（含按坡度的包络）；`marchChoke.ts` 在行迹点上认窄处、量宽度；`marchSlots.ts` 管各排占行迹的哪一段、成员的队列位置，以及成员跟着哪一点走、到达后何时离队。成员的排与排内序号存在 `World.marchRow`、`World.marchCol` |
| `src/sim/systems/aura.ts` | 光环：定期重新判定，由带光环特性的存活单位给半径内的其他己方单位写入加成（`World.aura`），伤害结算读它 |
| `src/sim/systems/effects.ts` | 单位身上增减益的查询（不在系统管线里，不是每帧运行的系统）：`unitEffects(w, i)` 只读世界状态，列出此刻城墙、地形、雨雪、顺逆风、光环的倍率（来源、影响的数值、是否有利），供详情面板显示；`terrainSpeedMul`、`weatherSpeedMul` 是地形、雨雪对移动速度的倍率，`units.ts`、`march.ts` 共用 |
| `src/sim/ai/` | 指挥官接口与登记表（`commander.ts`），战略 AI（`strategic.ts`），以及电脑给营寨选兵种的办法（`picker.ts`） |
| `src/render/` | three.js 渲染层：把模拟状态每帧写进实例缓冲并绘制 |
| `src/render/renderer.ts` | 场景、镜头、拾取，各绘制部件的总管 |
| `src/render/terrain.ts` | 高度场地形、河水、战争迷雾贴图 |
| `src/render/units.ts`、`src/render/rig.ts`、`src/render/unitAnim.ts` | 单位按兵种实例化绘制（双方共用一批，队伍色是实例属性，模型里染色部位记在 `aTeam`）；骨骼动画烘焙成贴图，着色器在相邻帧间插值、换动作时与上一动作冻结的帧过渡；`unitAnim.ts` 记每个单位的动作状态（攻击播满全长、换动作过渡，按模拟时间计时） |
| `src/render/buildings.ts` | 代码建模的建筑、围墙、树石、桥 |
| `src/render/quads.ts`、`src/render/portrait.ts`、`src/render/minimap.ts` | 贴地标记、粒子、血条与文字；兵种头像；小地图（`minimap.ts` 的 `resize()` 让画布随显示尺寸重设，移动版放大后用；圆外左上角画天气角标、右上角画风向，共用随小地图尺寸缩放的角标底圆） |
| `src/render/assets.ts`、`src/render/materials.ts`、`src/render/prims.ts` | glTF 加载与几何处理；材质补丁（迷雾、骨骼贴图动画）；代码生成的基本体 |
| `src/render/models/` | 模型：`spec.ts` 总入口（先查素材清单 `public/assets/units/manifest.json`，没登记或素材出错退回代码建模，高级形态的素材坏了先借初级形态的素材；预加载 `loadUnitModels`），`manifest.ts` 清单的解析、校验与动作名查找，`gltf.ts` 把清单里的 glTF 烘成模型（单份骨骼模型、骑手挂马的 `saddle` 骨骼），`actions.ts` 标准动作名、退路与骑兵配马的动作，`catalog.ts`、`builders.ts`、`human.ts` 代码建模。素材约定见 [unit-art-spec.md](unit-art-spec.md) |
| `src/ui/` | 主菜单（`menu.ts`）与游戏内界面：`hud.ts`（`Hud`，含右上角设置面板，创建并持有底部卡片 `hud.cards`、移动版镜头摇杆 `hud.stick`、缩放条 `hud.zoom` 与编队按钮排；`setGroups` 把编队同时交给编队卡片与编队按钮排；设置面板里的速度是「暂停 / 继续」加一个循环切换的速度按钮（`setSpeed` 只管显示，操作走 `HudCallbacks.togglePause` / `cycleSpeed`）；长按卡片弹出的升级框（`UpgradeChoice`，各项由 `game.ts` 的 `HudCallbacks.upgradeChoices` 给出，框的摆放、指针与键盘确认都在 `hud.ts` 内；`selectionChanged` 供 `game.ts` 在选择变化时通知它收起，`closeUpgradeMenu` 直接收起）；选中单位 / 据点的详情面板（移动版替换卡片带以下的操作区，带关闭按钮；`reopenDetail` 让收起的详情重新弹出，`detailShown` 查是否显示着，`detailQuiet` 供 `game.ts` 在拖卡片下令等顺带换选择时压住不打开）；移动版另有卡片带最前面的「取消选择」按钮、菜单按钮、左右抽屉与边缘把手、遮罩，由 `setMobile` 切换；设置里的「摇杆位置」决定摇杆与缩放条放哪一侧、小地图在另一侧；观战时根元素带 `watch` 类，没有编队按钮与取消选择）、`cardBar.ts`、`joystick.ts`、`zoomSlider.ts`、`groupSlots.ts`、`pressable.ts`、`unitText.ts`、`sword.svg`。移动版的尺寸由 `src/style.css` 按 `#app` 宽度限幅、等比缩放，下半部分按内容定高 |
| `src/ui/cardBar.ts` | 底部卡片（`CardBar`）：最左的全选卡片（屏幕内全部己方部队，回调 `pickAll`）、兵种卡片与其上一排编队卡片的渲染（卡片种类 `CardKind`：`type` / `group` / `all`）、点击选择（单击已亮着的卡片是取消选中它代表的人，期间卡片带冻结约一个双击窗口，第二下判双击选同类全部）、长按弹升级选择（回调 `holdCard`）、拖拽下令（拖到地面或小地图上松开，松在敌军身上是攻击该单位，否则攻打建筑或让这批人攻击移动）、画面框选扫卡片时的命中（`cardsIn` 返回兵种、编队与是否含全选卡片，`markCards`）、全选卡片选中态的判定（纯函数 `allCardPicked`，`update` 收它的结果）；移动版的卡片带横向滚动与拖卡片（卡片立在手指上方，剑 `.dragptr` 从卡片顶上伸出去，剑尖是落点；手指离开按下处一段距离松手才下令；落在小地图圆外不算小地图；手指贴近屏幕底时剑往 `mapSide` 指的小地图那一侧放倒；拖拽中的卡片不盖住 Hud 传入的顶栏）；对外还有 `busy`（卡片带上有手指按着，带里的按钮此时不响应）、`cardRect(kind, id)`（某张卡片的视口矩形）、`cardsTop()`（所有卡片最高的上沿，升级框与详情据此避让）；取消选择按钮也走卡片带的手指归属（回调 `tapButton`）；回调接口 `CardBarCallbacks` 由 `game.ts` 实现（`HudCallbacks` 继承它，但去掉 `holdCard` 与 `tapButton`，这两项由 `Hud` 接管） |
| `src/ui/joystick.ts` | 移动版镜头摇杆（`Joystick`：DOM 与指针处理，放在小地图一侧，左右由设置决定），只暴露读数 `x` / `y`、`reset()`、`destroy()`；由 `Hud` 创建并持有，`game.ts` 每帧读它的读数卷屏 |
| `src/ui/zoomSlider.ts` | 移动版摇杆上方的横向缩放条（`ZoomSlider`：DOM 与指针处理，读写缩放条上的位置 0～1，`sync` 由 `game.ts` 每帧把镜头缩放同步进来，玩家拖动或点 − / + 时经构造回调通知）；由 `Hud` 创建并以 `hud.zoom` 暴露，变化时 `game.ts` 经 `HudCallbacks.zoomTo` 缩放镜头；`release()` 在缩放条被详情盖住不可交互时放掉按着的手指 |
| `src/ui/groupSlots.ts` | 移动版下半屏的一排编队按钮（`GroupSlots`，数量 `GROUP_SLOTS`＝8：点一下把所选部队编为这一队；`setGroups` / `update` / `destroy`），只管编队，选中一队靠卡片带里的编队卡片；由 `Hud` 创建并挂在小地图容器最上面，回调由 `game.ts` 的 `groupSlot` 实现 |
| `src/ui/pressable.ts` | `bindPress`：让元素自己用 pointer 事件分辨点一下与长按（不靠手指触发的 click），给贴屏幕边的触屏按钮用 |
| `src/ui/unitText.ts` | 兵种的文字说明（悬停提示 `unitTip`、光环加成与面板数值的写法、上千缩写的人数 / 资源 `compactNum`），`hud.ts`、`cardBar.ts`、`menu.ts` 共用，单独成文件以免 hud 与 cardBar 互相引用 |
| `src/ui/sword.svg` | 游戏内的剑形鼠标指针，样式表（`src/style.css`）与锁定鼠标的自绘光标（`src/pointerLock.ts`）共用 |
| `src/audio/sound.ts`、`src/audio/battlefield.ts` | `Sound` 按需加载、缓存和播放对局音频，管理暂停、静音和结算配乐。`Battlefield` 根据模拟事件、天气及镜头附近可见的战况选择音效、环境声和配乐，确定音量与左右声像 |
| [`public/audio/`](../public/audio/) | 对局使用的实录、拟音与授权配乐剪辑，另含备用素材。[`sampler.mp3`](../public/audio/sampler.mp3) 可连续试听一段混音后的战场场景 |
| `src/dev/viewer.ts` | 开发用预览页（兵种与动画、静态素材、glTF） |
| [`tools/measure/`](../tools/measure/README.md) | 对战测量工具（开发用，游戏运行时不引用）：无头对战量出兵种与阵营的实战强弱，只作参考、不写文件；另有不跑对战的点数明细与补级命令（计算在 `content/budget.ts`，`--write` 写回 `content/factions.ts`） |
| `tests/` | 无头测试（模拟层与测量工具；`tests/ui/` 是界面类测试，项目没有 jsdom，共用 `tests/ui/fakeDom.ts` 的极简假 DOM 在 node 环境里跑；`tests/bench/` 放不是测试文件的测量脚本，`tests/sim.test.ts` 的性能用例把它打包后在单独的 node 进程里跑并读其输出） |

## 层间约定

- `content/` 与 `systems/` 的分工：加兵种、调数值只动 `content/`，换算法只动 `systems/`；`World` 只存状态。
- 模拟层的世界是平的，地形高度只存在于渲染层；模拟坐标 `(x, y)` 对应 three.js 的 `(x, z)`，单位为世界像素。
- 渲染层读模拟状态：单位的状态位与朝向、`seen`（被哪一队看见）、`env`（天光、雨势）；特效事件队列 `World.fx` 由渲染与音效消费。
