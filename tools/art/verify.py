"""直接校验导出后的 GLB，使用系统 Python 即可运行。"""

import argparse
import json
import math
import struct
import sys
from bisect import bisect_left
from itertools import combinations, groupby
from pathlib import Path

if __name__ == "__main__":
    sys.dont_write_bytecode = True

from horse_gaits import GAITS, STRIDE
from horse_rig import SADDLE

LIBRARY = {"idle", "ready", "walk", "run", "charge", "attack", "attackMove", "attackMoveL",
           "attackMoveR", "attackMoveBL", "attackMoveBR", "die", "brace", "guard", "guardWalk"}
LOOPS = {"idle", "ready", "walk", "run", "charge", "attackMove", "brace", "guard", "guardWalk"}
ATTACKS = ("attack", "attack2", "attack3")
COMMON_HOLDS = {"idle", "ready", "walk", "run", "die", *ATTACKS}
HOLDS = {
    "legion": ("sword_shield", {"guard", "guardWalk"}),
    "auxilia": ("spear_shield", {"brace", "charge"}),
    "velites": ("javelin", {"attackMove"}),
    "sagitt": ("bow", {"attackMove"}),
    "equites": ("ride_lance", {"charge"}),
}
TOOLS = {"scorpio", "onager"}
HUMAN = {"root", "hips", "spine", "chest", "neck", "head"} | {
    f"{bone}.{side}" for side in ("L", "R")
    for bone in ("shoulder", "upper_arm", "forearm", "hand", "thigh", "shin", "foot", "toe", "weapon")
}
DIMENSION = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}
COMPONENT = {5121: "B", 5123: "H", 5125: "I", 5126: "f"}
# walk 是快步（对角两蹄同起同落），run 是右领袭步（四蹄依次落地）。
HORSE_BEATS = {
    "walk": [{("hind", "L"), ("fore", "R")}, {("hind", "R"), ("fore", "L")}],
    "run": [{("hind", "L")}, {("hind", "R")}, {("fore", "L")}, {("fore", "R")}],
}
# 每个周期四蹄腾空的次数、每次至少占周期的比例，以及同时着地的蹄数上限。
HORSE_FLIGHT = {"walk": (2, .08), "run": (1, .18)}
HORSE_SUPPORT = {"walk": 2, "run": 3}
HORSE_LIFT = (.06, .60)
HORSE_GROUND_TOLERANCE = .008
HORSE_DRIFT_TOLERANCE = .012


