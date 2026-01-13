import { expect, test } from "bun:test";

import { buildWorklist, sortWorklist } from "../src/worklist";

const baseEntry = {
  repo: "outfitter-dev/firewatch",
  pr_title: "Add worklist",
  pr_state: "open" as const,
  pr_author: "alice",
  pr_branch: "feature/worklist",
  created_at: "2025-01-02T10:00:00.000Z",
  captured_at: "2025-01-02T10:05:00.000Z",
};

test("buildWorklist aggregates counts and latest activity", () => {
  const entries = [
    {
      ...baseEntry,
      id: "comment-1",
      pr: 10,
      type: "comment" as const,
      author: "alice",
      body: "First comment",
    },
    {
      ...baseEntry,
      id: "review-1",
      pr: 10,
      type: "review" as const,
      author: "bob",
      state: "approved",
      created_at: "2025-01-02T12:00:00.000Z",
    },
    {
      ...baseEntry,
      id: "commit-1",
      pr: 10,
      type: "commit" as const,
      author: "alice",
      body: "fix: add worklist",
      created_at: "2025-01-02T13:00:00.000Z",
    },
  ];

  const worklist = buildWorklist(entries);
  expect(worklist).toHaveLength(1);
  expect(worklist[0]?.counts.comments).toBe(1);
  expect(worklist[0]?.counts.reviews).toBe(1);
  expect(worklist[0]?.counts.commits).toBe(1);
  expect(worklist[0]?.review_states?.approved).toBe(1);
  expect(worklist[0]?.latest_activity_type).toBe("commit");
  expect(worklist[0]?.latest_activity_author).toBe("alice");
});

test("buildWorklist prefers updated_at when computing last activity", () => {
  const entries = [
    {
      ...baseEntry,
      id: "comment-1",
      pr: 20,
      type: "comment" as const,
      author: "alice",
      created_at: "2025-01-02T10:00:00.000Z",
      updated_at: "2025-01-02T12:00:00.000Z",
    },
    {
      ...baseEntry,
      id: "commit-1",
      pr: 20,
      type: "commit" as const,
      author: "bob",
      body: "Update code",
      created_at: "2025-01-02T11:00:00.000Z",
    },
  ];

  const worklist = buildWorklist(entries);
  expect(worklist).toHaveLength(1);
  expect(worklist[0]?.last_activity_at).toBe("2025-01-02T12:00:00.000Z");
  expect(worklist[0]?.latest_activity_type).toBe("comment");
  expect(worklist[0]?.latest_activity_author).toBe("alice");
});

test("sortWorklist orders by stack position when present", () => {
  const items = buildWorklist([
    {
      ...baseEntry,
      id: "comment-1",
      pr: 11,
      type: "comment" as const,
      author: "alice",
      graphite: {
        stack_id: "feat-auth",
        stack_position: 2,
        stack_size: 2,
      },
    },
    {
      ...baseEntry,
      id: "comment-2",
      pr: 12,
      type: "comment" as const,
      author: "bob",
      graphite: {
        stack_id: "feat-auth",
        stack_position: 1,
        stack_size: 2,
      },
    },
  ]);

  const sorted = sortWorklist(items);
  expect(sorted[0]?.pr).toBe(12);
  expect(sorted[1]?.pr).toBe(11);
});
