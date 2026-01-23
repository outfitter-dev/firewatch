import { z } from "zod";

/**
 * Graphite stack metadata for PRs that are part of a stack.
 */
export const GraphiteMetadataSchema = z.object({
  stack_id: z.string().optional(),
  stack_position: z.number().int().positive().optional(),
  stack_size: z.number().int().positive().optional(),
  parent_pr: z.number().int().positive().optional(),
});

export type GraphiteMetadata = z.infer<typeof GraphiteMetadataSchema>;

export const FileActivityAfterSchema = z.object({
  modified: z.boolean(),
  commits_touching_file: z.number().int().nonnegative(),
  latest_commit: z.string().optional(),
  latest_commit_at: z.string().datetime().optional(),
});

export type FileActivityAfter = z.infer<typeof FileActivityAfterSchema>;

export const FileProvenanceSchema = z.object({
  origin_pr: z.number().int().positive(),
  origin_branch: z.string(),
  origin_commit: z.string(),
  stack_position: z.number().int().positive(),
});

export type FileProvenance = z.infer<typeof FileProvenanceSchema>;

export const CommentReactionsSchema = z.object({
  thumbs_up_by: z.array(z.string()),
});

export type CommentReactions = z.infer<typeof CommentReactionsSchema>;

/**
 * PR state enum.
 */
export const PrStateSchema = z.enum(["open", "closed", "merged", "draft"]);

export type PrState = z.infer<typeof PrStateSchema>;

/**
 * Entry type enum.
 */
export const EntryTypeSchema = z.enum([
  "comment",
  "review",
  "commit",
  "ci",
  "event",
]);

export type EntryType = z.infer<typeof EntryTypeSchema>;

/**
 * Valid entry type values as a tuple.
 * Use this for validation: `ENTRY_TYPES.includes(value as EntryType)`
 */
export const ENTRY_TYPES = EntryTypeSchema.options;

/**
 * A single Firewatch entry - a fully denormalized record of PR activity.
 * Each line in the JSONL output is self-contained for jq queries.
 */
export const FirewatchEntrySchema = z.object({
  // Identity
  id: z.string(),
  database_id: z.number().int().positive().optional(), // REST API numeric ID (for comments)
  short_id: z.string().optional(),
  repo: z.string(),
  pr: z.number().int().positive(),

  // PR context (denormalized for jq queries)
  pr_title: z.string(),
  pr_state: PrStateSchema,
  pr_author: z.string(),
  pr_branch: z.string(),
  pr_labels: z.array(z.string()).optional(),

  // Entry data
  type: EntryTypeSchema,
  subtype: z.string().optional(),
  author: z.string(),
  author_login: z.string().optional(), // GitHub login (when available, e.g., for linked commit authors)
  body: z.string().optional(),
  state: z.string().optional(),

  // Timestamps
  created_at: z.string().datetime(),
  updated_at: z.string().datetime().optional(),
  captured_at: z.string().datetime(),

  // Metadata
  url: z.string().url().optional(),
  file: z.string().optional(),
  line: z.number().int().positive().optional(),
  file_activity_after: FileActivityAfterSchema.optional(),
  file_provenance: FileProvenanceSchema.optional(),
  reactions: CommentReactionsSchema.optional(),

  // Thread resolution (for review_comment entries)
  // true = resolved, false = unresolved, undefined = unknown/not applicable
  thread_resolved: z.boolean().optional(),

  // Plugin data
  graphite: GraphiteMetadataSchema.optional(),
});

export type FirewatchEntry = z.infer<typeof FirewatchEntrySchema>;

export type ReviewCommentEntry = Omit<
  FirewatchEntry,
  "type" | "subtype" | "file" | "line"
> & {
  type: "comment";
  subtype: "review_comment";
  file: string;
  line?: number;
  thread_resolved?: boolean;
  reactions?: CommentReactions;
};

export type IssueCommentEntry = Omit<
  FirewatchEntry,
  "type" | "subtype" | "file" | "line" | "thread_resolved"
> & {
  type: "comment";
  subtype: "issue_comment";
  reactions?: CommentReactions;
};

export type CommentEntry = ReviewCommentEntry | IssueCommentEntry;

export function isReviewComment(
  entry: FirewatchEntry
): entry is ReviewCommentEntry {
  return entry.type === "comment" && entry.subtype === "review_comment";
}

export function isIssueComment(
  entry: FirewatchEntry
): entry is IssueCommentEntry {
  return entry.type === "comment" && entry.subtype === "issue_comment";
}

export function isCommentEntry(entry: FirewatchEntry): entry is CommentEntry {
  return isReviewComment(entry) || isIssueComment(entry);
}

/**
 * Sync metadata for tracking incremental sync state per repository.
 */
export const SyncMetadataSchema = z.object({
  repo: z.string(),
  last_sync: z.string().datetime(),
  cursor: z.string().optional(),
  pr_count: z.number().int().nonnegative(),
});

export type SyncMetadata = z.infer<typeof SyncMetadataSchema>;
