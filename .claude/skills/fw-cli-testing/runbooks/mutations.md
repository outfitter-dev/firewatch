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

### PR Comment Command

#### Comment Help

**Command**: `bun apps/cli/bin/fw.ts pr comment --help`
**Expected**: Shows usage: pr comment <pr> <body> with options
**Validates**: Comment documented

#### Comment Missing PR

**Command**: `bun apps/cli/bin/fw.ts pr comment`
**Expected**: Error about missing PR number
**Validates**: Required arg validation

#### Comment Missing Body

**Command**: `bun apps/cli/bin/fw.ts pr comment 1`
**Expected**: Error about missing body
**Validates**: Body required

### PR Edit Command

#### Edit Help

**Command**: `bun apps/cli/bin/fw.ts pr edit --help`
**Expected**: Shows PR editing options
**Validates**: Edit documented

#### Edit Missing PR

**Command**: `bun apps/cli/bin/fw.ts pr edit`
**Expected**: Error about missing PR number
**Validates**: PR required

#### Edit Options Present

**Command**: `bun apps/cli/bin/fw.ts pr edit --help`
**Expected**: Shows --title, --body, --draft, --ready, --add-label, --remove-label options
**Validates**: Edit options documented

#### Edit Draft Ready Conflict

**Command**: `bun apps/cli/bin/fw.ts pr edit 1 --draft --ready`
**Expected**: Error about conflicting options
**Validates**: Mutual exclusion

#### Add Label Option

**Command**: `bun apps/cli/bin/fw.ts pr edit --help | grep -i label`
**Expected**: Shows --add-label and --remove-label options
**Validates**: Label management documented

#### Add Reviewer Option

**Command**: `bun apps/cli/bin/fw.ts pr edit --help | grep -i reviewer`
**Expected**: Shows --add-reviewer and --remove-reviewer options
**Validates**: Reviewer management documented

### PR Review Command

#### Review Help

**Command**: `bun apps/cli/bin/fw.ts pr review --help`
**Expected**: Shows review options (approve, request-changes, comment)
**Validates**: Review documented

#### Review Missing PR

**Command**: `bun apps/cli/bin/fw.ts pr review`
**Expected**: Error about missing PR number
**Validates**: PR required

### Close/Resolve Command

#### Close Help

**Command**: `bun apps/cli/bin/fw.ts close --help`
**Expected**: Shows usage with comment ID argument
**Validates**: Close documented

#### Close Missing ID

**Command**: `bun apps/cli/bin/fw.ts close`
**Expected**: Help or waits for input
**Validates**: ID behavior

#### Close Bulk Option

**Command**: `bun apps/cli/bin/fw.ts close --help | grep -i all`
**Expected**: Shows --all option for bulk closing
**Validates**: Bulk close documented

#### Resolve Alias

**Command**: `bun apps/cli/bin/fw.ts resolve --help`
**Expected**: Shows same options as close (resolve is alias)
**Validates**: Resolve alias works

### Ack Command

#### Ack Help

**Command**: `bun apps/cli/bin/fw.ts ack --help`
**Expected**: Shows options for acknowledging feedback
**Validates**: Ack documented

#### Ack List Option

**Command**: `bun apps/cli/bin/fw.ts ack --list`
**Expected**: Shows list of acknowledged comments
**Validates**: List acks works

#### Ack Clear Option

**Command**: `bun apps/cli/bin/fw.ts ack --help | grep -i clear`
**Expected**: Shows --clear option
**Validates**: Clear ack documented

### Feedback Command (fb)

#### Fb Help

**Command**: `bun apps/cli/bin/fw.ts fb --help`
**Expected**: Shows feedback abstraction options
**Validates**: Fb documented

#### Fb Stack Option

**Command**: `bun apps/cli/bin/fw.ts fb --help | grep -i stack`
**Expected**: Shows --stack option for stack-aware feedback
**Validates**: Stack option documented

#### Fb Current Option

**Command**: `bun apps/cli/bin/fw.ts fb --help | grep -i current`
**Expected**: Shows --current option for current branch
**Validates**: Current branch option documented

#### Fb Body Option

**Command**: `bun apps/cli/bin/fw.ts fb --help | grep -i body`
**Expected**: Shows --body option for replies
**Validates**: Reply body documented

#### Fb Resolve Option

**Command**: `bun apps/cli/bin/fw.ts fb --help | grep -i resolve`
**Expected**: Shows --resolve option
**Validates**: Resolve option documented
