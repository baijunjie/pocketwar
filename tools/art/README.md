# 罗马兵种素材

在仓库根目录用 Blender 5.3 无头生成。脚本直接构造网格、蒙皮和关键帧，所需数据都在此目录。

```sh
blender -b --factory-startup --python-exit-code 1 -P tools/art/generate.py
python3 tools/art/verify.py
```

默认输出到 `public/assets/units/`。生成器更新罗马模型和共用动作库的清单条目，保留清单中的其他模型。用 `--output` 指定一个临时目录可先生成独立素材副本。校验脚本也接受该目录，读取 GLB 并打印导出后的三角形、骨骼和动作数。

```sh
blender -b --factory-startup --python-exit-code 1 -P tools/art/generate.py -- --output /tmp/pocketwar-rome-units
python3 tools/art/verify.py /tmp/pocketwar-rome-units
```

用 `--horse-only` 单独重建马及现有清单中的罗马骑兵步幅。

```sh
blender -b --factory-startup --python-exit-code 1 -P tools/art/generate.py -- --horse-only
python3 tools/art/verify.py
```

## 渲染预览

用 `--previews` 附带输出 Blender 的 PNG。加 `--preview-only` 只渲图。可用 `--ids legion equites onager` 指定要处理的兵种，省略时处理全部 12 个形态。每个形态渲染待命帧和第 0.133 秒的命中帧，人形会拍三个攻击变体。骑兵预览同时加载马和骑手。预览拍摄时才对 `team` 材质染色。加 `--horse-frames 24` 会在 `horse-walk/` 和 `horse-run/` 下各拍一个周期的 24 帧。

```sh
blender -b --factory-startup --python-exit-code 1 -P tools/art/generate.py -- \
  --preview-only --previews /tmp/pocketwar-rome-previews \
  --ids legion auxilia velites sagitt equites --horse-frames 24
```

## 修改素材

- `rome.py` 生成人形骨架、初级和高级服装、盾牌与武器。先调整轮廓和骨骼附近的蒙皮，再用站立和出手两帧核对穿插。改人形绑定姿势后重新生成全部人形和动作库。
- `human_motion.py` 定义站姿、持械点、脚步周期、命中时刻与收势。脚步的支撑相随步幅后移，摆动相由两段骨链求出膝盖位置。弓弦中央由独立骨骼带动。用 `strikes.py` 修改变体的蓄力、命中和收势。
- `horse_rig.py` 定马的关节与骨架。`horse_mesh.py` 生成体表、鬃尾与马具：躯干、颈、头是腹背两条轮廓线之间放样出的一张皮；四肢各分上下两个壳，上壳从肩胛、臀部做到肘、后膝，大半埋在躯干里，露出来的就是肩与大腿的肌肉，下壳从关节处起一直做到蹄冠，上端藏在上壳里，关节屈伸时像套筒一样转。改体形先改这两个文件里的关节与截面表。
- `horse.py` 生成待命、行军、奔跑、侧倒四个动作，时序与步幅在 `horse_gaits.py`。`walk` 做成快步、`run` 做成袭步：游戏里骑兵行军每秒 3–6 米、奔跑每秒 10 米以上，是真马快步与袭步的速度，做成慢步会在对局里快放成碎步；时长取「步幅 ÷ 这个速度」，预览页与对局里的步频才一致。每帧先定四蹄（支撑期蹄尖锁地，蹄踵先离地、蹄绕蹄尖翻起；摆动期球节走一条抬高的弧，蹄挂在下面随俯仰甩动），再定躯干的起伏与俯仰，最后由蹄反解关节：前肢的腕在支撑期锁直、摆动期屈曲，后肢的后膝与飞节按固定比例一起屈伸，够不着蹄印时压低躯干。清单里罗马骑兵的 `stride` 由生成器按 `horse_gaits.py` 同步。骑手保留 0.94 米高的人形髋部绑定姿势，`ride_*` 动作把髋部摆到原点附近，由运行时把骑手原点对齐鞍骨。
- `siege.py` 生成蝎弩、野驴投石机及其自带动作。
- `mesh.py` 定义材料、网格、骨架和 GLB 导出。建模坐标依次为横向、前向、高度，导出后为 glTF 的 +Y 向上、+Z 向前，每单位一米。


## 出手变体

| 姿态 | `attack` | `attack2` | `attack3` |
| --- | --- | --- | --- |
| 剑盾 | 直刺 | 斜劈 | 盾击 |
| 矛盾 | 平刺 | 高位下刺 | 盾推 |
| 标枪 | 上手投 | 低手挑投 | 侧投 |
| 弓 | 平射 | 抬弓仰射 | 倾弓低射 |
| 骑枪 | 平刺 | 下刺 | 侧刺 |

校验脚本读取导出后的 GLB，检查命中时刻三套持械姿势的间距，马的落蹄顺序、支撑期蹄尖随步幅保持的世界位置、摆动期的离地高度、四蹄腾空的次数与时长、体表不穿地，以及鞍骨的绑定位置。