class Glb:
    def __init__(self, path):
        self.path = path
        data = path.read_bytes()
        magic, version, length, text_length, json_type = struct.unpack_from("<4sIII4s", data)
        assert (magic, version, length, json_type) == (b"glTF", 2, len(data), b"JSON"), path
        self.doc = json.loads(data[20:20+text_length])
        self.binary = data[28+text_length:]
        self.nodes = self.doc["nodes"]
        skin, = self.doc["skins"]
        self.joints = skin["joints"]
        self.inv_binds = list(self.values(skin["inverseBindMatrices"]))
        self.names = [self.nodes[index]["name"] for index in self.joints]
        assert len(set(self.names)) == len(self.names), path
        self.actions = {action["name"]: action for action in self.doc.get("animations", [])}

    def values(self, index):
        acc = self.doc["accessors"][index]
        view = self.doc["bufferViews"][acc["bufferView"]]
        offset = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
        layout = struct.Struct("<" + COMPONENT[acc["componentType"]] * DIMENSION[acc["type"]])
        stride = view.get("byteStride", layout.size)
        for i in range(acc["count"]):
            yield layout.unpack_from(self.binary, offset + stride*i)

    def bind_signature(self):
        parents = {child: node["name"] for node in self.nodes for child in node.get("children", [])}
        return {
            name: (
                parents[index], self.nodes[index].get("translation", [0, 0, 0]),
                self.nodes[index].get("rotation", [0, 0, 0, 1]),
                self.nodes[index].get("scale", [1, 1, 1]), inv,
            )
            for name, index, inv in zip(self.names, self.joints, self.inv_binds)
        }

    def mesh(self, face_budget, height, team):
        triangles = 0
        bottom, top = math.inf, -math.inf
        materials = self.doc["materials"]
        for mesh in self.doc["meshes"]:
            for prim in mesh["primitives"]:
                assert prim.get("mode", 4) == 4, self.path
                indices = self.doc["accessors"][prim["indices"]]["count"]
                assert indices % 3 == 0, self.path
                triangles += indices // 3
                attrs = prim["attributes"]
                assert "WEIGHTS_1" not in attrs, self.path
                joints = self.values(attrs["JOINTS_0"])
                weights = self.values(attrs["WEIGHTS_0"])
                assert self.doc["accessors"][attrs["JOINTS_0"]]["count"] == self.doc["accessors"][attrs["WEIGHTS_0"]]["count"], self.path
                for vertex_joints, vertex_weights in zip(joints, weights):
                    active = [(joint, w) for joint, w in zip(vertex_joints, vertex_weights) if w > 0.00001]
                    assert 1 <= len(active) <= 2, self.path
                    assert abs(sum(w for _, w in active) - 1) <= .001, self.path
                    assert all(joint < len(self.names) for joint, _ in active), self.path
                positions = self.doc["accessors"][attrs["POSITION"]]
                bottom = min(bottom, positions["min"][1])
                top = max(top, positions["max"][1])
        assert 0 < triangles <= face_budget, (self.path, triangles, face_budget)
        assert len(self.names) <= 48 and "root" in self.names, self.path
        assert abs(bottom) < .02 and height[0] <= top <= height[1], (self.path, bottom, top)
        has_team = False
        for mat in materials:
            assert mat.get("alphaMode", "OPAQUE") == "OPAQUE", (self.path, mat["name"])
            assert "normalTexture" not in mat and "emissiveTexture" not in mat, (self.path, mat["name"])
            assert not any(mat.get("emissiveFactor", [0, 0, 0])), (self.path, mat["name"])
            if mat["name"].startswith("team"):
                has_team = True
                r, g, b, alpha = mat["pbrMetallicRoughness"]["baseColorFactor"]
                assert .60 <= r <= 1 and r == g == b and alpha == 1, (self.path, mat["name"])
        assert has_team == team, self.path
        return triangles

    def clips(self, required):
        assert self.actions.keys() == required, (self.path, self.actions.keys() ^ required)
        for name, action in self.actions.items():
            short_name = name.rsplit(".", 1)[-1]
            end = 0
            for channel in action["channels"]:
                target = channel["target"]
                assert target["node"] in self.joints, (self.path, name, target)
                assert self.nodes[target["node"]]["name"] != "root", (self.path, name, target)
                sampler = action["samplers"][channel["sampler"]]
                times = list(self.values(sampler["input"]))
                values = list(self.values(sampler["output"]))
                start, finish = times[0][0], times[-1][0]
                assert start == 0 and len(times) == len(values), (self.path, name)
                assert all(a < b for a, b in zip(times, times[1:])), (self.path, name)
                end = max(end, finish)
                if short_name in LOOPS:
                    a, b = values[0], values[-1]
                    if target["path"] == "rotation":
                        assert abs(abs(sum(x*y for x, y in zip(a, b))) - 1) < .0001, (self.path, name, target)
                    else:
                        assert math.dist(a, b) < .0001, (self.path, name, target)
            if short_name.startswith("attack"):
                assert .60 <= end <= 1.0, (self.path, name, end)
            if short_name == "die":
                assert 1.0 <= end <= 1.5, (self.path, name, end)
            if short_name == "idle":
                assert 2.0 <= end <= 4.0, (self.path, name, end)



def add(a, b):
    return tuple(x+y for x,y in zip(a,b))


def cross(a, b):
    return (a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0])


