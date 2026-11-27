"""战马的关节与骨架，体表和动作共用。坐标依次为横向、前向、高度（米），原点在四蹄中心的地面。"""

SIDE = {"L": 1, "R": -1}
PAIRS = ("fore", "hind")
LEGS = tuple((pair, side) for pair in PAIRS for side in SIDE)

# 骑手胯部的位置：鞍面以上约 9 厘米。
SADDLE = (0, .02, 1.61)
# 躯干的转动中心（胸廓骨的头）与腰荐关节（骨盆从这里向腹下收拢）。
CHEST = (0, .08, 1.16)
LUMBOSACRAL = (0, -.42, 1.38)
# 四肢各关节都在同一个矢状面里，体表的内外起伏由截面自己给。
LIMB_X = .155

# 侧视图里的关节（前向、高度），肩高 1.555 米。
# 前肢：肩胛的转动中心、肩关节、肘、腕、球节、蹄冠、蹄尖。
FORE = ((.495, 1.353), (.686, 1.048), (.520, .810), (.520, .440), (.520, .150), (.585, .058), (.678, 0))
# 后肢：髋、后膝、飞节、球节、蹄冠、蹄尖。
HIND = ((-.674, 1.167), (-.434, .860), (-.680, .545), (-.680, .155), (-.620, .062), (-.5295, 0))
JOINTS = {"fore": FORE, "hind": HIND}
BONES = {
    "fore": ("scapula", "humerus", "forearm", "fore_cannon", "fore_pastern", "fore_hoof"),
    "hind": ("thigh", "gaskin", "hind_cannon", "hind_pastern", "hind_hoof"),
}
PARENT = {"fore": "chest", "hind": "pelvis"}
# 蹄底后缘的前向位置；前缘（蹄尖）就是最后一个关节。
HEEL = {"fore": .536, "hind": -.6665}


def limb_bones(pair, side):
    return tuple(f"{name}.{side}" for name in BONES[pair])


def limb_joints(pair, side):
    return tuple((SIDE[side]*LIMB_X, f, z) for f, z in JOINTS[pair])


def horse_skeleton():
    bones = [
        ("root", None, (0, 0, 0), (0, 0, .24)),
        ("chest", "root", CHEST, (0, .46, 1.20)),
        ("loin", "chest", (0, -.12, 1.36), LUMBOSACRAL),
        ("pelvis", "loin", LUMBOSACRAL, (0, -.80, 1.28)),
        ("tail1", "pelvis", (0, -.850, 1.350), (0, -.935, 1.190)),
        ("tail2", "tail1", (0, -.935, 1.190), (0, -.962, .850)),
        ("tail3", "tail2", (0, -.962, .850), (0, -.950, .500)),
        ("neck1", "chest", (0, .62, 1.36), (0, .80, 1.52)),
        ("neck2", "neck1", (0, .80, 1.52), (0, .95, 1.67)),
        ("neck3", "neck2", (0, .95, 1.67), (0, 1.10, 1.83)),
        ("head", "neck3", (0, 1.10, 1.83), (0, 1.40, 1.50)),
        ("ear.L", "head", (.058, 1.175, 1.990), (.082, 1.205, 2.135)),
        ("ear.R", "head", (-.058, 1.175, 1.990), (-.082, 1.205, 2.135)),
        ("saddle", "chest", SADDLE, (0, SADDLE[1], SADDLE[2] + .14)),
    ]
    for pair, side in LEGS:
        names = limb_bones(pair, side)
        joints = limb_joints(pair, side)
        parents = (PARENT[pair], *names)
        bones.extend(zip(names, parents, joints, joints[1:]))
    return bones
