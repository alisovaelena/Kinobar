'use strict';
// Manager page: edit prices / items / screens and push them to all TVs with one click.

(function () {
  const $ = (sel) => document.querySelector(sel);
  const main = $('#main');
  const tabs = $('#tabs');
  const state = $('#state');
  const saveBtn = $('#save');

  let saved = null;     // menu as it is on the server
  let menu = null;      // working copy being edited
  let version = null;
  let tab = sessionStorage.getItem('kinobar-tab') || '1';
  let password = sessionStorage.getItem('kinobar-pass') || null;

  const clone = (x) => JSON.parse(JSON.stringify(x));
  const isDirty = () => JSON.stringify(menu) !== JSON.stringify(saved);

  function toast(text) {
    const t = $('#toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove('show'), 2500);
  }

  function updateState() {
    const dirty = isDirty();
    saveBtn.disabled = !dirty;
    state.className = dirty ? 'dirty' : '';
    state.textContent = dirty ? 'Есть несохранённые изменения' : 'Всё сохранено, на экранах актуально';
  }

  function authHeaders() {
    return password ? { Authorization: 'Basic ' + btoa(unescape(encodeURIComponent('manager:' + password))) } : {};
  }

  function askPassword() {
    const p = prompt('Пароль менеджера:');
    if (p === null) return false;
    password = p;
    sessionStorage.setItem('kinobar-pass', password);
    return true;
  }

  // fetch() that asks for the manager password again when the server says 401.
  async function api(method, url, body, headers = {}) {
    for (;;) {
      const res = await fetch(url, { method, body, headers: { ...headers, ...authHeaders() }, cache: 'no-store' });
      if (res.status !== 401 || !askPassword()) return res;
    }
  }

  async function load() {
    const res = await fetch('/api/menu', { cache: 'no-store' });
    const data = await res.json();
    saved = data.menu;
    menu = clone(saved);
    version = data.version;
    render();
  }

  async function save() {
    // Drop empty rows the manager added but never filled in.
    for (const s of menu.screens) for (const c of s.categories) c.items = c.items.filter((i) => i.name.trim());
    saveBtn.disabled = true;
    state.textContent = 'Сохраняю…';
    const res = await api('PUT', '/api/menu', JSON.stringify(menu), { 'Content-Type': 'application/json' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      state.className = 'err';
      state.textContent = 'Ошибка: ' + (data.error || res.status);
      if (data.details) alert(data.details.join('\n'));
      saveBtn.disabled = false;
      return;
    }
    version = data.version;
    saved = clone(menu);
    render();
    toast('Сохранено — экраны обновились');
  }

  // ---------- rendering ----------

  function render() {
    const screenTabs = menu.screens.map((s) =>
      `<button data-tab="${s.id}" class="${tab === String(s.id) ? 'active' : ''}">ТВ ${s.id}: ${escapeHtml(s.title)}</button>`).join('');
    tabs.innerHTML = screenTabs + `<button data-tab="settings" class="${tab === 'settings' ? 'active' : ''}">⚙ Настройки</button>`;

    const screen = menu.screens.find((s) => String(s.id) === tab);
    if (tab === 'settings' || !screen) {
      tab = 'settings';
      renderSettings();
    } else {
      renderScreen(screen);
    }
    updateState();
  }

  function savedItem(screen, ci, ii) {
    const s = saved.screens.find((x) => x.id === screen.id);
    return s && s.categories[ci] && s.categories[ci].items[ii];
  }

  function renderScreen(screen) {
    const si = menu.screens.indexOf(screen);
    const cats = screen.categories.map((cat, ci) => {
      const rows = cat.items.map((item, ii) => {
        const old = savedItem(screen, ci, ii);
        const priceChanged = !old || old.price !== item.price;
        const p = `${si}.${ci}.${ii}`;
        return `<tr>
          <td class="center" data-label="Фото"><button class="thumb-btn" data-act="pick-item-image" data-path="${p}" title="Выбрать фото">${thumb(item.image, '+ фото')}</button></td>
          <td class="wide" data-label="Название"><input type="text" data-path="${p}" data-field="name" value="${escapeHtml(item.name)}" placeholder="Название"></td>
          <td data-label="Объём / вес"><input type="text" data-path="${p}" data-field="size" value="${escapeHtml(item.size || '')}" placeholder="Объём / вес"></td>
          <td data-label="Цена"><input type="number" class="price${priceChanged ? ' changed' : ''}" min="0" step="1" data-path="${p}" data-field="price" value="${item.price}"></td>
          <td data-label="Старая цена"><input type="number" class="old" min="0" step="1" data-path="${p}" data-field="oldPrice" value="${item.oldPrice ?? ''}" placeholder="—"></td>
          <td class="center" data-label="В наличии"><input type="checkbox" data-path="${p}" data-field="available" ${item.available !== false ? 'checked' : ''} title="В наличии"></td>
          <td class="center" data-label="Хит"><input type="checkbox" data-path="${p}" data-field="hit" ${item.hit ? 'checked' : ''} title="Хит"></td>
          <td class="center" data-label="Скрыть"><input type="checkbox" data-path="${p}" data-field="hidden" ${item.hidden ? 'checked' : ''} title="Скрыть с экрана"></td>
          <td class="center" style="white-space:nowrap">
            <button class="ghost" data-act="up" data-path="${p}" title="Выше">↑</button><button class="ghost" data-act="down" data-path="${p}" title="Ниже">↓</button><button class="ghost danger" data-act="del-item" data-path="${p}" title="Удалить">✕</button>
          </td>
        </tr>`;
      }).join('');
      return `<div class="card">
        <div class="cat-head">
          <input type="text" data-cat="${si}.${ci}" value="${escapeHtml(cat.name)}" placeholder="Название раздела">
          <button class="ghost" data-act="cat-up" data-cat="${si}.${ci}" title="Раздел выше">↑</button>
          <button class="ghost" data-act="cat-down" data-cat="${si}.${ci}" title="Раздел ниже">↓</button>
          <button class="danger" data-act="del-cat" data-cat="${si}.${ci}">Удалить раздел</button>
        </div>
        <table>
          <thead><tr><th>Фото</th><th>Название</th><th>Объём / вес</th><th>Цена</th><th>Старая цена</th><th>Есть</th><th>Хит</th><th>Скрыть</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <button data-act="add-item" data-cat="${si}.${ci}" style="margin-top:8px">+ Добавить позицию</button>
      </div>`;
    }).join('');

    const promos = (screen.promos || []).map((promo, pi) => `<tr>
        <td>${thumb(promo.file)}</td>
        <td class="wide">${escapeHtml(fileName(promo.file))}</td>
        <td data-label="Сколько секунд"><input type="number" min="0" step="1" data-promo="${si}.${pi}" data-field="seconds" value="${promo.seconds ?? ''}" placeholder="${isVideo(promo.file) ? 'весь ролик' : '10'}" style="width:110px"></td>
        <td class="center">${isVideo(promo.file) ? `<label><input type="checkbox" data-promo="${si}.${pi}" data-field="sound" ${promo.sound ? 'checked' : ''}> звук</label>` : ''}</td>
        <td class="center"><button class="ghost danger" data-act="del-promo" data-promo="${si}.${pi}" title="Убрать">✕</button></td>
      </tr>`).join('');
    const effects = [['none', 'Без анимации'], ['popcorn', 'Падающий попкорн'], ['bubbles', 'Пузырьки (напитки)'], ['sparkles', 'Искры'], ['steam', 'Пар (кофе, чай)']];

    main.innerHTML = `
      <div class="card row">
        <label class="f">Заголовок на ТВ<input type="text" data-screen="${si}" data-field="title" value="${escapeHtml(screen.title)}"></label>
        <label class="f">Цвет<input type="color" data-screen="${si}" data-field="accent" value="${escapeHtml(screen.accent || '#ffb400')}"></label>
        <span class="muted">Ссылка для телевизора: <a href="/screen/${screen.id}" target="_blank">/screen/${screen.id}</a></span>
      </div>
      <details class="card" ${sessionStorage.getItem('kinobar-design') === '1' ? 'open' : ''} id="design">
        <summary><b>🎨 Оформление экрана: фон, анимация, ролики</b></summary>
        <div class="row" style="margin-top:12px; align-items:flex-start">
          ${screen.layout === 'slides' ? '' : `<div class="f">Фон (картинка или видео)
            <div class="row">
              <button class="thumb-btn big" data-act="pick-bg" data-screen="${si}">${thumb(screen.background, 'выбрать фон')}</button>
              ${screen.background ? `<button class="ghost danger" data-act="clear-bg" data-screen="${si}">Убрать фон</button>` : ''}
            </div>
          </div>
          <label class="f">Затемнение фона, чтобы цены читались: ${screen.dim ?? 55}%
            <input type="range" min="0" max="90" step="5" data-screen="${si}" data-field="dim" data-num="1" data-rerender="1" value="${screen.dim ?? 55}">
          </label>`}
          <label class="f">Вид меню
            <select data-screen="${si}" data-field="layout">
              <option value="list" ${screen.layout !== 'cards' ? 'selected' : ''}>Список (название …… цена)</option>
              <option value="cards" ${screen.layout === 'cards' ? 'selected' : ''}>Карточки с большими фото</option>
              <option value="slides" ${screen.layout === 'slides' ? 'selected' : ''}>Слайды дизайнера + живые цены</option>
            </select>
          </label>
          <label class="f">Анимация поверх фона
            <select data-screen="${si}" data-field="effect">
              ${effects.map(([v, t]) => `<option value="${v}" ${(screen.effect || 'none') === v ? 'selected' : ''}>${t}</option>`).join('')}
            </select>
          </label>
        </div>
        <div style="margin-top:16px">
          <b>Рекламные ролики и картинки</b>
          <div class="muted">Показываются на весь экран по очереди, затем снова меню.</div>
          <table><tbody>${promos}</tbody></table>
          <div class="row" style="margin-top:8px">
            <button data-act="add-promo" data-screen="${si}">+ Добавить ролик или картинку</button>
            <label class="f">Показывать каждые (секунд, 0 — выключено)
              <input type="number" min="0" step="10" data-screen="${si}" data-field="promoEvery" data-num="1" value="${screen.promoEvery ?? 0}" style="width:120px">
            </label>
          </div>
        </div>
      </details>
      ${screen.layout === 'slides' ? slideEd.html(si) + '<div class="card"><b>Цены этого экрана</b> <span class="muted">— меняете здесь, на слайдах обновится само</span></div>' : ''}
      ${cats}
      <button data-act="add-cat" data-screen="${si}">+ Добавить раздел</button>`;
  }

  function renderSettings() {
    const list = menu.screens.map((s, si) => `<tr>
      <td>ТВ ${s.id}</td>
      <td class="wide"><input type="text" data-screen="${si}" data-field="title" value="${escapeHtml(s.title)}"></td>
      <td><a href="/screen/${s.id}" target="_blank">открыть</a></td>
      <td><button class="danger" data-act="del-screen" data-screen="${si}">Удалить</button></td>
    </tr>`).join('');
    setTimeout(renderLibrary);
    main.innerHTML = `
      <div class="card">
        <label class="f" style="max-width:200px">Валюта на экранах<input type="text" data-settings="currency" value="${escapeHtml((menu.settings || {}).currency || '')}"></label>
      </div>
      <div class="card">
        <b>Экраны (телевизоры)</b>
        <table><tbody>${list}</tbody></table>
        <button data-act="add-screen" style="margin-top:8px">+ Добавить экран</button>
      </div>
      <div class="card">
        <b>Медиатека — загруженные фото и видео</b>
        <div class="muted">Лучше всего: видео MP4 (H.264) 1920×1080, картинки JPG/PNG. Файлы, которые стоят на экранах, удалить нельзя.</div>
        <div id="library" class="lib">Загрузка…</div>
        <button data-act="upload-only" style="margin-top:8px">+ Загрузить файлы</button>
      </div>
      <div class="card row">
        <button data-act="export">Скачать резервную копию меню</button>
        <label class="f">Загрузить меню из файла<input type="file" id="import" accept=".json,application/json"></label>
      </div>`;
  }

  // ---------- media ----------

  const DEMO = ['popcorn', 'caramel', 'combo', 'cola', 'lemonade', 'water', 'juice', 'nachos', 'hotdog', 'chips', 'chocolate', 'gummy', 'coffee', 'tea']
    .map((n) => `/demo/${n}.svg`);
  const DEMO_VIDEOS = ['bg-popcorn', 'bg-drinks', 'promo-combo'].map((n) => `/demo/${n}.webm`);

  function isVideo(url) { return /\.(mp4|webm)$/i.test(url || ''); }
  function fileName(url) { return decodeURIComponent(String(url || '').split('/').pop()); }
  function thumb(url, empty = '') {
    if (!url) return `<span class="thumb empty">${escapeHtml(empty)}</span>`;
    return isVideo(url)
      ? `<video class="thumb" src="${escapeHtml(url)}#t=1" muted preload="metadata"></video>`
      : `<img class="thumb" src="${escapeHtml(url)}" alt="">`;
  }
  function formatSize(bytes) {
    return bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} МБ` : `${Math.ceil(bytes / 1024)} КБ`;
  }

  async function listMedia() {
    const res = await api('GET', '/api/media');
    if (!res.ok) return [];
    return (await res.json()).files;
  }

  // Upload with a progress bar (videos can be large). Resolves with the uploaded file info.
  function uploadFile(file, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/media?name=${encodeURIComponent(file.name)}`);
      const auth = authHeaders().Authorization;
      if (auth) xhr.setRequestHeader('Authorization', auth);
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress && onProgress(e.loaded / e.total);
      xhr.onload = () => {
        let data = {};
        try { data = JSON.parse(xhr.responseText); } catch { /* ignore */ }
        if (xhr.status === 401 && askPassword()) return uploadFile(file, onProgress).then(resolve, reject);
        if (xhr.status !== 200) return reject(new Error(data.error || `Ошибка ${xhr.status}`));
        resolve(data);
      };
      xhr.onerror = () => reject(new Error('Нет связи с сервером'));
      xhr.send(file);
    });
  }

  function chooseFiles(accept, multiple) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.multiple = multiple;
      input.onchange = () => resolve([...input.files]);
      input.click();
    });
  }

  async function uploadMany(files) {
    const done = [];
    for (const [i, file] of files.entries()) {
      try {
        done.push(await uploadFile(file, (f) => { state.className = ''; state.textContent = `Загрузка ${i + 1}/${files.length}: ${Math.round(f * 100)}%`; }));
      } catch (err) {
        alert(`${file.name}: ${err.message}`);
      }
    }
    updateState();
    return done;
  }

  // Modal with demo art, uploaded files and an upload button. Resolves with a URL, '' for "none", or null if closed.
  function pickMedia({ videos, title }) {
    return new Promise(async (resolve) => {
      const accept = videos ? 'image/*,video/mp4,video/webm' : 'image/*';
      const modal = document.createElement('div');
      modal.className = 'modal';
      modal.innerHTML = `<div class="modal-box"><div class="row" style="justify-content:space-between"><b>${escapeHtml(title)}</b><button class="ghost" data-close>✕</button></div><div class="lib" id="pick">Загрузка…</div></div>`;
      document.body.appendChild(modal);
      const close = (value) => { modal.remove(); resolve(value); };
      const fill = async () => {
        const files = (await listMedia()).filter((f) => videos || !f.video);
        const tiles = [
          `<button class="tile upload" data-upload>+ Загрузить с компьютера</button>`,
          `<button class="tile" data-url=""><span class="thumb empty">без картинки</span></button>`,
          ...files.map((f) => `<button class="tile" data-url="${escapeHtml(f.url)}">${thumb(f.url)}<span>${escapeHtml(f.name)}</span></button>`),
          ...(videos ? DEMO_VIDEOS : []).map((u) => `<button class="tile" data-url="${u}">${thumb(u)}<span>демо: ${fileName(u)}</span></button>`),
          ...DEMO.map((u) => `<button class="tile" data-url="${u}">${thumb(u)}<span>демо: ${fileName(u)}</span></button>`),
        ];
        modal.querySelector('#pick').innerHTML = tiles.join('');
      };
      modal.addEventListener('click', async (e) => {
        if (e.target === modal || e.target.closest('[data-close]')) return close(null);
        if (e.target.closest('[data-upload]')) {
          const files = await chooseFiles(accept, false);
          if (!files.length) return;
          const [up] = await uploadMany(files);
          if (up) close(up.url);
          return;
        }
        const tile = e.target.closest('[data-url]');
        if (tile) close(tile.dataset.url);
      });
      fill();
    });
  }

  async function renderLibrary() {
    const box = $('#library');
    if (!box) return;
    const files = await listMedia();
    box.innerHTML = files.length
      ? files.map((f) => `<div class="tile">${thumb(f.url)}<span>${escapeHtml(f.name)}<br><span class="muted">${formatSize(f.size)}</span></span><button class="ghost danger" data-act="del-media" data-name="${escapeHtml(f.name)}">Удалить</button></div>`).join('')
      : '<span class="muted">Пока ничего не загружено</span>';
  }

  const slideEd = window.KinobarSlideEditor({ getMenu: () => menu, render, updateState: () => updateState(), pickMedia, thumb });

  // ---------- editing ----------

  function itemAt(path) {
    const [si, ci, ii] = path.split('.').map(Number);
    return { list: menu.screens[si].categories[ci].items, ii, item: menu.screens[si].categories[ci].items[ii] };
  }
  function catAt(path) {
    const [si, ci] = path.split('.').map(Number);
    return { list: menu.screens[si].categories, ci, cat: menu.screens[si].categories[ci] };
  }
  function move(list, i, delta) {
    const j = i + delta;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
  }

  main.addEventListener('input', (e) => {
    const el = e.target;
    const field = el.dataset.field;
    if (slideEd.onInput(el)) return updateState();
    if (el.dataset.path) {
      const { item } = itemAt(el.dataset.path);
      if (el.type === 'checkbox') {
        if (field === 'available') item.available = el.checked;
        else if (el.checked) item[field] = true;
        else delete item[field];
      } else if (field === 'price') {
        item.price = el.value === '' ? 0 : Number(el.value);
        const [si, ci, ii] = el.dataset.path.split('.').map(Number);
        const old = savedItem(menu.screens[si], ci, ii);
        el.classList.toggle('changed', !old || old.price !== item.price);
        slideEd.refreshAll(si);
      } else if (field === 'oldPrice') {
        if (el.value === '') delete item.oldPrice; else item.oldPrice = Number(el.value);
      } else {
        item[field] = el.value;
      }
    } else if (el.dataset.cat) {
      catAt(el.dataset.cat).cat.name = el.value;
    } else if (el.dataset.promo) {
      const [si, pi] = el.dataset.promo.split('.').map(Number);
      const promo = menu.screens[si].promos[pi];
      if (el.type === 'checkbox') promo[field] = el.checked;
      else if (el.value === '') delete promo[field];
      else promo[field] = Number(el.value);
    } else if (el.dataset.screen) {
      menu.screens[Number(el.dataset.screen)][field] = el.dataset.num ? Number(el.value) || 0 : el.value;
      if (field === 'layout') return render();
      if (el.dataset.rerender) { const label = el.closest('label'); if (label) label.firstChild.textContent = `Затемнение фона, чтобы цены читались: ${el.value}%`; }
    } else if (el.dataset.settings) {
      menu.settings = menu.settings || {};
      menu.settings[el.dataset.settings] = el.value;
    }
    updateState();
  });

  main.addEventListener('change', (e) => {
    if (e.target.id !== 'import' || !e.target.files[0]) return;
    e.target.files[0].text().then((text) => {
      try {
        const data = JSON.parse(text);
        menu = data.menu || data;
        render();
        toast('Меню загружено из файла — проверьте и нажмите «Сохранить»');
      } catch {
        alert('Не удалось прочитать файл');
      }
    });
  });

  main.addEventListener('toggle', (e) => {
    if (e.target.id === 'design') sessionStorage.setItem('kinobar-design', e.target.open ? '1' : '0');
  }, true);

  main.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (await slideEd.onClick(btn)) return;
    if (act === 'pick-item-image') {
      const { item } = itemAt(btn.dataset.path);
      const url = await pickMedia({ videos: false, title: `Фото: ${item.name || 'позиция'}` });
      if (url === null) return;
      if (url) item.image = url; else delete item.image;
      return render();
    }
    if (act === 'pick-bg') {
      const screen = menu.screens[Number(btn.dataset.screen)];
      const url = await pickMedia({ videos: true, title: 'Фон экрана — картинка или видео' });
      if (url === null) return;
      if (url) screen.background = url; else delete screen.background;
      return render();
    }
    if (act === 'clear-bg') {
      delete menu.screens[Number(btn.dataset.screen)].background;
      return render();
    }
    if (act === 'add-promo') {
      const screen = menu.screens[Number(btn.dataset.screen)];
      const url = await pickMedia({ videos: true, title: 'Рекламный ролик или картинка' });
      if (!url) return;
      screen.promos = screen.promos || [];
      screen.promos.push({ file: url });
      if (!screen.promoEvery) screen.promoEvery = 60;
      return render();
    }
    if (act === 'del-promo') {
      const [si, pi] = btn.dataset.promo.split('.').map(Number);
      menu.screens[si].promos.splice(pi, 1);
      return render();
    }
    if (act === 'upload-only') {
      const files = await chooseFiles('image/*,video/mp4,video/webm', true);
      if (files.length) { await uploadMany(files); toast('Файлы загружены'); }
      return renderLibrary();
    }
    if (act === 'del-media') {
      if (!confirm(`Удалить файл «${btn.dataset.name}»?`)) return;
      const res = await api('DELETE', `/api/media/${encodeURIComponent(btn.dataset.name)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) alert(data.error || 'Не удалось удалить');
      return renderLibrary();
    }
    if (act === 'add-item') {
      const { cat } = catAt(btn.dataset.cat);
      cat.items.push({ id: slideEd.newId(), name: '', size: '', price: 0, available: true });
      render();
      const inputs = main.querySelectorAll(`input[data-path^="${btn.dataset.cat}."][data-field="name"]`);
      inputs[inputs.length - 1].focus();
      return;
    }
    if (act === 'del-item') {
      const { list, ii, item } = itemAt(btn.dataset.path);
      if (!item.name || confirm(`Удалить «${item.name}»?`)) list.splice(ii, 1);
    } else if (act === 'up' || act === 'down') {
      const { list, ii } = itemAt(btn.dataset.path);
      move(list, ii, act === 'up' ? -1 : 1);
    } else if (act === 'cat-up' || act === 'cat-down') {
      const { list, ci } = catAt(btn.dataset.cat);
      move(list, ci, act === 'cat-up' ? -1 : 1);
    } else if (act === 'add-cat') {
      menu.screens[Number(btn.dataset.screen)].categories.push({ name: 'Новый раздел', items: [] });
    } else if (act === 'del-cat') {
      const { list, ci, cat } = catAt(btn.dataset.cat);
      if (confirm(`Удалить раздел «${cat.name}» со всеми позициями?`)) list.splice(ci, 1);
    } else if (act === 'add-screen') {
      const id = Math.max(0, ...menu.screens.map((s) => s.id)) + 1;
      menu.screens.push({ id, title: `Экран ${id}`, accent: '#ffb400', categories: [] });
    } else if (act === 'del-screen') {
      const s = menu.screens[Number(btn.dataset.screen)];
      if (menu.screens.length > 1 && confirm(`Удалить экран ТВ ${s.id} «${s.title}»?`)) menu.screens.splice(menu.screens.indexOf(s), 1);
    } else if (act === 'export') {
      const blob = new Blob([JSON.stringify(menu, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `kinobar-menu-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      return;
    }
    render();
  });

  tabs.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-tab]');
    if (!btn) return;
    tab = btn.dataset.tab;
    sessionStorage.setItem('kinobar-tab', tab);
    render();
  });

  saveBtn.addEventListener('click', save);
  $('#revert').addEventListener('click', () => {
    if (isDirty() && confirm('Отменить все несохранённые изменения?')) { menu = clone(saved); render(); }
  });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (isDirty()) save();
    }
  });
  window.addEventListener('beforeunload', (e) => {
    if (menu && isDirty()) { e.preventDefault(); e.returnValue = ''; }
  });

  // Someone else (another manager tab) saved the menu.
  const es = new EventSource('/api/events');
  es.addEventListener('menu', (e) => {
    const data = JSON.parse(e.data);
    if (version === null || data.version === version) return;
    if (!isDirty()) load().then(() => toast('Меню обновлено с сервера'));
    else { state.className = 'err'; state.textContent = 'Меню изменили в другом окне — сохранение перезапишет их'; }
  });

  load().catch(() => { state.className = 'err'; state.textContent = 'Нет связи с сервером'; });
})();
