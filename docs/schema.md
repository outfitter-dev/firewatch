# JSONL Schema Reference

Firewatch outputs denormalized JSONL where each line is a self-contained record. This design makes entries directly queryable with `jq` without needing joins.

## Schema Commands

Firewatch provides multiple schema types. Use `fw schema` to inspect them:

| Command              | Output                 | Use Case                                                       |
| -------------------- | ---------------------- | -------------------------------------------------------------- |
| `fw schema entry`    | FirewatchEntry schema  | Individual activity records (comments, reviews, commits, etc.) |
| `fw schema worklist` | WorklistEntry schema   | Per-PR summaries with aggregated counts                        |
| `fw schema config`   | Config schema          | Configuration file format                                      |
| `fw schema`          | Entry schema (default) | Same as `fw schema entry`                                      |

### When to Use Each

- **Entry schema** (`fw schema entry`): Understanding the structure of individual records from `fw`. Each entry represents a single event: a comment, review, commit, CI status, or PR event.

- **Worklist schema** (`fw schema worklist`): Understanding the structure of `fw --summary` output. Each worklist entry is a per-PR summary with activity counts and review states.

## Entry Types

| Type      | Description                                            |
| --------- | ------------------------------------------------------ |
| `comment` | PR comments (top-level and review comments)            |
| `review`  | Review submissions (approve, request changes, comment) |
| `commit`  | Commits pushed to the PR branch                        |
| `ci`      | CI/CD status events                                    |
| `event`   | PR lifecycle events (opened, closed, merged, etc.)     |

## FirewatchEntry

The primary data structure for individual activity records.

### Core Fields

| Field  | Type   | Required | Description                       |
| ------ | ------ | -------- | --------------------------------- |
| `id`   | string | Yes      | Unique entry identifier           |
| `repo` | string | Yes      | Repository in `owner/repo` format |
| `pr`   | number | Yes      | Pull request number               |

### PR Context (Denormalized)

| Field       | Type     | Required | Description                                 |
| ----------- | -------- | -------- | ------------------------------------------- |
| `pr_title`  | string   | Yes      | PR title                                    |
| `pr_state`  | string   | Yes      | One of: `open`, `closed`, `merged`, `draft` |
| `pr_author` | string   | Yes      | PR author username                          |
| `pr_branch` | string   | Yes      | Head branch name                            |
| `pr_labels` | string[] | No       | Array of label names                        |

### Entry Data

| Field     | Type   | Required | Description                                                  |
| --------- | ------ | -------- | ------------------------------------------------------------ |
| `type`    | string | Yes      | Entry type: `comment`, `review`, `commit`, `ci`, `event`     |
| `subtype` | string | No       | Type-specific subtype (see below)                            |
| `author`  | string | Yes      | Author of this activity                                      |
| `body`    | string | No       | Content body (comment text, commit message, etc.)            |
| `state`   | string | No       | State for reviews/CI (e.g., `approved`, `changes_requested`) |

### Timestamps

| Field         | Type   | Required | Description                              |
| ------------- | ------ | -------- | ---------------------------------------- |
| `created_at`  | string | Yes      | ISO 8601 datetime when activity occurred |
| `updated_at`  | string | No       | ISO 8601 datetime when last updated      |
| `captured_at` | string | Yes      | ISO 8601 datetime when synced to cache   |

### Metadata

| Field  | Type   | Required | Description                     |
| ------ | ------ | -------- | ------------------------------- |
| `url`  | string | No       | GitHub URL for this activity    |
| `file` | string | No       | File path for review comments   |
| `line` | number | No       | Line number for review comments |

### Staleness Hints

| Field                 | Type   | Required | Description                            |
| --------------------- | ------ | -------- | -------------------------------------- |
| `file_activity_after` | object | No       | Post-comment activity info (see below) |

#### file_activity_after

Populated when staleness hints are available on comment entries:

