import {
  closeDatabase,
  insertEntries,
  openDatabase,
  setSyncMeta,
  upsertPR,
  type FirewatchEntry,
  type PRMetadata,
} from "@outfitter/firewatch-core";
import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempRoot = await mkdtemp(join(tmpdir(), "firewatch-fb-command-"));
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

// Create entries with review comments that represent feedback
const entries: FirewatchEntry[] = [
  {
    id: "PRRC_review-comment-1",
    repo,
    pr: 60,
    pr_title: "Add validation",
    pr_state: "open",
    pr_author: "alice",
    pr_branch: "feat/validation",
    type: "comment",
    subtype: "review_comment",
    author: "bob",
    body: "Should we add input sanitization here?",
    file: "src/validator.ts",
    line: 25,
    created_at: "2025-01-18T10:00:00.000Z",
    captured_at: "2025-01-18T10:05:00.000Z",
  },
  {
    id: "PRRC_review-comment-2",
    repo,
    pr: 60,
    pr_title: "Add validation",
    pr_state: "open",
    pr_author: "alice",
    pr_branch: "feat/validation",
    type: "comment",
    subtype: "review_comment",
    author: "charlie",
    body: "Consider using Zod for runtime validation",
    file: "src/validator.ts",
    line: 42,
    thread_resolved: true,
    created_at: "2025-01-18T11:00:00.000Z",
    captured_at: "2025-01-18T11:05:00.000Z",
  },
  {
    id: "IC_issue-comment-1",
    repo,
    pr: 60,
    pr_title: "Add validation",
    pr_state: "open",
    pr_author: "alice",
    pr_branch: "feat/validation",
    type: "comment",
    subtype: "issue_comment",
    author: "dave",
    body: "Great work! Can we add docs?",
    created_at: "2025-01-18T12:00:00.000Z",
    captured_at: "2025-01-18T12:05:00.000Z",
  },
  {
    id: "PRRC_review-comment-3",
    repo,
    pr: 61,
    pr_title: "Refactor auth",
    pr_state: "open",
    pr_author: "bob",
    pr_branch: "refactor/auth",
    type: "comment",
    subtype: "review_comment",
    author: "alice",
    body: "This needs error handling",
    file: "src/auth.ts",
    line: 100,
    created_at: "2025-01-19T09:00:00.000Z",
    captured_at: "2025-01-19T09:05:00.000Z",
  },
];

const prs: PRMetadata[] = [
  {
    repo,
    number: 60,
    state: "open",
    isDraft: false,
    title: "Add validation",
    author: "alice",
    branch: "feat/validation",
    labels: [],
  },
  {
    repo,
    number: 61,
    state: "open",
    isDraft: false,
    title: "Refactor auth",
    author: "bob",
    branch: "refactor/auth",
    labels: [],
  },
];

const db = openDatabase(dbPath);
for (const pr of prs) {
  upsertPR(db, pr);
}
insertEntries(db, entries);
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

describe("fw fb", () => {
  test("fb --help shows usage", async () => {
    const { stdout, exitCode } = await runCli(["fb", "--help"]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Feedback abstraction");
    expect(stdout).toContain("--todo");
    expect(stdout).toContain("--all");
    expect(stdout).toContain("--ack");
    expect(stdout).toContain("--resolve");
    expect(stdout).toContain("--offline");
  });

  test("fb lists feedback with short IDs", async () => {
    const { stdout, exitCode } = await runCli([
      "fb",
      "--repo",
      repo,
      "--all",
      "--jsonl",
      "--offline",
    ]);

    expect(exitCode).toBe(0);

    // Should output feedback entries
    const lines = stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);

    // Each entry should have id (short ID format)
    const entry = JSON.parse(lines[0]!);
    expect(entry).toHaveProperty("id");
    expect(entry.id).toMatch(/^@[a-f0-9]{5}$/);
    // Should also have gh_id for the full GitHub ID
    expect(entry).toHaveProperty("gh_id");
  });

  test("fb <pr> filters to specific PR", async () => {
    const { stdout, exitCode } = await runCli([
      "fb",
      "60",
      "--repo",
      repo,
      "--all",
      "--jsonl",
      "--offline",
    ]);

    expect(exitCode).toBe(0);

    const lines = stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    // All entries should be from PR 60
    for (const line of lines) {
      const entry = JSON.parse(line);
      expect(entry.pr).toBe(60);
    }
  });

  test("fb --todo filters to unaddressed feedback only", async () => {
    const { stdout, exitCode } = await runCli([
      "fb",
      "--repo",
      repo,
      "--todo",
      "--jsonl",
      "--offline",
    ]);

    expect(exitCode).toBe(0);

    const lines = stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    // Should exclude resolved threads
    for (const line of lines) {
      const entry = JSON.parse(line);
      // Resolved threads should not appear in --todo output
      expect(entry.thread_resolved).not.toBe(true);
    }
  });

  test("fb text output shows formatted feedback", async () => {
    const { stdout, exitCode } = await runCli([
      "fb",
      "60",
      "--repo",
      repo,
      "--all",
      "--no-jsonl",
      "--offline",
    ]);

    expect(exitCode).toBe(0);

    // Text output should include PR title and short IDs
    expect(stdout).toContain("Add validation");
    expect(stdout).toMatch(/@[a-f0-9]{5}/); // Short ID format
  });
});
