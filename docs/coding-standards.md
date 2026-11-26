# 编码规范

审查改动时对照本文。界面相关的规则集中在「界面」一节。

## 通则

- 沿用周围代码已有的做法：同类问题已有现成的函数、材质、数据开关的，复用它，不另起一套。
- 模拟层与渲染、界面分离：`src/sim/` 不依赖 DOM，也不引用 `src/render/`、`src/ui/`、`src/audio/`，否则测试无法在 Node 里无头运行。
- `src/sim/content/` 只放数据，`src/sim/systems/` 只放算法：数值写进 `content/`（规则数值在 `rules.ts`），系统里不写死数字、
  不按具体兵种 key 或原型 key 判断，加兵种、调数值才能只动 `content/`；系统要区分行为，读原型与特性上的数据开关（`ranged`、`mobile`、标签、`counter`、`hitMod` 之类）。
  调行为的数值（阈值、比例、时长、距离、力度）进 `rules.ts`；
  只为实现服务、改了不影响玩法的常量（缓冲区大小、采样方向数、候选上限、复查间隔）可以在系统文件里写成带注释的具名模块常量。

## 模拟层

- `src/sim/world.ts` 要用到的常量放 `src/sim/state.ts`（它不依赖任何模块），不放进 `world.ts`；只在系统之间用的，可以留在定义它的系统文件里。
  系统文件对 `world.ts` 只做 `import type`：
  否则形成循环引用，浏览器按另一种顺序加载时报 `Cannot access '…' before initialization`，而 Node 里的测试碰巧能过。
- 先用 64 位中间值做判断（比如下一步落在哪一格）、再存进 `Float32Array` 字段的，判断之前先 `Math.fround`：
  否则贴着格线时判断用的值还在本格，存进去却被舍入到隔壁格，绕过了检查。
- 改「相邻两格之间能不能直接走」的规则（墙顶、城内、城外这类），`src/sim/nav.ts` 的 `canStep` / `canStepDiag`（位移碰撞、绕行前瞻、流场搜索、追击绕行都调它们）
  与 `src/sim/world.ts` 的 `lineBlocked` 两处同改：漏一处，寻路、直线判断与实际位移就对不上。
- 改移动速度的系数（天气、风、地形之类），`src/sim/systems/units.ts` 的单位期望速度与 `src/sim/systems/march.ts` 的领队步长两处同改：
  只改一处，编队成员与队列位置会对不上。
- 新增下令函数、或在 `src/sim/systems/orders.ts` 之外改单位的命令或目的地时，先调 `leavePost`（腾垛口、取消出击与预留的站位），
  再照 `orders.ts` 里 `reset()` 清掉寻路进度（`stuck`、`bestD`、`noGain` 等）：漏清 `bestD / noGain`，单位刚派出去就被判到达、又被派出，原地循环。
- 读建筑的生命上限、火力用 `Building` 上的 `maxHp`、`tower`，不读 `b.def.hp`、`b.def.tower`：据点升级会改前两者（负责写入它们的升级逻辑除外）。
- 据点按下标取、不删除，遍历 `w.sites` 跳过 `gone` 的；各类据点的行为差异读 `SITE_INFO` 上的数据开关
  （`reinf`、`haven`、`counts`、`captureTime`、`towerSlots`、`regen`），不写 `s.type === SITE_CITY` 这类按据点类型的判断。
- 判断「单位或点在不在据点里、离据点多远」用 `src/sim/siteArea.ts` 的 `siteContains` / `siteGap`（有围墙的按围墙矩形，没有的按占领圈），
  不直接拿 `s.radius` 算圆：肃清、交战、休整、守军警戒与电脑判断敌情都按据点范围，只有旗帜区另按旗帜半径算。
- 建筑能不能被攻击用 `src/sim/systems/targeting.ts` 的 `canAttackBuilding`，不自己判 `b.def.fort` 或 `b.owner`：玩家指令、自动索敌、挡路攻城、电脑选目标、投射物都靠它排除普通建筑（范围伤害按同样的 `hittable`、`fort` 判断）；
  占领前要不要拆某座建筑看它的 `role`（军事建筑 `BR_MILITARY`），不按建筑种类判断。
