# -*- coding: utf-8 -*-
"""把 shanhai/ 打包成一个自包含的单文件 HTML（图片 base64 内嵌）。
用途：微信/邮件直接发给别人，对方双击即可打开，不依赖服务器与网址。
"""
import base64, io, os, re, zipfile

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_HTML = os.path.join(BASE, '山海舆图-先民观.html')
OUT_ZIP = os.path.join(BASE, '山海舆图-先民观.zip')

_cache = {}
def data_uri(rel):
    """rel 为相对 shanhai/ 的路径，如 assets/img/beast-luwu.jpg"""
    if rel in _cache:
        return _cache[rel]
    p = os.path.join(BASE, rel.replace('/', os.sep))
    if not os.path.exists(p):
        print('!! 缺少文件:', rel)
        return rel
    ext = os.path.splitext(p)[1].lower().lstrip('.')
    mime = {'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png',
            'webp': 'image/webp', 'svg': 'image/svg+xml'}.get(ext, 'image/jpeg')
    raw = open(p, 'rb').read()
    uri = 'data:%s;base64,%s' % (mime, base64.b64encode(raw).decode('ascii'))
    _cache[rel] = uri
    return uri

html = io.open(os.path.join(BASE, 'index.html'), encoding='utf-8').read()

# 1) CSS 内联
def css_sub(m):
    href = m.group(1)
    css = io.open(os.path.join(BASE, href.replace('/', os.sep)), encoding='utf-8').read()
    # 处理 CSS 内的 url(../img/xxx) —— 相对 css 文件所在目录 assets/css/
    def u(sub):
        rel_css = sub.group(1)
        abs_rel = os.path.normpath(os.path.join('assets/css', rel_css)).replace('\\', '/')
        return 'url("%s")' % data_uri(abs_rel)
    css = re.sub(r'url\(["\']?(?!data:)([^"\')]+)["\']?\)', u, css)
    return '<style>\n' + css + '\n</style>'
html = re.sub(r'<link rel="stylesheet" href="([^"]+)">', css_sub, html)

# 2) JS 内联
def js_sub(m):
    src = m.group(1)
    js = io.open(os.path.join(BASE, src.replace('/', os.sep)), encoding='utf-8').read()
    # JS 里的图片路径统一补成 data URI（data.js 的 img 字段形如 'assets/img/xxx.jpg'）
    def u(sub):
        return "'" + data_uri(sub.group(1)) + "'"
    js = re.sub(r"'(assets/img/[^']+)'", u, js)
    return '<script>\n' + js + '\n</script>'
html = re.sub(r'<script src="([^"]+)"></script>', js_sub, html)

# 3) HTML 里残留的 img src（本例没有，留个保险）
def img_sub(m):
    return 'src="' + data_uri(m.group(1)) + '"'
html = re.sub(r'src="(assets/img/[^"]+)"', img_sub, html)

io.open(OUT_HTML, 'w', encoding='utf-8').write(html)

# 4) 顺手打个 zip（保留原目录结构，解压后双击 index.html 也能跑）
with zipfile.ZipFile(OUT_ZIP, 'w', zipfile.ZIP_DEFLATED) as z:
    for root, dirs, files in os.walk(BASE):
        if 'tools' in root or '_probe' in root:
            continue
        for f in files:
            fp = os.path.join(root, f)
            if f.startswith('山海舆图') or f.startswith('_'):
                continue
            z.write(fp, os.path.relpath(fp, BASE))
            print('+', os.path.relpath(fp, BASE))

print('\n单文件:', OUT_HTML, '%.2f MB' % (os.path.getsize(OUT_HTML) / 1048576))
print('压缩包:', OUT_ZIP, '%.2f MB' % (os.path.getsize(OUT_ZIP) / 1048576))
