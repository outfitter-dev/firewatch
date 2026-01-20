# Resolving Threads Pattern

How to reply to review comments and resolve threads after addressing feedback.

## Methods

### 1. Reply and Resolve (Preferred)

Acknowledge what was done and resolve in one command:

```bash
fw add PR_NUMBER "Fixed" --reply COMMENT_ID --resolve
```

### 2. Reply Only

When you want feedback before resolving:

```bash
fw add PR_NUMBER "I made this change, let me know if it looks right" --reply COMMENT_ID
```

### 3. Resolve Without Reply

When the fix is self-evident from the commit:

```bash
fw close COMMENT_ID
```

### 4. Bulk Resolve

Resolve multiple threads at once:

```bash
fw close IC_abc IC_def IC_ghi
```

## Good Reply Patterns

Keep replies brief but informative:

| Fix Type    | Reply Example                          |
| ----------- | -------------------------------------- |
| Renamed     | "Renamed to `getUserById` for clarity" |
| Added check | "Added null check"                     |
| Extracted   | "Extracted to `validateInput` helper"  |
| Added types | "Added explicit types"                 |
| Fixed bug   | "Fixed -- was off by one"              |
| Added test  | "Added test coverage"                  |
| Removed     | "Removed dead code"                    |
| Refactored  | "Refactored per suggestion"            |
| General     | "Done" or "Fixed"                      |

## When to Use Each Method

### Use Reply + Resolve When:

- You made a code change
- The fix might not be obvious
- You want to document what changed
- The reviewer asked a question you answered with code

### Use Resolve Only When:

- Fix is trivially obvious from the commit
- Comment was already addressed before you saw it
- Multiple comments addressed by same change

### Use Reply Only (No Resolve) When:

- You need clarification before fully addressing
- You disagree and want discussion
- You made a partial fix
- The reviewer should verify before closing

## Batch Resolution Workflow

### Get All Comment IDs for a PR

```bash
fw --type comment --pr PR_NUMBER | jq -r '
  select(.subtype == "review_comment") | .id
'
```

### Resolve All Comments on a File

```bash
fw --type comment --pr PR_NUMBER | jq -r '
  select(.file == "src/auth.ts") | .id
' | xargs fw close
```

### Resolve Only Addressed Comments

After making changes:

```bash
fw --refresh
fw --type comment --pr PR_NUMBER | jq -r '
  select(
    .subtype == "review_comment" and
    .file_activity_after.modified == true
  ) | .id
' | xargs fw close
```

### Resolve with Uniform Reply

For multiple similar fixes:

```bash
# Get IDs
IDS=$(fw --type comment --pr PR_NUMBER | jq -r '
  select(.file == "src/auth.ts") | .id
')

# Reply to each, then resolve all
for id in $IDS; do
  fw add PR_NUMBER "Fixed" --reply $id
done
fw close $IDS
```

## Verification

### Check Resolution Status

After resolving, sync and verify:

```bash
fw --refresh
fw --type comment --pr PR_NUMBER | jq '{
  file,
  line,
  id,
  body: .body[0:40]
}'
```

Resolved comments should no longer appear (or will have a resolved state).

### Summary of Remaining

```bash
fw --type comment --pr PR_NUMBER | jq -s '{
  total: length,
  review_comments: [.[] | select(.subtype == "review_comment")] | length,
  addressed: [.[] | select(.file_activity_after.modified == true)] | length,
  pending: [.[] | select(
    .subtype == "review_comment" and
    (.file_activity_after.modified // false) == false
  )] | length
}'
```

## Edge Cases

### Thread Already Resolved

If GitHub shows the thread as already resolved:

- `fw close` will succeed but have no effect
- No harm in calling it redundantly

### Missing Comment ID

If you can't find the comment ID:

1. Check you're querying the right PR
2. Try without filters: `fw --pr PR_NUMBER`
3. Check if the comment is on a different PR in a stack

### Resolution Failed

If `fw close` fails:

1. Verify the comment ID is correct
2. Check you have write access to the repo
3. Ensure the comment is a review thread (not issue comment)
4. Try `fw --refresh` and retry

## Agent Checklist

When resolving threads:

1. [ ] Ensure fix is actually complete
2. [ ] Choose appropriate method (reply+resolve vs resolve-only)
3. [ ] Write concise, informative reply
4. [ ] Use bulk resolve when appropriate
5. [ ] Verify with `fw --refresh` after resolving
6. [ ] Check remaining count matches expectations

## Complete Example

```bash
# 1. Find unaddressed comments
fw --type comment --pr 42 | jq 'select(
  .subtype == "review_comment" and
  (.file_activity_after.modified // false) == false
) | {file, line, body: .body[0:60], id}'

# 2. Make fixes...

# 3. Refresh to track changes
fw --refresh

# 4. Reply and resolve addressed comments
fw add 42 "Fixed -- added error handling" --reply IC_abc --resolve
fw add 42 "Done -- renamed for clarity" --reply IC_def --resolve

# 5. Bulk resolve any remaining trivial fixes
fw close IC_ghi IC_jkl

# 6. Verify
fw --refresh
fw --type comment --pr 42 | jq -s 'length'
```
