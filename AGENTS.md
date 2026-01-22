# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Firewatch is a CLI tool that fetches, caches, and queries GitHub PR activity. It outputs pure JSONL designed for `jq` composition. The binary is `fw`.

## Development Commands

This is a Bun workspaces monorepo. Root scripts delegate to workspace packages:

```bash
bun run dev              # Run CLI with --watch (delegates to @outfitter/firewatch-cli)
bun run build            # Build all workspace packages
bun run check            # Lint (oxlint) + type check all packages
bun run test             # Run tests with bun test
bun run lint             # Run oxlint
bun run lint:fix         # Run oxlint with auto-fix
bun run format           # Run oxfmt
```

Run the CLI directly during development:

```bash
bun apps/cli/bin/fw.ts sync outfitter-dev/firewatch
bun apps/cli/bin/fw.ts query --type review --since 24h
bun apps/cli/bin/fw.ts status --short
```

For a local `fw-dev` alias during development:

```bash
./scripts/symlink-dev.sh          # Links ~/.bun/bin/fw-dev -> apps/cli/dist/fw
./scripts/symlink-dev.sh fw-local # Custom alias
```

## Architecture

```
apps/
├── cli/                    # @outfitter/firewatch-cli - Commander-based CLI
│   ├── bin/fw.ts           # Entry point
│   └── src/commands/       # Command implementations
└── mcp/                    # @outfitter/firewatch-mcp - MCP server interface

packages/
├── core/                   # @outfitter/firewatch-core - Pure library logic
│   ├── auth.ts             # Adaptive auth: gh CLI → env → config
│   ├── github.ts           # GraphQL client using native fetch
│   ├── cache.ts            # XDG-compliant JSONL storage
│   ├── sync.ts             # Incremental sync with cursor tracking
│   ├── query.ts            # JSONL filtering and output
│   ├── check.ts            # Staleness detection & file activity hints
│   ├── worklist.ts         # Per-PR summary aggregation, stack-aware ordering
│   ├── config.ts           # Config loading (.firewatch.toml, XDG config)
│   ├── time.ts             # Duration parsing (7d, 24h, etc.)
│   ├── repo-detect.ts      # Auto-detect repo from git/package.json/Cargo.toml
│   ├── schema/             # Zod schemas for type safety
│   └── plugins/            # Plugin interface (e.g., Graphite stacks)
├── shared/                 # @outfitter/firewatch-shared - Shared utilities
└── claude-plugin/          # Local Claude Code plugin marketplace
    ├── .claude-plugin/
    │   └── marketplace.json  # Marketplace manifest
    └── firewatch/            # Firewatch plugin
        ├── .claude-plugin/
        │   └── plugin.json   # Plugin manifest
        ├── commands/         # /firewatch:* commands
        ├── hooks/            # Session lifecycle hooks
        ├── scripts/          # Hook scripts
        └── skills/firewatch/ # triage, respond skills
```

### CLI Commands

| Command  | Description                                                       |
| -------- | ----------------------------------------------------------------- |
| `fw`     | Query cached activity (auto-syncs; `--summary` for per-PR rollup) |
| `add`    | Add comments, reviews, or metadata                                |
| `close`  | Resolve review comment threads by ID                              |
| `edit`   | Update PR fields or draft/ready                                   |
| `rm`     | Remove labels/reviewers/assignees/milestone                       |
| `status` | Firewatch state info (`--short` for compact view)                 |
| `config` | View/edit configuration                                           |
| `doctor` | Diagnose auth/cache/repo issues                                   |
| `schema` | Print JSON schema for output formats                              |
| `mcp`    | Start MCP server for AI tool integration                          |

### Key Patterns

**Layered architecture**: Core library functions in `packages/core/` are interface-agnostic. CLI (`apps/cli/`) and MCP server (`apps/mcp/`) wire these to different interfaces.

**Adaptive auth** (`packages/core/src/auth.ts`): Tries gh CLI first, then environment variables, then config file token.

**Denormalized JSONL**: Each entry is self-contained with PR context embedded. No joins needed for jq queries.

