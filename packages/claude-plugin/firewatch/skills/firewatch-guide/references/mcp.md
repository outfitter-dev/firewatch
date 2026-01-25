# Firewatch MCP Reference

Complete reference for Firewatch MCP server tools.

## Overview

The Firewatch MCP server exposes tools for querying and managing GitHub PR activity. Start via `fw mcp`.

**Base tools** (always available):
- `fw_query` - Query cached activity
- `fw_status` - Status info
- `fw_doctor` - Diagnostics
- `fw_help` - Usage documentation

**Write tools** (require authentication):
- `fw_fb` - Feedback operations
- `fw_pr` - PR mutations

---

## fw_query

Query cached PR activity with filters.

### Parameters

| Name | Type | Description |
|------|------|-------------|
| `repo` | string | Repository (owner/repo) |
| `pr` | number \| number[] | Filter to specific PR(s) |
| `type` | string \| string[] | Entry type: comment, review, commit, ci, event |
| `author` | string \| string[] | Filter by author(s), prefix `!` to exclude |
| `states` | string[] | PR states: open, closed, merged, draft |
| `state` | string | Comma-separated states (alternative) |
| `open` | boolean | Filter to open PRs (including drafts) |
| `ready` | boolean | Filter to ready PRs (open, non-draft) |
| `closed` | boolean | Include merged/closed PRs |
| `draft` | boolean | Filter to draft PRs |
| `label` | string | Filter by PR label |
| `since` | string | Time window (24h, 7d, etc.) |
| `limit` | number | Max results |
| `offset` | number | Skip first N results |
| `summary` | boolean | Per-PR aggregation |
| `summary_short` | boolean | Compact summary |
| `orphaned` | boolean | Unresolved on merged/closed PRs |
| `all` | boolean | Include all cached repos |
| `mine` | boolean | My PRs only |
| `reviews` | boolean | PRs I need to review |
| `no_bots` | boolean | Exclude bot activity |
| `no_sync` | boolean | Cache only, no sync |
| `sync_full` | boolean | Force a full sync before query |

### Examples

```json
// Recent comments
{"since": "24h", "type": "comment"}

// Per-PR summary
{"summary": true}

// Compact summary
{"summary_short": true}

// My PRs with reviews
{"mine": true, "type": "review"}

// Specific PR
{"pr": 123}

// Force full sync
{"sync_full": true, "summary": true}
```

### Response

JSONL-formatted entries or worklist objects (if `summary`/`summary_short`).

---

## fw_fb

Unified feedback operations for viewing, replying, resolving, and acknowledging comments.

### Parameters

| Name | Type | Description |
|------|------|-------------|
| `pr` | number | PR number for PR-level operations |
| `id` | string | Comment ID (short `@a7f3c` or full) |
| `body` | string | Comment text for reply |
| `resolve` | boolean | Resolve thread or ack |
| `ack` | boolean | Thumbs-up reaction + local record |
| `all` | boolean | Include resolved/acked feedback |
| `repo` | string | Repository (owner/repo) |

### Usage Patterns

**List feedback:**

```json
// All unaddressed (repo-wide)
{}

// For specific PR
{"pr": 123}

// Include resolved
{"pr": 123, "all": true}
```

**View comment:**

```json
{"id": "@a7f3c"}
```

**Reply:**

```json
{"id": "@a7f3c", "body": "Fixed in latest commit"}
```

**Reply and resolve:**

```json
{"id": "@a7f3c", "body": "Done", "resolve": true}
```

**Resolve without reply:**

```json
{"id": "@a7f3c", "resolve": true}
```

**Acknowledge:**

```json
{"id": "@a7f3c", "ack": true}
```

**Bulk acknowledge PR:**

```json
{"pr": 123, "ack": true}
```

**Add comment to PR:**

```json
{"pr": 123, "body": "LGTM!"}
```

### Response

JSON with operation result:

```json
{
  "ok": true,
  "repo": "owner/repo",
  "pr": 123,
  "id": "@a7f3c",
  "gh_id": "PRRC_kwDO...",
  "resolved": true,
  "url": "https://github.com/..."
}
```

---

## fw_pr

PR mutations: edit fields, manage metadata, submit reviews.

### Parameters

| Name | Type | Description |
|------|------|-------------|
| `action` | string | Required: "edit", "rm", or "review" |
| `pr` | number | Required: PR number |
| `repo` | string | Repository (owner/repo) |

**Edit action params:**

| Name | Type | Description |
|------|------|-------------|
| `title` | string | New title |
| `body` | string | New description |
| `base` | string | New base branch |
| `milestone` | string | Set milestone |
| `draft` | boolean | Convert to draft |
| `ready` | boolean | Mark ready for review |
| `labels` | string \| string[] | Add labels |
| `label` | string | Add single label |
| `reviewer` | string \| string[] | Add reviewers |
| `assignee` | string \| string[] | Add assignees |

