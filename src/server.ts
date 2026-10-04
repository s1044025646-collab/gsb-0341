/** HTTP API 服务。默认端口 0 = 自动选择空闲端口；可用 PORT 环境变量或 --port 指定。 */
import * as http from "node:http";
import * as path from "node:path";
import { Store } from "./db";
import { ObstService } from "./service";
import { ObstError } from "./validate";

const DATA_DIR = process.env.OBST_DATA_DIR || path.join(process.cwd(), "data");
const DB_PATH = process.env.OBST_DB_PATH || path.join(DATA_DIR, "obst.db");

function parsePort(argv: string[]): number {
  const idx = argv.indexOf("--port");
  if (idx >= 0 && argv[idx + 1]) return Number(argv[idx + 1]);
  if (process.env.PORT) return Number(process.env.PORT);
  return 0; // 空闲端口
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body, null, 2);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(text);
}

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ObstError("E_BAD_JSON", "请求体不是合法 JSON");
  }
}

export function createServer(service: ObstService): http.Server {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean);
    try {
      // POST /snapshots {keys, frequencies}
      if (req.method === "POST" && parts[0] === "snapshots" && parts.length === 1) {
        const body = (await readBody(req)) as any;
        const b = service.createSnapshot(body.keys, body.frequencies);
        return send(res, 201, {
          snapshotId: b.snapshotId,
          totalCost: b.result.totalCost,
          rootKey: b.result.rootIndex === null ? null : b.keys[b.result.rootIndex],
          nodes: b.result.nodes,
        });
      }
      if (req.method === "GET" && parts[0] === "snapshots" && parts.length === 1) {
        return send(res, 200, service.list());
      }
      const id = parts[1] !== undefined ? Number(parts[1]) : NaN;
      if (parts[0] === "snapshots" && parts.length >= 2) {
        if (!Number.isInteger(id)) throw new ObstError("E_BAD_ID", `非法快照 id: ${parts[1]}`);
        if (req.method === "GET" && parts.length === 2) return send(res, 200, service.report(id));
        if (req.method === "GET" && parts[2] === "tree") {
          const b = service.load(id);
          return send(res, 200, { snapshotId: id, totalCost: b.result.totalCost, nodes: b.result.nodes });
        }
        if (req.method === "GET" && parts[2] === "query") {
          const key = url.searchParams.has("key") ? Number(url.searchParams.get("key")) : undefined;
          return send(res, 200, service.query(id, key));
        }
        if (req.method === "GET" && parts[2] === "intervals" && parts.length === 3) {
          const offset = url.searchParams.has("offset") ? Number(url.searchParams.get("offset")) : 0;
          const limit = url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : 100;
          return send(res, 200, service.intervals(id, offset, limit));
        }
        if (req.method === "GET" && parts[2] === "intervals" && parts.length === 5) {
          return send(res, 200, service.intervalDetail(id, Number(parts[3]), Number(parts[4])));
        }
        if (req.method === "POST" && parts[2] === "verify") {
          const body = (await readBody(req)) as any;
          return send(res, 200, service.verify(id, body.nodes));
        }
        if (req.method === "GET" && parts[2] === "report") return send(res, 200, service.report(id));
      }
      if (req.method === "GET" && parts[0] === "compare") {
        const a = Number(url.searchParams.get("a"));
        const b = Number(url.searchParams.get("b"));
        return send(res, 200, service.compare(a, b));
      }
      throw new ObstError("E_NOT_FOUND", `未知路由: ${req.method} ${url.pathname}`);
    } catch (e) {
      if (e instanceof ObstError) {
        const status = e.code === "E_SNAPSHOT_NOT_FOUND" || e.code === "E_NOT_FOUND" ? 404 : 400;
        return send(res, status, { error: { code: e.code, message: e.message } });
      }
      return send(res, 500, { error: { code: "E_INTERNAL", message: String(e) } });
    }
  });
}

if (require.main === module) {
  const store = new Store(DB_PATH);
  const service = new ObstService(store);
  const server = createServer(service);
  const port = parsePort(process.argv.slice(2));
  server.listen(port, () => {
    const addr = server.address();
    const actual = typeof addr === "object" && addr ? addr.port : port;
    console.log(`OBST 服务已启动: http://localhost:${actual}  (数据目录: ${DATA_DIR})`);
  });
}
