---
name: query-operations
focus: Read-only query commands, filtering, output formats
estimated-tests: 25
---

# Query Operations Runbook

Tests the core query functionality of the Firewatch CLI.

## Setup

Ensure cache has data:
```bash
bun apps/cli/bin/fw.ts sync outfitter-dev/firewatch
```

## Test Cases

### Basic Output

#### JSON Output (Default)
**Command**: `bun apps/cli/bin/fw.ts query --limit 3`
**Expected**: Valid JSONL, 3 lines max
**Validates**: Default output format works

#### Worklist Mode
**Command**: `bun apps/cli/bin/fw.ts query --worklist --limit 3`
**Expected**: Valid JSON array with PR summaries
**Validates**: Worklist aggregation works

#### JSONL Validity
**Command**: `bun apps/cli/bin/fw.ts query --limit 5 | jq -c .`
**Expected**: Each line parses as valid JSON
**Validates**: Output is proper JSONL

### Type Filtering

#### Filter by Comment
**Command**: `bun apps/cli/bin/fw.ts query --type comment --limit 3`
**Expected**: All entries have `"type": "comment"`
**Validates**: Type filter works

#### Filter by Review
**Command**: `bun apps/cli/bin/fw.ts query --type review --limit 3`
**Expected**: All entries have `"type": "review"`
**Validates**: Review type filter

#### Filter by Commit
**Command**: `bun apps/cli/bin/fw.ts query --type commit --limit 3`
**Expected**: All entries have `"type": "commit"`
**Validates**: Commit type filter

#### Invalid Type
**Command**: `bun apps/cli/bin/fw.ts query --type invalid`
**Expected**: Error message, non-zero exit code
**Validates**: Invalid type handling

#### Multiple Types
**Command**: `bun apps/cli/bin/fw.ts query --type comment,review --limit 5`
**Expected**: Entries with type "comment" OR "review"
**Validates**: Multi-type filter (if supported)

### Time Filtering

#### Since Hours
**Command**: `bun apps/cli/bin/fw.ts query --since 24h --limit 5`
**Expected**: All entries from last 24 hours
**Validates**: Hour duration parsing

#### Since Days
**Command**: `bun apps/cli/bin/fw.ts query --since 7d --limit 5`
**Expected**: All entries from last 7 days
**Validates**: Day duration parsing

#### Since Weeks
**Command**: `bun apps/cli/bin/fw.ts query --since 2w --limit 5`
**Expected**: All entries from last 2 weeks
**Validates**: Week duration parsing

#### Invalid Duration
**Command**: `bun apps/cli/bin/fw.ts query --since invalid`
**Expected**: Error message about invalid duration
**Validates**: Duration validation

### Author Filtering

#### Include Author
**Command**: `bun apps/cli/bin/fw.ts query --author galligan --limit 5`
**Expected**: All entries by "galligan"
**Validates**: Author inclusion filter

#### Exclude Author
**Command**: `bun apps/cli/bin/fw.ts query --author '!dependabot' --limit 5`
**Expected**: No entries by "dependabot"
**Validates**: Author exclusion pattern

#### No Bots
**Command**: `bun apps/cli/bin/fw.ts query --no-bots --limit 5`
**Expected**: No bot authors in results
**Validates**: Bot filtering

### PR Filtering

#### Single PR
**Command**: `bun apps/cli/bin/fw.ts query --prs 1 --limit 5`
**Expected**: All entries for PR #1 (or empty if no such PR)
**Validates**: PR number filter

#### PR State Open
**Command**: `bun apps/cli/bin/fw.ts query --open --limit 5`
**Expected**: All entries from open PRs
**Validates**: Open state filter

#### PR State Active
**Command**: `bun apps/cli/bin/fw.ts query --active --limit 5`
**Expected**: Entries from open or draft PRs
**Validates**: Active state filter

### Combined Filters

#### Type + Time
**Command**: `bun apps/cli/bin/fw.ts query --type review --since 7d --limit 5`
**Expected**: Reviews from last 7 days only
**Validates**: Filter combination (AND logic)

#### Type + Author + Time
**Command**: `bun apps/cli/bin/fw.ts query --type comment --author galligan --since 30d --limit 5`
**Expected**: Comments by galligan in last 30 days
**Validates**: Multiple filter combination

#### All Filters
**Command**: `bun apps/cli/bin/fw.ts query --type review --author galligan --since 30d --open --limit 5`
**Expected**: Reviews by galligan on open PRs in last 30 days
**Validates**: Full filter stack

### Limit and Output

#### Limit Works
**Command**: `bun apps/cli/bin/fw.ts query --limit 3 | wc -l`
**Expected**: Exactly 3 lines (or fewer if cache has less)
**Validates**: Limit enforcement

#### Large Limit
**Command**: `bun apps/cli/bin/fw.ts query --limit 1000`
**Expected**: Up to 1000 entries, no crash
**Validates**: Large limit handling

#### Zero Limit
**Command**: `bun apps/cli/bin/fw.ts query --limit 0`
**Expected**: No output or error
**Validates**: Zero limit behavior
