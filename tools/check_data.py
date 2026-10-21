# -*- coding: utf-8 -*-
"""校验 data.js：每只异兽的图片是否存在、nodes 引用的兽 key 是否都定义过。"""
import os
import re
import sys

sys.stdout.reconfigure(encoding='utf-8')

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SRC = os.path.join(ROOT, 'assets', 'js', 'data.js')
src = open(SRC, encoding='utf-8').read()

beasts = re.findall(r"(\w+):\s*\{\s*name:\s*'([^']+)',\s*img:\s*'([^']+)'", src)
print('共解析到 %d 只异兽' % len(beasts))

bad = 0
for key, name, img in beasts:
    ok = os.path.exists(os.path.join(ROOT, img))
    if not ok:
        bad += 1
    print('  %s %s %s' % (name.ljust(4), img.split('/')[-1].ljust(24),
                          'OK' if ok else '** 文件缺失 **'))

keys = set(k for k, _, _ in beasts)
missing = set()
for group in re.findall(r'beasts:\s*\[([^\]]+)\]', src):
    for k in re.findall(r"'(\w+)'", group):
        if k not in keys:
            missing.add(k)

print()
print('图片缺失: %d | 引用了未定义的兽: %s' % (bad, missing if missing else '无'))
print('结论:', '全部就绪' if bad == 0 and not missing else '有问题')
