# -*- coding: utf-8 -*-
"""逐页截图，拼成总览图，用来肉眼核对每一页的图是否真的画出来了。

用法： python tools/shot_pages.py
产出： _preview/pages_all.png（25 格总览）、_preview/page_XX.png（单页）
"""
import base64
import functools
import http.server
import io
import os
import socketserver
import sys
import threading

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp import Browser

from PIL import Image

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, '_preview')


def serve():
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=BASE)
    socketserver.TCPServer.allow_reuse_address = True
    srv = socketserver.TCPServer(('127.0.0.1', 0), h)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, srv.server_address[1]


# 跳到第 i 页并等图就绪（最多 4s）
JUMP = r"""
(function (i) {
  var d = document.querySelectorAll('.dot')[i];
  if (d) d.click();
  return 1;
})(%d)
"""

STAT = r"""
(function () {
  var im = document.querySelector('#page img');
  return JSON.stringify({
    n: (document.getElementById('page-num').textContent || '').split('/')[0].trim(),
    has: !!im,
    ready: im ? !!(im.complete && im.naturalWidth) : null,
    w: im ? im.naturalWidth : 0,
    cls: im ? im.className : ''
  });
})()
"""


def main():
    os.makedirs(OUT, exist_ok=True)
    srv, port = serve()
    b = Browser('http://127.0.0.1:%d/index.html?intro=0' % port,
                width=500, height=900, port=9355)
    shots = []
    try:
        b.cmd('Page.enable')
        b.wait(2.5)
        for i in range(25):
            b.js(JUMP % i)
            # 等这一页的图就绪
            st = None
            for _ in range(40):
                b.wait(0.1)
                st = __import__('json').loads(b.js(STAT))
                if st['has'] is False or st['ready']:
                    break
            b.wait(0.35)                      # 等淡入走完
            data = b.cmd('Page.captureScreenshot', {'format': 'png'})['data']
            img = Image.open(io.BytesIO(base64.b64decode(data))).convert('RGB')
            p = os.path.join(OUT, 'page_%02d.png' % (i + 1))
            img.save(p)
            shots.append(img)
            print('%2d  %-6s img=%s ready=%s w=%s  %s'
                  % (i + 1, st['n'],
                     '有' if st['has'] else '无',
                     st['ready'], st['w'],
                     'OK' if (st['has'] is False or st['ready']) else '★ 未就绪'))
    finally:
        b.close()
        srv.shutdown()

    # 5 列总览
    tw, th = 220, 396
    cols = 5
    rows = (len(shots) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * (tw + 8) + 8, rows * (th + 8) + 8), '#2b2118')
    for k, im in enumerate(shots):
        t = im.resize((tw, th), Image.LANCZOS)
        sheet.paste(t, (8 + (k % cols) * (tw + 8), 8 + (k // cols) * (th + 8)))
    ap = os.path.join(OUT, 'pages_all.png')
    sheet.save(ap)
    print('\n总览：', ap, sheet.size)


if __name__ == '__main__':
    main()
