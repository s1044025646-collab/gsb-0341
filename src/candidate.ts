/** 候选树核验：不信任候选附带的任何统计，独立校验结构并重算加权代价。 */
import { ObstError } from "./validate";

export interface CandidateNodeInput {
  key: number;
  left?: number | null;   // 左孩子的键
  right?: number | null;  // 右孩子的键
}

export interface CandidateVerifyResult {
  valid: boolean;
  errors: string[];
  rootKey: number | null;
  totalCost: number | null;   // 独立重算的加权代价
  nodeCount: number;
  inorder: number[];
}

export function verifyCandidate(
  keys: number[],
  freqs: number[],
  nodes: CandidateNodeInput[],
): CandidateVerifyResult {
  const errors: string[] = [];
  if (!Array.isArray(nodes)) throw new ObstError("E_NOT_ARRAY", "候选树 nodes 必须是数组");

  const keySet = new Map<number, number>(); // key -> freq
  keys.forEach((k, i) => keySet.set(k, freqs[i]));

  const byKey = new Map<number, CandidateNodeInput>();
  for (const nd of nodes) {
    if (typeof nd.key !== "number" || !Number.isFinite(nd.key)) {
      errors.push(`非法节点键: ${String(nd.key)}`);
      continue;
    }
    if (byKey.has(nd.key)) errors.push(`重复节点键: ${nd.key}`);
    else byKey.set(nd.key, nd);
    if (!keySet.has(nd.key)) errors.push(`节点键 ${nd.key} 不在快照键集合中`);
  }
  for (const k of keys) {
    if (!byKey.has(k)) errors.push(`缺少节点: ${k}`);
  }

  const resolve = (v: number | null | undefined, owner: number, side: string): number | null => {
    if (v === null || v === undefined) return null;
    if (!byKey.has(v)) { errors.push(`节点 ${owner} 的${side}孩子键 ${v} 不存在`); return null; }
    return v;
  };

  // 找根：不被任何人引用的节点
  const referenced = new Set<number>();
  for (const nd of byKey.values()) {
    const l = resolve(nd.left, nd.key, "左");
    const r = resolve(nd.right, nd.key, "右");
    if (l !== null) referenced.add(l);
    if (r !== null) referenced.add(r);
  }
  const roots = [...byKey.keys()].filter((k) => !referenced.has(k));
  if (roots.length === 0 && byKey.size > 0) errors.push("不存在根节点（可能有环）");
  if (roots.length > 1) errors.push(`存在多个根: ${roots.join(", ")}`);

  // DFS：环检测、键顺序约束、深度与代价
  let totalCost = 0;
  const inorder: number[] = [];
  const visiting = new Set<number>();
  const visited = new Set<number>();
  const freqOf = (k: number) => keySet.get(k) ?? 0;
  const dfs = (k: number, depth: number, lo: number | null, hi: number | null): void => {
    if (visiting.has(k)) { errors.push(`检测到环，涉及键 ${k}`); return; }
    if (visited.has(k)) { errors.push(`键 ${k} 被多个父节点引用`); return; }
    if (lo !== null && k <= lo) errors.push(`键 ${k} 违反二叉搜索树顺序（应 > ${lo}）`);
    if (hi !== null && k >= hi) errors.push(`键 ${k} 违反二叉搜索树顺序（应 < ${hi}）`);
    visiting.add(k);
    const nd = byKey.get(k)!;
    const l = resolve(nd.left, k, "左");
    const r = resolve(nd.right, k, "右");
    if (l !== null) dfs(l, depth + 1, lo, k);
    inorder.push(k);
    totalCost += freqOf(k) * depth;
    if (r !== null) dfs(r, depth + 1, k, hi);
    visiting.delete(k);
    visited.add(k);
  };
  if (roots.length === 1) dfs(roots[0], 1, null, null);
  if (visited.size !== byKey.size && errors.length === 0) {
    errors.push(`树不连通：可达 ${visited.size} 个节点，共 ${byKey.size} 个`);
  }

  return {
    valid: errors.length === 0,
    errors,
    rootKey: roots.length === 1 ? roots[0] : null,
    totalCost: errors.length === 0 ? totalCost : null,
    nodeCount: byKey.size,
    inorder,
  };
}
