# -*- coding: utf-8 -*-
"""翻页每帧开销度量（无头）。

用 __FLIP_TEST__ 假时钟手动驱动 Flip._apply()，统计：
  - 翻满一页 N 帧的 JS 总耗时 / 平均每帧 ms
  - 每帧往 DOM 写的 style 次数（MutationObserver 计数）——写越少，主线程越轻
"写次数"反映主线程 JS 成本；滤镜 / 阴影这类绘制成本靠 CSS 侧单独关照，不在本脚本度量范围。

用法： python tools/perf_flip.py [index.html]
"""
import io, json, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.dirname(HERE)
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

PROBE = """
<pre id="RESULT" style="display:none">running</pre>
<script>
var LOG = [];
window.onerror = function (m, s, l) { LOG.push('ERR ' + m + ' @' + l); return true; };
function dump(o) {
  o.errors = LOG;
  document.getElementById('RESULT').textContent = 'RESULT ' + JSON.stringify(o);
}
function now(){ return (window.performance && performance.now) ? performance.now() : Date.now(); }

window.addEventListener('load', function () {
  setTimeout(function () {
    var out = { seg: (window.Flip && Flip._state ? Flip._state().seg : -1) };
    var NF = 90;                      // 采样帧数：约一场翻页的密度
    try {
      document.getElementById('btn-next').click();   // prepare：铺纸后方可测 apply
    } catch (e) { LOG.push('CLICK ' + e.message); }
    setTimeout(function () {
      if (!window.Flip) { dump({ fatal: 'no Flip' }); return; }
      var s = Flip._state();
      out.busy = s.busy;

      // 数一数测期间往 #flip 子树里写了多少次 style，并按元素分类
      var writes = 0, by = { seg: 0, cast: 0, book: 0, spine: 0, other: 0 };
      function bucket(nd) {
        if (!nd || !nd.classList) return 'other';
        if (nd.classList.contains('curl__seg')) return 'seg';
        if (nd.id === 'cast') return 'cast';
        if (nd.id === 'book') return 'book';
        if (nd.id === 'spine') return 'spine';
        return 'other';
      }
      var obs = null;
      try {
        obs = new MutationObserver(function (recs) {
          for (var r = 0; r < recs.length; r++) { writes++; by[bucket(recs[r].target)]++; }
        });
        obs.observe(document.getElementById('flip').parentNode,
                    { attributes: true, subtree: true, attributeFilter: ['style'] });
      } catch (e) {}

      // 注意：无头虚拟时间下 performance.now 不走真实时间，耗时量不出来（恒为 0），
      // 因此以"每帧写了多少次 style"作为主线程成本的度量。
      for (var i = 0; i < NF; i++) Flip._apply(i / (NF - 1));

      // MutationObserver 是微任务，必须先让出再读，否则 disconnect 会把记录丢掉
      setTimeout(function () {
        obs.disconnect();
        out.frames = NF;
        out.styleWrites = writes;
        out.writesPerFrame = +(writes / NF).toFixed(1);
        out.byTarget = by;
        dump(out);
      }, 0);
    }, 900);
  }, 400);
});
</script>
"""


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else 'index.html'
    src_path = os.path.join(BASE, src)
    html = io.open(src_path, encoding='utf-8').read()

    tag = '<script src="assets/js/flip.js"></script>'
    if tag in html:
        html = html.replace(tag, '<script>window.__FLIP_TEST__=true;</script>\n' + tag)
    else:
        i = html.find('<script>')
        html = html[:i + 8] + '\nwindow.__FLIP_TEST__=true;' + html[i + 8:]
    html = html.replace('</body>', PROBE + '\n</body>')

    probe_file = os.path.join(BASE, '_perf.html')
    io.open(probe_file, 'w', encoding='utf-8').write(html)

    out = subprocess.run(
        [EDGE, '--headless=new', '--disable-gpu', '--mute-audio',
         '--autoplay-policy=no-user-gesture-required',
         '--window-size=1280,800', '--virtual-time-budget=20000', '--dump-dom',
         'file:///' + probe_file.replace('\\', '/') + '?intro=0&freeze=0.5'],
        capture_output=True, text=True, encoding='utf-8', errors='replace').stdout
    os.remove(probe_file)

    m = re.search(r'<pre id="RESULT"[^>]*>RESULT (.*?)</pre>', out, re.S)
    if not m:
        print('[perf] 没拿到结果，原始输出片段：')
        print(out[:1200])
        return 1
    import html as H
    d = json.loads(H.unescape(m.group(1)))
    print('[perf]', os.path.basename(src_path))
    for k in ('seg', 'frames', 'styleWrites', 'writesPerFrame', 'byTarget', 'errors'):
        if k in d:
            print('  %-14s %s' % (k, d[k]))
    return 0


if __name__ == '__main__':
    sys.exit(main())
