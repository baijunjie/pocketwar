"""火箭车和霹雳车的游戏网格及动作。"""

import math

from china import cloth_strip
from human_motion import envelope
from mesh import Mesh, Pose, angles, armature, clip, turn
from siege import DURATION, beam, wheel


def wheels(kind):
    return (.56, .31, (-.14,)) if kind == "huojian" else (.76, .36, (-.77, .76))


def stand(kind, elite):
    rocket = kind == "huojian"
    w, z, axles = wheels(kind)
    pivot = (0, .03, .94) if rocket else (0, .23, 1.53)
    flag = (.35, -.63, 1.62 if elite else 1.55) if rocket else (.55, -.72, 1.92 if elite else 1.76)
    bones = [
        ("root", None, (0, 0, 0), (0, 0, .2)),
        ("chassis", "root", (0, 0, .44), (0, 0, .85)),
        ("payload", "chassis", pivot, (0, pivot[1], pivot[2]+.3)),
        ("basket", "payload", (0, 1.02, 1.12), (0, 1.02, 1.40)),
        ("sling", "payload", (0, -.94, .91), (0, -.94, 1.25)),
        ("banner", "chassis", flag, (flag[0], flag[1], flag[2]+.4)),
    ]
    for side, s in (("L", 1), ("R", -1)):
        for i, f in enumerate(axles):
            bones.append((f"wheel.{side}.{i}", "chassis", (s*w, f, z), (s*(w+.16), f, z)))
    return armature(kind + " rig", bones)


def banner(mesh, x, f, base, height, elite):
    mesh.tube((x, f, base), (x, f, height), .017, .012, 6, "Ash", "chassis")
    mesh.tube((x, f, height-.059), (x, f, height+.056), .024, .008, 6, "Bronze", "chassis")
    width = .286 if elite else .231
    rows = [([(x, f, height-.064), (x, f-width*.62, height-.092),
              (x-.019, f-width, height-.138)], "banner"),
            ([(x, f, height-.249), (x+.045, f-width*.58, height-.248),
              (x-.024, f-width, height-.205)], "banner"),
            ([(x, f, height-.267), (x+.045, f-width*.58, height-.266),
              (x-.024, f-width, height-.220)], "banner")]
    cloth_strip(mesh, rows, lambda i: "team cloth" if i == 0 else "Han braid")
    cloth_strip(mesh, [(points[::-1], bind) for points, bind in rows],
                lambda i: "team cloth shadow" if i == 0 else "Han braid")


def rocket_box(mesh, elite):
    bind = "payload"
    cols, rows = (6, 4) if elite else (5, 3)
    stride_x, stride_z = .108, .103
    w = cols * stride_x + .12
    h = rows * stride_z + .13
    z = 1.02
    mesh.box((0, .09, z), (w, .83, h), "Han wood", bind)
    mesh.box((0, .521, z), (w-.074, .031, h-.065), "Han lacquer dark", bind)
    for x in (-w*.5, w*.5):
        for face in (-.315, .531):
            mesh.box((x, face, z), (.058, .068, h+.048), "Iron", bind)
        for cz in (z-h/2, z+h/2):
            mesh.box((x, .09, cz), (.066, .91, .05), "Oak end", bind)
        mesh.box((x*1.07, -.014, z), (.022, .47, h*.52), "team shield", bind)
        if elite:
            mesh.tube((x, -.014, z), (x*1.11, -.014, z), .072, .068, 8, "Brass", bind)
    for cz in (z-h*.5, z+h*.5):
        mesh.box((0, .535, cz), (w+.052, .065, .052), "Oak end", bind)
    for x in (-w*.502, w*.502):
        for n in (-1, 1):
            mesh.box((x, .092, z+n*h*.36), (.012, .80, .012), "Oak end", bind)
        for face in (-.327, .541):
            for n in (-1, 1):
                mesh.box((x, face, z+n*h*.32), (.023, .016, .021), "Brass", bind)
    for row in range(rows):
        for col in range(cols):
            x = (col-(cols-1)*.5)*stride_x
            cz = z + (row-(rows-1)*.5)*stride_z
            mesh.tube((x, .533, cz), (x, .564, cz), .037, .027, 5, "Iron", bind)
            extent = .60 + .022*((col+row*2)%3)
            mesh.tube((x, .558, cz), (x, extent, cz), .021, .002, 5, "Steel edge", bind)
    if elite:
        mesh.box((0, .07, z+h*.5+.041), (w*.96, .88, .053), "team trim", bind)


