# fw check

Refresh staleness hints in the local cache.

## Synopsis

```bash
fw check [repo] [options]
```

## Description

The `check` command updates cached comment entries with staleness hints, indicating whether follow-up activity occurred after feedback was posted. This helps identify which comments may have already been addressed.

## Arguments

| Argument | Description |
|----------|-------------|
| `repo` | Repository to check (`owner/repo` format). Auto-detects if omitted. |

## Options

| Option | Description |
|--------|-------------|
| `--json` | Output JSONL (default) |

## Examples

```bash
# Check current repo
fw check

# Check specific repo
fw check outfitter-dev/firewatch
```

## Output

Check outputs results as JSONL:

```json
{"repo":"outfitter-dev/firewatch","comments_checked":15,"entries_updated":8}
```

## Staleness Hints

After running `fw check`, comment entries may include a `file_activity_after` field:

```json
{
  "id": "comment-123",
  "type": "comment",
  "subtype": "review_comment",
  "file": "src/index.ts",
  "line": 42,
  "file_activity_after": {
    "modified": true,
    "commits_touching_file": 2,
    "latest_commit": "abc123",
    "latest_commit_at": "2025-01-14T12:00:00Z"
  }
}
```

### Fields

| Field | Description |
|-------|-------------|
| `modified` | Whether the file was modified after the comment |
| `commits_touching_file` | Number of commits touching this file (or PR-wide if file info unavailable) |
| `latest_commit` | SHA of the most recent relevant commit |
| `latest_commit_at` | Timestamp of the latest commit |

## File-Scoped vs PR-Scoped

When running inside a git repository, Firewatch uses local git history to determine which files were touched by each commit:

- **File-scoped**: `commits_touching_file` counts only commits that touched the commented file
- **PR-scoped**: Falls back to counting all PR commits if file lists aren't available

File-scoped hints are more accurate for determining if specific feedback has been addressed.

## Use Cases

### Find Potentially Addressed Comments

```bash
fw check
fw query --type comment | jq 'select(.file_activity_after.modified == true)'
```

### Find Stale Comments

```bash
fw query --type comment | jq 'select(.file_activity_after.modified == false)'
```

### Review with Staleness Context

```bash
fw query --type comment | jq '{
  id,
  file,
  body,
  stale: (.file_activity_after.modified // false)
}'
```

## When to Run

Run `fw check` when you want up-to-date staleness information:

- Before reviewing feedback to see what's been addressed
- After pushing commits to update staleness state
- Periodically during active development

The check is fast and only updates existing cache entries.

## See Also

- [fw sync](./sync.md) - Fetch new activity
- [fw query](./query.md) - Filter with staleness data
