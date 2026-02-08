import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { nowMs } from '../lib/utils.js';

export type JobState = 'creating' | 'queued' | 'running' | 'completed' | 'failed' | 'canceled';

export type JobRow = {
  job_id: string;
  user_id: string;
  state: JobState;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
  updated_at: number;
  timeout_seconds: number;
  no_progress_timeout_seconds: number;
  comfy_prompt_id: string | null;
  error: string | null;
  params_json: string | null;
  debug: number;
  ref_rel: string | null;
  src_rels_json: string | null;
  progress_json: string | null;
  cancel_requested: number;
};

export type JobResultRow = {
  job_id: string;
  idx: number;
  filename: string;
  subfolder: string;
  type: string;
};

export type JobEventRow = {
  id: number;
  job_id: string;
  ts: number;
  event_type: string;
  payload_json: string;
};

export function openDb(dbPath: string): DatabaseSync {
  const dir = path.dirname(dbPath);
  fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(dbPath);
  // Better concurrency between API + worker processes.
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec('PRAGMA foreign_keys = ON;');
  initSchema(db);
  return db;
}

function initSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      job_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      state TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      finished_at INTEGER,
      updated_at INTEGER NOT NULL,
      timeout_seconds INTEGER NOT NULL,
      no_progress_timeout_seconds INTEGER NOT NULL,
      comfy_prompt_id TEXT,
      error TEXT,
      params_json TEXT,
      debug INTEGER NOT NULL DEFAULT 0,
      ref_rel TEXT,
      src_rels_json TEXT,
      progress_json TEXT,
      cancel_requested INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_user_state ON jobs(user_id, state, created_at);
    CREATE INDEX IF NOT EXISTS idx_jobs_state_created ON jobs(state, created_at);

    CREATE TABLE IF NOT EXISTS job_files (
      job_id TEXT NOT NULL,
      role TEXT NOT NULL,
      idx INTEGER NOT NULL,
      rel_path TEXT NOT NULL,
      orig_name TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      PRIMARY KEY (job_id, role, idx)
    );
    CREATE INDEX IF NOT EXISTS idx_job_files_job ON job_files(job_id);

    CREATE TABLE IF NOT EXISTS job_results (
      job_id TEXT NOT NULL,
      idx INTEGER NOT NULL,
      filename TEXT NOT NULL,
      subfolder TEXT NOT NULL,
      type TEXT NOT NULL,
      PRIMARY KEY (job_id, idx)
    );
    CREATE INDEX IF NOT EXISTS idx_job_results_job ON job_results(job_id);

    CREATE TABLE IF NOT EXISTS job_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL,
      ts INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_job_events_job_id_id ON job_events(job_id, id);
  `);
}

function beginImmediate(db: DatabaseSync): void {
  db.exec('BEGIN IMMEDIATE;');
}

function commit(db: DatabaseSync): void {
  db.exec('COMMIT;');
}

function rollback(db: DatabaseSync): void {
  db.exec('ROLLBACK;');
}

export function createJob(
  db: DatabaseSync,
  job: {
    jobId: string;
    userId: string;
    timeoutSeconds: number;
    noProgressTimeoutSeconds: number;
    paramsJson: string | null;
    debug: boolean;
  },
): void {
  const ts = nowMs();
  db.prepare(
    `INSERT INTO jobs (
       job_id, user_id, state, created_at, updated_at,
       timeout_seconds, no_progress_timeout_seconds,
       comfy_prompt_id, error, params_json, debug,
       ref_rel, src_rels_json, progress_json, cancel_requested
     ) VALUES (
       ?, ?, 'creating', ?, ?,
       ?, ?,
       NULL, NULL, ?, ?,
       NULL, NULL, NULL, 0
     )`,
  ).run(
    job.jobId,
    job.userId,
    ts,
    ts,
    Math.trunc(job.timeoutSeconds),
    Math.trunc(job.noProgressTimeoutSeconds),
    job.paramsJson,
    job.debug ? 1 : 0,
  );
}

export function markJobQueued(
  db: DatabaseSync,
  jobId: string,
  data: { refRel: string; srcRels: string[]; debug: boolean },
): void {
  const ts = nowMs();
  db.prepare(
    `UPDATE jobs
     SET state='queued',
         updated_at=?,
         ref_rel=?,
         src_rels_json=?,
         debug=?
     WHERE job_id=?`,
  ).run(ts, data.refRel, JSON.stringify(data.srcRels), data.debug ? 1 : 0, jobId);
}

export function markJobFailed(db: DatabaseSync, jobId: string, message: string): void {
  const ts = nowMs();
  db.prepare(
    `UPDATE jobs
     SET state='failed',
         finished_at=COALESCE(finished_at, ?),
         updated_at=?,
         error=?
     WHERE job_id=?`,
  ).run(ts, ts, message, jobId);
}

export function markJobCanceled(db: DatabaseSync, jobId: string, message: string | null = null): void {
  const ts = nowMs();
  db.prepare(
    `UPDATE jobs
     SET state='canceled',
         finished_at=COALESCE(finished_at, ?),
         updated_at=?,
         error=?
     WHERE job_id=?`,
  ).run(ts, ts, message, jobId);
}

export function requestCancel(db: DatabaseSync, jobId: string): void {
  const ts = nowMs();
  db.prepare(`UPDATE jobs SET cancel_requested=1, updated_at=? WHERE job_id=?`).run(ts, jobId);
}

export function markJobRunning(db: DatabaseSync, jobId: string): void {
  const ts = nowMs();
  db.prepare(
    `UPDATE jobs
     SET state='running',
         started_at=COALESCE(started_at, ?),
         updated_at=?
     WHERE job_id=?`,
  ).run(ts, ts, jobId);
}

export function setJobComfyPromptId(db: DatabaseSync, jobId: string, promptId: string): void {
  const ts = nowMs();
  db.prepare(`UPDATE jobs SET comfy_prompt_id=?, updated_at=? WHERE job_id=?`).run(promptId, ts, jobId);
}

export function setJobProgress(db: DatabaseSync, jobId: string, progress: any): void {
  const ts = nowMs();
  db.prepare(`UPDATE jobs SET progress_json=?, updated_at=? WHERE job_id=?`).run(JSON.stringify(progress), ts, jobId);
}

export function markJobCompleted(db: DatabaseSync, jobId: string): void {
  const ts = nowMs();
  db.prepare(
    `UPDATE jobs
     SET state='completed',
         finished_at=COALESCE(finished_at, ?),
         updated_at=?
     WHERE job_id=?`,
  ).run(ts, ts, jobId);
}

export function upsertJobFile(
  db: DatabaseSync,
  row: { jobId: string; role: 'ref' | 'src'; idx: number; relPath: string; origName: string; bytes: number; sha256: string },
): void {
  db.prepare(
    `INSERT INTO job_files(job_id, role, idx, rel_path, orig_name, bytes, sha256)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(job_id, role, idx) DO UPDATE SET
       rel_path=excluded.rel_path,
       orig_name=excluded.orig_name,
       bytes=excluded.bytes,
       sha256=excluded.sha256`,
  ).run(row.jobId, row.role, row.idx, row.relPath, row.origName, row.bytes, row.sha256);
}

export function replaceJobResults(db: DatabaseSync, jobId: string, images: JobResultRow[]): void {
  beginImmediate(db);
  try {
    db.prepare(`DELETE FROM job_results WHERE job_id=?`).run(jobId);
    const stmt = db.prepare(
      `INSERT INTO job_results(job_id, idx, filename, subfolder, type)
       VALUES (?, ?, ?, ?, ?)`,
    );
    for (const img of images) {
      stmt.run(jobId, img.idx, img.filename, img.subfolder, img.type);
    }
    commit(db);
  } catch (e) {
    try {
      rollback(db);
    } catch {
      // ignore
    }
    throw e;
  }
}

export function insertJobEvent(db: DatabaseSync, jobId: string, eventType: string, payload: any): number {
  const ts = nowMs();
  const payloadJson = typeof payload === 'string' ? payload : JSON.stringify(payload ?? {});
  const r = db
    .prepare(`INSERT INTO job_events(job_id, ts, event_type, payload_json) VALUES (?, ?, ?, ?)`)
    .run(jobId, ts, eventType, payloadJson) as any;
  return Number(r?.lastInsertRowid ?? 0);
}

export function getJob(db: DatabaseSync, jobId: string): JobRow | null {
  const row = db.prepare(`SELECT * FROM jobs WHERE job_id=?`).get(jobId) as any;
  return row ? (row as JobRow) : null;
}

export function listJobsByUser(
  db: DatabaseSync,
  userId: string,
  opts?: {
    states?: JobState[] | null;
    limit?: number;
  },
): JobRow[] {
  const states = opts?.states ?? null;
  const limit = Math.max(1, Math.min(200, Math.trunc(opts?.limit ?? 50)));

  if (!states || states.length === 0) {
    return (db
      .prepare(`SELECT * FROM jobs WHERE user_id=? ORDER BY created_at DESC LIMIT ?`)
      .all(userId, limit) as any[]) as JobRow[];
  }

  const ph = states.map(() => '?').join(', ');
  const sql = `SELECT * FROM jobs WHERE user_id=? AND state IN (${ph}) ORDER BY created_at DESC LIMIT ?`;
  return (db.prepare(sql).all(userId, ...states, limit) as any[]) as JobRow[];
}

export function getJobResults(db: DatabaseSync, jobId: string): JobResultRow[] {
  return (db.prepare(`SELECT * FROM job_results WHERE job_id=? ORDER BY idx ASC`).all(jobId) as any[]) as JobResultRow[];
}

export function getJobEventsSince(db: DatabaseSync, jobId: string, sinceId: number, limit = 200): JobEventRow[] {
  return (db
    .prepare(`SELECT * FROM job_events WHERE job_id=? AND id>? ORDER BY id ASC LIMIT ?`)
    .all(jobId, sinceId, limit) as any[]) as JobEventRow[];
}
