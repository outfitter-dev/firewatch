import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { silentLogger } from "@outfitter/firewatch-shared";
import { closeDatabase, openDatabase } from "../../src/db";
import { getCacheStats, statusHandler } from "../../src/handlers/status";
import type { HandlerContext } from "../../src/handlers/types";
import {
  insertEntries,
  setSyncMeta,
  upsertPR,
  type PRMetadata,
} from "../../src/repository";
import type { FirewatchEntry } from "../../src/schema/entry";

// =============================================================================
// Test Fixtures
// =============================================================================

function createTestPR(overrides: Partial<PRMetadata> = {}): PRMetadata {
  return {
    repo: "owner/repo",
    number: 1,
    state: "open",
    isDraft: false,
    title: "Test PR",
    author: "testuser",
    branch: "feature/test",
    labels: ["bug"],
    updatedAt: "2025-01-15T00:00:00Z",
    ...overrides,
  };
}

function createTestEntry(
  overrides: Partial<FirewatchEntry> = {}
): FirewatchEntry {
  return {
    id: "entry-1",
    repo: "owner/repo",
    pr: 1,
    pr_title: "Test PR",
    pr_state: "open",
    pr_author: "testuser",
    pr_branch: "feature/test",
    pr_labels: ["bug"],
    type: "comment",
    subtype: "issue_comment",
    author: "commenter",
    body: "LGTM",
    created_at: "2025-01-15T12:00:00Z",
    updated_at: "2025-01-15T12:00:00Z",
    captured_at: "2025-01-15T12:00:00Z",
    url: "https://github.com/owner/repo/pull/1#issuecomment-123",
    ...overrides,
  };
}

function createTestContext(db: Database): HandlerContext {
  return {
    config: { repos: [], max_prs_per_sync: 100 },
    db,
    logger: silentLogger,
  };
}

// =============================================================================
// getCacheStats
// =============================================================================

describe("getCacheStats", () => {
  let db: Database;

  beforeEach(() => {
    db = openDatabase(":memory:");
  });

  afterEach(() => {
    closeDatabase(db);
  });

  test("returns zeros for empty database", () => {
    const stats = getCacheStats(db);

    expect(stats.repos).toBe(0);
    expect(stats.entries).toBe(0);
    expect(stats.last_sync).toBeUndefined();
  });

  test("counts repos and entries", () => {
    upsertPR(db, createTestPR({ repo: "owner/repo", number: 1 }));
    upsertPR(db, createTestPR({ repo: "owner/other", number: 2 }));
    insertEntries(db, [
      createTestEntry({ id: "e1", repo: "owner/repo", pr: 1 }),
      createTestEntry({ id: "e2", repo: "owner/repo", pr: 1 }),
      createTestEntry({ id: "e3", repo: "owner/other", pr: 2 }),
    ]);

    const stats = getCacheStats(db);

    expect(stats.repos).toBe(2);
    expect(stats.entries).toBe(3);
  });

  test("finds most recent sync time across repos", () => {
    setSyncMeta(db, {
      repo: "owner/repo",
      scope: "open",
      last_sync: "2025-01-10T00:00:00Z",
      pr_count: 1,
    });
    setSyncMeta(db, {
      repo: "owner/other",
      scope: "open",
      last_sync: "2025-01-15T00:00:00Z",
      pr_count: 1,
    });

    const stats = getCacheStats(db);

    expect(stats.last_sync).toBe("2025-01-15T00:00:00Z");
  });

  test("returns undefined last_sync when no sync metadata exists", () => {
    const stats = getCacheStats(db);

    expect(stats.last_sync).toBeUndefined();
  });
});

// =============================================================================
// statusHandler
// =============================================================================

describe("statusHandler", () => {
  let db: Database;

  beforeEach(() => {
    db = openDatabase(":memory:");
  });

  afterEach(() => {
    closeDatabase(db);
  });

  test("returns Result.ok with StatusOutput structure", async () => {
    const ctx = createTestContext(db);

    const result = await statusHandler({ version: "1.0.0-test" }, ctx);

    expect(result.isOk()).toBe(true);

    const output = result.unwrap();
    expect(output.version).toBe("1.0.0-test");
    expect(output.auth).toBeDefined();
    expect(output.auth.ok).toEqual(expect.any(Boolean));
    expect(output.auth.source).toEqual(expect.any(String));
    expect(output.config).toBeDefined();
    expect(output.config.user).toBeDefined();
    expect(output.repo).toBeDefined();
    expect(output.graphite).toBeDefined();
    expect(output.cache).toBeDefined();
    expect(output.cache.repos).toBe(0);
    expect(output.cache.entries).toBe(0);
  });

  test("does not throw when auth state varies", async () => {
    const ctx = createTestContext(db);

    const result = await statusHandler({ version: "1.0.0-test" }, ctx);

    // Auth may or may not succeed depending on environment (gh cli, env vars)
    // The important thing is the handler doesn't throw
    expect(result.isOk()).toBe(true);
  });

  test("populates cache stats from database", async () => {
    // Seed the database
    upsertPR(db, createTestPR({ repo: "owner/repo", number: 1 }));
    insertEntries(db, [
      createTestEntry({ id: "e1", repo: "owner/repo", pr: 1 }),
    ]);
    setSyncMeta(db, {
      repo: "owner/repo",
      scope: "open",
      last_sync: "2025-01-15T00:00:00Z",
      pr_count: 1,
    });

    const ctx = createTestContext(db);

    const result = await statusHandler({ version: "1.0.0-test" }, ctx);

    expect(result.isOk()).toBe(true);

    const output = result.unwrap();
    expect(output.cache.repos).toBe(1);
    expect(output.cache.entries).toBe(1);
    expect(output.cache.last_sync).toBe("2025-01-15T00:00:00Z");
  });
});
