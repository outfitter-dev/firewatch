# Common jq Patterns for Firewatch

Firewatch outputs JSONL (one JSON object per line). Pipe to `jq` for filtering, transformation, and aggregation.

## Basics

### Reading JSONL

```bash
# Parse each line as JSON (slurp into array)
fw query | jq -s '.'

# Process line by line (streaming, memory efficient)
fw query | jq -c '.'

# Pretty print each entry
fw query | jq '.'
```

### Selecting Fields

```bash
# Single field
fw query | jq '.type'

# Multiple fields as object
fw query | jq '{type, author: .author.login, pr: .pr.number}'

# Nested field access
fw query | jq '.pr.title'
```

### Basic Filtering

```bash
# Exact match
fw query | jq 'select(.type == "review")'

# Not equal
fw query | jq 'select(.type != "comment")'

# Contains text (case sensitive)
fw query | jq 'select(.body | contains("LGTM"))'

# Contains text (case insensitive)
fw query | jq 'select(.body | ascii_downcase | contains("lgtm"))'

# Regex match
fw query | jq 'select(.body | test("fix(es)?"; "i"))'
```

## Time-based Filtering

### Using Unix Timestamps

```bash
# Entries from the last 24 hours
fw query | jq 'select(.timestamp > (now - 86400))'

# Entries from the last 7 days
fw query | jq 'select(.timestamp > (now - 604800))'

# Entries from the last hour
fw query | jq 'select(.timestamp > (now - 3600))'
```

### Date Comparisons

```bash
# Entries after a specific date
fw query | jq 'select(.timestamp > ("2024-01-15T00:00:00Z" | fromdate))'

# Entries between two dates
fw query | jq 'select(
  .timestamp > ("2024-01-01T00:00:00Z" | fromdate) and
  .timestamp < ("2024-01-31T23:59:59Z" | fromdate)
)'
```

### Stale Detection

```bash
# Entries older than 48 hours (stale)
fw query | jq 'select(.timestamp < (now - 172800))'

# Reviews pending longer than 24 hours
fw query | jq 'select(
  .type == "review_request" and
  .timestamp < (now - 86400)
)'
```

### Formatting Timestamps

```bash
# Add human-readable date
fw query | jq '. + {date: (.timestamp | todate)}'

# Show relative age in hours
fw query | jq '. + {hours_ago: ((now - .timestamp) / 3600 | floor)}'
```

## Type Filtering

### By Entry Type

```bash
# Reviews only
fw query | jq 'select(.type == "review")'

# Comments only
fw query | jq 'select(.type == "comment")'

# Review requests
fw query | jq 'select(.type == "review_request")'

# Multiple types
fw query | jq 'select(.type == "review" or .type == "comment")'

# Using array membership
fw query | jq 'select(.type | IN("review", "comment", "review_request"))'
```

### By Subtype

```bash
# Review comments (inline code comments)
fw query | jq 'select(.subtype == "review_comment")'

# Issue comments (PR conversation)
fw query | jq 'select(.subtype == "issue_comment")'

# PR description changes
fw query | jq 'select(.subtype == "description")'
```

## Author Filtering

### Include/Exclude Authors

```bash
# From specific author
fw query | jq 'select(.author.login == "octocat")'

# Exclude specific author
fw query | jq 'select(.author.login != "dependabot[bot]")'

# Multiple authors
fw query | jq 'select(.author.login | IN("alice", "bob", "charlie"))'

# Exclude multiple authors
fw query | jq 'select(.author.login | IN("dependabot[bot]", "renovate[bot]") | not)'
```

### Bot Detection

```bash
# Exclude all bots (common pattern)
fw query | jq 'select(.author.login | endswith("[bot]") | not)'

# Include only bots
fw query | jq 'select(.author.login | endswith("[bot]"))'

# Exclude known CI/automation accounts
fw query | jq 'select(.author.login | IN(
  "dependabot[bot]",
  "renovate[bot]",
  "github-actions[bot]",
  "codecov[bot]"
) | not)'
```

### Self-authored Filtering

