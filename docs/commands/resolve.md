# fw resolve

Resolve review comment threads by ID.

## Synopsis

```bash
fw resolve <commentIds...> [options]
```

## Description

The `resolve` command resolves review comment threads on GitHub. It's useful for bulk-resolving threads after addressing feedback.

## Arguments

| Argument | Description |
|----------|-------------|
| `commentIds` | One or more review comment IDs to resolve |

## Options

| Option | Description |
|--------|-------------|
| `--repo <name>` | Repository (`owner/repo` format). Required if cache lookup fails. |
| `--pr <number>` | PR number. Required if cache lookup fails. |
| `--json` | Output JSON (default) |

## Examples

```bash
# Resolve a single thread
fw resolve comment-2001

# Resolve multiple threads
fw resolve comment-2001 comment-2002 comment-2003

# Explicit repo and PR (skips cache lookup)
fw resolve comment-2001 --repo outfitter-dev/firewatch --pr 42
```

## Output

Each resolved thread produces a JSON line:

```json
{"ok":true,"repo":"outfitter-dev/firewatch","pr":42,"comment_id":"comment-2001","thread_id":"PRT_abc123"}
```

## Comment ID Resolution

Firewatch looks up comment IDs in the local cache to find the associated repo, PR, and thread. If a comment isn't in the cache:

1. Sync the repo first: `fw sync`
2. Or provide `--repo` and `--pr` explicitly

### Cache Lookup

```bash
# This uses cached data to find repo/PR
fw resolve comment-2001

# This skips cache lookup
fw resolve comment-2001 --repo org/repo --pr 42
```

## Workflow Example

```bash
# Find unresolved review comments
fw query --pr 42 --type comment \
  | jq 'select(.subtype == "review_comment")' \
  | jq '{id, body}'

# Resolve specific threads
fw resolve comment-2001 comment-2002

# Or use jq to extract IDs and xargs
fw query --pr 42 --type comment \
  | jq -r 'select(.subtype == "review_comment") | .id' \
  | xargs fw resolve
```

## Batch Resolution

When resolving multiple comments from the same PR, Firewatch groups them to minimize API calls.

## Errors

### Comment Not Found

```
Comment comment-xyz not found in cache. Run fw sync or pass --repo and --pr.
```

Solution: Sync the repo or provide explicit `--repo` and `--pr`.

### Not a Review Comment

```
Comment comment-xyz is not a review comment thread entry.
```

Only review comments (not top-level PR comments) have threads that can be resolved.

## Authentication

Requires write access to the repository (`repo` scope).

## See Also

- [fw comment](./comment.md) - Reply and optionally resolve
- [fw query](./query.md) - Find comment IDs
