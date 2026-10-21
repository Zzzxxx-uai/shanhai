/* ===========================================================
 * 墨迹粒子系统（HTML5 Canvas）
 * -----------------------------------------------------------
 * 设计目标：营造「纸上山河苏醒」的沉浸感，但必须足够轻，
 * 不能和视差滚动抢性能。
 * 做法：
 *   - 预渲染单个墨点到离屏 canvas，之后只做 drawImage，避免
 *     每帧 createRadialGradient（那是最常见的性能坑）；
 *   - 粒子数按视口宽度自适应，移动端自动降配；
 *   - 支持 start / stop，切页时可暂停省电。
 * =========================================================== */
(function (global) {
  'use strict';

  var INK = '43,33,24';
  var RED = '156,43,33';

  function makeSprite(color) {
    var s = 64, c = document.createElement('canvas');
    c.width = c.height = s;
    var g = c.getContext('2d');
    // 粒子浮在正文之上，浓度必须压得很低，否则会糊住文字
    var rg = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    rg.addColorStop(0, 'rgba(' + color + ',0.30)');
    rg.addColorStop(0.45, 'rgba(' + color + ',0.13)');
    rg.addColorStop(1, 'rgba(' + color + ',0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, s, s);
    return c;
  }

  function InkParticles(canvas, opts) {
    opts = opts || {};
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.sprites = { ink: makeSprite(INK), red: makeSprite(RED) };
    this.parts = [];
    this.density = opts.density || 26;   // 每多少 px 一个粒子
    this.max = opts.max || 70;
    this.raf = null;
    this.running = false;
    this.t = 0;
    this._resize = this.resize.bind(this);
    this.resize();
    window.addEventListener('resize', this._resize);
  }

  InkParticles.prototype.resize = function () {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = window.innerWidth, h = window.innerHeight;
    this.w = w; this.h = h;
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    var n = Math.min(this.max, Math.max(18, Math.floor(w / this.density)));
    this.parts.length = 0;
    for (var i = 0; i < n; i++) this.parts.push(this.spawn(true));
  };

  InkParticles.prototype.spawn = function (init) {
    return {
      x: Math.random() * this.w,
      y: init ? Math.random() * this.h : this.h + 30,
      r: 6 + Math.random() * 26,
      vy: -(0.12 + Math.random() * 0.34),
      drift: 0.12 + Math.random() * 0.3,
      phase: Math.random() * Math.PI * 2,
      alpha: 0.25 + Math.random() * 0.5,
      red: Math.random() < 0.08          // 少量朱红点缀，呼应印章
    };
  };

  InkParticles.prototype.step = function () {
    var ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);
    this.t += 0.006;

    for (var i = 0; i < this.parts.length; i++) {
      var p = this.parts[i];
      p.y += p.vy;
      p.x += Math.sin(this.t + p.phase) * p.drift;

      if (p.y < -60 || p.x < -80 || p.x > this.w + 80) {
        this.parts[i] = this.spawn(false);
        continue;
      }

      var breathe = 0.72 + 0.28 * Math.sin(this.t * 3 + p.phase);
      ctx.globalAlpha = p.alpha * breathe;
      var sp = p.red ? this.sprites.red : this.sprites.ink;
      ctx.drawImage(sp, p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
    }
    ctx.globalAlpha = 1;
  };

  InkParticles.prototype.start = function () {
    if (this.running) return;
    this.running = true;
    var self = this;
    (function loop() {
      self.step();
      self.raf = requestAnimationFrame(loop);
    })();
  };

  InkParticles.prototype.stop = function () {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
  };

  global.InkParticles = InkParticles;
})(window);
