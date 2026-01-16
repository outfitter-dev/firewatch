# fw rm

Remove metadata from PRs (labels, reviewers, assignees, milestone).

## Synopsis

```bash
fw rm <pr> [options]
```

## Options

| Option | Description |
|--------|-------------|
| `--label <name>` | Remove label (repeatable) |
| `--reviewer <user>` | Remove reviewer (repeatable) |
| `--assignee <user>` | Remove assignee (repeatable) |
| `--milestone` | Clear milestone |
| `--repo <name>` | Target repository (`owner/repo`) |
| `--json` | Force JSON output |
| `--no-json` | Force human-readable output |

## Examples

```bash
# Remove label
fw rm 23 --label wip

# Remove reviewer
fw rm 23 --reviewer alice

# Remove multiple labels
fw rm 23 --label bug --label stale

# Clear milestone
fw rm 23 --milestone
```
