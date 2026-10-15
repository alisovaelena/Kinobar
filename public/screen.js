'use strict';
// TV menu board. Shows one screen of the menu, refreshes itself the moment
// the manager saves new prices, and keeps working through network hiccups.

(function () {
  const screenId = Number(location.pathname.split('/').filter(Boolean)[1]) || 1;
  const inner = document.getElementById('inner');
  const status = document.getElementById('status');
  const errorBox = document.getElementById('error');
  let currentVersion = null;
  let lastPrices = new Map();

  function render(menu) {
    const screen = menu.screens.find((s) => s.id === screenId);
    if (!screen) {
      inner.innerHTML = '';
      errorBox.style.display = 'flex';
      errorBox.textContent = `Экран ${screenId} не настроен`;
      return;
    }
    errorBox.style.display = 'none';
    document.title = `Кинобар — ${screen.title}`;
    document.documentElement.style.setProperty('--accent', screen.accent || '#ffb400');
    const currency = (menu.settings && menu.settings.currency) || '';

    const prices = new Map();
    const cats = screen.categories
      .filter((cat) => !cat.hidden && cat.items.some((i) => !i.hidden))
      .map((cat, ci) => {
        const items = cat.items.filter((i) => !i.hidden).map((item, ii) => {
          const key = `${ci}:${ii}:${item.name}:${item.size || ''}`;
          prices.set(key, item.price);
          const changed = lastPrices.size > 0 && lastPrices.get(key) !== item.price;
          const out = item.available === false;
          return `<div class="item${out ? ' out' : ''}">
            <span class="name">${escapeHtml(item.name)}</span>
            ${item.size ? `<span class="size">${escapeHtml(item.size)}</span>` : ''}
            ${item.hit && !out ? '<span class="hit">хит</span>' : ''}
            <span class="dots"></span>
            ${out ? '<span class="soldout">закончился</span>' : ''}
            <span class="price${changed ? ' flash' : ''}">${item.oldPrice && !out ? `<span class="old">${escapeHtml(formatPrice(item.oldPrice))}</span>` : ''}${escapeHtml(formatPrice(item.price, currency))}</span>
          </div>`;
        }).join('');
        return `<section class="cat">${cat.name ? `<h2>${escapeHtml(cat.name)}</h2>` : ''}${items}</section>`;
      }).join('');
    lastPrices = prices;

    inner.innerHTML = `<h1>${escapeHtml(screen.title)}</h1><div class="cols">${cats}</div>`;
    fit();
  }

  // Pick the column count and the largest font size that fit the whole menu on the TV.
  function fit() {
    const cols = inner.querySelector('.cols');
    if (!cols) return;
    // #inner stretches to fill the board, so its client box is exactly the space available.
    const maxW = inner.clientWidth;
    const maxH = inner.clientHeight;
    let best = { size: 8, cols: 1 };
    for (let c = 1; c <= 3; c++) {
      cols.style.setProperty('--cols', c);
      let lo = 8, hi = 120;
      while (hi - lo > 0.5) {
        const mid = (lo + hi) / 2;
        inner.style.setProperty('--fs', `${mid}px`);
        if (inner.scrollHeight <= maxH && inner.scrollWidth <= maxW && rowsFit(cols)) lo = mid;
        else hi = mid;
      }
      if (lo > best.size) best = { size: lo, cols: c };
    }
    cols.style.setProperty('--cols', best.cols);
    inner.style.setProperty('--fs', `${best.size}px`);
  }

  // A row overflows when name + size + price don't fit in its column width.
  function rowsFit(cols) {
    for (const row of cols.querySelectorAll('.item, .cat h2')) {
      if (row.scrollWidth > row.clientWidth + 1) return false;
    }
    return true;
  }

  async function load() {
    try {
      const res = await fetch('/api/menu', { cache: 'no-store' });
      if (!res.ok) throw new Error(res.status);
      const data = await res.json();
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
