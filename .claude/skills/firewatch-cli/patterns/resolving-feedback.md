# Resolving Review Feedback

A systematic workflow for addressing review comments and resolving threads.

## Discovery Phase

### List All Unaddressed Comments

```bash
fw check  # Refresh staleness data first
fw query --type comment --prsPR_NUMBER | jq 'select(
  .subtype == "review_comment" and
  (.file_activity_after.modified // false) == false
)'
```

### Group by File

```bash
fw query --type comment --prsPR_NUMBER | jq -s '
  map(select(.subtype == "review_comment")) |
  group_by(.file) |
  map({
    file: .[0].file,
    count: length,
    comments: map({line, author, body: .body[0:60], id})
  })
'
```

### Prioritize by Reviewer

```bash
fw query --type comment --prsPR_NUMBER | jq -s '
  map(select(.subtype == "review_comment")) |
  group_by(.author) |
  map({
    reviewer: .[0].author,
    count: length,
    files: [.[].file] | unique
  })
'
```

## Implementation Phase

### Get Comment Details

```bash
fw query --type comment --prsPR_NUMBER | jq 'select(.file == "TARGET_FILE") | {
  id,
  line,
  body,
  author,
  url
}'
```

### Track Progress

After making changes:

```bash
fw check  # Refresh file activity tracking
fw query --type comment --prsPR_NUMBER | jq '{
  file,
  addressed: (.file_activity_after.modified // false),
  commits_after: (.file_activity_after.commits_touching_file // 0)
}'
```

## Resolution Phase

### Reply and Resolve

```bash
# Reply to a comment
fw comment PR_NUMBER "Fixed in latest commit" --reply-to COMMENT_ID

# Reply and resolve in one step
fw comment PR_NUMBER "Done" --reply-to COMMENT_ID --resolve
```

### Bulk Resolve

```bash
# Get all review comment IDs for a PR
COMMENTS=$(fw query --type comment --prsPR_NUMBER | jq -r 'select(.subtype == "review_comment") | .id')

# Resolve multiple
fw resolve $COMMENTS
```

### Resolve Addressed Comments Only

```bash
# Only resolve comments where file was modified
fw query --type comment --prsPR_NUMBER | jq -r 'select(
  .subtype == "review_comment" and
  .file_activity_after.modified == true
) | .id' | xargs fw resolve
```

## Verification Phase

### Check Remaining

```bash
fw sync  # Refresh from GitHub
fw query --type comment --prsPR_NUMBER | jq 'select(
  .subtype == "review_comment"
) | {file, line, resolved: (.state == "resolved" // false)}'
```

### Summary Report

```bash
fw query --type comment --prsPR_NUMBER | jq -s '{
  total_comments: length,
  review_comments: ([.[] | select(.subtype == "review_comment")] | length),
  addressed: ([.[] | select(.file_activity_after.modified == true)] | length),
  pending: ([.[] | select(
    .subtype == "review_comment" and
    (.file_activity_after.modified // false) == false
  )] | length)
}'
```

## Complete Workflow

```bash
# 1. Sync and check staleness
fw sync && fw check

# 2. List pending comments
fw query --type comment --prs123 | jq 'select(
  .subtype == "review_comment" and
  (.file_activity_after.modified // false) == false
) | {file, line, body: .body[0:80], id}'

# 3. Make code changes...

# 4. Refresh tracking
fw check

# 5. Verify addressed
fw query --type comment --prs123 | jq 'select(.file_activity_after.modified == true) | {file, line}'

# 6. Reply and resolve
fw comment 123 "Addressed all feedback" --reply-to IC_xxx --resolve

# 7. Final verification
fw sync
fw query --prs123 --type comment | jq -s 'length' # Should be 0 or only resolved
```

## For Graphite Stacks

When feedback requires changes in a different PR in the stack:

```bash
# Check file provenance
fw query --type comment --prs123 | jq 'select(.file_provenance.origin_pr != .pr) | {
  comment_pr: .pr,
  fix_in_pr: .file_provenance.origin_pr,
  file: .file,
  id
}'

# Fix in the origin PR, then:
# gt modify   (in the origin PR branch)
# gt restack  (to propagate changes)
# fw sync --with-graphite
```

## Tips

- Run `fw check` after making commits to update staleness tracking
- Use `--resolve` flag when replying to auto-resolve threads
- Bulk resolve with `fw resolve ID1 ID2 ID3`
- For Graphite stacks, check `file_provenance` to find where to make fixes
- Re-sync after resolving to verify GitHub reflects the changes
