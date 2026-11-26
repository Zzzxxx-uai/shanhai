# -*- coding: utf-8 -*-
"""绘本自检：封面 / 开卷 / 连续翻页 / 异兽页内容 / 图片加载 / 目录与进度点。
生成 _probe.html 后用无头 Edge --dump-dom 取结果。
注意：无头虚拟时间下 Promise 不推进，脚本一律用嵌套 setTimeout。"""
import io, os, sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(BASE, 'index.html')
src = io.open(SRC, encoding='utf-8').read()

TEST = r"""
<script>
window.__err = [];
window.onerror = function(m){ window.__err.push(m); };
var L = [];
function log(s){ L.push(s); live(); }
// 边跑边把日志刷进 RESULT 节点：中途卡死也能从 dump 里看到走到哪一步
function live(){
  var pre = document.getElementById('RESULT');
  if (!pre) { pre = document.createElement('pre'); pre.id = 'RESULT'; document.body.appendChild(pre); }
  pre.textContent = L.join('\\n');
}
function $(s){ return document.querySelector(s); }
function txt(s){ var e=$(s); return e ? e.textContent.replace(/\s+/g,' ').trim() : '(无)'; }

setTimeout(function(){
  try{
    log('PAGES: ' + (window.PAGES ? window.PAGES.length : '未加载'));
    log('封面标题: ' + txt('.cover__t'));
    log('封面副题: ' + txt('.cover__s'));
    log('开卷按钮: ' + (document.getElementById('btn-start') ? '有' : '无'));
    log('进度点/目录: ' + document.getElementById('dots').children.length + ' / ' + document.getElementById('toc').children.length);

    document.getElementById('btn-start').click();
    setTimeout(function(){
      log('开卷后页码: ' + txt('#page-num'));
      log('开卷后标题: ' + txt('.page__title'));

      // 翻到第一只异兽（第 5 页，索引 4）。
      // 用目录跳转（jump 直渲染、不走翻页动画）——无头下 rAF 不跑，
      // 仿实体书翻页永远停在 busy，等动画是等不到的；翻页引擎本身由 probe_flip 覆盖。
      var toc = document.getElementById('toc').children;
      toc[4].click();
      setTimeout(function(){
        log('异兽页码: ' + txt('#page-num'));
        log('异兽名+注音: ' + txt('.page__title'));
        log('属地: ' + txt('.page__place'));
        log('正文句数: ' + document.querySelectorAll('.sen').length);
        log('考据块数: ' + document.querySelectorAll('.note').length);
        log('非原文标注: ' + txt('.page__tag').slice(0, 20));
        var img = document.querySelector('.page__fig img');
        log('异兽图: ' + (img ? (img.getAttribute('src').split('/').pop()) : '无'));
        var pg = document.getElementById('page');
        log('境别标记: ' + pg.getAttribute('data-scene'));
        log('该境纸色: ' + getComputedStyle(pg).backgroundColor);
        log('插画调色: ' + (getComputedStyle(img).filter || '').slice(0, 46));

        // 图片实际是否加载成功
        var imgs = document.querySelectorAll('img');
        var ok = 0, bad = [];
        for (var k = 0; k < imgs.length; k++) {
          if (imgs[k].complete && imgs[k].naturalWidth > 0) ok++;
          else bad.push(imgs[k].getAttribute('src'));
        }
        log('图片加载: ' + ok + '/' + imgs.length + (bad.length ? ' 失败:' + bad.join(',') : ''));

        // 跳到末尾考据页
        var toc = document.getElementById('toc').children;
        toc[toc.length - 1].click();
        setTimeout(function(){
          log('末页页码: ' + txt('#page-num'));
          log('末页标题: ' + txt('.colophon__t'));
          log('考据条目: ' + document.querySelectorAll('.colo').length);
          log('朗读支持: ' + (window.speechSynthesis ? 'API存在' : 'API缺失'));
          log('中文语音数: ' + ((window.speechSynthesis && window.speechSynthesis.getVoices() || []).filter(function(v){return /^zh/i.test(v.lang);}).length));
          log('JS错误: ' + (window.__err.length ? window.__err.join(' | ') : '无'));
          var pre = document.createElement('pre');
          pre.id = 'RESULT';
          pre.textContent = L.join('\n');
          document.body.appendChild(pre);
        }, 500);
      }, 500);
    }, 500);
  } catch(e){
    var pre = document.createElement('pre');
    pre.id = 'RESULT';
    pre.textContent = 'EXCEPTION: ' + e.message + '\n' + L.join('\n');
    document.body.appendChild(pre);
  }
}, 800);
</script>
"""

out = src.replace('</body>', TEST + '\n</body>')
# 探针环境预处理（注到 <head>，先于业务脚本执行）：
# 1) 关自动朗读——无头下音频播放会冻结 virtual-time，探针永远跑不完；
# 2) 清掉存档页码——headless 沿用默认 profile 时 localStorage 会残留，导致不在封面起步。
if '<head>' in out:
    out = out.replace('<head>',
                      '<head><script>try{localStorage.setItem("shanhai-auto","0");'
                      'localStorage.removeItem("shanhai-page");}catch(e){}</script>', 1)
io.open(os.path.join(BASE, '_probe.html'), 'w', encoding='utf-8').write(out)
print('已生成 _probe.html')