def rotate(q, v):
    t = tuple(2*x for x in cross(q[:3], v))
    return add(v, add(tuple(q[3]*x for x in t), cross(q[:3], t)))


def compose_rotation(a, b):
    scalar = a[3]*b[3] - sum(x*y for x,y in zip(a[:3], b[:3]))
    xyz = add(cross(a[:3], b[:3]), tuple(a[3]*y+b[3]*x for x,y in zip(a[:3], b[:3])))
    return (*xyz, scalar)


def slerp(a, b, weight):
    dot = sum(x*y for x, y in zip(a, b))
    if dot < 0:
        b = tuple(-v for v in b)
        dot = -dot
    if dot > .9995:
        value = tuple(x + weight*(y-x) for x, y in zip(a, b))
        length = math.sqrt(sum(v*v for v in value))
        return tuple(v/length for v in value)
    angle = math.acos(dot)
    divisor = math.sin(angle)
    before = math.sin((1-weight)*angle)/divisor
    after = math.sin(weight*angle)/divisor
    return tuple(before*x + after*y for x, y in zip(a, b))


class Motion:
    def __init__(self, asset, clip_name=None):
        self.nodes = asset.nodes
        self.parents = {child: i for i, node in enumerate(self.nodes) for child in node.get("children", [])}
        self.tracks = {}
        if clip_name is not None:
            animation = asset.actions[clip_name]
            for channel in animation["channels"]:
                target = channel["target"]
                sampler = animation["samplers"][channel["sampler"]]
                ts = tuple(t for (t,) in asset.values(sampler["input"]))
                self.tracks[target["node"], target["path"]] = (ts, tuple(asset.values(sampler["output"])))
        self.times = max((t for t, _ in self.tracks.values()), key=len, default=(0,))

    def world(self, time):
        pose = {}

        def get(i):
            if i in pose:
                return pose[i]
            rest = self.nodes[i]

            def sample(path, fallback):
                track = self.tracks.get((i, path))
                if track is None:
                    return rest.get(path, fallback)
                times, values = track
                if time <= times[0]:
                    return values[0]
                if time >= times[-1]:
                    return values[-1]
                j = bisect_left(times, time)
                if abs(times[j]-time) < 1e-7:
                    return values[j]
                weight = (time-times[j-1])/(times[j]-times[j-1])
                a, b = values[j-1], values[j]
                if path == "rotation":
                    return slerp(a, b, weight)
                return tuple(x + weight*(y-x) for x, y in zip(a, b))

            assert all(abs(v-1) < .0001 for v in sample("scale", (1,1,1))), rest["name"]
            position = sample("translation", (0,0,0))
            orientation = sample("rotation", (0,0,0,1))
            if i in self.parents:
                parent_pos, parent_rot = get(self.parents[i])
                position = add(parent_pos, rotate(parent_rot, position))
                orientation = compose_rotation(parent_rot, orientation)
            pose[i] = position, orientation
            return pose[i]

        for i in range(len(self.nodes)):
            get(i)
        return pose


def verify_strikes(asset):
    weapons = [asset.joints[asset.names.index(f"weapon.{side}")] for side in ("L", "R")]
    for stance, _ in HOLDS.values():
        hits = []
        for name in ATTACKS:
            motion = Motion(asset, f"{stance}.{name}")
            hit = min(motion.times, key=lambda t: abs(t-2/15))
            assert abs(hit-2/15) < .0001, (stance, name, hit)
            pose = motion.world(hit)
            hits.append([pose[i] for i in weapons])
        for a, b in combinations(hits, 2):
            distances = [math.dist(p, q) for (p, _), (q, _) in zip(a, b)]
            angles = [2*math.acos(min(1, abs(sum(x*y for x,y in zip(p,q))))) for (_, p), (_, q) in zip(a,b)]
            assert max(distances) > .09 or max(angles) > .25, (stance, distances, angles)


