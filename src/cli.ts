#!/usr/bin/env node
import { join } from 'node:path';
import { Store } from './db.js';
import { ObstService } from './service.js';
import { buildOptimalTree, type OptimalTreeResult } from './dp.js';
import { enumerateAllBST, catalan } from './enumerate.js';
import { AppError } from './errors.js';
import { verifyCandidate } from './verify.js';

const DATA_DIR = process.env.OBST_DATA_DIR ?? join(process.cwd(), 'data');

function service() {
  return new ObstService(new Store(join(DATA_DIR, 'obst.db')));
}

const parseNums = (s: string) => s.split(',').map((x) => Number(x.trim()));

export function renderTree(result: OptimalTreeResult): string {
  if (result.rootKey === null) return '(空集：无节点)';
  const lines: string[] = [];
  const walk = (key: number | null, prefix: string, isTail: boolean, side: string) => {
    if (key === null) return;
    const node = result.nodes[key]!;
    lines.push(`${prefix}${isTail ? '└─' : '├─'} ${side}${key} (f=${node.freq}, 深度=${node.depth}, 比较次数=${node.depth})`);
    const children = [node.leftKey, node.rightKey];
    const live = children.filter((c): c is number => c !== null);
    live.forEach((child, i) => {
      const isLast = i === live.length - 1;
      walk(child, prefix + (isTail ? '   ' : '│  '), isLast, child === node.leftKey ? 'L:' : 'R:');
    });
  };
  walk(result.rootKey, '', true, '');
  return lines.join('\n');
}

function comparisonTable(result: OptimalTreeResult) {
  const rows = result.keys.map((k, i) => ({
    键: k,
    频数: result.freqs[i]!,
    比较次数: result.depths[i]!,
    加权: result.freqs[i]! * result.depths[i]!
  }));
  return rows;
}

function printTable(rows: Array<Record<string, string | number>>) {
  if (!rows.length) return '(无行)';
  const cols = Object.keys(rows[0]!);
  const widths = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c]).length)));
  const line = (r: Record<string, string | number>) =>
    '| ' + cols.map((c, i) => String(r[c]).padEnd(widths[i]!)).join(' | ') + ' |';
  const sep = '+-' + widths.map((w) => '-'.repeat(w)).join('-+-') + '-+';
  return [sep, line(Object.fromEntries(cols.map((c) => [c, c]))), sep, ...rows.map(line), sep].join('\n');
}

function sideBySide(a: string, b: string, titleA: string, titleB: string) {
  const la = a.split('\n');
  const lb = b.split('\n');
  const width = Math.max(titleA.length, ...la.map((l) => l.length));
  const head = `${titleA.padEnd(width)}   ${titleB}`;
  const rows = Array.from({ length: Math.max(la.length, lb.length) }, (_, i) =>
    `${(la[i] ?? '').padEnd(width)}   ${lb[i] ?? ''}`
  );
  return [head, '-'.repeat(head.length), ...rows].join('\n');
}

