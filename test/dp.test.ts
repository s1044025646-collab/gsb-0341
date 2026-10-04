import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOptimalTree, inorderKeys, queryPath } from '../src/dp.ts';

test('三键等频：最优代价 5（根 1 次 + 两叶各 2 次），最优根 20', () => {
  const r = buildOptimalTree([10, 20, 30], [1, 1, 1]);
  assert.equal(r.totalCost, 5);
  assert.equal(r.rootKey, 20);
  assert.deepEqual(inorderKeys(r), [10, 20, 30]);
});

test('边缘键加权：根左移到 10，手算代价 15', () => {
  const r = buildOptimalTree([10, 20, 30], [10, 1, 1]);
  assert.equal(r.totalCost, 15);
  assert.equal(r.rootKey, 10);
});

test('另一端边缘加权：根右移到 30', () => {
  const r = buildOptimalTree([10, 20, 30], [1, 1, 10]);
  assert.equal(r.totalCost, 15);
  assert.equal(r.rootKey, 30);
});

test('单键：代价=频数，深度=1', () => {
  const r = buildOptimalTree([5], [7]);
  assert.equal(r.totalCost, 7);
  assert.equal(r.rootKey, 5);
  assert.equal(r.nodes[5]!.depth, 1);
});

test('空集：确定的空结果', () => {
  const r = buildOptimalTree([], []);
  assert.equal(r.totalCost, 0);
  assert.equal(r.rootKey, null);
  assert.deepEqual(inorderKeys(r), []);
  assert.deepEqual(r.intervals, []);
});

test('全零频数：代价 0，平局根为最左键', () => {
  const r = buildOptimalTree([1, 2, 3, 4], [0, 0, 0, 0]);
  assert.equal(r.totalCost, 0);
  assert.equal(r.rootKey, 1);
  assert.deepEqual(inorderKeys(r), [1, 2, 3, 4]);
});

test('统一放大频数：结构不变，代价线性放大', () => {
  const a = buildOptimalTree([10, 20, 30], [1, 1, 1]);
  const b = buildOptimalTree([10, 20, 30], [10, 10, 10]);
  assert.equal(b.totalCost, a.totalCost * 10); // 50
  assert.equal(b.rootKey, a.rootKey);
});

test('查询路径：已含键逐跳正确，未含键返回 null', () => {
  const r = buildOptimalTree([10, 20, 30], [10, 1, 1]); // 根 10
  const p = queryPath(r, 30)!;
  assert.ok(p);
  assert.equal(p.length, 3);
  assert.deepEqual(p.map((s) => s.atKey), [10, 20, 30]);
  assert.equal(p.at(-1)!.next, 'found');
  assert.equal(queryPath(r, 99), null);
  assert.equal(queryPath(r, 25), null);
});

test('每条路径深度 = 比较次数，加权和等于总代价', () => {
  const r = buildOptimalTree([1, 2, 3, 4, 5], [5, 4, 3, 2, 1]);
  let sum = 0;
  for (let i = 0; i < r.keys.length; i++) {
    const p = queryPath(r, r.keys[i]!)!;
    assert.equal(p.length, r.depths[i]);
    sum += r.freqs[i]! * p.length;
  }
  assert.equal(sum, r.totalCost);
  assert.deepEqual(inorderKeys(r), r.keys);
});

test('区间记录数量 = n(n+1)/2，根区间即最终根', () => {
  const r = buildOptimalTree([1, 2, 3, 4], [1, 2, 3, 4]);
  assert.equal(r.intervals.length, 10);
  const full = r.intervals.find((x) => x.lo === 0 && x.hi === 3)!;
  assert.equal(full.rootKey, r.rootKey);
  assert.equal(full.attempts.length, 4);
  assert.ok(full.attempts.every((a) => a.cost >= full.bestCost));
  assert.equal(full.attempts.filter((a) => a.chosen).length, 1);
});

test('左子树键均小于根、右子树键均大于根', () => {
  const keys = [1, 2, 3, 4, 5, 6];
  const r = buildOptimalTree(keys, [1, 5, 2, 8, 3, 4]);
  for (const node of Object.values(r.nodes)) {
    if (node.leftKey !== null) assert.ok(node.leftKey < node.key);
    if (node.rightKey !== null) assert.ok(node.rightKey > node.key);
  }
});
