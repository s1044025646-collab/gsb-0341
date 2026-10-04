import type { CandidateNode } from './verify.js';

export interface EnumeratedTree {
  rootKey: number | null;
  nodes: CandidateNode[];
  weightedCost: number;
  shape: string; // 前序键序列，便于人工识别结构
}

interface BuiltTree {
  root: number | null;
  nodes: CandidateNode[];
  cost: number;
  preorder: number[];
}

/**
 * 独立枚举：递归生成键区间 [lo..hi] 的全部合法 BST（卡特兰数），
 * 每棵树独立按深度计算加权代价。仅用于 n<=6 的交叉核对。
 */
export function enumerateAllBST(keys: number[], freqs: number[]): EnumeratedTree[] {
  const gen = (lo: number, hi: number, depth: number): BuiltTree[] => {
    if (lo > hi) return [{ root: null, nodes: [], cost: 0, preorder: [] }];
    const out: BuiltTree[] = [];
    for (let r = lo; r <= hi; r++) {
      for (const left of gen(lo, r - 1, depth + 1)) {
        for (const right of gen(r + 1, hi, depth + 1)) {
          const key = keys[r]!;
          out.push({
            root: r,
            nodes: [
              {
                key,
                leftKey: left.root === null ? null : keys[left.root]!,
                rightKey: right.root === null ? null : keys[right.root]!
              },
              ...left.nodes,
              ...right.nodes
            ],
            cost: freqs[r]! * depth + left.cost + right.cost,
            preorder: [key, ...left.preorder, ...right.preorder]
          });
        }
      }
    }
    return out;
  };

  return gen(0, keys.length - 1, 1).map((t) => ({
    rootKey: t.root === null ? null : keys[t.root]!,
    nodes: t.nodes,
    weightedCost: t.cost,
    shape: keys.length === 0 ? 'empty' : t.preorder.join('-')
  }));
}

export function catalan(n: number): number {
  let c = 1;
  for (let i = 0; i < n; i++) c = (c * 2 * (2 * i + 1)) / (i + 2);
  return c;
}
