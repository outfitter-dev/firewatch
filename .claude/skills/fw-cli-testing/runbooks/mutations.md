---
name: mutations
focus: Write operations - help text, validation, error handling
estimated-tests: 15
---

# Mutations Runbook

Tests write operations in validation/help mode only. **Does not execute actual mutations.**

## Safety Note

These tests validate command structure and error handling without making real changes to GitHub. Focus on `--help`, missing argument errors, and validation.

## Test Cases

### Comment Command

#### Comment Help
**Command**: `bun apps/cli/bin/fw.ts comment --help`
**Expected**: Shows usage: comment <pr> <body> with options
**Validates**: Comment documented

#### Comment Missing PR
**Command**: `bun apps/cli/bin/fw.ts comment`
**Expected**: Error about missing PR number
**Validates**: Required arg validation

#### Comment Missing Body
**Command**: `bun apps/cli/bin/fw.ts comment 1`
**Expected**: Error about missing body
**Validates**: Body required

#### Comment Reply-To Option
**Command**: `bun apps/cli/bin/fw.ts comment --help | grep -i reply`
**Expected**: Shows --reply-to option
**Validates**: Reply option documented

#### Comment Resolve Option
**Command**: `bun apps/cli/bin/fw.ts comment --help | grep -i resolve`
**Expected**: Shows --resolve option
**Validates**: Resolve option documented

### Resolve Command

#### Resolve Help
**Command**: `bun apps/cli/bin/fw.ts resolve --help`
**Expected**: Shows usage with comment ID argument
**Validates**: Resolve documented

#### Resolve Missing ID
**Command**: `bun apps/cli/bin/fw.ts resolve`
**Expected**: Error about missing comment ID
**Validates**: ID required

#### Resolve Invalid ID Format
**Command**: `bun apps/cli/bin/fw.ts resolve not-a-valid-id`
**Expected**: Error about invalid ID format (or API error)
**Validates**: ID validation

### Edit Command

#### Edit Help
**Command**: `bun apps/cli/bin/fw.ts edit --help`
**Expected**: Shows PR editing options
**Validates**: Edit documented

#### Edit Missing PR
**Command**: `bun apps/cli/bin/fw.ts edit`
**Expected**: Error about missing PR number
**Validates**: PR required

#### Edit Options Present
**Command**: `bun apps/cli/bin/fw.ts edit --help`
**Expected**: Shows --title, --body, --draft, --ready options
**Validates**: Edit options documented

#### Edit Draft Ready Conflict
**Command**: `bun apps/cli/bin/fw.ts edit 1 --draft --ready`
**Expected**: Error about conflicting options
**Validates**: Mutual exclusion

### Add Command (Metadata)

#### Add Help
**Command**: `bun apps/cli/bin/fw.ts add --help`
**Expected**: Shows options for labels, reviewers, assignees
**Validates**: Add documented

#### Add Label Option
**Command**: `bun apps/cli/bin/fw.ts add --help | grep -i label`
**Expected**: Shows --label option
**Validates**: Label adding documented

### Remove Command

#### Rm Help
**Command**: `bun apps/cli/bin/fw.ts rm --help`
**Expected**: Shows removal options
**Validates**: Rm documented

#### Rm Missing PR
**Command**: `bun apps/cli/bin/fw.ts rm`
**Expected**: Error about missing PR number
**Validates**: PR required
