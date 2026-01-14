# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2025-01-14

### Added

- **CLI tool (`fw`)** for fetching, caching, and querying GitHub PR activity
- **Core commands**: `sync`, `query`, `status`, `check`, `comment`, `resolve`, `config`, `schema`
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
- **Staleness hints** via `fw check` to track post-feedback commits
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

[Unreleased]: https://github.com/outfitter-dev/firewatch/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/outfitter-dev/firewatch/releases/tag/v0.1.0
