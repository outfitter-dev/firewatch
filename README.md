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
```

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

## Configuration

Firewatch loads configuration in this order (project overrides user):

1. Project config: `.firewatch.toml` (repo root)
2. User config: `~/.config/firewatch/config.toml`

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

Stack metadata is designed to be compatible with GitHub's stacked PRs as they roll out.

## Cache Layout

XDG-compliant cache and config locations:

```
~/.cache/firewatch/
├── repos/
│   └── owner--repo.jsonl
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

Firewatch doesn't ship a `status` command yet, but the worklist makes it easy to keep output tight:

```bash
fw query --worklist | jq '{repo, pr, pr_title, pr_state, changes_requested: .review_states.changes_requested, comments: .counts.comments}'
```

The plan is to add `fw status --short` as a thin wrapper over this view.

## Planned Write Ops

To close the loop on feedback, the plan is to add write commands:

```bash
# Post a comment and resolve in one step
fw comment 42 "Fixed in abc123" --reply-to comment-2001 --resolve
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

## License

MIT
