import math

from mathutils import Vector

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


def human_pose(rig, stance, movement, phase):
    p = Pose(rig)
    p.set("root")
    mounted = stance.startswith("ride_")
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
        height = HIP - (.135 if mounted else .715) * fall
        p.set("hips", head=((.12 if mounted else .38)*fall, -.12*fall, height),
              delta=turn(x=(-12 if mounted else -28)*fall, f=(15 if mounted else 80)*fall, z=twist*fall))
        body_roll = .32 if mounted else 1
        p.set("spine", local=turn(x=9 + 16*fall))
        p.set("chest", local=turn(x=8*fall, z=-14*fall))
        p.set("neck", local=turn(x=12*fall))
        p.set("head", local=turn(f=-7*fall))
        p.set("mantle", local=turn(x=9*fall))
        settle = envelope(t, ((0, 0), (.22, .12), (.54, .63), (.90, 1), (1.30, 1)))
        for side, s in SIDE.items():
            if mounted:
                p.set("shoulder." + side)
                p.set("upper_arm." + side, local=turn(f=s*(11 + 44*fall)))
                p.set("forearm." + side, local=turn(x=-(35 - 15*fall)))
                p.set("hand." + side)
                p.set("weapon." + side)
            else:
                # 尸体侧卧时，靠地的手臂向外撑，另一侧让盾面或弓身贴地。
                if side == "L":
                    wrist = (.35, .35, .105 if grip == "bow" else .18)
                    aiming = turn(*mix(l_turn, (83, 0, 8), settle))
                    arm(p, side, mix(left, wrist, settle), aiming, mix((.8, -.55, -.65), (0, .96, -.30), settle))
                else:
                    wrist = (-.27, -.34, .098)
                    aiming = turn(*mix(r_turn, (1, 0, -97), settle))
                    arm(p, side, mix(right, wrist, settle), aiming, mix((-.8, -.55, -.65), (-.32, -.86, .27), settle))
            p.set("thigh." + side, local=turn(x=-(36 if mounted else 8) - (8+10*s)*fall*body_roll,
                                             f=s*(26 if mounted else 0)))
            p.set("shin." + side, local=turn(x=9 + 29*fall))
            p.set("foot." + side)
            p.set("toe." + side)
        p.set("bowstring")
        if mounted:
            seat_origin(p)
        return

    strike = envelope(t, ((0, 0), (.033, -.13), (.075, .28), (HIT_TIME, 1),
                          (.20, 1.07), (.39, .58), (.68, .04), (.84, 0))) if attack else 0
    follow = envelope(t, ((0, 0), (.10, -.50), (.18, 1), (.32, .31), (.64, 0))) if attack else 0
    right, left, r_turn, l_turn = (Vector(v) for v in (right, left, r_turn, l_turn))
    if alternate:
        hold = (right, left, r_turn, l_turn)
        duration = TIMING[movement]
        if t < .045:
            start, stop, amount = hold, alternate.windup, ease(t/.045)
        elif t <= HIT_TIME:
            start, stop, amount = alternate.windup, alternate.contact, ease((t-.045)/(HIT_TIME-.045))
        elif t <= .24:
            start, stop, amount = alternate.contact, alternate.release, ease((t-HIT_TIME)/(.24-HIT_TIME))
        else:
            start, stop, amount = alternate.release, hold, ease((t-.24)/(duration-.24))
        right, left, r_turn, l_turn = [mix(a, b, amount) for a, b in zip(start, stop)]
    elif attack:
        contact = CONTACT[grip]
        right, left, r_turn, l_turn = [mix(a, b, strike) for a, b in zip((right, left, r_turn, l_turn), contact)]
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
                 lambda phase: human_pose(rig, stance, movement, phase), movement in LOOP)
