import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { GitHubClient } from "../src/github";
import type { FirewatchEntry, SyncMetadata } from "../src/schema/entry";

const tempRoot = await mkdtemp(join(tmpdir(), "firewatch-sync-"));

const { ensureDirectories, getRepoCachePath, readJsonl, writeJsonl, PATHS } =
  await import("../src/cache");
const { syncRepo } = await import("../src/sync");

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

test("syncRepo uses last_sync when since is omitted", async () => {
  const repo = "outfitter-dev/firewatch";
  const lastSync = "2026-01-13T20:15:00.000Z";
  const meta: SyncMetadata = {
    repo,
    last_sync: lastSync,
    cursor: "cursor",
    pr_count: 1,
  };
  await writeJsonl(PATHS.meta, [meta]);

  type FetchOptions = Parameters<GitHubClient["fetchPRActivity"]>[2];
  const calls: { after: string | null }[] = [];
  const client = {
    fetchPRActivity: (
      _owner: string,
      _repo: string,
      options: FetchOptions = {}
    ) => {
      const optionsWithAfter = { after: null as string | null, ...options };
      calls.push({ after: optionsWithAfter.after });
      return Promise.resolve({
        repository: {
          pullRequests: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              {
                number: 1,
                title: "Sync test",
                state: "OPEN",
                isDraft: false,
                author: { login: "alice" },
                headRefName: "feat/sync",
                createdAt: "2026-01-13T19:00:00.000Z",
                updatedAt: "2026-01-13T20:30:00.000Z",
                url: "https://github.com/outfitter-dev/firewatch/pull/1",
                labels: { nodes: [] },
                reviews: { nodes: [] },
                comments: {
                  nodes: [
                    {
                      id: "comment-1",
                      author: { login: "alice" },
                      body: "Old",
                      createdAt: "2026-01-13T20:00:00.000Z",
                      updatedAt: "2026-01-13T20:00:00.000Z",
                    },
                    {
                      id: "comment-2",
                      author: { login: "bob" },
                      body: "New",
                      createdAt: "2026-01-13T20:20:00.000Z",
                      updatedAt: "2026-01-13T20:20:00.000Z",
                    },
                  ],
                },
                reviewThreads: { nodes: [] },
                commits: { nodes: [] },
              },
            ],
          },
        },
      });
    },
  } as GitHubClient;

  const result = await syncRepo(client, repo);

  expect(calls).toHaveLength(1);
  expect(calls[0].after).toBeNull();
  expect(result.prsProcessed).toBe(1);

  const entries = await readJsonl<FirewatchEntry>(getRepoCachePath(repo));
  expect(entries).toHaveLength(1);
  expect(entries[0]?.id).toBe("comment-2");
});
