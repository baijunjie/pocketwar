"""战马的毛色、鞍具与马甲，按阵营各一套；高级形态披甲。

鞍具贴着体表摆：位置都从 horse_mesh.Hide 上取点，披了贴身的甲就自动垫在甲外面。
垂下来的挂甲（当胸、搭后）跟着躯干的骨骼走，挂在四肢摆动范围的外侧，腿在里面动不会穿出来。
"""

import math
from collections import namedtuple

from mathutils import Vector

from horse_mesh import (BROW, MUZZLE, POLL, TAIL_KNOT, TAIL_TIED, Hide, Plate, Skin, axial_point, axial_row, blend, body,
                        cropped_mane, forelock, head_details, limbs, mane, tail)
from horse_rig import SIDE
from mesh import PALETTE

# 马专用的颜色登记在这里，不动人形共用的调色板。
PALETTE.update({
    "Chestnut": ((.36, .135, .048), 0, .67),
    "Chestnut shade": ((.25, .085, .032), 0, .72),
    "Chestnut mane": ((.115, .042, .019), 0, .86),
    "Black coat": ((.040, .029, .023), 0, .62),
    "Black shade": ((.022, .016, .014), 0, .70),
    "Grey coat": ((.56, .54, .50), 0, .70),
    "Grey shade": ((.38, .37, .35), 0, .74),
    "Grey points": ((.11, .105, .10), 0, .80),
    "Grey mane": ((.22, .215, .205), 0, .86),
    "Grey muzzle": ((.17, .14, .13), 0, .77),
    "Lacquer": ((.018, .017, .019), 0, .35),
    "Bronze shadow": ((.33, .20, .068), .72, .45),
})

# 毛色：体表按枣骝马的颜色名建，别的毛色把这些名字换掉。
COATS = {
    "bay": {},
    "chestnut": {"Bay": "Chestnut", "Bay shade": "Chestnut shade", "Bay points": "Chestnut shade",
                 "Horse mane": "Chestnut mane"},
    "black": {"Bay": "Black coat", "Bay shade": "Black shade", "Bay points": "Black shade", "Muzzle": "Bay points",
              "Blaze": "Black coat"},
    "grey": {"Bay": "Grey coat", "Bay shade": "Grey shade", "Bay points": "Grey points", "Horse mane": "Grey mane",
             "Muzzle": "Grey muzzle", "Blaze": "Grey coat"},
}

# 各阵营马甲交替的两种甲色：铁札、金箔小札、铜鳞。
IRON = ("Steel shadow", "Iron")
GILT = ("Brass", "Bronze")
SCALE = ("Bronze shadow", "Bronze")

# 四肢上段在走、跑里向外鼓出的最大半宽（高度、半宽），由动作量出：挂甲从这之外垂下。
BULGE = {
    "fore": ((1.47, .10), (1.43, .15), (1.335, .21), (1.205, .25), (1.075, .262), (.90, .255), (.80, .235), (.40, .225)),
    "hind": ((1.48, .10), (1.45, .16), (1.38, .24), (1.26, .287), (1.14, .297), (1.00, .292), (.90, .282), (.80, .255),
             (.40, .245)),
}
# 这块鼓出在前后方向上占的范围：中间一段是满的，两头按椭圆收掉。
SPAN = {"fore": (.22, .50, .62, .88), "hind": (-.88, -.62, -.30, -.16)}
# 挂甲的领口浮在体表上这么高：贴身的甲是一格一格的平面，领口压进去的话，露出来的那条边会是锯齿。
COLLAR = .005


def strap(mesh, path, width, mat, both=False):
    """沿一串（位置、朝外方向、蒙皮）铺一条带子。"""
    grid = []
    for i, (p, normal, weight) in enumerate(path):
        before, after = path[max(0, i - 1)][0], path[min(len(path) - 1, i + 1)][0]
        across = (Vector(after) - Vector(before)).cross(Vector(normal)).normalized()*width/2
        grid.append(((Vector(p) + across, normal, weight), (Vector(p) - across, normal, weight)))
    mesh.sheet(grid, mat, smooth=False, both=both)


def on_skin(hide, stations, lift, weight=None):
    return [(*hide.skin(u, a, lift), weight or hide.weight(u)) for u, a in stations]


def disc(mesh, center, normal, radius, weight, mat="Brass"):
    normal = Vector(normal).normalized()
    side = normal.cross(Vector((0, 0, 1))).normalized()
    up = side.cross(normal)
    hub = mesh.vertex(Vector(center) + normal*.008, weight)
    rim = [mesh.vertex(Vector(center) + (side*math.cos(a) + up*math.sin(a))*radius, weight)
           for a in (math.tau*k/6 for k in range(6))]
    for k in range(6):
        mesh.facing((hub, rim[k], rim[(k+1) % 6]), normal, mat, smooth=False)


def bob(mesh, top, length, radius, weight, mat):
    """垂下来的一只缨穗：上尖下圆。"""
    top = Vector(top)
    ring = [top + Vector((radius*math.cos(a), radius*math.sin(a), -length*.62)) for a in (math.tau*k/4 for k in range(4))]
    mesh.shell([(ring, weight)], mat, head=(top, weight), tail=(top + Vector((0, 0, -length)), weight))


