import { AppError } from './errors.js';
import { Store, type SnapshotRow } from './db.js';
import { buildOptimalTree, inorderKeys, queryPath, type OptimalTreeResult } from './dp.js';
import { verifyCandidate, type VerificationReport } from './verify.js';
import { validateSnapshot } from './validation.js';

export interface StoredTree {
  rootKey: number | null;
  nodes: OptimalTreeResult['nodes'];
  order: number[];
}

export class ObstService {
  constructor(private store: Store) {}

 createSnapshot(raw: unknown): { version: number; snapshot: SnapshotRow } {
    const input = validateSnapshot(raw);
    const row = this.store.createSnapshot(input.keys, input.freqs, input.label);
    return { version: row.version, snapshot: row };
  }

  /** 校验输入（不持久化），供 /validate 使用。 */
  validate(raw: unknown) {
    const input = validateSnapshot(raw);
    return {
      valid: true,
      keys: input.keys,
      freqs: input.freqs,
      keyCount: input.keys.length,
      totalFreq: input.freqs.reduce((a, b) => a + b, 0)
    };
  }

  listVersions() {
    return this.store.listSnapshots().map((r) => ({
      version: r.version,
      label: r.label,
      keyCount: (JSON.parse(r.keys_json) as number[]).length,
      totalCost: r.total_cost,
      rootKey: r.root_key,
      built: r.tree_json !== null,
      createdAt: r.created_at
    }));
  }

  private requireVersion(version: number): SnapshotRow {
    const row = this.store.getByVersion(version);
    if (!row) throw new AppError('VERSION_NOT_FOUND', `版本 ${version} 不存在`, { version });
    return row;
  }

  private keysFreqs(row: SnapshotRow) {
    return { keys: JSON.parse(row.keys_json) as number[], freqs: JSON.parse(row.freqs_json) as number[] };
  }

  /** 构造（或重复构造）最优树并原子发布；旧版本不受影响。 */
  construct(version: number): OptimalTreeResult & { intervalCount: number } {
    const row = this.requireVersion(version);
    const { keys, freqs } = this.keysFreqs(row);
    const result = buildOptimalTree(keys, freqs);
    this.store.publishTree(row.id, result);
    return { ...result, intervalCount: result.intervals.length };
  }

  getTree(version: number): { tree: StoredTree; summary: any; keys: number[]; freqs: number[] } {
    const row = this.requireVersion(version);
    if (!row.tree_json || !row.summary_json) {
      throw new AppError('BAD_REQUEST', `版本 ${version} 尚未构造最优树，请先调用 construct`, { version });
    }
    return {
      tree: JSON.parse(row.tree_json) as StoredTree,
      summary: JSON.parse(row.summary_json),
      ...this.keysFreqs(row)
    };
  }

  /** 查询路径：已含键返回比较过程；未含键返回 found=false，且绝不计入优化目标。 */
  query(version: number, target: unknown) {
    const row = this.requireVersion(version);
    if (typeof target !== 'number' || !Number.isFinite(target)) {
      throw new AppError('INVALID_KEY', '查询键必须是有限数值');
    }
    const { keys, freqs } = this.keysFreqs(row);
    // 已构造：直接走持久化指针（不依赖内存 DP 表）；未构造：即时计算
    const steps = row.tree_json
      ? this.walkStored(JSON.parse(row.tree_json) as StoredTree, target)
      : queryPath(buildOptimalTree(keys, freqs), target);
    if (steps === null) {
      return { version, target, found: false, comparisons: 0, steps: [], message: `键 ${target} 不在快照中（未找到），其代价不纳入优化目标` };
    }
    return { version, target, found: true, comparisons: steps.length, steps };
  }

  private walkStored(tree: StoredTree, target: number) {
    if (tree.rootKey === null) return null;
    let cur: number | null = tree.rootKey;
    const steps: Array<{ atKey: number; comparison: string; next: string }> = [];
    let guard = 0;
    while (cur !== null) {
      if (guard++ > Object.keys(tree.nodes).length + 1) return null;
      const node: (typeof tree.nodes)[number] = tree.nodes[cur]!;
      if (target === node.key) {
        steps.push({ atKey: node.key, comparison: 'eq', next: 'found' });
        return steps;
      }
      if (target < node.key) {
        steps.push({ atKey: node.key, comparison: 'lt', next: node.leftKey === null ? 'stop' : 'left' });
        cur = node.leftKey;
      } else {
        steps.push({ atKey: node.key, comparison: 'gt', next: node.rightKey === null ? 'stop' : 'right' });
        cur = node.rightKey;
      }
    }
    return null;
  }

