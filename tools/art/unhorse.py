"""骑手落马：马倒地时骑手被甩出鞍座，摔在马背一侧的地上。

骑手的原点在引擎里跟着马的 saddle 骨骼走，马的倒地动作又是定死的，所以这个动作摆在马站着时的坐标里
（原点在四蹄中间的地面，坐标依次为横向、前向、高度），最后把胯部换算进鞍骨的坐标系。
马向右侧翻倒，背转向右边：骑手起先跟着鞍走，随后被甩向右外侧，右脚先着地，人朝外栽倒，
右侧身着地、半趴着停在离马背一步远的地方，头朝外、脚朝马。
"""

import math
from functools import cache

import bpy
from mathutils import Matrix, Vector

import horse
from horse import carried, ease, flex, model, spline, turned
from horse_gaits import DURATION
from horse_rig import SADDLE
from mesh import Pose, armature, bend, mix, point, turn
from rome import SHIN, SIDE, THIGH

# 引擎每秒烘焙 30 帧，骑手的关键帧也落在这些时刻上：这些时刻上人与马的相对位置就是这里摆出来的。
RATE = 30
# 几个时刻（秒）：离鞍，右脚着地，身子着地，停稳。
LEAVE, TOUCH, LAND, REST = .20, .50, .66, 1.0

# 胯部离鞍以后在世界里走的路（时刻，横向、前向、高度）：先被翻倒的马甩向右外侧，身子着地时一颠，再向外滑一小段停住。
PATH = (
    (.30, -.22, .03, 1.49),
    (.40, -.52, .02, 1.23),
    (.50, -.84, .00, .90),
    (.58, -1.06, -.02, .58),
    (.66, -1.23, -.03, .30),
    (.72, -1.31, -.04, .20),
    (.80, -1.36, -.04, .215),
    (.90, -1.38, -.04, .195),
    (1.30, -1.38, -.04, .195),
)
# 身子的朝向（时刻，前俯、右倾、偏航、绕自身纵轴右拧）：跟着马向右倒，侧身着地，再向前趴过去小半边。
SPIN = (
    (.30, -6, 27, -2, 0),
    (.40, -8, 47, -4, -4),
    (.50, -6, 67, -6, -10),
    (.58, -2, 80, -8, -16),
    (.66, 0, 86, -9, -24),
    (.74, 0, 89, -10, -32),
    (.84, 0, 88, -10, -37),
    (1.00, 0, 88, -10, -38),
    (1.30, 0, 88, -10, -38),
)
# 左脚踝离鞍后相对鞍骨走的路（时刻，横向、前向、高度；马站着时的朝向）：贴着马的左肋往上收，从前后鞍桥之间翻过马背。
LEFT_OVER = (
    (.28, .37, -.03, -.37),
    (.36, .38, .02, -.08),
    (.44, .22, .04, .17),
    (.52, -.06, .02, .26),
)
# 两腿落地后踝与膝的位置：右腿屈着压在下面，左腿屈膝搭在它前面。
ANKLE = {"R": (-.70, -.10, .080), "L": (-.80, .32, .090)}
KNEE = {"R": (-1.08, .27, .095), "L": (-1.12, .50, .115)}
# 落地后右手伸过头顶够到的地方，左手落在胸前地上的地方。
REACH = (-2.36, -.24, .055)
FRONT = (-1.72, .40, .05)
# 脚掌平踩在地上时脚踝的高度，脚趾关节离地至少这么高。
SOLE, TOE = .108, .045
# 头垫在伸出去的右臂上：头的中心离地至少这么高。
PILLOW = .20
# 头的中心在头骨根部上方这么远；颈根到头的中心这么远，头要抬高多少，脖子就按这个半径歪多少。
HEAD_CENTER, NECK_REACH = .10, .24


