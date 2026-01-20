# fw add

Add content (comments, replies, reviews) or metadata (labels, reviewers, assignees) to PRs.

## Synopsis

```bash
fw add <pr> [body] [options]
```

## Options

| Option              | Description                                            |
| ------------------- | ------------------------------------------------------ |
| `--reply <id>`      | Reply to a specific review thread comment              |
| `--resolve`         | Resolve the thread after replying (requires `--reply`) |
| `--review <type>`   | Add review: `approve`, `request-changes`, `comment`    |
| `--label <name>`    | Add label (repeatable)                                 |
| `--reviewer <user>` | Request reviewer (repeatable)                          |
| `--assignee <user>` | Add assignee (repeatable)                              |
| `--repo <name>`     | Target repository (`owner/repo`)                       |
| `--jsonl`            | Force structured output                                      |
| `--no-jsonl`         | Force human-readable output                            |

## Examples

```bash
# Add comment to PR
fw add 23 "LGTM, ship it!"

# Reply to a review comment
fw add 23 --reply IC_kwDOABC123 "Fixed in latest commit"

# Reply and resolve the thread
fw add 23 --reply IC_kwDOABC123 "Done" --resolve

# Approve PR with message
fw add 23 --review approve "Looks good!"

# Request changes
fw add 23 --review request-changes "Please add tests"

# Add labels
fw add 23 --label bug --label priority-high

# Add reviewers
fw add 23 --reviewer alice --reviewer bob

# Add assignees
fw add 23 --assignee galligan
```

## Notes

- `--resolve` requires `--reply`
- Review comments must be review thread comment IDs (not top-level issue comments)
