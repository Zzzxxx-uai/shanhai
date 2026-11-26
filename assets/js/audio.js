/* ===========================================================
 * 《山海舆图 · 先民观》—— 声音
 * -----------------------------------------------------------
 * 两样声音：
 *   1) 翻书声   assets/audio/page-flip.mp3   每次翻页响一声
 *   2) 背景乐   assets/audio/bgm.ogg / .mp3  轻柔纯音乐，64s 循环
 *
 * 两条取声通道（自动选）：
 *   · buffer  ：fetch 取文件 → decodeAudioData → WebAudio 播放。
 *              控制最细（精确循环点、增益淡入淡出、瞬时响应），
 *              线上（https）与单文件版（data:）都走这条。
 *   · element ：浏览器不允许 file:// 页面 fetch 本地文件，离线压缩包
 *              （解压后双击 index.html）自动退到 <audio> 元素 + volume。
 *
 * 必须守住的几点：
 *   · 自动播放策略：AudioContext.resume()/play() 一律放在用户第一次
 *     点击或按键里（capture 阶段监听，早于各按钮自己的 click）；
 *   · 两个文件在页面加载时就开始取，翻页时不等网络；
 *   · 翻页声同一时刻只留一声：新声响起前先把上一声 30ms 内淡掉并停住，
 *     连点不会叠成爆音；
 *   · 背景乐明显低于翻页声；静音同时管住两者，用平滑过渡，不"咔"。
 * =========================================================== */
