/* ===========================================================
 * 《山海舆图 · 先民观》—— 仿实体书翻页引擎
 *
 * 思路：把正在翻动的那一张纸，沿水平方向切成若干"纸条"，
 * 纸条首尾相接、各自绕自己的左缘转一点点角度，折线连起来就是纸的卷曲弧面。
 * 每根纸条的明暗按真实光照（法线 · 光源方向）算，所以纸弯起来时会有明暗过渡。
 * 再配上：底页投影、纸张厚度、落页回弹、书脊青金微光与薄雾粒子。
 * （纯图文绘本：无翻页音效。）
 * =========================================================== */
(function () {
  'use strict';

  var DUR = 1060;         // 一次翻页时长（舒缓）
  var CURL = 0.75;        // 卷曲强度（柔和内敛：纸微微卷起，不鼓成大弧面）
  var PUSH = 0.045;       // 翻到中段时整张纸向观察者推近的程度（占书宽）——压低3D顶出感
  var n = 7;              // 纸条数（越多越圆滑，越费性能）

  var el = {}, cb = {}, segN = 7, bookW = 900, frac = 0.5;
  var busy = false, dragging = false, dir = 1;
  var u = 0, from = 0, to = 1, t0 = 0, dur = DUR, raf = null, queued = 0;
  var segsF = [], segsB = [], shF = [], shB = [], misted = false, revealed = false, lastB = '';
  var mistOn = true;
  var GLOW = 0.12;
  var frozen = -1;          // 平时书缝里透出的一点微光
  var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion:reduce)').matches);

  /* 上一帧写进 DOM 的值：相同就不重写，省掉大量样式失效 */
  var castD = -1, castTF = '', bookTF = '', glow = -1;

  /* ---------- 自适应画质 ----------
   * 纸被切成 segN 张复制，画得越细越贵。每翻完一页量一次真实帧间隔：
   * 平均掉到 21.5ms 以下（约 46fps）就减段，明显有余量再加回来。
   * 无头 __FLIP_TEST__ 下关掉，保证测试可复现。 */
  var autoQ = true, QMAX = 7, QMIN = 4;
  var accMs = 0, cntF = 0, prevT = 0;
  function qualityTune() {
    if (!autoQ || cntF < 24) return;
    var avg = accMs / cntF;
    if (avg > 21.5) { if (n > QMIN) n--; }
    else if (avg < 14 && n < QMAX) n++;
  }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  /* ---------- 把一页内容铺进某个"纸面"，并切成 n 根纸条 ----------
   * frac = 纸宽 / 整页宽（桌面跨页书翻右半页：0.5；窄屏单页翻整页：1）。
   * body 铺整页 HTML（宽 = N/frac 段宽），第 i 段的窗口要落在整页的
   *   正面：书脊端 h0f 起、向外递增（跨页 0.5，单页 0）
   *   背面：书脊端 h0b 起、向外递减（跨页 0.5，单页 1）——翻过来后从左读到右
   * 由此 body 相对第 i 段的偏移 = -(h*N/frac ∓ i)*100%。 */
  function buildFace(face, html, collectSeg, collectSh, isBack) {
    face.innerHTML = '';
    collectSeg.length = 0; collectSh.length = 0;

    var curl = document.createElement('div');
    curl.className = 'curl';

    var bodyW = (segN / frac * 100).toFixed(4) + '%';
    var h0 = (segN / frac) * (frac < 1 ? 0.5 : (isBack ? 1 : 0));

    var parent = curl, i;
    for (i = 0; i < segN; i++) {
      var seg = document.createElement('div');
      seg.className = 'curl__seg';
      if (i === 0) { seg.style.left = '0'; seg.style.width = (100 / segN) + '%'; }
      else { seg.style.left = '100%'; seg.style.width = '100%'; }

      var clip = document.createElement('div');
      clip.className = 'seg__clip';

      var body = document.createElement('div');
      body.className = 'seg__body';
      body.style.width = bodyW;
      body.style.left = (-(h0 + (isBack ? -(i + 1) : i)) * 100).toFixed(4) + '%';
      body.innerHTML = html;

      var shade = document.createElement('div');
      shade.className = 'seg__shade';

      clip.appendChild(body);
      clip.appendChild(shade);
      seg.appendChild(clip);
      parent.appendChild(seg);

      collectSeg.push(seg); collectSh.push(shade);
      parent = seg;                 // 下一根纸条挂在上一根末尾，首尾相接
    }
    face.appendChild(curl);
  }

  /* 纸条转过的角度：整体角 a 按权重分配给各纸条；
   * 权重留 30% 的"常弯底量"——起手时纸角就先翘起来，而不是整块平板慢吞吞地转；
   * 中段（sin πt 最大）弯得最厉害。权重曲线用 sin^1.3，让中段纸条集中多转，弧更圆。
   *
   * 性能：wBase[i] = sin^1.3(πx)(1-0.45x) 只跟第几段有关，铺纸时算一次存好；
   * 每帧只剩 1+k·wBase 与归一化，省掉每段的 Math.pow / Math.sin。 */
  var wBase = [], angBuf = [];
  function computeWeights() {
    wBase.length = 0; angBuf.length = segN;
    for (var i = 0; i < segN; i++) {
      var x = (i + 0.5) / segN;
      wBase.push(Math.pow(Math.sin(Math.PI * x), 1.3) * (1 - 0.45 * x));
      angBuf[i] = 0;
    }
  }

  function segAngles(a, t) {
    var k = CURL * (0.3 + 0.7 * Math.sin(Math.PI * clamp(t, 0, 1)));
    var sum = 0, i, wi;
    for (i = 0; i < segN; i++) { wi = 1 + k * wBase[i]; angBuf[i] = wi; sum += wi; }
    for (i = 0; i < segN; i++) angBuf[i] = a * angBuf[i] / sum;
    return angBuf;
  }

  /* 光照：光源大致在左上前方，纸面法线随纸条累计转角而变，
   * 法线与光线夹角越小越亮 —— 弯起来的纸于是自带明暗过渡。 */
  var LX = -0.42, LZ = 0.78;
  function lum(rad) {
    var d = Math.sin(rad) * LX + Math.cos(rad) * LZ;
    return clamp(d, 0, 1);
  }

  /* 明暗按 0.006 量化：肉眼分不出档差，但可以省掉大量无谓的样式写入 */
  function paint(segs, shades, angs) {
    var cum = 0, i, op;
    for (i = 0; i < segs.length; i++) {
      cum += angs[i];
      var tr = 'rotateY(' + angs[i].toFixed(2) + 'deg)';
      if (tr !== segs[i].__tr) { segs[i].__tr = tr; segs[i].style.transform = tr; }
      op = clamp((1 - (0.34 + 0.66 * lum(cum * Math.PI / 180))) * 0.62, 0, 0.66);
      op = Math.round(op / 0.006) * 0.006;
      if (op !== shades[i].__op) {
        shades[i].__op = op;
        shades[i].style.opacity = op.toFixed(3);
      }
    }
  }

  /* ---------- 每一帧：摆好纸、影子、微光和镜头 ---------- */
  function apply(uu) {
    var t = clamp(uu, 0, 1);
    var a = dir > 0 ? -180 * uu : -180 * (1 - uu);      // 纸的整体转角
    var lift = Math.sin(Math.PI * t);                    // 抬起程度
    var angs = segAngles(a, t);

    paint(segsF, shF, angs);
    paint(segsB, shB, angs);
    // 整张纸向观察者推近：透视下纸会放大迎面而来，"掀起来"的感觉。
    // 注意只能平移（不能转），角度全在纸条链上，flip 本身一转就会翻倍。
    el.flip.style.transform = 'translateZ(' + (PUSH * bookW * lift).toFixed(1) + 'px)';

    // 过半之后，朝上的已经是纸的另一面；纸刚离开的那半边提前露出目标页
    var back = dir > 0 ? (uu > 0.5) : (uu < 0.5);
    if (el.front) el.front.style.visibility = back ? 'hidden' : 'visible';
    if (el.back) el.back.style.visibility = back ? 'visible' : 'hidden';
    if (!revealed && Math.abs(a) >= 89.9) {
      revealed = true;
      if (el.next && frac < 1) {     // 窄屏单页用不上（整页都是纸）
        el.next.className = 'book__next ' + (dir > 0 ? 'is-right' : 'is-left');
        el.next.innerHTML = '<div class="book__next-in">' + lastB + '</div>';
        el.next.style.visibility = 'visible';
      }
      if (cb.reveal) cb.reveal();
    }

    /* 落在底页上的影子：纸悬在书脊哪一侧，影子就铺向哪一侧，靠书脊处最浓，向自由端渐淡。
     * 只写 opacity 和 transform（两个纯合成属性，走 GPU，不触发布局与重绘）；
     * 渐变本身写死在 CSS 里，方向靠 scaleX(-1) 镜像，不再每帧拼字符串。 */
    if (el.cast) {
      var swing = Math.cos(a * Math.PI / 180) * (dir > 0 ? 1 : -1);   // 自由端在右半还是左半
      var dens = Math.round(0.5 * lift * (1 - Math.pow(t, 6)) * 50) / 50;
      if (dens !== castD) { castD = dens; el.cast.style.opacity = dens.toFixed(2); }
      var sp = Math.round(Math.abs(swing) * 0.92 * 50) / 50;
      var ctf = (swing >= 0 ? 'scaleX(' : 'scaleX(-') + sp.toFixed(2) + ')';
      if (ctf !== castTF) { castTF = ctf; el.cast.style.transform = ctf; }
    }
    // 书缝里溢出的青金微光
    if (el.spine) {
      var gl = mistOn ? Math.round((GLOW + 0.55 * lift) * 100) / 100 : 0;
      if (gl !== glow) { glow = gl; el.spine.style.opacity = gl.toFixed(2); }
    }

    // 镜头轻微后退，给翻过去的纸让出画面
    if (el.book) {
      var s = 1 - 0.052 * lift;
      var tx = (dir > 0 ? 1 : -1) * 2.6 * lift;
      var btf = 'translateX(' + tx.toFixed(2) + '%) scale(' + s.toFixed(4) + ')';
      if (btf !== bookTF) { bookTF = btf; el.book.style.transform = btf; }
    }

    // 翻页一开始就把书口的翘角藏起来，别跟纸打架
    if (el.corner) el.corner.style.visibility = t < 0.04 ? '' : 'hidden';
    if (el.cornerPrev) el.cornerPrev.style.visibility = t < 0.04 ? '' : 'hidden';

    if (!misted && uu > 0.1) { misted = true; mist(); }
  }

  /* ---------- 薄雾粒子 ---------- */
  function mist() {
    if (!el.spine || !mistOn) return;
    var many = n <= QMIN ? 5 : 8;         // 画质降下来时粒子也少一点，别拖慢翻页
    for (var i = 0; i < many; i++) {
      var d = document.createElement('i');
      d.className = 'mist';
      var s = 3 + Math.random() * 7;
      d.style.width = d.style.height = s.toFixed(1) + 'px';
      d.style.left = (Math.random() * 26 - 4).toFixed(1) + 'px';
      d.style.bottom = (Math.random() * 40).toFixed(0) + '%';
      d.style.animationDelay = (Math.random() * 0.5).toFixed(2) + 's';
      d.style.animationDuration = (1.3 + Math.random() * 1.1).toFixed(2) + 's';
      el.spine.appendChild(d);
      (function (node) {
        setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, 3000);
      })(d);
    }
  }

  /* ---------- 动画节拍 ---------- */
  /* 两端慢、中间快：手翻书页就是这样起手和落下的 */
  function ease(x) {
    return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  }

  function step(now) {
    if (!busy) return;
    var k = clamp((now - t0) / dur, 0, 1);
    // 采真实帧间隔（只有真浏览器才有意义），用来决定要不要降价
    if (prevT) { accMs += now - prevT; cntF++; }
    prevT = now;
    var e = ease(k);
    // 落页时两次阻尼振荡：纸"啪"地拍下、再轻轻弹一下才服帖（幅度调小，落页更轻柔）
    if (k > 0.74) {
      var q = (k - 0.74) / 0.26;
      e += Math.sin(q * Math.PI * 2.6) * Math.exp(-3.4 * q) * 0.014;
    }
    apply(from + (to - from) * e);
    if (k < 1) { raf = request(step); return; }
    finish(to > 0.5);
  }

  var vt = 0;
  var request = window.requestAnimationFrame || function (f) { return setTimeout(function () { f(Date.now()); }, 16); };
  var cancel = window.cancelAnimationFrame || clearTimeout;
  if (window.__FLIP_TEST__) {   // 无头环境 rAF 不跑，改成按帧步进的假时钟
    request = function (f) { vt += 16; return setTimeout(function () { f(vt); }, 16); };
  }

  function run(f, t, d) {
    from = f; to = t; dur = d; busy = true;
    if (window.__FLIP_TEST__) { vt = 0; t0 = 0; }
    else { t0 = (window.performance && performance.now) ? performance.now() : Date.now(); }
    step(t0);
  }

  function finish(done) {
    busy = false; dragging = false;
    if (raf) { try { cancel(raf); } catch (e) {} } raf = null;
    el.flip.hidden = true;
    el.flip.classList.remove('is-turning');
    el.flip.style.transform = '';
    qualityTune();                                   // 据这一场的真实帧间隔调下一场的画质
    // 只倒空两个纸面，front / back 这两个壳得留着
    if (el.front) { el.front.innerHTML = ''; el.front.style.visibility = 'visible'; }
    if (el.back) { el.back.innerHTML = ''; el.back.style.visibility = 'visible'; }
    if (el.book) el.book.style.transform = '';
    if (el.cast) { el.cast.style.opacity = 0; el.cast.style.width = ''; }
    if (el.spine) el.spine.style.opacity = mistOn ? GLOW : 0;
    if (el.corner) el.corner.style.visibility = '';
    if (el.cornerPrev) el.cornerPrev.style.visibility = '';
    if (el.next) { el.next.style.visibility = 'hidden'; el.next.innerHTML = ''; }
    segsF = []; segsB = []; shF = []; shB = [];
    misted = false; revealed = false; lastB = '';
    if (done) { if (cb.commit) cb.commit(dir); }
    else { if (cb.cancel) cb.cancel(dir); }
    // 动画期间点的下一页不丢，落定后接着翻
    if (queued) { var q = queued; queued = 0; go(q); }
  }

  /* ---------- 准备：把当前页铺在纸的一面、目标页铺在另一面 ---------- */
  function prepare(d) {
    var r = cb.prepare(d);
    if (!r) return false;
    dir = d;
    segN = n;
    revealed = false;
    castD = -1; castTF = ''; bookTF = ''; glow = -1;    // 新一场翻新：缓存作废
    prevT = 0; accMs = 0; cntF = 0;
    computeWeights();
    // 只有真正翻开的时候才给这张纸加 will-change（常驻反而占资源）
    if (el.flip) el.flip.classList.add('is-turning');
    // 纸宽：桌面跨页书翻右半页（书宽一半），窄屏单页翻整页
    frac = (window.matchMedia && window.matchMedia('(max-width:860px)').matches) ? 1 : 0.5;
    lastB = r.b;
    if (el.flip) {
      var w = el.flip.getBoundingClientRect().width;
      if (w > 40) bookW = w;
    }
    // r.a = 尚未翻动时朝上的那一面（当前页）；r.b = 翻过去后朝上的那一面（目标页）
    if (d > 0) {
      buildFace(el.front, r.a, segsF, shF, false);
      buildFace(el.back, r.b, segsB, shB, true);
    } else {
      buildFace(el.front, r.b, segsF, shF, false);
      buildFace(el.back, r.a, segsB, shB, true);
    }
    el.flip.hidden = false;
    apply(0);
    return true;
  }

  /* ---------- 对外：整页翻动 ---------- */
  function go(d) {
    if (busy) { queued = d; return; }
    if (!prepare(d)) return;
    if (reduce) { finish(true); return; }      // 用户要求减少动效
    if (frozen >= 0) { apply(frozen); return; } // ?freeze=.45 把纸停在半途，方便看效果
    run(0, 1, DUR);
  }

  /* ---------- 对外：按住纸拖动 ---------- */
  function beginDrag(d) {
    if (busy) return false;
    if (!prepare(d)) return false;
    dragging = true; busy = true;
    dir = d;
    return true;
  }
  function dragTo(pp) {
    if (!dragging) return;
    u = clamp(pp, 0, 1);
    apply(u);
  }
  function endDrag() {
    if (!dragging) return;
    dragging = false;
    if (u >= 0.34) run(u, 1, Math.max(220, DUR * (1 - u)));
    else if (u > 0.001) run(u, 0, Math.max(180, DUR * u));
    else finish(false);
  }

  /* ---------- 拖动绑定 ---------- */
  var dragX = 0, dragW = 1, pending = false;

  function interactive(t) {
    if (!t || !t.closest) return false;
    return !!t.closest('button,a,input,select,textarea,.sen,.sheet,.nav');
  }

  function bindDrag() {
    var stage = el.stage;
    if (!stage) return;
    stage.addEventListener('pointerdown', function (e) {
      if (e.button != null && e.button !== 0) return;
      if (interactive(e.target)) return;
      dragX = e.clientX;
      dragW = (el.book && el.book.getBoundingClientRect().width) || window.innerWidth;
      pending = true;
    });
    stage.addEventListener('pointermove', function (e) {
      if (!pending && !dragging) return;
      var dx = e.clientX - dragX;
      if (!dragging) {
        if (Math.abs(dx) < 14) return;
        var d = dx < 0 ? 1 : -1;
        if (!beginDrag(d)) { pending = false; return; }
        try { document.body.classList.add('is-dragging'); } catch (err) {}
      }
      dragTo(Math.abs(dx) / (dragW * 0.82));
      if (e.cancelable) e.preventDefault();
    });
    function up(e) {
      if (dragging) {
        endDrag();
        // 拖完这一下，别让 click 再触发按钮
        setTimeout(function () { try { document.body.classList.remove('is-dragging'); } catch (err) {} }, 30);
      }
      pending = false;
    }
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', up);
    stage.addEventListener('pointerleave', up);
  }

  window.Flip = {
    init: function (o) {
      el = o;
      cb = { prepare: o.prepare, commit: o.commit, cancel: o.cancel, reveal: o.reveal };
      // 先按设备给个默认值，再用网址参数 / 全局变量覆盖（方便调试与测试）
      if (window.matchMedia && window.matchMedia('(max-width:860px)').matches) n = 3;
      if (reduce) n = 1;
      var fz = /[?&]freeze=([\d.]+)/.exec(location.search);
      if (fz) frozen = clamp(parseFloat(fz[1]), 0, 1);
      var q = /[?&]seg=(\d+)/.exec(location.search);
      if (q) n = clamp(parseInt(q[1], 10) || 1, 1, 8);
      if (window.__FLIP_SEG__) n = clamp(window.__FLIP_SEG__, 1, 8);
      // 网址硬指定段数、或无头测试：关掉自适应，保证表现可复现
      if (q || window.__FLIP_SEG__ || window.__FLIP_TEST__ || reduce) autoQ = false;
      // 弱机起步就降压，别等到第一场翻完再降
      var cores = navigator.hardwareConcurrency || 4;
      if (cores <= 4 && n > 5) n = 5;
      bindDrag();
    },
    go: go,
    busy: function () { return busy; },
    mist: function (on) {
      mistOn = !!on;
      if (el.spine) {
        el.spine.style.opacity = mistOn ? GLOW : 0;
        if (!mistOn) el.spine.innerHTML = '';
      }
    },
    /* 给无头测试用：直接跳到某个进度 */
    _apply: apply,
    _state: function () { return { busy: busy, dragging: dragging, dir: dir, seg: segN }; }
  };
})();