def horse_geometry(asset, bind):
    hooves = {}
    surface = set()
    for mesh in asset.doc["meshes"]:
        for prim in mesh["primitives"]:
            is_hoof = asset.doc["materials"][prim["material"]]["name"] == "Hoof"
            attrs = prim["attributes"]
            positions = asset.values(attrs["POSITION"])
            joints = asset.values(attrs["JOINTS_0"])
            weights = asset.values(attrs["WEIGHTS_0"])
            for vertex, indices, values in zip(positions, joints, weights):
                x, y, z = vertex
                influences = []
                for index, weight in zip(indices, values):
                    if weight <= .00001:
                        continue
                    inv = asset.inv_binds[index]
                    local = tuple(inv[i]*x + inv[i+4]*y + inv[i+8]*z + inv[i+12]
                                  for i in range(3))
                    joint = asset.joints[index]
                    influences.append((joint, *(v*weight for v in local), weight))
                surface.add(tuple(influences))
                if is_hoof:
                    ((joint, x, y, z, weight),) = influences
                    assert abs(weight-1) < .0001, (asset.path, joint, weight)
                    hooves.setdefault(joint, set()).add((x, y, z))

    feet = {}
    for pair, side in GAITS["walk"]:
        index = asset.joints[asset.names.index(f"{pair}_hoof.{side}")]
        points = hooves.pop(index)
        _, rotation = bind[index]
        heights = {v: rotate(rotation, v)[1] for v in points}
        floor = min(heights.values())
        sole = [v for v, height in heights.items() if height <= floor+.0001]
        assert len(sole) >= 3, (asset.path, pair, side)
        # 蹄踵离地时蹄绕蹄尖翻起，所以拿蹄尖（蹄底最靠前的一点）当蹄印的标记。
        marker = max(sole, key=lambda v: rotate(rotation, v)[2])
        feet[pair, side] = (index, points, marker)
    assert not hooves, (asset.path, hooves.keys())
    return feet, surface


def ground_height(surface, pose):
    rows = {}
    for joint, ((_, y, _), (qx, qy, qz, qw)) in pose.items():
        rows[joint] = (2*(qx*qy+qw*qz), 1-2*(qx*qx+qz*qz), 2*(qy*qz-qw*qx), y)
    return min(sum(a*x+b*y+c*z+d*w for joint, x, y, z, w in influences
                   for a, b, c, d in (rows[joint],)) for influences in surface)


def horse_samples(motion, phases=()):
    keys = sorted({t for times, _ in motion.tracks.values() for t in times})
    duration = keys[-1]
    steps = math.ceil(duration * 120)
    samples = [duration*i/steps for i in range(steps+1)]
    samples.extend((a+b)/2 for a, b in zip(keys, keys[1:]))
    samples.extend(keys)
    samples.extend(phase*duration for phase in phases)
    # 关键帧和落蹄边界优先于只差浮点精度的等间隔采样。
    distinct = {round(t, 6): t for t in samples}
    return duration, [distinct[t] for t in sorted(distinct)]


def hoof_height(hoof, pose):
    index, points, _ = hoof
    p, q = pose[index]
    return p[1] + min(rotate(q, v)[1] for v in points)


def hoof_marker(hoof, pose, travel):
    index, _, marker = hoof
    p, q = pose[index]
    return add(add(p, rotate(q, marker)), (0, 0, travel))


