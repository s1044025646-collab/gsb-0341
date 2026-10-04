import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { AppError } from './errors.js';
import { Store } from './db.js';
import { ObstService } from './service.js';

const DATA_DIR = process.env.OBST_DATA_DIR ?? join(process.cwd(), 'data');
const DB_PATH = join(DATA_DIR, 'obst.db');

function send(res: ServerResponse, status: number, body: unknown) {
  const json = JSON.stringify(body, null, 2);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(json);
}

function readJson(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > 5_000_000) {
        reject(new AppError('BAD_REQUEST', '请求体过大（>5MB）'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf-8');
      if (!text) return resolve({});
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new AppError('BAD_REQUEST', 'JSON 解析失败'));
      }
    });
    req.on('error', reject);
  });
}

const STATUS_BY_CODE: Record<string, number> = {
  EMPTY_KEYS: 400, LENGTH_MISMATCH: 400, DUPLICATE_KEY: 400, KEYS_NOT_SORTED: 400,
  INVALID_KEY: 400, INVALID_FREQ: 400, TOO_MANY_KEYS: 400, FREQ_OUT_OF_RANGE: 400,
  COST_OVERFLOW: 422, BAD_REQUEST: 400,
  NOT_FOUND: 404, VERSION_NOT_FOUND: 404
};

interface RouteCtx {
  service: ObstService;
  params: Record<string, string>;
  query: URLSearchParams;
  body: any;
}

type Handler = (ctx: RouteCtx) => unknown | Promise<unknown>;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
}

function route(method: string, path: string, handler: Handler): Route {
  const keys: string[] = [];
  const pattern = new RegExp(
    '^' +
      path
        .replace(/\/+$/g, '')
        .replace(/\{(\w+)\}/g, (_, k) => {
          keys.push(k);
          return '([^/]+)';
        }) +
      '$'
  );
  return { method, pattern, keys, handler };
}

const intP = (q: URLSearchParams, name: string, dflt: number, min: number, max: number) => {
  const raw = q.get(name);
  if (raw === null) return dflt;
  const v = Number(raw);
  if (!Number.isInteger(v) || v < min || v > max) {
    throw new AppError('BAD_REQUEST', `参数 ${name} 必须是 ${min}..${max} 的整数`, { got: raw });
  }
  return v;
};

export function createApp(service: ObstService): Server {
  const routes: Route[] = [
    route('GET', '/api/health', () => ({ ok: true, service: 'obst-analyzer' })),
    route('POST', '/api/validate', (ctx) => service.validate(ctx.body)),
    route('POST', '/api/snapshots', (ctx) => service.createSnapshot(ctx.body)),
    route('GET', '/api/snapshots', () => ({ versions: service.listVersions() })),
    route('POST', '/api/snapshots/{version}/construct', (ctx) =>
      service.construct(Number(ctx.params.version))
    ),
    route('GET', '/api/snapshots/{version}/tree', (ctx) => service.getTree(Number(ctx.params.version))),
    route('GET', '/api/snapshots/{version}/query', (ctx) =>
      service.query(Number(ctx.params.version), Number(ctx.query.get('key')))
    ),
    route('GET', '/api/snapshots/{version}/intervals', (ctx) => {
      const page = intP(ctx.query, 'page', 1, 1, 1_000_000);
      const pageSize = intP(ctx.query, 'pageSize', 50, 1, 500);
      return service.intervals(Number(ctx.params.version), page, pageSize);
    }),
    route('POST', '/api/snapshots/{version}/candidates', (ctx) =>
      service.importCandidate(Number(ctx.params.version), String(ctx.body?.name ?? 'candidate'), ctx.body?.tree ?? ctx.body)
    ),
    route('GET', '/api/snapshots/{version}/candidates', (ctx) =>
      ({ candidates: service.listCandidates(Number(ctx.params.version)) })
    ),
    route('GET', '/api/compare', (ctx) =>
      service.compare(intP(ctx.query, 'v1', 1, 1, 1e9), intP(ctx.query, 'v2', 1, 1, 1e9))
    ),
    route('GET', '/api/snapshots/{version}/report', (ctx) => service.report(Number(ctx.params.version)))
  ];

  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const pathname = url.pathname.replace(/\/+$/, '') || '/';
      const matched = routes.find(
        (r) => r.method === req.method && r.pattern.test(pathname)
      );
      if (!matched) {
        return send(res, 404, { error: { code: 'NOT_FOUND', message: `无此路由: ${req.method} ${pathname}` } });
      }
      const m = matched.pattern.exec(pathname)!;
      const params: Record<string, string> = {};
      matched.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1]!)));
      const body = req.method === 'POST' ? await readJson(req) : {};
      const result = await matched.handler({ service, params, query: url.searchParams, body });
      send(res, 200, result);
    } catch (err) {
      if (err instanceof AppError) {
        return send(res, STATUS_BY_CODE[err.code] ?? 400, { error: { code: err.code, message: err.message, details: err.details } });
      }
      const message = err instanceof Error ? err.message : String(err);
      send(res, 500, { error: { code: 'INTERNAL', message } });
    }
  });
}

/** 端口 0 = 由操作系统分配空闲端口。 */
export function listen(server: Server, preferred?: number): Promise<{ port: number }> {
  const port = preferred ?? Number(process.env.PORT ?? 0);
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ port: typeof addr === 'object' && addr ? addr.port : port });
    });
  });
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  const store = new Store(DB_PATH);
  const server = createApp(new ObstService(store));
  listen(server).then(({ port }) => {
    console.log(JSON.stringify({ msg: 'OBST 分析服务已启动', baseUrl: `http://127.0.0.1:${port}`, dataDir: DATA_DIR }));
  });
}
