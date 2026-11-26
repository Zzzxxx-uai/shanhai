# -*- coding: utf-8 -*-
"""验证真人录音通道：注入一条测试音频映射 + 生成 5 秒 WAV，
检查点朗读后是否切到录音模式、句子高亮是否跟随、有无 JS 错误。
"""
import io, math, os, struct, sys, wave

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(BASE, 'index.html')
PAGE = 5   # 第 5 页是异兽「狌狌」，正文 4 句

# ---- 1) 造一段 5 秒 220Hz 正弦 WAV（无需 ffmpeg，纯标准库） ----
aud = os.path.join(BASE, 'assets', 'audio')
os.makedirs(aud, exist_ok=True)
wav_path = os.path.join(aud, '_test.wav')
sr = 8000
with wave.open(wav_path, 'w') as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(sr)
    frames = bytearray()
    for i in range(sr * 5):
        v = int(3000 * math.sin(2 * math.pi * 220 * i / sr))
        frames += struct.pack('<h', v)
    w.writeframes(bytes(frames))

src = io.open(SRC, encoding='utf-8').read()

# ---- 2) 在 story.js 之前注入映射（覆盖 audio-map.js 的空对象） ----
inject = ('<script>window.AUDIO={%d:"assets/audio/_test.wav"};</script>\n'
          % PAGE)
if '<script src="assets/js/story.js"></script>' not in src:
    sys.exit('未找到 story.js 引用，无法注入')
src = src.replace('<script src="assets/js/story.js"></script>',
                  inject + '<script src="assets/js/story.js"></script>', 1)

TEST = r"""
<script>
window.__err = [];
window.onerror = function(m){ window.__err.push(m); };
var L = [];
function log(s){ L.push(s); }
function $(s){ return document.querySelector(s); }
function txt(s){ var e=$(s); return e ? e.textContent.replace(/\s+/g,' ').trim() : '(无)'; }
function done(){
  var pre = document.createElement('pre');
  pre.id = 'RESULT'; pre.textContent = L.join('\n');
  document.body.appendChild(pre);
}
setTimeout(function(){
  try{
    log('AUDIO 映射: ' + JSON.stringify(window.AUDIO));
    document.getElementById('btn-start').click();
    setTimeout(function(){
      // 走到第 5 页（异兽页）
      for (var i = 0; i < 3; i++) document.getElementById('btn-next').click();
      setTimeout(function(){
        log('页码: ' + txt('#page-num'));
        log('句数: ' + document.querySelectorAll('.sen').length);
        document.getElementById('btn-say').click();
        setTimeout(function(){
          log('朗读按钮状态: ' + txt('#btn-say') + '（录音模式下应为「暂停」）');
          log('当前音频: ' + ((document.querySelectorAll('audio').length) ? 'audio 元素已创建' : '复用内部 Audio 对象'));
          log('高亮句数: ' + document.querySelectorAll('.sen.is-on').length);
          log('高亮文字: ' + (document.querySelector('.sen.is-on') ? document.querySelector('.sen.is-on').textContent.slice(0,14) : '(无)'));
          // 再点一次应暂停
          document.getElementById('btn-say').click();
          setTimeout(function(){
            log('暂停后按钮: ' + txt('#btn-say'));
            log('JS错误: ' + (window.__err.length ? window.__err.join(' | ') : '无'));
            done();
          }, 400);
        }, 1500);
      }, 400);
    }, 400);
  } catch(e){ log('EXCEPTION: ' + e.message); done(); }
}, 900);
</script>
"""

out = src.replace('</body>', TEST + '\n</body>')
io.open(os.path.join(BASE, '_probe_audio.html'), 'w', encoding='utf-8').write(out)
print('已生成 _probe_audio.html 与 assets/audio/_test.wav')
