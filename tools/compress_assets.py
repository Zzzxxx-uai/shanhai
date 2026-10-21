# -*- coding: utf-8 -*-
"""
把生成的 PNG 素材压缩成适合 H5 加载的体积。
- 舆图长卷：水平镜像拼接后 repeat-x 平铺，接缝对称、看不出断点
- 异兽白描：缩到 640 方图
- 启卷首页：缩到 1400 宽
"""
import os
from PIL import Image

ROOT = r"C:\Users\zhouy\WorkBuddy\2026-10-21-19-54-18"
SRC = os.path.join(ROOT, "assets", "images")
DST = os.path.join(ROOT, "shanhai", "assets", "img")
os.makedirs(DST, exist_ok=True)


def jpg(img, path, q):
    img.convert("RGB").save(path, "JPEG", quality=q, optimize=True, progressive=True)
    print(f"{os.path.basename(path):26s} {img.size[0]}x{img.size[1]}  {os.path.getsize(path)//1024} KB")


# 1) 舆图长卷 —— 镜像平铺版
im = Image.open(os.path.join(SRC, "01-yutu-changjuan.png"))
im = im.resize((1536, 1024), Image.LANCZOS)
mirror = im.transpose(Image.FLIP_LEFT_RIGHT)
long = Image.new("RGB", (3072, 1024))
long.paste(im, (0, 0))
long.paste(mirror, (1536, 0))
jpg(long, os.path.join(DST, "scroll-long.jpg"), 84)

# 2) 首页古本启卷
im = Image.open(os.path.join(SRC, "02-guben-qijuan.png"))
w, h = im.size
im = im.resize((1400, int(h * 1400 / w)), Image.LANCZOS)
jpg(im, os.path.join(DST, "cover-scroll.jpg"), 84)

# 3) 五只异兽白描
beasts = {
    "04-beast-wenyaoyu.png": "beast-wenyaoyu.jpg",
    "05-beast-xingxing.png": "beast-xingxing.jpg",
    "06-beast-lushu.png":    "beast-lushu.jpg",
    "07-beast-bifang.png":   "beast-bifang.jpg",
    "08-beast-feifei.png":   "beast-feifei.jpg",
}
for src, out in beasts.items():
    im = Image.open(os.path.join(SRC, src)).resize((640, 640), Image.LANCZOS)
    jpg(im, os.path.join(DST, out), 88)

print("\n输出目录:", DST)
