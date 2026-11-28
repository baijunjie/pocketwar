"""汉唐兵种外观。沿用共用人形骨架与装备挂点。"""

import math

from mesh import Mesh, PALETTE, angles
from rome import SIDE

SETS = {"ji": "polearm", "dao": "sword_shield", "nu": "crossbow",
        "liannu": "repeating_crossbow", "tieqi": "ride_lance"}
MACHINES = ("huojian", "pili")
IDS = (*SETS, *MACHINES)
RIGHT = "weapon.R"
GRIP = (-.192, 0, .835)

PALETTE.update({
    "Han lacquer": ((.086, .106, .11), .35, .56),
    "Han lacquer light": ((.159, .188, .183), .39, .49),
    "Han lacquer dark": ((.046, .056, .056), .27, .63),
    "Han silk": ((.31, .265, .178), 0, .83),
    "Han cotton": ((.164, .187, .148), 0, .94),
    "Han braid": ((.60, .415, .194), .12, .76),
    "Han wood": ((.193, .102, .043), 0, .72),
})


def cloth_strip(mesh, rows, mat):
    rings = [[mesh.vertex(point, bone) for point in points] for points, bone in rows]
    for row, (a, b) in enumerate(zip(rings, rings[1:])):
        for i in range(len(a)-1):
            mesh.face((a[i], b[i], b[i+1], a[i+1]), mat(row) if callable(mat) else mat)


def folded_band(mesh, top, bottom, mat):
    cloth_strip(mesh, [top, bottom], mat)


def body(mesh, kind, elite):
    cavalry = kind == "tieqi"
    heavy = cavalry or kind == "dao" or elite
    shoulders = .194 if heavy else .183
    mesh.rings([
        (0, 0, .91, .143, .097, "hips"),
        (0, 0, 1.04, .149, .105, "hips"),
        (0, .005, 1.22, .177, .112, {"spine": .82, "chest": .18}),
        (0, 0, 1.386, shoulders, .107, "chest"),
        (0, -.003, 1.441, .071, .064, "chest"),
    ], 8, "Han cotton")
    # 领缘在胸前交叠，在后颈随上身转动。
    for side, s in SIDE.items():
        collar = [
            ([(s*.049, .050, 1.453), (s*.075, .057, 1.445)], "chest"),
            ([(s*.018, .094, 1.412), (s*.049, .101, 1.401)], "chest"),
            ([(-s*.050, .131, 1.375), (-s*.076, .132, 1.364)], "chest"),
        ]
        cloth_strip(mesh, collar if s > 0 else [(ring[::-1], bone) for ring, bone in collar],
                    "Han silk" if side == "R" else "team trim")

    for row, (z, rx, rf, bind) in enumerate((
        (1.366, shoulders+.008, .118, "chest"),
        (1.306, .184, .126, {"chest": .72, "spine": .28}),
        (1.238, .179, .126, {"chest": .18, "spine": .82}),
        (1.170, .164, .121, "spine"),
        (1.097, .156, .113, {"hips": .37, "spine": .63}),
    )):
        laminate(mesh, (0, .003, z), rx, rf, .082, 12 if cavalry else 14, bind,
                 "Steel shadow" if elite else "Han lacquer", row)
    mesh.rings([(0, 0, z, .159, .113, "hips") for z in (1.050, 1.096)], 10,
               "Leather edge", caps=False)
    mesh.oval((0, .118, 1.074), (.044, .017, .027), 6, "Brass" if elite else "Bronze", "hips", cuts=2)

    # 左右袍裾分别随髋腿摆动，前后留开衩。
    for side, s in SIDE.items():
        thigh = "thigh." + side
        middle = {"hips": .53, thigh: .47}
        hem_z = .755 if cavalry else .606 if kind == "ji" else .655
        for row, (za, wa, da, bind_a, zb, wb, db, bind_b) in enumerate((
            (1.058, .150, .10, "hips", .892, .177, .133, middle),
            (.892, .177, .133, middle, hem_z+.023, .193, .144, thigh),
            (hem_z+.023, .193, .144, thigh, hem_z, .195, .147, thigh),
        )):
            arc = [math.radians(s * angle) for angle in (-82, -51, -18, 18, 52, 82)]
            if s < 0:
                arc = [math.pi + a for a in arc]
            folded_band(mesh, ([(wa*math.cos(a), da*math.sin(a), za) for a in arc], bind_a),
                        ([(wb*math.cos(a)+s*.014, db*math.sin(a), zb+.021*abs(math.cos(a))) for a in arc], bind_b),
                        "team cloth" if row < 2 else "Han braid")
        if heavy:
            for row in range(2 if elite else 1):
                coat_z = .98 - row*.072
                laminate(mesh, (s*.013, 0, coat_z), .180+row*.021, .132+row*.009, .088, 5,
                         middle if not row else thigh, "Han lacquer", row,
                         start=-1.40 if s > 0 else math.pi-1.40, span=2.80)

    if elite:
        # 披风内外面共用带脊折线，垂到膝上以避开腿部。
        for offset in (-.006, .004):
            rows = [(1.424, .151, -.118, "chest"), (1.27, .207, -.162, "mantle"),
                    (1.013 if cavalry else .887, .211, -.185, "mantle"),
                    (.992 if cavalry else .864, .205, -.19, "mantle")]
            if offset > 0:
                rows.reverse()
            rings = [([(w*x, f+offset-.026*math.cos(i*math.pi), z-.035*abs(x))
                       for i, x in enumerate((-1, -.66, -.33, 0, .33, .66, 1))], bind)
                     for z, w, f, bind in rows]
            cloth_strip(mesh, rings, lambda row: "team trim" if row == (2 if offset < 0 else 0)
                        else "team cloth" if offset < 0 else "team cloth shadow")
        if cavalry or kind == "dao":
            for s in SIDE.values():
                mesh.tube((s*.086, .121, 1.321), (s*.086, .142, 1.321),
                          .055, .043, 8, "Bronze", "chest")


