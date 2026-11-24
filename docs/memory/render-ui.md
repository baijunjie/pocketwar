# 渲染与界面开发

- 给静态物体（建筑、树石、道具）新建材质用 `src/render/materials.ts` 的 `litMaterial`，单位用同文件的 `unitMaterials`：
  战争迷雾的压暗和积雪都做在这些材质的着色器补丁里，直接 new 一个 three.js 材质，它在迷雾里会是亮的、雪天也不积白。
- three.js 锁在 0.170.x（`package.json` 的 `^0.170.0`）。升级时要逐条核对 `src/render/materials.ts`、`src/render/terrain.ts`
  里着色器补丁 `replace` 的片段名（`#include <begin_vertex>` 等）：片段名一变，替换静默落空，不报错。
- 画面上跟着单位走的东西（镜头、标记、文字）取插值后的位置 `px + (x − px) × min(1, acc / DT)`，和画单位用同一个系数：
  模拟固定每秒 30 帧，画面每秒 60～120 帧，直接读 `x / y` 会一顿一顿，而静态截图看不出来。
- 新增可点的界面元素用 `button`，或把它的类名加进 `src/game.ts` 的 `INTERACTIVE`：鼠标停在不匹配这个选择器的元素上照样会边缘卷屏。
- 渲染要提速先看面数：马（`public/assets/quaternius/horse.glb`）约 2200 个三角形，骑兵连人带马近 3000，是面数大户，先从它下手。
