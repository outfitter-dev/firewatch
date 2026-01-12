import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FirewatchEntry } from "../src/schema/entry";

const tempRoot = await mkdtemp(join(tmpdir(), "firewatch-check-"));

const { ensureDirectories, getRepoCachePath, readJsonl, writeJsonl, PATHS } =
  await import("../src/cache");
const { checkRepo } = await import("../src/check");

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

test("checkRepo updates file_activity_after for comments", async () => {
  const repo = "outfitter-dev/firewatch";
  const entries: FirewatchEntry[] = [
    {
      id: "comment-1",
      repo,
      pr: 42,
      pr_title: "Add check",
      pr_state: "open",
      pr_author: "alice",
      pr_branch: "feat/check",
      type: "comment",
      subtype: "review_comment",
      author: "bob",
      body: "Needs work",
      created_at: "2025-01-01T00:00:00.000Z",
      captured_at: "2025-01-02T00:00:00.000Z",
    },
    {
      id: "commit-1",
      repo,
      pr: 42,
      pr_title: "Add check",
      pr_state: "open",
      pr_author: "alice",
      pr_branch: "feat/check",
      type: "commit",
      author: "alice",
      body: "Fix comment",
      created_at: "2025-01-02T12:00:00.000Z",
      captured_at: "2025-01-02T12:01:00.000Z",
    },
    {
      id: "comment-2",
      repo,
      pr: 42,
      pr_title: "Add check",
      pr_state: "open",
      pr_author: "alice",
      pr_branch: "feat/check",
      type: "comment",
      subtype: "review_comment",
      author: "bob",
      body: "Another note",
      created_at: "2025-01-03T00:00:00.000Z",
      captured_at: "2025-01-03T00:01:00.000Z",
    },
  ];

  await writeJsonl(getRepoCachePath(repo), entries);

  const result = await checkRepo(repo);
  expect(result.comments_checked).toBe(2);
  expect(result.entries_updated).toBe(2);

  const updated = await readJsonl<FirewatchEntry>(getRepoCachePath(repo));
  const firstComment = updated.find((entry) => entry.id === "comment-1");
  const secondComment = updated.find((entry) => entry.id === "comment-2");

  expect(firstComment?.file_activity_after?.modified).toBe(true);
  expect(firstComment?.file_activity_after?.commits_touching_file).toBe(1);
  expect(firstComment?.file_activity_after?.latest_commit).toBe("commit-1");
  expect(firstComment?.file_activity_after?.latest_commit_at).toBe(
    "2025-01-02T12:00:00.000Z"
  );

  expect(secondComment?.file_activity_after?.modified).toBe(false);
  expect(secondComment?.file_activity_after?.commits_touching_file).toBe(0);
});
