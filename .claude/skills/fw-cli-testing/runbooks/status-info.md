---
name: status-info
focus: Informational and diagnostic commands
estimated-tests: 18
---

# Status & Info Runbook

Tests status, config, doctor, schema, and help commands.

## Setup

Ensure inside a git repo with firewatch configured.

## Test Cases

### Status Command

#### Default Status

**Command**: `bun apps/cli/bin/fw.ts status`
**Expected**: Shows PR summary with activity counts
**Validates**: Basic status works

#### Short Status

**Command**: `bun apps/cli/bin/fw.ts status --short`
**Expected**: Compact one-line-per-PR format
**Validates**: Short format works

#### JSON Status

**Command**: `bun apps/cli/bin/fw.ts status --json`
**Expected**: Valid JSON output
**Validates**: JSON output mode

#### Status with Limit

**Command**: `bun apps/cli/bin/fw.ts status --limit 3`
**Expected**: At most 3 PRs shown
**Validates**: Limit applies to status

#### Status Open Only

**Command**: `bun apps/cli/bin/fw.ts status --open`
**Expected**: Only open PRs in output
**Validates**: State filter on status

### Config Command

#### View Config

**Command**: `bun apps/cli/bin/fw.ts config`
**Expected**: Shows current configuration
**Validates**: Config display works

#### Config Path

**Command**: `bun apps/cli/bin/fw.ts config --path`
**Expected**: Shows path to config file
**Validates**: Path option works

#### Config Local Flag

**Command**: `bun apps/cli/bin/fw.ts config --local`
**Expected**: Shows/uses local .firewatch.toml
**Validates**: Local config handling

### Doctor Command

#### Basic Doctor

**Command**: `bun apps/cli/bin/fw.ts doctor`
**Expected**: Diagnostic output about auth, cache, repo
**Validates**: Doctor runs diagnostics

#### Doctor with Fix

**Command**: `bun apps/cli/bin/fw.ts doctor --fix`
**Expected**: Attempts to fix issues (or says nothing to fix)
**Validates**: Fix flag accepted

### Schema Command

#### Entry Schema

**Command**: `bun apps/cli/bin/fw.ts schema entry`
**Expected**: JSON schema for FirewatchEntry
**Validates**: Entry schema available

#### Worklist Schema

**Command**: `bun apps/cli/bin/fw.ts schema worklist`
**Expected**: JSON schema for WorklistEntry
**Validates**: Worklist schema available

#### Config Schema

**Command**: `bun apps/cli/bin/fw.ts schema config`
**Expected**: JSON schema for configuration
**Validates**: Config schema available

#### Invalid Schema Type

**Command**: `bun apps/cli/bin/fw.ts schema invalid`
**Expected**: Error listing valid schema types
**Validates**: Schema type validation

### Help Text

#### Main Help

**Command**: `bun apps/cli/bin/fw.ts --help`
**Expected**: Lists all commands with descriptions
**Validates**: Main help complete

#### Query Help

**Command**: `bun apps/cli/bin/fw.ts query --help`
**Expected**: Lists all query options
**Validates**: Query command documented

#### Status Help

**Command**: `bun apps/cli/bin/fw.ts status --help`
**Expected**: Lists status options
**Validates**: Status command documented

#### Config Help

**Command**: `bun apps/cli/bin/fw.ts config --help`
**Expected**: Lists config options
**Validates**: Config command documented

#### All Commands Have Help

**Command**: Check each command in apps/cli/src/commands/
**Expected**: Every command responds to --help
**Validates**: Complete help coverage
