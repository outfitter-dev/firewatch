# jq Cookbook

Practical jq patterns for working with Firewatch output. All examples assume you're piping from `fw` (entries) or `fw --summary` (per-PR rollups).

## Basics

### Filter by Field Value

```bash
# Only reviews
fw | jq 'select(.type == "review")'

# Only approved reviews
fw --type review | jq 'select(.state == "approved")'

# Reviews requesting changes
fw --type review | jq 'select(.state == "changes_requested")'

# Comments from a specific author
fw --type comment | jq 'select(.author == "alice")'
```

### Select Specific Fields

```bash
# Just PR number and title
fw | jq '{pr, pr_title}'

# Author and body for comments
fw --type comment | jq '{author, body}'

# Useful summary
fw | jq '{repo, pr, type, author, created_at}'
```

### Handle Optional Fields

```bash
# Check if field exists
fw | jq 'select(.graphite != null)'

# Default value for missing field
fw | jq '.graphite.stack_position // 0'

# Filter by optional field
fw --type comment | jq 'select(.file_activity_after.modified == true)'
```

## Filtering

### By Type

```bash
# Comments only
fw | jq 'select(.type == "comment")'

# Reviews only
fw | jq 'select(.type == "review")'

# Commits only
fw | jq 'select(.type == "commit")'

# CI events only
fw | jq 'select(.type == "ci")'

# Review comments (not top-level)
fw | jq 'select(.type == "comment" and .subtype == "review_comment")'
```

### By PR State

```bash
# Open PRs only
fw | jq 'select(.pr_state == "open")'

# Not merged
fw | jq 'select(.pr_state != "merged")'

# Open or draft
fw | jq 'select(.pr_state == "open" or .pr_state == "draft")'
```

### By Author

```bash
# From specific author
fw | jq 'select(.author == "alice")'

# Not from a bot
fw | jq 'select(.author | endswith("[bot]") | not)'

# PR authored by someone else (external feedback)
fw | jq 'select(.author != .pr_author)'

# Exclude common bots using regex
fw | jq 'select(.author | test("dependabot|renovate|github-actions") | not)'
```

### By Time

```bash
# After a specific date
fw | jq 'select(.created_at > "2025-01-01T00:00:00Z")'

# Today only (replace date)
fw | jq 'select(.created_at | startswith("2025-01-14"))'
```

### By File

```bash
# Comments on a specific file
fw --type comment | jq 'select(.file == "src/index.ts")'

# Comments on any TypeScript file
fw --type comment | jq 'select(.file | endswith(".ts"))'

# Comments in a directory
fw --type comment | jq 'select(.file | startswith("src/"))'
```

## Aggregation

### Count by Type

```bash
fw | jq -s 'group_by(.type) | map({type: .[0].type, count: length})'
```

### Count by Author

```bash
fw | jq -s 'group_by(.author) | map({author: .[0].author, count: length}) | sort_by(-.count)'
```

### Count by PR

```bash
fw | jq -s 'group_by(.pr) | map({pr: .[0].pr, pr_title: .[0].pr_title, count: length})'
```

### Review Summary

```bash
fw --type review | jq -s 'group_by(.state) | map({state: .[0].state, count: length})'
```

## Sorting and Limiting

### Sort by Time

```bash
# Most recent first
fw | jq -s 'sort_by(.created_at) | reverse | .[]'

# Oldest first
fw | jq -s 'sort_by(.created_at) | .[]'
```

### Limit Results

```bash
# First 10
fw | jq -s '.[0:10] | .[]'

# Last 5
fw | jq -s '.[-5:] | .[]'
```

### Latest Per PR

```bash
fw | jq -s 'group_by(.pr) | map(sort_by(.created_at) | last)'
```

## Graphite Stacks

### Filter by Stack

```bash
# Only stacked PRs
fw | jq 'select(.graphite != null)'

# Specific stack
fw | jq 'select(.graphite.stack_id == "stack-abc")'

# Bottom of stack (position 1)
fw | jq 'select(.graphite.stack_position == 1)'
```

