"""战马的体表与鬃尾。

躯干、颈、头是一张连续的皮，由腹背两条轮廓线之间的横截面放样而成；四肢各分上下两个壳，
上壳从肩胛、臀部做到肘、后膝，大半埋在躯干里，露出来的就是肩与大腿的肌肉；下壳一直做到蹄冠。
毛色、鬃尾的样式与贴身的甲按阵营换，鞍具与挂甲在 horse_tack.py。
"""

import math
from collections import namedtuple

from mathutils import Vector

from horse_rig import SIDE
from mesh import Mesh, point

AXIAL_SIDES = 16
LIMB_SIDES = 8

# 每个截面：背点、腹点（前向、高度）、半宽、最宽处在腹背之间的位置、上下半圈的饱满度（2 是椭圆，越大越方）、蒙皮。
AXIAL = (
    ((-.850, 1.360), (-.800, 1.090), .085, .55, 2.0, 2.0, "pelvis"),
    ((-.775, 1.432), (-.735, 1.020), .170, .55, 2.0, 2.0, "pelvis"),
    ((-.650, 1.493), (-.625, .995), .228, .58, 2.1, 2.0, "pelvis"),
    ((-.520, 1.525), (-.505, .985), .252, .58, 2.2, 2.0, "pelvis"),
    ((-.380, 1.515), (-.370, .955), .248, .55, 2.2, 2.0, {"pelvis": .5, "loin": .5}),
    ((-.220, 1.495), (-.220, .895), .262, .52, 2.1, 2.1, {"loin": .6, "chest": .4}),
    ((-.060, 1.476), (-.060, .855), .270, .50, 2.0, 2.2, "chest"),
    ((.100, 1.472), (.100, .838), .264, .48, 2.0, 2.2, "chest"),
    ((.250, 1.492), (.250, .834), .248, .45, 1.8, 2.2, "chest"),
    ((.360, 1.538), (.385, .842), .232, .42, 1.55, 2.2, "chest"),
    ((.440, 1.557), (.540, .868), .215, .40, 1.45, 2.1, "chest"),
    ((.500, 1.563), (.690, .950), .195, .36, 1.5, 2.0, "chest"),
    ((.585, 1.630), (.800, 1.090), .170, .33, 1.55, 2.0, {"chest": .5, "neck1": .5}),
    ((.720, 1.735), (.855, 1.250), .135, .38, 1.6, 2.0, {"neck1": .8, "neck2": .2}),
    ((.860, 1.830), (.915, 1.410), .112, .42, 1.7, 2.0, {"neck1": .3, "neck2": .7}),
    ((1.000, 1.910), (.975, 1.565), .097, .45, 1.8, 2.0, {"neck2": .5, "neck3": .5}),
    ((1.130, 1.968), (1.030, 1.695), .089, .48, 1.9, 2.0, {"neck3": .75, "head": .25}),
    ((1.195, 1.985), (1.058, 1.705), .092, .35, 2.3, 2.1, {"head": .8, "neck3": .2}),
    ((1.315, 1.828), (1.140, 1.620), .112, .66, 2.6, 1.9, "head"),
    ((1.385, 1.707), (1.244, 1.559), .088, .62, 2.5, 2.0, "head"),
    ((1.454, 1.608), (1.3385, 1.503), .068, .58, 2.4, 2.1, "head"),
    ((1.507, 1.523), (1.401, 1.449), .062, .52, 2.4, 2.2, "head"),
    ((1.520, 1.453), (1.442, 1.416), .050, .50, 2.2, 2.2, "head"),
)
# 截面表里几处的下标：鬐甲、项顶、眉、鼻。
WITHERS, POLL, BROW, MUZZLE = 11, 17, 18, 20

