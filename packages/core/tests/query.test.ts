import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { PRMetadata } from "../src/repository";
import type { FirewatchEntry } from "../src/schema/entry";

const tempRoot = await mkdtemp(join(tmpdir(), "firewatch-query-"));

const { closeFirewatchDb, ensureDirectories, getDatabase, PATHS } =
  await import("../src/cache");
const { queryEntries } = await import("../src/query");
const {
  insertEntries,
  setSyncMeta,
  updatePRState,
  upsertPRs,
  clearRepo,
} = await import("../src/repository");

// Close any existing db connection before setting up test paths
// This is needed because the db singleton might be pointing to a different path
closeFirewatchDb();

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

const repoA = "outfitter-dev/firewatch";
const repoB = "outfitter-dev/other";

const entriesA: FirewatchEntry[] = [
  {
    id: "comment-1",
    repo: repoA,
    pr: 1,
    pr_title: "Fix auth flow",
    pr_state: "open",
    pr_author: "alice",
    pr_branch: "main",
    pr_labels: ["bug", "ui"],
    type: "comment",
    subtype: "issue_comment",
    author: "alice",
    body: "Looks good",
    created_at: "2025-01-02T03:00:00.000Z",
    updated_at: "2025-01-02T03:00:00.000Z",
    captured_at: "2025-01-02T04:00:00.000Z",
    url: "https://github.com/outfitter-dev/firewatch/pull/1",
  },
  {
    id: "review-1",
    repo: repoA,
    pr: 2,
    pr_title: "Add caching",
    pr_state: "draft",
    pr_author: "bob",
    pr_branch: "cache",
    pr_labels: ["infra"],
    type: "review",
    author: "carol",
    state: "approved",
    created_at: "2025-01-02T01:00:00.000Z",
    updated_at: "2025-01-02T01:00:00.000Z",
    captured_at: "2025-01-02T04:00:00.000Z",
    url: "https://github.com/outfitter-dev/firewatch/pull/2",
  },
];

const entriesB: FirewatchEntry[] = [
  {
    id: "commit-1",
    repo: repoB,
    pr: 5,
    pr_title: "Refactor core",
    pr_state: "closed",
    pr_author: "dana",
    pr_branch: "refactor",
    type: "commit",
    author: "dana",
    body: "Refactor modules",
    created_at: "2025-01-01T23:00:00.000Z",
    captured_at: "2025-01-02T04:00:00.000Z",
  },
];

// Set up test data in SQLite
const db = getDatabase();
upsertPRs(db, [
  {
    repo: repoA,
    number: 1,
    state: "open",
    isDraft: false,
    title: "Fix auth flow",
    author: "alice",
    branch: "main",
    labels: ["bug", "ui"],
  },
  {
    repo: repoA,
    number: 2,
    state: "open",
    isDraft: true,
    title: "Add caching",
    author: "bob",
    branch: "cache",
    labels: ["infra"],
  },
  {
    repo: repoB,
    number: 5,
    state: "closed",
    isDraft: false,
    title: "Refactor core",
    author: "dana",
    branch: "refactor",
    labels: [],
  },
]);
insertEntries(db, [...entriesA, ...entriesB]);
setSyncMeta(db, { repo: repoA, last_sync: "2025-01-15T00:00:00Z", pr_count: 2 });
setSyncMeta(db, { repo: repoB, last_sync: "2025-01-15T00:00:00Z", pr_count: 1 });

test("queryEntries filters by repo substring", async () => {
  const results = await queryEntries({ filters: { repo: "firewatch" } });
  expect(results).toHaveLength(2);
  expect(results.every((entry) => entry.repo === repoA)).toBe(true);
});

test("queryEntries filters by id", async () => {
  const results = await queryEntries({ filters: { id: "review-1" } });
  expect(results).toHaveLength(1);
  expect(results[0]?.id).toBe("review-1");
});

test("queryEntries filters by label and state", async () => {
  const results = await queryEntries({
    filters: { label: "BUG", states: ["open"] },
  });
  expect(results).toHaveLength(1);
  expect(results[0]?.id).toBe("comment-1");
});

test("queryEntries filters by author", async () => {
  const results = await queryEntries({
    filters: { author: "carol" },
  });
  expect(results).toHaveLength(1);
  expect(results[0]?.id).toBe("review-1");
});

test("queryEntries applies since filter", async () => {
  const results = await queryEntries({
    filters: { since: new Date("2025-01-02T02:00:00.000Z") },
  });
  expect(results).toHaveLength(1);
  expect(results[0]?.id).toBe("comment-1");
});

test("queryEntries applies limit and offset", async () => {
  const results = await queryEntries({ offset: 1, limit: 1 });
  expect(results).toHaveLength(1);
  expect(results[0]?.id).toBe("review-1");
});

// =============================================================================
// SQLite Path Tests (Issue #37 fix)
// =============================================================================

