"""生成战国日本兵种：blender -b --factory-startup --python-exit-code 1 -P tools/art/japan.py"""

import argparse
import math
import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))

from mathutils import Vector

import unhorse
from human_motion import HIT_TIME, STRIDE, TIMING, arm, envelope, flung_arm, ground_step, leg, reaching_arm, seat_origin
from mesh import PALETTE, Mesh, Pose, angles, armature, clip, export, mix, point, reset, turn
from registry import cavalry_spec, read_manifest, write_manifest
from rome import HIP, LOWER_ARM, SHIN, SIDE, THIGH, UPPER_ARM, human_skeleton
from siege import wheel

SETS = {
    "yari": "spear", "samurai": "katana", "yumi": "longbow",
    "teppo": "gun", "kiba": "ride_sword", "sohei": "polearm",
}
ATTACKS = ("attack", "attack2", "attack3")
COMMON = ("idle", "ready", "walk", "run", *ATTACKS, "die")
EXTRA = {"yari": ("brace", "charge"), "kiba": ("charge",), "sohei": ("charge",)}
PALETTE_JAPAN = {
    "Japanese black lacquer": ((.073, .076, .073), .22, .55),
    "Japanese brown lacquer": ((.201, .092, .050), .25, .48),
    "Japanese lacquer bevel": ((.248, .176, .121), .25, .44),
    "Japanese indigoblack": ((.081, .096, .111), 0, .89),
    "Japanese undyed cloth": ((.78, .75, .66), 0, .87),
    "Japanese linen folds": ((.49, .46, .39), 0, .91),
    "Japanese black iron": ((.115, .109, .100), .58, .48),
    "Japanese bamboo": ((.55, .36, .17), 0, .56),
    "Japanese powder dark": ((.023, .021, .019), 0, .95),
    "team Sashimono": ((.91,)*3, 0, .82),
    "team Sashimono fold": ((.72,)*3, 0, .86),
    "team Odoshi": ((.79,)*3, 0, .77),
    "team Jingasa mon": ((.86,)*3, 0, .73),
}
BLACK = "Japanese black lacquer"
BROWN = "Japanese brown lacquer"
BEVEL = "Japanese lacquer bevel"
INDIGO = "Japanese indigoblack"
WHITE = "Japanese undyed cloth"
FOLD = "Japanese linen folds"
IRON = "Japanese black iron"
BAMBOO = "Japanese bamboo"
DARK = "Japanese powder dark"
FLAG = "team Sashimono"
FLAG_FOLD = "team Sashimono fold"
CORD = "team Odoshi"
MON = "team Jingasa mon"
RIGHT, LEFT = "weapon.R", "weapon.L"
GRIP_Z = .835


def layer(mesh, rings, sides, surface, caps=False):
    mesh.rings(rings, sides, surface, caps=caps)


def laced_plate(mesh, x, y, z, width, height, lean, weight, surface, ornate, axis=(0, 1)):
    a, b = axis
    rows = []
    for h, w, shift in ((0, .96, lean), (.23, 1, lean*.77), (1, .96, 0)):
        rows.append([mesh.vertex((x+b*d*width*w+a*(shift+.025*d*d),
                                  y-a*d*width*w+b*(shift+.025*d*d), z+h*height), weight)
                     for d in (-.5, 0, .5)])
    for row, (low, high) in enumerate(zip(rows, rows[1:])):
        for i in range(2):
            face = (low[i], low[i+1], high[i+1], high[i])
            trim = "Brass" if ornate else CORD if i == 0 else BEVEL
            mesh.face(face, trim if row == 0 else surface)


def body(mesh, kind, elite):
    commander = kind == "samurai" and elite
    monk = kind == "sohei"
    noble = kind in ("samurai", "kiba")
    lancer = kind == "yari" and elite
    archer = kind == "yumi" and elite
    garment = WHITE if monk or archer else INDIGO
    shell = "Steel shadow" if lancer else IRON if commander or archer else BROWN if noble or elite else BLACK
    layer(mesh, [(0, .001, z, w, d, bone) for z, w, d, bone in (
        (.87, .146, .096, "hips"), (1.04, .143, .094, "hips"),
        (1.28, .173, .106, "spine"), (1.40, .183, .101, "chest"),
        (1.46, .069, .064, "chest"),
    )], 10, garment, True)
    if monk:
        for s in SIDE.values():
            rows = [
                ((0, .111, 1.154), (s*.039, .114, 1.186), "spine"),
                ((s*.046, .104, 1.326), (s*.103, .111, 1.332), "chest"),
                ((s*.071, .048, 1.465), (s*.112, .043, 1.441), "chest"),
            ]
            pairs = [tuple(mesh.vertex(v, bone) for v in (a, b)) for a, b, bone in rows]
            for (a, b), (c, d) in zip(pairs, pairs[1:]):
                mesh.face((a, c, d, b), FOLD)
    if kind != "yumi" or elite:
        z0 = 1.035 if monk else 1.008
        for i in range(3 if monk else 4):
            z = z0 + .067*i
            binding = "chest" if z >= 1.27 else ("spine" if z >= 1.14 else {"hips": .35, "spine": .65})
            w = .158 + .010*i + (.022 if commander or lancer else .008 if elite else 0)
            d = .111 + .003*i + (.012 if commander or lancer else 0)
            layer(mesh, [(0, -.006, z, w, d, binding),
                         (0, -.006, z+.015, w+.003, d+.003, binding),
                         (0, -.006, z+.066, w+.008, d+.008, binding)], 10,
                  lambda row, n: (CORD if commander or lancer or n in (1, 3, 7, 9) else BEVEL) if row == 0 else shell)
        if not monk:
            layer(mesh, [(0, -.007, z, w+(.020 if commander else 0), d+(.010 if commander else 0), "chest")
                         for z, w, d in ((1.286, .191, .129), (1.370, .201, .111), (1.421, .151, .099))],
                  10, lambda row, n: (
                      CORD if row and (commander or lancer or n in (1, 4, 7, 10))
                      else FOLD if archer and row and n in (0, 2, 3, 5, 8, 9) else shell))
    layer(mesh, [(0, 0, z, .166, .110, "hips") for z in (.984, 1.029)], 10,
          CORD if monk or kind == "yumi" else "Leather")
    mesh.box((-.010, .117, 1.006), (.062, .020, .039), "Brass" if elite or noble else BEVEL, "hips")
    if monk:
        for side, s in SIDE.items():
            cloth(mesh, [
                ([(s*x, f, z) for x, f in row], weight)
                for z, row, weight in (
                    (.682 if elite else .73, ((-.022, .122), (.094, .146), (.193, .103)),
                     {"hips": .22, "thigh."+side: .78}),
                    (.831, ((-.018, .116), (.087, .136), (.181, .092)), {"hips": .5, "thigh."+side: .5}),
                    (.990, ((-.010, .110), (.067, .124), (.156, .086)), "hips"),
                )
            ], lambda row, n: CORD if elite and row == 0 and n == 1 else WHITE if n == 0 else FOLD,
                  reverse=True)
    else:
        for side, s in SIDE.items():
            leg_bone = "thigh." + side
            for i in range(4 if elite and kind != "kiba" else 3):
                pitch = .069 if lancer else .062 if elite or noble else .058
                z = .988 - (i+1)*pitch
                weight = {"hips": 1-(i+1)*.14, leg_bone: (i+1)*.14}
                for face in (-1, 1):
                    laced_plate(mesh, s*.101, face*(.119+i*.009), z, .166+i*.014,
                                (.071 if lancer else .064), .022, weight, shell, elite and i == 2, (0, face))
                laced_plate(mesh, s*(.165+i*.014), -.009, z, .196+.015*i,
                            (.071 if lancer else .064), .027, weight, shell, elite and i == 2, (s, 0))


