/**
 * 单位每帧的行为：校验目标 → 索敌与状态切换 → 行军 / 追击 / 攻击 / 溃逃 → 分离 → 位移。
 * 这是整个模拟里最热的循环，所以写成一个大函数；具体的规则（选谁、打多少、何时溃逃）都在别的系统里。
 */
import { A_MELEE, A_PIERCE, DT, RULES, SIZES, TERRAIN_SPEED, TILE, TR_FIREMOVE, T_FOREST, T_HILL } from '../content';
import { DIRX, DIRY } from '../nav';
import { FX_IMPACT, GRID, NONE, O_AMOVE, O_ATTACK, O_HOLD, O_IDLE, O_MOVE, S_BRACE, S_CHARGE, S_COMBAT, S_ROUT, S_SHIELD, S_TORCH, S_WALL } from '../state';
import type { World } from '../world';
import { attack, damageUnit, spawnProj } from './combat';
import { P_NONE, P_POSTED, stepPost } from './garrison';
import { SLOT, marchSlot } from './march';
import { FLEE, fleeStep } from './morale';
import { retarget } from './orders';
import { SCAN, findBuilding, scan } from './targeting';

function arrive(w: World, i: number, atSlot: boolean): void {
  w.order[i] = O_IDLE;
  w.homeX[i] = atSlot ? w.destX[i] : w.x[i];
  w.homeY[i] = atSlot ? w.destY[i] : w.y[i];
  w.field[i] = null;
  w.stuck[i] = 0;
  w.grpSpeed[i] = 0;
  w.grp[i] = -1;
}