def laminate(mesh, center, rx, depth, height, count, bone, base, row, *, start=0, span=math.tau):
    x, f, z = center
    step = span / count
    for i in range(count):
        a = start + step * i
        def at(angle, h, flare):
            return x + (rx+flare)*math.cos(angle), f + (depth+flare)*math.sin(angle), z+h
        low, high = a + .07*step, a + .97*step
        contour = (at(low, 0, .004), at(high, 0, .004),
                   at(high-.07*step, -height, .019), at(low+.10*step, -height, .019))
        mesh.face([mesh.vertex(p, bone) for p in contour], "Han lacquer light" if (i+row*2) % 5 == 0 else base)
        if (i+row) % 2 == 0:
            mid = a + .53*step
            knots = (at(mid-.10*step, -.014, .013), at(mid+.10*step, -.014, .013),
                     at(mid, -.048, .020))
            mesh.face([mesh.vertex(p, bone) for p in knots], "Han braid")



def limbs(mesh, kind, elite):
    for side, s in SIDE.items():
        upper, lower, hand, thigh, shin, foot, toe = (key+"."+side for key in
            ("upper_arm", "forearm", "hand", "thigh", "shin", "foot", "toe"))
        x = s*.192
        elbow = {upper: .46, lower: .54}
        wrist = {lower: .70, hand: .30}
        mesh.rings([
            (x, 0, 1.104, .049, .049, elbow), (x, 0, 1.184, .055, .057, upper),
            (x, 0, 1.359, .071, .069, upper), (x*.89, 0, 1.448, .068, .067, upper),
        ], 6, "team cloth", caps=False)
        mesh.rings([
            (x, 0, .861, .035, .035, wrist), (x, .007, .982, .045, .046, lower),
            (x, 0, 1.076, .053, .051, lower), (x, 0, 1.116, .049, .049, elbow),
        ], 6, lambda row, _n: "Leather edge" if row == 0 else "Han cotton", caps=False)
        for n in range(3 if kind == "tieqi" or elite and kind == "dao" else 2):
            laminate(mesh, (x+s*.008, 0, 1.426-.051*n), .079+.004*n, .077+.003*n, .069, 5,
                     upper, "Steel shadow" if elite else "Han lacquer", n,
                     start=-1.43 if s > 0 else 1.71, span=2.86)
        mesh.rings([(x, .01, .773, .030, .028, hand), (x, .01, .802, .041, .035, hand),
                    (x, 0, .869, .034, .033, wrist)], 6, "Skin shade")
        mesh.tube((x+s*.025, .022, .838), (x+s*.034, .036, .801), .015, .012, 4, "Skin", hand)
        x = s*.092
        knee = {thigh: .45, shin: .55}
        ankle = {shin: .68, foot: .32}
        mesh.rings([
            (x, .007, .475, .053, .059, knee), (x, .02, .540, .060, .061, thigh),
            (x, .01, .686, .079, .075, thigh), (x, -.012, .917, .091, .090, {thigh: .68, "hips": .32}),
        ], 6, "Han cotton", caps=False)
        mesh.rings([
            (x, -.014, .055, .043, .047, foot), (x, -.008, .115, .041, .050, ankle),
            (x, -.01, .278, .057, .059, shin), (x, -.005, .424, .065, .061, shin),
            (x, .007, .486, .053, .059, knee),
        ], 6, lambda row, _n: "Leather" if row < 3 else "Han cotton", caps=False)
        if kind == "tieqi" or elite:
            mesh.rings([(x, .006, z, w, d, shin) for z, w, d in (
                (.221, .052, .055), (.400, .067, .065),
            )], 6, "Han lacquer light", caps=False)
        sole = [(-.038, -.062), (.038, -.062), (.049, .071), (.034, .167),
                (-.031, .167), (-.045, .082)]
        mesh.loft([([(x+dx, f, height + (.020 if height > .02 and f < .07 else 0))
                     for dx, f in sole], lambda i: toe if sole[i][1] > .13 else foot)
                   for height in (0, .014, .048)], lambda row, _i: "Iron" if row == 0 else "Leather edge")


