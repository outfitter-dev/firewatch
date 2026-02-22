# MCP Server

Firewatch provides an MCP (Model Context Protocol) server for AI agent integration. The server exposes 6 tools with auth-gated write operations, built on `@outfitter/mcp` with `createMcpServer()`, `defineTool()`, and `connectStdio()`.

## Quick Start

### Running the Server

```bash
# Development mode
bun run --filter @outfitter/firewatch-mcp dev

# Or directly
bun apps/mcp/bin/fw-mcp.ts
```

### Configuration for Claude Code

Add to your MCP configuration:

```json
{
  "mcpServers": {
    "firewatch": {
      "command": "bun",
      "args": ["run", "--filter", "@outfitter/firewatch-mcp", "dev"],
      "cwd": "/path/to/firewatch"
    }
  }
}
```

Or with the built binary:

```json
{
  "mcpServers": {
    "firewatch": {
      "command": "/path/to/fw-mcp"
    }
  }
}
```

## Tools

Firewatch exposes **6 tools** with MCP tool annotations. Base tools are always available; write tools require authentication and are registered dynamically.

### Base Tools (always available)

#### `fw_query` (readOnly)

Query cached PR activity entries.

```json
{"since": "24h"}
{"type": "review", "author": "alice"}
{"pr": "23,34", "summary": true}
{"states": ["open", "draft"], "limit": 10}
{"summary": true, "summary_short": true}
```

**Parameters:**

| Parameter       | Type                         | Description                                                 |
| --------------- | ---------------------------- | ----------------------------------------------------------- |
| `repo`          | string                       | Filter by repository                                        |
| `pr`            | number                       | Filter by PR number                                         |
| `prs`           | number \| number[] \| string | Filter by multiple PRs (comma-separated string allowed)     |
| `type`          | string \| string[]           | Entry type(s): `comment`, `review`, `commit`, `ci`, `event` |
| `author`        | string \| string[]           | Filter by author (prefix with `!` to exclude)               |
| `states`        | string[]                     | Filter by PR state: `open`, `closed`, `merged`, `draft`     |
| `state`         | string \| string[]           | Explicit state list (comma-separated allowed)               |
| `open`          | boolean                      | Include open PRs (including drafts)                         |
| `ready`         | boolean                      | Include ready PRs (open, non-draft)                         |
| `closed`        | boolean                      | Include closed + merged PRs                                 |
| `draft`         | boolean                      | Include draft PRs                                           |
| `label`         | string                       | Filter by label                                             |
| `since`         | string                       | Time filter: `24h`, `7d`, etc.                              |
| `limit`         | number                       | Maximum results                                             |
| `offset`        | number                       | Skip N results                                              |
| `summary`       | boolean                      | Return aggregated per-PR summary                            |
| `summary_short` | boolean                      | Compact summary output (requires `summary`)                 |
| `mine`          | boolean                      | PRs authored by `user.github_username`                      |
| `reviews`       | boolean                      | PRs authored by others (review queue)                       |
| `no_bots`       | boolean                      | Exclude bot activity                                        |
| `all`           | boolean                      | Include all cached repositories                             |
| `sync_full`     | boolean                      | Force a full sync before query                              |
| `no_sync`       | boolean                      | Use cache only (no network)                                 |

Note: `mine` and `reviews` require `user.github_username` to be set in config.

#### `fw_status` (readOnly)

Get Firewatch state information (auth/config/cache).

```json
{}
{"short": true}
```

#### `fw_doctor` (readOnly)

Diagnose setup issues (auth, cache, repo, GitHub API).

```json
{}
{"fix": true}
```

#### `fw_help` (readOnly)

Get usage docs, JSON schemas, and config inspection.

```json
{}
{"schema": "entry"}
{"schema": "worklist"}
{"config": true}
{"config_key": "user.github_username"}
```

### Write Tools (require authentication)

These tools are registered after auth verification. Clients receive a `tools/list_changed` notification when write tools become available.

#### `fw_pr` (destructive)

PR mutations: edit fields, manage metadata, submit reviews.

```json
{"pr": 42, "action": "edit", "title": "feat: update auth"}
{"pr": 42, "action": "edit", "draft": true}
{"pr": 42, "action": "add", "review": "approve", "body": "LGTM"}
{"pr": 42, "action": "add", "labels": ["bug", "priority-high"]}
{"pr": 42, "action": "rm", "labels": ["wip"]}
```

#### `fw_fb` (destructive)

Unified feedback: list, view, reply, ack, resolve.

```json
{"action": "list"}
{"id": "@a7f3c", "action": "view"}
{"id": "@a7f3c", "body": "Fixed", "resolve": true}
{"id": "@a7f3c", "action": "ack"}
```

## Architecture

### Tool Definition Pattern

Tools are defined using `defineTool()` from `@outfitter/mcp` with Zod input schemas and tool annotations:

```typescript
import { TOOL_ANNOTATIONS, defineTool } from "@outfitter/mcp";

const queryTool = defineTool({
  name: "fw_query",
  description: "Query cached PR activity",
  inputSchema: queryParamsSchema,
  annotations: TOOL_ANNOTATIONS.readOnly,
  handler: async (params) => { /* ... */ },
});
```

### Server Creation

The server uses `createMcpServer()` and `connectStdio()` from `@outfitter/mcp`:

```typescript
const server = createMcpServer({
  name: "firewatch-mcp",
  version: mcpVersion,
});

// Register base tools
server.registerTool(queryTool);
server.registerTool(statusTool);

// Start transport
await connectStdio(server);

// Register write tools after auth check
if (authResult.isOk()) {
  server.registerTool(prTool);
  server.registerTool(feedbackTool);
}
```

### Handler Bridge

MCP tool handlers call core handlers via `adaptHandler()` which bridges domain errors to `OutfitterError` for automatic JSON-RPC error code mapping:

```typescript
handler: adaptHandler(async (params) => {
  const result = await statusHandler(input, ctx);
  if (result.isErr()) { return result; }
  return Result.ok(formatOutput(result.value));
}),
```

## Output Format

All tools return text content. Query results are JSONL (newline-delimited JSON).

### Query Output

```json
{"id":"comment-123","repo":"org/repo","pr":42,"type":"comment","author":"alice",...}
{"id":"review-456","repo":"org/repo","pr":42,"type":"review","state":"approved",...}
```

### Summary Output

```json
{"repo":"org/repo","pr":42,"pr_title":"Feature","counts":{"comments":3,"reviews":1,...},...}
```

### Operation Results

```json
{"ok": true, "repo": "org/repo", "pr": 42, "comment_id": "IC_abc123"}
```

## Auto-Sync Behavior

The MCP server auto-syncs when cache data is missing or stale (configurable via `sync.stale_threshold`). Open/draft PRs are synced by default; include closed/merged states to fetch closed data. Use `sync_full` to force a full sync or `no_sync` to skip network calls.

## Authentication

The MCP server uses the same authentication chain as the CLI:

1. gh CLI (if authenticated)
2. `GITHUB_TOKEN` / `GH_TOKEN` environment variable
3. `github_token` in config file

Ensure one of these is configured before using the server. Write tools (`fw_pr`, `fw_fb`) are only registered after successful authentication.

## See Also

- [Schema Reference](./schema.md) - Field documentation
- [Configuration](./configuration.md) - Authentication setup
- [MCP Protocol](https://modelcontextprotocol.io/) - Protocol documentation
