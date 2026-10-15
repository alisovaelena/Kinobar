'use strict';
// Kinobar menu server: serves the TV screens, the manager page and a small JSON API.
// No external dependencies — only Node.js (>= 18) is required.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'kinobar';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'menu.json');
const DEFAULT_FILE = path.join(__dirname, 'data', 'menu.default.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const MEDIA_DIR = path.join(DATA_DIR, 'media');
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY = 1024 * 1024;
const MAX_UPLOAD = 1024 * 1024 * 1024; // 1 GB per file — enough for a long promo video
const MEDIA_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg', '.mp4', '.webm']);
const VIDEO_EXT = new Set(['.mp4', '.webm']);
const MAX_BACKUPS = 50;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

// ---------- storage ----------

function loadMenu() {
  const file = fs.existsSync(DATA_FILE) ? DATA_FILE : DEFAULT_FILE;
  const menu = JSON.parse(fs.readFileSync(file, 'utf8'));
  const errors = validateMenu(menu);
  if (errors.length) throw new Error(`Invalid menu in ${file}: ${errors.join('; ')}`);
  ensureItemIds(menu);
  return menu;
}

// Slides point at menu items by id, so every item needs a stable one.
function ensureItemIds(m) {
  for (const screen of m.screens) {
    for (const cat of screen.categories) {
      for (const item of cat.items) if (!item.id) item.id = 'i' + crypto.randomBytes(4).toString('hex');
    }
  }
  return m;
}

function saveMenu(menu) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  if (fs.existsSync(DATA_FILE)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(DATA_FILE, path.join(BACKUP_DIR, `menu-${stamp}.json`));
    const backups = fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.json')).sort();
    for (const old of backups.slice(0, Math.max(0, backups.length - MAX_BACKUPS))) {
      fs.unlinkSync(path.join(BACKUP_DIR, old));
    }
  }
  // Write to a temp file first so a power cut never leaves a half-written menu.
  const tmp = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(menu, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

function validateMenu(menu) {
  const errors = [];
  if (!menu || typeof menu !== 'object') return ['menu must be an object'];
  if (!Array.isArray(menu.screens) || menu.screens.length === 0) errors.push('screens must be a non-empty array');
  (menu.screens || []).forEach((screen, si) => {
    const where = `screens[${si}]`;
    if (!Number.isInteger(screen.id) || screen.id < 1) errors.push(`${where}.id must be a positive integer`);
    if (typeof screen.title !== 'string') errors.push(`${where}.title must be a string`);
    if (screen.layout !== undefined && !['list', 'cards', 'slides'].includes(screen.layout)) errors.push(`${where}.layout must be list, cards or slides`);
    if (screen.slides !== undefined) {
      if (!Array.isArray(screen.slides)) errors.push(`${where}.slides must be an array`);
      else screen.slides.forEach((slide, sl) => {
        const sw = `${where}.slides[${sl}]`;
        if (!slide || typeof slide !== 'object') return errors.push(`${sw} must be an object`);
        checkMedia(errors, `${sw}.background`, slide.background);
        if (slide.labels !== undefined && !Array.isArray(slide.labels)) errors.push(`${sw}.labels must be an array`);
        (slide.labels || []).forEach((label, li) => {
          const lw = `${sw}.labels[${li}]`;
          if (!label || !['price', 'text'].includes(label.type)) errors.push(`${lw}.type must be price or text`);
          else if (!Number.isFinite(label.x) || !Number.isFinite(label.y)) errors.push(`${lw} needs x and y`);
        });
      });
    }
    checkMedia(errors, `${where}.background`, screen.background);
    if (screen.promos !== undefined) {
      if (!Array.isArray(screen.promos)) errors.push(`${where}.promos must be an array`);
      else screen.promos.forEach((promo, pi) => checkMedia(errors, `${where}.promos[${pi}].file`, promo && promo.file, true));
    }
    if (!Array.isArray(screen.categories)) {
      errors.push(`${where}.categories must be an array`);
      return;
    }
    screen.categories.forEach((cat, ci) => {
      const cw = `${where}.categories[${ci}]`;
      if (typeof cat.name !== 'string') errors.push(`${cw}.name must be a string`);
      if (!Array.isArray(cat.items)) {
        errors.push(`${cw}.items must be an array`);
        return;
      }
      cat.items.forEach((item, ii) => {
        const iw = `${cw}.items[${ii}]`;
        if (typeof item.name !== 'string' || !item.name.trim()) errors.push(`${iw}.name is required`);
        if (typeof item.price !== 'number' || !Number.isFinite(item.price) || item.price < 0) {
          errors.push(`${iw}.price must be a non-negative number`);
        }
        checkMedia(errors, `${iw}.image`, item.image);
        if (item.id !== undefined && typeof item.id !== 'string') errors.push(`${iw}.id must be a string`);
      });
    });
  });
  const ids = (menu.screens || []).map((s) => s.id);
  if (new Set(ids).size !== ids.length) errors.push('screen ids must be unique');
  return errors;
}

// Pictures and videos are referenced by URL: uploaded ones live under /media/, built-in demo art under /demo/.
function checkMedia(errors, where, value, required = false) {
  if (value === undefined || value === null || value === '') {
    if (required) errors.push(`${where} is required`);
    return;
  }
  if (typeof value !== 'string' || !/^\/(media|demo)\/[^/\\]+$/.test(value)) errors.push(`${where} must be a /media/ or /demo/ file`);
}

let menu = loadMenu();
let version = Date.now();

// ---------- live updates (Server-Sent Events) ----------

const clients = new Set();

function broadcast() {
  const payload = `event: menu\ndata: ${JSON.stringify({ version })}\n\n`;
  for (const res of clients) res.write(payload);
}

setInterval(() => {
  for (const res of clients) res.write(': ping\n\n');
}, 25000).unref();

// ---------- helpers ----------

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function isAuthorized(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) return false;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const password = decoded.slice(decoded.indexOf(':') + 1);
  const a = Buffer.from(password);
  const b = Buffer.from(ADMIN_PASSWORD);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function requireAuth(req, res) {
  if (isAuthorized(req)) return true;
  res.writeHead(401, {
    'WWW-Authenticate': 'Basic realm="Kinobar manager", charset="UTF-8"',
    'Content-Type': 'text/plain; charset=utf-8',
  });
  res.end('Нужен пароль менеджера');
  return false;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function serveFile(res, file) {
  const resolved = path.resolve(PUBLIC_DIR, file);
  if (!resolved.startsWith(PUBLIC_DIR + path.sep)) return sendJson(res, 404, { error: 'not found' });
  fs.readFile(resolved, (err, data) => {
    if (err) return sendJson(res, 404, { error: 'not found' });
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(resolved).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}

// ---------- media library ----------

function safeMediaName(original) {
  const ext = path.extname(original).toLowerCase();
  if (!MEDIA_EXT.has(ext)) return null;
  const base = path.basename(original, path.extname(original))
    .replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'file';
  let name = `${base}${ext}`;
  for (let n = 2; fs.existsSync(path.join(MEDIA_DIR, name)); n++) name = `${base}-${n}${ext}`;
  return name;
}

function listMedia() {
  if (!fs.existsSync(MEDIA_DIR)) return [];
  return fs.readdirSync(MEDIA_DIR)
    .filter((f) => MEDIA_EXT.has(path.extname(f).toLowerCase()))
    .map((f) => {
      const st = fs.statSync(path.join(MEDIA_DIR, f));
      return { url: `/media/${f}`, name: f, size: st.size, video: VIDEO_EXT.has(path.extname(f).toLowerCase()), mtime: st.mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

function mediaInUse(url) {
  return JSON.stringify(menu).includes(JSON.stringify(url));
}

function receiveUpload(req, res, original) {
  const name = safeMediaName(original || '');
  if (!name) return sendJson(res, 400, { error: 'Можно загружать только картинки (jpg, png, webp, gif, svg) и видео (mp4, webm)' });
  const declared = Number(req.headers['content-length'] || 0);
  if (declared > MAX_UPLOAD) return sendJson(res, 413, { error: 'Файл больше 1 ГБ' });
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  const final = path.join(MEDIA_DIR, name);
  const tmp = `${final}.uploading`;
  const out = fs.createWriteStream(tmp);
  let size = 0;
  let failed = false;
  const fail = (status, msg) => {
    if (failed) return;
    failed = true;
    out.destroy();
    fs.rm(tmp, { force: true }, () => {});
    if (!res.headersSent) sendJson(res, status, { error: msg });
  };
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_UPLOAD) {
      fail(413, 'Файл больше 1 ГБ');
      req.destroy();
    }
  });
  req.on('aborted', () => fail(400, 'Загрузка прервана'));
  out.on('error', () => fail(500, 'Не удалось сохранить файл'));
  out.on('finish', () => {
    if (failed) return;
    if (size === 0) return fail(400, 'Пустой файл');
    fs.renameSync(tmp, final);
    sendJson(res, 200, { url: `/media/${name}`, name, size, video: VIDEO_EXT.has(path.extname(name).toLowerCase()) });
  });
  req.pipe(out);
}

// Serves a file from `dir` with HTTP Range support, which TV browsers need to play and loop videos smoothly.
function serveStatic(req, res, dir, rel, cache) {
  const resolved = path.resolve(dir, rel);
  if (!resolved.startsWith(dir + path.sep)) return sendJson(res, 404, { error: 'not found' });
  fs.stat(resolved, (err, st) => {
    if (err || !st.isFile()) return sendJson(res, 404, { error: 'not found' });
    const headers = {
      'Content-Type': MIME[path.extname(resolved).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': cache,
      'Accept-Ranges': 'bytes',
    };
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (range && (range[1] || range[2])) {
      let start = range[1] ? Number(range[1]) : st.size - Number(range[2]);
      let end = range[1] && range[2] ? Number(range[2]) : st.size - 1;
      start = Math.max(0, start);
      end = Math.min(end, st.size - 1);
      if (start > end) {
        res.writeHead(416, { 'Content-Range': `bytes */${st.size}` });
        return res.end();
      }
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
      return fs.createReadStream(resolved, { start, end }).pipe(res);
    }
    res.writeHead(200, { ...headers, 'Content-Length': st.size });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(resolved).pipe(res);
  });
}

// ---------- routes ----------

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  if (req.method === 'GET' && p === '/api/menu') {
    return sendJson(res, 200, { version, menu });
  }

  if (req.method === 'PUT' && p === '/api/menu') {
    if (!requireAuth(req, res)) return;
    let next;
    try {
      next = JSON.parse(await readBody(req));
    } catch {
      return sendJson(res, 400, { error: 'Некорректный JSON' });
    }
    const errors = validateMenu(next);
    if (errors.length) return sendJson(res, 400, { error: 'Ошибка в данных', details: errors });
    ensureItemIds(next);
    saveMenu(next);
    menu = next;
    version = Date.now();
    broadcast();
    return sendJson(res, 200, { version });
  }

  if (req.method === 'GET' && p === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
    });
    res.write(`retry: 3000\nevent: menu\ndata: ${JSON.stringify({ version })}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  if (p === '/api/media') {
    if (!requireAuth(req, res)) return;
    if (req.method === 'GET') return sendJson(res, 200, { files: listMedia() });
    if (req.method === 'POST') return receiveUpload(req, res, url.searchParams.get('name'));
    return sendJson(res, 405, { error: 'method not allowed' });
  }

  if (req.method === 'DELETE' && p.startsWith('/api/media/')) {
    if (!requireAuth(req, res)) return;
    const name = decodeURIComponent(p.slice('/api/media/'.length));
    const file = path.resolve(MEDIA_DIR, name);
    if (!file.startsWith(MEDIA_DIR + path.sep) || !fs.existsSync(file)) return sendJson(res, 404, { error: 'Файл не найден' });
    if (mediaInUse(`/media/${name}`)) return sendJson(res, 409, { error: 'Файл используется в меню — сначала уберите его с экранов' });
    fs.unlinkSync(file);
    return sendJson(res, 200, { ok: true });
  }

  if ((req.method === 'GET' || req.method === 'HEAD') && p.startsWith('/media/')) {
    // Uploaded files never change under the same name, so TVs may cache them for long.
    return serveStatic(req, res, MEDIA_DIR, decodeURIComponent(p.slice('/media/'.length)), 'public, max-age=86400');
  }

  if (req.method === 'GET' && p === '/api/auth') {
    if (!requireAuth(req, res)) return;
    return sendJson(res, 200, { ok: true });
  }

  if ((req.method === 'GET' || req.method === 'HEAD') && p.startsWith('/demo/')) {
    return serveStatic(req, res, path.join(PUBLIC_DIR, 'demo'), decodeURIComponent(p.slice('/demo/'.length)), 'public, max-age=3600');
  }

  if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });

  if (p === '/favicon.ico') {
    res.writeHead(204);
    return res.end();
  }
  if (p === '/') return serveFile(res, 'index.html');
  if (p === '/admin' || p === '/admin/') {
    if (!requireAuth(req, res)) return;
    return serveFile(res, 'admin.html');
  }
  if (/^\/screen\/\d+\/?$/.test(p)) return serveFile(res, 'screen.html');
  return serveFile(res, p.slice(1));
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error(err);
    if (!res.headersSent) sendJson(res, 500, { error: 'Внутренняя ошибка сервера' });
    else res.end();
  });
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Кинобар: сервер запущен на http://localhost:${PORT}`);
    console.log(`  Экраны:   http://localhost:${PORT}/screen/1 ... /screen/${menu.screens.length}`);
    console.log(`  Менеджер: http://<IP-этого-компьютера>:${PORT}/admin`);
    if (!process.env.ADMIN_PASSWORD) console.log('  ВНИМАНИЕ: пароль по умолчанию "kinobar" — задайте ADMIN_PASSWORD');
  });
}

module.exports = { server, validateMenu };
