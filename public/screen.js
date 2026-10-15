'use strict';
// TV menu board. Shows one screen of the menu over an animated background,
// refreshes itself the moment the manager saves new prices, plays promo clips
// between menu views, and keeps working through network hiccups.

(function () {
  const screenId = Number(location.pathname.split('/').filter(Boolean)[1]) || 1;
  const root = document.documentElement;
  const inner = document.getElementById('inner');
  const bg = document.getElementById('bg');
  const promoBox = document.getElementById('promo');
  const status = document.getElementById('status');
  const errorBox = document.getElementById('error');
  let currentVersion = null;
  let lastPrices = new Map();
  let lastStructure = null;
  let currentBg = null;
  let promoKey = null;
  let promoTimer = 0;
  let promoPlaying = false;
  let screenConf = null;

  // ---------- menu ----------

  function render(menu, forceEnter) {
    const screen = menu.screens.find((s) => s.id === screenId);
    if (!screen) {
      inner.innerHTML = '';
      errorBox.style.display = 'flex';
      errorBox.textContent = `Экран ${screenId} не настроен`;
      return;
    }
    screenConf = screen;
    errorBox.style.display = 'none';
    document.title = `Кинобар — ${screen.title}`;
    root.style.setProperty('--accent', screen.accent || '#ffb400');
    root.style.setProperty('--dim', String((screen.dim ?? 55) / 100));
    setBackground(screen.background);
    window.KinobarEffects.set(screen.effect || 'none', screen.accent);
    schedulePromos(screen);

    const currency = (menu.settings && menu.settings.currency) || '';
    const cards = screen.layout === 'cards';
    const prices = new Map();
    let n = 0;
    const cats = screen.categories
      .filter((cat) => !cat.hidden && cat.items.some((i) => !i.hidden))
      .map((cat, ci) => {
        const items = cat.items.filter((i) => !i.hidden).map((item, ii) => {
          const key = `${ci}:${ii}:${item.name}:${item.size || ''}`;
          prices.set(key, item.price);
          const changed = lastPrices.size > 0 && lastPrices.has(key) && lastPrices.get(key) !== item.price;
          const out = item.available === false;
          const pic = item.image ? `<img class="pic" src="${escapeHtml(item.image)}" alt="">` : '';
          const price = `<span class="price${changed ? ' flash' : ''}">${item.oldPrice && !out ? `<span class="old">${escapeHtml(formatPrice(item.oldPrice))}</span>` : ''}${escapeHtml(formatPrice(item.price, currency))}</span>`;
          const hit = item.hit && !out ? '<span class="hit">хит</span>' : '';
          const sold = out ? '<span class="soldout">закончился</span>' : '';
          const size = item.size ? `<span class="size">${escapeHtml(item.size)}</span>` : '';
          const i = n++;
          if (cards) {
            return `<div class="card anim${out ? ' out' : ''}" style="--i:${i}">${hit}${sold}${pic}<span class="name">${escapeHtml(item.name)}</span>${size}${price}</div>`;
          }
          return `<div class="item anim${out ? ' out' : ''}" style="--i:${i}">${pic}<span class="name">${escapeHtml(item.name)}</span>${size}${hit}<span class="dots"></span>${sold}${price}</div>`;
        }).join('');
        const head = cat.name ? `<h2 class="anim" style="--i:${n++}">${escapeHtml(cat.name)}</h2>` : '';
        return `<section class="cat">${head}${cards ? `<div class="cat-items">${items}</div>` : items}</section>`;
      }).join('');

    // Animate the whole board in only when the menu itself changed, not on a mere price edit.
    const structure = JSON.stringify([screen.title, screen.layout, screen.categories.map((c) => [c.name, c.items.map((i) => [i.name, i.size, i.image, i.hidden])])]);
    const enter = forceEnter || structure !== lastStructure;
    lastStructure = structure;
    lastPrices = prices;

    inner.className = cards ? 'layout-cards' : 'layout-list';
    inner.innerHTML = `<h1>${escapeHtml(screen.title)}</h1><div class="cols">${cats}</div>`;
    fit();
    if (enter) playEnter();
  }

  function playEnter() {
    inner.classList.remove('enter');
    void inner.offsetWidth; // restart CSS animations
    inner.classList.add('enter');
  }

  // Pick the column count and the largest font size that fit the whole menu on the TV.
  function fit() {
    if (!inner.querySelector('.cols')) return;
    inner.classList.add('measuring');
    const cards = inner.classList.contains('layout-cards');
    const maxW = inner.clientWidth;
    const maxH = inner.clientHeight;
    const [from, to] = cards ? [2, 6] : [1, 3];
    let best = { size: 8, cols: from };
    for (let c = from; c <= to; c++) {
      inner.style.setProperty('--cols', c);
      let lo = 8, hi = 140;
      while (hi - lo > 0.5) {
        const mid = (lo + hi) / 2;
        inner.style.setProperty('--fs', `${mid}px`);
        if (inner.scrollHeight <= maxH && inner.scrollWidth <= maxW && rowsFit()) lo = mid;
        else hi = mid;
      }
      // Prefer fewer columns unless more columns give noticeably bigger text.
      if (lo > best.size * 1.08) best = { size: lo, cols: c };
    }
    inner.style.setProperty('--cols', best.cols);
    inner.style.setProperty('--fs', `${best.size}px`);
    inner.classList.remove('measuring');
  }

  // A row overflows when name + size + price don't fit in its column width.
  function rowsFit() {
    for (const row of inner.querySelectorAll('.item, .card, .cat h2')) {
      if (row.scrollWidth > row.clientWidth + 1) return false;
    }
    return true;
  }

  // ---------- background ----------

  function isVideo(url) {
    return /\.(mp4|webm)$/i.test(url || '');
  }

  function setBackground(url) {
    url = url || '';
    if (url === currentBg) return;
    currentBg = url;
    bg.innerHTML = '';
    bg.classList.toggle('empty', !url);
    if (!url) return;
    if (isVideo(url)) {
      const v = document.createElement('video');
      Object.assign(v, { src: url, muted: true, loop: true, autoplay: true, playsInline: true });
      v.setAttribute('muted', '');
      bg.appendChild(v);
      v.play().catch(() => {});
    } else {
      const img = document.createElement('img');
      img.src = url;
      bg.appendChild(img);
    }
  }

  // ---------- promo clips between menu views ----------

  function schedulePromos(screen) {
    const promos = (screen.promos || []).filter((p) => p && p.file);
    const every = Number(screen.promoEvery) || 0;
    const key = JSON.stringify([promos, every]);
    if (key === promoKey) return;
    promoKey = key;
    clearTimeout(promoTimer);
    if (promos.length && every > 0 && !promoPlaying) promoTimer = setTimeout(playPromos, every * 1000);
  }

  function showPromo(promo) {
    return new Promise((resolve) => {
      let done = false;
      let timer = 0;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve();
      };
      promoBox.innerHTML = '';
      const seconds = Number(promo.seconds) || 0;
      if (isVideo(promo.file)) {
        const v = document.createElement('video');
        Object.assign(v, { src: promo.file, muted: !promo.sound, autoplay: true, playsInline: true });
        if (!promo.sound) v.setAttribute('muted', '');
        v.addEventListener('ended', finish);
        v.addEventListener('error', finish);
        promoBox.appendChild(v);
        v.play().catch(() => { v.muted = true; v.play().catch(finish); });
        // A clip plays to its end unless a shorter time is set; never hang longer than 10 minutes.
        timer = setTimeout(finish, (seconds || 600) * 1000);
      } else {
        const img = document.createElement('img');
        img.src = promo.file;
        img.addEventListener('error', finish);
        promoBox.appendChild(img);
        timer = setTimeout(finish, (seconds || 10) * 1000);
      }
      promoBox.classList.add('show');
    });
  }

  async function playPromos() {
    const screen = screenConf;
    const promos = ((screen && screen.promos) || []).filter((p) => p && p.file);
    if (!promos.length) return;
    promoPlaying = true;
    for (const promo of promos) await showPromo(promo);
    promoBox.classList.remove('show');
    promoPlaying = false;
    setTimeout(() => { promoBox.innerHTML = ''; }, 900);
    playEnter();
    const every = Number(screenConf && screenConf.promoEvery) || 0;
    if (every > 0) promoTimer = setTimeout(playPromos, every * 1000);
  }

  // ---------- data & live updates ----------

  async function load() {
    try {
      const res = await fetch('/api/menu', { cache: 'no-store' });
      if (!res.ok) throw new Error(res.status);
      const data = await res.json();
      // Nothing changed: don't rebuild the board, that would restart its animations.
      if (data.version === currentVersion && inner.innerHTML) return;
      currentVersion = data.version;
      render(data.menu);
      localStorageSet(data);
    } catch (err) {
      // Server unreachable: keep showing what is on screen (or the last saved copy).
      if (!inner.innerHTML) {
        const cached = localStorageGet();
        if (cached) render(cached.menu);
      }
    }
  }

  function localStorageSet(data) {
    try { localStorage.setItem('kinobar-menu', JSON.stringify(data)); } catch { /* ignore */ }
  }
  function localStorageGet() {
    try { return JSON.parse(localStorage.getItem('kinobar-menu')); } catch { return null; }
  }

  function connect() {
    const es = new EventSource('/api/events');
    es.addEventListener('menu', (e) => {
      status.classList.remove('offline');
      const { version } = JSON.parse(e.data);
      if (version !== currentVersion) load();
    });
    es.onerror = () => status.classList.add('offline');
  }

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(fit, 200);
  });

  load();
  connect();
  // Safety net in case an update event is ever missed.
  setInterval(load, 60000);
})();
