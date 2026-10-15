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
    let res = await fetch('/api/menu', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(menu),
    });
    if (res.status === 401) {
      password = prompt('Пароль менеджера:');
      if (password === null) { updateState(); return; }
      sessionStorage.setItem('kinobar-pass', password);
      return save();
    }
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
          <thead><tr><th>Название</th><th>Объём / вес</th><th>Цена</th><th>Старая цена</th><th>Есть</th><th>Хит</th><th>Скрыть</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <button data-act="add-item" data-cat="${si}.${ci}" style="margin-top:8px">+ Добавить позицию</button>
      </div>`;
    }).join('');

    main.innerHTML = `
      <div class="card row">
        <label class="f">Заголовок на ТВ<input type="text" data-screen="${si}" data-field="title" value="${escapeHtml(screen.title)}"></label>
        <label class="f">Цвет<input type="color" data-screen="${si}" data-field="accent" value="${escapeHtml(screen.accent || '#ffb400')}"></label>
        <span class="muted">Ссылка для телевизора: <a href="/screen/${screen.id}" target="_blank">/screen/${screen.id}</a></span>
      </div>
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
    main.innerHTML = `
      <div class="card">
        <label class="f" style="max-width:200px">Валюта на экранах<input type="text" data-settings="currency" value="${escapeHtml((menu.settings || {}).currency || '')}"></label>
      </div>
      <div class="card">
        <b>Экраны (телевизоры)</b>
        <table><tbody>${list}</tbody></table>
        <button data-act="add-screen" style="margin-top:8px">+ Добавить экран</button>
      </div>
      <div class="card row">
        <button data-act="export">Скачать резервную копию меню</button>
        <label class="f">Загрузить меню из файла<input type="file" id="import" accept=".json,application/json"></label>
      </div>`;
  }

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
      } else if (field === 'oldPrice') {
        if (el.value === '') delete item.oldPrice; else item.oldPrice = Number(el.value);
      } else {
        item[field] = el.value;
      }
    } else if (el.dataset.cat) {
      catAt(el.dataset.cat).cat.name = el.value;
    } else if (el.dataset.screen) {
      menu.screens[Number(el.dataset.screen)][field] = el.value;
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

  main.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'add-item') {
      const { cat } = catAt(btn.dataset.cat);
      cat.items.push({ name: '', size: '', price: 0, available: true });
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
