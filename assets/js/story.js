/* ===========================================================
 * 《山海舆图 · 先民观》绘本 · 交互与翻页
 * 纯原生 JS：翻页 + 目录。纯图文，无语音朗读与音效。
 * =========================================================== */
(function () {
  'use strict';

  var PAGES = window.PAGES || [];
  var TOTAL = PAGES.length;
  var idx = 0;

  var pageEl  = document.getElementById('page');
  var bookEl  = document.getElementById('book');
  var flipEl  = document.getElementById('flip');
  var frontEl = document.getElementById('flip-front');
  var backEl  = document.getElementById('flip-back');
  var castEl  = document.getElementById('cast');
  var spineEl = document.getElementById('spine');
  var stageEl = document.getElementById('stage');
  var cornerEl = document.getElementById('corner');
  var cornerPrevEl = document.getElementById('corner-prev');
  var dotsEl  = document.getElementById('dots');
  var numEl   = document.getElementById('page-num');
  var tocEl   = document.getElementById('toc');
  var btnPrev = document.getElementById('btn-prev');
  var btnNext = document.getElementById('btn-next');

  /* 纯图文绘本：无语音朗读、无背景音乐、无音效。
   * unlocked 仅用于标记用户已进入绘本（无实质用途，保留以最小化改动）。 */
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

  /* 邻近几页的图先取下来：翻到时才不会先白一下再出图 */
  function preloadAround(i) {
    for (var d = -2; d <= 2; d++) {
      if (!d) continue;
      var p = PAGES[i + d];
      if (p && p.img && !p.__pl) {
        p.__pl = 1;
        var im = new Image();
        im.src = p.img;
      }
    }
  }

  function render(p) {
    var html = '';
    if (p.kind === 'cover') {
      html =
        '<div class="cover">' +
          '<img class="cover__img" src="' + p.img + '" alt="封面">' +
          '<h1 class="cover__t">' + esc(p.title) + '</h1>' +
          '<p class="cover__s">' + esc(p.sub) + '</p>' +
          '<div class="cover__rule"></div>' +
          '<p class="cover__d">' + sayHTML(p.say) + '</p>' +
          '<button class="cover__go" id="btn-start" type="button">开 卷</button>' +
        '</div>';
      pageEl.className = 'page page--cover';
    } else if (p.kind === 'colophon') {
      html =
        '<div class="colophon">' +
          '<h2 class="colophon__t">' + esc(p.title) + '</h2>' +
          p.colophon.map(function (c) {
            return '<div class="colo"><div class="colo__k">' + esc(c[0]) + '</div>' +
                   '<div class="colo__v">' + esc(c[1]) + '</div></div>';
          }).join('') +
        '</div>';
      pageEl.className = 'page page--colophon';
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
      pageEl.className = 'page';
    }
    pageEl.innerHTML = html;

    // 换境 → 纸色过渡；再让这一页的内容缓缓浮出（先摘类再强制回流，动画才会重播）
    pageEl.setAttribute('data-scene', sceneKey(p));
    pageEl.classList.remove('is-in');
    void pageEl.offsetWidth;
    pageEl.classList.add('is-in');
    preloadAround(idx);

    var st = document.getElementById('btn-start');
    if (st) st.addEventListener('click', function () {
      unlocked = true;
      go(1);
    });
  }

  function updateChrome() {
    numEl.textContent = (idx + 1) + ' / ' + TOTAL;
    btnPrev.disabled = idx === 0;
    btnNext.disabled = idx === TOTAL - 1;
    if (cornerEl) cornerEl.classList.toggle('is-off', idx === TOTAL - 1);
    if (cornerPrevEl) cornerPrevEl.classList.toggle('is-off', idx === 0);
    var dots = dotsEl.children;
    for (var i = 0; i < dots.length; i++) dots[i].classList.toggle('is-on', i === idx);
    var items = tocEl.children;
    for (var j = 0; j < items.length; j++) items[j].classList.toggle('is-on', j === idx);
  }

  /* ---------------- 翻页：交给 flip.js 做仿实体书的纸 ---------------- */
  /* 把一页连壳取出，用作"纸的一面"（去掉 id，免得页里出现两个 #page） */
  function snap() { return pageEl.outerHTML.replace(/ id="page"/, ''); }

  function flipPrepare(dir) {
    var n = idx + dir;
    if (n < 0 || n >= TOTAL) return null;
    var old = snap();                 // 当前这一页
    var keep = idx;
    idx = n;
    render(PAGES[idx]);               // 借渲染区取出目标页内容
    var neo = snap();
    var narrow = !!(window.matchMedia && window.matchMedia('(max-width:860px)').matches);
    if (narrow) {
      // 窄屏整页都是纸，底下直接铺目标页
    } else {
      render(PAGES[keep]);            // 桌面跨页：底下保持当前页，右半由 next 层提前露出
    }
    updateChrome();
    localStorage.setItem('shanhai-page', idx);
    return { a: old, b: neo };
  }

  function flipReveal() {}            // "下一页"半边由 flip.js 填，这里不用做事

  function flipCommit() {
    render(PAGES[idx]);               // 纸落定：底下真正换成目标页
  }

  function flipCancel(dir) {          // 拖了一半又放回去
    idx -= dir;
    render(PAGES[idx]);
    updateChrome();
    localStorage.setItem('shanhai-page', idx);
  }

  function go(delta) {
    if (Math.abs(delta) !== 1) { jump(idx + delta); return; }
    if (window.Flip) { Flip.go(delta > 0 ? 1 : -1); return; }
    // 兜底：没有翻页引擎时直接切
    var n = idx + delta;
    if (n < 0 || n >= TOTAL) return;
    idx = n; render(PAGES[idx]); updateChrome(); flipCommit();
  }

  function jump(i) {
    if (i === idx) return;
    if (Math.abs(i - idx) === 1) { go(i - idx); return; }
    idx = i;
    render(PAGES[idx]);
    updateChrome();
    localStorage.setItem('shanhai-page', idx);
    flipCommit();
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

  /* ---------------- 翻页交互 ---------------- */
  btnPrev.addEventListener('click', function () { unlocked = true; go(-1); });
  btnNext.addEventListener('click', function () { unlocked = true; go(1); });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowRight' || e.key === 'PageDown') { go(1); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { go(-1); }
    else if (e.key === 'Escape') { closeSheets(); }
  });

  /* 翻页引擎：纸的分段卷曲、投影、微光都在 flip.js 里，这里只喂内容 */
  if (window.Flip) {
    Flip.init({
      stage: stageEl, book: bookEl, flip: flipEl, front: frontEl, back: backEl,
      cast: castEl, spine: spineEl, corner: cornerEl, cornerPrev: cornerPrevEl, next: document.getElementById('next-half'),
      prepare: flipPrepare, commit: flipCommit, cancel: flipCancel, reveal: flipReveal
    });
  }
  // 书口翘角 = 翻下一页的快捷入口
  if (cornerEl) {
    cornerEl.addEventListener('click', function () { unlocked = true; go(1); });
  }
  // 左侧翘角 = 翻上一页
  if (cornerPrevEl) {
    cornerPrevEl.addEventListener('click', function () { unlocked = true; go(-1); });
  }

  // 不支持 Pointer Events 的老浏览器：退回"滑动一下翻一页"
  if (!window.PointerEvent && stageEl) {
    var tx = 0, ty = 0, tracking = false;
    stageEl.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) return;
      tx = e.touches[0].clientX; ty = e.touches[0].clientY; tracking = true;
    }, { passive: true });
    stageEl.addEventListener('touchend', function (e) {
      if (!tracking) return;
      tracking = false;
      var t = e.changedTouches[0];
      var dx = t.clientX - tx, dy = t.clientY - ty;
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) {
        unlocked = true;
        go(dx < 0 ? 1 : -1);
      }
    }, { passive: true });
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
})();
