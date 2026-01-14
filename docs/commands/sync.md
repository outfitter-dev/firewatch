# fw sync

Fetch and update PR activity data from GitHub.

## Synopsis

```bash
fw sync [repo] [options]
```

## Description

The `sync` command fetches PR activity from GitHub's GraphQL API and stores it in the local cache. Firewatch uses cursor-based incremental sync by default, only fetching activity since the last sync.

## Arguments

| Argument | Description |
|----------|-------------|
| `repo` | Repository to sync (`owner/repo` format). Auto-detects from git remote if omitted. |

## Options

| Option | Description |
|--------|-------------|
| `--full` | Force full refresh, ignoring the stored cursor |
| `--since <duration>` | Only sync PRs updated since duration (e.g., `7d`, `24h`) |
| `--with-graphite` | Include Graphite stack metadata during sync |
| `--stack` | Alias for `--with-graphite` |
| `--json` | Output JSONL (default) |

## Examples

```bash
# Sync current repo (auto-detected)
fw sync

# Sync specific repo
fw sync outfitter-dev/firewatch

# Only recent activity
fw sync --since 7d

# Full refresh (ignore cursor)
fw sync --full

# Include Graphite stack metadata
fw sync --stack
```

## Output

Sync outputs progress to stderr and results to stdout as JSONL:

```json
{"repo":"outfitter-dev/firewatch","prs_processed":12,"entries_added":47}
```

With `--stack`:

```json
{"repo":"outfitter-dev/firewatch","prs_processed":12,"entries_added":47,"graphite":true}
```

## Behavior

### Incremental Sync

By default, Firewatch tracks a cursor for each repository. Subsequent syncs only fetch activity since the last sync, making updates fast.

Use `--full` to re-fetch all data (useful after schema changes or to recover from issues).

### Graphite Integration

When `--stack` or `--with-graphite` is used (or `graphite_enabled = true` in config), Firewatch enriches entries with stack metadata:

- `graphite.stack_id` - Unique stack identifier
- `graphite.stack_position` - Position in stack (1 = bottom)
- `graphite.stack_size` - Total PRs in stack
- `graphite.parent_pr` - Parent PR number if not at bottom

Graphite integration requires running inside a Graphite-managed repository.

### Authentication

Sync requires GitHub authentication. Firewatch tries:

1. `gh` CLI (if authenticated)
2. `GITHUB_TOKEN` or `GH_TOKEN` environment variable
3. `github_token` in config file

### Multi-Repo Sync

If `repos` is configured in your config file, running `fw sync` without arguments syncs all configured repositories.

## See Also

- [fw query](./query.md) - Filter synced entries
- [fw check](./check.md) - Update staleness hints
- [Configuration](../configuration.md)
