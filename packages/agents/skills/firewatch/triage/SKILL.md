---
name: firewatch-triage
description: Triages PR activity to identify what needs attention. Use when reviewing PR status, prioritizing work, checking for stale reviews, or when the user asks about PR health, what needs review, or what's blocking progress.
allowed-tools: Read, Bash(fw *), Bash(gh *), Bash(gt *)
---

# PR Triage Skill

Systematic review of PR activity to identify priorities and blockers.

## Triage Flow

```
1. Refresh data if needed
2. Get summary overview
3. Identify priorities by category
4. Recommend actions
```

## Quick Triage

```bash
# Refresh and get overview
fw --refresh --summary

# Find PRs needing review response
fw --type review --since 24h | jq 'select(.state == "changes_requested")'

# Find stale PRs (no activity in 3+ days)
fw --summary | jq 'select(.last_activity_at < (now - 259200 | todate))'
```

## Priority Categories

### P0 - Immediate
- Changes requested on your PRs
- Review threads awaiting your response
- CI failures on open PRs

### P1 - Today
- Approved PRs ready to merge
- Review requests assigned to you
- Stale PRs blocking others

### P2 - This Week
- Draft PRs needing polish
- Old review comments to address
- PRs with unresolved discussions

## Triage Output Format

Present findings as:

```
## Needs Immediate Attention
- PR #123: Changes requested by @reviewer (2h ago)
- PR #456: CI failing - test suite

## Ready to Merge
- PR #789: Approved, all checks passing

## Review Requests
- PR #101: @author requested your review (1d ago)

## Stale (3+ days)
- PR #202: Last activity 5 days ago
```

## Integration with Graphite

If using Graphite stacks:

```bash
# Show stack-aware summary
fw --summary | jq 'select(.graphite != null)'

# Find blocked stacks (lower PR has issues)
fw --summary | jq 'select(.graphite.stack_position > 1 and .review_states.changes_requested > 0)'
```

Recommend addressing stack issues bottom-up.
