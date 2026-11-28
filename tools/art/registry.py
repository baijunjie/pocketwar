"""清单 manifest.json 里各阵营生成脚本共用的写法：读写、共用动作库的登记、骑兵条目。不依赖 Blender。"""

import json

from horse_gaits import STRIDE

HUMAN_LIBRARY, HUMAN_SRC = "human", "units/anims/human.glb"
HORSE_LIBRARY, HORSE_SRC = "horse", "units/anims/horse.glb"


def read_manifest(output):
    """读出清单，没有就新建。

    先登记各阵营共用的人形、马两个动作库：单独跑一个阵营的脚本时，它的条目引用的库在清单里也都有。
    两个库的文件由 generate.py 生成。
    """
    path = output / "manifest.json"
    manifest = json.loads(path.read_text()) if path.exists() else {"version": 1, "libraries": {}, "models": {}}
    manifest["libraries"][HUMAN_LIBRARY] = HUMAN_SRC
    manifest["libraries"][HORSE_LIBRARY] = HORSE_SRC
    return manifest


def write_manifest(output, manifest):
    (output / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")


def mount_spec(style):
    """清单里坐骑的写法：style 是 horse_tack.STYLES 里的名字，动作从马的动作库取。"""
    return {"src": f"units/horses/{style}.glb", "anims": HORSE_LIBRARY}


def cavalry_spec(rider, faction, elite):
    """骑兵的清单条目：骑手骑本阵营的马（高级形态骑披甲的），步幅跟着马的步态。"""
    return {"kind": "mounted", "rider": rider, "mount": mount_spec(faction + ("_e" if elite else "")), "stride": STRIDE}
