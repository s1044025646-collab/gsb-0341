/** SQLite 持久化：快照与分析结果，原子发布，重启后可完整还原报告。 */
import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";
import { ObstError } from "./validate";

export const ALGO_VERSION = "obst-dp-v1";

export interface SnapshotRow {
  id: number;
  created_at: string;
  algo_version: string;
  keys: number[];
  freqs: number[];
}

export interface AnalysisRow {
  snapshot_id: number;
  root_index: number | null;
  root_key: number | null;
  total_cost: number;
  tree_json: string;
  summary_json: string;
  published_at: string;
}

export class Store {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL,
        algo_version TEXT NOT NULL,
        keys_json TEXT NOT NULL,
        freqs_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS analyses (
        snapshot_id INTEGER PRIMARY KEY REFERENCES snapshots(id),
        root_index INTEGER,
        root_key REAL,
        total_cost INTEGER NOT NULL,
        tree_json TEXT NOT NULL,
        summary_json TEXT NOT NULL,
        published_at TEXT NOT NULL
      );
    `);
  }

  close(): void { this.db.close(); }

  /** 原子发布：快照与分析在同一事务中写入，失败整体回滚。 */
  publish(keys: number[], freqs: number[], analysis: {
    rootIndex: number | null;
    rootKey: number | null;
    totalCost: number;
    treeJson: string;
    summaryJson: string;
  }): number {
    this.db.exec("BEGIN");
    try {
      const ins = this.db.prepare(
        "INSERT INTO snapshots (created_at, algo_version, keys_json, freqs_json) VALUES (?, ?, ?, ?)"
      );
      const r = ins.run(new Date().toISOString(), ALGO_VERSION, JSON.stringify(keys), JSON.stringify(freqs));
      const id = Number(r.lastInsertRowid);
      this.db.prepare(
        "INSERT INTO analyses (snapshot_id, root_index, root_key, total_cost, tree_json, summary_json, published_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(id, analysis.rootIndex, analysis.rootKey, analysis.totalCost, analysis.treeJson, analysis.summaryJson, new Date().toISOString());
      this.db.exec("COMMIT");
      return id;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  getSnapshot(id: number): SnapshotRow {
    const row = this.db.prepare("SELECT * FROM snapshots WHERE id = ?").get(id) as any;
  if (!row) throw new ObstError("E_SNAPSHOT_NOT_FOUND", `快照 ${id} 不存在`);
    return {
      id: row.id,
      created_at: row.created_at,
      algo_version: row.algo_version,
      keys: JSON.parse(row.keys_json),
      freqs: JSON.parse(row.freqs_json),
    };
  }

  getAnalysis(id: number): AnalysisRow {
    const row = this.db.prepare("SELECT * FROM analyses WHERE snapshot_id = ?").get(id) as any;
    if (!row) throw new ObstError("E_SNAPSHOT_NOT_FOUND", `快照 ${id} 的分析不存在`);
    return {
      snapshot_id: row.snapshot_id,
      root_index: row.root_index,
      root_key: row.root_key,
      total_cost: row.total_cost,
      tree_json: row.tree_json,
      summary_json: row.summary_json,
      published_at: row.published_at,
    };
  }

  listSnapshots(): Array<{ id: number; created_at: string; algo_version: string; n: number; total_cost: number | null }> {
    const rows = this.db.prepare(`
      SELECT s.id, s.created_at, s.algo_version, s.keys_json, a.total_cost
      FROM snapshots s LEFT JOIN analyses a ON a.snapshot_id = s.id
      ORDER BY s.id
    `).all() as any[];
    return rows.map((r) => ({
      id: r.id,
      created_at: r.created_at,
      algo_version: r.algo_version,
      n: (JSON.parse(r.keys_json) as number[]).length,
      total_cost: r.total_cost,
    }));
  }
}
