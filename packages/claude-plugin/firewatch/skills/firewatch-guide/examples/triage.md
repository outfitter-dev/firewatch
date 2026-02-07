# Triage Workflow Examples

Practical examples for triaging PR activity.

## Quick Triage Session

```bash
# Get overview
fw --summary --no-jsonl

# Find urgent items
fw fb  # Unaddressed feedback
```

---

## Finding What Needs Attention

### Changes Requested

```bash
# All PRs with changes requested
fw --summary | jq 'select(.review_states.changes_requested > 0)'

# My PRs with changes requested
fw --mine --summary | jq 'select(.review_states.changes_requested > 0)'
```

### Pending Reviews

```bash
# PRs I need to review
fw --reviews --summary

# Review requests in the last 24h
fw --reviews --since 24h --summary
```

### Unaddressed Feedback

```bash
# All repos
fw fb

# Specific repo
fw fb --repo owner/repo

# Specific PR
fw fb 123
```

### Stale PRs

```bash
# No activity in 3+ days (259200 seconds)
fw --summary | jq 'select(.last_activity_at < (now - 259200 | todate))'

# No activity in 7+ days
fw --summary | jq 'select(.last_activity_at < (now - 604800 | todate))'
```

### Orphaned Comments

```bash
# Unresolved comments on merged/closed PRs
fw --orphaned

# With summary
fw --orphaned --summary
```

---

## Graphite Stack Triage

### Stack Overview

```bash
# All PRs with stack info
fw --summary | jq 'select(.graphite != null)'

# Show stack position
fw --summary | jq 'select(.graphite != null) | {pr, title: .pr_title, stack: .graphite.stack_id, position: .graphite.stack_position}'
```

### Blocked Stacks

```bash
# Lower PR in stack has changes requested
fw --summary | jq 'select(.graphite.stack_position > 1) | select(.review_states.changes_requested > 0)'

# Find the blocking PR
fw --summary | jq 'select(.graphite.stack_position == 1) | select(.review_states.changes_requested > 0)'
```

### Stack-Ordered Review

```bash
# Sort by stack position (review bottom-up)
fw --summary | jq -s 'sort_by(.graphite.stack_position // 999)'
```

---

## CI Status Triage

### Failing CI

```bash
# PRs with CI failures
fw --type ci | jq 'select(.conclusion == "failure")'

# Summary view
fw --summary | jq 'select(.ci_status.failure > 0)'
```

### Pending CI

```bash
# Waiting for CI
fw --summary | jq 'select(.ci_status.pending > 0)'
```

---

## Priority-Based Triage

### P0 - Immediate (now)

```bash
# Changes requested on my PRs
fw --mine --summary | jq 'select(.review_states.changes_requested > 0)'

# Unaddressed feedback
fw fb

# CI failures on my PRs
fw --mine --type ci | jq 'select(.conclusion == "failure")'
```

### P1 - Today

```bash
# Ready to merge (approved, CI passing)
fw --summary | jq 'select(.review_states.approved > 0) | select(.ci_status.failure == 0)'

# Review requests for me
fw --reviews --summary

# Stale blockers
fw --summary | jq 'select(.pr_state == "open") | select(.last_activity_at < (now - 172800 | todate))'
```

### P2 - This Week

```bash
# Draft PRs
fw --draft --summary

# Old unresolved discussions
fw --orphaned --since 7d
```

---

## MCP Equivalents

### CLI to MCP Translation

| CLI             | MCP                  |
| --------------- | -------------------- |
| `fw --summary`  | `{"summary": true}`  |
| `fw --mine`     | `{"mine": true}`     |
| `fw --reviews`  | `{"reviews": true}`  |
| `fw fb`         | `{}` (to fw_fb)      |
| `fw fb 123`     | `{"pr": 123}`        |
| `fw --orphaned` | `{"orphaned": true}` |

### MCP Examples

```json
// Quick triage
{"summary": true}

// My PRs needing attention
{"mine": true, "summary": true}

// Review requests
{"reviews": true, "summary": true}

// Unaddressed feedback
// (call fw_fb with no params)
{}
```

---

## Triage Output Template

Present triage findings in this format:

```markdown
## Needs Immediate Attention (P0)

- PR #123: Changes requested by @reviewer (2h ago)
  - 3 unaddressed comments
- PR #456: CI failing - `test:unit` job

## Ready to Merge (P1)

- PR #789: Approved by @alice, all checks passing
- PR #101: Approved, waiting for CI

## Review Requests (P1)

- PR #202: @bob requested your review (6h ago)

## Stale (3+ days)

- PR #303: Last activity 5 days ago
  - Awaiting response from @charlie

## Stack Issues

- Stack `feature/auth`:
  - PR #401 (position 1): Changes requested - blocking stack
  - PR #402 (position 2): Approved but blocked by #401
```

---

## Automation Ideas

### Daily Triage Script

```bash
#!/bin/bash
echo "=== Daily Triage ==="
echo ""
echo "## Unaddressed Feedback"
fw fb --no-jsonl
echo ""
echo "## Review Requests"
fw --reviews --summary --no-jsonl
echo ""
echo "## Stale PRs (3+ days)"
fw --summary | jq -r 'select(.last_activity_at < (now - 259200 | todate)) | "PR #\(.pr): \(.pr_title) - \(.last_activity_at)"'
```

### Slack/Discord Notification

```bash
# Generate JSON for webhook
fw --summary | jq -s '{
  text: "PR Status",
  attachments: [.[] | {
    title: "PR #\(.pr): \(.pr_title)",
    fields: [
      {title: "State", value: .pr_state, short: true},
      {title: "Reviews", value: (.review_states | to_entries | map("\(.key): \(.value)") | join(", ")), short: true}
    ]
  }]
}'
```
