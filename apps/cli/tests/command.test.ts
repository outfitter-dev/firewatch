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

const tempRoot = await mkdtemp(join(tmpdir(), "firewatch-cli-"));
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
    pr: 42,
    pr_title: "Stack wiring",
    pr_state: "open",
    pr_author: "alice",
    pr_branch: "feat/stack",
    type: "comment",
    subtype: "issue_comment",
    author: "alice",
    body: "Check output",
    created_at: "2025-01-02T03:00:00.000Z",
    captured_at: "2025-01-02T04:00:00.000Z",
    graphite: {
      stack_id: "feat-stack",
      stack_position: 1,
      stack_size: 2,
    },
  },
  {
    id: "review-1",
    repo,
    pr: 42,
    pr_title: "Stack wiring",
    pr_state: "open",
    pr_author: "alice",
    pr_branch: "feat/stack",
    type: "review",
    author: "bob",
    state: "changes_requested",
    created_at: "2025-01-02T05:00:00.000Z",
    captured_at: "2025-01-02T05:10:00.000Z",
    graphite: {
      stack_id: "feat-stack",
      stack_position: 1,
      stack_size: 2,
    },
  },
  {
    id: "comment-2",
    repo,
    pr: 43,
    pr_title: "Stack wiring follow-up",
    pr_state: "open",
    pr_author: "bob",
    pr_branch: "feat/stack-2",
    type: "comment",
    subtype: "issue_comment",
    author: "bob",
    body: "Next PR",
    created_at: "2025-01-03T03:00:00.000Z",
    captured_at: "2025-01-03T04:00:00.000Z",
    graphite: {
      stack_id: "feat-stack",
      stack_position: 2,
      stack_size: 2,
    },
  },
];

// Create PR metadata for both PRs in the test data
const prs: PRMetadata[] = [
  {
    repo,
    number: 42,
    state: "open",
    isDraft: false,
    title: "Stack wiring",
    author: "alice",
    branch: "feat/stack",
    labels: [],
  },
  {
    repo,
    number: 43,
    state: "open",
    isDraft: false,
    title: "Stack wiring follow-up",
    author: "bob",
    branch: "feat/stack-2",
    labels: [],
  },
];

// Set up SQLite database with test data
const db = openDatabase(dbPath);
for (const pr of prs) {
  upsertPR(db, pr);
}
insertEntries(db, entries);
// Add sync metadata so hasRepoCache() returns true for offline mode
setSyncMeta(db, {
  repo,
  last_sync: new Date().toISOString(),
  pr_count: 2,
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

async function runCli(
  args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn({
    cmd: [process.execPath, "apps/cli/bin/fw.ts", ...args],
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
  const stderr = proc.stderr ? await new Response(proc.stderr).text() : "";
  const exitCode = await proc.exited;

  return { stdout, stderr, exitCode };
}

function parseLines(stdout: string): string[] {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

test("root command outputs filtered entries by type", async () => {
  const { stdout, stderr, exitCode } = await runCli([
    "--repo",
    repo,
    "--type",
    "review",
    "--jsonl",
    "--offline",
  ]);

  expect(exitCode).toBe(0);
  expect(stderr.trim()).toBe("");

  const lines = parseLines(stdout);
  expect(lines).toHaveLength(1);
  const entry = JSON.parse(lines[0]!);
  expect(entry.id).toBe("review-1");
});

test("root command summary outputs worklist entries", async () => {
  const { stdout, stderr, exitCode } = await runCli([
    "--repo",
    repo,
    "--summary",
    "--offline",
  ]);

  expect(exitCode).toBe(0);
  expect(stderr.trim()).toBe("");

  const lines = parseLines(stdout);
  expect(lines).toHaveLength(2);
  const worklist = lines.map((line) => JSON.parse(line));
  const prs = worklist.map((entry) => entry.pr).toSorted();
  expect(prs).toEqual([42, 43]);
});

test("--json alias works like --jsonl", async () => {
  const { stdout, stderr, exitCode } = await runCli([
    "--repo",
    repo,
    "--type",
    "review",
    "--json",
    "--offline",
  ]);

  expect(exitCode).toBe(0);
  expect(stderr.trim()).toBe("");
  const lines = parseLines(stdout);
  expect(lines).toHaveLength(1);
  const entry = JSON.parse(lines[0]!);
  expect(entry.id).toBe("review-1");
});
