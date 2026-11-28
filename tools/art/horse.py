"""战马的动作：待命、行军（快步）、奔跑（袭步）、倒地。

每一帧先定四蹄：支撑期蹄尖钉在随步幅后移的地面上，摆动期球节走一条抬高的弧、蹄随俯仰曲线甩动；
再定躯干的起伏与俯仰；最后由蹄反解各关节。前肢的腕在支撑期锁直、摆动期屈曲；后肢的后膝与飞节按固定比例一起屈伸。
"""

import math
from functools import cache

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

from horse_gaits import DURATION, GAITS, STRIDE
from horse_tack import STYLES, build_horse
from horse_rig import CHEST as CHEST_REST
from horse_rig import HEEL, JOINTS, LEGS, LIMB_X, LUMBOSACRAL, SIDE, horse_skeleton, limb_bones, limb_joints
from mesh import Pose, bend, clip, point, turn

__all__ = ("STRIDE", "STYLES", "animate_horse", "check_barding", "horse_mesh", "horse_pose", "horse_skeleton")

FORWARD = Vector((0, 1, 0))
CHEST = Vector(CHEST_REST)
# 支撑期走到这里蹄踵开始离地，蹄绕蹄尖翻起。
ROLL_START = .70
# 肩胛随前肢前伸后摆而转的比例与限度（度）。
SCAPULA_SWING, SCAPULA_LIMIT = .40, 14
# 真马的后膝与飞节被腱连着，只能一起屈伸：飞节的屈曲是后膝的这么多倍；后肢的屈伸范围（度，相对站立）。
HOCK_RATIO = 1.15
HIND_RANGE = (-22, 62)
# 肢体伸到头时留的余量（米），不让肘、膝完全拉直。
SLACK = .004
# 前肢摆动时「肩—肘—球节」夹角的范围与腕屈曲的上限（度）。
ELBOW_RANGE = (98, 150)
FOLD_LIMIT = 125

# 各步态的造型：track 是蹄迹到中线的距离，sink 是负重时球节下沉的角度，follow 是摆动两端蹄速与地面接上的程度，
# apex 是摆动期里蹄最高的时刻；pitch 是摆动期蹄的俯仰（蹄尖朝下为正，第一个值就是离地时翻起的角度），
# fold 是前肢摆动期腕的屈曲。角度都是度。
MOTION = {
    "walk": {
        "track": .105, "follow": .2,
        "sink": {"fore": 20, "hind": 17},
        "apex": {"fore": .44, "hind": .40},
        "pitch": {
            "fore": ((0, 52), (.22, 86), (.45, 78), (.70, 28), (.88, -8), (1, 0)),
            "hind": ((0, 56), (.20, 84), (.42, 62), (.68, 24), (.88, -6), (1, 0)),
        },
        "fold": ((0, 8), (.12, 50), (.30, 88), (.45, 96), (.64, 56), (.80, 8), (1, 0)),
    },
    "run": {
        "track": .085, "follow": .15,
        "sink": {"fore": 24, "hind": 20},
        "apex": {"fore": .44, "hind": .40},
        "pitch": {
            "fore": ((0, 60), (.22, 112), (.45, 118), (.70, 44), (.88, -10), (1, 0)),
            "hind": ((0, 60), (.20, 100), (.42, 84), (.70, 30), (.88, -8), (1, 0)),
        },
        "fold": ((0, 10), (.12, 62), (.26, 100), (.42, 114), (.64, 70), (.84, 10), (1, 0)),
    },
}


def horse_mesh(rig, style="rome"):
    """style 是马的样式（horse_tack.STYLES）：阵营名是初级形态，加 _e 是披甲的高级形态。"""
    return build_horse(rig, style)


def spline(t, keys):
    """过各关键点的光滑曲线，切线取两侧差商的平均，首尾为零。"""
    def slope(j):
        if j <= 0 or j >= len(keys) - 1:
            return 0
        (a, u), (b, v), (c, w) = keys[j-1], keys[j], keys[j+1]
        return ((v - u)/(b - a) + (w - v)/(c - b))/2

    for i, ((a, u), (b, v)) in enumerate(zip(keys, keys[1:])):
        if t <= b or i == len(keys) - 2:
            h = b - a
            s = min(1, max(0, (t - a)/h))
            return ((2*s**3 - 3*s**2 + 1)*u + (s**3 - 2*s**2 + s)*h*slope(i)
                    + (3*s**2 - 2*s**3)*v + (s**3 - s**2)*h*slope(i + 1))


