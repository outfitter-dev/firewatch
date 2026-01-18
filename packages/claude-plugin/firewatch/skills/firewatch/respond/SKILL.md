---
name: firewatch-respond
description: Helps respond to PR review comments and resolve threads. Use when addressing review feedback, replying to comments, resolving discussions, or when the user wants to handle PR feedback systematically.
allowed-tools: Read, Edit, Write, Bash(fw *), Bash(gh *), Bash(gt *), Bash(git *)
---

# Review Response Skill

Systematic workflow for addressing PR review feedback.

## Response Flow

```
1. Fetch review comments for PR
2. Group by file/thread
3. Address each comment
4. Reply and resolve threads
5. Update PR if needed
```

## Fetch Review Comments

```bash
# Get all review comments for a PR
fw --prs 123 --type review

# Get unresolved comments (review_comment subtype)
fw --prs 123 --type comment | jq 'select(.subtype == "review_comment")'

# Check for staleness hints if present
fw --prs 123 --type comment | jq 'select(.file_activity_after.modified == false)'
```

## Comment Categories

### Code Changes Required

- Bugs or logic errors identified
- Missing error handling
- Performance concerns
- Security issues

**Action**: Fix the code, then reply explaining the fix.

### Style/Preference

- Naming suggestions
- Code organization
- Documentation requests

**Action**: Apply if reasonable, or discuss tradeoffs.

### Questions/Clarifications

- "Why did you do X?"
- "What happens if Y?"
- "Have you considered Z?"

**Action**: Reply with explanation, no code change needed.

### Nitpicks

- Minor formatting
- Typos
- Optional improvements

**Action**: Fix quickly or acknowledge for future.

## Reply and Resolve

```bash
# Reply to a review thread
fw add 123 --reply COMMENT_ID "Fixed in latest commit"

# Reply and resolve in one command
fw add 123 --reply COMMENT_ID "Done" --resolve

# Bulk resolve addressed comments
fw close COMMENT_ID1 COMMENT_ID2 COMMENT_ID3
```

## Workflow Integration

### With Graphite

```bash
# After addressing feedback
gt modify -m "Address review feedback"
gt submit --stack
```

### With Standard Git

```bash
git add -A
git commit -m "Address review feedback"
git push
```

## Response Templates

### Code Fixed

> Fixed in [commit]. [Brief explanation of the fix].

### Clarification

> Good question! [Explanation]. I chose this approach because [reasoning].

### Acknowledged

> Good point, I'll address this in a follow-up PR to keep this one focused.

### Disagreement

> I considered that, but [reasoning]. Happy to discuss further if you see issues with this approach.

## Checklist

Before marking review complete:

- [ ] All comments addressed or responded to
- [ ] Code changes committed and pushed
- [ ] Threads resolved where appropriate
- [ ] CI passing on latest commit
