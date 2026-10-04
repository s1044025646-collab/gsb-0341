/** 演示脚本：等频三键 -> 边缘键频数增大后根变化；附手算对照与候选树并排比较。 */
import * as path from "node:path";
import * as fs from "node:fs";
import { Store } from "./db";
import { ObstService } from "./service";
import { renderTree, renderCostTable } from "./cli";

const DEMO_DB = path.join(process.cwd(), "data", "demo.db");
for (const suffix of ["", "-wal", "-shm", "-journal"]) {
  try { fs.unlinkSync(DEMO_DB + suffix); } catch { /* 忽略 */ }
}

const store = new Store(DEMO_DB);
const svc = new ObstService(store);

function show(title: string, keys: number[], freqs: number[]): number {
  console.log("=".repeat(60));
  console.log(title);
  console.log(`keys=[${keys.join(", ")}] freqs=[${freqs.join(", ")}]`);
  const b = svc.createSnapshot(keys, freqs);
  console.log(`快照 ${b.snapshotId}: 根=${b.keys[b.result.rootIndex!]}，总代价=${b.result.totalCost}`);
  console.log(renderTree(b.result.nodes, b.result.rootIndex));
  console.log(renderCostTable(b.result.nodes));
  return b.snapshotId;
}

// 场景 1：三个键频数相同
// 手算：根=20 时 cost = 5*1 + 5*2 + 5*2 = 25（平局规则选下标最小根，此处唯一最优）
const id1 = show("场景 1：三键等频（手算对照：根20, 总代价=5*1+5*2+5*2=25）", [10, 20, 30], [5, 5, 5]);

// 场景 2：边缘键 30 频数显著增大
// 手算：根=30 时 cost = C[10,20](=15) + 0 + W(=60) = 75；根=20 时 5+50+60=115；根=10 时 60+60=120
const id2 = show("场景 2：边缘键频数增大（手算对照：根30, 总代价=15+60=75）", [10, 20, 30], [5, 5, 50]);

console.log("=".repeat(60));
console.log("版本比较（频数修改产生新分析，旧树仍可读取）:");
const cmp = svc.compare(id1, id2);
console.log(`根变化: ${cmp.rootChanged ? "是" : "否"}（${cmp.a.rootKey} -> ${cmp.b.rootKey}）`);
for (const d of cmp.freqDiff) console.log(`  键 ${d.key}: 频数 ${d.before} -> ${d.after}`);

console.log("=".repeat(60));
console.log("与固定候选树并排比较（候选: 根10 的右斜链 10->20->30）:");
const v = svc.verify(id2, [
  { key: 10, left: null, right: 20 },
  { key: 20, left: null, right: 30 },
  { key: 30, left: null, right: null },
]);
console.log(`候选树独立重算代价 = ${v.totalCost}（手算: 5*1+5*2+50*3=165）`);
console.log(`最优树代价         = ${v.optimalCost}`);
console.log(`候选是否最优: ${v.isOptimal ? "是" : "否"}，差值=${(v.totalCost ?? 0) - v.optimalCost}`);

console.log("=".repeat(60));
console.log("查询路径演示:");
for (const k of [10, 20, 30, 25]) {
  const q = svc.query(id2, k);
  console.log(q.found
    ? `  键 ${k}: 比较 ${q.comparisons} 次，路径 ${q.path.map((p) => p.key).join(" -> ")}`
    : `  键 ${k}: 未找到（不计入优化目标）`);
}

store.close();
console.log(`演示数据库: ${DEMO_DB}`);
