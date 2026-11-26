# -*- coding: utf-8 -*-
"""逐页翻一遍，抓「翻页动画第 0 帧」的图片状态。

复现用户说的"翻页后图片空白"：纸上那一面是把页面 innerHTML 重新塞进
新容器得到的 —— 那是新建的 <img> 节点，图没下完就是一块空的。

用真实时钟 + 4G 限速，点一次下一页，然后每 20ms 采一次样，
把「页码翻过去的那一刻」纸上/底页的就绪情况定下来。

用法： python tools/probe_img.py [--pace=3.0] [--fast]
       --pace  每次翻页的间隔秒数（默认 0.9，模拟快速连翻）
       --fast  不限速（本地磁盘）
"""
import functools
import http.server
import json
import os
import socketserver
import sys
import threading

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp import Browser

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 点下一页 → 每 20ms 采样 → 700ms 后返回时间线
SAMPLE = r"""
(function () {
  var b = document.getElementById('btn-next');
  if (!b || b.disabled) return Promise.resolve('END');
  var rec = [], t0 = performance.now();
  b.click();
  return new Promise(function (res) {
    var iv = setInterval(function () {
      var fp = document.querySelector('#flip-front img');
      var im = document.querySelector('#page img');
      var n = (document.getElementById('page-num').textContent || '').split('/')[0].trim();
      rec.push([Math.round(performance.now() - t0), +n,
                fp ? (fp.complete && fp.naturalWidth ? 1 : 0) : -1,
                im ? (im.complete && im.naturalWidth ? 1 : 0) : -1]);
      if (performance.now() - t0 > 700) { clearInterval(iv); res(JSON.stringify(rec)); }
    }, 20);
  });
})()
"""


def serve():
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=BASE)
    socketserver.TCPServer.allow_reuse_address = True
    srv = socketserver.TCPServer(('127.0.0.1', 0), h)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, srv.server_address[1]


def main():
    fast = '--fast' in sys.argv
    pace, mbps = 0.9, 4.0
    for a in sys.argv:
        if a.startswith('--pace='):
            pace = float(a.split('=', 1)[1])
        if a.startswith('--mbps='):
            mbps = float(a.split('=', 1)[1])

    srv, port = serve()
    b = Browser('http://127.0.0.1:%d/index.html?intro=0' % port,
                width=500, height=900, port=9344)
    try:
        b.cmd('Network.enable')
        if not fast:
            b.cmd('Network.emulateNetworkConditions', {
                'offline': False, 'latency': 100,
                'downloadThroughput': mbps * 1024 * 1024 / 8,
                'uploadThroughput': 750 * 1024 / 8,
            })
        b.wait(3.0)

        rows, bad = [], []
        for _ in range(24):
            r = b.js(SAMPLE, await_promise=True)
            if r == 'END' or not r:
                break
            rec = json.loads(r)
            last = rec[-1]
            # 纸上第一次出现内容的那一帧 = 动画第 0 帧，用户此刻看到的画面
            start = next((x for x in rec if x[2] != -1), None)
            rows.append((last[1], start, last))
            # 只把「明确空白」(0) 记为问题；-1 = 这一面本来就没有图（考据页）
            if start and (start[2] == 0 or start[3] == 0):
                bad.append((start[1], '纸上' if start[2] == 0 else '', '底页' if start[3] == 0 else ''))
            b.wait(pace)

        print('%-4s %-10s %-16s %-16s' % ('页', '动画起帧', '起始帧·纸上/底页', '700ms 后·底页'))
        for n, s, l in rows:
            f = lambda v: '无' if v < 0 else ('就绪' if v else '空白')
            print('%-4s %-10s %-16s %-16s'
                  % (n, ('%dms' % s[0]) if s else '—',
                     ('%s / %s' % (f(s[2]), f(s[3]))) if s else '—',
                     f(l[3])))
        print('\n%d 页中，翻页起始帧存在空白的：%d 页' % (len(rows), len(bad)))
        for n, a, c in bad:
            print('   第 %s 页：%s' % (n, '、'.join(x for x in (a, c) if x) + '未就绪'))
    finally:
        b.close()
        srv.shutdown()


if __name__ == '__main__':
    main()
