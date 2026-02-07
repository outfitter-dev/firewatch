import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { closeDatabase, openDatabase } from "../src/db";
import {
  countHiddenEntries,
  freezePR,
  getFreezeInfo,
  getFrozenPRs,
  isFrozen,
  unfreezePR,
} from "../src/freeze";
import { insertEntries, upsertPR, upsertPRs, type PRMetadata } from "../src/repository";
import type { FirewatchEntry } from "../src/schema/entry";

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
  overrides: Partial<FirewatchEntry> = {},
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
    created_at: "2025-01-15T00:00:00Z",
    updated_at: "2025-01-15T01:00:00Z",
    captured_at: "2025-01-15T02:00:00Z",
    url: "https://github.com/owner/repo/pull/1#issuecomment-123",
    ...overrides,
  };
}

// =============================================================================
// freezePR Tests
// =============================================================================

describe("freezePR", () => {
  let db: Database;

  beforeEach(() => {
    db = openDatabase();
    upsertPR(db, createTestPR());
  });

  afterEach(() => {
    closeDatabase(db);
  });

  test("returns ok with FreezeInfo for an existing PR", () => {
    const result = freezePR(db, "owner/repo", 1);

    expect(result.isOk()).toBe(true);
    expect(result.value!.repo).toBe("owner/repo");
    expect(result.value!.pr).toBe(1);
    expect(result.value!.frozen_at).toBeString();
  });

  test("sets frozen_at to a valid ISO timestamp", () => {
    const before = new Date().toISOString();
    const result = freezePR(db, "owner/repo", 1);
    const after = new Date().toISOString();

    expect(result.isOk()).toBe(true);
    const frozenAt = result.value!.frozen_at;
    expect(frozenAt).not.toBeNull();
    expect(frozenAt! >= before).toBe(true);
    expect(frozenAt! <= after).toBe(true);
  });

  test("returns err with NotFoundError for a non-existent PR", () => {
    const result = freezePR(db, "owner/repo", 999);

    expect(result.isErr()).toBe(true);
    expect(result.error!.message).toContain("PR #999");
    expect(result.error!.message).toContain("owner/repo");
  });

  test("returns err for a non-existent repo", () => {
    const result = freezePR(db, "nonexistent/repo", 1);

    expect(result.isErr()).toBe(true);
  });

  test("overwrites a previous freeze timestamp on re-freeze", () => {
    const first = freezePR(db, "owner/repo", 1);
    expect(first.isOk()).toBe(true);

    // Small delay to ensure different timestamp
    const second = freezePR(db, "owner/repo", 1);
    expect(second.isOk()).toBe(true);

    // The second freeze should have a timestamp >= the first
    expect(second.value!.frozen_at! >= first.value!.frozen_at!).toBe(true);
  });
});

// =============================================================================
// unfreezePR Tests
// =============================================================================

describe("unfreezePR", () => {
  let db: Database;

  beforeEach(() => {
    db = openDatabase();
    upsertPR(db, createTestPR());
  });

  afterEach(() => {
    closeDatabase(db);
  });

  test("returns ok with null frozen_at for a frozen PR", () => {
    freezePR(db, "owner/repo", 1);
    const result = unfreezePR(db, "owner/repo", 1);

    expect(result.isOk()).toBe(true);
    expect(result.value!.repo).toBe("owner/repo");
    expect(result.value!.pr).toBe(1);
    expect(result.value!.frozen_at).toBeNull();
  });

  test("returns ok for an unfrozen PR (idempotent)", () => {
    // PR exists but was never frozen
    const result = unfreezePR(db, "owner/repo", 1);

    expect(result.isOk()).toBe(true);
    expect(result.value!.frozen_at).toBeNull();
  });

  test("returns err with NotFoundError for a non-existent PR", () => {
    const result = unfreezePR(db, "owner/repo", 999);

    expect(result.isErr()).toBe(true);
    expect(result.error!.message).toContain("PR #999");
    expect(result.error!.message).toContain("owner/repo");
  });

  test("clears the frozen_at value in the database", () => {
    freezePR(db, "owner/repo", 1);
    expect(isFrozen(db, "owner/repo", 1)).toBe(true);

    unfreezePR(db, "owner/repo", 1);
    expect(isFrozen(db, "owner/repo", 1)).toBe(false);
  });
});

// =============================================================================
// isFrozen Tests
// =============================================================================

describe("isFrozen", () => {
  let db: Database;

  beforeEach(() => {
    db = openDatabase();
    upsertPR(db, createTestPR());
  });

  afterEach(() => {
    closeDatabase(db);
  });

  test("returns false for a PR that has never been frozen", () => {
    expect(isFrozen(db, "owner/repo", 1)).toBe(false);
  });

  test("returns true after freezing a PR", () => {
    freezePR(db, "owner/repo", 1);
    expect(isFrozen(db, "owner/repo", 1)).toBe(true);
  });

  test("returns false after unfreezing a PR", () => {
    freezePR(db, "owner/repo", 1);
    unfreezePR(db, "owner/repo", 1);
    expect(isFrozen(db, "owner/repo", 1)).toBe(false);
  });

  test("returns false for a non-existent PR", () => {
    expect(isFrozen(db, "owner/repo", 999)).toBe(false);
  });
});

// =============================================================================
// getFreezeInfo Tests
// =============================================================================

