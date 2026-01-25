---
name: firewatch-guide
description: >-
  Guides GitHub PR activity workflows using the Firewatch CLI (fw) and MCP server.
  Use when triaging PRs, responding to review feedback, querying PR activity,
  or when the user mentions firewatch, PR reviews, PR comments, or review threads.
user-invocable: true
allowed-tools: Read, Bash(fw *), Bash(gh *), Bash(gt *), Bash(git *), Edit, Write
---

# Firewatch Guide

Query GitHub PR activity and manage review feedback using the Firewatch CLI (`fw`) or MCP tools.

## Quick Start

```bash
# Check setup
fw doctor

# View status (auth, cache, repo)
fw status --short

# Get per-PR summary
fw --summary

# See unaddressed feedback
fw fb
```

## Core Concepts

**Short IDs**: Firewatch generates human-friendly short IDs (e.g., `@a7f3c`) for comments. Use these instead of long GitHub IDs.

**JSONL Output**: Default output is newline-delimited JSON. Pipe to `jq` for filtering. Use `--no-jsonl` for human-readable format.

**Auto-sync**: Cache refreshes automatically if stale. Use `--no-sync` to skip or `--refresh` to force.

---

## Triage Workflow

Systematic review to identify what needs attention.

### 1. Get Overview

```bash
# Per-PR summary with activity counts
fw --summary

# Compact summary
fw --summary --no-jsonl
```

### 2. Identify Priorities

**P0 - Immediate:**

```bash
# Changes requested on your PRs
fw --mine --type review | jq 'select(.body | contains("changes"))'

# Unaddressed feedback on your PRs
fw fb --repo owner/repo
```

**P1 - Today:**

```bash
# Approved PRs ready to merge
fw --summary | jq 'select(.review_states.approved > 0)'

# PRs needing your review
fw --reviews --summary
```

**P2 - This Week:**

```bash
# Stale PRs (no activity in 3+ days)
fw --summary | jq 'select(.last_activity_at < (now - 259200 | todate))'

# Orphaned comments (unresolved on merged PRs)
fw --orphaned
```

### 3. Graphite Stack Awareness

```bash
# PRs with stack metadata
fw --summary | jq 'select(.graphite != null)'

# Blocked stacks (lower PR has issues)
fw --summary | jq 'select(.graphite.stack_position > 1) | select(.review_states.changes_requested > 0)'
```

Address stack issues **bottom-up** to avoid merge conflicts.

### 4. Present Findings

Format triage output for the user:

```
## Needs Immediate Attention
- PR #123: Changes requested by @reviewer (2h ago)
- PR #456: CI failing

## Ready to Merge
- PR #789: Approved, all checks passing

## Review Requests
- PR #101: @author requested your review (1d ago)
```

---

## Response Workflow

Systematic approach to addressing PR feedback.

### 1. List Feedback

```bash
# All unaddressed feedback (repo-wide)
fw fb

# Feedback for specific PR
fw fb 123

# All comments including resolved
fw fb 123 --all
```

### 2. View Comment Details

```bash
# View by short ID
fw fb @a7f3c
```

### 3. Address and Reply

**After fixing code:**

```bash
# Reply to comment
fw fb @a7f3c "Fixed in latest commit"

# Reply and resolve thread
fw fb @a7f3c "Done" --resolve
```

**For clarification only:**

```bash
# Just reply
fw fb @a7f3c "Good question! I chose X because..."
```

**Acknowledge without action:**

```bash
# Add thumbs-up reaction + local ack
fw fb @a7f3c --ack

# Bulk ack all feedback on a PR
fw fb 123 --ack
```

### 4. Resolve Without Reply

```bash
# Resolve thread directly
fw fb @a7f3c --resolve
```

### 5. Commit and Push

**With Graphite:**

```bash
gt modify -m "Address review feedback"
gt submit --stack
```

**Standard git:**

```bash
git add -A && git commit -m "Address review feedback" && git push
```

---

## Comment Categories

| Type | Action |
|------|--------|
| Bug/logic error | Fix code, reply explaining fix |
| Style/preference | Apply if reasonable, or discuss tradeoffs |
| Question | Reply with explanation (no code change) |
| Nitpick | Fix quickly or ack for future |

### Response Templates

**Code Fixed:**
> Fixed in [commit]. [Brief explanation].

**Clarification:**
> Good question! [Explanation]. I chose this because [reasoning].

**Acknowledged:**
> Good point, I'll address this in a follow-up PR.

**Disagreement:**
> I considered that, but [reasoning]. Happy to discuss further.

---

## CLI Quick Reference

| Command | Purpose |
|---------|---------|
| `fw` | Query activity (auto-syncs if stale) |
| `fw --summary` | Per-PR aggregation |
| `fw fb` | List/view/reply/resolve feedback |
| `fw fb 123` | Feedback for PR #123 |
| `fw fb @id "text"` | Reply to comment |
| `fw fb @id --resolve` | Resolve thread |
| `fw pr edit 123 --title "..."` | Edit PR fields |
| `fw status` | Auth/cache/repo info |
| `fw doctor` | Diagnose issues |
| `fw schema entry` | Output format schema |

See [references/cli.md](references/cli.md) for complete command documentation.

---

## MCP Tools Quick Reference

| Tool | Purpose |
|------|---------|
| `fw_query` | Query cached activity |
| `fw_fb` | Feedback operations |
| `fw_pr` | PR mutations (edit/rm/review) |
| `fw_status` | Status info |
| `fw_doctor` | Diagnostics |
| `fw_help` | Usage docs |

See [references/mcp.md](references/mcp.md) for complete tool documentation.

---

## Common Filters

```bash
# By time
fw --since 24h
fw --since 7d

# By type
fw --type review
fw --type comment

# By PR state
fw --open           # Open PRs only
fw --draft          # Drafts only
fw --active         # Open + draft
fw --closed         # Merged + closed

# By ownership
fw --mine           # My PRs
fw --reviews        # PRs I need to review

# Exclude bots
fw --no-bots
```

---

## Checklist

Before marking review complete:

- [ ] All comments addressed or responded to
- [ ] Code changes committed and pushed
- [ ] Threads resolved where appropriate
- [ ] CI passing on latest commit

---

## Further Reading

- [references/cli.md](references/cli.md) - Complete CLI reference
- [references/mcp.md](references/mcp.md) - MCP tool reference
- [references/troubleshooting.md](references/troubleshooting.md) - Setup and troubleshooting
- [examples/triage.md](examples/triage.md) - Triage workflow examples
- [examples/respond.md](examples/respond.md) - Response workflow examples
- [examples/jq-patterns.md](examples/jq-patterns.md) - Common jq queries