def ease(t):
    t = min(1, max(0, t))
    return t*t*(3 - 2*t)


def pitched(v, degrees):
    """绕横轴转，正角让朝前的向量低头，与 turn(x=) 同向。"""
    c, s = math.cos(math.radians(degrees)), math.sin(math.radians(degrees))
    return Vector((v.x, v.y*c + v.z*s, -v.y*s + v.z*c))


def model(v):
    """Blender 坐标换回模型坐标（横向、前向、高度）。"""
    return Vector((v.x, -v.y, v.z))


def carried(p, bone, rest_point):
    """绑定姿势里的一点随 bone 运动后的位置。"""
    return model(p.transforms[bone] @ p.rest[bone].inverted() @ point(rest_point))


def turned(p, bone):
    """bone 相对绑定姿势转过的角度。"""
    return p.transforms[bone].to_quaternion() @ p.rest[bone].to_quaternion().inverted()


def flex(p, name, x=0, f=0, z=0):
    """让一根骨在父骨自己的轴上转：躯干侧倒以后，四肢、颈、尾照样是屈伸而不是乱拧。"""
    frame = turned(p, p.rig.pose.bones[name].parent.name)
    p.set(name, local=frame @ turn(x=x, f=f, z=z) @ frame.inverted())


def joints(pair, side):
    return tuple(map(Vector, limb_joints(pair, side)))


@cache
def spans(pair):
    points = JOINTS[pair]
    return tuple(math.dist(a, b) for a, b in zip(points, points[1:]))


def corner(a, b, c):
    """折线 a-b-c 在 b 处的夹角（度）。"""
    u, v = Vector(a) - Vector(b), Vector(c) - Vector(b)
    return math.degrees(u.angle(v))


@cache
def hoof_shape(pair):
    """蹄冠相对蹄尖、球节相对蹄冠的位置，以及蹄底的长度。"""
    *_, fetlock, coronet, toe = JOINTS[pair]
    return (Vector((0, coronet[0] - toe[0], coronet[1] - toe[1])),
            Vector((0, fetlock[0] - coronet[0], fetlock[1] - coronet[1])), toe[0] - HEEL[pair])


def resting_hoof(pair, side):
    toe = JOINTS[pair][-1]
    return Vector((SIDE[side]*LIMB_X, toe[0], 0)), 0, 0, 0


def moving_hoof(pair, side, gait, phase):
    """蹄尖的位置、蹄的俯仰、球节的下沉、腕屈曲的意向。地面以每周期一个步幅的速度后移。"""
    strike, duty, center, lift = GAITS[gait][pair, side]
    style = MOTION[gait]
    stride = STRIDE[gait]
    travel = stride*duty
    landing = center + travel/2
    progress = (phase - strike) % 1
    x = SIDE[side]*style["track"]
    if progress < duty:
        w = progress/duty
        pitch = style["pitch"][pair][0][1]*ease((w - ROLL_START)/(1 - ROLL_START))
        load = math.sin(math.pi*min(1, w/.82))**1.2
        fold = style["fold"][0][1]*ease((w - .88)/.12) if pair == "fore" else 0
        return Vector((x, landing - stride*progress, 0)), pitch, style["sink"][pair]*load, fold

    u = (progress - duty)/(1 - duty)
    # 摆动期跟的是球节：它从离地处到落地处走一条抬高的弧，蹄挂在球节下面随俯仰甩动，所以蹄尖先拖后、落地前才伸到前面。
    # 三次曲线的两端带着向后的速度：离地后还随地面退一小段，落地前先往回收，不是直直戳下去。
    crown, pastern, sole = hoof_shape(pair)
    reach = crown + pastern
    start = pitched(reach, style["pitch"][pair][0][1])
    speed = -stride*(1 - duty)*style["follow"]
    span = travel + reach.y - start.y
    forward = landing - travel + start.y + span*(3*u*u - 2*u**3) + speed*(u - 3*u*u + 2*u**3)
    pitch = spline(u, style["pitch"][pair])
    arc = math.sin(math.pi*u**(math.log(.5)/math.log(style["apex"][pair])))**1.15
    height = start.z + (reach.z - start.z)*ease(u) + lift*arc
    toe = Vector((x + SIDE[side]*.018*math.sin(math.pi*u), forward, height)) - pitched(reach, pitch)
    # 蹄尖上翘时最低的是蹄踵；蹄的最低点不许碰地。
    toe.z = max(toe.z, .012*math.sin(math.pi*u) + max(0, -sole*math.sin(math.radians(pitch))))
    fold = spline(u, style["fold"]) if pair == "fore" else 0
    return toe, pitch, 0, fold


