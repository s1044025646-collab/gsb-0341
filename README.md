# 静态最优二叉搜索树分析后端（OBST Analyzer）

仅后端（API + CLI），使用 **TypeScript + Node.js + 内置 SQLite（`node:sqlite`）**，在 Windows 本地直接运行；
不依赖 Docker、WSL、付费服务或任何在线 API。

## 解决的问题

给定一组**已按键值严格递增排列**的键及其**成功查询频数**，构造中序顺序与输入一致的二叉搜索树，使

```
总加权代价 = Σ 频数[key] × 找到 key 所需的比较次数（根为 1，每深一层 +1）
```

最小。**只考虑这些键能被找到的查询**：

- 不加入失败查询的间隙概率（虚拟键）；
- 不做动态插入删除、不做自平衡维护；
- 不以最小树高代替加权代价最小，也不按“频数最高者优先”贪心选根。

### 动态规划（自行实现）

对连续键区间 `[i..j]`：

```
e[i][j] = min_{r=i..j} ( e[i][r-1] + e[r+1][j] + Σ_{k=i..j} p[k] )
空区间 e[i][i-1] = 0
```

- 选 `r` 作根时，左/右子区间严格是 `[i..r-1]` 与 `[r+1..j]`（左子树不会出现比根大的键）；
- 区间频数之和用前缀和取得；
- **平局固定规则 `leftmost-root`**：相同最优代价取键序最靠左的根，结果确定；
- 用 `root[][]` 表逐层还原真实树结构、深度与查询路径。

### 限制（超限在计算前拒绝）

| 项 | 值 | 说明 |
| --- | --- | --- |
| `MAX_KEYS` | 200 | DP 为 O(n³) |
| `MAX_FREQ` | 1,000,000,000 | 单键非负整数频数上限 |
| 累计代价 | ≤ `Number.MAX_SAFE_INTEGER` | 保证 JS/SQLite 64 位整数内精确 |

键必须是有限整数，频数必须是非负整数。拒绝重复键、未排序输入、长度不一致与非法数值；
**不会静默排序**（避免键与频数错配）。空输入与全零频数有确定结果。

## 环境要求

- Node.js **≥ 22.5**（已在 Node v25 验证；使用内置 `node:sqlite`，无需 native 模块编译）。

## 安装与构建

```powershell
npm install
npm run build
```

## 运行演示（含手算对照与独立枚举核对）

```powershell
npm run demo
```

演示内容：

1. 三键 `[10,20,30]` 等频 `[1,1,1]`：最优根为 20，总代价 **5**（根比较 1 次，两叶各 2 次：1+2+2）；
2. 边缘键频数增大为 `[10,1,1]`：最优根左移为 10，总代价 **15**（手算：10×1 + 20×2 + 30×3 = 15）；
3. 两棵树缩进式并排比较；
4. 对至多 6 个键**独立枚举全部合法 BST（卡特兰数）**，逐棵重算加权深度，核对 DP 最优值与平局根；
5. 空集、单键、全零频数、频数统一放大；候选树合法/顺序错误/重复节点核验；命中与未命中查询路径；持久化报告。

## 启动 HTTP 服务

```powershell
npm start                 # 构建后运行 dist/server.js
# 或开发模式：
npm run dev
```

- 默认端口 **0**：由操作系统分配空闲端口，启动时打印 `http://127.0.0.1:<端口>`；
- 自定义端口：`$env:PORT=8080; npm start`（或 `set PORT=8080 && ...`）；
- 数据目录：项目内 `./data`（可用环境变量 `OBST_DATA_DIR` 覆盖）。

### API 一览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/validate` | 仅校验键/频数输入 |
| POST | `/api/snapshots` | 创建频数快照（新版本） |
| GET | `/api/snapshots` | 列出全部版本 |
| POST | `/api/snapshots/{v}/construct` | 构造最优树并原子发布 |
| GET | `/api/snapshots/{v}/tree` | 查看树、节点与解释摘要 |
| GET | `/api/snapshots/{v}/query?key=K` | 查看从根到键的比较过程；未含键明确返回 `found:false` |
| GET | `/api/snapshots/{v}/intervals?page=1&pageSize=50` | 区间选根尝试明细分页 |
| POST | `/api/snapshots/{v}/candidates` | 导入并核验候选树 |
| GET | `/api/snapshots/{v}/candidates` | 候选核验结果列表 |
| GET | `/api/compare?v1=N&v2=M` | 比较两个频数版本 |
| GET | `/api/snapshots/{v}/report` | 导出报告（重启后由 SQLite 重建） |

候选树请求体：

```json
{
  "name": "chain",
  "tree": {
    "nodes": [
      { "key": 10, "leftKey": null, "rightKey": 20 },
      { "key": 20, "leftKey": null, "rightKey": 30 },
      { "key": 30, "leftKey": null, "rightKey": null }
    ]
  }
}
```

### 错误码

`LENGTH_MISMATCH`、`DUPLICATE_KEY`、`KEYS_NOT_SORTED`、`INVALID_KEY`、`INVALID_FREQ`、
`TOO_MANY_KEYS`、`FREQ_OUT_OF_RANGE`、`COST_OVERFLOW`、`VERSION_NOT_FOUND`、
`CANDIDATE_MISSING_NODES`、`CANDIDATE_EXTRA_NODES`、`CANDIDATE_DUPLICATE_NODE`、
`CANDIDATE_NOT_A_TREE`（环/不可达/多根/悬空指针）、`CANDIDATE_ORDER_VIOLATION`、
`CANDIDATE_MULTIPLE_ROOTS`、`BAD_REQUEST`、`NOT_FOUND`、`INTERNAL`。

## CLI

```powershell
npx tsx src/cli.ts create --keys=10,20,30 --freqs=10,1,1 --label=edge
npx tsx src/cli.ts list
npx tsx src/cli.ts build --version=1
npx tsx src/cli.ts query --version=1 --key=30
npx tsx src/cli.ts intervals --version=1 --page=1 --pageSize=10
npx tsx src/cli.ts candidate --version=1 --name=chain --tree='{\"nodes\":[{\"key\":10,\"rightKey\":20},{\"key\":20,\"rightKey\":30},{\"key\":30}]}'
npx tsx src/cli.ts compare --v1=1 --v2=2
npx tsx src/cli.ts report --version=1
```

`build` 输出缩进树与逐键比较次数表；`demo` 中包含最优树与固定候选树的并排比较。

## 持久化与原子发布

SQLite 表：

- `snapshots`：键顺序、频数、算法版本 `obst-success-v1`、平局规则、所选根、树 JSON、解释摘要；
- `intervals`：每个连续区间的频数和、最优代价、所选根及**每个候选根的尝试代价**（分页读取，不影响计算）；
- `candidates`：候选树载荷与独立核验报告。

构造在单个事务内写入，任何步骤失败即回滚（测试覆盖），快照保持“未构造”。
修改一个频数会创建**新版本**，旧树与查询路径仍可读取；报告仅依赖磁盘数据，重启后一致（测试覆盖）。

## 测试

```powershell
npm test
```

覆盖：单键、空集、零频数、统一放大、三键手算对照、6 键以内全枚举核对、查询路径、
中序恰好还原全部键、无环但顺序错误与重复节点候选、事务失败回滚、重启后报告一致、HTTP 端到端。

## 范围与限制

- 仅成功查询（无间隙失败概率、无动态更新、无 AVL/红黑维护）；
- 仅 API 与 CLI，无网页界面；
- 频数/代价模型使用精确整数，不引入浮点；
- 未做鉴权与并发写压测，定位为本地单机分析工具。
