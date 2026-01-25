# Firewatch Specification

> GitHub PR activity logger with pure JSONL output for jq-based workflows.

## Overview

Firewatch is a standalone CLI tool for fetching, caching, and querying GitHub PR activity. It prioritizes:

- **Pure JSONL** — Every output is valid JSONL, designed for `jq` composition
- **Minimal API calls** — GraphQL bulk fetches + incremental sync
- **Smart caching** — XDG-compliant global cache with per-repo tracking
- **Zero config fast path** — Works immediately if `gh` CLI is authenticated

## Architecture Decisions

| Area             | Decision                                           | Rationale                                                       |
| ---------------- | -------------------------------------------------- | --------------------------------------------------------------- |
| **Architecture** | Monorepo with core + CLI + MCP                     | Core logic reusable across interfaces                           |
| **API Strategy** | Adaptive: `gh` CLI → GitHub PAT → error            | Zero-config when gh is available; explicit PAT as fallback      |
| **Storage**      | Per-repo JSONL files                               | Clean incremental updates, parallelizable, combine with `jq -s` |
| **Schema**       | Fully denormalized                                 | Each line self-contained for jq queries without joins           |
| **Integrations** | Plugin architecture                                | Core is GitHub-only; Graphite via plugins                       |
| **CLI Design**   | Bare `fw` + CRUD verbs (`add`/`edit`/`rm`/`close`) | Most common actions are shortest                                |
| **Runtime**      | Bun-native APIs                                    | Native fetch, file I/O, shell — minimal dependencies            |
| **Linting**      | Ultracite with oxlint/oxfmt                        | 50-100x faster than ESLint, Rust-powered                        |

## Project Structure

```
firewatch/
├── apps/
│   ├── cli/                    # @outfitter/firewatch-cli
│   │   ├── bin/fw.ts           # CLI entry point
│   │   └── src/commands/       # Command implementations
│   └── mcp/                    # @outfitter/firewatch-mcp
├── packages/
│   ├── core/                   # @outfitter/firewatch-core
│   │   ├── auth.ts             # Adaptive auth
│   │   ├── github.ts           # GraphQL + REST client
│   │   ├── cache.ts            # XDG cache management
│   │   ├── sync.ts             # Incremental sync logic
│   │   ├── query.ts            # JSONL query engine
│   │   ├── worklist.ts         # Per-PR summary aggregation
│   │   ├── schema/             # Zod schemas
│   │   └── plugins/            # Plugin interface
│   └── shared/                 # Shared utilities
└── docs/                        # Documentation
```

## Cache Structure

XDG Base Directory compliant (cross-platform via `env-paths`):

```
~/.cache/firewatch/              # XDG_CACHE_HOME/firewatch
├── repos/
│   └── b64~<encoded-repo>.jsonl # Per-repo activity cache
└── meta.jsonl                   # Sync state per repo

~/.config/firewatch/             # XDG_CONFIG_HOME/firewatch
└── config.toml                  # User settings

./.firewatch.toml                # Project-local settings (repo root)
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
  file_activity_after?: {
    modified: boolean;
    commits_touching_file: number; // best-effort, file-scoped when file data is available
    latest_commit?: string;
    latest_commit_at?: string;
  };
  file_provenance?: {
    origin_pr: number;
    origin_branch: string;
    origin_commit: string;
    stack_position: number;
  };

  // Plugin data (optional)
  graphite?: {
    stack_id?: string; // Graphite stack identifier
    stack_position?: number; // Position in stack (1 = bottom)
    stack_size?: number; // Total PRs in stack
    parent_pr?: number; // Parent PR in stack
  };
}
```

## Worklist Summary

`fw --summary` aggregates entries into per-PR summaries (WorklistEntry):

- Counts of comments/reviews/commits/CI/events
- Latest activity metadata
- Review state counts
- Graphite metadata (when available)

## Sync Metadata

Tracks incremental sync state per repository:

```jsonl
{"repo":"outfitter-dev/ranger","last_sync":"2026-01-11T10:00:00Z","cursor":"abc123","pr_count":42}
{"repo":"outfitter-dev/blz","last_sync":"2026-01-10T15:30:00Z","cursor":"def456","pr_count":18}
```

## CLI Commands

Binary: `fw` (short for firewatch)

### fw (query)

```bash
fw                       # Actionable items (default)
fw --summary             # Per-PR summary
fw --since 24h           # Recent activity
fw --type review         # Filter by entry type
fw --pr 42,43           # Specific PRs
fw --sync-full           # Full sync before query
```

### fw add

```bash
fw add 42 "LGTM"                           # Comment
fw add 42 --review approve "Looks good"    # Review
fw add 42 --label bug --label urgent       # Labels
```

### fw close

```bash
fw close comment-2001 comment-2002         # Resolve threads
```

### fw edit

```bash
fw edit 42 --title "feat: update auth"     # Update title
fw edit 42 --draft                         # Convert to draft
```

### fw rm

```bash
fw rm 42 --label wip                       # Remove label
fw rm 42 --milestone                       # Clear milestone
```

### fw status / config / doctor / schema

```bash
fw status --short
fw config user.github_username galligan
fw doctor
fw schema entry
```

## Example jq Workflows

```bash
# Approved reviews in last 24 hours
fw --since 24h | jq 'select(.type == "review" and .state == "approved")'

# Comment count by author for PR 42
fw --pr 42 | jq -s 'group_by(.author) | map({author: .[0].author, count: length})'

# All open PRs with changes requested
fw --type review | jq -s '
  group_by(.pr) |
  map(select(any(.state == "changes_requested"))) |
  map(.[0] | {pr, pr_title, repo})
'

# Export to CSV (via jq)
fw | jq -r '[.repo, .pr, .type, .author, .created_at] | @csv'

# Find reviews for PRs in a Graphite stack
fw --type review | jq 'select(.graphite.stack_id == "feat-auth")'
```

## Authentication

Adaptive auth detection (in order):

1. **gh CLI** — If `gh auth status` succeeds, use gh token
2. **Environment variable** — `GITHUB_TOKEN` or `GH_TOKEN`
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

Enriches entries with Graphite stack context when `gt` is available and stacks exist. The plugin adds `graphite` and `file_provenance` metadata during sync, enabling stack-aware sorting and provenance-aware fixes.

## MCP Server

The MCP server exposes a single tool with an action parameter:

```typescript
// MCP tool
{
  name: "firewatch",
  description: "GitHub PR activity (query/add/close/edit/rm/status/config/doctor/schema/help)",
  inputSchema: {
    action: "query | add | close | edit | rm | status | config | doctor | schema | help",
    repo?: "string",
    pr?: "number",
    prs?: "number | number[] | string",
    type?: "comment | review | commit | ci | event",
    author?: "string",
    states?: "string[]",
    label?: "string",
    since?: "string",
    summary?: "boolean",
    summary_short?: "boolean",
    status_short?: "boolean",
    body?: "string",
    reply_to?: "string",
    resolve?: "boolean",
    review?: "approve | request-changes | comment",
    labels?: "string | string[]",
    reviewer?: "string | string[]",
    assignee?: "string | string[]",
    comment_ids?: "string[]",
    schema?: "entry | worklist | config"
  }
}
```

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
