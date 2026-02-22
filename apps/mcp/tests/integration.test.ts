import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  closeFirewatchDb,
  ensureDirectories,
  getDatabase,
  insertEntries,
  PATHS,
  setSyncMeta,
  upsertPR,
  type FirewatchEntry,
  type PRMetadata,
} from "@outfitter/firewatch-core";
import { createSdkServer } from "@outfitter/mcp";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createServer } from "../src/index";

const tempRoot = await mkdtemp(join(tmpdir(), "firewatch-mcp-"));
const originalPaths = { ...PATHS };

const repo = "mcp-test/firewatch";
const entries: FirewatchEntry[] = [
  {
    id: "mcp-comment-1",
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
    id: "mcp-review-1",
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

const pr: PRMetadata = {
  repo,
  number: 10,
  state: "open",
  isDraft: false,
  title: "Add workflow",
  author: "alice",
  branch: "feature/workflow",
  labels: [],
};

// Set up test environment before tests run
beforeAll(async () => {
  // Close any existing database singleton before modifying paths
  closeFirewatchDb();

  Object.assign(PATHS as Record<string, string>, {
    cache: join(tempRoot, "cache"),
    config: join(tempRoot, "config"),
    data: join(tempRoot, "data"),
    repos: join(tempRoot, "cache", "repos"),
    meta: join(tempRoot, "cache", "meta.jsonl"),
    db: join(tempRoot, "cache", "firewatch.db"),
    configFile: join(tempRoot, "config", "config.toml"),
  });

  await ensureDirectories();

  // Use the singleton to ensure consistency with queryEntries()
  const db = getDatabase();
  upsertPR(db, pr);
  insertEntries(db, entries);
  setSyncMeta(db, {
    repo,
    scope: "open",
    last_sync: new Date().toISOString(),
    pr_count: 1,
  });
});

afterAll(async () => {
  closeFirewatchDb();
  Object.assign(PATHS as Record<string, string>, originalPaths);
  await rm(tempRoot, { recursive: true, force: true });
});

async function callTool(name: string, args: Record<string, unknown>) {
  const mcpServer = createServer();
  const sdkServer = createSdkServer(mcpServer);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "firewatch-test", version: "0.0.0" });

  await sdkServer.connect(serverTransport);
  await client.connect(clientTransport);

  const result = await client.callTool({
    name,
    arguments: args,
  });

  await client.close();
  await sdkServer.close();

  return result;
}

test("mcp tool fw_query returns jsonl entries", async () => {
  const result = await callTool("fw_query", {
    repo,
    type: "comment",
    no_sync: true,
  });

  expect(result.content).toHaveLength(1);
  const text = result.content[0].text;
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as FirewatchEntry);

  expect(lines).toHaveLength(1);
  expect(lines[0]?.id).toBe("mcp-comment-1");
});

test("mcp tool fw_query summary short returns per-PR summary", async () => {
  const result = await callTool("fw_query", {
    repo,
    summary_short: true,
    no_sync: true,
  });

  expect(result.content).toHaveLength(1);
  const text = result.content[0].text;
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map(
      (line) => JSON.parse(line) as { pr: number; changes_requested: number }
    );

  expect(lines).toHaveLength(1);
  expect(lines[0]?.pr).toBe(10);
  expect(lines[0]?.changes_requested).toBe(1);
});