def commander_sleeve(mesh, side):
    s = SIDE[side]
    upper = "upper_arm." + side
    mount = {"shoulder."+side: .35, upper: .65}
    # 袖甲在肩外展开，甲缘由上臂带动，避免挥刀时兜与袖甲一起转动。
    rows = []
    for z, x, depth, weight in (
        (1.156, .316, .110, upper), (1.191, .320, .129, upper),
        (1.245, .307, .123, upper), (1.300, .292, .116, upper),
        (1.353, .274, .100, upper), (1.403, .238, .079, mount),
    ):
        rows.append(([(s*u, f, z) for u, f in (
            (x-.060, -depth), (x, -depth*.75), (x+.012, 0),
            (x, depth*.81), (x-.053, depth),
        )], weight))
    if s > 0:
        rows = [(list(reversed(points)), weight) for points, weight in rows]
    cloth(mesh, rows, lambda row, n: "Brass" if row == 0 else CORD if n in (1, 2) else IRON)


def commander_leg_guard(mesh, x, profile, binding):
    # 甲片由正面绕向两侧，边缘贴近裤腿，屈膝时保持各自的绑点。
    rows = [
        ([(x-width, edge, z), (x, ridge, z), (x+width, edge, z)], binding)
        for z, width, edge, ridge in profile
    ]
    cloth(mesh, rows, lambda row, n: "Brass" if row == 0 else IRON)


def limbs(mesh, kind, elite):
    commander = kind == "samurai" and elite
    monk = kind == "sohei"
    noble = kind in ("samurai", "kiba")
    for side, s in SIDE.items():
        upper, lower, hand, thigh, shin, foot, toe = (
            n+"."+side for n in ("upper_arm", "forearm", "hand", "thigh", "shin", "foot", "toe")
        )
        x = .192*s
        archer = kind == "yumi" and elite
        lancer = kind == "yari" and elite
        garment = WHITE if monk or archer else INDIGO
        layer(mesh, [(x, f, z, w, d, b) for f, z, w, d, b in (
            (0, 1.109, .050, .047, {upper: .45, lower: .55}),
            (0, 1.196, .059, .054, upper),
            (0, 1.390, .075, .068, upper),
            (0, 1.443, .062, .059, {"chest": .45, upper: .55}),
        )], 6, garment)
        layer(mesh, [(x, f, z, w, d, b) for f, z, w, d, b in (
            (0, .858, .032, .032, {lower: .7, hand: .3}),
            (.007, .990, .049, .043, lower),
            (.007, 1.094, .049, .048, lower),
            (0, 1.119, .050, .047, {upper: .45, lower: .55}),
        )], 7, lambda row, n: (BEVEL if n in (1, 2) and row < 2 else garment))
        if commander:
            commander_sleeve(mesh, side)
        elif lancer:
            for i in range(3):
                z = 1.226+i*.057
                width = .204-i*.016
                laced_plate(mesh, x+s*.077, 0, z, width, .063,
                            .027, upper, "Steel shadow", i == 0, (s, 0))
                laced_plate(mesh, x+s*.048, .073, z, .103, .063, .023, upper, IRON, i == 0)
        elif archer:
            width = .17 if side == "R" else .136
            laced_plate(mesh, x+s*.066, .002, 1.334, width, .075, .030, upper, IRON, True, (s, 0))
        elif noble or elite:
            for i in range(2 if elite and noble else 1):
                z = 1.365 - .051*i
                laced_plate(mesh, x+s*(.070+i*.011), -.003, z, .169+(i*.013), .054,
                            .023, upper, BROWN, elite, (s, 0))
                if kind == "samurai":
                    laced_plate(mesh, x+s*.045, .068, z, .104+i*.014, .054,
                                .014, upper, BROWN, elite)
        layer(mesh, [(x, f, z, w, d, b) for f, z, w, d, b in (
            (.010, .774, .026, .024, hand), (.009, .797, .039, .034, hand),
            (0, .840, .037, .031, hand), (0, .862, .032, .031, {lower: .7, hand: .3}),
        )], 6, "Skin shade")
        mesh.tube((x+s*.027, .015, .838), (x+s*.032, .026, .802), .014, .011, 4, "Skin", hand)
        x = .092*s
        knee = {thigh: .4, shin: .6}
        layer(mesh, [(x, f, z, w, d, b) for f, z, w, d, b in (
            (.010, .491, .055, .054, knee), (.025, .543, .065, .063, thigh),
            (.011, .690, .086 if monk else .074, .079, thigh),
            (-.008, .906, .092, .096, {"hips": .3, thigh: .7}),
        )], 6, lambda row, n: (FOLD if monk and n in (1, 4) else INDIGO))
        layer(mesh, [(x, f, z, w, d, b) for f, z, w, d, b in (
            (-.009, .084, .033, .043, {shin: .4, foot: .6}),
            (-.011, .157, .042, .052, shin), (-.014, .327, .060, .060, shin),
            (.002, .487, .055, .054, knee), (.009, .512, .055, .055, knee),
        )], 6, lambda row, n: (
            (BEVEL if elite and n == 1 else IRON) if row == 1 and n in (0, 1, 2, 3)
            and (not monk or elite) else (WHITE if row < 2 else INDIGO)))
        if commander or lancer:
            commander_leg_guard(mesh, x, (
                (.474, .059, .023, .079), (.492, .063, .025, .084), (.678, .081, .031, .100),
            ), {thigh: .85, shin: .15})
            commander_leg_guard(mesh, x, (
                (.128, .038, .013, .046), (.149, .041, .013, .051), (.383, .058, .020, .066),
            ), shin)
        outline = [(-.041, -.070), (.041, -.070), (.049, .113), (.034, .176),
                   (.006, .181), (-.004, .174), (-.039, .171), (-.048, .116)]
        mesh.loft([
            ([(x+u, f, z + (.017 if row == 2 and f < .1 else 0)) for u, f in outline],
             lambda i: toe if outline[i][1] > .13 else foot)
            for row, z in enumerate((0, .014, .038))
        ], lambda row, n: "Leather" if row == 0 or n == 4 else WHITE, smooth=False)


def front_badge(mesh, x, y, z, radius, weight, surface, slope=0):
    vertices = [mesh.vertex((x+radius*math.cos(a), y, z+radius*(math.sin(a)+slope*math.cos(a))),
                            weight) for a in angles(8, -math.pi/8)]
    mesh.face(vertices, surface)


def commander_crest(mesh):
    for s in SIDE.values():
        # 两支锹形向外上方张开，尖端一前一后，正侧视也留有间隙。
        rings = []
        for x, f, z, width, ridge in (
            (.034, .146, 1.735, .022, .018),
            (.088, .148, 1.839, .030, .023),
            (.146, .123, 1.981, .026, .020),
            (.229, .093, 2.108, .003, .006),
        ):
            f += s*.132*((z-1.735)/.373)**2
            points = [
                (s*(x-width), f, z+.42*width),
                (s*(x+width), f, z-.42*width),
                (s*x, f+ridge, z),
            ]
            rings.append((points[::s], "head"))
        mesh.loft(rings, lambda row, n: "Bronze" if n == (0 if s > 0 else 1) else "Brass",
                  smooth=False)
        turnback = [(s*x, f, z) for x, f, z in (
            (.077, .113, 1.645), (.154, .094, 1.654), (.175, .073, 1.732),
            (.125, .104, 1.751), (.097, .122, 1.708),
        )]
        mesh.face([mesh.vertex(p, "head") for p in turnback[::s]], "Brass")
    mesh.box((0, .105, 1.728), (.121, .136, .046), "Bronze", "head")
    front_badge(mesh, 0, .177, 1.771, .052, "head", "Brass")
    mesh.rings([(0, f, z, w, d, "head") for f, z, w, d in (
        (.039, 1.549, .046, .049), (.037, 1.573, .069, .062),
        (.019, 1.616, .084, .086), (.010, 1.639, .082, .082),
    )], 8, lambda row, n: ("Bronze" if row == 2 and n in (0, 3) else IRON), caps=False)
    mouth = [(-.033, .109, 1.604), (-.023, .116, 1.587),
             (.023, .116, 1.587), (.033, .109, 1.604)]
    mesh.face([mesh.vertex(p, "head") for p in mouth], DARK)


