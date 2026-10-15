'use strict';
// Lightweight animated particles drawn behind the menu (falling popcorn, rising bubbles, ...).
// Kept to a few dozen particles so one computer can drive several TVs at once.

window.KinobarEffects = (function () {
  const canvas = document.getElementById('fx');
  const ctx = canvas.getContext('2d');
  let kind = 'none';
  let parts = [];
  let raf = 0;
  let last = 0;
  let accent = '#ffb400';

  const rand = (a, b) => a + Math.random() * (b - a);

  function resize() {
    canvas.width = innerWidth;
    canvas.height = innerHeight;
  }

  function spawn(initial) {
    const w = canvas.width, h = canvas.height, s = Math.min(w, h);
    if (kind === 'popcorn') {
      return { x: rand(0, w), y: initial ? rand(-h, h) : rand(-h * .2, -s * .05), r: rand(s * .008, s * .018),
        vy: rand(s * .02, s * .05), vx: rand(-s * .01, s * .01), a: rand(0, 6.28), va: rand(-1, 1), o: rand(.25, .6) };
    }
    if (kind === 'bubbles') {
      return { x: rand(0, w), y: initial ? rand(0, h * 1.2) : h + rand(0, s * .1), r: rand(s * .004, s * .02),
        vy: -rand(s * .03, s * .09), ph: rand(0, 6.28), o: rand(.15, .45) };
    }
    if (kind === 'sparkles') {
      return { x: rand(0, w), y: rand(0, h), r: rand(s * .004, s * .012), ph: rand(0, 6.28), sp: rand(.6, 1.8) };
    }
    if (kind === 'steam') {
      return { x: rand(0, w), y: initial ? rand(0, h * 1.2) : h + rand(0, s * .2), r: rand(s * .06, s * .16),
        vy: -rand(s * .015, s * .04), ph: rand(0, 6.28), o: rand(.03, .08) };
    }
    return null;
  }

  function counts() {
    return { popcorn: 34, bubbles: 45, sparkles: 40, steam: 14 }[kind] || 0;
  }

  function drawKernel(p) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.a);
    ctx.globalAlpha = p.o;
    ctx.fillStyle = '#fff6d8';
    for (const [dx, dy, k] of [[0, 0, 1], [p.r * .8, -p.r * .3, .8], [-p.r * .6, -p.r * .6, .75], [p.r * .1, p.r * .7, .7]]) {
      ctx.beginPath();
      ctx.arc(dx, dy, p.r * k, 0, 6.283);
      ctx.fill();
    }
    ctx.fillStyle = '#e8b04a';
    ctx.beginPath();
    ctx.arc(p.r * .2, p.r * .3, p.r * .35, 0, 6.283);
    ctx.fill();
    ctx.restore();
  }

  function frame(t) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(.05, (t - last) / 1000 || 0);
    last = t;
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (kind === 'popcorn') {
        p.y += p.vy * dt; p.x += p.vx * dt; p.a += p.va * dt;
        if (p.y - p.r * 2 > h) parts[i] = spawn(false);
        drawKernel(p);
      } else if (kind === 'bubbles') {
        p.y += p.vy * dt; p.ph += dt * 2;
        const x = p.x + Math.sin(p.ph) * p.r;
        if (p.y + p.r < 0) parts[i] = spawn(false);
        ctx.globalAlpha = p.o;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = Math.max(1, p.r * .15);
        ctx.beginPath(); ctx.arc(x, p.y, p.r, 0, 6.283); ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(x - p.r * .35, p.y - p.r * .35, p.r * .2, 0, 6.283); ctx.fill();
      } else if (kind === 'sparkles') {
        p.ph += dt * p.sp;
        const a = Math.max(0, Math.sin(p.ph));
        if (p.ph > Math.PI * 2) parts[i] = spawn(false);
        ctx.globalAlpha = a * .8;
        ctx.fillStyle = accent;
        const r = p.r * (.5 + a);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - r * 2); ctx.quadraticCurveTo(p.x, p.y, p.x + r * 2, p.y);
        ctx.quadraticCurveTo(p.x, p.y, p.x, p.y + r * 2); ctx.quadraticCurveTo(p.x, p.y, p.x - r * 2, p.y);
        ctx.quadraticCurveTo(p.x, p.y, p.x, p.y - r * 2); ctx.fill();
      } else if (kind === 'steam') {
        p.y += p.vy * dt; p.ph += dt * .6;
        if (p.y + p.r < 0) parts[i] = spawn(false);
        const g = ctx.createRadialGradient(p.x + Math.sin(p.ph) * p.r * .3, p.y, 0, p.x, p.y, p.r);
        g.addColorStop(0, `rgba(255,255,255,${p.o})`);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.globalAlpha = 1;
        ctx.fillStyle = g;
        ctx.fillRect(p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
      }
    }
    ctx.globalAlpha = 1;
  }

  function set(nextKind, nextAccent) {
    accent = nextAccent || accent;
    if (nextKind === kind) return;
    kind = nextKind || 'none';
    cancelAnimationFrame(raf);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    parts = [];
    if (kind === 'none') return;
    resize();
    for (let i = 0; i < counts(); i++) parts.push(spawn(true));
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  window.addEventListener('resize', resize);
  resize();
  return { set };
})();
