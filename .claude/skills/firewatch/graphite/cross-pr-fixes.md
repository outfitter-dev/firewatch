# Cross-PR Fixes in Graphite Stacks

How to handle file provenance when a fix belongs in a different PR than where the comment appears.

## The Problem

In Graphite stacks, a reviewer might comment on a file in PR #103 (top of stack), but that file was actually introduced in PR #101 (base of stack). If you fix the file in PR #103:

- The fix won't propagate down the stack
- PR #101 still has the original issue
- Rebasing becomes messy

The correct approach is to fix in the **origin PR** where the file was introduced.

## Detecting Cross-PR Comments

### Find All Cross-PR Comments

```bash
fw --type comment | jq 'select(.file_provenance.origin_pr != .pr)'
```

### Detailed View

```bash
fw --type comment | jq 'select(.file_provenance.origin_pr != .pr) | {
  comment_on_pr: .pr,
  fix_in_pr: .file_provenance.origin_pr,
  origin_branch: .file_provenance.origin_branch,
  file,
  line,
  body: .body[0:80],
  id
}'
```

### Group by Origin PR

See which origin PRs have comments to address:

```bash
fw --type comment | jq -s '
  map(select(.file_provenance.origin_pr != .pr)) |
  group_by(.file_provenance.origin_pr) |
  map({
    fix_in_pr: .[0].file_provenance.origin_pr,
    origin_branch: .[0].file_provenance.origin_branch,
    comments: length,
    files: [.[].file] | unique,
    comment_prs: [.[].pr] | unique
  })
'
```

## The Fix Workflow

### Step 1: Identify the Origin

```bash
fw --type comment --prs PR_NUMBER | jq '
  select(.file_provenance != null) | {
    file,
    origin_pr: .file_provenance.origin_pr,
    origin_branch: .file_provenance.origin_branch
  }
'
```

### Step 2: Switch to Origin Branch

```bash
gt checkout <origin-branch>
```

### Step 3: Make the Fix

Edit the file in the origin branch. The fix will propagate up the stack after restack.

### Step 4: Commit

See [commit-workflow.md](commit-workflow.md) for commit guidance.

For single-branch fixes:

```bash
gt modify -m "address review: <summary>"
```

### Step 5: Restack

Propagate the change through the stack:

```bash
gt restack
```

This rebases all PRs above the current one, incorporating your fix.

### Step 6: Submit Updated Stack

```bash
gt submit --stack
```

### Step 7: Sync and Verify

```bash
fw --refresh
```

### Step 8: Resolve the Original Comment

The comment lives on the higher PR, so resolve it there:

```bash
fw add ORIGINAL_PR "Fixed in PR #ORIGIN_PR, propagated via restack" --reply COMMENT_ID --resolve
```

## Complete Example

```bash
# 1. Find cross-PR comments
fw --type comment --prs 103 | jq '
  select(.file_provenance.origin_pr != .pr) | {
    file,
    fix_in: .file_provenance.origin_pr,
    origin_branch: .file_provenance.origin_branch,
    id
  }
'
# Output: {file: "src/auth.ts", fix_in: 101, origin_branch: "feature/auth-base", id: "IC_xyz"}

# 2. Switch to origin branch
gt checkout feature/auth-base

# 3. Make the fix
# ... edit src/auth.ts ...

# 4. Commit to origin PR
gt modify -m "address review: add error handling"

# 5. Propagate through stack
gt restack

# 6. Submit all updated PRs
gt submit --stack

# 7. Sync and verify
fw --refresh

# 8. Resolve comment on original PR
fw add 103 "Fixed in base PR #101, propagated via restack" --reply IC_xyz --resolve
```

## Edge Cases

### File Modified in Multiple PRs

If a file appears in multiple stack PRs, Graphite tracks where it was **introduced**. Subsequent modifications don't change provenance.

To see the full history:

```bash
gt log --files src/auth.ts
```

### Conflicting Fixes

If your fix conflicts with changes in higher PRs:

1. `gt restack` will pause on conflict
2. Resolve the conflict manually
3. `git add` the resolved file
4. `gt continue`

### Missing Provenance Data

If `file_provenance` is null:

- The file may have been introduced before stack tracking
- The file may not be in a Graphite stack
- Try re-syncing: `fw --refresh`

### Reviewer Wants Fix in Place

Sometimes reviewers want the fix in the commenting PR, not the origin. In that case:

1. Make the fix in the current PR
2. Explain in your reply: "Fixed here as requested, though file originated in #101"
3. Be aware this may cause issues if origin PR changes

## Best Practices

1. **Always check provenance** before fixing stack comments
2. **Fix at origin** unless specifically asked otherwise
3. **Restack immediately** after origin fixes
4. **Submit the whole stack** to keep PRs in sync
5. **Reference origin PR** in your reply for context

## Agent Checklist

For each cross-PR comment:

1. [ ] Check `file_provenance.origin_pr`
2. [ ] If different from comment PR, switch to origin branch
3. [ ] Make the fix in origin
4. [ ] Commit (see [commit-workflow.md](commit-workflow.md))
5. [ ] Run `gt restack` to propagate
6. [ ] Handle any conflicts
7. [ ] Run `gt submit --stack`
8. [ ] Sync: `fw --refresh`
9. [ ] Resolve comment on original PR, mentioning fix location
10. [ ] Verify fix appears in all relevant PRs
