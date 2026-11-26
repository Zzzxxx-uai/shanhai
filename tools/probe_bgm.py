# -*- coding: utf-8 -*-
"""无头验证背景音乐模块：不报错、能落到合成音源、开关/ducking 可用。

用法： python tools/probe_bgm.py [index.html | 山海舆图-先民观.html]
"""
import io, json, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.dirname(HERE)
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

PROBE = """
<pre id="RESULT" style="display:none">running</pre>
<script>
var LOG = [];
window.onerror = function (m, s, l, c) { LOG.push('ERR ' + m + ' @line ' + l); return true; };
window.addEventListener('error', function (e) {
  if (e.target && e.target.tagName === 'AUDIO') return;   // bgm.mp3 404 属预期
  LOG.push('RES_ERR ' + (e.target && (e.target.src || e.target.href)));
}, true);

function dump(o) {
  var el = document.getElementById('RESULT');
  el.textContent = 'RESULT ' + JSON.stringify(o, null, 1);
}

window.addEventListener('load', function () {
  var o = { pages: (window.PAGES || []).length,
            bgmDefined: typeof window.BGM,
            enabled: window.BGM && window.BGM.isEnabled(),
            sourceBefore: window.BGM && window.BGM.source(),
            hasBox: !!document.getElementById('set-bgm'),
            hasVol: !!document.getElementById('set-bgmvol') };

  // 模拟一次用户交互，触发 autoplay unlock
  try {
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  } catch (e) { LOG.push('pointer ' + e.message); }

  setTimeout(function () {
    o.sourceAfter = window.BGM && window.BGM.source();

    // ducking 不应抛错
    try {
      window.BGM.duck(true);
      o.afterDuckVol = window.BGM.getVolume();
      window.BGM.duck(false);
      window.BGM.setVolume(0.55);
      o.volSet = window.BGM.getVolume();
    } catch (e) { LOG.push('duck ' + e.message); }

    // 关掉再打开
    try {
      window.BGM.setEnabled(false);
      o.offOK = window.BGM.isEnabled() === false;
      window.BGM.setEnabled(true);
      o.onOK = window.BGM.isEnabled() === true;
    } catch (e) { LOG.push('toggle ' + e.message); }

    // 8 秒后看合成器实际演奏了哪些音
    setTimeout(function () {
      var notes = (window.__BGM_LOG__ || []).map(function (x) { return x[0]; });
      var amps = (window.__BGM_LOG__ || []).map(function (x) { return x[1]; });
      o.noteCount = notes.length;
      o.noteSample = notes.slice(0, 12);
      o.ampRange = amps.length ? [Math.min.apply(null, amps), Math.max.apply(null, amps)] : null;
      o.pagesOK = (window.PAGES || []).length === 25;
      o.errors = LOG;
      dump(o);
    }, 9000);
  }, 1500);
});
</script>
"""


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else 'index.html'
    src_path = os.path.join(BASE, src)
    html = io.open(src_path, encoding='utf-8').read()
    # 必须在 bgm.js 之前打开调试开关，才能拿到每颗音符的音高
    dbg = '<script>window.__BGM_DEBUG__=true;</script>\n<script src="assets/js/bgm.js"></script>'
    if ('<script src="assets/js/bgm.js"></script>' in html
            and html.replace('<script src="assets/js/bgm.js"></script>', dbg)):
        html = html.replace('<script src="assets/js/bgm.js"></script>', dbg)
    else:
        # 单文件版：所有 JS 已内联，在最前面那个内联块头部插入开关
        i = html.find('<script>')
        if i >= 0:
            j = i + len('<script>')
            html = html[:j] + '\nwindow.__BGM_DEBUG__=true;' + html[j:]
    html = html.replace('</body>', PROBE + '\n</body>')
    probe_file = os.path.join(BASE, '_probe.html')
    io.open(probe_file, 'w', encoding='utf-8').write(html)

    out = subprocess.run(
        [EDGE, '--headless=new', '--disable-gpu', '--mute-audio',
         '--autoplay-policy=no-user-gesture-required',
         '--virtual-time-budget=20000', '--dump-dom',
         'file:///' + probe_file.replace('\\', '/')],
        capture_output=True, text=True, encoding='utf-8', errors='replace'
    ).stdout

    m = re.search(r'<pre id="RESULT"[^>]*>RESULT (.*?)</pre>', out, re.S)
    os.remove(probe_file)
    if not m:
        print('[probe] 没拿到结果，原始输出片段：')
        print(out[:1200])
        return 1
    import html as H
    data = json.loads(H.unescape(m.group(1)))
    print('[probe]', os.path.basename(src_path))
    for k in ('pages', 'pagesOK', 'bgmDefined', 'enabled', 'hasBox', 'hasVol',
              'sourceBefore', 'sourceAfter', 'noteCount', 'noteSample', 'ampRange',
              'afterDuckVol', 'volSet', 'offOK', 'onOK'):
        if k in data:
            print('  %-14s %s' % (k, data[k]))

    # 校验：演奏的音必须全部落在 D 宫五声音阶上
    penta = set()
    for octv in range(3):
        for semi in (0, 2, 4, 7, 9):
            penta.add(round(440 * 2 ** ((62 - 12 + octv * 12 + semi - 69) / 12)))
    played = data.get('noteSample', [])
    off_scale = [n for n in played
                 if not any(abs(n - f) <= 2 for f in penta)]
    print('  offScale       ', off_scale or 'none')

    errs = [e for e in data.get('errors', []) if 'bgm' not in e.lower()]
    print('  errors         ', errs or 'none')
    # 注意：无头环境 AudioContext.currentTime 不推进，调度器只能排出开头 1.2 秒的音，
    # 音符数不代表真实密度（真实浏览器约每 0.6~2.5 秒一颗）。这里只验「能出声且音高正确」。
    ok = (data.get('bgmDefined') == 'object' and not errs
          and data.get('hasBox') and data.get('hasVol')
          and data.get('pages') == 25 and data.get('sourceAfter') == 'synth'
          and data.get('noteCount', 0) >= 1 and not off_scale
          and data.get('offOK') and data.get('onOK'))
    print('  ==> ', 'PASS' if ok else 'FAIL')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
