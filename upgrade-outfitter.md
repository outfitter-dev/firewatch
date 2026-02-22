# Outfitter Stack Upgrade

Firewatch uses `@outfitter/contracts` at `^0.1.0` but doesn't use other @outfitter packages (cli, config, logging, mcp) — it has its own shared logger package and uses `@modelcontextprotocol/sdk` and `commander` directly.

## Current vs Latest

| Package                | Current | Latest | Used In      |
| ---------------------- | ------- | ------ | ------------ |
| `@outfitter/contracts` | 0.1.0   | 0.2.0  | core, shared |

### Not yet adopted (opportunities)

| Package              | Latest | Opportunity                                                                            |
| -------------------- | ------ | -------------------------------------------------------------------------------------- |
| `@outfitter/cli`     | 0.3.0  | Replace raw Commander usage, get `--json` global flag, `OUTFITTER_ENV` profiles        |
| `@outfitter/mcp`     | 0.3.0  | Replace raw `@modelcontextprotocol/sdk` usage, get typed tools, resources, annotations |
| `@outfitter/logging` | 0.3.0  | Replace `@outfitter/firewatch-shared` logger with structured logging + redaction       |
| `@outfitter/config`  | 0.3.0  | Replace custom TOML config loading with XDG-compliant resolution + deep merge          |

## High-Value Opportunities

### 1. Adopt @outfitter/mcp (new)

The MCP server (`apps/mcp`) currently uses `@modelcontextprotocol/sdk` directly with a custom `FirewatchMCPServer` class. `@outfitter/mcp` 0.3.0 provides:

- `defineTool()` with typed handlers returning `Result<T, E>`
- Tool annotations (read-only for `fw_query`/`fw_status`, destructive for `fw_pr`)
- Resources — expose cached PR data as addressable MCP resources
- Progress reporting for long syncs
- Log forwarding to MCP clients

### 2. Adopt @outfitter/cli (new)

The CLI (`apps/cli`) uses raw Commander with manual `console.error()` + `process.exit()`. `@outfitter/cli` 0.3.0 provides:

- `createCLI()` wrapper with `--json` global flag (firewatch already has JSONL output — this would unify it)
- `exitWithError()` for proper error formatting and exit codes
- `output()` for consistent stdout handling
- `OUTFITTER_ENV` profiles for dev/prod/test defaults

### 3. Error factory methods (contracts 0.1.0 -> 0.2.0)

- `static create()` factories for `AuthError`, `ValidationError`, `NetworkError`, `NotFoundError`
- `expect()` utility for unwrapping Results at CLI/MCP boundaries

### 4. Consolidate shared package

`@outfitter/firewatch-shared` currently only exports a logger and constants. With `@outfitter/logging` adoption, the shared package could be eliminated or reduced to just constants.

## Anti-Patterns to Address

- **~15 thrown exceptions** in `apps/mcp/` and `packages/core/` (sync.ts, config.ts, repo.ts) — should return `Result.err()` instead
- **console.log in core** (`query.ts:224`) — JSONL output should go through a proper output boundary
- **console.error in config** — should use structured logging

## Getting Started

Run `/outfitter-update` to upgrade `@outfitter/contracts`, then consider `/outfitter-start` to adopt the remaining packages (`cli`, `mcp`, `logging`, `config`) incrementally.
