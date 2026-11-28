"""生成波斯兵种与阵营动作库。

blender -b --factory-startup --python-exit-code 1 -P tools/art/persia.py
"""

import argparse
import math
from pathlib import Path
import sys

from mathutils import Vector

if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    sys.dont_write_bytecode = True

import human_motion as motion
import unhorse
from horse import GroundSurface
from mesh import PALETTE, Mesh, Pose, angles, armature, bend, clip, export, mix, point, reset, turn
from registry import cavalry_spec, read_manifest, write_manifest
from rome import LOWER_ARM, SIDE, UPPER_ARM, human_skeleton
from siege import beam, wheel

SETS = {
    "spara": "spara",
    "immortal": "spear",
    "kamandar": "bow",
    "asvaran": "ride_bow",
    "cataphract": "ride_kontos",
}
COMMON = ("idle", "ready", "walk", "run", "attack", "attack2", "attack3", "die")
EXTRAS = {
    "spara": ("brace", "charge"),
    "spear": ("brace",),
    "bow": (),
    "ride_bow": ("attackMove", *motion.DIRECTIONS),
    "ride_kontos": ("charge",),
}

MATERIALS = {
    "Persian wool": ((0.36, 0.258, 0.143), 0, 0.88),
    "Dyed linen": ((0.42, 0.275, 0.216), 0, 0.86),
    "Flax shadow": ((0.52, 0.43, 0.30), 0, 0.90),
    "Olive wool": ((0.26, 0.26, 0.17), 0, 0.90),
    "Brocade": ((0.64, 0.47, 0.25), 0, 0.82),
    "Reed": ((0.57, 0.393, 0.204), 0, 0.89),
    "Reed bright": ((0.72, 0.525, 0.296), 0, 0.83),
    "Reed shade": ((0.41, 0.254, 0.127), 0, 0.90),
    "Elephant hide": ((0.33, 0.30, 0.282), 0, 0.90),
    "Elephant shade": ((0.242, 0.217, 0.206), 0, 0.92),
    "Ear interior": ((0.376, 0.286, 0.268), 0, 0.91),
    "Ivory": ((0.79, 0.73, 0.59), 0, 0.69),
    "Walnut": ((0.208, 0.112, 0.064), 0, 0.78),
}


def section(mesh, profile, sides, surface, caps=False):
    mesh.rings(profile, sides, surface, caps=caps)


def band(mesh, x, f, z, w, d, height, bone, surface, sides=8):
    section(mesh, [(x, f, z, w, d, bone), (x, f, z + height, w, d, bone)], sides, surface)


def cape(mesh, mounted, cloth=("team cloth", "team cloth shadow")):
    rings = []
    for row, (z, width, f, weight) in enumerate(
        (
            (0.81 if mounted else 0.56, 0.218, -0.31 if mounted else -0.185, "mantle"),
            (1.02, 0.220, -0.205, "mantle"),
            (1.22, 0.208, -0.154, {"chest": 0.4, "mantle": 0.6}),
            (1.445, 0.151, -0.060, "chest"),
        )
    ):
        points = [
            (width * u, f + 0.061 * u * u + 0.017 * (i % 2), z + 0.014 * (1 - u * u))
            for i, u in enumerate((-1, -0.68, -0.33, 0, 0.33, 0.68, 1))
        ]
        rings.append((points, weight))
    indices = [[mesh.vertex(p, weight) for p in points] for points, weight in rings]
    inner = [[mesh.vertex((x, f + 0.002, z), weight) for x, f, z in points] for points, weight in rings]
    for rows, shaded in ((indices, False), (inner, True)):
        for low, high in zip(rows, rows[1:]):
            for i in range(len(low) - 1):
                face = (low[i], low[i + 1], high[i + 1], high[i])
                edge = i in (0, len(low) - 2)
                mesh.face(
                    face[::-1] if shaded else face,
                    "Brocade" if edge else cloth[shaded],
                    True,
                )
    mesh.oval((0.132, 0.096, 1.412), (0.034, 0.014, 0.033), 6, "Brass", "chest", cuts=2)


def scales(mesh, radius, depth, bottom, top, rows, columns, dark, bright, weight):
    for row in range(rows):
        z = bottom + (top - bottom) * row / rows
        height = (top - bottom) / rows
        for col in range(columns):
            theta = math.tau * (col + 0.5 * (row % 2)) / columns
            nodes = []
            for da, dz, offset in (
                (-0.47, 0.86, 0),
                (0.47, 0.86, 0),
                (0.46, 0.13, 0.006),
                (0, -0.16, 0.014),
                (-0.46, 0.13, 0.006),
            ):
                a = theta + math.tau * da / columns
                nodes.append(
                    mesh.vertex(
                        (
                            (radius(z) + offset) * math.cos(a),
                            (depth(z) + offset) * math.sin(a),
                            z + height * dz,
                        ),
                        weight(z),
                    )
                )
            mesh.face(tuple(nodes), bright if (col * 5 + row * 3) % 7 < 2 else dark)


def robe(mesh, mounted, cloth=("team cloth", "team cloth shadow")):
    skirt = []
    stations = (
        ((0.921, 0.168, 0.119, 0.18), (0.980, 0.162, 0.111, 0.12), (1.044, 0.149, 0.104, 0))
        if mounted
        else (
            (0.665, 0.237, 0.158, 0.74),
            (0.790, 0.204, 0.143, 0.59),
            (0.954, 0.169, 0.115, 0.24),
            (1.044, 0.149, 0.104, 0),
        )
    )
    for z, w, d, leg_weight in stations:
        ring, weights = [], []
        for i, a in enumerate(angles(12, math.pi / 12)):
            fold = 0.96 if i % 2 else 1.02
            x = w * math.cos(a) * fold
            ring.append((x, d * math.sin(a) * fold, z + 0.010 * (i % 2)))
            leg = "thigh.L" if x > 0 else "thigh.R"
            weights.append({"hips": 1 - leg_weight, leg: leg_weight} if leg_weight else "hips")
        skirt.append((ring, weights.__getitem__))
    mesh.loft(
        skirt,
        lambda row, n: "Brocade" if row == 0 and n % 3 == 0 else cloth[n % 2],
        caps=False,
    )
    if mounted:
        for side, s in SIDE.items():
            thigh = f"thigh.{side}"
            stations = ((0.965, 0.101, 0.185, 0.20), (0.861, 0.085, 0.195, 0.72), (0.777, 0.037, 0.187, 1))
            rows = [
                [
                    mesh.vertex(
                        (s * (x + 0.016 * (1 - u * u)), f * u, z - 0.022 * u * u),
                        {"hips": 1 - w, thigh: w} if w < 1 else thigh,
                    )
                    for u in (-1, -0.5, 0, 0.5, 1)
                ]
                for z, f, x, w in stations
            ]
            for row, (a, b) in enumerate(zip(rows, rows[1:])):
                for i in range(4):
                    face = (a[i], a[i + 1], b[i + 1], b[i])
                    mesh.face(face[::s], "Brocade" if row and i in (0, 3) else "team cloth", True)


def torso(mesh, kind, elite):
    mounted = kind in ("asvaran", "cataphract")
    cat = kind == "cataphract"
    armored = cat or kind == "immortal" or elite
    # 领口缩进，胸与腰由两根骨骼过渡，便于骑射扭腰。
    shirt = [
        (0, 0, 0.94, 0.151, 0.098, "hips"),
        (0, 0, 1.051, 0.143, 0.101, "hips"),
        (0, 0.002, 1.224, 0.164, 0.112, {"spine": 0.74, "chest": 0.26}),
        (0, -0.005, 1.372, 0.195, 0.111, "chest"),
        (0, -0.004, 1.465, 0.066, 0.065, "chest"),
    ]
    shirt_color = "Mail" if cat else "Persian wool" if armored else "team cloth"
    if kind == "spara":
        section(mesh, shirt, 12, "Linen")
        robe(mesh, mounted, ("Linen", "Flax shadow"))
    else:
        section(mesh, shirt, 12, shirt_color)
        robe(mesh, mounted)
    if armored:
        bottom = 1.065
        top = 1.376 - (0.06 if kind in ("kamandar", "asvaran") else 0)
        shell = "Steel shadow" if cat else "Bronze"
        accent = "Steel" if cat else "Brass"

        def width(z):
            return 0.170 + 0.12 * (z - bottom)

        def depth(z):
            return 0.123 + 0.039 * (z - bottom)

        def weight(z):
            return "chest" if z > 1.272 else {"spine": 0.74, "chest": 0.26} if z > 1.16 else "spine"

        rows, columns = (3, 8) if kind == "asvaran" else (4 if elite else 3, 12 if cat else 14)
        scales(mesh, width, depth, bottom, top, rows, columns, shell, accent, weight)
        for s in SIDE.values():
            mesh.tube(
                (s * 0.091, 0.115, top - 0.029),
                (s * 0.135, 0.055, 1.432),
                0.018 if not elite else 0.025,
                0.015,
                4,
                shell,
                "chest",
            )
    band(mesh, 0, 0, 1.013, 0.155, 0.109, 0.040, "hips", "Leather")
    mesh.oval(
        (0, 0.113, 1.035),
        (0.042, 0.016, 0.028),
        6,
        "Brass" if elite or armored else "Leather edge",
        "hips",
        cuts=2,
    )
    if elite:
        if kind == "spara":
            cape(mesh, mounted, ("Olive wool", "Olive wool"))
        else:
            cape(mesh, mounted)


