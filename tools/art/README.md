# 兵种素材

在仓库根目录用 Blender 5.3 无头生成。脚本直接构造网格、蒙皮和关键帧，所需数据都在此目录。四个阵营各一个生成脚本，校验只有一条命令：

```sh
blender -b --factory-startup --python-exit-code 1 -P tools/art/generate.py        # 罗马，共用的人形、马两个动作库，各阵营的马
blender -b --factory-startup --python-exit-code 1 -P tools/art/generate_china.py  # 中国
blender -b --factory-startup --python-exit-code 1 -P tools/art/japan.py           # 日本
blender -b --factory-startup --python-exit-code 1 -P tools/art/persia.py          # 波斯
python3 tools/art/verify.py
```

`generate.py` 先跑：人形动作库 `anims/human.glb`、马的动作库 `anims/horse.glb` 与各阵营的马 `horses/*.glb` 都由它生成，另外三个阵营的兵种要用。其余三个脚本互不依赖。每个脚本只改写清单 `manifest.json` 里自己阵营的条目与动作库，保留其余的；清单里 `human`、`horse` 两个共用动作库每个脚本都会登记，所以单独跑一个阵营的脚本，它写的条目引用的库也都在清单里（库文件本身仍要 `generate.py` 生成）。

默认输出到 `public/assets/units/`。四个脚本都能用 `--output` 换一个目录，先生成一份独立的素材副本，校验脚本也接受这个目录。校验一次查全部四个阵营，缺哪个阵营都会报错，所以副本要四个脚本都跑过才校验得过；在空目录里按上面的顺序跑，生成的清单与仓库里的逐字节一致。

```sh
for script in generate.py generate_china.py japan.py persia.py; do
  blender -b --factory-startup --python-exit-code 1 -P tools/art/$script -- --output /tmp/pocketwar-units
done
python3 tools/art/verify.py /tmp/pocketwar-units
```

`generate.py` 加 `--horse-only` 只重建马：动作库 `anims/horse.glb` 与各阵营的马 `horses/*.glb`，并把已有清单里各阵营骑兵的步幅同步一遍（见下面 `horse.py` 一条）。

```sh
blender -b --factory-startup --python-exit-code 1 -P tools/art/generate.py -- --horse-only
python3 tools/art/verify.py
```

## 渲染预览

罗马与中国的脚本能用 `--previews` 附带输出 Blender 的 PNG，加 `--preview-only` 只渲图，`--ids` 指定要处理的兵种（省略时处理本阵营全部形态）。每个形态渲染待命帧和第 0.133 秒的命中帧，人形会拍三个攻击变体；中国的脚本另有 `--actions` 挑要拍的动作，可以加 `die`：拍在约第 0.25 秒（骑手刚离鞍），不是倒地后的终态。骑兵预览同时加载骑手和本阵营的马（高级形态配披甲的那匹）；拍阵亡时马也播倒地，取同一时刻。预览拍摄时才对 `team` 材质染色。`generate.py` 加 `--horse-frames 24` 会在 `horse-walk/` 和 `horse-run/` 下各拍一个周期的 24 帧。日本、波斯的脚本没有预览，用游戏里的预览页（`/?view=units`）看。

```sh
blender -b --factory-startup --python-exit-code 1 -P tools/art/generate.py -- \
  --preview-only --previews /tmp/pocketwar-rome-previews \
  --ids legion auxilia velites sagitt equites --horse-frames 24
blender -b --factory-startup --python-exit-code 1 -P tools/art/generate_china.py -- \
  --preview-only --previews /tmp/pocketwar-china-previews --ids tieqi tieqi_e --actions idle attack
```

## 修改素材

各阵营共用：

