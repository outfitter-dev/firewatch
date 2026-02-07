# fw fb

Polymorphic feedback command for listing, viewing, replying to, and managing PR feedback. Uses short IDs (`@a7f3c`) for ergonomic comment references.

## Synopsis

```bash
fw fb [id] [body] [options]
```

## Modes

The command behavior depends on the arguments provided:

| Arguments        | Action                          |
| ---------------- | ------------------------------- |
| _(none)_         | List unaddressed feedback       |
| `<pr>`           | List feedback on specific PR    |
| `<pr> <body>`    | Add comment to PR               |
| `<id>`           | View comment details            |
| `<id> <body>`    | Reply to comment                |
| `<id> --ack`     | Acknowledge feedback            |
| `<id> --resolve` | Resolve review thread           |
| `<pr> --ack`     | Bulk acknowledge PR feedback    |
| `--current`      | Feedback on current branch's PR |
| `--stack`        | Feedback on current stack's PRs |

## Options

| Option              | Description                              |
| ------------------- | ---------------------------------------- |
| `--repo <name>`     | Repository (`owner/repo` format)         |
| `-c, --current`     | Target current git branch's PR           |
| `-s, --stack [dir]` | Filter to current stack (all/up/down)    |
| `--all`             | Show all feedback including resolved     |
| `--ack`             | Acknowledge feedback (👍 + local record) |
| `--resolve`         | Resolve thread (or resolve after reply)  |
| `--json`            | Force JSON output                        |
| `--no-json`         | Force human-readable output              |

## Short IDs

Firewatch generates 5-character hex short IDs for comments, making them easier to reference than GitHub's full IDs.

| Format         | Example          |
| -------------- | ---------------- |
| Short ID       | `@a7f3c`         |
| Full GitHub ID | `PRRC_kwDOBx...` |

Short IDs are derived from the full GitHub ID using SHA256. Use either format when referencing comments.

## Examples

### Listing Feedback

```bash
# List all unaddressed feedback (default)
fw fb

# List feedback on specific PR
fw fb 42

# List all feedback including resolved
fw fb 42 --all

# Force JSON output
fw fb --json
```

### Branch & Stack Targeting

```bash
# Feedback on current git branch's PR
fw fb --current

# Feedback on entire stack (requires Graphite)
fw fb --stack

# Feedback on current PR + downstack (toward trunk)
fw fb --stack down

# Feedback on current PR + upstack (toward tip)
fw fb --stack up
```

### Viewing Comments

```bash
# View comment details by short ID
fw fb @a7f3c

# View comment by full GitHub ID
fw fb PRRC_kwDOBx...
```

### Adding Comments

```bash
# Add comment to PR
fw fb 42 "LGTM, ready to merge"

# Reply to specific comment
fw fb @a7f3c "Good point, I'll fix that"

# Reply and resolve the thread
fw fb @a7f3c "Done" --resolve
```

### Acknowledging Feedback

The ack system marks feedback as "seen" without requiring a reply. It adds a 👍 reaction on GitHub and stores a local record.

```bash
# Acknowledge single comment
fw fb @a7f3c --ack

# Bulk acknowledge all feedback on PR
fw fb 42 --ack
```

### Resolving Threads

```bash
# Resolve a review comment thread
fw fb @a7f3c --resolve

# Reply and resolve in one action
fw fb @a7f3c "Fixed" --resolve
```

## Output Format

### JSON Output

Each feedback item includes both the short ID and full GitHub ID:

```json
{
  "id": "@a7f3c",
  "gh_id": "PRRC_kwDOBx...",
  "pr": 42,
  "pr_title": "Add validation",
  "author": "reviewer",
  "body": "Consider using Zod here",
  "file": "src/validator.ts",
  "line": 25,
  "thread_resolved": false
}
```

### Text Output

```
PR #42: Add validation
──────────────────────────────────────────────────

[@a7f3c] @reviewer src/validator.ts:25
  "Consider using Zod here for runtime validation"

1 need attention
```

## Feedback vs Comments

The `fb` command focuses on actionable feedback:

- **Review comments** — Inline code review comments with file/line context
- **Issue comments** — General PR discussion comments

By default, only unaddressed feedback is shown:

- Threads that are not resolved
- Comments not acknowledged via `--ack`

Use `--all` to see all comments including resolved threads.

## Stack Integration

The `--stack` flag enables stack-aware feedback queries for Graphite users. It detects the current branch's stack and filters feedback to only those PRs.

### Stack Directions

| Direction | PRs Included                          |
| --------- | ------------------------------------- |
| `all`     | All PRs in the stack (default)        |
| `down`    | Current PR + ancestors (toward trunk) |
| `up`      | Current PR + descendants (toward tip) |

### Requirements

- Graphite CLI (`gt`) must be installed and available
- Current directory must be in a Graphite-managed repository
- Branch must be part of a stack (not trunk)

### How It Works

1. Detects current git branch
2. Uses `gt state` to find stack structure
3. Resolves PR numbers via `gh pr list`
4. Filters feedback entries to matching PRs

See [Graphite Integration](../development/graphite-integration.md) for implementation details.

## Related Commands

| Command                       | Description            |
| ----------------------------- | ---------------------- |
| `fw pr list`                  | List all PR activity   |
| `fw pr comment <pr> <body>`   | Add PR comment (alias) |
| `fw pr review <pr> --approve` | Submit review          |
