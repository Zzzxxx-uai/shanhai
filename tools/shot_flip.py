# -*- coding: utf-8 -*-
"""把翻页停在中途（?freeze=），截几张静态帧，用来肉眼检查纸张形态。

用法： python tools/shot_flip.py [宽 高]
产物： _shot_020.png / _shot_045.png / _shot_070.png（工程根目录下，用完可删）
"""
import os, subprocess, sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"


def main():
    w, h = (sys.argv[1], sys.argv[2]) if len(sys.argv) > 2 else ('1440', '900')
    url = 'file:///' + os.path.join(BASE, 'index.html').replace('\\', '/')
    for fz, name in (('0.15', '_shot_015.png'), ('0.35', '_shot_035.png'), ('0.6', '_shot_060.png')):
        out = os.path.join(BASE, name)
        subprocess.run([EDGE, '--headless=new', '--disable-gpu', '--mute-audio',
                        '--force-device-scale-factor=1',
                        '--hide-scrollbars', '--window-size=%s,%s' % (w, h),
                        '--virtual-time-budget=6000', '--screenshot=' + out,
                        url + '?intro=0&freeze=' + fz],
                       capture_output=True, timeout=120)
        print(fz, '->', name, ('%.0f KB' % (os.path.getsize(out) / 1024)) if os.path.exists(out) else 'MISS')
    return 0


if __name__ == '__main__':
    sys.exit(main())
