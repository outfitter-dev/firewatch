# fw recap

Human-readable summary of PR activity.

## Synopsis

```bash
fw recap [options]
```

## Description

The `recap` command provides a quick, human-friendly overview of PR activity. Unlike other commands that output JSONL, `recap` defaults to text output designed for terminal display. Use `--json` if you need machine-readable output.

## Options

| Option | Description |
|--------|-------------|
| `--repo <name>` | Filter by repository (partial match) |
| `--all` | Query across all cached repositories |
| `--state <states>` | Filter by PR state (comma-separated: `open`, `closed`, `merged`, `draft`) |
| `--open` | Shorthand for `--state open` |
| `--draft` | Shorthand for `--state draft` |
| `--active` | Shorthand for `--state open,draft` |
| `--since <duration>` | Filter by time (e.g., `24h`, `7d`) |
| `--json` | Output JSONL instead of text |

## Examples

```bash
# Quick summary of current repo
fw recap

# Summary across all cached repos
fw recap --all

# Recent activity only
fw recap --since 7d

# Machine-readable output
fw recap --json
```

## Output Formats

### Default (Text)

```
Firewatch: 5 open PRs, 12 comments
- Changes Requested (2): #42, #45
- Ready to Merge (1): #41
- Drafts (2): #43, #44

Run `fw status --short` for JSONL output
```

### JSON (`--json`)

Outputs worklist entries as JSONL (same format as `fw status`).

## Categories

The recap categorizes PRs into:

- **Changes Requested**: PRs with at least one "changes requested" review
- **Ready to Merge**: Open PRs with approvals and no changes requested
- **Drafts**: PRs in draft state

## Use Cases

### Quick Morning Check

```bash
# What needs attention today?
fw recap --since 24h
```

### Team Overview

```bash
# All repos, recent activity
fw recap --all --since 7d
```

## See Also

- [fw status](./status.md) - Detailed worklist output
- [fw query](./query.md) - Full entry queries
