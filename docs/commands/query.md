# fw query

Filter and output cached PR activity as JSONL.

## Synopsis

```bash
fw query [options]
```

## Description

The `query` command filters cached activity entries and outputs them as JSONL to stdout. This is the primary way to extract specific data for jq processing.

## Options

| Option | Description |
|--------|-------------|
| `--repo <name>` | Filter by repository (partial match) |
| `--all` | Query across all cached repositories |
| `--pr <number>` | Filter by PR number |
| `--author <name>` | Filter by author |
| `--type <type>` | Filter by type (`comment`, `review`, `commit`, `ci`, `event`) |
| `--state <states>` | Filter by PR state (comma-separated: `open`, `closed`, `merged`, `draft`) |
| `--open` | Shorthand for `--state open` |
| `--draft` | Shorthand for `--state draft` |
| `--active` | Shorthand for `--state open,draft` |
| `--label <name>` | Filter by PR label (partial match) |
| `--since <duration>` | Filter by time (e.g., `24h`, `7d`, `1w`) |
| `--limit <count>` | Limit number of results |
| `--offset <count>` | Skip first N results |
| `--stack` | Show entries grouped by Graphite stack |
| `--worklist` | Aggregate entries into per-PR worklist |
| `--json` | Output JSONL (default) |

## Examples

```bash
# All entries from current repo
fw query

# Entries from the last 24 hours
fw query --since 24h

# Reviews only
fw query --type review

# Reviews with changes requested
fw query --type review | jq 'select(.state == "changes_requested")'

# From a specific author
fw query --author galligan

# For a specific PR
fw query --pr 42

# Open PRs only
fw query --open

# Open or draft PRs
fw query --active

# PRs with a specific label
fw query --label bug

# Combine filters
fw query --type review --author galligan --since 7d --active

# Aggregate into worklist
fw query --worklist

# With Graphite stack grouping
fw query --stack

# Query all cached repos
fw query --all --since 24h

# Pagination
fw query --limit 10 --offset 20
```

## Output Modes

### Default (JSONL entries)

Each line is a complete `FirewatchEntry`:

```json
{"id":"comment-123","repo":"org/repo","pr":42,"type":"comment","author":"alice","body":"LGTM","created_at":"2025-01-14T10:00:00Z",...}
```

### Worklist (`--worklist`)

Aggregated per-PR summaries:

```json
{"repo":"org/repo","pr":42,"pr_title":"Add feature","pr_state":"open","counts":{"comments":3,"reviews":1,"commits":2,"ci":0,"events":0},...}
```

### Stack (`--stack`)

Entries grouped by Graphite stack, with stack metadata visible:

```json
{"id":"comment-123",...,"graphite":{"stack_id":"stack-abc","stack_position":1,"stack_size":3}}
```

## Time Duration Format

The `--since` option accepts:

| Format | Meaning |
|--------|---------|
| `24h` | 24 hours ago |
| `7d` | 7 days ago |
| `1w` | 1 week ago |
| `30d` | 30 days ago |

## Filter Logic

- Multiple filters are combined with AND logic
- `--state` accepts comma-separated values (OR within states)
- Partial string matching for `--repo` and `--label`
- Exact matching for `--pr`, `--author`, `--type`

## Configuration Defaults

Query respects these config options:

- `default_since` - Default time filter
- `default_states` - Default PR states
- `default_stack` - Default to stack grouping

## See Also

- [fw status](./status.md) - Summarized view
- [jq Cookbook](../jq-cookbook.md) - Query patterns
- [Schema Reference](../schema.md) - Field documentation
