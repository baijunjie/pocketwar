/** three.js 渲染器：立体地形、透视镜头、实例化的单位与建筑、贴地标记与粒子 */
import * as THREE from 'three';
import {
  BK_KEEP, BK_WALL, BUILDINGS, DT, PROJ_ARC, P_BALL, P_BIGBOLT, P_BOLT, P_BULLET, P_JAVELIN, P_ROCKET, P_STONE, P_TORCH,
  RULES, SITE_HQ, TILE, T_BRIDGE, UNITS,
} from '../sim/defs';
import { CHUNK } from '../sim/map';
import {
  Building, FX_ARROW_HIT, FX_COLLAPSE, FX_DEATH, FX_EXPLODE, FX_FIRE, FX_HIT, FX_IMPACT, FX_LEVEL, FX_SMOKE, MAX_CORPSE,
  MAX_UNITS, S_BRACE, S_CHARGE, S_ROUT, S_SHIELD, S_TORCH, S_WALL, VIS_CELL, World,
} from '../sim/world';
import { bridgeGeo, buildingGeo, flagHeight, propGeo, rubbleGeo, wallGeo } from './buildings';
import { litMaterial, shared } from './materials';
import { box, cyl, join } from './prims';
import { Atlas, Q_AXIS, Q_BILLBOARD, Q_GROUND, Q_SCREEN, Quads, Sprite } from './quads';
import { Terrain, WATER_Y } from './terrain';
import { CLIP_FALLBACK, buildUnitModel } from './models/spec';
import { Clip, clipOf } from './rig';
import { UnitBatch } from './units';

const MAXP = 3000;
const FOV = 30;
const TAN = Math.tan((FOV / 2) * (Math.PI / 180));
const DULL = new THREE.Color(0.42, 0.45, 0.48);

export interface Marker {
  x: number;
  y: number;
  t: number;
  r: number;
  g: number;
  b: number;
}

interface InstGroup {
  mesh: THREE.InstancedMesh;
  list: Building[];
}

export class Renderer {
  readonly three: THREE.WebGLRenderer;
  /** 镜头：x, y 为注视点（世界坐标），zoom 越大越近，yaw 为水平转角，pitch 为俯角 */
  readonly cam = { x: 0, y: 0, zoom: 1, yaw: 0, pitch: 0.8 };
  viewW = 1;
  viewH = 1;
  readonly terrain: Terrain;
  /** [队伍] 颜色 0..1 */
  readonly teamColor: [number, number, number][];
  readonly teamRgb: [number, number, number][];
  markers: Marker[] = [];
  drawn = 0;

  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(FOV, 1, 10, 30000);
  private readonly sun = new THREE.DirectionalLight(0xfff0d6, 2.4);
  private readonly sky = new THREE.HemisphereLight(0xcfe0ff, 0x6e6548, 1.35);
  private readonly batches: (UnitBatch | null)[][] = [[], [], []];
  /** [队伍][兵种] 各标准动作解析后的结果（缺的动作已按回退表补上） */
  private readonly clips: (Record<string, Clip> | null)[][] = [[], [], []];
  private readonly ground: Quads;
  private readonly sprites: Quads;
  private readonly overlay: Quads;
  private readonly atlas = new Atlas(1024);
  private readonly white: Sprite;
  private readonly soft: Sprite;
  private readonly ring: Sprite;
  private readonly circle: Sprite;
  private readonly labels: Sprite[] = [];
  private readonly bldGroups = new Map<string, InstGroup>();
  private readonly rubble = new Map<string, InstGroup>();
  private readonly bldSig: Int32Array;
  private readonly flags: THREE.InstancedMesh;
  private readonly siteFlags: THREE.InstancedMesh;
  private readonly disposables: { dispose(): void }[] = [];
  private time = 0;
  private readonly ray = new THREE.Raycaster();
  private readonly v = new THREE.Vector3();
  private readonly m4 = new THREE.Matrix4();
  private readonly col = new THREE.Color();
  private readonly teamLin: THREE.Color[];
  /** 镜头在地面上看到的范围（包围盒），用于剔除 */
  private vx0 = 0;
  private vx1 = 0;
  private vy0 = 0;
  private vy1 = 0;

  // 粒子：x y z vx vy vz life life0 size grow r g b a
  private pn = 0;
  private readonly pp = new Float32Array(MAXP * 14);
  /** 单位上下城墙时的高度过渡 */
  private readonly lift = new Float32Array(MAX_UNITS);

