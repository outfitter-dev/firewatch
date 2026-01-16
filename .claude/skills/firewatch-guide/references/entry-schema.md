# Entry Schema Reference

Complete field reference for FirewatchEntry and WorklistEntry.

## FirewatchEntry

Each line in JSONL output is a self-contained FirewatchEntry.

### Core Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique identifier (GitHub node ID) |
| `repo` | string | Yes | Repository in "owner/repo" format |
| `pr` | number | Yes | Pull request number |
| `type` | string | Yes | Entry type (see below) |
| `author` | string | Yes | Username who created this entry |
| `created_at` | string | Yes | ISO 8601 timestamp |
| `captured_at` | string | Yes | When Firewatch captured this entry |

### Entry Types

| Type | Description |
|------|-------------|
| `comment` | PR comments (review or issue comments) |
| `review` | Review submissions (approve, changes_requested, etc.) |
| `commit` | Commits pushed to PR branch |
| `ci` | CI/CD status checks |
| `event` | Lifecycle events (opened, closed, merged) |

### PR Context (Denormalized)

Every entry includes full PR context for jq queries without joins.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `pr_title` | string | Yes | PR title |
| `pr_state` | string | Yes | One of: "open", "closed", "merged", "draft" |
| `pr_author` | string | Yes | Username who created the PR |
| `pr_branch` | string | Yes | Source branch name |
| `pr_labels` | string[] | No | Labels attached to the PR |

### Entry-Specific Fields

| Field | Type | Applies To | Description |
|-------|------|-----------|-------------|
| `subtype` | string | comment | "review_comment" or "issue_comment" |
| `body` | string | comment, review | Content text |
| `state` | string | review, ci | Review: "approved", "changes_requested", "commented", "dismissed" |
| `file` | string | comment | File path for review comments |
| `line` | number | comment | Line number for review comments |
| `url` | string | any | GitHub URL to the entry |
| `updated_at` | string | any | ISO 8601 timestamp of last update |

### File Activity Tracking

Populated by `fw check`. Shows if file was modified after the comment.

| Field | Type | Description |
|-------|------|-------------|
| `file_activity_after.modified` | boolean | True if file has commits after comment |
| `file_activity_after.commits_touching_file` | number | Count of commits touching this file |
| `file_activity_after.latest_commit` | string | SHA of most recent commit |
| `file_activity_after.latest_commit_at` | string | Timestamp of most recent commit |

### File Provenance (Graphite Stacks)

For comments on files that originated in a different stack PR.

| Field | Type | Description |
|-------|------|-------------|
| `file_provenance.origin_pr` | number | PR number where file was introduced |
| `file_provenance.origin_branch` | string | Branch name of origin PR |
| `file_provenance.origin_commit` | string | Commit SHA that introduced the file |
| `file_provenance.stack_position` | number | Stack position of origin PR |

### Graphite Metadata

Populated when syncing with `--with-graphite`.

| Field | Type | Description |
|-------|------|-------------|
| `graphite.stack_id` | string | Unique stack identifier |
| `graphite.stack_position` | number | Position in stack (1 = base) |
| `graphite.stack_size` | number | Total PRs in the stack |
| `graphite.parent_pr` | number | PR number of parent in stack |

## WorklistEntry

Aggregated per-PR summary from `fw status` or `fw query --worklist`.

### Core Fields

| Field | Type | Description |
|-------|------|-------------|
| `repo` | string | Repository in "owner/repo" format |
| `pr` | number | Pull request number |
| `pr_title` | string | PR title |
| `pr_state` | string | One of: "open", "closed", "merged", "draft" |
| `pr_author` | string | Username who created the PR |
| `pr_branch` | string | Source branch name |
| `pr_labels` | string[] | Labels attached to the PR (optional) |

### Activity Summary

| Field | Type | Description |
|-------|------|-------------|
| `last_activity_at` | string | Timestamp of most recent activity |
| `latest_activity_type` | string | Type of most recent activity |
| `latest_activity_author` | string | Author of most recent activity |

