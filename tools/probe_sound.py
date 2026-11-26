# -*- coding: utf-8 -*-
"""声音功能的检查（按真实时间跑，不走 virtual-time，因为音频解码需要真实时间）。

检查项：
  1. 预加载：页面加载后两个音频都已取到并解码
  2. 首次交互：上下文恢复、背景乐起播（总线有信号）
  3. 翻页声：点一次下一声、连点三下最多两声（不叠加）
  4. 静音：总线增益归零、翻页不再出声、localStorage 记住
  5. 刷新后沿用上次的开关
  6. file:// 下自动退回 <audio> 元素通道（离线压缩包场景）

用法：
  python tools/probe_sound.py
  python tools/probe_sound.py --file
"""
import http.server
import os
import shutil
import socketserver
import sys
import threading
import time

from cdp import Browser

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

TAP = """
document.dispatchEvent(new PointerEvent('pointerdown',
  { bubbles: true, cancelable: true, pointerType: 'mouse', isPrimary: true }));
"""

STATUS = "JSON.stringify(Object.assign(BookAudio.status(), BookAudio.level()))"


def serve():
    class H(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **kw):
            super().__init__(*a, directory=BASE, **kw)

        def log_message(self, *a):
            pass

    httpd = socketserver.TCPServer(('127.0.0.1', 0), H)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, httpd.server_address[1]


def show(tag, b):
    print('%-10s %s' % (tag, b.js(STATUS)))


def main():
    # 每次都用干净的浏览器配置，免得上一次留下的"声音开关"记忆干扰
    prof = os.path.join(BASE, 'tools', '_cdp_profile')
    if os.path.exists(prof):
        shutil.rmtree(prof, ignore_errors=True)
    use_file = '--file' in sys.argv
    if use_file:
        url = 'file:///' + os.path.join(BASE, 'index.html').replace('\\', '/') + '?intro=0'
        httpd = None
    else:
        httpd, port = serve()
        url = 'http://127.0.0.1:%d/index.html?intro=0' % port

    b = Browser(url)
    try:
        b.wait(2.0)
        show('加载 2s', b)

        b.js(TAP)
        b.wait(2.0)
        show('点击后', b)

        b.js("document.getElementById('btn-next').click()")
        b.wait(1.6)
        show('翻一页', b)

        b.js("""['btn-next','btn-next','btn-next'].forEach(function(id){
                  document.getElementById(id).click(); });""")
        b.wait(2.4)
        show('连点三下', b)

        # 翻页声的瞬时峰值：翻页后立刻量一次
        b.js("document.getElementById('btn-next').click()")
        b.wait(0.12)
        print('%-10s %s' % ('翻页瞬间', b.js(STATUS)))
        b.wait(1.4)

        b.js("document.getElementById('btn-sound').click()")
        b.wait(0.6)
        show('静音', b)
        b.js("document.getElementById('btn-next').click()")
        b.wait(0.9)
        show('静音翻页', b)

        b.js("document.getElementById('btn-sound').click()")
        b.wait(3.0)
        show('取消静音', b)

        b.js("location.reload()")
        b.wait(3.0)
        show('刷新后', b)
    finally:
        b.close()
        if httpd:
            httpd.shutdown()


if __name__ == '__main__':
    main()
