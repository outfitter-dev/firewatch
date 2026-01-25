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
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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

// Create config to disable auto-sync (no network calls in tests)
await writeFile(join(paths.config, "config.toml"), "[sync]\nauto_sync = false\n");

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
  scope: "open",
  last_sync: new Date().toISOString(),
  pr_count: 1,
});
closeDatabase(db);

afterAll(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

// Compute XDG base dirs (parent of app-specific /firewatch suffix)
const xdgCacheHome =
  process.platform === "darwin"
    ? join(tempRoot, "Library", "Caches")
    : join(tempRoot, ".cache");
const xdgConfigHome =
  process.platform === "darwin"
    ? join(tempRoot, "Library", "Preferences")
    : join(tempRoot, ".config");
const xdgDataHome =
  process.platform === "darwin"
    ? join(tempRoot, "Library", "Application Support")
    : join(tempRoot, ".local", "share");

test("cli smoke runs root command against cached data", async () => {
  const proc = Bun.spawn({
    cmd: [
      process.execPath,
      "apps/cli/bin/fw.ts",
      "--repo",
      repo,
      "--summary",
    ],
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOME: tempRoot,
      // Override XDG variables to ensure isolation from user's environment
      XDG_CACHE_HOME: xdgCacheHome,
      XDG_CONFIG_HOME: xdgConfigHome,
      XDG_DATA_HOME: xdgDataHome,
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
