/* ===========================================================
 * 背景音乐
 * -----------------------------------------------------------
 * 两种音源，自动择优：
 *   1) 外置文件 assets/audio/bgm.mp3 —— 放进去即优先使用（可换成任意曲子）
 *   2) 缺省用 Web Audio 实时合成的古筝独奏 —— 中国五声音阶，
 *      Karplus-Strong 弹拨物理建模 + 程序生成的房间混响。
 *      波形由本文件实时计算产生，不含任何第三方音乐素材，不涉及版权。
 *
 * 讲述开始时自动压低音量（ducking），讲完缓慢恢复。
 * =========================================================== */
window.BGM = (function () {
  'use strict';

  var EXT_SRC = window.BGM_FILE || 'assets/audio/bgm.mp3';

  var ctx = null, master = null, convolver = null, revGain = null;
  var ext = null, usingExt = false, extTried = false;
  var timer = null, started = false;
  var vol = 0.30;            // 基准音量（背景，不盖人声）
  var ducked = false;
  var enabled = true;
  var extRamp = null;

  /* ---------------- 音量 / 开关 ---------------- */

  function targetGain() {
    return enabled ? vol * (ducked ? 0.30 : 1) : 0;
  }

  /* 外置 <audio> 用 HTMLMediaElement.volume，手动做一段渐变（它本身没有 ramp API） */
  function rampExt(to, ms) {
    if (extRamp) { clearInterval(extRamp); extRamp = null; }
    if (!ext) return;
    var from = ext.volume, t0 = Date.now();
    extRamp = setInterval(function () {
      var k = Math.min(1, (Date.now() - t0) / ms);
      try { ext.volume = from + (to - from) * k; } catch (e) {}
      if (k >= 1) { clearInterval(extRamp); extRamp = null; }
    }, 40);
  }

  function applyGain(ms) {
    var target = targetGain();
    if (usingExt && ext) { rampExt(target, ms || 400); return; }
    if (!master) return;
    ms = ms || (ducked ? 500 : 1400);
    var now = ctx.currentTime, sec = ms / 1000;
    try {
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(master.gain.value, now);
      master.gain.linearRampToValueAtTime(target, now + sec);
    } catch (e) { master.gain.value = target; }
  }

  function duck(on) {
    var v = !!on;
    if (ducked === v) return;
    ducked = v;
    applyGain();
  }

  function setVolume(v) {
    vol = Math.max(0, Math.min(1, v));
    applyGain(120);
    save();
  }

  function setEnabled(on) {
    enabled = !!on;
    save();
    if (!enabled) {
      applyGain(300);
      return;
    }
    ensure();
    if (ctx && ctx.state === 'suspended') { try { ctx.resume(); } catch (e) {} }
    if (!extTried) tryExternal(function (ok) { if (!ok) startSynth(); });
    else if (!usingExt) startSynth();
    if (usingExt && ext) { try { ext.play().catch(function () {}); } catch (e) {} }
    applyGain(600);
  }

  /* ---------------- 状态持久化 ---------------- */

  function save() {
    try { localStorage.setItem('sh_bgm', JSON.stringify({ on: enabled, v: vol })); } catch (e) {}
  }
  function load() {
    try {
      var s = JSON.parse(localStorage.getItem('sh_bgm') || '{}');
      if (typeof s.on === 'boolean') enabled = s.on;
      if (typeof s.v === 'number') vol = s.v;
    } catch (e) {}
  }

  /* ---------------- 混响：程序生成的房间脉冲响应 ---------------- */

  function buildIR(seconds, decay) {
    var len = Math.floor(ctx.sampleRate * seconds);
    var buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (var c = 0; c < 2; c++) {
      var d = buf.getChannelData(c);
      for (var i = 0; i < len; i++) {
        var t = i / len;
        var early = i < ctx.sampleRate * 0.010 ? 0.4 : 1;   // 前 10ms 留一点直达感
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * early;
      }
    }
    return buf;
  }

  /* ---------------- 古筝拨弦：Karplus-Strong 物理建模 ---------------- */

  var strings = {};

  function pluckBuffer(freq, seconds) {
    var key = Math.round(freq * 10);
    if (strings[key]) return strings[key];

    var sr = ctx.sampleRate;
    var N = Math.max(2, Math.round(sr / freq));
    var len = Math.floor(sr * seconds);
    var buf = ctx.createBuffer(1, len, sr);
    var d = buf.getChannelData(0);
    var i, prev, v, n;

    /* 激励：一小段柔化噪声，模拟指甲拨丝弦（不是方波那种电味） */
    prev = 0;
    for (i = 0; i < N; i++) {
      n = Math.random() * 2 - 1;
      v = n * 0.55 + prev * 0.45;
      prev = n;
      d[i] = v;
    }

    /* KS 循环：均值滤波 + 损耗。
     * 固定 per-sample 损耗天然呈现「高音先没、低音留余韵」的弦特性。 */
    var damp = 0.9968;
    for (i = N; i < len; i++) {
      d[i] = damp * (d[i - N] + d[i - N + 1]) * 0.5;
    }

    /* 首尾包络，防爆音 */
    var atk = Math.floor(sr * 0.004), rel = Math.floor(sr * 0.12);
    for (i = 0; i < atk; i++) d[i] *= i / atk;
    for (i = 0; i < rel; i++) d[len - 1 - i] *= i / rel;

    /* 归一化 */
    var peak = 0, a;
    for (i = 0; i < len; i++) { a = Math.abs(d[i]); if (a > peak) peak = a; }
    if (peak > 0) for (i = 0; i < len; i++) d[i] /= peak;

    strings[key] = buf;
    return buf;
  }

  function pluck(freq, when, amp, glide) {
    if (!ctx) return;
    if (window.__BGM_DEBUG__) {                 // 自检探针用，正常阅读时忽略
      (window.__BGM_LOG__ = window.__BGM_LOG__ || []).push([Math.round(freq), +amp.toFixed(2)]);
    }
    var src = ctx.createBufferSource();
    src.buffer = pluckBuffer(freq, 2.6);

    var tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = Math.min(7000, freq * 6 + 900);   // 高音亮、低音闷
    tone.Q.value = 0.6;

    var g = ctx.createGain();
    g.gain.setValueAtTime(amp, when);

    if (glide) {                                              // 偶尔来一点按弦上滑
      try {
        src.playbackRate.setValueAtTime(0.982, when);
        src.playbackRate.linearRampToValueAtTime(1, when + 0.14);
      } catch (e) {}
    }

    src.connect(tone); tone.connect(g);
    g.connect(master);        // 直达声
    g.connect(convolver);     // 送一路进混响
    src.start(when);
    src.stop(when + 2.7);
  }

  /* ---------------- 旋律：中国五声音阶随机游走 ---------------- */

  var SCALE = [0, 2, 4, 7, 9];               // 宫 商 角 徵 羽
  var ROOT = 62;                              // D4 作宫
  var NOTES = [];
  for (var o = 0; o <= 2; o++)
    for (var k = 0; k < SCALE.length; k++)
      NOTES.push(ROOT - 12 + o * 12 + SCALE[k]);

  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  var cur = 5, nextAt = 0, sinceGliss = 0;

  function schedule() {
    if (!ctx || usingExt) return;
    var horizon = ctx.currentTime + 1.2;
    var guard = 0;
    while (nextAt < horizon && guard++ < 40) {
      var t = nextAt;

      /* 偶发「刮奏」——古筝最有辨识度的装饰音 */
      sinceGliss++;
      if (sinceGliss > 26 && Math.random() < 0.5) {
        sinceGliss = 0;
        var up = Math.random() < 0.75;
        var cnt = 5 + Math.floor(Math.random() * 4);
        var base = up ? Math.max(0, cur - 3) : Math.min(NOTES.length - 1, cur + 3);
        for (var q = 0; q < cnt; q++) {
          var gi = base + (up ? q : -q);
          if (gi < 0 || gi >= NOTES.length) break;
          pluck(mtof(NOTES[gi]), t + q * 0.055, 0.15 + q * 0.02, false);
        }
        cur = Math.max(0, Math.min(NOTES.length - 1, base + (up ? cnt : -cnt)));
        nextAt = t + cnt * 0.055 + 1.0 + Math.random() * 0.8;
        continue;
      }

      /* 主旋律：以级进为主，偶尔跳进 */
      var r0 = Math.random();
      if (r0 < 0.10) cur += (Math.random() < 0.5 ? -4 : 4);
      else if (r0 < 0.32) cur += (Math.random() < 0.5 ? -2 : 2);
      else cur += (Math.random() < 0.5 ? -1 : 1);
      if (cur < 0) cur = -cur;                                    // 边界反弹
      if (cur > NOTES.length - 1) cur = 2 * (NOTES.length - 1) - cur;

      var amp = 0.28 + Math.random() * 0.32;
      pluck(mtof(NOTES[cur]), t, amp, Math.random() < 0.22);

      /* 三成概率补一个低八度音，像左手按出的余韵 */
      if (cur >= 5 && Math.random() < 0.26) {
        pluck(mtof(NOTES[cur - 5]), t + 0.02 + Math.random() * 0.06, amp * 0.45, false);
      }

      /* 节奏：舒缓留白，偶尔一个长音收句 */
      var gap, r = Math.random();
      if (r < 0.16) gap = 1.7 + Math.random() * 0.9;
      else if (r < 0.55) gap = 0.58 + Math.random() * 0.22;
      else gap = 0.78 + Math.random() * 0.42;
      nextAt = t + gap;
    }
  }

  /* ---------------- 外置音源探测 ---------------- */

  function tryExternal(cb) {
    if (extTried) return;
    extTried = true;
    if (!EXT_SRC) { cb(false); return; }
    var settled = false;
    function done(ok) {
      if (settled) return;
      settled = true;
      cb(ok);
    }
    try {
      ext = new Audio();
      ext.loop = true;
      ext.preload = 'auto';
      ext.volume = 0;
      ext.addEventListener('canplaythrough', function () {
        usingExt = true;
        try { convolver && convolver.disconnect(); } catch (e) {}
        try { ext.volume = 0; ext.play().catch(function () {}); } catch (e) {}
        applyGain(1500);
        done(true);
      });
      ext.addEventListener('error', function () { done(false); });
      ext.src = EXT_SRC;
      ext.load();
      setTimeout(function () { done(false); }, 3000);   // 无以为据时兜底
    } catch (e) { done(false); }
  }

  /* ---------------- 合成声部启停 ---------------- */

  function startSynth() {
    if (timer || !ctx || usingExt) return;
    nextAt = ctx.currentTime + 0.25;
    sinceGliss = 0;
    schedule();
    timer = setInterval(schedule, 250);
  }

  function stopSynth() {
    if (timer) { clearInterval(timer); timer = null; }
  }

  /* ---------------- 初始化 ---------------- */

  function ensure() {
    if (started) return true;
    // __BGM_CTX__ 仅供离线渲染做波形自检用（tools/render_bgm.py）
    var AC = window.__BGM_CTX__ || window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try { ctx = new AC(); } catch (e) { return false; }

    master = ctx.createGain();
    master.gain.value = enabled ? vol : 0;
    master.connect(ctx.destination);

    revGain = ctx.createGain();
    revGain.gain.value = 0.30;                 // 混响湿度
    revGain.connect(master);

    convolver = ctx.createConvolver();
    convolver.buffer = buildIR(2.2, 2.6);
    convolver.connect(revGain);

    started = true;
    return true;
  }

  /* 浏览器自动播放策略：等第一次用户交互再起声 */
  function unlock() {
    if (!enabled) return;
    if (!ensure()) return;
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch (e) {} }
    tryExternal(function (ok) { if (!ok) startSynth(); });
    applyGain(1200);
  }

  document.addEventListener('pointerdown', unlock, { passive: true });
  document.addEventListener('touchstart', unlock, { passive: true });
  document.addEventListener('keydown', unlock);

  document.addEventListener('visibilitychange', function () {
    if (!started) return;
    if (document.hidden) {
      if (usingExt && ext) { try { ext.pause(); } catch (e) {} }
      else { try { ctx.suspend(); } catch (e) {} }
    } else if (enabled) {
      if (usingExt && ext) { try { ext.play().catch(function () {}); } catch (e) {} }
      else { try { ctx.resume(); } catch (e) {} }
    }
  });

  load();

  return {
    unlock: unlock,
    duck: duck,
    setVolume: setVolume,
    getVolume: function () { return vol; },
    setEnabled: setEnabled,
    isEnabled: function () { return enabled; },
    source: function () { return usingExt ? ('file:' + EXT_SRC) : 'synth'; }
  };
})();