def veteran_helm(mesh, kind):
    lancer = kind == "yari"
    if lancer:
        # 桃形盔的高冠前宽后尖，兜顶的铜脊和侧影在俯视下分开。
        profile = (
            (1.660, -.007, .112, .113), (1.704, -.005, .110, .109),
            (1.769, -.012, .095, .095), (1.847, -.018, .064, .078),
            (1.934, -.034, .027, .041), (1.988, -.053, .010, .018),
        )
    else:
        profile = (
            (1.665, -.013, .109, .105), (1.707, -.018, .112, .106),
            (1.767, -.019, .098, .086), (1.811, -.022, .066, .059),
            (1.839, -.021, .032, .035),
        )
    mesh.rings([(0, f, z, w, d, "head") for z, f, w, d in profile], 10, lambda row, n:
               ("Brass" if row == 0 else "Steel" if lancer and n in (2, 3) else
                "Steel shadow" if lancer else BLACK))
    for i in range(2):
        z = 1.666 - .048*i
        cloth(mesh, [
            ([(w*math.cos(a), -.024 + d*math.sin(a), z+dz) for a in
              (-math.pi+j*math.pi/7 for j in range(7, -1, -1))], "head")
            for dz, w, d in ((-.033, .129+i*.011, .109+i*.013),
                             (-.021, .129+i*.011, .110+i*.013),
                             (.012, .110+i*.014, .101+i*.013))
        ], lambda row, n: (CORD if row == 0 else IRON))
    if lancer:
        seam = ((0, .105, 1.728), (0, .073, 1.805), (0, .034, 1.898), (0, -.042, 1.984))
        for start, end in zip(seam, seam[1:]):
            mesh.tube(start, end, .013, .008, 4, "Brass", "head")
    else:
        # 小扇前立和浅色兜巾保留弓手的轻装轮廓。
        for side, sign in SIDE.items():
            cloth(mesh, [
                ([(sign*.088, f, z), (sign*.120, f-.018, z+.009)], "head")
                for f, z in ((.033, 1.578), (.033, 1.626), (.058, 1.681))
            ], lambda row, n: WHITE if row == 0 else FOLD, reverse=True)
        mesh.box((0, .086, 1.715), (.047, .061, .038), "Bronze", "head")
        fan = ((-.018, .120, 1.726), (.018, .120, 1.726), (.059, .119, 1.808),
               (.019, .134, 1.839), (-.019, .134, 1.839), (-.059, .119, 1.808))
        center = mesh.vertex((0, .149, 1.785), "head")
        border = [mesh.vertex(v, "head") for v in fan]
        for i, vertex in enumerate(border):
            face = (vertex, border[(i+1)%len(border)], center)
            color = "Brass" if i%2 else "Bronze"
            mesh.face(face, color)
        mesh.face([mesh.vertex((x, f-.003, z), "head") for x, f, z in reversed(fan)], "Bronze")


def head(mesh, kind, elite):
    noble = kind in ("samurai", "kiba")
    layer(mesh, [(0, .004, z, w, d, b) for z, w, d, b in (
        (1.450, .057, .052, "chest"), (1.525, .050, .047, "neck"),
        (1.576, .050, .049, "head"),
    )], 7, "Skin")
    layer(mesh, [(0, f, z, w, d, "head") for f, z, w, d in (
        (.016, 1.547, .044, .049), (.007, 1.581, .067, .068),
        (.002, 1.636, .078, .081), (-.006, 1.693, .082, .079),
        (-.009, 1.740, .059, .054),
    )], 10, lambda row, n: "Skin shade" if row < 2 and n in (0, 4, 5, 9) else "Skin", True)
    mesh.loft([([(u, f, z) for u, f in coords], "head") for z, coords in (
        (1.612, ((-.017, .074), (.017, .074), (.012, .103), (-.012, .103))),
        (1.630, ((-.014, .077), (.014, .077), (.008, .110), (-.008, .110))),
        (1.671, ((-.011, .077), (.011, .077), (.008, .090), (-.008, .090))),
    )], "Skin light", smooth=False)
    for s in SIDE.values():
        mesh.box((s*.034, .077, 1.647), (.030, .006, .008), "Hair", "head")
    mesh.box((0, .079, 1.584), (.039, .005, .006), "Skin shade", "head")

    if kind == "sohei":
        mesh.rings([(0, f, z, w, d, "head") for f, z, w, d in (
            (-.016, 1.626, .084, .082), (-.009, 1.678, .093, .092),
            (-.013, 1.738, .077, .086), (-.024, 1.768, .042, .052),
        )], 12, lambda row, n: FOLD if (row+n)%5 == 0 else WHITE)
        for side, s in SIDE.items():
            mesh.loft([
                ([(s*.058, .074, 1.656), (s*.087, .030, 1.666), (s*.087, -.057, 1.678)], "head"),
                ([(s*.062, .069, 1.552), (s*.097, -.004, 1.564), (s*.074, -.092, 1.565)], "head"),
                ([(s*.096, .025, 1.468), (s*.135, -.028, 1.480), (s*.077, -.109, 1.438)],
                 {"neck": .35, "chest": .65}),
            ], lambda row, n: FOLD if n == 1 else WHITE, caps=False)
        if elite:
            front_badge(mesh, 0, .085, 1.703, .028, "head", CORD)
        return

    if noble:
        layer(mesh, [(0, -.012, z, w, d, "head") for z, w, d in (
            (1.664, .108, .116), (1.707, .106, .105), (1.766, .084, .086),
            (1.804, .049, .058), (1.820 if elite else 1.802, .020, .025),
        )], 12, lambda row, n: BEVEL if n in (2, 8) else BLACK, True)
        for i in range(3 if elite else 2):
            z = 1.670 - .044*i
            mesh.loft([
                ([(w*math.cos(a), -.023 + d*math.sin(a), z+dz+.037*max(0, math.sin(a)))
                  for a in (-math.pi+i*math.pi/8 for i in range(9))], "head")
                for dz, w, d in ((-.032, .125+i*.012, .114+i*.009),
                                 (-.016, .124+i*.012, .112+i*.009),
                                 (.012, .114+i*.012, .108+i*.009))
            ], lambda row, n: CORD if row == 0 and n%2 == 0 else BROWN, caps=False)
        mesh.box((0, .102, 1.694), (.154, .055, .023), BEVEL, "head")
        if kind == "samurai" and elite:
            commander_crest(mesh)
            return
        for s in SIDE.values():
            points = ((0, .110, 1.724), (s*.096, .119, 1.751),
                      (s*(.178 if elite else .126), .099, 1.899 if elite else 1.841),
                      (s*.065, .129, 1.785), (0, .118, 1.755))
            back, front = [[mesh.vertex((x, f+depth, z), "head") for x, f, z in points[::s]]
                           for depth in (0, .015)]
            mesh.face(back[::-1], "Bronze")
            mesh.face(front, "Brass")
            for i in range(len(points)):
                j = (i+1) % len(points)
                mesh.face((front[i], back[i], back[j], front[j]), "Bronze")
        for s in SIDE.values():
            if kind == "samurai":
                mesh.box((s*.097, .077, 1.672), (.053, .048, .044), BROWN, "head")
            if elite:
                mesh.face([mesh.vertex(p, "head") for p in (
                    (s*.039, .074, 1.596), (s*.088, .053, 1.632),
                    (s*.088, .040, 1.566), (0, .089, 1.535), (0, .100, 1.587),
                )], IRON)
        return

    if elite and kind in ("yari", "yumi"):
        veteran_helm(mesh, kind)
        return
    brim = {"yari": .172, "teppo": .149, "yumi": .162}[kind] + (.014 if elite else 0)
    top = 1.831 if kind == "teppo" else 1.813
    layer(mesh, [(0, .001, z, w, w*.94, "head") for z, w in (
        (1.695, brim*.94), (1.711, brim), (1.735, brim*.76), (top, .020),
    )], 14, lambda row, n: ("Brass" if elite else BEVEL) if row == 0 else
          (BEVEL if row == 1 and n % 5 == 0 else BLACK), True)
    mesh.tube((0, .001, top-.004), (0, .001, top+.017), .024, .014, 7, "Brass" if elite else BEVEL, "head")
    for x, y, z in ((0, brim*.54, 1.770), (-.027, brim*.70, 1.751), (.027, brim*.70, 1.751)):
        vertices = [mesh.vertex((x+.015*math.cos(a), y-.021*math.sin(a), z+.013*math.sin(a)), "head")
                    for a in angles(8)]
        mesh.face(vertices, MON)


