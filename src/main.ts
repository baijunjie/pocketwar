import './style.css';
import { GameApp } from './game';
import { FACTION_IDS, FactionId } from './sim/defs';
import { GameOptions } from './sim/setup';
import { showMenu } from './ui/menu';
import { loadAssets } from './render/assets';

const app = document.getElementById('app')!;
let game: GameApp | null = null;
let canvas: HTMLCanvasElement | null = null;
let closeMenu: (() => void) | null = null;

function toMenu(): void {
  if (game) {
    game.destroy();
    game.renderer.dispose();
    game = null;
  }
  canvas?.remove();
  canvas = null;
  closeMenu?.();
  closeMenu = showMenu(app, start);
}

function start(opts: GameOptions): void {
  closeMenu?.();
  closeMenu = null;
  const loading = document.createElement('div');
  loading.className = 'loading';
  loading.textContent = '正在生成战场…';
  app.appendChild(loading);
  // 让"加载中"先画出来，再做耗时的地图生成
  setTimeout(() => {
    try {
      canvas = document.createElement('canvas');
      canvas.className = 'view';
      canvas.tabIndex = 0;
      app.appendChild(canvas);
      game = new GameApp(app, canvas, opts, toMenu);
      if (import.meta.env.DEV) (window as unknown as { game: GameApp }).game = game;
      loading.remove();
    } catch (err) {
      loading.textContent = `启动失败：${(err as Error).message}`;
      console.error(err);
    }
  }, 30);
}

// 便于调试的直达参数：?f=china&e=japan&size=600&spectate=1&seed=42&fog=0
const q = new URLSearchParams(location.search);
if (q.has('view')) {
  void import('./dev/viewer').then(m => m.runViewer(app, q.get('view')!, q)).catch(e => {
    app.textContent = String((e as Error).stack ?? e);
  });
} else {
  const boot = document.createElement('div');
  boot.className = 'loading';
  boot.textContent = '正在加载模型…';
  app.appendChild(boot);
  void loadAssets().then(() => {
    boot.remove();
    if (!q.has('f')) return toMenu();
  const pick = (v: string | null, d: FactionId): FactionId => (FACTION_IDS.includes(v as FactionId) ? (v as FactionId) : d);
  start({
    seed: Number(q.get('seed')) || 42,
    factions: [pick(q.get('f'), 'china'), pick(q.get('e'), 'japan')],
    armySize: Number(q.get('size')) || 600,
    difficulty: Number(q.get('d') ?? 1),
    fog: q.get('fog') !== '0',
    spectate: q.get('spectate') === '1',
  });
  }, err => {
    boot.textContent = `模型加载失败：${(err as Error).message}`;
  });
}