def helmet(mesh, kind, elite):
    mounted = kind == "tieqi"
    peaked = elite or mounted
    head = "head"
    mesh.rings([(0, 0, z, w, d, bone) for z, w, d, bone in (
        (1.432, .062, .051, "chest"), (1.526, .053, .049, "neck"), (1.574, .051, .051, head),
    )], 6, "Skin", caps=False)
    mesh.rings([(0, f, z, w, d, head) for f, z, w, d in (
        (.028, 1.545, .036, .043), (.008, 1.595, .071, .077),
        (.003, 1.651, .079, .083), (0, 1.684, .077, .080),
    )], 8, lambda row, n: "Skin shade" if row < 2 and n in (0, 3, 4, 7) else "Skin", caps=False)
    mesh.loft([([(x, f, z) for x, f in outline], head) for z, outline in (
        (1.606, [(-.013, .077), (.013, .077), (.011, .103), (-.011, .103)]),
        (1.627, [(-.015, .080), (.015, .080), (.007, .112), (-.007, .112)]),
        (1.663, [(-.012, .075), (.012, .075), (.008, .090), (-.008, .090)]),
    )], "Skin light", smooth=False)
    mesh.box((0, .081, 1.581), (.036, .007, .009), "Hair" if mounted or elite else "Skin shade", head)
    for s in SIDE.values():
        mesh.box((s*.035, .075, 1.635), (.030, .012, .007), "Hair", head)
    if mounted:
        mesh.oval((0, .063, 1.551), (.033, .020, .030), 5, "Hair", head, cuts=2)

    shell_top = 1.803 if peaked else 1.773
    mesh.rings([(0, -.011, z, w, d, head) for z, w, d in (
        (1.658, .095, .101), (1.699, .096, .096),
        (1.751, .069, .069), (shell_top, .018 if peaked else .034, .028),
    )], 10, lambda row, n: ("Bronze" if elite else "Han lacquer light") if n in (0, 3, 5, 8)
                 else "Steel shadow" if mounted else "Han lacquer")
    mesh.rings([(0, -.007, z, w, d, head) for z, w, d in (
        (1.654, .093, .105), (1.675, .101, .107),
    )], 10, "Brass" if elite else "Bronze", caps=False)
    for row in range(3 if peaked else 2):
        laminate(mesh, (0, -.010, 1.655-row*.038), .099+row*.008, .101+row*.007, .049, 7,
                 head, "Steel shadow" if mounted else "Han lacquer", row,
                 start=math.pi*.80, span=math.pi*1.40)
    mesh.tube((0, -.012, shell_top-.012), (0, -.021, shell_top+.030), .025, .018, 7, "Bronze", head)
    plume = [((0, -.020, shell_top+.020), .018), ((0, -.032, shell_top+.055), .031),
             ((0, -.080, shell_top+(.100 if elite else .067)), .028),
             ((0, -.132, shell_top+.047), .021), ((0, -.164, shell_top+.004), .004)]
    mesh.loft([([(x+r*math.cos(a), f, z+.57*r*math.sin(a)) for a in angles(5, math.pi/5)], head)
               for (x, f, z), r in plume], lambda row, n: "team trim" if n == 0
               else "team plume" if row < 3 else "team cloth shadow")
    if elite:
        mesh.oval((0, .087, 1.715), (.033, .018, .028), 6, "Brass", head, cuts=2)


def plate(mesh, x, outline, depth, surface, edge, bone):
    rings = []
    for side in (-1, 1):
        rings.append([mesh.vertex((x+side*depth, u, v), bone) for u, v in outline])
    mesh.face(tuple(reversed(rings[0])), surface)
    mesh.face(rings[1], surface)
    for i in range(len(outline)):
        j = i-1
        mesh.face((rings[0][j], rings[0][i], rings[1][i], rings[1][j]), edge)


