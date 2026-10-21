# -*- coding: utf-8 -*-
"""把 raw/ 里 AI 生成的异兽 PNG 按兽名匹配、压缩成 640px JPG 存入 img/。

用法：改 MAP 后直接跑。已存在同名目标会被覆盖。
"""
import os
import glob
from PIL import Image

RAW = os.path.join(os.path.dirname(__file__), '..', 'assets', 'img', 'raw')
IMG = os.path.join(os.path.dirname(__file__), '..', 'assets', 'img')
RAW = os.path.abspath(RAW)
IMG = os.path.abspath(IMG)

# 文件名中出现的兽名关键字 -> 目标文件名（拼音，与 data.js 的 img 字段对应）
MAP = {
    '鯥':     'beast-lu',
    '旋龟':   'beast-xuangui',
    '九尾狐': 'beast-jiuweihu',
    '赤鱬':   'beast-chiru',
    '陆吾':   'beast-luwu',
    '土蝼':   'beast-tulou',
    '西王母': 'beast-xiwangmu',
    '蛮蛮':   'beast-manman',
    '烛龙':   'beast-zhulong',
    '夔':     'beast-kui',
}

SIZE = 640       # 与既有五张一致
QUALITY = 82


def main():
    files = sorted(glob.glob(os.path.join(RAW, '*.png')))
    used = set()
    for f in files:
        name = os.path.basename(f)
        target = None
        for key, out in MAP.items():
            if key in name and key not in used:
                target = out
                used.add(key)
                break
        if not target:
            print('  跳过（未匹配）:', name)
            continue
        im = Image.open(f).convert('RGB')
        im = im.resize((SIZE, SIZE), Image.LANCZOS)
        out = os.path.join(IMG, target + '.jpg')
        im.save(out, 'JPEG', quality=QUALITY, optimize=True)
        print('  %-24s %5dpx  %4dKB' % (target + '.jpg', SIZE,
                                        os.path.getsize(out) // 1024))

    missing = set(MAP.values()) - {os.path.splitext(os.path.basename(p))[0]
                                   for p in glob.glob(os.path.join(IMG, 'beast-*.jpg'))}
    if missing:
        print('!! 未生成的:', missing)
    else:
        print('全部 %d 只异兽图就绪' % len(MAP))


if __name__ == '__main__':
    main()
