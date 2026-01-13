import { expect, test } from "bun:test";

import type { FirewatchConfig, FirewatchEntry } from "@outfitter/firewatch-core";
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

test("buildQueryContext uses config defaults when params omit values", () => {
  const config: FirewatchConfig = {
    repos: [],
    graphite_enabled: false,
    default_stack: false,
    default_since: "24h",
    default_states: ["open"],
    max_prs_per_sync: 100,
  };

  const context = buildQueryContext({}, config, "outfitter-dev/firewatch");
  expect(context.repoFilter).toBe("outfitter-dev/firewatch");
  expect(context.states).toEqual(["open"]);
  expect(context.since).toBe("24h");
});

test("buildQueryOptions applies since from context", () => {
  const config: FirewatchConfig = {
    repos: [],
    graphite_enabled: false,
    default_stack: false,
    default_since: "24h",
    max_prs_per_sync: 100,
  };

  const context = buildQueryContext({}, config, "outfitter-dev/firewatch");
  const before = Date.now();
  const options = buildQueryOptions({}, context);
  const after = Date.now();

  const since = options.filters?.since as Date;
  expect(since).toBeInstanceOf(Date);
  const expected = 24 * 60 * 60 * 1000;
  expect(since.getTime()).toBeGreaterThanOrEqual(before - expected);
  expect(since.getTime()).toBeLessThanOrEqual(after - expected);
});

test("buildQueryContext honors explicit states from params", () => {
  const config: FirewatchConfig = {
    repos: [],
    graphite_enabled: false,
    default_stack: false,
    default_since: "24h",
    default_states: ["open"],
    max_prs_per_sync: 100,
  };

  const context = buildQueryContext(
    { states: ["closed", "merged"] },
    config,
    "outfitter-dev/firewatch"
  );

  expect(context.states).toEqual(["closed", "merged"]);
});

test("shouldEnrichGraphite returns false without stack flags", () => {
  const context = {
    repoFilter: "outfitter-dev/firewatch",
    states: undefined,
    since: undefined,
    detectedRepo: "outfitter-dev/firewatch",
  };

  expect(shouldEnrichGraphite({}, context)).toBe(false);
});

test("shouldEnrichGraphite returns true when stack flags are set and repo matches", () => {
  const context = {
    repoFilter: "outfitter-dev/firewatch",
    states: undefined,
    since: undefined,
    detectedRepo: "outfitter-dev/firewatch",
  };

  expect(shouldEnrichGraphite({ worklist: true }, context)).toBe(true);
});

test("shouldEnrichGraphite returns false when repo does not match", () => {
  const context = {
    repoFilter: "outfitter-dev/other",
    states: undefined,
    since: undefined,
    detectedRepo: "outfitter-dev/firewatch",
  };

  expect(shouldEnrichGraphite({ worklist: true }, context)).toBe(false);
});

test("resolveQueryOutput enriches and filters by stack id", async () => {
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
      id: "comment-2",
      pr: 2,
      type: "comment",
      author: "bob",
    },
  ];

  const context = {
    repoFilter: "outfitter-dev/firewatch",
    states: undefined,
    since: undefined,
    detectedRepo: "outfitter-dev/firewatch",
  };

  let called = 0;
  const stackIds = ["stack-1", "stack-2"];
  const output = await resolveQueryOutput(
    { stack_id: "stack-1" },
    entries,
    context,
    {
      enrichGraphite: (items) => {
        called += 1;
        return Promise.resolve(
          items.map((entry, index) => ({
            ...entry,
            graphite: {
              stack_id: stackIds[index]!,
              stack_position: index + 1,
              stack_size: items.length,
            },
          }))
        );
      },
    }
  );

  expect(called).toBe(1);
  expect(output).toHaveLength(1);
  const [first] = output as FirewatchEntry[];
  expect(first.pr).toBe(1);
});

test("resolveQueryOutput groups entries when group_stack is set", async () => {
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
      id: "comment-2",
      pr: 2,
      type: "comment",
      author: "bob",
    },
    {
      ...baseEntry,
      id: "comment-3",
      pr: 3,
      type: "comment",
      author: "carol",
    },
  ];

  const context = {
    repoFilter: "outfitter-dev/firewatch",
    states: undefined,
    since: undefined,
    detectedRepo: "outfitter-dev/firewatch",
  };

  const stackIds = ["stack-1", "stack-1", "stack-2"];
  const output = await resolveQueryOutput(
    { group_stack: true },
    entries,
    context,
    {
      enrichGraphite: (items) =>
        Promise.resolve(
          items.map((entry, index) => ({
            ...entry,
            graphite: {
              stack_id: stackIds[index]!,
              stack_position: index + 1,
              stack_size: items.length,
            },
          }))
        ),
    }
  );

  expect(output).toHaveLength(2);
  const groups = output as { stack_id: string; entries: FirewatchEntry[] }[];
  expect(groups[0]?.stack_id).toBe("stack-1");
  expect(groups[0]?.entries).toHaveLength(2);
  expect(groups[1]?.stack_id).toBe("stack-2");
  expect(groups[1]?.entries).toHaveLength(1);
});

test("resolveQueryOutput builds a worklist when worklist flag is set", async () => {
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

  const output = await resolveQueryOutput(
    { worklist: true },
    entries,
    context,
    {
      enrichGraphite: (items) => Promise.resolve(items),
    }
  );

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
