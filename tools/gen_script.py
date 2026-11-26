# -*- coding: utf-8 -*-
"""从 pages.js 生成录音稿：每页文稿、字数、参考时长、文件命名规范。

用法：
    python tools/gen_script.py
产出：
    录音稿.md（工程根目录，不进仓库也不影响打包）
"""
import io, json, os, subprocess, sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NODE = sys.executable  # 占位，真正的 node 在下面探测

CANDIDATES = [
    r'C:/Users/zhouy/.workbuddy/binaries/node/versions/22.22.2/node.exe',
    'node',
]


def load_pages():
    js = os.path.join(BASE, 'assets', 'js', 'pages.js').replace('\\', '/')
    snippet = ("global.window={};require('%s');"
               "process.stdout.write(JSON.stringify(window.PAGES));" % js)
    last = None
    for exe in CANDIDATES:
        try:
            out = subprocess.run([exe, '-e', snippet], capture_output=True)
            if out.returncode == 0 and out.stdout:
                return json.loads(out.stdout.decode('utf-8'))
            last = out.stderr.decode('utf-8', 'replace')[:300]
        except Exception as e:                     # noqa: BLE001
            last = str(e)
    sys.exit('读取 pages.js 失败：%s' % last)


def main():
    pages = load_pages()
    total_chars = 0
    lines = []
    lines.append('# 《山海舆图 · 先民观》录音稿\n')
    lines.append('> 录音要求：安静房间、离麦克风一拳距离、语速放慢半拍。')
    lines.append('> **每页单独录一个文件**，按页码命名（`01.mp3`、`02.mp3` … `%02d.mp3`），'
                 '录完放进工程目录下的 `录音/` 文件夹，我来合成进绘本。\n' % len(pages))
    lines.append('> 语速参考：约 4.2 字/秒。表中「参考时长」是念一遍的自然长度，'
                 '前后留半秒静音即可。\n')
    lines.append('| 页 | 类型 | 标题 | 字数 | 参考时长 | 文件名 |')
    lines.append('|---|---|---|---|---|---|')

    for i, p in enumerate(pages, 1):
        kind = {'cover': '封面', 'scene': '场景', 'beast': '异兽', 'colophon': '考据'}.get(p.get('kind'), p.get('kind'))
        title = p.get('name') or p.get('title') or ''
        say = p.get('say') or ''
        n = len(say)
        total_chars += n
        sec = n / 4.2 if n else 0
        lines.append('| %d | %s | %s | %d | %s | `%02d.mp3` |'
                     % (i, kind, title, n,
                        ('%.0f 秒' % sec) if n else '无需录音', i))

    lines.append('\n合计正文 %d 字，纯录音约 %.1f 分钟（含翻页停顿约 %.0f 分钟）。\n'
                 % (total_chars, total_chars / 4.2 / 60, total_chars / 4.2 / 60 * 1.25))

    lines.append('## 逐页文稿\n')
    for i, p in enumerate(pages, 1):
        title = p.get('name') or p.get('title') or ''
        py = p.get('py') or ''
        say = p.get('say') or ''
        head = '### %02d · %s%s' % (i, title, ('（%s）' % py) if py else '')
        lines.append(head)
        if p.get('place'):
            lines.append('*%s*' % p['place'])
        lines.append('')
        lines.append(say if say else '（此页无正文，不需要录音）')
        lines.append('')
        note = []
        if p.get('origin'):
            note.append('古籍白话转述（不朗读）：' + p['origin'])
        if p.get('zoology'):
            note.append('博物对照（不朗读）：' + p['zoology'])
        for nt in note:
            lines.append('> ' + nt + '\n')

    out = os.path.join(BASE, '录音稿.md')
    io.open(out, 'w', encoding='utf-8').write('\n'.join(lines))
    print('已生成:', out)
    print('共 %d 页，正文 %d 字，参考总时长 %.1f 分钟'
          % (len(pages), total_chars, total_chars / 4.2 / 60))


if __name__ == '__main__':
    main()
