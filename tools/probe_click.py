# -*- coding: utf-8 -*-
"""生成 _probe.html：模拟「真实鼠标」点击序列，验证节点点得开、神兽图能显示。"""
import io, os, sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(BASE, 'index.html')
src = io.open(SRC, encoding='utf-8').read()

probe = r"""
<script>
window.onerror = function (m, f, l) { out('JS_ERR: ' + m + ' @' + l); };
var R = [];
function out(s) { R.push(s); var d = document.getElementById('RESULT');
  if (!d) { d = document.createElement('pre'); d.id = 'RESULT'; document.body.appendChild(d); }
  d.textContent = R.join('\n'); }

function mouse(type, el, x, y) {
  return new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y,
    pointerType: 'mouse', button: 0, buttons: 1, isPrimary: true });
}
/* 完整鼠标点击：down -> 微动(手抖) -> up -> click */
function tap(el, jitter) {
  var r = el.getBoundingClientRect();
  var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  el.dispatchEvent(mouse('pointerdown', el, cx, cy));
  window.dispatchEvent(mouse('pointermove', el, cx + (jitter || 0), cy));
  window.dispatchEvent(mouse('pointerup', el, cx + (jitter || 0), cy));
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true,
    clientX: cx + (jitter || 0), clientY: cy }));
}
/* 拖拽：down -> 移动 60px -> up -> click（这一次 click 应被吃掉） */
function drag(el) {
  var r = el.getBoundingClientRect();
  var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  el.dispatchEvent(mouse('pointerdown', el, cx, cy));
  window.dispatchEvent(mouse('pointermove', el, cx - 60, cy));
  window.dispatchEvent(mouse('pointerup', el, cx - 60, cy));
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true,
    clientX: cx - 60, clientY: cy }));
}
function imgsOk(sel) {
  var a = document.querySelectorAll(sel), ok = 0, bad = [];
  for (var i = 0; i < a.length; i++) {
    if (a[i].complete && a[i].naturalWidth > 0) ok++; else bad.push(a[i].getAttribute('src'));
  }
  return ok + '/' + a.length + (bad.length ? ' MISS:' + bad.join(',') : '');
}

setTimeout(function () {
  document.getElementById('btn-open').click();
  setTimeout(function () {
    var nodes = document.querySelectorAll('.node');
    out('nodes=' + nodes.length);
    var n = nodes[2];
    out('tap-node=' + (n ? n.querySelector('.node__label').textContent : 'NONE'));
    tap(n, 1);                                   // 手抖 1px，仍应点开
    setTimeout(function () {
      var m = document.getElementById('modal');
      out('[1] modal-open=' + m.classList.contains('is-open'));
      out('[1] place=' + document.getElementById('modal-title').textContent);
      out('[1] beast-cards=' + document.querySelectorAll('.beast-card').length);
      out('[1] grid-img=' + imgsOk('.beast-card__frame img'));

      var card = document.querySelector('.beast-card');
      if (!card) { out('STOP: 无兽卡'); return; }
      tap(card, 0);
      setTimeout(function () {
        out('[2] beast-view=' + document.getElementById('view-beast').classList.contains('is-active'));
        out('[2] name=' + document.getElementById('kc-beast-name').textContent);
        out('[2] big-img=' + imgsOk('#kc-img'));
        out('[2] story-len=' + (document.getElementById('story-text').textContent || '').length);
        out('[2] layers=' + document.querySelectorAll('.kc-layer').length);
        var fw = document.querySelector('.kc-beast__frame');
        out('[2] frame-size=' + Math.round(fw.getBoundingClientRect().width) + 'x' + Math.round(fw.getBoundingClientRect().height));

        document.querySelector('.modal__close').click();     // 关掉
        setTimeout(function () {
          out('[3] closed=' + !document.getElementById('modal').classList.contains('is-open'));
          drag(nodes[2]);                                    // 拖动后不应误开
          setTimeout(function () {
            out('[4] drag-did-not-open=' + !document.getElementById('modal').classList.contains('is-open'));
            out('DONE');
          }, 200);
        }, 200);
      }, 400);
    }, 400);
  }, 1400);
}, 400);
</script>
"""

html = src.replace('</body>', probe + '\n</body>')
io.open(os.path.join(BASE, '_probe.html'), 'w', encoding='utf-8').write(html)
print('written')
