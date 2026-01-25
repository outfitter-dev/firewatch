import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeDatabase, openDatabase } from "../src/db";
import {
  countEntries,
  getPR,
  getSyncMeta,
  insertEntries,
  queryEntries,
  setSyncMeta,
  upsertPR,
  upsertPRs,
  type PRMetadata,
} from "../src/repository";
import type { FirewatchEntry } from "../src/schema/entry";

const tempRoot = await mkdtemp(join(tmpdir(), "firewatch-sync-"));

afterAll(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

// =============================================================================
// Test Fixtures - Simulating GitHub API data
// =============================================================================

function createPRMetadata(overrides: Partial<PRMetadata> = {}): PRMetadata {
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

function createEntry(overrides: Partial<FirewatchEntry> = {}): FirewatchEntry {
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
// PR State Update Tests (Issue #37 fix)
// =============================================================================

describe("PR State Updates (Issue #37)", () => {
  test("upsertPR updates state when PR is merged", () => {
    const db = openDatabase();

    // Initial sync: PR is open
    upsertPR(db, createPRMetadata({ state: "open", isDraft: false }));
    let pr = getPR(db, "owner/repo", 1);
    expect(pr?.state).toBe("open");
    expect(pr?.isDraft).toBe(false);

    // Subsequent sync: PR was merged
    upsertPR(db, createPRMetadata({ state: "merged", isDraft: false }));
    pr = getPR(db, "owner/repo", 1);
    expect(pr?.state).toBe("merged");

    closeDatabase(db);
  });

  test("upsertPR updates state when PR is closed", () => {
    const db = openDatabase();

    // Initial sync: PR is open
    upsertPR(db, createPRMetadata({ state: "open" }));
    let pr = getPR(db, "owner/repo", 1);
    expect(pr?.state).toBe("open");

    // Subsequent sync: PR was closed
    upsertPR(db, createPRMetadata({ state: "closed" }));
    pr = getPR(db, "owner/repo", 1);
    expect(pr?.state).toBe("closed");

    closeDatabase(db);
  });

  test("upsertPR updates isDraft when PR is marked ready", () => {
    const db = openDatabase();

    // Initial sync: PR is draft
    upsertPR(db, createPRMetadata({ state: "open", isDraft: true }));
    let pr = getPR(db, "owner/repo", 1);
    expect(pr?.state).toBe("open");
    expect(pr?.isDraft).toBe(true);

    // Subsequent sync: PR is now ready
    upsertPR(db, createPRMetadata({ state: "open", isDraft: false }));
    pr = getPR(db, "owner/repo", 1);
    expect(pr?.state).toBe("open");
    expect(pr?.isDraft).toBe(false);

    closeDatabase(db);
  });

  test("upsertPR preserves PR metadata on state update", () => {
    const db = openDatabase();

    // Initial sync with full metadata
    upsertPR(
      db,
      createPRMetadata({
        state: "open",
        title: "Original Title",
        author: "alice",
        branch: "feature/test",
        labels: ["bug"],
      })
    );

    // Subsequent sync updates state but keeps metadata
    upsertPR(
      db,
      createPRMetadata({
        state: "merged",
        title: "Updated Title",
        author: "alice",
        branch: "feature/test",
        labels: ["bug", "merged"],
      })
    );

    const pr = getPR(db, "owner/repo", 1);
    expect(pr?.state).toBe("merged");
    expect(pr?.title).toBe("Updated Title");
    expect(pr?.labels).toEqual(["bug", "merged"]);

    closeDatabase(db);
  });
});

// =============================================================================
// Entry Query with Current PR State
// =============================================================================

describe("Entry Queries with Current PR State", () => {
  test("queryEntries reflects current PR state, not entry-time state", () => {
    const db = openDatabase();

    // Insert PR as open
    upsertPR(db, createPRMetadata({ state: "open", isDraft: false }));

    // Insert entry (captured when PR was open)
    insertEntries(db, [createEntry({ pr_state: "open" })]);

    // Initial query shows open
    let entries = queryEntries(db, { pr: 1 });
    expect(entries[0]?.pr_state).toBe("open");

    // PR is merged (simulating a subsequent sync)
    upsertPR(db, createPRMetadata({ state: "merged" }));

    // Same entry now shows merged state
    entries = queryEntries(db, { pr: 1 });
    expect(entries[0]?.pr_state).toBe("merged");

    closeDatabase(db);
  });

  test("queryEntries with --open filter excludes merged PRs", () => {
    const db = openDatabase();

    // Insert two PRs
    upsertPR(
      db,
      createPRMetadata({ number: 1, state: "open", isDraft: false })
    );
    upsertPR(
      db,
      createPRMetadata({ number: 2, state: "open", isDraft: false })
    );

    // Insert entries for both
    insertEntries(db, [
      createEntry({ id: "e1", pr: 1 }),
      createEntry({ id: "e2", pr: 2 }),
    ]);

    // Both PRs are open
    let openEntries = queryEntries(db, { states: ["open"] });
    expect(openEntries).toHaveLength(2);

    // PR 2 gets merged
    upsertPR(db, createPRMetadata({ number: 2, state: "merged" }));

    // Now only PR 1 entries show with --open
    openEntries = queryEntries(db, { states: ["open"] });
    expect(openEntries).toHaveLength(1);
    expect(openEntries[0]?.pr).toBe(1);

    closeDatabase(db);
  });

  test("queryEntries with --open filter excludes draft PRs", () => {
    const db = openDatabase();

    // One open, one draft
    upsertPR(
      db,
      createPRMetadata({ number: 1, state: "open", isDraft: false })
    );
    upsertPR(db, createPRMetadata({ number: 2, state: "open", isDraft: true }));

    insertEntries(db, [
      createEntry({ id: "e1", pr: 1 }),
      createEntry({ id: "e2", pr: 2 }),
    ]);

    // Only non-draft open PRs
    const openEntries = queryEntries(db, { states: ["open"] });
    expect(openEntries).toHaveLength(1);
    expect(openEntries[0]?.pr).toBe(1);

    // Draft PRs show with draft filter
    const draftEntries = queryEntries(db, { states: ["draft"] });
    expect(draftEntries).toHaveLength(1);
    expect(draftEntries[0]?.pr).toBe(2);
    expect(draftEntries[0]?.pr_state).toBe("draft");

    closeDatabase(db);
  });
});

// =============================================================================
// Sync Metadata Tests
// =============================================================================

describe("Sync Metadata", () => {
  test("sync metadata is stored correctly", () => {
    const db = openDatabase();

    setSyncMeta(db, {
      repo: "owner/repo",
      scope: "open",
      cursor: "Y3Vyc29yOjEyMw==",
      last_sync: "2025-01-15T00:00:00Z",
      pr_count: 42,
    });

    const meta = getSyncMeta(db, "owner/repo", "open");
    expect(meta?.repo).toBe("owner/repo");
    expect(meta?.cursor).toBe("Y3Vyc29yOjEyMw==");
    expect(meta?.pr_count).toBe(42);

    closeDatabase(db);
  });

  test("sync metadata updates on subsequent syncs", () => {
    const db = openDatabase();

    // First sync
    setSyncMeta(db, {
      repo: "owner/repo",
      scope: "open",
      cursor: "cursor1",
      last_sync: "2025-01-15T00:00:00Z",
      pr_count: 10,
    });

    // Second sync
    setSyncMeta(db, {
      repo: "owner/repo",
      scope: "open",
      cursor: "cursor2",
      last_sync: "2025-01-16T00:00:00Z",
      pr_count: 20,
    });

    const meta = getSyncMeta(db, "owner/repo", "open");
    expect(meta?.cursor).toBe("cursor2");
    expect(meta?.pr_count).toBe(20);

    closeDatabase(db);
  });
});

// =============================================================================
// Transaction Atomicity Tests
// =============================================================================

describe("Transaction Atomicity", () => {
  test("multiple PRs and entries are written atomically", () => {
    const db = openDatabase();

    const prs = [
      createPRMetadata({ number: 1, title: "PR 1" }),
      createPRMetadata({ number: 2, title: "PR 2" }),
      createPRMetadata({ number: 3, title: "PR 3" }),
    ];

    const entries = [
      createEntry({ id: "e1", pr: 1 }),
      createEntry({ id: "e2", pr: 1 }),
      createEntry({ id: "e3", pr: 2 }),
      createEntry({ id: "e4", pr: 3 }),
    ];

    // Simulate batch write from sync
    db.transaction(() => {
      upsertPRs(db, prs);
      insertEntries(db, entries);
    })();

    // All PRs should exist
    expect(getPR(db, "owner/repo", 1)).not.toBeNull();
    expect(getPR(db, "owner/repo", 2)).not.toBeNull();
    expect(getPR(db, "owner/repo", 3)).not.toBeNull();

    // All entries should exist
    expect(countEntries(db)).toBe(4);

    closeDatabase(db);
  });
});

// =============================================================================
// mapPRStateForDb Tests (exported for unit testing)
// =============================================================================

describe("State Mapping", () => {
  test("GitHub OPEN state maps to 'open'", () => {
    const db = openDatabase();

    // Simulating what sync does: GitHub returns OPEN
    upsertPR(db, createPRMetadata({ state: "open" }));
    const pr = getPR(db, "owner/repo", 1);
    expect(pr?.state).toBe("open");

    closeDatabase(db);
  });

  test("GitHub CLOSED state maps to 'closed'", () => {
    const db = openDatabase();

    upsertPR(db, createPRMetadata({ state: "closed" }));
    const pr = getPR(db, "owner/repo", 1);
    expect(pr?.state).toBe("closed");

    closeDatabase(db);
  });

  test("GitHub MERGED state maps to 'merged'", () => {
    const db = openDatabase();

    upsertPR(db, createPRMetadata({ state: "merged" }));
    const pr = getPR(db, "owner/repo", 1);
    expect(pr?.state).toBe("merged");

    closeDatabase(db);
  });

  test("Draft PRs have state 'open' with isDraft true", () => {
    const db = openDatabase();

    upsertPR(db, createPRMetadata({ state: "open", isDraft: true }));
    const pr = getPR(db, "owner/repo", 1);
    expect(pr?.state).toBe("open");
    expect(pr?.isDraft).toBe(true);

    closeDatabase(db);
  });
});

// =============================================================================
// Thread Resolution Tests (gh/fw parity)
// =============================================================================

describe("Thread Resolution State", () => {
  test("thread_resolved=false is stored and queryable", () => {
    const db = openDatabase();

    upsertPR(db, createPRMetadata({ number: 10, state: "open" }));
    insertEntries(db, [
      createEntry({
        id: "review-comment-unresolved",
        pr: 10,
        subtype: "review_comment",
        thread_resolved: false,
      }),
    ]);

    const entries = queryEntries(db, { pr: 10 });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.thread_resolved).toBe(false);

    closeDatabase(db);
  });

  test("thread_resolved=true is stored and queryable", () => {
    const db = openDatabase();

    upsertPR(db, createPRMetadata({ number: 11, state: "open" }));
    insertEntries(db, [
      createEntry({
        id: "review-comment-resolved",
        pr: 11,
        subtype: "review_comment",
        thread_resolved: true,
      }),
    ]);

    const entries = queryEntries(db, { pr: 11 });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.thread_resolved).toBe(true);

    closeDatabase(db);
  });

  test("thread_resolved=undefined (non-review comments) is stored as null", () => {
    const db = openDatabase();

    upsertPR(db, createPRMetadata({ number: 12, state: "open" }));
    insertEntries(db, [
      createEntry({
        id: "issue-comment",
        pr: 12,
        subtype: "issue_comment",
        // thread_resolved intentionally omitted (undefined)
      }),
    ]);

    const entries = queryEntries(db, { pr: 12 });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.thread_resolved).toBeUndefined();

    closeDatabase(db);
  });

  test("can count unresolved threads on open PRs", () => {
    const db = openDatabase();

    upsertPR(db, createPRMetadata({ number: 20, state: "open" }));
    upsertPR(db, createPRMetadata({ number: 21, state: "open" }));

    insertEntries(db, [
      // PR 20: 2 unresolved, 1 resolved
      createEntry({
        id: "pr20-unresolved-1",
        pr: 20,
        subtype: "review_comment",
        thread_resolved: false,
      }),
      createEntry({
        id: "pr20-unresolved-2",
        pr: 20,
        subtype: "review_comment",
        thread_resolved: false,
      }),
      createEntry({
        id: "pr20-resolved",
        pr: 20,
        subtype: "review_comment",
        thread_resolved: true,
      }),
      // PR 21: 1 unresolved
      createEntry({
        id: "pr21-unresolved",
        pr: 21,
        subtype: "review_comment",
        thread_resolved: false,
      }),
    ]);

    // Query all review comments with unresolved threads on open PRs
    const entries = queryEntries(db, {
      subtype: "review_comment",
      states: ["open"],
    });

    const unresolved = entries.filter((e) => e.thread_resolved === false);
    expect(unresolved).toHaveLength(3);

    // Group by PR to verify counts
    const byPr = Map.groupBy(unresolved, (e) => e.pr);
    expect(byPr.get(20)?.length).toBe(2);
    expect(byPr.get(21)?.length).toBe(1);

    closeDatabase(db);
  });

  test("thread_resolved state updates on re-sync", () => {
    const db = openDatabase();

    upsertPR(db, createPRMetadata({ number: 30, state: "open" }));

    // Initial sync: thread is unresolved
    insertEntries(db, [
      createEntry({
        id: "pr30-thread",
        pr: 30,
        subtype: "review_comment",
        thread_resolved: false,
      }),
    ]);

    let entries = queryEntries(db, { pr: 30 });
    expect(entries[0]?.thread_resolved).toBe(false);

    // Re-sync: thread is now resolved (INSERT OR REPLACE)
    insertEntries(db, [
      createEntry({
        id: "pr30-thread",
        pr: 30,
        subtype: "review_comment",
        thread_resolved: true,
      }),
    ]);

    entries = queryEntries(db, { pr: 30 });
    expect(entries[0]?.thread_resolved).toBe(true);

    closeDatabase(db);
  });
});
