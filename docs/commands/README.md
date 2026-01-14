# CLI Command Reference

Firewatch provides a CLI tool (`fw`) for fetching, caching, and querying GitHub PR activity. All commands output JSONL by default for easy composition with `jq`.

## Quick Reference

| Command | Description |
|---------|-------------|
| [`fw`](#root-command) | Query cached activity (auto-syncs if needed) |
| [`fw sync`](./sync.md) | Fetch and update PR data from GitHub |
| [`fw query`](./query.md) | Filter and output cached entries |
| [`fw status`](./status.md) | Summarize PR activity |
| [`fw lookout`](./lookout.md) | PR reconnaissance (what needs attention) |
| [`fw recap`](./recap.md) | Human-readable summary |
| [`fw check`](./check.md) | Refresh staleness hints in cache |
| [`fw comment`](./comment.md) | Post a PR comment or reply |
| [`fw resolve`](./resolve.md) | Resolve review comment threads |
| [`fw config`](./config.md) | Manage configuration |
| [`fw schema`](./schema.md) | Print schema information |
| [`fw mcp`](./mcp.md) | Start MCP server for AI assistants |

## Root Command

Running `fw` directly queries cached activity. If no cache exists, it auto-syncs first.

```bash
fw [repo] [options]
```

### Arguments

| Argument | Description |
|----------|-------------|
| `repo` | Repository to query (`owner/repo` format). Auto-detects from git remote if omitted. |

### Options

| Option | Description |
|--------|-------------|
| `--pr <number>` | Filter by PR number |
| `--author <name>` | Filter by author |
| `--type <type>` | Filter by type (`comment`, `review`, `commit`, `ci`, `event`) |
| `--state <states>` | Filter by PR state (comma-separated: `open`, `closed`, `merged`, `draft`) |
| `--open` | Shorthand for `--state open` |
| `--draft` | Shorthand for `--state draft` |
| `--active` | Shorthand for `--state open,draft` |
| `--label <name>` | Filter by PR label (partial match) |
| `--since <duration>` | Filter by time (e.g., `24h`, `7d`) |
| `--limit <count>` | Limit number of results |
| `--stack` | Show entries grouped by Graphite stack |
| `--worklist` | Aggregate entries into per-PR summary |
| `--schema` | Print the query result schema (JSON) |
| `--json` | Output JSONL (default) |

### Examples

```bash
# Query current repo (auto-detected)
fw

# Query specific repo
fw outfitter-dev/firewatch

# Per-PR summary (minimal starting point)
fw --worklist

# Recent reviews from a specific author
fw --type review --author galligan --since 24h

# Open PRs with a label
fw --label bug --active
```

## Global Behavior

### Auto-Detection

When run inside a git repository with a GitHub remote, Firewatch auto-detects the repository. You can override by specifying `owner/repo` explicitly.

### Auto-Sync

If no cache exists for a repository, Firewatch automatically syncs before running your query. For explicit sync control, use `fw sync`.

### Output Format

All commands output JSONL by default. Each line is a complete JSON object. The `--json` flag is accepted but redundant (it's the default).

```bash
fw query --since 24h | jq '.author'
```

### Configuration Defaults

Commands respect configuration from `~/.config/firewatch/config.toml` and `.firewatch.toml`. See [Configuration](../configuration.md) for details.

## Command Groups

### Read Operations

- `fw`, `fw query` - Filter and retrieve cached entries
- `fw status` - Aggregated PR summaries (JSONL)
- `fw lookout` - PR reconnaissance with smart time defaults
- `fw recap` - Human-readable summary (text by default)
- `fw schema` - Schema documentation

### Write Operations

- `fw sync` - Fetch from GitHub (updates cache)
- `fw check` - Refresh staleness hints
- `fw comment` - Post comments
- `fw resolve` - Resolve threads

### Configuration

- `fw config show` - Display configuration
- `fw config set` - Update configuration
- `fw config path` - Show file paths

### Integration

- `fw mcp` - Start MCP server for AI assistant integration

## See Also

- [Configuration Reference](../configuration.md)
- [JSONL Schema](../schema.md)
- [jq Cookbook](../jq-cookbook.md)
- [MCP Server](../mcp.md)
