import { expect, test } from "bun:test";

import type { FirewatchEntry } from "@outfitter/firewatch-core";
import { outputStatusShort } from "../src/status";

test("outputStatusShort emits a tight per-PR summary", async () => {
  const entries: FirewatchEntry[] = [
    {
      id: "comment-1",
      repo: "outfitter-dev/firewatch",
      pr: 10,
      pr_title: "Base",
      pr_state: "open",
      pr_author: "alice",
      pr_branch: "base",
      type: "comment",
      author: "alice",
      created_at: "2025-01-02T03:00:00.000Z",
      captured_at: "2025-01-02T04:00:00.000Z",
      graphite: {
        stack_id: "feat-auth",
        stack_position: 1,
        stack_size: 2,
      },
    },
    {
      id: "review-1",
      repo: "outfitter-dev/firewatch",
      pr: 10,
      pr_title: "Base",
      pr_state: "open",
      pr_author: "alice",
      pr_branch: "base",
      type: "review",
      author: "bob",
      state: "changes_requested",
      created_at: "2025-01-02T03:10:00.000Z",
      captured_at: "2025-01-02T04:00:00.000Z",
      graphite: {
        stack_id: "feat-auth",
        stack_position: 1,
        stack_size: 2,
      },
    },
    {
      id: "comment-2",
      repo: "outfitter-dev/firewatch",
      pr: 11,
      pr_title: "Follow-up",
      pr_state: "open",
      pr_author: "bob",
      pr_branch: "follow",
      type: "comment",
      author: "bob",
      created_at: "2025-01-02T03:05:00.000Z",
      captured_at: "2025-01-02T04:00:00.000Z",
      graphite: {
        stack_id: "feat-auth",
        stack_position: 2,
        stack_size: 2,
      },
    },
  ];

  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (value?: unknown) => {
    logs.push(String(value));
  };

  try {
    const wrote = await outputStatusShort(entries);
    expect(wrote).toBe(true);
  } finally {
    console.log = originalLog;
  }

  expect(logs).toHaveLength(2);

  const first = JSON.parse(logs[0]!);
  expect(first.pr).toBe(10);
  expect(first.comments).toBe(1);
  expect(first.changes_requested).toBe(1);
  expect(first.stack_id).toBe("feat-auth");
  expect(first.stack_position).toBe(1);

  const second = JSON.parse(logs[1]!);
  expect(second.pr).toBe(11);
  expect(second.comments).toBe(1);
  expect(second.changes_requested).toBe(0);
  expect(second.stack_position).toBe(2);
});
