/** 业务层：校验 -> 计算 -> 持久化，以及读取/查询/区间分页/比较/报告。 */
import { computeObst, intervalTries, queryPath, ObstResult } from "./obst";
import { validateInput, ObstError } from "./validate";
import { Store } from "./db";
import { verifyCandidate, CandidateNodeInput } from "./candidate";

export interface AnalysisBundle {
  snapshotId: number;
  keys: number[];
  freqs: number[];
  result: ObstResult;
}

export class ObstService {
  constructor(private store: Store) {}

  /** 创建频数快照并构造最优树（原子发布）。 */
  createSnapshot(keysRaw: unknown, freqsRaw: unknown): AnalysisBundle {
    const { keys, freqs } = validateInput(keysRaw, freqsRaw);
    const result = computeObst(keys, freqs);
    const summary = {
      algoVersion: "obst-dp-v1",
      n: keys.length,
      totalCost: result.totalCost,
      rootIndex: result.rootIndex,
      rootKey: result.rootIndex === null ? null : keys[result.rootIndex],
      tieRule: "min-root-index",
      depthBase: 1,
    };
    const snapshotId = this.store.publish(keys, freqs, {
      rootIndex: result.rootIndex,
      rootKey: summary.rootKey,
      totalCost: result.totalCost,
      treeJson: JSON.stringify(result.nodes),
      summaryJson: JSON.stringify(summary),
    });
    return { snapshotId, keys, freqs, result };
  }

  /** 读取快照并从持久化数据重算（重启后不依赖内存 DP 表）。 */
  load(id: number): AnalysisBundle {
    const snap = this.store.getSnapshot(id);
    const result = computeObst(snap.keys, snap.freqs);
    return { snapshotId: id, keys: snap.keys, freqs: snap.freqs, result };
  }

  list() { return this.store.listSnapshots(); }

  query(id: number, key: unknown) {
    if (typeof key !== "number" || !Number.isFinite(key)) {
      throw new ObstError("E_KEY_NOT_FINITE", `查询键必须是有限数值: ${String(key)}`);
    }
    const b = this.load(id);
    const q = queryPath(b.result.nodes, b.result.rootIndex, key);
    return { ...q, snapshotId: id };
  }

  intervals(id: number, offset = 0, limit = 100) {
    if (!Number.isInteger(offset) || offset < 0) throw new ObstError("E_BAD_PAGING", "offset 必须是非负整数");
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new ObstError("E_BAD_PAGING", "limit 必须在 1..1000");
    const b = this.load(id);
    const total = b.result.intervals.length;
    return {
      snapshotId: id,
      total,
      offset,
      limit,
      items: b.result.intervals.slice(offset, offset + limit).map((iv) => ({
        ...iv,
        keys: b.keys.slice(iv.i, iv.j + 1),
        chosenRootKey: b.keys[iv.chosenRoot],
      })),
    };
  }

  intervalDetail(id: number, i: number, j: number) {
    const b = this.load(id);
    if (!Number.isInteger(i) || !Number.isInteger(j) || i < 0 || j < i || j >= b.keys.length) {
      throw new ObstError("E_BAD_INTERVAL", `非法区间 [${i}, ${j}]`);
    }
    return {
      snapshotId: id,
      i, j,
      keys: b.keys.slice(i, j + 1),
      tries: intervalTries(b.result, b.keys, i, j),
    };
  }

  verify(id: number, nodes: CandidateNodeInput[]) {
    const b = this.load(id);
    const v = verifyCandidate(b.keys, b.freqs, nodes);
    return {
      ...v,
      snapshotId: id,
      optimalCost: b.result.totalCost,
      isOptimal: v.valid && v.totalCost === b.result.totalCost,
    };
  }

  /** 比较两个频数版本（键集合必须一致）。 */
  compare(aId: number, bId: number) {
    const a = this.load(aId);
    const b = this.load(bId);
    if (a.keys.length !== b.keys.length || a.keys.some((k, i) => k !== b.keys[i])) {
      throw new ObstError("E_KEYSET_MISMATCH", "两个快照的键集合不一致，无法比较");
    }
    const freqDiff = a.keys.map((k, i) => ({ key: k, before: a.freqs[i], after: b.freqs[i] }))
      .filter((d) => d.before !== d.after);
    return {
      a: { snapshotId: aId, totalCost: a.result.totalCost, rootKey: a.result.rootIndex === null ? null : a.keys[a.result.rootIndex] },
      b: { snapshotId: bId, totalCost: b.result.totalCost, rootKey: b.result.rootIndex === null ? null : b.keys[b.result.rootIndex] },
      rootChanged: a.result.rootIndex !== b.result.rootIndex,
      freqDiff,
    };
  }

  /** 导出报告（JSON 文本；树结构来自持久化记录）。 */
  report(id: number) {
    const snap = this.store.getSnapshot(id);
    const ana = this.store.getAnalysis(id);
    return {
      snapshot: snap,
      analysis: { ...ana, tree: JSON.parse(ana.tree_json), summary: JSON.parse(ana.summary_json) },
    };
  }
}
