# tools/measure：对战测量工具

开发工具，不属于游戏本体：游戏运行时（`src/`）不引用本目录，反过来本目录读 `src/sim/` 的内容表并复用模拟层无头跑对战。

做什么：让「被测的一方」与标准混编军在平地上无头对战，把优势换算成实战点数（1 点 = 标准混编军全军生命加 1 级），作为兵种、特性、阵营强弱的参考。
这个实战点数与配置用的兵种点数（价目是设计出来的固定规则，见 [`src/sim/content/points.ts`](../../src/sim/content/points.ts)）不是一个量：对战测量命令不写任何文件。阵营点数与援军点数的计账在 [`src/sim/content/budget.ts`](../../src/sim/content/budget.ts)，`budget --write`、`reinf --write` 只写回 `src/sim/content/factions.ts`。
「位置」（`units.ts` 的 `POSITIONS`）是本工具的概念：兵种在标准混编军里占的位置。顶替别的位置的位置（`ref`，现在只有直射器械顶替器械位）不进标准混编军：量它时把被顶替的位置整个换成它的基准单位，参照组也是这支军队。
点数机制与阵营预算的规则见 [`docs/product/units.md`](../../docs/product/units.md)「点数机制」与 [`docs/product/factions.md`](../../docs/product/factions.md)，实测依据见 [`docs/unit-stat-model.md`](../../docs/unit-stat-model.md)。

## 文件

| 文件 | 职责 |
|------|------|
| `cli.ts` | 命令行入口，全部命令与选项的用法写在文件头 |
| `measure.ts` | `Measurer`：标尺、维度、特性、人数、兵种、阵营、循环赛等测量，并把优势折算成实战点数 |
| `battle.ts` | 测量规程里的一场对战（平地、双方相距、残部重新寻敌、胜负已分就收兵） |
| `army.ts` | 军队描述（可序列化的纯数据）与建军：标准混编军按位置混编，位置可加级数或人数 |
| `units.ts` | 位置表与兵种所在位置、各位置的基准单位、标准混编军的构成与兵力折算、顶替位置的参照组、按级数造变体兵种 |
| `job.ts` | 一个对阵（纯数据）与在本进程里跑它 |
| `runner.ts`、`worker.ts` | 把一批对阵按种子切开分给多个工作进程并行跑，缺省进程数取本机性能核数；工作进程跑 esbuild 打包后的 `worker.ts`（比 vite-node 直接跑源码快约一倍，结果逐位相同）；结果与进程数无关 |
| `stats.ts`、`table.ts` | 样本统计（配对差、显著性、序贯检验的停止规则）；结果输出为终端表格与 TSV |
| `node-shim.d.ts` | 本工具用到的 Node 接口的最小类型声明 |

## 命令

项目根目录运行 `npm run measure -- [选项] <命令> [参数…]`（以 `vite-node --script` 运行 `cli.ts`，被导入时不执行），选项有 `--workers`、`--size`、`--n`、`--out`。

测量规程：每场打到一方死光、胜负已分（败方作战生命 ≤ 5% 且胜方是它的 4 倍以上）或 420 秒；换算点数的测量（维度、特性、人数、兵种、阵营）按序贯检验每批 16 组，明确显著或明确不显著就停，`--n` 与缺省样本数是上限，行里的 `n` 是实际组数、`stop` 是停止原因。规程的依据与取舍见 [`docs/unit-stat-model.md`](../../docs/unit-stat-model.md)。

| 命令 | 作用 |
|------|------|
| `base`、`ladder`、`dim`、`trait`、`count`、`countslots`、`force` | 基准面板、标尺、维度、特性、人数、兵力占用的测量 |
| `unit`、`uvar` | 兵种整体测量；在兵种上再加减级数的试算 |
| `faction`、`roundrobin`、`fmod`、`pair` | 阵营测量、循环赛与试算（参考用，不作门槛） |
| `breakdown`、`budget`、`reinf` | 阵营点数与援军点数明细、补到固定预算要的级数（不跑对战）；`budget --write` 只写各阵营 `manpower`、`reinf --write` 只写各阵营 `reinfLevel`，都写回 `factions.ts` |