def plume(mesh, base, axis, shape, weight, mats, sides=5):
    """立着的一束缨：shape 是沿轴各圈的（高度、半径），最后一项只取高度、收成尖；mats 是各段的颜色。"""
    base, axis = Vector(base), Vector(axis).normalized()
    side = axis.cross(Vector((1, 0, 0))).normalized()
    other = axis.cross(side)
    around = [side*math.cos(a) + other*math.sin(a) for a in (math.tau*k/sides for k in range(sides))]
    rings = [([base + axis*h + out*r for out in around], weight) for h, r in shape[:-1]]
    mesh.shell(rings, lambda layer, _n: mats[min(layer, len(mats) - 1)], tail=(base + axis*shape[-1][0], weight))


def fan(mesh, base, axis, across, height, half, weight, mat, blades=4):
    """一面竖着的扇：从根上向 axis 张开（左右各 half 弧度），顶上是几片翎尖。"""
    base, axis, across = Vector(base), Vector(axis).normalized(), Vector(across).normalized()
    out = axis.cross(across)
    for flip in (1, -1):
        hub = mesh.vertex(base, weight)
        rim = []
        for k in range(2*blades + 1):
            a = half*(k/blades - 1)
            rim.append(mesh.vertex(base + (axis*math.cos(a) + across*math.sin(a))*height*(1 if k % 2 else .74), weight))
        for a, b in zip(rim, rim[1:]):
            mesh.facing((hub, a, b), out*flip, mat, smooth=False)


def fringe(mesh, path, drop, mat, flare=.012):
    """沿带子垂下的一排穗子；drop 是穗长，给一串就是各站各自的长度。"""
    grid = []
    for i, (p, normal, weight) in enumerate(path):
        p, normal = Vector(p), Vector(normal).normalized()
        length = drop[i] if isinstance(drop, tuple) else drop
        # 穗根比带子再靠外一点，免得与带子叠在同一个面上。
        grid.append(((p + normal*.005, normal, weight), (p + Vector((0, 0, -length)) + normal*flare, normal, weight)))
    mesh.sheet(grid, mat, smooth=False, both=True)


def bordered(inner, border, rows=5, cols=11):
    """一张布的配色：四周一圈镶边。"""
    return lambda i, j: border if i in (0, rows - 2) or j in (0, cols - 2) else inner


def spread(count, margin=None):
    """把 0…1 分成 count 个站：margin 给出时两头各留一条这么宽的窄边，中间平分。"""
    if margin is None:
        return [i/(count - 1) for i in range(count)]
    return [0, *(blend(margin, 1 - margin, i/(count - 3)) for i in range(count - 2)), 1]


def saddle_cloth(mesh, hide, back, front, drop, mat, rows=5, cols=11, lift=.015, edge=.004, weight="chest", margin=None):
    """鞍褥：从脊背披到肋侧，四周收进体表，中间抬起一指厚。

    drop 是下摆垂到的方位，可以是按前后位置（0 后缘、1 前缘）给出的函数；margin 是镶边占的比例（前后、左右），
    不给就是一格宽。返回铺出来的点阵。
    """
    grid = []
    along, around = spread(rows, margin and margin[0]), spread(cols, margin and margin[1])
    for i in range(rows):
        u = blend(back, front, along[i])
        reach = drop(along[i]) if callable(drop) else drop
        row = []
        for j in range(cols):
            a = blend(-reach, reach, around[j])
            rim = i in (0, rows - 1) or j in (0, cols - 1)
            p, normal = hide.skin(u, a, edge if rim else lift)
            row.append((p, normal, weight or hide.weight(u)))
        grid.append(row)
    mesh.sheet(grid, mat)
    return grid


def flap(mesh, hide, back, front, top, drop, mat, rows=4, cols=4, lift=.012):
    """鞍下垂在两肋的一片（障泥、泥障）：上缘压在鞍褥底下，过了肋侧最宽处就垂直挂着，前后两角收圆。"""
    for sign in (1, -1):
        grid = []
        for i in range(rows):
            t = i/(rows - 1)
            u = blend(back, front, t)
            low = blend(top, drop, .70 + .30*math.sin(math.pi*t))
            row, reach = [], 0
            for j in range(cols):
                rim = i in (0, rows - 1) or j == 0
                p, normal = hide.skin(u, sign*blend(top, low, j/(cols - 1)), .004 if rim else lift)
                reach = max(reach, abs(p.x))
                row.append((Vector((sign*reach, p.y, p.z)), normal, hide.weight(u)))
            grid.append(row)
        mesh.sheet(grid, mat)


def seat(mesh, hide, stations, mat, half=.95, cols=7, edge=.010):
    """鞍面：stations 是从后到前各站（位置、中线抬起的高度），两侧比中线再高一点，兜住骑手；edge 是四周压在鞍褥上的高度。"""
    grid = []
    for i, (u, rise) in enumerate(stations):
        row = []
        for j in range(cols):
            a = blend(-half, half, j/(cols - 1))
            rim = i in (0, len(stations) - 1) or j in (0, cols - 1)
            middle = (cols - 1)//2
            p, normal = hide.skin(u, a, edge if rim else rise + .012*abs(j - middle)/middle)
            row.append((p, normal, "chest"))
        grid.append(row)
    mesh.sheet(grid, mat)


