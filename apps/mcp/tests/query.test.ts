import type {
  FirewatchConfig,
  FirewatchEntry,
} from "@outfitter/firewatch-core";
import { expect, test } from "bun:test";

import {
  buildQueryContext,
  buildQueryOptions,
  resolveQueryOutput,
  shouldEnrichGraphite,
} from "../src/query";

const baseEntry = {
  repo: "outfitter-dev/firewatch",
  pr_title: "Add query helpers",
  pr_state: "open" as const,
  pr_author: "alice",
  pr_branch: "feat/query",
  created_at: "2025-01-02T03:00:00.000Z",
  captured_at: "2025-01-02T04:00:00.000Z",
};

test("buildQueryContext uses provided values", () => {
  const config: FirewatchConfig = {
    repos: [],
    max_prs_per_sync: 100,
  };

  const context = buildQueryContext(
    { repo: "outfitter-dev/firewatch", since: "24h" },
    config,
    null
  );
  expect(context.repoFilter).toBe("outfitter-dev/firewatch");
  expect(context.states).toBeUndefined();
  expect(context.since).toBe("24h");
});

test("buildQueryOptions applies since and list filters", () => {
  const context = {
    repoFilter: "outfitter-dev/firewatch",
    states: ["open"],
    since: "24h",
    detectedRepo: "outfitter-dev/firewatch",
  };

  const before = Date.now();
  const options = buildQueryOptions(
    { pr: [1, 2], type: ["comment", "review"] },
    context
  );
  const after = Date.now();

  const since = options.filters?.since as Date;
  expect(since).toBeInstanceOf(Date);
  const expected = 24 * 60 * 60 * 1000;
  expect(since.getTime()).toBeGreaterThanOrEqual(before - expected);
  expect(since.getTime()).toBeLessThanOrEqual(after - expected);
});

test("shouldEnrichGraphite respects summary flag and repo match", () => {
  const context = {
    repoFilter: "outfitter-dev/firewatch",
    states: undefined,
    since: undefined,
    detectedRepo: "outfitter-dev/firewatch",
  };

  expect(shouldEnrichGraphite({ summary: true }, context)).toBe(true);
  expect(shouldEnrichGraphite({}, context)).toBe(false);
});

test("resolveQueryOutput builds worklist when summary is set", async () => {
  const entries: FirewatchEntry[] = [
    {
      ...baseEntry,
      id: "comment-1",
      pr: 1,
      type: "comment",
      author: "alice",
    },
    {
      ...baseEntry,
      id: "review-1",
      pr: 1,
      type: "review",
      author: "bob",
      state: "changes_requested",
    },
    {
      ...baseEntry,
      id: "comment-2",
      pr: 2,
      type: "comment",
      author: "carol",
      created_at: "2025-01-03T03:00:00.000Z",
      captured_at: "2025-01-03T04:00:00.000Z",
    },
  ];

  const context = {
    repoFilter: "outfitter-dev/firewatch",
    states: undefined,
    since: undefined,
    detectedRepo: "outfitter-dev/firewatch",
  };

  const output = await resolveQueryOutput({ summary: true }, entries, context, {
    enrichGraphite: (items) => Promise.resolve(items),
  });

  const worklist = output as {
    pr: number;
    counts: { comments: number; reviews: number };
    review_states?: { changes_requested: number };
  }[];
  expect(worklist).toHaveLength(2);
  expect(worklist[0]?.pr).toBe(2);
  expect(worklist[1]?.pr).toBe(1);
  expect(worklist[1]?.counts.comments).toBe(1);
  expect(worklist[1]?.counts.reviews).toBe(1);
  expect(worklist[1]?.review_states?.changes_requested).toBe(1);
});
