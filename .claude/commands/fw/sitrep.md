---
name: sitrep
description: Comprehensive review of all open PR feedback
argument-hint: "[PR number]"
---

# Command: Firewatch Sitrep

Situation report on PR activity. Quick scan first, then detailed check if anything needs attention.

## Pre-run Context

!`bun apps/cli/bin/fw.ts --refresh --open --summary --json 2>/dev/null | jq -c '{pr, title: .pr_title, state: .pr_state, stack_pos: .graphite.stack_position, comments: .counts.comments, reviews: .counts.reviews, changes_requested: .review_states.changes_requested}'`

## Skill Context

```
Load skill: firewatch
```

For Graphite stack workflows, reference:

- `.claude/skills/firewatch/graphite/stack-queries.md`
- `.claude/skills/firewatch/graphite/cross-pr-fixes.md`

## Task

### Phase 1: Quick Scan

Parse the pre-run context. Produce a one-glance summary:

**If argument is a PR number**, focus on that PR only.

**If no argument**, scan all open PRs:

| PR   | Title        | State | Comments | Reviews              | Attention? |
| ---- | ------------ | ----- | -------- | -------------------- | ---------- |
| #101 | Base changes | open  | 0        | ✅ approved          | —          |
| #102 | API layer    | open  | 3        | ⏳ pending           | **Yes**    |
| #103 | UI updates   | open  | 1        | ❌ changes requested | **Yes**    |

**Quick verdict:**

- ✅ **All clear** — No actionable feedback. Done.
- ⚠️ **N items need attention** — Proceed to Phase 2.

### Phase 2: Detailed Check (if needed)

If anything needs attention, query for details:

```bash
bun apps/cli/bin/fw.ts --type comment --open --json | jq -c 'select(.author != .pr_author) | select(.subtype == "review_comment") | select(.thread_resolved == false) | {pr, file, line, author, body, id}'
```

#### Comment Categorization

Categorize each comment by **type** and **severity**:

**Type** (what kind of feedback):
| Emoji | Type | Signals |
|-------|------|---------|
| 🧠 | Logic | Bug, correctness issue, missing error handling, security concern |
| ✨ | Style | Naming, structure, patterns, readability, "consider..." |
| 🤓 | Nit | Typos, formatting, minor preferences, "nit:" prefix |

**Severity** (how urgent):
| Emoji | Severity | Meaning |
|-------|----------|---------|
| 🔴 | Blocking | Must fix before merge |
| 🟡 | Should fix | Important but not blocking |
| 🟢 | Optional | Nice to have, author's discretion |

**Heuristics:**

- "Bug", "Issue", "Blocking", "Must" → 🔴
- "Should", "Please", "Consider" (for logic) → 🟡
- "Nit", "Minor", "Optional", "Consider" (for style) → 🟢
- Questions about logic → 🧠 (severity depends on context)
- "LGTM", "Looks good" → Not actionable, skip

#### Present by PR

Group findings by PR, sorted by stack position (if applicable):

**PR #102 — API layer** (stack position 2)

| File     | Line | Type     | Severity | Author    | Summary                              |
| -------- | ---- | -------- | -------- | --------- | ------------------------------------ |
| auth.ts  | 42   | 🧠 Logic | 🔴       | @reviewer | Add error handling for token refresh |
| auth.ts  | 58   | ✨ Style | 🟡       | @reviewer | Consider rate limiting               |
| types.ts | 12   | 🤓 Nit   | 🟢       | @other    | Typo in type name                    |

**PR #103 — UI updates** (stack position 3)

| File      | Line | Type     | Severity | Author    | Summary                   |
| --------- | ---- | -------- | -------- | --------- | ------------------------- |
| config.ts | 18   | 🧠 Logic | 🔴       | @reviewer | Validate input before use |

#### Check File Provenance (Graphite stacks)

For stack PRs, check if any comments need cross-PR fixes:

```bash
bun apps/cli/bin/fw.ts --type comment --open --json | jq -c 'select(.file_provenance.origin_pr != .pr) | {pr, fix_in: .file_provenance.origin_pr, file}'
```

If found, note: "⚠️ Comment on PR #X but file originated in PR #Y — fix in #Y"

### Phase 3: Recommendations

Based on findings:

**Priority order:**

1. 🔴 Blocking items (must address)
2. 🟡 Should-fix items (address if time permits)
3. 🟢 Optional items (author's discretion)

**Suggested actions:**

- `/fw:yolo` — Fix everything and ship
- `/fw:cleanup` — Just resolve already-addressed threads
- "Focus on PR #N" — Work through one PR at a time

**Ask user:** "How do you want to proceed?"

### Phase 4: Loop (if user chooses to address)

If user wants to address specific feedback:

1. Read the file at the commented location
2. Understand context (10-20 lines around)
3. Propose fix approach
4. After implementing, remind about thread resolution

Loop back to Phase 1 quick scan to verify progress.

## Output

End with: `<promise>flow:fw:sitrep complete</promise>`

## Related

- `/fw:cleanup` — Resolve addressed threads
- `/fw:yolo` — Full court press (fix everything, resolve, commit, submit)
