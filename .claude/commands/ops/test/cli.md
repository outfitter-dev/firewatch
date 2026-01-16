---
name: ops-test-cli
description: Run Firewatch CLI validation tests
argument-hint: "[category|--all]"
allowed-tools: Read Glob Grep Skill TodoWrite Bash(./.claude/scripts/run-tests.sh *) Bash(bun apps/cli/bin/fw.ts *)
---

# CLI Validation Tests

Load the `cli-testing` skill for detailed testing guidance.

## Quick Run

```bash
./.claude/scripts/run-tests.sh [category|--all]
```

## Categories

| Category | Tests | Focus |
|----------|-------|-------|
| `query-validation` | ~9 | Root command filters, flag conflicts |
| `mutation-validation` | ~12 | add/edit/rm/close validation rules |
| `output-modes` | ~9 | --json, --short, schema variants |
| `error-taxonomy` | ~6 | Error messages, exit codes |
| `edge-cases` | ~9 | Boundaries, malformed input |

## Output

Results written to `.scratch/testing/`:
- `{date}-{id}-{category}.md` - Markdown report
- `{date}-{id}-{category}-debug.log` - Debug output

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | All tests passed |
| 1 | One or more tests failed |
| 2 | Setup or usage error |

## Result Classifications

| Result | Meaning |
|--------|---------|
| **PASS** | Behaves as expected |
| **WARN** | Works but unexpected output |
| **FAIL** | Broken behavior or wrong exit code |

## When to Use

- After modifying CLI option parsing
- Before releases
- To validate error handling
- CI pipelines (deterministic, fast)