@cache
def reference():
    """动作库里那样的马：它倒地时贴地用的体表，和倒地动作里每个烘焙时刻的（骑手原点的位姿，马躯干相对站立的位姿）。

    各阵营的马套的都是动作库的动作，动作库的倒地是照缺省样式的网格贴地的：现建一匹那样的马来量，量完删掉，场景里不留东西。
    """
    kinds = ("objects", "meshes", "armatures", "materials")
    before = {kind: set(getattr(bpy.data, kind)) for kind in kinds}
    active = bpy.context.view_layer.objects.active
    rig = armature("Fall reference", horse.horse_skeleton())
    ground = horse.GroundSurface(Pose(rig), horse.horse_mesh(rig))
    count = round(DURATION["die"]*RATE)
    track = []
    for k in range(count + 1):
        p = horse.horse_pose(rig, "die", k/count, ground)
        trunk = p.transforms["chest"] @ p.rest["chest"].inverted()
        saddle = trunk @ p.rest["saddle"] @ rig.pose.bones["saddle"].matrix_basis
        # 骑手的原点跟鞍骨的位置，朝向取鞍骨相对绑定姿势转过的角。
        seat = (Matrix.Translation(saddle.translation)
                @ (saddle @ p.rest["saddle"].inverted()).to_quaternion().to_matrix().to_4x4())
        track.append((seat.freeze(), trunk.freeze()))
    for kind in kinds:
        store = getattr(bpy.data, kind)
        for item in set(store) - before[kind]:
            store.remove(item)
    bpy.context.view_layer.objects.active = active
    return ground, tuple(track)


def horse_ground():
    """动作库里的马倒地时贴地用的体表：给别的样式的马摆倒地时传给 horse.horse_pose，马才落在游戏里的那个高度上。"""
    return reference()[0]


def horse_track():
    """马倒地动作里每个烘焙时刻的（骑手原点的位姿，马躯干相对站立的位姿）。"""
    return reference()[1]


def blend_matrix(a, b, w):
    la, qa, _ = a.decompose()
    lb, qb, _ = b.decompose()
    return Matrix.Translation(la.lerp(lb, w)) @ qa.slerp(qb, w).to_matrix().to_4x4()


def at(t, which=0):
    """t 时刻骑手原点（which=0）或马躯干（which=1）的位姿；两个烘焙时刻之间取插值。"""
    track = horse_track()
    k = min(max(t, 0)*RATE, len(track) - 1)
    i = min(int(k), len(track) - 2)
    return blend_matrix(track[i][which], track[i + 1][which], k - i)


def ramp(t, start, end):
    return ease((t - start)/(end - start))


def toward(p, direction, bone="hips"):
    """bone 自己坐标里的一个方向（横向、前向、高度）在世界里朝哪。"""
    return model(turned(p, bone) @ point(direction))


def seated(rig, start):
    """待命坐姿里各骨骼在骑手原点坐标系里的位姿；start 是各骨骼的 matrix_basis。"""
    pose = {}
    for bone in rig.pose.bones:
        rest = bone.bone.matrix_local
        if bone.parent is None:
            pose[bone.name] = rest @ start[bone.name]
        else:
            local = bone.parent.bone.matrix_local.inverted() @ rest
            pose[bone.name] = pose[bone.parent.name] @ local @ start[bone.name]
    return pose


def swing_leg(p, side, ankle, pole, pitch=0, splay=0):
    """腿：踝落在 ankle，膝朝 pole 那边弯；pitch 是脚背绷直的角度，splay 是脚尖外撇的角度（都相对小腿）。

    脚尖要扎进地里时把脚掌抬平。
    """
    thigh, shin, foot, toe = (n + "." + side for n in ("thigh", "shin", "foot", "toe"))
    hip = carried(p, "hips", model(p.rest[thigh].translation))
    ray = Vector(ankle) - hip
    ankle = hip + ray.normalized()*min(ray.length, THIGH + SHIN - .002)
    knee = bend(hip, ankle, THIGH, SHIN, pole)
    p.set(thigh, aim=knee - hip)
    p.set(shin, aim=ankle - knee)
    flex(p, foot, x=pitch, z=SIDE[side]*splay)
    p.set(toe)
    reach = p.anchor(toe) - ankle
    if ankle.z + reach.z < TOE:
        flat = Vector((reach.x, reach.y, 0))
        rise = min(TOE - ankle.z, reach.length*.9)
        p.set(foot, aim=flat.normalized()*math.sqrt(reach.length**2 - rise**2) + Vector((0, 0, rise)))
        p.set(toe)


