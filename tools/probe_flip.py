# -*- coding: utf-8 -*-
"""翻页交互探针：跑一遍按钮/连点/边界/拖动，把结果写进 document.title。

用法： python tools/probe_flip.py
依赖： Edge（无头）。无头下 rAF 不执行，全部用嵌套 setTimeout 推进。
"""
import os, re, subprocess, sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

PROBE = r"""
<script>
(function () {
  var log = [], t = 0;
  function say(s) { log.push(s); document.title = 'PROBE ' + log.join(' | '); }
  function later(fn, ms) { t += ms; setTimeout(fn, t); }
  function num() { return document.getElementById('page-num').textContent.replace(/\s/g, ''); }
  function body() { return document.getElementById('page').textContent; }
  function flipHidden() { return document.getElementById('flip').hidden; }
  function ptr(type, x, y, id) {
    var b = document.getElementById('book');
    b.dispatchEvent(new PointerEvent(type, {
      pointerId: id || 1, pointerType: 'touch', isPrimary: true,
      clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1,
      bubbles: true, cancelable: true
    }));
  }
  var NEXT = document.getElementById('btn-next');
  var PREV = document.getElementById('btn-prev');

  later(function () {
    try { localStorage.removeItem('shanhai-page'); } catch (e) {}
    say('start=' + num() + ' flipHidden=' + flipHidden());
    NEXT.click();
    later(function () {
      say('afterNext=' + num() + ' hasP2=' + /刻在石头上的记忆/.test(body()) + ' flipHidden=' + flipHidden());

      NEXT.click(); NEXT.click();                 // 连点两下：合并成一页
      later(function () {
        say('burst=' + num());

        document.querySelectorAll('.dot')[0].click();
        later(function () {
          say('back0=' + num() + ' prevDisabled=' + PREV.disabled);
          PREV.click();
          later(function () {
            say('prevAt0=' + num());              // 应仍是 1 / 25

            var b = document.getElementById('book').getBoundingClientRect();
            var y = b.top + b.height / 2, x = b.left + b.width * 0.8;
            ptr('pointerdown', x, y);
            ptr('pointermove', x - 40, y + 6);
            ptr('pointermove', x - 220, y + 8);
            ptr('pointermove', x - 360, y + 8);
            ptr('pointerup', x - 360, y + 8);
            later(function () {
              say('afterSwipe=' + num() + ' flipHidden=' + flipHidden());

              document.querySelectorAll('.dot')[24].click();
              later(function () {
                say('last=' + num() + ' nextDisabled=' + NEXT.disabled);
                NEXT.click();
                later(function () {
                  say('nextAtLast=' + num());
                }, 600);
              }, 150);
            }, 700);
          }, 600);
        }, 250);
      }, 900);
    }, 700);
  }, 150);
})();
</script>
"""


def main():
    html = open(os.path.join(BASE, 'index.html'), encoding='utf-8').read()
    html = html.replace('</body>', PROBE + '</body>')
    tmp = os.path.join(BASE, '_probe.html')
    open(tmp, 'w', encoding='utf-8').write(html)
    url = 'file:///' + tmp.replace('\\', '/') + '?intro=0'
    p = subprocess.run([EDGE, '--headless=new', '--disable-gpu', '--mute-audio',
                        '--hide-scrollbars', '--window-size=1280,860',
                        '--virtual-time-budget=20000', '--dump-dom', url],
                       capture_output=True, timeout=180)
    dom = p.stdout.decode('utf-8', 'ignore')
    m = re.search(r'<title>(PROBE[^<]*)</title>', dom)
    if not m:
        print('NO RESULT')
        return 1
    for part in m.group(1)[6:].split('|'):
        print(part.strip())
    return 0


if __name__ == '__main__':
    sys.exit(main())
