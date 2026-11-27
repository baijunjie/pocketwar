/**
 * 开发用预览页：?view=units 看全部兵种与动画（&f=rome 只看一个阵营，&k=legion 只看一个兵种，
 * &tint=c0392b 换队伍色，缺省每个兵种轮流用几种颜色以便检查染色），?view=models 看静态素材，
 * &gltf=路径.glb 预览任意 glTF（&set=姿态 &anims=动作库路径 套动作库）。
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { FACTIONS, UNITS } from '../sim/defs';
import { asset, loadAssets } from '../render/assets';
import { rigModel } from '../render/models/gltf';
import { buildUnitModel, loadModelManifest, modelAssets } from '../render/models/spec';
import { CLIP_FALLBACK, ONE_SHOT, STD_ACTIONS } from '../render/models/actions';
import { clipOf } from '../render/rig';
import { UnitBatch, clipRow } from '../render/units';

/** 检查染色用的几种队伍色 */
const TINTS = [0xc0392b, 0x2f6fd0, 0x3a9a48, 0xd9a520, 0x8a3ab9, 0xeeeeee];

export async function runViewer(root: HTMLElement, mode: string, q: URLSearchParams): Promise<void> {
  const bad = await loadModelManifest();
  if (bad) {
    root.textContent = `manifest.json 有误：${bad.message}`;
    return;
  }
  await loadAssets(modelAssets());
  const tintOf = (k: number): number[] => {
    const c = new THREE.Color().setHex(q.get('tint') ? parseInt(q.get('tint')!, 16) : TINTS[k % TINTS.length], THREE.SRGBColorSpace);
    return [c.r, c.g, c.b];
  };
  const canvas = document.createElement('canvas');
  canvas.className = 'view';
  root.appendChild(canvas);
  const r = new THREE.WebGLRenderer({ canvas, antialias: true });
  r.setPixelRatio(Math.min(2, devicePixelRatio));
  r.setSize(innerWidth, innerHeight, false);
  r.shadowMap.enabled = true;
  r.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x6f8f6a);
  const cam = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 1, 5000);
  const ctl = new OrbitControls(cam, canvas);
  scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x6b6248, 1.5));
  const sun = new THREE.DirectionalLight(0xfff2d8, 2.2);
  sun.position.set(-200, 400, 250);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -400;
  sc.right = sc.top = 400;
  sc.far = 1500;
  scene.add(sun);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: 0x7fa060 }));
  ground.receiveShadow = true;
  scene.add(ground);

  const batches: { b: UnitBatch; x: number; z: number; tint: number[] }[] = [];
  scene.add(new THREE.AxesHelper(40));
  if (mode === 'units') {
    // &k=dao 只看一个兵种（连同它的高级形态，排在后面一行）；&cmp=1 每个兵种的初级、高级形态并排站着对比
    const only = q.get('k'), cmp = q.get('cmp'), fac = q.get('f');
    let col = 0, row = 0;
    for (const fid of Object.keys(FACTIONS) as (keyof typeof FACTIONS)[]) {
      if (fac && fid !== fac) continue;
      col = 0;
      for (const d of UNITS) {
        if (d.faction !== fid || (only && d.key !== only && d.key !== `${only}_e`)) continue;
        const b = new UnitBatch(buildUnitModel(d.model, true));
        scene.add(b.mesh);
        const tint = tintOf(col >> 1);
        batches.push(only ? { b, x: 0, z: d.tier * 90, tint } : cmp ? { b, x: ((col / 2) | 0) * 80 + d.tier * 30, z: row * 70, tint }
          : { b, x: ((col / 2) | 0) * 95, z: row * 200 + d.tier * 100, tint });
        col++;
      }
      row++;
    }
    cam.position.set(300, 380, 780);
    ctl.target.set(300, 0, 170);
    if (only) {
      cam.position.set(Number(q.get('cx')) || 26, 46, 140);
      ctl.target.set(26, 9, 22);
    } else if (cmp) {
      cam.position.set(270, 190, 520);
      ctl.target.set(270, 10, 100);
    }
  }
  ctl.update();
  // &gltf=路径.glb：直接预览任意 glTF 模型走通用烘焙流程的结果（动作名自动按常见叫法对应）
  const gltf = q.get('gltf');
  if (gltf) {
    const lib = q.get('anims');
    await loadAssets(lib ? [gltf, lib] : [gltf]);
    const names = [...asset(gltf).animations, ...(lib ? asset(lib).animations : [])].map(a => a.name).filter(n => !n.includes('|'));
    const find = (...keys: string[]): string | undefined => names.find(n => keys.some(k => n.toLowerCase() === k))
      ?? names.find(n => keys.some(k => n.toLowerCase().includes(k)));
    const clips: Record<string, string> = {};
    // 不套动作库时按常见叫法对应标准动作
    if (!lib) {
      for (const [std, keys] of Object.entries({ idle: ['idle'], walk: ['walk'], run: ['run', 'gallop'], attack: ['attack'], die: ['death', 'die'] })) {
        const n = find(...keys);
        if (n) clips[std] = n;
      }
    }
    console.log('动画：', names.join(', '), '→', clips);
    const h = Number(q.get('h'));
    const b = new UnitBatch(rigModel({ libraries: lib ? { lib } : {}, models: {} }, {
      kind: 'rig', src: gltf, anims: lib ? 'lib' : undefined, set: q.get('set') ?? undefined, clips,
      height: h || undefined, yaw: q.has('ry') ? Number(q.get('ry')) : undefined,
    }));
    scene.add(b.mesh);
    batches.push({ b, x: 0, z: 0, tint: tintOf(0) });
    cam.position.set(60, 60, 150);
    ctl.target.set(40, 10, 20);
    ctl.update();
  }
  // 每个模型把它有的标准动作排成一排
  const order: string[] = [...STD_ACTIONS];
  const fixed = q.get('clip') ?? (q.get('cmp') ? 'idle' : null);
  const tick = (now: number): void => {
    requestAnimationFrame(tick);
    const t = now / 1000;
    for (const { b, x, z, tint } of batches) {
      b.begin();
      const list = fixed ? [fixed] : order.filter(c => b.clips[c]);
      list.forEach((c, i) => {
        const clip = clipOf(b.model, c, CLIP_FALLBACK);
        // 非循环动作播完停一秒再重播
        const loop = !ONE_SHOT.has(c);
        const ph = loop ? (t / clip.seconds) % 1 : Math.min(1, (t % (clip.seconds + 1)) / clip.seconds);
        b.add(x + (i % 3) * 26, 0, z + ((i / 3) | 0) * 26, Number(q.get('yaw')) || 0, clipRow(clip, ph), tint);
      });
      b.end();
    }
    ctl.update();
    r.render(scene, cam);
  };
  requestAnimationFrame(tick);
  (window as unknown as Record<string, unknown>).viewer = { r, scene, cam, ctl };
}
