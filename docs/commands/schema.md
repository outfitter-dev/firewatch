# fw schema

Print JSON schema for Firewatch data types.

## Synopsis

```bash
fw schema [name] [--json]
```

## Arguments

| Argument | Description |
|----------|-------------|
| `name` | Schema to display: `entry` or `worklist`. Defaults to `entry`. |

## Options

| Option | Description |
|--------|-------------|
| `--json` | Output JSON (default) |

## Examples

```bash
# Entry schema (default)
fw schema
fw schema entry

# Worklist schema (per-PR summaries)
fw schema worklist

# Deprecated - use 'entry' instead
fw schema query
```

## Schema Variants

| Name | Description |
|------|-------------|
| `entry` | FirewatchEntry - individual activity records (comments, reviews, commits, etc.) |
| `worklist` | WorklistEntry - aggregated per-PR summaries with counts and review states |
| `query` | **Deprecated** - alias for `entry`, use `entry` instead |

### When to Use Each

**Entry schema** (`fw schema entry`):
- Understanding the structure of individual records from `fw query`
- Each entry represents a single event: a comment, review, commit, CI status, or PR event
- Use this when working with raw activity data

**Worklist schema** (`fw schema worklist`):
- Understanding the structure of `fw status` output or `fw query --worklist`
- Each worklist entry is a per-PR summary with activity counts and review states
- Use this when building dashboards or summaries

## Output

### Entry Schema

```json
{
  "name": "FirewatchEntry",
  "description": "Denormalized PR activity record. Each JSONL line stands alone and is jq-friendly.",
  "fields": {
    "id": { "type": "string", "description": "Unique entry ID" },
    "repo": { "type": "string", "description": "owner/repo" },
    "pr": { "type": "number", "description": "PR number" },
    "pr_title": { "type": "string" },
    "pr_state": { "type": "open | closed | merged | draft" },
    "pr_author": { "type": "string" },
    "pr_branch": { "type": "string" },
    "pr_labels": { "type": "string[]", "optional": true },
    "type": { "type": "comment | review | commit | ci | event" },
    "subtype": { "type": "string", "optional": true },
    "author": { "type": "string" },
    "body": { "type": "string", "optional": true },
    "state": { "type": "string", "optional": true },
    "created_at": { "type": "string", "format": "date-time" },
    "updated_at": { "type": "string", "format": "date-time", "optional": true },
    "captured_at": { "type": "string", "format": "date-time" },
    "url": { "type": "string", "optional": true },
    "file": { "type": "string", "optional": true },
    "line": { "type": "number", "optional": true },
    "file_activity_after": { "type": "object", "optional": true },
    "file_provenance": { "type": "object", "optional": true },
    "graphite": { "type": "object", "optional": true }
  }
}
```

### Worklist Schema

```json
{
  "name": "WorklistEntry",
  "description": "Aggregated per-PR summary derived from query results.",
  "fields": {
    "repo": { "type": "string" },
    "pr": { "type": "number" },
    "pr_title": { "type": "string" },
    "pr_state": { "type": "open | closed | merged | draft" },
    "pr_author": { "type": "string" },
    "pr_branch": { "type": "string" },
    "pr_labels": { "type": "string[]", "optional": true },
    "last_activity_at": { "type": "string", "format": "date-time" },
    "latest_activity_type": { "type": "comment | review | commit | ci | event" },
    "latest_activity_author": { "type": "string" },
    "counts": { "type": "object" },
    "review_states": { "type": "object", "optional": true },
    "graphite": { "type": "object", "optional": true }
  }
}
```

## Quick Field Discovery

For live data inspection:

```bash
# Get field names from actual data
fw query --limit 1 | jq 'keys'

# See a formatted entry
fw query --limit 1 | jq '.'
```

## TypeScript Usage

```ts
import type { FirewatchEntry } from "@outfitter/firewatch-core/schema";
import type { WorklistEntry } from "@outfitter/firewatch-core/schema";
```

## See Also

- [Schema Reference](../schema.md) - Full field documentation
- [jq Cookbook](../jq-cookbook.md) - Working with output
