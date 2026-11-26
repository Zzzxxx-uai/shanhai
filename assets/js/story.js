/* ===========================================================
 * 《山海舆图 · 先民观》绘本 · 交互与翻页
 * 纯原生 JS：翻页 + 目录。背景乐在 audio.js（翻页本身不发声）。
 * =========================================================== */
(function () {
  'use strict';

  var PAGES = window.PAGES || [];
  var TOTAL = PAGES.length;
  var idx = 0;

  var pageEl  = document.getElementById('page');
  var bookEl  = document.getElementById('book');
  var flipEl  = document.getElementById('flip');
  var sheetEl = document.getElementById('sheet');
  var frontEl = document.getElementById('flip-front');
  var backEl  = document.getElementById('flip-back');
  var sheenEl = document.getElementById('flip-sheen');
  var dropEl  = document.getElementById('flip-drop');
  var dimEl   = document.getElementById('flip-dim');
  var castEl  = document.getElementById('cast');
  var spineEl = document.getElementById('spine');
  var edgeLeftEl  = document.getElementById('edge-left');
  var edgeRightEl = document.getElementById('edge-right');
  var dotsEl  = document.getElementById('dots');
  var numEl   = document.getElementById('page-num');
  var tocEl   = document.getElementById('toc');
  var btnPrev = document.getElementById('btn-prev');
  var btnNext = document.getElementById('btn-next');

  /* 用户是否已经交互过（声音由 audio.js 自己按手势解锁，这里只留作语义标记） */
  var unlocked = false;

  function splitSentences(t) {
    var out = [], buf = '';
    for (var i = 0; i < t.length; i++) {
      buf += t.charAt(i);
      if ('。！？；'.indexOf(t.charAt(i)) >= 0) { out.push(buf); buf = ''; }
    }
    if (buf.replace(/\s/g, '')) out.push(buf);
    return out;
  }

  /* ---------------- 渲染 ---------------- */
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

  function sayHTML(text) {
    return splitSentences(text).map(function (s) {
      return '<span class="sen">' + esc(s) + '</span>';
    }).join('');
  }

  /* 五境的场景色：换境时纸色随之过渡（见 story.css 的 --scene-tint） */
  var REALM = [
    ['东方', 'dong'], ['西方', 'xi'], ['北方', 'bei'],
    ['南方', 'nan'], ['蛮荒', 'man']
  ];
  function sceneKey(p) {
    if (p.kind === 'cover') return 'cover';
    if (p.kind === 'colophon') return 'colo';
    var s = (p.place || '') + (p.chapter || '') + (p.title || '');
    for (var i = 0; i < REALM.length; i++) {
      if (s.indexOf(REALM[i][0]) >= 0) return REALM[i][1];
    }
    return /尾声/.test(s) ? 'wei' : 'xu';
  }

  /* ---------------- 预加载 ----------------
   * 用户翻得快时，下一页的图常常还没下完，翻过去就是一片空白。
   * 这里做三件事：
   *   1) 队列化：最多 3 张同时在途，不跟当前页抢带宽，也不把浏览器并发打满；
   *   2) 保留 Image 引用：以前只记一个 1，Image 对象会被回收，解码好的位图也随之丢掉，
   *      新建的 <img> 还得从头解一遍；现在留住引用，同一张图第二次用几乎零成本；
   *   3) 全书排队：打开就把 24 张按页序取下来（越靠前越优先），
   *      整本 3.3MB，读完封面这几秒前面几页基本都到位了。 */
  var preloaded = {};            // src -> Image（0 表示"已排队、还没取完"）
  /* 并发 3 是量出来的：4 个一起取，总带宽被摊薄，队首那张反而更慢到；
   * 3 个既能吃满带宽，又不至于把"下一页"排到别的图后面。 */
  var queue = [], bus = 0, MAX_BUS = 3, allQueued = false;

  function imgReady(src) {
    var im = preloaded[src];
    return !!(im && im.complete && im.naturalWidth > 0);
  }

  function pump() {
    while (bus < MAX_BUS && queue.length) {
      var src = queue.shift();
      bus++;
      (function (src) {
        var im = new Image();
        im.decoding = 'async';
        var fin = function () {
          bus--;
          preloaded[src] = im;
          if (im.decode) { try { im.decode().catch(function () {}); } catch (e) {} }
          pump();
        };
        im.onload = fin;
        im.onerror = fin;                 // 失败也放行，别把队列卡死
        im.src = src;
      })(src);
    }
  }

  function enqueue(src, urgent) {
    if (!src || preloaded[src]) return;
    preloaded[src] = 0;                   // 占位：已在队列里
    if (urgent) queue.unshift(src); else queue.push(src);
    pump();
  }

  function preloadAround(i) {
    /* unshift 是插到队首，所以最后入队的最先下载 ——
     * 这里要倒着写：越先会翻到的，越往后写，才排得越前。 */
    if (PAGES[i - 2]) enqueue(PAGES[i - 2].img, true);     // 回翻两页（最不急）
    if (PAGES[i + 3]) enqueue(PAGES[i + 3].img, true);
    if (PAGES[i - 1]) enqueue(PAGES[i - 1].img, true);
    if (PAGES[i + 2]) enqueue(PAGES[i + 2].img, true);
    if (PAGES[i + 1]) enqueue(PAGES[i + 1].img, true);     // 下一页最急，排最前

    if (!allQueued) {                     // 其余按页序排在后面，空闲时慢慢取完
      allQueued = true;
      for (var k = 0; k < TOTAL; k++) {
        var j = (i + k) % TOTAL;
        if (PAGES[j] && PAGES[j].img) enqueue(PAGES[j].img, false);
      }
    }
  }

  /* 图片显影：没就绪的先隐住（底下是纸色，不是白），load 完再淡进来。
   * 覆盖底页与翻页纸上那一面，避免任何时刻出现一块刺眼的空白。 */
  function harden(root) {
    if (!root) return;
    var ims = root.querySelectorAll('img');
    for (var i = 0; i < ims.length; i++) {
      (function (im) {
        if (im.complete && im.naturalWidth) { im.className += ' is-ready'; return; }
        im.className += ' is-loading';
        var done = function () {
          im.className = im.className.replace(/\s*is-loading/, '') + ' is-ready';
        };
        im.addEventListener('load', done, { once: true });
        im.addEventListener('error', done, { once: true });
      })(ims[i]);
    }
  }
  window.__imgHarden = harden;             // 翻页引擎铺完纸后会调一次

  /* ---------------- 一页的标记 ----------------
   * pageMarkup 只产出字符串，渲染与"翻页用的纸"共用同一份内容，
   * 保证纸上那一面和底页一模一样。 */
  function pageMarkup(p) {
    var cls = 'page', html = '';

    if (p.kind === 'cover') {
      cls = 'page page--cover';
      html =
        '<div class="cover">' +
          '<img class="cover__img" src="' + p.img + '" alt="封面">' +
          '<h1 class="cover__t">' + esc(p.title) + '</h1>' +
          '<p class="cover__s">' + esc(p.sub) + '</p>' +
          '<div class="cover__rule"></div>' +
          '<p class="cover__d">' + sayHTML(p.say) + '</p>' +
          '<button class="cover__go" id="btn-start" type="button">开 卷</button>' +
        '</div>';
    } else if (p.kind === 'colophon') {
      cls = 'page page--colophon';
      html =
        '<div class="colophon">' +
          '<h2 class="colophon__t">' + esc(p.title) + '</h2>' +
          p.colophon.map(function (c) {
            return '<div class="colo"><div class="colo__k">' + esc(c[0]) + '</div>' +
                   '<div class="colo__v">' + esc(c[1]) + '</div></div>';
          }).join('') +
        '</div>';
    } else {
      var isBeast = p.kind === 'beast';
      html =
        '<figure class="page__fig">' +
          '<img src="' + p.img + '" alt="' + esc(isBeast ? p.name : p.title) + '">' +
          '<figcaption class="page__figcap">' + esc(isBeast ? p.place : p.chapter) + '</figcaption>' +
        '</figure>' +
        '<div class="page__body">' +
          (p.chapter ? '<div class="page__chapter">' + esc(p.chapter) + '</div>' : '') +
          (isBeast
            ? '<h2 class="page__title">' + esc(p.name) + '<span class="py">' + esc(p.py || '') + '</span></h2>' +
              '<div class="page__place">' + esc(p.place) + '</div>'
            : '<h2 class="page__title">' + esc(p.title) + '</h2>') +
          '<p class="page__say">' + sayHTML(p.say) + '</p>' +
          (isBeast ? '<div class="page__tag">此段为据' + esc(p.doc || '《山海经》') + '记载推演的情景化叙述，非古籍原文。</div>' : '') +
          ((p.origin || p.zoology) ? '<div class="page__note">' +
            (p.origin ? '<div class="note"><span class="note__k">古籍 · 白话转述</span><span class="note__v">' + esc(p.origin) + '</span></div>' : '') +
            (p.zoology ? '<div class="note"><span class="note__k">博物 · 对照参考</span><span class="note__v">' + esc(p.zoology) + '</span></div>' : '') +
            '</div>' : '') +
        '</div>';
    }
    return { cls: cls, scene: sceneKey(p), html: html };
  }

  function render(p) {
    var m = pageMarkup(p);
    pageEl.className = m.cls;
    pageEl.setAttribute('data-scene', m.scene);
    pageEl.innerHTML = m.html;
    harden(pageEl);                 // 未就绪的图先隐住，load 完淡入

    var st = document.getElementById('btn-start');
    if (st) st.addEventListener('click', function () {
      unlocked = true;
      go(1);
    });

    preloadAround(idx);
  }

  /* 一页的完整外壳（给翻页引擎铺在纸上用）；去掉 id，免得出现两个 #page */
  function pageShell(p) {
    var m = pageMarkup(p);
    return '<article class="' + m.cls + '" data-scene="' + m.scene + '">' +
           m.html.replace(/ id="btn-start"/, '') + '</article>';
  }

  function updateChrome() {
    numEl.textContent = (idx + 1) + ' / ' + TOTAL;
    btnPrev.disabled = idx === 0;                 // 首末页：按钮隐去，不留可点的空壳
    btnNext.disabled = idx === TOTAL - 1;
    if (edgeLeftEl) edgeLeftEl.classList.toggle('is-off', idx === 0);
    if (edgeRightEl) edgeRightEl.classList.toggle('is-off', idx === TOTAL - 1);
    var dots = dotsEl.children;
    for (var i = 0; i < dots.length; i++) dots[i].classList.toggle('is-on', i === idx);
    var items = tocEl.children;
    for (var j = 0; j < items.length; j++) items[j].classList.toggle('is-on', j === idx);
  }

  function savePage() {
    try { localStorage.setItem('shanhai-page', idx); } catch (e) {}
  }

  /* ---------------- 翻页：交给 flip.js 做那张纸 ----------------
   * 正向：纸 = 当前页（连滚动位置一起揭下来），底页先铺好目标页；
   * 回翻：底页仍留当前页，纸 = 目标页，从书脊后展开盖上来，落定再换底页。
   * 两个方向都不会出现白页：任何时刻底页都有内容。 */
  function flipPrepare(d) {
    var t = idx + d;
    if (t < 0 || t >= TOTAL) return null;

    var out;
    if (d > 0) {
      var body = pageEl.querySelector('.page__body');
      out = {
        html: pageEl.outerHTML.replace(/ id="page"/, ''),
        scroll: [pageEl.scrollTop || 0, body ? (body.scrollTop || 0) : 0]
      };
      idx = t;
      render(PAGES[idx]);
    } else {
      out = { html: pageShell(PAGES[t]), scroll: null };
      idx = t;                                   // 底页暂不换，等纸落定
    }
    updateChrome();
    savePage();
    return out;
  }

  function flipCommit(d) {
    if (d < 0) render(PAGES[idx]);               // 回翻落定：底页才换成目标页
    preloadAround(idx);
  }

  function flipCancel(d) {                       // 拖了一半又放回去
    idx -= d;
    render(PAGES[idx]);
    updateChrome();
    savePage();
  }

  /* 翻页前的"等图门"：翻页只有 380ms，目标页的图若还在路上，
   * 纸上那一面必然是空的。这里最多等 260ms —— 只吃掉"最后那一段"，
   * 真没下完就不等了，交给占位与淡入兜底，绝不把点击拖成卡顿。 */
  var gateOpen = true, queuedDir = 0;

  function go(delta) {
    if (Math.abs(delta) !== 1) { jump(idx + delta); return; }

    if (!window.Flip) {                          // 没有翻页引擎时直接切
      var n = idx + delta;
      if (n < 0 || n >= TOTAL) return;
      idx = n; render(PAGES[idx]); updateChrome(); savePage();
      return;
    }

    var dir = delta > 0 ? 1 : -1;
    if (!gateOpen) { queuedDir = dir; return; }  // 门还没开：连点只记一次

    var t = PAGES[idx + dir];
    if (!t || !t.img || imgReady(t.img)) { Flip.go(dir); return; }

    gateOpen = false;
    enqueue(t.img, true);                        // 把要翻到的那张提到队首
    // 开卷那一下多等一会儿：读者刚点完"开卷"，停半秒不会被察觉，
    // 但正好够第一张内页图下完；之后的翻页仍按 260ms，绝不拖慢连续阅读。
    var waitMax = idx === 0 ? 600 : 260;
    var t0 = Date.now();
    (function tick() {
      if (imgReady(t.img) || Date.now() - t0 >= waitMax) {
        gateOpen = true;
        Flip.go(dir);
        if (queuedDir) {
          var q = queuedDir; queuedDir = 0;
          setTimeout(function () { go(q); }, 0);
        }
      } else {
        setTimeout(tick, 50);
      }
    })();
  }

  function jump(i) {
    if (i < 0 || i >= TOTAL || i === idx) return;
    if (window.Flip && Flip.busy()) return;        // 翻页途中不动底下的页，免得纸面和底页对不上
    if (Math.abs(i - idx) === 1) { go(i - idx); return; }
    idx = i;
    render(PAGES[idx]);
    updateChrome();
    savePage();
  }

  /* ---------------- 目录与进度点 ---------------- */
  function buildIndex() {
    PAGES.forEach(function (p, i) {
      var label = p.kind === 'cover' ? '封面'
        : p.kind === 'colophon' ? p.title
        : p.kind === 'beast' ? p.name : p.title;
      var b = document.createElement('button');
      b.className = 'toc__i';
      b.type = 'button';
      b.innerHTML = '<span class="toc__n">' + (i + 1) + '</span><span>' + esc(label) + '</span>';
      b.addEventListener('click', function () {
        unlocked = true;
        closeSheets();
        jump(i);
      });
      tocEl.appendChild(b);

      var d = document.createElement('button');
      d.className = 'dot';
      d.type = 'button';
      d.setAttribute('aria-label', '第 ' + (i + 1) + ' 页');
      d.addEventListener('click', function () { unlocked = true; jump(i); });
      dotsEl.appendChild(d);
    });
  }

  /* ---------------- 浮层 ---------------- */
  function closeSheets() {
    document.getElementById('sheet-toc').hidden = true;
  }
  document.getElementById('btn-toc').addEventListener('click', function () {
    document.getElementById('sheet-toc').hidden = false;
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-close]'), function (b) {
    b.addEventListener('click', closeSheets);
  });
  Array.prototype.forEach.call(document.querySelectorAll('.sheet'), function (s) {
    s.addEventListener('click', function (e) { if (e.target === s) s.hidden = true; });
  });

  /* ---------------- 翻页交互 ----------------
   * 按钮、书口边缘热区、键盘；手指/鼠标左右拖动由 flip.js 接手。 */
  btnPrev.addEventListener('click', function () { unlocked = true; go(-1); });
  btnNext.addEventListener('click', function () { unlocked = true; go(1); });
  if (edgeLeftEl) edgeLeftEl.addEventListener('click', function () { unlocked = true; go(-1); });
  if (edgeRightEl) edgeRightEl.addEventListener('click', function () { unlocked = true; go(1); });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowRight' || e.key === 'PageDown') { go(1); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { go(-1); }
    else if (e.key === 'Escape') { closeSheets(); }
  });

  /* 翻页引擎：纸张的翻转、明暗、拖动都在 flip.js 里，这里只喂内容 */
  if (window.Flip) {
    Flip.init({
      book: bookEl, flip: flipEl, sheet: sheetEl,
      front: frontEl, back: backEl, sheen: sheenEl, drop: dropEl, dim: dimEl,
      cast: castEl, spine: spineEl,
      prepare: flipPrepare, commit: flipCommit, cancel: flipCancel
    });
  }

  /* ---------------- 启动 ---------------- */
  var saved = parseInt(localStorage.getItem('shanhai-page') || '0', 10);
  if (saved > 0 && saved < TOTAL) idx = saved;

  buildIndex();
  render(PAGES[idx]);
  updateChrome();

  // 开场短片放完，书轻轻落定
  document.addEventListener('intro:done', function () {
    if (!bookEl) return;
    bookEl.classList.add('is-in');
    setTimeout(function () { bookEl.classList.remove('is-in'); }, 1100);
  });

  // 调试：?freeze=0.45 把翻页停在半途，便于截图检查纸张形态
  var fz = /[?&]freeze=([\d.]+)/.exec(location.search);
  if (fz && window.Flip) setTimeout(function () {
    Flip.freeze(parseFloat(fz[1]) || 0.5, /[?&]rev=1/.test(location.search) ? -1 : 1);
  }, 60);
})();