```bash
# Exclude your own activity (replace with your username)
fw query | jq 'select(.author.login != "your-username")'

# Only your activity
fw query | jq 'select(.author.login == "your-username")'
```

## PR State Filtering

### Open/Closed/Merged

```bash
# Only open PRs
fw query | jq 'select(.pr.state == "OPEN")'

# Only merged PRs
fw query | jq 'select(.pr.merged == true)'

# Closed but not merged (abandoned)
fw query | jq 'select(.pr.state == "CLOSED" and .pr.merged == false)'
```

### Draft PRs

```bash
# Exclude drafts
fw query | jq 'select(.pr.draft == false)'

# Only drafts
fw query | jq 'select(.pr.draft == true)'

# Ready for review (open and not draft)
fw query | jq 'select(.pr.state == "OPEN" and .pr.draft == false)'
```

### By PR Number

```bash
# Specific PR
fw query | jq 'select(.pr.number == 42)'

# Multiple PRs
fw query | jq 'select(.pr.number | IN(42, 43, 44))'

# PR range
fw query | jq 'select(.pr.number >= 100 and .pr.number <= 150)'
```

## Aggregation

### Counting

```bash
# Total entries
fw query | jq -s 'length'

# Count by type
fw query | jq -s 'group_by(.type) | map({type: .[0].type, count: length})'

# Count by author
fw query | jq -s 'group_by(.author.login) | map({author: .[0].author.login, count: length}) | sort_by(-.count)'
```

### Grouping by PR

```bash
# Group all entries by PR
fw query | jq -s 'group_by(.pr.number) | map({
  pr: .[0].pr.number,
  title: .[0].pr.title,
  entries: length
})'

# PRs with most activity
fw query | jq -s 'group_by(.pr.number) | map({
  pr: .[0].pr.number,
  count: length
}) | sort_by(-.count) | .[0:10]'
```

### Unique Values

```bash
# Unique authors
fw query | jq -s '[.[].author.login] | unique'

# Unique PRs
fw query | jq -s '[.[].pr.number] | unique | sort'

# Unique types
fw query | jq -s '[.[].type] | unique'
```

## Review State Queries

### Changes Requested

```bash
# PRs with changes requested
fw query | jq 'select(.type == "review" and .state == "CHANGES_REQUESTED")'

# Count changes requested per PR
fw query | jq -s '[.[] | select(.type == "review" and .state == "CHANGES_REQUESTED")] |
  group_by(.pr.number) | map({pr: .[0].pr.number, requests: length})'
```

### Approved Reviews

```bash
# Approved reviews
fw query | jq 'select(.type == "review" and .state == "APPROVED")'

# PRs with at least one approval
fw query | jq -s '[.[] | select(.type == "review" and .state == "APPROVED")] |
  [.[].pr.number] | unique'
```

### Pending Reviews

```bash
# Pending review requests (no response yet)
fw query | jq 'select(.type == "review_request")'

# Review requests older than 24 hours
fw query | jq 'select(
  .type == "review_request" and
  .timestamp < (now - 86400)
)'
```

### Review Summary per PR

```bash
# Review state summary by PR
fw query | jq -s '
  [.[] | select(.type == "review")] |
  group_by(.pr.number) |
  map({
    pr: .[0].pr.number,
    approved: [.[] | select(.state == "APPROVED")] | length,
    changes_requested: [.[] | select(.state == "CHANGES_REQUESTED")] | length,
    commented: [.[] | select(.state == "COMMENTED")] | length
  })'
```

## Graphite Stack Queries

### Stack Position

```bash
# Entries with stack metadata
fw query | jq 'select(.graphite != null)'

# Bottom of stack (ready to merge)
fw query | jq 'select(.graphite.stackPosition == 1)'

# Top of stack
fw query | jq 'select(.graphite.isTopOfStack == true)'
```

### Blocked Stacks

```bash
# PRs blocked by parent
fw query | jq 'select(.graphite.parentPr != null and .graphite.parentPr.state == "OPEN")'

# Find blocking parents
fw query | jq -s '[.[] | select(.graphite.parentPr != null)] |
  group_by(.graphite.parentPr.number) |
  map({
    blocking_pr: .[0].graphite.parentPr.number,
    blocked_count: length
  }) | sort_by(-.blocked_count)'
```