function demo() {
  console.log('=== 演示 1：三个键频数相同（平局规则 leftmost-root） ===');
  const keys1 = [10, 20, 30];
  const f1 = [1, 1, 1];
  const r1 = buildOptimalTree(keys1, f1);
  console.log(renderTree(r1));
  console.log(printTable(comparisonTable(r1)));
  // 手算（区间和均为 3）：
  //  根10: 左0 + 右子树[20,30]最优3 + 区间和3 = 6
  //  根20: 左[10]1 + 右[30]1 + 区间和3 = 5
  //  根30: 左子树[10,20]最优3 + 0 + 区间和3 = 6
  console.log('手算对照：根20 => 20 深度1，10/30 深度2 => 1+2+2=5；根10 或 根30 => 6');
  console.log(`DP 总代价=${r1.totalCost}（应为 5），根=${r1.rootKey}`);

  console.log('\n=== 演示 2：边缘键(10)频数显著增大，最优根左移 ===');
  const f2 = [10, 1, 1];
  const r2 = buildOptimalTree(keys1, f2);
  console.log(renderTree(r2));
  console.log(printTable(comparisonTable(r2)));
  // 手算：
  //  根10: 10*1 + [20,30]区间和2 + 右子最优3 = 15
  //  根20: 12 + 10*2(左深2) + 1*2(右深2) = 12+20+2=34
  //  根30: 12 + 左子树[10,20]：根10 => 10*2+1*3=23 => 35
  console.log('手算对照：根10 => 10×1 + 右子树(20深2,30深3)=10+2+3=15；根20 => 12+10×2+1×2=34；根30=>12+20+3=35');
  console.log(`DP 总代价=${r2.totalCost}（应为 15），根=${r2.rootKey}（由 20 变为 10）`);

  console.log('\n=== 并排比较：等频 vs 边缘加权 ===');
  console.log(sideBySide(renderTree(r1), renderTree(r2), 'f=[1,1,1]  cost=5', 'f=[10,1,1] cost=15'));

  console.log('\n=== 独立枚举交叉核对（n<=6 全部合法 BST） ===');
  for (const [keys, freqs, label] of [
    [keys1, f1, '[10,20,30] f=[1,1,1]'],
    [keys1, f2, '[10,20,30] f=[10,1,1]']
  ] as Array<[number[], number[], string]>) {
    const all = enumerateAllBST(keys, freqs);
    const dp = buildOptimalTree(keys, freqs);
    const minCost = Math.min(...all.map((t) => t.weightedCost));
    const optShapes = all.filter((t) => t.weightedCost === minCost);
    console.log(
      `${label}: 卡特兰数=${catalan(keys.length)}（枚举 ${all.length} 棵），枚举最优=${minCost}，DP最优=${dp.totalCost}，` +
        `一致=${minCost === dp.totalCost}；平局最优结构=${optShapes.map((t) => t.shape).join(' / ')}，DP根=${dp.rootKey}`
    );
  }

  console.log('\n=== 边界：空集 / 单键 / 全零频数 / 统一放大 ===');
  console.log('空集:', JSON.stringify({ cost: buildOptimalTree([], []).totalCost, root: buildOptimalTree([], []).rootKey }));
  const single = buildOptimalTree([5], [7]);
  console.log(`单键[5]f=7: 代价=${single.totalCost}（=7），根=${single.rootKey}`);
  const zeros = buildOptimalTree([1, 2, 3], [0, 0, 0]);
  console.log(`全零: 代价=${zeros.totalCost}（=0），平局根=${zeros.rootKey}（最左=1）`);
  const scaled = buildOptimalTree([10, 20, 30], [10, 10, 10]);
  console.log(`统一放大×10: 代价=${scaled.totalCost}（=50，结构不变，根=${scaled.rootKey}）`);

  console.log('\n=== 候选核验：合法 / 顺序错误（无环但违反 BST）/ 重复节点 ===');
  const keys = [10, 20, 30];
  const freqs = [1, 1, 1];
  const badOrder = {
    nodes: [
      { key: 20, leftKey: 30, rightKey: 10 }, // 无环、无重复，但左>根、右<根
      { key: 10, leftKey: null, rightKey: null },
      { key: 30, leftKey: null, rightKey: null }
    ]
  };
  const rep = verifyCandidate(keys, freqs, badOrder);
  console.log('顺序错误候选 valid =', rep.valid, '；错误码 =', rep.errors.map((e) => e.code).join(','));
  const dup = { nodes: [{ key: 10 }, { key: 10 }, { key: 20 }, { key: 30 }] };
  const rep2 = verifyCandidate(keys, freqs, dup);
  console.log('重复节点候选 valid =', rep2.valid, '；错误码 =', rep2.errors.map((e) => e.code).join(','));

  console.log('\n=== 查询路径：已含键 / 未含键（持久化树走查） ===');
  const svc = service();
  const snap = svc.createSnapshot({ keys: keys1, freqs: f1, label: 'demo-equal' });
  svc.construct(snap.version);
  console.log(`版本 ${snap.version} 查 30：`, JSON.stringify(svc.query(snap.version, 30)));
  console.log(`版本 ${snap.version} 查 99：`, JSON.stringify(svc.query(snap.version, 99)));
  console.log(`\n报告（重启后由 SQLite 重建）版本 ${snap.version}：`);
  const rep3 = svc.report(snap.version);
  console.log(JSON.stringify({ totalCost: rep3.totalCost, rootKey: rep3.rootKey, inorderKeys: rep3.inorderKeys }, null, 2));
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const svc = service();
  const arg = (name: string) => {
    const i = rest.findIndex((a) => a.startsWith(`--${name}=`));
    return i >= 0 ? rest[i]!.slice(name.length + 3) : undefined;
  };
  try {
    switch (cmd) {
      case 'demo':
        demo();
        break;
      case 'validate':
      case 'create': {
        const body = { keys: parseNums(arg('keys')!), freqs: parseNums(arg('freqs')!), label: arg('label') };
        if (cmd === 'validate') console.log(JSON.stringify(svc.validate(body), null, 2));
        else console.log(JSON.stringify(svc.createSnapshot(body), null, 2));
        break;
      }
      case 'list':
        console.log(JSON.stringify(svc.listVersions(), null, 2));
        break;
      case 'build': {
        const r = svc.construct(Number(arg('version')));
        console.log(`版本 ${arg('version')} 构造完成：总代价=${r.totalCost}，根=${r.rootKey}，区间数=${r.intervalCount}`);
        console.log(renderTree(r));
        console.log(printTable(comparisonTable(r)));
        break;
      }
      case 'query':
        console.log(JSON.stringify(svc.query(Number(arg('version')), Number(arg('key'))), null, 2));
        break;
      case 'intervals': {
        const page = Number(arg('page') ?? 1);
        const size = Number(arg('pageSize') ?? 50);
        console.log(JSON.stringify(svc.intervals(Number(arg('version')), page, size), null, 2));
        break;
      }
      case 'candidate': {
        const tree = JSON.parse(arg('tree')!);
        console.log(
          JSON.stringify(svc.importCandidate(Number(arg('version')), arg('name') ?? 'cli', tree), null, 2)
        );
        break;
      }
      case 'compare':
        console.log(JSON.stringify(svc.compare(Number(arg('v1')), Number(arg('v2'))), null, 2));
        break;
      case 'report':
        console.log(JSON.stringify(svc.report(Number(arg('version'))), null, 2));
        break;
      default:
        console.log(
 [
            '用法: obst <命令> [参数]',
            '  demo                                  运行内置演示（含手算对照与枚举核对）',
            '  create --keys=1,2,3 --freqs=1,1,1 [--label=x]',
            '  validate --keys=... --freqs=...',
            '  list',
            '  build --version=N',
            '  query --version=N --key=K',
            '  intervals --version=N [--page=1] [--pageSize=50]',
            '  candidate --version=N --name=x --tree=\'{"nodes":[...]}\'',
            '  compare --v1=N --v2=M',
            '  report --version=N'
          ].join('\n')
        );
    }
  } catch (err) {
    if (err instanceof AppError) {
      console.error(`错误[${err.code}]: ${err.message}`);
      if (err.details) console.error(JSON.stringify(err.details));
      process.exitCode = 1;
    } else {
      throw err;
    }
  }
}

main();