### Counts

| Field | Type | Description |
|-------|------|-------------|
| `counts.comments` | number | Total comment count |
| `counts.reviews` | number | Total review count |
| `counts.commits` | number | Total commit count |
| `counts.ci` | number | Total CI status count |
| `counts.events` | number | Total event count |

### Review States

| Field | Type | Description |
|-------|------|-------------|
| `review_states.approved` | number | Count of approvals |
| `review_states.changes_requested` | number | Count of changes requested |
| `review_states.commented` | number | Count of comment-only reviews |
| `review_states.dismissed` | number | Count of dismissed reviews |

### Graphite Metadata

Same as FirewatchEntry.graphite when available.

## Example Entries

### Review Comment

```json
{
  "id": "PRRC_kwDOK123",
  "repo": "owner/repo",
  "pr": 42,
  "pr_title": "Add user authentication",
  "pr_state": "open",
  "pr_author": "alice",
  "pr_branch": "feature/auth",
  "type": "comment",
  "subtype": "review_comment",
  "author": "bob",
  "body": "Consider adding error handling here",
  "file": "src/auth.ts",
  "line": 42,
  "url": "https://github.com/owner/repo/pull/42#discussion_r123",
  "created_at": "2025-01-14T10:00:00Z",
  "captured_at": "2025-01-14T12:00:00Z",
  "file_activity_after": {
    "modified": false,
    "commits_touching_file": 0
  }
}
```

### Review Submission

```json
{
  "id": "PRR_kwDOK456",
  "repo": "owner/repo",
  "pr": 42,
  "pr_title": "Add user authentication",
  "pr_state": "open",
  "pr_author": "alice",
  "pr_branch": "feature/auth",
  "type": "review",
  "author": "bob",
  "body": "Looks good overall, minor comments",
  "state": "changes_requested",
  "url": "https://github.com/owner/repo/pull/42#pullrequestreview-456",
  "created_at": "2025-01-14T10:30:00Z",
  "captured_at": "2025-01-14T12:00:00Z"
}
```

### Stack Entry with Provenance

```json
{
  "id": "PRRC_kwDOK789",
  "repo": "owner/repo",
  "pr": 103,
  "pr_title": "Add auth middleware",
  "pr_state": "open",
  "pr_author": "alice",
  "pr_branch": "feature/auth-middleware",
  "type": "comment",
  "subtype": "review_comment",
  "author": "bob",
  "body": "This validation should be stricter",
  "file": "src/auth.ts",
  "line": 15,
  "created_at": "2025-01-14T11:00:00Z",
  "captured_at": "2025-01-14T12:00:00Z",
  "graphite": {
    "stack_id": "stack_abc123",
    "stack_position": 3,
    "stack_size": 3,
    "parent_pr": 102
  },
  "file_provenance": {
    "origin_pr": 101,
    "origin_branch": "feature/auth-base",
    "origin_commit": "abc123",
    "stack_position": 1
  }
}
```

### Worklist Entry

```json
{
  "repo": "owner/repo",
  "pr": 42,
  "pr_title": "Add user authentication",
  "pr_state": "open",
  "pr_author": "alice",
  "pr_branch": "feature/auth",
  "last_activity_at": "2025-01-14T11:00:00Z",
  "latest_activity_type": "comment",
  "latest_activity_author": "bob",
  "counts": {
    "comments": 5,
    "reviews": 2,
    "commits": 3,
    "ci": 1,
    "events": 1
  },
  "review_states": {
    "approved": 0,
    "changes_requested": 1,
    "commented": 1,
    "dismissed": 0
  }
}
```

## Field Usage by Task

### Finding Actionable Comments

Key fields: `subtype`, `author`, `pr_author`, `file_activity_after.modified`

### Resolving Comments

Key fields: `id`, `file`, `line`, `body`

### Stack Navigation

Key fields: `graphite.stack_position`, `file_provenance.origin_pr`

### PR Status Overview

Key fields: `pr_state`, `review_states.*`, `counts.*`, `last_activity_at`