def blade(mesh, center, profile, bind):
    x, f, z = center
    previous = None
    for advance, mid, width, depth in profile:
        ring = [mesh.vertex((x+mid+dx, f+advance, z+dz), bind) for dx, dz in
                ((-width, 0), (0, depth), (width, 0), (0, -depth))]
        if previous:
            for i in range(4):
                j = (i+1) % 4
                mesh.face((previous[i], ring[i], ring[j], previous[j]),
                          "Steel edge" if i in (1, 2) else "Steel")
        previous = ring


def side_shield(mesh, elite):
    x, f, z = .192, .089, .827
    w, h = .234, .392 if elite else .366
    profile = ((-.74, -1), (.65, -1), (.94, -.7), (1, -.25), (1, .65), (.68, 1),
               (-.68, 1), (-1, .65), (-1, -.25), (-.94, -.7)) if elite else (
               (0, -1), (.56, -.84), (.94, -.49), (1, .19), (.84, .68), (.44, .94),
               (0, 1), (-.44, .94), (-.84, .68), (-1, .19), (-.94, -.49), (-.56, -.84))
    rings = [[mesh.vertex((x+u*w*scale, f+advance-.053*u*u*scale, z+v*h*scale), "weapon.L")
              for u, v in profile] for scale, advance in ((1, -.028), (1, .014), (.90, .020), (.67, .028))]
    mesh.face(rings[0], "Han wood")
    mesh.face(tuple(reversed(rings[-1])), "team shield")
    for row, (a, b) in enumerate(zip(rings, rings[1:])):
        for i in range(len(profile)):
            j = (i+1) % len(profile)
            mesh.face((a[i], a[j], b[j], b[i]), ("Leather edge", "Brass" if elite else "Bronze", "team shield")[row])
    mesh.tube((x, f+.025, z), (x, f+.070, z), .065, .031, 9, "Bronze", "weapon.L")
    for sign in (-1, 1):
        for dx in (-.104, .104):
            mesh.box((x+dx, f+.020, z+sign*.22), (.036, .012, .019), "Brass", "weapon.L")
        if elite:
            coords = [(x+u, f+.031-.053*(u/w)**2, z+sign*v) for u, v in (
                (-.139, .108), (-.058, .156), (0, .253), (.058, .156), (.139, .108),
                (0, .206),
            )]
            mesh.face([mesh.vertex(p, "weapon.L") for p in coords[::sign]], "Han braid")


def oval_loop(mesh, center, width, depth, thickness, mat):
    x, f, z = center
    rings = [([(x+(width+thickness*u)*math.cos(a), f+(depth+thickness*u)*math.sin(a), z+thickness*v)
               for a in angles(8)], RIGHT) for u, v in ((0, -1), (1, 0), (0, 1), (-1, 0), (0, -1))]
    mesh.loft(rings, mat, caps=False)


def dao(mesh, elite):
    x, f, z = GRIP
    mesh.tube((x, -.133, z), (x, .073, z), .023, .021, 7, "Leather", RIGHT)
    mesh.tube((x, .062, z), (x, .105, z), .045, .042, 8, "Bronze", RIGHT)
    profile = ((.099, 0, .028, .009), (.34, .005, .034, .009),
               (.615 if elite else .547, .033, .038, .008), (.746 if elite else .668, .060, .001, .001))
    blade(mesh, GRIP, profile, RIGHT)
    oval_loop(mesh, (x, -.154, z), .034, .040, .009, "Brass" if elite else "Bronze")
    side_shield(mesh, elite)


def pole(mesh, kind, elite):
    x, _, z = GRIP
    front = 1.39 if kind == "tieqi" else 1.03
    rear = -1.02 if kind == "tieqi" else -.79
    mesh.tube((x, rear, z), (x, front, z), .020, .014, 7, "Han wood", RIGHT)
    mesh.tube((x, rear-.07, z), (x, rear+.039, z), .013, .022, 6, "Iron", RIGHT)
    mesh.tube((x, front-.097, z), (x, front+.046, z), .022, .019, 7, "Bronze", RIGHT)
    blade(mesh, (x, front, z), ((0, 0, .019, .010), (.084, 0, .031 if elite else .025, .015),
                               (.279 if kind == "tieqi" else .22, 0, .001, .001)), RIGHT)
    if kind == "ji":
        # 侧枝以明亮刃缘从长杆轮廓中分离。
        outline = [(front+d, z+h) for d, h in (
            (-.093, -.015), (.052, -.016), (.088, -.091), (.156, -.202 if elite else -.166),
            (.075, -.195 if elite else -.162), (-.044, -.110), (-.103, -.043),
        )]
        plate(mesh, x, outline, .009, "Steel shadow", "Steel edge", RIGHT)
    if elite:
        cloth_strip(mesh, [
            ([(x-.037, front-.071, z), (x, front-.061, z+.007), (x+.037, front-.072, z)], RIGHT),
            ([(x-.045, front-.101, z-.122), (x+.008, front-.125, z-.104),
              (x+.046, front-.116, z-.115)], RIGHT),
        ], "team plume")


