/** 兵种头像：用一个离屏的小渲染器把立体模型渲成图片（菜单与选中面板用） */
import * as THREE from 'three';
import { shared } from './materials';
import { LOOKS, buildUnitModel } from './unitModels';
import { UnitBatch } from './units';

const PX = 128;
let three: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
const camera = new THREE.PerspectiveCamera(22, 1, 1, 2000);
const cache = new Map<string, HTMLCanvasElement>();

/** @returns 一张 size×size（CSS 像素）的画布；需在素材加载完成后调用 */
export function unitPortrait(key: string, teamRgb: [number, number, number], size = 56): HTMLCanvasElement {
  const id = `${key}:${teamRgb.join(',')}`;
  let src = cache.get(id);
  if (!src) {
    if (!three) {
      three = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      three.setSize(PX, PX, false);
      three.setClearColor(0x000000, 0);
      scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight(0xeef2ff, 0x9a907a, 2.2));
      const sun = new THREE.DirectionalLight(0xfff2d8, 2.6);
      sun.position.set(-1, 2, 1.5);
      scene.add(sun);
    }
    const fogOn = shared.uFogOn.value;
    shared.uFogOn.value = 0;
    const b = new UnitBatch(buildUnitModel(key, teamRgb), false);
    b.begin();
    b.add(0, 0, 0, -0.6, b.clips.idle, 0);
    b.end();
    scene!.add(b.mesh);
    // 取景高度：步兵、骑兵按人马的身高，不把长兵器算进去
    const kind = LOOKS[key].kind;
    const h = kind === 'foot' ? 19 : kind === 'horse' ? 28 : Math.min(b.model.height, 46);
    const dist = (h * 0.56) / Math.tan((11 * Math.PI) / 180);
    camera.position.set(dist * 0.25, h * 0.62, dist * 0.97);
    camera.lookAt(0, h * 0.5, 0);
    three.render(scene!, camera);
    scene!.remove(b.mesh);
    b.dispose();
    shared.uFogOn.value = fogOn;
    src = document.createElement('canvas');
    src.width = src.height = PX;
    src.getContext('2d')!.drawImage(three.domElement, 0, 0);
    cache.set(id, src);
  }
  const cv = document.createElement('canvas');
  cv.width = cv.height = size * 2;
  cv.style.width = cv.style.height = `${size}px`;
  cv.getContext('2d')!.drawImage(src, 0, 0, size * 2, size * 2);
  return cv;
}
