# -*- coding: utf-8 -*-
"""亮度/明快感的前后对比（肉眼之外的量化验证）。

把当前 story.css 里这一轮改过的颜色逐条回退成"改前"值，生成一份对照 CSS，
同一页各截一张图，用 Pillow 算平均亮度与平均饱和度。

用法： Anaconda python tools/cmp_bright.py
"""
import io, os, subprocess, sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

# 改后 -> 改前
UNDO = [
    ('--paper:#FDFAF1;', '--paper:#FAF5E9;'),
    ('--paper-2:#FFFFFC;', '--paper-2:#FFFDF8;'),
    ('--ink:#241C14;', '--ink:#2B2118;'),
    ('--ink-soft:#4E3F31;', '--ink-soft:#5A4B3C;'),
    ('--ink-faint:#87755F;', '--ink-faint:#8B7B69;'),
    ('--red:#B43527;', '--red:#9C2B21;'),
    ('--line:rgba(43,33,24,.12);', '--line:rgba(43,33,24,.14);'),
    ('--desk:#2E2519;', '--desk:#1E1813;'),
    ('radial-gradient(130% 100% at 50% 0%,#443728 0%,var(--desk) 58%,#221A12 100%)',
     'radial-gradient(120% 90% at 50% 0%,#2C241C 0%,var(--desk) 60%,#15100C 100%)'),
    ('box-shadow:0 16px 44px rgba(48,34,14,.36),0 2px 0 rgba(255,255,255,.1) inset;',
     'box-shadow:0 18px 50px rgba(0,0,0,.5),0 2px 0 rgba(255,255,255,.08) inset;'),
    ('background:linear-gradient(90deg,rgba(0,0,0,.11),rgba(0,0,0,0));',
     'background:linear-gradient(90deg,rgba(0,0,0,.16),rgba(0,0,0,0));'),
    ('background:linear-gradient(160deg,#FCF6E7,#FFFFFA);',
     'background:linear-gradient(160deg,#F3EBD8,#FAF5E9);'),
    ('filter:brightness(1.035) saturate(1.15) contrast(1.02) drop-shadow(0 6px 14px rgba(43,33,24,.13));',
     'filter:drop-shadow(0 6px 16px rgba(43,33,24,.18));'),
    ('background:radial-gradient(130% 100% at 50% 45%,rgba(0,0,0,0) 52%,rgba(8,6,4,.58) 100%);',
     'background:radial-gradient(120% 90% at 50% 45%,rgba(0,0,0,0) 45%,rgba(8,6,4,.72) 100%);'),
    ('background:rgba(180,53,39,.14);color:var(--ink);box-shadow:0 0 0 3px rgba(180,53,39,.14)',
     'background:rgba(156,43,33,.13);color:var(--ink);box-shadow:0 0 0 3px rgba(156,43,33,.13)'),
]

JUMP = """
<style>*{animation:none!important;transition:none!important}</style>   /* 关掉入场动画，避免截在半透明那一帧 */
<script>
window.addEventListener('load', function () {
  setTimeout(function () {
    try { document.getElementById('toc').children[4].click(); } catch (e) {}
  }, 150);
});
</script>
"""


