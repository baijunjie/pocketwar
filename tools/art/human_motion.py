import math

from mathutils import Vector

import unhorse
from horse import carried, model, turned
from mesh import Pose, bend, clip, mix, point, turn
from rome import HIP, LOWER_ARM, SHIN, SIDE, THIGH, UPPER_ARM
from strikes import STRIKES, VARIANTS

TIMING = {
    "idle": 3.2, "ready": 2.4, "walk": .96, "run": .66, "charge": .66,
    "attack": 50 / 60, "attack2": .90, "attack3": .80, "attackMove": .84, "attackMoveL": .84, "attackMoveR": .84,
    "attackMoveBL": .84, "attackMoveBR": .84, "die": 1.3, "brace": 2.8,
    "guard": 2.8, "guardWalk": .96,
}
LOOP = {"idle", "ready", "walk", "run", "charge", "attackMove", "brace", "guard", "guardWalk"}
STRIDE = {"walk": 1.32, "run": 2.46}
HIT_TIME = .1333333333
DIRECTIONS = {"attackMoveL": 90, "attackMoveR": -90, "attackMoveBL": 140, "attackMoveBR": -140}

# 腕的目标点用各兵器的握法定姿。护盾朝向与左肘弯曲分别控制。
HOLD = {
    "generic": ((-.248, .17, 1.09), (.253, .17, 1.09), (0, 0, 0), (0, 0, 0)),
    "sword_shield": ((-.25, .13, 1.06), (.17, .29, 1.12), (46, 1, -17), (-9, 0, -9)),
    "spear_shield": ((-.27, .16, 1.20), (.19, .28, 1.10), (-58, 0, 1), (-9, 0, -11)),
    "javelin": ((-.28, .10, 1.51), (.24, .24, 1.06), (-18, 2, -12), (-3, 4, -19)),
    "bow": ((-.072, .16, 1.455), (.175, .57, 1.47), (0, 0, 0), (-7, -7, -9)),
    "ride_lance": ((-.29, .19, 1.22), (.21, .24, 1.16), (-52, 0, -4), (0, 0, -16)),
}
# 出手帧的位置与兵器方向。挥出后继续走少量弧度，以免命中时骤停。
CONTACT = {
    "generic": ((-.21, .45, 1.31), (.22, .22, 1.13), (0, 0, 0), (0, 0, 0)),
    "sword_shield": ((-.14, .47, 1.23), (.20, .29, 1.12), (-4, 2, 4), (-6, 0, -9)),
    "spear_shield": ((-.19, .47, 1.28), (.22, .30, 1.12), (-4, 0, 2), (-6, 0, -10)),
    "javelin": ((-.17, .45, 1.51), (.22, .23, 1.11), (-4, 0, 6), (-2, 2, -17)),
    "bow": ((-.141, -.025, 1.483), (.143, .70, 1.526), (0, 0, 0), (1, 1, -3)),
    "ride_lance": ((-.24, .44, 1.26), (.24, .24, 1.14), (-7, 0, 1), (0, 0, -16)),
}
# 马上的骑枪收在身侧（待命、临战、行进）时再往外撇开的角度（侧倾、偏航）：照握法枪尾贴着马腹往后下方斜，
# 会戳进马的后腿根，披甲的马外面还挂着搭后。枪绕着握点转，枪尾向外让开约 14 厘米，枪尖相应向里。
# 平刺出手时收回原来的枪路，冲锋端平的枪不受影响。
LANCE_SPLAY = Vector((0, -5, 7))
# 骑枪手使出手变体时右肘的朝向：收在身侧偏下。照平时那样朝外撑开的话，肘正挡在握点后面那截枪杆的去路上，
# 枪尖一抬一落，枪杆就从肘里穿过去。
LANCE_ELBOW = (-.25, -.55, -.80)


def ease(t):
    t = min(1, max(0, t))
    return t * t * (3 - 2 * t)


def envelope(seconds, keys):
    for (a, u), (b, v) in zip(keys, keys[1:]):
        if seconds <= b:
            return u + (v - u) * ease((seconds - a) / (b - a))
    return keys[-1][1]


def ground_step(phase, stride, duty, lift):
    phase %= 1
    reach = stride * duty / 2
    if phase < duty:
        f = reach - stride * phase
        roll = 13 * ease((phase - (duty - .115)) / .115)
        return f, .039 * ease((phase - duty + .105) / .105), roll
    swing = (phase - duty) / (1 - duty)
    bump = math.sin(math.pi * swing)
    f = -reach + 2 * reach * ease(swing)
    return f, lift * bump ** 1.35 + .039 * (1 - ease(swing / .28)), 13 * (1 - ease(swing / .42)) - 12 * bump


