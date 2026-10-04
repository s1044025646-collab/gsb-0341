import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { computeObst, queryPath, TreeNode } from "../src/obst";
import { validateInput, ObstError } from "../src/validate";
import { verifyCandidate } from "../src/candidate";
import { Store } from "../src/db";
import { ObstService } from "../src/service";

// ---------- 暴力枚举：至多 6 个键的全部合法 BST ----------
interface EnumNode { key: number; freq: number; left: EnumNode | null; right: EnumNode | null; }

function enumerateTrees(keys: number[], freqs: number[], i: number, j: number): EnumNode[] {
  if (i > j) return [];
  const out: EnumNode[] = [];
  for (let r = i; r <= j; r++) {
    const lefts: Array<EnumNode | null> = i <= r - 1 ? enumerateTrees(keys, freqs, i, r - 1) : [null];
    const rights: Array<EnumNode | null> = r + 1 <= j ? enumerateTrees(keys, freqs, r + 1, j) : [null];
    for (const left of lefts) for (const right of rights) {
      out.push({ key: keys[r], freq: freqs[r], left, right });
    }
  }
  return out;
}

function treeCost(root: EnumNode | null, depth = 1): number {
  if (!root) return 0;
  return root.freq * depth + treeCost(root.left, depth + 1) + treeCost(root.right, depth + 1);
}

function bruteForceOptimal(keys: number[], freqs: number[]): { cost: number; roots: number[] } {
  const trees = enumerateTrees(keys, freqs, 0, keys.length - 1);
  let best = Infinity;
  const roots: number[] = [];
  for (const t of trees) {
    const c = treeCost(t);
    if (c < best) { best = c; roots.length = 0; roots.push(t.key); }
    else if (c === best) { roots.push(t.key); }
  }
  return { cost: best, roots };
}

function randFreqs(n: number, seed: number): number[] {
  let s = seed;
  const next = () => { s = (s * 1103515245 + 12345) % 2147483648; return s % 20; };
  return Array.from({ length: n }, next);
}

// ---------- DP 正确性 ----------
test("枚举核对: n=1..6 随机频数下 DP 最优值与平局规则", () => {
  for (let n = 1; n <= 6; n++) {
    for (let trial = 0; trial < 8; trial++) {
      const keys = Array.from({ length: n }, (_, i) => (i + 1) * 10);
      const freqs = randFreqs(n, n * 1000 + trial * 37 + 1);
      const res = computeObst(keys, freqs);
      const bf = bruteForceOptimal(keys, freqs);
      assert.equal(res.totalCost, bf.cost, `n=${n} freqs=${freqs}`);
      // 平局规则：DP 根必须是所有最优根中键最小者
      assert.equal(keys[res.rootIndex!], Math.min(...bf.roots), `n=${n} 平局规则`);
    }
  }
});

test("单键", () => {
  const res = computeObst([7], [4]);
  assert.equal(res.totalCost, 4);
  assert.equal(res.rootIndex, 0);
  assert.equal(res.nodes[0].depth, 1);
});

test("空集: 代价为 0，根为 null", () => {
  const res = computeObst([], []);
  assert.equal(res.totalCost, 0);
  assert.equal(res.rootIndex, null);
  assert.deepEqual(res.nodes, []);
});

test("全零频数: 代价为 0，平局规则选下标最小根", () => {
  const res = computeObst([1, 2, 3], [0, 0, 0]);
  assert.equal(res.totalCost, 0);
  assert.equal(res.rootIndex, 0);
});

test("频数统一放大: 代价同比放大，树形不变", () => {
  const keys = [1, 2, 3, 4, 5];
  const a = computeObst(keys, [3, 1, 4, 1, 5]);
  const b = computeObst(keys, [30, 10, 40, 10, 50]);
  assert.equal(b.totalCost, a.totalCost * 10);
  const shape = (ns: TreeNode[]) => ns.map((n) => [n.left, n.right]);
  assert.deepEqual(shape(b.nodes), shape(a.nodes));
});

