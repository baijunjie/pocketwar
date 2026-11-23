/** 游戏内界面：顶栏、据点与援军、选中面板、指令按钮、战报、帮助与结算 */
import {
  CLASS_NAMES, ELITE, FactionDef, LEVELS, RES_KINDS, RES_NAMES, RULES, ResKind, SITE_CATEGORY_NAMES, SITE_HQ, SITE_INFO, SIZES, UNITS,
  UnitDef,
} from '../sim/defs';
import { canUpgradeSite, towerCount, unitUpgradeCost } from '../sim/systems/economy';
import { teamMoraleFactors } from '../sim/systems/morale';
import { S_BRACE, S_CHARGE, S_COMBAT, S_SHIELD, S_TORCH, S_WALL, Site, World } from '../sim/world';
import { unitPortrait } from '../render/portrait';

/** 此刻可以点的升级：所选部队、屏幕内全部部队、屏幕内全部城邦 / 营寨（null = 不显示这个按钮） */
export interface UpgradeOffers {
  /** 所选部队：黄金够升其中几人、要花多少 */
  sel: { count: number; cost: number; total: number } | null;
  /** 黄金足够把屏幕内的己方部队全部升级 */
  all: { count: number; cost: number } | null;
  forts: { count: number; cost: number } | null;
  camps: { count: number; cost: number } | null;
}
export type UpgradeAction = 'sel' | 'all' | 'forts' | 'camps';