def arm(p, side, target, attitude, pole):
    upper, lower, hand, weapon = (n + "." + side for n in ("upper_arm", "forearm", "hand", "weapon"))
    p.set("shoulder." + side)
    # upper_arm 的关节位于锁骨末端，使用胸骨旋转后的绑定坐标。
    socket = p.transforms["shoulder." + side] @ Vector((0, p.rig.data.bones["shoulder." + side].length, 0))
    a = Vector((socket.x, -socket.y, socket.z))
    ray = Vector(target) - a
    b = a + ray.normalized() * min(ray.length, UPPER_ARM + LOWER_ARM - .008)
    elbow = bend(a, b, UPPER_ARM, LOWER_ARM, pole)
    p.set(upper, aim=elbow-a)
    p.set(lower, aim=b-elbow)
    p.set(hand, delta=attitude)
    p.set(weapon, delta=attitude)
    return p.anchor(weapon)


def leg(p, side, foot, pitch, mounted):
    thigh, shin, ankle, toe = (n + "." + side for n in ("thigh", "shin", "foot", "toe"))
    inherited = p.transforms["hips"] @ p.rest["hips"].inverted() @ p.rest[thigh]
    v = inherited.translation
    hip = Vector((v.x, -v.y, v.z))
    ray = Vector(foot) - hip
    foot = hip + ray.normalized() * min(ray.length, THIGH + SHIN - .002)
    pole = (SIDE[side] * (.65 if mounted else .13), 1, .12)
    knee = bend(hip, foot, THIGH, SHIN, pole)
    p.set(thigh, aim=knee-hip)
    p.set(shin, aim=foot-knee)
    p.set(ankle, delta=turn(x=pitch, z=SIDE[side] * (19 if mounted else 5)))
    p.set(toe, local=turn(x=-.65 * max(0, pitch)))


