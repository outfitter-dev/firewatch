# Firewatch

Firewatch is a CLI for fetching, caching, and querying GitHub PR activity. It outputs clean JSONL so agents and humans can focus on the actionable parts of review feedback without dragging a full GitHub context window into every step.

## Why Firewatch

PR feedback is scattered across reviews, comments, commits, and CI events. If you want the core signal, you usually end up making a lot of API calls and carrying around a lot of extra context. Firewatch keeps a local, denormalized activity cache so you can query just what you need.

## Quick Start

```bash
# Tight per-PR summary (auto-syncs if no cache yet)
fw --worklist

# Query recent activity
fw query --since 24h

# Filter by type or author
fw query --type review --author galligan

# Stack view (Graphite-aware)
fw --stack

# Worklist (per-PR summary)
fw --worklist

# Schema for query output
fw --schema

# Tight status snapshot
fw status --short
```

Tip: running `fw` in a repo auto-syncs if there's no cache yet, then runs your query. For a fresh session, `fw --worklist` keeps the output minimal.

## Docs

- Workflow guide: `docs/WORKFLOW.md`

## CLI Reference

### sync

Fetch and update PR activity.

```bash
fw sync
fw sync owner/repo
fw sync --since 7d
fw sync --full
fw sync --stack
```

`--stack` is an alias for `--with-graphite` when you want stack metadata during sync.

### check

Refresh staleness hints in the local cache.

```bash
fw check
fw check owner/repo
```

When running inside a repo, Firewatch will use local git history to match commits to comment file paths for more accurate staleness hints.

### query

Filter cached activity and print JSONL to stdout.

```bash
fw query
fw query --repo ranger
fw query --pr 42
fw query --type review
fw query --label bug
fw query --since 24h
fw query --limit 50
fw query --stack
fw query --worklist
```

Most commands emit JSONL by default; `--json` is accepted everywhere as an explicit alias.

### config

Inspect or set configuration.

```bash
fw config show
fw config set repos "org/repo1,org/repo2"
fw config set github-token <token>
fw config set default-stack true
fw config set --local default-stack true
```

### schema

Print JSON schema hints for query outputs.

```bash
fw schema
fw schema entry
fw schema worklist
```

### status

Summarize PR activity.

```bash
fw status
fw status --short
```

### comment

Post a PR comment or reply to a review thread.

```bash
# Top-level PR comment
fw comment 42 "Addressed feedback"

# Reply and resolve
fw comment 42 "Fixed in abc123" --reply-to comment-2001 --resolve
```

### resolve

Resolve review comment threads by comment ID.

```bash
fw resolve comment-2001 comment-2002
```

## Configuration

Firewatch loads configuration in this order (later sources override earlier):

1. User config: `~/.config/firewatch/config.toml`
2. Project config: `.firewatch.toml` (repo root)

Example:

```toml
repos = ["outfitter-dev/firewatch"]
graphite_enabled = true
default_stack = true
default_since = "7d"
default_states = ["open", "draft"]
```

## Graphite Integration

If the repo uses Graphite, Firewatch can enrich entries with stack metadata. Stack output groups entries by stack and annotates each entry with `stack_id`, `stack_position`, and related fields.

- Auto-detected when running inside a Graphite repo.
- Enable by default in config with `graphite_enabled = true`.
- Show grouped output with `--stack` (or `default_stack = true`).
- Review comments can include `file_provenance` to show which PR in a stack last modified a file.

Stack metadata is designed to be compatible with GitHub's stacked PRs as they roll out.

## Cache Layout

XDG-compliant cache and config locations:

```text
~/.cache/firewatch/
├── repos/
│   └── b64~<encoded>.jsonl
└── meta.jsonl

~/.config/firewatch/
└── config.toml

./.firewatch.toml
```

## Schema Quick Reference

The schema is defined in `packages/core/src/schema/entry.ts`. For quick inspection:

```bash
fw query --limit 1 | jq 'keys'
```

For TypeScript usage:

```ts
import type { FirewatchEntry } from "@outfitter/firewatch-core/schema";
```

For the aggregated worklist schema:

```bash
fw schema worklist
```

## Short Status Snapshot

`fw status --short` is a tight, per-PR snapshot:

```bash
fw status --short
```

After running `fw check`, comment entries may include `file_activity_after` staleness hints. When commit file lists are available, the hints are scoped to the comment's file; otherwise they fall back to PR-level activity.

## Write Ops

Firewatch can post replies and resolve review threads so agents can close the loop:

```bash
fw comment 42 "Fixed in abc123" --reply-to comment-2001 --resolve
fw resolve comment-2001 comment-2002
```

## Development

Install dependencies:

```bash
bun install
```

Run the CLI in watch mode:

```bash
bun run --filter @outfitter/firewatch-cli dev
```

Build the CLI binary:

```bash
bun run --filter @outfitter/firewatch-cli build
```

Symlink a dev alias (default `fw-dev`):

```bash
./scripts/symlink-dev.sh
```

Custom alias example:

```bash
./scripts/symlink-dev.sh fw-waymark
```

## MCP Server

Run the MCP server over stdio:

```bash
bun run --filter @outfitter/firewatch-mcp dev
```

The server exposes a single tool, `firewatch`, with an `action` parameter (e.g. `query`, `sync`, `status`, `comment`, `resolve`, `check`).

## License

MIT
