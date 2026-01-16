---
description: Show firewatch usage and available commands
allowed-tools: Bash(fw *)
---

# Firewatch Help

## CLI Usage

!`fw --help 2>&1`

## Available Plugin Commands

- `/firewatch:status` - Show PR activity summary
- `/firewatch:sync` - Force a refresh before querying
- `/firewatch:reviews` - Show pending reviews needing attention
- `/firewatch:help` - This help message

## jq Integration

Firewatch outputs JSONL for easy jq composition:

```bash
# Get all review comments from last 24h
fw --type review --since 24h | jq '.body'

# Find PRs with changes requested
fw --summary | jq 'select(.review_states.changes_requested > 0)'

# Group activity by author
fw --since 7d | jq -s 'group_by(.author) | map({author: .[0].author, count: length})'
```

Use `fw schema` to see all available fields.
