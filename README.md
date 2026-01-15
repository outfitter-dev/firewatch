# Firewatch

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Firewatch is a CLI for fetching, caching, and querying GitHub PR activity. It outputs clean JSONL so agents and humans can focus on the actionable parts of review feedback without dragging a full GitHub context window into every step.

## Why Firewatch

PR feedback is scattered across reviews, comments, commits, and CI events. If you want the core signal, you usually end up making a lot of API calls and carrying around a lot of extra context. Firewatch keeps a local, denormalized activity cache so you can query just what you need.

## Installation

```bash
# Clone and install
git clone https://github.com/outfitter-dev/firewatch.git
cd firewatch
bun install

# Symlink the CLI
./scripts/symlink-dev.sh fw
```

## Quick Start

```bash
# Actionable items (default)
fw

# Per-PR summary
fw --summary

# Recent review activity
fw --since 24h --type review

# Tight status snapshot
fw status --short

# Post a reply and resolve thread
fw add 42 --reply comment-2001 "Fixed in abc123" --resolve
```

Running `fw` in a repo auto-syncs if the cache is stale, then runs your query.

## Documentation

| Document | Description |
|----------|-------------|
| [CLI Commands](docs/commands/README.md) | Complete command reference |
| [Configuration](docs/configuration.md) | Config files and options |
| [Schema Reference](docs/schema.md) | JSONL entry structure |
| [jq Cookbook](docs/jq-cookbook.md) | Practical query patterns |
| [MCP Server](docs/mcp.md) | AI agent integration |
| [Workflow Guide](docs/WORKFLOW.md) | Usage patterns and tips |

## Community

| Document | Description |
|----------|-------------|
| [Contributing](CONTRIBUTING.md) | Development setup and guidelines |
| [Changelog](CHANGELOG.md) | Release history |
| [Security](SECURITY.md) | Security policy and token handling |

## Configuration

Firewatch loads config from `~/.config/firewatch/config.toml` and `.firewatch.toml` (repo root).

```toml
repos = ["outfitter-dev/firewatch"]
max_prs_per_sync = 100

[user]
github_username = "galligan"

[sync]
auto_sync = true
stale_threshold = "5m"

[filters]
exclude_bots = true
exclude_authors = ["dependabot", "renovate"]

[output]
default_format = "human"
```

See [Configuration](docs/configuration.md) for all options.

## Graphite Integration

If the repo uses Graphite, Firewatch enriches entries with stack metadata automatically:

- Auto-detected when running inside a Graphite repo
- Stack metadata is included on entries and summaries
- No flags or config required

## Development

```bash
bun run dev       # Run CLI in watch mode
bun run check     # Lint + type check
bun run test      # Run tests
```

See [Contributing](CONTRIBUTING.md) for full setup instructions.

## License

MIT
