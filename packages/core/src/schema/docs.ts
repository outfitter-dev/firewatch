export const ENTRY_SCHEMA_DOC = {
  name: "FirewatchEntry",
  description:
    "Denormalized PR activity record. Each JSONL line stands alone and is jq-friendly.",
  fields: {
    id: { type: "string", description: "Unique entry ID" },
    short_id: {
      type: "string",
      optional: true,
      description: "Short @id for comment entries",
    },
    repo: { type: "string", description: "owner/repo" },
    pr: { type: "number", description: "PR number" },
    pr_title: { type: "string" },
    pr_state: { type: "open | closed | merged | draft" },
    pr_author: { type: "string" },
    pr_branch: { type: "string" },
    pr_labels: { type: "string[]", optional: true },
    type: { type: "comment | review | commit | ci | event" },
    subtype: { type: "string", optional: true },
    author: { type: "string" },
    body: { type: "string", optional: true },
    state: { type: "string", optional: true },
    created_at: { type: "string", format: "date-time" },
    updated_at: { type: "string", format: "date-time", optional: true },
    captured_at: { type: "string", format: "date-time" },
    url: { type: "string", optional: true },
    file: { type: "string", optional: true },
    line: { type: "number", optional: true },
    file_activity_after: {
      type: "object",
      optional: true,
      fields: {
        modified: { type: "boolean" },
        commits_touching_file: { type: "number" },
        latest_commit: { type: "string", optional: true },
        latest_commit_at: {
          type: "string",
          format: "date-time",
          optional: true,
        },
      },
    },
    file_provenance: {
      type: "object",
      optional: true,
      fields: {
        origin_pr: { type: "number" },
        origin_branch: { type: "string" },
        origin_commit: { type: "string" },
        stack_position: { type: "number" },
      },
    },
    reactions: {
      type: "object",
      optional: true,
      fields: {
        thumbs_up_by: { type: "string[]" },
      },
    },
    graphite: {
      type: "object",
      optional: true,
      fields: {
        stack_id: { type: "string", optional: true },
        stack_position: { type: "number", optional: true },
        stack_size: { type: "number", optional: true },
        parent_pr: { type: "number", optional: true },
      },
    },
  },
};

export const WORKLIST_SCHEMA_DOC = {
  name: "WorklistEntry",
  description: "Aggregated per-PR summary derived from query results.",
  fields: {
    repo: { type: "string" },
    pr: { type: "number" },
    pr_title: { type: "string" },
    pr_state: { type: "open | closed | merged | draft" },
    pr_author: { type: "string" },
    pr_branch: { type: "string" },
    pr_labels: { type: "string[]", optional: true },
    last_activity_at: { type: "string", format: "date-time" },
    latest_activity_type: { type: "comment | review | commit | ci | event" },
    latest_activity_author: { type: "string" },
    counts: {
      type: "object",
      fields: {
        comments: { type: "number" },
        reviews: { type: "number" },
        commits: { type: "number" },
        ci: { type: "number" },
        events: { type: "number" },
      },
    },
    review_states: {
      type: "object",
      optional: true,
      fields: {
        approved: { type: "number" },
        changes_requested: { type: "number" },
        commented: { type: "number" },
        dismissed: { type: "number" },
      },
    },
    graphite: {
      type: "object",
      optional: true,
      fields: {
        stack_id: { type: "string", optional: true },
        stack_position: { type: "number", optional: true },
        stack_size: { type: "number", optional: true },
        parent_pr: { type: "number", optional: true },
      },
    },
  },
};

export const CONFIG_SCHEMA_DOC = {
  name: "FirewatchConfig",
  description: "Configuration schema for Firewatch.",
  fields: {
    repos: { type: "string[]", description: "Repositories to sync" },
    github_token: { type: "string", optional: true },
    max_prs_per_sync: { type: "number", optional: true },
    sync: {
      type: "object",
      optional: true,
      fields: {
        auto_sync: { type: "boolean", optional: true },
        stale_threshold: { type: "string", optional: true },
      },
    },
    filters: {
      type: "object",
      optional: true,
      fields: {
        exclude_authors: { type: "string[]", optional: true },
        bot_patterns: { type: "string[]", optional: true },
        exclude_bots: { type: "boolean", optional: true },
      },
    },
    output: {
      type: "object",
      optional: true,
      fields: {
        default_format: { type: "human | json", optional: true },
      },
    },
    user: {
      type: "object",
      optional: true,
      fields: {
        github_username: { type: "string", optional: true },
      },
    },
  },
};
