import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enumerateAllBST, catalan } from '../src/enumerate.ts';
import { buildOptimalTree } from '../src/dp.ts';
import { verifyCandidate } from '../src/verify.ts';

test('枚举数量等于卡特兰数', () => {
  for (let n = 0; n <= 6; n++) {
    const keys = Array.from({ length: n }, (_, i) => i + 1);
    const freqs = keys.map((k) => k * 3 + 1);
    assert.equal(enumerateAllBST(keys, freqs).length, catalan(n));
  }
});

test('至多 6 键：枚举最优值与 DP 一致，平局根一致', () => {
  for (let n = 1; n <= 6; n++) {
    const keys = Array.from({ length: n }, (_, i) => (i + 1) * 10);
    // 使用确定但“不规整”的频数，制造若干平局与非平衡最优
    const freqs = keys.map((k, i) => ((i * 7 + k) % 13));
    const all = enumerateAllBST(keys, freqs);
    const dp = buildOptimalTree(keys, freqs);
    const minCost = Math.min(...all.map((t) => t.weightedCost));
    assert.equal(dp.totalCost, minCost, `n=${n} 最优值不一致`);
    // DP 平局根必须是枚举中最优树里最靠左的根
    const bestRoots = all.filter((t) => t.weightedCost === minCost).map((t) => t.rootKey);
    assert.equal(dp.rootKey, Math.min(...(bestRoots as number[])));
    // 每一棵枚举树都必须通过候选核验，且独立加权代价等于枚举值
    for (const t of all) {
      const rep = verifyCandidate(keys, freqs, { nodes: t.nodes });
      assert.ok(rep.valid, `枚举树却核验失败: ${rep.errors.map((e) => e.message).join(';')}`);
      assert.equal(rep.weightedCost, t.weightedCost);
      assert.deepEqual(rep.inorderKeys, keys);
    }
  }
});

test('全零频数：所有合法树并列最优，DP 选择最左根 1', () => {
  const keys = [10, 20, 30];
  const all = enumerateAllBST(keys, [0, 0, 0]);
  assert.ok(all.every((t) => t.weightedCost === 0));
  assert.equal(buildOptimalTree(keys, [0, 0, 0]).rootKey, 10);
});
