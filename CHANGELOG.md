# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-01-20

### Added

- `fw pr` and `fw fb` command groups with short IDs for comment workflows
- `fw ack` command for feedback acknowledgements with optional 👍 reactions
- `fw examples` command with jq patterns reference (alias: `fw patterns`)
- `fw claude-plugin` command for Claude Code plugin installation
- `commit_implies_read` config option to treat your commits as implicit feedback read
- `--before` filter for date range queries
- Issue comments included in feedback detection and worklist summaries
- Reaction capture for feedback comments during sync
- Focused MCP tools with short ID output in feedback responses
- MCP server instructions for Tool Search discovery

### Changed

- `--json` flag renamed to `--jsonl` for accuracy
- `--prs` flag renamed to `--pr` for consistency
- `fw fb` requires explicit `--body` flag (prevents ID misinterpretation)
- `fw close` tolerates partial failures and reports them
- Actionable summary and doctor output uses tree-style format

### Fixed

- Summary and filtering now honor PR filters consistently
- Orphaned feedback detection respects thread resolution state
- XDG environment variables respected on macOS
- `--all` repo discovery includes SQLite and sync metadata
- Short flag collisions resolved (`-a` for `--all` vs `--approve`)

## [0.1.0] - 2025-01-14

### Added

- **CLI tool (`fw`)** for fetching, caching, and querying GitHub PR activity
- **Core commands**: `fw`, `add`, `close`, `edit`, `rm`, `status`, `config`, `doctor`, `schema`, `mcp`
- **JSONL output** designed for `jq` composition and agent workflows
- **Denormalized entries** with full PR context in each record for easy filtering
- **Incremental sync** with cursor tracking for efficient updates
- **Adaptive authentication** chain: gh CLI, environment variables, config file token
- **XDG-compliant caching** with per-repo JSONL files
- **Graphite integration** for stack metadata enrichment
  - Auto-detection of Graphite-managed repositories
  - Stack ID, position, size, and parent PR tracking
  - File provenance for identifying which stack PR modified a file
- **Worklist aggregation** for per-PR summaries with activity counts
- **Staleness hints** in cached comment metadata to track post-feedback commits
- **Write operations** for posting comments and resolving review threads
- **MCP server** for AI agent integration via stdio
- **Configuration system** with user (`~/.config/firewatch/config.toml`) and project (`.firewatch.toml`) files
- **Query filtering** by repo, PR, author, type, state, label, and time range
- **State shortcuts**: `--open`, `--draft`, `--active` for common PR state filters

### Technical Details

- Built with Bun runtime for performance
- TypeScript with strict type safety
- Zod schemas for runtime validation
- Commander.js for CLI structure
- Native `fetch` for GitHub GraphQL API

[Unreleased]: https://github.com/outfitter-dev/firewatch/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/outfitter-dev/firewatch/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/outfitter-dev/firewatch/releases/tag/v0.1.0
