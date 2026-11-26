/** 主菜单：选择阵营、对手与对局设置 */
import { FACTIONS, FACTION_IDS, FactionId, UNIT_BY_KEY } from '../sim/defs';
import { GameOptions, MENU_SIZES } from '../sim/setup';
import { unitPortrait } from '../render/portrait';
import { unitTip } from './unitText';

interface Saved {
  faction: FactionId;
  enemy: FactionId | 'random';
  size: number;
  difficulty: number;
  fog: boolean;
  spectate: boolean;
}

const KEY = 'fengyan.menu';

function load(): Saved {
  const def: Saved = { faction: 'china', enemy: 'random', size: 850, difficulty: 1, fog: true, spectate: false };
  try {
    const st: Saved = { ...def, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Saved>) };
    // 存档里不是现有档位的（改档位之前存的 300、600、1000、1500），按同一档换过来
    if (!MENU_SIZES.includes(st.size)) st.size = MENU_SIZES[[300, 600, 1000, 1500].indexOf(st.size)] ?? def.size;
    return st;
  } catch {
    return def;
  }
}

export function showMenu(root: HTMLElement, onStart: (opts: GameOptions) => void): () => void {
  const st = load();
  let seed = Math.floor(Math.random() * 90000) + 10000;
  const menu = document.createElement('div');
  menu.className = 'menu';
  root.appendChild(menu);

  const render = (): void => {
    const css = (c: [number, number, number]): string => `rgb(${c[0]},${c[1]},${c[2]})`;
    menu.innerHTML = `
      <div class="menu-inner">
        <header><h1>口袋战争</h1><p>四方争霸 · 千军会战</p></header>
        <h2>选择你的阵营</h2>
        <div class="factions">
          ${FACTION_IDS.map(id => {
            const f = FACTIONS[id];
            return `<div class="fcard ${st.faction === id ? 'on' : ''}" data-f="${id}" style="--c:${css(f.color)}">
              <div class="fhead"><b>${f.name}</b><i>${f.motto}</i></div>
              <p>${f.desc}</p>
              <ul>${f.traits.map(t => `<li>${t}</li>`).join('')}</ul>
              <div class="roster" data-roster="${id}"></div>
            </div>`;
          }).join('')}
        </div>
        <div class="opts">
          <div class="opt"><label>对手</label><div class="seg" data-k="enemy">
            <button data-v="random" class="${st.enemy === 'random' ? 'on' : ''}">随机</button>
            ${FACTION_IDS.map(id => `<button data-v="${id}" class="${st.enemy === id ? 'on' : ''}">${FACTIONS[id].name}</button>`).join('')}
          </div></div>
          <div class="opt"><label title="单位是兵力份数：1 份是一个近战步兵的兵力，骑兵、器械、战象每人占得更多，同样的份数下人数更少">每方兵力</label><div class="seg" data-k="size">
            ${MENU_SIZES.map(n => `<button data-v="${n}" class="${st.size === n ? 'on' : ''}">${n}</button>`).join('')}
          </div></div>
          <div class="opt"><label>难度</label><div class="seg" data-k="difficulty">
            ${['简单', '普通', '困难'].map((n, i) => `<button data-v="${i}" class="${st.difficulty === i ? 'on' : ''}">${n}</button>`).join('')}
          </div></div>
          <div class="opt"><label>战争迷雾</label><div class="seg" data-k="fog">
            <button data-v="1" class="${st.fog ? 'on' : ''}">开</button><button data-v="0" class="${st.fog ? '' : 'on'}">关</button>
          </div></div>
          <div class="opt"><label>模式</label><div class="seg" data-k="spectate">
            <button data-v="0" class="${st.spectate ? '' : 'on'}">亲自指挥</button><button data-v="1" class="${st.spectate ? 'on' : ''}">观战</button>
          </div></div>
          <div class="opt"><label>地图种子</label><div class="seg">
            <input id="seed" value="${seed}" inputmode="numeric" maxlength="9"><button id="reroll">换一张</button>
          </div></div>
        </div>
        <button class="primary start">开　战</button>
        <footer>不造兵、不用派人采集：开局即拥有整支军队。占领据点获得援军，占领资源点自动采集，攻下敌方所有城池与营寨取胜。</footer>
      </div>`;
    for (const id of FACTION_IDS) {
      const box = menu.querySelector<HTMLDivElement>(`[data-roster="${id}"]`)!;
      for (const [key] of FACTIONS[id].army) {
        const d = UNIT_BY_KEY[key];
        const cell = document.createElement('div');
        cell.className = 'ru';
        cell.title = unitTip(d);
        cell.appendChild(unitPortrait(d.model, FACTIONS[id].color, 40));
        const nm = document.createElement('span');
        nm.textContent = d.name;
        cell.appendChild(nm);
        box.appendChild(cell);
      }
    }
    for (const card of menu.querySelectorAll<HTMLDivElement>('.fcard')) {
      card.onclick = () => {
        st.faction = card.dataset.f as FactionId;
        render();
      };
    }
    for (const seg of menu.querySelectorAll<HTMLDivElement>('.seg[data-k]')) {
      for (const b of seg.querySelectorAll('button')) {
        b.onclick = () => {
          const k = seg.dataset.k!, v = b.dataset.v!;
          if (k === 'enemy') st.enemy = v as Saved['enemy'];
          else if (k === 'size') st.size = Number(v);
          else if (k === 'difficulty') st.difficulty = Number(v);
          else if (k === 'fog') st.fog = v === '1';
          else if (k === 'spectate') st.spectate = v === '1';
          render();
        };
      }
    }
    const seedInput = menu.querySelector<HTMLInputElement>('#seed')!;
    seedInput.oninput = () => {
      seed = Number(seedInput.value.replace(/\D/g, '')) || 1;
    };
    menu.querySelector<HTMLButtonElement>('#reroll')!.onclick = () => {
      seed = Math.floor(Math.random() * 90000) + 10000;
      seedInput.value = String(seed);
    };
    menu.querySelector<HTMLButtonElement>('.start')!.onclick = () => {
      try {
        localStorage.setItem(KEY, JSON.stringify(st));
      } catch {
        // 无痕模式下存不了设置，忽略
      }
      const enemy = st.enemy === 'random' ? FACTION_IDS[Math.floor(Math.random() * 4)] : st.enemy;
      onStart({ seed, factions: [st.faction, enemy], armySize: st.size, difficulty: st.difficulty, fog: st.fog, spectate: st.spectate });
    };
  };
  render();
  return () => menu.remove();
}
