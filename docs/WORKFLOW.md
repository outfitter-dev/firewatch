# Firewatch Workflow

Firewatch helps agents and humans stay on top of PR feedback without pulling unnecessary context. The core idea is simple: keep a local JSONL cache of PR activity and query it with small, precise filters.

## Typical Loop

1. Run `fw` (auto-syncs if cache is stale).
2. Start with `fw --summary` for a tight per-PR overview.
3. Narrow results by time, author, type, label, or state.
4. Pipe to `jq` for exact signals.
5. Act on feedback with `fw add`, `fw close`, `fw edit`, or `fw rm`.

## Querying Activity

```bash
# Everything since yesterday
fw --since 24h

# Reviews from a specific author
fw --type review --author galligan

# Open or draft PRs with a label match
fw --label bug --state open,draft
```

## Summary View

The summary aggregates entries into a per-PR rollup (stack-aware when Graphite metadata is available).

```bash
# Per-PR summary
fw --summary

# Summary for my PRs
fw --mine --summary
```

## jq Patterns (Examples)

```bash
# Approved reviews in the last 24 hours
fw --since 24h | jq 'select(.type == "review" and .state == "approved")'

# PRs with changes requested
fw --type review | jq 'select(.state == "changes_requested") | {repo, pr, pr_title, author, url}'

# Comment count by author for a specific PR
fw --prs 42 | jq -s 'group_by(.author) | map({author: .[0].author, count: length})'

# Latest activity per PR
fw --since 7d | jq -s 'sort_by(.created_at) | group_by(.pr) | map(.[-1]) | .[] | {repo, pr, type, author, created_at}'
```

## Auto-Sync Controls

```bash
# Use cached data only
fw --offline

# Force refresh before query
fw --refresh

# Full refresh (ignore cursor)
fw --refresh full
```

## Graphite Workflow

Graphite stack metadata is auto-detected when running inside a Graphite-managed repo. Entries and summaries include:

- `graphite.stack_id`
- `graphite.stack_position`
- `graphite.stack_size`
- `graphite.parent_pr`

No flags or config required.

## Schema Discovery

1. Source of truth: `packages/core/src/schema/entry.ts`
2. Inspect a live entry:
   ```bash
   fw --limit 1 | jq 'keys'
   ```
3. TypeScript usage:
   ```ts
   import type { FirewatchEntry } from "@outfitter/firewatch-core/schema";
   ```
4. CLI schema output:
   ```bash
   fw schema
   fw schema entry
   fw schema worklist
   fw schema config
   ```

## Status Snapshot

```bash
fw status --short
```

## Write Ops

```bash
# Reply and resolve
fw add 42 --reply comment-2001 "Fixed in abc123" --resolve

# Resolve multiple threads
fw close comment-2001 comment-2002

# Add labels
fw add 42 --label bug --label priority-high

# Remove a label
fw rm 42 --label wip
```

## Suggested Agent Prompts

- "Show me all PRs with changes requested in the last 48 hours."
- "List open PRs where I commented but no review has been submitted."
- "Group all feedback by author for PR 123."
- "Show stacked PRs with unresolved review comments."
