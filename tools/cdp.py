# -*- coding: utf-8 -*-
"""极简 CDP 客户端：给无头浏览器"按真实时间"跑脚本用。

为什么需要它：`--virtual-time-budget` 会把时间快进，音频解码、媒体加载这类
真正跑在别的线程/进程上的活儿来不及完成（表现就是 decodeAudioData 永远不回调），
所以涉及声音的验证必须让浏览器按真实时钟跑。这里用标准库直接连 DevTools 协议。

用法：
    b = Browser(url)
    b.wait(2.0)
    print(b.js('document.title'))
    b.close()
"""
import base64
import json
import os
import socket
import struct
import subprocess
import time
import urllib.request

EDGE = r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'


class WS:
    """只够用的一层 WebSocket（文本帧、无分片）。"""

    def __init__(self, url):
        # ws://127.0.0.1:port/path
        rest = url.split('://', 1)[1]
        hostport, path = rest.split('/', 1)
        host, port = hostport.split(':')
        self.sock = socket.create_connection((host, int(port)), timeout=30)
        key = base64.b64encode(os.urandom(16)).decode()
        req = ('GET /%s HTTP/1.1\r\nHost: %s:%s\r\nUpgrade: websocket\r\n'
               'Connection: Upgrade\r\nSec-WebSocket-Key: %s\r\n'
               'Sec-WebSocket-Version: 13\r\n\r\n') % (path, host, port, key)
        self.sock.sendall(req.encode())
        buf = b''
        while b'\r\n\r\n' not in buf:
            buf += self.sock.recv(4096)
        if b'101' not in buf.split(b'\r\n')[0]:
            raise RuntimeError('websocket handshake failed: %r' % buf[:120])
        self.buf = buf.split(b'\r\n\r\n', 1)[1]

    def _recv(self, n):
        while len(self.buf) < n:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise RuntimeError('socket closed')
            self.buf += chunk
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def send(self, text):
        data = text.encode()
        head = bytearray([0x81])
        n = len(data)
        if n < 126:
            head.append(0x80 | n)
        elif n < 65536:
            head.append(0x80 | 126)
            head += struct.pack('>H', n)
        else:
            head.append(0x80 | 127)
            head += struct.pack('>Q', n)
        mask = os.urandom(4)
        head += mask
        self.sock.sendall(bytes(head) + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))

    def recv(self):
        b1, b2 = self._recv(2)
        n = b2 & 0x7f
        if n == 126:
            n = struct.unpack('>H', self._recv(2))[0]
        elif n == 127:
            n = struct.unpack('>Q', self._recv(8))[0]
        return self._recv(n).decode('utf-8', 'ignore')

    def close(self):
        try:
            self.sock.close()
        except Exception:
            pass


class Browser:
    def __init__(self, url, width=1280, height=860, port=9333, extra=None,
                 profile=None):
        self.port = port
        args = [EDGE, '--headless=new', '--disable-gpu', '--mute-audio',
                '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required',
                '--force-device-scale-factor=1',
                '--window-size=%d,%d' % (width, height),
                '--remote-debugging-port=%d' % port,
                '--user-data-dir=' + (profile or os.path.join(
                    os.path.dirname(os.path.abspath(__file__)), '_cdp_profile'))]
        args += (extra or [])
        args.append(url)
        self.proc = subprocess.Popen(args, stdout=subprocess.DEVNULL,
                                     stderr=subprocess.DEVNULL)
        ws_url = None
        for _ in range(120):
            try:
                with urllib.request.urlopen('http://127.0.0.1:%d/json/list' % port, timeout=1) as r:
                    tabs = json.loads(r.read().decode())
                for t in tabs:
                    if t.get('type') == 'page' and t.get('webSocketDebuggerUrl'):
                        ws_url = t['webSocketDebuggerUrl']
                        break
                if ws_url:
                    break
            except Exception:
                pass
            time.sleep(0.1)
        if not ws_url:
            self.proc.kill()
            raise RuntimeError('no devtools target')
        self.ws = WS(ws_url)
        self._id = 0

    def cmd(self, method, params=None):
        self._id += 1
        mid = self._id
        self.ws.send(json.dumps({'id': mid, 'method': method, 'params': params or {}}))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get('id') == mid:
                if 'error' in msg:
                    raise RuntimeError(msg['error'])
                return msg.get('result', {})

    def js(self, expr, await_promise=False):
        r = self.cmd('Runtime.evaluate', {'expression': expr, 'returnByValue': True,
                                          'awaitPromise': await_promise})
        res = r.get('result', {})
        if r.get('exceptionDetails'):
            return 'EXC: ' + json.dumps(r['exceptionDetails'].get('exception', {}))[:300]
        return res.get('value')

    def wait(self, sec):
        time.sleep(sec)

    def close(self):
        try:
            self.cmd('Browser.close')
        except Exception:
            pass
        try:
            self.ws.close()
        except Exception:
            pass
        try:
            self.proc.wait(timeout=5)
        except Exception:
            self.proc.kill()
