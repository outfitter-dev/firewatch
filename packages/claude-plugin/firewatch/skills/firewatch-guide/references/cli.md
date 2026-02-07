# Firewatch CLI Reference

Complete reference for the `fw` command-line tool.

## Global Options

| Flag         | Description                 |
| ------------ | --------------------------- |
| `--jsonl`    | Force JSONL output          |
| `--no-jsonl` | Force human-readable output |
| `--debug`    | Enable debug logging        |
| `--no-color` | Disable color output        |

---

## Query Command (`fw`)

The base `fw` command queries cached PR activity.

### Filtering Options

| Flag                | Description                                               |
| ------------------- | --------------------------------------------------------- |
| `--pr [numbers]`    | Filter to specific PR(s)                                  |
| `--repo <name>`     | Filter to specific repository                             |
| `-a, --all`         | Include all cached repos                                  |
| `--mine`            | Items on PRs assigned to me                               |
| `--reviews`         | PRs I need to review                                      |
| `--open`            | Filter to open PRs (including drafts)                     |
| `--ready`           | Filter to ready PRs (open, non-draft)                     |
| `--closed`          | Include merged and closed PRs                             |
| `--draft`           | Filter to draft PRs                                       |
| `--orphaned`        | Unresolved comments on merged/closed PRs                  |
| `--state <states>`  | Explicit comma-separated PR states                        |
| `--type <types>`    | Filter by entry type (comment, review, commit, ci, event) |
| `--label <name>`    | Filter by PR label (partial match)                        |
| `--author <list>`   | Filter by author(s), prefix `!` to exclude                |
| `--no-bots`         | Exclude bot activity                                      |
| `-s, --since <dur>` | Filter by time window (e.g., `24h`, `7d`, `2w`)           |

### Output Options

| Flag                  | Description                           |
| --------------------- | ------------------------------------- |
| `--summary`           | Aggregate entries into per-PR summary |
| `-n, --limit <count>` | Limit number of results               |
| `--offset <count>`    | Skip first N results                  |

### Sync Options

| Flag          | Description                    |
| ------------- | ------------------------------ |
| `--no-sync`   | Use cache only, no network     |
| `--sync-full` | Force a full sync before query |

### Examples

```bash
# Per-PR summary
fw --summary

# Recent comments
fw --type comment --since 24h

# Activity on my PRs
fw --mine

# PRs I need to review
fw --reviews --summary

# Specific PR
fw --pr 123

# Multiple PRs
fw --pr 123,456,789

# Exclude bots
fw --no-bots

# Orphaned comments on closed PRs
fw --orphaned
```

---

## Feedback Command (`fw fb`)

Unified interface for viewing, replying to, and resolving feedback.

### Usage Patterns

```bash
fw fb [options] [id] [body]
```

| Pattern                         | Description                                 |
| ------------------------------- | ------------------------------------------- |
| `fw fb`                         | List all unaddressed feedback (repo-wide)   |
| `fw fb 123`                     | List unaddressed feedback for PR #123       |
| `fw fb 123 --all`               | List all feedback for PR including resolved |
| `fw fb @a7f3c`                  | View comment by short ID                    |
| `fw fb @a7f3c "text"`           | Reply to comment                            |
| `fw fb @a7f3c --resolve`        | Resolve thread (review comments only)       |
| `fw fb @a7f3c "text" --resolve` | Reply and resolve                           |
| `fw fb @a7f3c --ack`            | Acknowledge with thumbs-up                  |
| `fw fb 123 --ack`               | Bulk acknowledge all feedback on PR         |

### Options

| Flag            | Description                                     |
| --------------- | ----------------------------------------------- |
| `--repo <name>` | Repository (owner/repo format)                  |
| `--all`         | Show all feedback including resolved            |
| `--ack`         | Acknowledge feedback (thumbs-up + local record) |
| `--resolve`     | Resolve the thread after replying               |

### Short IDs

Comments have short IDs like `@a7f3c` (5 hex chars prefixed with `@`). These are generated from the full GitHub ID and are stable within a repo.

```bash
# Both work
fw fb @a7f3c
fw fb a7f3c

# Full ID also works
fw fb PRRC_kwDOLK...
```

---

## PR Command (`fw pr`)

GitHub PR operations aligned with `gh` CLI patterns.

### Edit (`fw pr edit`)

```bash
fw pr edit <pr> [options]
```

