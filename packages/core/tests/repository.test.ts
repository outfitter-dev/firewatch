import type { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";

import { closeDatabase, openDatabase } from "../src/db";
import {
  clearRepo,
  countEntries,
  deleteEntriesByRepo,
  deletePR,
  deleteSyncMeta,
  getAllSyncMeta,
  getEntry,
  getPR,
  getPRsByState,
  getRepos,
  getSyncMeta,
  insertEntries,
  insertEntry,
  queryEntries,
  setSyncMeta,
  updateEntry,
  updatePRState,
  upsertPR,
  upsertPRs,
  type EntryUpdates,
  type PRMetadata,
} from "../src/repository";
import type { FirewatchEntry, SyncMetadata } from "../src/schema/entry";

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
    labels: ["bug", "enhancement"],
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
    pr_labels: ["bug", "enhancement"],
    type: "comment",
    subtype: "issue_comment",
    author: "commenter",
    body: "LGTM",
    created_at: "2025-01-15T00:00:00Z",
    updated_at: "2025-01-15T01:00:00Z",
    captured_at: "2025-01-15T02:00:00Z",
    url: "https://github.com/owner/repo/pull/1#issuecomment-123",
    ...overrides,
  };
}

// =============================================================================
// PR Metadata Tests
// =============================================================================

describe("PR Metadata Operations", () => {
  let db: Database;

  beforeEach(() => {
    db = openDatabase();
  });

  test("upsertPR inserts a new PR", () => {
    const pr = createTestPR();
    upsertPR(db, pr);

    const retrieved = getPR(db, pr.repo, pr.number);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.repo).toBe(pr.repo);
    expect(retrieved?.number).toBe(pr.number);
    expect(retrieved?.state).toBe(pr.state);
    expect(retrieved?.isDraft).toBe(pr.isDraft);
    expect(retrieved?.title).toBe(pr.title);
    expect(retrieved?.author).toBe(pr.author);
    expect(retrieved?.branch).toBe(pr.branch);
    expect(retrieved?.labels).toEqual(pr.labels);
    expect(retrieved?.updatedAt).toBe(pr.updatedAt);

    closeDatabase(db);
  });

  test("upsertPR updates an existing PR", () => {
    const pr = createTestPR();
    upsertPR(db, pr);

    // Update the PR
    const updatedPR: PRMetadata = {
      ...pr,
      state: "merged",
      title: "Updated Title",
      labels: ["merged"],
    };
    upsertPR(db, updatedPR);

    const retrieved = getPR(db, pr.repo, pr.number);
    expect(retrieved?.state).toBe("merged");
    expect(retrieved?.title).toBe("Updated Title");
    expect(retrieved?.labels).toEqual(["merged"]);

    closeDatabase(db);
  });

  test("upsertPRs inserts multiple PRs in transaction", () => {
    const prs = [
      createTestPR({ number: 1 }),
      createTestPR({ number: 2, title: "Second PR" }),
      createTestPR({ number: 3, title: "Third PR", state: "closed" }),
    ];

    upsertPRs(db, prs);

    const pr1 = getPR(db, "owner/repo", 1);
    const pr2 = getPR(db, "owner/repo", 2);
    const pr3 = getPR(db, "owner/repo", 3);

    expect(pr1?.number).toBe(1);
    expect(pr2?.title).toBe("Second PR");
    expect(pr3?.state).toBe("closed");

    closeDatabase(db);
  });

  test("getPRsByState filters by open state", () => {
    upsertPRs(db, [
      createTestPR({ number: 1, state: "open", isDraft: false }),
      createTestPR({ number: 2, state: "open", isDraft: true }),
      createTestPR({ number: 3, state: "closed" }),
      createTestPR({ number: 4, state: "merged" }),
    ]);

    const openPRs = getPRsByState(db, "owner/repo", ["open"]);
    expect(openPRs).toHaveLength(1);
    expect(openPRs[0]?.number).toBe(1);

    closeDatabase(db);
  });

  test("getPRsByState filters by draft state", () => {
    upsertPRs(db, [
      createTestPR({ number: 1, state: "open", isDraft: false }),
      createTestPR({ number: 2, state: "open", isDraft: true }),
      createTestPR({ number: 3, state: "closed" }),
    ]);

    const draftPRs = getPRsByState(db, "owner/repo", ["draft"]);
    expect(draftPRs).toHaveLength(1);
    expect(draftPRs[0]?.number).toBe(2);
    expect(draftPRs[0]?.isDraft).toBe(true);

    closeDatabase(db);
  });

  test("getPRsByState filters by multiple states", () => {
    upsertPRs(db, [
      createTestPR({ number: 1, state: "open", isDraft: false }),
      createTestPR({ number: 2, state: "open", isDraft: true }),
      createTestPR({ number: 3, state: "closed" }),
      createTestPR({ number: 4, state: "merged" }),
    ]);

    const prs = getPRsByState(db, "owner/repo", ["draft", "merged"]);
    expect(prs).toHaveLength(2);
    const numbers = prs.map((p) => p.number).toSorted();
    expect(numbers).toEqual([2, 4]);

    closeDatabase(db);
  });

  test("updatePRState updates state correctly", () => {
    const pr = createTestPR({ state: "open", isDraft: false });
    upsertPR(db, pr);

    updatePRState(db, pr.repo, pr.number, "merged");

    const retrieved = getPR(db, pr.repo, pr.number);
    expect(retrieved?.state).toBe("merged");
    expect(retrieved?.isDraft).toBe(false);

    closeDatabase(db);
  });

  test("updatePRState handles draft state", () => {
    const pr = createTestPR({ state: "open", isDraft: false });
    upsertPR(db, pr);

    updatePRState(db, pr.repo, pr.number, "draft");

    const retrieved = getPR(db, pr.repo, pr.number);
    expect(retrieved?.state).toBe("open");
    expect(retrieved?.isDraft).toBe(true);

    closeDatabase(db);
  });

  test("deletePR removes PR and its entries", () => {
    const pr = createTestPR();
    upsertPR(db, pr);
    insertEntry(db, createTestEntry({ id: "e1", pr: pr.number }));

    deletePR(db, pr.repo, pr.number);

    expect(getPR(db, pr.repo, pr.number)).toBeNull();
    expect(getEntry(db, "e1", pr.repo)).toBeNull();

    closeDatabase(db);
  });
});

