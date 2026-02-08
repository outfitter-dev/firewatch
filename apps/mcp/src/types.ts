export type SchemaName = "query" | "entry" | "worklist" | "config";

// Legacy type for internal handler compatibility
// Using `| undefined` explicitly for exactOptionalPropertyTypes compatibility
export interface FirewatchParams {
  action?: string | undefined;
  repo?: string | undefined;
  pr?: number | number[] | string | undefined;
  type?:
    | "comment"
    | "review"
    | "commit"
    | "ci"
    | "event"
    | ("comment" | "review" | "commit" | "ci" | "event")[]
    | string
    | undefined;
  author?: string | string[] | undefined;
  states?: ("open" | "closed" | "merged" | "draft")[] | undefined;
  state?: string | string[] | undefined;
  open?: boolean | undefined;
  ready?: boolean | undefined;
  closed?: boolean | undefined;
  draft?: boolean | undefined;
  label?: string | undefined;
  since?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
  summary?: boolean | undefined;
  summary_short?: boolean | undefined;
  orphaned?: boolean | undefined;
  stale?: boolean | undefined;
  status_short?: boolean | undefined;
  short?: boolean | undefined;
  all?: boolean | undefined;
  mine?: boolean | undefined;
  reviews?: boolean | undefined;
  no_bots?: boolean | undefined;
  no_sync?: boolean | undefined;
  sync_full?: boolean | undefined;
  body?: string | undefined;
  reply_to?: string | undefined;
  resolve?: boolean | undefined;
  comment_ids?: string[] | undefined;
  comment_id?: string | undefined;
  review?: "approve" | "request-changes" | "comment" | undefined;
  reviewer?: string | string[] | undefined;
  assignee?: string | string[] | undefined;
  labels?: string | string[] | undefined;
  title?: string | undefined;
  base?: string | undefined;
  milestone?: string | boolean | undefined;
  local?: boolean | undefined;
  path?: boolean | undefined;
  key?: string | undefined;
  value?: string | undefined;
  fix?: boolean | undefined;
  schema?: "query" | "entry" | "worklist" | "config" | undefined;
}

export interface McpToolResult {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
}
