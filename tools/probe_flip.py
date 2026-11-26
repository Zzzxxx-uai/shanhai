# -*- coding: utf-8 -*-
"""无头验证仿实体书翻页：结构齐全、动画中间态正确、落定后干净、拖动可翻页。

用法： python tools/probe_flip.py [index.html | 山海舆图-先民观.html]
"""
import io, json, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.dirname(HERE)
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

PROBE = """
<pre id="RESULT" style="display:none">running</pre>
<script>
var LOG = [];
window.onerror = function (m, s, l) { LOG.push('ERR ' + m + ' @line ' + l); return true; };
window.addEventListener('error', function (e) {
  var t = e.target;
  if (t && (t.tagName === 'VIDEO' || t.tagName === 'IMG')) return;   // 视频打不开属预期
  LOG.push('RES_ERR ' + (t && (t.src || t.href)));
}, true);

function dump(o) {
  var el = document.getElementById('RESULT');
  el.textContent = 'RESULT ' + JSON.stringify(o, null, 1);
}
function num(id) { return document.getElementById(id).textContent; }
function opa(id) { return parseFloat(document.getElementById(id).style.opacity || '0'); }

window.addEventListener('load', function () {
  var o = {
    pages: (window.PAGES || []).length,
    flip: typeof window.Flip,
    els: {
      flip: !!document.getElementById('flip'),
      front: !!document.getElementById('flip-front'),
      back: !!document.getElementById('flip-back'),
      cast: !!document.getElementById('cast'),
      spine: !!document.getElementById('spine')
    },
    segParam: window.Flip && window.Flip._state ? window.Flip._state().seg : -1
  };

  setTimeout(function () {
    var f = document.getElementById('flip');
    o.startNum = num('page-num');

    // —— 点"下一页"，看翻页中途那张纸 ——
    document.getElementById('btn-next').click();
    setTimeout(function () {
      o.mid = {
        hidden: f.hidden,
        segFront: document.querySelectorAll('#flip-front .curl__seg').length,
        segBack: document.querySelectorAll('#flip-back .curl__seg').length,
        bodyCount: document.querySelectorAll('#flip-front .seg__body').length,
        hasPageInSeg: !!document.querySelector('#flip-front .seg__body .page'),
        flipRotate: f.style.transform,
        segRot: (document.querySelector('#flip-front .curl__seg') || {}).style
                ? document.querySelector('#flip-front .curl__seg').style.transform : '',
        spine: opa('spine'),
        cast: opa('cast'),
        book: document.getElementById('book').style.transform,
        mist: document.querySelectorAll('#spine .mist').length
      };
      setTimeout(function () {
        o.done = {
          hidden: f.hidden,
          num: num('page-num'),
          frontEmpty: document.getElementById('flip-front').innerHTML.length,
          backEmpty: document.getElementById('flip-back').innerHTML.length,
          cast: opa('cast'),
          book: document.getElementById('book').style.transform || '(none)',
          hasPage: !!document.querySelector('#page .page__title, #page .cover, #page .colophon')
        };

        // —— 按住纸往左拖，看能不能拖过去 ——
        var book = document.getElementById('book');
        function pe(type, x) {
          return new PointerEvent(type, {
            bubbles: true, cancelable: true, clientX: x, clientY: 300,
            pointerType: 'mouse', button: 0, buttons: type === 'pointerup' ? 0 : 1
          });
        }
        try {
          book.dispatchEvent(pe('pointerdown', 700));
          book.dispatchEvent(pe('pointermove', 640));
          book.dispatchEvent(pe('pointermove', 300));
          o.dragMid = { hidden: f.hidden, spine: opa('spine'), rotate: f.style.transform };
          book.dispatchEvent(pe('pointerup', 300));
        } catch (e) { LOG.push('drag ' + e.message); }

        setTimeout(function () {
          o.afterDrag = { num: num('page-num'), hidden: f.hidden };
          // 再往回翻一页
          document.getElementById('btn-prev').click();
          setTimeout(function () {
            o.afterPrev = { num: num('page-num'), hidden: f.hidden };
            o.errors = LOG;
            dump(o);
          }, 1600);
        }, 1600);
      }, 1600);
    }, 520);
  }, 400);
});
</script>
"""


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else 'index.html'
    src_path = os.path.join(BASE, src)
    html = io.open(src_path, encoding='utf-8').read()

    # 无头环境 rAF 不推进，开假时钟；?seg=5 强制 5 段（默认窄屏只给 3 段）
    tag = '<script src="assets/js/flip.js"></script>'
    if tag in html:
        html = html.replace(tag, '<script>window.__FLIP_TEST__=true;</script>\n' + tag)
    else:
        i = html.find('<script>')
        html = html[:i + 8] + '\nwindow.__FLIP_TEST__=true;' + html[i + 8:]
    html = html.replace('</body>', PROBE + '\n</body>')

    probe_file = os.path.join(BASE, '_probe.html')
    io.open(probe_file, 'w', encoding='utf-8').write(html)

    out = subprocess.run(
        [EDGE, '--headless=new', '--disable-gpu', '--mute-audio',
         '--autoplay-policy=no-user-gesture-required',
         '--window-size=1280,800',
         '--virtual-time-budget=30000', '--dump-dom',
         'file:///' + probe_file.replace('\\', '/') + '?intro=0&seg=5'],
        capture_output=True, text=True, encoding='utf-8', errors='replace'
    ).stdout

    m = re.search(r'<pre id="RESULT"[^>]*>RESULT (.*?)</pre>', out, re.S)
    os.remove(probe_file)
    if not m:
        print('[probe] 没拿到结果，原始输出片段：')
        print(out[:1500])
        return 1

    import html as H
    data = json.loads(H.unescape(m.group(1)))
    print('[probe]', os.path.basename(src_path))
    for k in ('pages', 'flip', 'els', 'segParam', 'startNum', 'mid', 'done',
              'dragMid', 'afterDrag', 'afterPrev', 'errors'):
        if k in data:
            print('  %-10s %s' % (k, data[k]))

    mid = data.get('mid', {})
    done = data.get('done', {})
    ok = (
        data.get('pages') == 25
        and data.get('flip') == 'object'
        and all(data.get('els', {}).values())
        and mid.get('hidden') is False
        and mid.get('segFront') == 5 and mid.get('segBack') == 5
        and mid.get('bodyCount') == 5
        and mid.get('hasPageInSeg')
        and 'rotateY' in (mid.get('segRot') or '')
        and mid.get('spine', 0) > 0.12
        and mid.get('cast', 0) > 0
        and 'scale' in (mid.get('book') or '')
        and mid.get('mist', 0) >= 1
        and done.get('hidden') is True
        and done.get('num') == '2 / 25'
        and done.get('frontEmpty') == 0 and done.get('backEmpty') == 0
        and done.get('cast') == 0
        and done.get('hasPage')
        and data.get('afterDrag', {}).get('num') == '3 / 25'
        and data.get('afterPrev', {}).get('num') == '2 / 25'
        and not data.get('errors')
    )
    print('  ==> ', 'PASS' if ok else 'FAIL')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
