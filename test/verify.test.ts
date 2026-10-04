import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyCandidate } from '../src/verify.ts';

const keys = [10, 20, 30];
const freqs = [10, 1, 1];

test('合法最优树核验通过并独立重算代价 15', () => {
  const tree = {
    nodes: [
      { key: 10, leftKey: null, rightKey: 20 },
      { key: 20, leftKey: null, rightKey: 30 },
      { key: 30, leftKey: null, rightKey: null }
    ]
  };
  const rep = verifyCandidate(keys, freqs, tree);
  assert.ok(rep.valid, rep.errors.map((e) => e.message).join(';'));
  assert.equal(rep.weightedCost, 15);
  assert.equal(rep.rootKey, 10);
  assert.deepEqual(rep.inorderKeys, [10, 20, 30]);
});

test('无环但 BST 顺序错误：拒绝', () => {
  const tree = {
    nodes: [
      { key: 20, leftKey: 30, rightKey: 10 },
      { key: 10 },
      { key: 30 }
    ]
  };
  const rep = verifyCandidate(keys, freqs, tree);
  assert.equal(rep.valid, false);
  assert.ok(rep.errors.some((e) => e.code === 'CANDIDATE_ORDER_VIOLATION'));
});

test('重复节点：拒绝', () => {
  const rep = verifyCandidate(keys, freqs, {
    nodes: [{ key: 10 }, { key: 10 }, { key: 20 }, { key: 30 }]
  });
  assert.equal(rep.valid, false);
  assert.ok(rep.errors.some((e) => e.code === 'CANDIDATE_DUPLICATE_NODE'));
});

test('缺节点 / 多节点：拒绝', () => {
  const missing = verifyCandidate(keys, freqs, { nodes: [{ key: 10 }, { key: 20 }] });
  assert.ok(missing.errors.some((e) => e.code === 'CANDIDATE_MISSING_NODES'));
  const extra = verifyCandidate(keys, freqs, {
    nodes: [{ key: 10 }, { key: 20 }, { key: 30 }, { key: 40 }]
  });
  assert.ok(extra.errors.some((e) => e.code === 'CANDIDATE_EXTRA_NODES'));
});

test('环（互相引用）：拒绝', () => {
  const rep = verifyCandidate(keys, freqs, {
    nodes: [
      { key: 10, leftKey: 20, rightKey: 30 },
      { key: 20, leftKey: 10 },
      { key: 30 }
    ]
  });
  assert.equal(rep.valid, false);
  assert.ok(rep.errors.some((e) => e.code === 'CANDIDATE_NOT_A_TREE'));
});

test('候选附带错误统计不被信任：深度按结构重算', () => {
  const tree = {
    nodes: [
      { key: 20, leftKey: 10, rightKey: 30, fakeDepth: 99, fakeCost: 99999 },
      { key: 10 },
      { key: 30 }
    ]
  };
  const rep = verifyCandidate(keys, freqs, tree);
  assert.ok(rep.valid);
  // 真实代价：10×2 + 1×1 + 1×2 = 23
  assert.equal(rep.weightedCost, 23);
});
