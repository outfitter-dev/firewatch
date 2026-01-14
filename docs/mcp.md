# MCP Server

Firewatch provides an MCP (Model Context Protocol) server for AI agent integration. The server exposes PR activity data through a single tool interface.

## Quick Start

### Running the Server

```bash
# Development mode
bun run --filter @outfitter/firewatch-mcp dev

# Or directly
bun apps/mcp/bin/mcp.ts
```

### Configuration for Claude Code

Add to your MCP configuration:

```json
{
  "mcpServers": {
    "firewatch": {
      "command": "bun",
      "args": ["run", "--filter", "@outfitter/firewatch-mcp", "start"],
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

Firewatch exposes a **single tool** called `firewatch` with an `action` parameter. This design keeps the interface simple while supporting all operations.

### Tool Schema

```typescript
{
  name: "firewatch",
  description: "GitHub PR activity query tool. Outputs JSONL for jq.",
  parameters: {
    action: "query" | "sync" | "check" | "status" | "comment" | "resolve" | "schema" | "help",
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
{"action": "query", "pr": 42, "worklist": true}
{"action": "query", "states": ["open", "draft"], "limit": 10}
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `repo` | string | Filter by repository |
| `pr` | number | Filter by PR number |
| `type` | string | Filter by type: `comment`, `review`, `commit`, `ci`, `event` |
| `author` | string | Filter by author |
| `states` | string[] | Filter by PR state: `open`, `closed`, `merged`, `draft` |
| `label` | string | Filter by label |
| `since` | string | Time filter: `24h`, `7d`, etc. |
| `limit` | number | Maximum results |
| `offset` | number | Skip N results |
| `stack_id` | string | Filter by Graphite stack |
| `group_stack` | boolean | Group by stack |
| `worklist` | boolean | Return aggregated per-PR summary |

### sync

Fetch PR data from GitHub.

```json
{"action": "sync"}
{"action": "sync", "repo": "org/repo"}
{"action": "sync", "since": "7d", "full": false}
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `repo` | string | Repository to sync |
| `since` | string | Only recent PRs |
| `full` | boolean | Force full refresh |

### status

Get PR activity summary.

```json
{"action": "status"}
{"action": "status", "states": ["open"], "status_short": true}
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `repo` | string | Filter by repository |
| `pr` | number | Filter by PR |
| `states` | string[] | Filter by state |
| `label` | string | Filter by label |
| `since` | string | Time filter |
| `status_short` | boolean | Compact output |

### check

Refresh staleness hints.

```json
{"action": "check"}
{"action": "check", "repo": "org/repo"}
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `repo` | string | Repository to check |

### comment

Post a PR comment or reply.

```json
{"action": "comment", "pr": 42, "body": "Thanks for the review!"}
{"action": "comment", "pr": 42, "body": "Fixed", "reply_to": "comment-123", "resolve": true}
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `repo` | string | Repository |
| `pr` | number | PR number (required) |
| `body` | string | Comment text (required) |
| `reply_to` | string | Comment ID to reply to |
| `resolve` | boolean | Resolve thread after reply |

### resolve

Resolve review threads.

```json
{"action": "resolve", "comment_ids": ["comment-123", "comment-456"]}
{"action": "resolve", "comment_ids": ["comment-123"], "repo": "org/repo", "pr": 42}
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `comment_ids` | string[] | Comment IDs to resolve (required) |
| `repo` | string | Repository (optional, for cache bypass) |
| `pr` | number | PR number (optional, for cache bypass) |

### schema

Get schema documentation.

```json
{"action": "schema"}
{"action": "schema", "schema": "entry"}
{"action": "schema", "schema": "worklist"}
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `schema` | string | Schema name: `query`, `entry`, `worklist` |

### help

Get help text.

```json
{"action": "help"}
```

## Output Format

All actions return JSONL (newline-delimited JSON). Each line is a complete JSON object.

### Query Output

```json
{"id":"comment-123","repo":"org/repo","pr":42,"type":"comment","author":"alice",...}
{"id":"review-456","repo":"org/repo","pr":42,"type":"review","state":"approved",...}
```

### Worklist Output

```json
{"repo":"org/repo","pr":42,"pr_title":"Feature","counts":{"comments":3,"reviews":1,...},...}
```

### Operation Results

```json
{"ok":true,"repo":"org/repo","pr":42,"comment_id":"IC_abc123"}
```

## Agent Workflows

### Discovery Flow

1. Start with schema to understand fields:
   ```json
   {"action": "schema"}
   ```

2. Get current status:
   ```json
   {"action": "status", "status_short": true}
   ```

3. Query specific data:
   ```json
   {"action": "query", "type": "review", "states": ["open"]}
   ```

### Review Flow

1. Check for pending reviews:
   ```json
   {"action": "query", "type": "review", "states": ["open"]}
   ```

2. Get specific PR details:
   ```json
   {"action": "query", "pr": 42}
   ```

3. Address feedback and resolve:
   ```json
   {"action": "comment", "pr": 42, "body": "Fixed in abc123", "reply_to": "comment-123", "resolve": true}
   ```

### Sync Flow

1. Sync latest data:
   ```json
   {"action": "sync"}
   ```

2. Update staleness hints:
   ```json
   {"action": "check"}
   ```

3. Query with fresh data:
   ```json
   {"action": "query", "since": "24h"}
   ```

## Auto-Sync Behavior

When querying a repository with no cache, the MCP server automatically syncs before returning results. This makes the tool self-bootstrapping.

## Authentication

The MCP server uses the same authentication chain as the CLI:

1. gh CLI (if authenticated)
2. `GITHUB_TOKEN` / `GH_TOKEN` environment variable
3. `github_token` in config file

Ensure one of these is configured before using the server.

## Example Session

```
Agent: {"action": "schema"}
Server: {"name":"FirewatchEntry","fields":{...}}

Agent: {"action": "status", "states": ["open"], "status_short": true}
Server: {"repo":"org/repo","pr":42,"pr_title":"Add feature","comments":3,"changes_requested":1}

Agent: {"action": "query", "pr": 42, "type": "comment"}
Server: {"id":"comment-123","body":"Consider error handling","file":"src/index.ts",...}
{"id":"comment-456","body":"Naming could be clearer","file":"src/utils.ts",...}

Agent: {"action": "comment", "pr": 42, "body": "Addressed all feedback", "reply_to": "comment-123", "resolve": true}
Server: {"ok":true,"repo":"org/repo","pr":42,"comment_id":"PRRC_abc","resolved":true}
```

## Tips for Agents

1. **Start with schema** - Understand available fields before querying
2. **Use status_short** - Get a quick overview before diving deep
3. **Filter server-side** - Use parameters instead of post-processing
4. **Auto-sync works** - No need to explicitly sync for basic queries
5. **Batch resolves** - Use `comment_ids` array for multiple threads

## See Also

- [Schema Reference](./schema.md) - Field documentation
- [Configuration](./configuration.md) - Authentication setup
- [MCP Protocol](https://modelcontextprotocol.io/) - Protocol documentation
