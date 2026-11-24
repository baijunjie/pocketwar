# 编码规范

审查改动时对照本文。界面相关的规则集中在「界面」一节。

## 通则

- 沿用周围代码已有的做法：同类问题已有现成的函数、材质、数据开关的，复用它，不另起一套。
- 模拟层与渲染、界面分离：`src/sim/` 不依赖 DOM，也不引用 `src/render/`、`src/ui/`、`src/audio/`，否则测试无法在 Node 里无头运行。
- `src/sim/content/` 只放数据，`src/sim/systems/` 只放算法：数值写进 `content/`（规则数值在 `rules.ts`），系统里不写死数字、
  不按具体兵种 key 判断，加兵种、调数值才能只动 `content/`。调行为的数值（阈值、比例、时长、距离、力度）进 `rules.ts`；
  只为实现服务、改了不影响玩法的常量（缓冲区大小、采样方向数、候选上限、复查间隔）可以在系统文件里写成带注释的具名模块常量。

## 模拟层

- 新常量放 `src/sim/state.ts`（它不依赖任何模块），不放进 `src/sim/world.ts`；系统文件对 `world.ts` 只做 `import type`：
  否则形成循环引用，浏览器按另一种顺序加载时报 `Cannot access '…' before initialization`，而 Node 里的测试碰巧能过。
- 先用 64 位中间值做判断（比如下一步落在哪一格）、再存进 `Float32Array` 字段的，判断之前先 `Math.fround`：
  否则贴着格线时判断用的值还在本格，存进去却被舍入到隔壁格，绕过了检查。
- 改「相邻两格之间能不能直接走」的规则（墙顶、城内、城外这类），`src/sim/nav.ts` 的 `canStep`（位移碰撞与绕行前瞻都调它）与流场搜索、
  `src/sim/world.ts` 的 `lineBlocked` 三处同改：漏一处，寻路、直线判断与实际位移就对不上。
- 改移动速度的系数（天气、风、地形之类），`src/sim/systems/units.ts` 的单位期望速度与 `src/sim/systems/march.ts` 的领队步长两处同改：
  只改一处，编队成员与队列位置会对不上。
- 新增下令函数、或在 `src/sim/systems/orders.ts` 之外改单位的命令或目的地时，先调 `leavePost`（腾垛口、取消出击与预留的站位），
  再照 `orders.ts` 里 `reset()` 清掉寻路进度（`stuck`、`bestD`、`noGain` 等）：漏清 `bestD / noGain`，单位刚派出去就被判到达、又被派出，原地循环。
- 读建筑的生命上限、火力用 `Building` 上的 `maxHp`、`tower`，不读 `b.def.hp`、`b.def.tower`：据点升级会改前两者（负责写入它们的升级逻辑除外）。
- 据点按下标取、不删除，遍历 `w.sites` 跳过 `gone` 的；各类据点的行为差异读 `SITE_INFO` 上的数据开关
  （`reinf`、`haven`、`counts`、`captureTime`、`towerSlots`、`razeFirst`），不写 `type !== SITE_HQ` 这类按据点类型的判断。
- 遍历 `UNITS` 列兵种（界面、统计）时只取 `tier === 0`，或按 `factions.ts` 的编制取：`UNITS` 里每个兵种后面紧跟一条它的高级形态。

## 渲染

- 静态物体（建筑、树石、道具）的材质用 `src/render/materials.ts` 的 `litMaterial`，单位用同文件的 `unitMaterials`，不直接 new three.js 材质：
  战争迷雾的压暗和积雪做在这些材质的着色器补丁里。
- 画面上跟着单位走的东西（镜头、标记、文字）取插值后的位置 `px + (x − px) × min(1, acc / DT)`，与画单位用同一个系数，不直接读 `x / y`：
  模拟每秒 30 帧、画面每秒 60～120 帧，直接读会一顿一顿。

## 界面

- 新增可点的界面元素用 `button`，或把它的类名加进 `src/game.ts` 的 `INTERACTIVE`：鼠标停在不匹配这个选择器的元素上照样会边缘卷屏。

## 测试

- 测试不断言某个种子下对局的具体走向（谁赢、几分钟分出胜负）：任何系统多一次 `w.rng` 调用，同一种子的走向就会变。