# 四肢的截面：高度、前向、前后半径、横向、外内半径、倾斜（前低后高的斜率）、两端向中线收拢的距离、蒙皮、往下一段的毛色。
# 每条腿分上下两个壳：上壳是肩臂或臀股的肌肉，底下收口；下壳从肘或后膝的关节处起，上端藏在上壳里，
# 关节屈伸时像套筒一样转，不会像一张连续的皮那样在关节后面拧翻。
FORE_UPPER = (
    (1.430, .430, .050, .050, .105, .045, .045, 0, 0, "chest", "Bay"),
    (1.335, .450, .125, .110, .125, .082, .060, 0, .05, {"chest": .6, "scapula": .4}, "Bay"),
    (1.205, .500, .190, .150, .140, .105, .070, 0, .09, {"scapula": .7, "chest": .3}, "Bay"),
    (1.075, .555, .205, .170, .150, .110, .075, 0, .10, {"scapula": .5, "humerus": .5}, "Bay"),
    (.965, .545, .172, .158, .155, .102, .078, 0, .06, {"humerus": .7, "scapula": .3}, "Bay"),
    (.885, .525, .140, .140, .160, .090, .074, 0, .03, "humerus", "Bay"),
    (.830, .525, .100, .105, .160, .072, .062, 0, .01, "humerus", "Bay"),
)
FORE_LOWER = (
    (.870, .522, .088, .088, .160, .066, .058, 0, 0, "forearm", "Bay"),
    (.790, .525, .108, .104, .160, .072, .064, 0, 0, "forearm", "Bay"),
    (.680, .525, .084, .078, .158, .060, .055, 0, 0, "forearm", "Bay"),
    (.565, .523, .060, .058, .156, .048, .046, 0, 0, "forearm", "Bay shade"),
    (.488, .522, .066, .058, .155, .056, .054, 0, 0, "forearm", "Bay points"),
    (.400, .522, .058, .054, .155, .052, .050, 0, 0, "fore_cannon", "Bay points"),
    (.345, .520, .040, .046, .155, .037, .037, 0, 0, "fore_cannon", "Bay points"),
    (.225, .520, .038, .046, .155, .036, .036, 0, 0, "fore_cannon", "Bay points"),
    (.168, .518, .048, .060, .155, .046, .046, 0, 0, "fore_cannon", "Bay points"),
    (.128, .530, .042, .050, .155, .041, .041, 0, 0, "fore_pastern", "Bay points"),
    (.066, .582, .048, .044, .155, .045, .045, .25, 0, "fore_pastern", None),
)
HIND_UPPER = (
    (1.450, -.500, .070, .070, .110, .050, .050, 0, 0, "pelvis", "Bay"),
    (1.380, -.520, .190, .170, .140, .100, .070, 0, .04, "pelvis", "Bay"),
    (1.260, -.560, .240, .225, .160, .125, .080, 0, .07, {"pelvis": .85, "thigh": .15}, "Bay"),
    (1.140, -.575, .255, .225, .170, .125, .085, 0, .08, {"pelvis": .62, "thigh": .38}, "Bay"),
    (1.020, -.565, .240, .215, .175, .115, .090, 0, .06, {"pelvis": .38, "thigh": .62}, "Bay"),
    (.925, -.540, .200, .190, .180, .100, .086, 0, .03, {"thigh": .85, "pelvis": .15}, "Bay"),
    (.862, -.490, .140, .165, .180, .082, .072, 0, .01, "thigh", "Bay"),
)
# 小腿（胫）的截面垂直于胫骨，所以前低后高；飞节后上方的尖是跟骨，随管骨动。
HIND_LOWER = (
    (.880, -.450, .094, .112, .178, .076, .066, .78, 0, "gaskin", "Bay"),
    (.781, -.496, .112, .126, .176, .084, .072, .78, 0, "gaskin", "Bay"),
    (.702, -.557, .079, .095, .167, .062, .056, .78, 0, "gaskin", "Bay"),
    (.624, -.619, .057, .073, .158, .050, .047, .78, 0, "gaskin", "Bay shade"),
    (.576, -.656, .047, .066, .156, .046, .044, .78, 0, "gaskin", "Bay points"),
    (.560, -.682, .049, .073, .155, .050, .048, .78, 0, "hind_cannon", "Bay points"),
    (.470, -.684, .058, .060, .155, .048, .047, 0, 0, "hind_cannon", "Bay points"),
    (.400, -.680, .043, .049, .155, .038, .038, 0, 0, "hind_cannon", "Bay points"),
    (.235, -.680, .041, .048, .155, .037, .037, 0, 0, "hind_cannon", "Bay points"),
    (.175, -.682, .050, .061, .155, .047, .047, 0, 0, "hind_cannon", "Bay points"),
    (.135, -.668, .043, .051, .155, .041, .041, 0, 0, "hind_pastern", "Bay points"),
    (.070, -.622, .048, .045, .155, .044, .044, .25, 0, "hind_pastern", None),
)
# 上壳收口的那一点（前向、高度）。
LIMB_CAP = {"fore": (.525, .790), "hind": (-.485, .805)}
# 上壳截面上各点的方位（度，从正前方转向外侧）：内侧埋在躯干里，把点让给看得见的外侧；下壳各点均匀分布。
BURIED = (0, 32, 62, 90, 118, 148, 180, 270)
# 蹄：蹄冠与蹄底两圈（高度、前向、前后半径、半宽、倾斜）。
HOOF = {
    "fore": ((.076, .582, .057, .051, .052, .25), (0, .606, .072, .070, .066, 0)),
    "hind": ((.080, -.622, .055, .050, .050, .25), (0, -.5985, .069, .068, .062, 0)),
}
LIMBS = {"fore": (FORE_UPPER, FORE_LOWER), "hind": (HIND_UPPER, HIND_LOWER)}

