import { AppError } from './errors.js';
import { LIMITS, TIE_RULE } from './limits.js';

export interface RootAttempt {
  rootIndex: number;
  rootKey: number;
  cost: number; // e[i][r-1] + e[r+1][j] + sum(i,j)
  chosen: boolean;
}

export interface IntervalRecord {
  lo: number;
  hi: number;
  startKey: number;
  endKey: number;
  sumFreq: number;
  bestCost: number;
  rootIndex: number;
  rootKey: number;
  attempts: RootAttempt[];
}

export interface TreeNode {
  key: number;
  index: number;
  freq: number;
  depth: number;
  leftKey: number | null;
  rightKey: number | null;
}

export interface QueryPathStep {
  atKey: number;
  comparison: 'eq' | 'lt' | 'gt'; // 待查键 与 当前节点键 的关系
  next: 'found' | 'left' | 'right';
}

export interface OptimalTreeResult {
  keys: number[];
  freqs: number[];
  totalCost: number;
  rootKey: number | null;
  rootIndex: number | null;
  nodes: Record<number, TreeNode>;
  order: number[]; // 键的数组顺序（=中序）
  intervals: IntervalRecord[]; // 区间按长度、起点有序，便于分页
  depths: number[];
  tieRule: string;
}

/**
 * 静态最优 BST（仅成功查询）经典 DP：
 *   e[i][j] = min over r in [i,j] of e[i][r-1] + e[r+1][j] + sum_{k=i..j} p[k]
 * 空区间 e[i][i-1] = 0。平局取最小 r（最左根），保证确定性。
 */
export function buildOptimalTree(keys: number[], freqs: number[]): OptimalTreeResult {
  const n = keys.length;
  // 前缀和
  const prefix: number[] = [0];
  for (let i = 0; i < n; i++) prefix.push(prefix[i]! + freqs[i]!);
  const sumOf = (lo: number, hi: number) => prefix[hi + 1]! - prefix[lo]!;

  const e: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const root: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(-1));
  const intervalMap = new Map<string, IntervalRecord>();

  for (let len = 1; len <= n; len++) {
    for (let lo = 0; lo + len - 1 < n; lo++) {
      const hi = lo + len - 1;
      const sumFreq = sumOf(lo, hi);
      let best = Infinity;
      let bestRoot = lo;
      const attempts: RootAttempt[] = [];
      for (let r = lo; r <= hi; r++) {
        const leftCost = r > lo ? (e[lo] as number[])[r - 1]! : 0;
        const rightCost = r < hi ? (e[r + 1] as number[])[hi]! : 0;
        const cost = leftCost + rightCost + sumFreq;
        if (!Number.isSafeInteger(cost)) {
          throw new AppError(
            'COST_OVERFLOW',
            '累计加权代价超出精确整数范围，请降低键数量或频数上限',
            { interval: [keys[lo], keys[hi]], rootKey: keys[r] }
          );
        }
        if (cost > LIMITS.MAX_TOTAL_COST) {
          throw new AppError('COST_OVERFLOW', '累计加权代价超过配置上限', {
            cost,
            limit: LIMITS.MAX_TOTAL_COST
          });
        }
        attempts.push({ rootIndex: r, rootKey: keys[r]!, cost, chosen: false });
        // 严格小于：平局保留最左根
        if (cost < best) {
          best = cost;
          bestRoot = r;
        }
      }
      (attempts.find((a) => a.rootIndex === bestRoot) as RootAttempt).chosen = true;
      (e[lo] as number[])[hi] = best as number;
      (root[lo] as number[])[hi] = bestRoot;
      intervalMap.set(`${lo}:${hi}`, {
        lo,
        hi,
        startKey: keys[lo]!,
        endKey: keys[hi]!,
        sumFreq,
        bestCost: best as number,
        rootIndex: bestRoot,
        rootKey: keys[bestRoot]!,
        attempts
      });
    }
  }

  const intervals: IntervalRecord[] = [];
  for (let len = 1; len <= n; len++) {
    for (let lo = 0; lo + len - 1 < n; lo++) {
      intervals.push(intervalMap.get(`${lo}:${lo + len - 1}`)!);
    }
  }

  const nodes: Record<number, TreeNode> = {};
  const depths = new Array<number>(n).fill(0);
  let rootKey: number | null = null;
  let rootIndex: number | null = null;

  if (n > 0) {
    rootIndex = (root[0] as number[])[n - 1]!;
    rootKey = keys[rootIndex]!;
    // 迭代展开，避免深树递归
    const depthStack: number[] = [1];
    const frameStack: Array<[number, number]> = [[0, n - 1]];
    while (frameStack.length) {
      const [lo, hi] = frameStack.pop()!;
      const depth = depthStack.pop()!;
      const r = (root[lo] as number[])[hi]!;
      depths[r] = depth;
      nodes[keys[r]!] = {
        key: keys[r]!,
        index: r,
        freq: freqs[r]!,
        depth,
        leftKey: r > lo ? keys[(root[lo] as number[])[r - 1]!]! : null,
        rightKey: r < hi ? keys[(root[r + 1] as number[])[hi]!]! : null
      };
      if (r < hi) {
        frameStack.push([r + 1, hi]);
        depthStack.push(depth + 1);
      }
      if (r > lo) {
        frameStack.push([lo, r - 1]);
        depthStack.push(depth + 1);
      }
    }
  }

  return {
    keys,
    freqs,
    totalCost: n === 0 ? 0 : (e[0] as number[])[n - 1]!,
    rootKey,
    rootIndex,
    nodes,
    order: keys.slice(),
    depths,
    intervals,
    tieRule: TIE_RULE
  };
}

/** 在已构造的树中沿指针搜索，返回到达某键的比较路径；键不存在返回 null。 */
export function queryPath(result: OptimalTreeResult, target: number): QueryPathStep[] | null {
  if (result.rootKey === null) return null;
  const steps: QueryPathStep[] = [];
  let cur = result.rootKey;
  let guard = 0;
  while (guard++ <= result.keys.length) {
    const node = result.nodes[cur]!;
    if (target === node.key) {
      steps.push({ atKey: node.key, comparison: 'eq', next: 'found' });
      return steps;
    }
    if (target < node.key) {
      if (node.leftKey === null) return null;
      steps.push({ atKey: node.key, comparison: 'lt', next: 'left' });
      cur = node.leftKey;
    } else {
      if (node.rightKey === null) return null;
      steps.push({ atKey: node.key, comparison: 'gt', next: 'right' });
      cur = node.rightKey;
    }
  }
  return null; // 理论不可达：防御性
}

/** 中序遍历（用孩子指针），用于结构自检。 */
export function inorderKeys(result: OptimalTreeResult): number[] {
  const out: number[] = [];
  if (result.rootKey === null) return out;
  const stack: number[] = [];
  let cur: number | null = result.rootKey;
  while (cur !== null || stack.length) {
    while (cur !== null) {
      stack.push(cur);
      cur = result.nodes[cur]!.leftKey;
    }
    const key = stack.pop()!;
    out.push(key);
    cur = result.nodes[key]!.rightKey;
  }
  return out;
}