def limbs(mesh, kind, elite):
    cat = kind == "cataphract"
    upper_mat = "Mail" if cat else "Brocade" if elite else "Persian wool"
    pants = "Mail" if cat else "Dyed linen" if kind in ("immortal", "asvaran") else "Persian wool"
    for side, s in SIDE.items():
        upper, fore, hand, thigh, shin, foot, toe = (
            f"{bone}.{side}" for bone in ("upper_arm", "forearm", "hand", "thigh", "shin", "foot", "toe")
        )
        x = s * 0.192
        elbow = {upper: 0.46, fore: 0.54}
        wrist = {fore: 0.65, hand: 0.35}
        section(
            mesh,
            [
                (x, 0, 0.865, 0.033, 0.034, wrist),
                (x, 0.007, 1.008, 0.045, 0.044, fore),
                (x, 0, 1.114, 0.050, 0.048, elbow),
                (x, 0.003, 1.290, 0.066, 0.064, upper),
                (x, -0.004, 1.413, 0.075, 0.072, upper),
                (x * 0.83, 0, 1.455, 0.051, 0.054, {"chest": 0.47, upper: 0.53}),
            ],
            7,
            lambda row, n: (
                ("Mail highlight" if n % 3 == 1 else "Mail")
                if cat
                else ("Skin" if row == 0 else upper_mat if n % 4 else "Brocade")
            ),
        )
        band(mesh, x, 0, 0.883, 0.036, 0.037, 0.037, fore, "Steel" if cat else "Leather edge", 6)
        section(
            mesh,
            [
                (x, 0.012, 0.777, 0.029, 0.027, hand),
                (x, 0.007, 0.805, 0.040, 0.035, hand),
                (x, 0, 0.859, 0.034, 0.033, wrist),
            ],
            6,
            "Leather" if cat else "Skin",
            True,
        )
        if cat or elite:
            for z in (1.338, 1.383):
                band(
                    mesh,
                    x,
                    -0.004,
                    z,
                    0.078,
                    0.074,
                    0.032,
                    upper,
                    "Steel edge" if cat and elite else "Bronze",
                    6,
                )
        x = s * 0.092
        knee = {thigh: 0.48, shin: 0.52}
        section(
            mesh,
            [
                (x, -0.006, 0.104, 0.045, 0.046, {foot: 0.28, shin: 0.72}),
                (x, -0.018, 0.235, 0.051, 0.057, shin),
                (x, -0.012, 0.367, 0.062, 0.066, shin),
                (x, 0.02, 0.510, 0.065, 0.067, knee),
                (x, 0.014, 0.678, 0.078, 0.078, thigh),
                (x, 0, 0.854, 0.083, 0.084, {thigh: 0.78, "hips": 0.22}),
            ],
            8,
            lambda row, n: (
                ("Mail highlight" if (row + n) % 3 == 0 else pants)
                if cat
                else ("Leather edge" if row == 0 else "Leather" if row == 1 else pants)
            ),
        )
        if cat or elite:
            band(mesh, x, -0.012, 0.292, 0.063, 0.069, 0.048, shin, "Steel" if cat else "Bronze", 7)
        outline = [
            (-0.047, -0.045),
            (0.047, -0.045),
            (0.051, 0.115),
            (0.030, 0.171),
            (-0.033, 0.167),
            (-0.052, 0.112),
        ]
        mesh.loft(
            [
                (
                    [(x + dx * r, f, z + (0.061 if row == 2 and f < 0.03 else 0)) for dx, f in outline],
                    lambda n: toe if outline[n][1] > 0.13 else foot,
                )
                for row, (r, z) in enumerate(((0.96, 0), (1, 0.018), (0.95, 0.047)))
            ],
            lambda row, n: "Leather" if row else "Walnut",
            smooth=False,
        )


def head(mesh, kind, elite):
    cat = kind == "cataphract"
    section(
        mesh,
        [
            (0, 0, 1.443, 0.061, 0.058, "chest"),
            (0, 0, 1.527, 0.051, 0.050, "neck"),
            (0, 0.007, 1.580, 0.053, 0.048, "head"),
        ],
        8,
        "Mail" if cat else "Skin",
    )
    profile = [
        (0, 0.026, 1.538, 0.041, 0.045, "head"),
        (0, 0.015, 1.584, 0.070, 0.066, "head"),
        (0, 0.005, 1.638, 0.078, 0.079, "head"),
        (0, 0, 1.689, 0.079, 0.078, "head"),
        (0, -0.005, 1.745, 0.052, 0.050, "head"),
    ]
    section(mesh, profile, 10, lambda row, n: "Skin shade" if row == 0 else "Skin", True)
    if cat:
        # 面甲分成鼻脊、两颊和护喉。眼缝露出衬底。
        for s in SIDE.values():
            outline = [
                (0, 0.116, 1.65),
                (s * 0.064, 0.071, 1.656),
                (s * 0.086, 0.028, 1.606),
                (s * 0.049, 0.064, 1.548),
                (0, 0.089, 1.530),
            ]
            mesh.face(
                tuple(mesh.vertex(p, "head") for p in outline[::s]), "Steel" if s == 1 else "Steel shadow"
            )
            mesh.box((s * 0.039, 0.081, 1.667), (0.049, 0.013, 0.013), "Iron", "head")
            mesh.tube(
                (s * 0.087, -0.013, 1.673), (s * 0.074, 0.011, 1.510), 0.033, 0.029, 6, "Mail", "head"
            )
    else:
        mesh.oval((0, 0.074, 1.626), (0.018, 0.031, 0.032), 6, "Skin light", "head", cuts=2)
        beard = [
            (0, 0.070, 1.533, 0.037, 0.024, "head"),
            (0, 0.068, 1.564, 0.068, 0.036, "head"),
            (0, 0.052, 1.597, 0.069, 0.029, "head"),
        ]
        section(mesh, beard, 10, lambda row, n: "Leather" if n in (1, 4) else "Hair", True)
        mesh.box((0, 0.093, 1.583), (0.046, 0.013, 0.010), "Skin shade", "head")
        for s in SIDE.values():
            mesh.box((s * 0.037, 0.076, 1.649), (0.032, 0.012, 0.009), "Hair", "head")
            mesh.oval((s * 0.078, -0.005, 1.621), (0.014, 0.020, 0.030), 5, "Skin shade", "head", cuts=2)

    if cat:
        cap = [
            (0, -0.009, z, w, d, "head")
            for z, w, d in (
                (1.666, 0.107, 0.108),
                (1.732, 0.102, 0.098),
                (1.795, 0.073, 0.071),
                (1.858, 0.033, 0.035),
                (1.894 if elite else 1.874, 0.016, 0.018),
            )
        ]
        section(mesh, cap, 12, lambda _r, n: "Steel edge" if n % 3 == 2 else "Steel", True)
        band(mesh, 0, -0.009, 1.674, 0.109, 0.113, 0.025, "head", "Brass" if elite else "Bronze", 12)
    else:
        crown = {
            "spara": (-0.059, 1.828, 0.027, 0.042),
            "immortal": (-0.039, 1.856, 0.042, 0.053),
            "kamandar": (-0.044, 1.792, 0.031, 0.047),
            "asvaran": (-0.083, 1.866, 0.024, 0.027),
        }[kind]
        if elite:
            f, z, w, d = crown
            crown = (f * 0.85, z + 0.022, w * 0.94, d)
        cap = [
            (0, f, z, w, d, "head")
            for f, z, w, d in (
                (-0.004, 1.671, 0.091, 0.090),
                (-0.014, 1.711, 0.100, 0.103),
                (-0.032, 1.762, 0.088, 0.092),
                crown,
            )
        ]
        outer, folds = (
            ("Dyed linen", "Persian wool") if kind == "spara" else ("team cloth", "team cloth shadow")
        )
        section(mesh, cap, 10, lambda row, n: folds if (n + row) % 3 == 1 else outer, True)
        band(
            mesh,
            0,
            -0.010,
            1.687,
            0.103,
            0.103,
            0.023,
            "head",
            "Brass" if elite or kind == "immortal" else "Brocade" if kind == "spara" else "team trim",
            10,
        )
        for s in SIDE.values():
            mesh.loft(
                [
                    ([(s * x, f, z) for x, f in row[::s]], "head")
                    for z, row in (
                        (1.522, ((0.059, -0.063), (0.073, -0.063), (0.073, -0.012), (0.056, -0.013))),
                        (1.635, ((0.078, -0.070), (0.101, -0.069), (0.096, 0.023), (0.078, 0.023))),
                        (1.702, ((0.080, -0.076), (0.102, -0.076), (0.104, 0.027), (0.082, 0.027))),
                    )
                ],
                folds,
                smooth=False,
            )
    if elite:
        mesh.oval((0, 0.097, 1.723), (0.026, 0.012, 0.031), 6, "Brass", "head", cuts=2)
        if cat or kind == "immortal":
            mesh.tube((0, -0.041, 1.815), (0, -0.093, 1.963), 0.029, 0.009, 6, "team plume", "head")