# 尾：沿中线下垂的一束，每站是（前向、高度、半宽、半厚、蒙皮）。
TAIL = (
    (-.825, 1.345, .040, .042, "tail1"),
    (-.895, 1.305, .055, .050, "tail1"),
    (-.935, 1.190, .078, .062, {"tail1": .5, "tail2": .5}),
    (-.955, 1.030, .098, .072, "tail2"),
    (-.962, .850, .108, .076, {"tail2": .5, "tail3": .5}),
    (-.962, .670, .100, .070, "tail3"),
    (-.955, .500, .074, .054, "tail3"),
    (-.945, .360, .026, .022, "tail3"),
)
# 缚尾：尾毛在尾根下面扎一道，挽成一个结，只垂到后膝。
TAIL_KNOT = (
    (-.825, 1.345, .040, .042, "tail1"),
    (-.895, 1.305, .052, .048, "tail1"),
    (-.935, 1.190, .058, .052, {"tail1": .5, "tail2": .5}),
    (-.950, 1.100, .046, .042, "tail2"),
    (-.955, 1.050, .046, .042, "tail2"),
    (-.966, .985, .090, .074, "tail2"),
    (-.972, .900, .084, .070, "tail2"),
    (-.972, .825, .050, .044, {"tail2": .5, "tail3": .5}),
)
# 束尾：尾毛中段用带子束一道，底下照常散开。
TAIL_TIED = (
    (-.825, 1.345, .040, .042, "tail1"),
    (-.895, 1.305, .055, .050, "tail1"),
    (-.935, 1.190, .076, .062, {"tail1": .5, "tail2": .5}),
    (-.951, 1.075, .060, .052, "tail2"),
    (-.956, 1.015, .058, .050, "tail2"),
    (-.962, .850, .106, .076, {"tail2": .5, "tail3": .5}),
    (-.962, .670, .100, .070, "tail3"),
    (-.955, .500, .074, .054, "tail3"),
    (-.945, .360, .026, .022, "tail3"),
)

# 贴身的甲：把躯干这张皮上的一片顶点沿法线垫高、面换成甲的颜色，不另加面，所以随皮一起动、不会穿出来。
# first、last 是罩住的截面下标，reach 是从背线向两侧各罩几格（一圈 16 格），lift 是垫高的距离；
# colors 是交替的甲色，pattern 定怎么交替：rows 沿身长一行一色（披在身上的札甲），rings 一圈一色（箍在颈上的甲），
# check 一格一色（鳞甲）。垫高的顶点与没垫高的顶点之间那一圈斜面是甲的包边，颜色是 edge。
Plate = namedtuple("Plate", "first last reach lift colors pattern edge", defaults=("rows", "team trim"))


