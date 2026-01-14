---
name: firewatch-cli
description: Queries GitHub PR activity using the firewatch CLI (fw). Fetches, caches, and filters PR comments, reviews, commits, and CI status as JSONL for jq composition. Supports Graphite stacked PRs. Use when checking PR status, finding review comments, querying activity, resolving feedback, or working with GitHub pull requests.
user-invocable: true
metadata:
  author: outfitter-dev
  version: "2.0"
---

# Firewatch CLI

This guide teaches you to use Firewatch (`fw`) for querying GitHub PR activity. By the end, you'll understand how to fetch data, filter it, compose queries with jq, and take action on feedback.

## Contents

- [Overview](#overview)
- [Getting Started](#getting-started)
- [Understanding Entries](#understanding-entries)
- [Querying Activity](#querying-activity)
- [Composing with jq](#composing-with-jq)
- [Taking Action](#taking-action)
- [Staying Current](#staying-current)
- [Graphite Stacks](#graphite-stacks)
- [Command Reference](#command-reference)
- [Schema Reference](#schema-reference)

## Overview

Firewatch fetches PR activity from GitHub and caches it locally as JSONL. Each line is a self-contained JSON object — a comment, review, commit, or CI status. This design makes the output directly pipeable to `jq` without joins or lookups.

**Core workflow:**
```bash
fw sync                    # Fetch from GitHub → local cache
fw query --since 24h       # Filter cache → JSONL to stdout
fw query | jq 'select(...)'  # Compose with jq
```

**Why JSONL?** Each entry contains everything you need: the comment body, the PR it belongs to, the author, timestamps, and even Graphite stack position. No need to fetch the PR separately or join tables.

## Getting Started

### First Sync

Inside a git repo with a GitHub remote, run:

```bash
fw sync
```

Firewatch auto-detects the repo from your git remote. It fetches open PRs and their activity, storing everything in `~/.cache/firewatch/`.

For a specific repo:
```bash
fw sync owner/repo
```

### First Query

See what's in the cache:

```bash
fw query --limit 5
```

Each line is a JSON object. You'll see entries like comments, reviews, and commits — each with full PR context embedded.

### Quick Status

For a human-readable summary:

```bash
fw status --short
```

Or to see what needs attention since your last check:

```bash
fw lookout
```

## Understanding Entries

Every entry has the same structure, regardless of type. This is the key insight: **entries are denormalized**.

### Entry Types

| Type | What it represents |
|------|-------------------|
| `comment` | PR comments (issue comments and review comments) |
| `review` | Review submissions (approve, request changes, comment) |
| `commit` | Commits pushed to the PR branch |
| `ci` | CI/CD status checks |
| `event` | Lifecycle events (opened, closed, merged) |

### Denormalization

Each entry includes full PR context:

```json
{
  "id": "IC_kwDOK...",
  "type": "comment",
  "author": "alice",
  "body": "LGTM!",
  "pr": 42,
  "pr_title": "Add user authentication",
  "pr_state": "open",
  "pr_author": "bob",
  "pr_branch": "feature/auth",
  "created_at": "2025-01-14T10:00:00Z"
}
```

This means you can filter, group, or aggregate without fetching additional data. The PR title, state, and author are right there.

### Why This Matters

With normalized data, finding "all comments on open PRs by alice" requires joining comments → PRs → filtering. With denormalized entries:

```bash
fw query --type comment --author alice --open
```

One command. No joins.

## Querying Activity

The `fw query` command filters cached entries. Combine flags to narrow results.

### Filter by Type

```bash
fw query --type review           # Only reviews
fw query --type comment          # Only comments
fw query --type commit           # Only commits
```

### Filter by Time

```bash
fw query --since 24h             # Last 24 hours
fw query --since 7d              # Last week
fw query --since "2025-01-01"    # Since a specific date
```

Duration formats: `30s`, `5m`, `24h`, `7d`, `2w`, `1mo`, `1y`

### Filter by PR State

```bash
fw query --open                  # Open PRs only
fw query --active                # Open or draft PRs
fw query --state merged          # Merged PRs
fw query --state open,draft      # Multiple states
```

### Filter by Author or PR

```bash
fw query --author alice          # Activity by alice
fw query --pr 42                 # Activity on PR #42
fw query --label bug             # PRs with "bug" label
```

### Combine Filters

Filters are additive (AND logic):

```bash
fw query --type review --author alice --since 7d --open
```

This returns: reviews by alice, in the last 7 days, on open PRs.

### Aggregate to Worklist

For a per-PR summary instead of individual entries:

```bash
fw query --worklist
```

Or use the dedicated command:

```bash
fw status
```

## Composing with jq

Firewatch outputs JSONL specifically for jq composition. The CLI filters handle common cases; jq handles everything else.

### Basic Selection

```bash
# Only approved reviews
fw query --type review | jq 'select(.state == "approved")'

# Comments mentioning "TODO"
fw query --type comment | jq 'select(.body | test("TODO"; "i"))'
```

### External Feedback Only

Filter out self-comments (author commenting on their own PR):

```bash
fw query --type comment | jq 'select(.author != .pr_author)'
```

### Aggregation

Use `-s` (slurp) to load all entries into an array:

```bash
# Count by type
fw query | jq -s 'group_by(.type) | map({type: .[0].type, count: length})'

# PRs with most activity
fw query | jq -s 'group_by(.pr) | map({pr: .[0].pr, count: length}) | sort_by(-.count) | .[0:5]'
```

### Handle Optional Fields

Some fields are optional. Use the `//` operator for defaults:

```bash
# Stack position, defaulting to 0
fw query | jq '.graphite.stack_position // 0'

# Only entries with Graphite metadata
fw query | jq 'select(.graphite != null)'
```

### Efficient Filtering

**Tip:** Use CLI filters first, then jq. The CLI filters are faster because they skip JSON parsing for non-matching entries.

```bash
# Good: CLI narrows first
fw query --type review --since 24h | jq 'select(.state == "approved")'

# Less efficient: jq does all the work
fw query | jq 'select(.type == "review" and .state == "approved")'
```

See [references/jq-cookbook.md](references/jq-cookbook.md) for more patterns.

## Taking Action

Firewatch isn't just for reading — you can respond to feedback directly.

### Post a Comment

```bash
fw comment 42 "LGTM, merging!"
```

### Reply to a Review Comment

Every comment entry has an `id` field. Use it to reply:

```bash
fw comment 42 "Fixed in latest commit" --reply-to IC_kwDOK...
```

### Reply and Resolve

Address feedback and resolve the thread in one command:

```bash
fw comment 42 "Done" --reply-to IC_kwDOK... --resolve
```

### Resolve Without Replying

If the feedback is already addressed:

```bash
fw resolve IC_kwDOK...
```

Resolve multiple threads:

```bash
fw resolve IC_abc IC_def IC_ghi
```

## Staying Current

### The Lookout Command

`fw lookout` tracks when you last checked each repo. On subsequent runs, it shows only new activity:

```bash
fw lookout                  # What's new since last check?
```

First run shows the last 7 days. After that, it remembers your last lookout timestamp.

**What lookout surfaces:**
- PRs with changes requested
- PRs waiting for review
- Stale PRs (no activity for 3+ days)
- Unaddressed feedback (including bot comments)

### Override or Reset

```bash
fw lookout --since 24h      # Ignore tracking, show last 24h
fw lookout --reset          # Clear tracking, start fresh
```

### Auto-Sync

Lookout auto-syncs if the cache is stale (default: 1 hour). Configure in `.firewatch.toml`:

```toml
lookout_stale_after = "30m"
```

### Staleness Hints

Review comments can become stale when the file is modified. Run `fw check` to populate staleness data:

```bash
fw check
```

Then query for unaddressed comments:

```bash
fw query --type comment | jq 'select(.file_activity_after.modified == false)'
```

## Graphite Stacks

If you use Graphite for stacked PRs, Firewatch tracks stack metadata.

### Sync with Stack Data

```bash
fw sync --with-graphite
```

This adds `graphite` fields to entries: stack ID, position, size, and parent PR.

### Query Stack PRs

```bash
# All entries with stack metadata
fw query | jq 'select(.graphite != null)'

# Base PRs only (bottom of stack)
fw status | jq 'select(.graphite.stack_position == 1)'

# PRs in a specific stack
fw query | jq 'select(.graphite.stack_id == "stack_abc")'
```

### File Provenance

For review comments on files that originated in a different PR in the stack:

```bash
fw query --type comment | jq 'select(.file_provenance != null)'
```

The `file_provenance` field tells you which PR in the stack introduced the file.

See [patterns/graphite-stacked-prs.md](patterns/graphite-stacked-prs.md) for stack workflows.

## Command Reference

| Command | Purpose |
|---------|---------|
| `fw sync [repo]` | Fetch PR activity from GitHub |
| `fw query [options]` | Filter and output cached entries |
| `fw status` | Per-PR summary (worklist) |
| `fw lookout` | What needs attention since last check |
| `fw recap` | Human-readable activity digest |
| `fw check` | Refresh staleness hints |
| `fw comment <pr> <body>` | Post a PR comment |
| `fw resolve <id>...` | Resolve review threads |
| `fw config` | View/edit configuration |
| `fw schema <type>` | Print JSON schema |

### Common Options

| Option | Commands | Description |
|--------|----------|-------------|
| `--since <duration>` | query, sync, lookout, recap | Time filter |
| `--type <type>` | query | Entry type filter |
| `--author <name>` | query | Author filter |
| `--pr <number>` | query | PR number filter |
| `--open` | query, status | Open PRs only |
| `--active` | query, status | Open or draft PRs |
| `--worklist` | query | Aggregate to per-PR summary |
| `--json` | lookout, recap | Output as JSONL |
| `--with-graphite` | sync | Include stack metadata |

## Schema Reference

### FirewatchEntry

```typescript
interface FirewatchEntry {
  id: string                    // Unique identifier
  repo: string                  // "owner/repo"
  pr: number
  pr_title: string
  pr_state: "open" | "closed" | "merged" | "draft"
  pr_author: string
  pr_branch: string
  pr_labels?: string[]

  type: "comment" | "review" | "commit" | "ci" | "event"
  subtype?: string              // "review_comment", "issue_comment", etc.
  author: string
  body?: string
  state?: string                // Review state: "approved", "changes_requested"

  created_at: string            // ISO 8601
  updated_at?: string
  captured_at: string

  file?: string                 // For review comments
  line?: number
  url?: string

  file_activity_after?: {       // Populated by fw check
    modified: boolean
    commits_touching_file: number
    latest_commit: string
    latest_commit_at: string
  }

  graphite?: {                  // If synced with --with-graphite
    stack_id: string
    stack_position: number      // 1 = bottom of stack
    stack_size: number
    parent_pr?: number
  }
}
```

### WorklistEntry

```typescript
interface WorklistEntry {
  repo: string
  pr: number
  pr_title: string
  pr_state: string
  pr_author: string
  pr_branch: string
  pr_labels?: string[]

  last_activity_at: string
  latest_activity_type: string
  latest_activity_author: string

  counts: {
    comments: number
    reviews: number
    commits: number
    ci: number
    events: number
  }

  review_states?: {
    approved: number
    changes_requested: number
    commented: number
    dismissed: number
  }

  graphite?: { /* same as entry */ }
}
```

## Agent Tips

1. **CLI filters first, then jq** — More efficient than jq-only filtering
2. **Use `-s` for aggregation** — Slurp loads all entries into an array
3. **Check optional fields** — Use `// default` pattern for missing fields
4. **Denormalized = no joins** — Each entry has full PR context
5. **Entry IDs for actions** — Use `id` field with `fw comment --reply-to` and `fw resolve`
6. **Graphite is optional** — Check `.graphite != null` before using stack fields
7. **Run `fw check` for staleness** — Populates `file_activity_after` field