def digit(pair, toe, pitch, sink):
    """由蹄尖推出蹄冠与球节；球节下沉就是系骨绕蹄冠向后放平。"""
    crown, pastern, _ = hoof_shape(pair)
    coronet = toe + pitched(crown, pitch)
    return coronet, coronet + pitched(pastern, pitch - sink)


def solve_fore(p, side, hoof):
    toe, pitch, sink, fold = hoof
    pivot_rest, shoulder_rest = joints("fore", side)[:2]
    _, upper, forearm, cannon, _, _ = spans("fore")
    coronet, fetlock = digit("fore", toe, pitch, sink)
    pivot = carried(p, "chest", pivot_rest)
    reach = fetlock - pivot
    rest = joints("fore", side)[4] - pivot_rest
    swing = math.degrees(math.atan2(reach.y, -reach.z) - math.atan2(rest.y, -rest.z))
    swing = max(-SCAPULA_LIMIT, min(SCAPULA_LIMIT, SCAPULA_SWING*swing))
    shoulder = pivot + pitched(carried(p, "chest", shoulder_rest) - pivot, -swing)
    gap = (fetlock - shoulder).length

    def chord_at(degrees):
        return math.sqrt(forearm**2 + cannon**2 + 2*forearm*cannon*math.cos(math.radians(degrees)))

    def chord_for(elbow):
        """肘角为 elbow 时，肘到球节该有多长才够得着。"""
        c, s = math.cos(math.radians(elbow)), math.sin(math.radians(elbow))
        return upper*c + math.sqrt(max(0, gap*gap - (upper*s)**2))

    chord = chord_at(fold)
    if fold > 0:
        # 腕的屈曲只是个意向：肘快拉直了就少屈一点，肘折得太紧就多屈一点，前肢才不会够不着或缩成一团。
        chord = max(chord_for(ELBOW_RANGE[1]), min(chord, chord_for(ELBOW_RANGE[0])))
        chord = max(chord_at(FOLD_LIMIT), min(chord_at(0), chord))
    limit = upper + chord - SLACK
    target = fetlock if gap <= limit else shoulder + (fetlock - shoulder)*(limit/gap)
    elbow = bend(shoulder, target, upper, chord, -FORWARD)
    straight = chord > forearm + cannon - .001
    knee = elbow + (target - elbow)*(forearm/chord) if straight else bend(elbow, target, forearm, cannon, FORWARD)
    return (pivot, shoulder, elbow, knee, target, coronet + target - fetlock), pitch, max(0, gap - limit)


@cache
def hind_angles():
    hip, stifle, hock, fetlock = JOINTS["hind"][:4]
    return corner(hip, stifle, hock), corner(stifle, hock, fetlock)


def hind_chain(flexion):
    """后膝与飞节一起屈伸时，髋、后膝、飞节、球节在肢体自身平面里的位置。"""
    thigh, gaskin, cannon, _, _ = spans("hind")
    stifle_rest, hock_rest = hind_angles()
    stifle = math.radians(stifle_rest - flexion)
    hock = math.radians(hock_rest - HOCK_RATIO*flexion)
    knee = Vector((gaskin, 0))
    return (knee + thigh*Vector((-math.cos(stifle), math.sin(stifle))), knee, Vector((0, 0)),
            cannon*Vector((math.cos(hock), -math.sin(hock))))


