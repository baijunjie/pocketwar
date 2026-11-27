import argparse
import json
import sys
from pathlib import Path

import bpy

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))

import horse
import human_motion
import rome
import siege
from mesh import Mesh, armature, export, material, point, reset

DEFAULT_OUTPUT = Path(__file__).resolve().parents[2] / "public/assets/units"
MACHINES = ("scorpio", "onager")
HORSE_SRC = "units/anims/horse.glb"


def rider_offset(rig):
    # 骑手原点跟随鞍骨，旋转使用鞍骨相对绑定姿势的增量。
    joint = rig.pose.bones["saddle"]
    rotation = (joint.matrix @ joint.bone.matrix_local.inverted()).to_quaternion()
    return joint.matrix.translation, rotation


def scene_lighting(kind, action):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 16
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 584
    scene.render.resolution_y = 500
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.world = bpy.data.worlds.new("Studio")
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs[0].default_value = (.25, .32, .43, 1)
    scene.world.node_tree.nodes["Background"].inputs[1].default_value = .39
    bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -.018))
    ground = bpy.context.object
    ground.data.materials.append(material("Stone"))
    ground.active_material.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (.072, .063, .048, 1)
    for mat in bpy.data.materials:
        if mat.name.startswith("team"):
            value = mat.diffuse_color[0]
            mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (
                .43*value, .057*value, .039*value, 1)
    mounted = kind == "equites"
    machine = kind in MACHINES
    h = 1.32 if mounted else .85 if kind == "onager" else .62 if machine else .90
    scorpio_shot = kind == "scorpio" and action == "attack"
    target = point((-.03, .43 if scorpio_shot else .16 if mounted else .08, h))
    for name, pos, energy, size, color in (
        ("Key", (-3.5, 4.0, 6.2), 850, 3.0, (1, .89, .76)),
        ("Fill", (3.5, 2.0, 3.2), 360, 3.5, (.69, .81, 1)),
        ("Rim", (.4, -3.5, 4.4), 980, 2.8, (1, .95, .89)),
    ):
        data = bpy.data.lights.new(name, "AREA")
        data.energy, data.shape, data.size, data.color = energy, "DISK", size, color
        obj = bpy.data.objects.new(name, data)
        scene.collection.objects.link(obj)
        obj.location = point(pos)
        obj.rotation_euler = (target - obj.location).to_track_quat("-Z", "Y").to_euler()
    data = bpy.data.cameras.new("Preview")
    cam = bpy.data.objects.new("Preview", data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    x, f, z = (-4.5, 5.5, 3.3)
    if mounted or machine:
        x, f, z = (-6.4, 4.0, 4.3)
    if kind == "sagitt":
        x, f = 6.3, 3.6
    cam.location = point((x, f, z))
    cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
    data.type = "ORTHO"
    data.ortho_scale = 4.10 if mounted else 3.32 if kind == "onager" else 2.38 if machine else (
        2.78 if kind in ("auxilia", "velites") else 2.43)
    if action.startswith("attack") and kind in ("velites", "auxilia", "equites"):
        data.ortho_scale += .23
    if scorpio_shot:
        data.ortho_scale = 3.02
    return scene


def preview(kind, elite, action, path):
    reset()
    if kind in MACHINES:
        rig = siege.stand(kind)
        siege.model(kind, rig)
        phase = .1333333333 / siege.DURATION[action] if action == "attack" else .19
        siege.machine_pose(rig, kind, action, phase)
    else:
        rig = armature("Human", rome.human_skeleton())
        rome.infantry(kind, elite, rig)
        phase = human_motion.HIT_TIME / human_motion.TIMING[action] if action.startswith("attack") else .19
        human_motion.human_pose(rig, rome.SETS[kind], action, phase)
        if kind == "equites":
            mount = armature("Horse", horse.horse_skeleton())
            horse.horse_mesh(mount)
            horse.horse_pose(mount, "idle", .19)
            bpy.context.view_layer.update()
            rig.rotation_mode = "QUATERNION"
            rig.location, rig.rotation_quaternion = rider_offset(mount)
    scene = scene_lighting(kind, action)
    path.parent.mkdir(parents=True, exist_ok=True)
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def horse_preview(previews, frames):
    reset()
    rig = armature("Horse", horse.horse_skeleton())
    horse.horse_mesh(rig)
    scene = scene_lighting("equites", "walk")
    scene.cycles.samples = 12
    scene.render.resolution_x = 720
    scene.render.resolution_y = 470
    camera = scene.camera
    camera.location = point((-6.7, .58, 1.86))
    camera.rotation_euler = (point((0, .10, .99)) - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera.data.ortho_scale = 4.0
    for gait in ("walk", "run"):
        path = previews / f"horse-{gait}"
        path.mkdir(parents=True, exist_ok=True)
        for frame in range(frames):
            horse.horse_pose(rig, gait, frame/frames)
            scene.render.filepath = str(path / f"{frame:03d}.png")
            bpy.ops.render.render(write_still=True)


def export_horse(output):
    reset()
    rig = armature("Horse", horse.horse_skeleton())
    mesh = horse.horse_mesh(rig)
    # 高频烘焙：蹄踵离地、蹄绕蹄尖翻起只有几十毫秒，关键帧稀了插值会把锁地的马蹄带进地面。
    bpy.context.scene.render.fps = 120
    horse.animate_horse(rig, mesh)
    export(output / "anims/horse.glb", step=1)


def update_horse_strides(manifest):
    for name in ("equites", "equites_e"):
        model = manifest["models"].get(name, {})
        if model.get("mount", {}).get("src") == HORSE_SRC:
            model["stride"] = horse.STRIDE


def generate(output, previews, preview_only, ids, horse_frames):
    manifest_path = output / "manifest.json"
    if not preview_only:
        manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {
            "version": 1, "libraries": {}, "models": {},
        }
        reset()
        rig = armature("Human", rome.human_skeleton())
        # 参考网格让加载器能用与兵种完全相同的导出路径读取蒙皮和骨名。
        ref = Mesh()
        ref.box((0, 0, .028), (.04, .04, .05), "Stone", "root")
        ref.build("Reference", rig)
        human_motion.animate_human(rig, rome.SETS.values())
        export(output / "anims/human.glb")
        export_horse(output)
        manifest["libraries"]["human"] = "units/anims/human.glb"
        for kind in ids:
            elite = kind.endswith("_e")
            base = kind.removesuffix("_e")
            reset()
            art = {"src": f"units/rome/{kind}.glb"}
            if base in MACHINES:
                rig = siege.stand(base)
                siege.model(base, rig)
                siege.animate(rig, base)
                spec = {"kind": "rig", **art, "stride": {"walk": 2.262 if base == "onager" else 1.759}}
            else:
                rig = armature("Human", rome.human_skeleton())
                rome.infantry(base, elite, rig)
                stance = rome.SETS[base]
                art.update(anims="human", set=stance)
                if base == "equites":
                    spec = {"kind": "mounted", "rider": art, "mount": {"src": HORSE_SRC},
                            "stride": horse.STRIDE}
                else:
                    spec = {"kind": "rig", **art, "stride": human_motion.STRIDE}
            export(output / f"rome/{kind}.glb")
            manifest["models"][kind] = spec
        update_horse_strides(manifest)
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    if previews:
        for kind in ids:
            actions = ("idle", "attack") if kind in MACHINES else ("idle", "attack", *human_motion.VARIANTS)
            for action in actions:
                preview(kind.removesuffix("_e"), kind.endswith("_e"), action, previews / f"{kind}-{action}.png")
        if horse_frames:
            horse_preview(previews, horse_frames)


def generate_mount(output):
    manifest_path = output / "manifest.json"
    manifest = None
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text())
        update_horse_strides(manifest)
    export_horse(output)
    if manifest is not None:
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")


def main():
    ids = (*rome.SETS, *(f"{name}_e" for name in rome.SETS), *MACHINES)
    parser = argparse.ArgumentParser(description="生成罗马试点的 GLB、清单与 Blender 预览")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--previews", type=Path)
    parser.add_argument("--preview-only", action="store_true")
    parser.add_argument("--horse-only", action="store_true",
                        help="只生成马并更新已有清单中的罗马骑兵步幅")
    parser.add_argument("--horse-frames", type=int, default=0,
                        help="每种马步态截取的帧数，需同时指定 --previews")
    parser.add_argument("--ids", nargs="+", choices=ids, default=ids)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    if (args.preview_only or args.horse_frames) and not args.previews:
        parser.error("--preview-only 和 --horse-frames 需要 --previews")
    if args.horse_frames < 0:
        parser.error("--horse-frames 需要非负的帧数")
    output = args.output.resolve()
    previews = args.previews.resolve() if args.previews else None
    if args.horse_only:
        if not args.preview_only:
            generate_mount(output)
        if previews:
            horse_preview(previews, args.horse_frames or 24)
    else:
        generate(output, previews, args.preview_only, args.ids, args.horse_frames)


if __name__ == "__main__":
    main()
