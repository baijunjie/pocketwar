import math

from mesh import Mesh, angles

SETS = {
    "legion": "sword_shield",
    "auxilia": "spear_shield",
    "velites": "javelin",
    "sagitt": "bow",
    "equites": "ride_lance",
}
SIDE = {"L": 1, "R": -1}
HIP = .94
UPPER_ARM, LOWER_ARM = .292, .256
THIGH, SHIN = .422, .410


def human_skeleton():
    bones = [
        ("root", None, (0, 0, 0), (0, 0, .20)),
        ("hips", "root", (0, 0, HIP), (0, 0, 1.05)),
        ("spine", "hips", (0, 0, 1.05), (0, 0, 1.28)),
        ("chest", "spine", (0, 0, 1.28), (0, 0, 1.46)),
        ("neck", "chest", (0, 0, 1.46), (0, 0, 1.55)),
        ("head", "neck", (0, 0, 1.55), (0, 0, 1.74)),
        ("mantle", "chest", (0, -.105, 1.44), (0, -.15, 1.10)),
    ]
    for side, s in SIDE.items():
        shoulder = (s * .192, 0, 1.41)
        elbow = (s * .192, 0, 1.41 - UPPER_ARM)
        hand = (s * .192, 0, 1.41 - UPPER_ARM - LOWER_ARM)
        hip = (s * .092, 0, HIP)
        knee = (hip[0], 0, HIP - THIGH)
        foot = (hip[0], 0, HIP - THIGH - SHIN)
        toe = (hip[0], .137, .047)
        bones.extend((name + "." + side, parent, a, b) for name, parent, a, b in (
            ("shoulder", "chest", (s * .045, 0, 1.41), shoulder),
            ("upper_arm", "shoulder." + side, shoulder, elbow),
            ("forearm", "upper_arm." + side, elbow, hand),
            ("hand", "forearm." + side, hand, (hand[0], 0, hand[2] - .093)),
            ("weapon", "hand." + side, hand, (hand[0], .14, hand[2])),
            ("thigh", "hips", hip, knee),
            ("shin", "thigh." + side, knee, foot),
            ("foot", "shin." + side, foot, toe),
            ("toe", "foot." + side, toe, (hip[0], .20, .035)),
        ))
    bones.append(("bowstring", "weapon.L", (.192, .005, .835), (.192, .005, .885)))
    return bones


def skin_section(mesh, profile, sides, mat):
    mesh.rings(profile, sides, mat, caps=False)


