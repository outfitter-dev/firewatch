# fw

Query cached PR activity (auto-syncs if stale). This is the default Firewatch command.

## Synopsis

```bash
fw [options]
```

## Description

- Shows actionable items when running interactively
- Outputs JSONL when piped or when `--jsonl` is set
- Auto-syncs when cache is missing or stale (configurable)
- Auto-sync prioritizes open PRs; closed/merged data syncs when requested

## Options

### Scope

| Option           | Description                                                    |
| ---------------- | -------------------------------------------------------------- |
| `--pr [numbers]` | Filter to PR domain, optionally specific PRs (comma-separated) |
| `--repo <name>`  | Filter to specific repository (`owner/repo`)                   |
| `-a, --all`      | Include all cached repos                                       |

### Perspective

| Option      | Description                                                   |
| ----------- | ------------------------------------------------------------- |
| `--mine`    | Items on PRs assigned to me (requires `user.github_username`) |
| `--reviews` | PRs I need to review (requires `user.github_username`)        |

### State

| Option             | Description                                     |
| ------------------ | ----------------------------------------------- |
| `--open`           | Include open PRs (including drafts)             |
| `--ready`          | Include ready PRs (open, non-draft)             |
| `--closed`         | Include merged and closed PRs                   |
| `--draft`          | Include draft PRs                               |
| `--orphaned`       | Only unresolved review comments on merged/closed PRs |
| `--stale`          | Include unresolved review comments on merged/closed PRs |
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
| `--no-sync`        | Use cache only, no network                      |
| `--sync-full`      | Force a full sync before query                  |

### Pagination

| Option                | Description             |
| --------------------- | ----------------------- |
| `-n, --limit <count>` | Limit number of results |
| `--offset <count>`    | Skip first N results    |

### Output

| Option        | Description                           |
| ------------- | ------------------------------------- |
| `--summary`   | Aggregate entries into per-PR summary |
| `-j, --jsonl` | Force structured output               |
| `--no-jsonl`  | Force human-readable output           |
| `--debug`     | Enable debug logging                  |
| `--no-color`  | Disable color output                  |

## Examples

```bash
# Actionable items (default)
fw

# Filter to PRs only
fw --pr

# Specific PRs
fw --pr 23,34

# My PRs with unaddressed feedback
fw --mine

# PRs I need to review
fw --reviews

# Recent activity
fw --since 24h

# All repos, last 7 days, JSONL output
fw -a -s 7d -j

# Per-PR summary
fw --summary

# Full sync before query
fw --sync-full
```

## Notes

- `--mine` and `--reviews` are mutually exclusive
- `--sync-full` cannot be used with `--no-sync`
- `--mine`/`--reviews` require `user.github_username` in config
- Unresolved review comments on merged/closed PRs are hidden by default; use `--stale` or `--orphaned`
- If no state flags are provided, Firewatch defaults to open + draft PRs
- Auto-sync fetches open/draft PRs by default; include `--closed` or `--state closed,merged` to sync closed/merged data
- Use `fw schema` for output structure reference