def horn(mesh, hide, u, sign, lean, mat):
    """鞍角：向外、向前或向后撑开的一只短角。"""
    foot, normal = hide.skin(u, sign*.80, .020)
    axis = (normal + Vector((sign*.35, lean*.45, .55))).normalized()
    across = axis.cross(Vector((0, 1, 0))).normalized()
    along = axis.cross(across)
    rings = [([foot + axis*h + (across*math.cos(a) + along*math.sin(a))*r
               for a in (math.tau*k/5 for k in range(5))], "chest") for h, r in ((0, .044), (.058, .036))]
    mesh.shell(rings, mat, tail=(foot + axis*.082, "chest"))


def saddle_bow(mesh, hide, u, half, height, lean, mats, points=5, thick=.034, base=.010):
    """鞍桥：横跨背上的一道拱，中间高、两脚落在背的两侧。

    lean 是拱顶沿背线前倾的距离（负为后仰），mats 是（桥面、桥沿），base 是桥脚离体表多高（压在鞍褥上）。
    """
    along = (hide.skin(u + .05, 0)[0] - hide.skin(u - .05, 0)[0]).normalized()
    foot, crest = {}, {}
    for offset in (thick/2, -thick/2):
        foot[offset], crest[offset] = [], []
        for j in range(points):
            t = j/(points - 1)
            p, normal = hide.skin(u, blend(-half, half, t), base)
            arch = math.sin(math.pi*t)**.7
            foot[offset].append(p + along*offset)
            crest[offset].append((p + along*(offset + lean*arch) + normal*height*(.20 + .80*arch), normal, "chest"))
    for offset, out in ((thick/2, along), (-thick/2, -along)):
        mesh.sheet([[(p, out, "chest") for p in foot[offset]], [(p, out, "chest") for p, _, _ in crest[offset]]], mats[0],
                   smooth=False)
    # 桥沿只有拱顶一段包着边，两脚与桥面同色。
    mesh.sheet([crest[thick/2], crest[-thick/2]], lambda _i, j: mats[1] if 0 < j < points - 2 else mats[0], smooth=False)


def bowed_saddle(mesh, hide, back, front, mats, cantle=(.072, -.055), pommel=(.090, .010), half=.78, pad=.015, rear=.68):
    """高桥鞍：前后两道鞍桥夹着一块鞍面，压在厚 pad 的鞍褥上。

    mats 是（鞍面、桥面、桥沿），cantle、pommel 是后桥、前桥的（高度、前倾），rear 是后桥的宽度占鞍宽的几成。
    """
    stations = ((back + .10, pad + .016), (blend(back, front, .30), pad + .022), (blend(back, front, .70), pad + .022),
                (front - .10, pad + .016))
    seat(mesh, hide, stations, mats[0], half=half*.92, cols=5, edge=pad + .004)
    # 后桥比骑手的胯窄：挂在腰侧的刀鞘、箭囊从它两边垂下去。
    saddle_bow(mesh, hide, back, half*rear, *cantle, mats[1:], base=pad - .004)
    saddle_bow(mesh, hide, front, half*.86, *pommel, mats[1:], base=pad - .004)


def girth(mesh, hide, back, front, drop, mat):
    """肚带：只露出鞍褥（下摆在方位 drop）以下的一段，上头压进鞍褥里一点。"""
    band = [[(*hide.skin(u, a, .008), "chest") for a in (blend(drop - .12, math.tau - drop + .12, j/8) for j in range(9))]
            for u in (back, front)]
    mesh.sheet(band, mat, smooth=False)


def breast_path(side, ahead=0):
    """攀胸的走向：从鞍前绕过肩头到胸前正中。肩头的两点跟着肩胛与肱骨动。

    ahead 是胸前一段再往前让出的距离：袭步里肩端会顶到胸前这么远。
    """
    sign = SIDE[side]
    scapula, humerus = f"scapula.{side}", f"humerus.{side}"
    return [
        ((sign*.222, .285, 1.275), (sign, 0, .2), "chest"),
        ((sign*.262, .430, 1.215), (sign, .1, .2), {scapula: .75, "chest": .25}),
        ((sign*.276, .600, 1.150), (sign, .3, .1), {scapula: .5, humerus: .5}),
        ((sign*.236, .748 + ahead/2, 1.105), (sign*.8, .7, 0), {scapula: .5, humerus: .5}),
        ((sign*.110, .800 + ahead, 1.092), (sign*.2, 1, 0), "chest"),
        ((0, .806 + ahead, 1.090), (0, 1, 0), "chest"),
    ]


def haunch_path(hide, side):
    """鞦带的走向：从鞍后沿肋侧绕过臀部到尾根下面。臀上的几点贴在臀肌鼓出的外面，跟着骨盆走。"""
    sign = SIDE[side]
    return [
        *on_skin(hide, ((5.9, sign*1.02), (5.0, sign*1.12)), .010),
        ((sign*.282, -.440, 1.300), (sign, 0, .3), "pelvis"),
        ((sign*.296, -.580, 1.295), (sign, -.1, .3), "pelvis"),
        ((sign*.250, -.720, 1.285), (sign*.8, -.6, .2), "pelvis"),
        ((sign*.135, -.838, 1.275), (sign*.4, -1, 0), "pelvis"),
        ((0, -.874, 1.270), (0, -1, 0), "pelvis"),
    ]


