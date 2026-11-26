/**
 * 单位每帧的行为：校验目标 → 索敌与状态切换 → 行军 / 追击 / 攻击 / 溃逃 → 分离 → 位移。
 * 这是整个模拟里最热的循环，所以写成一个大函数；具体的规则（选谁、打多少、何时溃逃）都在别的系统里。
 */
import { A_MELEE, DT, RULES, TERRAIN_SPEED, TICK_RATE, TILE, TR_FIREMOVE, T_FOREST, T_HILL, UnitDef } from '../content';
import { DIRX, DIRY } from '../nav';
import { siteContains } from '../siteArea';
import { BLD_SKIP_ALL, ENG_CLOSE, ENG_REACH, FX_IMPACT, GRID, NONE, O_AMOVE, O_ATTACK, O_HOLD, O_IDLE, O_MOVE, S_BRACE, S_CHARGE, S_COMBAT, S_ROUT, S_SHIELD, S_TORCH, S_WALL } from '../state';
import type { Building, World } from '../world';
import { damageUnit, strike } from './combat';
import { orderAttackUnit, orderMove } from './orders';
import { P_NONE, P_POSTED, stepPost } from './garrison';
import { FOLLOW, FOLLOW_APART, FOLLOW_SLOT, SLOT, marchFollow, marchSlot } from './march';
import { FLEE, fleeStep } from './morale';
import { retarget } from './orders';
import { SCAN, canAttackBuilding, crowded, findBuilding, findWallFoe, foeSiteFighting, foeTargets, scan, wallSpotBad, windRangeMul } from './targeting';
import { STEP, detourPasses, detourProgress, detourStep, shooting, startWait, tryDetour } from './detour';
import { WAY_AROUND, WAY_DIRECT, WAY_NONE, chaseWay, findAround, keepWay } from './around';

