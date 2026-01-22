# fw pr

GitHub PR operations with `gh`-aligned interface. Consolidates PR listing, editing, comments, and reviews into a single command group.

## Synopsis

```bash
fw pr <subcommand> [options]
```

## Subcommands

| Subcommand | Description                                  |
| ---------- | -------------------------------------------- |
| `list`     | List PRs and activity                        |
| `edit`     | Edit PR fields, labels, reviewers, assignees |
| `comment`  | Add a comment to a PR                        |
| `review`   | Submit a review on a PR                      |

---

## fw pr list

Query cached PR activity with filtering and aggregation.

### Options

| Option              | Description                                        |
| ------------------- | -------------------------------------------------- |
| `--prs [numbers]`   | Filter to specific PRs                             |
| `--repo <name>`     | Filter to repository (`owner/repo`)                |
| `-a, --all`         | Include all cached repos                           |
| `--mine`            | Items on PRs assigned to me                        |
| `--reviews`         | PRs I need to review                               |
| `--open`            | Filter to open PRs                                 |
| `--closed`          | Include merged and closed PRs                      |
| `--draft`           | Filter to draft PRs                                |
| `--active`          | Alias for `--open --draft`                         |
| `--orphaned`        | Unresolved comments on merged/closed PRs           |
| `--state <states>`  | Comma-separated PR states                          |
| `--type <types>`    | Filter by entry type (comment, review, commit, ci) |
| `--label <name>`    | Filter by PR label                                 |
| `--author <list>`   | Filter by author(s), `!` prefix to exclude         |
| `--no-bots`         | Exclude bot activity                               |
| `-s, --since <dur>` | Time window (24h, 7d, etc.)                        |
| `--offline`         | Use cache only, no network                         |
| `--refresh [full]`  | Force sync before query                            |
| `-n, --limit <n>`   | Limit results                                      |
| `--offset <n>`      | Skip first N results                               |
| `--summary`         | Aggregate into per-PR summary                      |
| `-j, --json`        | Force JSON output                                  |
| `--no-json`         | Force human-readable output                        |

### Examples

```bash
# List all activity on current repo
fw pr list

# List with per-PR summary
fw pr list --summary

# Filter to reviews only
fw pr list --type review

# Filter to specific PR
fw pr list --prs 42

# List from specific repo
fw pr list --repo owner/repo --since 7d
```

---

## fw pr edit

Edit PR metadata with `gh pr edit`-aligned flags. Supports adding and removing labels, reviewers, and assignees.

### Options

| Option                     | Description                  |
| -------------------------- | ---------------------------- |
| `--title <text>`           | Change PR title              |
| `--body <text>`            | Change PR description        |
| `--base <branch>`          | Change base branch           |
| `--milestone <name>`       | Set milestone                |
| `--remove-milestone`       | Clear milestone              |
| `--draft`                  | Convert to draft             |
| `--ready`                  | Mark ready for review        |
| `--add-label <name>`       | Add label (repeatable)       |
| `--remove-label <name>`    | Remove label (repeatable)    |
| `--add-reviewer <user>`    | Add reviewer (repeatable)    |
| `--remove-reviewer <user>` | Remove reviewer (repeatable) |
| `--add-assignee <user>`    | Add assignee (repeatable)    |
| `--remove-assignee <user>` | Remove assignee (repeatable) |
| `--repo <name>`            | Target repository            |
| `--json`                   | Force JSON output            |
| `--no-json`                | Force human-readable output  |

### Examples

```bash
# Add labels
fw pr edit 23 --add-label bug --add-label urgent

# Remove label
fw pr edit 23 --remove-label wip

# Add reviewer
fw pr edit 23 --add-reviewer alice

# Multiple changes at once
fw pr edit 23 --title "fix: auth bug" --add-label bug --add-reviewer bob

# Convert to draft
fw pr edit 23 --draft
```

---

## fw pr comment

Add a comment to a PR.

### Synopsis

```bash
fw pr comment <pr> <body>
```

### Options

| Option          | Description                 |
| --------------- | --------------------------- |
| `--repo <name>` | Target repository           |
| `--json`        | Force JSON output           |
| `--no-json`     | Force human-readable output |

### Examples

```bash
# Add a comment
fw pr comment 23 "LGTM, ready to merge"

# Comment on specific repo
fw pr comment 23 "Needs tests" --repo owner/repo
```

---

## fw pr review

Submit a review on a PR.

### Synopsis

```bash
fw pr review <pr> [options]
```

### Options

| Option                  | Description                 |
| ----------------------- | --------------------------- |
| `-a, --approve`         | Approve the PR              |
| `-r, --request-changes` | Request changes             |
| `-c, --comment`         | Comment without approval    |
| `-b, --body <text>`     | Review body                 |
| `--repo <name>`         | Target repository           |
| `--json`                | Force JSON output           |
| `--no-json`             | Force human-readable output |

### Examples

```bash
# Approve PR
fw pr review 23 --approve

# Request changes with comment
fw pr review 23 --request-changes -b "Please add error handling"

# Comment-only review
fw pr review 23 --comment -b "Looking good so far"
```