def solve_hind(p, side, hoof):
    toe, pitch, sink, _ = hoof
    coronet, fetlock = digit("hind", toe, pitch, sink)
    hip = carried(p, "pelvis", joints("hind", side)[0])
    gap = (fetlock - hip).length
    low, high = HIND_RANGE

    def length(flexion):
        chain = hind_chain(flexion)
        return (chain[3] - chain[0]).length

    limit = length(low) - SLACK
    reach = min(gap, limit)
    for _ in range(28):
        middle = (low + high)/2
        if length(middle) > reach:
            low = middle
        else:
            high = middle
    chain = hind_chain(low)
    target = fetlock if gap <= limit else hip + (fetlock - hip)*(limit/gap)
    # 把链自身平面里的形状转到「髋 → 球节」这条线上，后膝朝前。
    along = (target - hip).normalized()
    front = (FORWARD - along*FORWARD.dot(along)).normalized()
    axis = (chain[3] - chain[0]).normalized()
    side_axis = Vector((-axis.y, axis.x))
    if (chain[1] - chain[0]).dot(side_axis) < 0:
        side_axis.negate()
    stifle, hock = (hip + along*(q - chain[0]).dot(axis) + front*(q - chain[0]).dot(side_axis) for q in chain[1:3])
    return (hip, stifle, hock, target, coronet + target - fetlock), pitch, max(0, gap - limit)


SOLVERS = {"fore": solve_fore, "hind": solve_hind}


def pose_limb(p, pair, side, solution):
    points, pitch, _ = solution
    names = limb_bones(pair, side)
    for name, a, b in zip(names, points, points[1:]):
        p.set(name, aim=b - a)
    p.set(names[-1], delta=turn(x=pitch))


def place_trunk(p, front, back, sway=0, surge=0, roll=0, yaw=0, tuck=0, hip_roll=0):
    """front、back 是肩胛处与腰荐处相对站立的起落，躯干的俯仰由两者之差得出；tuck 是骨盆向腹下收拢的角度。"""
    blade = Vector((0, *JOINTS["fore"][0])) - CHEST
    loin = Vector(LUMBOSACRAL) - CHEST
    pitch = math.atan2(back - front, blade.y - loin.y)
    rise = front + blade.y*math.sin(pitch) - blade.z*(math.cos(pitch) - 1)
    p.set("chest", head=CHEST + Vector((sway, surge, rise)), delta=turn(x=math.degrees(pitch), f=roll, z=yaw))
    p.set("saddle")
    flex(p, "loin", x=-.35*tuck)
    flex(p, "pelvis", x=-.65*tuck, f=hip_roll)


def carry_neck(p, lower=0, nod=0, side=0, tilt=0):
    """lower 让整条颈往下探（负值是扬起），nod 是头绕寰枕关节点头，side 是颈向一侧摆。"""
    flex(p, "neck1", x=.42*lower, z=.4*side)
    flex(p, "neck2", x=.33*lower, z=.35*side)
    flex(p, "neck3", x=.25*lower, z=.25*side)
    flex(p, "head", x=nod, f=tilt)


def carry_tail(p, lift, sweep, curl=0, wave=0):
    flex(p, "tail1", x=lift, z=sweep)
    flex(p, "tail2", x=.45*lift + curl, z=.8*sweep + wave)
    flex(p, "tail3", x=.20*lift + 1.4*curl, z=.6*sweep - wave)


def set_ears(p, left, right, splay=0):
    flex(p, "ear.L", x=left, f=-splay)
    flex(p, "ear.R", x=right, f=splay)


def trunk_motion(movement, phase):
    w = math.tau*phase
    if movement == "walk":
        # 每个对角支撑的中点躯干最低，腾空的中点最高。
        bounce = math.cos(2*w - math.tau*.86)
        return dict(front=-.040 + .026*bounce + .004*math.cos(2*w - 1.0), back=-.040 + .026*bounce,
                    sway=.006*math.sin(w - .3), roll=1.1*math.sin(w - .2), yaw=.9*math.sin(w + 1.2),
                    tuck=1.0 + 1.4*math.cos(2*w - .25), hip_roll=2.2*math.sin(w - .5))
    if movement == "run":
        # 后蹄落地时前躯高、后躯低，前蹄撑地时反过来；腾空时骨盆收到腹下，后肢蹬直时腰背伸开。
        return dict(front=-.050 + .055*math.cos(w - math.tau*.03), back=-.050 + .045*math.cos(w - math.tau*.66),
                    surge=.018*math.cos(w - math.tau*.62), roll=1.3*math.sin(w - math.tau*.20),
                    yaw=.8*math.sin(w - math.tau*.45), tuck=2 + 8*math.cos(w - math.tau*.95))
    return dict(front=.0035*math.sin(w), back=.002*math.sin(w - .6), sway=.007*math.sin(w - .8),
                roll=.45*math.sin(w - .8))