describe("SQLite query path", () => {
  const sqliteRepo = "sqlite/test-repo";

  function createTestPR(overrides: Partial<PRMetadata> = {}): PRMetadata {
    return {
      repo: sqliteRepo,
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
      id: "sqlite-entry-1",
      repo: sqliteRepo,
      pr: 1,
      pr_title: "Test PR",
      pr_state: "open",
      pr_author: "testuser",
      pr_branch: "feature/test",
      pr_labels: ["bug"],
      type: "comment",
      author: "commenter",
      body: "Test comment",
      created_at: "2025-01-15T00:00:00Z",
      captured_at: "2025-01-15T02:00:00Z",
      ...overrides,
    };
  }

  beforeEach(() => {
    // Clear SQLite data for the test repo
    const db = getDatabase();
    clearRepo(db, sqliteRepo);
  });

  test("uses SQLite when data exists", async () => {
    const db = getDatabase();

    // Set up SQLite data
    upsertPRs(db, [createTestPR({ number: 1, state: "open" })]);
    insertEntries(db, [createTestEntry({ id: "e1", pr: 1 })]);
    setSyncMeta(db, {
      repo: sqliteRepo,
      last_sync: "2025-01-15T00:00:00Z",
      pr_count: 1,
    });

    const results = await queryEntries({ filters: { repo: sqliteRepo } });
    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe("e1");
  });

  test("Issue #37 fix: --open returns only currently open PRs", async () => {
    const db = getDatabase();

    // Set up two PRs: one open, one that will be merged
    upsertPRs(db, [
      createTestPR({ number: 1, state: "open" }),
      createTestPR({ number: 2, state: "open" }),
    ]);

    insertEntries(db, [
      createTestEntry({ id: "e1", pr: 1 }),
      createTestEntry({ id: "e2", pr: 2 }),
    ]);

    setSyncMeta(db, {
      repo: sqliteRepo,
      last_sync: "2025-01-15T00:00:00Z",
      pr_count: 2,
    });

    // Initially both PRs are open
    let results = await queryEntries({
      filters: { repo: sqliteRepo, states: ["open"] },
    });
    expect(results).toHaveLength(2);

    // Merge PR 2 (simulating what happens during sync)
    updatePRState(db, sqliteRepo, 2, "merged");

    // Now --open should only return PR 1
    results = await queryEntries({
      filters: { repo: sqliteRepo, states: ["open"] },
    });
    expect(results).toHaveLength(1);
    expect(results[0]?.pr).toBe(1);
    expect(results[0]?.pr_state).toBe("open");

    // --merged should return PR 2 with updated state
    results = await queryEntries({
      filters: { repo: sqliteRepo, states: ["merged"] },
    });
    expect(results).toHaveLength(1);
    expect(results[0]?.pr).toBe(2);
    expect(results[0]?.pr_state).toBe("merged");
  });

  test("pr_state reflects current PR state, not sync-time state", async () => {
    const db = getDatabase();

    // Create a PR that was initially open
    upsertPRs(db, [createTestPR({ number: 1, state: "open" })]);
    insertEntries(db, [
      createTestEntry({
        id: "e1",
        pr: 1,
        pr_state: "open", // Entry was captured when PR was open
      }),
    ]);
    setSyncMeta(db, {
      repo: sqliteRepo,
      last_sync: "2025-01-15T00:00:00Z",
      pr_count: 1,
    });

    // Verify initial state
    let results = await queryEntries({ filters: { repo: sqliteRepo } });
    expect(results[0]?.pr_state).toBe("open");

    // PR gets merged
    updatePRState(db, sqliteRepo, 1, "merged");

    // Entry should now show merged state (not the stale "open" from sync time)
    results = await queryEntries({ filters: { repo: sqliteRepo } });
    expect(results[0]?.pr_state).toBe("merged");
  });

  test("draft state filtering works correctly", async () => {
    const db = getDatabase();

    upsertPRs(db, [
      createTestPR({ number: 1, state: "open", isDraft: false }),
      createTestPR({ number: 2, state: "open", isDraft: true }),
      createTestPR({ number: 3, state: "closed", isDraft: false }),
    ]);

    insertEntries(db, [
      createTestEntry({ id: "e1", pr: 1 }),
      createTestEntry({ id: "e2", pr: 2 }),
      createTestEntry({ id: "e3", pr: 3 }),
    ]);

    setSyncMeta(db, {
      repo: sqliteRepo,
      last_sync: "2025-01-15T00:00:00Z",
      pr_count: 3,
    });

    // --open should return only non-draft open PRs
    let results = await queryEntries({
      filters: { repo: sqliteRepo, states: ["open"] },
    });
    expect(results).toHaveLength(1);
    expect(results[0]?.pr).toBe(1);

    // --draft should return only draft PRs
    results = await queryEntries({
      filters: { repo: sqliteRepo, states: ["draft"] },
    });
    expect(results).toHaveLength(1);
    expect(results[0]?.pr).toBe(2);
    expect(results[0]?.pr_state).toBe("draft");
  });

  test("combined state filtering", async () => {
    const db = getDatabase();

    upsertPRs(db, [
      createTestPR({ number: 1, state: "open", isDraft: false }),
      createTestPR({ number: 2, state: "open", isDraft: true }),
      createTestPR({ number: 3, state: "merged", isDraft: false }),
      createTestPR({ number: 4, state: "closed", isDraft: false }),
    ]);

    insertEntries(db, [
      createTestEntry({ id: "e1", pr: 1 }),
      createTestEntry({ id: "e2", pr: 2 }),
      createTestEntry({ id: "e3", pr: 3 }),
      createTestEntry({ id: "e4", pr: 4 }),
    ]);

    setSyncMeta(db, {
      repo: sqliteRepo,
      last_sync: "2025-01-15T00:00:00Z",
      pr_count: 4,
    });

    // --open --draft should return both
    const results = await queryEntries({
      filters: { repo: sqliteRepo, states: ["open", "draft"] },
    });
    expect(results).toHaveLength(2);
    const prs = results.map((r) => r.pr).toSorted();
    expect(prs).toEqual([1, 2]);
  });
});