```json
{
  "modified": true,
  "commits_touching_file": 2,
  "latest_commit": "abc123def",
  "latest_commit_at": "2025-01-14T12:00:00Z"
}
```

| Field                   | Type    | Description                                           |
| ----------------------- | ------- | ----------------------------------------------------- |
| `modified`              | boolean | Whether file was modified after comment               |
| `commits_touching_file` | number  | Commits touching the file (or PR-wide if unavailable) |
| `latest_commit`         | string  | SHA of most recent relevant commit                    |
| `latest_commit_at`      | string  | Timestamp of latest commit                            |

### File Provenance (Graphite)

| Field             | Type   | Required | Description                           |
| ----------------- | ------ | -------- | ------------------------------------- |
| `file_provenance` | object | No       | Which stack PR last modified the file |

```json
{
  "origin_pr": 41,
  "origin_branch": "feature/base",
  "origin_commit": "abc123",
  "stack_position": 1
}
```

### Graphite Metadata

| Field      | Type   | Required | Description                             |
| ---------- | ------ | -------- | --------------------------------------- |
| `graphite` | object | No       | Stack metadata for Graphite-managed PRs |

```json
{
  "stack_id": "stack-abc123",
  "stack_position": 2,
  "stack_size": 3,
  "parent_pr": 41
}
```

| Field            | Type   | Description                         |
| ---------------- | ------ | ----------------------------------- |
| `stack_id`       | string | Unique identifier for the stack     |
| `stack_position` | number | Position in stack (1 = bottom)      |
| `stack_size`     | number | Total PRs in the stack              |
| `parent_pr`      | number | Parent PR number (if not at bottom) |

## Entry Subtypes

### Comment Subtypes

| Subtype          | Description                   |
| ---------------- | ----------------------------- |
| `issue_comment`  | Top-level PR comment          |
| `review_comment` | Inline review comment on code |

### Review States

| State               | Description               |
| ------------------- | ------------------------- |
| `approved`          | PR approved               |
| `changes_requested` | Changes requested         |
| `commented`         | Review with comments only |
| `dismissed`         | Review dismissed          |

### CI States

| State     | Description       |
| --------- | ----------------- |
| `pending` | Check in progress |
| `success` | Check passed      |
| `failure` | Check failed      |
| `neutral` | Neutral result    |
| `skipped` | Check skipped     |

## WorklistEntry

Aggregated per-PR summary, output by `fw --summary`.

### Fields

| Field                    | Type     | Required | Description                    |
| ------------------------ | -------- | -------- | ------------------------------ |
| `repo`                   | string   | Yes      | Repository                     |
| `pr`                     | number   | Yes      | PR number                      |
| `pr_title`               | string   | Yes      | PR title                       |
| `pr_state`               | string   | Yes      | PR state                       |
| `pr_author`              | string   | Yes      | PR author                      |
| `pr_branch`              | string   | Yes      | Head branch                    |
| `pr_labels`              | string[] | No       | Labels                         |
| `last_activity_at`       | string   | Yes      | Most recent activity timestamp |
| `latest_activity_type`   | string   | Yes      | Type of most recent activity   |
| `latest_activity_author` | string   | Yes      | Author of most recent activity |
| `counts`                 | object   | Yes      | Activity counts by type        |
| `review_states`          | object   | No       | Review state counts            |
| `graphite`               | object   | No       | Stack metadata                 |

### counts

```json
{
  "comments": 5,
  "reviews": 2,
  "commits": 3,
  "ci": 1,
  "events": 0
}
```

### review_states

```json
{
  "approved": 1,
  "changes_requested": 1,
  "commented": 0,
  "dismissed": 0
}
```

## Example Entries

### Comment (Review Comment)

