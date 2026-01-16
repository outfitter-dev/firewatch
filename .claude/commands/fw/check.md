---
name: check
description: Check PR feedback - pass "stack" for current stack or a PR number
argument-hint: "[stack | <pr-number>]"
---

# Command: Firewatch Check

Quick feedback check for your PRs.

## Pre-run Context

!`bun apps/cli/bin/fw.ts --refresh --open --summary --json 2>/dev/null | jq -c '{pr, pr_title, stack_pos: .graphite.stack_position, comments: .counts.comments, reviews: .counts.reviews}' | head -10`

## Task

Based on the argument provided:

### If `$1` is "stack" or empty

1. **Parse the summary above** — Identify PRs in the current Graphite stack (those with `stack_pos`)

2. **Query for external feedback on stack PRs**:

   ```bash
   bun apps/cli/bin/fw.ts --type comment --open --json | jq -c 'select(.graphite.stack_position != null) | select(.author != .pr_author) | select(.subtype == "review_comment") | {pr, stack_pos: .graphite.stack_position, file, author, body: .body[0:80]}'
   ```

3. **Summarize by stack position**:

   | Pos | PR  | Title | Comments | Status                  |
   | --- | --- | ----- | -------- | ----------------------- |
   | 1   | #N  | ...   | count    | needs attention / clear |

4. **For PRs with feedback**, briefly note:
   - Who commented and on what file
   - Whether it looks actionable (logic/bug) vs style/nit

### If `$1` is a PR number

1. **Query for that specific PR**:

   ```bash
   bun apps/cli/bin/fw.ts --type comment --prs $1 --json | jq -c 'select(.subtype == "review_comment") | {file, line, author, body: .body[0:150], id}'
   ```

2. **Categorize each comment**:
   - 🔴 **Logic/Bug** — Must fix
   - 🟡 **Style** — Should consider
   - 🟢 **Nit** — Optional
   - 💬 **Question** — Needs response

3. **Present by file**:

   ### file.ts

   | Line | Author   | Category | Summary        |
   | ---- | -------- | -------- | -------------- |
   | 42   | reviewer | 🔴 Logic | Description... |

4. **Ask user** which to address or if they want file context

## After Check

If user wants to address feedback:

- Read the relevant file(s) to understand context
- Propose fix approach
- After fixing, remind about `/fw:cleanup` to resolve threads

## Related

- `/fw:sitrep` — Comprehensive review across all open PRs
- `/fw:cleanup` — Resolve addressed comment threads
- `/fw:yolo` — Fix everything and ship it
