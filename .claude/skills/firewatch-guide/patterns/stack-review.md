# Stack Review Pattern

Comprehensive check of a Graphite stack for feedback that needs attention.

## Prerequisites

```bash
fw --refresh
```

Graphite metadata is automatically enriched when you're in a repo with Graphite stacks.

## Workflow

### Step 1: Identify the Stack

**From Graphite CLI:**
```bash
gt state
```

This shows your current stack and all PRs in it.

**From Firewatch:**
```bash
fw --open | jq -s '
  map(select(.graphite != null)) |
  group_by(.graphite.stack_id) |
  map({
    stack_id: .[0].graphite.stack_id,
    prs: [.[] | .pr] | unique | sort,
    size: .[0].graphite.stack_size
  })
'
```

### Step 2: Get All Feedback in Stack

Query comments across all stack PRs:

```bash
# Replace with your PR numbers
fw --type comment --prs 101,102,103 | jq '{
  pr,
  file,
  line,
  author,
  body: .body[0:100],
  id,
  stack_position: .graphite.stack_position
}'
```

### Step 3: Filter to Actionable Comments

**Review comments only (inline code feedback):**
```bash
fw --type comment --prs 101,102,103 | jq '
  select(.subtype == "review_comment")
'
```

**External feedback only (not self-comments):**
```bash
fw --type comment --prs 101,102,103 | jq '
  select(.author != .pr_author)
'
```

**Unaddressed comments (file not modified since comment):**
```bash
fw --type comment --prs 101,102,103 | jq '
  select(
    .subtype == "review_comment" and
    (.file_activity_after.modified // false) == false
  )
'
```

### Step 4: Organize by Stack Position

Address feedback bottom-up (base PR first) to avoid restack conflicts:

```bash
fw --type comment --prs 101,102,103 | jq -s '
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

### Step 5: Check File Provenance

Some comments appear on PR N but the file was introduced in PR M. Fix in the origin PR:

```bash
fw --type comment --prs 101,102,103 | jq '
  select(.file_provenance.origin_pr != .pr) | {
    comment_on: .pr,
    fix_in: .file_provenance.origin_pr,
    file,
    line,
    body: .body[0:80]
  }
'
```

### Step 6: Stack Summary

One command to see overall stack feedback status:

```bash
fw --type comment --prs 101,102,103 | jq -s '{
  total: length,
  review_comments: [.[] | select(.subtype == "review_comment")] | length,
  external: [.[] | select(.author != .pr_author)] | length,
  by_pr: (group_by(.pr) | map({pr: .[0].pr, position: .[0].graphite.stack_position, count: length})),
  needs_attention: [.[] | select(
    .subtype == "review_comment" and
    (.file_activity_after.modified // false) == false
  )] | length,
  cross_pr_fixes: [.[] | select(.file_provenance.origin_pr != .pr)] | length
}'
```

## Addressing Feedback

### Order of Operations

1. **Start at the base** (stack_position = 1)
2. Make fixes in origin PR when file_provenance differs
3. Commit with `gt modify -m "address review: <summary>"`
4. Move up the stack and repeat
5. Run `gt restack` to propagate changes
6. Re-sync: `fw --refresh`

### Per-PR Workflow

For each PR in stack order:

```bash
# Get comments for this PR
fw --type comment --prs PR_NUMBER | jq 'select(.subtype == "review_comment")'

# Make fixes...

# Commit
gt modify -m "address review feedback"

# Move to next PR
gt up
```

### After All Fixes

```bash
# Propagate changes through stack
gt restack

# Submit updated PRs
gt submit --stack

# Verify resolution
fw --refresh
fw --type comment --prs 101,102,103 | jq -s 'length'
```

## Agent Checklist

```
1. [ ] fw --refresh
2. [ ] gt state --> identify stack PRs
3. [ ] fw --type comment --prs X,Y,Z --> get all feedback
4. [ ] Filter to subtype == "review_comment" and unaddressed
5. [ ] Sort by stack_position (base first)
6. [ ] Check file_provenance for cross-PR fixes
7. [ ] For each PR (bottom-up):
   - [ ] Make fixes
   - [ ] gt modify -m "..."
   - [ ] gt up
8. [ ] gt restack
9. [ ] Reply and resolve comments
10. [ ] gt submit --stack
11. [ ] fw --refresh --> verify
```

## Common Issues

### Comments on Wrong PR

If a reviewer comments on PR #103 but the file originated in PR #101:
- The comment will have `file_provenance.origin_pr = 101`
- Make the fix in PR #101, not #103
- After `gt restack`, the fix propagates to #103

### Stack Conflicts After Restack

If `gt restack` fails:
1. Check for merge conflicts
2. Resolve in the base PR first
3. Run `gt restack` again
4. Use `gt submit --force` if needed (carefully)

### Missing Graphite Metadata

If `graphite` fields are null:
1. Verify you're in a repo with Graphite stacks
2. Check that the PR is actually in a Graphite stack
3. Verify `gt state` shows the PR
4. Try `fw --refresh` to re-sync

## Tips

- Always address feedback bottom-up in stacks
- Use `gt modify` instead of regular commits to keep stack clean
- After resolving all feedback, run a final `fw --refresh` to verify