describe("getFreezeInfo", () => {
  let db: Database;

  beforeEach(() => {
    db = openDatabase();
    upsertPR(db, createTestPR());
  });

  afterEach(() => {
    closeDatabase(db);
  });

  test("returns null for a non-existent PR", () => {
    expect(getFreezeInfo(db, "owner/repo", 999)).toBeNull();
  });

  test("returns info with null frozen_at for an unfrozen PR", () => {
    const info = getFreezeInfo(db, "owner/repo", 1);

    expect(info).not.toBeNull();
    expect(info?.repo).toBe("owner/repo");
    expect(info?.pr).toBe(1);
    expect(info?.frozen_at).toBeNull();
  });

  test("returns info with frozen_at timestamp for a frozen PR", () => {
    freezePR(db, "owner/repo", 1);

    const info = getFreezeInfo(db, "owner/repo", 1);

    expect(info).not.toBeNull();
    expect(info?.repo).toBe("owner/repo");
    expect(info?.pr).toBe(1);
    expect(info?.frozen_at).toBeString();
  });

  test("reflects unfreezing correctly", () => {
    freezePR(db, "owner/repo", 1);
    unfreezePR(db, "owner/repo", 1);

    const info = getFreezeInfo(db, "owner/repo", 1);

    expect(info).not.toBeNull();
    expect(info?.frozen_at).toBeNull();
  });
});

// =============================================================================
// getFrozenPRs Tests
// =============================================================================

describe("getFrozenPRs", () => {
  let db: Database;

  beforeEach(() => {
    db = openDatabase();
    upsertPRs(db, [
      createTestPR({ number: 1, repo: "owner/repo" }),
      createTestPR({ number: 2, repo: "owner/repo" }),
      createTestPR({ number: 3, repo: "other/repo" }),
    ]);
  });

  afterEach(() => {
    closeDatabase(db);
  });

  test("returns empty array when no PRs are frozen", () => {
    expect(getFrozenPRs(db)).toEqual([]);
  });

  test("returns all frozen PRs across repos", () => {
    freezePR(db, "owner/repo", 1);
    freezePR(db, "other/repo", 3);

    const frozen = getFrozenPRs(db);
    expect(frozen).toHaveLength(2);

    const prs = frozen.map((f) => `${f.repo}#${f.pr}`).toSorted();
    expect(prs).toEqual(["other/repo#3", "owner/repo#1"]);
  });

  test("filters by repo when provided", () => {
    freezePR(db, "owner/repo", 1);
    freezePR(db, "owner/repo", 2);
    freezePR(db, "other/repo", 3);

    const frozen = getFrozenPRs(db, "owner/repo");
    expect(frozen).toHaveLength(2);
    expect(frozen.every((f) => f.repo === "owner/repo")).toBe(true);
  });

  test("excludes unfrozen PRs", () => {
    freezePR(db, "owner/repo", 1);
    freezePR(db, "owner/repo", 2);
    unfreezePR(db, "owner/repo", 1);

    const frozen = getFrozenPRs(db);
    expect(frozen).toHaveLength(1);
    expect(frozen[0]?.pr).toBe(2);
  });

  test("orders by frozen_at descending", () => {
    // Set frozen_at manually to guarantee distinct timestamps
    db.prepare(
      "UPDATE prs SET frozen_at = $frozen_at WHERE repo = $repo AND number = $number",
    ).run({ $repo: "owner/repo", $number: 1, $frozen_at: "2025-01-01T00:00:00Z" });
    db.prepare(
      "UPDATE prs SET frozen_at = $frozen_at WHERE repo = $repo AND number = $number",
    ).run({ $repo: "owner/repo", $number: 2, $frozen_at: "2025-01-02T00:00:00Z" });

    const frozen = getFrozenPRs(db);

    // The later freeze should appear first
    expect(frozen[0]?.pr).toBe(2);
    expect(frozen[1]?.pr).toBe(1);
  });
});

// =============================================================================
// countHiddenEntries Tests
// =============================================================================

describe("countHiddenEntries", () => {
  let db: Database;

  beforeEach(() => {
    db = openDatabase();
    upsertPR(db, createTestPR());
  });

  afterEach(() => {
    closeDatabase(db);
  });

  test("returns 0 when PR is not frozen", () => {
    insertEntries(db, [createTestEntry({ id: "e1", pr: 1 })]);
    expect(countHiddenEntries(db, "owner/repo", 1)).toBe(0);
  });

  test("returns 0 when PR does not exist", () => {
    expect(countHiddenEntries(db, "owner/repo", 999)).toBe(0);
  });

  test("counts entries created after freeze timestamp", () => {
    // Insert entry before freezing
    insertEntries(db, [
      createTestEntry({
        id: "e-before",
        pr: 1,
        created_at: "2025-01-01T00:00:00Z",
      }),
    ]);

    // Freeze the PR (sets frozen_at to now)
    freezePR(db, "owner/repo", 1);

    // Insert entry after freezing (simulate by manually setting created_at in the future)
    insertEntries(db, [
      createTestEntry({
        id: "e-after",
        pr: 1,
        created_at: "2099-01-01T00:00:00Z",
      }),
    ]);

    expect(countHiddenEntries(db, "owner/repo", 1)).toBe(1);
  });

  test("does not count entries created before freeze timestamp", () => {
    insertEntries(db, [
      createTestEntry({
        id: "e1",
        pr: 1,
        created_at: "2020-01-01T00:00:00Z",
      }),
      createTestEntry({
        id: "e2",
        pr: 1,
        created_at: "2020-06-01T00:00:00Z",
      }),
    ]);

    freezePR(db, "owner/repo", 1);

    // All entries are before the freeze — none should be hidden
    expect(countHiddenEntries(db, "owner/repo", 1)).toBe(0);
  });
});
