# -*- coding: utf-8 -*-
"""把 tools/_genimg_dunhuang 里的敦煌重彩神兽图，映射到标准兽名并处理成正式 jpg。
1) 按文件名关键词映射到 beast-<name>
2) 裁掉右下角水印（AI 生成 / WORKBUDDY）
3) 缩放 640x640 -> assets/img/beast-<name>.jpg
"""
import os
import glob
from PIL import Image

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(BASE, 'tools', '_genimg_dunhuang')
DST = os.path.join(BASE, 'assets', 'img')

# 文件名关键词 -> 标准兽名
# 注意：长关键词须排在短关键词之前（「烛龙」优先于「巨龙」，否则会误映射）
KEYWORD_MAP = [
    ('烛龙', 'zhulong'),
    ('青色巨龙', 'qinglong'),
    ('白虎', 'baihu'),
    ('朱雀', 'zhuque'),
    ('玄武', 'xuanwu'),
    ('麒麟', 'qilin'),
    ('凤凰', 'fenghuang'),
    ('九尾狐', 'jiuweihu'),
    ('鲲鹏', 'kunpeng'),
    ('穷奇', 'qiongqi'),
    ('梼杌', 'taowu'),
    ('饕餮', 'taotie'),
    ('毕方', 'bifang'),
    ('獬豸', 'xiezhi'),
    ('貔貅', 'pixiu'),
]

# 右下角水印裁切比例（AI 生成 / WORKBUDDY 在右下角）
CROP_BOTTOM = 0.09
CROP_RIGHT = 0.06

OUT_SIZE = 640


def main():
    files = sorted(glob.glob(os.path.join(SRC, '*.png')))
    if not files:
        print('!! 目录里没有 png：', SRC)
        return

    mapped = {}
    for fp in files:
        name = os.path.basename(fp)
        for kw, beast in KEYWORD_MAP:
            if kw in name:
                mapped[beast] = fp
                break
        else:
            print('!! 未识别：', name)

    print('识别到 %d / %d 张' % (len(mapped), len(files)))
    for beast in sorted(mapped):
        fp = mapped[beast]
        im = Image.open(fp).convert('RGB')
        w, h = im.size
        im = im.crop((0, 0, int(w * (1 - CROP_RIGHT)), int(h * (1 - CROP_BOTTOM))))
        im = im.resize((OUT_SIZE, OUT_SIZE), Image.LANCZOS)
        out = os.path.join(DST, 'beast-' + beast + '.jpg')
        im.save(out, 'JPEG', quality=88, optimize=True, progressive=True)
        print('OK beast-%-12s %6.0f KB' % (beast + '.jpg', os.path.getsize(out) / 1024))


if __name__ == '__main__':
    main()