def wicker(mesh, elite):
    x, f, z = 0.192, 0.135, 0.712
    half_w, half_h = 0.287, 0.573
    bone = "weapon.L"
    # 门形立盾随横向弯曲，竖篾隔行换色，细横条跨过接缝。
    rows = []
    for r in range(9):
        v = r / 4 - 1
        row = []
        for c in range(13):
            u = c / 6 - 1
            rounded = 1 - 0.065 * abs(v) ** 6
            row.append(
                (
                    x + u * half_w * rounded,
                    f - 0.067 * u * u + 0.003 * ((r + c) % 2),
                    z + half_h * v - 0.031 * u * u * max(0, v),
                )
            )
        rows.append(row)
    face = [[mesh.vertex(p, bone) for p in row] for row in rows]
    for r, (low, high) in enumerate(zip(face, face[1:])):
        for c in range(12):
            surface = (
                "team shield"
                if r == 7
                else ("Reed", "Reed bright", "Reed shade", "Reed bright")[(c + r % 2) % 4]
            )
            mesh.face((low[c], low[c + 1], high[c + 1], high[c]), surface)
    contour = rows[0] + [row[-1] for row in rows[1:-1]] + rows[-1][::-1] + [row[0] for row in rows[-2:0:-1]]
    edge = [mesh.vertex((a, b - 0.019, h), bone) for a, b, h in contour]
    mesh.face(tuple(reversed(edge)), "Reed shade")
    for s in (-1, 1):
        for v in (-1, 0):
            a = (x + s * 0.269, f - 0.061, z + v * 0.565)
            b = (x + s * 0.269, f - 0.061, z + (v + 1) * 0.554)
            mesh.tube(a, b, 0.018, 0.017, 5, "Brass" if elite else "Leather edge", bone)
    for h in (-0.555, -0.391, -0.233, -0.065, 0.101, 0.257, 0.405, 0.536):
        tape = [
            [
                mesh.vertex((x + a, f + 0.009 - 0.067 * (a / half_w) ** 2, z + h + dz), bone)
                for a in (-0.268, -0.141, 0, 0.141, 0.268)
            ]
            for dz in (-0.008, 0.008)
        ]
        for j in range(4):
            mesh.face(
                (tape[0][j], tape[0][j + 1], tape[1][j + 1], tape[1][j]),
                "Leather edge" if h < 0.5 else "Brocade",
            )


def spear(mesh, kind, elite):
    x, z, bone = -0.192, 0.835, "weapon.R"
    butt, tip = {"spara": (-0.63, 0.83), "immortal": (-0.70, 1.30), "cataphract": (-0.72, 2.20)}[kind]
    mesh.tube((x, butt, z), (x, tip, z), 0.017, 0.011, 7, "Ash", bone)
    mesh.tube((x, tip - 0.081, z), (x, tip + 0.029, z), 0.019, 0.016, 6, "Iron", bone)
    profile = [
        (tip - 0.023, 0.017, 0.012),
        (tip + 0.031, 0.031, 0.010),
        (tip + 0.112, 0.021, 0.008),
        (tip + 0.192, 0.001, 0.001),
    ]
    rings = [([(x - w, f, z), (x, f, z - h), (x + w, f, z), (x, f, z + h)], bone) for f, w, h in profile]
    mesh.loft(rings, lambda _r, n: "Steel edge" if n in (0, 2) else "Steel")
    mesh.tube((x, -0.113, z), (x, 0.070, z), 0.019, 0.019, 6, "Leather", bone)
    if kind == "immortal":
        mesh.oval(
            (x, butt - 0.019, z), (0.045, 0.048, 0.045), 8, "Brass" if elite else "Steel edge", bone, cuts=3
        )
    else:
        mesh.tube((x, butt - 0.049, z), (x, butt + 0.025, z), 0.009, 0.019, 6, "Iron", bone)


def bow(mesh, mounted, elite):
    x, z, bone = 0.192, 0.835, "weapon.L"
    scale = 0.91 if mounted else 1
    profile = [
        (f * scale, z + h * scale, w)
        for f, h, w in (
            (0.005, -0.501, 0.009),
            (-0.057, -0.463, 0.011),
            (-0.083, -0.412, 0.013),
            (-0.055, -0.349, 0.015),
            (0.017, -0.299, 0.017),
            (0.076, -0.219, 0.018),
            (0.089, -0.132, 0.019),
            (0.058, -0.064, 0.020),
            (0.033, 0, 0.022),
            (0.059, 0.068, 0.020),
            (0.091, 0.132, 0.019),
            (0.076, 0.216, 0.017),
            (0.014, 0.295, 0.016),
            (-0.054, 0.354, 0.014),
            (-0.083, 0.413, 0.013),
            (-0.057, 0.468, 0.011),
            (0.005, 0.505, 0.009),
        )
    ]

    def bend_weight(height):
        flex = 0.125 * max(0, (abs(height - z) / (0.505 * scale) - 0.35) / 0.65)
        return {bone: 1 - flex, "bowstring": flex} if flex else bone

    rings = [
        ([(x + w * math.cos(a), f + 0.68 * w * math.sin(a), h) for a in angles(6)], bend_weight(h))
        for f, h, w in profile
    ]
    mesh.loft(
        rings,
        lambda row, n: (
            "Ivory"
            if row < 3 or row > 12
            else "Leather"
            if row in (7, 8)
            else "Brass"
            if elite and n in (1, 4)
            else "Ash"
        ),
    )
    center = (x, 0.005, z)
    mesh.tube((x, *profile[0][:2]), center, 0.0031, 0.0031, 4, "Linen", rings[0][1], end_weight="bowstring")
    mesh.tube(
        center, (x, *profile[-1][:2]), 0.0031, 0.0031, 4, "Linen", "bowstring", end_weight=rings[-1][1]
    )