def blend(a, b, t):
    return a + (b - a)*t


def axial_row(u):
    """把截面表按下标插值，u 可以是小数。"""
    i = max(0, min(len(AXIAL) - 2, math.floor(u)))
    t = u - i
    a, b = AXIAL[i], AXIAL[i+1]
    dorsal = (blend(a[0][0], b[0][0], t), blend(a[0][1], b[0][1], t))
    ventral = (blend(a[1][0], b[1][0], t), blend(a[1][1], b[1][1], t))
    return (dorsal, ventral, *(blend(a[k], b[k], t) for k in range(2, 6)))


def axial_point(row, angle):
    """截面上的一点，angle 从背线起、向左侧转（弧度）。"""
    dorsal, ventral, width, widest, top, bottom = row
    c, s = math.cos(angle), math.sin(angle)
    power = top if c >= 0 else bottom
    reach = (1 - widest) if c >= 0 else widest
    t = widest + reach*math.copysign(abs(c)**(2/power), c)
    x = width*math.copysign(abs(s)**(2/power), s)
    return Vector((x, blend(ventral[0], dorsal[0], t), blend(ventral[1], dorsal[1], t)))


class Hide:
    """躯干、颈、头这张皮，连同贴身的甲把它垫高了哪些地方。鞍具都贴着它摆。"""

    def __init__(self, plates=()):
        self.plates = tuple(plates)

    def plate(self, ring, k):
        """罩住第 ring 圈第 k 个顶点的甲。"""
        k %= AXIAL_SIDES
        steps = min(k, AXIAL_SIDES - k)
        for plate in self.plates:
            if plate.first <= ring <= plate.last and steps <= plate.reach:
                return plate
        return None

    def rise(self, u, angle):
        """体表上一点被甲垫高了多少：在顶点之间线性插值。"""
        i = max(0, min(len(AXIAL) - 2, math.floor(u)))
        turn = (angle % math.tau)/(math.tau/AXIAL_SIDES)
        k = math.floor(turn)

        def at(ring, col):
            plate = self.plate(ring, col)
            return plate.lift if plate else 0

        return blend(blend(at(i, k), at(i, k + 1), turn - k), blend(at(i + 1, k), at(i + 1, k + 1), turn - k), u - i)

    def panel(self, layer, n):
        """第 layer、layer+1 两圈之间第 n 格的甲色；没有甲就是 None。"""
        corners = [self.plate(layer + i, n + k) for i in (0, 1) for k in (0, 1)]
        plate = next((corner for corner in corners if corner), None)
        if plate is None:
            return None
        if any(corner is not plate for corner in corners):
            return plate.edge
        row = min(n, AXIAL_SIDES - 1 - n)
        index = {"rows": row, "rings": layer, "check": row + layer}[plate.pattern]
        return plate.colors[index % len(plate.colors)]

    def skin(self, u, angle, lift=0):
        """体表上的点连同外法线；lift 是沿法线再抬起的距离，马具贴着体表摆时用。"""
        row = axial_row(u)
        p = axial_point(row, angle)
        d = .01
        ahead = axial_point(axial_row(min(u + d, len(AXIAL) - 1.001)), angle)
        along = ahead - axial_point(axial_row(max(u - d, 0)), angle)
        around = axial_point(row, angle + d) - axial_point(row, angle - d)
        normal = along.cross(around)
        dorsal, ventral = row[0], row[1]
        core = Vector((0, (dorsal[0] + ventral[0])/2, (dorsal[1] + ventral[1])/2))
        if normal.dot(p - core) < 0:
            normal.negate()
        normal.normalize()
        if self.plates:
            lift += self.rise(u, angle)
        return p + normal*lift, normal

    def weight(self, u):
        """u 处的蒙皮：相邻两圈合起来不超过两根骨时按位置过渡，否则取近的那一圈。"""
        i = max(0, min(len(AXIAL) - 2, math.floor(u)))
        t = u - i
        a, b = ({w: 1} if isinstance(w, str) else w for w in (AXIAL[i][6], AXIAL[i + 1][6]))
        bones = sorted(set(a) | set(b))
        if len(bones) > 2 or t in (0, 1):
            return AXIAL[i if t < .5 else i + 1][6]
        mixed = {bone: blend(a.get(bone, 0), b.get(bone, 0), t) for bone in bones}
        mixed = {bone: value for bone, value in mixed.items() if value > 1e-9}
        return next(iter(mixed)) if len(mixed) == 1 else mixed


