# Working with Graphite Stacked PRs

Firewatch integrates with Graphite to provide stack-aware PR activity queries. This pattern covers workflows for managing stacked PRs.

## Syncing with Stack Metadata

Always sync with Graphite enrichment when working with stacks:

```bash
fw sync --with-graphite
```

This populates:
- `graphite.stack_id` — Unique identifier for the stack
- `graphite.stack_position` — Position (1 = bottom/base)
- `graphite.stack_size` — Total PRs in stack
- `graphite.parent_pr` — Parent PR number
- `file_provenance` — Which PR in stack owns each file change

## Understanding Stack Order

Stack position 1 is the base (closest to main). Higher positions are further up:

```
main
  └── PR #101 (position: 1, base)  ← Review/merge first
        └── PR #102 (position: 2)
              └── PR #103 (position: 3, top)
```

## Common Queries

### View All Stacked PRs

```bash
fw status | jq 'select(.graphite != null) | {
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
fw status | jq 'select(.graphite.stack_position == 1)'
```

### List Stack in Order

```bash
fw status | jq -s '
  map(select(.graphite.stack_id == "STACK_ID")) |
  sort_by(.graphite.stack_position)
'
```

### PRs Ready to Review

PRs where all downstack PRs are approved:

```bash
# Manual check: ensure position-1 PRs are approved before reviewing position-N
fw status | jq 'select(.graphite != null) | {
  pr,
  position: .graphite.stack_position,
  approved: (.review_states.approved // 0),
  changes_requested: (.review_states.changes_requested // 0)
}'
```

## Addressing Feedback in Stacks

### Find Which PR to Fix

When a file has feedback, check if the change originated from a different PR in the stack:

```bash
fw query --type comment | jq 'select(.file_provenance != null) | {
  comment_pr: .pr,
  file: .file,
  origin_pr: .file_provenance.origin_pr,
  origin_branch: .file_provenance.origin_branch,
  should_fix_in: (if .file_provenance.origin_pr != .pr then .file_provenance.origin_pr else .pr end)
}'
```

### Stack-Wide Feedback Summary

```bash
fw query --type comment | jq -s '
  map(select(.graphite != null)) |
  group_by(.graphite.stack_id) |
  map({
    stack: .[0].graphite.stack_id,
    total_comments: length,
    by_position: (group_by(.graphite.stack_position) | map({
      position: .[0].graphite.stack_position,
      comments: length
    }))
  })
'
```

## Workflow: Review a Stack

1. **Sync with Graphite metadata**
   ```bash
   fw sync --with-graphite
   ```

2. **List the stack in order**
   ```bash
   fw status | jq -s 'map(select(.graphite.stack_id == "STACK_ID")) | sort_by(.graphite.stack_position)'
   ```

3. **Start with base PR**
   ```bash
   fw query --prsBASE_PR_NUMBER --type review
   ```

4. **Check for unresolved comments**
   ```bash
   fw query --prsBASE_PR_NUMBER --type comment | jq 'select(.subtype == "review_comment")'
   ```

5. **Proceed upstack after approval**

## Workflow: Address Stack Feedback

When implementing feedback across a stack:

1. **Get all unaddressed comments**
   ```bash
   fw query --type comment | jq -s '
     map(select(
       .graphite != null and
       (.file_activity_after.modified // false) == false
     )) |
     sort_by(.graphite.stack_position) |
     group_by(.pr)
   '
   ```

2. **Identify fix locations** (check file provenance)
   ```bash
   fw query --type comment | jq 'select(.file_provenance.origin_pr != .pr) | {
     comment_on_pr: .pr,
     fix_in_pr: .file_provenance.origin_pr,
     file: .file
   }'
   ```

3. **Address from bottom up** — Start with lowest stack position

4. **Use `gt modify`** — After fixing, use Graphite's modify to update

5. **Restack** — Run `gt restack` to propagate changes upward

6. **Re-sync** — Refresh firewatch cache
   ```bash
   fw sync --with-graphite
   ```

## Tips

- Always address feedback starting from the bottom of the stack
- File provenance helps identify where changes originated
- After `gt modify`, changes propagate upward on restack
- Re-sync after modifying to update staleness tracking