def quiver(mesh, mounted, elite):
    # 骑射手的箭囊整根跟着胸转，回身射时下端从鞍的上方扫过去：下端收在胯以上，才不扫进鞍与马背。
    a, b = (
        ((0.205, -0.122, 0.975), (0.257, -0.137, 1.395))
        if mounted
        else ((-0.132, -0.146, 0.963), (0.157, -0.171, 1.471))
    )
    d = Vector(b) - Vector(a)
    collar = Vector(b) - d * 0.13
    mesh.tube(a, b, 0.048, 0.065, 8, "Leather", "chest")
    mesh.tube(collar, b, 0.068, 0.069, 8, "Brass" if elite else "Leather edge", "chest")
    body = Vector(a) + d * 0.20
    mesh.tube(body, body + d * 0.038, 0.055, 0.055, 8, "Brocade", "chest")
    for i in range(4):
        start = Vector(b) + Vector((0.020 * (i - 1.5), -0.016 * (i % 2), -0.022))
        end = start + d.normalized() * (0.17 + 0.019 * i)
        mesh.tube(start, end, 0.0045, 0.004, 4, "Ash", "chest")
        edge = end - d.normalized() * 0.045
        vane = (edge, edge + Vector((0.016, 0, -0.006)), end)
        for points in (vane, reversed(vane)):
            mesh.face(tuple(mesh.vertex(p, "chest") for p in points), "Linen")
    strap = [
        ([(-0.137, 0.077, 1.054), (-0.102, 0.087, 1.054)], "spine"),
        ([(0.005, 0.124, 1.271), (0.047, 0.126, 1.271)], "chest"),
        ([(0.104, 0.069, 1.428), (0.145, 0.060, 1.426)], "chest"),
        ([(0.11, -0.100, 1.422), (0.153, -0.132, 1.419)], "chest"),
    ]
    rows = [[mesh.vertex(p, weight) for p in points] for points, weight in strap]
    for low, high in zip(rows, rows[1:]):
        mesh.face((low[0], low[1], high[1], high[0]), "Leather edge", True)


def person(kind, elite, rig):
    mesh = Mesh()
    torso(mesh, kind, elite)
    limbs(mesh, kind, elite)
    head(mesh, kind, elite)
    if kind in ("kamandar", "asvaran"):
        bow(mesh, kind == "asvaran", elite)
    else:
        spear(mesh, kind, elite)
    if kind == "spara":
        wicker(mesh, elite)
    elif kind != "cataphract":
        quiver(mesh, kind == "asvaran", elite)
    return mesh.build(kind, rig)


def inherited_pose(rig):
    pose = Pose(rig)
    for bone in rig.pose.bones:
        rest = pose.rest[bone.name]
        parent = bone.parent
        base = pose.transforms[parent.name] @ pose.rest[parent.name].inverted() @ rest if parent else rest
        pose.transforms[bone.name] = base @ bone.matrix_basis
    return pose


def local_offset(v, rotation):
    offset = rotation @ point(v)
    return Vector((offset.x, -offset.y, offset.z))


# 平射、越过前排的仰射、倾弓近射。各自有不同的拉弦停顿及放箭后的持弓方向。
SHOTS = {
    "attack": (0, -4, 0.56, 0.045, 0.102),
    "attack2": (19, 8, 0.50, 0.117, 0.087),
    "attack3": (-13, 39, 0.54, -0.117, 0.116),
}


def archery_pose(rig, stance, action, phase):
    mounted = stance == "ride_bow"
    moving_shot = action.startswith("attackMove")
    base = "run" if moving_shot else "ready" if action.startswith("attack") else action
    motion.human_pose(rig, stance, base, phase)
    if mounted and action in ("walk", "run"):
        p = inherited_pose(rig)
        grip = p.anchor("weapon.L")
        cord = p.anchor("bowstring")
        rotation = p.transforms["weapon.L"].to_quaternion() @ p.rest["weapon.L"].to_quaternion().inverted()
        # 给下弓梢留出肩铠随马步抬落的空间。
        raised = motion.arm(p, "L", grip + Vector((0.035, 0, 0.14)), rotation, (0.80, -0.55, -0.65))
        p.set("bowstring", head=cord + raised - grip)
        return
    if not action.startswith("attack"):
        return
    p = inherited_pose(rig)
    wave = math.tau * phase
    t = phase * motion.TIMING[action]
    yaw = motion.DIRECTIONS.get(action, 0)
    pitch, cant, reach, rise, hold = SHOTS.get(action, SHOTS["attack"])
    aiming = motion.envelope(
        t, ((0, 0.77), (0.033, 0.70), (0.11, 1), (0.17, 1), (0.33, 0.64), (0.67, 0.38), (0.84, 0.77))
    )
    release = motion.envelope(t, ((0, 0), (0.105, 0), (0.17, 1), (0.28, 0.65), (0.56, 0)))
    hips = p.anchor("hips")
    if not mounted:
        feet = {side: p.anchor(f"foot.{side}") for side in SIDE}
        hips += Vector((0.032 * (aiming - 0.5), 0.035 * release - 0.020 * aiming, -0.013 * aiming))
        p.set("hips", head=hips, delta=turn(x=2 * release, f=-2 * aiming, z=-4 * aiming))
        for side, foot in feet.items():
            motion.leg(p, side, foot, 0, False)
    follow = yaw * (0.76 + 0.24 * aiming)
    p.set("spine", local=turn(x=2 + 3 * release, z=follow * 0.37 - 16 * aiming))
    p.set("chest", local=turn(x=-pitch * 0.15, f=cant * 0.20, z=follow * 0.48 - 37 * aiming))
    p.set("neck", local=turn(z=follow * 0.15 + 28 * aiming))
    p.set("head", local=turn(x=-pitch * 0.48, z=23 * aiming))
    p.set("mantle", local=turn(x=-6 - 8 * moving_shot + 3 * math.sin(wave), z=-follow * 0.24))
    axis = turn(z=follow)
    weapon = turn(x=-pitch - 5 * release, f=cant * aiming, z=follow)
    # 左臂随射向伸展，右手贴下颌，松弦后沿同一直线后撤。
    left = hips + local_offset(
        (-0.023, reach - 0.105 * (1 - aiming), 0.616 + rise - 0.14 * (1 - aiming)), axis
    )
    motion.arm(p, "L", left, weapon, local_offset((0.79, -0.65, -0.73), axis))
    cheek = p.anchor("head") + local_offset((-0.083, -0.008 - 0.104 * release, 0.025), axis)
    drawn = motion.envelope(
        t,
        (
            (0, 0.82),
            (0.034, 0.76),
            (hold, 1),
            (0.118, 1),
            (0.13334, 0),
            (0.183, 0.08),
            (0.29, 0),
            (0.84, 0.82),
        ),
    )
    right = cheek + local_offset((0, 0.10 * (1 - aiming), -0.02 * (1 - aiming)), axis)
    hand = motion.arm(p, "R", right, turn(f=-24, z=follow), local_offset((-0.92, -0.84, 0.23), axis))
    p.set("bowstring")
    cord = p.anchor("bowstring")
    nock = hand + local_offset((0.009, 0.015, -0.025), axis)
    p.set("bowstring", head=cord.lerp(nock, drawn))


# 主手握住枪根，左手沿同一根枪杆取第二个握点。
KONTOS_IDLE = ((-0.235, 0.032, 0.280), (-51, 0, 26))
KONTOS = {
    "attack": ((-0.204, 0.266, 0.320), (-6, 0, 19)),
    "attack2": ((-0.236, 0.205, 0.468), (23, 0, 20)),
    "attack3": ((-0.315, 0.089, 0.375), (9, 0, 52)),
}


# 骑枪平刺从耳尖上方越过，下刺沿马颈右侧出枪并收回。
MOUNTED_KONTOS = {
    "attack": ((-0.204, 0.266, 0.365), (-15, 0, 16)),
    "attack2": ((-0.250, 0.205, 0.468), (23, 0, -24)),
}


def kontos_fall(p, t, held):
    """落马时铁甲骑兵的两臂：左手松开落在胸前，长枪握在伸过头顶的右手里，平放在头前的地上，与马身平行。"""
    motion.reaching_arm(p, t, held["weapon.R"], turn(f=-90, z=-10))
    motion.flung_arm(p, t, unhorse.FRONT)


