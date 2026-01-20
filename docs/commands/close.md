# fw close

Resolve review comment threads by comment ID.

## Synopsis

```bash
fw close <comment-id> [comment-id...]
```

## Options

| Option          | Description                                             |
| --------------- | ------------------------------------------------------- |
| `--repo <name>` | Target repository (`owner/repo`), if cache lookup fails |
| `--jsonl`        | Force structured output                                       |
| `--no-jsonl`     | Force human-readable output                             |

## Examples

```bash
# Resolve a review comment thread
fw close IC_kwDOABC123

# Resolve multiple threads
fw close IC_kwDOABC123 IC_kwDODEF456
```

## Notes

- Works only on review comment threads (inline comments), not top-level PR comments
- If a comment ID is missing from cache, run `fw --refresh` first