// =============================================================================
// Entry Operations Tests
// =============================================================================

describe("Entry Operations", () => {
  let db: Database;

  beforeEach(() => {
    db = openDatabase();
    // Insert required PR for foreign key
    upsertPR(db, createTestPR());
  });

  test("insertEntry inserts a new entry", () => {
    const entry = createTestEntry();
    insertEntry(db, entry);

    const retrieved = getEntry(db, entry.id, entry.repo);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.id).toBe(entry.id);
    expect(retrieved?.type).toBe(entry.type);
    expect(retrieved?.body).toBe(entry.body);
    expect(retrieved?.author).toBe(entry.author);

    closeDatabase(db);
  });

  test("insertEntry handles JSON fields", () => {
    const entry = createTestEntry({
      id: "entry-graphite",
      graphite: {
        stack_id: "stack-123",
        stack_position: 2,
        stack_size: 5,
        parent_pr: 10,
      },
      file_activity_after: {
        modified: true,
        commits_touching_file: 3,
        latest_commit: "abc123",
        latest_commit_at: "2025-01-15T00:00:00Z",
      },
      file_provenance: {
        origin_pr: 5,
        origin_branch: "main",
        origin_commit: "def456",
        stack_position: 1,
      },
      reactions: {
        thumbs_up_by: ["alice", "bob"],
      },
    });

    insertEntry(db, entry);

    const retrieved = getEntry(db, entry.id, entry.repo);
    expect(retrieved?.graphite).toEqual(entry.graphite);
    expect(retrieved?.file_activity_after).toEqual(entry.file_activity_after);
    expect(retrieved?.file_provenance).toEqual(entry.file_provenance);
    expect(retrieved?.reactions).toEqual(entry.reactions);

    closeDatabase(db);
  });

  test("insertEntry handles null JSON fields", () => {
    const entry = createTestEntry({
      id: "entry-no-json",
      graphite: undefined,
      file_activity_after: undefined,
      file_provenance: undefined,
      reactions: undefined,
    });

    insertEntry(db, entry);

    const retrieved = getEntry(db, entry.id, entry.repo);
    expect(retrieved?.graphite).toBeUndefined();
    expect(retrieved?.file_activity_after).toBeUndefined();
    expect(retrieved?.file_provenance).toBeUndefined();
    expect(retrieved?.reactions).toBeUndefined();

    closeDatabase(db);
  });

  test("insertEntry replaces existing entry", () => {
    const entry = createTestEntry({ body: "Original" });
    insertEntry(db, entry);

    const updated = { ...entry, body: "Updated" };
    insertEntry(db, updated);

    const retrieved = getEntry(db, entry.id, entry.repo);
    expect(retrieved?.body).toBe("Updated");

    closeDatabase(db);
  });

  test("insertEntries inserts multiple entries in transaction", () => {
    upsertPR(db, createTestPR({ number: 2 }));

    const entries = [
      createTestEntry({ id: "e1", pr: 1 }),
      createTestEntry({ id: "e2", pr: 1, type: "review" }),
      createTestEntry({ id: "e3", pr: 2, author: "other" }),
    ];

    insertEntries(db, entries);

    expect(getEntry(db, "e1", "owner/repo")).not.toBeNull();
    expect(getEntry(db, "e2", "owner/repo")?.type).toBe("review");
    expect(getEntry(db, "e3", "owner/repo")?.author).toBe("other");

    closeDatabase(db);
  });

  test("insertEntries handles empty array", () => {
    // Should not throw
    insertEntries(db, []);
    closeDatabase(db);
  });

  test("updateEntry updates specific fields", () => {
    const entry = createTestEntry();
    insertEntry(db, entry);

    const updates: EntryUpdates = {
      body: "Updated body",
      state: "resolved",
      file_activity_after: {
        modified: true,
        commits_touching_file: 5,
      },
    };

    updateEntry(db, entry.id, entry.repo, updates);

    const retrieved = getEntry(db, entry.id, entry.repo);
    expect(retrieved?.body).toBe("Updated body");
    expect(retrieved?.state).toBe("resolved");
    expect(retrieved?.file_activity_after?.modified).toBe(true);
    expect(retrieved?.file_activity_after?.commits_touching_file).toBe(5);

    closeDatabase(db);
  });

  test("updateEntry handles empty updates", () => {
    const entry = createTestEntry();
    insertEntry(db, entry);

    updateEntry(db, entry.id, entry.repo, {});

    const retrieved = getEntry(db, entry.id, entry.repo);
    expect(retrieved?.body).toBe(entry.body);

    closeDatabase(db);
  });

  test("deleteEntriesByRepo removes all entries for repo", () => {
    upsertPR(db, createTestPR({ repo: "other/repo" }));

    insertEntries(db, [
      createTestEntry({ id: "e1", repo: "owner/repo" }),
      createTestEntry({ id: "e2", repo: "owner/repo" }),
      createTestEntry({ id: "e3", repo: "other/repo" }),
    ]);

    deleteEntriesByRepo(db, "owner/repo");

    expect(getEntry(db, "e1", "owner/repo")).toBeNull();
    expect(getEntry(db, "e2", "owner/repo")).toBeNull();
    expect(getEntry(db, "e3", "other/repo")).not.toBeNull();

    closeDatabase(db);
  });
});