def human_pose(rig, stance, movement, phase, lancer=False):
    """摆出 stance 姿态下 movement 动作在 phase 处的姿势。

    lancer 给马上真拿着骑枪的骑手开：收着的枪往外撇开，让开马身（见 LANCE_SPLAY），
    使出手变体时右肘收到身侧（见 LANCE_ELBOW）。
    借这套坐姿摆别的骑乘者（如象夫）时不开，他们的动作不受影响。
    """
    mounted = stance.startswith("ride_")
    if movement == "die" and mounted:
        # 骑手阵亡是落马：从待命的坐姿开始，身子与两腿照 unhorse 摆，两臂与兵器按持械姿态接着摆。
        human_pose(rig, stance, "idle", 0, lancer)
        unhorse.fall(rig, phase * TIMING[movement], bow_fall if stance == "ride_bow" else lance_fall, lift=.02)
        return
    p = Pose(rig)
    p.set("root")
    grip = "bow" if stance == "ride_bow" else stance
    t = phase * TIMING[movement]
    wave = math.tau * phase
    moving = movement in ("walk", "run", "charge", "guardWalk", "attackMove")
    fast = movement in ("run", "charge", "attackMove")
    attack = movement.startswith("attack")
    alternate = STRIKES[grip][VARIANTS.index(movement)] if movement in VARIANTS else None
    crouch = movement in ("ready", "guard", "guardWalk", "brace")
    yaw = DIRECTIONS.get(movement, 0)
    right, left, r_turn, l_turn = HOLD[grip]
    if movement == "die":
        fall = envelope(t, ((0, 0), (.16, .04), (.54, .63), (.90, 1), (1.035, .96), (1.3, 1)))
        twist = 16 + 36 * fall
        p.set("hips", head=(.38*fall, -.12*fall, HIP - .715 * fall), delta=turn(x=-28*fall, f=80*fall, z=twist*fall))
        p.set("spine", local=turn(x=9 + 16*fall))
        p.set("chest", local=turn(x=8*fall, z=-14*fall))
        p.set("neck", local=turn(x=12*fall))
        p.set("head", local=turn(f=-7*fall))
        p.set("mantle", local=turn(x=9*fall))
        settle = envelope(t, ((0, 0), (.22, .12), (.54, .63), (.90, 1), (1.30, 1)))
        for side, s in SIDE.items():
            # 尸体侧卧时，靠地的手臂向外撑，另一侧让盾面或弓身贴地。
            if side == "L":
                wrist = (.35, .35, .105 if grip == "bow" else .18)
                aiming = turn(*mix(l_turn, (83, 0, 8), settle))
                arm(p, side, mix(left, wrist, settle), aiming, mix((.8, -.55, -.65), (0, .96, -.30), settle))
            else:
                wrist = (-.27, -.34, .098)
                aiming = turn(*mix(r_turn, (1, 0, -97), settle))
                arm(p, side, mix(right, wrist, settle), aiming, mix((-.8, -.55, -.65), (-.32, -.86, .27), settle))
            p.set("thigh." + side, local=turn(x=-8 - (8+10*s)*fall))
            p.set("shin." + side, local=turn(x=9 + 29*fall))
            p.set("foot." + side)
            p.set("toe." + side)
        p.set("bowstring")
        return

    strike = envelope(t, ((0, 0), (.033, -.13), (.075, .28), (HIT_TIME, 1),
                          (.20, 1.07), (.39, .58), (.68, .04), (.84, 0))) if attack else 0
    follow = envelope(t, ((0, 0), (.10, -.50), (.18, 1), (.32, .31), (.64, 0))) if attack else 0
    right, left, r_turn, l_turn = (Vector(v) for v in (right, left, r_turn, l_turn))
    lancer = lancer and grip == "ride_lance"
    # 兵器离开待命握法几成：出手变体从蓄力到收回来之前都是 1。
    away = 0
    if alternate:
        hold = (right, left, r_turn + LANCE_SPLAY if lancer else r_turn, l_turn)
        duration = TIMING[movement]
        if t < .045:
            start, stop, amount = hold, alternate.windup, ease(t/.045)
            away = amount
        elif t <= HIT_TIME:
            start, stop, amount = alternate.windup, alternate.contact, ease((t-.045)/(HIT_TIME-.045))
            away = 1
        elif t <= .24:
            start, stop, amount = alternate.contact, alternate.release, ease((t-HIT_TIME)/(.24-HIT_TIME))
            away = 1
        else:
            # 收势：先依次靠向 recover 里的架势，最后回到待命的握法；各段按各自的时段走，可以前后叠着。
            spent = (t-.24)/(duration-.24)
            start = alternate.release
            for (a, b), pose in alternate.recover:
                start = [mix(u, v, ease((spent-a)/(b-a))) for u, v in zip(start, pose)]
            a, b = alternate.settle
            stop, amount = hold, ease((spent-a)/(b-a))
            away = 1 - amount
        right, left, r_turn, l_turn = [mix(a, b, amount) for a, b in zip(start, stop)]
    elif attack:
        contact = CONTACT[grip]
        right, left, r_turn, l_turn = [mix(a, b, strike) for a, b in zip((right, left, r_turn, l_turn), contact)]
        if lancer:
            r_turn += LANCE_SPLAY * (1 - min(1, max(0, strike)))
    elif lancer:
        r_turn += LANCE_SPLAY
    if grip == "javelin" and attack and not alternate:
        right += Vector((.091, .013, -.277)) * max(0, follow)
        r_turn.x += 31 * max(0, follow)
    if grip == "bow" and not attack and movement != "ready":
        right += Vector((-.058, -.01, -.17 if not moving else -.27))
        left += Vector((.05, -.17, -.14 if not moving else -.24))
        l_turn.x -= 16
    if movement in ("guard", "guardWalk"):
        left += Vector((-.135, .097, .29))
        l_turn = Vector((-62, -8, 0))
        right += Vector((-.033, -.098, -.065))
    if movement == "brace":
        right += Vector((.016, .018, -.226))
        r_turn = Vector((-76, 0, -4))
        left.z += .064
    if movement == "charge":
        right += Vector((-.01, .144, -.02))
        r_turn = Vector((-6, 0, -4))

    sway = (.016 if moving else .013) * math.sin(wave)
    if mounted:
        height = HIP
        sway *= .55
        height += (.019 if fast else .009) * math.cos(wave)
    elif moving:
        height = (.830 if fast else .883) - (.034 if crouch else 0)
        height += (.039 if fast else .018) * math.cos(2 * wave - 2.1)
    else:
        height = .917 - (.035 if crouch or attack else 0) - .028*strike + .006 * math.sin(wave)
    lean, roll, twist, lunge = alternate.torso if alternate else (14, 0, -12 if grip == "bow" else 23, .09)
    hip_f = 0 if mounted else (lunge * strike + (.030 if fast else .009) * math.sin(2 * wave))
    steps = {}
    if moving and not mounted:
        for side in SIDE:
            f, lift, pitch = ground_step(phase + (0 if side == "R" else .5),
                                          STRIDE["run" if fast else "walk"], .39 if fast else .61,
                                          .239 if fast else .105)
            steps[side] = (f, lift, pitch)
            # 先移动骨盆到可达区间，避免 IK 为够远处落脚点把脚整段抬高。
            limit = .108 + lift + math.sqrt((THIGH + SHIN - .014)**2 - (f-hip_f)**2)
            blend = max(.03 - abs(height-limit), 0) / .03
            height = min(height, limit) - .0075*blend**2
    shift = -.038 if alternate and twist < 0 else .035
    p.set("hips", head=(sway - shift*strike, hip_f, height),
          delta=turn(x=(8 if fast else 2), f=3*math.sin(wave)+roll*strike*.28,
                     z=-7*math.sin(wave) if moving else (twist*.14 if alternate else -5)*strike))
    p.set("spine", local=turn(x=.57*lean*strike + (5 if fast else 0),
                              z=(5*math.sin(wave) if moving else 0)+yaw*.27))
    if alternate:
        chest_turn = twist*strike + math.copysign(7, twist)*follow
        if grip == "bow":
            chest_turn += -22 + 32*strike
    else:
        chest_turn = -22 + 10*strike if grip == "bow" else 23*strike + 7*follow
    p.set("chest", local=turn(x=-3*math.sin(wave) + .43*lean*strike, f=roll*strike*.72,
                              z=chest_turn + yaw*.61))
    p.set("neck", local=turn(x=3*math.sin(wave), z=-chest_turn*.43+yaw*.12))
    p.set("head", local=turn(f=-2*math.sin(wave), z=-chest_turn*.25))
    p.set("mantle", local=turn(x=-(11 if fast else 2)+5*math.sin(wave-.8)-10*follow,
                                f=2*math.cos(wave), z=-9*follow))
    raise_wrist = height - HIP + (.012*math.sin(wave-.6))
    y_rotation = turn(z=yaw)
    for side, target, attitude in (("L", left, l_turn), ("R", right, r_turn)):
        s = SIDE[side]
        target += Vector((sway, hip_f, raise_wrist))
        if moving and not attack:
            target += Vector((0, (.10 if stance == "generic" else .041)*s*math.sin(wave), .021*s*math.cos(wave)))
            attitude.x += 9*s*math.sin(wave-.65)
        if yaw:
            rotated = y_rotation @ Vector((target.x, -target.y, 0))
            target.x, target.y = rotated.x, -rotated.y
            attitude.z += yaw
        elbow_pole = (s*.80, -.55, .29 if grip == "bow" and side == "R" and (attack or movement == "ready") else -.65)
        if lancer and side == "R" and away:
            elbow_pole = mix(elbow_pole, LANCE_ELBOW, away)
        wrist = arm(p, side, target, turn(*attitude), elbow_pole)
        if side == "R":
            draw_hand = wrist
        if mounted:
            ankle = (s*.267, -.055 + .019*math.sin(wave), .41 + height - HIP)
            pitch = 8 + 6*math.sin(wave-.3)
        elif moving:
            f, lift, pitch = steps[side]
            ankle = (s*.105, f, .108+lift)
        else:
            lead = 1 if not alternate or twist < 0 else -.85
            f = (.215*lead if attack else .215 if crouch else .086) * s
            ankle = (s*(.119 if crouch else .100), f, .108)
            pitch = 0
        leg(p, side, ankle, pitch, mounted)

    p.set("bowstring")
    if grip == "bow":
        # 拉弦时最多退 26 cm。松弦在命中帧完成，弦回弹后停稳。
        cord = p.anchor("bowstring")
        if attack:
            draw_start = alternate.draw if alternate else .82
            draw = envelope(t, ((0, draw_start), (.09 if alternate else .095, 1),
                                (HIT_TIME, 0), (.22, .08), (.31, 0), (TIMING[movement], draw_start)))
        else:
            draw = .82 if movement == "ready" else .15
        extension = draw_hand - cord
        if extension.length > .26:
            extension = extension.normalized() * .26
        # 用未拉开的骨骼位置作为基准，覆盖时不重复叠加偏移。
        p.set("bowstring", head=cord + extension * draw)
    if mounted:
        seat_origin(p)


