import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  ensureDirectories,
  getRepoCachePath,
  PATHS,
  writeJsonl,
  type FirewatchEntry,
} from "@outfitter/firewatch-core";
import { createServer } from "../src/index";

const tempRoot = await mkdtemp(join(tmpdir(), "firewatch-mcp-"));
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
    pr: 10,
    pr_title: "Add workflow",
    pr_state: "open",
    pr_author: "alice",
    pr_branch: "feature/workflow",
    type: "comment",
    subtype: "issue_comment",
    author: "alice",
    body: "Needs update",
    created_at: "2025-01-02T03:00:00.000Z",
    captured_at: "2025-01-02T04:00:00.000Z",
  },
  {
    id: "review-1",
    repo,
    pr: 10,
    pr_title: "Add workflow",
    pr_state: "open",
    pr_author: "alice",
    pr_branch: "feature/workflow",
    type: "review",
    author: "bob",
    state: "changes_requested",
    body: "Fix tests",
    created_at: "2025-01-02T04:00:00.000Z",
    captured_at: "2025-01-02T05:00:00.000Z",
  },
];

await writeJsonl(getRepoCachePath(repo), entries);

afterAll(async () => {
  Object.assign(PATHS as Record<string, string>, originalPaths);
  await rm(tempRoot, { recursive: true, force: true });
});

async function callTool(args: Record<string, unknown>) {
  const server = createServer();
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "firewatch-test", version: "0.0.0" });

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const result = await client.callTool({
    name: "firewatch",
    arguments: args,
  });

  await client.close();
  await server.close();

  return result;
}

test("mcp tool query returns jsonl entries", async () => {
  const result = await callTool({
    action: "query",
    repo,
    type: "comment",
  });

  expect(result.content).toHaveLength(1);
  const text = result.content[0].text;
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as FirewatchEntry);

  expect(lines).toHaveLength(1);
  expect(lines[0]?.id).toBe("comment-1");
});

test("mcp tool status short returns per-PR summary", async () => {
  const result = await callTool({
    action: "status",
    repo,
    status_short: true,
  });

  expect(result.content).toHaveLength(1);
  const text = result.content[0].text;
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { pr: number; changes_requested: number });

  expect(lines).toHaveLength(1);
  expect(lines[0]?.pr).toBe(10);
  expect(lines[0]?.changes_requested).toBe(1);
});
