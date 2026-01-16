import type { Database } from "bun:sqlite";
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeDatabase, openDatabase } from "../src/db";
import {
  getEntry,
  insertEntries,
  queryEntries,
  upsertPR,
  type PRMetadata,
} from "../src/repository";
import type { FirewatchEntry } from "../src/schema/entry";

const tempRoot = await mkdtemp(join(tmpdir(), "firewatch-check-"));

const { closeFirewatchDb, ensureDirectories, getDatabase, PATHS } =
  await import("../src/cache");
const { checkRepo, checkRepoDb } = await import("../src/check");

const originalPaths = { ...PATHS };

afterAll(async () => {
  closeFirewatchDb();
  Object.assign(PATHS as Record<string, string>, originalPaths);
  await rm(tempRoot, { recursive: true, force: true });
});

Object.assign(PATHS as Record<string, string>, {
  cache: join(tempRoot, "cache"),
  config: join(tempRoot, "config"),
  data: join(tempRoot, "data"),
  repos: join(tempRoot, "cache", "repos"),
  meta: join(tempRoot, "cache", "meta.jsonl"),
  db: join(tempRoot, "cache", "firewatch.db"),
  configFile: join(tempRoot, "config", "config.toml"),
});

await ensureDirectories();

function createTestPRForLegacy(
  overrides: Partial<PRMetadata> = {}
): PRMetadata {
  return {
    repo: "outfitter-dev/firewatch",
    number: 42,
    state: "open",
    isDraft: false,
    title: "Add check",
    author: "alice",
    branch: "feat/check",
    labels: [],
    ...overrides,
  };
}

test("checkRepo updates file_activity_after for comments", async () => {
  const repo = "outfitter-dev/firewatch";
  const db = getDatabase();
  const entries: FirewatchEntry[] = [
    {
      id: "comment-1",
      repo,
      pr: 42,
      pr_title: "Add check",
      pr_state: "open",
      pr_author: "alice",
      pr_branch: "feat/check",
      type: "comment",
      subtype: "review_comment",
      author: "bob",
      body: "Needs work",
      created_at: "2025-01-01T00:00:00.000Z",
      captured_at: "2025-01-02T00:00:00.000Z",
    },
    {
      id: "commit-1",
      repo,
      pr: 42,
      pr_title: "Add check",
      pr_state: "open",
      pr_author: "alice",
      pr_branch: "feat/check",
      type: "commit",
      author: "alice",
      body: "Fix comment",
      created_at: "2025-01-02T12:00:00.000Z",
      captured_at: "2025-01-02T12:01:00.000Z",
    },
    {
      id: "comment-2",
      repo,
      pr: 42,
      pr_title: "Add check",
      pr_state: "open",
      pr_author: "alice",
      pr_branch: "feat/check",
      type: "comment",
      subtype: "review_comment",
      author: "bob",
      body: "Another note",
      created_at: "2025-01-03T00:00:00.000Z",
      captured_at: "2025-01-03T00:01:00.000Z",
    },
  ];

  upsertPR(db, createTestPRForLegacy());
  insertEntries(db, entries);

  const result = await checkRepo(repo);
  expect(result.comments_checked).toBe(2);
  expect(result.entries_updated).toBe(2);

  const firstComment = getEntry(db, "comment-1", repo);
  const secondComment = getEntry(db, "comment-2", repo);

  expect(firstComment?.file_activity_after?.modified).toBe(true);
  expect(firstComment?.file_activity_after?.commits_touching_file).toBe(1);
  expect(firstComment?.file_activity_after?.latest_commit).toBe("commit-1");
  expect(firstComment?.file_activity_after?.latest_commit_at).toBe(
    "2025-01-02T12:00:00.000Z"
  );

  expect(secondComment?.file_activity_after?.modified).toBe(false);
  expect(secondComment?.file_activity_after?.commits_touching_file).toBe(0);
});

