# -*- coding: utf-8 -*-
"""把翻页停在中途（?freeze=），截几张静态帧，用来肉眼检查纸张形态。

用法： python tools/shot_flip.py
产物： _shot_025.png / _shot_05.png / _shot_075.png（工程根目录下，用完可删）
"""
import io, os, subprocess, sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

INJECT = """
<script>
window.addEventListener('load', function () {
  setTimeout(function () {
    try { document.getElementById('btn-next').click(); } catch (e) {}
  }, 200);
});
</script>
"""


def main():
    html = io.open(os.path.join(BASE, 'index.html'), encoding='utf-8').read()
    html = html.replace('</body>', INJECT + '\n</body>')
    shot = os.path.join(BASE, '_shot.html')
    io.open(shot, 'w', encoding='utf-8').write(html)

    url = 'file:///' + shot.replace(chr(92), '/')
    for fz, name in (('0.25', '_shot_025.png'), ('0.5', '_shot_05.png'), ('0.75', '_shot_075.png')):
        out = os.path.join(BASE, name)
        subprocess.run([EDGE, '--headless=new', '--disable-gpu', '--mute-audio',
                        '--hide-scrollbars', '--window-size=1440,900',
                        '--virtual-time-budget=8000', '--screenshot=' + out,
                        url + '?intro=0&freeze=' + fz],
                       capture_output=True)
        print(fz, '->', out, ('%.0f KB' % (os.path.getsize(out) / 1024)) if os.path.exists(out) else 'MISS')
    return 0


if __name__ == '__main__':
    sys.exit(main())
