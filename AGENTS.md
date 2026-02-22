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
├── cli/                    # @outfitter/firewatch-cli - CLI (Commander + @outfitter/cli)
│   ├── bin/fw.ts           # Entry point
│   └── src/commands/       # Thin command adapters calling core handlers
└── mcp/                    # @outfitter/firewatch-mcp - MCP server (@outfitter/mcp)

packages/
├── core/                   # @outfitter/firewatch-core - Pure library logic
│   ├── handlers/           # Transport-agnostic handlers (Result-based)
│   │   ├── types.ts        # HandlerContext, Handler<TInput, TOutput, TError>
│   │   ├── approve.ts      # PR approval
│   │   ├── reject.ts       # PR request-changes
│   │   ├── comment.ts      # PR-level comments
│   │   ├── reply.ts        # Review thread replies
│   │   ├── close.ts        # Thread resolution / PR close
│   │   ├── ack.ts          # Local acknowledgement
│   │   ├── edit.ts         # PR/comment editing
│   │   ├── query.ts        # Entry filtering pipeline
│   │   ├── sync.ts         # Incremental sync orchestration
│   │   ├── status.ts       # Cache/auth/config diagnostics
│   │   ├── doctor.ts       # Setup issue diagnosis
│   │   └── index.ts        # Barrel exports
│   ├── ack.ts              # Local acknowledgement tracking
│   ├── auth.ts             # Adaptive auth: gh CLI → env → config
│   ├── authors.ts          # Author filtering and bot detection
│   ├── batch.ts            # Batch operations (reactions, ID resolution)
│   ├── cache.ts            # XDG-compliant paths and directory setup
│   ├── check.ts            # Staleness detection & file activity hints
│   ├── config.ts           # Config loading (.firewatch.toml, XDG config)
│   ├── db.ts               # SQLite database initialization
│   ├── github.ts           # GraphQL client using native fetch
│   ├── parity.ts           # CLI/MCP shared operations
│   ├── query.ts            # Entry filtering with SQLite queries
│   ├── repo-detect.ts      # Auto-detect repo from git/package.json/Cargo.toml
│   ├── repository.ts       # SQLite repository operations (CRUD, sync metadata)
│   ├── short-id.ts         # Short ID generation and resolution
│   ├── sync.ts             # Incremental sync with cursor tracking
│   ├── time.ts             # Duration parsing (7d, 24h, etc.)
│   ├── worklist.ts         # Per-PR summary aggregation, stack-aware ordering
│   ├── schema/             # Zod schemas for type safety
│   ├── stack/              # Stack provider abstraction (Graphite, future GitHub)
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

| Command    | Description                                    |
| ---------- | ---------------------------------------------- |
| `query`    | Query cached activity (JSONL output for jq)    |
| `list`     | Opinionated feedback view (`list prs` for PRs) |
| `view`     | View PR or comment details (polymorphic)       |
| `reply`    | Reply to a comment                             |
| `comment`  | Add PR-level comment                           |
| `ack`      | Acknowledge feedback (local tracking)          |
| `close`    | Resolve thread or close PR (polymorphic)       |
| `approve`  | Approve PR (GitHub review)                     |
| `reject`   | Request changes on PR (GitHub review)          |
| `edit`     | Edit PR or comment (polymorphic)               |
| `sync`     | Sync cache (`--clear` to reset)                |
| `status`   | Show Firewatch state                           |
| `config`   | View/edit configuration                        |
| `doctor`   | Diagnose setup issues                          |
| `schema`   | Print JSON schema                              |
| `examples` | Show jq patterns                               |
| `mcp`      | Start MCP server                               |

### Key Patterns

**Handler contract** (`packages/core/src/handlers/`): All business logic lives in transport-agnostic handlers that take typed input + `HandlerContext` and return `Result<TOutput, TError>`. CLI commands and MCP tools are thin adapters. See `handlers/types.ts` for the contract:

```typescript
type Handler<TInput, TOutput, TError extends Error = Error> = (
  input: TInput,
  ctx: HandlerContext
) => Promise<Result<TOutput, TError>>;
```

