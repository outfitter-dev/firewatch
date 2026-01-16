# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Firewatch is a CLI tool that fetches, caches, and queries GitHub PR activity. It outputs pure JSONL designed for `jq` composition. The binary is `fw`.

## Development Commands

```bash
bun run dev              # Run CLI with --watch for development
bun run build            # Build minified JS bundle
bun run build:bin        # Build standalone native binary
bun run check            # Lint (oxlint) + type check (tsc --noEmit)
bun run test             # Run tests with bun test
bun run lint             # Run oxlint
bun run lint:fix         # Run oxlint with auto-fix
bun run format           # Run oxfmt
```

Run the CLI directly during development:

```bash
bun bin/fw.ts sync outfitter-dev/firewatch
bun bin/fw.ts query --type review --since 24h
```

## Architecture

```
src/
├── core/           # Pure logic, no CLI/MCP concerns
│   ├── auth.ts     # Adaptive auth: gh CLI → env → config
│   ├── github.ts   # GraphQL client using native fetch
│   ├── cache.ts    # XDG-compliant JSONL storage
│   ├── sync.ts     # Incremental sync with cursor tracking
│   ├── query.ts    # JSONL filtering and output
│   └── repo-detect.ts  # Auto-detect repo from git/package.json/Cargo.toml
├── schema/         # Zod schemas for type safety and validation
├── plugins/        # Plugin interface for extensions (e.g., Graphite stacks)
├── cli/            # Commander-based CLI wiring
└── mcp/            # Future MCP server interface
```

### Key Patterns

**Layered architecture**: Core library functions in `src/core/` are interface-agnostic. CLI (`src/cli/`) and future MCP server (`src/mcp/`) wire these to different interfaces.

**Adaptive auth** (`src/core/auth.ts:55`): Tries gh CLI first, then environment variables, then config file token.

**Denormalized JSONL**: Each entry is self-contained with PR context embedded. No joins needed for jq queries.

**Plugin enrichment** (`src/plugins/types.ts`): Plugins can enrich entries during sync (e.g., add Graphite stack metadata) and provide custom query filters.

**Bun-native APIs**: Uses `$` shell template, `Bun.file()`, `Bun.write()`, native `fetch`. Minimal dependencies.

### Data Flow

1. `fw sync` → `detectAuth()` → `GitHubClient.fetchPRActivity()` (GraphQL) → `prToEntries()` → `appendJsonl()`
2. `fw query` → `readJsonl()` → filter → `outputJsonl()` (stdout, pipe to jq)

### Cache Structure

XDG-compliant paths (cross-platform via `env-paths`):

- `~/.cache/firewatch/repos/*.jsonl` — Per-repo activity entries
- `~/.cache/firewatch/meta.jsonl` — Sync state with cursors
- `~/.config/firewatch/config.toml` — User configuration

## Conventions

**Naming**: `camelCase` for variables/functions, `PascalCase` for types/classes, `kebab-case` for CLI flags.

**Testing**: Tests via `bun test`. Use `*.test.ts` colocated with modules or in `tests/`. Focus on core logic before CLI wiring.

**Commits**: Conventional Commits (`feat:`, `fix:`, `chore:`). Small PRs with clear descriptions.

## Integration Notes

Firewatch integrates with external services (GitHub, Graphite). Implementation details, API quirks, and workarounds are documented in `docs/development/`:

- [GitHub Integration](docs/development/github-integration.md) — GraphQL API patterns, auth chain, data mapping, rate limiting
- [Graphite Integration](docs/development/graphite-integration.md) — gt CLI capabilities/limitations, file provenance, stack detection

Update these docs when discovering new API behaviors or implementing new integration features.