def lance_pose(rig, stance, action, phase):
    mounted = stance == "ride_kontos"
    if action == "die" and mounted:
        # 铁甲骑兵阵亡是落马：从待命的坐姿开始，身子与两腿照 unhorse 摆。
        lance_pose(rig, stance, "idle", 0)
        unhorse.fall(rig, phase * motion.TIMING[action], kontos_fall, lift=.02)
        return
    motion.human_pose(rig, "ride_lance" if mounted else "spear_shield", action, phase)
    if action == "die":
        return
    p = inherited_pose(rig)
    strike = action.startswith("attack")
    wave = math.tau * phase
    t = phase * motion.TIMING[action]
    position, attitude = KONTOS_IDLE
    lean, twist = 0, 0
    if strike:
        hit, aim = MOUNTED_KONTOS.get(action, KONTOS[action]) if mounted else KONTOS[action]
        amount = motion.envelope(
            t,
            (
                (0, 0),
                (0.036, -0.30),
                (0.076, 0.23),
                (0.13334, 1),
                (0.203, 1.06),
                (0.34, 0.69),
                (0.57, 0.15),
                (motion.TIMING[action], 0),
            ),
        )
        position = mix(position, hit, amount)
        attitude = mix(attitude, aim, amount)
        if not mounted:
            position.z += 0.048
        elif action == "attack3" and amount < 0:
            # 横刺预备时收住枪尾高度，给右侧马衣留空。
            position.z -= amount * 0.27
            attitude.x = max(-58, attitude.x)
        lean, twist = 16 * amount, (-22 if action == "attack3" else -9) * amount
    elif action == "charge":
        position = (-0.245, 0.122, 0.254 + 0.014 * math.cos(wave))
        attitude = (-3, 0, 28 + 2 * math.sin(wave))
        lean, twist = 19, -12
    elif action == "brace":
        position, attitude = (-0.229, 0.145, 0.047), (-76, 0, 31)
        lean = 12
    elif action == "ready":
        position, attitude = (-0.235, 0.13, 0.246), (-22, 0, 23)
        lean, twist = 8, -7
    elif action in ("walk", "run"):
        position = Vector(position) + Vector((0, 0.038 * math.sin(wave), 0.012 * math.cos(wave)))
    p.set("spine", local=turn(x=lean * 0.55, z=twist * 0.38))
    p.set("chest", local=turn(x=lean * 0.45, z=twist * 0.62))
    p.set("neck", local=turn(x=-lean * 0.25, z=-twist * 0.45))
    p.set("head", local=turn(x=-lean * 0.2, z=-twist * 0.32))
    p.set("mantle", local=turn(x=-4 - lean * 0.55 + 3 * math.sin(wave), z=-twist * 0.25))
    rotation = turn(*attitude)
    anchor = motion.arm(p, "R", p.anchor("hips") + Vector(position), rotation, (-0.95, -0.8, -0.40))
    offhand = turn(attitude[0] + 10, 6, attitude[2] - 6)
    direction = local_offset((0, 1, 0), rotation)
    grip_offset = (0, 0, -0.027)
    origin = anchor + local_offset(grip_offset, rotation) - local_offset(grip_offset, offhand)
    p.set("shoulder.L")
    p.set("upper_arm.L")
    # 可达距离不足时沿枪杆向后滑握，保持左手与枪杆接触。
    toward_shoulder = p.anchor("upper_arm.L") - origin
    along = toward_shoulder.dot(direction)
    across = (toward_shoulder - direction * along).length_squared
    reach = UPPER_ARM + LOWER_ARM - 0.013
    distance = min(0.42 if mounted else 0.342, along + math.sqrt(max(0, reach * reach - across)))
    motion.arm(p, "L", origin + direction * distance, offhand, (0.90, -0.34, -0.57))
    p.set("bowstring")


def animate_library(rig):
    for stance in SETS.values():
        for action in (*COMMON, *EXTRAS[stance]):

            def pose(phase):
                if stance in ("bow", "ride_bow"):
                    archery_pose(rig, stance, action, phase)
                elif stance in ("spear", "ride_kontos"):
                    lance_pose(rig, stance, action, phase)
                else:
                    motion.human_pose(rig, "spear_shield", action, phase)

            clip(rig, f"{stance}.{action}", motion.TIMING[action], pose, action in motion.LOOP)


ELEPHANT_STRIDE = {"walk": 1.58, "run": 2.24}
ELEPHANT_DURATIONS = {
    "idle": 3.4,
    "walk": 1.35,
    "run": 1.05,
    "attack": 0.84,
    "attack2": 0.94,
    "attack3": 0.88,
    "die": 1.48,
}
# 同侧后足先落地，再轮到同侧前足。不同时压低两个对角关节。
ELEPHANT_LEGS = (
    ("hind.L", 1, -0.98, 0),
    ("fore.L", 1, 0.92, 0.22),
    ("hind.R", -1, -0.98, 0.5),
    ("fore.R", -1, 0.92, 0.72),
)
ELEPHANT_BODY = (0, -0.04, 2.03)
TRUNK = (
    (1.78, 2.39, 0.224),
    (1.99, 2.02, 0.186),
    (2.00, 1.62, 0.144),
    (2.03, 1.19, 0.111),
    (2.15, 0.87, 0.079),
    (2.31, 0.67, 0.046),
    (2.41, 0.71, 0.029),
)
DRIVER = (0, 1.15, 2.71)


def elephant_rig():
    bones = [
        ("root", None, (0, 0, 0), (0, 0, 0.3)),
        ("body", "root", ELEPHANT_BODY, (0, -0.04, 2.7)),
        ("skull", "body", (0, 1.22, 2.43), (0, 1.84, 2.60)),
        ("tail", "body", (0, -1.55, 2.40), (0, -1.75, 1.51)),
    ]
    for name, s, f, _ in ELEPHANT_LEGS:
        a, b, c = (s * 0.49, f, 1.91), (s * 0.49, f, 1.01), (s * 0.49, f, 0.20)
        bones.extend(
            (
                (f"upper.{name}", "body", a, b),
                (f"lower.{name}", f"upper.{name}", b, c),
                (f"pad.{name}", f"lower.{name}", c, (c[0], c[1] + 0.20, 0.13)),
            )
        )
    for side, s in SIDE.items():
        bones.append((f"ear.{side}", "skull", (s * 0.38, 1.38, 2.61), (s * 0.80, 1.26, 2.19)))
    for i in range(3):
        f, z, _ = TRUNK[i * 2]
        a, b, _ = TRUNK[i * 2 + 2]
        bones.append((f"trunk.{i}", "skull" if i == 0 else f"trunk.{i - 1}", (0, f, z), (0, a, b)))
    for name, parent, a, b in human_skeleton():
        bones.append(
            (
                "driver" if name == "root" else name,
                ("skull" if parent is None else "driver" if parent == "root" else parent),
                Vector(a) + Vector(DRIVER),
                Vector(b) + Vector(DRIVER),
            )
        )
    return armature("Elephant", bones)


def axial(mesh, profile, sides, surface):
    rings = [
        ([(x + width * math.cos(a), f, z - height * math.sin(a)) for a in angles(sides)], weight)
        for x, f, z, width, height, weight in profile
    ]
    mesh.loft(rings, surface)


def cloth(mesh, elite):
    hem = 1.84 if elite else 1.91
    across = (-0.954, -0.937, -0.795, -0.442, 0, 0.442, 0.795, 0.937, 0.954)
    height = (hem, hem + 0.075, 2.48, 2.794, 2.894, 2.794, 2.48, hem + 0.075, hem)
    rows = []
    for r, f in enumerate((-0.98, -0.91, -0.55, -0.10, 0.38, 0.77, 0.85)):
        rows.append(
            [
                mesh.vertex(
                    (x + 0.013 * ((r + i) % 2), f, height[i] - 0.085 * abs(f) - 0.03 * (r == 0 or r == 6)),
                    "body",
                )
                for i, x in enumerate(across)
            ]
        )
    for r, (back, front) in enumerate(zip(rows, rows[1:])):
        for i in range(len(back) - 1):
            surface = (
                "Brass"
                if r in (0, 5) or i in (0, len(back) - 2)
                else ("team cloth shadow" if i in (1, 6) else "team cloth")
            )
            mesh.face((back[i], front[i], front[i + 1], back[i + 1]), surface, True)
    for s in SIDE.values():
        for i in range(9):
            f = -0.84 + i * 0.195
            z = height[0] - 0.085 * abs(f)
            mesh.tube(
                (s * 0.954, f, z + 0.02), (s * 0.967, f, z - 0.087), 0.018, 0.013, 4, "Brocade", "body"
            )
        if elite:
            for i in range(4):
                for j in range(7):
                    f = -0.78 + 0.225 * j + 0.06 * (i % 2)
                    z = 2.38 - 0.112 * i
                    down = (2.48 - 0.085 * abs(f) - z) / (2.48 - hem - 0.075)
                    x = s * (0.824 + (0.937 - 0.795) * down)
                    outline = [
                        (x, f - 0.114, z),
                        (x, f + 0.114, z),
                        (x + s * 0.025, f + 0.107, z - 0.083),
                        (x + s * 0.045, f, z - 0.119),
                        (x + s * 0.021, f - 0.114, z - 0.084),
                    ]
                    face = tuple(mesh.vertex(p, "body") for p in outline[::s])
                    mesh.face(face, "Brass" if (i + j) % 3 == 0 else "Bronze")


