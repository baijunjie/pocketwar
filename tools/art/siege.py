import math

from mesh import Mesh, Pose, armature, clip, turn
from human_motion import envelope

DURATION = {"idle": 3.2, "walk": 1.18, "attack": .84, "die": 1.32}


def stand(kind):
    big = kind == "onager"
    w = .57 if big else .38
    axle = .36 if big else .28
    pivot = (0, -.22, .59) if big else (0, .22, 1.14)
    bones = [
        ("root", None, (0, 0, 0), (0, 0, .20)),
        ("chassis", "root", (0, 0, .47), (0, 0, .85)),
        ("throw", "chassis", pivot, (0, pivot[1], pivot[2]+.35)),
        ("sling", "throw", (0, -.70, 1.80) if big else (0, -.26, 1.15),
         (0, -.70, 2.02) if big else (0, -.26, 1.32)),
        ("spring.L", "chassis", (.25, .37, 1.15), (.62, .28, 1.15)),
        ("spring.R", "chassis", (-.25, .37, 1.15), (-.62, .28, 1.15)),
        ("fragment.L", "chassis", (.29, -.46, .50), (.29, .02, .50)),
        ("fragment.R", "chassis", (-.29, -.46, .50), (-.29, .02, .50)),
    ]
    for side, s in (("L", 1), ("R", -1)):
        for n, f in enumerate((-.63, .62) if big else (-.26,)):
            bones.append((f"wheel.{side}.{n}", "chassis", (s*w, f, axle), (s*(w+.16), f, axle)))
    return armature(kind + " rig", bones)


def beam(m, a, b, width, binding="chassis", surface="Oak"):
    m.tube(a, b, width, width, 4, surface, binding, smooth=False)


def wheel(m, x, f, z, side, n):
    radius = z
    bone = f"wheel.{side}.{n}"
    rim = []
    for dx, r in ((-.065, radius), (.065, radius), (.065, radius*.78), (-.065, radius*.78)):
        rim.append([m.vertex((x+dx, f + r*math.cos(a), z+r*math.sin(a)), bone)
                    for a in (math.tau*i/16 for i in range(16))])
    for row in range(4):
        for i in range(16):
            j = (i+1) % 16
            m.face((rim[row][i], rim[(row+1)%4][i], rim[(row+1)%4][j], rim[row][j]),
                   "Iron" if row == 0 else "Oak end", row == 0)
    m.tube((x-.091, f, z), (x+.091, f, z), radius*.265, radius*.265, 10, "Oak", bone)
    m.tube((x-.102, f, z), (x+.102, f, z), radius*.134, radius*.134, 8, "Iron", bone)
    for i in range(8):
        a = i*math.tau/8
        b = (x, f+radius*.84*math.cos(a), z+radius*.84*math.sin(a))
        beam(m, (x, f, z), b, radius*.102, bone, "Ash")


