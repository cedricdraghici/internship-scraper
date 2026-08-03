/**
 * Storage. Uses node:sqlite (built into Node 22+) so there is no native dep to compile.
 *
 * Dedupe strategy: a posting's identity is company+normalized-title+province. The same
 * job listed on Greenhouse and in a GitHub repo collapses to one row; `sources` records
 * every source that has seen it.
 */

import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { JobPosting, JobStatus } from '../types.js';
import { normalizeTitle } from './roles.js';

/**
 * JT_DATA_DIR points this at a mounted volume when deployed, so the database (and
 * with it every applied/interview mark) survives a redeploy. Unset locally.
 */
export const DB_PATH = resolve(process.env.JT_DATA_DIR ?? resolve(process.cwd(), 'data'), 'jobs.db');

/** Strip qualifiers that differ between sources for the same underlying job. */
function identityTitle(title: string): string {
  return normalizeTitle(title)
    .replace(/\((summer|fall|winter|spring)?\s*20\d\d\)/g, '')
    .replace(/\b20\d\d\b/g, '')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function jobId(company: string, title: string, province: string | null): string {
  const key = [company.toLowerCase().trim(), identityTitle(title), province ?? ''].join('|');
  return createHash('sha256').update(key).digest('hex').slice(0, 16);
}

export function openDb(path = DB_PATH): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS jobs (
      id                TEXT PRIMARY KEY,
      title             TEXT NOT NULL,
      company           TEXT NOT NULL,
      location          TEXT NOT NULL,
      province          TEXT,
      remote            INTEGER NOT NULL DEFAULT 0,
      url               TEXT NOT NULL,
      source            TEXT NOT NULL,
      sources           TEXT NOT NULL DEFAULT '[]',
      posted_at         TEXT,
      first_seen_at     TEXT NOT NULL,
      last_seen_at      TEXT NOT NULL,
      salary_raw        TEXT,
      salary_min        INTEGER,
      salary_max        INTEGER,
      salary_currency   TEXT,
      type              TEXT,
      role_category     TEXT,
      matched_by        TEXT,
      canada_confidence TEXT NOT NULL DEFAULT 'confirmed',
      canada_matched_by TEXT,
      sponsorship       TEXT,
      description       TEXT,
      status            TEXT NOT NULL DEFAULT 'new',
      notes             TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_first_seen ON jobs(first_seen_at DESC);
    CREATE INDEX IF NOT EXISTS idx_jobs_status     ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_category   ON jobs(role_category);
    CREATE INDEX IF NOT EXISTS idx_jobs_province   ON jobs(province);

    CREATE TABLE IF NOT EXISTS runs (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL,
      source    TEXT NOT NULL,
      ok        INTEGER NOT NULL,
      fetched   INTEGER NOT NULL DEFAULT 0,
      kept      INTEGER NOT NULL DEFAULT 0,
      inserted  INTEGER NOT NULL DEFAULT 0,
      updated   INTEGER NOT NULL DEFAULT 0,
      ms        INTEGER NOT NULL DEFAULT 0,
      error     TEXT
    );
  `);
  return db;
}

export interface UpsertResult {
  inserted: number;
  updated: number;
  /** The rows that were genuinely new this run, what notifications announce. */
  newJobs: JobPosting[];
}

/**
 * Insert new postings; for ones already known, refresh last_seen and merge the source
 * list. Never overwrites `status` or `notes`, that is the user's own tracking data.
 */
export function upsertJobs(db: DatabaseSync, jobs: JobPosting[]): UpsertResult {
  const existing = db.prepare('SELECT id, sources FROM jobs WHERE id = ?');
  const insert = db.prepare(`
    INSERT INTO jobs (
      id, title, company, location, province, remote, url, source, sources,
      posted_at, first_seen_at, last_seen_at, salary_raw, salary_min, salary_max,
      salary_currency, type, role_category, matched_by, canada_confidence,
      canada_matched_by, sponsorship, description, status
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);
  const update = db.prepare(`
    UPDATE jobs SET last_seen_at = ?, sources = ?, url = COALESCE(NULLIF(url,''), ?),
      posted_at = COALESCE(posted_at, ?), salary_raw = COALESCE(salary_raw, ?),
      description = COALESCE(description, ?)
    WHERE id = ?
  `);

  let inserted = 0;
  let updated = 0;
  /** The rows that were genuinely new, so callers can announce them. */
  const newJobs: JobPosting[] = [];
  const now = new Date().toISOString();

  db.exec('BEGIN');
  try {
    for (const j of jobs) {
      const row = existing.get(j.id) as { id: string; sources: string } | undefined;
      if (row) {
        let sources: string[] = [];
        try {
          sources = JSON.parse(row.sources) as string[];
        } catch {
          sources = [];
        }
        if (!sources.includes(j.source)) sources.push(j.source);
        update.run(now, JSON.stringify(sources), j.url, j.postedAt, j.salaryRaw, j.description, j.id);
        updated++;
      } else {
        insert.run(
          j.id, j.title, j.company, j.location, j.province, j.remote ? 1 : 0, j.url,
          j.source, JSON.stringify([j.source]), j.postedAt, j.firstSeenAt, now,
          j.salaryRaw, j.salaryMin, j.salaryMax, j.salaryCurrency, j.type,
          j.roleCategory, j.matchedBy, j.canadaConfidence, j.canadaMatchedBy,
          j.sponsorship, j.description, j.status,
        );
        inserted++;
        newJobs.push(j);
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { inserted, updated, newJobs };
}

export function recordRun(
  db: DatabaseSync,
  r: { source: string; ok: boolean; fetched: number; kept: number; inserted: number; updated: number; ms: number; error?: string },
): void {
  db.prepare(`
    INSERT INTO runs (started_at, source, ok, fetched, kept, inserted, updated, ms, error)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).run(new Date().toISOString(), r.source, r.ok ? 1 : 0, r.fetched, r.kept, r.inserted, r.updated, r.ms, r.error ?? null);
}

export function setStatus(db: DatabaseSync, id: string, status: JobStatus): void {
  db.prepare('UPDATE jobs SET status = ? WHERE id = ?').run(status, id);
}