| Flag                       | Description                  |
| -------------------------- | ---------------------------- |
| `--title <text>`           | Change PR title              |
| `--body <text>`            | Change PR description        |
| `--base <branch>`          | Change base branch           |
| `--milestone <name>`       | Set milestone by name        |
| `--remove-milestone`       | Clear milestone              |
| `--draft`                  | Convert to draft             |
| `--ready`                  | Mark ready for review        |
| `--add-label <name>`       | Add label (repeatable)       |
| `--remove-label <name>`    | Remove label (repeatable)    |
| `--add-reviewer <user>`    | Add reviewer (repeatable)    |
| `--remove-reviewer <user>` | Remove reviewer (repeatable) |
| `--add-assignee <user>`    | Add assignee (repeatable)    |
| `--remove-assignee <user>` | Remove assignee (repeatable) |

**Examples:**

```bash
# Update title
fw pr edit 123 --title "feat: new feature"

# Add labels and reviewers
fw pr edit 123 --add-label bug --add-reviewer alice

# Mark ready for review
fw pr edit 123 --ready

# Convert to draft
fw pr edit 123 --draft
```

### Comment (`fw pr comment`)

```bash
fw pr comment <pr> <body>
```

Add a general comment to a PR (not a review comment).

```bash
fw pr comment 123 "LGTM, merging when CI passes"
```

### Review (`fw pr review`)

```bash
fw pr review <pr> [options]
```

| Flag                    | Description                                |
| ----------------------- | ------------------------------------------ |
| `-a, --approve`         | Approve the PR                             |
| `-r, --request-changes` | Request changes                            |
| `-c, --comment`         | Leave a comment review                     |
| `-b, --body <text>`     | Review body (required for changes/comment) |

**Examples:**

```bash
# Approve
fw pr review 123 --approve

# Approve with comment
fw pr review 123 --approve --body "Looks great!"

# Request changes
fw pr review 123 --request-changes --body "Please fix the type error"

# Comment review (neither approve nor request changes)
fw pr review 123 --comment --body "Some thoughts..."
```

---

## Status Command (`fw status`)

Show Firewatch state information.

```bash
fw status [options]
```

| Flag      | Description    |
| --------- | -------------- |
| `--short` | Compact output |

**Output includes:**

- Version
- Auth status and source
- Config file paths
- Detected repo
- Graphite status
- Cache stats (entries, size, last sync)

---

## Doctor Command (`fw doctor`)

Diagnose Firewatch setup.

```bash
fw doctor [options]
```

| Flag    | Description                         |
| ------- | ----------------------------------- |
| `--fix` | Attempt to fix issues automatically |

**Checks:**

- GitHub API connectivity
- Authentication (gh CLI → env → config)
- Config file validity
- Cache writability
- Repo detection
- Graphite CLI availability

---

## Schema Command (`fw schema`)

Print JSON schema for Firewatch data types.

```bash
fw schema [name]
```

| Name       | Description                         |
| ---------- | ----------------------------------- |
| `entry`    | Individual activity entry (default) |
| `worklist` | Per-PR summary object               |
| `config`   | Configuration file schema           |

---

## Examples Command (`fw examples`)

Show common jq patterns for filtering output.

```bash
fw examples
```

Displays example queries with proper escaping for different shells.

---

## Authentication

Firewatch uses an adaptive auth chain:

1. **gh CLI** (preferred) - Uses `gh auth token` if available
2. **Environment** - `GITHUB_TOKEN` or `GH_TOKEN`
3. **Config file** - `github_token` in config.toml

Check auth status:

```bash
fw doctor
fw status
```

---

## Configuration

Config files use TOML format:

| Path                              | Purpose                   |
| --------------------------------- | ------------------------- |
| `~/.config/firewatch/config.toml` | User config               |
| `.firewatch.toml`                 | Project config (optional) |

View config:

```bash
fw config
fw config user.github_username
fw config --path
```

Set config:

```bash
fw config user.github_username myusername
```

---

## Cache

XDG-compliant cache location:

| Path                              | Contents        |
| --------------------------------- | --------------- |
| `~/.cache/firewatch/firewatch.db` | SQLite database |

Cache management:

```bash
fw cache prune        # Remove stale data
fw cache clear        # Clear all cached data
fw cache clear --repo owner/repo  # Clear specific repo
```

---

## Duration Format

Time durations use this format:

| Format | Meaning  |
| ------ | -------- |
| `Nh`   | N hours  |
| `Nd`   | N days   |
| `Nw`   | N weeks  |
| `Nm`   | N months |

Examples: `24h`, `7d`, `2w`, `3m`
