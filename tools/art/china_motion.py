"""中国阵营的双手戟、汉弩和匣式连弩姿态。"""

import math

from mathutils import Vector

from china import GRIP
from human_motion import HIT_TIME, LOOP, TIMING, arm, envelope, human_pose
from mesh import Pose, clip, mix, point, turn

ACTIONS = {
    "polearm": ("idle", "ready", "walk", "run", "brace", "attack", "attack2", "attack3", "die"),
    "crossbow": ("idle", "ready", "walk", "run", "attack", "attack2", "attack3", "die"),
    "repeating_crossbow": ("idle", "ready", "walk", "run", "attack", "attack2", "attack3", "die"),
}

# 各变体经过命中帧，接着收杆或压下弩身。腕的位置是右手的独立目标，
# 左手的位置再由这把武器的朝向推导，两手会一起随兵器转动。
HITS = {
    "polearm": (((-.17, .27, 1.27), (-6, 12, 26)), ((-.17, .30, 1.57), (33, -8, 24)),
                ((-.29, .24, 1.23), (11, 76, 49))),
    "crossbow": (((-.14, .11, 1.40), (-2, 0, 16)), ((-.14, .15, 1.44), (-28, -8, 19)),
                 ((-.18, .16, 1.26), (21, 14, 24))),
    "repeating_crossbow": (((-.14, .12, 1.33), (1, 0, 22)), ((-.15, .15, 1.42), (-23, -7, 18)),
                           ((-.19, .16, 1.21), (25, 11, 27))),
}


def swing(stance, movement, phase):
    staff = stance == "polearm"
    repeating = stance == "repeating_crossbow"
    t = phase * TIMING[movement]
    if staff:
        hold = ((-.206, .235, 1.08), (-67, 63, -33))
        if movement == "ready":
            hold = ((-.208, .241, 1.093), (-44, 22, 39))
        if movement == "brace":
            hold = ((-.178, .236, .800), (-66, 72, 33))
        if movement in ("walk", "run"):
            hold = ((-.203, .262, 1.135), (-65 if movement == "walk" else -35, 35, 30))
    else:
        hold = ((-.157, .21, 1.14 if repeating else 1.19),
                (25 if movement != "ready" else 10, 9, 33))
    if not movement.startswith("attack"):
        bob = .014*math.sin(math.tau*phase)
        return Vector(hold[0])+Vector((0, bob, bob*.8)), Vector(hold[1]), 0

    hit = HITS[stance][("attack", "attack2", "attack3").index(movement)]
    distance = envelope(t, ((0, 0), (.042, -.14), (.133, 1), (.193, .96), (.35, .42), (.58, .10), (.79, 0)))
    right, angles = (mix(a, b, distance) for a, b in zip(hold, hit))
    pump = envelope(t, ((0, 0), (.090, -.21), (HIT_TIME, .52), (.24, .11),
                        (.42, -.60), (.62, .24), (.81, 0)))
    if not staff:
        # 弩兵命中后收弩。汉弩空手短暂后拉，连弩的手抬上木匣拨杆。
        angles.x += 8*pump
    return right, angles, pump


def current_pose(rig):
    p = Pose(rig)
    for bone in rig.pose.bones:
        name = bone.name
        parent = bone.parent
        base = p.transforms[parent.name] @ p.rest[parent.name].inverted() @ p.rest[name] if parent else p.rest[name]
        p.transforms[name] = base @ bone.matrix_basis
    return p


def local_world(rotation, coordinate):
    offset = rotation @ point(coordinate)
    return Vector((offset.x, -offset.y, offset.z))


def held_pose(rig, stance, movement, phase):
    human_pose(rig, "generic", movement if movement not in ("attack2", "attack3") else "attack", phase)
    repeating = stance == "repeating_crossbow"
    staff = stance == "polearm"
    p = current_pose(rig)
    pump = 0
    if movement == "die":
        anchor = p.anchor("weapon.R")
        rotation = p.transforms["weapon.R"].to_quaternion() @ p.rest["weapon.R"].to_quaternion().inverted()
        rest = turn(x=-5 if staff else 4, z=-75)
        rotation = rotation.slerp(rest, envelope(phase, ((0, 0), (.30, 0), (.78, 1))))
        p.set("weapon.R", head=anchor, delta=rotation)
    else:
        right, angles, pump = swing(stance, movement, phase)
        hip = p.anchor("hips")
        right += Vector((hip.x, hip.y, hip.z-.917))
        rotation = turn(*angles)
        hand = arm(p, "R", right, rotation, (-.85, -.64, -.47))
        if staff:
            offset = (0, .325, -.014)
        elif repeating:
            offset = (0, .315, -.037)
        else:
            offset = (0, .289, -.026)
        left = hand + local_world(rotation, offset)
        arm(p, "L", left, rotation @ turn(z=-58 if staff else -46), (.82, -.65, -.57))
        if not staff and movement.startswith("attack"):
            follow = envelope(phase, ((0, 0), (.29, 0), (.48, 1), (.71, .88), (.96, 0)))
            change = local_world(rotation, (.01, (-.13 if repeating else -.19)*follow,
                                             (.13 if repeating else .072)*follow))
            # 装填手离开握把时，骨骼仍留住弩身的朝向。
            arm(p, "R", hand+change, rotation, (-.85, -.64, -.47))
            p.set("weapon.R", head=hand, delta=rotation)
    if staff:
        return
    if repeating:
        # 复用闲置的弓弦骨驱动木匣拨杆，在当前弩身坐标里绕匣顶摆动。
        pivot = (-.192, .241, .835+.187)
        delta = rotation @ turn(x=-31*pump)
        shift = Vector((0, 0, 0))
    else:
        pivot = (-.192, .38, .878)
        delta = rotation
        if movement.startswith("attack"):
            tension = envelope(phase*TIMING[movement],
                               ((0, 1), (.113, 1), (HIT_TIME, 0), (.31, 0), (.62, 1)))
        else:
            tension = 0 if movement == "die" else .75
        shift = local_world(rotation, (0, -.145*tension, 0))
    bone_rest = (.192, .005, .835)
    joint = p.anchor("weapon.R") + local_world(rotation, Vector(pivot)-Vector(GRIP))
    p.set("bowstring", head=joint+shift+local_world(delta, Vector(bone_rest)-Vector(pivot)),
          delta=delta)


def animate(rig):
    for stance, movements in ACTIONS.items():
        for movement in movements:
            clip(rig, f"{stance}.{movement}", TIMING[movement],
                 lambda phase: held_pose(rig, stance, movement, phase), movement in LOOP)
