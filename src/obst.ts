/**
 * 最优二叉搜索树（仅成功查询）动态规划核心。
 *
 * 定义：C[i][j] 为键区间 [i..j]（含端点，下标从 0 开始）的最优加权比较代价，
 * 根的深度为 1。选 r 为根时：
 *   C[i][j] = min_r ( C[i][r-1] + C[r+1][j] + W(i,j) )，W(i,j) = sum(freq[i..j])
 * 空区间代价为 0。
 *
 * 平局规则（公开且固定）：同一区间存在多个最优根时，选择下标最小（键值最小）的根。
 */

export interface TreeNode {
  index: number;      // 在 keys 数组中的下标
  key: number;
  freq: number;
  depth: number;      // 根为 1
  left: number | null;   // 左孩子下标
  right: number | null;  // 右孩子下标
}

export interface IntervalTry {
  rootIndex: number;
  rootKey: number;
  leftCost: number;
  rightCost: number;
  weight: number;
  total: number;
  chosen: boolean;
}

export interface IntervalRecord {
  i: number;
  j: number;
  weight: number;
  cost: number;
  chosenRoot: number; // 下标
}

export interface ObstResult {
  n: number;
  totalCost: number;
  rootIndex: number | null; // 空输入为 null
  nodes: TreeNode[];        // 按下标顺序
  intervals: IntervalRecord[]; // 全部非空区间
  costTable: number[][];    // (n+1)x(n+1)，仅对角线右上有意义
  rootTable: number[][];    // 所选根下标
  prefixSum: number[];
}

export function computeObst(keys: number[], freqs: number[]): ObstResult {
  const n = keys.length;
  const size = n + 1;
  const cost: number[][] = Array.from({ length: size }, () => new Array(size).fill(0));
  const root: number[][] = Array.from({ length: size }, () => new Array(size).fill(-1));
  const prefix = new Array(n + 1).fill(0);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + freqs[i];
  const W = (i: number, j: number) => prefix[j + 1] - prefix[i];

  // 区间长度 1..n
  for (let len = 1; len <= n; len++) {
    for (let i = 0; i + len - 1 < n; i++) {
      const j = i + len - 1;
      const w = W(i, j);
      let best = Infinity;
      let bestR = i;
      for (let r = i; r <= j; r++) {
        const c = (r > i ? cost[i][r - 1] : 0) + (r < j ? cost[r + 1][j] : 0) + w;
        if (c < best) { // 严格小于才更新 => 平局保留下标最小的根
          best = c;
          bestR = r;
        }
      }
      cost[i][j] = best;
      root[i][j] = bestR;
    }
  }

  // 还原树结构
  const nodes: TreeNode[] = keys.map((k, idx) => ({
    index: idx, key: k, freq: freqs[idx], depth: 0, left: null, right: null,
  }));
  const build = (i: number, j: number, depth: number, parent: number | null, side: "left" | "right" | null): void => {
    if (i > j) return;
    const r = root[i][j];
    nodes[r].depth = depth;
    if (parent !== null && side) nodes[parent][side] = r;
    build(i, r - 1, depth + 1, r, "left");
    build(r + 1, j, depth + 1, r, "right");
  };
  if (n > 0) build(0, n - 1, 1, null, null);

  const intervals: IntervalRecord[] = [];
  for (let len = 1; len <= n; len++) {
    for (let i = 0; i + len - 1 < n; i++) {
      const j = i + len - 1;
      intervals.push({ i, j, weight: W(i, j), cost: cost[i][j], chosenRoot: root[i][j] });
    }
  }

  return {
    n,
    totalCost: n > 0 ? cost[0][n - 1] : 0,
    rootIndex: n > 0 ? root[0][n - 1] : null,
    nodes,
    intervals,
    costTable: cost,
    rootTable: root,
    prefixSum: prefix,
  };
}

/** 某区间尝试所有根的代价明细（用于解释展示）。 */
export function intervalTries(res: ObstResult, keys: number[], i: number, j: number): IntervalTry[] {
  const tries: IntervalTry[] = [];
  for (let r = i; r <= j; r++) {
    const leftCost = r > i ? res.costTable[i][r - 1] : 0;
    const rightCost = r < j ? res.costTable[r + 1][j] : 0;
    const weight = res.prefixSum[j + 1] - res.prefixSum[i];
    tries.push({
      rootIndex: r,
      rootKey: keys[r],
      leftCost,
      rightCost,
      weight,
      total: leftCost + rightCost + weight,
      chosen: res.rootTable[i][j] === r,
    });
  }
  return tries;
}

export interface QueryStep { key: number; depth: number; comparison: "less" | "greater" | "equal"; }
export interface QueryResult {
  found: boolean;
  key: number;
  comparisons: number;
  path: QueryStep[];
}

/** 从根到目标键的比较路径；未包含的键明确返回未找到。 */
export function queryPath(nodes: TreeNode[], rootIndex: number | null, key: number): QueryResult {
  const path: QueryStep[] = [];
  let cur = rootIndex;
  while (cur !== null) {
    const node = nodes[cur];
    if (key === node.key) {
      path.push({ key: node.key, depth: node.depth, comparison: "equal" });
      return { found: true, key, comparisons: node.depth, path };
    }
    if (key < node.key) {
      path.push({ key: node.key, depth: node.depth, comparison: "less" });
      cur = node.left;
    } else {
      path.push({ key: node.key, depth: node.depth, comparison: "greater" });
      cur = node.right;
    }
  }
  return { found: false, key, comparisons: path.length, path };
}
