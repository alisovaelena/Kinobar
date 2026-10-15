'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kinobar-'));
process.env.DATA_DIR = dataDir;
process.env.ADMIN_PASSWORD = 'secret';
const { server } = require('../server');

let base;
const auth = { Authorization: 'Basic ' + Buffer.from('manager:secret').toString('base64') };

before(() => new Promise((resolve) => server.listen(0, () => {
  base = `http://127.0.0.1:${server.address().port}`;
  resolve();
})));
after(() => {
  server.closeAllConnections();
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('serves default menu with 5 screens', async () => {
  const res = await fetch(`${base}/api/menu`);
  assert.strictEqual(res.status, 200);
  const { menu } = await res.json();
  assert.strictEqual(menu.screens.length, 5);
});

test('screen and admin pages', async () => {
  assert.strictEqual((await fetch(`${base}/screen/3`)).status, 200);
  assert.strictEqual((await fetch(`${base}/admin`)).status, 401);
  assert.strictEqual((await fetch(`${base}/admin`, { headers: auth })).status, 200);
  assert.strictEqual((await fetch(`${base}/../server.js`)).status, 404);
  assert.strictEqual((await fetch(`${base}/%2e%2e/server.js`)).status, 404);
});

test('saving requires password', async () => {
  const { menu } = await (await fetch(`${base}/api/menu`)).json();
  const res = await fetch(`${base}/api/menu`, { method: 'PUT', body: JSON.stringify(menu) });
  assert.strictEqual(res.status, 401);
});

test('rejects invalid prices', async () => {
  const { menu } = await (await fetch(`${base}/api/menu`)).json();
  menu.screens[0].categories[0].items[0].price = -5;
  const res = await fetch(`${base}/api/menu`, { method: 'PUT', headers: auth, body: JSON.stringify(menu) });
  assert.strictEqual(res.status, 400);
});

test('price change is saved, persisted and pushed to screens', async () => {
  const controller = new AbortController();
  const events = await fetch(`${base}/api/events`, { signal: controller.signal });
  const reader = events.body.getReader();
  const decoder = new TextDecoder();
  const first = decoder.decode((await reader.read()).value);
  assert.match(first, /event: menu/);

  const { menu } = await (await fetch(`${base}/api/menu`)).json();
  menu.screens[0].categories[0].items[0].price = 333;
  const res = await fetch(`${base}/api/menu`, { method: 'PUT', headers: auth, body: JSON.stringify(menu) });
  assert.strictEqual(res.status, 200);
  const { version } = await res.json();

  const pushed = decoder.decode((await reader.read()).value);
  assert.match(pushed, new RegExp(`"version":${version}`));
  controller.abort();

  const after = await (await fetch(`${base}/api/menu`)).json();
  assert.strictEqual(after.menu.screens[0].categories[0].items[0].price, 333);
  const onDisk = JSON.parse(fs.readFileSync(path.join(dataDir, 'menu.json'), 'utf8'));
  assert.strictEqual(onDisk.screens[0].categories[0].items[0].price, 333);
});

test('keeps a backup of the previous menu', async () => {
  const { menu } = await (await fetch(`${base}/api/menu`)).json();
  menu.screens[0].categories[0].items[0].price = 444;
  await fetch(`${base}/api/menu`, { method: 'PUT', headers: auth, body: JSON.stringify(menu) });
  const backups = fs.readdirSync(path.join(dataDir, 'backups'));
  assert.ok(backups.length >= 1);
});

test('uploads, serves (with ranges) and deletes media', async () => {
  const body = Buffer.alloc(5000, 7);
  const up = await fetch(`${base}/api/media?name=${encodeURIComponent('Промо ролик.mp4')}`, { method: 'POST', headers: auth, body });
  assert.strictEqual(up.status, 200);
  const file = await up.json();
  assert.match(file.url, /^\/media\/.+\.mp4$/);
  assert.strictEqual(file.video, true);

  const noAuth = await fetch(`${base}/api/media?name=x.png`, { method: 'POST', body });
  assert.strictEqual(noAuth.status, 401);
  const bad = await fetch(`${base}/api/media?name=virus.exe`, { method: 'POST', headers: auth, body });
  assert.strictEqual(bad.status, 400);

  const full = await fetch(`${base}${file.url}`);
  assert.strictEqual(full.status, 200);
  assert.strictEqual(full.headers.get('content-type'), 'video/mp4');
  assert.strictEqual((await full.arrayBuffer()).byteLength, 5000);
  const part = await fetch(`${base}${file.url}`, { headers: { Range: 'bytes=100-199' } });
  assert.strictEqual(part.status, 206);
  assert.strictEqual(part.headers.get('content-range'), 'bytes 100-199/5000');
  assert.strictEqual((await part.arrayBuffer()).byteLength, 100);

  const list = await (await fetch(`${base}/api/media`, { headers: auth })).json();
  assert.ok(list.files.some((f) => f.url === file.url));

  // A file shown on a TV can't be deleted.
  const { menu } = await (await fetch(`${base}/api/menu`)).json();
  menu.screens[0].background = file.url;
  assert.strictEqual((await fetch(`${base}/api/menu`, { method: 'PUT', headers: auth, body: JSON.stringify(menu) })).status, 200);
  const del1 = await fetch(`${base}/api/media/${encodeURIComponent(file.name)}`, { method: 'DELETE', headers: auth });
  assert.strictEqual(del1.status, 409);

  delete menu.screens[0].background;
  await fetch(`${base}/api/menu`, { method: 'PUT', headers: auth, body: JSON.stringify(menu) });
  const del2 = await fetch(`${base}/api/media/${encodeURIComponent(file.name)}`, { method: 'DELETE', headers: auth });
  assert.strictEqual(del2.status, 200);
  assert.strictEqual((await fetch(`${base}${file.url}`)).status, 404);
});

test('rejects media links outside the library', async () => {
  const { menu } = await (await fetch(`${base}/api/menu`)).json();
  menu.screens[0].background = 'https://evil.example/x.mp4';
  const res = await fetch(`${base}/api/menu`, { method: 'PUT', headers: auth, body: JSON.stringify(menu) });
  assert.strictEqual(res.status, 400);
});

test('serves demo video with range support', async () => {
  const res = await fetch(`${base}/demo/promo-combo.webm`, { headers: { Range: 'bytes=0-9' } });
  assert.strictEqual(res.status, 206);
});