def bridle(mesh, hide, mat="Horse tack", reins="Horse tack", bands=True):
    """笼头：鼻革、额革、颊革，嘴角的衔环上系着缰绳。戴了面甲就只留衔环与缰绳。"""
    nose = MUZZLE - .35
    if bands:
        band = [[(*hide.skin(u, a, .005), "head") for a in (math.tau*k/8 for k in range(9))]
                for u in (nose - .10, nose + .10)]
        mesh.sheet(band, mat, smooth=False)
        brow = [[(*hide.skin(u, a, .005), "head") for a in (blend(-.95, .95, k/4) for k in range(5))]
                for u in (POLL + .50, POLL + .62)]
        mesh.sheet(brow, mat, smooth=False)
    for sign in SIDE.values():
        if bands:
            cheek = on_skin(hide, ((nose, sign*1.30), (BROW + .55, sign*1.36), (BROW - .30, sign*1.05),
                                   (POLL + .40, sign*.80), (POLL + .05, sign*.25), (POLL, 0)), .006, "head")
            strap(mesh, cheek, .016, mat)
        ring, normal = hide.skin(MUZZLE + .25, sign*1.75, .004)
        disc(mesh, ring, normal, .017, "head")
        path = [
            (ring, (sign, 0, 0), "head"),
            ((sign*.105, 1.150, 1.600), (sign, 0, 0), {"head": .5, "neck3": .5}),
            ((sign*.138, .920, 1.580), (sign, 0, .2), "neck2"),
            ((sign*.168, .720, 1.520), (sign, 0, .3), {"neck1": .6, "chest": .4}),
            ((sign*.070, .520, 1.580), (sign*.6, 0, 1), "chest"),
            ((0, .440, 1.585), (0, 0, 1), "chest"),
        ]
        strap(mesh, path, .014, reins, both=True)


def stirrup(mesh, hide, sign, shoe=False, mat="Iron"):
    """镫：鞍侧垂下一条镫革，底下是踏板与外侧的镫环；shoe 为真时是日本的舌长镫，前头卷起、托住整个脚掌。

    踏板的位置照骑手的脚定：脚跟高、脚尖低。骑手的脚随坐姿起伏上下约两厘米，镫是挂在马身上不动的，
    踏板取脚底起伏的中间高度（脚掌处 0.956 米）：脚落到最低时靴底陷进踏板一点，抬到最高时离开一点。
    日本骑手的脚比别的阵营靠后三厘米。
    """
    if shoe:
        leather = on_skin(hide, ((6.78, sign*.95), (6.90, sign*1.32), (7.00, sign*1.60)), .034, "chest")
        strap(mesh, leather, .030, "Horse tack")
        profile = ((-.175, .988), (.090, .956), (.162, .984), (.188, 1.072), (.112, 1.156))
        tongue, rim = [], []
        for i, (f, z) in enumerate(profile):
            before, after = profile[max(0, i - 1)], profile[min(len(profile) - 1, i + 1)]
            up = Vector((0, -(after[1] - before[1]), after[0] - before[0])).normalized()
            tongue.append([(Vector((sign*x, f, z)), up, "chest") for x in (.222, .346)])
            # 镫是一条有厚度的弯板：从侧面看只见它的侧缘，另铺一条朝外的边。
            rim.append([(Vector((sign*.346, f, z)) + up*lift, Vector((sign, 0, 0)), "chest") for lift in (.004, -.024)])
        mesh.sheet(tongue, mat, smooth=False)
        mesh.sheet(rim, mat, smooth=False)
        return
    # 镫环套在脚掌上：踏板托着脚底，外侧一条从踏板绕过脚背到环顶，镫革从环顶贴着马身上去（在小腿里侧）。
    top = Vector((sign*.318, .075, 1.076))
    leather = on_skin(hide, ((6.74, sign*.95), (6.80, sign*1.32), (6.84, sign*1.56)), .034, "chest")
    strap(mesh, [*leather, (top, Vector((sign, 0, .3)), "chest")], .030, "Horse tack")
    tread = [[(Vector((sign*x, f, .956)), Vector((0, 0, 1)), "chest") for x in (.245, .368)] for f in (.045, .105)]
    mesh.sheet(tread, mat, smooth=False, both=True)
    hoop = [[(Vector((sign*x, f, z)), Vector((sign, 0, .2)), "chest") for f in (.075 - w, .075 + w)]
            for x, z, w in ((.368, .956, .024), (.366, 1.020, .018), (.348, 1.060, .014), (top.x*sign, top.z, .011))]
    mesh.sheet(hoop, mat, smooth=False, both=True)


def level(u, z):
    """第 u 圈上高度为 z 的那一点离背线多少弧度；这一圈够不到这个高度就是 None。"""
    row = axial_row(u)
    if not axial_point(row, math.pi).z <= z <= axial_point(row, 0).z:
        return None
    low, high = 0, math.pi
    for _ in range(24):
        middle = (low + high)/2
        if axial_point(row, middle).z > z:
            low = middle
        else:
            high = middle
    return (low + high)/2


