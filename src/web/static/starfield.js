/* 星空主题背景：透视星场画布。
   每颗星带深度与光谱类别，颜色取自光谱，大小/亮度/速度由深度决定；
   星轨是一条帧位移，慢速时像光点、快速时才拉成细线。纯展示，不参与渲染。 */
(function () {
  'use strict';

  var SPECTRA = [
    { rgb: '155,178,255', weight: 0.010 },
    { rgb: '170,196,255', weight: 0.075 },
    { rgb: '202,219,255', weight: 0.130 },
    { rgb: '246,246,255', weight: 0.185 },
    { rgb: '255,244,224', weight: 0.200 },
    { rgb: '255,206,150', weight: 0.240 },
    { rgb: '255,150,104', weight: 0.160 },
  ];

  var STAR_COUNT = 1200;
  var WARP = 0.12;
  var TRAIL_FRAMES = 1.3;
  var FOCAL = 0.62;
  var MAX_DPR = 2;
  var SPRITE = 56;
  var BOX_X = 2.4;
  var BOX_Y = 1.25;
  var MIN_Z = 0.055;
  var LOOK_RANGE = 0.24;

  var canvas = document.getElementById('starfield');
  if (!(canvas instanceof HTMLCanvasElement)) return;
  var ctx = canvas.getContext('2d');
  if (!ctx) return;

  var reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function bakeSprites() {
    return SPECTRA.map(function (spectrum) {
      var sprite = document.createElement('canvas');
      sprite.width = SPRITE;
      sprite.height = SPRITE;
      var g = sprite.getContext('2d');
      if (!g) return sprite;
      var half = SPRITE / 2;
      var grad = g.createRadialGradient(half, half, 0, half, half, half);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.055, 'rgba(255,255,255,0.92)');
      grad.addColorStop(0.11, 'rgba(' + spectrum.rgb + ',0.8)');
      grad.addColorStop(0.26, 'rgba(' + spectrum.rgb + ',0.26)');
      grad.addColorStop(0.55, 'rgba(' + spectrum.rgb + ',0.07)');
      grad.addColorStop(1, 'rgba(' + spectrum.rgb + ',0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, SPRITE, SPRITE);
      return sprite;
    });
  }

  var sprites = bakeSprites();

  // 固定种子：同一台机器刷新后看到同一片天空。
  var seed = 0x5ea17c01;
  function next() {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return (seed >>> 9) / 4194304;
  }

  var cumulative = [];
  var totalWeight = 0;
  for (var i = 0; i < SPECTRA.length; i++) {
    totalWeight += SPECTRA[i].weight;
    cumulative.push(totalWeight);
  }
  function pickClass() {
    var draw = next() * totalWeight;
    for (var j = 0; j < cumulative.length; j++) {
      if (draw <= cumulative[j]) return j;
    }
    return cumulative.length - 1;
  }

  var stars = [];
  function reset(star) {
    star.x = (next() * 2 - 1) * BOX_X;
    star.y = (next() * 2 - 1) * BOX_Y;
    star.z = MIN_Z + next() * (1 - MIN_Z);
    star.m = Math.pow(next(), 2.3);
    star.phase = next() * Math.PI * 2;
    star.cls = pickClass();
  }
  for (var s = 0; s < STAR_COUNT; s++) {
    var star = { x: 0, y: 0, z: 1, m: 0, phase: 0, cls: 0 };
    reset(star);
    stars.push(star);
  }

  var width = 0;
  var height = 0;
  var elapsed = 0;
  var centreX = 0.5;
  var centreY = 0.5;
  var aimX = 0.5;
  var aimY = 0.5;
  var enabled = false;
  var raf = 0;
  var last = 0;
  var warmed = false;

  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function draw(dt) {
    var focal = Math.min(width, height) * FOCAL;
    var ox = centreX * width;
    var oy = centreY * height;
    var warp = reduceMotion ? 0 : WARP;
    ctx.clearRect(0, 0, width, height);
    // 叠加混合：星场密集处应该发亮，而不是互相遮挡。
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';

    for (var i = 0; i < stars.length; i++) {
      var star = stars[i];
      star.z -= dt * warp;
      if (star.z < MIN_Z) {
        reset(star);
        continue;
      }
      var k = focal / star.z;
      var sx = ox + star.x * k;
      var sy = oy + star.y * k;
      if (sx < -320 || sx > width + 320 || sy < -320 || sy > height + 320) continue;

      var depth = 1 - star.z;
      var d2 = depth * depth;
      var twinkle = 0.86 + 0.14 * Math.sin(elapsed * 2.1 + star.phase);
      var shift = (focal * warp * (dt * TRAIL_FRAMES)) / Math.max(0.0016, star.z * star.z);
      var dx = star.x * shift;
      var dy = star.y * shift;
      var raw = Math.hypot(dx, dy);
      var length = Math.min(340, raw);
      var rgb = SPECTRA[star.cls].rgb;
      var alpha = Math.min(1, (0.2 + d2 * 1.1) * twinkle * (0.3 + star.m) + 0.16);

      if (length > 2.2) {
        var scale = length / raw;
        ctx.strokeStyle = 'rgba(' + rgb + ',' + (alpha * 0.42).toFixed(3) + ')';
        ctx.lineWidth = 0.45 + d2 * 1.35;
        ctx.beginPath();
        ctx.moveTo(sx - dx * scale, sy - dy * scale);
        ctx.lineTo(sx, sy);
        ctx.stroke();
      }

      var size = (3.5 + d2 * 15 + star.m * 18) * twinkle;
      ctx.globalAlpha = Math.min(1, alpha * 1.3);
      ctx.drawImage(sprites[star.cls], sx - size / 2, sy - size / 2, size, size);
      ctx.globalAlpha = 1;

      if (star.m > 0.9 && d2 > 0.35) {
        var arm = size * 0.6;
        ctx.strokeStyle = 'rgba(' + rgb + ',' + (alpha * 0.3).toFixed(3) + ')';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(sx - arm, sy);
        ctx.lineTo(sx + arm, sy);
        ctx.moveTo(sx, sy - arm);
        ctx.lineTo(sx, sy + arm);
        ctx.stroke();
      }
    }

    ctx.globalCompositeOperation = 'source-over';
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    var dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
    last = now;
    elapsed += dt;
    centreX += (aimX - centreX) * Math.min(1, dt * 2.5);
    centreY += (aimY - centreY) * Math.min(1, dt * 2.5);
    draw(dt);
  }

  function start() {
    if (raf || !enabled || document.hidden) return;
    last = 0;
    raf = requestAnimationFrame(frame);
  }
  function stop() {
    if (!raf) return;
    cancelAnimationFrame(raf);
    raf = 0;
  }

  function enable() {
    resize();
    if (reduceMotion) { draw(0); return; }
    // 预热：第一帧就带上已经飞过的位移，避免星星从同一点同时起步。
    if (!warmed) {
      for (var i = 0; i < 120; i++) draw(1 / 60);
      warmed = true;
    }
    start();
  }

  function sync() {
    enabled = document.documentElement.dataset.cncmapsTheme === 'starry';
    if (!enabled) { stop(); return; }
    requestAnimationFrame(enable);
  }

  function onPointer(event) {
    aimX = 0.5 + (event.clientX / window.innerWidth - 0.5) * LOOK_RANGE;
    aimY = 0.5 + (event.clientY / window.innerHeight - 0.5) * LOOK_RANGE;
  }

  window.addEventListener('resize', function () { if (enabled) resize(); });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stop();
    else if (enabled && !reduceMotion) start();
    else if (enabled) draw(0);
  });
  if (!reduceMotion) window.addEventListener('pointermove', onPointer);
  new MutationObserver(sync).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-cncmaps-theme'],
  });
  sync();
})();
