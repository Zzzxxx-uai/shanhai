/* ===========================================================
 * 《山海舆图 · 先民观》—— 仿实体书翻页引擎
 * -----------------------------------------------------------
 * 一张纸绕书脊（书页左缘）在 3D 空间里翻过去，露出下面那一页。
 * 位移只用 transform，明暗只用 opacity，全部落在合成层上：
 *   · 页面内容翻页前一次性铺好，动画期间不再读写 DOM 尺寸，不触发布局；
 *   · 位移交给 CSS transition（合成器跑，主线程抖动也不掉帧）；
 *   · 明暗（纸面反光、书脊阴影、微光）由一小段 rAF 跟随同一条缓动曲线，
 *     每帧只写 opacity，同样不重排。
 * 交互：边缘点击、键盘（由 story.js 转发）、左右拖动（鼠标与手指同一套
 *      Pointer 事件，横向判定后接手，纵向滚动照常交给浏览器）。
 * =========================================================== */
(function () {
  'use strict';

  var DUR = 380;                                    // 整页翻转时长（300–500ms 区间）
  var EASE = 'cubic-bezier(.42,0,.26,1)';           // 缓入缓出
  var GLOW = 0.12;                                  // 静止时书脊微光
  var DRAG_W = 0.72;                                // 拖到书宽的这个比例即算翻完

  var el = {}, cb = {};
  var dir = 1, busy = false, pending = 0, expectOk = true;
  var pCur = 0;                                     // 当前翻页进度 0–1
  var rafId = null, endTimer = 0, suppressUntil = 0;
  var st = null;                                    // 当前手势状态

  var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion:reduce)').matches);

  var raf = window.requestAnimationFrame || function (f) { return setTimeout(function () { f(Date.now()); }, 16); };
  var caf = window.cancelAnimationFrame || clearTimeout;
  function now() { return (window.performance && performance.now) ? performance.now() : Date.now(); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  /* 与 CSS 的 cubic-bezier(.42,0,.26,1) 形状接近，只用来让明暗跟手；
   * 位移本身完全交给 CSS，主线程忙时也不会拖慢纸张。 */
  function easeInOut(x) { return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2; }

  /* 进度 → 角度：正向 0→-90（纸抬起、立到与视线垂直）；回翻 -90→0（纸落下、铺回）。
   * 只翻到 90°：过了 90° 纸就转到书脊左侧、要让位给"左半页"，
   * 而这本书一页就是一整幅跨页，没有左半页可落，翻到立起即止最干净，
   * 也顺带免掉了越出书口被裁切的问题。 */
  function angleFor(p, d) { return -90 * (d > 0 ? p : 1 - p); }

  /* ---------- 摆纸 ----------
   * 只写 transform；dur>0 时挂上过渡，位移交给合成器。 */
  function pose(deg, dur) {
    var s = el.sheet.style;
    s.transition = dur ? ('transform ' + dur + 'ms ' + EASE) : 'none';
    s.transform = 'rotateY(' + deg.toFixed(2) + 'deg)';
  }
  /* 起过渡前把当前样式结算掉，否则浏览器会把"起点"和"终点"合成一次跳变。
   * 只在起手/落定时调用，拖动过程中不需要（拖动本来就是逐帧直写）。 */
  function flush() { void el.sheet.offsetWidth; }

  /* ---------- 明暗 ----------
   * k 在翻页中途最大：纸面反光最亮、书脊阴影最深，两端归零，不会有突兀的跳变。 */
  function shade(p) {
    var q = clamp(p, 0, 1);
    var k = Math.sin(Math.PI * q);            // 中途最浓，两端归零
    var edge = dir > 0 ? q : 1 - q;           // 0 = 平铺，1 = 立起（与方向无关）
    el.sheen.style.opacity = (0.10 + 0.90 * k).toFixed(3);
    el.drop.style.opacity = (0.85 * k).toFixed(3);
    el.cast.style.opacity = (0.92 * k).toFixed(3);
    el.spine.style.opacity = (GLOW + 0.5 * k).toFixed(3);
    /* 后段：纸越立越背光。近端被透视放大会比书页高出一截，若仍是纸的亮色，
     * 在深色桌面上会看成一根白刺；转暗之后它自然沉进背景里。 */
    el.dim.style.opacity = (0.9 * (edge > 0.62 ? Math.min(1, (edge - 0.62) / 0.34) : 0)).toFixed(3);
    /* 立到 97% 以上彻底淡掉，落定时不会有一丝残影 */
    el.sheet.style.opacity = (edge > 0.97 ? Math.max(0, 1 - (edge - 0.97) / 0.025) : 1).toFixed(3);
  }

  function shadeTo(from, to, dur) {
    stopShade();
    var t0 = now();
    (function tick() {
      var k = clamp((now() - t0) / dur, 0, 1);
      shade(from + (to - from) * easeInOut(k));
      rafId = k < 1 ? raf(tick) : null;
    })();
  }
  function stopShade() { if (rafId) { caf(rafId); rafId = null; } }

  /* ---------- 铺纸：内容一次写完 ---------- */
  function laySheet(page) {
    el.flip.hidden = false;
    el.front.innerHTML = page.html;
    el.back.innerHTML = '';
    if (window.__imgHarden) window.__imgHarden(el.front);   // 纸上那面也走显影逻辑
    if (page.scroll) {                       // 纸是从滚动到一半的那一页揭下来的
      var a = el.front.querySelector('.page');
      var b = el.front.querySelector('.page__body');
      if (a && page.scroll[0]) a.scrollTop = page.scroll[0];
      if (b && page.scroll[1]) b.scrollTop = page.scroll[1];
    }
  }

  /* ---------- 起手 ----------
   * 先把纸摆到起点（正向 0°：整张盖住底页；回翻 -90°：立在书脊处、看不见），
   * 结算一次样式再起步，任何时刻都不会露出中间态或空白页。 */
  function begin(d) {
    var page = cb.prepare(d);
    if (!page) return false;                 // 边界：没有这一页，静默忽略
    dir = d; busy = true; expectOk = true; pCur = 0;
    laySheet(page);
    pose(angleFor(0, d), 0);
    shade(0);
    flush();
    return true;
  }

  /* ---------- 结束 ---------- */
  function end() {
    if (!busy) return;
    busy = false;
    clearTimeout(endTimer); endTimer = 0;
    stopShade();

    el.flip.hidden = true;
    el.sheet.style.transition = 'none';
    el.sheet.style.transform = '';
    el.front.innerHTML = '';
    el.back.innerHTML = '';
    el.sheen.style.opacity = 0;
    el.drop.style.opacity = 0;
    el.dim.style.opacity = 0;
    el.cast.style.opacity = 0;
    el.sheet.style.opacity = 1;
    el.spine.style.opacity = GLOW;
    if (el.book) el.book.classList.remove('is-grab');

    if (expectOk) { if (cb.commit) cb.commit(dir); }
    else { if (cb.cancel) cb.cancel(dir); }

    if (pending) {                            // 动画期间多按的一下只记一槽，落定后接着翻
      var d = pending; pending = 0;
      setTimeout(function () { turn(d); }, 0);
    }
  }

  /* ---------- 整页翻动 ---------- */
  function turn(d) {
    if (d !== 1 && d !== -1) return;
    if (reduce) {                            // 系统要求减少动效：直接换页
      var page = cb.prepare(d);
      if (!page) return;
      busy = true; expectOk = true; dir = d;
      end();
      return;
    }
    if (busy) { pending = d; return; }
    if (!begin(d)) return;
    pose(angleFor(1, d), DUR);
    shadeTo(0, 1, DUR);
    endTimer = setTimeout(end, DUR + 90);
  }

  /* ---------- 拖动 ---------- */
  function dragBegin(d) {
    if (reduce) return false;
    if (!begin(d)) return false;
    expectOk = false;
    return true;
  }

  function dragMove(dx) {
    pCur = clamp(Math.abs(dx) / (el.bookW * DRAG_W), 0, 1);
    pose(angleFor(pCur, dir), 0);
    shade(pCur);
  }

  function dragSettle(complete) {
    var to = complete ? 1 : 0;
    var dur = clamp(DUR * Math.abs(to - pCur), 220, DUR + 60);
    expectOk = complete;
    flush();
    pose(angleFor(to, dir), dur);
    shadeTo(pCur, to, dur);
    clearTimeout(endTimer);
    endTimer = setTimeout(end, dur + 90);
  }

  function bindGestures() {
    var book = el.book;
    if (!book) return;

    book.addEventListener('pointerdown', function (e) {
      if (e.button != null && e.button !== 0) return;
      st = { id: e.pointerId, x0: e.clientX, y0: e.clientY, axis: 0, live: true };
    });

    book.addEventListener('pointermove', function (e) {
      if (!st || !st.live || e.pointerId !== st.id) return;
      var dx = e.clientX - st.x0, dy = e.clientY - st.y0;

      if (!st.axis) {                       // 先判方向：竖着划就还给浏览器滚动
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        if (Math.abs(dx) <= Math.abs(dy) * 1.15) { st.live = false; return; }
        st.axis = 1;
        if (busy) { st.live = false; return; }     // 正在翻：不接新手势，免得纸被撕成两半
        if (!dragBegin(dx < 0 ? 1 : -1)) { st.live = false; return; }  // 边界：不翻也不拦
        try { book.setPointerCapture(e.pointerId); } catch (err) {}
        book.classList.add('is-grab');
      }
      dragMove(dx);
    });

    function finishGesture(e, cancelled) {
      if (!st || e.pointerId !== st.id) return;
      var s = st; st = null;
      if (!s.live || !s.axis) return;
      suppressUntil = now() + 400;          // 拖动之后浏览器补发的 click 一律吞掉
      book.classList.remove('is-grab');
      if (cancelled) { dragSettle(false); return; }
      dragSettle(Math.abs(e.clientX - s.x0) / (el.bookW * DRAG_W) > 0.28);
    }
    book.addEventListener('pointerup', function (e) { finishGesture(e, false); });
    book.addEventListener('pointercancel', function (e) { finishGesture(e, true); });

    /* 拖完会补发一次 click，落点若在"开卷"或边缘热区上就会多翻一页，这里截住 */
    book.addEventListener('click', function (e) {
      if (now() < suppressUntil) { e.stopPropagation(); e.preventDefault(); }
    }, true);
  }

  window.Flip = {
    init: function (o) {
      el = o;
      cb = { prepare: o.prepare, commit: o.commit, cancel: o.cancel };
      el.bookW = (el.book && el.book.getBoundingClientRect().width) || 900;
      window.addEventListener('resize', function () {
        var w = el.book && el.book.getBoundingClientRect().width;
        if (w) el.bookW = w;
      });
      if (el.spine) el.spine.style.opacity = GLOW;
      bindGestures();
    },
    go: turn,
    busy: function () { return busy; },
    /* 调试：把纸停在某个进度（?freeze=0.45 由 story.js 调用），便于截图检查 */
    freeze: function (p, d) {
      if (!begin(d === -1 ? -1 : 1)) return false;
      pCur = clamp(p, 0, 1);
      expectOk = false;
      pose(angleFor(pCur, dir), 0);
      shade(pCur);
      busy = false;                          // 不再自动结束，停在半途
      return true;
    }
  };
})();
