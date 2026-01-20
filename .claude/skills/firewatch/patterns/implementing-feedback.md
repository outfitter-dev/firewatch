# Implementing Feedback Pattern

Systematic workflow for addressing review comments and making the requested changes.

## Phase 1: Gather Context

### Get Comment Details

```bash
fw --type comment --pr PR_NUMBER | jq 'select(.subtype == "review_comment") | {
  id,
  file,
  line,
  author,
  body,
  url
}'
```

### Read the File at Comment Location

Use the `file` and `line` fields to navigate:

```bash
# Example: comment on src/auth.ts line 42
# Use your editor or Read tool to view src/auth.ts around line 42
```

### Understand the Request

Common feedback patterns and how to interpret them:

| Prefix             | Meaning        | Action                                |
| ------------------ | -------------- | ------------------------------------- |
| "Consider..."      | Suggestion     | Use judgment, implement if reasonable |
| "This should..."   | Direct request | Implement as stated                   |
| "Why..."           | Question       | May need explanation, not code change |
| "Bug:" or "Issue:" | Problem found  | Must fix                              |
| "Nit:"             | Minor issue    | Optional, low priority                |
| "LGTM"             | Approval       | No action needed                      |
| "Blocking:"        | Critical       | Must address before merge             |

### Check for Cross-PR Fixes (Graphite Stacks)

If in a Graphite stack, check if this file originated elsewhere:

```bash
fw --type comment --pr PR_NUMBER | jq 'select(.file_provenance != null) | {
  file,
  origin_pr: .file_provenance.origin_pr,
  body: .body[0:80]
}'
```

If `origin_pr` differs from the current PR, the fix belongs in the origin PR.

See [../graphite/cross-pr-fixes.md](../graphite/cross-pr-fixes.md) for the workflow.

## Phase 2: Implement Fix

### Make the Code Change

Navigate to the file and line, then implement the fix.

### Common Fix Patterns

**Add error handling:**

```typescript
// Before
const result = await fetch(url);

// After
const result = await fetch(url);
if (!result.ok) {
  throw new Error(`Fetch failed: ${result.status}`);
}
```

Reply: "Added error handling for non-ok responses"

**Rename for clarity:**

```typescript
// Before
const d = getData();

// After
const userData = getUserData();
```

Reply: "Renamed to `userData`/`getUserData` for clarity"

**Extract to function:**

```typescript
// Before: inline logic in main function

// After: extracted helper
function validateInput(input: string): boolean {
  // ...validation logic
}
```

Reply: "Extracted to `validateInput` helper"

**Add types:**

```typescript
// Before
function process(data) { ... }

// After
function process(data: UserInput): ProcessedResult { ... }
```

Reply: "Added explicit types for input and return"

**Add null check:**

```typescript
// Before
const name = user.name;

// After
const name = user?.name ?? "Unknown";
```

Reply: "Added null safety for user.name"

## Phase 3: Verify Changes

### Run Tests

Always verify changes don't break anything:

```bash
bun test
# or
npm test
```

### Lint/Format Check

```bash
bun run check
# or
npm run lint
```

### Check File Was Modified

```bash
fw --refresh
fw --type comment --pr PR_NUMBER | jq 'select(.file == "TARGET_FILE") | {
  file,
  addressed: .file_activity_after.modified,
  commits_after: .file_activity_after.commits_touching_file
}'
```

## Phase 4: Resolve Comments

After implementing, acknowledge and resolve. See [resolving-threads.md](resolving-threads.md) for detailed patterns.

Quick resolution:

```bash
fw add PR_NUMBER "Fixed -- <brief description>" --reply COMMENT_ID --resolve
```

## Handling Special Cases

### When You Disagree

If you disagree with the feedback:

1. Don't resolve without addressing
2. Reply explaining your reasoning
3. Let the reviewer respond
4. Escalate to user if needed

```bash
fw add PR_NUMBER "I kept this as-is because... Let me know if you'd still like me to change it." --reply COMMENT_ID
```

### When Clarification Is Needed

Ask before implementing:

```bash
fw add PR_NUMBER "Could you clarify what you mean by X? I want to make sure I address this correctly." --reply COMMENT_ID
```

### When Multiple Comments Are Related

Group related comments and address together:

```bash
# Find all comments on same file
fw --type comment --pr PR_NUMBER | jq 'select(.file == "src/auth.ts")'

# Address all at once, then resolve all
```

## Agent Implementation Checklist

For each comment:

1. [ ] Read the comment body fully
2. [ ] Navigate to file:line
3. [ ] Understand surrounding context (read 10-20 lines around the location)
4. [ ] Determine if code change needed or just explanation
5. [ ] Check file_provenance for stack fixes (see [../graphite/cross-pr-fixes.md](../graphite/cross-pr-fixes.md))
6. [ ] Implement the fix
7. [ ] Run tests and linter
8. [ ] Commit changes
9. [ ] Reply with brief description of change
10. [ ] Resolve the thread
11. [ ] Move to next comment

## Batch Processing

When addressing multiple comments efficiently:

```bash
# 1. Get all unaddressed comments grouped by file
fw --type comment --pr PR_NUMBER | jq -s '
  map(select(.subtype == "review_comment")) |
  group_by(.file) |
  map({
    file: .[0].file,
    comments: map({line, body: .body[0:60], id})
  })
'

# 2. Address all comments in one file
# 3. Single commit for that file
# 4. Bulk resolve all IDs for that file
fw close ID1 ID2 ID3
```

## Summary Report

After addressing all feedback:

```bash
fw --refresh
fw --type comment --pr PR_NUMBER | jq -s '{
  total: length,
  addressed: [.[] | select(.file_activity_after.modified == true)] | length,
  remaining: [.[] | select(
    .subtype == "review_comment" and
    (.file_activity_after.modified // false) == false
  )] | length
}'
```

## For Graphite Stacks

When implementing feedback across a stack, see:

- [../graphite/cross-pr-fixes.md](../graphite/cross-pr-fixes.md) — Fixing in the right PR
- [../graphite/commit-workflow.md](../graphite/commit-workflow.md) — How to commit changes
