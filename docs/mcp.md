# MCP Server

Firewatch provides an MCP (Model Context Protocol) server for AI agent integration. The server exposes PR activity data and write operations through a single tool interface.

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

## Tool Design

Firewatch exposes a **single tool** called `firewatch` with an `action` parameter.

### Tool Schema

```typescript
{
  name: "firewatch",
  description: "GitHub PR activity query tool. Outputs JSONL for jq.",
  parameters: {
    action: "query" | "add" | "close" | "edit" | "rm" | "status" | "config" | "doctor" | "schema" | "help",
    // ... additional parameters per action
  }
}
```

## Actions

### query

Filter cached PR activity entries.

```json
{"action": "query", "since": "24h"}
{"action": "query", "type": "review", "author": "alice"}
{"action": "query", "pr": "23,34", "summary": true}
{"action": "query", "states": ["open", "draft"], "limit": 10}
{"action": "query", "summary": true, "summary_short": true}
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
| `open`          | boolean                      | Include open PRs                                            |
| `closed`        | boolean                      | Include closed + merged PRs                                 |
| `draft`         | boolean                      | Include draft PRs                                           |
| `active`        | boolean                      | Include open + draft PRs                                    |
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
| `refresh`       | boolean \| "full"            | Force sync before query                                     |
| `offline`       | boolean                      | Use cache only (no network)                                 |

Note: `mine` and `reviews` require `user.github_username` to be set in config.

### add

Add content or metadata to PRs.

```json
{"action": "add", "pr": 42, "body": "Thanks for the review!"}
{"action": "add", "pr": 42, "body": "Fixed", "reply_to": "comment-123", "resolve": true}
{"action": "add", "pr": 42, "review": "approve", "body": "LGTM"}
{"action": "add", "pr": 42, "labels": ["bug", "priority-high"]}
```

**Parameters:**

| Parameter  | Type               | Description                             |
| ---------- | ------------------ | --------------------------------------- |
| `repo`     | string             | Repository                              |
| `pr`       | number             | PR number (required)                    |
| `body`     | string             | Comment/review body                     |
| `reply_to` | string             | Comment ID to reply to                  |
| `resolve`  | boolean            | Resolve thread after reply              |
| `review`   | string             | `approve`, `request-changes`, `comment` |
| `labels`   | string \| string[] | Labels to add                           |
| `reviewer` | string \| string[] | Reviewers to request                    |
| `assignee` | string \| string[] | Assignees to add                        |

### close

Resolve review comment threads.

```json
{"action": "close", "comment_id": "comment-123"}
{"action": "close", "comment_ids": ["comment-123", "comment-456"]}
```

### edit

Update PR fields or state.

```json
{"action": "edit", "pr": 42, "title": "feat: update auth"}
{"action": "edit", "pr": 42, "draft": true}
{"action": "edit", "pr": 42, "milestone": "v1.0"}
```

### rm

Remove metadata from PRs.

```json
{"action": "rm", "pr": 42, "labels": ["wip"]}
{"action": "rm", "pr": 42, "assignee": "galligan"}
{"action": "rm", "pr": 42, "milestone": true}
```

### status

Get Firewatch state information (auth/config/cache).

```json
{"action": "status"}
{"action": "status", "status_short": true}
```

### config

Read Firewatch configuration (read-only).

```json
{"action": "config"}
{"action": "config", "key": "user.github_username"}
{"action": "config", "path": true}
```

### doctor

Diagnose setup (auth, cache, repo, GitHub API).

```json
{ "action": "doctor" }
```

### schema

Get schema documentation.

```json
{"action": "schema"}
{"action": "schema", "schema": "entry"}
{"action": "schema", "schema": "worklist"}
{"action": "schema", "schema": "config"}
```

### help

Get help text.

```json
{ "action": "help" }
```

## Output Format

All actions return JSONL (newline-delimited JSON). Each line is a complete JSON object.

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
{ "ok": true, "repo": "org/repo", "pr": 42, "comment_id": "IC_abc123" }
```

## Auto-Sync Behavior

The MCP server auto-syncs when cache data is missing or stale (configurable via `sync.stale_threshold`). Use `refresh` to force sync or `offline` to skip network calls.

## Authentication

The MCP server uses the same authentication chain as the CLI:

1. gh CLI (if authenticated)
2. `GITHUB_TOKEN` / `GH_TOKEN` environment variable
3. `github_token` in config file

Ensure one of these is configured before using the server.

## See Also

- [Schema Reference](./schema.md) - Field documentation
- [Configuration](./configuration.md) - Authentication setup
- [MCP Protocol](https://modelcontextprotocol.io/) - Protocol documentation