def bulge(f, z):
    """四肢上段在前后位置 f、高度 z 处向外鼓出的半宽。"""
    widest = 0
    for pair, table in BULGE.items():
        start, full, last, end = SPAN[pair]
        if not start < f < end or z >= table[0][0]:
            continue
        fade = 1
        if f < full:
            fade = math.sqrt(1 - ((full - f)/(full - start))**2)
        elif f > last:
            fade = math.sqrt(1 - ((f - last)/(end - last))**2)
        reach = table[-1][1]
        for (high, a), (low, b) in zip(table, table[1:]):
            if low <= z <= high:
                reach = blend(a, b, (high - z)/(high - low))
        widest = max(widest, reach*fade)
    return widest


def wall(hide, u, sign, top, z, pad=.014, gap=.030):
    """挂甲在第 u 站垂到高度 z 时离中线多远、在前后哪个位置。

    顶上从方位 top 起贴着体表，往下搭在躯干或四肢鼓出的地方，底下没有东西托着就垂直挂着，所以只会越往下越宽。
    gap 是给四肢摆动留的余量：甲的边上收回来的那一列留得少，贴着身子。
    """
    crown = hide.skin(u, sign*top)[0]
    reach, f = abs(crown.x), crown.y
    steps = max(1, math.ceil((crown.z - z)/.02))
    for k in range(1, steps + 1):
        height = blend(crown.z, z, k/steps)
        angle = level(u, height)
        if angle is not None and angle > top:
            p = hide.skin(u, sign*angle, pad)[0]
            if abs(p.x) >= reach - .002:
                reach, f = abs(p.x), p.y
        reach = max(reach, bulge(f, height) + gap)
    return reach, f


def tiers(crown, ridge, hem, trim, short=False):
    """一列挂甲各行的高度：领口下面的两行密，肩、臀鼓出的地方弯得急；ridge 以下是垂着的一段，最底下一条是包边。

    short 是只垂到肘、后膝上面的短甲：垂着的一段不再分两行。
    """
    shoulder = crown - min(.07, (crown - ridge)/3)
    hanging = (hem + trim,) if short else ((ridge + hem + trim)/2, hem + trim)
    return shoulder, (shoulder + ridge)/2, ridge, *hanging, hem


def skirt(hide, u, sign, top, ridge, hem, trim, anchor=None, gap=.030, short=False):
    """一列挂甲，从贴着体表的顶点垂到下摆：（位置、朝外方向、蒙皮）。

    anchor 是垂下来的部分跟着哪根骨骼，不给就跟着这一站的躯干。
    """
    crown, normal = hide.skin(u, sign*top, COLLAR)
    column = [(crown, normal, hide.weight(u))]
    for z in tiers(crown.z, ridge, hem, trim, short):
        reach, f = wall(hide, u, sign, top, z, gap=gap)
        column.append((Vector((sign*reach, f, z)), Vector((sign, 0, .2)), anchor or hide.weight(u)))
    return column


def breast(hide, u, top, collar, ridge, hems, trim, short=False, nose=.878, lean=.25):
    """挂甲绕过胸前的几列，从左到右。

    领口从最前面一列肩甲（第 u 站）斜着绕到颈根正前方（第 collar 圈）；甲面是一道圆角的弧，宽处与肩甲接上，
    正前方在 nose。胸前比两肩短（hems 是两端与正中的下摆高度），越往下越向前张开一点（lean），让开前肢提起来的膝。
    """
    columns = []
    for sign, part in ((1, 1/3), (1, 2/3), (1, 1), (-1, 2/3), (-1, 1/3)):
        turn = part*math.pi/2
        station = blend(u, collar, part)
        crown, normal = hide.skin(station, sign*blend(top, math.pi, part**1.4), COLLAR)
        column = [(crown, normal, hide.weight(station))]
        for z in tiers(crown.z, min(ridge, crown.z - .04), blend(hems[0], hems[1], part), trim, short):
            reach, f = wall(hide, u, sign, top, z)
            tip = nose + lean*max(0, .95 - z)
            position = Vector((sign*reach*math.cos(turn)**.77, f + (tip - f)*math.sin(turn)**.77, z))
            column.append((position, Vector((sign*math.cos(turn), math.sin(turn), .2)), "chest"))
        columns.append(column)
    return columns


def housing(mesh, columns, colors, pattern="rows", hem="team trim", border=None, lining="team cloth shadow", lined=3):
    """把若干列挂甲连成一张。

    外面按行（rows）或按格（check）交替甲色，最底下一条是下摆的包边，border 是两端的竖边；
    从第 lined 条起里面再衬一层，免得从下面看过去是空的。
    """
    strips, bands = len(columns) - 1, len(columns[0]) - 1

    def mat(i, j):
        if j == bands - 1:
            return hem
        if border and i in (0, strips - 1):
            return border
        return colors[((i + j) if pattern == "check" else j) % len(colors)]

    start = len(mesh.faces)
    mesh.sheet(columns, mat)
    if lining:
        # 衬里比甲面靠里一点：两层叠在同一个面上，阴影会在甲面上打出条纹。
        inside = [[(Vector(p) - Vector(normal).normalized()*.008, -Vector(normal), weight)
                   for p, normal, weight in column[lined:]] for column in columns]
        mesh.sheet(inside, lining)
    mesh.hanging.append((start, len(mesh.faces)))


