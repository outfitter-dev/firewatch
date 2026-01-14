# fw comment

Post a PR comment or reply to a review thread.

## Synopsis

```bash
fw comment <pr> <body> [options]
```

## Description

The `comment` command posts comments to GitHub PRs. It can create top-level PR comments or reply to existing review threads. Optionally, it can resolve threads after replying.

## Arguments

| Argument | Description |
|----------|-------------|
| `pr` | PR number to comment on |
| `body` | Comment body text |

## Options

| Option | Description |
|--------|-------------|
| `--repo <name>` | Repository (`owner/repo` format). Auto-detects if omitted. |
| `--reply-to <commentId>` | Reply to a specific review comment |
| `--resolve` | Resolve the review thread after replying (requires `--reply-to`) |
| `--json` | Output JSON (default) |

## Examples

```bash
# Post a top-level PR comment
fw comment 42 "Thanks for the review!"

# Reply to a review comment
fw comment 42 "Fixed in latest commit" --reply-to comment-2001

# Reply and resolve the thread
fw comment 42 "Addressed in abc123" --reply-to comment-2001 --resolve

# Specify repository explicitly
fw comment 42 "LGTM" --repo outfitter-dev/firewatch
```

## Output

### Top-Level Comment

```json
{
  "ok": true,
  "repo": "outfitter-dev/firewatch",
  "pr": 42,
  "comment_id": "IC_abc123",
  "url": "https://github.com/outfitter-dev/firewatch/pull/42#issuecomment-123"
}
```

### Thread Reply

```json
{
  "ok": true,
  "repo": "outfitter-dev/firewatch",
  "pr": 42,
  "comment_id": "PRRC_xyz789",
  "reply_to": "comment-2001",
  "url": "https://github.com/outfitter-dev/firewatch/pull/42#discussion_r456"
}
```

### Reply with Resolve

```json
{
  "ok": true,
  "repo": "outfitter-dev/firewatch",
  "pr": 42,
  "comment_id": "PRRC_xyz789",
  "reply_to": "comment-2001",
  "resolved": true,
  "url": "https://github.com/outfitter-dev/firewatch/pull/42#discussion_r456"
}
```

## Finding Comment IDs

To reply to a review comment, you need its ID. Query for comments and extract IDs:

```bash
# List review comments with IDs
fw query --pr 42 --type comment | jq 'select(.subtype == "review_comment") | {id, file, body}'

# Get the first review comment ID
fw query --pr 42 --type comment | jq -r 'select(.subtype == "review_comment") | .id' | head -1
```

## Common Workflows

### Address Feedback and Resolve

```bash
# Find comments needing attention
fw query --pr 42 --type comment | jq 'select(.subtype == "review_comment") | {id, body}'

# Reply and resolve
fw comment 42 "Fixed in commit abc123" --reply-to comment-2001 --resolve
```

### Bulk Resolution

For resolving multiple threads, use `fw resolve` instead:

```bash
fw resolve comment-2001 comment-2002 comment-2003
```

## Authentication

The `comment` command requires write access to the repository:

- `repo` scope for private repositories
- `public_repo` scope for public repositories

## See Also

- [fw resolve](./resolve.md) - Resolve without replying
- [fw query](./query.md) - Find comment IDs