def torso(mesh, kind, elite):
    if kind == "velites" and not elite:
        mesh.rings([
            (0, 0, .93, .145, .092, "hips"),
            (0, .003, 1.04, .146, .096, "hips"),
            (0, .004, 1.23, .170, .113, "spine"),
            (0, 0, 1.38, .197, .106, "chest"),
            (0, -.004, 1.46, .065, .063, "chest"),
        ], 12, "team cloth")
    else:
        # 衣领露出，衣身收在甲内以免转身时穿出甲片。
        skin_section(mesh, [
            (0, .003, 1.035, .137, .094, "hips"),
            (0, .004, 1.23, .149, .104, "spine"),
            (0, 0, 1.37, .171, .097, "chest"),
            (0, -.004, 1.46, .065, .063, "chest"),
        ], 10, "team cloth")

    def skirt_surface(_row, side):
        return "team cloth shadow" if side % 4 == 3 else "team cloth"

    skirt = []
    for height, rx, depth, blend in ((.745, .189, .125, True), (.90, .163, .111, True),
                                     (1.04, .153, .101, False)):
        ring = []
        for i, a in enumerate(angles(16, math.pi / 16)):
            fold = (1, .958, 1.025, .967)[i % 4]
            side = "L" if math.cos(a) > 0 else "R"
            weight = {"hips": .50, "thigh." + side: .50} if blend else "hips"
            ring.append(((fold * rx * math.cos(a), fold * depth * math.sin(a),
                          height + (.010 if i % 4 == 2 else 0)), weight))
        positions, weights = zip(*ring)
        skirt.append((positions, weights.__getitem__))
    mesh.loft(skirt, skirt_surface, caps=False)
    if kind == "legion" or (kind == "velites" and not elite):
        skin_section(mesh, [(0, 0, z, .159, .105, "hips") for z in (.998, 1.042)], 12, "Leather")
        mesh.box((0, .111, 1.022), (.078, .021, .049), "Brass", "hips")

    if kind == "legion":
        for i in range(6):
            z = 1.065 + .055 * i
            rx = .168 + i * .006
            bind = "chest" if i >= 4 else ("spine" if i >= 2 else {"hips": .45, "spine": .55})
            skin_section(mesh, [(0, 0, z, rx, .116 + i * .003, bind),
                        (0, 0, z + .053, rx + .002, .118 + i * .003, bind)], 10,
                       lambda _r, n: "Steel shadow" if n in (6, 8) else "Steel")
        for s in SIDE.values():
            for z in (1.16, 1.32):
                mesh.box((s * .063, .125, z), (.032, .011, .049), "Bronze",
                         "chest" if z > 1.28 else "spine")
    elif kind != "velites" or elite:
        skin_section(mesh, [
            (0, 0, .96, .162, .111, "hips"),
            (0, 0, 1.09, .153, .108, {"hips": .65, "spine": .35}),
            (0, .004, 1.235, .179, .123, {"spine": .75, "chest": .25}),
            (0, -.005, 1.39, .204, .114, "chest"),
            (0, -.004, 1.454, .082, .072, "chest"),
        ], 16, lambda r, n: "Mail highlight" if (r + n) % 4 == 0 else "Mail")
        skin_section(mesh, [(0, 0, z, .172, .116, "hips") for z in (1.017, 1.052)], 12, "Leather")
        mesh.box((0, .123, 1.034), (.085, .022, .055), "Brass", "hips")
    if elite:
        rings = []
        for row, (z, w, f, weight) in enumerate((
                (.54, .24, -.196, "mantle"), (.84, .225, -.161, "mantle"),
                (1.15, .201, -.141, {"chest": .40, "mantle": .60}),
                (1.445, .141, -.073, "chest"))):
            rings.append([mesh.vertex((-w + w * n / 3, f + .020 * (n % 2) + .045 *
                                       ((n - 3) / 3) ** 2, z + .012 * (n % 2)), weight)
                          for n in range(7)])
        for low, high in zip(rings, rings[1:]):
            for n in range(6):
                face = (low[n], high[n], high[n+1], low[n+1])
                mesh.face(face, "team trim" if n in (0, 5) else "team cloth", True)
        mesh.oval((.136, .075, 1.419), (.028, .013, .028), 6, "Brass", "chest", cuts=2)