# 腕到指尖的长度，指尖离地至少这么高。
FINGERS, FINGERTIP = .12, .03


def thrown_arm(p, side, wrist, pole, attitude=None):
    """落马时的一条手臂：腕落在 wrist，手顺着小臂，指尖要扎进地里时把手掌放平。

    attitude 是手里兵器的朝向，不给就跟着手。
    """
    hand = "hand." + side
    arm(p, side, wrist, attitude or turn(), pole)
    p.set(hand)
    reach = model(p.transforms[hand].to_quaternion() @ Vector((0, FINGERS, 0)))
    wrist = p.anchor(hand)
    if wrist.z + reach.z < FINGERTIP:
        rise = min(FINGERTIP - wrist.z, FINGERS*.8)
        level = Vector((reach.x, reach.y, 0)).normalized()*math.sqrt(FINGERS**2 - rise**2)
        p.set(hand, aim=level + Vector((0, 0, rise)))
    p.set("weapon." + side, delta=attitude)


def reaching_arm(p, t, carry=None, rest=None):
    """落马时的右臂：离鞍后朝倒下去的那边伸出去够地，落地后顺着地面伸过头顶，头枕在上面。

    carry、rest 是手里兵器待命时与落地后的朝向，空手不给。
    """
    wrist = mix(carried(p, "chest", (-.42, .18, 1.62)), unhorse.REACH, unhorse.ramp(t, .56, .76))
    wrist.z = max(wrist.z, unhorse.REACH[2])
    attitude = carry and carry.slerp(rest, unhorse.ramp(t, .22, .62))
    thrown_arm(p, "R", wrist, unhorse.toward(p, (-.3, -.8, -.3), "chest"), attitude)