def living_pose(p, movement, phase):
    w = math.tau*phase
    moving = movement in GAITS
    hooves = {(pair, side): moving_hoof(pair, side, movement, phase) if moving else resting_hoof(pair, side)
              for pair, side in LEGS}
    motion = trunk_motion(movement, phase)
    for _ in range(4):
        place_trunk(p, **motion)
        solved = {leg: SOLVERS[leg[0]](p, leg[1], hoof) for leg, hoof in hooves.items()}
        # 哪条腿够不着蹄印，就把那一端的躯干压低，蹄印不动。
        short = {pair: max(solved[pair, side][2] for side in SIDE) for pair in ("fore", "hind")}
        if max(short.values()) < .0005:
            break
        motion["front"] -= 1.15*short["fore"]
        motion["back"] -= 1.15*short["hind"]
    for (pair, side), solution in solved.items():
        pose_limb(p, pair, side, solution)

    if movement == "walk":
        carry_neck(p, lower=-3 + 1.6*math.cos(2*w - 1.4), nod=1.5 - 1.3*math.cos(2*w - 1.0), side=1.2*math.sin(w + .8))
        carry_tail(p, lift=17 + 4*math.cos(2*w - 2.2), sweep=7*math.sin(w - .9), curl=-4 + 3*math.cos(2*w - 3.0),
                   wave=5*math.sin(w - 2.2))
        set_ears(p, 4*math.sin(w), 4*math.sin(w + 2.0))
    elif movement == "run":
        # 颈向前探平，前蹄撑地时头最低，腾空时扬起。
        carry_neck(p, lower=17 + 6*math.cos(w - math.tau*.56), nod=-17 + 4*math.cos(w - math.tau*.70),
                   side=.8*math.sin(w - 1.0))
        carry_tail(p, lift=38 + 8*math.cos(w - math.tau*.30), sweep=4*math.sin(w - .6),
                   curl=-8 + 9*math.cos(w - math.tau*.52), wave=5*math.sin(w - 2.0))
        set_ears(p, 16 + 3*math.sin(w), 16 + 3*math.sin(w + 1.3), 8)
    else:
        # 待命：呼吸、缓缓转头、甩尾、耳朵各自转动。
        look = 5*math.sin(w - .4) + 2*math.sin(2*w + .7)
        carry_neck(p, lower=1.6*math.sin(w + .9) + .8*math.sin(2*w), nod=1.8*math.sin(w - .5) + 1.0*math.sin(3*w),
                   side=look, tilt=.25*look)
        swish = math.sin(w - 1.1)**3
        carry_tail(p, lift=2 + 2*swish, sweep=13*swish + 3*math.sin(2*w), wave=11*math.sin(w - 1.9)**3)
        set_ears(p, 9*math.sin(w - .6) + 5*math.sin(3*w), 8*math.sin(2*w + .4) + 5*math.sin(w + 2.0),
                 4*math.sin(w + .5))


class GroundSurface:
    """蒙皮后体表的最低点，倒地时用它把躯干放到地面上。"""

    def __init__(self, p, mesh):
        groups = [group.name for group in mesh.vertex_groups]
        inverse = {name: matrix.inverted() for name, matrix in p.rest.items()}
        self.vertices = []
        for vertex in mesh.data.vertices:
            influences = []
            for group in vertex.groups:
                name = groups[group.group]
                local = inverse[name] @ vertex.co
                influences.append((name, Vector((*local, 1))*group.weight))
            self.vertices.append(influences)

    def floor(self, p):
        rows = {bone: matrix[2] for bone, matrix in p.transforms.items()}
        return min(sum(rows[name].dot(local) for name, local in influences) for influences in self.vertices)


# 倒地时各关节相对站立的屈伸（度）：四肢先这样软下去，落地后再摊成第二组。
COLLAPSE = {
    "fore": ((0, -10, -35, 115, 30, 10), (0, -6, -14, 28, 14, 10)),
    "hind": ((-22, 55, -62, 20, 0), (-8, 14, -16, 14, 10)),
}