function arrive(w: World, i: number, atSlot: boolean): void {
  w.order[i] = O_IDLE;
  w.homeX[i] = atSlot ? w.destX[i] : w.x[i];
  w.homeY[i] = atSlot ? w.destY[i] : w.y[i];
  w.field[i] = null;
  w.stuck[i] = 0;
  w.bestD[i] = 1e9;
  w.noGain[i] = 0;
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
  const rainMul = w.env.raining ? RULES.env.rainSpeed : w.env.snowing ? RULES.env.snowSpeed : 1;
  // 风：顺风快、顶风慢，按行进方向在风向上的投影算
  // 顺风时远程最远能射到射程的几倍（索敌按这个找，出手前再按实际方向核对）
  const windMax = 1 + RULES.env.windRange * w.env.wind;
  const windK = w.env.wind * RULES.env.windSpeed, windX = Math.cos(w.env.windDir), windY = Math.sin(w.env.windDir);
  const canTorch = w.env.night && !w.env.raining && !w.env.snowing;
  const mc = RULES.morale.cell, mcw = w.mw, mch = w.mh;
  const nav = w.nav, marches = w.marches, planted = w.planted;
  const give = 1 - C.plantGive;
  const n = w.n;

  // 每个单位正被多少近战敌人盯着（索敌时避开已经围满的目标）；隔着贴身距离出手的长兵器不占贴身的位置，不算
  const crowd = w.crowd;
  crowd.fill(0, 0, n);
  // 两方各有多少人站在墙顶上（远程单位没目标时，没有敌兵上墙就不用再多扫一圈）
  const onWallN = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const t = target[i];
    if (alive[i] && t >= 0 && defs[type[i]].melee && w.engaged[i] !== ENG_REACH && crowd[t] < 250) crowd[t]++;
    if (alive[i] && state[i] & S_WALL) onWallN[team[i]]++;
  }

  for (let i = 0; i < n; i++) {
    if (!alive[i]) continue;
    const d = defs[type[i]];
    // 城墙驻守：上下墙的过场由驻守系统接管
    if (w.pmode[i] !== P_NONE && stepPost(w, i, d)) continue;
    const posted = w.pmode[i] === P_POSTED;
    const ab = d.abilities;
    const tm = team[i];
    const blk = nav.block[tm];
    const ux = x[i], uy = y[i];
    w.px[i] = ux;
    w.py[i] = uy;
    w.apart[i] = 0;
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
    if (w.bldSkipT[i] > 0) w.bldSkipT[i] -= DT;
    if (w.waitT[i] > 0) w.waitT[i] -= DT;
    if (w.detourLoose[i] > 0) w.detourLoose[i] -= DT;
    if (w.wayNoT[i] > 0) w.wayNoT[i] -= DT;
    // 目标不再是敌兵（清空或换成建筑，不论在哪里换的）：追击绕行的判断跟着作废
    if (target[i] < 0) w.wayUid[i] = w.wallUid[i] = 0;
    let st = state[i];
    let ord = order[i];
    let tgt = target[i];
    let wx = 0, wy = 0;
    let spd = d.speed * TERRAIN_SPEED[tt] * rainMul;
    if (tt === T_FOREST) spd *= d.forestMul;
    const run = spd;
    let eng = 0, usePath = false, chasing = false, blockedByTerrain = false, detouring = false, overRank = false;
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
          if (!canAttackBuilding(b, tm, d.siege)) tgt = NONE;
        }
        if (tgt === NONE) {
          target[i] = NONE;
          w.waitT[i] = w.detourT[i] = 0;
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
            } else if (w.sortie[i]) {
              // 出击的守军打完了：回原位
              const hx = w.sortieX[i], hy = w.sortieY[i];
              ONE[0] = i;
              orderMove(w, ONE, hx, hy, false);
              ord = order[i];
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
        const melee = d.melee;
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
        // 在自家据点里待命的守军：整个据点的视野范围内来了敌人都会警觉，远程的上前迎击（城池里的自动登城），
        // 近战的不出据点，只打进了据点的敌人；挨了敌方远程的打才出击追打那个射手
        const guard = ord === O_IDLE && w.sheltered[i] === 1;
        const prov = guard && melee ? provoker(w, i, tm, TICK_RATE * SITE.provoke) : NONE;
        let acqR = ord === O_HOLD ? (melee ? C.holdAcq + d.main.range - C.meleeContact : d.main.range * (onWall ? SG.wallRange : hill) * windMax) : d.acq * hill;
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
          if (ab.shield && !nd.melee && !(melee && w.engaged[i] === ENG_CLOSE)) w.shieldT[i] = C.shieldHold;
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
              w.waitT[i] = w.detourT[i] = 0;
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
          const b = findBuilding(w, i, ux, uy, tm, d.main.range > acqR ? d.main.range : acqR, d, bLeash);
          if (b >= 0) {
            tgt = target[i] = -b - 2;
            w.waitT[i] = 0;
          }
        }
        // 追着自己挑的墙顶敌兵（wallUid）去的远程：墙顶守军会沿墙挪位、下墙，复核一下该不该放手：
        // 走到刚好进射程的那一点变得不该去了（顶在墙根、进了塔的射程、目标下墙进城后直线不通），或待命的单位所在据点已平静而它也没在打我方的人，
        // 就放手，交回原有逻辑：待命的回岗位，攻击移动的接着走；目标下了墙但够得着，就当普通目标追，不再复核
        const wallHunter = auto && !melee && !d.siege && !guard && (ord === O_IDLE || ord === O_AMOVE);
        if (w.wallUid[i] !== 0) {
          if (!wallHunter || tgt < 0 || w.uid[tgt] !== w.wallUid[i]) w.wallUid[i] = 0;
          else if (wallSpotBad(w, tm, tgt, ux, uy, d) || (ord === O_IDLE && state[tgt] & S_WALL && !foeSiteFighting(w, tgt) && !foeTargets(w, tgt, tm))) {
            tgt = target[i] = NONE;
            w.waitT[i] = 0;
            w.wallUid[i] = 0;
          } else if (!(state[tgt] & S_WALL)) w.wallUid[i] = 0;
        }
        if (prov !== NONE && !w.engaged[i] && auto) {
          // 出击：改成明确的攻击命令（走寻路出城门），打完回原位
          const hx = w.homeX[i], hy = w.homeY[i];
          ONE[0] = i;
          orderAttackUnit(w, ONE, prov);
          w.sortie[i] = 1;
          w.sortieX[i] = hx;
          w.sortieY[i] = hy;
          ord = order[i];
          tgt = target[i];
        } else if (auto && (tgt === NONE || (tgt < 0 && !d.siege) || (tgt >= 0 && melee && !w.engaged[i] && w.waitT[i] <= 0 && w.detourT[i] <= 0))) {
          let e = SCAN.pick;
          if (e !== NONE && guard && melee && !inSite(w, w.shelterSite[i], x[e], y[e])) e = NONE;
          // 人形单位先打敌兵：手头盯着的是建筑也换过去。
          // 近战隔着民房这类小障碍（直线不通）的，绕得过去才挑（追击时沿局部路线绕）；绕不过去的几秒内不再挑它，下次换别人
          let took = e !== NONE && e === tgt;
          if (e !== NONE && !took) {
            const blocked = melee && w.lineBlocked(ux, uy, x[e], y[e], tm);
            if (!blocked || (ord !== O_HOLD && w.wayNoT[i] <= 0 && findAround(w, i, x[e], y[e]))) {
              tgt = target[i] = e;
              w.targetUid[i] = w.uid[e];
              w.waitT[i] = 0;
              took = true;
              // 挑中了才记下走法（没挑中的候选不留记录），要绕的直接用刚算出的路点
              if (blocked) keepWay(w, i, w.uid[e], WAY_AROUND);
            } else if (ord !== O_HOLD) {
              w.avoidUid[i] = w.uid[e];
              if (w.wayNoT[i] > 0) {
                // 重试间隔内没寻路就跳过的：未必绕不过去，少挑它不超过剩下的间隔，间隔一过照常再试
                w.avoidT[i] = w.wayNoT[i] < C.avoidFor ? w.wayNoT[i] : C.avoidFor;
              } else {
                // 刚为它寻过路又绕不过去的：一小段时间内直线不通的候选都不再试，免得墙外的人每次索敌都为墙后另一个敌兵白找一次
                w.avoidT[i] = C.avoidFor;
                w.wayNoT[i] = C.chaseRetry;
              }
            }
          }
          // 远程单位索敌范围里没有敌兵时，去打墙顶上的，手头盯着的建筑也换过去（人形单位先打敌兵）。
          // 待命的只在那座据点正在交战、或它自己正在打我方的人时才去（攻击移动是玩家下了进攻的命令）；据点里待命的守军由驻守系统接管，不在此列
          if (!took && tgt < 0 && wallHunter && onWallN[3 - tm] > 0) {
            const e = findWallFoe(w, i, tm, ux, uy, d, ord === O_IDLE ? C.wallSeek : 0, ord === O_IDLE);
            if (e !== NONE) {
              tgt = target[i] = e;
              w.targetUid[i] = w.wallUid[i] = w.uid[e];
              w.waitT[i] = 0;
              took = true;
            }
          }
          if (!took && tgt === NONE && seekB && !d.siege) {
            const b = findBuilding(w, i, ux, uy, tm, acqR > C.bldSeek ? acqR : C.bldSeek, d, bLeash);
            if (b >= 0) tgt = target[i] = -b - 2;
          }
        }
        // 近战守军不追出据点（追的是最近打过自己的人除外）
        if (guard && melee && tgt >= 0 && guardDrops(w, i, tgt) && !w.engaged[i]) {
          tgt = target[i] = NONE;
          w.waitT[i] = 0;
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
        | (ab.shield && w.shieldT[i] > 0 && !(d.melee && w.engaged[i] === ENG_CLOSE) ? S_SHIELD : 0)
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
        // 站位按这把武器：打建筑用对建筑武器（距离不乘高地、风、城墙），否则是主武器（远程的射程乘城墙、高地、风）
        const torch = tgt < 0 ? d.torch : null;
        const stance = torch ?? d.main;
        const reach = torch ? torch.range
          : !d.melee ? d.main.range * (onWall ? SG.wallRange : tt === T_HILL ? 1.12 : 1) * windRangeMul(w, dx, dy)
            : st & S_CHARGE && d.main.range > C.meleeContact ? C.meleeContact : d.main.range;
        // 近战武器隔着贴身距离够着敌兵（长兵器隔着自己人出手）：超出贴身的那一段要直线可通（建筑按贴边的点算距离，不看这一条）
        const far = d.melee && tgt >= 0 && edge > C.meleeContact;
        if (edge <= reach && !(far && w.lineBlocked(ux, uy, tx, ty, tm))) {
          if (stance.minRange > 0 && dist < stance.minRange) {
            // 器械无法攻击贴身目标
            target[i] = tgt = NONE;
            w.ignoreT[i] = 0.5;
          } else {
            eng = 1;
            overRank = far;
            w.waits[i] = 0;
            w.waitT[i] = w.detourT[i] = 0;
            aim = Math.atan2(dy, dx);
            if (dx > 1) w.facing[i] = 1;
            else if (dx < -1) w.facing[i] = -1;
            if (!d.mobile && vx[i] * vx[i] + vy[i] * vy[i] > 16) {
              // 只有骑兵能边跑边打：其余的先站定，下一帧再出手
              vx[i] = vy[i] = 0;
            } else {
              // 够得着的武器里用最短的那把
              const aux = d.aux;
              const wp = !torch && aux && tgt >= 0 && edge <= aux.range && aux.range < d.main.range ? aux : stance;
              if ((wp === aux ? w.auxCd[i] : w.cd[i]) <= 0) strike(w, i, d, wp, tgt, tt);
            }
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
        } else if (ord === O_IDLE && !(st & S_CHARGE) && (tx - w.homeX[i]) ** 2 + (ty - w.homeY[i]) ** 2 > idleLeash2(w, i, d, tgt)) {
          // 待命：敌人离岗位太远就不追了
          target[i] = tgt = NONE;
          w.ignoreT[i] = 1.5;
        } else {
          // 接敌途中的副武器（重标枪、弓）
          const aux = d.aux;
          if (aux && tgt >= 0 && w.auxCd[i] <= 0 && edge <= aux.range) strike(w, i, d, aux, tgt, tt);
          // 打建筑：明确下令的走通往它的路线；途中自己盯上的（角楼、哨塔、门楼）能直走就直接上前，否则继续沿原路线走
          if (tgt < 0 ? ord === O_ATTACK || (ord !== O_IDLE && w.lineBlocked(ux, uy, tx - (dx / dist) * 24, ty - (dy / dist) * 24, tm))
            : ord === O_ATTACK && dist > 240) usePath = true;
          else if (w.waitT[i] > 0) {
            // 挤不进战线：在原地面朝敌人列队，等前面空出位置
            aim = Math.atan2(dy, dx);
          } else {
            // 与目标之间直线不通（隔着民房这类小障碍）：朝局部路线上看得见的最远一点走（远程也一样，绕过房子凑进射程）
            const way = tgt >= 0 ? chaseWay(w, i, tgt, tx, ty) : WAY_DIRECT;
            let ax = dx, ay = dy, al = dist;
            if (way === WAY_AROUND) {
              ax = w.wayX[i] - ux;
              ay = w.wayY[i] - uy;
              al = Math.sqrt(ax * ax + ay * ay) || 0.001;
            } else if (way === WAY_NONE && d.melee) {
              // 近战绕不过去（隔着城墙、深水）：玩家指定的目标改走寻路，自己挑的放弃，几秒内不再挑它。
              // 远程绕不过去照旧直线走、不放弃：隔着墙也射得着，凑近到射程就行
              if (ord === O_ATTACK) usePath = true;
              else {
                w.avoidUid[i] = w.targetUid[i];
                w.avoidT[i] = C.avoidFor;
                target[i] = tgt = NONE;
              }
            }
            if (tgt !== NONE && !usePath) {
              chasing = true;
              wx = (ax / al) * spd;
              wy = (ay / al) * spd;
            }
            if (chasing && w.detourT[i] > 0 && tgt >= 0 && detourStep(w, i, tgt, ord, spd, cell, ord === O_IDLE ? idleLeash2(w, i, d, tgt) : 0, guardKeep(w, i, d, ord))) {
              wx = STEP.wx;
              wy = STEP.wy;
              detouring = true;
            }
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
          // 队伍在打、位置落在身后的成员：自己沿路线往前走，但仍是队伍的人，不按下面的到达判断提前改成待命
          let pushOn = false;
          const gi = w.grp[i];
          if (gi >= 0 && tgt === NONE) {
            const g = marches[gi];
            if (!g.alive || g.arrived) w.grp[i] = -1;
            else if (!g.blocked && !g.loose && !inCombat) {
              // 只有不在打仗的时候才排队：自己进入战斗状态、或队伍已经打起来了，就各走各的
              const l = w.offL[i];
              marchSlot(g, w.offA[i], l);
              // 位置在自己前方多远（沿队列在那里的行进方向量；负数是落到了身后）
              const behind = (SLOT.x - ux) * SLOT.hx + (SLOT.y - uy) * SLOT.hy < -RULES.march.waitAhead;
              if (behind && g.battleT > 0) {
                // 位置在自己身后、队伍里又有人在打敌兵：不等位置，交给下面沿路线往前去接敌（多是走在队列前面的人）。
                // 不看位置够不够得着（走到障碍另一侧后位置常被挡住），也不像够不着位置时那样提速：他们已经在自己的位置前面，没有要追的
                pushOn = true;
              } else {
                const mode = marchFollow(w, g, l, ux, uy);
                if (mode !== FOLLOW_SLOT) w.apart[i] = 1;
                if (mode === FOLLOW_APART) {
                  // 够不着自己的位置，也看不见本排：不等，跑步沿寻路路线找路过去，过去之后再回到位置上
                  spd = run;
                } else {
                  // 瞄准要跟的那一点前方一小段：到位后正好与领队同速，落后了就跑步追
                  const ex = FOLLOW.x + SLOT.hx * g.v * 0.4 - ux, ey = FOLLOW.y + SLOT.hy * g.v * 0.4 - uy;
                  const ed = Math.sqrt(ex * ex + ey * ey);
                  if (behind) {
                    // 位置在自己身后（绕路时走到了前面）：原地站着等它走过来，不往回跑
                    wx = wy = 0;
                  } else if (ed > 0.5) {
                    let v = ed / 0.4;
                    if (v > run) v = run;
                    wx = (ex / ed) * v;
                    wy = (ey / ed) * v;
                  }
                  inFormation = true;
                }
              }
            }
          }
          // 离开编队之后迟迟不再靠近目的地（终点附近被列好阵的人挡着，在流场和直线之间来回绕）：就地算到
          let late = false;
          if (!inFormation && !pushOn && ord !== O_ATTACK) {
            if (dd < w.bestD[i] - 4) {
              w.bestD[i] = dd;
              w.noGain[i] = 0;
            } else if (dd < RULES.march.giveUpNear && (w.noGain[i] += DT) > RULES.march.giveUpAfter) late = true;
          }
          if (inFormation) {
            if (w.stuck[i] > 0) w.stuck[i] = 0;
          } else if (dd < 5 && ord !== O_ATTACK && !pushOn) arrive(w, i, true);
          else if (late) arrive(w, i, false);
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
                    const bid = routeBlocker(f.dirs, cell, K, blk, bldAt, mw);
                    if (bid >= 0 && canAttackBuilding(buildings[bid], tm, d.siege)) target[i] = -bid - 2;
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
                if (pushOn) {
                  // 队伍在打、往前走的人卡住了（多是顶在前面交手的自己人或小障碍上）：只换走法、不判到达，
                  // 没流场就申请、有就转回走流场；计时清零重新累计，免得攒到 3.5 秒、一离开这条路就被判到达。
                  // 流场也走不通的就留在原地，等队伍打完再随队走
                  if (!f) {
                    w.field[i] = w.nav.getField(tm, w.destCell[i], tick);
                    w.seekR[i] = 40;
                  } else w.seekR[i] = 0.001;
                  w.stuck[i] = 0;
                } else if (dd < 140 || sk > 3.5) arrive(w, i, false);
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
    if (!detouring) w.detourT[i] = 0;
    w.engaged[i] = overRank ? ENG_REACH : eng;
    state[i] = st;
    // 站定出手：除了骑兵，出手的那一下（以及交手期间）脚下不动，也不会被旁人挤开
    const plant = !d.mobile && !(st & S_ROUT) && (eng === 1 || w.atkAnim[i] > 0);
    // 骑兵交手时脚下可以动，但不会被自己人挤出战位；在战线后面列队等待的也一样
    // 隔着贴身距离出手的长兵器（多是站在后排）不算钉在战位上：脚下不走，但叠在自己人身上时照常被推开，
    // 否则后排一进攻击距离就原地钉住，人叠着人
    const firm = !overRank && (plant || ((eng === 1 || (w.waitT[i] > 0 && wx === 0 && wy === 0 && w.detourLoose[i] <= 0)) && !(st & (S_CHARGE | S_ROUT))));
    planted[i] = overRank ? 0 : plant ? 1 : firm ? 2 : 0;
    if (plant || posted) {
      wx = wy = 0;
      vx[i] = vy[i] = 0;
    }
    if (posted) planted[i] = 1;

    // ---- 分离（单位互不重叠）与冲撞 ----
    // 推挤只负责把已经叠在一起的人分开；冲着目标去的人贴上自己人时，下面把速度里朝向对方、又快过对方让开的那部分去掉，
    // 不再一边往前冲、一边被推回来（那样会原地来回跳，后排还会把前排一层层往里挤）
    let pxs = 0, pys = 0, pen = 0, nc = 0;
    const calm = (st & S_COMBAT) === 0, marching = calm && (order[i] === O_MOVE || order[i] === O_AMOVE);
    const gx = (ux / GRID) | 0, gy = (uy / GRID) | 0;
    const r = rad[i], r2 = r * r;
    const charging = (st & S_CHARGE) !== 0;
    // 绕行的人不受这条约束：他在绕过人群去找空位，路上没在交手的自己人让他穿过去
    // 只约束正冲着目标去的人（挤战线的那批）；回原位、赶路、溃逃的照旧能把没站定的自己人挤开
    const press = tgt !== NONE && !firm && !charging && !(st & S_ROUT) && !detouring;
    const skin = C.contactSkin, passK = C.passPush;
    // 近战不被射击中的己方远程挡住：远程射程内有目标就一直站定，又站在战线后面近战要过的地方，
    // 当成人墙的话，近战会被自己的弓手围死在后面。正在走的近战从他们身上穿过去，停下来的照常被推开
    const melee = d.melee, thru = melee && !firm && (wx !== 0 || wy !== 0);
    // 反过来，自己是站着射击的远程时，己方近战怎么叠上来都不让位（否则近战从正中穿过时重叠过了让位线，会被一路推着走）；
    // 边跑边射的不算，它自己在往人堆里走时照常受推
    const shot = !melee && eng === 1 && wx === 0 && wy === 0;
    let ousted = false;
    // 近战追击的人另看稍远一圈：正前方让不开的自己人只是把他弹开了一两像素、没贴着了，也还算顶在人墙上（「追不上」计时不回落）。
    // 只看近战，与下面往两侧绕的限定一致；远程不做这一圈
    const fwl = press && chasing && melee ? Math.sqrt(wx * wx + wy * wy) : 0;
    const wallSkin = fwl > 0 && C.stuckSkin > skin ? C.stuckSkin : skin;
    let walled = false;
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
          const rs = rr + skin, rf = rr + wallSkin;
          // 先按距离剔除：周围格子里的人大多离得远，别为他们去读别的数组
          if (d2 >= rf * rf) continue;
          const mate = team[j] === tm, pj = planted[j];
          const over = melee && mate && pj !== 0 && shooting(w, j);
          // 自己人之间可以互相穿过的三种情形：都不在打仗、有一方在行军；绕行中穿过没在交手的；正在走的近战穿过射击中的远程
          const pass = mate && ((calm && pj === 0 && !(state[j] & S_COMBAT) && (marching || order[j] === O_MOVE || order[j] === O_AMOVE))
            || (detouring && detourPasses(w, i, j)) || (over && thru));
          if (d2 < 0.01) {
            ox = ((i * 7919) % 13) - 6;
            oy = ((i * 104729) % 11) - 5;
            d2 = ox * ox + oy * oy + 0.01;
          }
          const dd = Math.sqrt(d2);
          if (mate && press && !pass) {
            const nx = -ox / dd, ny = -oy / dd;
            const away = pj === 0 ? vx[j] * nx + vy[j] * ny : 0;
            if (d2 >= rs * rs) {
              // 外面那一圈：只看正前方让不开的。判据与下面起横挪的 blocked 是同一句（夹角、让开速度不到一半），改一处另一处同改
              if (fwl > 0 && (nx * wx + ny * wy) > C.flankCos * fwl && away < fwl * 0.5) walled = true;
            } else if (nc < CN) {
              // 贴着（差一点就碰上）的自己人：记下方向和它离开的速度，下面让自己朝它走得不比它让得快
              cnx[nc] = nx;
              cny[nc] = ny;
              cnv[nc++] = away > 0 ? away : 0;
            }
          }
          if (d2 >= rs * rs) continue;
          if (dd >= rr) continue;
          // 站定的人只有被压得太狠才让一点；别人撞上站定的人，自己全让
          // 例外：没在出手的近战（列队等的、交手中的骑兵）叠在射击中的己方远程身上时照常被推开，否则穿到一半停下就一直叠着
          if (firm && dd > rr * give && (plant || mate) && !(over && !plant)) continue;
          if (shot && mate && defs[type[j]].melee) continue;
          let share = !firm && (pj === 1 || (pj === 2 && mate)) ? 1 : (rj * rj) / (r2 + rj * rj);
          if (pass) share *= passK;
          else if (over) ousted = true;
          const ov = (rr - dd) * share;
          if (ov > pen) pen = ov;
          pxs += (ox / dd) * ov;
          pys += (oy / dd) * ov;
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
    // 推挤上限要略高于自己一帧能走的距离，否则跑得快的会一点点挤进站定的人堆里；
    // 也不超过最深的那一处重叠，几处接触叠加起来不会把人推过头
    let pcap = firm || spd * DT < 2.5 ? 3 : spd * DT + 0.5;
    if (pen < pcap) pcap = pen;
    if (pm > pcap * pcap) {
      const k = pcap / Math.sqrt(pm);
      pxs *= k;
      pys *= k;
    }

    // 冲着目标去、正前方被自己人堵住：沿着他们的背后往一侧绕，找战线上的空位
    const cwx = wx, cwy = wy;
    let flank = false;
    // 只有近战绕：「追不上」的计时到点后另找、排队只管近战，远程绕起来没有尽头，况且横挪时也一直在往前凑，很快就够得着
    if (press && chasing && !detouring && d.melee && nc > 0) {
      const wl = Math.sqrt(wx * wx + wy * wy);
      if (wl > 0) {
        const fx = wx / wl, fy = wy / wl;
        let blocked = false, lat = 0;
        for (let c = 0; c < nc; c++) {
          // 正前方的人自己也在往前走、让得开的不算堵住（与上面外圈 walled 的判据同改）
          if (fx * cnx[c] + fy * cny[c] > C.flankCos && cnv[c] < wl * 0.5) blocked = true;
          lat += fx * cny[c] - fy * cnx[c];
        }
        if (blocked) {
          const sideK = C.flankSide, fwdK = Math.sqrt(1 - sideK * sideK);
          // 已经在往哪边绕就接着往哪边（旁边的人跟着前一个走，不会对撞）；还没动的往贴着的人少的一边，一样多时按编号分两边
          const vl = fx * vy[i] - fy * vx[i];
          const side = vl > 3 ? 1 : vl < -3 ? -1 : lat > 0.3 ? -1 : lat < -0.3 ? 1 : i & 1 ? 1 : -1;
          wx = (fx * fwdK - fy * side * sideK) * wl;
          wy = (fy * fwdK + fx * side * sideK) * wl;
          flank = true;
        }
      }
    }

    // ---- 积分与地形碰撞 ----
    if (windK > 0 && (wx !== 0 || wy !== 0)) {
      const f = 1 + windK * (wx * windX + wy * windY) / Math.sqrt(wx * wx + wy * wy);
      wx *= f;
      wy *= f;
    }
    let nvx = vx[i] + (wx - vx[i]) * 0.3, nvy = vy[i] + (wy - vy[i]) * 0.3;
    for (let sweep = 0; sweep < 2; sweep++) {
      for (let c = 0; c < nc; c++) {
        const into = nvx * cnx[c] + nvy * cny[c] - cnv[c];
        if (into > 0) {
          nvx -= cnx[c] * into;
          nvy -= cny[c] * into;
        }
      }
    }
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
      if (c1 !== cell && (blk[c1] || !nav.canStep(tm, cell, c1))) {
        nx = ux;
        vx[i] = 0;
        blockedByTerrain = true;
      }
      const c2 = ((ny / TILE) | 0) * mw + ((nx / TILE) | 0);
      if (c2 !== cell && (blk[c2] || !nav.canStep(tm, cell, c2))) {
        ny = uy;
        vy[i] = 0;
        blockedByTerrain = true;
      }
    }
    x[i] = nx;
    y[i] = ny;
    // 待命、坚守的近战原位压在射击中的己方远程身上：被推开多少原位就跟着挪多少，
    // 否则走回去穿进去、站住了又被推出来，在原位边上来回跳
    if (ousted && tgt === NONE && ord !== O_MOVE && ord !== O_AMOVE && ord !== O_ATTACK) {
      w.homeX[i] = nx;
      w.homeY[i] = ny;
    }
    const mvx = nx - ux, mvy = ny - uy;
    const moved = Math.sqrt(mvx * mvx + mvy * mvy);
    const want = Math.sqrt(cwx * cwx + cwy * cwy);
    if (chasing && plant && d.melee) {
      // 追击途中出手站定的那几帧（多是抛副武器；主武器刚出手、目标随即退出攻击距离的那几帧也一样）：既不算走通（不回落）、
      // 也不算没走通（不累计），计时原样留着，之后接着攒。否则落进下面回落那条分支，已攒的进度清空，这一轮横挪就超出上限
    } else if (flank) {
      // 绕向侧面找空位：不论有没有顺带往前蹭一点，都按比例记「追不上」，最多绕 blockedAfter ÷ flankStuck 秒
      w.stuck[i] += moved > want * DT * 0.3 ? DT * C.flankStuck : DT;
    } else if (want > 8 && (chasing ? mvx * cwx + mvy * cwy < want * want * DT * 0.3 : moved < want * DT * 0.3)) {
      // 追击时看的是有没有朝目标靠近：贴着人墙横着滑不算前进
      w.stuck[i] += DT;
    } else if (w.stuck[i] > 0 && nc === 0 && !walled) {
      // 还贴着冲不过去的自己人时，往目标斜着凑近一点不算走通了，计时不回落，否则会沿着人墙左右来回绕；
      // 被前排弹开一两像素、刚好没贴着的那几帧也算还顶在人墙上（walled）
      w.stuck[i] = Math.max(0, w.stuck[i] - DT * 2);
    }
    if (detouring) {
      w.stuck[i] = 0;
      // 绕行走不动（被正在交手的自己人堵在人堆里）就尽早放弃，改列队等
      detourProgress(w, i, ux, uy, nx, ny, want);
    }
    if (chasing && d.melee && w.stuck[i] > C.blockedAfter) {
      w.stuck[i] = 0;
      if (blockedByTerrain && !flank) {
        // 被地形挡住：放弃这个目标，稍后重新索敌。
        // 往两侧横挪时撞上的不算：那是被自己人挡在后面、横挪的一侧正好贴着房子，照被自己人挡住处理
        if (ord !== O_ATTACK) target[i] = NONE;
        w.ignoreT[i] = 1.5;
      } else if (tgt < NONE && ord !== O_ATTACK && !onRoute(w, i, cell, -tgt - 2, bldDist(buildings[-tgt - 2], ux, uy))) {
        // 自己挑中的建筑挤不到跟前（够得着的位置被自己人占满）：不在后面列队等，放下它接着执行原来的命令
        // （攻击移动的往目的地走，待命的回岗位），过一阵再来看有没有位置。成片的人等在一座建筑后面时，别处的敌兵没人管。
        // 挡在自己路线上的建筑（门、木栅）不放：不打通过不去，照旧列队等。
        // 放下一座之后还能改挑旁边别的；跳过期间又挤不进第二座，就这段时间里什么建筑都不挑，否则会在挨着的几座之间来回跑
        w.bldSkip[i] = w.bldSkipT[i] > 0 ? BLD_SKIP_ALL : -tgt - 2;
        w.bldSkipT[i] = C.bldSkipFor + (i & 7) * (C.bldSkipSpread / 8);
        target[i] = NONE;
      } else {
        // 被自己人挡在后面：先找一个还有空位的敌人，没有就原地列队等，不再来回乱跑
        w.avoidUid[i] = w.targetUid[i];
        w.avoidT[i] = C.avoidFor;
        let alt = NONE;
        if (ord !== O_ATTACK && tgt >= 0) {
          scan(w, i, tm, ux, uy, d.acq, d.acq, d, NONE, ord === O_IDLE ? C.leash : 0);
          alt = SCAN.pick;
          // 换过去的目标得真有空位，否则只是在两个围满的敌人之间来回跑
          if (alt !== NONE && (alt === tgt || crowded(w, d, alt, Math.hypot(x[alt] - ux, y[alt] - uy)) || w.lineBlocked(ux, uy, x[alt], y[alt], tm))) alt = NONE;
        }
        if (alt !== NONE) {
          target[i] = alt;
          w.targetUid[i] = w.uid[alt];
        } else if (!(tgt >= 0 && tryDetour(w, i, tgt, st, ord, spd, ord === O_IDLE ? idleLeash2(w, i, d, tgt) : 0, guardKeep(w, i, d, ord)))) {
          // 没有别的敌人可换、也绕不成：原地列队等
          startWait(w, i);
        }
      }
    }
    if (!eng) {
      if (nvx > 6) w.facing[i] = 1;
      else if (nvx < -6) w.facing[i] = -1;
      if (flank) aim = Math.atan2(cwy, cwx);
      else if (nvx * nvx + nvy * nvy > 64) aim = Math.atan2(nvy, nvx);
    } else if (d.traits & TR_FIREMOVE && nvx * nvx + nvy * nvy > 400) {
      // 骑射边跑边射：马头始终朝着跑的方向，骑手回身放箭（转身由渲染层表现）
      aim = Math.atan2(nvy, nvx);
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

const ONE = [0];

/**
 * 待命的单位追敌：敌人离岗位超过这个距离（的平方）就不追。据点里的守军（远程，或追打过自己的人）按据点警戒距离算；
 * 远程追的墙顶敌兵按 wallSeek 算（与 findWallFoe 挑目标时的离岗位距离一致）
 */
function idleLeash2(w: World, i: number, d: UnitDef, tgt: number): number {
  const C = RULES.combat, SITE = RULES.site;
  let r = w.sheltered[i] && (!d.melee || tgt === w.hitBy[i * 2] || tgt === w.hitBy[i * 2 + 1]) ? SITE.alarm : C.leash;
  if (!d.melee && tgt >= 0 && w.state[tgt] & S_WALL && C.wallSeek > r) r = C.wallSeek;
  return r * r * 1.2;
}
/** 据点里的近战守军不追出据点：目标在据点外、又不是最近打过自己的人，就该丢掉 */
function guardDrops(w: World, i: number, tgt: number): boolean {
  return tgt !== w.hitBy[i * 2] && tgt !== w.hitBy[i * 2 + 1] && !inSite(w, w.shelterSite[i], w.x[tgt], w.y[tgt]);
}

/** 绕行时空位所属的敌兵要满足的条件：据点里的近战守军只留不会被 guardDrops 丢掉的；其余没有限制（undefined） */
function guardKeep(w: World, i: number, d: UnitDef, ord: number): ((foe: number) => boolean) | undefined {
  return ord === O_IDLE && w.sheltered[i] === 1 && d.melee ? foe => !guardDrops(w, i, foe) : undefined;
}

/** (ux, uy) 到建筑贴边那一点的距离 */
function bldDist(b: Building, ux: number, uy: number): number {
  const px = ux < b.x0 ? b.x0 : ux > b.x1 ? b.x1 : ux, py = uy < b.y0 ? b.y0 : uy > b.y1 ? b.y1 : uy;
  return Math.hypot(px - ux, py - uy);
}

/**
 * 沿流场从 cell 往前走最多 steps 格，先碰到的走不通的格子属于哪座建筑；路上没有走不通的格子、或那一格不是建筑（地形）时是 -1
 */
function routeBlocker(dirs: Uint8Array, cell: number, steps: number, blk: Uint8Array, bldAt: Int32Array, mw: number): number {
  let c = cell;
  for (let k = 0; k < steps; k++) {
    const dr = dirs[c];
    if (dr > 7) return -1;
    c += DIRX[dr] + DIRY[dr] * mw;
    if (blk[c]) return bldAt[c];
  }
  return -1;
}

/** 判断建筑挡不挡路时，沿路线往前看的格数在「到它的直线距离」之上再多看几格：路线会绕开障碍，比直线长一点 */
const ROUTE_SLACK = 4;

/**
 * 建筑 bid 是不是挡在 i 的行军路线上：沿 i 的流场往前，先碰到的走不通的格子属于它。
 * 往前看到它那么远为止（dist 是 i 到它的距离，像素）。流场被回收了就重新取一张，并先当它挡路，否则挡路的门会被当成不挡路
 */
function onRoute(w: World, i: number, cell: number, bid: number, dist: number): boolean {
  const f = w.field[i];
  if (!f) return false;
  const tm = w.team[i];
  if (f.dead) {
    // 刚重取的这张多半还没算出来（方向都是空的），这一轮先当它挡路、照旧列队等，下一轮计时到点再判断
    w.field[i] = w.nav.getField(tm, f.cell, w.tickCount);
    return true;
  }
  return routeBlocker(f.dirs, cell, Math.ceil(dist / TILE) + ROUTE_SLACK, w.nav.block[tm], w.nav.bld, w.map.w) === bid;
}

/** 顶住的自己人的方向（单位向量），每帧最多记这么多处 */
const CN = 6;
const cnx = new Float64Array(CN), cny = new Float64Array(CN), cnv = new Float64Array(CN);

/** 最近 ticks 帧内打过 i 的、还活着且看得见的敌方远程单位（据点里的近战守军据此出击） */
function provoker(w: World, i: number, tm: number, ticks: number): number {
  for (let k = 0; k < 2; k++) {
    const o = i * 2 + k, a = w.hitBy[o];
    if (a < 0 || !w.alive[a] || w.uid[a] !== w.hitByUid[o] || w.team[a] === tm) continue;
    if (w.tickCount - w.hitByTick[o] > ticks || w.defs[w.type[a]].melee || !(w.seen[a] & (1 << tm))) continue;
    return a;
  }
  return NONE;
}

/** 点是否在据点范围内（据点不存在时算在内） */
function inSite(w: World, site: number, px: number, py: number): boolean {
  const s = w.sites[site];
  return !s || siteContains(s, px, py);
}