**Layered architecture**: Core library functions in `packages/core/` are interface-agnostic. CLI (`apps/cli/`) uses `@outfitter/cli` (`createCLI`, `exitWithError`). MCP server (`apps/mcp/`) uses `@outfitter/mcp` (`createMcpServer`, `defineTool`, `connectStdio`). Both call the same core handlers.

**Result types** (`@outfitter/contracts`): All core functions return `Result<T, E>` using taxonomy errors (`AuthError`, `NetworkError`, `NotFoundError`, `ValidationError`). CLI maps errors to exit codes via `exitWithError()`. MCP maps errors to JSON-RPC error codes automatically.

**Adaptive auth** (`packages/core/src/auth.ts`): Tries gh CLI first, then environment variables, then config file token.

**SQLite storage**: Entries stored in SQLite with denormalized PR context. Output as JSONL for jq composition.

**Plugin enrichment** (`packages/core/src/plugins/`): Plugins can enrich entries during sync (e.g., add Graphite stack metadata) and provide custom query filters. The Graphite plugin adds stack position, parent PR tracking, and file provenance.

**Worklist aggregation** (`packages/core/src/worklist.ts`): Aggregates entries into per-PR summaries with counts, stack-aware ordering for Graphite users.

**Bun-native APIs**: Uses `$` shell template, `Bun.file()`, `Bun.write()`, native `fetch`. Minimal dependencies.

### Data Flow

**Read operations:**

1. `fw query` (auto-sync if stale) → `detectAuth()` → `GitHubClient.fetchPRActivity()` (GraphQL) → plugin enrichment → SQLite insert
2. `fw query` → `queryEntries()` (SQLite) → filter → JSONL output (stdout, pipe to jq)
3. `fw list` → `queryEntries()` → `buildWorklist()` → formatted worklist output
4. `fw status` → cache/auth/config diagnostics

**Write operations:**

1. `fw comment <pr> "text"` → `GitHubClient.addIssueComment()` → GitHub API
2. `fw reply <id> "text"` → `GitHubClient.addReviewThreadReply()` → GitHub API
3. `fw approve <pr>` → `GitHubClient.addReview()` → GitHub API
4. `fw reject <pr>` → `GitHubClient.addReview()` → GitHub API
5. `fw close <id>` → `GitHubClient.resolveReviewThread()` or `closePR()` → GitHub API
6. `fw edit <id>` → `GitHubClient.editPullRequest()` or `editComment()` → GitHub API

### Cache Structure

XDG-compliant paths (cross-platform via `env-paths`):

- `~/.cache/firewatch/firewatch.db` — SQLite database (entries, PRs, sync metadata, acks)
- `~/.config/firewatch/config.toml` — User configuration
- `.firewatch.toml` — Project-local configuration (optional)

### MCP Server

The MCP server (`apps/mcp/`) uses `@outfitter/mcp` with `createMcpServer()`, `defineTool()`, and `connectStdio()`. It exposes 6 tools with auth-gated write operations and MCP tool annotations.

**Base tools (always available):**

| Tool        | Annotations     | Description                                            |
| ----------- | --------------- | ------------------------------------------------------ |
| `fw_query`  | readOnly        | Query cached PR activity (supports summary, filters)   |
| `fw_status` | readOnly        | Cache and auth status (`short` for compact)            |
| `fw_doctor` | readOnly        | Diagnose auth/cache/repo issues (`fix` to auto-repair) |
| `fw_help`   | readOnly        | Usage docs, JSON schemas, config inspection            |

**Write tools (require authentication):**

| Tool    | Annotations     | Description                                                |
| ------- | --------------- | ---------------------------------------------------------- |
| `fw_pr` | destructive     | PR mutations: edit fields, manage metadata, submit reviews |
| `fw_fb` | destructive     | Unified feedback: list, view, reply, ack, resolve          |

**Example calls:**

```json
{"since": "24h", "type": "review", "summary": true}
{"pr": 42, "action": "edit", "title": "feat: new feature"}
{"id": "@a7f3c", "body": "Fixed", "resolve": true}
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