def tower(mesh, elite):
    rear, front, w = -0.80, 0.61, 0.48
    mesh.box((0, -0.10, 2.81), (1.07, 1.44, 0.11), "Walnut", "body")
    for f in (rear, front):
        mesh.box((0, f, 3.045), (1.02, 0.065, 0.37), "Ash", "body")
        mesh.box((0, f, 3.249), (1.11, 0.096, 0.070), "Brass" if elite else "Walnut", "body")
    for s in SIDE.values():
        mesh.box((s * w, -0.096, 3.05), (0.062, 1.40, 0.38), "Ash", "body")
        mesh.box((s * w, -0.096, 3.25), (0.081, 1.50, 0.072), "Brass" if elite else "Walnut", "body")
        for f in (rear, -0.09, front):
            mesh.box((s * w, f, 3.04), (0.104, 0.09, 0.52), "Walnut", "body")
        for f in (-0.43, 0.235):
            mesh.tube(
                (s * 0.513, f, 3.067),
                (s * 0.558, f, 3.067),
                0.134,
                0.121,
                8,
                "team shield" if elite else "Reed",
                "body",
            )
            mesh.tube((s * 0.558, f, 3.067), (s * 0.586, f, 3.067), 0.054, 0.035, 7, "Brass", "body")
    mesh.tube((-0.43, -0.79, 3.14), (-0.43, -0.79, 4.05 if elite else 3.77), 0.021, 0.015, 6, "Ash", "body")
    pennant(mesh, -0.43, -0.79, 4.05 if elite else 3.77, 0.51 if elite else 0.34, "body")


def pennant(mesh, x, f, z, length, bone):
    outlines = (
        (f, z),
        (f - 0.21 * length, z + 0.027),
        (f - 0.63 * length, z - 0.005),
        (f - length, z - 0.041),
        (f - 0.79 * length, z - 0.113),
        (f - length, z - 0.197),
        (f - 0.48 * length, z - 0.228),
        (f, z - 0.238),
    )
    for side in (-1, 1):
        points = [
            mesh.vertex((x + 0.026 * math.sin(i * 0.96) + side * 0.001, a, b), bone)
            for i, (a, b) in enumerate(outlines)
        ]
        center = mesh.vertex((x + 0.02 + side * 0.001, f - length * 0.37, z - 0.106), bone)
        for i, a in enumerate(points):
            b = points[(i + 1) % len(points)]
            mesh.face((a, b, center)[::side], "team trim" if i in (3, 4) else "team cloth", True)


