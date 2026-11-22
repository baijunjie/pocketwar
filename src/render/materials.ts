/** 材质：在 three.js 的 Lambert 材质上打补丁——战争迷雾压暗、单位的骨骼贴图动画 */
import * as THREE from 'three';
import { UNIT_VERT_PARS } from './rig';

/** 全部材质共用的 uniform（迷雾贴图等） */
export const shared = {
  uFog: { value: null as THREE.Texture | null },
  uMap: { value: new THREE.Vector2(1, 1) },
  uFogOn: { value: 0 },
  uTime: { value: 0 },
};

const FOG_PARS = `
uniform sampler2D uFog;
uniform vec2 uMap;
uniform float uFogOn;
varying vec3 vWorld;
float fogShade(){
  float v = texture2D(uFog, clamp(vWorld.xz / uMap, 0.0, 1.0)).r;
  // 0 未探索 / 0.55 已探索 / 1 可见
  float k = v < 0.55 ? mix(0.44, 0.68, v / 0.55) : mix(0.68, 1.0, (v - 0.55) / 0.45);
  return mix(1.0, k, uFogOn);
}
`;
const FOG_APPLY = `
gl_FragColor.rgb *= fogShade();
gl_FragColor.rgb = mix(vec3(0.10, 0.12, 0.17), gl_FragColor.rgb, 0.7 + 0.3 * fogShade());
`;

function bind(shader: { uniforms: Record<string, THREE.IUniform> }, extra?: Record<string, THREE.IUniform>): void {
  Object.assign(shader.uniforms, shared, extra);
}

/** 静态物体（地形、建筑、树石）：顶点色 + 迷雾 */
export function litMaterial(opts: THREE.MeshLambertMaterialParameters = {}): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, ...opts });
  m.onBeforeCompile = shader => {
    bind(shader);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorld;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 fw = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          fw = instanceMatrix * fw;
        #endif
        vWorld = (modelMatrix * fw).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FOG_PARS}`)
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>\n${FOG_APPLY}`);
  };
  return m;
}

/** 单位：骨骼矩阵取自贴图，位置/朝向/动画行来自实例属性 */
export function unitMaterials(bones: THREE.Texture, influences: number): { lit: THREE.Material; depth: THREE.Material } {
  const defs = influences > 1 ? '#define INFLUENCES_2\n' : '';
  const uni = { uBones: { value: bones } };
  const lit = new THREE.MeshLambertMaterial({ vertexColors: true });
  lit.onBeforeCompile = shader => {
    bind(shader, uni);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${defs}${UNIT_VERT_PARS}\nvarying vec3 vWorld;`)
      .replace('#include <beginnormal_vertex>', 'mat4 um = unitMatrix();\nvec3 objectNormal = normalize(mat3(um) * normal);')
      .replace('#include <begin_vertex>', `vec3 transformed = (um * vec4(position, 1.0)).xyz;
        vFlash = aAnim.y; vShade = aAnim.w; vWorld = transformed;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FOG_PARS}\nvarying float vFlash;\nvarying float vShade;`)
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
        gl_FragColor.rgb = gl_FragColor.rgb * vShade + vFlash;\n${FOG_APPLY}`);
  };
  lit.customProgramCacheKey = () => `unit${influences}`;
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depth.onBeforeCompile = shader => {
    bind(shader, uni);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${defs}${UNIT_VERT_PARS}`)
      .replace('#include <begin_vertex>', 'mat4 um = unitMatrix();\nvec3 transformed = (um * vec4(position, 1.0)).xyz;');
  };
  depth.customProgramCacheKey = () => `unitDepth${influences}`;
  return { lit, depth };
}