def stats(path):
    """返回 (亮度, 相对饱和度, 绝对色度)：图区 / 全文区各一组。
    纸一提亮，"相对饱和度"必然下降，所以要同时看绝对色度 (max-min)/255。"""
    from PIL import Image
    im = Image.open(path).convert('RGB')
    w, h = im.size
    regions = {
        '图': (0.20, 0.22, 0.52, 0.76),      # 书页左半：插画
        '整页': (0.18, 0.20, 0.82, 0.78),    # 整幅书页
    }
    out = {}
    for name, (x0, y0, x1, y1) in regions.items():
        px = list(im.crop((int(w * x0), int(h * y0), int(w * x1), int(h * y1))).getdata())
        n = len(px)
        L = 0.0
        rel = 0.0
        chroma = 0.0
        cL = 0.0
        cC = 0.0
        cN = 0            # 只统计"有彩"的像素 = 画面里真正画的那些地方
        for r, g, b in px:
            L += 0.2126 * r + 0.7152 * g + 0.0722 * b
            mx, mn = max(r, g, b), min(r, g, b)
            ch = (mx - mn) / 255.0
            chroma += ch
            rel += 0 if mx == 0 else (mx - mn) / float(mx)
            if mx - mn > 20:
                cL += 0.2126 * r + 0.7152 * g + 0.0722 * b
                cC += ch
                cN += 1
        out[name] = (L / n, rel / n, chroma / n,
                     (cL / cN if cN else 0), (cC / cN if cN else 0), cN / float(n))
    return out


def main():
    css = io.open(os.path.join(BASE, 'assets', 'css', 'story.css'), encoding='utf-8').read()
    old_css = css
    miss = []
    for new, old in UNDO:
        if new in old_css:
            old_css = old_css.replace(new, old)
        else:
            miss.append(new[:48])
    if miss:
        print('!! 这些改动项在 CSS 里没找到（可能已经改过）:')
        for m in miss:
            print('   ', m)

    src = io.open(os.path.join(BASE, 'index.html'), encoding='utf-8').read()
    new_html = src.replace('</body>', JUMP + '\n</body>')
    old_html = new_html.replace('assets/css/story.css', 'assets/css/_cmp_old.css')

    io.open(os.path.join(BASE, 'assets', 'css', '_cmp_old.css'), 'w', encoding='utf-8').write(old_css)
    io.open(os.path.join(BASE, '_cmp_new.html'), 'w', encoding='utf-8').write(new_html)
    io.open(os.path.join(BASE, '_cmp_old.html'), 'w', encoding='utf-8').write(old_html)

    outs = {}
    for tag in ('old', 'new'):
        out = os.path.join(BASE, '_cmp_%s.png' % tag)
        subprocess.run([EDGE, '--headless=new', '--disable-gpu', '--mute-audio',
                        '--hide-scrollbars', '--window-size=1440,900',
                        '--virtual-time-budget=18000', '--screenshot=' + out,
                        'file:///' + os.path.join(BASE, '_cmp_%s.html' % tag).replace('\\', '/') + '?intro=0'],
                       capture_output=True)
        outs[tag] = out

    try:
        res = {}
        for tag in ('old', 'new'):
            res[tag] = stats(outs[tag])
    except ImportError:
        print('!! 没装 Pillow，跳过像素度量')
        return 1

    print('%-6s %-6s %9s %10s %10s %10s %9s' % ('', '区域', '亮度', '亮(有彩)', '相对饱和', '绝对色度', '色度(有彩)'))
    for name in ('图', '整页'):
        lo, so, co, cl0, cc0, _ = res['old'][name]
        ln, sn, cn, cl1, cc1, _ = res['new'][name]
        print('%-6s %-6s %9.2f %10.2f %10.4f %10.4f %9.4f' % ('改前', name, lo, cl0, so, co, cc0))
        print('%-6s %-6s %9.2f %10.2f %10.4f %10.4f %9.4f' % ('改后', name, ln, cl1, sn, cn, cc1))
        print('%-6s %-6s %+9.2f %+10.2f %+10.4f %+10.4f %+9.4f' % ('差值', name, ln - lo, cl1 - cl0, sn - so, cn - co, cc1 - cc0))
        print('-' * 68)

    # 收尾
    for p in ('assets/css/_cmp_old.css', '_cmp_new.html', '_cmp_old.html',
              '_cmp_new.png', '_cmp_old.png'):
        fp = os.path.join(BASE, *p.split('/')) if not p.startswith('_') else os.path.join(BASE, p)
        try:
            os.remove(fp)
        except OSError:
            pass
    return 0


if __name__ == '__main__':
    sys.exit(main())
