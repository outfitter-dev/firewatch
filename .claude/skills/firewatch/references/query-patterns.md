# Query Patterns Reference

Common jq filters and query combinations for Firewatch.

## CLI Filters vs jq

**Rule:** Use CLI filters first, then jq. CLI filters are faster because they skip JSON parsing for non-matching entries.

```bash
# Good: CLI narrows first
fw --type review --since 24h | jq 'select(.state == "approved")'

# Less efficient: jq does all the work
fw | jq 'select(.type == "review" and .state == "approved")'
```

## jq Modes

### Streaming Mode (default)

Process each entry independently:
```bash
fw | jq 'select(.type == "review")'
```

### Slurp Mode (-s)

Load all entries into array for aggregation:
```bash
fw | jq -s 'group_by(.type) | map({type: .[0].type, count: length})'
```

### Raw Output (-r)

Output without JSON quoting (for piping):
```bash
fw | jq -r '.id'
```

## Filtering Patterns

### By Entry Type

```bash
# Single type
fw --type comment

# Multiple types (jq)
fw | jq 'select(.type == "comment" or .type == "review")'
```

### By Subtype

```bash
# Review comments only (inline code feedback)
fw --type comment | jq 'select(.subtype == "review_comment")'

# Issue comments only (general PR comments)
fw --type comment | jq 'select(.subtype == "issue_comment")'
```

### By Author Relationship

```bash
# External feedback (not self-comments)
fw --type comment | jq 'select(.author != .pr_author)'

# Self-comments only
fw --type comment | jq 'select(.author == .pr_author)'
```

### By Review State

```bash
# Approved reviews
fw --type review | jq 'select(.state == "approved")'

# Changes requested
fw --type review | jq 'select(.state == "changes_requested")'
```

### By Staleness

```bash
# Unaddressed comments (file not modified)
fw --type comment | jq 'select(
  (.file_activity_after.modified // false) == false
)'

# Addressed comments (file was modified)
fw --type comment | jq 'select(
  .file_activity_after.modified == true
)'
```

### By Stack Position

```bash
# Base of stack
fw | jq 'select(.graphite.stack_position == 1)'

# Top of stack
fw | jq -s 'group_by(.graphite.stack_id) | map(max_by(.graphite.stack_position)) | .[]'

# Specific position
fw | jq 'select(.graphite.stack_position == 3)'
```

### By File

```bash
# Specific file
fw | jq 'select(.file == "src/auth.ts")'

# File pattern
fw | jq 'select(.file | test("^src/"))'

# Multiple files
fw | jq 'select(.file == "a.ts" or .file == "b.ts")'
```

### By Content

```bash
# Comments mentioning "TODO"
fw --type comment | jq 'select(.body | test("TODO"; "i"))'

# Bug-related comments
fw --type comment | jq 'select(.body | test("bug|issue|error"; "i"))'
```

## Aggregation Patterns

### Count by Type

```bash
fw | jq -s 'group_by(.type) | map({type: .[0].type, count: length})'
```

### Count by PR

```bash
fw | jq -s 'group_by(.pr) | map({pr: .[0].pr, count: length}) | sort_by(-.count)'
```

### Count by Author

```bash
fw | jq -s 'group_by(.author) | map({author: .[0].author, count: length}) | sort_by(-.count)'
```

### Group Comments by File

```bash
fw --type comment | jq -s '
  group_by(.file) |
  map({
    file: .[0].file,
    count: length,
    lines: [.[].line] | sort
  })
'
```

### Summary Statistics

```bash
fw --since 24h | jq -s '{
  total: length,
  by_type: (group_by(.type) | map({type: .[0].type, count: length})),
  unique_prs: ([.[].pr] | unique | length),
  unique_authors: ([.[].author] | unique | length)
}'
```

## Extraction Patterns

### Get IDs for Resolution

```bash
fw --type comment --prs 42 | jq -r '.id'
```

### Get URLs

```bash
fw --type comment | jq -r '.url'
```

### Get PR Numbers

```bash
fw | jq -r '.pr' | sort -u
```

### Compact Comment View

```bash
fw --type comment | jq '{
  pr,
  file,
  line,
  author,
  body: .body[0:60],
  id
}'
```

## Optional Field Safety

Always guard optional fields with `// default`:

```bash
# Stack position (defaults to 0 for non-stack PRs)
.graphite.stack_position // 0

# File activity (defaults to false)
.file_activity_after.modified // false

# Body (defaults to empty string)
.body // ""

# Labels (defaults to empty array)
.pr_labels // []
```

### Check for Presence

```bash
# Only entries with Graphite metadata
fw | jq 'select(.graphite != null)'

# Only entries with file provenance
fw | jq 'select(.file_provenance != null)'

# Only comments with file location
fw --type comment | jq 'select(.file != null)'
```

## Combining with fw Commands

### Feed IDs to fw close

```bash
fw --type comment --prs 42 | jq -r '
  select(.subtype == "review_comment") | .id
' | xargs fw close
```

### Get PR for gh Commands

```bash
fw --summary --active | jq -r '.pr' | xargs -I {} gh pr view {}
```

### Open URLs in Browser

```bash
fw --type comment | jq -r '.url' | head -1 | xargs open
```

## Performance Tips

1. **CLI filters first** -- `--type`, `--since`, `--prs` are faster than jq equivalents
2. **Avoid unnecessary slurp** -- Only use `-s` when aggregating
3. **Use `--limit`** -- When you only need a few results
4. **Chain selects** -- Multiple `select()` is fine and readable

## Common Workflows

### Find Unaddressed Review Comments

```bash
fw --type comment --open | jq 'select(
  .subtype == "review_comment" and
  .author != .pr_author and
  (.file_activity_after.modified // false) == false
)'
```

### PRs Needing Attention

```bash
fw --summary | jq 'select(
  .review_states.changes_requested > 0 or
  .counts.reviews == 0
)'
```

### Stack Feedback Summary

```bash
fw --type comment --prs 101,102,103 | jq -s '{
  total: length,
  by_pr: (group_by(.pr) | map({
    pr: .[0].pr,
    position: .[0].graphite.stack_position,
    count: length
  }) | sort_by(.position)),
  cross_pr: [.[] | select(.file_provenance.origin_pr != .pr)] | length
}'
```