### Sort by Stack Position (Summary)

```bash
fw --summary | jq -s 'sort_by(.graphite.stack_position // 999) | .[]'
```

### Stack Summary

```bash
fw --summary | jq 'select(.graphite != null) | {pr, pr_title, stack_id: .graphite.stack_id, position: .graphite.stack_position}'
```

## Staleness Analysis

### Find Addressed Comments

```bash
# Comments where file was modified after
fw --type comment | jq 'select(.file_activity_after.modified == true)'
```

### Find Stale Comments

```bash
# Comments with no follow-up activity
fw --type comment | jq 'select(.file_activity_after.modified == false)'
```

### Staleness Report

```bash
fw --type comment | jq '{
  id,
  file,
  body: .body[0:50],
  modified: (.file_activity_after.modified // false),
  commits_after: (.file_activity_after.commits_touching_file // 0)
}'
```

## Summary Patterns

### PRs Needing Attention

```bash
# PRs with changes requested
fw --summary | jq 'select(.review_states.changes_requested > 0)'

# PRs with unresolved comments
fw --summary | jq 'select(.counts.comments > 0)'

# PRs without any reviews
fw --summary | jq 'select(.counts.reviews == 0)'
```

### Activity Summary

```bash
# Total activity by PR
fw --summary | jq '{pr, pr_title, total: (.counts | add)}'
```

### Review Coverage

```bash
# PRs with approved reviews
fw --summary | jq 'select(.review_states.approved > 0) | {pr, pr_title, approved: .review_states.approved}'
```

## Output Formatting

### CSV-like Output

```bash
fw | jq -r '[.pr, .type, .author, .created_at] | @tsv'
```

### Markdown Table

```bash
fw --summary | jq -r '["| \(.pr) | \(.pr_title) | \(.counts.comments) | \(.counts.reviews) |"] | .[]'
```

### URLs Only

```bash
fw | jq -r 'select(.url != null) | .url'
```

### Comment Bodies

```bash
fw --type comment | jq -r '.body'
```

## Advanced Patterns

### Combine Multiple Conditions

```bash
# Unaddressed review comments from non-authors
fw --type comment | jq 'select(
  .subtype == "review_comment" and
  .author != .pr_author and
  (.file_activity_after.modified // false) == false
)'
```

### Cross-Reference PRs

```bash
# Get PR numbers, then query each
fw --summary | jq -r '.pr' | while read pr; do
  fw --prs "$pr" --type review
done
```

### Daily Digest

```bash
fw --since 24h | jq -s '
  group_by(.type) |
  map({type: .[0].type, count: length, authors: [.[].author] | unique}) |
  sort_by(-.count)
'
```

### Review Queue

```bash
fw --summary --active | jq -s '
  map(select(.review_states.approved == 0)) |
  sort_by(.last_activity_at) |
  reverse |
  .[0:5]
'
```

## Piping to Other Tools

### Copy URLs to Clipboard (macOS)

```bash
fw --type review | jq -r '.url' | pbcopy
```

### Open in Browser

```bash
fw --limit 1 | jq -r '.url' | xargs open
```

### Feed to Another Tool

```bash
# Extract PR numbers for gh CLI
fw --summary --active | jq -r '.pr' | xargs -I {} gh pr view {}
```

## Tips

1. **Use `-s` for aggregation** - Slurp mode collects all lines into an array
2. **Use `-r` for raw output** - Removes quotes from string output
3. **Combine with CLI filters** - Let Firewatch filter first, then refine with jq
4. **Check optional fields** - Use `// default` for missing values
5. **Test incrementally** - Build complex queries step by step

## See Also

- [Schema Reference](./schema.md) - All available fields
- [Commands](./commands/README.md) - CLI filtering options
- [jq Manual](https://stedolan.github.io/jq/manual/) - Full jq documentation
