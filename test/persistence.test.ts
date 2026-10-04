import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../src/db.ts';
import { ObstService } from '../src/service.ts';
import { buildOptimalTree } from '../src/dp.ts';
import { AppError } from '../src/errors.ts';

let dir: string;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'obst-test-'));
});
after(() => {
  // Windows 上 SQLite WAL 句柄可能延迟释放，重试删除
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
});

test('端到端：创建→构造→查询→区间分页→候选→比较→报告→重启一致', () => {
  const dbPath = join(dir, 'a.db');
  let store = new Store(dbPath);
  const svc = new ObstService(store);

  const v1 = svc.createSnapshot({ keys: [10, 20, 30], freqs: [1, 1, 1], label: 'equal' }).version;
  const built = svc.construct(v1);
  assert.equal(built.totalCost, 5);

  // 修改一个频数创建新分析，旧树仍可读取
  const v2 = svc.createSnapshot({ keys: [10, 20, 30], freqs: [10, 1, 1], label: 'edge' }).version;
  svc.construct(v2);
  const oldTree = svc.getTree(v1);
  assert.equal(oldTree.summary.totalCost, 5);
  assert.equal(oldTree.tree.rootKey, 20);

  // 查询路径：命中 / 未找到
  const hit = svc.query(v2, 30);
  assert.equal(hit.found, true);
  assert.equal(hit.comparisons, 3);
  const miss = svc.query(v2, 99);
  assert.equal(miss.found, false);
  assert.match(miss.message, /未找到/);

  // 区间分页：n=3 → 6 个区间；分页返回总数不缺
  const p1 = svc.intervals(v1, 1, 4);
  assert.equal(p1.total, 6);
  assert.equal(p1.intervals.length, 4);
  const p2 = svc.intervals(v1, 2, 4);
  assert.equal(p2.intervals.length, 2);
  const seqs = [...p1.intervals, ...p2.intervals].map((x) => x.seq);
  assert.deepEqual(seqs, [0, 1, 2, 3, 4, 5]);

  // 导入候选：合法 + 顺序错误
  const good = svc.importCandidate(v2, 'chain', {
    nodes: [
      { key: 10, rightKey: 20 },
      { key: 20, rightKey: 30 },
      { key: 30 }
    ]
  });
  assert.equal(good.valid, true);
  assert.equal(good.weightedCost, 15);
  const bad = svc.importCandidate(v2, 'bad-order', {
    nodes: [{ key: 20, leftKey: 30, rightKey: 10 }, { key: 10 }, { key: 30 }]
  });
  assert.equal(bad.valid, false);
  assert.equal(svc.listCandidates(v2).length, 2);

  // 版本比较
  const cmp = svc.compare(v1, v2);
  assert.equal(cmp.rootChanged, true);
  assert.equal(cmp.costDelta, 10);
  assert.deepEqual(cmp.changes.map((c) => c.changed), [true, false, false]);

  // 重启：新 Store 打开同一文件，仅靠持久化数据重建报告
  store.close();
  store = new Store(dbPath);
  const svc2 = new ObstService(store);
  const report = svc2.report(v2);
  assert.equal(report.totalCost, 15);
  assert.equal(report.rootKey, 10);
  assert.deepEqual(report.inorderKeys, [10, 20, 30]);
  assert.equal(report.intervalCount, 6);
  // 旧版本报告仍一致
  assert.equal(svc2.report(v1).totalCost, 5);
  store.close();
});

test('发布失败时事务回滚，快照保持未构造', () => {
  const dbPath = join(dir, 'rollback.db');
  const store = new Store(dbPath);
  const svc = new ObstService(store);
  const v = svc.createSnapshot({ keys: [1, 2, 3], freqs: [1, 1, 1] }).version;
  const row = store.getByVersion(v)!;

  // 破坏目标表，使发布中途失败
  store.db.exec('DROP TABLE intervals;');
  const result = buildOptimalTree([1, 2, 3], [1, 1, 1]);
  assert.throws(() => store.publishTree(row.id, result));
  const after = store.getByVersion(v)!;
  assert.equal(after.tree_json, null);
  assert.equal(after.total_cost, null);
  store.close();
});

test('操作不存在版本返回 VERSION_NOT_FOUND', () => {
  const store = new Store(join(dir, 'nf.db'));
  const svc = new ObstService(store);
  assert.throws(() => svc.report(42), (e: unknown) => e instanceof AppError && e.code === 'VERSION_NOT_FOUND');
  store.close();
});