def named(weight, side):
    """肢体截面表里的骨名不带左右，这里补上；躯干的骨骼没有左右。"""
    def name(bone):
        return bone if bone in ("chest", "pelvis") else f"{bone}.{side}"

    if isinstance(weight, str):
        return name(weight)
    return {name(bone): value for bone, value in weight.items()}


class Skin(Mesh):
    def __init__(self, coat=None):
        super().__init__()
        # 毛色表：体表按枣骝马的颜色名建，别的毛色在这里换名。
        self.coat = coat or {}
        # 挂甲占的面（起、止下标）：生成时拿来查它与四肢有没有相交。
        self.hanging = []

    def face(self, indices, mat, smooth=False):
        super().face(indices, self.coat.get(mat, mat), smooth)

    def facing(self, indices, outward, mat, smooth=True):
        """按给定的朝外方向决定绕向，背面不会被剔掉。"""
        a, b, c = (self.vertices[i] for i in indices[:3])
        normal = (b - a).cross(c - a)
        if len(indices) == 4:
            normal += (c - a).cross(self.vertices[indices[3]] - a)
        if normal.dot(point(outward)) < 0:
            indices = tuple(reversed(indices))
        self.face(tuple(indices), mat, smooth)

    def panel(self, quad, outward, mat, smooth=True):
        """四边形拆成两个三角形，各自朝外：两圈点的方位不一致时四边形是扭的，交给导出器拆会有一片翻到里面。"""
        outward = point(outward)

        def lean(tri):
            a, b, c = (self.vertices[i] for i in tri)
            return (b - a).cross(c - a).normalized().dot(outward)

        a, b, c, d = quad
        # 两条对角线里挑拆出来的两片都更正对外侧的那条。
        split = max((((a, b, c), (a, c, d)), ((a, b, d), (b, c, d))),
                    key=lambda tris: min(abs(lean(tri)) for tri in tris))
        for tri in split:
            self.face(tri if lean(tri) >= 0 else tuple(reversed(tri)), mat, smooth)

    def shell(self, rings, mat, head=None, tail=None, smooth=True):
        """把若干圈点放样成一个壳。每圈是（各点、蒙皮），朝外方向取自相邻两圈的中心。

        head、tail 是收口的顶点（位置、蒙皮），不给就敞着（埋在别的壳里的那头）。
        """
        loops, centers = [], []
        for positions, weight in rings:
            loops.append([self.vertex(p, weight) for p in positions])
            centers.append(sum((Vector(p) for p in positions), Vector())/len(positions))
        sides = len(loops[0])
        for layer, (low, high) in enumerate(zip(loops, loops[1:])):
            core = (centers[layer] + centers[layer+1])/2
            for n in range(sides):
                nxt = (n + 1) % sides
                quad = (low[n], high[n], high[nxt], low[nxt])
                middle = sum((Vector(rings[layer + k][0][j]) for k in (0, 1) for j in (n, nxt)), Vector())/4
                self.panel(quad, middle - core, mat(layer, n) if callable(mat) else mat, smooth)
        for end, loop, center, layer in ((head, loops[0], centers[0], 0), (tail, loops[-1], centers[-1], len(loops) - 2)):
            if end is None:
                continue
            position, weight = end
            tip = self.vertex(position, weight)
            for n in range(sides):
                nxt = (n + 1) % sides
                self.facing((loop[n], loop[nxt], tip), Vector(position) - center,
                            mat(layer, n) if callable(mat) else mat, smooth)

    def sheet(self, grid, mat, smooth=True, both=False):
        """把一张点阵连成面片。grid[i][j] 是（位置、朝外方向、蒙皮）；both 时背面再铺一层。"""
        for flip in (1, -1) if both else (1,):
            indices = [[self.vertex(p, weight) for p, _, weight in row] for row in grid]
            for i, (low, high) in enumerate(zip(indices, indices[1:])):
                for j in range(len(low) - 1):
                    quad = (low[j], high[j], high[j+1], low[j+1])
                    normal = sum((Vector(grid[i + a][j + b][1]) for a in (0, 1) for b in (0, 1)), Vector())
                    self.facing(quad, flip*Vector(normal), mat(i, j) if callable(mat) else mat, smooth)


