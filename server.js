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
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY = 1024 * 1024;
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
};

// ---------- storage ----------

function loadMenu() {
  const file = fs.existsSync(DATA_FILE) ? DATA_FILE : DEFAULT_FILE;
  const menu = JSON.parse(fs.readFileSync(file, 'utf8'));
  const errors = validateMenu(menu);
  if (errors.length) throw new Error(`Invalid menu in ${file}: ${errors.join('; ')}`);
  return menu;
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
      });
    });
  });
  const ids = (menu.screens || []).map((s) => s.id);
  if (new Set(ids).size !== ids.length) errors.push('screen ids must be unique');
  return errors;
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

  if (req.method === 'GET' && p === '/api/auth') {
    if (!requireAuth(req, res)) return;
    return sendJson(res, 200, { ok: true });
  }

  if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });

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