def front_housing(mesh, hide, stations, hems, colors, top=.45, collar=13.0, ridge=1.20, trim=.06, tuck=None, short=False,
                  **look):
    """肩甲连着当胸：两肩各几列（stations 从后往前，hems 是各列下摆的高度，最后一项是胸前正中的），中间绕过胸前。

    tuck 是最后面再加的一列收回到肋侧的（站、下摆高度），不给的话后缘就敞着。
    """
    sides = []
    for sign in (1, -1):
        columns = [skirt(hide, u, sign, top, ridge, hem, trim, "chest", short=short) for u, hem in zip(stations, hems)]
        if tuck:
            columns.insert(0, skirt(hide, tuck[0], sign, top, ridge, tuck[1], trim, "chest", gap=.008, short=short))
        sides.append(columns)
    front = breast(hide, stations[-1], top, collar, ridge, hems[-2:], trim, short)
    housing(mesh, [*sides[0], *front, *reversed(sides[1])], colors, **look)


def rear_housing(mesh, hide, stations, hems, colors, top=.78, ridge=1.22, trim=.06, short=False, **look):
    """搭后垂在两臀外侧的甲：stations 从后往前，最后面一列贴着臀收住，最前面一列收回到肋侧。"""
    for sign in (1, -1):
        columns = [skirt(hide, u, sign, top, ridge, hem, trim, gap=.018 if u == stations[0] else .030, short=short)
                   for u, hem in zip(stations, hems)]
        housing(mesh, columns, colors, **look)


def roman_tack(mesh, hide, breast_strap=True):
    saddle_cloth(mesh, hide, 6.15, 9.30, 1.78, bordered("team cloth", "team trim"))
    # 四角鞍：鞍面前后翘起，四只鞍角向外撑开，夹住骑手的大腿。
    seat(mesh, hide, ((6.30, .050), (6.95, .034), (7.75, .030), (8.45, .036), (8.95, .056)), "Horse tack")
    for sign in (1, -1):
        for u, lean in ((6.42, -1), (8.82, 1)):
            horn(mesh, hide, u, sign, lean, "Horse tack")
    girth(mesh, hide, 8.72, 9.08, 1.78, "Horse tack")
    if breast_strap:
        # 攀胸从鞍褥前角绕过肩头到胸前，三枚铜饰。
        for side, sign in SIDE.items():
            path = breast_path(side)
            strap(mesh, path, .034, "Horse tack")
            disc(mesh, (sign*.282, .600, 1.150), (sign, .3, .1), .034, path[2][2])
        disc(mesh, (0, .812, 1.090), (0, 1, 0), .038, "chest")
    bridle(mesh, hide)


def rome(mesh, hide):
    tail(mesh)
    mane(mesh, hide)
    head_details(mesh, hide)
    roman_tack(mesh, hide)


def rome_armored(mesh, hide):
    tail(mesh)
    mane(mesh, hide)
    head_details(mesh, hide)
    roman_tack(mesh, hide, breast_strap=False)
    # 额甲两侧的护眼：铜罩扣在眼上。
    for sign in (1, -1):
        center, normal = hide.skin(BROW - .08, sign*1.22, .008)
        disc(mesh, center, normal, .048, "head")
    # 胸甲：皮底上缀铜鳞，下缘垂一排队伍色的皮穗。
    front_housing(mesh, hide, (9.75, 10.65, 11.60), (1.02, 1.00, .98, .95),
                  ("Leather", "Bronze", "Brass", "Bronze"), trim=.10, hem="team cloth", lining=None, tuck=(9.35, 1.04),
                  short=True)
    # 鞦带上挂铜饰。
    for side in SIDE:
        path = haunch_path(hide, side)
        strap(mesh, path, .032, "Horse tack")
        for p, normal, weight in path[2:4]:
            disc(mesh, Vector(p) + Vector(normal).normalized()*.004, normal, .034, weight)


def chinese_saddle(mesh, hide, lift=.015, edge=.004):
    """鞍褥、高桥鞍与镫。lift、edge 是鞍褥中间与四周垫起的高度：底下压着障泥时要垫高。"""
    saddle_cloth(mesh, hide, 5.26, 9.25, 1.20, bordered("team cloth", "team trim", 5, 7), cols=7, lift=lift, edge=edge,
                 weight=None, margin=(.09, .08))
    # 后桥在骑手臀后：骑手的甲裙最靠后到鞍骨后面 12 厘米多。
    bowed_saddle(mesh, hide, 5.44, 8.95, ("Leather", "Horse tack", "Brass"), pad=lift)
    for sign in (1, -1):
        stirrup(mesh, hide, sign)