def cloth(mesh, rings, surface, reverse=False):
    for direction in ((1, -1) if reverse else (1,)):
        rows = [[mesh.vertex(position, weight) for position in positions] for positions, weight in rings]
        for row, (a, b) in enumerate(zip(rows, rows[1:])):
            for i in range(len(a)-1):
                face = (a[i], a[i+1], b[i+1], b[i])
                mesh.face(face[::direction], surface(row, i), True)


def flag(mesh, x, f, z, width, height, elite, binding="mantle", pole_length=.62):
    mesh.tube((x, f, z-pole_length), (x, f, z+.021), .011, .009, 6, BAMBOO, binding)
    mesh.tube((x-.016, f, z), (x+width+.019, f, z), .009, .009, 6, BAMBOO, binding)
    def flag_point(t, row, depth=0):
        return (x+width*t, f+.017*math.sin(7*t+row*.9)*row/3-.013*row+depth,
                z-height*row/3+.018*t*math.sin(row*1.55))

    cloth(mesh, [([flag_point(t, row) for t in (0, .19, .43, .78, 1)], binding) for row in range(4)],
          lambda row, n: WHITE if elite and n == 3 else FLAG_FOLD if n == 1 else FLAG, reverse=True)
    diamond = ((.60, .82), (.77, 1.43), (.60, 2.05), (.43, 1.43))
    for side in (-1, 1):
        points = [mesh.vertex(flag_point(t, row, side*.010), binding) for t, row in diamond[::side]]
        mesh.face(points, WHITE if elite else BLACK)


def archer_pennant(mesh):
    # 旗杆靠左，旗尾在右侧箭羽外缘之前收住。
    x, f, z = .105, -.226, 2.105
    width = .266
    mesh.tube((x, f, 1.309), (x, f, z+.020), .012, .009, 6, BAMBOO, "mantle")
    mesh.tube((x-width-.017, f, z), (x+.014, f, z), .010, .008, 6, BAMBOO, "mantle")
    rows = []
    for row, stretch in enumerate((1, .97, .91, .85)):
        points = []
        for t in (0, .24, .52, .77, 1):
            notch = .105*(1-abs(2*t-1)) if row == 3 else 0
            points.append((x-width*(1-t)*stretch, f+.020*math.sin(5*t+row*.85)*row/3-.012*row,
                           z-.415*row/3+notch))
        rows.append((points, "mantle"))
    cloth(mesh, rows, lambda row, n: WHITE if row == 0 or n == 0 else FLAG if n < 3 else FLAG_FOLD,
          reverse=True)


def banner(mesh, kind, elite):
    if kind == "sohei" and not elite:
        return
    if kind == "samurai" and elite:
        # 母衣从肩部系住，在背后鼓出并向腰下收束。
        mesh.rings([
            (0, f, z, w, d, weight) for z, f, w, d, weight in (
                (.696, -.229, .058, .071, "mantle"),
                (.816, -.288, .207, .160, "mantle"),
                (1.023, -.321, .260, .196, "mantle"),
                (1.229, -.277, .207, .161, {"chest": .28, "mantle": .72}),
                (1.382, -.152, .148, .069, "chest"),
            )
        ], 7, lambda row, n: FLAG_FOLD if n in (0, 2, 5) else FLAG)
        flag(mesh, -.169, -.316, 2.188, .465, .570, True, pole_length=.96)
        return
    if kind == "yari" and elite:
        flag(mesh, -.124, -.189, 2.209, .330, .663, True, pole_length=.880)
        mesh.box((-.124, -.146, 1.360), (.050, .079, .074), "Leather", "chest")
        return
    if kind == "yumi" and elite:
        archer_pennant(mesh)
        mesh.box((.105, -.155, 1.35), (.049, .156, .064), "Leather", "chest")
        return
    if kind == "kiba" and elite:
        # 腰后的布面收在后鞍桥上方，给鞍座随步态俯仰留出余量。
        edges = []
        for z, w, f, weight in (
            (1.035, .219, -.238, "mantle"), (1.155, .205, -.182, "mantle"),
            (1.27, .185, -.151, {"chest": .4, "mantle": .6}),
            (1.42, .155, -.098, "chest"),
        ):
            edges.append(([(w*d, f+.041*d*d+.017*(i%2), z+.028*d*d)
                           for i, d in enumerate((-1, -.62, 0, .62, 1))], weight))
        cloth(mesh, edges, lambda row, n: WHITE if n in (0, 3) else FLAG if n%2 else FLAG_FOLD, reverse=True)
    width = .265 if elite else .18
    x = -.15 if kind == "yumi" else -.056
    flag(mesh, x, -.187 if kind != "yumi" else -.224, 2.03 if elite else 1.955,
         width, .420 if elite else .326, elite)
    mesh.box((x, -.141, 1.356), (.053, .069, .058), "Leather", "chest")


def blade(mesh, x, z, points, binding=RIGHT):
    mesh.loft([
        ([(x+dx, f, z+dz) for dx, dz in
          ((-thickness, base), (0, base+width), (thickness, base), (0, base-width))], binding)
        for f, base, width, thickness in points
    ], lambda row, n: "Steel edge" if n in (0, 1) else "Steel shadow", smooth=False)


def equipment(mesh, kind, elite):
    x, z = -.192, GRIP_Z
    if kind in ("yari", "sohei"):
        yari = kind == "yari"
        tail, tip = (-1.04, 1.31) if yari else (-.64, .92)
        mesh.tube((x, tail, z), (x, tip, z), .017, .015, 7, BAMBOO if yari else BROWN, RIGHT)
        for a, b in ((tail-.025, tail+.064), (tip-.14, tip+.009)):
            mesh.tube((x, a, z), (x, b, z), .020, .019, 7, IRON if not elite else "Brass", RIGHT)
        mesh.tube((x, -.072, z), (x, .40, z), .021, .021, 7, BLACK, RIGHT)
        if yari:
            blade(mesh, x, z, ((tip-.030, 0, .021, .014), (tip+.035, 0, .044, .014),
                               (tip+.239, 0, .001, .001)))
        else:
            blade(mesh, x, z, ((tip-.025, 0, .024, .012), (tip+.050, .020, .052, .013),
                               (tip+.237, .063, .047, .009), (tip+.357, .128, .001, .001)))
    elif kind in ("samurai", "kiba"):
        mesh.tube((x, -.304, z), (x, .083, z), .023, .024, 7, BLACK, RIGHT)
        for f in (-.25, -.130, -.013):
            mesh.tube((x, f, z), (x, f+.014, z), .025, .023, 5, CORD if elite else "Leather edge", RIGHT)
        mesh.tube((x, .070, z), (x, .096, z), .048, .047, 9, "Brass" if elite else IRON, RIGHT)
        blade(mesh, x, z, ((.096, 0, .025, .009), (.34, .016, .026, .009),
                           (.64, .059, .024, .007), (.83, .121, .017, .005), (.90, .149, .001, .001)))
        # 刀鞘斜挂在左腰后：步行的鞘尾垂到胯下；骑马的抬高到胯的高度，鞘尾才不抵进马臀与尻铠。
        scabbard_tip = .944 if kind == "kiba" else .771
        mesh.tube((.153, .057, 1.003), (.205, -.536, scabbard_tip), .028, .022, 7, BLACK, "hips")
    elif kind == "yumi":
        yumi(mesh, elite)
    else:
        teppo(mesh, elite)


