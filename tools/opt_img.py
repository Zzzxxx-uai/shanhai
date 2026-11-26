# -*- coding: utf-8 -*-
"""把 assets/img 下的插画压到适合网页显示的规格。

原则：
  · 显示尺寸算过：桌面左图右文时图列宽约 440px、手机约 350px，
    场景图 840px（≈1.9x）、兽图 600px（≈1.4x）足够，再大是浪费带宽；
  · 统一 progressive + 4:2:0 + optimize，首字节到就能出轮廓，翻页时不会先白一片；
  · q80 —— 敦煌重彩细节密，再低会在石青石绿的渐变里出色块。

原图备份在 tools/_img_orig/（下划线目录，部署脚本与打包脚本都会跳过）。

用法： python tools/opt_img.py [--dry]
"""
import os
import shutil
import sys

from PIL import Image

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMGD = os.path.join(BASE, 'assets', 'img')
BAK = os.path.join(BASE, 'tools', '_img_orig')

SCENE = 840        # 场景图最长边
BEAST = 600        # 兽图最长边
Q = 80


def target(path):
    name = os.path.basename(path)
    return SCENE if name.startswith('scene-') else BEAST


def main():
    dry = '--dry' in sys.argv
    os.makedirs(BAK, exist_ok=True)

    before = after = 0
    for name in sorted(os.listdir(IMGD)):
        if not name.lower().endswith(('.jpg', '.jpeg')):
            continue
        p = os.path.join(IMGD, name)
        b0 = os.path.getsize(p)
        im = Image.open(p).convert('RGB')

        edge = target(p)
        if max(im.size) > edge:
            k = edge / float(max(im.size))
            im = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))),
                           Image.LANCZOS)

        tmp = p + '.tmp'
        im.save(tmp, 'JPEG', quality=Q, optimize=True, progressive=True, subsampling=2)
        b1 = os.path.getsize(tmp)

        before += b0
        after += b1
        print('%-26s %4dpx  %5.0fKB → %5.0fKB  (%+.0f%%)'
              % (name, max(im.size), b0 / 1024, b1 / 1024, (b1 - b0) * 100.0 / b0))

        if dry:
            os.remove(tmp)
        else:
            if not os.path.exists(os.path.join(BAK, name)):   # 只备份第一遍的原件
                shutil.copy2(p, os.path.join(BAK, name))
            os.replace(tmp, p)

    print('\n合计 %.2f MB → %.2f MB（省 %.0f%%）'
          % (before / 1048576, after / 1048576, (before - after) * 100.0 / before))


if __name__ == '__main__':
    main()
