import { describe, expect, test } from "bun:test";

import {
  buildAckRecords,
  deduplicateByCommentId,
  formatCommentId,
  partitionResolutions,
  type BatchIdResolution,
} from "../src/batch";
import type { FirewatchEntry } from "../src/schema/entry";

// =============================================================================
// Test Fixtures
// =============================================================================

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
    created_at: "2025-01-15T00:00:00Z",
    updated_at: "2025-01-15T01:00:00Z",
    captured_at: "2025-01-15T02:00:00Z",
    url: "https://github.com/owner/repo/pull/1#issuecomment-123",
    ...overrides,
  };
}

// =============================================================================
// partitionResolutions Tests
// =============================================================================

describe("partitionResolutions", () => {
  test("partitions empty array into empty groups", () => {
    const result = partitionResolutions([]);

    expect(result.comments).toEqual([]);
    expect(result.prs).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  test("separates comments, PRs, and errors", () => {
    const resolutions: BatchIdResolution[] = [
      {
        id: "abc12",
        type: "comment",
        entry: createTestEntry(),
        shortId: "@abc12",
      },
      { id: "42", type: "pr", pr: 42 },
      { id: "bad", type: "error", error: "Invalid ID format: bad" },
    ];

    const result = partitionResolutions(resolutions);

    expect(result.comments).toHaveLength(1);
    expect(result.prs).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
  });

  test("groups multiple items of the same type", () => {
    const resolutions: BatchIdResolution[] = [
      {
        id: "abc12",
        type: "comment",
        entry: createTestEntry({ id: "e1" }),
        shortId: "@abc12",
      },
      {
        id: "def34",
        type: "comment",
        entry: createTestEntry({ id: "e2" }),
        shortId: "@def34",
      },
      { id: "42", type: "pr", pr: 42 },
      { id: "99", type: "pr", pr: 99 },
      { id: "bad1", type: "error", error: "Error 1" },
      { id: "bad2", type: "error", error: "Error 2" },
      { id: "bad3", type: "error", error: "Error 3" },
    ];

    const result = partitionResolutions(resolutions);

    expect(result.comments).toHaveLength(2);
    expect(result.prs).toHaveLength(2);
    expect(result.errors).toHaveLength(3);
  });

  test("preserves resolution data in each partition", () => {
    const entry = createTestEntry({ id: "IC_kwDOQ" });
    const resolutions: BatchIdResolution[] = [
      { id: "abc12", type: "comment", entry, shortId: "@abc12" },
      { id: "42", type: "pr", pr: 42 },
      { id: "bad", type: "error", error: "Not found" },
    ];

    const result = partitionResolutions(resolutions);

    expect(result.comments[0]?.entry).toBe(entry);
    expect(result.comments[0]?.shortId).toBe("@abc12");
    expect(result.prs[0]?.pr).toBe(42);
    expect(result.errors[0]?.error).toBe("Not found");
  });

  test("handles all-comments input", () => {
    const resolutions: BatchIdResolution[] = [
      {
        id: "a",
        type: "comment",
        entry: createTestEntry({ id: "e1" }),
        shortId: "@a",
      },
      {
        id: "b",
        type: "comment",
        entry: createTestEntry({ id: "e2" }),
        shortId: "@b",
      },
    ];

    const result = partitionResolutions(resolutions);

    expect(result.comments).toHaveLength(2);
    expect(result.prs).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  test("handles all-errors input", () => {
    const resolutions: BatchIdResolution[] = [
      { id: "bad1", type: "error", error: "Error 1" },
      { id: "bad2", type: "error", error: "Error 2" },
    ];

    const result = partitionResolutions(resolutions);

    expect(result.comments).toHaveLength(0);
    expect(result.prs).toHaveLength(0);
    expect(result.errors).toHaveLength(2);
  });
});

// =============================================================================
// deduplicateByCommentId Tests
// =============================================================================

describe("deduplicateByCommentId", () => {
  test("returns empty array for empty input", () => {
    expect(deduplicateByCommentId([])).toEqual([]);
  });

  test("keeps unique comment resolutions", () => {
    const resolutions: BatchIdResolution[] = [
      {
        id: "abc12",
        type: "comment",
        entry: createTestEntry({ id: "IC_1" }),
        shortId: "@abc12",
      },
      {
        id: "def34",
        type: "comment",
        entry: createTestEntry({ id: "IC_2" }),
        shortId: "@def34",
      },
    ];

    const result = deduplicateByCommentId(resolutions);
    expect(result).toHaveLength(2);
  });

  test("removes duplicate comment resolutions with the same entry ID", () => {
    const entry = createTestEntry({ id: "IC_same" });
    const resolutions: BatchIdResolution[] = [
      { id: "abc12", type: "comment", entry, shortId: "@abc12" },
      { id: "ABC12", type: "comment", entry, shortId: "@ABC12" },
    ];

    const result = deduplicateByCommentId(resolutions);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("abc12"); // First one wins
  });

  test("keeps resolutions without entry (errors, PRs)", () => {
    const resolutions: BatchIdResolution[] = [
      { id: "42", type: "pr", pr: 42 },
      { id: "bad", type: "error", error: "Not found" },
      { id: "43", type: "pr", pr: 43 },
    ];

    const result = deduplicateByCommentId(resolutions);
    expect(result).toHaveLength(3);
  });

  test("deduplicates comments but preserves errors and PRs", () => {
    const sharedEntry = createTestEntry({ id: "IC_shared" });
    const resolutions: BatchIdResolution[] = [
      { id: "abc12", type: "comment", entry: sharedEntry, shortId: "@abc12" },
      { id: "42", type: "pr", pr: 42 },
      { id: "ABC12", type: "comment", entry: sharedEntry, shortId: "@ABC12" },
      { id: "bad", type: "error", error: "Not found" },
    ];

    const result = deduplicateByCommentId(resolutions);
    expect(result).toHaveLength(3); // 1 comment + 1 pr + 1 error
  });

  test("handles mix of unique and duplicate entries", () => {
    const entryA = createTestEntry({ id: "IC_A" });
    const entryB = createTestEntry({ id: "IC_B" });

    const resolutions: BatchIdResolution[] = [
      { id: "a1", type: "comment", entry: entryA, shortId: "@a1" },
      { id: "b1", type: "comment", entry: entryB, shortId: "@b1" },
      { id: "a2", type: "comment", entry: entryA, shortId: "@a2" }, // duplicate of a1
      { id: "b2", type: "comment", entry: entryB, shortId: "@b2" }, // duplicate of b1
    ];

    const result = deduplicateByCommentId(resolutions);
    expect(result).toHaveLength(2);
    expect(result[0]?.id).toBe("a1");
    expect(result[1]?.id).toBe("b1");
  });
});

// =============================================================================
// buildAckRecords Tests
// =============================================================================

describe("buildAckRecords", () => {
  test("returns empty array for empty input", () => {
    const records = buildAckRecords([], { repo: "owner/repo" });
    expect(records).toEqual([]);
  });

  test("builds ack records with correct fields", () => {
    const entry = createTestEntry({ id: "IC_123", pr: 5 });
    const records = buildAckRecords([{ entry, reactionAdded: true }], {
      repo: "owner/repo",
      username: "alice",
    });

    expect(records).toHaveLength(1);
    const record = records[0]!;
    expect(record.repo).toBe("owner/repo");
    expect(record.pr).toBe(5);
    expect(record.comment_id).toBe("IC_123");
    expect(record.reaction_added).toBe(true);
    expect(record.acked_by).toBe("alice");
    expect(record.acked_at).toBeString();
  });

  test("builds multiple ack records from multiple items", () => {
    const items = [
      { entry: createTestEntry({ id: "IC_1", pr: 1 }), reactionAdded: true },
      { entry: createTestEntry({ id: "IC_2", pr: 2 }), reactionAdded: false },
      { entry: createTestEntry({ id: "IC_3", pr: 1 }), reactionAdded: true },
    ];

    const records = buildAckRecords(items, {
      repo: "owner/repo",
      username: "bob",
    });

    expect(records).toHaveLength(3);
    expect(records[0]?.comment_id).toBe("IC_1");
    expect(records[1]?.comment_id).toBe("IC_2");
    expect(records[2]?.comment_id).toBe("IC_3");
  });

  test("uses the entry pr number for each record", () => {
    const items = [
      { entry: createTestEntry({ id: "IC_1", pr: 10 }), reactionAdded: true },
      { entry: createTestEntry({ id: "IC_2", pr: 20 }), reactionAdded: true },
    ];

    const records = buildAckRecords(items, { repo: "owner/repo" });

    expect(records[0]?.pr).toBe(10);
    expect(records[1]?.pr).toBe(20);
  });

  test("omits acked_by when username is not provided", () => {
    const records = buildAckRecords(
      [{ entry: createTestEntry(), reactionAdded: false }],
      { repo: "owner/repo" }
    );

    expect(records).toHaveLength(1);
    expect(records[0]?.acked_by).toBeUndefined();
  });

  test("sets consistent acked_at timestamp across all records", () => {
    const items = [
      { entry: createTestEntry({ id: "IC_1" }), reactionAdded: true },
      { entry: createTestEntry({ id: "IC_2" }), reactionAdded: true },
      { entry: createTestEntry({ id: "IC_3" }), reactionAdded: true },
    ];

    const records = buildAckRecords(items, { repo: "owner/repo" });

    // All records should have the same acked_at (generated once)
    const timestamps = records.map((r) => r.acked_at);
    expect(new Set(timestamps).size).toBe(1);
  });

  test("tracks reaction_added per item", () => {
    const items = [
      { entry: createTestEntry({ id: "IC_1" }), reactionAdded: true },
      { entry: createTestEntry({ id: "IC_2" }), reactionAdded: false },
    ];

    const records = buildAckRecords(items, { repo: "owner/repo" });

    expect(records[0]?.reaction_added).toBe(true);
    expect(records[1]?.reaction_added).toBe(false);
  });
});

// =============================================================================
// formatCommentId Tests
// =============================================================================

describe("formatCommentId", () => {
  test("returns a formatted short ID with @ prefix", () => {
    const result = formatCommentId("IC_kwDOQ_test123", "owner/repo");

    expect(result).toMatch(/^@[a-f0-9]{5}$/);
  });

  test("produces deterministic output for the same inputs", () => {
    const first = formatCommentId("IC_kwDOQ_abc", "owner/repo");
    const second = formatCommentId("IC_kwDOQ_abc", "owner/repo");

    expect(first).toBe(second);
  });

  test("produces different output for different comment IDs", () => {
    const a = formatCommentId("IC_kwDOQ_first", "owner/repo");
    const b = formatCommentId("IC_kwDOQ_second", "owner/repo");

    expect(a).not.toBe(b);
  });

  test("produces different output for different repos", () => {
    const a = formatCommentId("IC_kwDOQ_same", "owner/repo-a");
    const b = formatCommentId("IC_kwDOQ_same", "owner/repo-b");

    expect(a).not.toBe(b);
  });
});