def archer_quiver(mesh):
    binding = "chest"
    mesh.rings([
        (x, f, z, w, d, binding) for x, f, z, w, d in (
            (-.178, -.199, .958, .035, .043),
            (-.199, -.224, 1.036, .064, .062),
            (-.238, -.266, 1.393, .061, .063),
            (-.252, -.282, 1.471, .073, .066),
            (-.254, -.284, 1.502, .069, .063),
            (-.254, -.284, 1.503, .052, .048),
            (-.250, -.281, 1.450, .049, .045),
        )
    ], 8, lambda row, n: ("Brass" if row in (3, 4) else DARK if row == 5 else
                          "Oak end" if n in (1, 4, 7) else "Leather"), caps=False)
    mesh.box((-.179, -.202, .974), (.067, .082, .042), BEVEL, binding)
    for i, (dx, df, height) in enumerate((
        (-.036, .008, 1.729), (-.010, -.023, 1.780), (.025, -.010, 1.709),
        (.024, .019, 1.750), (-.018, .024, 1.692),
    )):
        x, f = -.252+dx, -.284+df
        top = (x+dx*.52-.023, f-.038+df*.34, height)
        mesh.tube((x, f, 1.448), top, .0045, .004, 4, BAMBOO, binding)
        tx, tf, tz = top
        for a in (i*.42, i*.42+math.pi/2, i*.42+math.pi):
            ca, sa = math.cos(a), math.sin(a)
            vane = [(tx+w*ca, tf+w*sa, tz+z) for w, z in (
                (0, -.112), (.028, -.078), (.024, -.030), (0, .005),
            )]
            for direction in (1, -1):
                mesh.face([mesh.vertex(v, binding) for v in vane[::direction]],
                          WHITE if direction == 1 else FOLD)
    cloth(mesh, [
        ([(x-w, f, z), (x+w, f, z+.018)], binding)
        for x, f, z, w in (
            (-.145, .066, 1.075, .014), (-.093, .137, 1.144, .016),
            (-.006, .149, 1.259, .016), (.096, .103, 1.390, .015),
            (.122, .009, 1.454, .015), (.104, -.075, 1.458, .015),
        )
    ], lambda row, n: "Leather edge", reverse=True)


def yumi(mesh, elite):
    x, z = .192, GRIP_Z
    profile = ((.005, -.70), (-.051, -.61), (.013, -.51), (.095, -.335),
               (.138, -.129), (.138, .06), (.126, .32), (.087, .63),
               (.002, .955), (-.036, 1.19), (.005, 1.36))
    rings = []
    tip_weights = ({LEFT: .84, "bowstring": .16}, {LEFT: .80, "bowstring": .20})
    for i, (f, h) in enumerate(profile):
        f -= .138
        w = .009+.009*math.sin(math.pi*i/(len(profile)-1))
        influence = (max(0, h/1.36)**2*.20 if h > 0 else (h/.70)**2*.16)
        weight = {LEFT: 1-influence, "bowstring": influence}
        rings.append(([(x+w*math.cos(a), f+w*.73*math.sin(a), z+h) for a in angles(6)], weight))
    mesh.loft(rings, lambda row, n: BLACK if row in (4, 5) else "Ash" if n%2 else BAMBOO)
    cord = (x, -.133, z)
    mesh.tube((x, -.133, z-.70), cord, .003, .003, 4, WHITE, tip_weights[0], end_weight="bowstring")
    mesh.tube(cord, (x, -.133, z+1.36), .003, .003, 4, WHITE, "bowstring", end_weight=tip_weights[1])
    if elite:
        archer_quiver(mesh)
        return
    a, b = (.19, -.09, .926), (.256, -.12, 1.407)
    mesh.tube(a, b, .057, .073, 7, "Leather", "chest")
    mesh.tube((.252, -.118, 1.363), (.257, -.12, 1.416), .074, .075, 7, BEVEL, "chest")
    for i, dx in enumerate((-.031, 0, .031)):
        a = (.257+dx, -.120-.02*(i%2), 1.402)
        b = (a[0]+dx*.35, a[1], 1.690+i*.035)
        mesh.tube(a, b, .0045, .0045, 4, BAMBOO, "chest")
        for side in (-1, 1):
            mesh.face([mesh.vertex((b[0]+side*w, b[1], b[2]+h), "chest")
                       for h, w in ((-.11, 0), (-.067, .021), (-.018, .013), (.005, 0))], WHITE)


def muzzle(mesh, x, f, z, radius, binding, surface, sides=12):
    mesh.loft([
        ([(x+r*math.cos(a), depth, z+r*math.sin(a)) for a in angles(sides)], binding)
        for depth, r in ((f-.047, radius*.9), (f, radius), (f+.001, radius*.63),
                         (f-.043, radius*.61))
    ], lambda row, n: DARK if row == 2 else surface, caps=False)
    mesh.tube((x, f-.060, z), (x, f-.055, z), radius*.60, radius*.60, sides, DARK, binding)


def teppo(mesh, elite):
    x, z = -.192, GRIP_Z
    mesh.loft([
        ([(x+sx*w, f, z+h+sz*d) for sx, sz in ((-1, -1), (1, -1), (1, 1), (-1, 1))], RIGHT)
        for f, h, w, d in ((-.407, -.067, .031, .062), (-.297, -.049, .029, .044),
                            (-.081, -.029, .027, .034), (.150, -.010, .032, .047),
                            (.516, -.022, .021, .025), (.684, -.024, .015, .017))
    ], lambda row, n: "Oak end" if n == 1 else BROWN, smooth=False)
    mesh.tube((x, .016, z+.029), (x, .840, z+.041), .034, .023, 8, IRON, RIGHT, smooth=False)
    muzzle(mesh, x, .867, z+.041, .031, RIGHT, IRON, 8)
    for f in (.191, .659):
        mesh.tube((x, f, z+.013), (x, f+.025, z+.013), .035, .035, 7,
                  "Brass" if elite else BEVEL, RIGHT)
    # 空闲时通条收在枪托边，装填阶段由副手控制。
    mesh.tube((.192, -.452, z), (.192, .005, z), .008, .006, 5, BAMBOO, "bowstring")
    mesh.box((x, .735, z+.068), (.012, .019, .017), IRON, RIGHT)
    mesh.box((x, .187, z+.075), (.030, .018, .014), IRON, RIGHT)
    mesh.box((x-.027, .075, z+.003), (.024, .133, .055), "Brass", RIGHT)
    mesh.tube((x-.045, .041, z-.004), (x-.050, .090, z+.104), .009, .009, 6, IRON, RIGHT)
    mesh.tube((x-.050, .090, z+.104), (x-.050, .139, z+.074), .008, .007, 6, "Rope", RIGHT)
    mesh.tube((x-.050, .139, z+.074), (x-.052, .166, z+.063), .008, .007, 6, BEVEL, RIGHT)
    mesh.rings([(.148, .012, q, r, r*.79, "hips") for q, r in (
        (.906, .045), (.934, .061), (1.013, .061), (1.034, .039),
    )], 8, "Leather")
    mesh.box((.151, .012, 1.049), (.074, .051, .021), BEVEL, "hips")


def infantry(kind, elite, rig):
    mesh = Mesh()
    body(mesh, kind, elite)
    limbs(mesh, kind, elite)
    head(mesh, kind, elite)
    banner(mesh, kind, elite)
    equipment(mesh, kind, elite)
    mesh.build(kind + ("_e" if elite else ""), rig)


# 主手的位置、装备的俯仰/滚转/偏航。双手武器用同一刚体计算副手握点。
HOLD = {
    "yari": ((-.17, .07, 1.105), (-30, 0, 17)),
    "samurai": ((-.034, .385, 1.233), (-49, 4, 15)),
    "yumi": ((.237, .383, 1.246), (-15, -22, -9)),
    "teppo": ((-.183, .12, 1.195), (-38, -8, 17)),
    "kiba": ((-.301, .240, 1.268), (-48, 2, -17)),
    "sohei": ((-.177, .053, 1.086), (-29, 16, 21)),
}

