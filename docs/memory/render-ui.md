# 渲染与界面开发

- three.js 锁在 0.170.x（`package.json` 的 `^0.170.0`）。升级时要逐条核对 `src/render/materials.ts`、`src/render/terrain.ts`
  里着色器补丁 `replace` 的片段名（`#include <begin_vertex>` 等）：片段名一变，替换静默落空，不报错。
- 渲染要提速先看面数：马（`public/assets/quaternius/horse.glb`）约 2200 个三角形，骑兵连人带马近 3000，是面数大户，先从它下手。