def limbs(mesh, kind, elite):
    for side, s in SIDE.items():
        upper, lower, hand, thigh, shin, foot, toe = (n + "." + side for n in
            ("upper_arm", "forearm", "hand", "thigh", "shin", "foot", "toe"))
        x = .192 * s
        mesh.rings([
            (x, 0, 1.110, .047, .046, {upper: .45, lower: .55}),
            (x, .008, 1.182, .056, .052, upper),
            (x, 0, 1.338, .073, .066, upper),
            (x, 0, 1.415, .073, .069, upper),
            (x * .85, 0, 1.458, .047, .047, {"chest": .5, upper: .5}),
        ], 6 if kind == "equites" else 8, lambda row, _n: ("Skin" if row < 2 else
                               ("Mail" if kind in ("auxilia", "sagitt", "equites") else "team trim")))
        if kind == "legion" or elite:
            for i in range(1 if kind == "equites" else 2):
                z = 1.359 + .043 * i
                skin_section(mesh, [(x, -.004, z, .080 - .007 * i, .073, upper),
                            (x, -.009, z + .041, .081 - .009 * i, .077, upper)],
                           7, "Steel" if i % 2 else "Steel shadow")
        mesh.rings([
            (x, 0, .858, .034, .032, {lower: .7, hand: .3}),
            (x, .007, .995, .050, .046, lower),
            (x, 0, 1.091, .051, .050, lower),
            (x, 0, 1.121, .047, .046, {upper: .45, lower: .55}),
        ], 7 if kind == "equites" else 8, "Skin")
        if kind != "equites":
            skin_section(mesh, [(x, 0, z, .039, .036, lower) for z in (.871, .909)], 8, "Leather edge")
        skin_section(mesh, [
            (x, .012, .771, .029, .027, hand),
            (x, .010, .791, .041, .034, hand),
            (x, 0, .84, .040, .032, hand),
            (x, 0, .865, .035, .031, {lower: .7, hand: .3}),
        ], 8, "Skin shade")
        mesh.tube((x + s*.029, .016, .842), (x + s*.035, .028, .801), .016, .011, 5, "Skin", hand)
        x = .092 * s
        leg_mat = "Leather" if kind == "equites" else "Skin"
        skin_section(mesh, [
            (x, .009, .487, .057, .055, {thigh: .38, shin: .62}),
            (x, .028, .546, .061, .066, {thigh: .84, shin: .16}),
            (x, .014, .70, .080, .080, thigh),
            (x, -.008, .863, .084, .092, {thigh: .78, "hips": .22}),
        ], 8, leg_mat)
        skin_section(mesh, [
            (x, -.008, .105, .037, .045, {shin: .82, foot: .18}),
            (x, -.018, .217, .047, .060, shin),
            (x, -.020, .337, .064, .066, shin),
            (x, .003, .478, .057, .056, {thigh: .38, shin: .62}),
            (x, .009, .507, .057, .055, {thigh: .38, shin: .62}),
        ], 8, leg_mat)
        if elite or kind == "equites":
            skin_section(mesh, [(x, 0, z, r, d, shin) for z, r, d in
                        ((.112, .042, .048), (.22, .055, .061), (.335, .067, .067))],
                       8, "Leather edge" if kind == "equites" else "Bronze")
        for i, z in enumerate((.126, .204)):
            if kind != "equites" and not elite:
                skin_section(mesh, [(x, -.009, k, .043 + .007 * i, .050 + .008 * i, shin)
                            for k in (z, z + .013)], 7, "Leather edge")
        # 皮底跨跖骨，鞋头随 toe 弯折。
        outline = [(-.044, -.070), (.044, -.070), (.054, .112), (.034, .183),
                   (-.038, .183), (-.054, .123)]
        def shoe_binding(n):
            return toe if outline[n][1] > .13 else foot

        layers = [
            ([(x + dx*scale, f, height + (.025 if row == 2 and f < .05 else 0))
              for dx, f in outline], shoe_binding)
            for row, (scale, height) in enumerate(((.98, 0), (1, .018), (.94, .045)))
        ]
        mesh.loft(layers, lambda row, n: "Leather" if row == 0 or n in (0, 2, 4) else leg_mat, smooth=False)