test("checkRepo uses file matches when commit files are available", async () => {
  const repo = "outfitter-dev/firewatch-file-matches";
  const db = getDatabase();
  const entries: FirewatchEntry[] = [
    {
      id: "comment-file-1",
      repo,
      pr: 99,
      pr_title: "Add provenance",
      pr_state: "open",
      pr_author: "alice",
      pr_branch: "feat/provenance",
      type: "comment",
      subtype: "review_comment",
      author: "bob",
      body: "Touch file",
      file: "src/target.ts",
      created_at: "2025-01-01T00:00:00.000Z",
      captured_at: "2025-01-02T00:00:00.000Z",
    },
    {
      id: "commit-file-1",
      repo,
      pr: 99,
      pr_title: "Add provenance",
      pr_state: "open",
      pr_author: "alice",
      pr_branch: "feat/provenance",
      type: "commit",
      author: "alice",
      body: "Other file",
      created_at: "2025-01-02T12:00:00.000Z",
      captured_at: "2025-01-02T12:01:00.000Z",
    },
    {
      id: "commit-file-2",
      repo,
      pr: 99,
      pr_title: "Add provenance",
      pr_state: "open",
      pr_author: "alice",
      pr_branch: "feat/provenance",
      type: "commit",
      author: "alice",
      body: "Target file",
      created_at: "2025-01-03T12:00:00.000Z",
      captured_at: "2025-01-03T12:01:00.000Z",
    },
  ];

  upsertPR(db, createTestPRForLegacy({ repo, number: 99 }));
  insertEntries(db, entries);

  const filesByCommit = new Map<string, string[]>([
    ["commit-file-1", ["src/other.ts"]],
    ["commit-file-2", ["src/target.ts"]],
  ]);
  const result = await checkRepo(repo, {
    resolveCommitFiles: (commitId: string) =>
      Promise.resolve(filesByCommit.get(commitId) as string[]),
  });

  expect(result.comments_checked).toBe(1);

  const comment = getEntry(db, "comment-file-1", repo);
  expect(comment?.file_activity_after?.modified).toBe(true);
  expect(comment?.file_activity_after?.commits_touching_file).toBe(1);
  expect(comment?.file_activity_after?.latest_commit).toBe("commit-file-2");
});

test("checkRepo falls back to all commits when file lists are partial", async () => {
  const repo = "outfitter-dev/firewatch-partial";
  const db = getDatabase();
  const entries: FirewatchEntry[] = [
    {
      id: "comment-partial-1",
      repo,
      pr: 101,
      pr_title: "Add provenance",
      pr_state: "open",
      pr_author: "alice",
      pr_branch: "feat/provenance",
      type: "comment",
      subtype: "review_comment",
      author: "bob",
      body: "Touch file",
      file: "src/target.ts",
      created_at: "2025-01-01T00:00:00.000Z",
      captured_at: "2025-01-02T00:00:00.000Z",
    },
    {
      id: "commit-partial-1",
      repo,
      pr: 101,
      pr_title: "Add provenance",
      pr_state: "open",
      pr_author: "alice",
      pr_branch: "feat/provenance",
      type: "commit",
      author: "alice",
      body: "Other file",
      created_at: "2025-01-02T12:00:00.000Z",
      captured_at: "2025-01-02T12:01:00.000Z",
    },
    {
      id: "commit-partial-2",
      repo,
      pr: 101,
      pr_title: "Add provenance",
      pr_state: "open",
      pr_author: "alice",
      pr_branch: "feat/provenance",
      type: "commit",
      author: "alice",
      body: "Unknown files",
      created_at: "2025-01-03T12:00:00.000Z",
      captured_at: "2025-01-03T12:01:00.000Z",
    },
  ];

  upsertPR(db, createTestPRForLegacy({ repo, number: 101 }));
  insertEntries(db, entries);

  const filesByCommit = new Map<string, string[] | null>([
    ["commit-partial-1", ["src/other.ts"]],
    ["commit-partial-2", null],
  ]);
  await checkRepo(repo, {
    resolveCommitFiles: (commitId: string) =>
      Promise.resolve(filesByCommit.get(commitId) as string[] | null),
  });

  const comment = getEntry(db, "comment-partial-1", repo);
  expect(comment?.file_activity_after?.modified).toBe(true);
  // When file data is partial (commit-2 returns null), falls back to counting all commits
  expect(comment?.file_activity_after?.commits_touching_file).toBe(2);
  expect(comment?.file_activity_after?.latest_commit).toBe("commit-partial-2");
});

// =============================================================================
// SQLite-based Check Tests (checkRepoDb)
// =============================================================================

function createTestPR(overrides: Partial<PRMetadata> = {}): PRMetadata {
  return {
    repo: "outfitter-dev/firewatch",
    number: 42,
    state: "open",
    isDraft: false,
    title: "Add check",
    author: "alice",
    branch: "feat/check",
    labels: [],
    ...overrides,
  };
}

function createTestEntry(
  overrides: Partial<FirewatchEntry> = {}
): FirewatchEntry {
  return {
    id: "entry-1",
    repo: "outfitter-dev/firewatch",
    pr: 42,
    pr_title: "Add check",
    pr_state: "open",
    pr_author: "alice",
    pr_branch: "feat/check",
    type: "comment",
    subtype: "review_comment",
    author: "bob",
    body: "Needs work",
    created_at: "2025-01-01T00:00:00.000Z",
    captured_at: "2025-01-02T00:00:00.000Z",
    ...overrides,
  };
}

/**
 * Helper to create a file resolver from a Map.
 * Extracted outside tests to avoid linter warnings about conditionals in tests.
 */
function createFileResolver(
  filesByCommit: Map<string, string[]>
): (commitId: string) => Promise<string[] | null> {
  return (commitId: string) => {
    const files = filesByCommit.get(commitId);
    return Promise.resolve(files === undefined ? null : files);
  };
}

