import { expect, test } from "bun:test";

import type { FirewatchEntry } from "@outfitter/firewatch-core";
import { ensureGraphiteMetadata, outputStackedEntries } from "../src/stack";

test("outputStackedEntries groups by stack and injects metadata", async () => {
  const entries: FirewatchEntry[] = [
    {
      id: "comment-1",
      repo: "outfitter-dev/firewatch",
      pr: 101,
      pr_title: "Base",
      pr_state: "open",
      pr_author: "alice",
      pr_branch: "base",
      type: "comment",
      author: "alice",
      created_at: "2025-01-02T03:00:00.000Z",
      captured_at: "2025-01-02T04:00:00.000Z",
    },
    {
      id: "comment-2",
      repo: "outfitter-dev/firewatch",
      pr: 102,
      pr_title: "Follow-up",
      pr_state: "open",
      pr_author: "bob",
      pr_branch: "follow",
      type: "comment",
      author: "bob",
      created_at: "2025-01-02T03:05:00.000Z",
      captured_at: "2025-01-02T04:00:00.000Z",
    },
  ];

  const stacks = [
    {
      name: "feat-auth",
      branches: [
        { name: "base", prNumber: 101 },
        { name: "follow", prNumber: 102 },
      ],
    },
  ];

  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (value?: unknown) => {
    logs.push(String(value));
  };

  try {
    const wrote = await outputStackedEntries(entries, { stacks });
    expect(wrote).toBe(true);
  } finally {
    console.log = originalLog;
  }

  expect(logs).toHaveLength(1);
  const group = JSON.parse(logs[0]!);
  expect(group.stack_id).toBe("feat-auth");
  expect(group.entries).toHaveLength(2);
  expect(group.entries[0].graphite?.stack_id).toBe("feat-auth");
  expect(group.entries[0].graphite?.stack_position).toBe(1);
  expect(group.entries[1].graphite?.stack_position).toBe(2);
});

test("ensureGraphiteMetadata fills missing metadata when some entries already have it", async () => {
  const entries: FirewatchEntry[] = [
    {
      id: "comment-1",
      repo: "outfitter-dev/firewatch",
      pr: 101,
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
      id: "comment-2",
      repo: "outfitter-dev/firewatch",
      pr: 102,
      pr_title: "Follow-up",
      pr_state: "open",
      pr_author: "bob",
      pr_branch: "follow",
      type: "comment",
      author: "bob",
      created_at: "2025-01-02T03:05:00.000Z",
      captured_at: "2025-01-02T04:00:00.000Z",
    },
  ];

  const stacks = [
    {
      name: "feat-auth",
      branches: [
        { name: "base", prNumber: 101 },
        { name: "follow", prNumber: 102 },
      ],
    },
  ];

  const enriched = await ensureGraphiteMetadata(entries, { stacks });

  expect(enriched[0]?.graphite?.stack_id).toBe("feat-auth");
  expect(enriched[0]?.graphite?.stack_position).toBe(1);
  expect(enriched[1]?.graphite?.stack_id).toBe("feat-auth");
  expect(enriched[1]?.graphite?.stack_position).toBe(2);
});
