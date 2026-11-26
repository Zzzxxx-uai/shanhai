# -*- coding: utf-8 -*-
"""列出本机浏览器可见的中文语音名（判断有没有「自然音色」可用）"""
import io, os, sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = io.open(os.path.join(BASE, 'index.html'), encoding='utf-8').read()

TEST = r"""
<script>
setTimeout(function(){
  var vs = (window.speechSynthesis ? speechSynthesis.getVoices() : []) || [];
  var zh = vs.filter(function(v){ return /^zh/i.test(v.lang || ''); });
  var lines = zh.map(function(v){ return v.name + ' | ' + v.lang; });
  var pre = document.createElement('pre');
  pre.id = 'RESULT';
  pre.textContent = '中文语音 ' + zh.length + ' / 全部 ' + vs.length + '\n' + lines.join('\n');
  document.body.appendChild(pre);
}, 3000);
</script>
"""

io.open(os.path.join(BASE, '_probe_v.html'), 'w', encoding='utf-8').write(
    src.replace('</body>', TEST + '\n</body>'))
print('ok')
