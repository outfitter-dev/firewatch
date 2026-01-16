import { afterAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FirewatchEntry } from "@outfitter/firewatch-core";

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

const reposDir = join(paths.cache, "repos");
await mkdir(reposDir, { recursive: true });
await mkdir(paths.config, { recursive: true });
await mkdir(paths.data, { recursive: true });

const repo = "outfitter-dev/firewatch";
const encoded = Buffer.from(repo, "utf8").toString("base64url");
const cachePath = join(reposDir, `b64~${encoded}.jsonl`);

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

await Bun.write(
  cachePath,
  `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`
);

afterAll(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

async function runCli(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
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

test("root command outputs filtered entries by type", async () => {
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
