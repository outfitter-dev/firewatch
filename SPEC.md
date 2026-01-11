# Firewatch Specification

> GitHub PR activity logger with pure JSONL output for jq-based workflows.

## Overview

Firewatch is a standalone CLI tool for fetching, caching, and querying GitHub PR activity. It prioritizes:

- **Pure JSONL** — Every output is valid JSONL, designed for `jq` composition
- **Minimal API calls** — GraphQL bulk fetches + incremental sync
- **Smart caching** — XDG-compliant global cache with per-repo tracking
- **Zero config fast path** — Works immediately if `gh` CLI is authenticated

## Architecture Decisions

| Area             | Decision                                             | Rationale                                                         |
| ---------------- | ---------------------------------------------------- | ----------------------------------------------------------------- |
| **Architecture** | Hybrid — standalone CLI with optional webhook worker | CLI covers 95% of use cases; worker available for real-time needs |
| **API Strategy** | Adaptive: `gh` CLI → GitHub PAT → error              | Zero-config when gh is available; explicit PAT as fallback        |
| **Storage**      | Per-repo JSONL files                                 | Clean incremental updates, parallelizable, combine with `jq -s`   |
| **Schema**       | Fully denormalized                                   | Each line self-contained for jq queries without joins             |
| **Integrations** | Plugin architecture                                  | Core is GitHub-only; Graphite/Linear/GitLab via plugins           |
| **CLI Design**   | Minimal: `sync`, `query`, `config`                   | Let jq handle complex transformations                             |
| **Runtime**      | Bun-native APIs                                      | Native fetch, file I/O, shell — minimal dependencies              |
| **Linting**      | Ultracite with oxlint/oxfmt                          | 50-100x faster than ESLint, Rust-powered                          |
| **Interfaces**   | Core library + CLI + MCP                             | Core logic reusable across interfaces                             |

## Project Structure

```
firewatch/
├── src/
│   ├── core/                    # Pure logic (no CLI/MCP concerns)
│   │   ├── index.ts             # Core exports
│   │   ├── auth.ts              # Adaptive auth (gh CLI / PAT detection)
│   │   ├── github.ts            # GitHub GraphQL client
│   │   ├── cache.ts             # XDG cache management
│   │   ├── sync.ts              # Incremental sync logic
│   │   └── query.ts             # JSONL query engine
│   ├── schema/
│   │   ├── entry.ts             # JSONL record schema (Zod)
│   │   └── config.ts            # Config schema
│   ├── plugins/                 # Plugin interface
│   │   ├── types.ts             # Plugin contract
│   │   └── graphite/            # Graphite stack integration
│   │       └── index.ts
│   ├── cli/                     # CLI interface
│   │   ├── index.ts             # CLI entry point
│   │   └── commands/
│   │       ├── sync.ts
│   │       ├── query.ts
│   │       └── config.ts
│   └── mcp/                     # MCP server (future)
│       └── index.ts
├── bin/
│   └── fw.ts                    # Global CLI entry (#!/usr/bin/env bun)
├── package.json
├── tsconfig.json
├── .oxlintrc.json               # Ultracite oxlint config
├── .oxfmtrc.jsonc               # Ultracite oxfmt config
└── README.md
```

## Tooling

### Linting & Formatting (Ultracite + Oxc)

