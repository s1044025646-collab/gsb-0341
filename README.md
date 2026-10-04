# 最优二叉搜索树（OBST）分析服务

纯后端项目：TypeScript + Node.js + SQLite（`node:sqlite`，无原生依赖），提供 HTTP API 与 CLI。
输入一组**已按键值严格递增排列**的键及各自的成功查询频数，用连续键区间动态规划构造
使**成功查询加权比较次数之和最小**的二叉搜索树。根的比较次数为 1，每深一层加 1。

- 仅考虑能命中这些键的查询；不包含失败查询间隙概率、动态插入删除、自平衡维护
- 优化目标是加权代价最小，**不是**最小树高
- 平局规则（公开且固定）：同一区间存在多个最优根时，选**下标最小（键值最小）**的根，结果确定可复现

## 环境要求

- Windows 本地，Node.js >= 22.5（使用了内置 `node:sqlite`，目前带 Experimental 警告，属正常）
- 不需要 Docker / WSL / 外部服务 / 网络

## 快速开始

```powershell
npm install
npm run build     # 编译 TypeScript 到 dist/
npm test          # 构建并运行全部测试
npm run demo      # 演示：等频三键 -> 边缘键频数增大根变化，附手算对照
npm start         # 启动 HTTP 服务（默认自动选择空闲端口）
npm start -- --port 8080   # 指定端口；也可用环境变量 PORT
```

数据目录默认为项目内 `data/`（可用 `OBST_DATA_DIR` / `OBST_DB_PATH` 覆盖）。

## 核心算法

对区间 `[i, j]`：`C[i][j] = min_r ( C[i][r-1] + C[r+1][j] + W(i,j) )`，`W(i,j)` 为区间频数之和，
空区间代价为 0。从所选根逐层还原真实树结构（每个节点的左右孩子、深度、频数）。

## HTTP API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/snapshots` | 创建频数快照并构造最优树，body: `{"keys":[...],"frequencies":[...]}` |
| GET | `/snapshots` | 列出全部快照 |
| GET | `/snapshots/:id` | 快照 + 分析报告（重启后从 SQLite 还原，不依赖内存 DP 表） |
| GET | `/snapshots/:id/tree` | 树结构（节点、左右孩子、深度、频数） |
| GET | `/snapshots/:id/query?key=K` | 从根到 K 的比较路径；未包含的键明确返回 `found:false` |
| GET | `/snapshots/:id/intervals?offset=&limit=` | 区间记录分页（分页不影响树的完整性） |
| GET | `/snapshots/:id/intervals/:i/:j` | 某区间尝试每个根的代价明细 |
| POST | `/snapshots/:id/verify` | 候选树核验，body: `{"nodes":[{"key":2,"left":1,"right":3},...]}` |
| GET | `/snapshots/:id/report` | 导出报告 JSON |
| GET | `/compare?a=1&b=2` | 比较两个频数版本（键集合须一致） |

错误统一返回 `{"error":{"code":"...","message":"..."}}`，校验失败 400，不存在 404。

## CLI

```powershell
node dist/src/cli.js create "10,20,30" "5,5,50"   # 创建快照，打印缩进树
node dist/src/cli.js list                          # 快照列表
node dist/src/cli.js tree 1                        # 缩进树
node dist/src/cli.js table 1                       # 逐键比较次数表
node dist/src/cli.js query 1 20                    # 查询路径
node dist/src/cli.js intervals 1 0 20              # 区间分页
node dist/src/cli.js interval 1 0 2                # 区间各根尝试明细
node dist/src/cli.js verify 1 "[{\"key\":10,\"right\":20},{\"key\":20,\"right\":30},{\"key\":30}]"
node dist/src/cli.js compare 1 2                   # 并排比较两个版本
node dist/src/cli.js report 1                      # 导出报告
```

## 输入校验与限制

- 键必须为有限数值、严格递增、无重复；**拒绝静默排序**（避免键与频数错配）
- 频数必须为非负整数，单个上限 1,000,000
- 键数量上限 200；累计代价上界超过 `Number.MAX_SAFE_INTEGER` 时在计算前拒绝
- 长度不一致、非法数值均返回稳定错误码
- 空输入：总代价 0、根为 null；全零频数：总代价 0、按平局规则选最小下标根

错误码：`E_NOT_ARRAY` `E_LENGTH_MISMATCH` `E_TOO_MANY_KEYS` `E_KEY_NOT_FINITE`
`E_FREQ_INVALID` `E_FREQ_TOO_LARGE` `E_DUP_KEY` `E_NOT_SORTED` `E_COST_OVERFLOW`
`E_SNAPSHOT_NOT_FOUND` `E_BAD_PAGING` `E_BAD_INTERVAL` `E_KEYSET_MISMATCH`
`E_BAD_JSON` `E_BAD_ID` `E_NOT_FOUND` `E_INTERNAL`

## 持久化与版本

- SQLite 保存键顺序、频数、算法版本（`obst-dp-v1`）、所选根、树结构与解释摘要
- 快照与分析在同一事务写入，**原子发布**，失败整体回滚
- 修改任一频数即创建新快照；旧快照的树与查询路径仍可读取
- 重启后报告完全来自数据库，不依赖内存中的动态规划表

## 候选树核验

检查：节点齐全、无重复、无环、连通、遵守键顺序（BST 约束），并**独立重算**加权代价，
不信任候选附带的任何统计；同时与当前快照的最优代价对比。

## 测试

`npm test` 覆盖：单键、空集、全零频数、频数统一放大（代价同比、树形不变）、
至多 6 键暴力枚举全部合法 BST 核对 DP 最优值与平局规则、中序遍历还原全部键、
查询路径与深度一致、无环但顺序错误的候选、重复节点候选、缺失/未知键候选、
发布失败回滚、重启后报告一致、频数修改产生新分析且旧树可读、区间分页完整性。

## 已知限制

- `node:sqlite` 在 Node 22/25 仍标记为实验特性（启动时有警告，不影响功能）
- 仅成功查询代价；不支持失败查询间隙概率与动态更新
- 键数量上限 200（DP 为 O(n^3)，保证本地秒级响应）
