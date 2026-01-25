---
name: edge-cases
focus: Error handling, boundary conditions, invalid inputs
estimated-tests: 20
---

# Edge Cases Runbook

Tests error handling and boundary conditions across the CLI.

## Setup

No special setup required. Tests validate error handling.

## Test Cases

### Missing Required Arguments

#### Query Without Repo (Outside Git Dir)

**Command**: `cd /tmp && bun /path/to/fw.ts`
**Expected**: Error about repo detection, suggests specifying --repo
**Validates**: Graceful handling when no repo context

#### Refresh Without Repo

**Command**: `cd /tmp && bun /path/to/fw.ts --refresh`
**Expected**: Error about repo detection
**Validates**: Refresh requires repo context

### Invalid Repo Formats

#### Single Word (No Slash)

**Command**: `bun apps/cli/bin/fw.ts --repo firewatch`
**Expected**: Error about invalid repo format (needs owner/repo)
**Validates**: Repo slug validation

#### Too Many Slashes

**Command**: `bun apps/cli/bin/fw.ts --repo a/b/c`
**Expected**: Error about invalid repo format
**Validates**: Repo slug validation

#### Empty String

**Command**: `bun apps/cli/bin/fw.ts --repo ""`
**Expected**: Error or help text
**Validates**: Empty arg handling

### Invalid Duration Formats

#### Plain Number

**Command**: `bun apps/cli/bin/fw.ts --since 24`
**Expected**: Error about invalid duration (needs unit)
**Validates**: Duration requires unit

#### Invalid Unit

**Command**: `bun apps/cli/bin/fw.ts --since 24x`
**Expected**: Error about invalid duration unit
**Validates**: Unit validation

#### Negative Duration

**Command**: `bun apps/cli/bin/fw.ts --since -7d`
**Expected**: Error or treated as invalid
**Validates**: Negative handling

### Conflicting Flags

#### Draft and Ready Together

**Command**: `bun apps/cli/bin/fw.ts pr edit 1 --draft --ready`
**Expected**: Error about conflicting options
**Validates**: Mutual exclusion enforcement

#### Open and Closed Together

**Command**: `bun apps/cli/bin/fw.ts --open --closed`
**Expected**: Both filters apply (returns open OR closed)
**Validates**: State filter combination

### Empty Results

#### Impossible Filter

**Command**: `bun apps/cli/bin/fw.ts --author nonexistent-user-xyz --limit 5`
**Expected**: Empty output (no error), exit code 0
**Validates**: No results is not an error

#### Future Date

**Command**: `bun apps/cli/bin/fw.ts --before 2099-01-01 --since 2099-01-01`
**Expected**: Empty results
**Validates**: Impossible date range handling

### Special Characters

#### Author with Hyphen

**Command**: `bun apps/cli/bin/fw.ts --author some-user --limit 3`
**Expected**: Works correctly
**Validates**: Hyphen in names

#### Author with Underscore

**Command**: `bun apps/cli/bin/fw.ts --author some_user --limit 3`
**Expected**: Works correctly
**Validates**: Underscore in names

#### Path with Spaces

**Command**: `bun apps/cli/bin/fw.ts config --path`
**Expected**: Path output (may have spaces on some systems)
**Validates**: Path handling

### Exit Codes

#### Success Exit Code

**Command**: `bun apps/cli/bin/fw.ts --limit 1; echo "Exit: $?"`
**Expected**: Exit code 0
**Validates**: Success returns 0

#### Error Exit Code

**Command**: `bun apps/cli/bin/fw.ts --type invalid; echo "Exit: $?"`
**Expected**: Exit code non-zero (1)
**Validates**: Errors return non-zero

#### Help Exit Code

**Command**: `bun apps/cli/bin/fw.ts --help; echo "Exit: $?"`
**Expected**: Exit code 0 (help is not an error)
**Validates**: Help returns 0

### Large Numbers

#### Large Limit

**Command**: `bun apps/cli/bin/fw.ts --limit 999999`
**Expected**: Works without overflow (returns available entries)
**Validates**: Large number handling

#### Large PR Number

**Command**: `bun apps/cli/bin/fw.ts --pr 999999`
**Expected**: Empty results (no such PR), not crash
**Validates**: Large PR number handling

#### Negative Limit

**Command**: `bun apps/cli/bin/fw.ts --limit -5`
**Expected**: Error or treated as invalid
**Validates**: Negative limit handling

### Unknown Flags

#### Typo in Flag

**Command**: `bun apps/cli/bin/fw.ts --limt 5`
**Expected**: Error about unknown option, possibly with suggestion
**Validates**: Unknown flag detection

#### Wrong Prefix

**Command**: `bun apps/cli/bin/fw.ts -limit 5`
**Expected**: Error or interpreted as short flags
**Validates**: Flag prefix handling

### Output Mode Edge Cases

#### Both JSONL Flags

**Command**: `bun apps/cli/bin/fw.ts --jsonl --no-jsonl`
**Expected**: Last flag wins or error
**Validates**: Conflicting output mode

#### Force Human in Pipe

**Command**: `bun apps/cli/bin/fw.ts --no-jsonl | head -5`
**Expected**: Human-readable output even when piped
**Validates**: Output mode override

### Refresh Edge Cases

#### Full Refresh

**Command**: `bun apps/cli/bin/fw.ts --refresh full --limit 1`
**Expected**: Forces full sync, returns data
**Validates**: Full refresh mode

#### Refresh Value Typo

**Command**: `bun apps/cli/bin/fw.ts --refresh invalid`
**Expected**: Error or treated as regular refresh
**Validates**: Refresh value validation
