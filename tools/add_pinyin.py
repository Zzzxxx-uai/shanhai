# -*- coding: utf-8 -*-
"""给 data.js 里每只异兽补 pinyin 字段（生僻字注音，供兽名旁显示）。"""
import io, os, re

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = os.path.join(BASE, 'assets', 'js', 'data.js')

PY = {
    '狌狌': 'xīng xīng', '鯥': 'lù', '旋龟': 'xuán guī',
    '鹿蜀': 'lù shǔ', '九尾狐': 'jiǔ wěi hú', '赤鱬': 'chì rú',
    '毕方': 'bì fāng', '陆吾': 'lù wú', '土蝼': 'tǔ lóu',
    '文鳐鱼': 'wén yáo yú', '西王母': 'xī wáng mǔ', '蛮蛮': 'mán mán',
    '朏朏': 'fěi fěi', '烛龙': 'zhú lóng', '夔': 'kuí'
}

s = io.open(P, encoding='utf-8').read()
n = 0
def sub(m):
    global n
    name = m.group(2)
    if name not in PY:
        print('!! 未收录读音:', name)
        return m.group(0)
    n += 1
    return "%sname: '%s',\n%spinyin: '%s'," % (m.group(1), name, m.group(1), PY[name])

s = re.sub(r"(\s*)name: '([^']+)',(?!\n\s*pinyin)", sub, s)
io.open(P, 'w', encoding='utf-8').write(s)
print('已补注音', n, '只')
