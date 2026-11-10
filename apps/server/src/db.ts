import { DatabaseSync } from 'node:sqlite';
import type { InputLog } from '@booster/sim';
import type { VerifiedRun } from './verify.ts';

export interface BoardRow {
  rank: number;
  name: string;
  score: number;
  grade: string;
  date?: string;
}

export interface GhostRow {
  name: string;
  score: number;
  seed: number;
  inputs: InputLog;
}

/**
 * Leaderboard storage on SQLite via Node's built-in `node:sqlite` (no native
 * addon to compile, so the Docker image stays tiny). One row per
 * (board, key, name): a player's best run on that board. That keeps the table
 * small and makes "best per player" a primary-key upsert instead of a GROUP BY.
 */
export class Store {
  private readonly db: DatabaseSync;

  constructor(path = ':memory:') {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS runs (
        board       TEXT    NOT NULL,           -- 'daily' | 'level'
        key         TEXT    NOT NULL,           -- date (daily) or level id
        name        TEXT    NOT NULL,
        score       INTEGER NOT NULL,
        grade       TEXT    NOT NULL,
        seed        INTEGER NOT NULL,
        ticks       INTEGER NOT NULL,
        sim_version INTEGER NOT NULL,
        inputs      TEXT    NOT NULL,           -- JSON input log, for ghosts and audits
        created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        PRIMARY KEY (board, key, name)
      );
      CREATE INDEX IF NOT EXISTS runs_by_score ON runs (board, key, score DESC);
      CREATE INDEX IF NOT EXISTS runs_alltime ON runs (board, score DESC);
    `);
  }

  /**
   * Save a verified run if it beats that player's previous best on the board.
   * Ties keep the earlier run. Returns the run's rank on its board afterwards.
   */
  save(run: VerifiedRun, simVersion: number): { improved: boolean; rank: number } {
    const res = this.db
      .prepare(
        `INSERT INTO runs (board, key, name, score, grade, seed, ticks, sim_version, inputs)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (board, key, name) DO UPDATE SET
           score = excluded.score, grade = excluded.grade, seed = excluded.seed,
           ticks = excluded.ticks, sim_version = excluded.sim_version,
           inputs = excluded.inputs, created_at = excluded.created_at
         WHERE excluded.score > runs.score`,
      )
      .run(run.board, run.key, run.name, run.score, run.grade, run.seed, run.ticks, simVersion, JSON.stringify(run.inputs));
    return { improved: Number(res.changes) > 0, rank: this.rankOf(run.board, run.key, run.score) };
  }

  private rankOf(board: string, key: string, score: number): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM runs WHERE board = ? AND key = ? AND score > ?').get(board, key, score) as { n: number };
    return Number(row.n) + 1;
  }

  top(board: 'daily' | 'level', key: string, limit = 20): BoardRow[] {
    const rows = this.db
      .prepare('SELECT name, score, grade FROM runs WHERE board = ? AND key = ? ORDER BY score DESC, created_at ASC LIMIT ?')
      .all(board, key, limit) as unknown as Omit<BoardRow, 'rank'>[];
    return rows.map((r, i) => ({ rank: i + 1, name: r.name, score: r.score, grade: r.grade }));
  }

  /** Best daily-challenge runs across every day. */
  allTime(limit = 20): BoardRow[] {
    const rows = this.db
      .prepare(`SELECT name, score, grade, key AS date FROM runs WHERE board = 'daily' ORDER BY score DESC, created_at ASC LIMIT ?`)
      .all(limit) as unknown as Omit<BoardRow, 'rank'>[];
    return rows.map((r, i) => ({ rank: i + 1, ...r }));
  }

  /** The leading run's inputs, so clients can race it as a ghost. */
  leader(board: 'daily' | 'level', key: string, simVersion: number): GhostRow | null {
    const row = this.db
      .prepare('SELECT name, score, seed, inputs FROM runs WHERE board = ? AND key = ? AND sim_version = ? ORDER BY score DESC, created_at ASC LIMIT 1')
      .get(board, key, simVersion) as { name: string; score: number; seed: number; inputs: string } | undefined;
    return row ? { name: row.name, score: row.score, seed: row.seed, inputs: JSON.parse(row.inputs) as InputLog } : null;
  }

  close(): void {
    this.db.close();
  }
}