  constructor(readonly canvas: HTMLCanvasElement, readonly world: World) {
    const r = (this.three = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    const f1 = world.factions[1]!, f2 = world.factions[2]!;
    this.teamRgb = [[190, 190, 182], f1.color, f1.id === f2.id ? f2.altColor : f2.color];
    this.teamColor = this.teamRgb.map(c => [c[0] / 255, c[1] / 255, c[2] / 255] as [number, number, number]);
    this.teamLin = this.teamColor.map(c => new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace));

    const scene = this.scene;
    scene.background = new THREE.Color(0x9db4c4);
    scene.fog = new THREE.Fog(0x9db4c4, 6000, 22000);
    scene.add(this.sky);
    const sun = this.sun;
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.6;
    scene.add(sun, sun.target);

    // ---- 地形 ----
    this.terrain = new Terrain(world.map, world.vw, world.vh,
      world.buildings.map(b => ({ tx: b.tx, ty: b.ty, w: b.w, h: b.h })));
    scene.add(this.terrain.mesh, this.terrain.water);
    this.terrain.mesh.renderOrder = -2;

    // ---- 贴图集 ----
    const at = this.atlas;
    this.white = at.add(8, 8, 1, c => {
      c.fillStyle = '#fff';
      c.fillRect(0, 0, 8, 8);
    });
    const wu = (this.white.u1 - this.white.u0) / 4, wv = (this.white.v1 - this.white.v0) / 4;
    this.white.u0 += wu;
    this.white.u1 -= wu;
    this.white.v0 += wv;
    this.white.v1 -= wv;
    this.soft = at.add(32, 32, 2, c => {
      const g = c.createRadialGradient(16, 16, 0, 16, 16, 16);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.5, 'rgba(255,255,255,0.55)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, 32, 32);
    });
    this.ring = at.add(48, 48, 2, c => {
      c.strokeStyle = '#fff';
      c.lineWidth = 3.4;
      c.beginPath();
      c.arc(24, 24, 20, 0, Math.PI * 2);
      c.stroke();
    });
    this.circle = at.add(256, 256, 1, c => {
      c.strokeStyle = '#fff';
      c.lineWidth = 3;
      c.setLineDash([14, 9]);
      c.beginPath();
      c.arc(128, 128, 124, 0, Math.PI * 2);
      c.stroke();
      c.fillStyle = 'rgba(255,255,255,0.07)';
      c.fill();
    });
    for (const s of world.sites) {
      const w = s.name.length * 14 + 14;
      this.labels.push(at.add(w, 22, 2, c => {
        c.font = '600 13px "PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.lineJoin = 'round';
        c.strokeStyle = 'rgba(15,12,8,0.9)';
        c.lineWidth = 4;
        c.strokeText(s.name, w / 2, 11);
        c.fillStyle = '#fff';
        c.fillText(s.name, w / 2, 11);
      }));
    }
    const tex = at.finish();
    this.ground = new Quads(tex, { ground: true });
    this.sprites = new Quads(tex, {}, 4096);
    this.overlay = new Quads(tex, { overlay: true }, 128);
    scene.add(this.ground.mesh, this.sprites.mesh, this.overlay.mesh);
    this.disposables.push(tex, this.ground, this.sprites, this.overlay, this.terrain);

    // ---- 单位 ----
    for (let tm = 1; tm <= 2; tm++) {
      const fac = world.factions[tm]!;
      for (const d of UNITS) {
        if (d.faction !== fac.id) continue;
        const b = new UnitBatch(buildUnitModel(d.model, this.teamRgb[tm]));
        this.batches[tm][d.idx] = b;
        const set: Record<string, Clip> = {};
        for (const name of ['idle', 'walk', 'run', 'attack', 'attackMove', 'die', 'charge', 'brace', 'guard', 'guardWalk']) {
          set[name] = clipOf(b.model, name, CLIP_FALLBACK);
        }
        this.clips[tm][d.idx] = set;
        scene.add(b.mesh);
        this.disposables.push(b);
      }
    }

    // ---- 建筑 ----
    const mat = litMaterial();
    this.disposables.push(mat);
    const nav = world.nav, mw = world.map.w, blds = world.buildings;
    const wallLike = (c: number): number => {
      const id = nav.bld[c];
      return id >= 0 && blds[id].def.kind <= 2 ? 1 : 0;
    };
    const lists = new Map<string, { geo: () => THREE.BufferGeometry; list: Building[] }>();
    const rub = new Map<string, { geo: () => THREE.BufferGeometry; list: Building[] }>();
    for (const b of blds) {
      const def = b.def;
      let key: string, geo: () => THREE.BufferGeometry;
      if (def.kind === BK_WALL) {
        const c = b.ty * mw + b.tx;
        const mask = wallLike(c - mw) | (wallLike(c + 1) << 1) | (wallLike(c + mw) << 2) | (wallLike(c - 1) << 3);
        key = `${def.key}:${mask}`;
        geo = () => wallGeo(mask, def.wood);
      } else {
        const variants = def.key === 'house' || def.key === 'tent' ? 4 : def.key === 'farmhouse' ? 2 : 1;
        const v = b.variant % variants, st = def.kind === BK_KEEP ? b.style : '';
        key = `${def.key}:${st}:${v}`;
        geo = () => buildingGeo(def.key, st, v);
      }
      if (!lists.has(key)) lists.set(key, { geo, list: [] });
      lists.get(key)!.list.push(b);
      const rk = `${def.w}x${def.h}:${def.wood ? 1 : 0}`;
      if (!rub.has(rk)) rub.set(rk, { geo: () => rubbleGeo(def.w, def.h, def.wood), list: [] });
      rub.get(rk)!.list.push(b);
    }
    const mk = (src: Map<string, { geo: () => THREE.BufferGeometry; list: Building[] }>, dst: Map<string, InstGroup>, shadow: boolean): void => {
      for (const [key, e] of src) {
        const g = e.geo();
        const mesh = new THREE.InstancedMesh(g, mat, e.list.length);
        mesh.castShadow = shadow;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        scene.add(mesh);
        dst.set(key, { mesh, list: e.list });
        this.disposables.push(g, mesh);
      }
    };
    mk(lists, this.bldGroups, true);
    mk(rub, this.rubble, false);
    this.bldSig = new Int32Array(blds.length).fill(-1);

    // 旗帜：旗杆 + 旗面，颜色随归属变化
    const flagGeo = join(cyl(0.5, 0.6, 22, 0x3a3028, 0, 11, 0, 4), box(13, 8, 0.5, 0xffffff, 6.8, 17.5, 0));
    const flagMat = litMaterial({ side: THREE.DoubleSide });
    this.flags = new THREE.InstancedMesh(flagGeo, flagMat, Math.max(1, blds.length));
    this.siteFlags = new THREE.InstancedMesh(flagGeo, flagMat, world.sites.length + 2);
    for (const f of [this.flags, this.siteFlags]) {
      f.frustumCulled = false;
      f.castShadow = true;
      f.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(f);
    }
    this.disposables.push(flagGeo, flagMat, this.flags, this.siteFlags);

    this.buildProps(mat);
    this.resize();
  }