- 遍历 `UNITS` 列兵种（界面、统计）时只取 `tier === 0`，或按 `factions.ts` 的编制取：`UNITS` 里每个兵种后面紧跟一条它的高级形态。

## 内容层与点数

点数机制见 `docs/product/units.md`「点数机制」，原型验证得来的标尺与估算的边界见 `docs/unit-stat-model.md`。

- 兵种的点数维度（`points.ts` 的 `DIMS`：生命、输出、节奏、护甲、机动、射程、攻击距离、纪律、冲击、破甲、范围杀伤、举盾）在 `units.ts` 的 `lv` 里只填相对原型基准的级数，不直接填面板数值：面板由原型基准与 `points.ts` 的阶梯算出。要动整个原型的底盘改原型的 `panel`，不改各兵种。
- 不计点的字段（对建筑倍率、最近射程、投射物、体型、视野等）照原值填；特有的克制、受击修正、副武器、特殊动作写成特性（`defineTrait`），不写进系统代码。
- 兵力按兵力份数计：原型的 `force` 是每人占几份，开局编制与援军用 `src/sim/content/force.ts` 的 `headcount` / `forceList` 换算成人数，不直接填人头。
- 价目表 `src/sim/content/prices.json` 与 `tools/measure/data/` 下的实测表是工具生成的文件，不手改：
  改了原型、特性、规则表或测量规程，运行 `npm run measure -- prices` 重量；只改汇总规则或地板价，运行 `npm run measure -- prices --derive`；
  改了价目或兵种表，运行 `npm run measure -- budget --write` 与 `npm run measure -- reinf --write`。
- 新兵种或新阵营落进预算的做法：用 `npm run measure -- breakdown` 看阵营点数与差额，用兵员级数、援军级数补齐到预算；兵种点数要落在 `UNIT_POINT_LIMITS` 内、各维度级数落在 `LEVEL_RANGES` 内。
- 测量工具（`tools/measure/`）只在 Node 里跑，不被 `src/` 引用。

## 渲染

- 静态物体（建筑、树石、道具）的材质用 `src/render/materials.ts` 的 `litMaterial`，单位用同文件的 `unitMaterials`，不直接 new three.js 材质：
  战争迷雾的压暗和积雪做在这些材质的着色器补丁里。
- 画面上跟着单位走的东西（镜头、标记、文字）取插值后的位置 `px + (x − px) × min(1, acc / DT)`，与画单位用同一个系数，不直接读 `x / y`：
  模拟每秒 30 帧、画面每秒 60～120 帧，直接读会一顿一顿。

## 界面

- 桌面版里贴屏幕边的面板，贴边一侧的边框加内边距不小于 `src/camInput.ts` 的 `EDGE_ZONE`：最外沿是卷屏区，不管底下是什么都卷屏，可点的东西伸进去，停在上面就会卷走镜头（移动版不做边缘卷屏，不受此限）。
- 游戏内界面要在锁定鼠标模式下照常可用（`src/pointerLock.ts` 只派发合成事件）：悬停样式写成 `:hover, .hover`（合成事件触发不了 `:hover`）；
  监听用 pointer 系列与 click / dblclick / contextmenu / wheel，不用 mousedown / mouseup / mousemove（锁定时不合成）；不用要靠浏览器默认交互操作的原生控件（select、滑条、文本框）。
- 游戏内界面（`.hud` 里）的浮层按固定次序取 z-index：常驻面板 < 移动版把手 < 抽屉遮罩 < 抽屉 < 菜单与设置 < 帮助与结算遮罩；新增浮层按这个次序放，否则把手、抽屉会盖到模态层上还能被点中（不接指针的拖拽影子不在此列）。

## 测试

- 测试不断言某个种子下对局的具体走向（谁赢、几分钟分出胜负）：任何系统多一次 `w.rng` 调用，同一种子的走向就会变。
  确实要断言胜负的（如记分口径），用悬殊到不会因走向而翻盘的对阵，并跨几个种子、两方互换。