- `mesh.py` 定义材料、网格、骨架和 GLB 导出。建模坐标依次为横向、前向、高度，导出后为 glTF 的 +Y 向上、+Z 向前，每单位一米。
- `registry.py` 是各脚本写清单的共用写法：读写清单、登记共用动作库、骑兵条目（骑手骑本阵营的马，高级形态骑披甲的，步幅取 `horse_gaits.py` 的 `STRIDE`）。不依赖 Blender。
- `rome.py` 里的人形骨架四个阵营共用。改人形绑定姿势后要重新生成全部人形和动作库。
- `human_motion.py` 定义共用人形动作库 `human` 的站姿、持械点、脚步周期、命中时刻与收势，中国的刀盾兵、铁骑也用这个库。脚步的支撑相随步幅后移，摆动相由两段骨链求出膝盖位置。弓弦中央由独立骨骼带动。用 `strikes.py` 修改变体的蓄力、命中和收势；收势要绕开身体或坐骑时，在 `recover` 里写途中依次靠向的架势。`human_pose` 的 `lancer` 开关只给马上真拿着骑枪的骑手开：枪收在身侧时枪尾往外撇开（`LANCE_SPLAY`），让开马的后腿与搭后，使出手变体时右肘收到身侧（`LANCE_ELBOW`）。借这套坐姿摆的象夫、波斯铁甲骑兵不开，它们的素材不跟着变。
- `unhorse.py` 是骑手的落马：四个阵营骑手的 `ride_*.die` 都照它摆身子与两腿。马倒地时骑手 0.2 秒离鞍，被甩向马背转过去的那一侧，右脚先着地，侧身半趴着停在离马背一步远的地上，头朝外、脚朝马。骑手的原点在引擎里跟着鞍骨走，所以动作摆在马站着时的坐标里，再按鞍骨在马的侧倒动作里每个烘焙时刻（1/30 秒）的位姿换算回去：改了马的侧倒（`horse.py`），四个脚本都要重跑。两臂与兵器由各持械姿态接着摆（`human_motion.py` 的 `lance_fall`、`bow_fall`，`japan.py` 的 `rider_fall`，`persia.py` 的 `kontos_fall`）：右手伸过头顶，枪、刀横在头前，与马身平行；左手落在胯上（盾盖在身侧），或空手落在胸前（持弓的连弓平放在地上）。兵器从待命姿势里的朝向起步，不另抄握法。`fall` 的 `lift` 把甲裙、肩甲宽的骑手垫高一些，`billow` 是披风离鞍时向后扬的角度（披风下摆坐着时垂在马臀里，扬起来才离得开；背的是旗杆就给小）。改了这套动作、各阵营的鞍桥或马铠，要把骑手放到马上按引擎烘焙的取法查一遍：离鞍后人与马、马具、马铠不相交，身上不沉进地里。
- `siege.py` 里的车轮、梁等部件，各阵营的器械都拿来拼。

罗马，入口是 `generate.py`：

- `rome.py` 生成军团步兵、辅助矛兵、投矛散兵、弓箭手、骑兵的初级和高级服装、盾牌与武器。先调整轮廓和骨骼附近的蒙皮，再用站立和出手两帧核对穿插。
- `siege.py` 生成蝎弩、投石机及其自带动作。

中国，入口是 `generate_china.py`：

- `china.py` 生成长戟兵、刀盾兵、弩兵、连弩兵、铁骑的服装与兵器。
- `china_motion.py` 生成中国专用动作库 `china`：长戟、弩、连弩三种持械姿态。持械姿态不在这个库里的兵种沿用 `human`。
- `china_siege.py` 生成火箭车、霹雳车及其自带动作。

日本，`japan.py` 一个文件：足轻枪兵、武士、弓足轻、铁炮足轻、骑马武者、僧兵的服装与兵器，专用动作库 `japan` 的全部持械姿态，以及自带动作的大筒。

波斯，`persia.py` 一个文件：持盾矛兵、不死军、弓箭手、骑射手、铁甲骑兵的服装与兵器，专用动作库 `persia` 的全部持械姿态，以及自带动作的战象、投石车。

马，四个阵营的骑兵共用骨架与动作，由 `generate.py` 生成：

- `horse_rig.py` 定马的关节与骨架。`horse_mesh.py` 生成体表与鬃尾：躯干、颈、头是腹背两条轮廓线之间放样出的一张皮；四肢各分上下两个壳，上壳从肩胛、臀部做到肘、后膝，大半埋在躯干里，露出来的就是肩与大腿的肌肉，下壳从关节处起一直做到蹄冠，上端藏在上壳里，关节屈伸时像套筒一样转。改体形先改这两个文件里的关节与截面表。
- `horse.py` 生成待命、行军、奔跑、侧倒四个动作，时序与步幅在 `horse_gaits.py`。`walk` 做成快步、`run` 做成袭步：游戏里骑兵行军每秒 3–6 米、奔跑每秒 10 米以上，是真马快步与袭步的速度，做成慢步会在对局里快放成碎步；时长取「步幅 ÷ 这个速度」，预览页与对局里的步频才一致。每帧先定四蹄（支撑期蹄尖锁地，蹄踵先离地、蹄绕蹄尖翻起；摆动期球节走一条抬高的弧，蹄挂在下面随俯仰甩动），再定躯干的起伏与俯仰，最后由蹄反解关节：前肢的腕在支撑期锁直、摆动期屈曲，后肢的后膝与飞节按固定比例一起屈伸，够不着蹄印时压低躯干。四个阵营骑兵在清单里的 `stride` 都是 `horse_gaits.py` 的 `STRIDE`：各阵营脚本写骑兵条目时取它，`generate.py` 每次跑（含 `--horse-only`）再把清单里已有的骑兵同步一遍，所以改步幅只改 `horse_gaits.py`，再跑 `generate.py`。骑手保留 0.94 米高的人形髋部绑定姿势，`ride_*` 动作把髋部摆到原点附近，由运行时把骑手原点对齐鞍骨。
- `horse_tack.py` 定各阵营的毛色、鞍具与马甲，样式登记在 `STYLES`，`horse.horse_mesh(rig, 样式名)` 按名字生成；马专用的颜色也登记在这里。甲分两种：贴身的甲（`Plate`）把躯干那张皮上的一片顶点垫高、换成甲色，不加面，随皮一起动；垂下来的挂甲（`front_housing`、`rear_housing`）跟着躯干的骨骼，挂在四肢摆动范围之外。这个范围是 `BULGE`、`SPAN` 两张表，由动作量出来，改了马的体形或步态要重量。生成每匹披甲马时都会把挂甲与四肢在四个动作里求交，相交就报错、不导出。鞍桥与镫的位置是照各阵营骑手的坐姿与脚位定的，改了骑手的 `ride_*` 姿态或甲裙要回来对一遍。加样式时在 `STYLES` 登记，再把名字和面数上限加进 `verify.py` 的 `HORSES`。

