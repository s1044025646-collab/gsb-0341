import { AppError } from './errors.js';

export interface CandidateNode {
  key: number;
  leftKey?: number | null;
  rightKey?: number | null;
}

export interface CandidateTree {
  nodes: CandidateNode[] | Record<string, { leftKey?: number | null; rightKey?: number | null }>;
  rootKey?: number;
}

export interface VerificationReport {
  valid: boolean;
  errors: Array<{ code: string; message: string }>;
  rootKey: number | null;
  inorderKeys: number[];
  depths: Record<string, number>;
  weightedCost: number;
  nodeCount: number;
}

/**
 * 候选树核验：完全不信任候选附带的统计。
 * 检查：节点齐全、无额外节点、键唯一、单根可达、无环、无重复、满足 BST 键顺序；
 * 并独立按深度重算加权代价（freq 来自权威快照而非候选）。
 */
export function verifyCandidate(
  keys: number[],
  freqs: number[],
  candidate: unknown
): VerificationReport {
  const errors: Array<{ code: string; message: string }> = [];
  const freqOf = new Map<number, number>(keys.map((k, i) => [k, freqs[i]!]));

  if (typeof candidate !== 'object' || candidate === null) {
    throw new AppError('BAD_REQUEST', '候选树必须是对象');
  }
  const raw = candidate as CandidateTree;
  const map = new Map<number, { leftKey: number | null; rightKey: number | null }>();

  const addNode = (key: unknown, leftKey: unknown, rightKey: unknown) => {
    if (typeof key !== 'number' || !Number.isFinite(key)) {
      errors.push({ code: 'INVALID_KEY', message: `非法节点键: ${String(key)}` });
      return;
    }
    if (map.has(key)) {
      errors.push({ code: 'CANDIDATE_DUPLICATE_NODE', message: `节点 ${key} 重复定义` });
      return;
    }
    map.set(key, {
      leftKey: leftKey == null ? null : (leftKey as number),
      rightKey: rightKey == null ? null : (rightKey as number)
    });
  };

  if (Array.isArray(raw.nodes)) {
    for (const node of raw.nodes) {
      if (typeof node !== 'object' || node === null) {
        errors.push({ code: 'BAD_REQUEST', message: '节点必须是对象' });
        continue;
      }
      addNode(node.key, node.leftKey ?? null, node.rightKey ?? null);
    }
  } else if (raw.nodes && typeof raw.nodes === 'object') {
    for (const [k, v] of Object.entries(raw.nodes)) {
      const key = Number(k);
      addNode(Number.isFinite(key) ? key : (k as unknown as number), v?.leftKey ?? null, v?.rightKey ?? null);
    }
  } else {
    throw new AppError('BAD_REQUEST', '候选树缺少 nodes（数组或键值映射）');
  }

  const present = new Set(map.keys());
  for (const k of keys) if (!present.has(k)) errors.push({ code: 'CANDIDATE_MISSING_NODES', message: `缺少节点 ${k}` });
  for (const k of present) if (!freqOf.has(k)) errors.push({ code: 'CANDIDATE_EXTRA_NODES', message: `出现非快照键 ${k}` });

  // 指针合法性
  for (const [k, n] of map) {
    for (const [side, child] of [['leftKey', n.leftKey], ['rightKey', n.rightKey]] as const) {
      if (child !== null && !map.has(child)) {
        errors.push({ code: 'CANDIDATE_NOT_A_TREE', message: `节点 ${k} 的 ${side} 指向不存在的节点 ${child}` });
      }
      if (child === k) {
        errors.push({ code: 'CANDIDATE_NOT_A_TREE', message: `节点 ${k} 的 ${side} 指向自身` });
      }
    }
  }

  // 找根：未被任何孩子指针引用、且存在于快照键集合中的节点
  const referenced = new Set<number>();
  for (const n of map.values()) {
    if (n.leftKey !== null) referenced.add(n.leftKey);
    if (n.rightKey !== null) referenced.add(n.rightKey);
  }
  const roots = keys.filter((k) => map.has(k) && !referenced.has(k));
  let rootKey: number | null = roots[0] ?? null;
  if (roots.length === 0) errors.push({ code: 'CANDIDATE_NOT_A_TREE', message: '找不到根（所有节点都被引用，可能成环）' });
  if (roots.length > 1) {
    errors.push({ code: 'CANDIDATE_MULTIPLE_ROOTS', message: `存在多个根: ${roots.join(', ')}` });
    rootKey = null;
  }

  // 从根遍历：检查可达性、无环、深度
  const depths = new Map<number, number>();
  const inorder: number[] = [];
  let weightedCost = 0;
  if (rootKey !== null && map.size > 0) {
    const walk: Array<{ key: number; depth: number; side: 'L' | 'R' | null; lo: number; hi: number }> = [];
    walk.push({ key: rootKey, depth: 1, side: null, lo: -Infinity, hi: Infinity });
    while (walk.length) {
      const frame = walk.pop()!;
      const node = map.get(frame.key);
      if (!node) continue;
      if (depths.has(frame.key)) {
        errors.push({ code: 'CANDIDATE_NOT_A_TREE', message: `节点 ${frame.key} 被重复访问（存在环或汇合）` });
        continue;
      }
      depths.set(frame.key, frame.depth);
      // BST 键序：左子树所有键 < key < 右子树所有键，用允许区间判定
      if (!(frame.key > frame.lo && frame.key < frame.hi)) {
        errors.push({
          code: 'CANDIDATE_ORDER_VIOLATION',
          message: `节点 ${frame.key} 违反 BST 键顺序（允许区间 (${frame.lo === -Infinity ? '-∞' : frame.lo}, ${frame.hi === Infinity ? '∞' : frame.hi})）`
        });
      }
      const freq = freqOf.get(frame.key) ?? 0;
      weightedCost += freq * frame.depth;
      if (node.rightKey !== null) walk.push({ key: node.rightKey, depth: frame.depth + 1, side: 'R', lo: frame.key, hi: frame.hi });
      if (node.leftKey !== null) walk.push({ key: node.leftKey, depth: frame.depth + 1, side: 'L', lo: frame.lo, hi: frame.key });
    }
    // 中序（独立做一次，避免上面遍历顺序影响结果）
    const stack: number[] = [];
    let cur: number | null = rootKey;
    const seen = new Set<number>();
    while (cur !== null || stack.length) {
      while (cur !== null) {
        if (seen.has(cur)) {
          errors.push({ code: 'CANDIDATE_NOT_A_TREE', message: '中序遍历时检测到环' });
          cur = null;
          break;
        }
        seen.add(cur);
        stack.push(cur);
        cur = map.get(cur)?.leftKey ?? null;
      }
      if (cur === null && stack.length === 0) break;
      const k = stack.pop()!;
      inorder.push(k);
      cur = map.get(k)?.rightKey ?? null;
    }
    for (const k of keys) {
      if (!depths.has(k) && map.has(k)) {
        errors.push({ code: 'CANDIDATE_NOT_A_TREE', message: `节点 ${k} 从根不可达` });
      }
    }
  }

  const expected = keys.join(',');
  if (inorder.length > 0 && inorder.join(',') !== expected) {
    errors.push({ code: 'CANDIDATE_ORDER_VIOLATION', message: `中序遍历 ${inorder.join(',')} 与按键序 ${expected} 不一致` });
  }

  return {
    valid: errors.length === 0,
    errors,
    rootKey,
    inorderKeys: inorder,
    depths: Object.fromEntries(depths),
    weightedCost,
    nodeCount: map.size
  };
}