### Stack Traversal

```bash
# All PRs in a specific stack (by any PR number in stack)
fw query | jq -s --arg pr "42" '
  [.[] | select(.graphite.stackId != null)] |
  (.[0] | select(.pr.number == ($pr | tonumber)).graphite.stackId) as $stackId |
  [.[] | select(.graphite.stackId == $stackId)]'
```

## Null-safe Patterns

### Handling Optional Fields

```bash
# Safe field access with default
fw query | jq '.graphite.stackPosition // 0'

# Check field exists before using
fw query | jq 'select(.graphite != null) | .graphite.stackPosition'

# Provide default object
fw query | jq '.graphite // {stackPosition: null, isTopOfStack: false}'
```

### Conditional Selection

```bash
# Select if field exists and matches
fw query | jq 'select((.state // "") == "APPROVED")'

# Select if nested field exists
fw query | jq 'select(.graphite.parentPr.number != null)'

# Filter out entries missing required field
fw query | jq 'select(.body != null and .body != "")'
```

### Safe Array Operations

```bash
# Handle potentially null arrays
fw query | jq '(.labels // []) | length'

# Filter with null-safe contains
fw query | jq 'select((.labels // []) | any(. == "bug"))'
```

## Output Formatting

### Compact Output

```bash
# Single line per entry (default JSONL)
fw query | jq -c '.'

# Minimal fields, compact
fw query | jq -c '{type, pr: .pr.number, author: .author.login}'
```

### TSV Output

```bash
# Tab-separated values
fw query | jq -r '[.type, .pr.number, .author.login] | @tsv'

# With headers
(echo -e "type\tpr\tauthor"; fw query | jq -r '[.type, .pr.number, .author.login] | @tsv')
```

### CSV Output

```bash
# Comma-separated values
fw query | jq -r '[.type, .pr.number, .author.login] | @csv'
```

### Custom Formats

```bash
# Human-readable summary
fw query | jq -r '"\(.type) on PR #\(.pr.number) by \(.author.login)"'

# Markdown list
fw query | jq -r '"- [\(.pr.title)](https://github.com/\(.pr.repo)/pull/\(.pr.number))"'

# Slack-style formatting
fw query | jq -r '"*\(.type)* on <https://github.com/\(.pr.repo)/pull/\(.pr.number)|#\(.pr.number)> by `\(.author.login)`"'
```

### Table Output

```bash
# Simple table with column
fw query | jq -r '"\(.type | .[0:10])\t\(.pr.number)\t\(.author.login)"' | column -t

# Formatted table with printf
fw query | jq -r '@sh "printf \"%-12s %4d %-20s\n\" \(.type) \(.pr.number) \(.author.login)"' | sh
```

## Combined Patterns

### Actionable Items

```bash
# Reviews needing attention (not from bots, open PRs, last 7 days)
fw query | jq 'select(
  .type == "review" and
  .pr.state == "OPEN" and
  (.author.login | endswith("[bot]") | not) and
  .timestamp > (now - 604800)
)'
```

### Daily Digest

```bash
# Activity summary for the last 24 hours
fw query | jq -s '
  [.[] | select(.timestamp > (now - 86400))] |
  {
    total: length,
    by_type: (group_by(.type) | map({type: .[0].type, count: length})),
    by_author: (group_by(.author.login) | map({author: .[0].author.login, count: length}) | sort_by(-.count) | .[0:5]),
    prs_touched: ([.[].pr.number] | unique | length)
  }'
```

### Stale Review Detection

```bash
# Open PRs with no activity in 48+ hours
fw query | jq -s '
  [.[] | select(.pr.state == "OPEN")] |
  group_by(.pr.number) |
  map(max_by(.timestamp)) |
  [.[] | select(.timestamp < (now - 172800))] |
  map({pr: .pr.number, title: .pr.title, last_activity: (.timestamp | todate)})'
```
