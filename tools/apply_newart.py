# -*- coding: utf-8 -*-
"""把 tools/_genimg 里生成的 PNG 处理成正式 jpg：
1) 统一裁掉底部/右侧（去掉 AI 生成水印）
2) 缩放到目标尺寸：兽图 640x640，场景图 900x900
3) 输出 jpg（quality 88）到 assets/img/
"""
import os
from PIL import Image

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(BASE, 'tools', '_genimg')
DST = os.path.join(BASE, 'assets', 'img')

BEASTS = ['qinglong', 'fenghuang', 'qilin', 'baihu', 'xiezhi', 'pixiu',
          'xuanwu', 'zhulong', 'kunpeng', 'zhuque', 'bifang', 'jiuweihu',
          'qiongqi', 'taowu', 'taotie']
SCENES = ['cover', 'prologue', 'depart', 'dongfang', 'xifang', 'beifang',
          'nanfang', 'manhuang', 'epilogue']

CROP_BOTTOM = 0.09    # 裁掉底部 9%（AI 水印所在，宁可多裁）
CROP_RIGHT = 0.05


def process(name, out_size):
    p = os.path.join(SRC, name + '.png')
    if not os.path.exists(p):
        print('!! 缺文件', name)
        return
    im = Image.open(p).convert('RGB')
    w, h = im.size
    # 先裁掉带水印的底边与右边
    im = im.crop((0, 0, int(w * (1 - CROP_RIGHT)), int(h * (1 - CROP_BOTTOM))))
    im = im.resize((out_size, out_size), Image.LANCZOS)
    out = os.path.join(DST, name + '.jpg')
    im.save(out, 'JPEG', quality=88, optimize=True, progressive=True)
    print('OK %-22s %5dx%-5d %6.0f KB' % (name + '.jpg', out_size, out_size,
                                         os.path.getsize(out) / 1024))


for b in BEASTS:
    process('beast-' + b, 640)
for s in SCENES:
    process('scene-' + s, 900)