Uses [Ultracite](https://docs.ultracite.ai/) with oxlint/oxfmt for 50-100x faster linting:

```bash
# Install
bun add -D ultracite

# Initialize (generates .oxlintrc.json and .oxfmtrc.jsonc)
bunx ultracite init --provider oxlint
```

**Oxfmt defaults:**

- 2-space indentation
- 80 character line width
- Semicolons always
- Single quotes
- ES5 trailing commas

### Bun-Native Patterns

Leverage Bun's built-in capabilities:

| Need     | Bun Pattern                 | Why                         |
| -------- | --------------------------- | --------------------------- |
| HTTP     | Native `fetch`              | Built-in, no package needed |
| File I/O | `Bun.file()`, `Bun.write()` | Fast, streaming support     |
| Shell    | `$` template literal        | Auto-escaping, clean syntax |
| TOML     | `@std/toml`                 | Standard library            |
| Build    | `bun build --compile`       | Single executable output    |

**Shell execution example:**

```typescript
import { $ } from "bun";

// Detect gh CLI auth
const { exitCode, stdout } = await $`gh auth status`.nothrow();
const authenticated = exitCode === 0;

// Get token
const token = (await $`gh auth token`.text()).trim();
```

**File streaming example:**

```typescript
// Append to JSONL without loading full file
await Bun.write(cachePath, jsonLine + "\n", { append: true });

// Stream read
const file = Bun.file(cachePath);
const text = await file.text();
```

## Cache Structure

XDG Base Directory compliant (cross-platform via `env-paths`):

```
~/.cache/firewatch/              # XDG_CACHE_HOME/firewatch
├── repos/
│   ├── outfitter-dev-ranger.jsonl
│   └── outfitter-dev-blz.jsonl
└── meta.jsonl                   # Sync state per repo

~/.config/firewatch/             # XDG_CONFIG_HOME/firewatch
└── config.toml                  # User settings

~/.local/share/firewatch/        # XDG_DATA_HOME/firewatch
└── (future: persistent data)
```

## JSONL Schema

Each line is fully self-contained (denormalized):

```typescript
interface FirewatchEntry {
  // Identity
  id: string; // Unique entry ID
  repo: string; // "owner/repo"
  pr: number;

  // PR context (denormalized for jq queries)
  pr_title: string;
  pr_state: "open" | "closed" | "merged" | "draft";
  pr_author: string;
  pr_branch: string;

  // Entry data
  type: "comment" | "review" | "commit" | "ci" | "event";
  subtype?: string; // "review_comment", "issue_comment", etc.
  author: string;
  body?: string;
  state?: string; // "approved", "changes_requested", etc.

  // Timestamps
  created_at: string; // ISO 8601
  updated_at?: string;
  captured_at: string; // When we fetched it

  // Metadata
  url?: string;
  file?: string; // For code comments
  line?: number;

  // Plugin data (optional)
  graphite?: {
    stack_id?: string; // Graphite stack identifier
    stack_position?: number; // Position in stack (1 = bottom)
    stack_size?: number; // Total PRs in stack
    parent_pr?: number; // Parent PR in stack
  };
}
```

## Sync Metadata

Tracks incremental sync state per repository:

```jsonl
{"repo":"outfitter-dev/ranger","last_sync":"2026-01-11T10:00:00Z","cursor":"abc123","pr_count":42}
{"repo":"outfitter-dev/blz","last_sync":"2026-01-10T15:30:00Z","cursor":"def456","pr_count":18}
```

## CLI Commands

Binary: `fw` (short for firewatch)

### sync

Fetch and update PR data from GitHub.

```bash
fw sync                           # Sync all configured repos
fw sync outfitter-dev/ranger      # Sync specific repo
fw sync --full                    # Force full refresh (ignore cursor)
fw sync --since 7d                # Only PRs updated in last 7 days
fw sync --with-graphite           # Include Graphite stack metadata
```

### query

Filter and output JSONL to stdout. Pipe to `jq` for complex queries.

```bash
fw query                          # All entries
fw query --repo ranger            # Filter by repo (partial match)
fw query --pr 42                  # Filter by PR number
fw query --author galligan        # Filter by author
fw query --type review            # Filter by type
fw query --since 24h              # Filter by time
fw query --stack                  # Show entries grouped by Graphite stack
```

### config

Manage settings.

```bash
fw config show                    # Display current config
fw config set repos "org/repo1,org/repo2"
fw config set github-token <token>  # Optional if gh CLI works
```

## Example jq Workflows

```bash
# Approved reviews in last 24 hours
fw query --since 24h | jq 'select(.type == "review" and .state == "approved")'

# Comment count by author for PR 42
fw query --pr 42 | jq -s 'group_by(.author) | map({author: .[0].author, count: length})'

# All open PRs with pending reviews
fw query --type review | jq -s '
  group_by(.pr) |
  map(select(any(.state == "changes_requested"))) |
  map(.[0] | {pr, pr_title, repo})
'

# Export to CSV (via jq)
fw query | jq -r '[.repo, .pr, .type, .author, .created_at] | @csv'

# Find reviews for PRs in a Graphite stack
fw query --type review | jq 'select(.graphite.stack_id == "feat-auth")'
```

## Authentication

Adaptive auth detection (in order):

1. **gh CLI** — If `gh auth status` succeeds, use `gh api graphql`
2. **Environment variable** — `GITHUB_TOKEN` or `FIREWATCH_GITHUB_TOKEN`
3. **Config file** — Token in `~/.config/firewatch/config.toml`
4. **Error** — Clear message explaining auth options

## Incremental Sync Strategy

1. **First sync**: Fetch all open PRs + recently closed (last 30 days)
2. **Subsequent syncs**: Use `updated_at` ordering + cursor to fetch only changes
3. **Weekly full refresh**: Catch edge cases (force pushes, deletions)
4. **GraphQL efficiency**: Single query fetches 50+ PRs with all reviews/comments

## Plugin Architecture

### Plugin Contract

```typescript
interface FirewatchPlugin {
  name: string;
  version: string;

  // Called during sync to enrich entries
  enrich?(entry: FirewatchEntry): Promise<FirewatchEntry>;

  // Called to provide additional query filters
  queryFilters?(): Record<
    string,
    (entry: FirewatchEntry, value: string) => boolean
  >;

  // Called on CLI init
  init?(config: FirewatchConfig): Promise<void>;
}
```

### Graphite Plugin

Enriches entries with Graphite stack context:

```typescript
// plugins/graphite/index.ts
import { $ } from "bun";
import type { FirewatchPlugin, FirewatchEntry } from "../types";

export const graphitePlugin: FirewatchPlugin = {
  name: "graphite",
  version: "1.0.0",

  async enrich(entry: FirewatchEntry): Promise<FirewatchEntry> {
    // Get stack info for the PR's branch
    const { stdout } = await $`gt log --json`.nothrow();
    const stacks = JSON.parse(stdout.toString());

    const stack = stacks.find((s: any) =>
      s.branches.some((b: any) => b.prNumber === entry.pr)
    );

    if (stack) {
      const position = stack.branches.findIndex(
        (b: any) => b.prNumber === entry.pr
      );
      entry.graphite = {
        stack_id: stack.name,
        stack_position: position + 1,
        stack_size: stack.branches.length,
        parent_pr:
          position > 0 ? stack.branches[position - 1].prNumber : undefined,
      };
    }

    return entry;
  },

  queryFilters() {
    return {
      stack: (entry, value) => entry.graphite?.stack_id === value,
      "stack-position": (entry, value) =>
        entry.graphite?.stack_position === parseInt(value),
    };
  },
};
```

**Use case**: Agents navigating stacked PRs can understand where a reviewed file exists in the stack hierarchy.

## MCP Server (Future)

The core logic is designed to be interface-agnostic. An MCP server would expose:

```typescript
// Planned MCP tools
tools: [
  {
    name: "firewatch_sync",
    description: "Sync PR data from GitHub",
    inputSchema: { repo: "string", full: "boolean?" },
  },
  {
    name: "firewatch_query",
    description: "Query cached PR activity",
    inputSchema: {
      repo: "string?",
      pr: "number?",
      type: "string?",
      since: "string?",
    },
  },
  {
    name: "firewatch_stack",
    description: "Get Graphite stack for a PR",
    inputSchema: { pr: "number", repo: "string" },
  },
];
```

This allows AI agents to query PR activity directly without shelling out to the CLI.

## Implementation Phases

### Phase 1: Project Setup

- [ ] Initialize with Bun
- [ ] Configure Ultracite (oxlint + oxfmt)
- [ ] Set up tsconfig with strict mode
- [ ] Create project structure (core/cli/plugins)

### Phase 2: Core Library

- [ ] Implement XDG path resolution (`env-paths`)
- [ ] Implement adaptive auth detection (Bun shell `$`)
- [ ] Define JSONL schema with Zod validation
- [ ] Build GitHub GraphQL client (native fetch)
- [ ] Implement cache read/write (Bun.file)
- [ ] Incremental sync with cursor tracking

### Phase 3: CLI (`fw`)

- [ ] Wire up commander with core library
- [ ] Implement `fw sync`
- [ ] Implement `fw query`
- [ ] Implement `fw config`
- [ ] Global npm installation setup

### Phase 4: Graphite Plugin

- [ ] Plugin interface definition
- [ ] Graphite stack detection via `gt log --json`
- [ ] Enrich entries with stack metadata
- [ ] Stack-aware query filters

### Phase 5: Polish

- [ ] README with examples
- [ ] Shell completions (fish, zsh, bash)
- [ ] Error handling and retry logic
- [ ] Rate limit awareness

### Phase 6: MCP Server (Future)

- [ ] Define MCP tool schemas
- [ ] Expose core functions as MCP tools
- [ ] Separate package or optional entry point

## Dependencies

### Runtime

- `env-paths` — XDG-compliant path resolution
- `zod` — Schema validation
- `commander` — CLI parsing
- `@std/toml` — Config file parsing (Bun stdlib)

### Development

- `bun` — Runtime and build
- `typescript` — Type safety
- `ultracite` — Linting/formatting (oxlint + oxfmt)

### Optional (Plugin)

- `@anthropic-ai/sdk` — MCP server (if building MCP interface)

## Scripts

```json
{
  "scripts": {
    "dev": "bun --watch src/cli/index.ts",
    "build": "bun build ./src/cli/index.ts --outfile dist/fw.js --minify",
    "build:bin": "bun build ./bin/fw.ts --compile --outfile dist/fw",
    "lint": "bunx oxlint",
    "format": "bunx oxfmt --write .",
    "check": "bunx oxlint && bunx tsc --noEmit",
    "test": "bun test",
    "prepublishOnly": "bun run check && bun run build"
  }
}
```

## Open Questions (Deferred)

- **npm name**: Verify `firewatch` availability (fallback: `@outfitter/firewatch`)
- **Worker protocol**: How CLI connects to optional webhook worker
- **MCP packaging**: Separate package or single package with multiple entry points

---

_Generated from pathfinding session on 2026-01-11_
_Updated with Bun patterns, Ultracite tooling, and Graphite plugin_