**Remove action params:**

| Name | Type | Description |
|------|------|-------------|
| `labels` | string \| string[] | Labels to remove |
| `reviewer` | string \| string[] | Reviewers to remove |
| `assignee` | string \| string[] | Assignees to remove |
| `milestone` | boolean | Clear milestone (true) |

**Review action params:**

| Name | Type | Description |
|------|------|-------------|
| `review` | string | Required: "approve", "request-changes", "comment" |
| `body` | string | Review body |

### Examples

**Edit title:**

```json
{"action": "edit", "pr": 123, "title": "feat: new feature"}
```

**Add labels:**

```json
{"action": "edit", "pr": 123, "labels": ["bug", "urgent"]}
```

**Mark ready:**

```json
{"action": "edit", "pr": 123, "ready": true}
```

**Remove label:**

```json
{"action": "rm", "pr": 123, "labels": "needs-review"}
```

**Approve PR:**

```json
{"action": "review", "pr": 123, "review": "approve"}
```

**Request changes:**

```json
{
  "action": "review",
  "pr": 123,
  "review": "request-changes",
  "body": "Please fix the type error on line 42"
}
```

---

## fw_status

Show cache and authentication status.

### Parameters

| Name | Type | Description |
|------|------|-------------|
| `short` | boolean | Compact output |
| `status_short` | boolean | Alias for short |
| `recheck_auth` | boolean | Re-verify auth and enable write tools |

### Example

```json
{"short": true}
```

### Response

```json
{
  "version": "0.2.0",
  "auth": {"ok": true, "source": "gh"},
  "config": {"paths": {...}, "values": {...}},
  "repo": "owner/repo",
  "graphite": {"enabled": true},
  "cache": {"repos": 1, "entries": 150, "size_bytes": 12345, "last_sync": "..."}
}
```

---

## fw_doctor

Diagnose Firewatch setup issues.

### Parameters

| Name | Type | Description |
|------|------|-------------|
| `fix` | boolean | Attempt auto-repair |

### Response

```json
{
  "ok": true,
  "checks": {
    "github_api": {"ok": true, "status": 200},
    "auth": {"ok": true, "source": "gh"},
    "config": {"ok": true, "user": "...", "project": "..."},
    "cache": {"ok": true, "path": "..."},
    "repo": {"ok": true, "repo": "owner/repo", "source": "git"},
    "graphite": {"ok": true, "enabled": true}
  },
  "issues": []
}
```

---

## fw_help

Usage documentation and schema info.

### Parameters

| Name | Type | Description |
|------|------|-------------|
| `schema` | string | Show schema: "query", "entry", "worklist", "config" |
| `config_key` | string | Show config value for key |
| `config_path` | boolean | Show config file locations |

### Examples

```json
// Get entry schema
{"schema": "entry"}

// Get config value
{"config_key": "user.github_username"}

// Get config paths
{"config_path": true}
```

---

## Authentication Flow

The MCP server uses auth-gated dynamic tool registration:

1. Base tools are always available
2. On first use, server checks auth
3. If authenticated, write tools become available
4. Use `fw_status` with `recheck_auth: true` to trigger re-verification

```json
{"recheck_auth": true}
```

Response includes:

```json
{
  "auth_recheck": {
    "authenticated": true,
    "tools_enabled": true,
    "source": "gh"
  }
}
```

---

## Entry Schema

Individual activity entries have this structure:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | GitHub node ID |
| `short_id` | string | Short ID (e.g., `@a7f3c`) |
| `repo` | string | Repository (owner/repo) |
| `pr` | number | PR number |
| `pr_title` | string | PR title |
| `pr_author` | string | PR author login |
| `pr_branch` | string | PR branch name |
| `pr_state` | string | PR state |
| `type` | string | Entry type |
| `subtype` | string | Comment subtype (issue_comment, review_comment) |
| `author` | string | Entry author |
| `body` | string | Content body |
| `created_at` | string | ISO timestamp |
| `file` | string | File path (review comments) |
| `line` | number | Line number (review comments) |
| `thread_resolved` | boolean | Thread resolution status |
| `graphite` | object | Graphite stack metadata |

---

## Worklist Schema

Per-PR summaries have this structure:

| Field | Type | Description |
|-------|------|-------------|
| `repo` | string | Repository |
| `pr` | number | PR number |
| `pr_title` | string | PR title |
| `pr_author` | string | PR author |
| `pr_state` | string | PR state |
| `last_activity_at` | string | Most recent activity |
| `counts` | object | Entry counts by type |
| `review_states` | object | Review state counts |
| `ci_status` | object | CI status summary |
| `graphite` | object | Stack metadata |