// =============================================================================
// Query Tests
// =============================================================================

describe("Query Operations", () => {
  let db: Database;

  beforeEach(() => {
    db = openDatabase();

    // Setup test data
    upsertPRs(db, [
      createTestPR({
        number: 1,
        state: "open",
        isDraft: false,
        labels: ["bug"],
      }),
      createTestPR({
        number: 2,
        state: "open",
        isDraft: true,
        labels: ["feature"],
      }),
      createTestPR({ number: 3, state: "closed", labels: ["docs"] }),
      createTestPR({ number: 4, state: "merged", labels: ["bug", "urgent"] }),
    ]);

    insertEntries(db, [
      createTestEntry({
        id: "e1",
        pr: 1,
        type: "comment",
        author: "alice",
        created_at: "2025-01-10T00:00:00Z",
      }),
      createTestEntry({
        id: "e2",
        pr: 1,
        type: "review",
        author: "bob",
        created_at: "2025-01-11T00:00:00Z",
      }),
      createTestEntry({
        id: "e3",
        pr: 2,
        type: "comment",
        author: "alice",
        created_at: "2025-01-12T00:00:00Z",
      }),
      createTestEntry({
        id: "e4",
        pr: 3,
        type: "commit",
        author: "carol",
        created_at: "2025-01-13T00:00:00Z",
      }),
      createTestEntry({
        id: "e5",
        pr: 4,
        type: "ci",
        author: "github-actions",
        created_at: "2025-01-14T00:00:00Z",
      }),
    ]);
  });

  test("queryEntries returns all entries when no filters", () => {
    const results = queryEntries(db);
    expect(results).toHaveLength(5);

    closeDatabase(db);
  });

  test("queryEntries orders by created_at descending", () => {
    const results = queryEntries(db);
    expect(results[0]?.id).toBe("e5");
    expect(results[4]?.id).toBe("e1");

    closeDatabase(db);
  });

  test("queryEntries filters by id", () => {
    const results = queryEntries(db, { id: "e2" });
    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe("e2");

    closeDatabase(db);
  });

  test("queryEntries filters by repo substring", () => {
    upsertPR(db, createTestPR({ repo: "other/project", number: 99 }));
    insertEntry(
      db,
      createTestEntry({ id: "other-e1", repo: "other/project", pr: 99 })
    );

    const results = queryEntries(db, { repo: "owner" });
    expect(results).toHaveLength(5);
    expect(results.every((e) => e.repo === "owner/repo")).toBe(true);

    closeDatabase(db);
  });

  test("queryEntries filters by pr number", () => {
    const results = queryEntries(db, { pr: 1 });
    expect(results).toHaveLength(2);
    expect(results.every((e) => e.pr === 1)).toBe(true);

    closeDatabase(db);
  });

  test("queryEntries filters by multiple pr numbers", () => {
    const results = queryEntries(db, { pr: [1, 3] });
    expect(results).toHaveLength(3);

    closeDatabase(db);
  });

  test("queryEntries filters by author", () => {
    const results = queryEntries(db, { author: "alice" });
    expect(results).toHaveLength(2);
    expect(results.every((e) => e.author === "alice")).toBe(true);

    closeDatabase(db);
  });

  test("queryEntries filters by single type", () => {
    const results = queryEntries(db, { type: "comment" });
    expect(results).toHaveLength(2);

    closeDatabase(db);
  });

  test("queryEntries filters by multiple types", () => {
    const results = queryEntries(db, { type: ["comment", "review"] });
    expect(results).toHaveLength(3);

    closeDatabase(db);
  });

  test("queryEntries filters by open state (excludes drafts)", () => {
    const results = queryEntries(db, { states: ["open"] });
    expect(results).toHaveLength(2);
    expect(results.every((e) => e.pr_state === "open")).toBe(true);

    closeDatabase(db);
  });

  test("queryEntries filters by draft state", () => {
    const results = queryEntries(db, { states: ["draft"] });
    expect(results).toHaveLength(1);
    expect(results[0]?.pr_state).toBe("draft");

    closeDatabase(db);
  });

  test("queryEntries filters by multiple states", () => {
    const results = queryEntries(db, { states: ["open", "merged"] });
    expect(results).toHaveLength(3);

    closeDatabase(db);
  });

  test("queryEntries filters by label", () => {
    const results = queryEntries(db, { label: "bug" });
    expect(results).toHaveLength(3); // PR 1 and PR 4 have "bug" label

    closeDatabase(db);
  });

  test("queryEntries label filter is case-insensitive", () => {
    const results = queryEntries(db, { label: "BUG" });
    expect(results).toHaveLength(3);

    closeDatabase(db);
  });

  test("queryEntries filters by since date", () => {
    const results = queryEntries(db, {
      since: new Date("2025-01-12T00:00:00Z"),
    });
    expect(results).toHaveLength(3);
    expect(results.map((e) => e.id).toSorted()).toEqual(["e3", "e4", "e5"]);

    closeDatabase(db);
  });

  test("queryEntries combines multiple filters", () => {
    const results = queryEntries(db, {
      type: "comment",
      states: ["open", "draft"],
    });
    expect(results).toHaveLength(2);

    closeDatabase(db);
  });

  test("queryEntries derives pr_state from PR table", () => {
    // Initially PR 1 is open
    let results = queryEntries(db, { pr: 1 });
    expect(results[0]?.pr_state).toBe("open");

    // Update PR state to merged
    updatePRState(db, "owner/repo", 1, "merged");

    // Now entries should reflect the new state
    results = queryEntries(db, { pr: 1 });
    expect(results[0]?.pr_state).toBe("merged");

    closeDatabase(db);
  });

  test("countEntries counts matching entries", () => {
    expect(countEntries(db)).toBe(5);
    expect(countEntries(db, { type: "comment" })).toBe(2);
    expect(countEntries(db, { states: ["draft"] })).toBe(1);

    closeDatabase(db);
  });

  test("getRepos returns distinct repos", () => {
    upsertPR(db, createTestPR({ repo: "other/project", number: 99 }));
    insertEntry(
      db,
      createTestEntry({ id: "other-e1", repo: "other/project", pr: 99 })
    );

    const repos = getRepos(db);
    expect(repos).toHaveLength(2);
    expect(repos).toContain("owner/repo");
    expect(repos).toContain("other/project");

    closeDatabase(db);
  });
});

