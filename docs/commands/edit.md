# fw edit

Modify PR fields (title, body, base branch, milestone) or state (draft/ready).

## Synopsis

```bash
fw edit <pr> --<field> <value>
```

## Options

| Option               | Description                      |
| -------------------- | -------------------------------- |
| `--title <text>`     | Change PR title                  |
| `--body <text>`      | Change PR description            |
| `--base <branch>`    | Change base branch               |
| `--milestone <name>` | Set milestone                    |
| `--draft`            | Convert to draft                 |
| `--ready`            | Mark ready for review            |
| `--repo <name>`      | Target repository (`owner/repo`) |
| `--jsonl`             | Force structured output                |
| `--no-jsonl`          | Force human-readable output      |

## Examples

```bash
# Change PR title
fw edit 23 --title "feat: add user authentication"

# Change description
fw edit 23 --body "Updated implementation with JWT support"

# Change base branch
fw edit 23 --base main

# Convert to draft
fw edit 23 --draft

# Mark ready for review
fw edit 23 --ready

# Set milestone
fw edit 23 --milestone "v1.0"
```