(function () {
  'use strict';

  var SFX_SRC = 'assets/audio/page-flip.mp3';
  var BGM_OGG = 'assets/audio/bgm.ogg';
  var BGM_MP3 = 'assets/audio/bgm.mp3';

  var STORE_KEY = 'shanhai-sound';
  var SFX_VOL = 0.50;        // 翻书声：短促，可以稍响
  var MUSIC_VOL = 0.17;      // 背景乐：明显低于翻书声，只做底
  var MUSIC_FADE = 2.4;      // 起播淡入，避免"突然开始"
  var BGM_LOOP = 64.0;       // 素材正好 64s：循环点钉在这儿，顺带截掉编码器补的静音

  var AC = window.AudioContext || window.webkitAudioContext;

  /* ---------------- 状态 ---------------- */
  var enabled = true;
  try { enabled = localStorage.getItem(STORE_KEY) !== '0'; } catch (e) {}

  var mode = 'pending';          // pending | buffer | element | none
  var unlocked = false, loading = false, started = false;

  var ctx = null, master = null, sfxGain = null, musicGain = null, analyser = null;
  var sfxBuf = null, musicBuf = null;
  var sfxRaw = null, musicRaw = null;
  var sfxCur = null;             // 正在响的那一声（buffer 通道）
  var musicNode = null;
  var plays = 0;

  var elMusic = null, elSfx = null, sfxTurn = 0;
  var fadeTimer = 0;

  var listeners = [];

  function notify() {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](); } catch (e) {}
    }
  }

  /* ---------------- 公共小工具 ---------------- */
  function ramp(param, to, sec) {
    var t = ctx.currentTime;
    try {
      param.cancelScheduledValues(t);
      param.setValueAtTime(param.value, t);
      param.linearRampToValueAtTime(to, t + sec);
    } catch (e) { param.value = to; }
  }

  function bgmSrc() {
    try {
      var a = document.createElement('audio');
      if (a.canPlayType && a.canPlayType('audio/ogg; codecs="vorbis"')) return BGM_OGG;
    } catch (e) {}
    return BGM_MP3;
  }

  /* ---------------- buffer 通道：WebAudio ---------------- */
  function ensureCtx() {
    if (ctx) return ctx;
    if (!AC) return null;
    try { ctx = new AC(); } catch (e) { return null; }
    master = ctx.createGain();
    master.gain.value = enabled ? 1 : 0;
    // 串一个分析器在总线上：只为了调试时能量一下"到底有没有出声"，不影响声音
    analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    master.connect(analyser);
    analyser.connect(ctx.destination);

    sfxGain = ctx.createGain();
    sfxGain.gain.value = SFX_VOL;
    sfxGain.connect(master);

    musicGain = ctx.createGain();
    musicGain.gain.value = 0;        // 真要播时才淡上来
    musicGain.connect(master);
    return ctx;
  }

  function getBuf(url) {
    if (!url) return Promise.reject(new Error('no url'));
    if (!window.fetch) return Promise.reject(new Error('no fetch'));
    return fetch(url, { cache: 'force-cache' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.arrayBuffer();
    });
  }

  /* 老 Safari 只认回调式 decodeAudioData，新的返回 Promise —— 两头都接 */
  function decode(raw) {
    return new Promise(function (res, rej) {
      if (!raw) return rej(new Error('empty'));
      var p = ctx.decodeAudioData(raw, res, rej);
      if (p && p.then) p.then(res, rej);
    });
  }

  function decodeAll() {
    if (!ctx) return;
    if (sfxRaw && !sfxBuf) {
      decode(sfxRaw).then(function (b) { sfxBuf = b; notify(); }, function () {});
    }
    if (musicRaw && !musicBuf) {
      decode(musicRaw).then(function (b) {
        musicBuf = b;
        notify();
        if (unlocked && enabled && mode === 'buffer') startMusic();
      }, function () {});
    }
  }

  function startBufferPath() {
    var ogg = bgmSrc() === BGM_OGG;
    if (!ensureCtx()) return Promise.reject(new Error('noctx'));   // 建不出上下文就退回元素通道
    return getBuf(SFX_SRC).then(function (b) {
      sfxRaw = b;
      return getBuf(ogg ? BGM_OGG : BGM_MP3).catch(function () {
        if (!ogg) throw new Error('bgm');
        return getBuf(BGM_MP3);                 // ogg 没取到就退回 mp3
      });
    }).then(function (b) {
      musicRaw = b;
      mode = 'buffer';
      decodeAll();
      if (unlocked && enabled) startMusic();
      notify();
    });
  }

  function startMusicBuffer() {
    if (!ctx || !musicBuf || musicNode) return;
    musicNode = ctx.createBufferSource();
    musicNode.buffer = musicBuf;
    musicNode.loop = true;                 // 缓冲首尾等相位，循环处本来就接得上
    musicNode.loopStart = 0;
    // mp3 编码会在末尾补几毫秒近静音，循环过去会"卡"一下；
    // 把循环终点钉在素材真实长度上（ogg 解码正好 64s，不受影响）。
    musicNode.loopEnd = Math.min(musicBuf.duration, BGM_LOOP);
    musicNode.connect(musicGain);
    try { musicNode.start(0); } catch (e) { musicNode = null; return; }
    ramp(musicGain.gain, MUSIC_VOL, MUSIC_FADE);
    started = true;
    notify();
  }

  function flipBuffer() {
    if (!ctx || !sfxBuf) return;
    if (ctx.state === 'suspended') {          // 刚解锁就翻页：恢复后这一声照样响
      try { ctx.resume().catch(function () {}); } catch (e) {}
    }
    var t = ctx.currentTime;

    // 上一声还没放完：先 30ms 淡掉并停住，避免两声叠在一起
    if (sfxCur) {
      var old = sfxCur; sfxCur = null;
      try {
        old.gain.gain.cancelScheduledValues(t);
        old.gain.gain.setValueAtTime(old.gain.gain.value, t);
        old.gain.gain.linearRampToValueAtTime(0, t + 0.03);
        old.node.stop(t + 0.05);
      } catch (e) {}
    }

    var src = ctx.createBufferSource();
    src.buffer = sfxBuf;
    src.playbackRate.value = 0.94 + Math.random() * 0.12;   // 每次略有不同，不像复读
    var g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1, t + 0.006);           // 极短淡入，去掉起振的"咔"
    src.connect(g); g.connect(sfxGain);
    src.start(t);
    plays++;
    sfxCur = { node: src, gain: g };
    src.onended = function () { if (sfxCur && sfxCur.node === src) sfxCur = null; };
  }

  /* ---------------- element 通道：<audio> ---------------- */
  function startElementPath() {
    if (mode === 'element' || mode === 'buffer') return;
    mode = 'element';
    try {
      elMusic = new Audio(bgmSrc());
      elMusic.loop = true;
      elMusic.preload = 'auto';
      elMusic.volume = 0;
      elMusic.load();

      elSfx = [new Audio(SFX_SRC), new Audio(SFX_SRC)];
      elSfx.forEach(function (a) {
        a.preload = 'auto';
        a.volume = enabled ? SFX_VOL : 0;
        a.load();
      });
    } catch (e) { mode = 'none'; }
    if (unlocked && enabled) startMusic();
    notify();
  }

  function fadeMusicTo(to) {
    clearInterval(fadeTimer);
    if (!elMusic) return;
    var from = elMusic.volume, t0 = Date.now(), dur = MUSIC_FADE * 1000;
    fadeTimer = setInterval(function () {
      var k = Math.min(1, (Date.now() - t0) / dur);
      elMusic.volume = Math.max(0, Math.min(1, from + (to - from) * k));
      if (k >= 1) clearInterval(fadeTimer);
    }, 40);
  }

  function startMusicElement() {
    if (!elMusic || started) return;
    started = true;
    var p = elMusic.play();
    if (p && p.catch) p.catch(function () { started = false; });
    fadeMusicTo(MUSIC_VOL * (enabled ? 1 : 0));
    notify();
  }

  function flipElement() {
    if (!elSfx || !elSfx.length) return;
    // 两个元素轮换：连点时最多两声，且每声都从头放，不会无限叠加
    var a = elSfx[sfxTurn++ % elSfx.length];
    try {
      a.pause();
      a.currentTime = 0;
      a.volume = SFX_VOL;
      var p = a.play();
      if (p && p.catch) p.catch(function () {});
    } catch (e) {}
    plays++;
  }

  /* ---------------- 对外行为 ---------------- */
  function flip() {
    if (!enabled) return;
    if (mode === 'buffer') flipBuffer();
    else if (mode === 'element') flipElement();
  }

  function startMusic() {
    if (!enabled) return;
    if (mode === 'buffer') startMusicBuffer();
    else if (mode === 'element') startMusicElement();
  }

  function applyEnabled() {
    // buffer 通道：一个 master 增益管住两样声音
    if (ctx) ramp(master.gain, enabled ? 1 : 0, 0.06);

    // element 通道：直接改 volume（离线双击打开的场景，桌面浏览器支持）
    if (mode === 'element') {
      if (elSfx) elSfx.forEach(function (a) { a.volume = enabled ? SFX_VOL : 0; });
      if (enabled) {
        startMusicElement();            // 关过再开：从头接上（started 已在关时清零）
      } else {
        clearInterval(fadeTimer);
        if (elMusic) { elMusic.volume = 0; try { elMusic.pause(); } catch (e) {} }
        started = false;
      }
    }

    document.documentElement.setAttribute('data-sound', enabled ? 'on' : 'off');
    var btn = document.getElementById('btn-sound');
    if (btn) {
      btn.classList.toggle('is-off', !enabled);
      btn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
      btn.setAttribute('aria-label', enabled ? '关闭声音' : '打开声音');
      btn.title = enabled ? '关闭声音' : '打开声音';
    }
    notify();
  }

  function toggle() {
    enabled = !enabled;
    try { localStorage.setItem(STORE_KEY, enabled ? '1' : '0'); } catch (e) {}
    if (enabled) {
      unlocked = true;                       // 点开关本身就是一次手势，可直接开声
      if (mode !== 'element') {
        var c = ensureCtx();
        if (c && c.state === 'suspended') {
          try { c.resume().catch(function () {}); } catch (e) {}
        }
        if (mode === 'buffer') startMusic();
      }
    }
    applyEnabled();
    notify();
  }

  function unlock() {
    if (unlocked) return;
    unlocked = true;
    if (!enabled) { applyEnabled(); return; }
    if (mode === 'buffer') {
      var c = ensureCtx();
      if (c && c.state === 'suspended') {
        try { c.resume().catch(function () {}); } catch (e) {}
      }
      startMusic();
    } else if (mode === 'element') {
      startMusic();
    }
  }

  /* ---------------- 预加载 ---------------- */
  function preload() {
    if (loading) return;
    loading = true;
    if (!AC) { startElementPath(); return; }
    startBufferPath().catch(function () {
      startElementPath();        // file:// 下 fetch 被拒 → 退回媒体元素
    });
  }

  /* ---------------- 绑定 ---------------- */
  ['pointerdown', 'touchstart', 'keydown'].forEach(function (ev) {
    document.addEventListener(ev, function () { unlock(); }, { capture: true, passive: true });
  });

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && enabled && unlocked && ctx && ctx.state === 'suspended') {
      ctx.resume().catch(function () {});
    }
  });

  var btn = document.getElementById('btn-sound');
  if (btn) btn.addEventListener('click', function () { toggle(); });
  applyEnabled();

  /* 页面一加载就开始取音频，不等用户点 */
  if (document.readyState === 'complete') preload();
  else window.addEventListener('load', preload);
  setTimeout(preload, 1500);            // 兜底：load 被拖住时也补一次

  /* ---------------- 调试 ---------------- */
  window.BookAudio = {
    flip: flip,
    toggle: toggle,
    preload: preload,
    isEnabled: function () { return enabled; },
    /* 调试：总线当前的 RMS 与总增益（0 = 已静音）。element 通道返回 -1 */
    level: function () {
      if (!analyser) return { rms: -1, gain: -1 };
      var a = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(a);
      var sum = 0;
      for (var i = 0; i < a.length; i++) sum += a[i] * a[i];
      return { rms: Math.sqrt(sum / a.length), gain: master.gain.value };
    },
    onChange: function (f) { listeners.push(f); },
    status: function () {
      return {
        mode: mode,
        enabled: enabled,
        ctx: ctx ? ctx.state : 'none',
        unlocked: unlocked,
        sfx: mode === 'buffer' ? !!sfxBuf : mode === 'element',
        music: mode === 'buffer' ? !!musicBuf : mode === 'element',
        playing: mode === 'buffer' ? !!musicNode : !!(elMusic && !elMusic.paused),
        plays: plays,
        sfxDur: sfxBuf ? +sfxBuf.duration.toFixed(3) : 0,
        musicDur: musicBuf ? +musicBuf.duration.toFixed(2) : (elMusic ? +(elMusic.duration || 0).toFixed(2) : 0),
        musicReady: elMusic ? elMusic.readyState : (musicBuf ? 4 : 0)
      };
    }
  };

  if (/[?&]amode=element/.test(location.search)) startElementPath();   // 调试：强制元素通道
})();
