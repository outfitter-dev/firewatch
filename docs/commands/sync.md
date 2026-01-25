# fw sync

Sync cache with GitHub.

## Synopsis

```bash
fw sync [repo] [options]
```

## Description

- Syncs open PRs by default
- Use `--open` or `--closed` to limit scope
- Use `--full` to ignore incremental windows

## Options

| Option        | Description                               |
| ------------- | ----------------------------------------- |
| `--clear`     | Clear cache before syncing                |
| `--full`      | Full sync (ignore cursors)                |
| `--open`      | Sync open PRs only                         |
| `--closed`    | Sync closed + merged PRs only              |
| `--dry-run`   | Show what would be synced                 |
| `--quiet`     | Suppress progress output                  |
| `--jsonl`     | Force JSONL output                        |
| `--no-jsonl`  | Force human-readable output               |

## Examples

```bash
# Sync current repo (open only)
fw sync

# Sync open PRs only
fw sync --open

# Sync closed + merged PRs only
fw sync --closed

# Full resync (ignore cursors)
fw sync --full

# Clear cache, then sync
fw sync --clear

# Preview sync without executing
fw sync --dry-run
```
