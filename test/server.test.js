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