def verify_gait(motion, name, stride, hooves, surface):
    events = GAITS[name]
    assert all(0 <= strike < 1 and 0 < duty < 1 for strike, duty, _, _ in events.values()), (name, events)
    ordered = sorted(events, key=lambda foot: events[foot][0])
    beats = [set(feet) for _, feet in groupby(ordered, key=lambda foot: events[foot][0])]
    assert beats == HORSE_BEATS[name], (name, "落蹄顺序", beats)
    boundaries = [(strike+offset) % 1 for strike, duty, _, _ in events.values() for offset in (0, duty)]
    duration, sample_times = horse_samples(motion, boundaries)
    anchored = {
        foot: hoof_marker(hooves[foot], motion.world(strike*duration), strike*stride)
        for foot, (strike, _, _, _) in events.items()
    }

    supports = []
    flights = []
    peak = dict.fromkeys(hooves, 0)
    for time in sample_times:
        phase = time/duration
        pose = motion.world(time)
        bottom = ground_height(surface, pose)
        assert bottom >= -HORSE_GROUND_TOLERANCE, (name, "网格穿地", phase, bottom)
        planted = 0
        heights = []
        for foot, hoof in hooves.items():
            height = hoof_height(hoof, pose)
            heights.append(height)
            peak[foot] = max(peak[foot], height)
            strike, duty, _, _ = events[foot]
            progress = (phase-strike+1e-9) % 1
            if progress < duty:
                # 跨循环接缝的支撑段也只用同一个蹄印。
                marker = hoof_marker(hoof, pose, (strike+progress)*stride)
                drift = math.dist(anchored[foot], marker)
                assert abs(height) <= HORSE_GROUND_TOLERANCE, (name, foot, "支撑相悬空", phase, height)
                assert drift <= HORSE_DRIFT_TOLERANCE, (name, foot, "蹄印漂移", phase, drift)
                planted += 1
            elif .12 < (progress-duty)/(1-duty) < .88:
                assert height > .004, (name, foot, "摆动相接触地面", phase, height)
        contact_count = sum(height <= HORSE_GROUND_TOLERANCE for height in heights)
        assert planted <= HORSE_SUPPORT[name] and contact_count <= 3, (
            name, "同时着地的蹄数", phase, planted, heights)
        supports.append(planted)
        flights.append((time, planted == 0 and contact_count == 0))

    # 腾空段按相位首尾相接来数：从一段着地的地方起算，跨过循环接缝的那一段不会被拆成两段。
    start = next(i for i, (_, airborne) in enumerate(flights) if not airborne)
    runs, begin = [], None
    for time, airborne in flights[start:] + [(t + duration, a) for t, a in flights[:start + 1]]:
        if airborne and begin is None:
            begin = time
        elif not airborne and begin is not None:
            runs.append(time - begin)
            begin = None
    count, share = HORSE_FLIGHT[name]
    assert len(runs) == count and min(runs) >= share*duration, (name, "四蹄腾空（秒）", runs)
    for foot, height in peak.items():
        assert HORSE_LIFT[0] <= height <= HORSE_LIFT[1], (name, foot, "抬蹄峰值", height)
    print(f"{name} 支撑蹄数（采样） " + " ".join(
        f"{feet} 蹄 × {supports.count(feet)}" for feet in sorted(set(supports)))
        + " | 腾空 " + "、".join(f"{span/duration:.0%}" for span in runs))


def verify_horse(asset, strides):
    for clip_name, value in STRIDE.items():
        for model_id, stride in strides.items():
            assert math.isclose(stride[clip_name], value, rel_tol=0, abs_tol=1e-9), (model_id, clip_name, stride)
    for name, action in asset.actions.items():
        assert all(s.get("interpolation", "LINEAR") == "LINEAR" for s in action["samplers"]), (asset.path, name)

    bind = Motion(asset).world(0)
    saddle = asset.joints[asset.names.index("saddle")]
    bind_position, bind_rotation = bind[saddle]
    # 导出后是 +Y 朝上、+Z 朝前。
    assert math.dist(bind_position, (SADDLE[0], SADDLE[2], SADDLE[1])) < .001, (asset.path, bind_position)
    hooves, surface = horse_geometry(asset, bind)
    for name in GAITS:
        verify_gait(Motion(asset, name), name, strides["equites"][name], hooves, surface)

    for name in ("idle", "die"):
        motion = Motion(asset, name)
        duration, sample_times = horse_samples(motion)
        for time in sample_times:
            pose = motion.world(time)
            bottom = ground_height(surface, pose)
            assert bottom >= -HORSE_GROUND_TOLERANCE, (name, "网格穿地", time, bottom)
            if name == "idle":
                planted = sum(abs(hoof_height(hoof, pose)) <= HORSE_GROUND_TOLERANCE for hoof in hooves.values())
                assert planted >= 3, (name, "至少三蹄支撑", time, planted)
        if name == "die":
            pose = motion.world(duration)
            p, q = pose[saddle]
            inverse = tuple(-v for v in bind_rotation[:3]) + bind_rotation[3:]
            up = rotate(compose_rotation(q, inverse), (0, 1, 0))
            bottom = ground_height(surface, pose)
            assert bottom <= .012 and p[1] < .85 and abs(up[1]) < .45, (name, "终帧倒地", bottom, p, up)