// =============================================================================
// Sync Metadata Tests
// =============================================================================

describe("Sync Metadata Operations", () => {
  let db: Database;

  beforeEach(() => {
    db = openDatabase();
  });

  test("setSyncMeta inserts new metadata", () => {
    const meta: SyncMetadata = {
      repo: "owner/repo",
      cursor: "Y3Vyc29yOjEyMw==",
      last_sync: "2025-01-15T00:00:00Z",
      pr_count: 42,
    };

    setSyncMeta(db, meta);

    const retrieved = getSyncMeta(db, meta.repo);
    expect(retrieved).toEqual(meta);

    closeDatabase(db);
  });

  test("setSyncMeta updates existing metadata", () => {
    const meta: SyncMetadata = {
      repo: "owner/repo",
      cursor: "cursor-1",
      last_sync: "2025-01-15T00:00:00Z",
      pr_count: 10,
    };

    setSyncMeta(db, meta);

    const updated: SyncMetadata = {
      ...meta,
      cursor: "cursor-2",
      last_sync: "2025-01-16T00:00:00Z",
      pr_count: 20,
    };

    setSyncMeta(db, updated);

    const retrieved = getSyncMeta(db, meta.repo);
    expect(retrieved?.cursor).toBe("cursor-2");
    expect(retrieved?.pr_count).toBe(20);

    closeDatabase(db);
  });

  test("getSyncMeta returns null for non-existent repo", () => {
    const result = getSyncMeta(db, "nonexistent/repo");
    expect(result).toBeNull();

    closeDatabase(db);
  });

  test("setSyncMeta handles null cursor", () => {
    const meta: SyncMetadata = {
      repo: "owner/repo",
      cursor: undefined,
      last_sync: "2025-01-15T00:00:00Z",
      pr_count: 0,
    };

    setSyncMeta(db, meta);

    const retrieved = getSyncMeta(db, meta.repo);
    expect(retrieved?.cursor).toBeUndefined();

    closeDatabase(db);
  });

  test("deleteSyncMeta removes metadata", () => {
    const meta: SyncMetadata = {
      repo: "owner/repo",
      cursor: "cursor",
      last_sync: "2025-01-15T00:00:00Z",
      pr_count: 10,
    };

    setSyncMeta(db, meta);
    expect(getSyncMeta(db, meta.repo)).not.toBeNull();

    deleteSyncMeta(db, meta.repo);
    expect(getSyncMeta(db, meta.repo)).toBeNull();

    closeDatabase(db);
  });

  test("getAllSyncMeta returns all metadata", () => {
    setSyncMeta(db, {
      repo: "owner/repo1",
      cursor: "c1",
      last_sync: "2025-01-15T00:00:00Z",
      pr_count: 10,
    });
    setSyncMeta(db, {
      repo: "owner/repo2",
      cursor: "c2",
      last_sync: "2025-01-16T00:00:00Z",
      pr_count: 20,
    });

    const all = getAllSyncMeta(db);
    expect(all).toHaveLength(2);
    expect(all.map((m) => m.repo).toSorted()).toEqual([
      "owner/repo1",
      "owner/repo2",
    ]);

    closeDatabase(db);
  });
});

