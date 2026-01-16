import { afterAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FirewatchEntry } from "@outfitter/firewatch-core";

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

await Bun.write(
  cachePath,
  `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`
);

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
