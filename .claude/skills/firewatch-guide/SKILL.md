---
name: firewatch-guide
description: Fetches and analyzes PR feedback using Firewatch CLI. Syncs activity, identifies actionable comments, and guides resolution workflow. Use when checking for PR feedback, reviewing comments, addressing review requests, running daily standups, implementing review feedback, or working through Graphite stack feedback.
user-invocable: true
metadata:
  author: outfitter-dev
  version: "1.2"
---

# Firewatch Guide

Fetch, analyze, and act on PR review feedback using the Firewatch CLI (`fw`).

## Quick Start

```bash
# Sync activity and see what needs attention
fw --refresh --summary --open
```

For a specific PR:
```bash
fw --type comment --prs 42 --open
```

## Core Workflow

### 1. Sync Activity

The main `fw` command auto-syncs by default. For force refresh:

```bash
fw --refresh
```

Graphite metadata is automatically enriched when you're in a repo with Graphite stacks -- no flag needed.

### 2. Check What Needs Attention

**Quick overview (per-PR summary):**
```bash
fw --summary --open
```

This shows per-PR summaries with:
- Comment/review counts
- Review states (approved, changes requested)
- Latest activity info

**All recent comments on open PRs:**
```bash
fw --type comment --open --since 7d
```

**Review comments specifically (inline code feedback):**
```bash
fw --type comment --open | jq 'select(.subtype == "review_comment")'
```

**External feedback only (not self-comments):**
```bash
fw --type comment | jq 'select(.author != .pr_author)'
```

### 3. Understand the Feedback

For each comment, extract actionable details:

```bash
fw --type comment --prs PR_NUMBER | jq '{
  id,
  file,
  line,
  author,
  body,
  pr,
  pr_title
}'
```

Key fields:
- `id` -- Use with `--reply` or `fw close`
- `file` + `line` -- Where to make the fix
- `body` -- The actual feedback
- `graphite.stack_position` -- Where in stack (1 = base)
- `file_provenance.origin_pr` -- Which PR introduced the file

### 4. Address and Resolve

After making code changes:

```bash
# Reply acknowledging the fix and resolve the thread
fw add PR_NUMBER "Fixed" --reply COMMENT_ID --resolve
```

Or resolve without reply:
```bash
fw close COMMENT_ID
```

Bulk resolve multiple threads:
```bash
fw close IC_abc IC_def IC_ghi
```

## Scenarios

### Morning Check (Daily Standup)

```bash
fw --refresh --summary --open
```

See [patterns/daily-standup.md](patterns/daily-standup.md) for the full workflow.

### Comprehensive Stack Review

When addressing feedback across a Graphite stack:

1. Refresh with `fw --refresh`
2. Get all stack PRs with `gt state`
3. Query comments across the stack
4. Address bottom-up (base PR first)
5. Check file provenance for cross-PR fixes

See [patterns/stack-review.md](patterns/stack-review.md) for detailed steps.

### Implementing Review Feedback

For each comment:
1. Read the feedback
2. Navigate to file:line
3. Make the fix
4. Commit with `gt modify`
5. Reply and resolve

See [patterns/implementing-feedback.md](patterns/implementing-feedback.md) for the systematic workflow.

### Resolving Comment Threads

After addressing feedback:
1. Reply to acknowledge the fix
2. Resolve the thread
3. Verify with `fw --refresh`

See [patterns/resolving-threads.md](patterns/resolving-threads.md) for patterns.

### Cross-PR Fixes in Stacks

When a comment appears on PR N but the file originated in PR M:

```bash
fw --type comment | jq 'select(.file_provenance.origin_pr != .pr)'
```

Fix in the origin PR, then restack to propagate.

See [patterns/cross-pr-fixes.md](patterns/cross-pr-fixes.md) for the workflow.

## Entry Types

| Type | Subtype | Meaning |
|------|---------|---------|
| `comment` | `review_comment` | Inline code comment (actionable) |
| `comment` | `issue_comment` | General PR comment |
| `review` | -- | Review submission (approve/request changes) |
| `commit` | -- | Commit pushed to PR branch |
| `ci` | -- | CI/CD status check |
| `event` | -- | Lifecycle event (opened, closed, merged) |

## Command Reference

| Command | Purpose |
|---------|---------|
| `fw [options]` | Query cached entries (auto-syncs if stale) |
| `fw --refresh` | Force sync before query |
| `fw --summary` | Aggregate into per-PR summaries |
| `fw add <pr> [body]` | Post a PR comment or add metadata |
| `fw close <id>...` | Resolve review threads |
| `fw status` | Firewatch state info |
| `fw doctor` | Diagnose auth/cache/repo issues |

### Query Options

| Option | Description |
|--------|-------------|
| `--type <type>` | Filter by entry type |
| `--since <duration>` | Time filter (24h, 7d, etc.) |
| `--prs <numbers>` | Filter by PR number(s) |
| `--author <name>` | Filter by author |
| `--open` | Open PRs only |
| `--active` | Open or draft PRs |
| `--mine` | Items on PRs assigned to me |
| `--reviews` | PRs I need to review |

### Add Options

| Option | Description |
|--------|-------------|
| `--reply <id>` | Reply to a specific comment |
| `--resolve` | Resolve the thread after posting |
| `--review <type>` | Add review (approve, request-changes, comment) |
| `--label <name>` | Add label (repeatable) |

## References

- [references/query-patterns.md](references/query-patterns.md) -- Common jq filters and query combinations
- [references/entry-schema.md](references/entry-schema.md) -- FirewatchEntry field reference
- [references/troubleshooting.md](references/troubleshooting.md) -- Common issues and fixes

## Agent Checklist

When checking PR feedback:

1. [ ] Refresh with `fw --refresh`
2. [ ] Run `fw --summary --open` for quick overview
3. [ ] Query for unaddressed comments
4. [ ] Group by file or PR for efficient fixes
5. [ ] Check `file_provenance` for stack fixes
6. [ ] Make code changes
7. [ ] Commit with `gt modify` (for Graphite stacks)
8. [ ] Reply and resolve comments
9. [ ] Re-sync with `fw --refresh` to verify resolution

When implementing feedback:

1. [ ] Read the comment body fully
2. [ ] Navigate to file:line
3. [ ] Understand surrounding context
4. [ ] Determine if code change needed or just explanation
5. [ ] Check file_provenance for cross-PR fixes
6. [ ] Implement the fix
7. [ ] Commit changes
8. [ ] Reply with brief description
9. [ ] Resolve the thread
10. [ ] Verify with `fw --refresh`
