/** 游戏内界面：顶栏、据点与援军、选中面板、指令按钮、战报、帮助与结算 */
import { CLASS_NAMES, FactionDef, SITE_INFO, UNITS, UnitDef } from '../sim/defs';
import { World } from '../sim/world';
import { unitPortrait } from '../render/portrait';

export interface HudCallbacks {
  command(cmd: 'amove' | 'stop' | 'hold' | 'rally' | 'all'): void;
  selectType(defIdx: number, remove: boolean): void;
  setSpeed(s: number): void;
  focus(x: number, y: number): void;
  exit(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

const css = (c: [number, number, number]): string => `rgb(${c[0]},${c[1]},${c[2]})`;

export function unitTip(d: UnitDef): string {
  const lines = [
    `${d.name}（${CLASS_NAMES[d.cls]}）`, d.desc,
    `生命 ${d.hp}　攻击 ${d.dmg}${d.splash ? '（范围）' : ''}　攻速 ${d.cd}s`,
    `射程 ${d.range ? d.range : '近战'}　护甲 ${d.armM}/${d.armP}　移速 ${d.speed}`,
  ];
  if (d.charge) lines.push(`冲锋 +${d.charge}`);
  if (d.vsBld >= 2) lines.push(`对建筑 ×${d.vsBld}`);
  return lines.join('\n');
}

export class Hud {
  readonly root: HTMLDivElement;
  readonly minimap: HTMLCanvasElement;
  private readonly counts: HTMLDivElement;
  private readonly clock: HTMLSpanElement;
  private readonly sitesBox: HTMLDivElement;
  private readonly selBox: HTMLDivElement;
  private readonly feed: HTMLDivElement;
  private readonly modeTip: HTMLDivElement;
  private readonly help: HTMLDivElement;
  private readonly over: HTMLDivElement;
  private readonly speedBtns: HTMLButtonElement[] = [];
  private readonly portraits = new Map<number, string>();
  private selKey = '?';
  private readonly dbg: HTMLSpanElement;

  constructor(parent: HTMLElement, private readonly world: World, private readonly teamRgb: [number, number, number][],
    private readonly cb: HudCallbacks) {
    const root = (this.root = el('div', 'hud'));
    parent.appendChild(root);
    const human = world.humanTeam;

    // ---- 顶栏 ----
    const top = el('div', 'panel topbar');
    this.counts = el('div', 'counts');
    this.clock = el('span', 'clock', '00:00');
    this.dbg = el('span', 'dbg');
    top.append(this.counts, this.clock, this.dbg);
    root.appendChild(top);

    const ctl = el('div', 'panel ctl');
    for (const [label, sp] of [['暂停', 0], ['1×', 1], ['2×', 2], ['4×', 4]] as [string, number][]) {
      const b = el('button', sp === 1 ? 'on' : '', label);
      b.onclick = () => cb.setSpeed(sp);
      b.dataset.sp = String(sp);
      this.speedBtns.push(b);
      ctl.appendChild(b);
    }
    const fs = el('button', '', '全屏');
    fs.onclick = () => {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen();
    };
    const hb = el('button', '', '帮助');
    hb.onclick = () => this.toggleHelp();
    const xb = el('button', '', '退出');
    xb.onclick = () => cb.exit();
    ctl.append(fs, hb, xb);
    root.appendChild(ctl);

    // ---- 据点与援军 ----
    this.sitesBox = el('div', 'panel sites');
    // 列表会被定时重建，用事件委托响应点击
    this.sitesBox.onpointerdown = e => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('.site');
      if (!row) return;
      const s = world.sites[Number(row.dataset.id)];
      cb.focus(s.x, s.y);
    };
    root.appendChild(this.sitesBox);

    // ---- 小地图 ----
    const mm = el('div', 'panel mini');
    this.minimap = el('canvas');
    mm.appendChild(this.minimap);
    root.appendChild(mm);

    // ---- 选中面板 ----
    this.selBox = el('div', 'panel selection');
    root.appendChild(this.selBox);

    // ---- 指令 ----
    const cmds = el('div', 'panel cmds');
    if (human) {
      const defs: [string, string, Parameters<HudCallbacks['command']>[0], string][] = [
        ['攻击移动', 'A', 'amove', '行军途中遇敌即战'],
        ['停止', 'S', 'stop', '停止当前行动'],
        ['坚守', 'H', 'hold', '原地坚守，不追击'],
        ['集结点', 'R', 'rally', '设置援军集结位置'],
        ['全军', 'Ctrl+A', 'all', '选中全部部队'],
      ];
      for (const [name, key, cmd, tip] of defs) {
        const b = el('button', '', `<b>${name}</b><i>${key}</i>`);
        b.title = tip;
        b.onclick = () => cb.command(cmd);
        cmds.appendChild(b);
      }
    } else cmds.appendChild(el('div', 'hint', '观战模式'));
    root.appendChild(cmds);

    this.feed = el('div', 'feed');
    this.modeTip = el('div', 'modetip');
    root.append(this.feed, this.modeTip);

    // ---- 帮助 ----
    this.help = el('div', 'overlay help', `
      <div class="panel card">
        <h2>操作说明</h2>
        <table>
          <tr><td>左键点击 / 拖框</td><td>选择部队（Shift 加选，双击选中同类）</td></tr>
          <tr><td>右键地面</td><td>移动（自动列阵：近战在前、远程居后、器械殿后）</td></tr>
          <tr><td>右键敌军 / 敌方建筑</td><td>攻击（Ctrl+右键可强攻中立建筑）</td></tr>
          <tr><td>A + 左键</td><td>攻击移动：沿途遇敌即战，遇墙自动破城</td></tr>
          <tr><td>S / H</td><td>停止 / 坚守</td></tr>
          <tr><td>R + 左键</td><td>设置援军集结点</td></tr>
          <tr><td>Ctrl 或 Alt+数字 / 数字</td><td>编队 / 选中编队（连按两次跳转镜头）</td></tr>
          <tr><td>方向键、中键拖动、小地图</td><td>移动镜头；滚轮缩放</td></tr>
          <tr><td>空格 / + −</td><td>暂停 / 调整速度</td></tr>
        </table>
        <p><b>目标：</b>摧毁敌方大本营的主堡。占领村庄、马场、工坊、营地、城镇与城池后，援军会定时从己方后方入场；摧毁据点主建筑可使其永久失效。</p>
        <p>高地上的远程部队射程与伤害更高；森林减免远程伤害并拖慢骑兵；浅滩可涉水但行动迟缓。</p>
        <button class="primary">开始指挥</button>
      </div>`);
    this.help.querySelector('button')!.onclick = () => this.toggleHelp();
    this.help.onclick = e => {
      if (e.target === this.help) this.toggleHelp();
    };
    this.over = el('div', 'overlay over');
    this.over.hidden = true;
    root.append(this.help, this.over);
    if (!human) this.help.hidden = true;
  }

  get helpOpen(): boolean {
    return !this.help.hidden;
  }

  toggleHelp(): void {
    this.help.hidden = !this.help.hidden;
  }

  setSpeed(s: number): void {
    for (const b of this.speedBtns) b.classList.toggle('on', Number(b.dataset.sp) === s);
  }

  setMode(text: string): void {
    this.modeTip.textContent = text;
    this.modeTip.style.display = text ? 'block' : 'none';
  }

  setDebug(text: string): void {
    this.dbg.textContent = text;
  }

  message(text: string, kind: 'good' | 'bad' | 'info', x?: number, y?: number): void {
    const m = el('div', `msg ${kind}`, text);
    if (x !== undefined && y !== undefined) {
      m.style.cursor = 'pointer';
      m.onclick = () => this.cb.focus(x, y);
    }
    this.feed.prepend(m);
    while (this.feed.children.length > 5) this.feed.lastChild!.remove();
    setTimeout(() => m.classList.add('fade'), 6000);
    setTimeout(() => m.remove(), 7200);
  }

  /** 低频刷新（约 4 次/秒） */
  update(): void {
    const w = this.world;
    const f = w.factions as FactionDef[];
    const human = w.humanTeam || 1;
    const other = 3 - human;
    this.counts.innerHTML = `
      <span class="tag" style="--c:${css(this.teamRgb[human])}">${f[human].name}</span><b>${w.teamCount[human]}</b>
      <span class="vs">对</span>
      <span class="tag" style="--c:${css(this.teamRgb[other])}">${f[other].name}</span><b>${w.teamCount[other]}</b>`;
    const t = Math.floor(w.time);
    this.clock.textContent = `${String((t / 60) | 0).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
    // 据点列表
    let html = '<h3>据点与援军</h3>';
    const order = w.sites.slice().sort((a, b) => (a.owner === human ? 0 : a.owner === 0 ? 1 : 2) - (b.owner === human ? 0 : b.owner === 0 ? 1 : 2));
    for (const s of order) {
      const info = SITE_INFO[s.type];
      const c = css(this.teamRgb[s.owner]);
      let state: string;
      if (s.disabled) state = '<i>已毁</i>';
      else if (s.owner === human || (!w.humanTeam && s.owner)) {
        const sec = Math.max(0, Math.ceil(s.timer));
        const full = w.teamCount[s.owner] >= w.unitCap[s.owner];
        state = full ? '<i>兵力已满</i>' : `<b>${info.provides}</b> ${(sec / 60) | 0}:${String(sec % 60).padStart(2, '0')}`;
      } else state = `<i>${s.owner ? '敌占' : '中立'} · ${info.provides}</i>`;
      const cap = s.cap > 0 && s.capTeam ? `<u style="width:${Math.round(s.cap * 100)}%;background:${css(this.teamRgb[s.capTeam])}"></u>` : '';
      html += `<div class="site" data-id="${s.id}"><span class="dot" style="background:${s.disabled ? '#555' : c}"></span><span class="nm">${s.name}</span>${state}${cap}</div>`;
    }
    this.sitesBox.innerHTML = html;
  }

  private portrait(defIdx: number, team: number): string {
    const key = defIdx * 4 + team;
    let url = this.portraits.get(key);
    if (!url) {
      url = unitPortrait(UNITS[defIdx].key, this.teamRgb[team], 44).toDataURL();
      this.portraits.set(key, url);
    }
    return url;
  }

  updateSelection(sel: number[]): void {
    const w = this.world;
    const count = new Map<number, { n: number; hp: number }>();
    for (const s of sel) {
      const t = w.type[s];
      let e = count.get(t);
      if (!e) count.set(t, (e = { n: 0, hp: 0 }));
      e.n++;
      e.hp += w.hp[s] / UNITS[t].hp;
    }
    let key = '';
    for (const [t, e] of count) key += `${t}:${e.n}:${Math.round((e.hp / e.n) * 20)},`;
    if (key === this.selKey) return;
    this.selKey = key;
    if (!sel.length) {
      this.selBox.innerHTML = w.humanTeam
        ? '<div class="hint">拖框选择部队 · 右键移动或攻击 · <b>A</b> 攻击移动</div>'
        : '<div class="hint">观战模式：方向键 / 拖动小地图移动镜头，滚轮缩放</div>';
      return;
    }
    this.selBox.innerHTML = `<div class="total">已选 <b>${sel.length}</b></div>`;
    const types = [...count.keys()].sort((a, b) => UNITS[a].row - UNITS[b].row || a - b);
    for (const t of types) {
      const e = count.get(t)!;
      const d = UNITS[t];
      const card = el('div', 'ucard', `
        <img src="${this.portrait(t, w.humanTeam)}" draggable="false">
        <span class="n">${e.n}</span>
        <span class="nm">${d.name}</span>
        <span class="hp"><u style="width:${Math.round((e.hp / e.n) * 100)}%"></u></span>`);
      card.title = unitTip(d);
      card.onclick = ev => this.cb.selectType(t, ev.shiftKey || ev.ctrlKey || ev.metaKey);
      this.selBox.appendChild(card);
    }
  }

  showGameOver(win: boolean | null, onAgain: () => void): void {
    const w = this.world;
    const human = w.humanTeam || 1, other = 3 - human;
    const f = w.factions as FactionDef[];
    const title = win === null ? `${f[w.winner].name} 获胜` : win ? '胜　利' : '战　败';
    const sub = win === null ? '' : win ? '敌方主堡已被攻陷' : '我方主堡陷落';
    const t = Math.floor(w.time);
    this.over.innerHTML = `
      <div class="panel card ${win === false ? 'lose' : 'win'}">
        <h1>${title}</h1><p>${sub}</p>
        <table>
          <tr><th></th><th>${f[human].name}</th><th>${f[other].name}</th></tr>
          <tr><td>歼敌</td><td>${w.kills[human]}</td><td>${w.kills[other]}</td></tr>
          <tr><td>损失</td><td>${w.lost[human]}</td><td>${w.lost[other]}</td></tr>
          <tr><td>援军</td><td>${w.arrived[human]}</td><td>${w.arrived[other]}</td></tr>
          <tr><td>残存</td><td>${w.teamCount[human]}</td><td>${w.teamCount[other]}</td></tr>
        </table>
        <p>用时 ${(t / 60) | 0} 分 ${t % 60} 秒</p>
        <button class="primary">返回主菜单</button>
      </div>`;
    this.over.querySelector('button')!.onclick = onAgain;
    this.over.hidden = false;
  }

  destroy(): void {
    this.root.remove();
  }
}
