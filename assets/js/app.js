/* ===========================================================
 * 《山海舆图 · 先民观》主逻辑
 * -----------------------------------------------------------
 * 层级：首页 → 山海舆图 → 知识卡（弹层）→ 时间线 → 结语
 * 技术：原生 JS + CSS transform 视差 + Canvas 粒子
 * =========================================================== */
(function () {
  'use strict';

  var D = window.SHANHAI_DATA;

  /* ---------------- DOM ---------------- */
  var pages = {
    cover:    document.getElementById('page-cover'),
    map:      document.getElementById('page-map'),
    timeline: document.getElementById('page-timeline'),
    ending:   document.getElementById('page-ending')
  };
  var viewport = document.getElementById('viewport');
  var track    = document.getElementById('track');
  var layers   = Array.prototype.slice.call(track.querySelectorAll('.layer'));
  var nodeLayer= document.getElementById('node-layer');
  var bar      = document.getElementById('progress-bar');
  var hint     = document.getElementById('map-hint');
  var modal    = document.getElementById('modal');

  var inkCanvas = document.getElementById('ink-canvas');
  var current = 'cover';
  var visited = {};

  /* ---------------- 墨迹粒子 ---------------- */
  var particles = new window.InkParticles(inkCanvas);
  var lowMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!lowMotion) particles.start();

  /* 时间线是长文页，墨点浮在字上会显脏，这一页收起粒子 */
  function setParticles(on) {
    inkCanvas.style.display = on ? 'block' : 'none';
    if (on) { if (!lowMotion) particles.start(); }
    else { particles.stop(); }
  }

  /* =========================================================
   * 页面切换
   * ========================================================= */
  function go(name) {
    if (!pages[name]) return;
    Object.keys(pages).forEach(function (k) {
      pages[k].classList.toggle('is-active', k === name);
    });
    current = name;

    if (name === 'map') {
      layoutMap();
      setParticles(true);
    } else if (name === 'timeline') {
      setParticles(false);
      animateTimeline();
    } else if (name === 'ending') {
      setParticles(true);
      animateEnding();
    } else {
      setParticles(true);
    }
  }

  /* =========================================================
   * 首页：启卷
   * ========================================================= */
  document.getElementById('btn-open').addEventListener('click', function () {
    var cover = pages.cover;
    cover.classList.add('is-opening');
    var wait = lowMotion ? 0 : 900;
    setTimeout(function () {
      go('map');
      setTimeout(function () { cover.classList.remove('is-opening'); }, 700);
    }, wait);
  });

  /* =========================================================
   * 山海舆图：布局 / 视差 / 节点
   * ========================================================= */
  /* ---- 长卷尺度（改这里就能调整游历节奏） ---- */
  var TRACK_RATIO = 3;      // 长卷总宽 = 视口宽 × N
  var NODE_SPEED  = 0.8;    // 节点层视差速度，须与 index.html 的 data-speed 一致
  var NODE_CENTER = 0.5;    // 节点滚到自身进度时，停在视口的横向位置（0.5 = 正中）
  var END_MARK_AT = 0.82;   // 卷末标记在长卷上的位置

  function trackWidth() {
    return Math.round((viewport.clientWidth || window.innerWidth) * TRACK_RATIO);
  }
  function maxScroll() {
    return Math.max(trackWidth() - (viewport.clientWidth || window.innerWidth), 1);
  }

  function layoutMap() {
    var w = trackWidth();
    track.style.width = w + 'px';
    layers.forEach(function (l) { l.style.width = w + 'px'; });
    placeNodes();
    updateParallax();
  }

  /* 节点定位：不手写百分比，按视差速度反算，保证每个节点都滚得到、且居中。
   * 节点屏幕位置 = left + translateX(scrollLeft*(1-speed)) - scrollLeft
   *              = left - speed*scrollLeft
   * 令 scrollLeft = t*maxScroll 时落在 NODE_CENTER 处：
   *   left = NODE_CENTER*vw + speed*t*maxScroll
   * 手写 x 百分比会让末位节点被推出可视范围（这是踩过的坑，别改回去）。 */
  function placeNodes() {
    var vw = viewport.clientWidth || window.innerWidth;
    var W = trackWidth(), S = maxScroll();
    D.nodes.forEach(function (n) {
      var el = nodeEls[n.id];
      if (!el) return;
      var leftAbs = NODE_CENTER * vw + NODE_SPEED * n.t * S;
      el.style.left = (leftAbs / W * 100) + '%';
      el.style.top = n.y + '%';
    });
    var em = document.querySelector('.end-mark');
    if (em) em.style.left = (END_MARK_AT * 100) + '%';
  }

  /* 把第 i 个节点滚到视口中央 */
  function scrollToNode(i, smooth) {
    var target = D.nodes[i].t * maxScroll();
    var behavior = (smooth && !lowMotion) ? 'smooth' : 'auto';
    if (viewport.scrollTo) {
      try { viewport.scrollTo({ left: target, behavior: behavior }); return; }
      catch (e) { /* 老浏览器降级 */ }
    }
    viewport.scrollLeft = target;
  }

  /* 2.5D 视差：远景慢、近景快
   * 元素本就跟着 scrollLeft 走（相当于 speed = 1），
   * 想让它只走 speed 倍，就补一个反向位移 scrollLeft*(1-speed)。 */
  function updateParallax() {
    var sl = viewport.scrollLeft;
    for (var i = 0; i < layers.length; i++) {
      var speed = parseFloat(layers[i].dataset.speed) || 1;
      layers[i].style.transform = 'translateX(' + (sl * (1 - speed)) + 'px)';
    }
    var max = viewport.scrollWidth - viewport.clientWidth;
    bar.style.width = (max > 0 ? (sl / max) * 100 : 0) + '%';
    hint.style.opacity = sl > 40 ? 0.25 : 1;
  }

  var ticking = false;
  viewport.addEventListener('scroll', function () {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () { updateParallax(); ticking = false; });
  }, { passive: true });

  /* 桌面鼠标拖拽横向游历（触屏交给原生滚动，避免冲突）
   * 坑（已修）：不能在 pointerdown 就加 is-dragging —— 那条 CSS 会给子元素上
   * pointer-events:none，mouseup 落到下层，click 便派发不到节点按钮上，
   * 表现就是「用鼠标怎么点都点不开」。必须等位移超过阈值才判定为拖拽。 */
  var DRAG_THRESHOLD = 5;
  var dragStartX = null, dragStartLeft = 0, dragActive = false, suppressClick = false;

  viewport.addEventListener('pointerdown', function (e) {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    dragStartX = e.clientX; dragStartLeft = viewport.scrollLeft; dragActive = false;
  });
  window.addEventListener('pointermove', function (e) {
    if (dragStartX === null) return;
    var dx = e.clientX - dragStartX;
    if (!dragActive) {
      if (Math.abs(dx) < DRAG_THRESHOLD) return;   // 手抖不算拖，仍然点得开
      dragActive = true;
      viewport.classList.add('is-dragging');
    }
    viewport.scrollLeft = dragStartLeft - dx;
  });
  function endDrag() {
    if (dragStartX === null) return;
    suppressClick = dragActive;      // 刚拖完的那下 click 要吃掉，别误开弹层
    dragActive = false; dragStartX = null;
    viewport.classList.remove('is-dragging');
    if (suppressClick) setTimeout(function () { suppressClick = false; }, 0);
  }
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
  document.addEventListener('click', function (e) {
    if (suppressClick) { e.stopPropagation(); e.preventDefault(); }
  }, true);

  /* 鼠标滚轮 → 横向游历 */
  viewport.addEventListener('wheel', function (e) {
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;   // 触控板横向：交给原生
    e.preventDefault();
    viewport.scrollLeft += e.deltaY;
  }, { passive: false });

  var nodeEls = {};   // id -> 按钮元素（供 placeNodes 复用）

  /* 渲染舆图节点 */
  function renderNodes() {
    D.nodes.forEach(function (n, i) {
      var btn = document.createElement('button');
      btn.className = 'node';
      btn.type = 'button';
      btn.innerHTML =
        '<span class="node__dot"></span>' +
        '<span class="node__label">' + n.name + '</span>' +
        '<span class="node__source">' + n.source + '</span>';
      btn.setAttribute('aria-label', n.name + '，' + n.source + '，查看本境 ' + n.beasts.length + ' 种异兽');
      btn.addEventListener('click', function () {
        visited[n.id] = true;
        btn.classList.add('is-visited');
        openPlace(i);
      });
      nodeEls[n.id] = btn;
      nodeLayer.appendChild(btn);
    });
  }

  /* =========================================================
   * 弹层：两级 —— 地点（本境异兽一览） → 异兽（故事与考据）
   * ========================================================= */
  var staggerTimers = [];
  var curNode  = -1;   // 当前地点索引
  var curBeast = -1;   // 当前异兽在该地点 beasts 数组内的索引（-1 = 在地点视图）

  var viewPlace = document.getElementById('view-place');
  var viewBeast = document.getElementById('view-beast');
  var cardEl    = document.getElementById('modal-card');

  /* ---------- 收集进度：已识几只 / 共几只 ---------- */
  var BEAST_KEYS = (function () {
    var seen = {}, out = [];
    D.nodes.forEach(function (n) {
      n.beasts.forEach(function (k) { if (!seen[k]) { seen[k] = 1; out.push(k); } });
    });
    return out;
  })();

  function readCount() {
    var c = 0;
    BEAST_KEYS.forEach(function (k) { if (visited[k]) c++; });
    return c;
  }
  function readInNode(node) {
    var c = 0;
    node.beasts.forEach(function (k) { if (visited[k]) c++; });
    return c;
  }
  function updateStats() {
    var c = readCount(), total = BEAST_KEYS.length;
    var el = document.getElementById('stat-count');
    if (el) {
      el.textContent = '已识 ' + c + ' / ' + total;
      el.classList.toggle('is-full', c === total);   // 集齐后变朱红
    }
    if (bar && bar.parentNode) bar.parentNode.classList.toggle('is-full', c === total);
  }

  function showView(which) {
    viewPlace.classList.toggle('is-active', which === 'place');
    viewBeast.classList.toggle('is-active', which === 'beast');
    if (cardEl) cardEl.scrollTop = 0;   // 换视图回到顶部，否则会停在上一屏的位置
  }

  function clearStagger() {
    staggerTimers.forEach(clearTimeout);
    staggerTimers = [];
  }

  /* ---------- 视图一：地点 —— 本境全部异兽 ---------- */
  function openPlace(i, opts) {
    opts = opts || {};
    var node = D.nodes[i];
    if (!node) return;
    curNode = i;
    curBeast = -1;

    document.getElementById('kc-source').textContent = node.source;
    document.getElementById('modal-title').textContent = node.name;
    document.getElementById('kc-focus').textContent  = node.focus;
    document.getElementById('kc-intro').textContent  = node.intro;
    document.getElementById('pl-count').textContent  =
      '本境 ' + node.beasts.length + ' 种异兽 · 已识 ' + readInNode(node);
    document.getElementById('kc-pos').textContent    = (i + 1) + ' / ' + D.nodes.length;
    document.getElementById('kc-prev').disabled = (i === 0);
    document.getElementById('kc-next').disabled = (i === D.nodes.length - 1);

    var grid = document.getElementById('beast-grid');
    grid.innerHTML = '';
    node.beasts.forEach(function (key, k) {
      var b = D.beasts[key];
      var li  = document.createElement('li');
      var btn = document.createElement('button');
      btn.className = 'beast-card' + (visited[key] ? ' is-read' : '');
      btn.type = 'button';
      btn.innerHTML =
        '<span class="beast-card__frame"><img src="' + b.img + '" alt="' + b.name + '白描图" loading="lazy"></span>' +
        '<span class="beast-card__name">' + b.name + '<em class="beast-card__py">' + (b.pinyin || '') + '</em></span>' +
        '<span class="beast-card__at">' + b.at + '</span>' +
        '<span class="beast-card__quote">' + b.origin + '</span>';
      btn.setAttribute('aria-label', b.name + '，出自' + b.at + '，查看故事与考据');
      btn.addEventListener('click', function () { openBeast(i, k); });
      li.appendChild(btn);
      grid.appendChild(li);
    });

    showView('place');
    modal.classList.add('is-open');
    document.body.style.overflow = 'hidden';
    if (opts.scroll !== false) scrollToNode(i, true);   // 关掉弹层后眼前就是这一处
  }

  /* ---------- 视图二：异兽 —— 先民故事 + 四层考据 ---------- */
  function openBeast(i, k) {
    var node = D.nodes[i];
    if (!node) return;
    var key = node.beasts[k];
    var b = D.beasts[key];
    if (!b) return;

    curNode = i;
    curBeast = k;
    visited[key] = true;
    if (nodeEls[node.id]) nodeEls[node.id].classList.add('is-visited');

    document.getElementById('back-place').textContent = node.name;

    var img = document.getElementById('kc-img');
    img.src = b.img;
    img.alt = b.name + '白描图';
    document.getElementById('kc-beast-name').textContent    = b.name;
    document.getElementById('kc-beast-py').textContent      = b.pinyin || '';
    document.getElementById('kc-beast-at').textContent      = b.at;
    document.getElementById('kc-beast-zoology').textContent = b.zoology;
    document.getElementById('kc-beast-guess').textContent   = b.guess;
    document.getElementById('story-text').textContent       = b.story;

    var list = document.getElementById('kc-layers');
    list.innerHTML = '';
    D.layers.forEach(function (L, idx) {
      var li = document.createElement('li');
      li.className = 'kc-layer kc-layer--' + L.key;
      li.innerHTML =
        '<div class="kc-layer__top">' +
          '<span class="kc-layer__idx">' + (idx + 1) + '</span>' +
          '<span class="kc-layer__label">' + L.label + '</span>' +
          '<span class="kc-layer__hint">' + L.hint + '</span>' +
        '</div>' +
        '<p class="kc-layer__text">' + b[L.key] + '</p>';
      list.appendChild(li);
    });

    document.getElementById('beast-pos').textContent = (k + 1) + ' / ' + node.beasts.length;
    document.getElementById('beast-prev').disabled = (k === 0);
    document.getElementById('beast-next').disabled = (k === node.beasts.length - 1);

    showView('beast');
    modal.classList.add('is-open');
    document.body.style.overflow = 'hidden';
    updateStats();

    // 四层依次浮现
    clearStagger();
    var items = list.querySelectorAll('.kc-layer');
    if (lowMotion) {
      Array.prototype.forEach.call(items, function (el) { el.classList.add('is-in'); });
    } else {
      Array.prototype.forEach.call(items, function (el, idx) {
        staggerTimers.push(setTimeout(function () { el.classList.add('is-in'); }, 160 + idx * 130));
      });
    }
  }

  function closeCard() {
    modal.classList.remove('is-open');
    document.body.style.overflow = '';
    clearStagger();
  }

  function backToPlace() {
    if (curNode >= 0) openPlace(curNode, { scroll: false });
  }

  /* 地点间翻页 */
  document.getElementById('kc-prev').addEventListener('click', function () {
    if (curNode > 0) openPlace(curNode - 1);
  });
  document.getElementById('kc-next').addEventListener('click', function () {
    if (curNode < D.nodes.length - 1) openPlace(curNode + 1);
  });

  /* 异兽间翻页与返回 */
  document.getElementById('beast-prev').addEventListener('click', function () {
    if (curBeast > 0) openBeast(curNode, curBeast - 1);
  });
  document.getElementById('beast-next').addEventListener('click', function () {
    var n = D.nodes[curNode];
    if (n && curBeast < n.beasts.length - 1) openBeast(curNode, curBeast + 1);
  });
  document.getElementById('beast-back').addEventListener('click', backToPlace);

  modal.addEventListener('click', function (e) {
    if (e.target.hasAttribute('data-close')) closeCard();
  });

  document.addEventListener('keydown', function (e) {
    var open = modal.classList.contains('is-open');
    if (e.key === 'Escape' && open) {
      // 逐级返回：先看兽详情就退回地点，再看地点才关闭
      if (curBeast >= 0) backToPlace(); else closeCard();
      return;
    }
    if (open) {
      if (e.key === 'ArrowLeft') {
        if (curBeast >= 0) { if (curBeast > 0) openBeast(curNode, curBeast - 1); }
        else if (curNode > 0) openPlace(curNode - 1);
        return;
      }
      if (e.key === 'ArrowRight') {
        if (curBeast >= 0) {
          var n = D.nodes[curNode];
          if (n && curBeast < n.beasts.length - 1) openBeast(curNode, curBeast + 1);
        } else if (curNode < D.nodes.length - 1) openPlace(curNode + 1);
        return;
      }
      return;
    }
    if (current === 'map') {
      if (e.key === 'ArrowRight') viewport.scrollLeft += 220;
      if (e.key === 'ArrowLeft')  viewport.scrollLeft -= 220;
    }
  });

  /* =========================================================
   * 时间线 / 结语
   * ========================================================= */
  function renderTimeline() {
    var list = document.getElementById('tl-list');
    list.innerHTML = '';
    D.timeline.forEach(function (t) {
      var li = document.createElement('li');
      li.className = 'tl-item';
      li.innerHTML =
        '<span class="tl-era">' + t.era + '</span>' +
        '<h3 class="tl-title">' + t.title + '</h3>' +
        '<p class="tl-desc">' + t.desc + '</p>';
      list.appendChild(li);
    });
  }

  function animateTimeline() {
    var items = document.querySelectorAll('.tl-item');
    if (lowMotion) {
      Array.prototype.forEach.call(items, function (el) { el.classList.add('is-in'); });
      return;
    }
    Array.prototype.forEach.call(items, function (el, i) {
      setTimeout(function () { el.classList.add('is-in'); }, 120 + i * 110);
    });
  }

  function renderEnding() {
    document.getElementById('ed-title').textContent = D.ending.title;
    var box = document.getElementById('ed-lines');
    box.innerHTML = '';
    D.ending.lines.forEach(function (line) {
      var p = document.createElement('p');
      p.textContent = line;
      box.appendChild(p);
    });
    var tags = document.getElementById('ed-tags');
    tags.innerHTML = '';
    D.ending.tags.forEach(function (t) {
      var s = document.createElement('span');
      s.textContent = t;
      tags.appendChild(s);
    });
  }

  /* 结语里的「此行所遇」：把看过的异兽回响一遍，没看满则指路继续 */
  function renderMet() {
    var box = document.getElementById('ed-met');
    if (!box) return;
    var met = [], miss = [];
    BEAST_KEYS.forEach(function (k) {
      (visited[k] ? met : miss).push(D.beasts[k].name);
    });
    var html =
      '<div class="ed-met__head">' +
        '<span class="ed-met__num">' + met.length + ' / ' + BEAST_KEYS.length + '</span>' +
        '<span class="ed-met__label">此行所遇</span>' +
      '</div>';
    html += met.length
      ? '<p class="ed-met__list">' + met.join('、') + '</p>'
      : '<p class="ed-met__list ed-met__list--empty">尚未识得任何一种——回到舆图，从招摇山起步。</p>';
    html += miss.length
      ? '<p class="ed-met__miss">仍有 ' + miss.length + ' 种在舆图深处未遇：' + miss.join('、') + '。</p>'
      : '<p class="ed-met__done"><em>山海尽览</em>十五种异兽已尽数识得。你也把没见过的，认真记下来了。</p>';
    box.innerHTML = html;
    box.classList.toggle('is-full', miss.length === 0);
  }

  function animateEnding() {
    renderMet();
    var ps = document.querySelectorAll('.ed-lines p');
    if (lowMotion) {
      Array.prototype.forEach.call(ps, function (el) { el.classList.add('is-in'); });
      return;
    }
    Array.prototype.forEach.call(ps, function (el, i) {
      setTimeout(function () { el.classList.add('is-in'); }, 200 + i * 260);
    });
  }

  /* ---------------- 导航按钮 ---------------- */
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-goto]');
    if (btn) go(btn.dataset.goto);
  });
  document.getElementById('btn-restart').addEventListener('click', function () {
    Object.keys(visited).forEach(function (k) { delete visited[k]; });
    Array.prototype.forEach.call(document.querySelectorAll('.node'), function (el) {
      el.classList.remove('is-visited');
    });
    curNode = -1;
    curBeast = -1;
    updateStats();
    showView('place');
    viewport.scrollLeft = 0;
    go('cover');
  });

  /* ---------------- 初始化 ---------------- */
  renderNodes();
  renderTimeline();
  renderEnding();
  updateStats();
  layoutMap();
  showView('place');   // 弹层默认停在地点视图

  var resizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      layoutMap();
      particles.resize();
    }, 150);
  });
})();
