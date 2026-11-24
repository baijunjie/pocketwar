/** 游戏内界面：顶栏、据点与援军、选中面板、指令按钮、战报、帮助与结算 */
import {
  CLASS_NAMES, ELITE, FactionDef, LEVELS, RES_KINDS, RES_NAMES, RES_SHORT, RULES, ResKind, SITE_CATEGORY_NAMES, SITE_HQ, SITE_INFO, SIZES, UNITS,
  UnitDef,
} from '../sim/defs';
import { canUpgradeSite, towerCount, unitUpgradeCost } from '../sim/systems/economy';
import { teamMoraleFactors } from '../sim/systems/morale';
import { fightState } from '../sim/systems/sites';
import { S_BRACE, S_CHARGE, S_COMBAT, S_SHIELD, S_TORCH, S_WALL, Site, World } from '../sim/world';
import { unitPortrait } from '../render/portrait';

/** 此刻可以点的升级：所选部队、屏幕内全部部队、屏幕内全部城邦 / 营寨（null = 不显示这个按钮） */
export interface UpgradeOffers {
  /** 所选部队：黄金够升其中几人、要花多少 */
  sel: { count: number; cost: number; total: number } | null;
  /** 全图的己方部队 / 城邦 / 营寨：资源够升其中几个、要花多少、一共还有几个能升 */
  all: { count: number; cost: number; total: number } | null;
  forts: { count: number; cost: number; total: number } | null;
  camps: { count: number; cost: number; total: number } | null;
}
export type UpgradeAction = 'sel' | 'all' | 'forts' | 'camps';

export interface HudCallbacks {
  command(cmd: 'amove' | 'stop' | 'hold' | 'rally' | 'unrally' | 'all' | 'torch' | 'outpost' | 'follow'): void;
  /** 点了某个升级按钮 */
  upgrade(act: UpgradeAction): void;
  /** 选中一个据点（-1 = 取消） */
  selectSite(id: number): void;
  /** 对选中的据点：升级 / 建一座箭塔 */
  siteAction(act: 'upgrade' | 'tower', id: number): void;
  /**
   * 兵种栏里点选 / 框选卡片：replace = 改选屏幕内这些兵种；add = 加选；toggle = 这个兵种选着就去掉、没选就加上；
   * map = 选中全图的这个兵种（双击卡片）
   */
  pickTypes(types: number[], mode: 'replace' | 'add' | 'toggle' | 'map'): void;
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
  /** 风向标：箭头指向风吹去的方向（随镜头旋转），无风时隐藏 */
  private readonly windBox: HTMLSpanElement;
  private readonly windArrow: HTMLElement;
  private windDeg = NaN;
  private readonly sitesBox: HTMLDivElement;
  /** 选中单个单位 / 据点时的详情（兵种栏上方） */
  private readonly selBox: HTMLDivElement;
  /** 兵种栏：屏幕内每个己方兵种一张卡片 */
  private readonly roster: HTMLDivElement;
  private rosterKey = '?';
  private readonly boxEl: HTMLDivElement;
  /** 正在兵种栏里拖框（拖动期间不重建卡片） */
  private dragging = false;
  private readonly cmdBtns = new Map<string, HTMLButtonElement>();
  /** 镜头正在跟随部队：「跟随」按钮高亮，没选部队时也能点它取消 */
  following = false;
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
  /** 指令面板里的「升级」一栏 */
  private readonly upBar: HTMLDivElement;
  private readonly upHead: HTMLElement;
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
    this.windBox = el('span', 'wind', '<i>➤</i><b></b>');
    this.windArrow = this.windBox.firstElementChild as HTMLElement;
    this.foodBox = el('span', 'food');
    this.moraleBox = el('span', 'morale');
    this.resBox = el('span', 'res');
    top.append(this.counts, this.clock, this.envBox, this.windBox, this.foodBox, this.resBox, this.moraleBox, this.dbg);
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
    // 右侧一列：上面据点列表（占满剩下的高度），下面指令面板
    const right = el('div', 'rightcol');
    right.appendChild(this.sitesBox);
    root.appendChild(right);

    // ---- 小地图 ----
    const mm = el('div', 'panel mini');
    this.minimap = el('canvas');
    mm.appendChild(this.minimap);
    root.appendChild(mm);