def crossbow(mesh, kind, elite):
    x, _, z = GRIP
    repeating = kind == "liannu"
    span = .265 if repeating else .425
    rail = .42 if repeating else .51
    mesh.box((x, .105, z+.020), (.079 if repeating else .067, .78, .074), "Han wood", RIGHT)
    mesh.box((x, .08, z+.059), (.052, .68, .011), "Ash", RIGHT)
    mesh.tube((x, -.252, z+.02), (x, -.312, z+.02), .045, .038, 6, "Bronze", RIGHT)
    path = [(x+span*u, rail-.13*u*u, z+.024+.019*abs(u))
            for u in (-1, -.84, -.58, -.28, 0, .28, .58, .84, 1)]
    sections = []
    for i, (cx, cf, cz) in enumerate(path):
        radius = .008+.015*math.sin(math.pi*i/8)
        sections.append(([(cx, cf+radius*math.cos(a), cz+radius*math.sin(a))
                          for a in angles(5)], RIGHT))
    mesh.loft(sections, lambda i, _n: "Ash" if i%3 else "Leather edge")
    if repeating:
        mesh.tube(path[0], path[-1], .003, .003, 4, "Linen", RIGHT)
        width = .123 if elite else .102
        mesh.box((x, .15, z+.125), (width, .442, .144), "Han wood", RIGHT)
        mesh.box((x, .144, z+.204), (width+.029, .443, .027), "Oak end", RIGHT)
        for f in (-.044, .298):
            mesh.box((x, f, z+.131), (width+.006, .042, .151), "Bronze", RIGHT)
        for s in (-1, 1):
            mesh.box((x+s*(width*.56), .071, z+.113), (.015, .286, .026), "Han braid", RIGHT)
        mesh.tube((x, .241, z+.187), (x, -.200, z+.221), .016, .019, 6, "Ash", "bowstring")
        mesh.tube((x-.065, -.205, z+.221), (x+.065, -.205, z+.221), .017, .017, 6,
                  "Leather edge", "bowstring")
    else:
        cord = (x, path[0][1], path[0][2])
        mesh.tube(path[0], cord, .003, .003, 4, "Linen", RIGHT, end_weight="bowstring")
        mesh.tube(cord, path[-1], .003, .003, 4, "Linen", "bowstring", end_weight=RIGHT)
        mesh.box((x, .163, z-.030), (.081, .116, .046), "Bronze", RIGHT)
        # 低而宽的蹶张脚圈让弩在侧视和俯视下都可辨认。
        oval_loop(mesh, (x, rail+.107, z+.022), .064, .077, .008, "Bronze")
    if elite:
        mesh.box((x, .34, z+.018), (.084, .058, .091), "Brass", RIGHT)
    quiver_z = 1.292 if repeating else 1.385
    mesh.tube((.129, -.121, .961), (.181, -.179, quiver_z), .052, .057, 7, "Leather", "chest")
    mesh.tube((.178, -.175, quiver_z-.039), (.183, -.181, quiver_z+.005),
              .058, .058, 7, "Bronze", "chest")
    for i in range(3):
        a = (.151+i*.029, -.169-(i%2)*.023, quiver_z-.035)
        b = (a[0]+.026, a[1]-.019, quiver_z+.117-.019*i)
        mesh.tube(a, b, .004, .004, 3, "Ash", "chest")
        mesh.face([mesh.vertex(p, "chest") for p in (a, b, (b[0]+.013, b[1], b[2]-.027))], "Linen")


def infantry(kind, elite, rig):
    mesh = Mesh()
    body(mesh, kind, elite)
    limbs(mesh, kind, elite)
    helmet(mesh, kind, elite)
    if kind == "dao":
        dao(mesh, elite)
    elif kind in ("ji", "tieqi"):
        pole(mesh, kind, elite)
    else:
        crossbow(mesh, kind, elite)
    return mesh.build(kind + ("_e" if elite else ""), rig)