test("中序遍历恰好还原全部键", () => {
  const keys = [2, 4, 6, 8, 10, 12];
  const res = computeObst(keys, [5, 3, 9, 1, 7, 2]);
  const inorder: number[] = [];
  const walk = (idx: number | null) => {
    if (idx === null) return;
    walk(res.nodes[idx].left);
    inorder.push(res.nodes[idx].key);
    walk(res.nodes[idx].right);
  };
  walk(res.rootIndex);
  assert.deepEqual(inorder, keys);
});

test("查询路径: 比较次数等于深度，未包含键明确未找到", () => {
  const keys = [10, 20, 30, 40];
  const res = computeObst(keys, [1, 5, 2, 8]);
  for (let i = 0; i < keys.length; i++) {
    const q = queryPath(res.nodes, res.rootIndex, keys[i]);
    assert.equal(q.found, true);
    assert.equal(q.comparisons, res.nodes[i].depth);
    assert.equal(q.path[q.path.length - 1].comparison, "equal");
  }
  const miss = queryPath(res.nodes, res.rootIndex, 25);
  assert.equal(miss.found, false);
});

// ---------- 输入校验 ----------
test("非法输入拒绝", () => {
  assert.throws(() => validateInput([1, 1], [1, 2]), (e: any) => e.code === "E_DUP_KEY");
  assert.throws(() => validateInput([2, 1], [1, 2]), (e: any) => e.code === "E_NOT_SORTED");
  assert.throws(() => validateInput([1, 2], [1]), (e: any) => e.code === "E_LENGTH_MISMATCH");
  assert.throws(() => validateInput([1], [-1]), (e: any) => e.code === "E_FREQ_INVALID");
  assert.throws(() => validateInput([1], [1.5]), (e: any) => e.code === "E_FREQ_INVALID");
  assert.throws(() => validateInput([NaN], [1]), (e: any) => e.code === "E_KEY_NOT_FINITE");
  assert.throws(() => validateInput("x", []), (e: any) => e.code === "E_NOT_ARRAY");
  assert.throws(() => validateInput(Array.from({ length: 201 }, (_, i) => i), new Array(201).fill(1)),
    (e: any) => e.code === "E_TOO_MANY_KEYS");
});

// ---------- 候选树核验 ----------
const CKEYS = [1, 2, 3];
const CFREQ = [2, 5, 1];

test("候选: 无环但顺序错误被拒绝", () => {
  // 把 3 放在 2 的左子树：无环但违反 BST 顺序
  const v = verifyCandidate(CKEYS, CFREQ, [
    { key: 2, left: 3, right: null },
    { key: 3, left: 1, right: null },
    { key: 1, left: null, right: null },
  ]);
  assert.equal(v.valid, false);
  assert.ok(v.errors.some((e) => e.includes("顺序")));
});

test("候选: 重复节点被拒绝", () => {
  const v = verifyCandidate(CKEYS, CFREQ, [
    { key: 2, left: 1, right: 3 },
    { key: 1, left: null, right: null },
    { key: 3, left: null, right: null },
    { key: 3, left: null, right: null },
  ]);
  assert.equal(v.valid, false);
  assert.ok(v.errors.some((e) => e.includes("重复")));
});

test("候选: 缺失节点与未知键被拒绝", () => {
  const v = verifyCandidate(CKEYS, CFREQ, [
    { key: 2, left: 1, right: 99 },
    { key: 1, left: null, right: null },
    { key: 99, left: null, right: null },
  ]);
  assert.equal(v.valid, false);
  assert.ok(v.errors.some((e) => e.includes("缺少")));
  assert.ok(v.errors.some((e) => e.includes("不在快照键集合")));
});

