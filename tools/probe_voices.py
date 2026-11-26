# -*- coding: utf-8 -*-
"""列出浏览器可见的中文语音（用无头 Edge 跑一遍，结果写 UTF-8 文件）"""
import io, os

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, '_voices.html')

HTML = """<!doctype html><meta charset="utf-8"><pre id="R"></pre>
<script>
var out=[];
function dump(){
  var vs=window.speechSynthesis?speechSynthesis.getVoices():[];
  out=vs.map(function(v){return v.name+' | '+v.lang+' | local='+v.localService;});
  document.getElementById('R').textContent=out.join('\\n')+'\\n共'+out.length+'个';
}
dump();
setTimeout(dump,800);
setTimeout(dump,2000);
</script>"""

io.open(OUT, 'w', encoding='utf-8').write(HTML)
print(OUT)
