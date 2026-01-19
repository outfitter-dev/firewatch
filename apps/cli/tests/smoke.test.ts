import {
  closeDatabase,
  insertEntries,
  openDatabase,
  setSyncMeta,
  upsertPR,
  type FirewatchEntry,
  type PRMetadata,
} from "@outfitter/firewatch-core";
import { afterAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempRoot = await mkdtemp(join(tmpdir(), "firewatch-cli-smoke-"));
const paths =
  process.platform === "darwin"
    ? {
        cache: join(tempRoot, "Library", "Caches", "firewatch"),
        config: join(tempRoot, "Library", "Preferences", "firewatch"),
        data: join(tempRoot, "Library", "Application Support", "firewatch"),
      }
    : {
        cache: join(tempRoot, ".cache", "firewatch"),
        config: join(tempRoot, ".config", "firewatch"),
        data: join(tempRoot, ".local", "share", "firewatch"),
      };

await mkdir(paths.cache, { recursive: true });
await mkdir(paths.config, { recursive: true });
await mkdir(paths.data, { recursive: true });

const repo = "outfitter-dev/firewatch";
const dbPath = join(paths.cache, "firewatch.db");

const entries: FirewatchEntry[] = [
  {
    id: "comment-1",
    repo,
    pr: 101,
    pr_title: "Smoke test",
    pr_state: "open",
    pr_author: "alice",
    pr_branch: "feat/smoke",
    type: "comment",
    author: "bob",
    created_at: "2025-01-02T03:00:00.000Z",
    captured_at: "2025-01-02T03:05:00.000Z",
  },
];

// Create PR metadata for the test entry
const pr: PRMetadata = {
  repo,
  number: 101,
  state: "open",
  isDraft: false,
  title: "Smoke test",
  author: "alice",
  branch: "feat/smoke",
  labels: [],
};

// Set up SQLite database with test data
const db = openDatabase(dbPath);
upsertPR(db, pr);
insertEntries(db, entries);
setSyncMeta(db, {
  repo,
  last_sync: new Date().toISOString(),
  pr_count: 1,
});
closeDatabase(db);

afterAll(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

test("cli smoke runs root command against cached data", async () => {
  const proc = Bun.spawn({
    cmd: [
      process.execPath,
      "apps/cli/bin/fw.ts",
      "--repo",
      repo,
      "--summary",
      "--offline",
    ],
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOME: tempRoot,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  expect(exitCode).toBe(0);
  expect(stderr.trim()).toBe("");

  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  expect(lines).toHaveLength(1);
  const parsed = JSON.parse(lines[0]!);
  expect(parsed.pr).toBe(101);
});
