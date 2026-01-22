# fw

Query cached PR activity (auto-syncs if stale). This is the default Firewatch command.

## Synopsis

```bash
fw [options]
```

## Description

- Shows actionable items when running interactively
- Outputs JSONL when piped or when `--json` is set
- Auto-syncs when cache is missing or stale (configurable)

## Options

### Scope

| Option            | Description                                                    |
| ----------------- | -------------------------------------------------------------- |
| `--prs [numbers]` | Filter to PR domain, optionally specific PRs (comma-separated) |
| `--repo <name>`   | Filter to specific repository (`owner/repo`)                   |
| `-a, --all`       | Include all cached repos                                       |

### Perspective

| Option      | Description                                                   |
| ----------- | ------------------------------------------------------------- |
| `--mine`    | Items on PRs assigned to me (requires `user.github_username`) |
| `--reviews` | PRs I need to review (requires `user.github_username`)        |

### State

| Option             | Description                                     |
| ------------------ | ----------------------------------------------- |
| `--open`           | Include open PRs                                |
| `--closed`         | Include merged and closed PRs                   |
| `--draft`          | Include draft PRs                               |
| `--active`         | Alias for `--open --draft`                      |
| `--orphaned`       | Unresolved review comments on merged/closed PRs |
| `--state <states>` | Explicit comma-separated state list             |

### Filters

| Option            | Description                                               |
| ----------------- | --------------------------------------------------------- |
| `--type <types>`  | Entry types: `comment`, `review`, `commit`, `ci`, `event` |
| `--label <name>`  | Filter by PR label                                        |
| `--author <list>` | Filter by author(s); prefix with `!` to exclude           |
| `--no-bots`       | Exclude bot activity                                      |

### Time

| Option                   | Description                                                             |
| ------------------------ | ----------------------------------------------------------------------- |
| `-s, --since <duration>` | Time window (h=hours, d=days, w=weeks, m=months). Examples: `24h`, `7d` |

### Sync/Cache

| Option             | Description                                     |
| ------------------ | ----------------------------------------------- |
| `--offline`        | Use cache only, no network                      |
| `--refresh [full]` | Force sync before query (`full` ignores cursor) |

### Pagination

| Option                | Description             |
| --------------------- | ----------------------- |
| `-n, --limit <count>` | Limit number of results |
| `--offset <count>`    | Skip first N results    |

### Output

| Option       | Description                           |
| ------------ | ------------------------------------- |
| `--summary`  | Aggregate entries into per-PR summary |
| `-j, --json` | Force JSON output                     |
| `--no-json`  | Force human-readable output           |
| `--debug`    | Enable debug logging                  |
| `--no-color` | Disable color output                  |

## Examples

```bash
# Actionable items (default)
fw

# Filter to PRs only
fw --prs

# Specific PRs
fw --prs 23,34

# My PRs with unaddressed feedback
fw --mine

# PRs I need to review
fw --reviews

# Recent activity
fw --since 24h

# All repos, last 7 days, JSON output
fw -a -s 7d -j

# Per-PR summary
fw --summary

# Force sync before query
fw --refresh

# Full refresh
fw --refresh full
```

## Notes

- `--mine` and `--reviews` are mutually exclusive
- `--refresh` cannot be used with `--offline`
- `--mine`/`--reviews` require `user.github_username` in config
- If no state flags are provided, Firewatch defaults to open + draft PRs
- Use `fw schema` for output structure reference
