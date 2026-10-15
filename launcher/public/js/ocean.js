'use strict';
// The background: deep water, drifting motes, and an octopus rising from the lower right corner —
// a nod to the SquidBots crest. Drawn on a canvas, calm and slow; a still frame when motion is off.

const Ocean = (() => {
  let canvas;
  let ctx;
  let width = 0;
  let height = 0;
  let scale = 1;
  let frame = 0;
  let still = false;
  let motes = [];
  const TENTACLES = [
    { angle: -2.45, length: 0.62, width: 30, phase: 0.0, speed: 0.42, curl: 1.15 },
    { angle: -2.05, length: 0.78, width: 34, phase: 1.3, speed: 0.36, curl: -0.9 },
    { angle: -1.72, length: 0.70, width: 32, phase: 2.2, speed: 0.4, curl: 1.3 },
    { angle: -1.38, length: 0.56, width: 28, phase: 3.1, speed: 0.46, curl: -1.1 },
    { angle: -2.85, length: 0.48, width: 24, phase: 4.0, speed: 0.5, curl: 0.8 },
    { angle: -1.05, length: 0.40, width: 22, phase: 5.2, speed: 0.55, curl: -1.4 },
  ];

  function css(name, fallback) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  }

  function resize() {
    scale = Math.min(window.devicePixelRatio || 1, 2);
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    motes = Array.from({ length: Math.round((width * height) / 14000) }, () => ({
      x: Math.random() * width, y: Math.random() * height, r: 0.6 + Math.random() * 1.8,
      v: 0.08 + Math.random() * 0.25, drift: Math.random() * Math.PI * 2, glow: Math.random(),
    }));
    if (still) draw(0);
  }

  // One tentacle: a spine of points bent by a travelling wave, then a tapered ribbon along it.
  function tentacle(base, spec, time) {
    const count = 34;
    const reach = Math.min(width, height) * spec.length;
    const points = [];
    let angle = spec.angle;
    let x = base.x;
    let y = base.y;
    for (let i = 0; i <= count; i++) {
      const t = i / count;
      points.push({ x, y, t });
      const wave = Math.sin(time * spec.speed + spec.phase - t * 5.2) * 0.11 * (0.4 + t);
      angle += wave + spec.curl * 0.018 * t * t * 3;
      x += Math.cos(angle) * (reach / count);
      y += Math.sin(angle) * (reach / count);
    }
    const left = [];
    const right = [];
    points.forEach((point, i) => {
      const next = points[Math.min(i + 1, points.length - 1)];
      const prev = points[Math.max(i - 1, 0)];
      const dir = Math.atan2(next.y - prev.y, next.x - prev.x);
      const half = spec.width * Math.pow(1 - point.t, 1.25) * 0.5 + 0.6;
      left.push({ x: point.x + Math.cos(dir - Math.PI / 2) * half, y: point.y + Math.sin(dir - Math.PI / 2) * half });
      right.push({ x: point.x + Math.cos(dir + Math.PI / 2) * half, y: point.y + Math.sin(dir + Math.PI / 2) * half, dir, half, t: point.t });
    });
    const skin = ctx.createLinearGradient(base.x, base.y, points.at(-1).x, points.at(-1).y);
    skin.addColorStop(0, css('--squid-deep', '#3a1d52'));
    skin.addColorStop(1, css('--squid-tip', '#8f4fb8'));
    ctx.beginPath();
    ctx.moveTo(left[0].x, left[0].y);
    for (const point of left) ctx.lineTo(point.x, point.y);
    for (const point of [...right].reverse()) ctx.lineTo(point.x, point.y);
    ctx.closePath();
    ctx.fillStyle = skin;
    ctx.globalAlpha = 0.55;
    ctx.fill();
    // Suckers along the inner edge, fading out towards the tip.
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = css('--squid-sucker', '#e9b3d6');
    for (let i = 3; i < right.length - 3; i += 2) {
      const point = right[i];
      const r = Math.max(0.8, point.half * 0.34);
      ctx.beginPath();
      ctx.ellipse(point.x - Math.cos(point.dir + Math.PI / 2) * r * 0.9, point.y - Math.sin(point.dir + Math.PI / 2) * r * 0.9, r, r * 0.8, point.dir, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function draw(time) {
    ctx.clearRect(0, 0, width, height);
    // Light from the surface.
    const ray = ctx.createRadialGradient(width * 0.3, -height * 0.2, 10, width * 0.3, -height * 0.2, height * 1.1);
    ray.addColorStop(0, css('--surface-light', 'rgba(90, 200, 220, 0.20)'));
    ray.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = ray;
    ctx.fillRect(0, 0, width, height);
    // Motes drifting up.
    ctx.fillStyle = css('--mote', '#7ff5e3');
    for (const mote of motes) {
      if (!still) {
        mote.y -= mote.v;
        mote.x += Math.sin(time * 0.3 + mote.drift) * 0.12;
        if (mote.y < -4) { mote.y = height + 4; mote.x = Math.random() * width; }
      }
      ctx.globalAlpha = 0.18 + 0.35 * Math.abs(Math.sin(time * 0.6 + mote.glow * 6));
      ctx.beginPath();
      ctx.arc(mote.x, mote.y, mote.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // The octopus, mostly out of frame in the lower right corner.
    const base = { x: width * 0.93, y: height * 1.02 };
    for (const spec of TENTACLES) tentacle(base, spec, time);
    const mantle = ctx.createRadialGradient(base.x - 30, base.y - 60, 10, base.x, base.y, Math.min(width, height) * 0.3);
    mantle.addColorStop(0, css('--squid-tip', '#8f4fb8'));
    mantle.addColorStop(1, css('--squid-deep', '#3a1d52'));
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = mantle;
    ctx.beginPath();
    ctx.ellipse(base.x + 10, base.y - 20, Math.min(width, height) * 0.2, Math.min(width, height) * 0.16, -0.5, 0, Math.PI * 2);
    ctx.fill();
    // Its eye, watching the play button.
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = css('--gold', '#e8b04a');
    const eye = { x: base.x - Math.min(width, height) * 0.1, y: base.y - Math.min(width, height) * 0.14 };
    ctx.beginPath();
    ctx.ellipse(eye.x, eye.y, 11, 8, -0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0b0710';
    ctx.beginPath();
    ctx.ellipse(eye.x + Math.sin(time * 0.2) * 2, eye.y, 7, 2.4, -0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function loop(now) {
    draw(now / 1000);
    frame = requestAnimationFrame(loop);
  }

  return {
    start(element, reduceMotion) {
      canvas = element;
      ctx = canvas.getContext('2d');
      still = reduceMotion;
      resize();
      window.addEventListener('resize', resize);
      cancelAnimationFrame(frame);
      if (still) draw(0); else frame = requestAnimationFrame(loop);
    },
    setStill(value) {
      still = value;
      cancelAnimationFrame(frame);
      if (still) draw(0); else frame = requestAnimationFrame(loop);
    },
  };
})();
