# -*- coding: utf-8 -*-
"""把 ImageGen 生成的中文长名 PNG 重命名、转 JPG、压缩为网页可用尺寸。"""
import os
import glob
from PIL import Image

IMG = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets", "img")

# 源文件名关键字 -> 目标文件名
MAP = [
    ("封面意境", "scene-cover.jpg"),
    ("崖壁", "scene-prologue.jpg"),
    ("少年", "scene-depart.jpg"),
    ("招摇山", "scene-zhaoyao.jpg"),
    ("青丘", "scene-qingqiu.jpg"),
    ("昆仑", "scene-kunlun.jpg"),
    ("西海", "scene-xihai.jpg"),
    ("大荒", "scene-dahuang.jpg"),
    ("尾声", "scene-epilogue.jpg"),
]

SIZE = (900, 900)

for kw, dst in MAP:
    hits = [p for p in glob.glob(os.path.join(IMG, "*.png")) if kw in os.path.basename(p)]
    if not hits:
        print("未找到：%s" % kw)
        continue
    src = hits[0]
    im = Image.open(src).convert("RGB")
    im.thumbnail(SIZE, Image.LANCZOS)
    out = os.path.join(IMG, dst)
    im.save(out, "JPEG", quality=82, optimize=True)
    os.remove(src)
    print("%-22s %dx%d  %.0f KB" % (dst, im.width, im.height, os.path.getsize(out) / 1024))
