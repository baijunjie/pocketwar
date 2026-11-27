import math
from collections import defaultdict
from functools import cache

import bpy
from mathutils import Matrix, Quaternion, Vector

# 模型坐标 (横向、前向、高度) 映射到 Blender 的 Z-up 空间。
def point(p):
    return Vector((p[0], -p[1], p[2]))


def mix(a, b, t):
    return Vector(a).lerp(Vector(b), t)


PALETTE = {
    "Skin": ((.52, .29, .18), 0, .67),
    "Skin shade": ((.36, .17, .11), 0, .74),
    "Skin light": ((.62, .37, .24), 0, .66),
    "Hair": ((.068, .038, .023), 0, .81),
    "Steel": ((.47, .49, .49), .72, .32),
    "Steel shadow": ((.26, .28, .29), .63, .48),
    "Steel edge": ((.69, .70, .68), .79, .28),
    "Mail": ((.29, .31, .31), .57, .64),
    "Mail highlight": ((.37, .39, .39), .58, .55),
    "Bronze": ((.48, .30, .10), .72, .39),
    "Brass": ((.70, .48, .21), .72, .32),
    "Leather": ((.20, .094, .040), 0, .74),
    "Leather edge": ((.32, .17, .080), 0, .61),
    "Fleece": ((.32, .26, .20), 0, .91),
    "Fur tip": ((.48, .40, .30), 0, .86),
    "Linen": ((.67, .58, .43), 0, .87),
    "Ash": ((.42, .26, .127), 0, .72),
    "Oak": ((.26, .145, .067), 0, .75),
    "Oak end": ((.36, .209, .101), 0, .81),
    "Rope": ((.52, .42, .27), 0, .88),
    "Iron": ((.16, .17, .16), .63, .55),
    "Stone": ((.38, .37, .34), 0, .91),
    "Bay": ((.24, .077, .033), 0, .67),
    "Bay shade": ((.151, .041, .021), 0, .72),
    "Bay light": ((.33, .128, .052), 0, .66),
    "Bay points": ((.053, .032, .025), 0, .82),
    "Horse eye": ((.025, .013, .009), 0, .37),
    "Horse mane": ((.032, .021, .017), 0, .88),
    "Horse tack": ((.079, .033, .017), 0, .75),
    "Mane": ((.071, .036, .019), 0, .83),
    "Muzzle": ((.18, .116, .09), 0, .77),
    "Blaze": ((.70, .66, .58), 0, .80),
    "Hoof": ((.098, .087, .074), 0, .63),
    "team cloth": ((.81, .81, .81), 0, .85),
    "team cloth shadow": ((.63, .63, .63), 0, .92),
    "team shield": ((.87, .87, .87), 0, .56),
    "team trim": ((.72, .72, .72), 0, .73),
    "team plume": ((.75, .75, .75), 0, .89),
}


def material(name):
    existing = bpy.data.materials.get(name)
    if existing:
        return existing
    color, metallic, roughness = PALETTE[name]
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*color, 1)
    shader.inputs["Metallic"].default_value = metallic
    shader.inputs["Roughness"].default_value = roughness
    return mat


class Mesh:
    def __init__(self):
        self.vertices = []
        self.weights = []
        self.faces = []
        self.surfaces = []

    def vertex(self, position, weight):
        idx = len(self.vertices)
        self.vertices.append(point(position))
        self.weights.append({weight: 1} if isinstance(weight, str) else weight)
        return idx

    def face(self, indices, mat, smooth=False):
        self.faces.append(indices)
        self.surfaces.append((mat, smooth))

    def loft(self, rings, mat, caps=True, smooth=True):
        indices = [
            [self.vertex(p, weight(i) if callable(weight) else weight) for i, p in enumerate(positions)]
            for positions, weight in rings
        ]
        sides = len(indices[0])
        for layer, (low, high) in enumerate(zip(indices, indices[1:])):
            for n in range(sides):
                nxt = (n + 1) % sides
                surface = mat(layer, n) if callable(mat) else mat
                self.face((low[n], high[n], high[nxt], low[nxt]), surface, smooth)
        if caps:
            bottom = mat(0, 0) if callable(mat) else mat
            top = mat(len(indices) - 2, 0) if callable(mat) else mat
            self.face(tuple(indices[0]), bottom)
            self.face(tuple(reversed(indices[-1])), top)

    def rings(self, profile, sides, mat, smooth=True, phase=0, caps=True):
        rings = []
        for x, f, z, rx, rf, weight in profile:
            positions = [(x + rx * math.cos(a), f + rf * math.sin(a), z)
                         for a in angles(sides, phase)]
            rings.append((positions, weight))
        self.loft(rings, mat, caps=caps, smooth=smooth)

    def tube(self, a, b, ra, rb, sides, mat, weight, *, end_weight=None, smooth=True):
        axis = (Vector(b) - Vector(a)).normalized()
        tangent = axis.cross(Vector((0, 0, 1)))
        if tangent.length < .001:
            tangent = axis.cross(Vector((1, 0, 0)))
        tangent.normalize()
        normal = axis.cross(tangent)
        rings = []
        for center, radius, binding in ((a, ra, weight), (b, rb, end_weight or weight)):
            rings.append(([Vector(center) + radius * (tangent * math.cos(t) + normal * math.sin(t))
                           for t in angles(sides)], binding))
        self.loft(rings, mat, smooth=smooth)

    def box(self, center, size, mat, weight):
        x, f, z = center
        w, d, h = (axis / 2 for axis in size)
        self.loft([([(x-w, f-d, k), (x+w, f-d, k), (x+w, f+d, k), (x-w, f+d, k)], weight)
                   for k in (z-h, z+h)], mat, smooth=False)

    def oval(self, center, size, sides, mat, weight, cuts=4):
        x, f, z = center
        w, d, h = size
        self.rings([(x, f, z + h * math.sin(t), w * math.cos(t), d * math.cos(t), weight)
                    for t in (-1.50 + 3 * i / cuts for i in range(cuts + 1))], sides, mat)

    def build(self, name, rig):
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(self.vertices, [], self.faces)
        mesh.update()
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.collection.objects.link(obj)
        materials = list(dict.fromkeys(mat for mat, _ in self.surfaces))
        for mat in materials:
            mesh.materials.append(material(mat))
        for poly, (mat, smooth) in zip(mesh.polygons, self.surfaces):
            poly.material_index = materials.index(mat)
            poly.use_smooth = smooth
        groups = defaultdict(list)
        for i, weights in enumerate(self.weights):
            assert len(weights) <= 2 and abs(sum(weights.values()) - 1) < 1e-6, weights
            for bone, value in weights.items():
                groups[bone].append((i, value))
        for bone, weights in groups.items():
            assert bone in rig.data.bones, bone
            group = obj.vertex_groups.new(name=bone)
            for vertex, weight in weights:
                group.add([vertex], weight, "REPLACE")
        obj.parent = rig
        modifier = obj.modifiers.new("Skin", "ARMATURE")
        modifier.object = rig
        return obj


