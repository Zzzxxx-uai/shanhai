/* ===========================================================
 * 《山海舆图 · 先民观》有声绘本 · 交互与朗读
 * 纯原生 JS：翻页 + 人声讲述（Web Speech API）+ 目录 + 设置
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
  var dotsEl  = document.getElementById('dots');
  var numEl   = document.getElementById('page-num');
  var tocEl   = document.getElementById('toc');
  var btnSay  = document.getElementById('btn-say');
  var btnPrev = document.getElementById('btn-prev');
  var btnNext = document.getElementById('btn-next');
  var hintEl  = document.getElementById('foot-hint');

  /* ---------------- 讲述（Web Speech API / 真人录音） ---------------- */
  var synth = window.speechSynthesis;
  var supported = !!synth && typeof window.SpeechSynthesisUtterance === 'function';
  var AUDIO = window.AUDIO || {};        // 已导入的真人录音：{页号: 'assets/audio/p01.mp3'}
  var voices = [], curVoice = null;
  var rate = 0.92, auto = true, unlocked = false;
  var sentences = [], offsets = [], plain = '';
  var si = 0, playing = false, paused = false;
  var media = 'tts';                     // 'tts' 合成语音 | 'audio' 真人录音
  var audioEl = null, boundaryHit = false, usedFallback = false;

  function splitSentences(t) {
    var out = [], buf = '';
    for (var i = 0; i < t.length; i++) {
      buf += t.charAt(i);
      if ('。！？；'.indexOf(t.charAt(i)) >= 0) { out.push(buf); buf = ''; }
    }
    if (buf.replace(/\s/g, '')) out.push(buf);
    return out;
  }

  function isZh(v) { return v && /^zh/i.test(v.lang || ''); }

  /* 音色排序：自然/神经网络音色远胜传统 SAPI 音色（后者就是"人机感"的主因）。
   * 命中越靠前越优先；用户手动选过则尊重用户选择。 */
  var VOICE_RANK = [
    /Natural|Neural|神经/i,
    /Xiaoxiao|晓晓/i,
    /Yunxi|云希|Yunjian|云健|Yunyang|云扬/i,
    /Xiaoyi|晓伊|Xiaomo|晓墨/i,
    /Huihui|慧慧/i,
    /Yaoyao|瑶瑶/i,
    /Tingting|Ting-Ting|婷婷/i,
    /Kangkang|康康/i
  ];

  function voiceScore(v) {
    for (var i = 0; i < VOICE_RANK.length; i++) {
      if (VOICE_RANK[i].test(v.name)) return VOICE_RANK.length - i;
    }
    return 0;
  }

  function loadVoices() {
    if (!supported) return;
    voices = synth.getVoices() || [];
    if (!voices.length) return;
    var sel = document.getElementById('set-voice');
    var saved = localStorage.getItem('shanhai-voice');
    var list = voices.filter(isZh).slice().sort(function (a, b) {
      return voiceScore(b) - voiceScore(a);
    });
    sel.innerHTML = '';
    list.forEach(function (v) {
      var o = document.createElement('option');
      o.value = v.name;
      var natural = /Natural|Neural/i.test(v.name);
      o.textContent = v.name
        .replace(/Microsoft |Online \(|\)|—/g, '')
        .replace(/\s+/g, ' ')
        .trim() + (natural ? '（自然音色）' : '');
      sel.appendChild(o);
    });
    curVoice = voices.filter(function (v) { return v.name === saved; })[0] || null;
    if (!curVoice) curVoice = list[0] || null;
    if (curVoice) sel.value = curVoice.name;
    updateHint();
  }

  function highlight(i) {
    var sens = pageEl.querySelectorAll('.sen');
    for (var k = 0; k < sens.length; k++) sens[k].classList.toggle('is-on', k === i);
  }
  function clearHL() {
    var sens = pageEl.querySelectorAll('.sen');
    for (var k = 0; k < sens.length; k++) sens[k].classList.remove('is-on');
  }

  /* 把整页正文拆句并记录每句起始偏移，供高亮与「从这句开始念」定位 */
  function buildText(text) {
    sentences = splitSentences(text || '');
    offsets = []; plain = '';
    var acc = 0;
    for (var i = 0; i < sentences.length; i++) {
      offsets.push(acc);
      acc += sentences[i].length;
    }
    plain = sentences.join('');
  }

  /* 讲述时把背景音乐压低（ducking），讲完再缓慢回升 */
  function bgmDuck(on) {
    try { if (window.BGM && BGM.duck) BGM.duck(!!on); } catch (e) {}
  }

  function applyVoice(u) {
    if (curVoice) u.voice = curVoice;
    u.lang = (curVoice && curVoice.lang) || 'zh-CN';
    u.rate = rate;
    u.pitch = 1;
    u.volume = 1;
  }

  function highlightAt(ci) {
    var k = 0;
    for (var i = 0; i < sentences.length; i++) {
      if (ci >= offsets[i]) k = i; else break;
    }
    highlight(k);
  }

  /* 整页一次成句：引擎自带句间停顿与语调，比逐句拼接自然得多 */
  function speakWhole(from) {
    if (!playing || media !== 'tts') return;
    var base = offsets[from] || 0;
    highlight(from);
    var u = new SpeechSynthesisUtterance(plain.slice(base));
    applyVoice(u);
    u.onboundary = function (e) {
      if (typeof e.charIndex !== 'number') return;
      boundaryHit = true;
      highlightAt(base + e.charIndex);
    };
    u.onend = function () {
      if (media !== 'tts' || !playing) return;
      clearHL(); playing = false; paused = false; updateSayBtn(); bgmDuck(false);
    };
    u.onerror = function () {
      if (media !== 'tts' || !playing) return;
      clearHL(); playing = false; paused = false; updateSayBtn(); bgmDuck(false);
    };
    try { synth.speak(u); } catch (e) { stop(); return; }

    /* 部分引擎（尤其 iOS Safari）不派发 boundary，高亮会僵在第一句。
     * 1.8 秒内没有 boundary 就退回逐句播放，保证高亮仍跟着念。 */
    setTimeout(function () {
      if (media !== 'tts' || !playing || paused || boundaryHit || usedFallback) return;
      usedFallback = true;
      try { synth.cancel(); } catch (e) {}
      speakSentence(from);
    }, 1800);
  }

  /* 退路：逐句播放（语调略生硬，但跨浏览器最稳） */
  function speakSentence(from) {
    si = from;
    if (!playing || media !== 'tts') return;
    if (si >= sentences.length) { clearHL(); playing = false; updateSayBtn(); bgmDuck(false); return; }
    highlight(si);
    var u = new SpeechSynthesisUtterance(sentences[si]);
    applyVoice(u);
    u.onend = function () { if (!playing || media !== 'tts') return; si++; speakSentence(si); };
    u.onerror = function () { if (!playing || media !== 'tts') return; si++; speakSentence(si); };
    try { synth.speak(u); } catch (e) { stop(); }
  }

  /* ---- 真人录音播放：按句长比例把音频时长映射到句子上，实现同样高亮 ---- */
  function playAudio(src, from) {
    media = 'audio';
    if (!audioEl) { audioEl = new Audio(); audioEl.preload = 'auto'; }
    var tot = 0, w = 0, i;
    for (i = 0; i < sentences.length; i++) tot += sentences[i].length;
    for (i = 0; i < (from || 0); i++) w += sentences[i].length;

    audioEl.pause();
    audioEl.src = src;
    audioEl.playbackRate = rate;
    highlight(from || 0);          // 先点亮起始句，别等 timeupdate
    if (from > 0 && tot) {
      audioEl.onloadedmetadata = function () {
        if (audioEl.duration) audioEl.currentTime = audioEl.duration * (w / tot);
        audioEl.play().catch(function () {});
      };
    }
    audioEl.ontimeupdate = function () {
      if (!audioEl.duration || !tot) return;
      var t = audioEl.currentTime / audioEl.duration, acc = 0, k = 0;
      for (var j = 0; j < sentences.length; j++) {
        acc += sentences[j].length / tot;
        if (t <= acc) { k = j; break; }
        k = j;
      }
      highlight(k);
    };
    audioEl.onended = function () {
      if (media !== 'audio') return;
      clearHL(); playing = false; paused = false; updateSayBtn(); bgmDuck(false);
    };
    try { audioEl.play().catch(function () {}); } catch (e) {}
  }

  function speakFrom(start) {
    var p = PAGES[idx];
    if (!p || !p.say) return;
    buildText(p.say);
    si = start || 0;
    playing = true; paused = false;
    unlocked = true;
    if (synth) { try { synth.cancel(); } catch (e) {} }

    // 该页有真人录音 → 优先放录音，合成语音只作兜底
    var src = AUDIO[idx + 1] || AUDIO[idx];
    if (src) { bgmDuck(true); playAudio(src, si); updateSayBtn(); return; }

    if (!supported) { playing = false; updateSayBtn(); bgmDuck(false); return; }
    media = 'tts'; boundaryHit = false; usedFallback = false;
    bgmDuck(true);
    updateSayBtn();
    speakWhole(si);
  }

  function stop(keepBtn) {
    playing = false; paused = false;
    if (synth) { try { synth.cancel(); } catch (e) {} }
    if (audioEl) {
      try { audioEl.pause(); audioEl.currentTime = 0; } catch (e) {}
    }
    clearHL();
    bgmDuck(false);
    if (!keepBtn) updateSayBtn();
  }

  function toggleSay() {
    unlocked = true;
    if (playing && !paused) {
      paused = true;
      if (media === 'audio' && audioEl) { try { audioEl.pause(); } catch (e) {} }
      else if (synth) synth.pause();
      bgmDuck(false);
      updateSayBtn(); return;
    }
    if (paused) {
      paused = false;
      if (media === 'audio' && audioEl) { audioEl.play().catch(function () {}); }
      else if (synth) synth.resume();
      bgmDuck(true);
      updateSayBtn(); return;
    }
    if (!supported && !Object.keys(AUDIO).length) {
      alert('当前浏览器不支持语音朗读，可静默阅读。');
      return;
    }
    speakFrom(0);
  }

  function updateSayBtn() {
    var hasAudio = Object.keys(AUDIO).length > 0;
    if (!supported && !hasAudio) { btnSay.style.display = 'none'; return; }
    btnSay.style.display = '';
    btnSay.textContent = (playing && !paused) ? '暂停' : (paused ? '继续' : '朗读');
    btnSay.classList.toggle('is-on', playing && !paused);
  }

  function updateHint() {
    if (!hintEl) return;
    var hasAudio = Object.keys(AUDIO).length > 0;
    if (hasAudio) {
      hintEl.textContent = '左右滑动翻页 · 键盘 ← → · 翻页后自动讲述（真人录音）';
      return;
    }
    if (!supported) { hintEl.textContent = '当前设备不支持语音朗读，可静默阅读'; return; }
    var zh = voices.filter(isZh).length;
    var natural = curVoice && /Natural|Neural/i.test(curVoice.name);
    hintEl.textContent = zh
      ? '左右滑动翻页 · 键盘 ← → · 翻页后自动讲述' + (natural ? '（自然音色）' : '')
      : '未检测到中文语音，可在系统设置中安装中文语音包';
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
    buildText(p.say);          // 先备好句子与偏移，录音高亮与「点句起念」都依赖它
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
      if (auto) setTimeout(function () { speakFrom(0); }, 420);
    });
    // 点句即从该句讲起
    var sens = pageEl.querySelectorAll('.sen');
    for (var i = 0; i < sens.length; i++) {
      (function (i) {
        sens[i].addEventListener('click', function () {
          if (!supported && !Object.keys(AUDIO).length) return;
          unlocked = true;
          if (PAGES[idx].kind === 'colophon') return;
          speakFrom(i);
        });
      })(i);
    }
  }

  function updateChrome() {
    numEl.textContent = (idx + 1) + ' / ' + TOTAL;
    btnPrev.disabled = idx === 0;
    btnNext.disabled = idx === TOTAL - 1;
    if (cornerEl) cornerEl.classList.toggle('is-off', idx === TOTAL - 1);
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
    stop();
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
    if (auto && unlocked && PAGES[idx] && PAGES[idx].kind !== 'colophon') {
      setTimeout(function () { speakFrom(0); }, 420);
    }
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
    stop(); idx = n; render(PAGES[idx]); updateChrome(); flipCommit();
  }

  function jump(i) {
    if (i === idx) return;
    if (Math.abs(i - idx) === 1) { go(i - idx); return; }
    stop();
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
        if (auto) setTimeout(function () { speakFrom(0); }, 420);
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
    document.getElementById('sheet-set').hidden = true;
  }
  document.getElementById('btn-toc').addEventListener('click', function () {
    document.getElementById('sheet-toc').hidden = false;
  });
  document.getElementById('btn-set').addEventListener('click', function () {
    document.getElementById('sheet-set').hidden = false;
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-close]'), function (b) {
    b.addEventListener('click', closeSheets);
  });
  Array.prototype.forEach.call(document.querySelectorAll('.sheet'), function (s) {
    s.addEventListener('click', function (e) { if (e.target === s) s.hidden = true; });
  });

  /* ---------------- 设置 ---------------- */
  document.getElementById('set-voice').addEventListener('change', function (e) {
    curVoice = voices.filter(function (v) { return v.name === e.target.value; })[0] || null;
    localStorage.setItem('shanhai-voice', e.target.value);
    if (playing) speakFrom(si);
  });
  document.getElementById('set-rate').addEventListener('input', function (e) {
    rate = parseFloat(e.target.value);
    document.getElementById('set-rate-val').textContent = rate.toFixed(2);
    localStorage.setItem('shanhai-rate', rate);
    if (playing && !paused) speakFrom(si);
  });
  document.getElementById('set-auto').addEventListener('change', function (e) {
    auto = e.target.checked;
    localStorage.setItem('shanhai-auto', auto ? '1' : '0');
  });

  /* 背景音乐：开关与音量 */
  var bgmBox = document.getElementById('set-bgm');
  var bgmVol = document.getElementById('set-bgmvol');
  var bgmVolVal = document.getElementById('set-bgmvol-val');
  if (bgmBox && window.BGM) {
    bgmBox.checked = BGM.isEnabled();
    bgmBox.addEventListener('change', function (e) { BGM.setEnabled(e.target.checked); });
    if (bgmVol) {
      var bv = Math.round(BGM.getVolume() * 100);
      bgmVol.value = bv;
      if (bgmVolVal) bgmVolVal.textContent = bv;
      bgmVol.addEventListener('input', function (e) {
        var v = parseInt(e.target.value, 10) || 0;
        if (bgmVolVal) bgmVolVal.textContent = v;
        BGM.setVolume(v / 100);
      });
    }
  }

  /* 纸张沙沙声与微光薄雾 */
  var sfxBox = document.getElementById('set-sfx');
  var mistBox = document.getElementById('set-mist');
  if (sfxBox && window.Flip) {
    var s0 = localStorage.getItem('shanhai-sfx');
    sfxBox.checked = s0 !== '0';
    Flip.sound(sfxBox.checked);
    sfxBox.addEventListener('change', function (e) {
      Flip.sound(e.target.checked);
      localStorage.setItem('shanhai-sfx', e.target.checked ? '1' : '0');
    });
  }
  if (mistBox && window.Flip) {
    var m0 = localStorage.getItem('shanhai-mist');
    mistBox.checked = m0 !== '0';
    Flip.mist(mistBox.checked);
    mistBox.addEventListener('change', function (e) {
      Flip.mist(e.target.checked);
      localStorage.setItem('shanhai-mist', e.target.checked ? '1' : '0');
    });
  }

  /* ---------------- 翻页交互 ---------------- */
  btnPrev.addEventListener('click', function () { unlocked = true; go(-1); });
  btnNext.addEventListener('click', function () { unlocked = true; go(1); });
  btnSay.addEventListener('click', toggleSay);

  document.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowRight' || e.key === 'PageDown') { go(1); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { go(-1); }
    else if (e.key === 'Escape') { closeSheets(); }
  });

  /* 翻页引擎：纸的分段卷曲、投影、微光都在 flip.js 里，这里只喂内容 */
  if (window.Flip) {
    Flip.init({
      stage: stageEl, book: bookEl, flip: flipEl, front: frontEl, back: backEl,
      cast: castEl, spine: spineEl, corner: cornerEl, next: document.getElementById('next-half'),
      prepare: flipPrepare, commit: flipCommit, cancel: flipCancel, reveal: flipReveal
    });
  }
  // 书口翘角 = 翻下一页的快捷入口
  if (cornerEl) {
    cornerEl.addEventListener('click', function () { unlocked = true; go(1); });
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
  var sr = parseFloat(localStorage.getItem('shanhai-rate'));
  if (sr) { rate = sr; document.getElementById('set-rate').value = sr; document.getElementById('set-rate-val').textContent = sr.toFixed(2); }
  var sa = localStorage.getItem('shanhai-auto');
  if (sa !== null) { auto = sa === '1'; document.getElementById('set-auto').checked = auto; }

  buildIndex();
  render(PAGES[idx]);
  updateChrome();
  updateSayBtn();

  // 开场短片放完，书轻轻落定
  document.addEventListener('intro:done', function () {
    if (!bookEl) return;
    bookEl.classList.add('is-in');
    setTimeout(function () { bookEl.classList.remove('is-in'); }, 1100);
  });

  if (supported) {
    loadVoices();
    if (typeof synth.onvoiceschanged !== 'undefined') {
      synth.onvoiceschanged = loadVoices;
    }
    setTimeout(loadVoices, 400);   // 部分浏览器 voices 异步就绪
  } else {
    document.getElementById('set-note').textContent =
      '当前浏览器不支持语音合成，无法启用人声讲述；文字内容可正常阅读。';
    updateHint();
  }

  // 离开页面时停止朗读，避免后台继续发声
  window.addEventListener('beforeunload', function () { if (supported) synth.cancel(); });
})();