# 每个变体的蓄势、命中、随势。较长的兵器在横扫中保持两手间距。
MELEE = {
    "yari": (
        (((-.29, -.12, 1.23), (-7, 0, 5)), ((-.178, .414, 1.261), (-4, 0, 7)),
         ((-.158, .416, 1.228), (5, 0, 10)), (13, -4, 24, .115)),
        (((-.23, -.073, 1.40), (-42, 0, -6)), ((-.15, .388, 1.437), (16, 10, 5)),
         ((-.125, .423, 1.356), (32, 10, 10)), (6, -8, 19, .079)),
        (((-.35, .14, 1.04), (4, 0, -63)), ((-.155, .31, 1.06), (7, 0, 44)),
         ((-.06, .34, 1.10), (9, 0, 70)), (18, 8, 33, .067)),
    ),
    "samurai": (
        (((-.186, .268, 1.675), (-107, 8, -20)), ((-.08, .443, 1.418), (27, -11, 7)),
         ((.049, .381, 1.072), (59, -5, 26)), (19, -6, 18, .085)),
        (((-.275, .191, 1.414), (-34, 30, -100)), ((-.040, .454, 1.312), (11, 38, 36)),
         ((.188, .348, 1.150), (29, 32, 90)), (13, 11, 36, .075)),
        (((.166, .269, 1.095), (20, -33, 92)), ((-.090, .457, 1.273), (-11, -30, -36)),
         ((-.264, .291, 1.472), (-38, -22, -79)), (9, -11, -34, .062)),
    ),
    "kiba": (
        (((-.384, .155, 1.63), (-98, 14, -33)), ((-.407, .396, 1.19), (39, 15, -20)),
         ((-.416, .22, 1.08), (60, 22, -37)), (14, -14, 14, 0)),
        # 横斩过马颈时抬起刀尖，再回到执刀待命姿势。
        (((-.38, .13, 1.38), (-31, 7, -124)), ((-.46, .28, 1.29), (15, 10, -55)),
         ((-.28, .435, 1.28), (-3, 13, 18)), (8, -18, 30, 0)),
        (((-.299, -.011, 1.15), (19, -11, -122)), ((-.255, .477, 1.31), (-7, -6, -5)),
         ((-.186, .445, 1.36), (-20, 0, 15)), (13, -4, 17, 0)),
    ),
    "sohei": (
        (((-.267, .075, 1.47), (-87, 17, -38)), ((-.167, .348, 1.36), (26, 0, 10)),
         ((-.125, .386, 1.194), (42, 3, 24)), (19, -7, 27, .108)),
        (((-.35, .025, 1.075), (3, 10, -96)), ((-.171, .356, 1.10), (11, 23, 49)),
         ((-.090, .355, 1.113), (18, 23, 83)), (10, 15, 40, .065)),
        (((.048, .234, 1.10), (22, -24, 72)), ((-.171, .374, 1.321), (-16, -33, -22)),
         ((-.284, .259, 1.473), (-34, -27, -65)), (11, -11, -28, .087)),
    ),
}
BOW_SHOTS = (
    # 开弓高度、弓身倾角、侧倾、放弦时右手的后撤幅度、屈膝量。
    (1.515, 0, -7, .089, .026),
    (1.700, -23, 11, .134, .008),
    (1.379, 18, -39, .101, .15),
)
GUN_SHOTS = (
    # 靠肩平射、前步俯射、屈膝射击。
    (((-.107, .314, 1.365), (0, 5, 2)), (6, -7, 12, .050), .008),
    (((-.143, .355, 1.479), (13, 10, 4)), (15, -11, 21, .112), .022),
    (((-.128, .323, 1.378), (-7, -14, -6)), (4, 11, -11, .018), .205),
)


def paired(a, b, fraction):
    return tuple(mix(x, y, fraction) for x, y in zip(a, b))


def hold_at(kind, movement, t, duration):
    hold = HOLD[kind]
    if movement in ATTACKS:
        variant = ATTACKS.index(movement)
        if kind == "teppo":
            aim, _, _ = GUN_SHOTS[variant]
            recoil = ((aim[0][0]-.012, aim[0][1]-.045, aim[0][2]+.033),
                      (aim[1][0]-8, aim[1][1]-6, aim[1][2]-4))
            reload = ((-.165, .134, .995), (-77-4*variant, -10, 12))
            prepare = paired(hold, aim, .82)
            return equipment_keys(t, ((0, prepare), (.104, aim), (.19, recoil), (.31, aim),
                                      (.46, reload), (.69, reload), (duration, hold)))
        if kind == "yumi":
            height, pitch, roll, _, _ = BOW_SHOTS[variant]
            full = ((.174, .647 if variant != 1 else .531, height), (pitch, roll, 0))
            raise_bow = ((.203, .488, height+.083), (pitch-13, roll-18, -8))
            settle = ((.205, .597, height-.037), (pitch+5, roll+7, 2))
            return equipment_keys(t, ((0, raise_bow), (.102, full), (.169, full), (.28, settle),
                                      (.53, settle), (duration, hold)))
        windup, contact, follow, _ = MELEE[kind][variant]
        # 游戏命中后立即播短蓄势，0.133 秒跨过接触点。
        start = paired(hold, windup, .66)
        return equipment_keys(t, ((0, start), (.045, windup), (HIT_TIME, contact),
                                  (.236, follow), (duration, hold)))
    if movement == "brace":
        return ((-.174, .012, .948), (-52, 0, 12))
    if movement == "charge":
        return ((-.242, .26, 1.16), (-8 if kind != "kiba" else -23, 7, 18))
    if movement == "ready" and kind == "teppo":
        return paired(hold, GUN_SHOTS[0][0], .76)
    if movement == "ready" and kind == "yumi":
        return ((.219, .475, 1.391), (-14, -22, -6))
    return hold


def equipment_keys(t, keys):
    for (start, a), (end, b) in zip(keys, keys[1:]):
        if t <= end:
            blend = envelope(t, ((start, 0), (end, 1)))
            return paired(a, b, blend)
    return keys[-1][1]


def reachable_grip(p, wrist, guide):
    # 两个肩关节的可达球相交处同时满足主手和副手的握点。
    centers = []
    for side in ("R", "L"):
        name = "shoulder." + side
        p.set(name)
        socket = p.transforms[name] @ Vector((0, p.rig.data.bones[name].length, 0))
        centers.append(Vector((socket.x, -socket.y, socket.z)))
    centers[1] -= guide
    limit = UPPER_ARM + LOWER_ARM - .014
    for _ in range(8):
        for center in centers:
            offset = wrist-center
            if offset.length > limit:
                wrist = center + offset.normalized()*limit
    return wrist


