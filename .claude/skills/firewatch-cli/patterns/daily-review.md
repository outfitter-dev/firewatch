# Daily Review Workflow

A structured approach to reviewing PR activity at the start of each work session.

## Quick Status Check

Get an immediate overview:

```bash
fw status --short --active
```

For more detail:

```bash
fw recap --since 24h
```

## Morning Triage

### 1. Sync Fresh Data

```bash
fw sync
```

Or for all tracked repos:

```bash
fw sync --all
```

### 2. Check What Needs Attention

**PRs with changes requested:**
```bash
fw status | jq 'select(.review_states.changes_requested > 0) | {pr, pr_title, changes: .review_states.changes_requested}'
```

**PRs awaiting review (no reviews yet):**
```bash
fw status --active | jq 'select(.counts.reviews == 0) | {pr, pr_title, pr_author}'
```

**Recent comments to address:**
```bash
fw query --type comment --since 24h | jq 'select(.author != .pr_author) | {pr, author, file, body: .body[0:80]}'
```

### 3. Activity Summary

```bash
fw query --since 24h | jq -s '{
  total: length,
  prs: ([.[].pr] | unique | length),
  reviews: ([.[] | select(.type == "review")] | length),
  comments: ([.[] | select(.type == "comment")] | length),
  commits: ([.[] | select(.type == "commit")] | length)
}'
```

## Review Inbox

### Incoming Reviews on Your PRs

```bash
fw query --author YOUR_USERNAME --type review --since 24h | jq '{
  pr,
  reviewer: .author,
  state,
  created_at
}'
```

### Comments Waiting for Response

```bash
fw query --type comment --since 48h | jq 'select(
  .subtype == "review_comment" and
  .author != .pr_author and
  (.file_activity_after.modified // false) == false
) | {pr, file, line, author, body: .body[0:60]}'
```

### PRs You Should Review

```bash
# Active PRs by others with no reviews
fw status --active | jq 'select(
  .pr_author != "YOUR_USERNAME" and
  .counts.reviews == 0
) | {pr, pr_title, pr_author, last_activity_at}'
```

## End of Day Check

### Unfinished Business

```bash
fw status | jq 'select(
  .pr_author == "YOUR_USERNAME" and
  .pr_state == "open" and
  (.review_states.changes_requested // 0) > 0
) | {pr, pr_title, changes_needed: .review_states.changes_requested}'
```

### Today's Activity

```bash
fw query --since 12h | jq -s 'group_by(.pr) | map({
  pr: .[0].pr,
  pr_title: .[0].pr_title,
  activity: length
}) | sort_by(-.activity)'
```

## Automation Snippets

### Shell Alias

```bash
# Add to .bashrc/.zshrc
alias fwd='fw sync && fw recap --since 24h'
alias fws='fw status --short --active'
```

### GitHub + Firewatch

```bash
# Open first PR needing attention
PR=$(fw status | jq -r 'select(.review_states.changes_requested > 0) | .pr' | head -1)
[ -n "$PR" ] && gh pr view "$PR" --web
```

## Tips

- Sync at start of session to get latest data
- Focus on `changes_requested` first — these block merges
- Use `--since 24h` for daily, `--since 7d` for weekly reviews
- Combine with `fw check` to see which comments have been addressed
