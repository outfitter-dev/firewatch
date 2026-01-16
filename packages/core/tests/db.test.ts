import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  closeDatabase,
  CURRENT_SCHEMA_VERSION,
  getSchemaVersion,
  initSchema,
  migrateSchema,
  openDatabase,
} from "../src/db";

const tempRoot = await mkdtemp(join(tmpdir(), "firewatch-db-"));

afterAll(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

test("openDatabase creates a working database with WAL mode", () => {
  const dbPath = join(tempRoot, "test-wal.db");
  const db = openDatabase(dbPath);

  // Verify WAL mode is enabled
  const journalMode = db
    .query<{ journal_mode: string }, []>("PRAGMA journal_mode")
    .get();
  expect(journalMode?.journal_mode).toBe("wal");

  closeDatabase(db);
});

test("openDatabase creates in-memory database when path is omitted", () => {
  const db = openDatabase();

  // Verify database is functional
  db.exec("CREATE TABLE test_table (id INTEGER PRIMARY KEY)");
  db.exec("INSERT INTO test_table (id) VALUES (1)");
  const result = db
    .query<{ id: number }, []>("SELECT id FROM test_table")
    .get();
  expect(result?.id).toBe(1);

  closeDatabase(db);
});

test("schema is initialized with correct tables", () => {
  const db = openDatabase();

  // Check that required tables exist
  const tables = db
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
    )
    .all();
  const tableNames = tables.map((t) => t.name);

  expect(tableNames).toContain("prs");
  expect(tableNames).toContain("entries");
  expect(tableNames).toContain("sync_meta");

  closeDatabase(db);
});

test("schema has correct indexes", () => {
  const db = openDatabase();

  const indexes = db
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%' ORDER BY name"
    )
    .all();
  const indexNames = indexes.map((i) => i.name);

  expect(indexNames).toContain("idx_entries_repo_pr");
  expect(indexNames).toContain("idx_entries_type");
  expect(indexNames).toContain("idx_entries_created");
  expect(indexNames).toContain("idx_entries_author");
  expect(indexNames).toContain("idx_prs_state");
  expect(indexNames).toContain("idx_prs_author");

  closeDatabase(db);
});

test("getSchemaVersion returns current version after init", () => {
  const db = openDatabase();

  const version = getSchemaVersion(db);
  expect(version).toBe(CURRENT_SCHEMA_VERSION);

  closeDatabase(db);
});

test("initSchema is idempotent", () => {
  const db = openDatabase();

  // Call initSchema multiple times
  initSchema(db);
  initSchema(db);
  initSchema(db);

  // Should still work with correct version
  const version = getSchemaVersion(db);
  expect(version).toBe(CURRENT_SCHEMA_VERSION);

  closeDatabase(db);
});

test("migrateSchema handles already-migrated database", () => {
  const db = openDatabase();

  // Migrate to current version (should be no-op)
  migrateSchema(db, CURRENT_SCHEMA_VERSION);

  const version = getSchemaVersion(db);
  expect(version).toBe(CURRENT_SCHEMA_VERSION);

  closeDatabase(db);
});

test("prs table has correct schema", () => {
  const db = openDatabase();

  // Insert a PR
  const insertPr = db.prepare(`
    INSERT INTO prs (repo, number, node_id, state, is_draft, title, author, branch, labels, updated_at)
    VALUES ($repo, $number, $node_id, $state, $is_draft, $title, $author, $branch, $labels, $updated_at)
  `);

  insertPr.run({
    $repo: "owner/repo",
    $number: 1,
    $node_id: "PR_123",
    $state: "open",
    $is_draft: 0,
    $title: "Test PR",
    $author: "testuser",
    $branch: "feature/test",
    $labels: '["bug", "enhancement"]',
    $updated_at: "2025-01-15T00:00:00Z",
  });

  // Verify retrieval
  const pr = db
    .query<
      {
        repo: string;
        number: number;
        state: string;
        title: string;
      },
      []
    >("SELECT repo, number, state, title FROM prs WHERE number = 1")
    .get();

  expect(pr?.repo).toBe("owner/repo");
  expect(pr?.number).toBe(1);
  expect(pr?.state).toBe("open");
  expect(pr?.title).toBe("Test PR");

  closeDatabase(db);
});

test("entries table has correct schema and foreign key", () => {
  const db = openDatabase();

  // First insert a PR (required for foreign key)
  db.prepare(`
    INSERT INTO prs (repo, number, state, is_draft)
    VALUES ($repo, $number, $state, $is_draft)
  `).run({
    $repo: "owner/repo",
    $number: 1,
    $state: "open",
    $is_draft: 0,
  });

  // Insert an entry
  const insertEntry = db.prepare(`
    INSERT INTO entries (id, repo, pr, type, subtype, author, body, created_at, captured_at, url)
    VALUES ($id, $repo, $pr, $type, $subtype, $author, $body, $created_at, $captured_at, $url)
  `);

  insertEntry.run({
    $id: "comment-123",
    $repo: "owner/repo",
    $pr: 1,
    $type: "comment",
    $subtype: "issue_comment",
    $author: "testuser",
    $body: "LGTM",
    $created_at: "2025-01-15T00:00:00Z",
    $captured_at: "2025-01-15T01:00:00Z",
    $url: "https://github.com/owner/repo/pull/1#issuecomment-123",
  });

  // Verify retrieval
  const entry = db
    .query<
      {
        id: string;
        type: string;
        body: string;
      },
      []
    >("SELECT id, type, body FROM entries WHERE id = 'comment-123'")
    .get();

  expect(entry?.id).toBe("comment-123");
  expect(entry?.type).toBe("comment");
  expect(entry?.body).toBe("LGTM");

  closeDatabase(db);
});

test("sync_meta table has correct schema", () => {
  const db = openDatabase();

  // Insert sync metadata
  db.prepare(`
    INSERT INTO sync_meta (repo, cursor, last_sync, pr_count)
    VALUES ($repo, $cursor, $last_sync, $pr_count)
  `).run({
    $repo: "owner/repo",
    $cursor: "Y3Vyc29yOjEyMw==",
    $last_sync: "2025-01-15T00:00:00Z",
    $pr_count: 42,
  });

  // Verify retrieval
  const meta = db
    .query<
      {
        repo: string;
        cursor: string;
        pr_count: number;
      },
      []
    >("SELECT repo, cursor, pr_count FROM sync_meta WHERE repo = 'owner/repo'")
    .get();

  expect(meta?.repo).toBe("owner/repo");
  expect(meta?.cursor).toBe("Y3Vyc29yOjEyMw==");
  expect(meta?.pr_count).toBe(42);

  closeDatabase(db);
});
