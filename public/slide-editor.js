'use strict';
// Slide editor for the manager page: pick a designer picture, then place live price
// labels on it by dragging. Uses the same label styling as the TV (screen.html).

window.KinobarSlideEditor = function (ctx) {
  // ctx: { getMenu, render, updateState, pickMedia, thumb }
  const FONTS = ['Open Sans', 'Montserrat', 'Rubik', 'Russo One', 'Caveat'];
  const ALIGN = { left: ['0%', 'left center'], center: ['-50%', 'center'], right: ['-100%', 'right center'] };
  let sel = null; // { si, sl, li } — the selected label

  const menu = () => ctx.getMenu();
  const isVideo = (url) => /\.(mp4|webm)$/i.test(url || '');
  const newId = () => 'i' + Math.random().toString(16).slice(2, 10);

  function allItems() {
    const list = [];
    for (const s of menu().screens) for (const c of s.categories) for (const i of c.items) {
      if (!i.id) i.id = newId();
      list.push({ id: i.id, item: i, label: `${s.title} · ${i.name}${i.size ? ' ' + i.size : ''}` });
    }
    return list;
  }

  function labelText(label) {
    if (label.type === 'text') return label.text || 'Текст';
    const found = allItems().find((x) => x.id === label.item);
    if (!found) return '? выберите товар';
    return `${label.prefix || ''}${formatPrice(found.item.price)}${suffixOf(label)}`;
  }

  function suffixOf(label) {
    const currency = (menu().settings || {}).currency || '';
    return label.suffix ?? (currency ? ` ${currency}` : '');
  }

  function labelStyle(label) {
    const [tx, origin] = ALIGN[label.align] || ALIGN.left;
    const font = label.font || 'Open Sans';
    return `left:${label.x}%;top:${label.y}%;--size:${label.size || 8};--tx:${tx};--origin:${origin};color:${label.color || '#ffffff'};` +
      `font-family:'${font}', 'Segoe UI', Arial, sans-serif;font-weight:${label.weight || (font === 'Open Sans' ? 600 : 800)}`;
  }

  function stageHtml(si, sl) {
    const slide = menu().screens[si].slides[sl];
    const bg = slide.background
      ? (isVideo(slide.background)
        ? `<video class="sbg" src="${escapeHtml(slide.background)}" muted loop autoplay playsinline></video>`
        : `<img class="sbg" src="${escapeHtml(slide.background)}" alt="">`)
      : '<div class="sbg empty-bg">Выберите картинку или видео для слайда</div>';
    const labels = (slide.labels || []).map((label, li) => {
      const selected = sel && sel.si === si && sel.sl === sl && sel.li === li;
      return `<div class="label ed-label${label.shadow !== false ? ' shadow' : ''}${selected ? ' selected' : ''}" data-label="${si}.${sl}.${li}" style="${labelStyle(label)}">${escapeHtml(labelText(label))}</div>`;
    }).join('');
    return bg + labels;
  }

  function panelHtml(si, sl) {
    if (!sel || sel.si !== si || sel.sl !== sl) {
      return '<div class="muted">Нажмите на цену на слайде, чтобы настроить её, или перетащите её мышкой в нужное место.</div>';
    }
    const label = menu().screens[si].slides[sl].labels[sel.li];
    if (!label) return '';
    const k = `${si}.${sl}.${sel.li}`;
    const f = (field) => `data-lbl="${k}" data-field="${field}"`;
    const what = label.type === 'price'
      ? `<label class="f">Товар (цена берётся из таблицы ниже)
          <select ${f('item')}>${allItems().map((x) => `<option value="${x.id}" ${x.id === label.item ? 'selected' : ''}>${escapeHtml(x.label)}</option>`).join('')}</select></label>
        <label class="f">Перед ценой<input type="text" ${f('prefix')} value="${escapeHtml(label.prefix || '')}" placeholder="например: от " style="width:110px"></label>
        <label class="f">После цены<input type="text" ${f('suffix')} value="${escapeHtml(suffixOf(label))}" style="width:70px"></label>`
      : `<label class="f" style="flex:1">Текст<input type="text" ${f('text')} value="${escapeHtml(label.text || '')}"></label>`;
    return `<div class="row" style="align-items:flex-end">
      ${what}
      <label class="f">Шрифт<select ${f('font')}>${FONTS.map((n) => `<option ${n === (label.font || 'Open Sans') ? 'selected' : ''} style="font-family:'${n}'">${n}</option>`).join('')}</select></label>
      <label class="f">Размер<input type="range" min="2" max="30" step="0.5" ${f('size')} value="${label.size || 8}"></label>
      <label class="f">Цвет<input type="color" ${f('color')} value="${escapeHtml(label.color || '#ffffff')}"></label>
      <label class="f">Выравнивание<select ${f('align')}>
        <option value="left" ${(label.align || 'left') === 'left' ? 'selected' : ''}>от точки вправо</option>
        <option value="center" ${label.align === 'center' ? 'selected' : ''}>по центру</option>
        <option value="right" ${label.align === 'right' ? 'selected' : ''}>от точки влево</option></select></label>
      <label class="f">Тень<span><input type="checkbox" ${f('shadow')} ${label.shadow !== false ? 'checked' : ''}></span></label>
      <label class="f">Пульсация<span><input type="checkbox" ${f('pulse')} ${label.pulse ? 'checked' : ''}></span></label>
      <button class="danger" data-act="del-label" data-lbl="${k}">Удалить</button>
    </div>`;
  }

  function html(si) {
    const screen = menu().screens[si];
    screen.slides = screen.slides || [];
    const list = screen.slides.map((slide, sl) => `
      <div class="card slide-card">
        <div class="row" style="justify-content:space-between">
          <b>Слайд ${sl + 1}${slide.hidden ? ' (скрыт)' : ''}</b>
          <span>
            <button class="ghost" data-act="slide-up" data-slide="${si}.${sl}" title="Раньше">↑</button>
            <button class="ghost" data-act="slide-down" data-slide="${si}.${sl}" title="Позже">↓</button>
            <button class="ghost danger" data-act="del-slide" data-slide="${si}.${sl}">Удалить слайд</button>
          </span>
        </div>
        <div class="ed-stage" data-stage="${si}.${sl}">${stageHtml(si, sl)}</div>
        <div class="row" style="margin-top:8px">
          <button data-act="slide-bg" data-slide="${si}.${sl}">🖼 Картинка / видео</button>
          <button data-act="add-price" data-slide="${si}.${sl}">+ Цена</button>
          <button data-act="add-text" data-slide="${si}.${sl}">+ Текст</button>
          <label class="f">Секунд на экране<input type="number" min="0" step="1" data-sld="${si}.${sl}" data-field="seconds" value="${slide.seconds ?? ''}" placeholder="${isVideo(slide.background) ? 'весь ролик' : '10'}" style="width:100px"></label>
          <label class="f">Появление<select data-sld="${si}.${sl}" data-field="transition">
            ${[['fade', 'плавно'], ['slide', 'выезд сбоку'], ['zoom', 'приближение']].map(([v, t]) => `<option value="${v}" ${(slide.transition || 'fade') === v ? 'selected' : ''}>${t}</option>`).join('')}
          </select></label>
          <label><input type="checkbox" data-sld="${si}.${sl}" data-field="zoom" ${slide.zoom !== false ? 'checked' : ''}> медленный наезд камеры</label>
          <label><input type="checkbox" data-sld="${si}.${sl}" data-field="hidden" ${slide.hidden ? 'checked' : ''}> скрыть</label>
        </div>
        <div class="label-panel" data-panel="${si}.${sl}">${panelHtml(si, sl)}</div>
      </div>`).join('');
    return `<div class="card">
        <b>Слайды</b>
        <div class="muted">Картинка от дизайнера <b>без цен</b>, цены программа ставит сверху сама и меняет их, когда вы меняете цену в таблице ниже.
        Цены можно таскать мышкой по слайду.</div>
      </div>
      ${list}
      <button data-act="add-slide" data-screen="${si}" style="margin-bottom:14px">+ Добавить слайд</button>`;
  }

  function refreshSlide(si, sl) {
    const stage = document.querySelector(`[data-stage="${si}.${sl}"]`);
    if (stage) stage.innerHTML = stageHtml(si, sl);
    const panel = document.querySelector(`[data-panel="${si}.${sl}"]`);
    if (panel) panel.innerHTML = panelHtml(si, sl);
  }

  function select(next) {
    const prev = sel;
    sel = next;
    if (prev) refreshSlide(prev.si, prev.sl);
    if (next && (!prev || prev.si !== next.si || prev.sl !== next.sl)) refreshSlide(next.si, next.sl);
  }

  const parse = (s) => s.split('.').map(Number);

  // ---- drag labels with mouse / finger ----
  let drag = null;
  document.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.ed-label');
    if (!el) return;
    e.preventDefault();
    const [si, sl, li] = parse(el.dataset.label);
    if (!sel || sel.si !== si || sel.sl !== sl || sel.li !== li) {
      select({ si, sl, li });
    }
    const fresh = document.querySelector(`.ed-label[data-label="${si}.${sl}.${li}"]`);
    const stage = fresh.closest('.ed-stage').getBoundingClientRect();
    const label = menu().screens[si].slides[sl].labels[li];
    drag = { el: fresh, stage, label, dx: e.clientX - (stage.left + stage.width * label.x / 100), dy: e.clientY - (stage.top + stage.height * label.y / 100) };
    try { fresh.setPointerCapture(e.pointerId); } catch { /* not critical */ }
  });
  document.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const { stage, label } = drag;
    label.x = Math.round(Math.min(100, Math.max(0, (e.clientX - drag.dx - stage.left) / stage.width * 100)) * 10) / 10;
    label.y = Math.round(Math.min(100, Math.max(0, (e.clientY - drag.dy - stage.top) / stage.height * 100)) * 10) / 10;
    const el = document.querySelector(`.ed-label.selected`) || drag.el;
    el.style.left = `${label.x}%`;
    el.style.top = `${label.y}%`;
  });
  document.addEventListener('pointerup', () => {
    if (!drag) return;
    drag = null;
    ctx.updateState();
  });

  // ---- inputs ----
  function onInput(el) {
    if (el.dataset.lbl) {
      const [si, sl, li] = parse(el.dataset.lbl);
      const label = menu().screens[si].slides[sl].labels[li];
      const field = el.dataset.field;
      if (el.type === 'checkbox') label[field] = el.checked;
      else if (field === 'size') label.size = Number(el.value);
      else label[field] = el.value;
      const stage = document.querySelector(`[data-stage="${si}.${sl}"]`);
      if (stage) stage.innerHTML = stageHtml(si, sl);
      return true;
    }
    if (el.dataset.sld) {
      const [si, sl] = parse(el.dataset.sld);
      const slide = menu().screens[si].slides[sl];
      const field = el.dataset.field;
      if (el.type === 'checkbox') slide[field] = el.checked;
      else if (field === 'seconds') { if (el.value === '') delete slide.seconds; else slide.seconds = Number(el.value); }
      else slide[field] = el.value;
      return true;
    }
    return false;
  }

  async function onClick(btn) {
    const act = btn.dataset.act;
    if (act === 'add-slide') {
      const si = Number(btn.dataset.screen);
      const url = await ctx.pickMedia({ videos: true, title: 'Картинка или видео для нового слайда (лучше без цен)' });
      if (url === null) return true;
      const screen = menu().screens[si];
      screen.slides = screen.slides || [];
      screen.slides.push({ background: url || undefined, labels: [] });
      ctx.render();
      return true;
    }
    if (!btn.dataset.slide && !btn.dataset.lbl) return false;
    if (act === 'del-label') {
      const [si, sl, li] = parse(btn.dataset.lbl);
      menu().screens[si].slides[sl].labels.splice(li, 1);
      sel = null;
      refreshSlide(si, sl);
      ctx.updateState();
      return true;
    }
    const [si, sl] = parse(btn.dataset.slide);
    const screen = menu().screens[si];
    const slide = screen.slides[sl];
    if (act === 'slide-bg') {
      const url = await ctx.pickMedia({ videos: true, title: `Слайд ${sl + 1}: картинка или видео` });
      if (url === null) return true;
      if (url) slide.background = url; else delete slide.background;
      refreshSlide(si, sl);
    } else if (act === 'add-price' || act === 'add-text') {
      slide.labels = slide.labels || [];
      const items = allItems();
      const own = items.find((x) => screen.categories.some((c) => c.items.includes(x.item))) || items[0];
      slide.labels.push(act === 'add-price'
        ? { type: 'price', item: own && own.id, x: 40, y: 50, size: 8, color: '#ffffff', font: 'Open Sans' }
        : { type: 'text', text: 'Текст', x: 40, y: 30, size: 6, color: '#ffffff', font: 'Open Sans' });
      sel = { si, sl, li: slide.labels.length - 1 };
      refreshSlide(si, sl);
    } else if (act === 'del-slide') {
      if (!confirm(`Удалить слайд ${sl + 1}?`)) return true;
      screen.slides.splice(sl, 1);
      sel = null;
      ctx.render();
    } else if (act === 'slide-up' || act === 'slide-down') {
      const j = sl + (act === 'slide-up' ? -1 : 1);
      if (j >= 0 && j < screen.slides.length) [screen.slides[sl], screen.slides[j]] = [screen.slides[j], screen.slides[sl]];
      sel = null;
      ctx.render();
    }
    ctx.updateState();
    return true;
  }

  // When prices change in the table, keep the slide previews in sync.
  function refreshAll(si) {
    (menu().screens[si].slides || []).forEach((_, sl) => {
      const stage = document.querySelector(`[data-stage="${si}.${sl}"]`);
      if (stage) stage.querySelectorAll('.ed-label').forEach((el) => {
        const [, , li] = parse(el.dataset.label);
        el.textContent = labelText(menu().screens[si].slides[sl].labels[li]);
      });
    });
  }

  return { html, onInput, onClick, refreshAll, newId };
};