def body(mesh, hide):
    def coat(layer, n):
        plated = hide.panel(layer, n)
        if plated:
            return plated
        if layer >= MUZZLE:
            return "Muzzle"
        # 额头到鼻梁的一道白章。
        if BROW <= layer < MUZZLE and n in (0, AXIAL_SIDES - 1):
            return "Blaze"
        return "Bay"

    rings = []
    for i, row in enumerate(AXIAL):
        angles = [math.tau*k/AXIAL_SIDES for k in range(AXIAL_SIDES)]
        positions = [hide.skin(i, a)[0] if hide.plate(i, k) else axial_point(row[:6], a) for k, a in enumerate(angles)]
        rings.append((positions, row[6]))
    mesh.shell(rings, coat, head=((0, -.862, 1.235), "pelvis"), tail=((0, 1.495, 1.411), "head"))


def limb_ring(side, z, f, front, back, x, outer, inner, pitch=0, wrap=0, buried=False):
    positions = []
    for k in range(LIMB_SIDES):
        a = math.radians(BURIED[k] if buried else 360*k/LIMB_SIDES)
        c, s = math.cos(a), math.sin(a)
        ahead = (front if c >= 0 else back)*c
        across = (outer if s >= 0 else inner)*s - wrap*c*c
        positions.append((side*(x + across), f + ahead, z - pitch*ahead))
    return positions


def limbs(mesh, sock=0):
    """sock 是白蹄的高度：这个高度以下的毛换成白的。"""
    for pair, (upper, lower) in LIMBS.items():
        for side, sign in SIDE.items():
            rings = [(limb_ring(sign, *row[:9], buried=True), named(row[9], side)) for row in upper]
            cap = LIMB_CAP[pair]
            mesh.shell(rings, "Bay", tail=((sign*upper[-1][4], *cap), named(upper[-1][9], side)))
            rings = [(limb_ring(sign, *row[:9]), named(row[9], side)) for row in lower]
            mesh.shell(rings, lambda layer, _n: "Blaze" if lower[layer][0] <= sock else lower[layer][10])
            hoof = f"{pair}_hoof.{side}"
            top, sole = HOOF[pair]
            x = lower[-1][4]
            rings = [(limb_ring(sign, z, f, front, back, x, half, half, pitch), hoof)
                     for z, f, front, back, half, pitch in (top, sole)]
            mesh.shell(rings, "Hoof", tail=((sign*x, sole[1], .004), hoof))


def tail(mesh, shape=TAIL, tip=(-.940, .300), band=None):
    """shape 是尾的各站，tip 是尾梢；band 给出（第几段、颜色）时那一段换成束尾的带子。"""
    rings = []
    for i, (f, z, half_width, half_depth, weight) in enumerate(shape):
        before, after = shape[max(0, i - 1)], shape[min(len(shape) - 1, i + 1)]
        along = Vector((0, after[0] - before[0], after[1] - before[1])).normalized()
        depth = Vector((0, -along.z, along.y))
        center = Vector((0, f, z))
        rings.append(([center + Vector((half_width*math.cos(a), 0, 0)) + depth*half_depth*math.sin(a)
                       for a in (math.tau*k/6 for k in range(6))], weight))
    hair = "Horse mane" if band is None else lambda layer, _n: band[1] if layer == band[0] else "Horse mane"
    mesh.shell(rings, hair, tail=((0, *tip), shape[-1][4]))