def thrower(mesh, elite):
    for s in (-1, 1):
        x = s*.62
        for f in (-.69, .77):
            beam(mesh, (x, f, .49), (s*.34, .23, 1.51), .145 if elite else .128)
            mesh.box((x, f, .51), (.202, .212, .163), "Han wood", "chassis")
        mesh.box((s*.34, .23, 1.49), (.197, .25, .245), "Han wood", "chassis")
        mesh.box((s*.34, .23, 1.53), (.208, .277, .094), "Iron", "chassis")
        beam(mesh, (x, -.48, .48), (s*.45, .41, 1.18), .071, surface="Ash")
        for i in range(2):
            mesh.box((x+s*.115, -.29+i*.46, .45), (.035, .055, .06), "Brass", "chassis")
        for f in (-.67, .69):
            mesh.box((x, f, .519), (.204, .084, .045), "Iron", "chassis")
    mesh.tube((-.47, .23, 1.53), (.47, .23, 1.53), .063, .063, 9, "Bronze", "chassis")
    beam(mesh, (0, -.94, .91), (0, 1.02, 1.43), .122 if elite else .103, "payload", "Han wood")
    mesh.box((0, .22, 1.47), (.245, .28, .19), "Iron", "payload")
    for s in (-1, 1):
        mesh.tube((s*.16, 1.02, 1.40), (s*.16, 1.02, 1.10), .023, .023, 5,
                  "Iron", "payload", end_weight="basket")
    mesh.rings([(0, 1.02, z, rx, rf, "basket") for z, rx, rf in (
        (.68, .227, .191), (.743, .282, .226), (1.055, .282, .228), (1.109, .258, .20)
    )], 8, "Oak end", smooth=False)
    for z in (.765, 1.052):
        mesh.rings([(0, 1.02, z+h, .291, .234, "basket") for h in (-.026, .026)], 8,
                   "Iron" if not elite else "Bronze", smooth=False, caps=False)
    for s in (-1, 1):
        mesh.tube((s*.042, -.94, .91), (s*.102, -1.19, .612), .012, .012, 5,
                  "Rope", "sling")
    mesh.oval((0, -1.20, .60), (.159, .147, .047), 8, "Leather", "sling", cuts=3)
    mesh.oval((0, -1.20, .661), (.119, .107, .103), 7, "Stone", "sling", cuts=3)
    if elite:
        mesh.box((0, -.54, .49), (.863, .122, .183), "team shield", "chassis")
        mesh.box((0, -.601, .50), (.356, .018, .051), "Han braid", "chassis")


def model(kind, elite, rig):
    rocket = kind == "huojian"
    m = Mesh()
    w, axle_h, axles = wheels(kind)
    rail = w - .15
    for side, s in (("L", 1), ("R", -1)):
        x = s*rail
        m.box((x, -.054, .443), (.154 if rocket else .187, 1.50 if rocket else 1.87, .161),
              "Han wood", "chassis")
        for i, f in enumerate(axles):
            wheel(m, s*w, f, axle_h, side, i)
        if rocket:
            for f in (-.34, .36):
                beam(m, (x, f, .44), (s*.28, f*.78, .87), .099, surface="Ash")
            beam(m, (x, -.54, .44), (s*.33, -1.036, .65), .079, surface="Oak")
            m.box((s*.33, -1.075, .65), (.136, .22, .11), "Leather edge", "chassis")
            m.box((x, .57, .211), (.121, .163, .414), "Oak", "chassis")
            m.box((x, .57, .024), (.161, .198, .048), "Iron", "chassis")
    for f in (*axles, .55) if rocket else axles:
        m.box((0, f, .448), (w*2+.16, .146, .156), "Oak end", "chassis")
    if rocket:
        rocket_box(m, elite)
        banner(m, .35, -.63, .65, 1.62 if elite else 1.55, elite)
    else:
        thrower(m, elite)
        banner(m, .55, -.72, .69, 1.92 if elite else 1.76, elite)
    return m.build(kind + ("_e" if elite else ""), rig)


def pose(rig, kind, movement, phase):
    rocket = kind == "huojian"
    t = DURATION[movement]*phase
    wave = math.tau*phase
    firing = envelope(t, ((0, 0), (.065, -.12), (.133, 1), (.22, .58),
                          (.39, -.16), (.84, 0))) if movement == "attack" else 0
    swivel = envelope(t, ((0, 0), (.065, -.11), (.133, .95), (.225, 1.0),
                          (.43, .42), (.84, 0))) if movement == "attack" else 0
    collapse = envelope(t, ((0, 0), (.18, .08), (.63, .81), (.97, 1), (1.32, 1))) if movement == "die" else 0
    p = Pose(rig)
    p.set("root")
    p.set("chassis", head=(.11*collapse, -.037*firing, .44-.16*collapse),
          delta=turn(x=-2.8*firing, f=24*collapse+(.55*math.sin(wave) if movement == "walk" else 0)))
    p.set("payload", local=turn(x=(-11+7*firing if rocket else 88*swivel)-19*collapse,
                               z=-14*collapse))
    p.set("basket", local=turn(x=-74*swivel+22*collapse))
    p.set("sling", local=turn(x=64*firing-17*collapse))
    p.set("banner", local=turn(f=6*math.sin(wave)+12*collapse, z=10*math.sin(wave-.40)))
    for side, s in (("L", 1), ("R", -1)):
        for i in range(len(wheels(kind)[2])):
            p.set(f"wheel.{side}.{i}", local=turn(x=360*phase if movement == "walk" else 0, z=s*13*collapse))


def animate(rig, kind):
    for movement, length in DURATION.items():
        clip(rig, movement, length, lambda phase: pose(rig, kind, movement, phase),
             movement in ("idle", "walk"))
