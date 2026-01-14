# fw status

Summarize PR activity as a worklist.

## Synopsis

```bash
fw status [options]
```

## Description

The `status` command provides a summarized view of PR activity, aggregating entries into per-PR worklist items. This is useful for getting a quick overview without the full detail of individual entries.

## Options

| Option | Description |
|--------|-------------|
| `--repo <name>` | Filter by repository (partial match) |
| `--all` | Query across all cached repositories |
| `--pr <number>` | Filter by PR number |
| `--state <states>` | Filter by PR state (comma-separated: `open`, `closed`, `merged`, `draft`) |
| `--open` | Shorthand for `--state open` |
| `--draft` | Shorthand for `--state draft` |
| `--active` | Shorthand for `--state open,draft` |
| `--label <name>` | Filter by PR label (partial match) |
| `--since <duration>` | Filter by time (e.g., `24h`, `7d`) |
| `--short` | Tight per-PR summary output |
| `--json` | Output JSONL (default) |

## Examples

```bash
# Full worklist for current repo
fw status

# Tight summary view
fw status --short

# Only open PRs
fw status --open

# Recent activity
fw status --since 7d

# Specific PR
fw status --pr 42

# PRs with a label
fw status --label urgent
```

## Output Formats

### Default (Full Worklist)

Full worklist entries with all counts and metadata:

```json
{
  "repo": "org/repo",
  "pr": 42,
  "pr_title": "Add new feature",
  "pr_state": "open",
  "pr_author": "alice",
  "pr_branch": "feature/new-thing",
  "pr_labels": ["enhancement"],
  "last_activity_at": "2025-01-14T10:00:00Z",
  "latest_activity_type": "review",
  "latest_activity_author": "bob",
  "counts": {
    "comments": 5,
    "reviews": 2,
    "commits": 3,
    "ci": 1,
    "events": 0
  },
  "review_states": {
    "approved": 1,
    "changes_requested": 1,
    "commented": 0,
    "dismissed": 0
  },
  "graphite": {
    "stack_id": "stack-abc",
    "stack_position": 2,
    "stack_size": 3
  }
}
```

### Short (`--short`)

Minimal summary for quick scanning:

```json
{
  "repo": "org/repo",
  "pr": 42,
  "pr_title": "Add new feature",
  "pr_state": "open",
  "pr_author": "alice",
  "last_activity_at": "2025-01-14T10:00:00Z",
  "comments": 5,
  "changes_requested": 1,
  "stack_id": "stack-abc",
  "stack_position": 2
}
```

## Use Cases

### Daily Review Queue

```bash
# What needs attention today?
fw status --active --since 24h --short
```

### PRs Needing Changes

```bash
# Find PRs with changes requested
fw status | jq 'select(.review_states.changes_requested > 0)'
```

### Stack Overview

```bash
# See stacked PRs in order
fw status --short | jq -s 'sort_by(.stack_position)'
```

## Sorting

Worklist entries are sorted by:

1. Stack position (bottom-up for Graphite stacks)
2. Last activity time (most recent first)

## See Also

- [fw query](./query.md) - Full entry details
- [Worklist Schema](../schema.md#worklist-entry) - Field documentation
