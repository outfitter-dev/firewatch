---
name: cleanup
description: Subagent-driven cleanup of resolved comment threads
argument-hint: "[--dry-run]"
---

# Command: Firewatch Cleanup

Systematically verify and resolve comment threads that have been addressed.

## Pre-run Context

!`bun apps/cli/bin/fw.ts --type comment --open --json 2>/dev/null | jq -c 'select(.subtype == "review_comment") | {pr, file, line, author, body: .body[0:60], id}' | head -20`

## Skill Context

```
Load skill: firewatch
```

Reference: `.claude/skills/firewatch/patterns/resolving-threads.md`

## Task

This is an orchestrated cleanup workflow using subagents.

### Phase 1: Gather (Subagent)

Spawn a subagent to collect and analyze all review comments:

**Subagent prompt:**
> Analyze all open review comments from Firewatch. For each comment:
> 1. Read the file at the commented line
> 2. Determine if the concern has been addressed in the current code
> 3. Return a structured report:
>    - `id`: comment ID
>    - `pr`: PR number
>    - `file`: file path
>    - `line`: line number
>    - `concern`: brief description of what was requested
>    - `addressed`: true/false
>    - `evidence`: why you believe it's addressed (or not)

Use: `Task` tool with `subagent_type: "Explore"` and `run_in_background: true`

### Phase 2: Review (Orchestrator)

When subagent returns, present findings:

| PR | File | Concern | Addressed? | Evidence |
|----|------|---------|------------|----------|
| #102 | auth.ts:42 | Add error handling | ✅ Yes | try/catch added at L40-45 |
| #102 | auth.ts:58 | Rate limiting | ❌ No | No rate limit code found |
| #103 | config.ts:18 | Validate input | ✅ Yes | Zod schema added |

### Phase 3: Confirm

Ask user to confirm which comments to resolve:
- Show the list of "Addressed" comments
- If `--dry-run` was passed, just show what would be resolved
- Otherwise, ask: "Resolve these N comments? [Y/n]"

### Phase 4: Resolve

For confirmed comments:
```bash
bun apps/cli/bin/fw.ts close ID1 ID2 ID3
```

### Phase 5: Report

Summarize:
- ✅ Resolved: N comments
- ⏳ Still open: M comments (not yet addressed)
- 📝 Next steps: List remaining concerns

## Options

| Flag | Description |
|------|-------------|
| `--dry-run` | Show what would be resolved without doing it |

## Error Handling

- If a comment can't be resolved (permissions, already resolved), note it and continue
- Report any failures at the end

## Output

End with: `<promise>flow:fw:cleanup complete</promise>`

## Related

- `/fw:sitrep` — Get full status first
- `/fw:yolo` — Fix and resolve everything