    // ---- 底部中央：上面是详情（选中单个单位 / 据点时），下面是兵种栏 ----
    const bottom = el('div', 'bottom');
    this.selBox = el('div', 'panel detail');
    this.selBox.hidden = true;
    // 面板内容会被定时重建，按钮用事件委托
    this.selBox.addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
      if (b && !b.disabled) cb.siteAction(b.dataset.act as 'upgrade' | 'tower', Number(b.dataset.site));
    });
    this.roster = el('div', 'panel unitbar');
    this.boxEl = el('div', 'rbox');
    this.boxEl.hidden = true;
    this.bindRoster();
    bottom.append(this.selBox, this.roster);
    root.appendChild(bottom);

    // ---- 右下：指令面板，分「部队」「援军」「升级」三栏 ----
    const cmds = el('div', 'panel cmds');
    const btn = (name: string, key: string, cmd: Parameters<HudCallbacks['command']>[0], tip: string): HTMLButtonElement => {
      const b = el('button', '', `<b>${name}</b><i>${key}</i>`);
      b.title = tip;
      b.onclick = () => cb.command(cmd);
      this.cmdBtns.set(cmd, b);
      return b;
    };
    const section = (title: string, ...items: HTMLElement[]): HTMLDivElement => {
      const sec = el('div', 'csec');
      sec.append(el('h3', '', title), ...items);
      return sec;
    };
    if (human) {
      const unit = el('div', 'cgrid');
      unit.append(
        btn('攻击移动', 'F', 'amove', '行军途中遇敌即战、见敌方建筑就打'),
        btn('停止', 'X', 'stop', '停止当前行动'),
        btn('坚守', 'H', 'hold', '原地坚守，不追击'),
        btn('火把', 'T', 'torch', '点燃 / 熄灭所选部队的火把：点着看得远，也更容易被发现'),
        btn('扎营', 'B', 'outpost', `派所选部队到指定位置搭一座临时据点（木材 ${RULES.economy.outpostCost}，最多 ${RULES.economy.outpostMax} 座）：部队在里面休整回血，被毁不会重生`),
        btn('跟随', 'C', 'follow', '镜头平滑地跟着所选部队走；再按一次、或手动移动镜头即取消'),
        btn('全军', 'Ctrl+A', 'all', '选中全图的全部部队'),
      );
      const reinf = el('div', 'cgrid');
      reinf.append(
        btn('集结点', 'R', 'rally', '设置援军集结点：之后各据点新出的援军自动开赴那里（已经出来的部队不受影响）'),
        btn('取消集结', '⇧R', 'unrally', '取消集结点：之后各据点新出的援军留在自己的据点里驻守'),
      );
      this.upBar = el('div', 'upbar');
      this.upBar.onclick = e => {
        const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-up]');
        if (b) cb.upgrade(b.dataset.up as UpgradeAction);
      };
      const up = section('升级', this.upBar);
      this.upHead = up;
      up.hidden = true;
      cmds.append(section('部队', unit), section('援军', reinf), up);
    } else {
      this.upBar = el('div');
      this.upHead = this.upBar;
      cmds.appendChild(el('div', 'hint', '观战模式'));
    }
    right.appendChild(cmds);

    this.feed = el('div', 'feed');
    this.modeTip = el('div', 'modetip');
    root.append(this.feed, this.modeTip);

    // ---- 帮助 ----
    this.help = el('div', 'overlay help', `
      <div class="panel card">
        <h2>操作说明</h2>
        <table>
          <tr><td>左键点击 / 拖框</td><td>选择部队（Shift 加选，双击选中同类）</td></tr>
          <tr><td>底部兵种卡片</td><td>卡片上的数字是屏幕内的人数。点击：选中屏幕内这个兵种；在卡片上拖框：一次选几个兵种（框住全部即选中屏幕内所有部队）；Shift 加选 / 去掉；双击：选中全图的这个兵种。选中的兵种卡片会上前一步</td></tr>
          <tr><td>右键地面</td><td>移动（编队行军，自动列阵：近战在前、远程居后、器械殿后）</td></tr>
          <tr><td>右键按住拖动</td><td>在按下处列阵，面朝拖动的方向（原地拖动即原地转向重排）</td></tr>
          <tr><td>右键敌军 / 敌方建筑</td><td>攻击（Ctrl+右键可强攻中立建筑；带着器械时，中立的城墙、门楼、角楼直接右键就砸）</td></tr>
          <tr><td>F + 左键</td><td>攻击移动：沿途遇敌即战、见敌方建筑就打，遇墙自动破城；点在敌方建筑上则直接攻打它</td></tr>
          <tr><td>X / H</td><td>停止 / 坚守</td></tr>
          <tr><td>R + 左键</td><td>设置援军集结点（只对之后新出的援军有效）</td></tr>
          <tr><td>Shift + R</td><td>取消集结点：新出的援军留在各自的据点</td></tr>
          <tr><td>T</td><td>点燃 / 熄灭所选部队的火把（夜间）</td></tr>
          <tr><td>B + 左键</td><td>扎营：派所选部队去搭一座临时据点（耗木材）</td></tr>
          <tr><td>左键点据点</td><td>选中据点：升级，或给资源点、村庄建箭塔</td></tr>
          <tr><td>Ctrl 或 Alt+数字 / 数字</td><td>编队 / 选中编队（连按两次跳转镜头）</td></tr>
          <tr><td>Shift+数字</td><td>追加编队：把当前选中的部队并入该队</td></tr>
          <tr><td>鼠标移到屏幕边缘、W A S D / 方向键、小地图</td><td>移动镜头（越靠边越快）；滚轮缩放</td></tr>
          <tr><td>C</td><td>镜头跟随所选部队（平滑跟着部队走）；再按一次、或手动移动镜头即取消</td></tr>
          <tr><td>中键拖动、Q / E</td><td>旋转镜头（上下拖动调俯角）；Shift+中键拖动平移；Home 复位</td></tr>
          <tr><td>空格 / + −　M</td><td>暂停 / 调整速度　开关音效</td></tr>
        </table>
        <p><b>目标：</b>摧毁敌方大本营的主堡。<b>占领据点：</b>敌占的城邦、营寨要先拆毁主建筑；再肃清圈内守军，派人站到中央旗帜下读秒；敌人回到圈内读秒暂停，旗下没人则清零。占领后据点定时出援军（设了集结点就开赴集结点，没设就留在据点里），被毁的建筑也会修好。</p>
        <p><b>攻坚：</b>士兵和骑兵打建筑是扔火把——营寨的木栅一烧就垮，城邦的石墙只有器械与战象能破（门楼、角楼可以慢慢烧毁，它们和营寨的望楼都会放箭）。在自家城邦里待命的远程步兵会自动登城驻守（每格墙顶三人），看到射程外的敌人会沿墙顶挪过去；在墙上射得更远、挨箭更轻（下别的命令即下墙）；别的兵种上不了墙，据点里的近战守军不出城，挨了敌方远程的打才出击。</p>
        <p>高地上的远程部队射程与伤害更高；森林减免远程伤害并拖慢骑兵；浅滩可涉水但行动迟缓。</p>
        <p><b>士气：</b>敌众我寡、伤亡惨重、断粮、淋雨都会压低士气，士气见底的部队会溃逃（头顶一面小白旗，防御大减），逃回最近的己方据点才恢复指挥。老兵更不容易溃逃。</p>
        <p><b>粮草：</b>据点产粮、部队吃粮，只靠大本营养不活全军。<b>昼夜：</b>夜里视野缩小，火把能照远但会暴露自己；下雨时火把点不着、行军变慢。偶尔下雪：走得更慢、看得更近，据点外的部队防御下降。</p>
        <p><b>资源点：</b>农庄、伐木场、采石场、金矿，站到旗下几秒就占领，之后自动采集。<b>黄金</b>把部队升为重甲的高级形态（选中面板旁的升级按钮，老兵优先）；<b>石料</b>升级城邦、<b>木材</b>升级营寨（选中据点后点升级），手里有料时建筑也修得更快；木材还能给资源点和村庄建箭塔（最多 4 座，敌人得先拆光才能占领）、让部队扎营。</p>
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
  /** 每帧：把风向换算到屏幕上（镜头转了 yaw，世界方位角 a 在屏幕上是 a + yaw） */
  setWindView(yaw: number): void {
    const deg = Math.round(((this.world.env.windDir + yaw) * 180) / Math.PI);
    if (deg === this.windDeg) return;
    this.windDeg = deg;
    this.windArrow.style.transform = `rotate(${deg}deg)`;
  }

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
    // 风
    const wk = env.wind;
    this.windBox.style.display = wk > 0.02 ? '' : 'none';
    if (wk > 0.02) {
      const pct = Math.round(wk * E.windSpeed * 100);
      (this.windBox.lastElementChild as HTMLElement).textContent = wk < 0.45 ? '微风' : wk < 0.75 ? '大风' : '狂风';
      this.windBox.title = `风向：箭头指向风吹去的方向（随镜头转动）\n顺风行军快 ${pct}%，顶风慢 ${pct}%，侧风不受影响`;
    }
    // 木材、石料、黄金
    const use: Record<ResKind, string> = {
      wood: `升级营寨、给资源点和村庄建箭塔（${RULES.economy.towerCost}）、扎营（${RULES.economy.outpostCost}）；有木材时营寨的建筑修得更快`,
      stone: '升级城邦；有石料时城邦的建筑修得更快',
      gold: `把部队升为高级形态（每份口粮 ${RULES.economy.unitGold}）`,
    };
    this.resBox.innerHTML = RES_KINDS.map(k => `<span class="r-${k}" title="${RES_NAMES[k]}：每分钟 +${Math.round(w.income[k][human])}\n${use[k]}">`
      + `${RES_SHORT[k]} <b>${Math.floor(w.stock[k][human])}</b></span>`).join('');
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
        const short = info.yields ? RES_SHORT[Object.keys(info.yields)[0] as ResKind] : info.provides[0];
        chips += `<span class="chip${s.disabled ? ' off' : ''}" data-id="${s.id}" style="--c:${s.disabled ? '#555' : c}" title="${s.name}：${s.disabled ? '废墟' : s.owner === human ? '我方' : s.owner ? '敌占' : '中立'}`
          + `${towers ? `，箭塔 ${towers}` : ''}">${short}${towers ? `<i>${towers}</i>` : ''}`
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

  /** 指令面板里的升级按钮：只列出此刻点了就能生效的 */
  updateUpgrades(o: UpgradeOffers): void {
    const rows: string[] = [];
    if (o.sel) {
      rows.push(`<button data-up="sel" title="把所选部队升为高级形态：等级高的优先，同级的在各兵种之间轮流，直到升完或黄金用尽"><b>升级所选部队</b>`
        + `<i>${o.sel.count}${o.sel.count < o.sel.total ? ` / ${o.sel.total}` : ''} 人 · 金 ${Math.round(o.sel.cost)}</i></button>`);
    }
    const part = (v: { count: number; total: number }): string => `${v.count}${v.count < v.total ? ` / ${v.total}` : ''}`;
    if (o.all) rows.push(`<button data-up="all" class="gold" title="把全图的己方部队升为高级形态：等级高的优先，直到升完或黄金用尽"><b>部队全部升级</b><i>${part(o.all)} 人 · 金 ${Math.round(o.all.cost)}</i></button>`);
    if (o.forts) rows.push(`<button data-up="forts" class="gold" title="把全图的己方城邦升级（石料不够时先升离镜头近的）"><b>城邦全部升级</b><i>${part(o.forts)} 座 · 石 ${o.forts.cost}</i></button>`);
    if (o.camps) rows.push(`<button data-up="camps" class="gold" title="把全图的己方营寨升级（木材不够时先升离镜头近的）"><b>营寨全部升级</b><i>${part(o.camps)} 座 · 木 ${o.camps.cost}</i></button>`);
    const key = rows.join('');
    if (key === this.upKey) return;
    this.upKey = key;
    this.upBar.innerHTML = key;
    this.upHead.hidden = !key;
  }

  /** 选中一个据点时：它的状况，以及能对它做的事（升级、建箭塔） */
  private siteDetail(s: Site): void {
    const w = this.world, human = w.humanTeam;
    const info = SITE_INFO[s.type];
    const mine = s.owner === human && !s.disabled;
    const mat = info.material, have = Math.floor(w.stock[mat][human] ?? 0);
    let alive = 0, total = 0, hp = 0, max = 0, shooters = 0, down = 0;
    for (const id of s.buildings) {
      const b = w.buildings[id];
      if (b.extra && !b.alive) continue;
      total++;
      max += b.maxHp;
      if (!b.alive) continue;
      alive++;
      hp += b.hp;
      if (b.down) down++;
      else if (b.tower) shooters++;
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
            <span>状态</span><b>${this.siteFight(s)}</b>
            <span>建筑</span><b>${alive - down} / ${total} 完好${down ? ` · ${down} 座重建中` : ''} · 生命 ${max ? Math.round((hp / max) * 100) : 0}%</b>
            <span>守备</span><b>${shooters ? `${shooters} 处放箭` : '不设防'}${s.type === SITE_HQ ? '' : info.captureTime > 0 ? ` · 占领需 ${info.captureTime} 秒` : ' · 不能占领，只能摧毁'}</b>
            <span>产出</span><b>${yields.length ? `${yields.join('　')} <i>每分钟</i>` : '—'}</b>
            <span>${info.reinf ? '援军' : '用途'}</span><b>${info.reinf ? `${info.provides} · 每 ${info.interval} 秒` : info.haven ? '部队在此休整回血' : `采集${info.provides}`}</b>
          </div>
          ${info.razeFirst && s.owner !== 0 && s.owner !== human && !s.disabled ? '<div class="dim">要先拆毁主建筑才能占领</div>' : ''}
          ${info.upgradeCost > 0 && !mine ? '<div class="dim">占领后可以升级</div>' : ''}
        </div>
        ${btns ? `<div class="acts">${btns}</div>` : ''}
      </div>`;
    if (html === this.selKey) return;
    this.selKey = html;
    this.selBox.innerHTML = html;
  }

  /** 据点此刻是否在交战，以及为什么（交战中不修建筑、不回血） */
  private siteFight(s: Site): string {
    if (!s.owner || s.disabled) return '<i>无人驻守</i>';
    const f = fightState(this.world, s);
    if (!f.fighting) return '平静 <i>建筑自修、部队休整</i>';
    const why: string[] = [];
    if (f.foes) why.push(`圈内有 ${f.foes} 名敌兵`);
    if (f.calmIn > 0) why.push(`建筑 ${Math.round(f.hitAgo)} 秒前挨打`);
    const tail = f.calmIn > 0 ? `，${Math.ceil(f.calmIn)} 秒后平静` : f.foes ? '，敌兵离开后平静' : '';
    return `<span class="warn">交战中</span> <i>${why.join('、')}${tail}</i>`;
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
    const pct = (v: number): string => (lv > 0 && v ? ` <i>+${Math.round(v * lv * 100)}%</i>` : '');
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
            <span>间隔</span><b>${num(d.lvCd[lv])} 秒${lv > 0 && LEVELS.cd ? ` <i>−${Math.round(LEVELS.cd * lv * 100)}%</i>` : ''}</b>
            <span>射程</span><b>${d.range ? d.range : '近战'}</b>
            <span>护甲</span><b>近 ${num(d.lvArmM[lv])} · 远 ${num(d.lvArmP[lv])}${lv > 0 && LEVELS.armor ? ` <i>+${num(LEVELS.armor * lv)}</i>` : ''}</b>
            <span>防御</span><b>×${num(1 + LEVELS.def * lv)}${lv > 0 ? ' <i>受到的伤害按此折算</i>' : ''}</b>
            <span>速度</span><b>行军 ${d.walk} · 奔跑 ${d.speed}</b>
            <span>士气</span><b class="${routAt >= 0 && m < routAt + 12 ? 'bad' : m < 55 ? 'warn' : ''}">${m} <i>${routAt < 0 ? '死战不退' : `低于 ${routAt} 溃逃`}</i></b>
            <span>状态</span><b>${flags.join(' · ')}</b>
          </div>
          ${perks.length ? `<div class="dim">${perks.join('　')}</div>` : ''}
        </div>
      </div>`;
  }

  /**
   * @param site 没选部队时选中的据点（-1 = 没有）
   * @param screen 屏幕内的己方单位（兵种栏按它数每个兵种的数量）
   */
  updateSelection(sel: number[], site = -1, screen: number[] = []): void {
    const w = this.world;
    // ---- 详情：选中单个单位，或没选部队而选着据点 ----
    if (!sel.length && site >= 0 && !w.sites[site].gone) {
      this.selBox.hidden = false;
      this.siteDetail(w.sites[site]);
    } else if (sel.length === 1 && w.alive[sel[0]]) {
      this.selBox.hidden = false;
      this.unitDetail(sel[0]);
    } else if (!this.selBox.hidden) {
      this.selBox.hidden = true;
      this.selKey = '?';
    }
    // ---- 指令按钮：没选部队时部队指令不可用；没设集结点时「取消集结」不可用 ----
    for (const [cmd, b] of this.cmdBtns) {
      const off = cmd === 'unrally' ? !w.rally[w.humanTeam] : cmd === 'follow' ? !sel.length && !this.following
        : cmd !== 'all' && cmd !== 'rally' && !sel.length;
      if (b.disabled !== off) b.disabled = off;
      if (cmd === 'follow') b.classList.toggle('on', this.following);
    }
    if (!this.dragging) this.renderRoster(sel, screen);
  }

  /** 兵种栏：屏幕内（以及已选中）的每个己方兵种一张卡片；选中的兵种卡片上前一步 */
  private renderRoster(sel: number[], screen: number[]): void {
    const w = this.world;
    interface Row { scr: number; n: number; hp: number; lv: number; top: number; morale: number }
    const rows = new Map<number, Row>();
    const row = (t: number): Row => {
      let r = rows.get(t);
      if (!r) rows.set(t, (r = { scr: 0, n: 0, hp: 0, lv: 0, top: 0, morale: 0 }));
      return r;
    };
    for (const s of screen) row(w.type[s]).scr++;
    let moraleSum = 0;
    for (const s of sel) {
      const r = row(w.type[s]);
      r.n++;
      r.hp += w.hp[s] / w.maxHp[s];
      r.lv += w.level[s];
      if (w.level[s] > r.top) r.top = w.level[s];
      r.morale += w.morale[s];
      moraleSum += w.morale[s];
    }
    // 没选中的兵种，等级与血量按屏幕内的人算
    for (const s of screen) {
      const r = rows.get(w.type[s])!;
      if (r.n) continue;
      r.hp += w.hp[s] / w.maxHp[s];
      r.lv += w.level[s];
      if (w.level[s] > r.top) r.top = w.level[s];
      r.morale += w.morale[s];
    }
    const types = [...rows.keys()].sort((a, b) => UNITS[a].row - UNITS[b].row || a - b);
    const mAvg = sel.length ? Math.round(moraleSum / sel.length) : 0;
    let key = `${w.humanTeam}|${sel.length}|${screen.length}|${Math.round(mAvg / 4)}|`;
    for (const t of types) {
      const r = rows.get(t)!, k = r.n || r.scr;
      key += `${t}:${r.scr}:${r.n}:${Math.round((r.hp / k) * 20)}:${Math.round((r.lv / k) * 4)}:${r.top},`;
    }
    if (key === this.rosterKey) return;
    this.rosterKey = key;
    if (!w.humanTeam) {
      this.roster.innerHTML = '<div class="hint">观战模式：方向键 / 拖动小地图移动镜头，滚轮缩放</div>';
      return;
    }
    if (!types.length) {
      this.roster.innerHTML = '<div class="hint">屏幕内没有我方部队 · 拖框选择部队 · 右键移动或攻击 · 点据点可升级</div>';
      return;
    }
    const head = sel.length
      ? `<div class="total">已选 <b>${sel.length}</b><span class="${mAvg < 40 ? 'bad' : mAvg < 55 ? 'warn' : ''}">士气 ${mAvg}</span></div>`
      : `<div class="total">屏幕内 <b>${screen.length}</b><span>点卡片选择</span></div>`;
    let html = head;
    for (const t of types) {
      const r = rows.get(t)!, d = UNITS[t], k = r.n || r.scr;
      const lv = Math.round(r.lv / k);
      const routAt = d.lvRout[lv];
      const tip = `${unitTip(d)}\n—\n屏幕内 ${r.scr} 人${r.n ? `，已选 ${r.n} 人` : ''}　平均等级 ${lv + 1}（${LEVELS.names[lv]}），最高 ${r.top + 1} 级`
        + `　士气 ${Math.round(r.morale / k)}　${routAt < 0 ? '死战不退' : `低于 ${routAt} 溃逃`}`
        + '\n—\n点击：选中屏幕内的这个兵种　Shift+点击：加选 / 去掉　双击：选中全图的这个兵种　在卡片上拖框：一次选几个兵种';
      html += `<div class="ucard${d.tier ? ' elite' : ''}${r.n ? ' on' : ''}" data-t="${t}" title="${tip.replace(/"/g, '&quot;')}">
        <img src="${this.portrait(t, w.humanTeam)}" draggable="false">
        <span class="n">${r.scr}</span>
        <span class="nm">${d.name}</span>
        <span class="lv">Lv${lv + 1}</span>
        <span class="hp"><u style="width:${Math.round((r.hp / k) * 100)}%"></u></span>
        ${r.n ? `<span class="sel">选 ${r.n}</span>` : ''}</div>`;
    }
    this.roster.innerHTML = html;
  }

  /** 兵种栏的点选、双击、拖框 */
  private bindRoster(): void {
    const R = this.roster, box = this.boxEl;
    this.root.appendChild(box);
    let sx = 0, sy = 0, add = false, down = false, last = { t: 0, type: -1 };
    const hits = (ex: number, ey: number): HTMLElement[] => {
      const ax = Math.min(sx, ex), ay = Math.min(sy, ey), bx = Math.max(sx, ex), by = Math.max(sy, ey);
      return [...R.querySelectorAll<HTMLElement>('.ucard')].filter(c => {
        const r = c.getBoundingClientRect();
        return r.right >= ax && r.left <= bx && r.bottom >= ay && r.top <= by;
      });
    };
    R.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      down = true;
      sx = e.clientX;
      sy = e.clientY;
      add = e.shiftKey || e.ctrlKey || e.metaKey;
      R.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    R.addEventListener('pointermove', e => {
      if (!down) return;
      if (!this.dragging && Math.hypot(e.clientX - sx, e.clientY - sy) < 5) return;
      this.dragging = true;
      box.hidden = false;
      box.style.left = `${Math.min(sx, e.clientX)}px`;
      box.style.top = `${Math.min(sy, e.clientY)}px`;
      box.style.width = `${Math.abs(e.clientX - sx)}px`;
      box.style.height = `${Math.abs(e.clientY - sy)}px`;
      const hot = new Set(hits(e.clientX, e.clientY));
      for (const c of R.querySelectorAll<HTMLElement>('.ucard')) c.classList.toggle('hot', hot.has(c));
    });
    const end = (e: PointerEvent, cancel: boolean): void => {
      if (!down) return;
      down = false;
      if (R.hasPointerCapture(e.pointerId)) R.releasePointerCapture(e.pointerId);
      if (this.dragging) {
        this.dragging = false;
        box.hidden = true;
        const types = cancel ? [] : hits(e.clientX, e.clientY).map(c => Number(c.dataset.t));
        this.rosterKey = '?';
        if (types.length) this.cb.pickTypes(types, add ? 'add' : 'replace');
        else for (const c of R.querySelectorAll<HTMLElement>('.ucard')) c.classList.remove('hot');
        return;
      }
      if (cancel) return;
      const card = (document.elementFromPoint(sx, sy) as HTMLElement | null)?.closest<HTMLElement>('.ucard');
      if (!card) return;
      const t = Number(card.dataset.t), now = performance.now();
      if (last.type === t && now - last.t < 350) {
        this.cb.pickTypes([t], 'map');
        last = { t: 0, type: -1 };
      } else {
        this.cb.pickTypes([t], add ? 'toggle' : 'replace');
        last = { t: now, type: t };
      }
    };
    R.addEventListener('pointerup', e => end(e, false));
    R.addEventListener('pointercancel', e => end(e, true));
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