```json
{
  "id": "comment-123456",
  "repo": "outfitter-dev/firewatch",
  "pr": 42,
  "pr_title": "Add query command",
  "pr_state": "open",
  "pr_author": "alice",
  "pr_branch": "feature/query",
  "pr_labels": ["enhancement"],
  "type": "comment",
  "subtype": "review_comment",
  "author": "bob",
  "body": "Consider adding error handling here",
  "created_at": "2025-01-14T10:00:00Z",
  "captured_at": "2025-01-14T10:05:00Z",
  "url": "https://github.com/outfitter-dev/firewatch/pull/42#discussion_r123",
  "file": "src/query.ts",
  "line": 42,
  "file_activity_after": {
    "modified": true,
    "commits_touching_file": 1,
    "latest_commit": "abc123",
    "latest_commit_at": "2025-01-14T11:00:00Z"
  },
  "graphite": {
    "stack_id": "stack-xyz",
    "stack_position": 2,
    "stack_size": 3,
    "parent_pr": 41
  }
}
```

### Review

```json
{
  "id": "review-789",
  "repo": "outfitter-dev/firewatch",
  "pr": 42,
  "pr_title": "Add query command",
  "pr_state": "open",
  "pr_author": "alice",
  "pr_branch": "feature/query",
  "type": "review",
  "author": "bob",
  "body": "Looks good with minor suggestions",
  "state": "approved",
  "created_at": "2025-01-14T12:00:00Z",
  "captured_at": "2025-01-14T12:05:00Z",
  "url": "https://github.com/outfitter-dev/firewatch/pull/42#pullrequestreview-789"
}
```

### Commit

```json
{
  "id": "commit-abc123",
  "repo": "outfitter-dev/firewatch",
  "pr": 42,
  "pr_title": "Add query command",
  "pr_state": "open",
  "pr_author": "alice",
  "pr_branch": "feature/query",
  "type": "commit",
  "author": "alice",
  "body": "fix: add error handling to query",
  "created_at": "2025-01-14T11:00:00Z",
  "captured_at": "2025-01-14T12:05:00Z",
  "url": "https://github.com/outfitter-dev/firewatch/commit/abc123"
}
```

### CI Status

```json
{
  "id": "ci-check-456",
  "repo": "outfitter-dev/firewatch",
  "pr": 42,
  "pr_title": "Add query command",
  "pr_state": "open",
  "pr_author": "alice",
  "pr_branch": "feature/query",
  "type": "ci",
  "subtype": "check_run",
  "author": "github-actions",
  "body": "Build",
  "state": "success",
  "created_at": "2025-01-14T11:05:00Z",
  "captured_at": "2025-01-14T12:05:00Z",
  "url": "https://github.com/outfitter-dev/firewatch/actions/runs/123"
}
```

### Worklist Entry

```json
{
  "repo": "outfitter-dev/firewatch",
  "pr": 42,
  "pr_title": "Add query command",
  "pr_state": "open",
  "pr_author": "alice",
  "pr_branch": "feature/query",
  "pr_labels": ["enhancement"],
  "last_activity_at": "2025-01-14T12:00:00Z",
  "latest_activity_type": "review",
  "latest_activity_author": "bob",
  "counts": {
    "comments": 3,
    "reviews": 1,
    "commits": 2,
    "ci": 1,
    "events": 0
  },
  "review_states": {
    "approved": 1,
    "changes_requested": 0,
    "commented": 0,
    "dismissed": 0
  },
  "graphite": {
    "stack_id": "stack-xyz",
    "stack_position": 2,
    "stack_size": 3,
    "parent_pr": 41
  }
}
```

## TypeScript Types

```typescript
import type {
  FirewatchEntry,
  WorklistEntry,
} from "@outfitter/firewatch-core/schema";
import type { EntryType, PrState } from "@outfitter/firewatch-core/schema";
```

## Schema Discovery

```bash
# Print schema documentation
fw schema entry
fw schema worklist

# Inspect live data
fw --limit 1 | jq 'keys'
fw --limit 1 | jq '.'
```