  intervals(version: number, page: number, pageSize: number) {
    const row = this.requireVersion(version);
    const total = this.store.countIntervals(row.id);
    const offset = (page - 1) * pageSize;
    const rows = this.store.getIntervals(row.id, offset, pageSize).map((r) => ({
      seq: r.seq,
      interval: [r.lo, r.hi],
      keyRange: [r.start_key, r.end_key],
      sumFreq: r.sum_freq,
      bestCost: r.best_cost,
      rootKey: r.root_key,
      attempts: JSON.parse(r.attempts_json)
    }));
    return { page, pageSize, total, pageCount: Math.max(1, Math.ceil(total / pageSize)), intervals: rows };
  }

  importCandidate(version: number, name: string, payload: unknown): VerificationReport & { candidateId: number } {
    const row = this.requireVersion(version);
    const { keys, freqs } = this.keysFreqs(row);
    const report = verifyCandidate(keys, freqs, payload);
    const candidateId = this.store.insertCandidate(row.id, name, payload, report);
    return { ...report, candidateId };
  }

  listCandidates(version: number) {
    const row = this.requireVersion(version);
    return this.store.listCandidates(row.id).map((c) => ({
      id: c.id,
      name: c.name,
      report: JSON.parse(c.report_json) as VerificationReport,
      createdAt: c.created_at
    }));
  }

  /** 比较两个频数版本：标注变化的键与最优代价/根差异。 */
  compare(v1: number, v2: number) {
    const r1 = this.requireVersion(v1);
    const r2 = this.requireVersion(v2);
    const k1 = JSON.parse(r1.keys_json) as number[];
    const k2 = JSON.parse(r2.keys_json) as number[];
    const f1 = JSON.parse(r1.freqs_json) as number[];
    const f2 = JSON.parse(r2.freqs_json) as number[];
    const m2 = new Map(k2.map((k, i) => [k, f2[i]!]));
    const changes = k1.map((k, i) => ({ key: k, from: f1[i]!, to: m2.get(k) ?? null, changed: m2.get(k) !== f1[i] }));
    const onlyInV2 = k2.filter((k) => !k1.includes(k));
    return {
      v1: { version: v1, totalCost: r1.total_cost, rootKey: r1.root_key },
      v2: { version: v2, totalCost: r2.total_cost, rootKey: r2.root_key },
      costDelta: (r2.total_cost ?? 0) - (r1.total_cost ?? 0),
      rootChanged: r1.root_key !== r2.root_key,
      changes,
      keysOnlyInV2: onlyInV2,
      sameKeySet: k1.length === k2.length && onlyInV2.length === 0
    };
  }

  /** 导出报告：完全由 SQLite 中持久化的数据重建，重启后一致。 */
  report(version: number) {
    const row = this.requireVersion(version);
    const { keys, freqs } = this.keysFreqs(row);
    if (!row.tree_json || !row.summary_json) {
      throw new AppError('BAD_REQUEST', `版本 ${version} 尚未构造最优树`, { version });
    }
    const tree = JSON.parse(row.tree_json) as StoredTree;
    const summary = JSON.parse(row.summary_json);
    // 独立核验持久化树自身（中序应恰好还原全部键）
    const inorder = inorderKeys({
      keys,
      freqs,
      totalCost: row.total_cost!,
      rootKey: tree.rootKey,
      rootIndex: null,
      nodes: tree.nodes,
      order: tree.order,
      intervals: [],
      depths: summary.depths,
      tieRule: summary.tieRule
    });
    return {
      version: row.version,
      label: row.label,
      algoVersion: row.algo_version,
      tieRule: row.tie_rule,
      keys,
      freqs,
      totalCost: row.total_cost,
      rootKey: row.root_key,
      tree,
      perKeyComparisons: summary.perKeyComparisons,
      inorderKeys: inorder,
      intervalCount: this.store.countIntervals(row.id),
      createdAt: row.created_at
    };
  }
}
