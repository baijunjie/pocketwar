# 模拟层开发

- 新常量放 `src/sim/state.ts`（它不依赖任何模块），不要放进 `src/sim/world.ts`；系统文件对 `world.ts` 只做 `import type`。
  否则会循环引用：Node 里跑测试碰巧能过，浏览器按另一种顺序加载时报 `Cannot access '…' before initialization`，所以 `npm test` 通过不能证明没问题。
- 单位坐标等字段存在 `Float32Array` 里：先用 JS 的 64 位中间值做判断（比如下一步落在哪一格）、再存进 Float32 数组的，判断之前先 `Math.fround`。
  否则贴着格线时，判断用的值还在本格，存进去却被舍入到隔壁格，绕过了检查。
- 改「相邻两格之间能不能直接走」的规则（墙顶、城内、城外这类）要四处同改：`src/sim/nav.ts` 的 `canStep` 与流场搜索、
  `src/sim/world.ts` 的 `lineBlocked`、`src/sim/systems/units.ts` 的位移碰撞。漏掉一处，寻路、走直线的判断与实际位移就对不上。
- 改移动速度的系数（天气、风、地形之类）要在 `src/sim/systems/units.ts` 的单位期望速度与 `src/sim/systems/march.ts` 的领队步长两处同改；
  只改一处，编队成员和他们的队列位置会对不上。
- 新增下令函数、或在 `src/sim/systems/orders.ts` 之外把单位派去别处（系统里自己改命令、目的地）时：先调 `leavePost`（腾垛口、取消出击与预留的站位），
  再照 `orders.ts` 里 `reset()` 那套清掉寻路进度（`stuck`、`bestD`、`noGain` 等）。漏清 `bestD / noGain`，单位会刚派出去就被判到达、又被派出，原地循环。
- 读建筑的生命上限、火力用 `Building` 上的 `maxHp`、`tower`，不读 `b.def.hp`、`b.def.tower`：据点升级会改前两者。
- 据点按下标取、不删除：临时据点被毁后置 `gone`，遍历 `w.sites` 要跳过 `gone` 的。
  各类据点的行为差异（出不出援军、能否落脚休整、计不计士气、能否占领、箭塔位、占领前要否先拆主建筑）读 `SITE_INFO` 上的数据开关
  （`reinf`、`haven`、`counts`、`captureTime`、`towerSlots`、`razeFirst`），不写 `type !== SITE_HQ` 这类按据点类型的判断。
- `UNITS` 里每个兵种后面紧跟一条它的高级形态（`tier === 1`）：遍历 `UNITS` 列兵种（界面、统计）时只取 `tier === 0`，或按 `factions.ts` 的编制取。