export function updateUnits(w: World): void {
  const x = w.x, y = w.y, vx = w.vx, vy = w.vy, team = w.team, type = w.type, order = w.order,
    target = w.target, defs = w.defs, alive = w.alive, rad = w.rad, state = w.state;
  const tick = w.tickCount, mw = w.map.w, terr = w.map.terrain;
  const gw = w.gw, gh = w.gh, cs = w.cellStart, items = w.items;
  const maxX = w.W - 6, maxY = w.H - 6;
  const bldAt = w.nav.bld, buildings = w.buildings;
  const C = RULES.combat, SG = RULES.siege, SITE = RULES.site;
  const LEASH2 = C.leash * C.leash;
  const rainMul = w.env.raining ? RULES.env.rainSpeed : w.env.snowing ? RULES.env.snowSpeed : 1;
  const canTorch = w.env.night && !w.env.raining && !w.env.snowing;
  const mc = RULES.morale.cell, mcw = w.mw, mch = w.mh;
  const inner = w.nav.inner, marches = w.marches, planted = w.planted;
  const give = 1 - C.plantGive;
  const n = w.n;

  // 每个单位正被多少近战敌人盯着（索敌时避开已经围满的目标）
  const crowd = w.crowd;
  crowd.fill(0, 0, n);
  for (let i = 0; i < n; i++) {
    const t = target[i];
    if (alive[i] && t >= 0 && defs[type[i]].range === 0 && crowd[t] < 250) crowd[t]++;
  }

  for (let i = 0; i < n; i++) {
    if (!alive[i]) continue;
    const d = defs[type[i]];
    // 城墙驻守：上下墙的过场由驻守系统接管
    if (w.pmode[i] !== P_NONE && stepPost(w, i, d)) continue;
    const posted = w.pmode[i] === P_POSTED;
    const ab = d.abilities;
    const tm = team[i];
    const blk = w.nav.block[tm], dk = w.nav.deck[tm];
    const ux = x[i], uy = y[i];
    w.px[i] = ux;
    w.py[i] = uy;
    const cell = ((uy / TILE) | 0) * mw + ((ux / TILE) | 0);
    const tt = terr[cell];
    const under = bldAt[cell];
    const onWall = under >= 0 && buildings[under].def.top > 0;
    if (w.cd[i] > 0) w.cd[i] -= DT;
    if (w.auxCd[i] > 0) w.auxCd[i] -= DT;
    if (w.atkAnim[i] > 0) w.atkAnim[i] -= DT;
    if (w.flash[i] > 0) w.flash[i] -= DT;
    if (w.ignoreT[i] > 0) w.ignoreT[i] -= DT;
    if (w.combatT[i] > 0) w.combatT[i] -= DT;
    if (w.chargeCd[i] > 0) w.chargeCd[i] -= DT;
    if (w.braceT[i] > 0) w.braceT[i] -= DT;
    if (w.shieldT[i] > 0) w.shieldT[i] -= DT;
    if (w.avoidT[i] > 0) w.avoidT[i] -= DT;
    if (w.waitT[i] > 0) w.waitT[i] -= DT;
    let st = state[i];
    let ord = order[i];
    let tgt = target[i];
    let wx = 0, wy = 0;
    let spd = d.speed * TERRAIN_SPEED[tt] * rainMul;
    if (tt === T_FOREST) spd *= d.forestMul;
    const run = spd;
    let eng = 0, usePath = false, chasing = false, blockedByTerrain = false;
    let aim = w.dir[i];

    if (st & S_ROUT) {
      // ---- 溃逃：不听指挥、不还手，只管往最近的己方据点跑 ----
      if (!fleeStep(w, i, cell)) continue;
      st = state[i];
      wx = FLEE.x * spd;
      wy = FLEE.y * spd;
    } else {
      // ---- 校验目标 ----
      if (tgt !== NONE) {
        if (tgt >= 0) {
          if (!alive[tgt] || w.uid[tgt] !== w.targetUid[i]) tgt = NONE;
        } else {
          const b = buildings[-tgt - 2];
          if (!b.alive || b.owner === tm || (b.def.fort && !d.siege)) tgt = NONE;
        }
        if (tgt === NONE) {
          target[i] = NONE;
          w.waitT[i] = 0;
          if (ord === O_ATTACK) {
            // 临时目标（挡路的建筑）清除后，恢复玩家指定的目标
            const ot = w.otarget[i];
            let ok = false;
            if (ot >= 0) ok = alive[ot] === 1 && w.uid[ot] === w.otargetUid[i];
            else if (ot < NONE) {
              const b = buildings[-ot - 2];
              ok = b.alive && b.owner !== tm;
            }
            if (ok) {
              tgt = target[i] = ot;
              w.targetUid[i] = w.otargetUid[i];
            } else {
              ord = order[i] = O_IDLE;
              w.otarget[i] = NONE;
              w.homeX[i] = ux;
              w.homeY[i] = uy;
              w.field[i] = null;
            }
          }
        }
      }

      // ---- 观察四周（分帧错开）：进入战斗状态、触发特殊动作、索敌 ----
      if (((i + tick) & 7) === 0) {
        const melee = d.range === 0;
        if (ab.brace) {
          // 有敌人朝这边冲锋：立枪
          const cx = (ux / mc) | 0, cy = (uy / mc) | 0;
          const ch = w.mCharge[3 - tm];
          let on = false;
          for (let yy = cy - 1; yy <= cy + 1 && !on; yy++) {
            if (yy < 0 || yy >= mch) continue;
            for (let xx = cx - 1; xx <= cx + 1; xx++) if (xx >= 0 && xx < mcw && ch[yy * mcw + xx]) {
              on = true;
              break;
            }
          }
          if (on) w.braceT[i] = C.braceHold;
        }
        const hill = tt === T_HILL && !melee ? 1.12 : 1;
        // 在自家据点里待命的守军：整个据点的视野范围内来了敌人都会警觉，远程的上前迎击，近战的守在原地待命
        const guard = ord === O_IDLE && w.sheltered[i] === 1;
        let acqR = ord === O_HOLD ? (melee ? 44 : d.range * (onWall ? SG.wallRange : hill)) : d.acq * hill;
        // 攻击移动：看见了就打，不等敌人走进平时的索敌距离
        if (ord === O_AMOVE && d.alert > acqR) acqR = d.alert;
        if (guard && !melee && SITE.alarm > acqR) acqR = SITE.alarm;
        let scanR = d.alert > acqR ? d.alert : acqR;
        if (guard && SITE.alarm > scanR) scanR = SITE.alarm;
        scan(w, i, tm, ux, uy, scanR, acqR, d, tgt, ord === O_IDLE ? (acqR > C.leash ? acqR : C.leash) : 0);
        const near = SCAN.near;
        if (near !== NONE) {
          w.combatT[i] = C.linger;
          const nd = defs[type[near]];
          if (ab.shield && nd.range > 0 && !(melee && w.engaged[i])) w.shieldT[i] = C.shieldHold;
          const cg = ab.charge;
          if (cg && w.chargeCd[i] <= 0 && !(st & S_CHARGE) && ord !== O_MOVE && ord !== O_HOLD && !w.engaged[i]
            && w.ignoreT[i] <= 0) {
            // 隔着一段距离发现敌人：发起冲锋
            const ct = ord === O_ATTACK && tgt >= 0 ? tgt : near;
            const cd2 = (x[ct] - ux) ** 2 + (y[ct] - uy) ** 2;
            if (cd2 >= cg.minDist * cg.minDist && cd2 <= d.alert * d.alert && !w.lineBlocked(ux, uy, x[ct], y[ct], tm)) {
              st |= S_CHARGE;
              w.chargeT[i] = cg.duration;
              w.chargeHits[i] = 0;
              w.chargeLast[i] = 0;
              w.waitT[i] = 0;
              tgt = target[i] = ct;
              w.targetUid[i] = w.uid[ct];
              // 立刻告知目标附近的枪兵
              w.mCharge[tm][((y[ct] / mc) | 0) * mcw + ((x[ct] / mc) | 0)] = 1;
            }
          }
        }
        const auto = ord !== O_MOVE && ord !== O_ATTACK && w.ignoreT[i] <= 0 && !(st & S_CHARGE);
        const seekB = auto && ord !== O_HOLD;
        const bLeash = ord === O_IDLE ? C.leash : 0;
        // 工程类先找建筑打：附近有建筑就不理会敌兵（正在肉搏的除外）
        if (seekB && d.siege && tgt >= NONE && !(melee && w.engaged[i])) {
          const b = findBuilding(w, i, ux, uy, tm, d.range > acqR ? d.range : acqR, d, bLeash);
          if (b >= 0) {
            tgt = target[i] = -b - 2;
            w.waitT[i] = 0;
          }
        }
        if (auto && (tgt === NONE || (tgt < 0 && !d.siege) || (tgt >= 0 && melee && !w.engaged[i] && w.waitT[i] <= 0))) {
          const e = SCAN.pick;
          if (e !== NONE) {
            // 人形单位先打敌兵：手头盯着的是建筑也换过去
            if (e !== tgt && (!melee || !w.lineBlocked(ux, uy, x[e], y[e], tm))) {
              tgt = target[i] = e;
              w.targetUid[i] = w.uid[e];
              w.waitT[i] = 0;
            }
          } else if (tgt === NONE && seekB && !d.siege) {
            const b = findBuilding(w, i, ux, uy, tm, acqR > C.bldSeek ? acqR : C.bldSeek, d, bLeash);
            if (b >= 0) tgt = target[i] = -b - 2;
          }
        }
      }

      // ---- 状态位：战斗 / 冲锋 / 立枪 / 举盾 / 火把 ----
      const inCombat = w.combatT[i] > 0 || tgt >= 0;
      if (st & S_CHARGE) {
        w.chargeT[i] -= DT;
        if (w.chargeT[i] <= 0 || tgt < 0 || w.chargeHits[i] >= ab.charge!.maxHits) {
          st &= ~S_CHARGE;
          w.chargeCd[i] = ab.charge!.cooldown;
        }
      }
      st = (st & S_CHARGE) | (inCombat ? S_COMBAT : 0)
        | (ab.brace && w.braceT[i] > 0 ? S_BRACE : 0)
        | (ab.shield && w.shieldT[i] > 0 && !(d.range === 0 && w.engaged[i]) ? S_SHIELD : 0)
        | (ab.torch && canTorch && !w.torchOff[i] ? S_TORCH : 0) | (onWall ? S_WALL : 0);
      // 非战斗状态按行军速度走；同一道命令里的部队统一成最慢的那个
      if (!inCombat) {
        const g = w.grpSpeed[i];
        spd *= (g > 0 && g < d.walk ? g : d.walk) / d.speed;
      }
      if (st & S_CHARGE) spd *= ab.charge!.speedMul;
      if (st & S_BRACE) spd *= ab.brace!.speedMul;
      else if (st & S_SHIELD) spd *= ab.shield!.speedMul;

      // ---- 行为 ----
      if (tgt !== NONE) {
        let tx: number, ty: number, tr: number;
        if (tgt >= 0) {
          tx = x[tgt];
          ty = y[tgt];
          tr = rad[tgt];
        } else {
          const b = buildings[-tgt - 2];
          tx = ux < b.x0 ? b.x0 : ux > b.x1 ? b.x1 : ux;
          ty = uy < b.y0 ? b.y0 : uy > b.y1 ? b.y1 : uy;
          tr = 0;
        }
        const dx = tx - ux, dy = ty - uy;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
        const edge = dist - tr - d.radius;
        const reach = tgt < 0 && d.humanoid ? SG.torchRange
          : d.range > 0 ? d.range * (onWall ? SG.wallRange : tt === T_HILL ? 1.12 : 1) : 7;
        if (edge <= reach) {
          if (d.minRange > 0 && dist < d.minRange) {
            // 器械无法攻击贴身目标
            target[i] = tgt = NONE;
            w.ignoreT[i] = 0.5;
          } else {
            eng = 1;
            w.waits[i] = 0;
            w.waitT[i] = 0;
            aim = Math.atan2(dy, dx);
            if (dx > 1) w.facing[i] = 1;
            else if (dx < -1) w.facing[i] = -1;
            if (!d.mobile && vx[i] * vx[i] + vy[i] * vy[i] > 16) {
              // 只有骑兵能边跑边打：其余的先站定，下一帧再出手
              vx[i] = vy[i] = 0;
            } else if (w.cd[i] <= 0) attack(w, i, d, tgt, tt);
            // 冲到跟前了：冲锋到此为止（撞击在下面的碰撞里结算）
            if (st & S_CHARGE && w.chargeT[i] > 0.25) w.chargeT[i] = 0.25;
            if ((d.traits & TR_FIREMOVE) && tgt >= 0 && edge < reach * 0.55) {
              // 骑射：保持距离
              wx = (-dx / dist) * spd;
              wy = (-dy / dist) * spd;
            }
          }
        } else if (ord === O_HOLD) {
          target[i] = tgt = NONE;
        } else if (ord === O_IDLE && !(st & S_CHARGE) && (tx - w.homeX[i]) ** 2 + (ty - w.homeY[i]) ** 2
          > (w.sheltered[i] && d.range > 0 ? SITE.alarm * SITE.alarm : LEASH2) * 1.2) {
          // 待命：敌人离岗位太远就不追了
          target[i] = tgt = NONE;
          w.ignoreT[i] = 1.5;
        } else {
          // 接敌途中的副武器（重标枪、弓）
          const aux = d.aux;
          if (aux && tgt >= 0 && w.auxCd[i] <= 0 && edge <= aux.range) {
            w.auxCd[i] = aux.cd * (0.9 + w.rng.next() * 0.2);
            w.atkAnim[i] = 0.3;
            spawnProj(w, ux, uy, tgt, tx, ty, aux.proj, aux.dmg, A_PIERCE, 0, 0, d.idx, tm, i);
          }
          // 打建筑：明确下令的走通往它的路线；途中自己盯上的（箭楼、门楼）能直走就直接上前，否则继续沿原路线走
          if (tgt < 0 ? ord === O_ATTACK || (ord !== O_IDLE && w.lineBlocked(ux, uy, tx - (dx / dist) * 24, ty - (dy / dist) * 24, tm))
            : ord === O_ATTACK && dist > 240) usePath = true;
          else if (w.waitT[i] > 0) {
            // 挤不进战线：在原地面朝敌人列队，等前面空出位置
            aim = Math.atan2(dy, dx);
          } else {
            chasing = true;
            wx = (dx / dist) * spd;
            wy = (dy / dist) * spd;
          }
        }
      }
      if (tgt === NONE || usePath) {
        if (ord === O_MOVE || ord === O_AMOVE || ord === O_ATTACK) {
          // 追击移动中的单位：目标走远后重新规划
          if (ord === O_ATTACK && tgt >= 0 && ((i + tick) & 31) === 0) {
            const ox = x[tgt] - w.destX[i], oy = y[tgt] - w.destY[i];
            if (ox * ox + oy * oy > 200 * 200) retarget(w, i, tm, x[tgt], y[tgt]);
          }
          const ddx = w.destX[i] - ux, ddy = w.destY[i] - uy;
          const dd = Math.sqrt(ddx * ddx + ddy * ddy);
          // 编队行军：跟着自己在队列里的位置走
          let inFormation = false;
          const gi = w.grp[i];
          if (gi >= 0 && tgt === NONE) {
            const g = marches[gi];
            if (!g.alive || g.arrived) w.grp[i] = -1;
            else if (!g.blocked && !g.loose && !inCombat) {
              // 只有不在打仗的时候才排队：自己进入战斗状态、或队伍已经打起来了，就各走各的
              marchSlot(g, w.offA[i], w.offL[i]);
              const px = SLOT.x, py = SLOT.y;
              const pc = ((py / TILE) | 0) * mw + ((px / TILE) | 0);
              if (px > 8 && py > 8 && px < maxX && py < maxY && !blk[pc] && !w.lineBlocked(ux, uy, px, py, tm)) {
                // 瞄准位置前方一小段：到位后正好与领队同速，落后了就跑步追
                const ex = px + SLOT.hx * g.v * 0.4 - ux, ey = py + SLOT.hy * g.v * 0.4 - uy;
                const ed = Math.sqrt(ex * ex + ey * ey);
                if (ed > 0.5) {
                  let v = ed / 0.4;
                  if (v > run) v = run;
                  wx = (ex / ed) * v;
                  wy = (ey / ed) * v;
                }
                inFormation = true;
              } else {
                // 够不着自己的位置（过桥、进门）：沿寻路路线走，略快一点好归队
                const lim = g.speed * 1.3 > d.walk ? g.speed * 1.3 : d.walk;
                spd = run < lim ? run : lim;
              }
            }
          }
          if (inFormation) {
            if (w.stuck[i] > 0) w.stuck[i] = 0;
          } else if (dd < 5 && ord !== O_ATTACK) arrive(w, i, true);
          else {
            let f = w.field[i];
            let direct = true;
            if (f) {
              const gc = w.destCell[i];
              const gx = (gc % mw + 0.5) * TILE - ux, gy = (((gc / mw) | 0) + 0.5) * TILE - uy;
              const sr = w.seekR[i];
              if (gx * gx + gy * gy > sr * sr || sr === 0) {
                if (f.dead) f = w.field[i] = w.nav.getField(tm, f.cell, tick);
                f.lastUse = tick;
                const dir = f.dirs[cell];
                if (dir < 8) {
                  direct = false;
                  const k = dir & 1 ? spd * 0.7071 : spd;
                  wx = DIRX[dir] * k;
                  wy = DIRY[dir] * k;
                  // 行军路线被敌方建筑挡住：就地攻击它（攻城）
                  const K = d.lookK;
                  if (tgt === NONE && (K === 1 || ((i + tick) & 7) === 3)) {
                    let c2 = cell;
                    for (let k2 = 0; k2 < K; k2++) {
                      const dr = f.dirs[c2];
                      if (dr > 7) break;
                      c2 += DIRX[dr] + DIRY[dr] * mw;
                      if (blk[c2]) {
                        const bid = bldAt[c2];
                        if (bid >= 0 && buildings[bid].owner !== tm && (!buildings[bid].def.fort || d.siege)) target[i] = -bid - 2;
                        break;
                      }
                    }
                  }
                }
              }
            }
            if (direct) {
              const k = (spd * Math.min(1, dd / 10)) / (dd || 1);
              wx = ddx * k;
              wy = ddy * k;
              const sk = w.stuck[i];
              if (sk > 1.2 && ord !== O_ATTACK) {
                if (dd < 140 || sk > 3.5) arrive(w, i, false);
                else if (!f) {
                  w.field[i] = w.nav.getField(tm, w.destCell[i], tick);
                  w.seekR[i] = 40;
                  w.stuck[i] = 0;
                } else w.seekR[i] = 0.001;
              } else if (sk > 1.5 && ord === O_ATTACK && !f) {
                w.field[i] = w.nav.getField(tm, w.destCell[i], tick);
                w.stuck[i] = 0;
              }
            }
          }
        } else {
          // 待命与坚守：被挤开或追击结束后回到原位
          const hx = w.homeX[i] - ux, hy = w.homeY[i] - uy;
          const h2 = hx * hx + hy * hy;
          if (h2 > 64) {
            const hd = Math.sqrt(h2);
            if (w.stuck[i] > 2) {
              w.homeX[i] = ux;
              w.homeY[i] = uy;
              w.stuck[i] = 0;
            } else {
              const k = (spd * Math.min(1, hd / 24)) / hd;
              wx = hx * k;
              wy = hy * k;
            }
          } else if (tgt === NONE) aim = w.faceA[i];
        }
      }
    }
    w.engaged[i] = eng;
    state[i] = st;
    // 站定出手：除了骑兵，出手的那一下（以及交手期间）脚下不动，也不会被旁人挤开
    const plant = !d.mobile && !(st & S_ROUT) && (eng === 1 || w.atkAnim[i] > 0);
    // 骑兵交手时脚下可以动，但不会被自己人挤出战位；在战线后面列队等待的也一样
    const firm = plant || ((eng === 1 || (w.waitT[i] > 0 && wx === 0 && wy === 0)) && !(st & (S_CHARGE | S_ROUT)));
    planted[i] = plant ? 1 : firm ? 2 : 0;
    if (plant || posted) {
      wx = wy = 0;
      vx[i] = vy[i] = 0;
    }
    if (posted) planted[i] = 1;

    // ---- 分离（单位互不重叠）与冲撞 ----
    let pxs = 0, pys = 0;
    const gx = (ux / GRID) | 0, gy = (uy / GRID) | 0;
    const r = rad[i], r2 = r * r;
    const charging = (st & S_CHARGE) !== 0;
    let braced = NONE;
    for (let cy = gy - 1; cy <= gy + 1; cy++) {
      if (cy < 0 || cy >= gh) continue;
      for (let cx = gx - 1; cx <= gx + 1; cx++) {
        if (cx < 0 || cx >= gw) continue;
        const c = cy * gw + cx;
        const e = cs[c + 1];
        for (let k = cs[c]; k < e; k++) {
          const j = items[k];
          if (j === i || !alive[j]) continue;
          let ox = ux - x[j], oy = uy - y[j];
          const rj = rad[j];
          const rr = r + rj;
          let d2 = ox * ox + oy * oy;
          if (charging && team[j] !== tm && d2 < (rr + 8) * (rr + 8) && w.uid[j] !== w.chargeLast[i] && !(state[j] & S_WALL)
            && w.chargeHits[i] < ab.charge!.maxHits && braced === NONE) {
            w.chargeLast[i] = w.uid[j];
            w.chargeHits[i]++;
            if (state[j] & S_BRACE) braced = j;
            else {
              w.addFx(FX_IMPACT, x[j], y[j], rj);
              damageUnit(w, j, ab.charge!.impact, A_MELEE, 0, d.vs, tm, i);
              if (!alive[j]) continue;
            }
          }
          if (d2 >= rr * rr) continue;
          if (d2 < 0.01) {
            ox = ((i * 7919) % 13) - 6;
            oy = ((i * 104729) % 11) - 5;
            d2 = ox * ox + oy * oy + 0.01;
          }
          const dd = Math.sqrt(d2);
          // 站定的人只有被压得太狠才让一点；别人撞上站定的人，自己全让
          if (firm && dd > rr * give && (plant || team[j] === tm)) continue;
          const pj = planted[j];
          const push = ((rr - dd) / dd) * (!firm && (pj === 1 || (pj === 2 && team[j] === tm)) ? 1 : (rj * rj) / (r2 + rj * rj));
          pxs += ox * push;
          pys += oy * push;
        }
      }
    }
    if (braced !== NONE) {
      // 撞上立起的枪阵：自己受伤、冲锋被拦停
      const jd = defs[type[braced]];
      state[i] = st &= ~S_CHARGE;
      w.chargeCd[i] = ab.charge!.cooldown;
      if (w.cd[i] < C.braceStun) w.cd[i] = C.braceStun;
      vx[i] = vy[i] = 0;
      wx = wy = 0;
      w.addFx(FX_IMPACT, ux, uy, r);
      damageUnit(w, i, jd.abilities.brace!.dmg, A_MELEE, 0, jd.vs, team[braced], braced);
      if (!alive[i]) continue;
    }
    const pm = pxs * pxs + pys * pys;
    // 推挤上限要略高于自己一帧能走的距离，否则跑得快的会一点点挤进站定的人堆里
    const pcap = firm || spd * DT < 2.5 ? 3 : spd * DT + 0.5;
    if (pm > pcap * pcap) {
      const k = pcap / Math.sqrt(pm);
      pxs *= k;
      pys *= k;
    }

    // ---- 积分与地形碰撞 ----
    const nvx = vx[i] + (wx - vx[i]) * 0.3, nvy = vy[i] + (wy - vy[i]) * 0.3;
    vx[i] = nvx;
    vy[i] = nvy;
    let nx = ux + nvx * DT + pxs, ny = uy + nvy * DT + pys;
    // 垛口上的人钉在原位
    if (posted) {
      nx = ux;
      ny = uy;
    }
    if (nx < 6) nx = 6;
    else if (nx > maxX) nx = maxX;
    if (ny < 6) ny = 6;
    else if (ny > maxY) ny = maxY;
    // 坐标按 32 位浮点存：先舍入成存进去的值再判格子，否则刚好贴着格线时会被舍入到隔壁格里，绕过下面的检查
    nx = Math.fround(nx);
    ny = Math.fround(ny);
    if (!blk[cell]) {
      // 进不去的格子：地形与敌方建筑；地面上不了墙顶，墙顶只能往城内一侧下
      const c1 = ((uy / TILE) | 0) * mw + ((nx / TILE) | 0);
      if (c1 !== cell && (blk[c1] || (dk[c1] !== dk[cell] && !(dk[cell] && inner[c1])))) {
        nx = ux;
        vx[i] = 0;
        blockedByTerrain = true;
      }
      const c2 = ((ny / TILE) | 0) * mw + ((nx / TILE) | 0);
      if (c2 !== cell && (blk[c2] || (dk[c2] !== dk[cell] && !(dk[cell] && inner[c2])))) {
        ny = uy;
        vy[i] = 0;
        blockedByTerrain = true;
      }
    }
    x[i] = nx;
    y[i] = ny;
    const mvx = nx - ux, mvy = ny - uy;
    const moved = Math.sqrt(mvx * mvx + mvy * mvy);
    const want = Math.sqrt(wx * wx + wy * wy);
    // 追击时看的是有没有朝目标靠近：贴着人墙横着滑不算前进
    if (want > 8 && (chasing ? mvx * wx + mvy * wy < want * want * DT * 0.3 : moved < want * DT * 0.3)) w.stuck[i] += DT;
    else if (w.stuck[i] > 0) w.stuck[i] = Math.max(0, w.stuck[i] - DT * 2);
    if (chasing && d.range === 0 && w.stuck[i] > C.blockedAfter) {
      w.stuck[i] = 0;
      if (blockedByTerrain) {
        // 被地形挡住：放弃这个目标，稍后重新索敌
        if (ord !== O_ATTACK) target[i] = NONE;
        w.ignoreT[i] = 1.5;
      } else {
        // 被自己人挡在后面：先找一个还有空位的敌人，没有就原地列队等，不再来回乱跑
        w.avoidUid[i] = w.targetUid[i];
        w.avoidT[i] = C.avoidFor;
        let alt = NONE;
        if (ord !== O_ATTACK && tgt >= 0) {
          scan(w, i, tm, ux, uy, d.acq, d.acq, d, NONE, ord === O_IDLE ? C.leash : 0);
          alt = SCAN.pick;
          // 换过去的目标得真有空位，否则只是在两个围满的敌人之间来回跑
          if (alt !== NONE && (alt === tgt || w.crowd[alt] >= SIZES[defs[type[alt]].size].slots || w.lineBlocked(ux, uy, x[alt], y[alt], tm))) alt = NONE;
        }
        if (alt !== NONE) {
          target[i] = alt;
          w.targetUid[i] = w.uid[alt];
        } else {
          w.waitT[i] = Math.min(C.waitMax, C.waitBase + w.waits[i] * 0.8);
          if (w.waits[i] < 200) w.waits[i]++;
        }
      }
    }
    if (!eng) {
      if (nvx > 6) w.facing[i] = 1;
      else if (nvx < -6) w.facing[i] = -1;
      if (nvx * nvx + nvy * nvy > 64) aim = Math.atan2(nvy, nvx);
    }
    let turn = aim - w.dir[i];
    if (turn > Math.PI) turn -= Math.PI * 2;
    else if (turn < -Math.PI) turn += Math.PI * 2;
    if (turn !== 0) {
      const lim = 9 * DT;
      w.dir[i] += turn > lim ? lim : turn < -lim ? -lim : turn;
      if (w.dir[i] > Math.PI) w.dir[i] -= Math.PI * 2;
      else if (w.dir[i] < -Math.PI) w.dir[i] += Math.PI * 2;
    }
    w.odo[i] += moved;
  }
}