**Plugin enrichment** (`packages/core/src/plugins/`): Plugins can enrich entries during sync (e.g., add Graphite stack metadata) and provide custom query filters. The Graphite plugin adds stack position, parent PR tracking, and file provenance.

**Worklist aggregation** (`packages/core/src/worklist.ts`): Aggregates entries into per-PR summaries with counts, stack-aware ordering for Graphite users.

**Bun-native APIs**: Uses `$` shell template, `Bun.file()`, `Bun.write()`, native `fetch`. Minimal dependencies.

### Data Flow

**Read operations:**

1. `fw` (auto-sync if stale) → `detectAuth()` → `GitHubClient.fetchPRActivity()` (GraphQL) → plugin enrichment → `appendJsonl()`
2. `fw` → `readJsonl()` → filter → `outputJsonl()` (stdout, pipe to jq)
3. `fw --summary` → `readJsonl()` → `buildWorklist()` → formatted output
4. `fw status` → cache/auth/config diagnostics

**Write operations:**

1. `fw add <pr> "text"` → `GitHubClient.addComment()` → GitHub API
2. `fw close <comment-id>` → `GitHubClient.resolveThread()` → GitHub API
3. `fw edit <pr> --title ...` → `GitHubClient.editPullRequest()` → GitHub API
4. `fw rm <pr> --label ...` → `GitHubClient.removeLabels()` → GitHub API

### Cache Structure

XDG-compliant paths (cross-platform via `env-paths`):

- `~/.cache/firewatch/repos/*.jsonl` — Per-repo activity entries
- `~/.cache/firewatch/meta.jsonl` — Sync state with cursors
- `~/.config/firewatch/config.toml` — User configuration
- `.firewatch.toml` — Project-local configuration (optional)

### MCP Server

The MCP server (`apps/mcp/`) exposes a single `firewatch` tool with an `action` parameter. This unified design keeps the tool surface simple for AI agents.

**Actions:**

| Action   | Description                                                         |
| -------- | ------------------------------------------------------------------- |
| `query`  | Filter entries (supports CLI query options; `summary` for worklist) |
| `add`    | Post comments/reviews or add metadata                               |
| `close`  | Resolve review comment threads                                      |
| `edit`   | Update PR fields or draft/ready                                     |
| `rm`     | Remove labels/reviewers/assignees/milestone                         |
| `status` | Firewatch state info (`status_short: true` for compact)             |
| `config` | Read config (read-only)                                             |
| `doctor` | Diagnose auth/cache/repo                                            |
| `schema` | Output JSON schema for entries/worklist/config                      |
| `help`   | Usage documentation                                                 |

**Example calls:**

```json
{"action": "schema"}
{"action": "query", "since": "24h", "type": "review"}
{"action": "query", "summary": true, "summary_short": true}
{"action": "add", "pr": 42, "body": "LGTM", "reply_to": "IC_...", "resolve": true}
```

Start via `fw mcp` or directly with `bun apps/mcp/bin/fw-mcp.ts`.

## Conventions

**Naming**: `camelCase` for variables/functions, `PascalCase` for types/classes, `kebab-case` for CLI flags.

**Workspace imports**: Import from package names, not relative paths across packages:

```typescript
import { GitHubClient } from "@outfitter/firewatch-core";
import { formatDuration } from "@outfitter/firewatch-shared";
```

**Testing**: Tests via `bun test`. Use `*.test.ts` colocated with modules or in `tests/`. Focus on core logic before CLI wiring.

**Commits**: Conventional Commits (`feat:`, `fix:`, `chore:`). Small PRs with clear descriptions.

## Integration Notes

Firewatch integrates with external services (GitHub, Graphite). Implementation details, API quirks, and workarounds are documented in `docs/development/`:

- [GitHub Integration](docs/development/github-integration.md) — GraphQL API patterns, auth chain, data mapping, rate limiting
- [Graphite Integration](docs/development/graphite-integration.md) — gt CLI capabilities/limitations, file provenance, stack detection

Update these docs when discovering new API behaviors or implementing new integration features.
