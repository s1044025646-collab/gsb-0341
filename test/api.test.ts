import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Server } from 'node:http';
import { Store } from '../src/db.ts';
import { ObstService } from '../src/service.ts';
import { createApp, listen } from '../src/server.ts';

const dir = mkdtempSync(join(tmpdir(), 'obst-api-'));
let server: Server;
let store: Store;
let base: string;

before(async () => {
  store = new Store(join(dir, 'api.db'));
  server = createApp(new ObstService(store));
  const { port } = await listen(server, 0);
  base = `http://127.0.0.1:${port}`;
});
after(() => {
  server.close();
  store.close();
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      break;
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
});

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const json = await res.json();
  return { status: res.status, json };
}

test('HTTP 端到端', async () => {
  assert.equal((await call('GET', '/api/health')).json.ok, true);

  const bad = await call('POST', '/api/validate', { keys: [3, 1], freqs: [1, 1] });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.error.code, 'KEYS_NOT_SORTED');

  const created = await call('POST', '/api/snapshots', { keys: [10, 20, 30], freqs: [10, 1, 1] });
  assert.equal(created.status, 200);
  const v = created.json.version;

  const built = await call('POST', `/api/snapshots/${v}/construct`);
  assert.equal(built.json.totalCost, 15);
  assert.equal(built.json.rootKey, 10);

  const q = await call('GET', `/api/snapshots/${v}/query?key=30`);
  assert.equal(q.json.found, true);
  assert.equal(q.json.comparisons, 3);

  const miss = await call('GET', `/api/snapshots/${v}/query?key=99`);
  assert.equal(miss.json.found, false);

  const intervals = await call('GET', `/api/snapshots/${v}/intervals?page=1&pageSize=2`);
  assert.equal(intervals.json.total, 6);
  assert.equal(intervals.json.intervals.length, 2);

  const cand = await call('POST', `/api/snapshots/${v}/candidates`, {
    name: 'chain',
    tree: { nodes: [{ key: 10, rightKey: 20 }, { key: 20, rightKey: 30 }, { key: 30 }] }
  });
  assert.equal(cand.json.valid, true);
  assert.equal(cand.json.weightedCost, 15);

  const report = await call('GET', `/api/snapshots/${v}/report`);
  assert.deepEqual(report.json.inorderKeys, [10, 20, 30]);

  const v2 = (await call('POST', '/api/snapshots', { keys: [10, 20, 30], freqs: [1, 1, 1] })).json.version;
  await call('POST', `/api/snapshots/${v2}/construct`);
  const cmp = await call('GET', `/api/compare?v1=${v}&v2=${v2}`);
  assert.equal(cmp.json.v1.totalCost, 15);
  assert.equal(cmp.json.v2.totalCost, 5);
});

test('错误路由 404', async () => {
  const r = await call('GET', '/nope');
  assert.equal(r.status, 404);
});
