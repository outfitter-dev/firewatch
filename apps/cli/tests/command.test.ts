import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ensureDirectories,
  getRepoCachePath,
  PATHS,
  writeJsonl,
  type FirewatchEntry,
} from "@outfitter/firewatch-core";
import { program } from "../src";
import { statusCommand } from "../src/commands/status";
import { captureStdout } from "./helpers";

const tempRoot = await mkdtemp(join(tmpdir(), "firewatch-cli-"));
const originalPaths = { ...PATHS };

Object.assign(PATHS as Record<string, string>, {
  cache: join(tempRoot, "cache"),
  config: join(tempRoot, "config"),
  data: join(tempRoot, "data"),
  repos: join(tempRoot, "cache", "repos"),
  meta: join(tempRoot, "cache", "meta.jsonl"),
  configFile: join(tempRoot, "config", "config.toml"),
});

await ensureDirectories();

const repo = "outfitter-dev/firewatch";
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

await writeJsonl(getRepoCachePath(repo), entries);

afterAll(async () => {
  Object.assign(PATHS as Record<string, string>, originalPaths);
  await rm(tempRoot, { recursive: true, force: true });
});

test("status command wiring outputs short summaries", async () => {
  const logs = await captureStdout(() =>
    statusCommand.parseAsync(["node", "status", "--short"])
  );

  expect(logs).toHaveLength(2);
  const first = JSON.parse(logs[0]!);
  expect(first.pr).toBe(42);
  expect(first.changes_requested).toBe(1);
});

test("root command stack wiring groups entries", async () => {
  const originalCwd = process.cwd();
  process.chdir(tempRoot);

  try {
    const logs = await captureStdout(() =>
      program.parseAsync(["node", "fw", repo, "--stack"])
    );

    expect(logs).toHaveLength(1);
    const group = JSON.parse(logs[0]!);
    expect(group.stack_id).toBe("feat-stack");
    expect(group.entries).toHaveLength(3);
  } finally {
    process.chdir(originalCwd);
  }
});

test("root command query outputs filtered entries", async () => {
  const originalCwd = process.cwd();
  process.chdir(tempRoot);

  try {
    const logs = await captureStdout(() =>
      program.parseAsync(["node", "fw", repo, "--type", "review"])
    );

    expect(logs).toHaveLength(1);
    const entry = JSON.parse(logs[0]!);
    expect(entry.id).toBe("review-1");
  } finally {
    process.chdir(originalCwd);
  }
});

test("query subcommand outputs filtered entries", async () => {
  const logs = await captureStdout(() =>
    program.parseAsync([
      "node",
      "fw",
      "query",
      "--repo",
      repo,
      "--type",
      "comment",
    ])
  );

  expect(logs).toHaveLength(2);
  const ids = logs.map((line) => JSON.parse(line).id).toSorted();
  expect(ids).toEqual(["comment-1", "comment-2"]);
});