def china(mesh, hide):
    # 唐马的样子：鬃剪出三花，尾挽成结。
    tail(mesh, TAIL_KNOT, tip=(-.970, .745), band=(3, "team trim"))
    cropped_mane(mesh, hide, (.028, .088, .030, .094, .030, .088, .028))
    forelock(mesh, hide)
    head_details(mesh, hide)
    # 障泥垂到腹下，鞍褥压在上面，高桥鞍。
    flap(mesh, hide, 6.05, 8.95, 1.02, 2.06, bordered("Leather edge", "team trim", 4, 4))
    chinese_saddle(mesh, hide, .026, .016)
    girth(mesh, hide, 7.55, 7.90, 2.06, "Horse tack")
    # 攀胸与鞦带上垂着杏叶，胸前正中一束缨。
    for side in SIDE:
        for path, hung in ((breast_path(side, .028), slice(1, 4)), (haunch_path(hide, side), slice(2, 5))):
            strap(mesh, path, .030, "Horse tack")
            for p, normal, weight in path[hung]:
                disc(mesh, Vector(p) + Vector((0, 0, -.040)) + Vector(normal).normalized()*.006, normal, .026, weight)
    bob(mesh, (0, .850, 1.085), .16, .040, "chest", "team plume")
    bridle(mesh, hide)


def china_armored(mesh, hide):
    # 具装：面帘、鸡颈贴身，当胸与搭后挂在外面，马身甲压在鞍下，臀上竖着寄生。
    tail(mesh, TAIL_KNOT, tip=(-.970, .745), band=(3, "team trim"))
    head_details(mesh, hide)
    plume(mesh, hide.skin(POLL + .55, 0, .004)[0], (0, .45, 1), ((0, .016), (.045, .030), (.105, 0)), "head",
          ("Brass", "team plume"))
    chinese_saddle(mesh, hide)
    front_housing(mesh, hide, (9.75, 10.40, 11.05, 11.70), (.70, .70, .72, .78, .86), IRON, border="team trim",
                  tuck=(9.35, .76))
    rear_housing(mesh, hide, (.95, 1.60, 2.30, 3.10, 3.90, 4.60, 5.12), (.94, .74, .68, .68, .68, .72, .84), IRON,
                 border="team trim")
    base = hide.skin(2.2, 0, .004)[0]
    for across in ((1, 0, 0), (0, 1, .22)):
        fan(mesh, base, (0, -.22, 1), across, .40, .60, "pelvis", "team plume")
    bridle(mesh, hide, bands=False)


def japanese_saddle(mesh, hide):
    """泥障、切付、前后轮高起的和鞍、舌长镫。"""
    flap(mesh, hide, 6.00, 8.85, 1.00, 1.96, bordered("Leather", "Leather edge", 4, 4))
    saddle_cloth(mesh, hide, 5.26, 9.20, 1.12, bordered("team cloth", "team trim", 5, 7), cols=7, lift=.026, edge=.016,
                 weight=None, margin=(.09, .08))
    # 后桥收窄到胯甲的里侧：照中式鞍的宽度，骑兵奔跑时垂在后腰两侧的草摺会磕在桥脚上。
    bowed_saddle(mesh, hide, 5.44, 8.90, ("Leather", "Lacquer", "Brass"), cantle=(.095, -.050), pommel=(.112, .012),
                 pad=.026, rear=.56)
    girth(mesh, hide, 7.55, 7.90, 1.96, "Horse tack")
    for sign in (1, -1):
        stirrup(mesh, hide, sign, shoe=True)


def japan(mesh, hide):
    tail(mesh)
    mane(mesh, hide)
    head_details(mesh, hide)
    japanese_saddle(mesh, hide)
    # 胸懸与鞦上垂着厚総。
    for side in SIDE:
        for path in (breast_path(side, .028), haunch_path(hide, side)):
            strap(mesh, path, .036, "Horse tack")
            fringe(mesh, path, (.095, .095, .095, .090, .070, .070, .070)[:len(path)], "team plume", flare=.018)
    bridle(mesh, hide, reins="team trim")


def japan_armored(mesh, hide):
    # 马面与练革小札的马铠：金箔小札缀在布上，罩住颈、胸与臀，四边是队伍色的布缘。
    tail(mesh)
    head_details(mesh, hide)
    for sign in (1, -1):
        plume(mesh, hide.skin(BROW - .30, sign*.55, .010)[0], (sign*.55, -.25, 1), ((0, .016), (.05, .012), (.12, 0)),
              "head", ("Brass", "Brass"), sides=4)
    japanese_saddle(mesh, hide)
    front_housing(mesh, hide, (9.75, 10.65, 11.60), (.98, .96, .95, .93), GILT, pattern="check", trim=.09, lining=None,
                  tuck=(9.35, 1.02), short=True)
    rear_housing(mesh, hide, (.95, 1.60, 2.30, 3.10, 3.90, 4.60, 5.12), (1.08, .98, .96, .96, .96, .98, 1.06), GILT,
                 pattern="check", trim=.09, lining=None, short=True)
    # 胸前与尻铠两角垂着色绳结的総。
    bob(mesh, (0, .884, 1.060), .17, .042, "chest", "team plume")
    for sign in (1, -1):
        bob(mesh, (sign*.352, -.700, .985), .15, .040, "pelvis", "team plume")
    bridle(mesh, hide, reins="team trim", bands=False)


