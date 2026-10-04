import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { ALGO_VERSION, TIE_RULE } from './limits.js';
import type { IntervalRecord, OptimalTreeResult } from './dp.js';
import type { VerificationReport } from './verify.js';

export interface SnapshotRow {
  id: number;
  version: number;
  label: string | null;
  keys_json: string;
  freqs_json: string;
  algo_version: string | null;
  total_cost: number | null;
  root_key: number | null;
  tie_rule: string | null;
  tree_json: string | null;
  summary_json: string | null;
  created_at: string;
}

export class Store {
  readonly db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.migrate();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        version INTEGER NOT NULL UNIQUE,
        label TEXT,
        keys_json TEXT NOT NULL,
        freqs_json TEXT NOT NULL,
        algo_version TEXT,
        total_cost INTEGER,
        root_key INTEGER,
        tie_rule TEXT,
        tree_json TEXT,
        summary_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS intervals (
        snapshot_id INTEGER NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
        seq INTEGER NOT NULL,
        lo INTEGER NOT NULL,
        hi INTEGER NOT NULL,
        start_key INTEGER NOT NULL,
        end_key INTEGER NOT NULL,
        sum_freq INTEGER NOT NULL,
        best_cost INTEGER NOT NULL,
        root_key INTEGER NOT NULL,
        attempts_json TEXT NOT NULL,
        PRIMARY KEY (snapshot_id, seq)
      );
      CREATE TABLE IF NOT EXISTS candidates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        snapshot_id INTEGER NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        report_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }

  listSnapshots(): SnapshotRow[] {
    return this.db.prepare('SELECT * FROM snapshots ORDER BY version DESC').all() as unknown as SnapshotRow[];
  }

  getByVersion(version: number): SnapshotRow | undefined {
    return this.db.prepare('SELECT * FROM snapshots WHERE version = ?').get(version) as unknown as
      | SnapshotRow
      | undefined;
  }

  /** 创建仅含输入的频数快照（尚未构造树）。 */
  createSnapshot(keys: number[], freqs: number[], label?: string): SnapshotRow {
    const next = (this.db.prepare('SELECT COALESCE(MAX(version),0)+1 AS v FROM snapshots').get() as { v: number }).v;
    const info = this.db
      .prepare('INSERT INTO snapshots(version,label,keys_json,freqs_json) VALUES (?,?,?,?)')
      .run(next, label ?? null, JSON.stringify(keys), JSON.stringify(freqs));
    return this.db.prepare('SELECT * FROM snapshots WHERE id = ?').get(Number(info.lastInsertRowid)) as unknown as SnapshotRow;
  }

  /**
   * 原子发布：在单个事务内写树、区间明细与解释摘要。
   * 任一步骤失败则整体回滚，快照保持“未构造”状态。
   */
  publishTree(snapshotId: number, result: OptimalTreeResult): void {
    const tx = this.db.exec.bind(this.db);
    tx('BEGIN');
    try {
      const summary = {
        algoVersion: ALGO_VERSION,
        tieRule: TIE_RULE,
        totalCost: result.totalCost,
        nodeCount: result.keys.length,
        depths: result.depths,
        perKeyComparisons: result.keys.map((k, i) => ({ key: k, freq: result.freqs[i], comparisons: result.depths[i] })),
        inorderKeys: result.order
      };
      this.db
        .prepare(
          `UPDATE snapshots SET algo_version=?, total_cost=?, root_key=?, tie_rule=?, tree_json=?, summary_json=? WHERE id=?`
        )
        .run(
          ALGO_VERSION,
          result.totalCost,
          result.rootKey,
          TIE_RULE,
          JSON.stringify({ rootKey: result.rootKey, nodes: result.nodes, order: result.order }),
          JSON.stringify(summary),
          snapshotId
        );
      this.db.prepare('DELETE FROM intervals WHERE snapshot_id = ?').run(snapshotId);
      const ins = this.db.prepare(
        `INSERT INTO intervals(snapshot_id,seq,lo,hi,start_key,end_key,sum_freq,best_cost,root_key,attempts_json)
         VALUES (?,?,?,?,?,?,?,?,?,?)`
      );
      result.intervals.forEach((rec: IntervalRecord, seq) => {
        ins.run(
          snapshotId,
          seq,
          rec.lo,
          rec.hi,
          rec.startKey,
          rec.endKey,
          rec.sumFreq,
          rec.bestCost,
          rec.rootKey,
          JSON.stringify(rec.attempts)
        );
      });
      tx('COMMIT');
    } catch (err) {
      tx('ROLLBACK');
      throw err;
    }
  }

  countIntervals(snapshotId: number): number {
    return (this.db.prepare('SELECT COUNT(*) AS c FROM intervals WHERE snapshot_id = ?').get(snapshotId) as { c: number }).c;
  }

  getIntervals(snapshotId: number, offset: number, limit: number) {
    return this.db
      .prepare(
        `SELECT seq,lo,hi,start_key,end_key,sum_freq,best_cost,root_key,attempts_json
         FROM intervals WHERE snapshot_id=? ORDER BY seq LIMIT ? OFFSET ?`
      )
      .all(snapshotId, limit, offset) as Array<{
      seq: number; lo: number; hi: number; start_key: number; end_key: number;
      sum_freq: number; best_cost: number; root_key: number; attempts_json: string;
    }>;
  }

  insertCandidate(snapshotId: number, name: string, payload: unknown, report: VerificationReport) {
    const info = this.db
      .prepare('INSERT INTO candidates(snapshot_id,name,payload_json,report_json) VALUES (?,?,?,?)')
      .run(snapshotId, name, JSON.stringify(payload), JSON.stringify(report));
    return Number(info.lastInsertRowid);
  }

  listCandidates(snapshotId: number) {
    return this.db
      .prepare('SELECT id,name,report_json,created_at FROM candidates WHERE snapshot_id=? ORDER BY id')
      .all(snapshotId) as Array<{ id: number; name: string; report_json: string; created_at: string }>;
  }

  close() {
    this.db.close();
  }
}
