# Querying Graphite Stacks with Firewatch

How to query PR activity in Graphite stacks.

## Stack Metadata

When syncing in a repo with Graphite stacks, entries include stack metadata automatically:

```bash
fw --refresh
```

### Stack Fields

Each entry gains a `graphite` object:

```json
{
  "graphite": {
    "stack_id": "abc123",
    "stack_position": 2,
    "stack_size": 4,
    "parent_pr": 101
  }
}
```

| Field            | Meaning                                       |
| ---------------- | --------------------------------------------- |
| `stack_id`       | Unique identifier for the stack               |
| `stack_position` | Position in stack (1 = base, closest to main) |
| `stack_size`     | Total PRs in the stack                        |
| `parent_pr`      | PR number of the parent (downstack)           |

### File Provenance

Review comments on files also include provenance:

```json
{
  "file_provenance": {
    "origin_pr": 101,
    "origin_branch": "feature/auth-base"
  }
}
```

This tells you which PR in the stack introduced the file.

## Understanding Stack Order

Stack position 1 is the base (closest to main). Higher positions are further up:

```
main
  └── PR #101 (position: 1, base)  ← Review/merge first
        └── PR #102 (position: 2)
              └── PR #103 (position: 3, top)
```

## Common Queries

### All Entries with Stack Metadata

```bash
fw | jq 'select(.graphite != null)'
```

### View All Stacked PRs

```bash
fw --summary | jq 'select(.graphite != null) | {
  pr,
  pr_title,
  stack_id: .graphite.stack_id,
  position: .graphite.stack_position,
  size: .graphite.stack_size
}'
```

### Find Base PRs (Address First)

Base PRs should be reviewed and merged first:

```bash
fw --summary | jq 'select(.graphite.stack_position == 1)'
```

### List Stack in Order

```bash
fw --summary | jq -s '
  map(select(.graphite.stack_id == "STACK_ID")) |
  sort_by(.graphite.stack_position)
'
```

### Identify Stack from Any PR

Get the stack ID from one PR, then query the whole stack:

```bash
# Get stack ID
fw --summary --pr 102 | jq '.graphite.stack_id'

# Query entire stack
fw --summary | jq 'select(.graphite.stack_id == "STACK_ID")'
```

### PRs Ready to Review

PRs where all downstack PRs are approved:

```bash
fw --summary | jq 'select(.graphite != null) | {
  pr,
  position: .graphite.stack_position,
  approved: (.review_states.approved // 0),
  changes_requested: (.review_states.changes_requested // 0)
}'
```

## Stack Feedback Queries

### All Comments in a Stack

```bash
fw --type comment --pr 101,102,103 | jq '{
  pr,
  file,
  line,
  author,
  body: .body[0:100],
  id,
  stack_position: .graphite.stack_position
}'
```

### Unaddressed Comments Sorted by Position

Address bottom-up (base first):

```bash
fw --type comment --pr 101,102,103 | jq -s '
  map(select(
    .subtype == "review_comment" and
    (.file_activity_after.modified // false) == false
  )) |
  sort_by(.graphite.stack_position)
'
```

### Comments Needing Cross-PR Fixes

```bash
fw --type comment | jq 'select(.file_provenance.origin_pr != .pr) | {
  comment_pr: .pr,
  fix_in_pr: .file_provenance.origin_pr,
  file: .file,
  body: .body[0:60]
}'
```

See [cross-pr-fixes.md](cross-pr-fixes.md) for the fix workflow.

### Stack-Wide Feedback Summary

```bash
fw --type comment --pr 101,102,103 | jq -s '{
  total: length,
  review_comments: [.[] | select(.subtype == "review_comment")] | length,
  external: [.[] | select(.author != .pr_author)] | length,
  by_pr: (group_by(.pr) | map({
    pr: .[0].pr,
    position: .[0].graphite.stack_position,
    count: length
  })),
  needs_attention: [.[] | select(
    .subtype == "review_comment" and
    (.file_activity_after.modified // false) == false
  )] | length,
  cross_pr_fixes: [.[] | select(.file_provenance.origin_pr != .pr)] | length
}'
```

## Stack Review Workflow

### 1. Identify Stack PRs

```bash
gt state
# or
fw --summary --open | jq 'select(.graphite != null)'
```

### 2. Get All Feedback

```bash
fw --type comment --pr X,Y,Z | jq 'select(.subtype == "review_comment")'
```

### 3. Organize by Position

```bash
fw --type comment --pr X,Y,Z | jq -s '
  map(select(.subtype == "review_comment")) |
  sort_by(.graphite.stack_position) |
  group_by(.pr) |
  map({
    pr: .[0].pr,
    position: .[0].graphite.stack_position,
    comments: length,
    files: [.[].file] | unique
  })
'
```

### 4. Check File Provenance

```bash
fw --type comment --pr X,Y,Z | jq '
  select(.file_provenance.origin_pr != .pr)
'
```

### 5. Address Bottom-Up

Start with the lowest stack position to avoid restack conflicts.

## Tips

- **Always refresh first:** `fw --refresh`
- **Address base PRs first:** Lower positions affect everything above
- **Check provenance:** Comments may need fixes in a different PR
- **Use jq slurp (`-s`):** For aggregations and grouping
- **Handle null:** Use `// default` for missing graphite metadata