def hips_at(rig, start, t, lift=0):
    """胯部在世界里的位置与朝向：离鞍前照待命的坐姿坐在鞍上，离鞍后接上 PATH 与 SPIN，落地后再垫高 lift。"""
    rest = rig.pose.bones["hips"].bone.matrix_local
    sit = rest @ start["hips"]
    if t <= LEAVE:
        seated = at(t) @ sit
        return model(seated.translation), seated.to_quaternion() @ rest.to_quaternion().inverted()
    # 离鞍前每个烘焙时刻一个结点（取坐在鞍上的值），后面接上离鞍后的：两段在离鞍那一刻速度接得上。
    early = [k/RATE for k in range(round(LEAVE*RATE) + 1)]
    seated = [at(k) @ sit for k in early]
    places = [model(m.translation) for m in seated]
    turns = []
    for m in seated:
        e = (m.to_quaternion() @ rest.to_quaternion().inverted()).to_euler("XYZ")
        turns.append((math.degrees(e.x), -math.degrees(e.y), math.degrees(e.z), 0))
    where = Vector([spline(t, [*zip(early, (v[i] for v in places)), *((key[0], key[1 + i]) for key in PATH)])
                    for i in range(3)])
    where.z += lift*ramp(t, TOUCH, LAND)
    x, f, z, twist = (spline(t, [*zip(early, (v[i] for v in turns)), *((key[0], key[1 + i]) for key in SPIN)])
                      for i in range(4))
    return where, turn(x=x, f=f, z=z) @ turn(z=twist)


