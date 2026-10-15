'use strict';
// "Slides" layout: full-screen designer pictures (or videos) that rotate with transitions.
// Prices are not baked into the pictures: they are drawn on top as labels bound to menu
// items, so changing a price in the manager page updates every slide instantly.

window.KinobarSlides = (function () {
  const box = document.getElementById('slides');
  const ALIGN = { left: ['0%', 'left center'], center: ['-50%', 'center'], right: ['-100%', 'right center'] };
  let layoutKey = null;
  let slideEls = [];
  let slides = [];
  let current = -1;
  let timer = 0;
  let lastTexts = new Map();

  function itemsById(menu) {
    const map = new Map();
    for (const s of menu.screens) for (const c of s.categories) for (const i of c.items) if (i.id) map.set(i.id, i);
    return map;
  }

  function isVideo(url) {
    return /\.(mp4|webm)$/i.test(url || '');
  }

  // Text a label shows right now, plus whether its item is sold out.
  function labelText(label, items, currency) {
    if (label.type === 'text') return { text: label.text || '', out: false };
    const item = items.get(label.item);
    if (!item) return { text: '', out: false };
    const suffix = label.suffix ?? (currency ? ` ${currency}` : '');
    return { text: `${label.prefix || ''}${formatPrice(item.price)}${suffix}`, out: item.available === false };
  }

  function labelStyle(label, i) {
    const [tx, origin] = ALIGN[label.align] || ALIGN.left;
    const font = label.font || 'Open Sans';
    return [
      `left:${label.x}%`, `top:${label.y}%`, `--size:${label.size || 8}`, `--i:${i}`, `--tx:${tx}`, `--origin:${origin}`,
      `color:${label.color || '#ffffff'}`, `font-family:'${font}', 'Segoe UI', Arial, sans-serif`,
      `font-weight:${label.weight || (font === 'Open Sans' ? 600 : 800)}`,
    ].join(';');
  }

  // Everything except the label texts: if this changes, slides are rebuilt and the show restarts.
  function key(screen) {
    return JSON.stringify((screen.slides || []).map((s) => [s.background, s.seconds, s.zoom, s.transition,
      (s.labels || []).map((l) => [l.type, l.item, l.x, l.y, l.size, l.color, l.font, l.weight, l.align, l.shadow, l.pulse])]));
  }

  function build(menu, screen) {
    stop();
    box.innerHTML = '';
    slides = (screen.slides || []).filter((s) => s && !s.hidden && (s.background || (s.labels || []).length));
    const items = itemsById(menu);
    const currency = (menu.settings && menu.settings.currency) || '';
    slideEls = slides.map((slide) => {
      const el = document.createElement('div');
      el.className = `slide fx-${slide.transition || 'fade'}`;
      const outer = document.createElement('div');
      outer.className = 'stage';
      // Picture and prices zoom together, so prices stay glued to the designer's captions.
      const stage = document.createElement('div');
      stage.className = 'zoomer' + (slide.zoom !== false && !isVideo(slide.background) ? ' kb' : '');
      outer.appendChild(stage);
      if (slide.background) {
        const media = document.createElement(isVideo(slide.background) ? 'video' : 'img');
        media.className = 'sbg';
        media.src = slide.background;
        if (media.tagName === 'VIDEO') Object.assign(media, { muted: true, playsInline: true, preload: 'auto' });
        stage.appendChild(media);
      }
      (slide.labels || []).forEach((label, i) => {
        const l = document.createElement('div');
        l.className = 'label' + (label.shadow !== false ? ' shadow' : '') + (label.pulse ? ' pulse' : '');
        l.style.cssText = labelStyle(label, i);
        const { text, out } = labelText(label, items, currency);
        l.textContent = text;
        l.classList.toggle('out', out);
        stage.appendChild(l);
      });
      el.appendChild(outer);
      box.appendChild(el);
      return el;
    });
    rememberTexts();
    current = -1;
    if (slideEls.length) show(0);
  }

  function rememberTexts() {
    lastTexts = new Map();
    slideEls.forEach((el, si) => el.querySelectorAll('.label').forEach((l, li) => lastTexts.set(`${si}:${li}`, l.textContent)));
  }

  // Prices changed but the slides didn't: swap the texts in place and flash what changed.
  function updateTexts(menu) {
    const items = itemsById(menu);
    const currency = (menu.settings && menu.settings.currency) || '';
    slides.forEach((slide, si) => {
      const labels = slideEls[si].querySelectorAll('.label');
      (slide.labels || []).forEach((label, li) => {
        const el = labels[li];
        const { text, out } = labelText(label, items, currency);
        el.classList.toggle('out', out);
        if (el.textContent !== text) {
          el.textContent = text;
          el.classList.remove('flash');
          void el.offsetWidth;
          el.classList.add('flash');
        }
      });
    });
    rememberTexts();
  }

  function show(index) {
    clearTimeout(timer);
    const prev = slideEls[current];
    current = index;
    const el = slideEls[current];
    const slide = slides[current];
    if (prev && prev !== el) {
      prev.classList.remove('active');
      const v = prev.querySelector('video');
      if (v) setTimeout(() => v.pause(), 1000);
    }
    // Restart the slide's own animations (zoom, labels popping in).
    el.classList.remove('active');
    void el.offsetWidth;
    el.classList.add('active');
    const seconds = Number(slide.seconds) || 0;
    const video = el.querySelector('video');
    let dur = (seconds || 10) * 1000;
    if (video) {
      video.currentTime = 0;
      video.play().catch(() => {});
      if (!seconds) {
        dur = 600000;
        video.onended = () => next();
      }
    }
    el.style.setProperty('--dur', `${dur / 1000 + 1}s`);
    if (slideEls.length > 1 || video) timer = setTimeout(next, dur);
  }

  function next() {
    if (!slideEls.length) return;
    show((current + 1) % slideEls.length);
  }

  function render(menu, screen) {
    const k = key(screen);
    if (k !== layoutKey) {
      build(menu, screen);
      layoutKey = k;
    } else {
      updateTexts(menu);
    }
  }

  function stop() {
    clearTimeout(timer);
    box.querySelectorAll('video').forEach((v) => v.pause());
    if (!box.children.length) return;
    box.innerHTML = '';
    slideEls = [];
    layoutKey = null;
  }

  return { render, stop };
})();
