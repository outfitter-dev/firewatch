# Firewatch Workflow

Firewatch is built to help agents and humans stay on top of PR feedback without pulling unnecessary context. The core idea is simple: keep a local JSONL cache of PR activity and query it with small, precise filters.

## Typical Loop

1. Sync activity for a repo.
2. Start with a worklist for a tight per-PR summary.
3. Query a narrow slice of data (by time, author, type, label).
4. Pipe to `jq` for the exact signal you need.
5. Act on the feedback and repeat.

## Sync

```bash
# Auto-detect repo and sync
fw sync

# Explicit repo
fw sync owner/repo

# Only recent activity
fw sync --since 7d

# Full refresh (use occasionally)
fw sync --full
```

When running `fw` inside a repo with no cache yet, it auto-syncs first and then runs your query.

## Query

```bash
# Everything since yesterday
fw query --since 24h

# Reviews from a specific author
fw query --type review --author galligan

# Open or draft PRs with a label match
fw query --label bug --state open,draft

# Stack view (Graphite)
fw query --stack
```

## Worklist

The worklist aggregates entries into a per-PR summary. If Graphite metadata is available, it orders PRs from the bottom of a stack upward.

```bash
# Per-PR summary
fw query --worklist

# Stack-aware worklist (auto when Graphite is present)
fw --worklist
```

If you want a minimal starting point on a fresh repo, this is the default place to begin.

## jq Patterns (Examples)

```bash
# Approved reviews in the last 24 hours
fw query --since 24h | jq 'select(.type == "review" and .state == "approved")'

# PRs with changes requested
fw query --type review | jq 'select(.state == "changes_requested") | {repo, pr, pr_title, author, url}'

# Comment count by author for a specific PR
fw query --pr 42 | jq -s 'group_by(.author) | map({author: .[0].author, count: length})'

# Latest activity per PR
fw query --since 7d | jq -s 'sort_by(.created_at) | group_by(.pr) | map(.[-1]) | .[] | {repo, pr, type, author, created_at}'
```

## Graphite Workflow

Graphite stack metadata is auto-detected when running inside a Graphite-managed repo. Stack output groups entries by stack and annotates them with:

- `graphite.stack_id`
- `graphite.stack_position`
- `graphite.stack_size`
- `graphite.parent_pr`

If you want stack output by default, set:

```bash
fw config set default-stack true
```

Or for a repo-local setting:

```bash
fw config set --local default-stack true
```

Stack metadata is designed to be compatible with GitHub's stacked PRs as they roll out.

## Stack-Aware Provenance (Planned)

For feedback that references a file/line, the goal is to identify which PR in the stack last touched that file. That makes it clear where fixes should land, especially when stacks are deep.

## Configuration

Firewatch loads config in this order (project overrides user):

1. `.firewatch.toml` (repo root)
2. `~/.config/firewatch/config.toml`

Common defaults:

```toml
repos = ["outfitter-dev/firewatch"]
graphite_enabled = true
default_stack = true
default_since = "7d"
default_states = ["open", "draft"]
```

## Schema Discovery

Agents can discover the schema in a few quick ways:

1. Source of truth: `packages/core/src/schema/entry.ts`
2. Inspect a live entry:
   ```bash
   fw query --limit 1 | jq 'keys'
   ```
3. TypeScript usage:
   ```ts
   import type { FirewatchEntry } from "@outfitter/firewatch-core/schema";
   ```
4. CLI schema output:
   ```bash
   fw --schema
   fw schema entry
   fw schema worklist
   ```

The JSONL records are denormalized, so each line includes PR context plus the specific activity.

## Short Status Snapshot

If you want an ultra-tight status view, use:

```bash
fw status --short
```

## Write Ops

Close the loop on feedback in one command:

```bash
fw comment 42 "Fixed in abc123" --reply-to comment-2001 --resolve
```

Resolve review threads directly by comment ID:

```bash
fw resolve comment-2001 comment-2002
```

## Suggested Agent Prompts

- "Show me all PRs with changes requested in the last 48 hours."
- "List open PRs where I commented but no review has been submitted."
- "Group all feedback by author for PR 123."
- "Show stacked PRs with unresolved review comments."
