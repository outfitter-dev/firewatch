# Graphite Commit Workflow

How to commit changes when working in Graphite stacks.

## The Key Distinction

| Scenario              | Command       | Behavior                                                |
| --------------------- | ------------- | ------------------------------------------------------- |
| Single branch changes | `gt modify`   | Amends the current branch's commit                      |
| Cross-stack changes   | `gt amend -a` | Places changes in appropriate branches across the stack |

## When to Use `gt modify`

Use `gt modify` when:

- You're making changes to a **single PR/branch** in the stack
- All your changes belong to the current branch only
- You're working manually on one branch at a time

```bash
# Make changes to files in current branch
# ...

# Amend the current branch's commit
gt modify -m "address review: add error handling"

# Restack to propagate to branches above
gt restack
```

## When to Use `gt amend -a`

Use `gt amend -a` when:

- **Subagents** are implementing fixes that touch multiple branches
- Changes span multiple PRs in the stack
- You want Graphite to automatically place changes in the right branches

```bash
# Subagent makes changes to files across multiple PRs
# ...

# Stage all and let Graphite distribute to appropriate branches
gt amend -a

# Restack to ensure consistency
gt restack
```

**Why this matters:** When subagents implement cross-stack feedback, they often edit files that originated in different PRs. Using `gt amend -a` ensures each change lands in the PR that owns that file.

## Workflow: Single Branch Fix

```bash
# 1. Check out the target branch
gt checkout <branch-name>

# 2. Make the fix
# ... edit files ...

# 3. Commit to this branch
gt modify -m "address review: <summary>"

# 4. Move up and repeat if needed
gt up
# ... more fixes ...
gt modify -m "..."

# 5. Propagate all changes
gt restack

# 6. Submit
gt submit --stack
```

## Workflow: Cross-Stack Fix (Subagents)

```bash
# 1. Ensure you're at the top of the stack or an appropriate branch
gt checkout <branch>

# 2. Subagent makes all fixes across the stack
# ... files in multiple PRs modified ...

# 3. Stage all and amend
gt amend -a

# 4. Restack to propagate
gt restack

# 5. Submit the stack
gt submit --stack
```

## Handling Restack Conflicts

If `gt restack` fails with conflicts:

1. Graphite shows which file(s) conflict
2. Edit the file(s) to resolve
3. Stage the resolved files: `gt add -A`
4. Continue: `gt continue`

```bash
# After conflict
gt add -A
gt continue
```

If conflicts persist:

- Consider fixing in a lower PR first
- Use `gt abort` to cancel and try a different approach

## After Committing

Always re-sync Firewatch to update staleness tracking:

```bash
fw --refresh
```

Then verify addressed comments:

```bash
fw --type comment --prs PR_NUMBER | jq 'select(.file_activity_after.modified == true)'
```

## Common Mistakes

### Using `gt modify` for Cross-Stack Changes

**Problem:** You edited files that belong to different PRs but used `gt modify`.

**Result:** All changes land in the current branch, not their origin branches.

**Fix:** Use `gt amend -a` instead, which distributes changes to the right branches.

### Forgetting to Restack

**Problem:** You committed with `gt modify` or `gt amend` but didn't run `gt restack`.

**Result:** Changes don't propagate to branches above in the stack.

**Fix:** Always run `gt restack` after modifying any branch in a stack.

### Committing Before Checking Provenance

**Problem:** You fixed a file in PR #103 but it was introduced in PR #101.

**Result:** The fix is in the wrong place; PR #101 still has the original issue.

**Fix:** Check `file_provenance` first (see [cross-pr-fixes.md](cross-pr-fixes.md)), then fix in the origin PR.

## Summary

```
┌─────────────────────────────────────────────────────────┐
│  Single branch?  ──────────────▶  gt modify             │
│                                                         │
│  Cross-stack (subagents)?  ────▶  gt amend -a           │
│                                                         │
│  Always after commits:  ───────▶  gt restack            │
│                                                         │
│  Always after restack:  ───────▶  gt submit --stack     │
└─────────────────────────────────────────────────────────┘
```