describe("checkRepoDb - SQLite-based check", () => {
  let db: Database;

  beforeEach(() => {
    db = openDatabase();
  });

  test("checkRepoDb updates file_activity_after for comments in SQLite", async () => {
    // Setup: Insert PR and entries into SQLite
    upsertPR(db, createTestPR());
    insertEntries(db, [
      createTestEntry({
        id: "comment-1",
        type: "comment",
        created_at: "2025-01-01T00:00:00.000Z",
      }),
      createTestEntry({
        id: "commit-1",
        type: "commit",
        author: "alice",
        body: "Fix comment",
        created_at: "2025-01-02T12:00:00.000Z",
      }),
      createTestEntry({
        id: "comment-2",
        type: "comment",
        body: "Another note",
        created_at: "2025-01-03T00:00:00.000Z",
      }),
    ]);

    // Execute check
    const result = await checkRepoDb(db, "outfitter-dev/firewatch");

    // Verify result counts
    expect(result.comments_checked).toBe(2);
    expect(result.entries_updated).toBe(2);

    // Verify entries are updated in SQLite
    const firstComment = getEntry(db, "comment-1", "outfitter-dev/firewatch");
    const secondComment = getEntry(db, "comment-2", "outfitter-dev/firewatch");

    expect(firstComment?.file_activity_after?.modified).toBe(true);
    expect(firstComment?.file_activity_after?.commits_touching_file).toBe(1);
    expect(firstComment?.file_activity_after?.latest_commit).toBe("commit-1");
    expect(firstComment?.file_activity_after?.latest_commit_at).toBe(
      "2025-01-02T12:00:00.000Z"
    );

    // Comment after the commit should show no modifications
    expect(secondComment?.file_activity_after?.modified).toBe(false);
    expect(secondComment?.file_activity_after?.commits_touching_file).toBe(0);

    closeDatabase(db);
  });

  test("checkRepoDb uses file matches when commit files are available", async () => {
    upsertPR(db, createTestPR({ number: 99 }));
    insertEntries(db, [
      createTestEntry({
        id: "comment-1",
        pr: 99,
        file: "src/target.ts",
        created_at: "2025-01-01T00:00:00.000Z",
      }),
      createTestEntry({
        id: "commit-1",
        pr: 99,
        type: "commit",
        body: "Other file",
        created_at: "2025-01-02T12:00:00.000Z",
      }),
      createTestEntry({
        id: "commit-2",
        pr: 99,
        type: "commit",
        body: "Target file",
        created_at: "2025-01-03T12:00:00.000Z",
      }),
    ]);

    const filesByCommit = new Map<string, string[]>([
      ["commit-1", ["src/other.ts"]],
      ["commit-2", ["src/target.ts"]],
    ]);

    const result = await checkRepoDb(db, "outfitter-dev/firewatch", {
      resolveCommitFiles: createFileResolver(filesByCommit),
    });

    expect(result.comments_checked).toBe(1);

    const comment = getEntry(db, "comment-1", "outfitter-dev/firewatch");
    expect(comment?.file_activity_after?.modified).toBe(true);
    // Only commit-2 touches the target file
    expect(comment?.file_activity_after?.commits_touching_file).toBe(1);
    expect(comment?.file_activity_after?.latest_commit).toBe("commit-2");

    closeDatabase(db);
  });

  test("checkRepoDb returns empty result when no entries", async () => {
    const result = await checkRepoDb(db, "nonexistent/repo");

    expect(result.repo).toBe("nonexistent/repo");
    expect(result.comments_checked).toBe(0);
    expect(result.entries_updated).toBe(0);

    closeDatabase(db);
  });

  test("checkRepoDb skips already up-to-date entries", async () => {
    upsertPR(db, createTestPR());
    insertEntries(db, [
      createTestEntry({
        id: "comment-1",
        type: "comment",
        created_at: "2025-01-01T00:00:00.000Z",
        // Already has correct file_activity_after
        file_activity_after: {
          modified: false,
          commits_touching_file: 0,
        },
      }),
    ]);

    const result = await checkRepoDb(db, "outfitter-dev/firewatch");

    expect(result.comments_checked).toBe(1);
    // No updates needed since data is already correct
    expect(result.entries_updated).toBe(0);

    closeDatabase(db);
  });

  test("checkRepoDb reflects current PR state from database", () => {
    // Create PR as open
    upsertPR(db, createTestPR({ state: "open" }));
    insertEntries(db, [createTestEntry({ id: "comment-1", type: "comment" })]);

    // Verify initial state
    let entries = queryEntries(db, { repo: "outfitter-dev/firewatch" });
    expect(entries[0]?.pr_state).toBe("open");

    // Update PR state to merged (simulating what sync would do)
    upsertPR(db, createTestPR({ state: "merged" }));

    // Verify entries now reflect merged state
    entries = queryEntries(db, { repo: "outfitter-dev/firewatch" });
    expect(entries[0]?.pr_state).toBe("merged");

    closeDatabase(db);
  });
});
