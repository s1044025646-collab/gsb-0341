/** CLI：缩进树、逐键比较次数表、候选树并排比较。直接操作本地数据库，无需启动服务。 */
import * as path from "node:path";
import { Store } from "./db";
import { ObstService } from "./service";
import { TreeNode } from "./obst";
import { ObstError } from "./validate";

const DATA_DIR = process.env.OBST_DATA_DIR || path.join(process.cwd(), "data");
const DB_PATH = process.env.OBST_DB_PATH || path.join(DATA_DIR, "obst.db");

export function renderTree(nodes: TreeNode[], rootIndex: number | null): string {
  if (rootIndex === null) return "(空树)";
  const lines: string[] = [];
  const walk = (idx: number | null, prefix: string): void => {
    if (idx === null) return;
    const n = nodes[idx];
    lines.push(`${prefix}${n.key} (freq=${n.freq}, depth=${n.depth})`);
    const children: Array<number | null> = [n.left, n.right];
    const has = children.filter((c) => c !== null);
    children.forEach((c, i) => {
      if (c === null) return;
      const last = i === 1 || has.indexOf(c) === has.length - 1;
      walk(c, prefix + (last ? "  └─ " : "  ├─ "));
    });
  };
  walk(rootIndex, "");
  return lines.join("\n");
}

export function renderCostTable(nodes: TreeNode[]): string {
  const rows = [...nodes].sort((a, b) => a.key - b.key);
  const lines = ["key      freq     depth    cost(freq*depth)", "------------------------------------------"];
  for (const n of rows) {
    lines.push(
      `${String(n.key).padEnd(8)} ${String(n.freq).padEnd(8)} ${String(n.depth).padEnd(8)} ${n.freq * n.depth}`
    );
  }
  return lines.join("\n");
}

function parseNumbers(s: string): number[] {
  if (s.trim() === "") return [];
  return s.split(",").map((x) => Number(x.trim()));
}

function usage(): void {
  console.log(`用法:
  node dist/cli.js create "<keys逗号分隔>" "<freqs逗号分隔>"
  node dist/cli.js list
  node dist/cli.js tree <snapshotId>
  node dist/cli.js table <snapshotId>
  node dist/cli.js query <snapshotId> <key>
  node dist/cli.js intervals <snapshotId> [offset] [limit]
  node dist/cli.js interval <snapshotId> <i> <j>
  node dist/cli.js verify <snapshotId> "<nodes JSON, 例: [{\\"key\\":2,\\"left\\":1,\\"right\\":3}]>"
  node dist/cli.js compare <snapshotIdA> <snapshotIdB>
  node dist/cli.js report <snapshotId>`);
}

export function runCli(argv: string[], service: ObstService, out: (s: string) => void = console.log): void {
  const [cmd, ...args] = argv;
  switch (cmd) {
    case "create": {
      const b = service.createSnapshot(parseNumbers(args[0] ?? ""), parseNumbers(args[1] ?? ""));
      out(`快照 ${b.snapshotId} 已发布，总代价=${b.result.totalCost}，根=${b.result.rootIndex === null ? "(空)" : b.keys[b.result.rootIndex]}`);
      out(renderTree(b.result.nodes, b.result.rootIndex));
      break;
    }
    case "list": {
      for (const s of service.list()) out(`#${s.id}  n=${s.n}  totalCost=${s.total_cost}  ${s.created_at}  ${s.algo_version}`);
      break;
    }
    case "tree": {
      const b = service.load(Number(args[0]));
      out(renderTree(b.result.nodes, b.result.rootIndex));
      break;
    }
    case "table": {
      const b = service.load(Number(args[0]));
      out(renderCostTable(b.result.nodes));
      out(`总代价 = ${b.result.totalCost}`);
      break;
    }
    case "query": {
      const q = service.query(Number(args[0]), Number(args[1]));
      if (!q.found) { out(`键 ${q.key} 未包含在快照中（未找到，不计入优化目标）`); break; }
      out(`键 ${q.key} 找到，比较次数=${q.comparisons}，路径: ${q.path.map((p) => `${p.key}(${p.comparison})`).join(" -> ")}`);
      break;
    }
    case "intervals": {
      const r = service.intervals(Number(args[0]), Number(args[1] ?? 0), Number(args[2] ?? 20));
      out(`区间总数=${r.total}，返回 ${r.items.length} 条 (offset=${r.offset}, limit=${r.limit})`);
      for (const it of r.items) {
        out(`[${it.i},${it.j}] keys=[${it.keys.join(",")}] weight=${it.weight} cost=${it.cost} root=${it.chosenRootKey}`);
      }
      break;
    }
    case "interval": {
      const d = service.intervalDetail(Number(args[0]), Number(args[1]), Number(args[2]));
      out(`区间 [${d.i},${d.j}] keys=[${d.keys.join(",")}] 各根尝试:`);
      for (const t of d.tries) {
        out(`  root=${t.rootKey}: left=${t.leftCost} + right=${t.rightCost} + weight=${t.weight} = ${t.total}${t.chosen ? "  <-- 选定" : ""}`);
      }
      break;
    }
    case "verify": {
      const nodes = JSON.parse(args[2] ?? "[]");
      const v = service.verify(Number(args[0]), nodes);
      out(`候选树校验: ${v.valid ? "结构合法" : "结构非法"}`);
      for (const e of v.errors) out(`  错误: ${e}`);
      if (v.valid) {
        out(`  独立重算代价=${v.totalCost}，最优代价=${v.optimalCost}，${v.isOptimal ? "达到最优" : "非最优"}`);
        out(`  中序遍历: ${v.inorder.join(", ")}`);
      }
      break;
    }
    case "compare": {
      const c = service.compare(Number(args[0]), Number(args[1]));
      out(`快照${c.a.snapshotId}: 根=${c.a.rootKey} 总代价=${c.a.totalCost}`);
      out(`快照${c.b.snapshotId}: 根=${c.b.rootKey} 总代价=${c.b.totalCost}`);
      out(`根是否变化: ${c.rootChanged ? "是" : "否"}`);
      for (const d of c.freqDiff) out(`  键 ${d.key}: 频数 ${d.before} -> ${d.after}`);
      break;
    }
    case "report": {
      out(JSON.stringify(service.report(Number(args[0])), null, 2));
      break;
    }
    default:
      usage();
  }
}

if (require.main === module) {
  const store = new Store(DB_PATH);
  const service = new ObstService(store);
  try {
    runCli(process.argv.slice(2), service);
  } catch (e) {
    if (e instanceof ObstError) {
      console.error(`错误 [${e.code}] ${e.message}`);
      process.exitCode = 2;
    } else throw e;
  } finally {
    store.close();
  }
}