def falling_pose(p, phase, surface):
    t = phase*DURATION["die"]
    # 四肢先软，身子向右侧翻倒，落地一颠之后颈与四肢才摊开。
    buckle = spline(t, ((0, 0), (.18, .45), (.40, 1), (1.3, 1)))
    fall = spline(t, ((0, 0), (.14, .03), (.42, .45), (.66, .97), (.76, 1.04), (.90, 1), (1.3, 1)))
    slack = spline(t, ((0, 0), (.50, 0), (.80, 1), (.96, .94), (1.3, 1)))
    stagger = math.sin(math.pi*min(1, t/.5))
    head = CHEST + Vector((.15*fall, .08*fall - .04*stagger, 0))
    delta = turn(x=5*stagger*(1 - fall) + 2*fall, f=87*fall, z=-9*fall)
    p.set("chest", head=head, delta=delta)
    # 鞍骨在倒地的后半段往回转一些。骑手的原点跟着鞍骨走，unhorse.py 把落马动作换算进骑手原点时用的就是它每一刻的位姿：
    # 改这里或倒地的其它部分，四个生成脚本都要重跑，骑手的落马才对得上。
    flex(p, "saddle", f=-22*slack)
    flex(p, "loin", x=3*slack, z=-3*slack)
    flex(p, "pelvis", x=4*slack, z=-3*slack)
    # 颈先扬起再甩到地上，头侧着贴地。
    flex(p, "neck1", x=-12*stagger*(1 - fall) + 6*slack, z=-8*slack)
    flex(p, "neck2", x=-8*stagger*(1 - fall) + 7*slack, z=-6*slack)
    flex(p, "neck3", x=5*slack, z=-4*slack)
    flex(p, "head", x=-10*stagger*(1 - slack) - 14*slack, z=-3*slack)
    carry_tail(p, lift=16*stagger*(1 - slack) + 5*slack, sweep=-10*slack, curl=4*slack)
    set_ears(p, 18*slack, 24*slack, 8*slack)
    for pair, side in LEGS:
        folded, spent = COLLAPSE[pair]
        # 压在身下的腿贴着地，上面一侧的腿垂下来搭在上头；向身侧放下去的是肱骨、股骨。
        droop = (-21 if side == "L" else -5)*slack
        hinge = 1 if pair == "fore" else 0
        for i, (name, a, b) in enumerate(zip(limb_bones(pair, side), folded, spent)):
            flex(p, name, x=a*buckle*(1 - slack) + b*slack, f=droop if i == hinge else 0)
    # 躯干整体抬到最低点刚好着地；子骨的相对姿势不变。
    head.z += .002 - surface.floor(p)
    p.set("chest", head=head, delta=delta)


def horse_pose(rig, movement, phase, surface=None):
    p = Pose(rig)
    p.set("root")
    if movement == "die":
        falling_pose(p, phase, surface if surface is not None else GroundSurface(p, rig.children[0]))
    else:
        living_pose(p, movement, phase)
    return p


def animate_horse(rig, mesh):
    ground = GroundSurface(Pose(rig), mesh)
    for name, duration in DURATION.items():
        clip(rig, name, duration, lambda phase: horse_pose(rig, name, phase, ground), name != "die", step=1)


def check_barding(rig, mesh, samples=24):
    """挂甲不得与四肢相交：四个动作各取若干帧，把蒙皮后的挂甲与四肢求交，相交就报错。查完把骨架放回绑定姿势。"""
    spans = list(mesh.get("hanging", ()))
    if not spans:
        return
    moving = {name for pair, side in LEGS for name in limb_bones(pair, side)}
    groups = {group.index for group in mesh.vertex_groups if group.name in moving}
    swung = {v.index for v in mesh.data.vertices if any(g.group in groups and g.weight > .01 for g in v.groups)}
    polygons = [tuple(polygon.vertices) for polygon in mesh.data.polygons]
    barding = [polygons[i] for start, end in zip(spans[::2], spans[1::2]) for i in range(start, end)]
    limbs = [polygon for polygon in polygons if swung.intersection(polygon)]
    ground = GroundSurface(Pose(rig), mesh)
    for name in DURATION:
        for i in range(samples):
            phase = i/(samples - 1) if name == "die" else i/samples
            horse_pose(rig, name, phase, ground)
            bpy.context.view_layer.update()
            posed = mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
            vertices = [vertex.co.copy() for vertex in posed.to_mesh().vertices]
            posed.to_mesh_clear()
            crossed = BVHTree.FromPolygons(vertices, limbs).overlap(BVHTree.FromPolygons(vertices, barding))
            assert not crossed, (name, phase, "挂甲与四肢相交", len(crossed))
    for bone in rig.pose.bones:
        bone.matrix_basis.identity()
    bpy.context.view_layer.update()