def mane(mesh, hide):
    # 鬃毛披在右侧：颈脊左缘、脊上的毛梢、右侧披下来的外沿与下摆。
    grid = []
    for u in range(WITHERS, POLL + 1):
        weight = hide.weight(u)
        dorsal = AXIAL[u][0]
        crest = Vector((-.004, dorsal[0], dorsal[1]))
        up = hide.skin(u, 0)[1]
        hang = 1 - .25*(abs(u - (WITHERS + POLL)/2)/((POLL - WITHERS)/2))**2
        left, normal = hide.skin(u, .22)
        outer, out = hide.skin(u, -.62, .016)
        hem, _ = hide.skin(u, -.62 - .58*hang, -.004)
        grid.append(((left, normal, weight), (crest + up*.034, up, weight), (outer, out, weight), (hem, out, weight)))
    mesh.sheet(grid, "Horse mane")
    forelock(mesh, hide)


def forelock(mesh, hide):
    # 额发从两耳之间垂到额头。
    top, up = hide.skin(POLL, 0, .030)
    fall = [hide.skin(POLL + .62, a, .012) for a in (.35, 0, -.35)]
    sides = [hide.skin(POLL + .12, a, .014) for a in (.42, -.42)]
    v = [mesh.vertex(p, "head") for p in (top, sides[0][0], fall[0][0], fall[1][0], fall[2][0], sides[1][0])]
    for a, b in zip(v[1:], v[2:]):
        mesh.facing((v[0], a, b), up, "Horse mane")


def cropped_mane(mesh, hide, heights):
    """剪短立起来的鬃：沿颈脊一道窄棱，heights 是从鬐甲到项顶各站的高度，高低相间就成了剪出的花。"""
    grid = []
    count = len(heights) - 1
    for i, height in enumerate(heights):
        u = blend(WITHERS + .4, POLL - .1, i/count)
        weight = hide.weight(round(u))
        crest, up = hide.skin(u, 0, height)
        grid.append(((hide.skin(u, .16, -.002)[0], Vector((1, 0, .3)), weight), (crest, up, weight),
                     (hide.skin(u, -.16, -.002)[0], Vector((-1, 0, .3)), weight)))
    mesh.sheet(grid, "Horse mane", smooth=False)


def head_details(mesh, hide):
    for side, sign in SIDE.items():
        ear = f"ear.{side}"
        base = Vector((sign*.060, 1.178, 1.972))
        axis = Vector((sign*.16, .20, 1)).normalized()
        out = Vector((sign, 0, 0))
        front = axis.cross(out)*sign
        # 耳廓朝前张开：中段最宽，前面一侧凹进去。
        rings = [([base + axis*h + front*a*math.cos(t) + out*b*math.sin(t)
                   for t in (math.tau*k/4 for k in range(4))], ear) for h, a, b in ((0, .024, .022), (.058, .020, .034))]
        mesh.shell(rings, lambda _layer, n: "Bay shade" if n in (0, 3) else "Bay", tail=(base + axis*.138, ear))

        def patch(u, angle, half_u, half_a, lift, mat):
            # 贴在头侧的小菱形：眼、鼻孔。
            corners = [hide.skin(u + du, sign*(angle + da), lift)[0]
                       for du, da in ((-half_u, 0), (0, half_a), (half_u, 0), (0, -half_a))]
            mesh.facing(tuple(mesh.vertex(p, "head") for p in corners), hide.skin(u, sign*angle)[1], mat, smooth=False)

        patch(BROW - .08, 1.22, .20, .20, .005, "Horse eye")
        patch(MUZZLE + .75, .78, .22, .30, .004, "Horse eye")
