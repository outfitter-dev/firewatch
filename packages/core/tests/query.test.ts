import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FirewatchEntry } from "../src/schema/entry";

const tempRoot = await mkdtemp(join(tmpdir(), "firewatch-query-"));

const { ensureDirectories, getRepoCachePath, writeJsonl, PATHS } =
  await import("../src/cache");
const { queryEntries } = await import("../src/query");

const originalPaths = { ...PATHS };

afterAll(async () => {
  Object.assign(PATHS as Record<string, string>, originalPaths);
  await rm(tempRoot, { recursive: true, force: true });
});

Object.assign(PATHS as Record<string, string>, {
  cache: join(tempRoot, "cache"),
  config: join(tempRoot, "config"),
  data: join(tempRoot, "data"),
  repos: join(tempRoot, "cache", "repos"),
  meta: join(tempRoot, "cache", "meta.jsonl"),
  configFile: join(tempRoot, "config", "config.toml"),
});

await ensureDirectories();

const repoA = "outfitter-dev/firewatch";
const repoB = "outfitter-dev/other";

const entriesA: FirewatchEntry[] = [
  {
    id: "comment-1",
    repo: repoA,
    pr: 1,
    pr_title: "Fix auth flow",
    pr_state: "open",
    pr_author: "alice",
    pr_branch: "main",
    pr_labels: ["bug", "ui"],
    type: "comment",
    subtype: "issue_comment",
    author: "alice",
    body: "Looks good",
    created_at: "2025-01-02T03:00:00.000Z",
    updated_at: "2025-01-02T03:00:00.000Z",
    captured_at: "2025-01-02T04:00:00.000Z",
    url: "https://github.com/outfitter-dev/firewatch/pull/1",
  },
  {
    id: "review-1",
    repo: repoA,
    pr: 2,
    pr_title: "Add caching",
    pr_state: "draft",
    pr_author: "bob",
    pr_branch: "cache",
    pr_labels: ["infra"],
    type: "review",
    author: "carol",
    state: "approved",
    created_at: "2025-01-02T01:00:00.000Z",
    updated_at: "2025-01-02T01:00:00.000Z",
    captured_at: "2025-01-02T04:00:00.000Z",
    url: "https://github.com/outfitter-dev/firewatch/pull/2",
  },
];

const entriesB: FirewatchEntry[] = [
  {
    id: "commit-1",
    repo: repoB,
    pr: 5,
    pr_title: "Refactor core",
    pr_state: "closed",
    pr_author: "dana",
    pr_branch: "refactor",
    type: "commit",
    author: "dana",
    body: "Refactor modules",
    created_at: "2025-01-01T23:00:00.000Z",
    captured_at: "2025-01-02T04:00:00.000Z",
  },
];

await writeJsonl(getRepoCachePath(repoA), entriesA);
await writeJsonl(getRepoCachePath(repoB), entriesB);

test("queryEntries filters by repo substring", async () => {
  const results = await queryEntries({ filters: { repo: "firewatch" } });
  expect(results).toHaveLength(2);
  expect(results.every((entry) => entry.repo === repoA)).toBe(true);
});

test("queryEntries filters by label and state", async () => {
  const results = await queryEntries({
    filters: { label: "BUG", states: ["open"] },
  });
  expect(results).toHaveLength(1);
  expect(results[0]?.id).toBe("comment-1");
});

test("queryEntries filters by author", async () => {
  const results = await queryEntries({
    filters: { author: "carol" },
  });
  expect(results).toHaveLength(1);
  expect(results[0]?.id).toBe("review-1");
});

test("queryEntries applies since filter", async () => {
  const results = await queryEntries({
    filters: { since: new Date("2025-01-02T02:00:00.000Z") },
  });
  expect(results).toHaveLength(1);
  expect(results[0]?.id).toBe("comment-1");
});

test("queryEntries applies limit and offset", async () => {
  const results = await queryEntries({ offset: 1, limit: 1 });
  expect(results).toHaveLength(1);
  expect(results[0]?.id).toBe("review-1");
});
