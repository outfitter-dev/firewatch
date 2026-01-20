# jq Cookbook for Agents

This reference provides jq patterns optimized for agent workflows. For the complete cookbook, see [docs/jq-cookbook.md](../../../../docs/jq-cookbook.md).

## Core Patterns

### Slurp Mode (-s)

Use `-s` whenever you need to aggregate, group, or sort across multiple entries:

```bash
# Without -s: processes each line independently (streaming)
fw query | jq 'select(.type == "review")'

# With -s: loads all entries into array for aggregation
fw query | jq -s 'group_by(.type) | map({type: .[0].type, count: length})'
```

### Raw Output (-r)

Use `-r` when you need values without JSON quoting:

```bash
# For piping to other commands
fw status | jq -r '.pr' | xargs -I {} gh pr view {}

# For clipboard
fw query | jq -r '.url' | pbcopy
```

### Optional Field Safety

Always guard optional fields with `// default`:

```bash
# These fields are optional
.graphite.stack_position // 0
.file_activity_after.modified // false
.body // "(no body)"
```

## Agent-Focused Patterns

### Find Unaddressed Review Comments

Critical for implementing feedback:

```bash
fw query --type comment | jq 'select(
  .subtype == "review_comment" and
  .author != .pr_author and
  (.file_activity_after.modified // false) == false
)'
```

### Get Comment IDs for Resolution

Extract IDs to use with `fw resolve`:

```bash
fw query --type comment --pr 123 | jq -r '.id'
```

### Group Feedback by File

Useful when addressing review comments systematically:

```bash
fw query --type comment --pr 123 | jq -s '
  group_by(.file) |
  map({
    file: .[0].file,
    comments: length,
    lines: [.[].line] | sort
  })
'
```

### Find PRs Needing Attention

```bash
# Changes requested but no recent commits
fw status | jq 'select(
  .review_states.changes_requested > 0 and
  .counts.commits == 0
)'

# No reviews yet
fw status | jq 'select(.counts.reviews == 0)'
```

### Stack-Aware Queries

For Graphite stacked PRs:

```bash
# Base of stack (address first)
fw status | jq 'select(.graphite.stack_position == 1)'

# Entries sorted by stack position
fw query --stack | jq -s 'sort_by(.graphite.stack_position // 999) | .[]'

# PRs above a given PR in stack
fw query | jq 'select(.graphite.stack_position > 2)'
```

### Activity Summary for Reporting

```bash
fw query --since 24h | jq -s '
  {
    total: length,
    by_type: (group_by(.type) | map({type: .[0].type, count: length})),
    unique_prs: ([.[].pr] | unique | length),
    authors: ([.[].author] | unique)
  }
'
```

## Efficiency Guidelines

1. **CLI filters first** — Let firewatch filter before jq: `fw query --type review --since 24h | jq ...`
2. **Avoid unnecessary slurp** — Only use `-s` when aggregating
3. **Limit early** — Use `--limit` at CLI level when possible
4. **Chain selects** — Multiple `select()` calls are fine: `select(.type == "review") | select(.state == "approved")`

## Output for Actions

### For `fw resolve`

```bash
# Get IDs to resolve
fw query --type comment --pr 123 | jq -r 'select(.subtype == "review_comment") | .id'

# Use directly
fw resolve $(fw query --type comment --pr 123 | jq -r '.id' | head -5)
```

### For `fw comment`

```bash
# Get thread ID to reply to
fw query --type comment --pr 123 | jq -r 'select(.file == "src/index.ts") | .id' | head -1
```

### For External Tools

```bash
# PR numbers for gh
fw status --active | jq -r '.pr'

# URLs for browser
fw query | jq -r '.url' | head -1 | xargs open
```

## See Also

- [docs/jq-cookbook.md](../../../../docs/jq-cookbook.md) — Complete pattern reference
- [jq manual](https://stedolan.github.io/jq/manual/) — Official documentation
