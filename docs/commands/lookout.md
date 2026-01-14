# fw lookout

PR activity reconnaissance - what needs attention since your last check.

## Synopsis

```bash
fw lookout [options]
```

## Description

The `lookout` command provides intelligent PR reconnaissance with smart time defaults. Unlike `fw recap` which uses explicit time ranges, `lookout` tracks your last check per-repo and shows activity since then. This makes it ideal for daily standup checks or catching up after being away.

On first run, lookout shows activity from the past 7 days (or your configured `default_since`). Subsequent runs show only activity since your last lookout.

If the cache is stale (configurable threshold, default 1 hour), lookout automatically syncs before querying.

## Options

| Option | Description |
|--------|-------------|
| `--repo <name>` | Filter by repository |
| `--all` | Query across all cached repositories |
| `--since <duration>` | Override smart time default (e.g., `24h`, `7d`) |
| `--reset` | Clear last lookout timestamp, show from fallback |
| `--json` | Output JSONL for agents |

## Examples

```bash
# What's happened since my last check?
fw lookout

# Override with explicit time range
fw lookout --since 24h

# Start fresh (reset tracking)
fw lookout --reset

# Machine-readable output for agents
fw lookout --json
```

## Output Formats

### Default (Text)

```
=== Firewatch Lookout: owner/repo ===
Since: 3 hours ago
(Auto-synced)

Activity: 5 PRs, 12 comments, 3 reviews, 8 commits

Changes Requested (2)
  #42 Add user authentication
  #38 Fix payment flow

Needs Review (1)
  #45 Update documentation

Unaddressed Feedback (3)
  #42: coderabbit[bot] [bot] - Consider adding input validation...
  #38: alice - This should handle the edge case...

Run `fw status --short` for full worklist
```

### JSON (`--json`)

```json
{
  "repo": "owner/repo",
  "period": {
    "since": "2024-01-15T10:00:00.000Z",
    "until": "2024-01-15T13:00:00.000Z"
  },
  "counts": {
    "total_entries": 28,
    "prs_active": 5,
    "comments": 12,
    "reviews": 3,
    "commits": 8
  },
  "attention": {
    "changes_requested": [...],
    "unreviewed": [...],
    "stale": [...]
  },
  "unaddressed_feedback": [...],
  "synced_at": "2024-01-15T13:00:00.000Z",
  "first_run": false
}
```

## Attention Categories

Lookout identifies PRs that need attention:

- **Changes Requested**: PRs with "changes requested" reviews
- **Needs Review**: Open PRs with no reviews yet
- **Stale**: Open PRs with no activity for 3+ days

## Unaddressed Feedback

Lookout tracks review comments and issue comments that haven't been addressed:

- Review comments on files that haven't been modified since
- Issue comments without subsequent commits
- Bot comments (marked with `[bot]`) are included since they often require action

## Smart Time Behavior

1. **First run**: Uses `default_since` from config (default: 7d)
2. **Subsequent runs**: Uses timestamp from last lookout
3. **`--since` flag**: Always takes precedence
4. **`--reset`**: Clears tracking, returns to first-run behavior

## Auto-Sync

Lookout automatically syncs if the cache is stale. Configure the threshold:

```toml
# .firewatch.toml or ~/.config/firewatch/config.toml
lookout_stale_after = "1h"  # default
```

## MCP Usage

For AI agents via MCP:

```json
{"action": "lookout"}
{"action": "lookout", "lookout_reset": true}
{"action": "lookout", "since": "24h"}
```

## Use Cases

### Daily Standup

```bash
# Quick check - what's happened since yesterday?
fw lookout
```

### After Weekend

```bash
# Reset and see everything from the week
fw lookout --reset --since 7d
```

### Continuous Agent Monitoring

```bash
# Agent polls for new activity
fw lookout --json | jq '.attention'
```

## Configuration

```toml
# ~/.config/firewatch/config.toml

# Default time range for first lookout (default: 7d)
default_since = "7d"

# Stale threshold for auto-sync (default: 1h)
lookout_stale_after = "1h"
```

## See Also

- [fw status](./status.md) - Full worklist output
- [fw recap](./recap.md) - Human-readable summary with explicit time ranges
- [fw query](./query.md) - Full entry queries