def model(kind, rig):
    big = kind == "onager"
    m = Mesh()
    w, d, z = (.48, 1.78, .45) if big else (.29, 1.20, .42)
    for side, s in (("L", 1), ("R", -1)):
        x = s*w
        m.box((x, 0, z), (.145 if big else .115, d, .15), "Oak", "chassis")
        for f in (-d*.44, d*.44):
            m.box((x, f, z), (.162 if big else .135, .105, .171), "Iron", "chassis")
        for n, f in enumerate((-.63, .62) if big else (-.26,)):
            wheel(m, s*(.57 if big else .38), f, .36 if big else .28, side, n)
        for i in range(3):
            m.box((x+s*.077, -.36+i*.23, z+.024), (.025, .039, .040), "Iron", "chassis")
        if big:
            beam(m, (x, .064, .50), (x, .38, 1.18), .117)
            beam(m, (x, .68, .47), (x, .38, 1.18), .094, "fragment."+side)
            m.box((x, .38, 1.13), (.174, .191, .12), "Iron", "fragment."+side)
            m.tube((x, -.22, .59), (x+s*.097, -.22, .59), .145, .125, 12, "Bronze", "chassis")
            beam(m, (x, -.76, .52), (x, -.54, .83), .08)
        else:
            beam(m, (x, -.50, .44), (s*.10, -.26, 1.01), .092)
            beam(m, (x, .42, .44), (s*.14, .30, 1.01), .090, "fragment."+side)
            m.box((x, .409, .18), (.135, .165, .36), "Oak", "chassis")
            m.box((x, .409, .041), (.17, .216, .082), "Oak end", "chassis")
            m.box((s*.242, .345, 1.087), (.145, .26, .30), "Oak", "chassis")
            for h in (.967, 1.208):
                m.box((s*.242, .345, h), (.178, .30, .051), "Iron", "chassis")
            for n in range(7):
                m.tube((s*.242, .344, .99+n*.028), (s*.242, .344, 1.022+n*.028),
                       .071, .070, 9, "Rope", "chassis")
            binding = "spring."+side
            beam(m, (s*.23, .363, 1.15), (s*.52, .296, 1.151), .045, binding, "Ash")
            beam(m, (s*.51, .298, 1.15), (s*.694, .137, 1.15), .029, binding, "Ash")
            m.tube((s*.689, .145, 1.15), (s*.014, -.22, 1.15),
                   .008, .008, 5, "Rope", binding, end_weight="sling")
    for f in (-.63, .62) if big else (-.26, .41):
        m.box((0, f, z), (2*w+.13, .16, .16), "Oak end", "chassis")
    if big:
        for n in range(9):
            x = -.41+n*.096
            m.tube((x, -.22, .59), (x+.09, -.22, .59), .127, .127, 12, "Rope", "chassis")
        m.box((0, .38, 1.20), (1.11, .19, .171), "Oak", "chassis")
        m.box((0, .38, 1.306), (.65, .215, .092), "Leather", "chassis")
        beam(m, (0, -.15, .53), (0, -.70, 1.80), .085, "throw", "Ash")
        m.tube((0, -.684, 1.742), (0, -.71, 1.804), .10, .10, 9, "Iron", "throw")
        m.tube((0, -.70, 1.80), (0, -1.06, 1.30), .016, .016, 6, "Rope", "sling")
        m.oval((0, -1.06, 1.30), (.149, .169, .059), 9, "Leather", "sling", cuts=3)
        m.oval((0, -1.06, 1.35), (.115, .120, .093), 9, "Stone", "sling", cuts=4)
    else:
        m.box((0, -.059, 1.03), (.158, 1.42, .138), "Oak end", "chassis")
        for x in (-.051, .051):
            m.box((x, -.059, 1.112), (.030, 1.40, .029), "Ash", "chassis")
        m.box((0, .56, 1.041), (.211, .125, .172), "Iron", "chassis")
        m.box((0, -.70, 1.012), (.195, .100, .169), "Iron", "chassis")
        m.tube((0, -.26, 1.15), (0, .68, 1.15), .013, .011, 6, "Ash", "throw")
        m.tube((0, .64, 1.15), (0, .79, 1.15), .027, .001, 6, "Steel", "throw")
        m.box((0, -.20, 1.15), (.080, .13, .043), "Iron", "sling")
        m.tube((-.205, -.61, .976), (.205, -.61, .976), .061, .061, 9, "Oak", "chassis")
        m.tube((.19, -.58, .97), (.26, -.58, 1.16), .031, .026, 6, "Iron", "chassis")
    return m.build(kind, rig)


def machine_pose(rig, kind, movement, phase):
    big = kind == "onager"
    t = DURATION[movement] * phase
    wave = math.tau * phase
    recoil = envelope(t, ((0, 0), (.10, -.04), (.133, 1), (.23, .54), (.37, -.17), (.84, 0))) if movement == "attack" else 0
    launch = envelope(t, ((0, 0), (.06, -.07), (.133, 1), (.18, .95), (.39, .18), (.84, 0))) if movement == "attack" else 0
    fall = envelope(t, ((0, 0), (.22, .12), (.64, .90), (.92, 1), (1.32, 1))) if movement == "die" else 0
    p = Pose(rig)
    p.set("root")
    p.set("chassis", head=(.17*fall, -.052*recoil, .47-.18*fall),
          delta=turn(x=3.2*recoil, f=27*fall + (.85*math.sin(2*wave) if movement == "walk" else 0)))
    if big:
        p.set("throw", local=turn(x=58*launch-32*fall+1.4*math.sin(wave)))
        p.set("sling", local=turn(x=105*launch-51*recoil))
    else:
        p.set("throw", head=(0, .22 + 1.06*max(0, launch), 1.14-.29*max(0, launch-.5)), local=turn(f=41*fall))
        latch = .002*math.sin(wave) if movement == "idle" else 0
        p.set("sling", head=(0, -.26 + .47*max(0, recoil), 1.15 + latch))
    for side, s in (("L", 1), ("R", -1)):
        p.set("spring."+side, local=turn(z=s*(23*recoil+13*fall)))
        p.set("fragment."+side, local=turn(x=-s*43*fall, f=s*38*fall, z=s*19*fall))
        for n in range(2 if big else 1):
            p.set(f"wheel.{side}.{n}", local=turn(x=360*phase if movement == "walk" else -s*27*fall))


def animate(rig, kind):
    for movement, duration in DURATION.items():
        clip(rig, movement, duration, lambda phase: machine_pose(rig, kind, movement, phase),
             movement in ("idle", "walk"))