def wield(p, kind, movement, t, duration, shift, sway, fall):
    wrist, attitude = hold_at(kind, movement, t, duration)
    wrist = Vector(wrist) + shift
    attitude = Vector(attitude) + Vector((sway, 0, 0))
    if movement == "die":
        wrist = mix(wrist, (.09, .24, .16), fall)
        attitude = mix(attitude, (-1, -87 if kind == "yumi" else 1, 63), fall)
    angle = turn(*attitude)
    attack = movement in ATTACKS
    variant = ATTACKS.index(movement) if attack else 0
    if kind == "yumi":
        arm(p, "L", wrist, angle, (.9, -.40, -.50))
        p.set("bowstring")
        cord = p.anchor("bowstring")
        back = angle @ point((0, -.138, 0))
        center = cord + Vector((back.x, -back.y, back.z))
        reach = Vector((-.119, .291, 1.297)) + shift
        if attack:
            height, _, _, release, _ = BOW_SHOTS[variant]
            reach = Vector((-.112, .015, min(height, 1.52))) + shift
            reach.y -= release*envelope(t, ((0, 0), (.11, 0), (.195, 1), (.29, .77), (.63, 0)))
            reach = mix(reach, Vector((-.119, .291, 1.297))+shift,
                        envelope(t, ((0, 0), (.38, 0), (duration, 1))))
        elif movement == "ready":
            reach = Vector((-.080, .232, 1.386)) + shift
        if fall:
            reach = mix(reach, (-.20, .07, .13), fall)
        draw_hand = arm(p, "R", reach, turn(x=-6, f=7), (-.9, -.71, .18 if attack else -.50))
        if attack:
            draw = envelope(t, ((0, .76 if variant != 1 else .58), (.10, 1), (HIT_TIME, 0),
                                (.173, .063), (.216, 0), (.59, 0), (duration, .21)))
        else:
            draw = (.49 if movement == "ready" else .21)*(1-fall)
        p.set("bowstring", head=cord + (draw_hand-center)*draw)
        return

    distance = {"yari": .353, "samurai": -.235, "sohei": .328, "teppo": .363, "kiba": 0}[kind]
    guide_offset = Vector((0, distance, 0))
    rod_offset = Vector((.033, .735, -.027))
    handle_rod = 0
    if kind == "teppo" and attack:
        # 点火后竖枪。副手从托手位沿枪身上移，提起通条，再把它收回枪托旁。
        feed = envelope(t, ((0, 0), (.30, 0), (.45, 1), (.70, 1), (duration, 0)))
        insert = envelope(t, ((0, 0), (.45, 0), (.51, 1), (.60, .28), (.65, .85), (.72, 0)))
        handle_rod = envelope(t, ((0, 0), (.43, 0), (.47, 1), (.66, 1), (.72, 0)))
        guide_offset = mix(guide_offset, (.034-.036*insert, .735+.244*insert, -.027+.066*insert), feed)
    forward = angle @ point(guide_offset)
    offset = Vector((forward.x, -forward.y, forward.z))
    if kind != "kiba" and fall < .98:
        wrist = mix(reachable_grip(p, wrist, offset), wrist, fall)
    grip = arm(p, "R", wrist, angle, (-.88, -.47, -.54))
    guide = grip + offset
    if kind == "kiba":
        guide = Vector((.163+.020*math.sin(t*9), .288, 1.118)) + shift
    if movement == "die":
        guide = mix(guide, (.386, -.045, .166), fall)
    support = arm(p, "L", guide, angle if kind != "kiba" else turn(x=-8), (.87, -.39, -.61))
    if kind == "teppo":
        rod = angle @ point(rod_offset)
        stowed_rod = grip + Vector((rod.x, -rod.y, rod.z))
        p.set("bowstring", head=mix(stowed_rod, support, handle_rod), delta=angle)
    else:
        p.set("bowstring")


def rider_fall(p, t, held):
    """落马时骑马武者的两臂：刀握在伸过头顶的右手里，平躺在地上；左手落在胸前。"""
    reaching_arm(p, t, held["weapon.R"], turn(f=-90, z=-30))
    flung_arm(p, t, unhorse.FRONT)


def human_pose(rig, kind, movement, phase, duration):
    if kind == "kiba" and movement == "die":
        # 骑马武者阵亡是落马：从待命的坐姿开始，身子与两腿照 unhorse 摆。
        human_pose(rig, kind, "idle", 0, TIMING["idle"])
        unhorse.fall(rig, duration*phase, rider_fall, lift=.05, billow=12)
        return
    p = Pose(rig)
    p.set("root")
    mounted = kind == "kiba"
    t = duration*phase
    wave = math.tau*phase
    move = movement in ("walk", "run", "charge")
    fast = movement in ("run", "charge")
    attack = movement in ATTACKS
    fallback = movement == "die"
    fall = (envelope(t, ((0, 0), (.18, .04), (.48, .59), (.82, 1), (1.01, .965), (duration, 1)))
            if fallback else 0)
    bend_amount, roll, twist, lunge, crouch = 0, 0, 0, 0, 0
    strike = 0
    if attack:
        i = ATTACKS.index(movement)
        strike = envelope(t, ((0, .18), (.046, -.14), (HIT_TIME, 1), (.223, .93),
                              (.34, .38), (duration, 0)))
        if kind == "teppo":
            (bend_amount, roll, twist, lunge), crouch = GUN_SHOTS[i][1:]
            crouch *= envelope(t, ((0, .82), (.083, 1), (.29, 1), (.63, .77), (duration, 0)))
        elif kind == "yumi":
            bend_amount, roll, twist, lunge = (9, -3, -28, .043)
            crouch = BOW_SHOTS[i][-1] * envelope(t, ((0, .76), (.112, 1), (.30, .94), (duration, 0)))
        else:
            bend_amount, roll, twist, lunge = MELEE[kind][i][3]
            crouch = .025 + .038*strike
    elif movement in ("ready", "brace"):
        crouch = .036 if movement == "ready" else .096
    sway = (.014 if move else .009)*math.sin(wave)
    hips_forward = lunge*strike
    height = .916 - crouch + .006*math.sin(wave)
    steps = {}
    if mounted:
        height = HIP + (.017 if fast else .008)*math.cos(wave)
        hips_forward = .006*math.sin(wave)
    elif move:
        height = (.836 if fast else .888) + (.035 if fast else .018)*math.cos(2*wave-2.1)
        hips_forward = (.027 if fast else .009)*math.sin(2*wave)
        for side in SIDE:
            f, lift, pitch = ground_step(phase+(0 if side == "R" else .5),
                                          STRIDE["run" if fast else "walk"], .39 if fast else .61,
                                          .239 if fast else .105)
            steps[side] = f, lift, pitch
            reach = math.sqrt((THIGH+SHIN-.017)**2 - (f-hips_forward)**2)
            height = min(height, .108+lift+reach)
    if fallback:
        height -= .70*fall
        hips_forward -= .086*fall
    p.set("hips", head=(sway if mounted else sway+.032*strike+.32*fall, hips_forward, height),
          delta=turn(x=(9 if fast else 0)+bend_amount*.25*strike-17*fall,
                     f=2*math.sin(wave)+roll*.3*strike+73*fall,
                     z=-6*math.sin(wave) if move else twist*.2*strike+44*fall))
    p.set("spine", local=turn(x=bend_amount*.45*strike + (6 if fast else 1) + 12*fall,
                             z=5*math.sin(wave) if move else twist*.27*strike))
    bow_twist = 0
    if kind == "yumi":
        bow_twist = -19 - 18*strike
    p.set("chest", local=turn(x=(bend_amount*.34)*strike-2.4*math.sin(wave)+7*fall,
                             f=roll*.74*strike, z=twist*.59*strike+bow_twist-12*fall))
    p.set("neck", local=turn(x=3*math.sin(wave)-bend_amount*.3*strike+10*fall,
                            z=-twist*.31*strike-bow_twist*.65))
    p.set("head", local=turn(f=-1.2*math.sin(wave)+5*fall, z=-twist*.20*strike))
    p.set("mantle", local=turn(x=(11 if fast else 2)+3.5*math.sin(wave-.68)-6*strike,
                              f=2*math.sin(wave-.6)+5*fall, z=-4*strike+2.4*math.sin(wave-1.0)))
    shift = Vector((sway+.035*strike, hips_forward*.59, height-HIP+.011*math.sin(wave-.6)))
    # 远程瞄准由持械点定高，蹲姿只取骨盆下移，余量由肩肘吸收。
    if attack and kind in ("teppo", "yumi"):
        shift.z += .028
    wield(p, kind, movement, t, duration, shift, (6 if fast else 3)*math.sin(wave) if move else 0, fall)
    for side, s in SIDE.items():
        if mounted:
            ankle = (s*.255, -.085+.015*math.sin(wave), .418+height-HIP)
            leg(p, side, ankle, 9+4*math.sin(wave), True)
        elif fallback:
            thigh = "thigh."+side
            p.set(thigh, local=turn(x=-8-(13+6*s)*fall, f=s*11*fall))
            p.set("shin."+side, local=turn(x=9+(28-8*s)*fall))
            p.set("foot."+side)
            p.set("toe."+side)
        elif move:
            f, lift, pitch = steps[side]
            leg(p, side, (s*.104, f, .108+lift), pitch, False)
        else:
            spread = .214 if attack or movement in ("ready", "brace") else .074
            lead = -1 if kind in ("yumi", "teppo") or (attack and twist < 0) else 1
            leg(p, side, (s*(.120 if spread > .1 else .103), s*spread*lead, .108), 0, False)
    if mounted:
        seat_origin(p)


def cannon_dimensions(elite):
    return (.55, .39, 1.015, .168) if elite else (.48, .34, .886, .132)