// =============================================================================
// Utility Operations Tests
// =============================================================================

describe("Utility Operations", () => {
  let db: Database;

  beforeEach(() => {
    db = openDatabase();
  });

  test("clearRepo removes all data for a repo", () => {
    upsertPR(db, createTestPR({ repo: "owner/repo", number: 1 }));
    upsertPR(db, createTestPR({ repo: "other/repo", number: 2 }));

    insertEntry(db, createTestEntry({ id: "e1", repo: "owner/repo", pr: 1 }));
    insertEntry(db, createTestEntry({ id: "e2", repo: "other/repo", pr: 2 }));

    setSyncMeta(db, {
      repo: "owner/repo",
      last_sync: "2025-01-15T00:00:00Z",
      pr_count: 1,
    });
    setSyncMeta(db, {
      repo: "other/repo",
      last_sync: "2025-01-15T00:00:00Z",
      pr_count: 1,
    });

    clearRepo(db, "owner/repo");

    // owner/repo should be cleared
    expect(getEntry(db, "e1", "owner/repo")).toBeNull();
    expect(getPR(db, "owner/repo", 1)).toBeNull();
    expect(getSyncMeta(db, "owner/repo")).toBeNull();

    // other/repo should remain
    expect(getEntry(db, "e2", "other/repo")).not.toBeNull();
    expect(getPR(db, "other/repo", 2)).not.toBeNull();
    expect(getSyncMeta(db, "other/repo")).not.toBeNull();

    closeDatabase(db);
  });
});

