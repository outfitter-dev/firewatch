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

**Command**: `cd /tmp && bun /path/to/fw.ts query`
**Expected**: Error about repo detection, suggests specifying repo
**Validates**: Graceful handling when no repo context

#### Sync Without Repo (Outside Git Dir)

**Command**: `cd /tmp && bun /path/to/fw.ts sync`
**Expected**: Error about repo detection
**Validates**: Sync requires repo context

### Invalid Repo Formats

#### Single Word (No Slash)

**Command**: `bun apps/cli/bin/fw.ts sync firewatch`
**Expected**: Error about invalid repo format (needs owner/repo)
**Validates**: Repo slug validation

#### Too Many Slashes

**Command**: `bun apps/cli/bin/fw.ts sync a/b/c`
**Expected**: Error about invalid repo format
**Validates**: Repo slug validation

#### Empty String

**Command**: `bun apps/cli/bin/fw.ts sync ""`
**Expected**: Error or help text
**Validates**: Empty arg handling

### Invalid Duration Formats

#### Plain Number

**Command**: `bun apps/cli/bin/fw.ts query --since 24`
**Expected**: Error about invalid duration (needs unit)
**Validates**: Duration requires unit

#### Invalid Unit

**Command**: `bun apps/cli/bin/fw.ts query --since 24x`
**Expected**: Error about invalid duration unit
**Validates**: Unit validation

#### Negative Duration

**Command**: `bun apps/cli/bin/fw.ts query --since -7d`
**Expected**: Error or treated as invalid
**Validates**: Negative handling

### Conflicting Flags

#### Draft and Ready Together

**Command**: `bun apps/cli/bin/fw.ts edit 1 --draft --ready`
**Expected**: Error about conflicting options
**Validates**: Mutual exclusion enforcement

#### Multiple Exclusive States

**Command**: `bun apps/cli/bin/fw.ts query --state open --state closed`
**Expected**: Either error or last-wins behavior (document which)
**Validates**: State conflict handling

### Empty Results

#### Impossible Filter

**Command**: `bun apps/cli/bin/fw.ts query --author nonexistent-user-xyz --limit 5`
**Expected**: Empty output (no error), exit code 0
**Validates**: No results is not an error

#### Future Date

**Command**: `bun apps/cli/bin/fw.ts query --since 2099-01-01`
**Expected**: Error or empty results
**Validates**: Future date handling

### Special Characters

#### Author with Hyphen

**Command**: `bun apps/cli/bin/fw.ts query --author some-user --limit 3`
**Expected**: Works correctly
**Validates**: Hyphen in names

#### Body with Quotes

**Command**: `bun apps/cli/bin/fw.ts comment 1 --help`
**Expected**: Help text shows (we're not testing actual posting)
**Validates**: Quote handling in help

#### Path with Spaces

**Command**: `bun apps/cli/bin/fw.ts config --path`
**Expected**: Path output (may have spaces on some systems)
**Validates**: Path handling

### Exit Codes

#### Success Exit Code

**Command**: `bun apps/cli/bin/fw.ts query --limit 1; echo "Exit: $?"`
**Expected**: Exit code 0
**Validates**: Success returns 0

#### Error Exit Code

**Command**: `bun apps/cli/bin/fw.ts query --type invalid; echo "Exit: $?"`
**Expected**: Exit code non-zero (1)
**Validates**: Errors return non-zero

#### Help Exit Code

**Command**: `bun apps/cli/bin/fw.ts --help; echo "Exit: $?"`
**Expected**: Exit code 0 (help is not an error)
**Validates**: Help returns 0

### Large Numbers

#### Large Limit

**Command**: `bun apps/cli/bin/fw.ts query --limit 999999`
**Expected**: Works without overflow (returns available entries)
**Validates**: Large number handling

#### Large PR Number

**Command**: `bun apps/cli/bin/fw.ts query --pr 999999`
**Expected**: Empty results (no such PR), not crash
**Validates**: Large PR number handling

### Unknown Flags

#### Typo in Flag

**Command**: `bun apps/cli/bin/fw.ts query --limt 5`
**Expected**: Error about unknown option
**Validates**: Unknown flag detection

#### Wrong Prefix

**Command**: `bun apps/cli/bin/fw.ts query -limit 5`
**Expected**: Error or interpreted as short flags
**Validates**: Flag prefix handling