@cache
def angles(sides, phase=0):
    return tuple(phase + n * math.tau / sides for n in range(sides))


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = 60
    bpy.context.scene.unit_settings.system = "METRIC"


def armature(name, skeleton):
    data = bpy.data.armatures.new(name)
    rig = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    for bone, parent, a, b in skeleton:
        edit = data.edit_bones.new(bone)
        edit.head, edit.tail = point(a), point(b)
        if parent:
            edit.parent = data.edit_bones[parent]
    bpy.ops.object.mode_set(mode="OBJECT")
    for pb in rig.pose.bones:
        pb.rotation_mode = "QUATERNION"
    return rig


class Pose:
    def __init__(self, rig):
        self.rig = rig
        self.transforms = {}
        self.rest = {b.name: b.bone.matrix_local for b in rig.pose.bones}

    def set(self, name, *, delta=None, head=None, aim=None, local=None):
        bone = self.rig.pose.bones[name]
        rest = self.rest[name]
        parent = bone.parent
        base = self.transforms[parent.name] @ self.rest[parent.name].inverted() @ rest if parent else rest
        rotation = base.to_quaternion()
        if delta is not None:
            rotation = delta @ rest.to_quaternion()
        if aim is not None:
            rotation = (rotation @ Vector((0, 1, 0))).rotation_difference(point(aim)) @ rotation
        if local is not None:
            rotation = local @ rotation
        location = point(head) if head is not None else base.translation
        matrix = Matrix.Translation(location) @ rotation.to_matrix().to_4x4()
        bone.matrix_basis = base.inverted() @ matrix
        self.transforms[name] = matrix

    def anchor(self, name):
        v = self.transforms[name].translation
        return Vector((v.x, -v.y, v.z))


def turn(x=0, f=0, z=0):
    return (Quaternion((0, 0, 1), math.radians(z))
            @ Quaternion((0, -1, 0), math.radians(f))
            @ Quaternion((1, 0, 0), math.radians(x)))


def bend(a, b, first, second, pole):
    axis = Vector(b) - Vector(a)
    length = max(.001, min(axis.length, first + second - .0001))
    axis.normalize()
    pole = Vector(pole) - axis * Vector(pole).dot(axis)
    along = (length * length + first * first - second * second) / (2 * length)
    height = math.sqrt(max(0, first * first - along * along))
    return Vector(a) + axis * along + pole.normalized() * height


def clip(rig, name, duration, pose, loop=False, step=2):
    # 循环必须采到最后一帧。
    fps = bpy.context.scene.render.fps
    end = step * round(duration * fps / step)
    action = bpy.data.actions.new(name)
    rig.animation_data_create().action = action
    previous = {}
    for frame in range(0, end + 1, step):
        pose(0 if loop and frame == end else frame / end)
        for bone in rig.pose.bones:
            q = bone.rotation_quaternion.copy()
            if bone.name in previous:
                q.make_compatible(previous[bone.name])
            previous[bone.name] = q
            bone.rotation_quaternion = q
            bone.keyframe_insert("location", frame=frame, group=bone.name)
            bone.keyframe_insert("rotation_quaternion", frame=frame, group=bone.name)
    nla = rig.animation_data.nla_tracks.new()
    nla.name = name
    nla.strips.new(name, 0, action)
    nla.mute = True
    rig.animation_data.action = None
    return action


def export(path, step=2):
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.context.scene.frame_set(0)
    bpy.ops.export_scene.gltf(
        filepath=str(path), export_format="GLB", export_yup=True,
        export_animation_mode="NLA_TRACKS", export_frame_step=step,
        export_force_sampling=True, export_optimize_animation_size=True,
        export_optimize_animation_keep_anim_armature=False, export_all_influences=False,
        export_cameras=False, export_lights=False, export_attributes=False,
    )