## 各阵营的马

`public/assets/units/horses/` 下每个阵营两份：`<阵营>.glb` 是初级形态，`<阵营>_e.glb` 是披甲的高级形态。它们与 `anims/horse.glb` 同一副骨架，只有网格、不带动作，清单里这样写，动作从动作库 `horse` 取：

```json
"mount": { "src": "units/horses/china_e.glb", "anims": "horse" }
```

| 阵营 | 初级 | 高级 |
| --- | --- | --- |
| `rome` | 枣骝；四角鞍，攀胸上三枚铜饰 | 铜额甲带护眼，铜鳞胸甲，鞦带挂铜饰 |
| `china` | 栗色白蹄；三花鬃、缚尾，高桥鞍、障泥、镫，攀胸与鞦带垂杏叶 | 具装：面帘、鸡颈、当胸、马身甲、搭后，臀上竖寄生 |
| `japan` | 青毛；和鞍、泥障、舌长镫，胸懸与鞦垂厚総 | 马面，金小札的马铠罩住颈、胸、臀 |
| `persia` | 青灰；城垛鬃、束尾，镶铜边的大鞍褥，圆铜饰与大缨，无镫 | 铜鳞马衣从颈到臀、垂到膝 |

初级形态与只披颈、胸、臀的不超过 2600 个三角形；披全身甲的 `china_e`、`persia_e` 在整匹马外面多一层挂甲和衬里，上限 3200。

## 出手变体

罗马各持械姿态的三个出手变体（其余阵营的见各自脚本里的姿态表）：

| 姿态 | `attack` | `attack2` | `attack3` |
| --- | --- | --- | --- |
| 剑盾 | 直刺 | 斜劈 | 盾击 |
| 矛盾 | 平刺 | 高位下刺 | 盾推 |
| 标枪 | 上手投 | 低手挑投 | 侧投 |
| 弓 | 平射 | 抬弓仰射 | 倾弓低射 |
| 骑枪 | 平刺 | 下刺 | 侧刺 |

骑枪握在中段，握点后面还有一米多的枪杆。下刺、侧刺都先把枪举过右肩再出手：枪杆从肩的外上方过，不横穿身体，枪尖落在马的右肩之外；收势先抬枪尖（手留在前外侧），再把手收回身侧，枪尾一直在马身右侧之外。改了这两个变体，要把骑手放到马上按引擎烘焙的取法查穿插：每 1/30 秒一帧、两帧之间顶点走直线；原地出手时坐骑播待命，边跑边出手（`attackMove*`）用的是 `attack`、坐骑播奔跑。

## 校验

`python3 tools/art/verify.py` 读取导出后的 GLB 与清单，用系统 Python 就能跑，一次查全部四个阵营，打印每份素材导出后的三角形、骨骼和动作数：

- 各阵营的兵种：清单条目指向本阵营的文件与动作库，骨架与共用人形逐骨一致，面数与高度在限内，有队伍色材质，动作库里各持械姿态要用的动作齐全，命中时刻几个出手变体的持械姿势彼此分得开。
- 骑兵：骑手的素材在哪个阵营的目录下，坐骑就得是那个阵营的马（高级形态骑披甲的），步幅等于 `horse_gaits.py` 的 `STRIDE`。阵亡时马倒地以后，骑手离开鞍座、落在马背转过去的那一侧的地上，全程不沉进地里（按骨骼关节查；网格与马的相交不在这里查）。
- 马的动作库：落蹄顺序、支撑期蹄尖随步幅保持的世界位置、摆动期的离地高度、四蹄腾空的次数与时长、体表不穿地，以及鞍骨的绑定位置。
- 各阵营的马：骨架与动作库逐骨一致、不带动作、四蹄与动作库里那匹一模一样（上面的落蹄校验才对它们同样成立）、面数、队伍色材质，以及套上动作库的四个动作后不穿地。
- 器械、战象这些自带动作的：面数、动作齐全，有几个出手变体的查它们彼此分得开，战象另查落脚。