  /** 树木、山石与桥：按区域分组实例化，交给视锥剔除 */
  private buildProps(mat: THREE.Material): void {
    const map = this.world.map, props = map.props;
    const REG = 4; // 每组 4×4 个区块
    const geos: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 8; k++) geos.push(propGeo(k));
    this.disposables.push(...geos);
    const rw = Math.ceil(map.chunkW / REG), rh = Math.ceil(map.chunkH / REG);
    const buckets = new Map<number, number[]>();
    for (let cy = 0; cy < map.chunkH; cy++) for (let cx = 0; cx < map.chunkW; cx++) {
      const ci = cy * map.chunkW + cx;
      const reg = ((cy / REG) | 0) * rw + ((cx / REG) | 0);
      for (let k = map.propChunk[ci]; k < map.propChunk[ci + 1]; k++) {
        const key = reg * 8 + props[k * 4 + 2];
        let l = buckets.get(key);
        if (!l) buckets.set(key, (l = []));
        l.push(k);
      }
    }
    void rh;
    const m = this.m4, q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    for (const [key, list] of buckets) {
      const kind = key % 8;
      const mesh = new THREE.InstancedMesh(geos[kind], mat, list.length);
      list.forEach((k, i) => {
        const x = props[k * 4], z = props[k * 4 + 1], sc = props[k * 4 + 3];
        // 用位置做伪随机，让同一种树朝向、高矮各不相同
        const h = Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1;
        q.setFromAxisAngle(up, h * 6.28);
        const k2 = kind < 5 ? 1.15 * sc * (0.85 + h * 0.4) : sc * 1.2;
        s.set(k2, k2 * (kind < 5 ? 0.9 + h * 0.35 : 1), k2);
        p.set(x, this.terrain.heightAt(x, z) - 0.5, z);
        mesh.setMatrixAt(i, m.compose(p, q, s));
      });
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      this.scene.add(mesh);
      this.disposables.push(mesh);
    }
    // 桥
    const cells: number[] = [];
    for (let i = 0; i < map.terrain.length; i++) if (map.terrain[i] === T_BRIDGE) cells.push(i);
    if (cells.length) {
      const g = bridgeGeo();
      const mesh = new THREE.InstancedMesh(g, mat, cells.length);
      cells.forEach((c, i) => {
        mesh.setMatrixAt(i, m.makeTranslation(((c % map.w) + 0.5) * TILE, 0.4, (((c / map.w) | 0) + 0.5) * TILE));
      });
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      this.disposables.push(g, mesh);
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.three.dispose();
    this.three.forceContextLoss();
  }

  resize(): void {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (w === 0 || h === 0) return;
    if (w !== this.viewW || h !== this.viewH) {
      this.viewW = w;
      this.viewH = h;
      this.three.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      this.three.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
  }

  /** 单位脚下的高度：桥面抬到水面以上，浅滩里只没到小腿 */
  groundY(x: number, z: number): number {
    const map = this.world.map;
    const tx = (x / TILE) | 0, tz = (z / TILE) | 0;
    if (tx >= 0 && tz >= 0 && tx < map.w && tz < map.h && map.terrain[tz * map.w + tx] === T_BRIDGE) return 1.6;
    const h = this.terrain.heightAt(x, z);
    return h < WATER_Y - 2.2 ? WATER_Y - 2.2 : h;
  }

  private get dist(): number {
    return 1500 / this.cam.zoom;
  }

  /** 屏幕上每个世界像素约占多少屏幕像素（按注视点处的距离估算） */
  get pxPerUnit(): number {
    return this.viewH / (2 * TAN * this.dist);
  }

  /** 把镜头参数写进 three.js 相机 */
  updateCamera(): void {
    const c = this.cam, d = this.dist;
    const ty = this.groundY(c.x, c.y);
    const cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
    this.camera.position.set(c.x + Math.sin(c.yaw) * cp * d, ty + sp * d, c.y + Math.cos(c.yaw) * cp * d);
    this.camera.near = Math.max(5, d * 0.05);
    this.camera.far = d * 8 + 4000;
    this.camera.lookAt(c.x, ty, c.y);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }

  /** 屏幕像素 → 地面上的世界坐标（与地形求交） */
  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    this.updateCamera();
    this.v.set((sx / this.viewW) * 2 - 1, -(sy / this.viewH) * 2 + 1, 0.5).unproject(this.camera);
    const o = this.camera.position;
    const dx = this.v.x - o.x, dy = this.v.y - o.y, dz = this.v.z - o.z;
    let gy = 0, x = 0, z = 0;
    for (let k = 0; k < 5; k++) {
      // 视线几乎水平或朝上时，取远处的一点
      const t = dy < -1e-4 ? Math.min((gy - o.y) / dy, 60000 / Math.hypot(dx, dy, dz)) : 60000 / Math.hypot(dx, dy, dz);
      x = o.x + dx * t;
      z = o.z + dz * t;
      gy = Math.max(WATER_Y, this.terrain.heightAt(x, z));
    }
    return { x, y: z };
  }

  /** 世界坐标（可带离地高度）→ 屏幕像素；镜头后方的点返回 null */
  worldToScreen(x: number, y: number, h = 0): { x: number; y: number } | null {
    this.v.set(x, this.groundY(x, y) + h, y).project(this.camera);
    if (this.v.z > 1 || this.v.z < -1) return null;
    return { x: (this.v.x + 1) * 0.5 * this.viewW, y: (1 - this.v.y) * 0.5 * this.viewH };
  }

  /** 屏幕四角落在地面上的位置（小地图画视野框用） */
  viewQuad(): { x: number; y: number }[] {
    return [this.screenToWorld(0, 0), this.screenToWorld(this.viewW, 0), this.screenToWorld(this.viewW, this.viewH),
      this.screenToWorld(0, this.viewH)];
  }