def fall(rig, t, limbs, lift=0, billow=45):
    """摆出落马动作在 t 秒时的姿势。

    调用前先把骨架摆成这个持械姿态待命的坐姿（坐在鞍上、拿着兵器）：动作从它开始。
    limbs(p, t, held) 接着摆两臂与兵器：这时 p 里是世界坐标，身子已经摆好；held 是待命坐姿里各骨骼相对绑定姿势
    转过的角（骑手原点的坐标系，也就是马站着时的世界），手里的兵器从这个朝向起步。
    lift 是躺在地上时身子再垫高多少（PATH、ANKLE、KNEE 里的高度是不垫时的）：甲裙、肩甲宽的垫高一些，侧躺时才不陷进地里。
    billow 是背后的披风向后扬起的角度：坐着时披风下摆垂在马臀里，扬起来才离得开；背的是旗杆就给小一点。
    """
    # 先量好马：量的时候要现建一副骨架，会让此前取到的骨骼矩阵失效，所以得在取骑手的姿势之前。
    horse_track()
    start = {bone.name: bone.matrix_basis.copy() for bone in rig.pose.bones}
    sitting = seated(rig, start)
    held = {name: matrix.to_quaternion() @ rig.pose.bones[name].bone.matrix_local.to_quaternion().inverted()
            for name, matrix in sitting.items()}
    p = Pose(rig)
    p.set("root")
    where, attitude = hips_at(rig, start, t, lift)
    p.set("hips", head=where, delta=attitude)
    free = ramp(t, LEAVE, LEAVE + .22)
    land = ramp(t, TOUCH + .04, LAND + .14)
    still = ramp(t, LAND + .08, REST + .05)
    # 挨了一下先向后一仰，离鞍时身子绷着，落地后瘫软下去：上身比胯趴得更多一些，头枕在伸出去的右臂上。
    jolt = math.sin(math.pi*min(1, t/.34))**2
    flex(p, "spine", x=6 - 13*jolt + 2*land, f=-3*land, z=-8*land)
    flex(p, "chest", x=4 - 9*jolt + 2*land, f=-3*land, z=-12*land)
    nod, tilt = -10*jolt + 12*free - 8*still, -6*land
    flex(p, "neck", x=nod, f=tilt, z=-6*land)
    flex(p, "head", x=-12*jolt + 9*free - 6*still, f=tilt, z=-10*land)
    # 头别扎进地里：不够高就把脖子朝上面那一侧再歪一点。
    for _ in range(6):
        low = PILLOW + lift - (p.anchor("head") + toward(p, (0, 0, HEAD_CENTER), "head")).z
        if low <= .002:
            break
        tilt -= math.degrees(low/NECK_REACH)
        flex(p, "neck", x=nod, f=tilt, z=-6*land)
        flex(p, "head", x=-12*jolt + 9*free - 6*still, f=tilt, z=-10*land)
    flex(p, "mantle", x=billow*ramp(t, .03, .17)*(1 - ramp(t, LEAVE + .16, LAND + .02)) - 4*land, f=8*land)

    trunk = at(t, 1)
    lying = ramp(t, LAND - .06, LAND + .16)
    for side in SIDE:
        seat_ankle = model(at(t) @ sitting["foot." + side].translation)
        hip = carried(p, "hips", model(p.rest["thigh." + side].translation))
        rest = Vector(ANKLE[side]) + Vector((0, 0, lift))
        if side == "R":
            # 右腿甩出去垂着，脚掌先着地，随后屈膝压在身下。
            hang = hip + Vector((-.05, .04, -(THIGH + SHIN - .03)))
            hang.z = max(hang.z, SOLE)
            stand = Vector((rest.x, rest.y, SOLE))
            ankle = mix(mix(seat_ankle, hang, ramp(t, LEAVE, .40)), mix(stand, rest, lying),
                        ramp(t, TOUCH - .05, TOUCH + .08))
            pole = mix(toward(p, (-.65, 1, .12)), (-.15, 1, .15), ramp(t, TOUCH - .08, TOUCH + .04))
            pole = mix(pole, Vector(KNEE[side]) + Vector((0, 0, lift)) - (hip + ankle)/2, lying)
            pitch = 25*free*(1 - ramp(t, TOUCH - .08, TOUCH + .02))
        else:
            # 左脚贴着马的左肋往上收，从鞍面上翻过马背，跟着身子落下，最后屈膝搭在右腿前面。
            keys = [(LEAVE, *model(sitting["foot." + side].translation)), *LEFT_OVER]
            x, f, z = (spline(t, [(key[0], key[1 + i]) for key in keys]) for i in range(3))
            over = model(trunk @ point(Vector(SADDLE) + Vector((x, f, z))))
            trail = hip + toward(p, (.10, -.06, -(THIGH + SHIN - .22)))
            down = ramp(t, LAND, LAND + .26)
            ankle = mix(mix(over, trail, ramp(t, .46, .64)), rest, down)
            pole = mix(model(trunk.to_quaternion() @ point((.4, .5, 1))), toward(p, (.3, 1, .2)), ramp(t, .48, .66))
            pole = mix(pole, Vector(KNEE[side]) + Vector((0, 0, lift)) - (hip + ankle)/2, down)
            pitch = 30*free*(1 - ramp(t, .50, .62))
        swing_leg(p, side, ankle, pole, pitch, 19*(1 - free))
    limbs(p, t, held)
    # 把摆在世界里的胯部换算进骑手原点（鞍骨）的坐标系：引擎把骑手原点对齐鞍骨以后，人就在摆的那个位置。
    p.rig.pose.bones["hips"].matrix_basis = p.rest["hips"].inverted() @ at(t).inverted() @ p.transforms["hips"]
    # 离鞍前后，各骨骼从待命的坐姿过渡过来。
    for bone in rig.pose.bones:
        if bone.name in ("root", "hips"):
            continue
        leg = bone.name.split(".")[0] in ("thigh", "shin", "foot", "toe")
        hold = 1 - (ramp(t, LEAVE - .05, LEAVE + .06) if leg else ramp(t, .03, LEAVE + .10))
        if bone.name == "mantle":
            hold = 1 - ramp(t, .03, .17)
        if hold:
            bone.matrix_basis = blend_matrix(bone.matrix_basis, start[bone.name], hold)
