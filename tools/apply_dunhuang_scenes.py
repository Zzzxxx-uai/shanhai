# -*- coding: utf-8 -*-
"""把 tools/_genimg_dunhuang 里的敦煌重彩场景图，映射到标准场景名并处理成正式 jpg。
1) 按文件名关键词映射到 scene-<name>
2) 裁掉右下角水印（AI 生成 / WORKBUDDY）
3) 缩放 900x900 -> assets/img/scene-<name>.jpg
"""
import os
import glob
from PIL import Image

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(BASE, 'tools', '_genimg_dunhuang')
DST = os.path.join(BASE, 'assets', 'img')

# 文件名关键词 -> 标准场景名（长词优先）
KEYWORD_MAP = [
    ('封面', 'cover'),
    ('先民在崖壁前凿刻岩画', 'prologue'),
    ('执笔少年背着竹简', 'depart'),
    ('东方苍木之野', 'dongfang'),
    ('西方金风之丘', 'xifang'),
    ('北方玄水之泽', 'beifang'),
    ('南方丹火之山', 'nanfang'),
    ('蛮荒四凶之野', 'manhuang'),
    ('尾声先民观', 'epilogue'),
]

CROP_BOTTOM = 0.09
CROP_RIGHT = 0.06

OUT_SIZE = 900


def main():
    files = sorted(glob.glob(os.path.join(SRC, '*.png')))
    if not files:
        print('!! 目录里没有 png：', SRC)
        return

    mapped = {}
    for fp in files:
        name = os.path.basename(fp)
        for kw, scene in KEYWORD_MAP:
            if kw in name:
                mapped[scene] = fp
                break

    print('识别到 %d 个场景' % len(mapped))
    for scene in sorted(mapped):
        fp = mapped[scene]
        im = Image.open(fp).convert('RGB')
        w, h = im.size
        im = im.crop((0, 0, int(w * (1 - CROP_RIGHT)), int(h * (1 - CROP_BOTTOM))))
        im = im.resize((OUT_SIZE, OUT_SIZE), Image.LANCZOS)
        out = os.path.join(DST, 'scene-' + scene + '.jpg')
        im.save(out, 'JPEG', quality=88, optimize=True, progressive=True)
        print('OK scene-%-12s %6.0f KB' % (scene + '.jpg', os.path.getsize(out) / 1024))


if __name__ == '__main__':
    main()
