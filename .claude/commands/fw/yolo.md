---
name: yolo
description: Full court press - fix everything outstanding and ship it
argument-hint: ""
---

# Command: Firewatch YOLO

Fix all outstanding feedback, resolve threads, commit, and submit the stack.

⚠️ **This is an aggressive workflow.** It will:

1. Identify all actionable feedback
2. Dispatch agents to implement fixes
3. Resolve comment threads
4. Amend commits with changes
5. Submit the entire stack

## Pre-run Context

!`bun apps/cli/bin/fw.ts --refresh --open --summary --json 2>/dev/null | jq -c '{pr, title: .pr_title, stack_pos: .graphite.stack_position, comments: .counts.comments, changes_requested: .review_states.changes_requested}'`

## Task

### Phase 1: Sitrep

First, get the full picture by running `/fw:sitrep` flow internally:

```
Load skill: firewatch-guide
Execute sitrep analysis
```

Capture:

- All open PRs in the stack
- All actionable comments (🔴 Logic/Bug, 🟡 Style)
- Any "changes requested" reviews

### Phase 2: Plan

Present the attack plan to user:

**Found N actionable items across M PRs:**

| PR   | File       | Issue                 | Severity      |
| ---- | ---------- | --------------------- | ------------- |
| #102 | auth.ts:42 | Add error handling    | 🔴 Must fix   |
| #102 | auth.ts:58 | Add rate limiting     | 🟡 Should fix |
| #103 | config.ts  | Address auth concerns | 🔴 Must fix   |

**Proposed approach:**

1. Dispatch agents to fix each file
2. Resolve threads after fixes verified
3. `gt amend -a` to capture changes
4. `gt submit --stack` to push

**Ask:** "Proceed with YOLO? [Y/n]"

### Phase 3: Dispatch

If confirmed, load the dispatch-agents skill:

```
/baselayer:dispatch-agents
```

Dispatch specialized agents for each fix:

- Group fixes by file where possible
- Use `senior-dev` agents for implementation
- Run in parallel where files don't conflict

**Dispatch pattern:**

```
Task: Fix auth.ts feedback
Agent: senior-dev
Prompt: |
  Address these review comments in apps/api/auth.ts:
  1. Line 42: Add try/catch error handling for token refresh
  2. Line 58: Implement rate limiting for refresh endpoint

  After fixing, verify each concern is addressed.
```

### Phase 4: Verify

After agents complete:

1. Review each fix
2. Run tests: `bun test`
3. Run type check: `bun run check`

If any fail, iterate with agents until passing.

### Phase 5: Resolve Threads

For each addressed comment:

```bash
bun apps/cli/bin/fw.ts close ID1 ID2 ID3
```

### Phase 6: Commit & Submit

Stage and amend all changes:

```bash
gt amend -a
```

Submit the entire stack:

```bash
gt submit --stack
```

### Phase 7: Report

**YOLO Complete** 🚀

| Metric           | Count |
| ---------------- | ----- |
| Issues fixed     | N     |
| Threads resolved | M     |
| PRs updated      | K     |

**Stack submitted:**

- PR #101 — Base changes ✅
- PR #102 — API layer ✅
- PR #103 — UI updates ✅

**Remaining items** (if any):

- Questions needing human response
- Items explicitly skipped

## Abort Conditions

Stop and ask user if:

- Tests fail after 2 fix attempts
- Type errors can't be resolved
- A fix would require significant refactoring
- Unsure about a reviewer's intent

## Output

End with: `<promise>flow:fw:yolo complete</promise>`

## Related

- `/fw:sitrep` — Just the analysis, no action
- `/fw:cleanup` — Just resolve threads, no fixes
- `/fw:check PR` — Focus on single PR