  /** 沿屏幕方向平移镜头（dx 向右、dy 向下，单位为世界像素） */
  moveCam(dx: number, dy: number): void {
    const c = this.cam, cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
    c.x += dx * cs + dy * sn;
    c.y += -dx * sn + dy * cs;
    this.clampCam();
  }

  clampCam(): void {
    const c = this.cam, w = this.world;
    c.zoom = Math.max(0.25, Math.min(3.2, c.zoom));
    c.pitch = Math.max(0.45, Math.min(1.4, c.pitch));
    c.x = Math.max(0, Math.min(w.W, c.x));
    c.y = Math.max(0, Math.min(w.H, c.y));
  }

  addMarker(x: number, y: number, r: number, g: number, b: number): void {
    this.markers.push({ x, y, t: 0, r, g, b });
  }

  private spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, grow: number,
    r: number, g: number, b: number, a: number): void {
    if (this.pn >= MAXP) return;
    const p = this.pp, o = this.pn++ * 14;
    p[o] = x;
    p[o + 1] = y;
    p[o + 2] = z;
    p[o + 3] = vx;
    p[o + 4] = vy;
    p[o + 5] = vz;
    p[o + 6] = life;
    p[o + 7] = life;
    p[o + 8] = size;
    p[o + 9] = grow;
    p[o + 10] = r;
    p[o + 11] = g;
    p[o + 12] = b;
    p[o + 13] = a;
  }

  private inView(x: number, y: number, pad = 0): boolean {
    return x >= this.vx0 - pad && x <= this.vx1 + pad && y >= this.vy0 - pad && y <= this.vy1 + pad;
  }

  /** 建筑的实例矩阵与明暗：只在状态变化时重写 */
  private syncBuildings(fog: boolean): void {
    const w = this.world, blds = w.buildings, tick = w.tickCount;
    let dirty = false;
    for (let i = 0; i < blds.length; i++) {
      const b = blds[i];
      const known = !fog || w.explored[((b.cy / VIS_CELL) | 0) * w.vw + ((b.cx / VIS_CELL) | 0)] === 1;
      const sig = (b.alive ? 1 : 0) | (known ? 2 : 0) | (b.owner << 2) | (((b.hp / b.def.hp) * 6) | 0) << 4 | (tick - b.hitTick < 3 ? 128 : 0);
      if (sig !== this.bldSig[i]) {
        this.bldSig[i] = sig;
        dirty = true;
      }
    }
    if (!dirty) return;
    const m = this.m4, col = this.col;
    const fill = (groups: Map<string, InstGroup>, alive: boolean): void => {
      for (const g of groups.values()) {
        let n = 0;
        for (const b of g.list) {
          if (b.alive !== alive || !(this.bldSig[b.id] & 2)) continue;
          m.makeTranslation(b.cx, this.terrain.heightAt(b.cx, b.cy) - 0.4, b.cy);
          g.mesh.setMatrixAt(n, m);
          const k = alive ? 0.5 + 0.5 * (b.hp / b.def.hp) : 0.8;
          const fl = alive && this.bldSig[b.id] & 128 ? 0.35 : 0;
          g.mesh.setColorAt(n, col.setRGB(k + fl, k * 0.97 + fl, k * 0.94 + fl));
          n++;
        }
        g.mesh.count = n;
        g.mesh.visible = n > 0;
        g.mesh.instanceMatrix.needsUpdate = true;
        if (g.mesh.instanceColor) g.mesh.instanceColor.needsUpdate = true;
      }
    };
    fill(this.bldGroups, true);
    fill(this.rubble, false);
    let n = 0;
    for (const b of blds) {
      if (!b.alive || !b.owner || !(this.bldSig[b.id] & 2)) continue;
      const fh = flagHeight(b.def.key, b.style);
      if (!fh) continue;
      m.makeTranslation(b.cx, this.terrain.heightAt(b.cx, b.cy) + fh - 22, b.cy);
      if (b.def.kind === BK_KEEP) m.scale(this.v.set(1.6, 1.6, 1.6));
      this.flags.setMatrixAt(n, m);
      this.flags.setColorAt(n++, this.teamLin[b.owner]);
    }
    this.flags.count = n;
    this.flags.instanceMatrix.needsUpdate = true;
    if (this.flags.instanceColor) this.flags.instanceColor.needsUpdate = true;
  }

  /** 昼夜与天气的画面表现：天光强弱与颜色、天空与雾色 */
  private applyEnvironment(): void {
    const env = this.world.env;
    const L = env.light, wet = env.rain;
    const c = this.col;
    // 夜里改成偏蓝的月光；下雨时整体压暗、发灰
    this.sun.intensity = (0.32 + 2.08 * L) * (1 - wet * 0.45);
    this.sun.color.setRGB(0.56 + 0.44 * L, 0.66 + 0.28 * L, 1 - 0.16 * L);
    this.sky.intensity = (0.42 + 0.93 * L) * (1 - wet * 0.2);
    this.sky.color.setRGB(0.5 + 0.31 * L, 0.6 + 0.28 * L, 1);
    c.setRGB(0.05 + 0.57 * L, 0.07 + 0.64 * L, 0.13 + 0.64 * L).lerp(DULL, wet * 0.55 * (0.25 + 0.75 * L));
    (this.scene.background as THREE.Color).copy(c);
    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(c);
    fog.near = 6000 - wet * 3200;
    fog.far = 22000 - wet * 9000;
  }

  /** 雨丝：每帧在视野里随机撒一批斜线 */
  private drawRain(S: Quads): void {
    const wet = this.world.env.rain;
    if (wet <= 0.01) return;
    const n = Math.round(wet * 420);
    const sx = this.vx1 - this.vx0, sz = this.vy1 - this.vy0;
    const len = Math.max(22, this.dist * 0.035), wd = Math.max(0.5, this.dist * 0.0009);
    const top = this.dist * 0.55;
    for (let k = 0; k < n; k++) {
      const x = this.vx0 + Math.random() * sx, z = this.vy0 + Math.random() * sz;
      S.add(Q_AXIS, this.white, x, this.terrain.heightAt(x, z) + Math.random() * top, z, len, wd, 0.78, 0.84, 0.95, 0.28, 0.5, 0.5, 0.16, -1, 0.06);
    }
  }

  /** @param fewSel 选中数量较少时，为每个选中单位都画血条；否则只画受伤的 */
  render(alpha: number, dt: number, sel: Uint8Array, fewSel = true): void {
    this.resize();
    const w = this.world, cam = this.cam;
    this.time += dt;
    shared.uTime.value = this.time;
    this.updateCamera();
    const d = this.dist;
    // 视野包围盒
    const q = this.viewQuad();
    this.vx0 = Math.min(q[0].x, q[1].x, q[2].x, q[3].x) - 60;
    this.vx1 = Math.max(q[0].x, q[1].x, q[2].x, q[3].x) + 60;
    this.vy0 = Math.min(q[0].y, q[1].y, q[2].y, q[3].y) - 60;
    this.vy1 = Math.max(q[0].y, q[1].y, q[2].y, q[3].y) + 120;

    const G = this.ground, S = this.sprites, O = this.overlay;
    G.begin();
    S.begin();
    O.begin();
    const fog = w.fog && w.humanTeam !== 0;
    const human = w.humanTeam;
    const vis = w.vis, expl = w.explored, vw = w.vw;
    const tick = w.tickCount;
    const white = this.white, soft = this.soft, ring = this.ring;
    const tc = this.teamColor;
    const near = d < 2600;
    const gy = (x: number, z: number): number => this.groundY(x, z);

    this.terrain.updateFog(fog, vis, expl, dt || 0.016);
    this.syncBuildings(fog);

    // ---------------- 特效事件 → 粒子 ----------------
    for (let k = 0; k < w.fxN; k++) {
      const o = k * 4;
      const kind = w.fx[o], fx = w.fx[o + 1], fz = w.fx[o + 2], a = w.fx[o + 3];
      if (!this.inView(fx, fz)) continue;
      if (fog && !vis[((fz / VIS_CELL) | 0) * vw + ((fx / VIS_CELL) | 0)]) continue;
      const R = Math.random;
      const y = gy(fx, fz);
      switch (kind) {
        case FX_HIT:
          if (near) this.spawn(fx, y + 11, fz, 0, 0, 0, 0.14, 3, 5, 1, 0.95, 0.7, 0.9);
          break;
        case FX_ARROW_HIT:
          this.spawn(fx, y + 2, fz, 0, 6, 0, 0.3, 2.5, 3, 0.8, 0.75, 0.6, 0.6);
          break;
        case FX_EXPLODE:
          this.spawn(fx, y + 5, fz, 0, 0, 0, 0.18, a * 1.1, a * 0.6, 1, 0.85, 0.5, 0.85);
          for (let j = 0; j < 7; j++) {
            const an = R() * 6.28, sp = 20 + R() * 55;
            this.spawn(fx, y + 3, fz, Math.cos(an) * sp, 14 + R() * 30, Math.sin(an) * sp, 0.5 + R() * 0.6, 5, 12, 0.56, 0.49, 0.38, 0.7);
          }
          this.spawn(fx, y + 8, fz, 0, 18, 0, 1.3, 9, 16, 0.3, 0.29, 0.28, 0.5);
          break;
        case FX_SMOKE:
          for (let j = 0; j < 3; j++) this.spawn(fx + R() * 4, y + 13, fz + R() * 4, (R() - 0.5) * 14, 8 + R() * 10, (R() - 0.5) * 14, 0.8 + R() * 0.7, 3.5 * a, 8 * a, 0.92, 0.92, 0.9, 0.5);
          break;
        case FX_DEATH:
          this.spawn(fx, y + 3, fz, (R() - 0.5) * 16, 6, (R() - 0.5) * 16, 0.5, a * 0.7, 6, 0.6, 0.54, 0.44, 0.5);
          break;
        case FX_LEVEL:
          // 升级：一圈金光
          if (near) {
            this.spawn(fx, y + 16, fz, 0, 26, 0, 0.7, 5, 9, 1, 0.85, 0.3, 0.9);
            this.spawn(fx, y + 4, fz, 0, 8, 0, 0.5, 9, 14, 1, 0.9, 0.5, 0.45);
          }
          break;
        case FX_IMPACT:
          for (let j = 0; j < 4; j++) {
            const an = R() * 6.28;
            this.spawn(fx, y + 6, fz, Math.cos(an) * 30, 12 + R() * 14, Math.sin(an) * 30, 0.45, a * 0.5, 9, 0.72, 0.66, 0.54, 0.6);
          }
          break;
        case FX_FIRE:
          // 火把砸中：一团火苗加黑烟
          this.spawn(fx, y + 10, fz, (R() - 0.5) * 8, 22, (R() - 0.5) * 8, 0.6, 5, -3, 1, 0.6, 0.15, 0.9);
          this.spawn(fx, y + 14, fz, 4, 16, 2, 1.2, 4, 10, 0.2, 0.19, 0.18, 0.4);
          break;
        case FX_COLLAPSE:
          for (let j = 0; j < 8 * a; j++) {
            this.spawn(fx + (R() - 0.5) * a * 30, y + R() * 20, fz + (R() - 0.5) * a * 26, (R() - 0.5) * 30, 8 + R() * 16, (R() - 0.5) * 30, 1 + R() * 1.2, 8, 22, 0.62, 0.58, 0.52, 0.7);
          }
          break;
      }
    }
    w.fxN = 0;

    // ---------------- 据点：占领圈、旗帜、名称 ----------------
    let nf = 0;
    const m = this.m4;
    const wave = Math.sin(this.time * 3) * 0.12;
    for (const s of w.sites) {
      if (!this.inView(s.x, s.y, 400)) continue;
      const known = !fog || expl[((s.y / VIS_CELL) | 0) * vw + ((s.x / VIS_CELL) | 0)] === 1;
      if (!known) continue;
      const c = tc[s.owner];
      const y = gy(s.x, s.y);
      if (s.radius > 0) {
        G.add(Q_GROUND, this.circle, s.x, y, s.y, s.radius * 2, s.radius * 2, c[0], c[1], c[2], 0.55);
        // 旗帜区：进攻方要站进这个小圈才开始读秒；读秒进度从小圈向外扩到整个占领圈
        const fr = RULES.capture.flagRadius * 2;
        G.add(Q_GROUND, ring, s.x, y, s.y, fr * 1.17, fr * 1.17, 1, 1, 1, 0.35);
        if (s.capTeam) {
          const cc = tc[s.capTeam];
          const rr = fr + (s.radius * 2 - fr) * s.cap;
          G.add(Q_GROUND, this.circle, s.x, y, s.y, rr, rr, cc[0], cc[1], cc[2], 0.9);
        }
        m.makeRotationY(wave).scale(this.v.set(2.2, 2.2, 2.2)).setPosition(s.x, y, s.y);
        this.siteFlags.setMatrixAt(nf, m);
        this.siteFlags.setColorAt(nf++, this.teamLin[s.owner]);
      }
      const lb = this.labels[s.id];
      const dim = s.disabled ? 0.5 : 1;
      const ly = y + (s.type === SITE_HQ ? 150 : 62);
      O.add(Q_SCREEN, lb, s.x, ly, s.y, lb.w, lb.h, dim, dim, dim, 1, 0.5, 1);
      O.add(Q_SCREEN, white, s.x, ly, s.y, 36, 4, 0.05, 0.05, 0.05, 0.75, 0.5, -0.5);
      O.add(Q_SCREEN, white, s.x, ly, s.y, 34, 2.4, c[0], c[1], c[2], 1, 0.5, -1.2);
      if (s.cap > 0 && s.capTeam) {
        const cc = tc[s.capTeam];
        O.add(Q_SCREEN, white, s.x, ly, s.y, 34 * s.cap, 2.4, cc[0], cc[1], cc[2], 1, 0.5 / s.cap, -1.2);
      }
    }
    // 集结点
    if (human) {
      const r = w.rally[human];
      if (this.inView(r.x, r.y)) {
        const y = gy(r.x, r.y);
        G.add(Q_GROUND, ring, r.x, y, r.y, 30, 30, 1, 0.9, 0.3, 0.8);
        m.makeRotationY(wave).scale(this.v.set(1.3, 1.3, 1.3)).setPosition(r.x, y, r.y);
        this.siteFlags.setMatrixAt(nf, m);
        this.siteFlags.setColorAt(nf++, this.teamLin[human]);
      }
    }
    this.siteFlags.count = nf;
    this.siteFlags.instanceMatrix.needsUpdate = true;
    if (this.siteFlags.instanceColor) this.siteFlags.instanceColor.needsUpdate = true;

    // ---------------- 单位 ----------------
    // 拉远后单位的影子小到看不清，省掉这一遍绘制
    const unitShadows = d < 2400;
    for (let tm = 1; tm <= 2; tm++) for (const b of this.batches[tm]) {
      if (!b) continue;
      b.begin();
      b.mesh.castShadow = unitShadows;
    }
    // 尸体
    const nc = Math.min(w.corpseN, MAX_CORPSE);
    const CORPSE_LIFE = 30 * 40;
    for (let c = 0; c < nc; c++) {
      const age = tick - w.cTick[c];
      if (age > CORPSE_LIFE) continue;
      const x = w.cX[c], z = w.cY[c];
      if (!this.inView(x, z)) continue;
      if (fog && !vis[((z / VIS_CELL) | 0) * vw + ((x / VIS_CELL) | 0)]) continue;
      const b = this.batches[w.cTeam[c]][w.cType[c]];
      if (!b) continue;
      const clip = this.clips[w.cTeam[c]][w.cType[c]]!.die;
      // 最后几秒沉入地面
      const sink = Math.max(0, (age - (CORPSE_LIFE - 150)) / 150);
      b.add(x, gy(x, z) - sink * 6, z, w.cDir[c], clip, (age + alpha) / (clip.n * 1.0), 0, 1, 0.72);
    }
    const showBars = d < 1900;
    const hbit = 1 << human;
    const dark = 1 - w.env.light;
    const wallTop = BUILDINGS.wall.top;
    const n = w.n;
    let drawn = 0;
    for (let i = 0; i < n; i++) {
      if (!w.alive[i]) continue;
      const x = w.px[i] + (w.x[i] - w.px[i]) * alpha, z = w.py[i] + (w.y[i] - w.py[i]) * alpha;
      if (!this.inView(x, z)) continue;
      const tm = w.team[i];
      // 敌军要被己方看见才画（包括远处打着火把的）
      if (fog && tm !== human && !(w.seen[i] & hbit)) continue;
      const b = this.batches[tm][w.type[i]]!;
      const cl = this.clips[tm][w.type[i]]!;
      const def = UNITS[w.type[i]];
      const st = w.state[i];
      // 站上城墙的单位抬到墙顶，上下墙时平滑过渡
      const up = st & S_WALL ? wallTop : 0;
      let lf = this.lift[i];
      if (lf !== up) lf = this.lift[i] = Math.abs(up - lf) < 0.5 || lf > wallTop ? up : lf + (up - lf) * Math.min(1, (dt || 0.016) * 9);
      const y = gy(x, z) + lf;
      const aa = w.atkAnim[i];
      const sp2 = w.vx[i] * w.vx[i] + w.vy[i] * w.vy[i];
      let clip: Clip, ph: number;
      if (aa > 0) {
        clip = sp2 > 900 ? cl.attackMove : cl.attack;
        ph = 1 - aa / 0.3;
      } else if (sp2 > 30) {
        // 走还是跑看实际速度；步幅与行进距离挂钩，脚下不打滑
        let name = sp2 > def.walk * def.walk * 1.3 ? 'run' : 'walk';
        if (st & S_CHARGE) name = 'charge';
        else if (st & S_SHIELD && !(st & S_ROUT)) name = 'guardWalk';
        clip = cl[name];
        ph = (w.odo[i] / (b.model.strides[name] ?? b.model.strides.walk ?? 28)) % 1;
      } else {
        clip = st & S_BRACE ? cl.brace : st & S_SHIELD ? cl.guard : cl.idle;
        ph = (this.time * 0.4 + i * 0.37) % 1;
      }
      const torch = (st & S_TORCH) !== 0;
      // 溃兵发白；夜里打火把的被火光照亮
      b.add(x, y, z, w.dir[i], clip, ph, st & S_ROUT ? 0.42 : w.flash[i] > 0 ? 0.25 : 0, 1, torch ? 1 + dark * 0.9 : 1);
      if (torch) {
        const fl = 4.5 + Math.sin(this.time * 17 + i) * 1.2;
        const fy = y + Math.min(b.model.height, 26) + 3;
        S.add(Q_BILLBOARD, soft, x, fy, z, fl * 1.9, fl * 2.3, 1, 0.5, 0.12, 0.85);
        S.add(Q_BILLBOARD, soft, x, fy - 0.5, z, fl, fl * 1.3, 1, 0.9, 0.55, 1);
        if (near) G.add(Q_GROUND, soft, x, y, z, 70, 70, 1, 0.62, 0.25, 0.1 + dark * 0.12);
      }
      drawn++;
      const hr = w.hp[i] / w.maxHp[i];
      const top = b.model.height + 3;
      const lv = w.level[i];
      if (lv > 0 && showBars) {
        // 等级：头顶一排金色小点
        for (let k = 0; k < lv; k++) S.add(Q_BILLBOARD, white, x, y + top + 3.2, z, 1.7, 1.7, 1, 0.82, 0.25, 1, 0.5 - (k - (lv - 1) / 2) * 1.4, 0.5);
      }
      if (sel[i]) {
        const r = def.radius * 2.6 + 5;
        G.add(Q_GROUND, ring, x, y, z, r, r, 0.35, 1, 0.4, 0.95);
      }
      if (sel[i] && (fewSel || hr < 0.999)) {
        const bw = 10 + def.radius;
        S.add(Q_BILLBOARD, white, x, y + top, z, bw + 1.2, 2.6, 0, 0, 0, 0.75);
        S.add(Q_BILLBOARD, white, x, y + top, z, bw * hr, 1.6, 1 - hr, 0.35 + hr * 0.6, 0.2, 1, bw / 2 / (bw * hr || 1), 0.5);
      } else if (showBars && hr < 0.999) {
        const bw = 9 + def.radius * 0.6;
        S.add(Q_BILLBOARD, white, x, y + top, z, bw, 1.6, 0, 0, 0, 0.55);
        if (tm === human || !human) S.add(Q_BILLBOARD, white, x, y + top, z, bw * hr, 1.6, 0.3, 0.9, 0.3, 0.9, bw / 2 / (bw * hr || 1), 0.5);
        else S.add(Q_BILLBOARD, white, x, y + top, z, bw * hr, 1.6, 0.95, 0.3, 0.25, 0.9, bw / 2 / (bw * hr || 1), 0.5);
      }
    }
    for (let tm = 1; tm <= 2; tm++) for (const b of this.batches[tm]) b?.end();
    this.drawn = drawn;

    // ---------------- 建筑：血条与烟火 ----------------
    for (const b of w.buildings) {
      if (!b.alive || !this.inView(b.cx, b.cy, 100)) continue;
      if (!(this.bldSig[b.id] & 2)) continue;
      const def = b.def;
      const ratio = b.hp / def.hp;
      if (ratio >= 1) continue;
      const y = this.terrain.heightAt(b.cx, b.cy);
      const tall = def.tall * 1.3 + 14;
      if (ratio < 0.6 && Math.random() < (0.6 - ratio) * 0.25 * def.w) {
        const px = b.x0 + Math.random() * def.w * TILE, pz = b.y0 + Math.random() * def.h * TILE, py = y + tall * (0.5 + Math.random() * 0.5);
        if (ratio < 0.35) this.spawn(px, py, pz, (Math.random() - 0.5) * 8, 30, 0, 0.5, 6, -4, 1, 0.55, 0.15, 0.85);
        this.spawn(px, py + 4, pz, 6 + Math.random() * 6, 18, 3, 1.6, 6, 16, 0.22, 0.21, 0.2, 0.45);
      }
      if (tick - b.hitTick < 240) {
        const bw = Math.min(60, def.w * TILE * 0.8);
        S.add(Q_BILLBOARD, white, b.cx, y + tall + 8, b.cy, bw + 2, 5, 0, 0, 0, 0.7);
        S.add(Q_BILLBOARD, white, b.cx, y + tall + 8, b.cy, bw * ratio, 3, 1 - ratio, 0.3 + ratio * 0.6, 0.2, 1, bw / 2 / (bw * ratio || 1), 0.5);
      }
    }

    // ---------------- 投射物 ----------------
    for (let p = 0; p < w.pn; p++) {
      const t = Math.min(1, (w.pT[p] + alpha * DT) / w.pDur[p]);
      const sx = w.pSx[p], sz = w.pSy[p], dx = w.pTx[p] - sx, dz = w.pTy[p] - sz;
      const x = sx + dx * t, z = sz + dz * t;
      if (!this.inView(x, z)) continue;
      if (fog && !vis[((z / VIS_CELL) | 0) * vw + ((x / VIS_CELL) | 0)]) continue;
      const type = w.pType[p];
      const len = Math.sqrt(dx * dx + dz * dz) || 1;
      const arc = PROJ_ARC[type] * len;
      const y = gy(x, z) + arc * 4 * t * (1 - t) + 11;
      // 切线方向
      const ax = dx, ay = arc * 4 * (1 - 2 * t), az = dz;
      if (type === P_TORCH) {
        S.add(Q_BILLBOARD, soft, x, y, z, 9, 11, 1, 0.5, 0.12, 0.9);
        S.add(Q_BILLBOARD, soft, x, y, z, 4.5, 6, 1, 0.9, 0.55, 1);
        if (Math.random() < 0.5) this.spawn(x, y, z, 0, 5, 0, 0.4, 2, 4, 0.3, 0.28, 0.26, 0.35);
      } else if (type === P_STONE || type === P_BALL) {
        const r = type === P_STONE ? 7 : 5;
        S.add(Q_BILLBOARD, soft, x, y, z, r * 1.6, r * 1.6, 0.16, 0.15, 0.14, 1);
        S.add(Q_BILLBOARD, soft, x, y, z, r, r, 0.42, 0.4, 0.38, 1);
        G.add(Q_GROUND, soft, x, gy(x, z), z, 14, 14, 0, 0, 0, 0.35);
      } else if (type === P_BULLET) {
        S.add(Q_AXIS, white, x, y, z, 16, 1.1, 1, 0.93, 0.7, 0.85, 0.5, 0.5, ax, ay, az);
      } else {
        const L = type === P_JAVELIN ? 15 : type === P_BIGBOLT ? 20 : type === P_ROCKET ? 13 : type === P_BOLT ? 8 : 10;
        const wd = type === P_BIGBOLT ? 1.6 : type === P_JAVELIN ? 1.2 : 0.9;
        S.add(Q_AXIS, white, x, y, z, L, wd, 0.36, 0.27, 0.17, 1, 0.5, 0.5, ax, ay, az);
        S.add(Q_AXIS, white, x, y, z, 2.6, wd * 1.5, 0.82, 0.84, 0.86, 1, -L / 5.2 + 0.5, 0.5, ax, ay, az);
        if (type === P_ROCKET && Math.random() < 0.6) this.spawn(x, y, z, 0, 4, 0, 0.5, 2.5, 5, 0.85, 0.82, 0.78, 0.45);
      }
    }

    // ---------------- 粒子 ----------------
    const pp = this.pp;
    for (let k = 0; k < this.pn; k++) {
      const o = k * 14;
      pp[o + 6] -= dt;
      if (pp[o + 6] <= 0) {
        const qo = --this.pn * 14;
        for (let j = 0; j < 14; j++) pp[o + j] = pp[qo + j];
        k--;
        continue;
      }
      pp[o] += pp[o + 3] * dt;
      pp[o + 1] += pp[o + 4] * dt;
      pp[o + 2] += pp[o + 5] * dt;
      const damp = 1 - dt * 1.5;
      pp[o + 3] *= damp;
      pp[o + 4] *= damp;
      pp[o + 5] *= damp;
      const life = pp[o + 6] / pp[o + 7];
      const size = Math.max(0.5, pp[o + 8] + pp[o + 9] * (1 - life)) * 2;
      S.add(Q_BILLBOARD, soft, pp[o], pp[o + 1], pp[o + 2], size, size, pp[o + 10], pp[o + 11], pp[o + 12], pp[o + 13] * Math.min(1, life * 1.6));
    }

    // ---------------- 指令标记 ----------------
    for (let k = this.markers.length - 1; k >= 0; k--) {
      const mk = this.markers[k];
      mk.t += dt * 2.2;
      if (mk.t >= 1) {
        this.markers.splice(k, 1);
        continue;
      }
      const sz = (18 + 26 * mk.t) * Math.max(0.8, d / 1500);
      const y = gy(mk.x, mk.y);
      G.add(Q_GROUND, ring, mk.x, y, mk.y, sz * 1.7, sz * 1.7, mk.r, mk.g, mk.b, 1 - mk.t);
      G.add(Q_GROUND, ring, mk.x, y, mk.y, sz * 0.9, sz * 0.9, mk.r, mk.g, mk.b, (1 - mk.t) * 0.8);
    }
    this.drawRain(S);
    G.end(this.viewW, this.viewH);
    S.end(this.viewW, this.viewH);
    O.end(this.viewW, this.viewH);

    // ---------------- 阳光与阴影范围 ----------------
    const ext = Math.min(2600, Math.max(260, d * 0.62));
    const ty = this.groundY(cam.x, cam.y);
    // 阴影范围的中心放在视野中心稍偏远处
    const cs = Math.cos(cam.yaw), sn = Math.sin(cam.yaw);
    const fwd = d * Math.cos(cam.pitch) * 0.25;
    const cx = cam.x - sn * fwd, cz = cam.y - cs * fwd;
    this.sun.target.position.set(cx, ty, cz);
    this.sun.position.set(cx - 0.55 * 3000, ty + 0.75 * 3000, cz + 0.42 * 3000);
    this.applyEnvironment();
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -ext;
    sc.right = sc.top = ext;
    sc.near = 100;
    sc.far = 7000;
    sc.updateProjectionMatrix();
    this.sun.target.updateMatrixWorld();

    this.three.render(this.scene, this.camera);
  }
}
