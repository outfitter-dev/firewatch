# Responding to PR Feedback

Examples for viewing and responding to PR review feedback using the Firewatch CLI.

## Viewing Feedback

### List All Unaddressed Feedback

```bash
# All unaddressed feedback across repos
fw fb

# Unaddressed feedback for current repo only
fw fb --repo
```

### PR-Level Feedback

```bash
# All feedback for PR #123
fw fb 123

# Unaddressed only
fw fb 123 --unaddressed

# Include resolved threads
fw fb 123 --all
```

### Comment-Level Details

```bash
# View specific comment by short ID
fw fb @abc123

# Shows: author, body, thread context, file location, resolution status
```

## Reply Patterns

### Explaining a Fix

```bash
# Reply explaining what you changed
fw fb @abc123 "Fixed - moved the validation to the controller layer"

# Reply with code reference
fw fb @abc123 "Refactored in commit f4a2b1c - now uses the shared validator"
```

### Asking for Clarification

```bash
fw fb @abc123 "Could you clarify? I'm not sure if you mean the input validation or the schema validation"

# With context
fw fb @abc123 "The current approach handles edge cases X and Y. Were you thinking of a different pattern?"
```

### Respectful Disagreement

```bash
fw fb @abc123 "I considered that, but kept the current approach because [reason]. Happy to discuss further"

# Offering alternatives
fw fb @abc123 "I see the concern. Would extracting this into a separate function address it while keeping the behavior?"
```

### Acknowledging Without Code Changes

```bash
# Thumbs-up reaction (quick acknowledgment)
fw fb @abc123 --ack

# Reply with acknowledgment
fw fb @abc123 "Good catch - will address in a follow-up PR to keep this one focused"
```

## Resolving Threads

### Resolve After Addressing

```bash
# Reply and resolve in one command
fw fb @abc123 "Done - updated the error handling" --resolve

# Resolve without reply (when fix is obvious)
fw fb @abc123 --resolve
```

### Resolve Multiple Threads

```bash
# After pushing fixes, resolve addressed threads
fw fb @abc123 --resolve
fw fb @def456 --resolve
fw fb @ghi789 "Addressed differently - see inline comment" --resolve
```

## Bulk Operations

### Acknowledge Multiple Comments

```bash
# Acknowledge several nitpicks
fw fb @abc123 --ack
fw fb @def456 --ack
fw fb @ghi789 --ack
```

### Batch Response Script

```bash
# Review all unaddressed, respond to each
for id in $(fw fb 123 --jsonl | jq -r '.id'); do
  echo "Comment: $id"
  fw fb "$id"
  # Manually respond or skip
done
```

## Graphite Workflow

### Typical Flow

```bash
# 1. View feedback for your PR
fw fb 123

# 2. Make code changes to address feedback
# ... edit files ...

# 3. Amend the current commit
gt modify

# 4. Reply and resolve threads
fw fb @abc123 "Fixed in latest push" --resolve
fw fb @def456 --resolve

# 5. Push the entire stack
gt submit --stack
```

### Stack-Aware Response

```bash
# When feedback affects multiple PRs in stack
fw fb 123  # Check parent PR
fw fb 124  # Check child PR

# Fix in correct PR, then
gt modify
gt submit --stack  # Updates all dependent PRs
```

### After Rebasing

```bash
# Graphite rebase may invalidate comment locations
gt sync

# Re-check feedback (comment IDs persist)
fw fb 123

# Respond as normal
fw fb @abc123 "Addressed after rebase" --resolve
```

## Standard Git Workflow

### Typical Flow

```bash
# 1. View feedback
fw fb 123

# 2. Make changes
# ... edit files ...

# 3. Commit the fix
git add -p
git commit -m "fix: address PR feedback on validation"

# 4. Push
git push

# 5. Respond and resolve
fw fb @abc123 "Fixed in latest commit" --resolve
```

### Amending Previous Commit

```bash
# If feedback is minor and you want clean history
git add -p
git commit --amend --no-edit
git push --force-with-lease

fw fb @abc123 --resolve
```

## Response Templates

### Quick Acknowledgments

```bash
# For valid suggestions you'll implement
fw fb @id "Good point - fixed"
fw fb @id "Done" --resolve
fw fb @id --ack  # Thumbs-up only

# For suggestions to defer
fw fb @id "Noted - tracking in #456 for follow-up"
fw fb @id "Will address in a separate PR"
```

### Explaining Decisions

```bash
# Performance rationale
fw fb @id "Kept this approach for O(1) lookup. The alternative would require O(n) scanning"

# Consistency rationale
fw fb @id "Following the pattern in auth.ts:45 for consistency across the codebase"

# Scope rationale
fw fb @id "Agreed this could be better, but keeping scope tight. Created #457 to track"
```

### Requesting Re-Review

```bash
# After addressing all feedback
fw fb @id "All feedback addressed - ready for another look" --resolve

# Tagging reviewer in final comment
fw fb @id "Thanks for the thorough review @reviewer - pushed fixes, PTAL"
```

## Viewing Response History

```bash
# See your replies in thread context
fw fb @abc123

# Check which threads are still open
fw fb 123 --unaddressed

# Verify resolution status
fw fb 123 --status
```
