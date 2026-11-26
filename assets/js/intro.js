/* ===========================================================
 * 开场：先用一段"展卷"短片把书翻开，再淡入绘本本体
 * 视频缺席 / 打不开 / 用户点跳过 / ?intro=0 都会直接进绘本，绝不卡住
 * =========================================================== */
(function () {
  'use strict';

  var box = document.getElementById('intro');
  var v = document.getElementById('intro-video');
  var skip = document.getElementById('intro-skip');

  function done() {
    if (window.__introDone) return;
    window.__introDone = true;
    try { sessionStorage.setItem('shanhai-intro', '1'); } catch (e) {}
    if (box) {
      box.classList.add('is-out');
      setTimeout(function () { box.hidden = true; if (v) { try { v.pause(); } catch (e) {} } }, 900);
    }
    try { document.body.classList.add('is-entered'); } catch (e) {}
    document.dispatchEvent(new CustomEvent('intro:done'));
  }

  function bye() {   // 不播了，直接进
    if (box) box.hidden = true;
    done();
  }

  var src = v && v.getAttribute('data-src');
  var off = /[?&]intro=0/.test(location.search);
  var seen = false;
  try { seen = sessionStorage.getItem('shanhai-intro') === '1'; } catch (e) {}

  if (!box || !v || !src || off || seen) { bye(); return; }

  box.hidden = false;
  var hard = setTimeout(done, 9000);        // 兜底：最多 9 秒
  var stuck = setTimeout(done, 3200);       // 迟迟没开始播就直接进

  v.addEventListener('playing', function () { clearTimeout(stuck); });
  v.addEventListener('ended', done);
  v.addEventListener('error', done);
  if (skip) skip.addEventListener('click', done);
  // 点画面任意处也可跳过
  box.addEventListener('click', function (e) { if (e.target !== skip) done(); });

  v.src = src;
  v.muted = true;
  var pr = v.play();
  if (pr && pr.catch) pr.catch(function () { done(); });

  window.addEventListener('beforeunload', function () { clearTimeout(hard); clearTimeout(stuck); });
})();