def elephant_mesh(rig, elite):
    mesh = Mesh()
    axial(
        mesh,
        [
            (0, f, z, w, h, "body")
            for f, z, w, h in (
                (-1.66, 2.06, 0.23, 0.42),
                (-1.49, 2.00, 0.51, 0.66),
                (-1.19, 1.98, 0.72, 0.78),
                (-0.72, 1.91, 0.84, 0.85),
                (-0.15, 1.89, 0.88, 0.89),
                (0.46, 1.96, 0.82, 0.85),
                (0.92, 2.02, 0.72, 0.79),
                (1.23, 2.08, 0.60, 0.68),
                (1.42, 2.13, 0.43, 0.49),
            )
        ],
        14,
        lambda row, n: "Elephant shade" if n in (3, 4) else "Elephant hide",
    )
    axial(
        mesh,
        [
            (0, f, z, w, h, "skull")
            for f, z, w, h in (
                (1.07, 2.40, 0.46, 0.43),
                (1.29, 2.44, 0.54, 0.50),
                (1.54, 2.48, 0.51, 0.53),
                (1.76, 2.51, 0.423, 0.46),
                (1.93, 2.45, 0.29, 0.32),
                (1.99, 2.37, 0.20, 0.18),
            )
        ],
        12,
        "Elephant hide",
    )
    for name, s, f, _ in ELEPHANT_LEGS:
        upper, lower, pad = (f"{piece}.{name}" for piece in ("upper", "lower", "pad"))
        x = s * 0.49
        joint = {upper: 0.49, lower: 0.51}
        shape = [
            (x, f + 0.039, 0, 0.222, 0.246, pad),
            (x, f + 0.038, 0.069, 0.242, 0.267, pad),
            (x, f + 0.017, 0.182, 0.220, 0.225, {lower: 0.25, pad: 0.75}),
            (x, f, 0.39, 0.197, 0.207, lower),
            (x, f, 0.71, 0.191, 0.205, lower),
            (x, f, 1.00, 0.215, 0.241, joint),
            (x, f - 0.022, 1.30, 0.268, 0.295, upper),
            (x, f - 0.036, 1.66, 0.332, 0.37, upper),
            (x * 0.87, f - 0.035, 2.083, 0.331, 0.38, {upper: 0.55, "body": 0.45}),
        ]
        section(
            mesh, shape, 9, lambda row, n: "Elephant shade" if row in (0, 2, 3) else "Elephant hide", True
        )
        for i in (-1, 0, 1):
            mesh.oval(
                (x + 0.105 * i, f + 0.259 - 0.027 * abs(i), 0.069),
                (0.045, 0.029, 0.052),
                5,
                "Ivory",
                pad,
                cuts=2,
            )
    ends = []
    for i, (f, z, r) in enumerate(TRUNK):
        weight = "trunk." + str(min(2, i // 2))
        if i in (2, 4):
            weight = {weight: 0.54, "trunk." + str(i // 2 - 1): 0.46}
        if i == 0:
            weight = {"skull": 0.42, "trunk.0": 0.58}
        ends.append(
            (
                [
                    (r * math.cos(a), f + r * 0.9 * math.sin(a), z + 0.40 * r * math.sin(a))
                    for a in angles(9)
                ][::-1],
                weight,
            )
        )
    mesh.loft(ends, lambda row, n: "Elephant shade" if n in (1, 2) and row % 2 == 1 else "Elephant hide")
    mesh.oval((0, 2.426, 0.711), (0.032, 0.018, 0.023), 6, "Elephant shade", "trunk.2", cuts=2)
    for side, s in SIDE.items():
        ear = f"ear.{side}"
        outline = [
            (s * 0.360, 1.343, 2.657),
            (s * 0.576, 1.320, 2.756),
            (s * 0.790, 1.220, 2.647),
            (s * 0.900, 1.131, 2.492),
            (s * 0.846, 1.138, 2.182),
            (s * 0.666, 1.279, 2.002),
            (s * 0.530, 1.363, 2.102),
            (s * 0.368, 1.416, 2.323),
        ]
        rim = [mesh.vertex(a, ear) for a in outline]
        front = mesh.vertex((s * 0.646, 1.461, 2.418), ear)
        back = mesh.vertex((s * 0.646, 1.321, 2.390), ear)
        for i, a in enumerate(rim):
            b = rim[(i + 1) % len(rim)]
            mesh.face((b, a, front)[::s], "Ear interior" if i % 3 == 0 else "Elephant hide", True)
            mesh.face((a, b, back)[::s], "Elephant shade", True)
        mesh.oval((s * 0.384, 1.756, 2.485), (0.038, 0.055, 0.028), 7, "Elephant shade", "skull", cuts=2)
        mesh.oval((s * 0.410, 1.770, 2.486), (0.017, 0.034, 0.014), 6, "Horse eye", "skull", cuts=2)
        length = 1.24 if elite else 1
        tusk = [
            (s * x, 1.76 + (f - 1.76) * length, z, w, h, "skull")
            for x, f, z, w, h in (
                (0.262, 1.76, 2.21, 0.090, 0.091),
                (0.306, 1.96, 2.08, 0.083, 0.080),
                (0.369, 2.22, 1.94, 0.066, 0.067),
                (0.403, 2.63, 1.90, 0.042, 0.039),
                (0.416, 2.93, 2.006, 0.001, 0.002),
            )
        ]
        axial(mesh, tusk, 8, "Ivory")
    mesh.tube((0, -1.53, 2.44), (0, -1.80, 1.70), 0.067, 0.031, 7, "Elephant hide", "tail")
    mesh.tube((0, -1.80, 1.70), (0, -1.74, 1.40), 0.033, 0.028, 6, "Hair", "tail")
    # 额带和鞍毯给同队成列的象留下清楚的色块。
    brow = (
        (-0.39, 1.710, 2.594),
        (-0.30, 1.785, 2.710),
        (-0.16, 1.817, 2.825),
        (0, 1.806, 2.881),
        (0.16, 1.817, 2.825),
        (0.30, 1.785, 2.710),
        (0.39, 1.710, 2.594),
    )
    width = 0.075 if elite else 0.044
    bands = [
        [mesh.vertex((x, f + y, z + h), "skull") for x, f, z in brow]
        for y, h in ((0.029, -width), (0.024, 0.018), (0.005, width))
    ]
    for row, (low, high) in enumerate(zip(bands, bands[1:])):
        for i in range(len(low) - 1):
            mesh.face((low[i], low[i + 1], high[i + 1], high[i]), "team cloth" if row else "Brocade", True)
    if elite:
        mesh.oval((0, 1.885, 2.649), (0.143, 0.077, 0.215), 8, "Bronze", "skull", cuts=3)
        mesh.oval((0, 1.963, 2.699), (0.061, 0.014, 0.071), 7, "Brass", "skull", cuts=2)
    cloth(mesh, elite)
    tower(mesh, elite)

    driver = Mesh()
    torso(driver, "asvaran", False)
    limbs(driver, "asvaran", False)
    head(driver, "asvaran", False)
    offset = len(mesh.vertices)
    mesh.vertices.extend(p + point(DRIVER) for p in driver.vertices)
    mesh.weights.extend(driver.weights)
    mesh.faces.extend(tuple(i + offset for i in face) for face in driver.faces)
    mesh.surfaces.extend(driver.surfaces)
    return mesh.build("War elephant", rig)


ELEPHANT_HITS = {
    "attack": (9, 5, 19, -0.12, 0),
    "attack2": (-9, -3, -34, 0.32, -27),
    "attack3": (4, -14, 21, 0.20, 30),
}


def elephant_pose(rig, driver_rig, action, phase, surface):
    p = Pose(rig)
    wave = math.tau * phase
    time = ELEPHANT_DURATIONS[action] * phase
    moving = action in ELEPHANT_STRIDE
    attack = action in ELEPHANT_HITS
    swing = (
        motion.envelope(
            time,
            (
                (0, 0),
                (0.041, -0.24),
                (0.083, 0.28),
                (0.13334, 1),
                (0.216, 0.92),
                (0.397, 0.38),
                (0.67, -0.06),
                (0.84, 0),
            ),
        )
        if attack
        else 0
    )
    fall = (
        motion.envelope(
            time, ((0, 0), (0.19, 0.04), (0.50, 0.24), (0.84, 0.66), (1.17, 1), (1.31, 0.974), (1.48, 1))
        )
        if action == "die"
        else 0
    )
    pitch, head_pitch, trunk_pitch, reach, yaw = ELEPHANT_HITS.get(action, (0, 0, 0, 0, 0))
    p.set("root")
    bob = (0.026 if moving else 0.008) * math.cos(2 * wave if moving else wave)
    stance_height = {"walk": 1.904, "run": 1.852}.get(action, 1.97)
    body = Vector(
        (
            0.029 * math.sin(wave) + 0.59 * fall,
            -0.04 + reach * swing,
            stance_height + bob - 0.10 * abs(swing) - 0.982 * fall,
        )
    )
    attitude = turn(
        x=pitch * swing + 0.92 * math.sin(wave) - 9 * fall,
        f=1.7 * math.sin(wave) + 85 * fall,
        z=yaw * 0.16 * swing - 8 * fall,
    )
    p.set("body", head=body, delta=attitude)
    p.set(
        "skull",
        local=turn(x=head_pitch * swing + 2.8 * math.sin(wave - 0.5) + 13 * fall, z=yaw * 0.45 * swing),
    )
    p.set("tail", local=turn(x=5 * math.sin(wave - 0.9) + 12 * fall, f=12 * math.sin(wave - 0.3)))
    for i in range(3):
        p.set(
            f"trunk.{i}",
            local=turn(
                x=5 * math.sin(wave - i * 0.55) + trunk_pitch * swing * (1 - 0.17 * i) - 16 * fall,
                z=yaw * swing * 0.37,
                f=3 * math.sin(wave - i * 0.61),
            ),
        )
    for side, s in SIDE.items():
        p.set(
            f"ear.{side}",
            local=turn(x=s * 3 * math.sin(wave), z=s * (8 * math.sin(wave - 0.4) + 12 * swing + 9 * fall)),
        )
    for name, s, f, beat in ELEPHANT_LEGS:
        upper, lower, pad = (f"{piece}.{name}" for piece in ("upper", "lower", "pad"))
        if fall:
            p.set(
                upper,
                local=turn(
                    x=(22 if f > 0 else -23) * fall - 10 * (1 - fall), f=s * (17 if s > 0 else 3) * fall
                ),
            )
            p.set(lower, local=turn(x=20 * (1 - fall) - s * 24 * fall))
            p.set(pad)
            continue
        # 支撑期足垫沿地面匀速后移，摆动期低抬回到落脚点。
        stride = ELEPHANT_STRIDE.get(action, 0)
        step = (phase - beat) % 1
        duty = 0.67 if action == "walk" else 0.58
        if moving and step >= duty:
            fraction = (step - duty) / (1 - duty)
            advance = stride * duty * (motion.ease(fraction) - 0.5)
            lift = (0.12 if action == "walk" else 0.17) * math.sin(math.pi * fraction) ** 1.45
        else:
            advance = stride * (duty / 2 - step)
            lift = 0
        rest = p.transforms["body"] @ p.rest["body"].inverted() @ p.rest[upper]
        h = rest.translation
        hip = Vector((h.x, -h.y, h.z))
        target = Vector((s * 0.49, f + advance, 0.20 + lift))
        ray = target - hip
        foot = hip + ray.normalized() * min(1.709, ray.length)
        knee = bend(hip, foot, 0.90, 0.81, (s * 0.08, 1, 0.03))
        p.set(upper, aim=knee - hip)
        p.set(lower, aim=foot - knee)
        p.set(pad, delta=turn(x=-4 * lift))
    p.set("driver", local=turn(x=6 * swing + 9 * fall, f=-7 * fall, z=-yaw * 0.4 * swing))
    driver_action = "run" if action == "run" else "walk" if action == "walk" else "idle"
    motion.human_pose(driver_rig, "ride_lance", driver_action, phase)
    for bone in driver_rig.pose.bones:
        if bone.name != "root":
            rig.pose.bones[bone.name].matrix_basis = bone.matrix_basis.copy()
    if action == "die":
        body.z += 0.004 - surface.floor(inherited_pose(rig))
        p.set("body", head=body, delta=attitude)


def animate_elephant(rig, mesh):
    import bpy

    driver_rig = armature("Driver reference", human_skeleton())
    surface = GroundSurface(Pose(rig), mesh)
    for action, duration in ELEPHANT_DURATIONS.items():
        clip(
            rig,
            action,
            duration,
            lambda phase: elephant_pose(rig, driver_rig, action, phase, surface),
            action in ("idle", "walk", "run"),
        )
    bpy.data.objects.remove(driver_rig, do_unlink=True)


MANGONEL_DURATIONS = {
    "idle": 3.2,
    "walk": 1.13,
    "attack": 0.80,
    "attack2": 0.94,
    "attack3": 0.86,
    "die": 1.34,
}
MANGONEL_STRIDE = math.tau * 0.332
MANGONEL_HITS = {"attack": (74, 110, 0), "attack2": (86, 126, 5), "attack3": (62, 99, -8)}


def mangonel_rig():
    bones = [
        ("root", None, (0, 0, 0), (0, 0, 0.2)),
        ("chassis", "root", (0, 0, 0.43), (0, 0, 0.83)),
        ("throw", "chassis", (0, -0.25, 0.568), (0, -0.70, 1.41)),
        ("sling", "throw", (0, -0.76, 1.54), (0, -1.02, 1.14)),
        ("flag", "chassis", (-0.438, -0.58, 0.46), (-0.438, -0.58, 1.67)),
    ]
    for side, s in SIDE.items():
        bones.extend(
            (
                (f"wheel.{side}.0", "chassis", (s * 0.523, 0.00, 0.332), (s * 0.65, 0.00, 0.332)),
                (f"axle.{side}", "chassis", (s * 0.34, -0.53, 0.47), (s * 0.34, 0.38, 0.48)),
            )
        )
    return armature("Mangonel", bones)


def mangonel_mesh(rig, elite):
    mesh = Mesh()
    for side, s in SIDE.items():
        x = s * 0.405
        frame = f"axle.{side}"
        mesh.box((x, -0.053, 0.452), (0.143, 1.68, 0.16), "Walnut", frame)
        wheel(mesh, s * 0.523, 0, 0.332, side, 0)
        beam(mesh, (x, 0.55, 0.49), (s * 0.32, 0.30, 1.14), 0.091, frame, "Ash")
        beam(mesh, (x, -0.56, 0.49), (s * 0.32, 0.25, 1.116), 0.077, frame, "Walnut")
        beam(mesh, (x, -0.81, 0.45), (x, -1.115, 0.21), 0.055, frame, "Ash")
        mesh.box((x, -1.09, 0.156), (0.16, 0.183, 0.09), "Iron", frame)
        for f in (-0.75, 0.65):
            mesh.box((x, f, 0.478), (0.157, 0.095, 0.164), "Bronze" if elite else "Iron", frame)
        mesh.tube(
            (s * 0.379, -0.25, 0.568),
            (s * 0.552, -0.25, 0.568),
            0.117,
            0.112,
            10,
            "Bronze" if elite else "Oak end",
            frame,
        )
        for i in range(3):
            mesh.oval(
                (x + s * 0.082, 0.23 - i * 0.095, 0.457),
                (0.019, 0.024, 0.026),
                5,
                "Brass" if elite else "Iron",
                frame,
                cuts=2,
            )
    for f in (-0.65, 0.67):
        mesh.box((0, f, 0.450), (0.89, 0.142, 0.15), "Ash", "chassis")
    mesh.box((0, 0.27, 1.164), (0.89, 0.19, 0.16), "Walnut", "chassis")
    mesh.box((0, 0.269, 1.252), (0.54, 0.198, 0.077), "Leather", "chassis")
    for i in range(11):
        x = -0.37 + i * 0.074
        mesh.tube(
            (x, -0.25, 0.568),
            (x + 0.068, -0.25, 0.568),
            0.097,
            0.090,
            11,
            "Rope" if i % 3 else "Reed shade",
            "chassis",
        )
    beam(mesh, (0, -0.21, 0.53), (0, -0.767, 1.54), 0.067, "throw", "Ash")
    for f, z in ((-0.60, 1.24), (-0.74, 1.49)):
        mesh.tube(
            (0, f + 0.036, z - 0.065),
            (0, f - 0.034, z + 0.057),
            0.088,
            0.081,
            7,
            "Brass" if elite else "Iron",
            "throw",
        )
    for s in SIDE.values():
        mesh.tube((s * 0.046, -0.767, 1.54), (s * 0.067, -1.01, 1.11), 0.012, 0.012, 5, "Rope", "sling")
    mesh.oval((0, -1.01, 1.10), (0.142, 0.140, 0.048), 10, "Leather", "sling", cuts=3)
    mesh.oval((0, -1.01, 1.167), (0.100, 0.099, 0.088), 9, "Stone", "sling", cuts=3)
    height = 1.95 if elite else 1.68
    mesh.tube((-0.438, -0.58, 0.48), (-0.438, -0.58, height), 0.021, 0.014, 6, "Ash", "flag")
    pennant(mesh, -0.438, -0.58, height, 0.54 if elite else 0.37, "flag")
    if elite:
        for s in SIDE.values():
            mesh.oval((s * 0.501, 0.352, 0.89), (0.037, 0.154, 0.148), 8, "Brass", "chassis", cuts=3)
            mesh.oval((s * 0.531, 0.352, 0.89), (0.018, 0.095, 0.096), 8, "team shield", "chassis", cuts=2)
        for z in (1.74, 1.88):
            mesh.tube((-0.438, -0.58, z), (-0.438, -0.58, z + 0.026), 0.031, 0.030, 6, "Brass", "flag")
    return mesh.build("Mangonel", rig)


def mangonel_pose(rig, action, phase):
    p = Pose(rig)
    t = phase * MANGONEL_DURATIONS[action]
    wave = math.tau * phase
    moving = action == "walk"
    swing, sling, yaw = MANGONEL_HITS.get(action, (0, 0, 0))
    throw = motion.envelope(
        t, ((0, 0), (0.072, -0.07), (0.13334, 1), (0.21, 0.96), (0.42, 0.24), (0.78, 0))
    )
    recoil = motion.envelope(t, ((0, 0), (0.10, 0), (0.15, 1), (0.28, -0.19), (0.56, 0)))
    fall = (
        motion.envelope(t, ((0, 0), (0.24, 0.15), (0.70, 0.91), (1, 1), (1.34, 1)))
        if action == "die"
        else 0
    )
    p.set("root")
    p.set(
        "chassis",
        head=(0.195 * fall, -0.057 * recoil * (swing > 0), 0.43 - 0.127 * fall),
        delta=turn(x=3 * recoil * (swing > 0), f=27 * fall + (0.54 * math.sin(2 * wave) if moving else 0)),
    )
    p.set("throw", local=turn(x=swing * throw - 42 * fall, z=yaw * throw + 17 * fall))
    p.set("sling", local=turn(x=sling * throw - 34 * recoil * (swing > 0), z=yaw * throw))
    p.set(
        "flag",
        local=turn(x=3 * math.sin(wave) + 32 * fall + 6 * recoil * (swing > 0), z=3 * math.sin(wave - 0.4)),
    )
    for side, s in SIDE.items():
        p.set(f"axle.{side}", local=turn(z=s * 24 * fall, x=s * 22 * fall))
        p.set(
            f"wheel.{side}.0",
            local=turn(x=360 * phase if moving else -s * 22 * fall, f=s * 17 * fall, z=s * 31 * fall),
        )


def animate_mangonel(rig):
    for action, duration in MANGONEL_DURATIONS.items():
        clip(
            rig,
            action,
            duration,
            lambda phase: mangonel_pose(rig, action, phase),
            action in ("idle", "walk"),
        )


def generate(output):
    manifest = read_manifest(output)
    PALETTE.update(MATERIALS)
    reset()
    rig = armature("Human", human_skeleton())
    reference = Mesh()
    reference.box((0, 0, 0.028), (0.04, 0.04, 0.05), "Stone", "root")
    reference.build("Reference", rig)
    animate_library(rig)
    export(output / "anims/persia.glb")
    manifest["libraries"]["persia"] = "units/anims/persia.glb"
    for kind in (*SETS, "elephant", "mangonel"):
        for elite in (False, True):
            reset()
            name = kind + ("_e" if elite else "")
            art = {"src": f"units/persia/{name}.glb"}
            if kind == "elephant":
                rig = elephant_rig()
                mesh = elephant_mesh(rig, elite)
                animate_elephant(rig, mesh)
                model = {"kind": "rig", **art, "stride": ELEPHANT_STRIDE}
            elif kind == "mangonel":
                rig = mangonel_rig()
                mangonel_mesh(rig, elite)
                animate_mangonel(rig)
                model = {"kind": "rig", **art, "stride": {"walk": MANGONEL_STRIDE}}
            else:
                rig = armature("Human", human_skeleton())
                person(kind, elite, rig)
                art.update(anims="persia", set=SETS[kind])
                if kind in ("asvaran", "cataphract"):
                    model = cavalry_spec(art, "persia", elite)
                else:
                    model = {"kind": "rig", **art, "stride": motion.STRIDE}
            export(output / f"persia/{name}.glb")
            manifest["models"][name] = model
    write_manifest(output, manifest)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output", type=Path, default=Path(__file__).resolve().parents[2] / "public/assets/units"
    )
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else [])
    generate(args.output)
