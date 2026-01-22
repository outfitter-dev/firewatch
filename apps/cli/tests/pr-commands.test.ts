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

const tempRoot = await mkdtemp(join(tmpdir(), "firewatch-pr-commands-"));
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
    id: "comment-pr-1",
    repo,
    pr: 50,
    pr_title: "Add feature X",
    pr_state: "open",
    pr_author: "alice",
    pr_branch: "feat/x",
    type: "comment",
    subtype: "issue_comment",
    author: "bob",
    body: "Looks good!",
    created_at: "2025-01-15T10:00:00.000Z",
    captured_at: "2025-01-15T10:05:00.000Z",
  },
  {
    id: "review-pr-1",
    repo,
    pr: 50,
    pr_title: "Add feature X",
    pr_state: "open",
    pr_author: "alice",
    pr_branch: "feat/x",
    type: "review",
    author: "charlie",
    state: "approved",
    created_at: "2025-01-15T11:00:00.000Z",
    captured_at: "2025-01-15T11:05:00.000Z",
  },
  {
    id: "comment-pr-2",
    repo,
    pr: 51,
    pr_title: "Fix bug Y",
    pr_state: "open",
    pr_author: "bob",
    pr_branch: "fix/y",
    type: "comment",
    subtype: "review_comment",
    author: "alice",
    body: "Please add a test",
    file: "src/index.ts",
    line: 42,
    created_at: "2025-01-16T09:00:00.000Z",
    captured_at: "2025-01-16T09:05:00.000Z",
  },
];

const prs: PRMetadata[] = [
  {
    repo,
    number: 50,
    state: "open",
    isDraft: false,
    title: "Add feature X",
    author: "alice",
    branch: "feat/x",
    labels: ["enhancement"],
  },
  {
    repo,
    number: 51,
    state: "open",
    isDraft: false,
    title: "Fix bug Y",
    author: "bob",
    branch: "fix/y",
    labels: ["bug"],
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

async function runCli(
  args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn({
    cmd: [process.execPath, "apps/cli/bin/fw.ts", ...args],
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOME: tempRoot,
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

describe("fw pr", () => {
  test("pr --help shows subcommands", async () => {
    const { stdout, exitCode } = await runCli(["pr", "--help"]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("list");
    expect(stdout).toContain("edit");
    expect(stdout).toContain("comment");
    expect(stdout).toContain("review");
  });

  test("pr list outputs entries in offline mode", async () => {
    const { stdout, stderr, exitCode } = await runCli([
      "pr",
      "list",
      "--repo",
      repo,
      "--json",
      "--offline",
    ]);

    expect(exitCode).toBe(0);
    expect(stderr.trim()).toBe("");

    const lines = parseLines(stdout);
    expect(lines.length).toBeGreaterThan(0);

    const entry = JSON.parse(lines[0]!);
    expect(entry.repo).toBe(repo);
  });

  test("pr list --summary aggregates by PR", async () => {
    const { stdout, stderr, exitCode } = await runCli([
      "pr",
      "list",
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
    const prNumbers = worklist.map((entry) => entry.pr).toSorted();
    expect(prNumbers).toEqual([50, 51]);
  });

  test("pr list filters by --type", async () => {
    const { stdout, exitCode } = await runCli([
      "pr",
      "list",
      "--repo",
      repo,
      "--type",
      "review",
      "--json",
      "--offline",
    ]);

    expect(exitCode).toBe(0);

    const lines = parseLines(stdout);
    expect(lines).toHaveLength(1);

    const entry = JSON.parse(lines[0]!);
    expect(entry.type).toBe("review");
    expect(entry.id).toBe("review-pr-1");
  });

  test("pr list filters by --prs", async () => {
    const { stdout, exitCode } = await runCli([
      "pr",
      "list",
      "--repo",
      repo,
      "--prs",
      "51",
      "--json",
      "--offline",
    ]);

    expect(exitCode).toBe(0);

    const lines = parseLines(stdout);
    expect(lines).toHaveLength(1);

    const entry = JSON.parse(lines[0]!);
    expect(entry.pr).toBe(51);
  });

  test("pr edit --help shows gh-aligned options", async () => {
    const { stdout, exitCode } = await runCli(["pr", "edit", "--help"]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("--add-label");
    expect(stdout).toContain("--remove-label");
    expect(stdout).toContain("--add-reviewer");
    expect(stdout).toContain("--remove-reviewer");
    expect(stdout).toContain("--add-assignee");
    expect(stdout).toContain("--remove-assignee");
  });

  test("pr comment --help shows required arguments", async () => {
    const { stdout, exitCode } = await runCli(["pr", "comment", "--help"]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("<pr>");
    expect(stdout).toContain("<body>");
  });

  test("pr review --help shows review options", async () => {
    const { stdout, exitCode } = await runCli(["pr", "review", "--help"]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("--approve");
    expect(stdout).toContain("--request-changes");
    expect(stdout).toContain("--comment");
  });
});
