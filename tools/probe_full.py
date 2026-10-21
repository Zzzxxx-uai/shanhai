# -*- coding: utf-8 -*-
"""全流程冒烟：走遍 5 处 × 3 只 = 15 只异兽，验证收集进度、注音、结语回响。
用法：python tools/probe_full.py [源html]
"""
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
function mouse(type, x, y) {
  return new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y,
    pointerType: 'mouse', button: 0, buttons: 1, isPrimary: true });
}
function tap(el, jitter) {
  var r = el.getBoundingClientRect();
  var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  el.dispatchEvent(mouse('pointerdown', cx, cy));
  window.dispatchEvent(mouse('pointermove', cx + (jitter || 0), cy));
  window.dispatchEvent(mouse('pointerup', cx + (jitter || 0), cy));
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true,
    clientX: cx + (jitter || 0), clientY: cy }));
}

var i = 0, k = 0, seen = [];
function stepPlace() {
  var nodes = document.querySelectorAll('.node');
  if (i >= nodes.length) { finish(); return; }
  tap(nodes[i], 1);
  setTimeout(stepBeast, 260);
}
function stepBeast() {
  var cards = document.querySelectorAll('.beast-card');
  if (k >= cards.length) {
    out('境' + (i + 1) + ' 已识标记=' + document.querySelectorAll('.beast-card.is-read').length + '/' + cards.length);
    var next = document.getElementById('kc-next');
    k = 0; i++;
    if (i < document.querySelectorAll('.node').length) { tap(next, 0); setTimeout(stepBeast, 300); }
    else { document.querySelector('.modal__close').click(); setTimeout(finish, 300); }
    return;
  }
  tap(cards[k], 0);
  setTimeout(function () {
    seen.push(document.getElementById('kc-beast-name').textContent +
      '(' + document.getElementById('kc-beast-py').textContent + ')');
    var back = document.getElementById('beast-back');
    k++;
    tap(back, 0);
    setTimeout(stepBeast, 240);
  }, 260);
}
function finish() {
  var stat = document.getElementById('stat-count');
  out('收集徽标=' + stat.textContent + ' is-full=' + stat.classList.contains('is-full'));
  out('进度条is-full=' + document.querySelector('.map-foot__progress').classList.contains('is-full'));
  out('已识兽=' + seen.length + ': ' + seen.join(' '));
  document.querySelector('[data-goto="ending"]').click();
  setTimeout(function () {
    var met = document.getElementById('ed-met');
    out('结语is-full=' + met.classList.contains('is-full'));
    out('结语num=' + (met.querySelector('.ed-met__num') || {}).textContent);
    out('结语done=' + !!met.querySelector('.ed-met__done'));
    out('结语列表字数=' + (met.querySelector('.ed-met__list') || {}).textContent.length);
    out('DONE');
  }, 600);
}
setTimeout(function () {
  document.getElementById('btn-open').click();
  setTimeout(stepPlace, 1400);
}, 400);
</script>
"""

io.open(os.path.join(BASE, '_probe.html'), 'w', encoding='utf-8').write(
    src.replace('</body>', probe + '\n</body>'))
print('written')