def head(mesh, kind, elite):
    skin_section(mesh, [(0, .002, h, r, r * .84, bind) for h, r, bind in
                ((1.45, .057, "chest"), (1.523, .050, "neck"), (1.573, .054, "head"))], 8, "Skin")
    skin_section(mesh, [
        (0, .027, 1.548, .038, .050, "head"),
        (0, .011, 1.578, .067, .069, "head"),
        (0, .004, 1.635, .079, .081, "head"),
        (0, 0, 1.692, .081, .080, "head"),
        (0, -.004, 1.745, .055, .052, "head"),
    ], 10, lambda row, n: "Skin shade" if row < 2 and n in (0, 4, 5, 9) else "Skin")
    # 鼻梁与眉骨保留侧面轮廓，眼睛用小面压暗。
    mesh.loft([([(x, f, z) for x, f in ring], "head") for z, ring in (
        (1.608, [(-.015, .074), (.015, .074), (.012, .103), (-.012, .103)]),
        (1.630, [(-.015, .077), (.015, .077), (.008, .112), (-.008, .112)]),
        (1.674, [(-.010, .077), (.010, .077), (.008, .091), (-.008, .091)]),
    )], "Skin light", smooth=False)
    mesh.box((0, .076, 1.584), (.047, .008, .009), "Skin shade", "head")
    for s in SIDE.values():
        mesh.box((s*.036, .076, 1.647), (.033, .010, .010), "Hair", "head")
        mesh.oval((s*.079, -.009, 1.629), (.014, .025, .030), 5, "Skin shade", "head", cuts=2)

    if kind == "velites" and not elite:
        skin_section(mesh, [(0, -.019, z, w, d, "head") for z, w, d in
                    ((1.63, .093, .092), (1.73, .098, .110), (1.80, .051, .074))], 10,
                   lambda r, n: "Fur tip" if (r + n) % 4 == 0 else "Fleece")
        mesh.oval((0, .087, 1.753), (.049, .065, .034), 8, "Fur tip", "head", cuts=3)
        mesh.oval((0, .145, 1.755), (.026, .020, .018), 6, "Hair", "head", cuts=2)
        for s in SIDE.values():
            mesh.tube((s*.063, -.040, 1.753), (s*.072, -.047, 1.858),
                      .033, .006, 5, "Fleece", "head")
            mesh.tube((s*.073, -.055, 1.715), (s*.133, -.106, 1.399),
                      .051, .028, 6, "Fur tip", "mantle", end_weight="chest")
        return

    shell = "Bronze" if kind == "auxilia" else "Steel"
    peaked = kind == "sagitt"
    mesh.rings([(0, -.007, z, w, d, "head") for z, w, d in (
        (1.658, .094, .104), (1.703, .095, .098), (1.759, .078, .081),
        (1.797 if not peaked else 1.844, .014 if peaked else .052, .052 if not peaked else .014),
    )], 12, shell)
    skin_section(mesh, [(0, .003, z, w, d, "head") for z, w, d in
                ((1.661, .105, .105), (1.682, .108, .107))], 12, "Brass")
    mesh.box((0, -.106, 1.623), (.186, .054, .032), shell, "head")
    for s in SIDE.values():
        mesh.loft([([(s*x, f, z) for x, f in ring[::s]], "head") for z, ring in (
            (1.557, [(.067, .034), (.086, .034), (.085, .055), (.066, .065)]),
            (1.595, [(.076, -.008), (.098, -.010), (.092, .063), (.074, .081)]),
            (1.663, [(.083, -.043), (.106, -.045), (.104, .053), (.083, .072)]),
        )], shell, smooth=False)
    if kind in ("equites", "legion") or elite:
        mesh.box((0, -.005, 1.797 if not peaked else 1.83), (.046, .136, .033), "Bronze", "head")
        profile = []
        for i, (bottom, height, half) in enumerate((
                (-.135, 1.796, .017), (-.087, 1.858, .026), (-.034, 1.879, .027),
                (.023, 1.883, .027), (.070, 1.870, .026), (.115, 1.830, .020))):
            height += .029*math.sin(i*math.pi/5) if elite else 0
            profile.append(([(half, bottom, 1.79), (-half, bottom, 1.79),
                             (-half*.86, bottom-.028, height), (half*.86, bottom-.028, height)], "head"))
        mesh.loft(profile, lambda row, _n: "team plume" if row % 3 else "team trim", smooth=False)


def shield(mesh, kind, elite):
    w, h, sides = {"legion": (.282, .508, 12), "auxilia": (.224, .358, 12),
                   "velites": (.166, .172, 10), "equites": (.202, .311, 10)}[kind]
    x, f, z = .192, .106, .864
    p = 5 if kind == "legion" else 2
    contour = [(math.copysign(abs(math.cos(a)) ** (2/p), math.cos(a)),
                math.copysign(abs(math.sin(a)) ** (2/p), math.sin(a)))
               for a in angles(sides, math.pi / sides)]
    layers = [[mesh.vertex((x + dx*w*scale, f + forward - (.092 if p == 5 else .043)*dx*dx*scale,
                            z + dz*h*scale), "weapon.L") for dx, dz in contour]
              for scale, forward in ((1, -.023), (1, .004), (.937, .010), (.56, .014))]
    for row, (outer, inner) in enumerate(zip(layers, layers[1:])):
        for i in range(sides):
            nxt = (i+1) % sides
            mesh.face((outer[i], outer[nxt], inner[nxt], inner[i]),
                      "Brass" if row == 1 or (row == 0 and elite) else (
                          "Leather edge" if row == 0 else "team shield"), row == 2)
    center = mesh.vertex((x, f+.016, z), "weapon.L")
    for i in range(sides):
        mesh.face((layers[-1][i], layers[-1][(i+1) % sides], center), "team shield", True)
    mesh.face(tuple(reversed(layers[0])), "Oak")
    mesh.tube((x, f, z), (x, f+.029, z), .079, .061, 10, "Bronze", "weapon.L")
    mesh.tube((x, f+.029, z), (x, f+.060, z), .061, .037, 10, "Steel", "weapon.L")
    if kind == "legion":
        for sx in (-1, 1):
            for sz in (-1, 1):
                coords = [(x + sx*u, f + .018 - .092*(u/w)**2, z + sz*v) for u,v in
                          ((.077, .064), (.172, .215), (.141, .112), (.209, .144), (.092, .036))]
                tips = [mesh.vertex(a, "weapon.L") for a in coords]
                if sx*sz > 0:
                    tips.reverse()
                mesh.face(tips, "Brass")


