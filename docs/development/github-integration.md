# GitHub Integration

> Internal notes on integrating with GitHub APIs for PR activity fetching.

## Overview

Firewatch fetches PR activity via GitHub's GraphQL API. This doc captures API patterns, rate limiting considerations, and data mapping decisions.

## Authentication

### Auth Chain

Firewatch uses adaptive auth (`src/core/auth.ts`):

1. **gh CLI** (preferred) — `gh auth token`
2. **Environment** — `GITHUB_TOKEN` or `GH_TOKEN`
3. **Config file** — `~/.config/firewatch/config.toml`

### Why gh CLI First

- Token is already authenticated and scoped
- Handles SSO/SAML automatically
- No token management for users who already have gh installed

## GraphQL API

### Primary Query

We fetch PR activity using the `pullRequests` connection with nested:

- `reviews` — Review submissions (approved, changes_requested, etc.)
- `comments` — Issue-style comments on the PR
- `reviewThreads.comments` — Inline review comments on code
- `commits.checkSuites.checkRuns` — CI status

### Pagination Strategy

- Use cursor-based pagination (`after: $cursor`)
- Store last sync metadata in the `sync_meta` table (SQLite)
- Incremental sync: start from most recent and stop at last sync time

### Rate Limiting

- GraphQL API: 5,000 points/hour
- Each query costs ~1 point base + 1 per 100 nodes
- Monitor via `X-RateLimit-Remaining` header
- Back off when remaining < 100

## Data Mapping

### PR Activity → JSONL Entries

Each GitHub object maps to a denormalized entry:

| GitHub Object              | Entry Type | Subtype               |
| -------------------------- | ---------- | --------------------- |
| `PullRequestReview`        | `review`   | `pull_request_review` |
| `IssueComment`             | `comment`  | `issue_comment`       |
| `PullRequestReviewComment` | `comment`  | `review_comment`      |
| `CheckRun`                 | `ci`       | `check_run`           |
| `Commit`                   | `commit`   | `commit`              |

### Denormalization

Each entry includes full PR context:

- `pr`, `pr_title`, `pr_state`, `pr_author`, `pr_branch`
- Enables filtering without joins
- Trade-off: larger cache, simpler queries

## Comment Threading

### GitHub's Model

- `PullRequestReviewComment` has `replyTo` field
- `reviewThreads` groups comments by conversation
- Resolution state is on the thread, not individual comments

### What We Capture

Current:

- Individual comments with `file`, `line`
- No threading or resolution

Proposed (see SCRATCHPAD.md):

- `comment_meta.in_reply_to` — Parent comment ID
- `comment_meta.resolved` — Thread resolution state
- `comment_meta.outdated` — Comment on outdated diff

## Suggestion Blocks

### GitHub Format

````markdown
```suggestion
const x = newValue;
` ` `
```
````

### Parsing Strategy

- Detect ` ```suggestion ` blocks in comment body
- Extract original line range from comment position
- Parse replacement text from block content
- Store in `comment_meta.suggestion`

## CI Status

### Check Runs vs Commit Status

GitHub has two CI systems:

- **Check Runs** — GitHub Actions, most modern CI
- **Commit Status** — Older integrations

We primarily use Check Runs. Consider adding Commit Status fallback for repos that still emit commit status events.

### Relevant Fields

```typescript
interface CiEntry {
  type: "ci";
  subtype: "check_run";
  state: "success" | "failure" | "pending" | "neutral" | "skipped";
  body?: string; // Failure message if available
}
```

## Webhook Alternative (Future)

For real-time updates, consider GitHub webhooks:

- `pull_request_review` — Review submitted
- `pull_request_review_comment` — Inline comment
- `check_run` — CI status change

Would require a server component or polling service.

## Testing

### Mock Responses

Store fixture responses in `tests/fixtures/github/`:

- `pr-with-reviews.json`
- `pr-with-comments.json`
- `pr-with-ci.json`

### Without Auth

For CI environments without GitHub auth:

- Skip integration tests
- Use mocked GraphQL responses
- Set `FIREWATCH_SKIP_GITHUB_TESTS=1`

## References

- [GitHub GraphQL API](https://docs.github.com/en/graphql)
- [Pull Request Object](https://docs.github.com/en/graphql/reference/objects#pullrequest)
- [gh CLI](https://cli.github.com/)
