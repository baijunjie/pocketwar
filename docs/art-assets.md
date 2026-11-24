# 画风与模型素材调研

## 画风要求

- 全 3D、写实、真人比例。用户先后否掉过 2D 俯视贴图（「怎么是纸片人」）和 Q 版卡通素材包（「不要 Q 版，要写实」）。
- 现状：人物、器械、战象、建筑、树石全部由代码按真人比例建模，低多边形、纯色顶点色、无贴图；只有马用 CC0 模型。
  离商业 3D 即时战略的精度有差距，用户知情。

## 现成素材调研结论

- 查过 Kenney、KayKit、Quaternius、poly.pizza、OpenGameArt：没有 CC0、带骨骼动画、写实精度的古代士兵；
  没有 CC0 的中 / 日 / 罗马 / 波斯风格建筑包；没有可直接用的 CC0 带行走动画的大象。
- Kenney Mini Characters / Castle Kit / Survival Kit、KayKit Medieval Hexagon 是 Q 版，不合画风要求。
- Quaternius 的成人比例人物包是候选，但调研时官方 Google Drive 限流下载不了，未评估。
- 用户的决定是「没有的话你就自己做」。用户自己提供或购买的 glTF 骨骼模型可以走通用烘焙流程接入（马就是这么接的，
  接法见 README「加一个兵种 / 换一个模型」）。