def equipment(mesh, kind, elite):
    r = "weapon.R"
    x, z = -.192, .835
    if kind == "legion":
        mesh.tube((x, -.08, z), (x, .08, z), .029, .028, 8, "Leather", r)
        mesh.box((x, .08, z), (.121, .039, .047), "Bronze", r)
        mesh.oval((x, -.093, z), (.033, .024, .035), 8, "Brass", r, cuts=2)
        for f, w in ((.10, .041), (.25, .033), (.535, .037), (.668, .001)):
            nodes = [mesh.vertex((x+dx, f, z+dz), r) for dx,dz in
                     ((-w, 0), (0, .011), (w, 0), (0, -.011))]
            if f > .10:
                for i in range(4):
                    n = (i+1) % 4
                    mesh.face((last[i], nodes[i], nodes[n], last[n]), "Steel edge" if i % 2 else "Steel")
            last = nodes
    elif kind != "sagitt":
        butt, end = {"velites": (-.47, .73), "auxilia": (-.89, 1.08), "equites": (-1.09, 1.24)}[kind]
        mesh.tube((x, butt, z), (x, end, z), .018, .013, 7, "Ash", r)
        mesh.tube((x, butt-.036, z), (x, butt+.035, z), .011, .019, 6, "Iron", r)
        mesh.tube((x, end-.053, z), (x, end+.168, z), .022, .001, 6, "Steel edge", r)
        mesh.tube((x, -.086, z), (x, .077, z), .023, .023, 8, "Leather", r)
    if kind != "sagitt":
        shield(mesh, kind, elite)
        return

    x, f = .192, -.053
    bow = [(x, f + delta, z + h) for delta,h in
           ((.058, -.521), (-.010, -.451), (.003, -.357), (.087, -.228), (.108, -.11),
            (.078, 0), (.108, .11), (.087, .228), (.003, .357), (-.010, .451), (.058, .521))]
    # 每段翼尖渐薄，弓弦端点绑定到弓，中央由拉弦手带动。
    limb = []
    for i, (_, f, height) in enumerate(bow):
        radius = .010 + .010 * math.sin(math.pi * i / 10)
        limb.append(([(x + radius*math.cos(a), f + radius*math.sin(a), height)
                      for a in angles(6)], "weapon.L"))
    mesh.loft(limb, lambda n, _side: "Ash" if n in (0, 9) else "Leather edge")
    # 弦中点的静置坐标与弓的端点相同，右手的 weapon 偏移由姿态修正。
    cord = (x, f + .058, z)
    mesh.tube(bow[0], cord, .0025, .0025, 4, "Linen", "weapon.L", end_weight="bowstring")
    mesh.tube(cord, bow[-1], .0025, .0025, 4, "Linen", "bowstring", end_weight="weapon.L")
    mesh.tube((-.143, -.177, 1.02), (.125, -.177, 1.54), .067, .076, 9, "Leather", "chest")
    mesh.tube((.095, -.177, 1.48), (.138, -.177, 1.56), .079, .080, 9, "Bronze", "chest")
    strap = [
        ([(-.152, .048, 1.055), (-.112, .079, 1.059)], "spine"),
        ([(-.032, .134, 1.22), (.007, .135, 1.22)], {"spine": .65, "chest": .35}),
        ([(.100, .101, 1.41), (.134, .073, 1.422)], "chest"),
        ([(.090, -.015, 1.456), (.13, -.018, 1.454)], "chest"),
        ([(.091, -.13, 1.409), (.13, -.14, 1.407)], "chest"),
    ]
    mesh.loft(strap, "Leather edge", caps=False, smooth=True)
    for i in range(4):
        a = (.090+i*.022, -.153-.019*(i%2), 1.47)
        b = (.157+i*.030, a[1], 1.67+.016*i)
        mesh.tube(a, b, .004, .004, 4, "Ash", "chest")
        mesh.tube((b[0]-.017, b[1], b[2]-.055), b, .012, .006, 4, "Linen", "chest")


def infantry(kind, elite, rig):
    mesh = Mesh()
    torso(mesh, kind, elite)
    limbs(mesh, kind, elite)
    head(mesh, kind, elite)
    equipment(mesh, kind, elite)
    return mesh.build(kind + ("_e" if elite else ""), rig)
