import type { FirewatchEntry } from "@outfitter/firewatch-core";
import { expect, test } from "bun:test";

import {
  buildActionableSummary,
  identifyUnaddressedFeedback,
} from "../src/actionable";

const repo = "outfitter-dev/firewatch";

test("identifyUnaddressedFeedback ignores comments with newer commits or file updates", () => {
  const entries: FirewatchEntry[] = [
    {
      id: "comment-1",
      repo,
      pr: 1,
      pr_title: "Sync pipeline",
      pr_state: "open",
      pr_author: "alice",
      pr_branch: "feat/sync",
      type: "comment",
      author: "bob",
      created_at: "2025-01-02T03:00:00.000Z",
      captured_at: "2025-01-02T03:05:00.000Z",
    },
    {
      id: "commit-1",
      repo,
      pr: 1,
      pr_title: "Sync pipeline",
      pr_state: "open",
      pr_author: "alice",
      pr_branch: "feat/sync",
      type: "commit",
      author: "alice",
      created_at: "2025-01-02T04:00:00.000Z",
      captured_at: "2025-01-02T04:05:00.000Z",
    },
    {
      id: "comment-2",
      repo,
      pr: 2,
      pr_title: "Cache updates",
      pr_state: "open",
      pr_author: "carol",
      pr_branch: "feat/cache",
      type: "comment",
      author: "dave",
      file: "src/cache.ts",
      file_activity_after: {
        modified: false,
        commits_touching_file: 0,
      },
      created_at: "2025-01-03T03:00:00.000Z",
      captured_at: "2025-01-03T03:05:00.000Z",
    },
    {
      id: "comment-3",
      repo,
      pr: 3,
      pr_title: "CLI refresh",
      pr_state: "open",
      pr_author: "emma",
      pr_branch: "feat/cli",
      type: "comment",
      author: "frank",
      file: "src/index.ts",
      file_activity_after: {
        modified: true,
        commits_touching_file: 2,
        latest_commit: "abc123",
        latest_commit_at: "2025-01-03T07:00:00.000Z",
      },
      created_at: "2025-01-03T04:00:00.000Z",
      captured_at: "2025-01-03T04:05:00.000Z",
    },
    {
      id: "comment-4",
      repo,
      pr: 4,
      pr_title: "Actionable summary",
      pr_state: "open",
      pr_author: "gina",
      pr_branch: "feat/actionable",
      type: "comment",
      author: "henry",
      file: "src/actionable.ts",
      created_at: "2025-01-04T03:00:00.000Z",
      captured_at: "2025-01-04T03:05:00.000Z",
    },
    {
      id: "commit-2",
      repo,
      pr: 4,
      pr_title: "Actionable summary",
      pr_state: "open",
      pr_author: "gina",
      pr_branch: "feat/actionable",
      type: "commit",
      author: "gina",
      created_at: "2025-01-04T01:00:00.000Z",
      captured_at: "2025-01-04T01:05:00.000Z",
    },
  ];

  const feedback = identifyUnaddressedFeedback(entries);
  const commentIds = feedback.map((item) => item.comment_id);

  expect(commentIds).toEqual(["comment-2", "comment-4"]);
});

test("buildActionableSummary groups categories and respects perspective", () => {
  const now = new Date();
  const nowIso = now.toISOString();
  const staleIso = new Date(
    now.getTime() - 10 * 24 * 60 * 60 * 1000
  ).toISOString();

  const entries: FirewatchEntry[] = [
    {
      id: "review-10",
      repo,
      pr: 10,
      pr_title: "Cache setup",
      pr_state: "open",
      pr_author: "alice",
      pr_branch: "feat/cache",
      type: "review",
      author: "dave",
      state: "changes_requested",
      created_at: nowIso,
      captured_at: nowIso,
    },
    {
      id: "comment-11",
      repo,
      pr: 11,
      pr_title: "Stack view",
      pr_state: "open",
      pr_author: "alice",
      pr_branch: "feat/stack",
      type: "comment",
      author: "bob",
      created_at: nowIso,
      captured_at: nowIso,
    },
    {
      id: "review-11",
      repo,
      pr: 11,
      pr_title: "Stack view",
      pr_state: "open",
      pr_author: "alice",
      pr_branch: "feat/stack",
      type: "review",
      author: "carol",
      state: "changes_requested",
      created_at: nowIso,
      captured_at: nowIso,
    },
    {
      id: "comment-12",
      repo,
      pr: 12,
      pr_title: "Refactor output",
      pr_state: "open",
      pr_author: "alice",
      pr_branch: "feat/refactor",
      type: "comment",
      author: "alice",
      created_at: nowIso,
      captured_at: nowIso,
    },
    {
      id: "review-13",
      repo,
      pr: 13,
      pr_title: "Old workflow",
      pr_state: "open",
      pr_author: "bob",
      pr_branch: "feat/old",
      type: "review",
      author: "carol",
      state: "commented",
      created_at: staleIso,
      captured_at: staleIso,
    },
  ];

  const summary = buildActionableSummary(repo, entries);
  expect(summary.counts).toEqual({
    unaddressed: 1,
    changes_requested: 1,
    awaiting_review: 1,
    stale: 1,
    total: 4,
  });

  const pr11Items = summary.items.filter((item) => item.pr === 11);
  expect(pr11Items).toHaveLength(1);
  expect(pr11Items[0]?.category).toBe("unaddressed");

  const mineSummary = buildActionableSummary(repo, entries, "mine", "alice");
  expect(mineSummary.items.every((item) => item.pr_author === "alice")).toBe(
    true
  );
  expect(mineSummary.counts.stale).toBe(0);
  expect(mineSummary.counts.total).toBe(3);
});