def persian_saddle(mesh, hide, drop):
    """软垫鞍，没有镫；drop 是鞍褥下摆的方位，肚带从那里露出来。"""
    seat(mesh, hide, ((6.05, .048), (6.75, .038), (7.55, .036), (8.30, .040), (8.78, .054)), "Leather edge", half=.86,
         edge=.019)
    girth(mesh, hide, 7.60, 7.95, drop, "Horse tack")


def persia(mesh, hide):
    # 鬃剪成城垛，额发扎成一束，尾中段束一道带子。
    tail(mesh, TAIL_TIED, band=(3, "team trim"))
    cropped_mane(mesh, hide, (.070, .070, .028, .070, .070, .028, .070, .070))
    plume(mesh, hide.skin(POLL + .12, 0, 0)[0], (0, .30, 1), ((0, .022), (.032, .020), (.085, .034), (.145, 0)), "head",
          ("team trim", "Horse mane"))
    head_details(mesh, hide)
    # 大鞍褥镶铜色的边。下缘不垂穗：骑手的脚就搭在那里。
    saddle_cloth(mesh, hide, 5.60, 9.02, 1.80, bordered("team cloth", "Brass", 6), rows=6, weight=None, margin=(.06, .05))
    persian_saddle(mesh, hide, 1.80)
    # 攀胸与鞦带上缀圆铜饰，胸前与两臀垂着大缨。
    for side, sign in SIDE.items():
        path = breast_path(side, .028)
        strap(mesh, path, .040, "Leather edge")
        disc(mesh, (sign*.282, .600, 1.150), (sign, .3, .1), .038, path[2][2])
        path = haunch_path(hide, side)
        strap(mesh, path, .040, "Leather edge")
        disc(mesh, Vector(path[3][0]) + Vector((sign*.006, 0, 0)), path[3][1], .038, "pelvis")
        bob(mesh, (sign*.350, -.580, 1.275), .20, .046, "pelvis", "team plume")
    bob(mesh, (0, .856, 1.080), .19, .046, "chest", "team plume")
    bridle(mesh, hide, mat="Leather edge")


def persia_armored(mesh, hide):
    # 铁甲骑兵的马：铜鳞的马衣从颈到臀罩到膝，下摆露出队伍色的衬布。
    tail(mesh, TAIL_TIED, band=(3, "team trim"))
    cropped_mane(mesh, hide, (.050, .050, .050, .050, .050, .050))
    plume(mesh, hide.skin(POLL + .30, 0, .004)[0], (0, .20, 1), ((0, .018), (.05, .040), (.15, .052), (.21, 0)), "head",
          ("Brass", "team plume", "team plume"))
    head_details(mesh, hide)
    saddle_cloth(mesh, hide, 5.75, 9.02, 1.30, bordered("team cloth", "Brass", 5, 7), cols=7, weight=None,
                 margin=(.10, .08))
    persian_saddle(mesh, hide, 1.50)
    front_housing(mesh, hide, (9.75, 10.40, 11.05, 11.70), (.58, .58, .60, .70, .84), SCALE, pattern="check", trim=.07,
                  tuck=(9.35, .66))
    rear_housing(mesh, hide, (.95, 1.60, 2.30, 3.10, 3.90, 4.60, 5.25), (.90, .62, .58, .58, .58, .64, .80), SCALE,
                 pattern="check", trim=.07)
    bridle(mesh, hide, mat="Leather edge", bands=False)


# 一匹马的样式：毛色、白蹄的高度、贴身的甲、鬃尾鞍具与挂甲的做法。阵营名是初级形态，加 _e 是披甲的高级形态。
Style = namedtuple("Style", "coat sock plates dress")
STYLES = {
    "rome": Style("bay", 0, (), rome),
    "rome_e": Style("bay", 0, (Plate(18, 20, 2, .014, ("Brass",), "rings", "Bronze"),), rome_armored),
    "china": Style("chestnut", .36, (), china),
    "china_e": Style("chestnut", .36, (
        Plate(18, 20, 3, .014, IRON, "rings"),
        Plate(12, 17, 6, .020, IRON, "rings"),
        Plate(0, 11, 6, .016, IRON),
    ), china_armored),
    "japan": Style("black", 0, (), japan),
    "japan_e": Style("black", 0, (
        Plate(18, 20, 3, .014, ("Lacquer",), "rings", "Brass"),
        Plate(12, 16, 5, .018, GILT, "check"),
        Plate(0, 4, 3, .016, GILT, "check"),
    ), japan_armored),
    "persia": Style("grey", 0, (), persia),
    "persia_e": Style("grey", 0, (
        Plate(18, 20, 3, .014, GILT, "rings", "Brass"),
        Plate(12, 17, 6, .020, SCALE, "check"),
        Plate(0, 11, 6, .016, SCALE, "check"),
    ), persia_armored),
}


def build_horse(rig, style="rome"):
    """生成一匹马的网格，style 是 STYLES 里的名字。披了挂甲的，把挂甲占的面记在物体的 hanging 属性上。"""
    look = STYLES[style]
    mesh = Skin(COATS[look.coat])
    hide = Hide(look.plates)
    body(mesh, hide)
    limbs(mesh, look.sock)
    look.dress(mesh, hide)
    horse = mesh.build("horse", rig)
    if mesh.hanging:
        horse["hanging"] = [index for span in mesh.hanging for index in span]
    return horse
