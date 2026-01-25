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
**Expected**: Shows cache status, auth info, repo detection
**Validates**: Basic status works

#### Short Status

**Command**: `bun apps/cli/bin/fw.ts status --short`
**Expected**: Compact one-line format
**Validates**: Short format works

#### JSON Status

**Command**: `bun apps/cli/bin/fw.ts status --jsonl`
**Expected**: Valid JSONL output with status info
**Validates**: JSONL output mode

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

#### Config Edit Mode

**Command**: `bun apps/cli/bin/fw.ts config --edit --help`
**Expected**: Shows that --edit opens config in $EDITOR
**Validates**: Edit option documented

### Doctor Command

#### Basic Doctor

**Command**: `bun apps/cli/bin/fw.ts doctor`
**Expected**: Diagnostic output about auth, cache, repo with checkmarks
**Validates**: Doctor runs diagnostics

#### Doctor with Fix

**Command**: `bun apps/cli/bin/fw.ts doctor --fix`
**Expected**: Attempts to fix issues (or says nothing to fix)
**Validates**: Fix flag accepted

#### Doctor JSONL

**Command**: `bun apps/cli/bin/fw.ts doctor --jsonl`
**Expected**: Structured diagnostic output
**Validates**: JSONL output mode

### Schema Command

#### Query Schema

**Command**: `bun apps/cli/bin/fw.ts schema query`
**Expected**: JSON schema for FirewatchEntry
**Validates**: Query schema available

#### Feedback Schema

**Command**: `bun apps/cli/bin/fw.ts schema fb`
**Expected**: JSON schema for feedback output
**Validates**: Feedback schema available

#### Status Schema

**Command**: `bun apps/cli/bin/fw.ts schema status`
**Expected**: JSON schema for status output
**Validates**: Status schema available

#### Config Schema

**Command**: `bun apps/cli/bin/fw.ts schema config`
**Expected**: JSON schema for configuration
**Validates**: Config schema available

#### Invalid Schema Type

**Command**: `bun apps/cli/bin/fw.ts schema invalid`
**Expected**: Error or help listing valid schema types
**Validates**: Schema type validation

### Help Text

#### Main Help

**Command**: `bun apps/cli/bin/fw.ts --help`
**Expected**: Lists all commands with descriptions
**Validates**: Main help complete

#### Root Command Help

**Command**: `bun apps/cli/bin/fw.ts help`
**Expected**: Shows help for the root fw command
**Validates**: Help subcommand works

#### Status Help

**Command**: `bun apps/cli/bin/fw.ts status --help`
**Expected**: Lists status options (--short, --jsonl, --no-jsonl)
**Validates**: Status command documented

#### Config Help

**Command**: `bun apps/cli/bin/fw.ts config --help`
**Expected**: Lists config options (--edit, --path, --local)
**Validates**: Config command documented

#### PR Subcommand Help

**Command**: `bun apps/cli/bin/fw.ts pr --help`
**Expected**: Lists pr subcommands (list, edit, comment, review)
**Validates**: PR command group documented

#### All Commands Have Help

**Command**: Check each command responds to --help
**Expected**: Every command/subcommand has help text
**Validates**: Complete help coverage

### Cache Command

#### Cache Status

**Command**: `bun apps/cli/bin/fw.ts cache status`
**Expected**: Shows cache size, repo count, freshness
**Validates**: Cache inspection works

#### Cache Clear Help

**Command**: `bun apps/cli/bin/fw.ts cache clear --help`
**Expected**: Shows options for clearing cache
**Validates**: Cache clear documented
