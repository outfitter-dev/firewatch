# Daily Standup Pattern

Morning routine to check what needs attention across all PRs.

## Quick Command

```bash
fw --refresh --summary --open
```

## Full Workflow

### Step 1: Sync Fresh Data

```bash
fw --refresh
```

This fetches the latest activity from GitHub. Graphite metadata is automatically enriched when available.

### Step 2: Get Quick Overview

```bash
fw --summary --open
```

This shows per-PR summaries with:

- Comment and review counts
- Review states (approved, changes requested)
- Latest activity timestamp

For JSON output for further processing:

```bash
fw --summary --open --json
```

### Step 3: Prioritize by Urgency

**Changes requested (address first):**

```bash
fw --summary | jq 'select(.review_states.changes_requested > 0)'
```

**Awaiting your review:**

```bash
fw --reviews --summary
```

**Stale PRs (no activity in 3+ days):**

```bash
fw --summary | jq 'select(
  (.last_activity_at | fromdateiso8601) < (now - 259200)
)'
```

### Step 4: Check Your PRs for Feedback

**Comments on your PRs from others:**

```bash
fw --type comment --mine | jq 'select(.author != .pr_author)'
```

**Review comments needing attention:**

```bash
fw --type comment --mine | jq 'select(
  .subtype == "review_comment" and
  .author != .pr_author and
  (.file_activity_after.modified // false) == false
)'
```

### Step 5: Summarize by PR

Get a concise summary of each PR's status:

```bash
fw status --short
```

Or detailed breakdown:

```bash
fw --summary | jq '{
  pr,
  title: .pr_title,
  state: .pr_state,
  comments: .counts.comments,
  reviews: .counts.reviews,
  approved: .review_states.approved,
  changes_requested: .review_states.changes_requested
}'
```

### Step 6: Plan the Day

Based on the overview:

1. **Urgent:** Address PRs with changes requested
2. **Important:** Respond to review comments
3. **Normal:** Follow up on stale PRs
4. **Low:** Review others' PRs awaiting feedback

## One-Liner Summary

```bash
fw --refresh --summary --open && fw status --short
```

## Agent Workflow

```
1. fw --refresh
2. fw --summary --open --> identify priority items
3. fw status --short --> see all PR states
4. For each priority item:
   - If changes requested --> load implementing-feedback pattern
   - If review needed --> read and respond
   - If stale --> check if blocked or just needs push
5. Update user on findings and recommended actions
```

## Output Interpretation

### Summary Categories

| Category          | Meaning              | Action                       |
| ----------------- | -------------------- | ---------------------------- |
| Changes Requested | Reviewer wants fixes | Address feedback immediately |
| Awaiting Review   | No reviews yet       | Ping reviewers or wait       |
| Stale             | No activity 3+ days  | Follow up or close           |
| Has Comments      | Comments to address  | Implement and resolve        |

### Status Short Format

The `--short` flag shows:

- PR number and title
- Current state (open/draft/merged/closed)
- Last activity timestamp
- Count of unresolved comments

## Tips

- Run this workflow at the start of each coding session
- Set up a shell alias: `alias standup='fw --refresh --summary --open'`
- Use `fw --since 24h` to focus on very recent activity
- Filter to your PRs with `--mine` or to review queue with `--reviews`
