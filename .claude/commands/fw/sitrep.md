---
name: sitrep
description: Comprehensive review of all open PR feedback
argument-hint: ""
---

# Command: Firewatch Sitrep

Full situation report on PR activity and outstanding feedback.

## Pre-run Context

!`bun apps/cli/bin/fw.ts --refresh --open --summary --json 2>/dev/null | jq -c '{pr, title: .pr_title, state: .pr_state, stack_pos: .graphite.stack_position, comments: .counts.comments, reviews: .counts.reviews, review_states}'`

## Task

Generate a comprehensive status report:

### 1. Stack Overview

Parse the summary above. Group by Graphite stack (if any) or list standalone PRs:

**Stack: feature-xyz** (3 PRs)
| Pos | PR | Title | Reviews | Comments | Blocking? |
|-----|----|----|---------|----------|-----------|
| 1 | #101 | Base changes | ✅ approved | 0 | No |
| 2 | #102 | API layer | ⏳ pending | 3 | **Yes** |
| 3 | #103 | UI updates | ❌ changes requested | 1 | **Yes** |

### 2. Actionable Feedback

Query for unaddressed external comments:
```bash
bun apps/cli/bin/fw.ts --type comment --open --json | jq -c 'select(.author != .pr_author) | select(.subtype == "review_comment") | {pr, file, author, body: .body[0:100], id}'
```

Group by PR and categorize:

**PR #102 — API layer** (3 comments)
- `auth.ts:42` — @reviewer: "Add error handling for token refresh" (🔴 Logic)
- `auth.ts:58` — @reviewer: "Consider rate limiting" (🟡 Style)
- `types.ts:12` — @other: "Typo in type name" (🟢 Nit)

### 3. Review Status

Query for review states:
```bash
bun apps/cli/bin/fw.ts --type review --open --json | jq -c '{pr, author, state, body: .body[0:80]}'
```

Summarize:
- **Approved**: PR #101 (@reviewer)
- **Changes Requested**: PR #103 (@reviewer) — "Need to address auth concerns"
- **Awaiting Review**: PR #102

### 4. Recommended Actions

Based on analysis, provide prioritized next steps:

1. 🔴 **Address blocking feedback on PR #102** — Auth error handling required
2. 🔴 **Respond to changes requested on PR #103** — Auth concerns
3. 🟡 **Consider style suggestions** — Rate limiting on PR #102
4. ✅ **PR #101 ready to merge** — Approved, no outstanding comments

### 5. Ask User

- Which PR to focus on first?
- Want to run `/fw:cleanup` to resolve any already-addressed comments?
- Ready for `/fw:yolo` to tackle everything?

## Output

End with: `<promise>flow:fw:sitrep complete</promise>`

## Related

- `/fw:check [stack|PR]` — Quick check on specific scope
- `/fw:cleanup` — Resolve addressed threads
- `/fw:yolo` — Full court press
