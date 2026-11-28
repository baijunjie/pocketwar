"""生成中国阵营 GLB、专用动作库及 Blender 预览。"""

import argparse
import math
import sys
from pathlib import Path

import bpy

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))

import china
import china_motion
import china_siege
import human_motion
import rome
from generate import DEFAULT_OUTPUT, mount_rider, scene_lighting
from mesh import Mesh, armature, export, point, reset
from registry import cavalry_spec, read_manifest, write_manifest

IDS = (*china.IDS, *(kind+"_e" for kind in china.IDS))
LIBRARY = "units/anims/china.glb"


def build(model_id):
    base, elite = model_id.removesuffix("_e"), model_id.endswith("_e")
    if base in china.MACHINES:
        rig = china_siege.stand(base, elite)
        china_siege.model(base, elite, rig)
    else:
        rig = armature("Human", rome.human_skeleton())
        china.infantry(base, elite, rig)
    return base, rig


def own_library(base):
    """这个兵种的持械姿态在不在中国专用的动作库里；不在的沿用共用的人形动作库。"""
    return base not in china.MACHINES and china.SETS[base] in china_motion.ACTIONS


def generate(output, ids):
    manifest = read_manifest(output)
    if any(own_library(model_id.removesuffix("_e")) for model_id in ids):
        reset()
        rig = armature("Human", rome.human_skeleton())
        ref = Mesh()
        ref.box((0, 0, .028), (.04, .04, .05), "Stone", "root")
        ref.build("Reference", rig)
        china_motion.animate(rig)
        export(output / "anims/china.glb")
        manifest["libraries"]["china"] = LIBRARY
    for model_id in ids:
        reset()
        base, rig = build(model_id)
        art = {"src": f"units/china/{model_id}.glb"}
        if base in china.MACHINES:
            china_siege.animate(rig, base)
            radius = china_siege.wheels(base)[1]
            spec = {"kind": "rig", **art, "stride": {"walk": round(math.tau*radius, 3)}}
        else:
            art["set"] = china.SETS[base]
            art["anims"] = "china" if own_library(base) else "human"
            if base == "tieqi":
                spec = cavalry_spec(art, "china", model_id.endswith("_e"))
            else:
                spec = {"kind": "rig", **art, "stride": human_motion.STRIDE}
        export(output / f"china/{model_id}.glb")
        manifest["models"][model_id] = spec
    write_manifest(output, manifest)


def preview(model_id, action, output):
    reset()
    kind, rig = build(model_id)
    if kind in china.MACHINES:
        phase = human_motion.HIT_TIME / china_siege.DURATION[action] if action == "attack" else .19
        china_siege.pose(rig, kind, action, phase)
    else:
        stance = china.SETS[kind]
        phase = human_motion.HIT_TIME / human_motion.TIMING[action] if action.startswith("attack") else .19
        if stance in china_motion.ACTIONS:
            china_motion.held_pose(rig, stance, action, phase)
        else:
            human_motion.human_pose(rig, stance, action, phase, lancer=True)
        if kind == "tieqi":
            mount_rider(rig, "china_e" if model_id.endswith("_e") else "china", action, phase)
    camera_kind = {"tieqi": "equites", "pili": "onager", "huojian": "scorpio", "ji": "auxilia"}.get(kind, kind)
    scene = scene_lighting(camera_kind, action)
    if kind in ("pili", "huojian", "ji"):
        scene.camera.data.ortho_scale = {"pili": 4.48 if action == "attack" else 3.72, "huojian": 2.96, "ji": 3.14}[kind]
    if kind == "pili":
        scene.camera.rotation_euler = (point((0, 0, 1.37 if action == "attack" else 1.05))-scene.camera.location).to_track_quat("-Z", "Y").to_euler()
    output.mkdir(parents=True, exist_ok=True)
    scene.render.filepath = str(output / f"{model_id}-{action}.png")
    bpy.ops.render.render(write_still=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--previews", type=Path)
    parser.add_argument("--preview-only", action="store_true")
    parser.add_argument("--ids", nargs="+", choices=IDS, default=IDS)
    parser.add_argument("--actions", nargs="+", choices=("idle", "attack", *human_motion.VARIANTS, "die"),
                        default=("idle", "attack", *human_motion.VARIANTS))
    args = parser.parse_args(sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else [])
    if args.preview_only and not args.previews:
        parser.error("--preview-only 需要 --previews")
    if not args.preview_only:
        generate(args.output.resolve(), args.ids)
    if args.previews:
        for model_id in args.ids:
            for action in args.actions:
                if model_id.removesuffix("_e") not in china.MACHINES or action not in human_motion.VARIANTS:
                    preview(model_id, action, args.previews.resolve())


if __name__ == "__main__":
    main()