export interface HudCallbacks {
  command(cmd: 'amove' | 'stop' | 'hold' | 'rally' | 'all' | 'torch' | 'outpost' | 'garrison'): void;
  /** 点了某个升级按钮 */
  upgrade(act: UpgradeAction): void;
  /** 选中一个据点（-1 = 取消） */
  selectSite(id: number): void;
  /** 对选中的据点：升级 / 建一座箭塔 */
  siteAction(act: 'upgrade' | 'tower', id: number): void;
  selectType(defIdx: number, remove: boolean): void;
  setSpeed(s: number): void;
  focus(x: number, y: number): void;
  exit(): void;
  toggleSound(): boolean;
  soundOn(): boolean;
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
    `射程 ${d.range ? d.range : '近战'}　护甲 ${d.armM}/${d.armP}`,
    `体型 ${SIZES[d.size].name}　行军 ${d.walk}　奔跑 ${d.speed}　口粮 ${d.upkeep}`,
  ];
  const ab = d.abilities;
  if (ab.charge) lines.push(`冲锋：远距离接敌时突进，冲撞伤害 ${ab.charge.impact}`);
  if (ab.brace) lines.push(`拒马：敌人冲来时立枪，反伤 ${ab.brace.dmg}`);
  if (ab.shield) lines.push(`举盾：遇远程敌人时远程伤害 −${Math.round(ab.shield.block * 100)}%，移动稍慢`);
  if (ab.torch) lines.push('夜间可打火把');
  lines.push(d.siege ? '工程类：能破坏城墙与箭楼' : '打建筑时投掷火把，烧不动城墙与箭楼');
  if (d.vsBld >= 2) lines.push(`对建筑 ×${d.vsBld}`);
  if (d.elite >= 0) lines.push(`可花 ${unitUpgradeCost(d)} 黄金升为「${UNITS[d.elite].name}」：生命 ×${ELITE.hp}、攻击 ×${ELITE.dmg}、护甲 +${ELITE.armor}`);
  else if (d.tier) lines.push('高级形态');
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
  private soundBtn!: HTMLButtonElement;
  private readonly portraits = new Map<number, string>();
  private selKey = '?';
  private readonly dbg: HTMLSpanElement;
  private readonly envBox: HTMLSpanElement;
  private readonly foodBox: HTMLSpanElement;
  private readonly moraleBox: HTMLSpanElement;
  private readonly resBox: HTMLSpanElement;
  private readonly upBar: HTMLDivElement;
  private upKey = '';
  private sitesHtml = '';

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
    this.envBox = el('span', 'env');
    this.foodBox = el('span', 'food');
    this.moraleBox = el('span', 'morale');
    this.resBox = el('span', 'res');
    top.append(this.counts, this.clock, this.envBox, this.foodBox, this.resBox, this.moraleBox, this.dbg);
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
    this.soundBtn = el('button', '', '');
    this.soundBtn.title = '开 / 关音效（M）';
    this.soundBtn.onclick = () => this.setSound(cb.toggleSound());
    this.setSound(cb.soundOn());
    const hb = el('button', '', '帮助');
    hb.onclick = () => this.toggleHelp();
    const xb = el('button', '', '退出');
    xb.onclick = () => cb.exit();
    ctl.append(fs, this.soundBtn, hb, xb);
    root.appendChild(ctl);

    // ---- 据点与援军 ----
    this.sitesBox = el('div', 'panel sites');
    // 列表会被定时重建，用事件委托响应点击
    this.sitesBox.onpointerdown = e => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('[data-id]');
      if (!row) return;
      const s = world.sites[Number(row.dataset.id)];
      cb.focus(s.x, s.y);
      cb.selectSite(s.id);
    };
    root.appendChild(this.sitesBox);

    // ---- 小地图 ----
    const mm = el('div', 'panel mini');
    this.minimap = el('canvas');
    mm.appendChild(this.minimap);
    root.appendChild(mm);

    // ---- 选中面板 ----
    this.selBox = el('div', 'panel selection');
    // 面板内容会被定时重建，按钮用事件委托
    this.selBox.addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
      if (b && !b.disabled) cb.siteAction(b.dataset.act as 'upgrade' | 'tower', Number(b.dataset.site));
    });
    root.appendChild(this.selBox);

    // ---- 升级按钮（有资源、有可升级的对象时才出现） ----
    this.upBar = el('div', 'upbar');
    this.upBar.onclick = e => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-up]');
      if (b) cb.upgrade(b.dataset.up as UpgradeAction);
    };
    root.appendChild(this.upBar);

    // ---- 指令 ----
    const cmds = el('div', 'panel cmds');
    if (human) {
      const defs: [string, string, Parameters<HudCallbacks['command']>[0], string][] = [
        ['攻击移动', 'F', 'amove', '行军途中遇敌即战'],
        ['停止', 'X', 'stop', '停止当前行动'],
        ['坚守', 'H', 'hold', '原地坚守，不追击'],
        ['登城驻守', 'G', 'garrison', '所选部队里的远程步兵登上所在城邦的城墙，各守一个垛口（射得更远、挨箭更轻）；垛口满了不能再上，下别的命令即下墙'],
        ['集结点', 'R', 'rally', '设置援军集结位置'],
        ['火把', 'T', 'torch', '点燃 / 熄灭所选部队的火把：点着看得远，也更容易被发现'],
        ['扎营', 'B', 'outpost', `派所选部队到指定位置搭一座临时据点（木材 ${RULES.economy.outpostCost}，最多 ${RULES.economy.outpostMax} 座）：部队在里面休整回血，被毁不会重生`],
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
          <tr><td>右键地面</td><td>移动（编队行军，自动列阵：近战在前、远程居后、器械殿后）</td></tr>
          <tr><td>右键按住拖动</td><td>在按下处列阵，面朝拖动的方向（原地拖动即原地转向重排）</td></tr>
          <tr><td>右键敌军 / 敌方建筑</td><td>攻击（Ctrl+右键可强攻中立建筑）</td></tr>
          <tr><td>F + 左键</td><td>攻击移动：沿途遇敌即战、见敌方建筑就打，遇墙自动破城；点在敌方建筑上则直接攻打它</td></tr>
          <tr><td>X / H</td><td>停止 / 坚守</td></tr>
          <tr><td>G</td><td>登城驻守：城邦里的远程步兵登上城墙，各守一个垛口</td></tr>
          <tr><td>R + 左键</td><td>设置援军集结点</td></tr>
          <tr><td>T</td><td>点燃 / 熄灭所选部队的火把（夜间）</td></tr>
          <tr><td>B + 左键</td><td>扎营：派所选部队去搭一座临时据点（耗木材）</td></tr>
          <tr><td>左键点据点</td><td>选中据点：升级，或给资源点建箭塔</td></tr>
          <tr><td>Ctrl 或 Alt+数字 / 数字</td><td>编队 / 选中编队（连按两次跳转镜头）</td></tr>
          <tr><td>Shift+数字</td><td>追加编队：把当前选中的部队并入该队</td></tr>
          <tr><td>鼠标移到屏幕边缘、W A S D / 方向键、小地图</td><td>移动镜头（越靠边越快）；滚轮缩放</td></tr>
          <tr><td>中键拖动、Q / E</td><td>旋转镜头（上下拖动调俯角）；Shift+中键拖动平移；Home 复位</td></tr>
          <tr><td>空格 / + −　M</td><td>暂停 / 调整速度　开关音效</td></tr>
        </table>
        <p><b>目标：</b>摧毁敌方大本营的主堡。<b>占领据点：</b>先肃清圈内守军，再派人站到中央旗帜下读秒；敌人回到圈内读秒暂停，旗下没人则清零。占领后援军定时从己方后方入场，被毁的建筑也会修好。</p>
        <p><b>攻坚：</b>士兵和骑兵打建筑是扔火把——营寨的木栅一烧就垮，城邦的石墙只有器械与战象能破（门楼、角楼可以慢慢烧毁，它们和营寨的望楼都会放箭）。城邦里的远程步兵按 G 登上自家城墙驻守，每个垛口一人，射得更远、挨箭更轻；别的兵种上不了墙。</p>
        <p>高地上的远程部队射程与伤害更高；森林减免远程伤害并拖慢骑兵；浅滩可涉水但行动迟缓。</p>
        <p><b>士气：</b>敌众我寡、伤亡惨重、断粮、淋雨都会压低士气，士气见底的部队会溃逃（头顶一面小白旗，防御大减），逃回最近的己方据点才恢复指挥。老兵更不容易溃逃。</p>
        <p><b>粮草：</b>据点产粮、部队吃粮，只靠大本营养不活全军。<b>昼夜：</b>夜里视野缩小，火把能照远但会暴露自己；下雨时火把点不着、行军变慢。偶尔下雪：走得更慢、看得更近，据点外的部队防御下降。</p>
        <p><b>资源点：</b>农庄、伐木场、采石场、金矿，站到旗下几秒就占领，之后自动采集。<b>黄金</b>把部队升为重甲的高级形态（左下角的升级按钮，老兵优先）；<b>石料</b>升级城邦、<b>木材</b>升级营寨（选中据点后点升级），手里有料时建筑也修得更快；木材还能给资源点建箭塔（最多 4 座，敌人得先拆光才能占领）、让部队扎营。</p>
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

  setSound(on: boolean): void {
    this.soundBtn.textContent = on ? '音效：开' : '音效：关';
    this.soundBtn.classList.toggle('on', on);
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
    // 时辰与天气
    const env = w.env;
    const ck = env.clock;
    const E = RULES.env;
    const part = env.night ? '夜晚' : ck < E.sunrise + 0.06 ? '清晨' : ck > E.sunset - 0.06 ? '黄昏' : ck < 0.44 ? '上午' : ck < 0.56 ? '正午' : '下午';
    this.envBox.textContent = `${part} · ${env.snowing ? '雪' : env.raining ? '雨' : '晴'}`;
    this.envBox.className = `env${env.night ? ' night' : ''}${env.raining ? ' rain' : ''}${env.snowing ? ' snow' : ''}`;
    this.envBox.title = `夜间视野 ×${E.nightVision}，火把 ×${E.torchVision}；雨天行军 ×${E.rainSpeed}，火把点不着\n`
      + `雪天行军 ×${E.snowSpeed}、视野 ×${E.snowVision}（与夜晚叠乘）、火把点不着，据点之外的部队护甲 ×${E.snowArmor}`;
    // 木材、石料、黄金
    const use: Record<ResKind, string> = {
      wood: `升级营寨、给资源点建箭塔（${RULES.economy.towerCost}）、扎营（${RULES.economy.outpostCost}）；有木材时营寨的建筑修得更快`,
      stone: '升级城邦；有石料时城邦的建筑修得更快',
      gold: `把部队升为高级形态（每份口粮 ${RULES.economy.unitGold}）`,
    };
    this.resBox.innerHTML = RES_KINDS.map(k => `<span class="r-${k}" title="${RES_NAMES[k]}：每分钟 +${Math.round(w.income[k][human])}\n${use[k]}">`
      + `${RES_NAMES[k][0]} <b>${Math.floor(w.stock[k][human])}</b></span>`).join('');
    // 粮草
    if (w.upkeep0[human] > 0) {
      const net = w.foodIn[human] - w.foodOut[human];
      this.foodBox.hidden = false;
      this.foodBox.textContent = `粮草 ${Math.round(w.food[human])}（${net >= 0 ? '+' : ''}${Math.round(net)}/分）`;
      this.foodBox.className = `food${w.hunger[human] > 0.15 ? ' bad' : net < 0 ? ' warn' : ''}`;
      this.foodBox.title = `每分钟产 ${Math.round(w.foodIn[human])}、耗 ${Math.round(w.foodOut[human])}，粮仓上限 ${Math.round(w.foodCap[human])}`
        + (w.hunger[human] > 0.01 ? `\n断粮：士气 −${Math.round(w.hunger[human] * RULES.morale.hunger)}` : '');
    } else this.foodBox.hidden = true;
    // 士气
    const mor = Math.round(w.avgMorale[human]);
    const rout = w.routing[human];
    this.moraleBox.textContent = `士气 ${mor}${rout ? ` · 溃逃 ${rout}` : ''}`;
    this.moraleBox.className = `morale${mor < 40 ? ' bad' : mor < 55 ? ' warn' : ''}`;
    this.moraleBox.title = ['全军士气的加减项：', ...teamMoraleFactors(w, human).map(f => `${f.label} ${f.value > 0 ? '+' : ''}${f.value}`),
      '另受附近敌我兵力对比、伤亡、负伤影响'].join('\n');
    // 据点列表：正经据点一行一个，资源点挤成一排小牌子
    let html = '<h3>据点与援军</h3>';
    const order = w.sites.slice().sort((a, b) => (a.owner === human ? 0 : a.owner === 0 ? 1 : 2) - (b.owner === human ? 0 : b.owner === 0 ? 1 : 2));
    let chips = '';
    for (const s of order) {
      const info = SITE_INFO[s.type];
      if (s.gone) continue;
      const c = css(this.teamRgb[s.owner]);
      if (info.category === 'resource') {
        const towers = towerCount(w, s);
        chips += `<span class="chip${s.disabled ? ' off' : ''}" data-id="${s.id}" style="--c:${s.disabled ? '#555' : c}" title="${s.name}：${s.disabled ? '废墟' : s.owner === human ? '我方' : s.owner ? '敌占' : '中立'}`
          + `${towers ? `，箭塔 ${towers}` : ''}">${info.provides[0]}${towers ? `<i>${towers}</i>` : ''}`
          + `${s.cap > 0 && s.capTeam ? `<u style="width:${Math.round(s.cap * 100)}%;background:${css(this.teamRgb[s.capTeam])}"></u>` : ''}</span>`;
        continue;
      }
      let state: string;
      if (info.category === 'outpost') state = `<i>${s.owner === human ? '休整' : '敌方'}</i>`;
      else if (s.disabled) state = '<i>废墟 · 占领后修复</i>';
      else if (s.owner === human || (!w.humanTeam && s.owner)) {
        const sec = Math.max(0, Math.ceil(s.timer));
        const full = w.teamCount[s.owner] >= w.unitCap[s.owner];
        const food = w.upkeep0[s.owner] > 0 ? ` <i>粮 +${Math.round((info.food * w.upkeep0[s.owner]) / 100)}</i>` : '';
        state = (full ? '<i>兵力已满</i>' : `<b>${info.provides}</b> ${(sec / 60) | 0}:${String(sec % 60).padStart(2, '0')}`) + food;
      } else state = `<i>${s.owner ? '敌占' : '中立'}${SITE_CATEGORY_NAMES[info.category]} · ${info.provides}</i>`;
      const cap = s.cap > 0 && s.capTeam ? `<u style="width:${Math.round(s.cap * 100)}%;background:${css(this.teamRgb[s.capTeam])}"></u>` : '';
      html += `<div class="site" data-id="${s.id}"><span class="dot" style="background:${s.disabled ? '#555' : c}"></span><span class="nm">${s.name}${s.level ? ' <em>★</em>' : ''}</span>${state}${cap}</div>`;
    }
    if (chips) html += `<h3 class="sub">资源点</h3><div class="chips">${chips}</div>`;
    if (html !== this.sitesHtml) this.sitesBox.innerHTML = this.sitesHtml = html;
  }

  private portrait(defIdx: number, team: number): string {
    const key = defIdx * 4 + team;
    let url = this.portraits.get(key);
    if (!url) {
      url = unitPortrait(UNITS[defIdx].model, this.teamRgb[team], 44).toDataURL();
      this.portraits.set(key, url);
    }
    return url;
  }

  /** 左下角的升级按钮：只列出此刻点了就能生效的 */
  updateUpgrades(o: UpgradeOffers): void {
    const rows: string[] = [];
    if (o.sel) {
      rows.push(`<button data-up="sel" title="把所选部队升为高级形态：等级高的优先，同级的在各兵种之间轮流，直到升完或黄金用尽"><b>升级所选部队</b>`
        + `<i>${o.sel.count}${o.sel.count < o.sel.total ? ` / ${o.sel.total}` : ''} 人 · 金 ${Math.round(o.sel.cost)}</i></button>`);
    }
    if (o.all) rows.push(`<button data-up="all" class="gold" title="黄金足够：把屏幕内的己方部队全部升为高级形态"><b>部队全部升级</b><i>${o.all.count} 人 · 金 ${Math.round(o.all.cost)}</i></button>`);
    if (o.forts) rows.push(`<button data-up="forts" class="gold" title="石料足够：把屏幕内的己方城邦全部升级"><b>城邦全部升级</b><i>${o.forts.count} 座 · 石 ${o.forts.cost}</i></button>`);
    if (o.camps) rows.push(`<button data-up="camps" class="gold" title="木材足够：把屏幕内的己方营寨全部升级"><b>营寨全部升级</b><i>${o.camps.count} 座 · 木 ${o.camps.cost}</i></button>`);
    const key = rows.join('');
    if (key === this.upKey) return;
    this.upKey = key;
    this.upBar.innerHTML = key;
    this.upBar.style.display = key ? 'flex' : 'none';
  }

  /** 选中一个据点时：它的状况，以及能对它做的事（升级、建箭塔） */
  private siteDetail(s: Site): void {
    const w = this.world, human = w.humanTeam;
    const info = SITE_INFO[s.type];
    const mine = s.owner === human && !s.disabled;
    const mat = info.material, have = Math.floor(w.stock[mat][human] ?? 0);
    let alive = 0, total = 0, hp = 0, max = 0, shooters = 0;
    for (const id of s.buildings) {
      const b = w.buildings[id];
      if (b.extra && !b.alive) continue;
      total++;
      max += b.maxHp;
      if (!b.alive) continue;
      alive++;
      hp += b.hp;
      if (b.tower) shooters++;
    }
    const towers = towerCount(w, s);
    const yields: string[] = [];
    if (info.food && w.upkeep0[human] > 0) yields.push(`粮 +${Math.round((info.food * w.upkeep0[human]) / 100)}`);
    for (const k of RES_KINDS) {
      const v = info.yields?.[k];
      if (v) yields.push(`${RES_NAMES[k]} +${Math.round(k === 'gold' ? (v * w.armyBase[human]) / 100 : v)}`);
    }
    const E = RULES.economy;
    let btns = '';
    if (mine && info.upgradeCost > 0) {
      const ok = canUpgradeSite(s) && have >= info.upgradeCost;
      btns += s.level ? '<span class="done">★ 已升级</span>'
        : `<button data-act="upgrade" data-site="${s.id}"${ok ? '' : ' disabled'} title="建筑生命 ×${E.siteHp}、护甲 +${E.siteArmor}，箭塔伤害 ×${E.towerDmg}、射程 ×${E.towerRange}；主建筑也会放箭。被敌人占领后降回">`
          + `<b>升级</b><i>${RES_NAMES[mat]} ${info.upgradeCost}${ok ? '' : `（现有 ${have}）`}</i></button>`;
    }
    if (mine && s.slots.length) {
      const ok = towers < s.slots.length && w.stock.wood[human] >= E.towerCost;
      btns += towers >= s.slots.length ? `<span class="done">箭塔 ${towers} / ${s.slots.length}</span>`
        : `<button data-act="tower" data-site="${s.id}"${ok ? '' : ' disabled'} title="在固定的位置建一座箭塔（地上的黄圈）。敌人要把箭塔全部摧毁才能占领这里">`
          + `<b>建箭塔 ${towers} / ${s.slots.length}</b><i>木材 ${E.towerCost}${ok ? '' : `（现有 ${Math.floor(w.stock.wood[human])}）`}</i></button>`;
    }
    const who = s.disabled ? '废墟' : s.owner === human ? '我方' : s.owner ? '敌方' : '中立';
    const html = `
      <div class="sdetail">
        <div class="who"><b>${s.name}${s.level ? ' <em>★</em>' : ''}</b><span>${SITE_CATEGORY_NAMES[info.category]} · ${info.label}</span>
          <span class="own" style="--c:${css(this.teamRgb[s.disabled ? 0 : s.owner])}">${who}</span></div>
        <div class="rows">
          <div class="grid">
            <span>建筑</span><b>${alive} / ${total} 完好 · 生命 ${max ? Math.round((hp / max) * 100) : 0}%</b>
            <span>守备</span><b>${shooters ? `${shooters} 处放箭` : '不设防'}${s.type === SITE_HQ ? '' : info.captureTime > 0 ? ` · 占领需 ${info.captureTime} 秒` : ' · 不能占领，只能摧毁'}</b>
            <span>产出</span><b>${yields.length ? `${yields.join('　')} <i>每分钟</i>` : '—'}</b>
            <span>${info.reinf ? '援军' : '用途'}</span><b>${info.reinf ? `${info.provides} · 每 ${info.interval} 秒` : info.haven ? '部队在此休整回血' : `采集${info.provides}`}</b>
          </div>
          ${info.upgradeCost > 0 && !mine ? '<div class="dim">占领后可以升级</div>' : ''}
        </div>
        ${btns ? `<div class="acts">${btns}</div>` : ''}
      </div>`;
    if (html === this.selKey) return;
    this.selKey = html;
    this.selBox.innerHTML = html;
  }

  /** 只选中一个单位时：列出它此刻的全部数值（含等级加成）与状态 */
  private unitDetail(s: number): void {
    const w = this.world;
    const d = UNITS[w.type[s]];
    const lv = w.level[s], max = LEVELS.thresholds.length;
    const st = w.state[s];
    const key = `one:${s}:${w.uid[s]}:${lv}:${Math.round(w.hp[s])}:${Math.round(w.xp[s])}:${Math.round(w.morale[s])}:${st}`;
    if (key === this.selKey) return;
    this.selKey = key;
    const pct = (v: number): string => (lv > 0 ? ` <i>+${Math.round(v * lv * 100)}%</i>` : '');
    const num = (v: number): string => String(Math.round(v * 10) / 10);
    const next = lv + 1 < max ? LEVELS.thresholds[lv + 1] : 0;
    const base = LEVELS.thresholds[lv];
    const xpPct = next ? Math.round(((w.xp[s] - base) / (next - base)) * 100) : 100;
    const routAt = d.lvRout[lv];
    const m = Math.round(w.morale[s]);
    const flags: string[] = [st & S_COMBAT ? '战斗' : '行军'];
    if (st & S_CHARGE) flags.push('冲锋');
    if (st & S_BRACE) flags.push('立枪');
    if (st & S_SHIELD) flags.push('举盾');
    if (st & S_WALL) flags.push('城墙上');
    if (st & S_TORCH) flags.push('火把');
    const ab = d.abilities;
    const perks: string[] = [];
    if (ab.charge) perks.push(`冲锋 ${ab.charge.impact}`);
    if (ab.brace) perks.push(`拒马 ${ab.brace.dmg}`);
    if (ab.shield) perks.push(`举盾 −${Math.round(ab.shield.block * 100)}%`);
    if (d.mobile) perks.push('可边走边打');
    if (d.siege) perks.push('可破城墙');
    if (d.aux) perks.push(`副武器 ${d.aux.dmg}/${d.aux.range}`);
    this.selBox.innerHTML = `
      <div class="udetail" title="${unitTip(d).replace(/"/g, '&quot;')}">
        <div class="who">
          <img src="${this.portrait(d.idx, w.humanTeam)}" draggable="false">
          <b>${d.name}</b>
          <span>${CLASS_NAMES[d.cls]} · ${SIZES[d.size].name}</span>
          <span class="${d.tier ? 'elite' : ''}">${d.tier ? '高级形态' : `初级 · 升级需 ${unitUpgradeCost(d)} 金`}</span>
        </div>
        <div class="rows">
          <div class="lvrow"><b>等级 ${lv + 1} / ${max}</b> ${LEVELS.names[lv]}
            <span class="pips">${'◆'.repeat(lv + 1)}<i>${'◇'.repeat(max - lv - 1)}</i></span>
            <span class="xp" title="击杀得全额经验，助攻得 ${Math.round(RULES.xp.assist * 100)}%"><u style="width:${xpPct}%"></u></span>
            <span class="dim">${next ? `经验 ${Math.round(w.xp[s])} / ${next}` : '已满级'}</span></div>
          <div class="grid">
            <span>生命</span><b>${Math.round(w.hp[s])} / ${Math.round(w.maxHp[s])}${pct(LEVELS.hp)}</b>
            <span>攻击</span><b>${num(d.lvDmg[lv])}${d.splash ? '（范围）' : ''}${pct(LEVELS.dmg)}</b>
            <span>间隔</span><b>${num(d.lvCd[lv])} 秒${lv > 0 ? ` <i>−${Math.round(LEVELS.cd * lv * 100)}%</i>` : ''}</b>
            <span>射程</span><b>${d.range ? d.range : '近战'}</b>
            <span>护甲</span><b>近 ${num(d.lvArmM[lv])} · 远 ${num(d.lvArmP[lv])}${lv > 0 ? ` <i>+${num(LEVELS.armor * lv)}</i>` : ''}</b>
            <span>速度</span><b>行军 ${d.walk} · 奔跑 ${d.speed}</b>
            <span>士气</span><b class="${routAt >= 0 && m < routAt + 12 ? 'bad' : m < 55 ? 'warn' : ''}">${m} <i>${routAt < 0 ? '死战不退' : `低于 ${routAt} 溃逃`}</i></b>
            <span>状态</span><b>${flags.join(' · ')}</b>
          </div>
          ${perks.length ? `<div class="dim">${perks.join('　')}</div>` : ''}
        </div>
      </div>`;
  }

  /** @param site 没选部队时选中的据点（-1 = 没有） */
  updateSelection(sel: number[], site = -1): void {
    const w = this.world;
    if (!sel.length && site >= 0 && !w.sites[site].gone) {
      this.siteDetail(w.sites[site]);
      return;
    }
    if (sel.length === 1 && w.alive[sel[0]]) {
      this.unitDetail(sel[0]);
      return;
    }
    const count = new Map<number, { n: number; hp: number; lv: number; top: number; morale: number }>();
    let moraleSum = 0;
    for (const s of sel) {
      const t = w.type[s];
      let e = count.get(t);
      if (!e) count.set(t, (e = { n: 0, hp: 0, lv: 0, top: 0, morale: 0 }));
      e.n++;
      e.hp += w.hp[s] / w.maxHp[s];
      e.lv += w.level[s];
      if (w.level[s] > e.top) e.top = w.level[s];
      e.morale += w.morale[s];
      moraleSum += w.morale[s];
    }
    let key = `${Math.round(moraleSum / (sel.length || 1) / 4)}|`;
    for (const [t, e] of count) key += `${t}:${e.n}:${Math.round((e.hp / e.n) * 20)}:${Math.round((e.lv / e.n) * 4)}:${e.top},`;
    if (key === this.selKey) return;
    this.selKey = key;
    if (!sel.length) {
      this.selBox.innerHTML = w.humanTeam
        ? '<div class="hint">拖框选择部队 · 右键移动或攻击 · <b>F</b> 攻击移动 · 点据点可升级</div>'
        : '<div class="hint">观战模式：方向键 / 拖动小地图移动镜头，滚轮缩放</div>';
      return;
    }
    const mAvg = Math.round(moraleSum / sel.length);
    this.selBox.innerHTML = `<div class="total">已选 <b>${sel.length}</b><span class="${mAvg < 40 ? 'bad' : mAvg < 55 ? 'warn' : ''}">士气 ${mAvg}</span></div>`;
    const types = [...count.keys()].sort((a, b) => UNITS[a].row - UNITS[b].row || a - b);
    for (const t of types) {
      const e = count.get(t)!;
      const d = UNITS[t];
      const card = el('div', `ucard${d.tier ? ' elite' : ''}`, `
        <img src="${this.portrait(t, w.humanTeam)}" draggable="false">
        <span class="n">${e.n}</span>
        <span class="nm">${d.name}</span>
        <span class="lv" title="平均等级（最高 ${LEVELS.thresholds.length} 级）">Lv${Math.round(e.lv / e.n) + 1}</span>
        <span class="hp"><u style="width:${Math.round((e.hp / e.n) * 100)}%"></u></span>`);
      const routAt = d.lvRout[Math.round(e.lv / e.n)];
      card.title = `${unitTip(d)}\n—\n平均等级 ${Math.round(e.lv / e.n) + 1}（${LEVELS.names[Math.round(e.lv / e.n)]}），最高 ${e.top + 1} 级，满级 ${LEVELS.thresholds.length} 级　士气 ${Math.round(e.morale / e.n)}`
        + `　${routAt < 0 ? '死战不退' : `低于 ${routAt} 溃逃`}`;
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
          <tr><td>其中逃散</td><td>${w.deserted[human]}</td><td>${w.deserted[other]}</td></tr>
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