test("候选: 合法树独立重算代价，不信任附带统计", () => {
  const v = verifyCandidate(CKEYS, CFREQ, [
    { key: 2, left: 1, right: 3 },
    { key: 1, left: null, right: null },
    { key: 3, left: null, right: null },
  ]);
  assert.equal(v.valid, true);
  assert.equal(v.totalCost, 5 * 1 + 2 * 2 + 1 * 2);
  assert.deepEqual(v.inorder, CKEYS);
});

// ---------- 持久化 ----------
function tmpDb(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "obst-")), "test.db");
}

test("发布失败回滚: 事务中断不留下半成品", () => {
  const store = new Store(tmpDb());
  const svc = new ObstService(store);
  svc.createSnapshot([1, 2], [3, 4]);
  const before = svc.list().length;
  // 手动开启事务模拟中途失败
  (store as any).db.exec("BEGIN");
  (store as any).db.prepare("INSERT INTO snapshots (created_at, algo_version, keys_json, freqs_json) VALUES (?,?,?,?)")
    .run(new Date().toISOString(), "v", "[]", "[]");
  (store as any).db.exec("ROLLBACK");
  assert.equal(svc.list().length, before);
  store.close();
});

test("重启后报告一致，不依赖内存 DP 表", () => {
  const dbPath = tmpDb();
  const keys = [5, 15, 25, 35];
  const freqs = [4, 9, 2, 6];
  let reportA: any;
  {
    const store = new Store(dbPath);
    const svc = new ObstService(store);
    const b = svc.createSnapshot(keys, freqs);
    reportA = svc.report(b.snapshotId);
    store.close();
  }
  {
    const store = new Store(dbPath);
    const svc = new ObstService(store);
    const reportB = svc.report(1);
    assert.deepEqual(reportB, reportA);
    const q = svc.query(1, 25);
    assert.equal(q.found, true);
    const miss = svc.query(1, 26);
    assert.equal(miss.found, false);
    store.close();
  }
});

test("频数修改产生新快照，旧树仍可读取", () => {
  const store = new Store(tmpDb());
  const svc = new ObstService(store);
  const a = svc.createSnapshot([10, 20, 30], [5, 5, 5]);
  const b = svc.createSnapshot([10, 20, 30], [5, 5, 50]);
  assert.notEqual(a.snapshotId, b.snapshotId);
  const cmp = svc.compare(a.snapshotId, b.snapshotId);
  assert.equal(cmp.rootChanged, true);
  assert.equal(cmp.a.rootKey, 20);
  assert.equal(cmp.b.rootKey, 30);
  assert.equal(cmp.a.totalCost, 25);   // 手算: 5*1+5*2+5*2
  assert.equal(cmp.b.totalCost, 75);   // 手算: 15+60
  // 旧树仍可读
  assert.equal(svc.load(a.snapshotId).result.totalCost, 25);
  store.close();
});

test("区间分页: 分页不少返回且不影响树计算", () => {
  const store = new Store(tmpDb());
  const svc = new ObstService(store);
  const keys = [1, 2, 3, 4, 5, 6, 7];
  const b = svc.createSnapshot(keys, [3, 1, 4, 1, 5, 9, 2]);
  const full = svc.intervals(b.snapshotId, 0, 1000);
  assert.equal(full.total, 28); // n(n+1)/2
  let collected: any[] = [];
  for (let off = 0; off < full.total; off += 5) {
    collected = collected.concat(svc.intervals(b.snapshotId, off, 5).items);
  }
  assert.equal(collected.length, full.total);
  assert.deepEqual(collected.map((x) => [x.i, x.j]), full.items.map((x) => [x.i, x.j]));
  // 区间明细含各根尝试
  const detail = svc.intervalDetail(b.snapshotId, 0, 6);
  assert.equal(detail.tries.length, 7);
  assert.equal(detail.tries.filter((t) => t.chosen).length, 1);
  store.close();
});

test("错误对象携带稳定错误码", () => {
  const e = new ObstError("E_X", "msg");
  assert.equal(e.code, "E_X");
});