// =============================================================================
// rowToEntry Tests
// =============================================================================

describe("rowToEntry conversion", () => {
  let db: Database;

  beforeEach(() => {
    db = openDatabase();
  });

  test("rowToEntry derives pr_state correctly for open PR", () => {
    upsertPR(db, createTestPR({ state: "open", isDraft: false }));
    insertEntry(db, createTestEntry({ id: "e1" }));

    const entry = getEntry(db, "e1", "owner/repo");
    expect(entry?.pr_state).toBe("open");

    closeDatabase(db);
  });

  test("rowToEntry derives pr_state correctly for draft PR", () => {
    upsertPR(db, createTestPR({ state: "open", isDraft: true }));
    insertEntry(db, createTestEntry({ id: "e1" }));

    const entry = getEntry(db, "e1", "owner/repo");
    expect(entry?.pr_state).toBe("draft");

    closeDatabase(db);
  });

  test("rowToEntry derives pr_state correctly for merged PR", () => {
    upsertPR(db, createTestPR({ state: "merged", isDraft: false }));
    insertEntry(db, createTestEntry({ id: "e1" }));

    const entry = getEntry(db, "e1", "owner/repo");
    expect(entry?.pr_state).toBe("merged");

    closeDatabase(db);
  });

  test("rowToEntry handles missing PR fields gracefully", () => {
    upsertPR(db, {
      repo: "owner/repo",
      number: 1,
      state: "open",
      isDraft: false,
      labels: [],
      // No title, author, branch
    });
    insertEntry(db, createTestEntry({ id: "e1" }));

    const entry = getEntry(db, "e1", "owner/repo");
    expect(entry?.pr_title).toBe("");
    expect(entry?.pr_author).toBe("unknown");
    expect(entry?.pr_branch).toBe("");
    expect(entry?.pr_labels).toBeUndefined();

    closeDatabase(db);
  });

  test("rowToEntry handles empty labels array", () => {
    upsertPR(db, createTestPR({ labels: [] }));
    insertEntry(db, createTestEntry({ id: "e1" }));

    const entry = getEntry(db, "e1", "owner/repo");
    expect(entry?.pr_labels).toBeUndefined();

    closeDatabase(db);
  });

  test("rowToEntry reflects PR state changes", () => {
    upsertPR(db, createTestPR({ state: "open", isDraft: false }));
    insertEntry(db, createTestEntry({ id: "e1" }));

    // Initial state
    let entry = getEntry(db, "e1", "owner/repo");
    expect(entry?.pr_state).toBe("open");

    // Simulate PR becoming draft
    updatePRState(db, "owner/repo", 1, "draft");
    entry = getEntry(db, "e1", "owner/repo");
    expect(entry?.pr_state).toBe("draft");

    // Simulate PR being merged
    updatePRState(db, "owner/repo", 1, "merged");
    entry = getEntry(db, "e1", "owner/repo");
    expect(entry?.pr_state).toBe("merged");

    closeDatabase(db);
  });
});
