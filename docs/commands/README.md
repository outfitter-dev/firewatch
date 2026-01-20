# CLI Command Reference

Firewatch provides a CLI tool (`fw`) for querying GitHub PR activity. The root command auto-syncs when data is stale, then outputs JSONL for `jq` or human-readable summaries when running in a TTY.

## Quick Reference

| Command                    | Description                                 |
| -------------------------- | ------------------------------------------- |
| [`fw`](./fw.md)            | Query cached activity (auto-syncs)          |
| [`fw add`](./add.md)       | Add comments, reviews, or metadata          |
| [`fw close`](./close.md)   | Resolve review comment threads              |
| [`fw edit`](./edit.md)     | Update PR fields (title/body/base/etc.)     |
| [`fw rm`](./rm.md)         | Remove labels/reviewers/assignees/milestone |
| [`fw status`](./status.md) | Firewatch state info (auth/config/cache)    |
| [`fw config`](./config.md) | View/edit configuration                     |
| [`fw doctor`](./doctor.md) | Diagnose auth/cache/repo issues             |
| [`fw schema`](./schema.md) | Output JSON schemas                         |
| [`fw mcp`](./mcp.md)       | Start MCP server                            |

## Global Behavior

### Auto-Sync

The root `fw` command auto-syncs when cache data is missing or stale. Control this with:

- `--offline` to skip network calls
- `--refresh` / `--refresh full` to force a sync

### Output Format

- JSONL when stdout is not a TTY or when `--jsonl` is set
- Human-readable output when in a TTY (configurable via `output.default_format`)

### Repo Detection

When `--repo` is omitted, Firewatch auto-detects the current repository from git remotes or package metadata.

## See Also

- [Configuration Reference](../configuration.md)
- [Schema Reference](../schema.md)
- [jq Cookbook](../jq-cookbook.md)
- [MCP Server](../mcp.md)