def cannon_rig(elite):
    half, radius, height, _ = cannon_dimensions(elite)
    bones = [
        ("root", None, (0, 0, 0), (0, 0, .20)),
        ("chassis", "root", (0, 0, .43), (0, 0, .78)),
        ("barrel", "chassis", (0, -.20, height), (0, .55, height)),
        ("runout", "chassis", (0, -1.08, .30), (0, -.71, .38)),
        ("mantle", "chassis", (.29, -.55, .58), (.29, -.55, .88)),
    ]
    for side, s in SIDE.items():
        bones.append((f"wheel.{side}.0", "chassis", (s*half, .055, radius), (s*(half+.16), .055, radius)))
    return armature("Ozutsu rig", bones)


def cannon_mesh(rig, elite):
    mesh = Mesh()
    half, radius, height, bore = cannon_dimensions(elite)
    oak = "Oak end" if elite else "Oak"
    end = 1.05 if elite else .91
    for side, s in SIDE.items():
        x = s*(half-.092)
        wheel(mesh, s*half, .055, radius, side, 0)
        mesh.loft([
            ([(x+u, f, h+z) for u, z in ((-.062, -.085), (.062, -.085), (.062, .085), (-.062, .085))], bone)
            for f, h, bone in ((-1.27, .216, "runout"), (-.69, .365, "chassis"), (.45, .502, "chassis"),
                               (.70, .530, "chassis"))
        ], lambda row, n: oak if n != 0 else "Oak", smooth=False)
        mesh.loft([
            ([(x+u, f, z) for u, f in ((-.071, -.48), (.071, -.48), (.071, .39), (-.071, .39))],
             "chassis")
            for z in (.465, .58)
        ], oak, smooth=False)
        mesh.loft([
            ([(u, f, z) for u, f in ((x-.07, -.24), (x+.07, -.24), (x+.07, .26), (x-.07, .26))],
             "chassis")
            for z in (.555, height-.092)
        ], oak, smooth=False)
        for f in (-.451, .350):
            mesh.box((x, f, .545), (.151, .083, .238), IRON, "chassis")
            mesh.tube((x+s*.071, f, .583), (x+s*.087, f, .583), .035, .025, 6,
                      "Brass" if elite else IRON, "chassis")
        mesh.tube((0, -.20, height), (x+s*.084, -.20, height), bore*.48, bore*.43, 10,
                  IRON, "barrel")
        mesh.box((x, -.18, height-.127), (.148, .222, .103), IRON, "chassis")
        for f in (-.85, .052, .46):
            mesh.box((x-s*.09, f, .413 if f < 0 else .49), (.235, .11, .117), oak,
                     "runout" if f < 0 else "chassis")
    mesh.box((0, .055, radius), (half*2, .127, .132), "Oak", "chassis")
    mesh.box((0, -.34, .502), (half*1.78, .38, .075), oak, "chassis")
    mesh.box((0, -.95, .330), (.39, .284, .077), oak, "runout")
    mesh.tube((0, -.80, height-.016), (0, end-.054, height), bore*1.20, bore*.87, 12, IRON, "barrel")
    muzzle(mesh, 0, end, height, bore, "barrel", "Bronze" if elite else IRON)
    for f, r in ((-.78, 1.23), (-.59, 1.18), (-.18, 1.09), (.35, .982), (end-.155, .93)):
        mesh.tube((0, f-.035, height), (0, f+.023, height), bore*r, bore*r, 12,
                  "Bronze" if elite else "Japanese lacquer bevel", "barrel")
    mesh.oval((0, -.828, height-.016), (.101, .093, .097), 9, IRON, "barrel", cuts=3)
    mesh.box((0, -.581, height+bore*1.14), (.100, .109, .028), "Bronze", "barrel")
    mesh.tube((0, -.581, height+bore*1.18), (0, -.581, height+bore*1.19),
              .024, .022, 7, DARK, "barrel")
    for x in (-.178, .178):
        mesh.tube((x, -.93, .407), (x, -.93, .628), .065, .067, 8, "Leather", "runout")
        mesh.tube((x, -.93, .619), (x, -.93, .658), .069, .066, 8, BEVEL, "runout")
    flag(mesh, half-.21, -.58, 1.422 if elite else 1.224, .246 if elite else .179,
         .343 if elite else .262, elite)
    mesh.build("ozutsu_e" if elite else "ozutsu", rig)


def cannon_pose(rig, movement, phase, duration):
    t = phase*duration
    wave = phase*math.tau
    fall = 0
    recoil = 0
    elevation = 0
    yaw = 0
    moving = movement in ("walk", "run")
    if movement in ATTACKS:
        variant = ATTACKS.index(movement)
        recoil = envelope(t, ((0, 0), (.102, 0), (.167, 1), (.244, .68), (.389, .20), (duration, 0)))
        pitch, traverse, kick = ((0, 0, 1.0), (-15, -2.5, 1.22), (5, 12.5, .71))[variant]
        recoil *= kick
        aim = envelope(t, ((0, .60), (.103, 1), (.24, 1), (duration, 0)))
        elevation, yaw = pitch*aim-6*recoil, traverse*aim
    if movement == "die":
        fall = envelope(t, ((0, 0), (.18, .09), (.67, 1), (.91, .96), (duration, 1)))
    p = Pose(rig)
    p.set("root")
    p.set("chassis", head=(.06*fall, -.101*recoil, .43-.12*fall),
          delta=turn(x=4*recoil, f=(.92*math.sin(wave) if moving else .32*math.sin(wave))+16*fall,
                     z=10*fall))
    p.set("barrel", local=turn(x=elevation-13*fall, f=24*fall, z=yaw+15*fall))
    p.set("runout", local=turn(x=9*recoil+7*fall, f=-40*fall))
    p.set("mantle", local=turn(x=12*fall+3.7*math.sin(wave-.5)+15*recoil, z=4*math.sin(wave-.82)))
    for side, s in SIDE.items():
        p.set(f"wheel.{side}.0", local=turn(x=360*phase if moving else -14*recoil+s*32*fall,
                                         z=s*27*fall))


def animate_library(rig):
    for kind, stance in SETS.items():
        for movement in COMMON + EXTRA.get(kind, ()):
            duration = TIMING[movement]
            clip(rig, f"{stance}.{movement}", duration,
                 lambda phase: human_pose(rig, kind, movement, phase, duration), movement not in (*ATTACKS, "die"))


CANNON_TIMING = {"idle": 3.2, "walk": 1.36, "run": 1.05, "attack": .84,
                 "attack2": .90, "attack3": .80, "die": 1.32}


def generate(output):
    manifest = read_manifest(output)
    PALETTE.update(PALETTE_JAPAN)
    reset()
    rig = armature("Human", human_skeleton())
    reference = Mesh()
    reference.box((0, 0, .028), (.04, .04, .05), "Stone", "root")
    reference.build("Reference", rig)
    animate_library(rig)
    export(output / "anims/japan.glb")
    manifest["libraries"]["japan"] = "units/anims/japan.glb"
    for kind in (*SETS, "ozutsu"):
        for elite in (False, True):
            model_id = kind + ("_e" if elite else "")
            asset = {"src": f"units/japan/{model_id}.glb"}
            reset()
            if kind == "ozutsu":
                rig = cannon_rig(elite)
                cannon_mesh(rig, elite)
                for movement, duration in CANNON_TIMING.items():
                    clip(rig, movement, duration, lambda phase: cannon_pose(rig, movement, phase, duration),
                         movement in ("idle", "walk", "run"))
                stride = round(math.tau*cannon_dimensions(elite)[1], 3)
                spec = {"kind": "rig", **asset, "stride": {"walk": stride, "run": stride}}
            else:
                rig = armature("Human", human_skeleton())
                infantry(kind, elite, rig)
                asset.update(anims="japan", set=SETS[kind])
                if kind == "kiba":
                    spec = cavalry_spec(asset, "japan", elite)
                else:
                    spec = {"kind": "rig", **asset, "stride": STRIDE}
            export(output / f"japan/{model_id}.glb")
            manifest["models"][model_id] = spec
    write_manifest(output, manifest)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[2] / "public/assets/units")
    generate(parser.parse_args(sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else []).output)
