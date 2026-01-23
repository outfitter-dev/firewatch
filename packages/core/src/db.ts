/**
 * Database foundation for Firewatch.
 *
 * Provides SQLite database management using Bun's native sqlite driver.
 * Uses WAL mode for better concurrent performance and schema versioning
 * for future migrations.
 */
import { Database } from "bun:sqlite";

/**
 * Current schema version.
 * Increment this when making schema changes and add migration logic.
 */
export const CURRENT_SCHEMA_VERSION = 4;

/**
 * Opens a SQLite database with optimal settings for Firewatch.
 *
 * @param path - Path to the database file. If omitted, creates an in-memory database.
 * @returns Configured Database instance
 */
export function openDatabase(path?: string): Database {
  const db = new Database(path ?? ":memory:", { create: true });

  // Enable WAL mode for better concurrent read/write performance
  db.exec("PRAGMA journal_mode = WAL");

  // Set busy timeout to handle concurrent access gracefully
  db.exec("PRAGMA busy_timeout = 5000");

  // Enable foreign key enforcement
  db.exec("PRAGMA foreign_keys = ON");

  // Initialize schema if needed
  initSchema(db);

  return db;
}

/**
 * Closes a database connection gracefully.
 *
 * @param db - Database instance to close
 */
export function closeDatabase(db: Database): void {
  db.close();
}

/**
 * Gets the current schema version from the database.
 *
 * @param db - Database instance
 * @returns Current schema version (0 if not initialized)
 */
export function getSchemaVersion(db: Database): number {
  const result = db
    .query<{ user_version: number }, []>("PRAGMA user_version")
    .get();
  return result?.user_version ?? 0;
}

/**
 * Sets the schema version in the database.
 *
 * @param db - Database instance
 * @param version - Version number to set
 */
function setSchemaVersion(db: Database, version: number): void {
  db.exec(`PRAGMA user_version = ${version}`);
}

/**
 * SQL statements for creating the schema.
 * Separated for clarity and potential reuse in migrations.
 */
const SCHEMA_SQL = `
-- Mutable PR metadata (updated on each sync)
CREATE TABLE IF NOT EXISTS prs (
  repo TEXT NOT NULL,
  number INTEGER NOT NULL,
  node_id TEXT,
  state TEXT NOT NULL,
  is_draft INTEGER NOT NULL DEFAULT 0,
  title TEXT,
  author TEXT,
  branch TEXT,
  labels TEXT,
  updated_at TEXT,
  frozen_at TEXT,
  PRIMARY KEY (repo, number)
);

-- Immutable activity log
-- Uses composite key (id, repo) to avoid potential ID collisions across repos
CREATE TABLE IF NOT EXISTS entries (
  id TEXT NOT NULL,
  repo TEXT NOT NULL,
  pr INTEGER NOT NULL,
  type TEXT NOT NULL,
  subtype TEXT,
  author TEXT,
  body TEXT,
  state TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  captured_at TEXT NOT NULL,
  url TEXT,
  file TEXT,
  line INTEGER,
  thread_resolved INTEGER,
  graphite_json TEXT,
  file_activity_json TEXT,
  file_provenance_json TEXT,
  reactions_json TEXT,
  PRIMARY KEY (id, repo),
  FOREIGN KEY (repo, pr) REFERENCES prs(repo, number)
);

-- Sync state (replaces meta.jsonl)
CREATE TABLE IF NOT EXISTS sync_meta (
  repo TEXT PRIMARY KEY,
  cursor TEXT,
  last_sync TEXT NOT NULL,
  pr_count INTEGER NOT NULL DEFAULT 0
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_entries_repo_pr ON entries(repo, pr);
CREATE INDEX IF NOT EXISTS idx_entries_type ON entries(type);
CREATE INDEX IF NOT EXISTS idx_entries_created ON entries(created_at);
CREATE INDEX IF NOT EXISTS idx_entries_author ON entries(author);
CREATE INDEX IF NOT EXISTS idx_entries_thread_resolved ON entries(thread_resolved);
CREATE INDEX IF NOT EXISTS idx_prs_state ON prs(repo, state);
CREATE INDEX IF NOT EXISTS idx_prs_author ON prs(repo, author);
`;

/**
 * Initializes the database schema if not already present.
 * Uses IF NOT EXISTS to be idempotent.
 *
 * @param db - Database instance
 */
export function initSchema(db: Database): void {
  const currentVersion = getSchemaVersion(db);

  if (currentVersion === 0) {
    // Fresh database - create schema
    db.exec(SCHEMA_SQL);
    setSchemaVersion(db, CURRENT_SCHEMA_VERSION);
  } else if (currentVersion < CURRENT_SCHEMA_VERSION) {
    // Existing database needs migration
    migrateSchema(db, CURRENT_SCHEMA_VERSION);
  }
  // If currentVersion >= CURRENT_SCHEMA_VERSION, schema is up to date
}

/**
 * Migrates the database schema from current version to target version.
 * Each version increment should have its own migration logic.
 *
 * @param db - Database instance
 * @param targetVersion - Target schema version
 */
export function migrateSchema(db: Database, targetVersion: number): void {
  const currentVersion = getSchemaVersion(db);

  if (currentVersion >= targetVersion) {
    return; // Already at or past target version
  }

  // Run migrations in a transaction for atomicity
  db.transaction(() => {
    let version = currentVersion;

    // For version 0 -> 1, we just create the schema
    if (version === 0 && targetVersion >= 1) {
      db.exec(SCHEMA_SQL);
      version = 1;
    }

    // Migration 1 -> 2: Add thread_resolved column for orphaned comment tracking
    if (version === 1 && targetVersion >= 2) {
      db.exec("ALTER TABLE entries ADD COLUMN thread_resolved INTEGER");
      db.exec(
        "CREATE INDEX IF NOT EXISTS idx_entries_thread_resolved ON entries(thread_resolved)"
      );
      version = 2;
    }

    // Migration 2 -> 3: Add reactions_json column for comment reactions
    if (version === 2 && targetVersion >= 3) {
      db.exec("ALTER TABLE entries ADD COLUMN reactions_json TEXT");
      version = 3;
    }

    // Migration 3 -> 4: Add frozen_at column for PR freeze feature
    if (version === 3 && targetVersion >= 4) {
      db.exec("ALTER TABLE prs ADD COLUMN frozen_at TEXT");
      version = 4;
    }

    setSchemaVersion(db, version);
  })();
}
