/** 开发用预览页：?view=units 看全部兵种与动画，?view=models 看静态素材 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { FACTIONS, UNITS } from '../sim/defs';
import { loadAssets } from '../render/assets';
import { buildUnitModel } from '../render/unitModels';
import { UnitBatch } from '../render/units';

export async function runViewer(root: HTMLElement, mode: string, q: URLSearchParams): Promise<void> {
  await loadAssets();
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

  const batches: { b: UnitBatch; x: number; z: number }[] = [];
  scene.add(new THREE.AxesHelper(40));
  if (mode === 'units') {
    const only = q.get('k');
    let col = 0, row = 0;
    for (const fid of Object.keys(FACTIONS) as (keyof typeof FACTIONS)[]) {
      col = 0;
      for (const d of UNITS) {
        if (d.faction !== fid || (only && d.key !== only)) continue;
        const b = new UnitBatch(buildUnitModel(d.key, FACTIONS[fid].color));
        scene.add(b.mesh);
        batches.push({ b, x: col * 75, z: row * 80 });
        col++;
      }
      row++;
    }
    cam.position.set(240, 300, 620);
    ctl.target.set(240, 0, 130);
    if (only) {
      cam.position.set(Number(q.get('cx')) || 15, 24, 75);
      ctl.target.set(15, 9, 16);
    }
  }
  ctl.update();
  const clipNames = ['idle', 'move', 'attack', 'die'];
  const fixed = q.get('clip');
  const tick = (now: number): void => {
    requestAnimationFrame(tick);
    const t = now / 1000;
    for (const { b, x, z } of batches) {
      b.begin();
      clipNames.forEach((c, i) => {
        const clip = b.clips[fixed ?? c];
        b.add(x + (i % 2) * 30, 0, z + ((i / 2) | 0) * 32, Number(q.get('yaw')) || 0, clip, (t / (clip.n / 30)) % 1);
      });
      b.end();
    }
    ctl.update();
    r.render(scene, cam);
  };
  requestAnimationFrame(tick);
  (window as unknown as Record<string, unknown>).viewer = { r, scene, cam, ctl };
}