def flung_arm(p, t, down, carry=None, rest=None):
    """落马时的左臂：离鞍时扬起来，落地后落到 down。carry、rest 是手里的东西待命时与落地后的朝向，空手不给。"""
    wrist = mix(carried(p, "chest", (.40, .10, 1.70)), down, unhorse.ramp(t, .60, .90))
    attitude = carry and carry.slerp(rest, unhorse.ramp(t, .35, .85))
    thrown_arm(p, "L", wrist, unhorse.toward(p, (.6, -.7, -.2), "chest"), attitude)
    p.set("bowstring")


def borne(p, held, bone):
    """待命时拿在手里的东西跟着胸转到现在的朝向；held 是待命坐姿里各骨骼的朝向（见 unhorse.fall）。"""
    return turned(p, "chest") @ held["chest"].inverted() @ held[bone]


def lance_fall(p, t, held):
    """落马时持枪、持盾的两臂：枪横握在手里，平放在头前的地上，与马身平行；左手落在胯上，盾贴着身侧盖在上面。

    没有盾的骑手（中国铁骑）共用这个动作，左手一样搭在胯上。
    """
    reaching_arm(p, t, held["weapon.R"], turn(f=-90, z=-10))
    flung_arm(p, t, carried(p, "hips", (.25, .03, .88)), borne(p, held, "weapon.L"), turned(p, "hips") @ turn(z=90))


def bow_fall(p, t, held):
    """落马时持弓的两臂：右手空着，左手连弓落在胸前，弓平躺在地上。"""
    reaching_arm(p, t)
    flung_arm(p, t, (-1.85, .46, .045), borne(p, held, "weapon.L"), turn(f=90, z=-10))


def seat_origin(p):
    # 骑乘动作把髋部摆到原点，与坐骑的 saddle 重合。
    # 共享绑定姿态的 hips 仍保留站立高度，所有子骨随这一个偏移移动。
    p.rig.pose.bones["hips"].location -= p.rest["hips"].to_quaternion().inverted() @ point((0, 0, HIP))


def animate_human(rig, stances):
    for movement in (name for name in TIMING if name not in VARIANTS):
        stance = "ride_bow" if movement in DIRECTIONS else "generic"
        clip(rig, movement, TIMING[movement],
             lambda phase: human_pose(rig, stance, movement, phase), movement in LOOP)
    for stance in stances:
        movements = ["idle", "ready", "walk", "run", "attack", *VARIANTS, "die"]
        if stance == "sword_shield":
            movements += ["guard", "guardWalk"]
        if stance == "spear_shield":
            movements += ["brace", "charge"]
        if stance == "ride_lance":
            movements.append("charge")
        if stance in ("javelin", "bow"):
            movements.append("attackMove")
        for movement in movements:
            name = stance + "." + movement
            clip(rig, name, TIMING[movement],
                 lambda phase: human_pose(rig, stance, movement, phase, lancer=True), movement in LOOP)