def report(asset, max_faces, height, team, actions):
    triangles = asset.mesh(max_faces, height, team)
    asset.clips(actions)
    print(f"{asset.path.parent.name}/{asset.path.name:14} {triangles:4} 三角形 | "
          f"{len(asset.names):2} 骨骼 | {len(asset.actions):2} 动作")


def verify(root):
    manifest = json.loads((root / "manifest.json").read_text())
    assert manifest["version"] == 1

    def asset(path):
        assert path.startswith("units/")
        return Glb(root / path.removeprefix("units/"))

    human_path = manifest["libraries"]["human"]
    assert human_path == "units/anims/human.glb"
    human = asset(human_path)
    assert HUMAN <= set(human.names)
    actions = LIBRARY | {f"{name}.{clip}" for name, extra in HOLDS.values() for clip in COMMON_HOLDS | extra}
    report(human, 20, (.04, .06), False, actions)
    verify_strikes(human)
    hips = human.joints[human.names.index("hips")]
    rider_idle = human.actions["ride_lance.idle"]
    track = next(channel for channel in rider_idle["channels"]
                 if channel["target"] == {"node": hips, "path": "translation"})
    for position in human.values(rider_idle["samplers"][track["sampler"]]["output"]):
        assert abs(position[1]) < .04, position
    mount = asset("units/anims/horse.glb")
    assert "saddle" in mount.names
    assert len(mount.doc["animations"]) == 4, mount.path
    report(mount, 2600, (1.9, 2.2), True, {"idle", "walk", "run", "die"})

    models = manifest["models"]
    verify_horse(mount, {name: models[name]["stride"] for name in ("equites", "equites_e")})
    ids = list(HOLDS) + [name + "_e" for name in HOLDS] + sorted(TOOLS)
    assert set(ids) <= models.keys()
    for model_id in ids:
        base = model_id.removesuffix("_e")
        row = models[model_id]
        machine = base in TOOLS
        mounted = base == "equites"
        art = row["rider"] if mounted else row
        assert row["kind"] == ("mounted" if mounted else "rig"), model_id
        assert art["src"] == f"units/rome/{model_id}.glb", model_id
        exported = asset(art["src"])
        assert row["stride"]["walk"] > 0, model_id
        if machine:
            report(exported, 3000, (1.0, 2.2), False, {"idle", "walk", "attack", "die"})
            continue
        if mounted:
            assert row["mount"]["src"] == "units/anims/horse.glb", model_id
        assert row["stride"]["run"] > 0, model_id
        assert art["anims"] == "human" and art["set"] == HOLDS[base][0], model_id
        for standard, custom in art.get("clips", {}).items():
            assert standard in LIBRARY | set(ATTACKS) and custom in actions and custom.startswith(art["set"] + "."), model_id
        assert exported.bind_signature() == human.bind_signature(), model_id
        report(exported, 1800 if mounted else 2000, (1.7, 2.0), True, set())


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", type=Path, nargs="?",
                        default=Path(__file__).resolve().parents[2] / "public/assets/units")
    verify(parser.parse_args().root)
