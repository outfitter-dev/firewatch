import { z } from "zod";

/**
 * Shared schema components used across multiple tools.
 * Keep these minimal to reduce token overhead.
 */

// Common primitives
const prNumber = z.number().int().positive();
const repoSlug = z.string();
const duration = z.string(); // e.g., "24h", "7d"

// List types (accept string or array for flexibility)
const stringList = z.union([z.string(), z.array(z.string())]);
const numberList = z.union([
  z.number().int().positive(),
  z.array(z.number().int().positive()),
  z.string(),
]);

/**
 * firewatch_query - Filter cached PR activity
 * ~300 tokens
 */
export const QueryParamsShape = {
  repo: repoSlug.optional(),
  pr: prNumber.optional(),
  prs: numberList.optional(),
  type: z
    .union([
      z.enum(["comment", "review", "commit", "ci", "event"]),
      z.array(z.enum(["comment", "review", "commit", "ci", "event"])),
      z.string(),
    ])
    .optional(),
  author: stringList.optional(),
  states: z.array(z.enum(["open", "closed", "merged", "draft"])).optional(),
  state: stringList.optional(),
  open: z.boolean().optional(),
  closed: z.boolean().optional(),
  draft: z.boolean().optional(),
  active: z.boolean().optional(),
  label: z.string().optional(),
  since: duration.optional(),
  limit: z.number().int().positive().optional(),
  offset: z.number().int().nonnegative().optional(),
  summary: z.boolean().optional(),
  summary_short: z.boolean().optional(),
  orphaned: z.boolean().optional(),
  all: z.boolean().optional(),
  mine: z.boolean().optional(),
  reviews: z.boolean().optional(),
  no_bots: z.boolean().optional(),
  offline: z.boolean().optional(),
  refresh: z.union([z.boolean(), z.literal("full")]).optional(),
};

export const QueryParamsSchema = z.object(QueryParamsShape);
export type QueryParams = z.infer<typeof QueryParamsSchema>;

/**
 * firewatch_status - Show cache and auth status
 * ~100 tokens
 */
export const StatusParamsShape = {
  short: z.boolean().optional(),
};

export const StatusParamsSchema = z.object(StatusParamsShape);
export type StatusParams = z.infer<typeof StatusParamsSchema>;

/**
 * firewatch_admin - Config, doctor, schema, help
 * ~200 tokens
 */
export const AdminParamsShape = {
  action: z.enum(["config", "doctor", "schema", "help"]),
  // config params
  key: z.string().optional(),
  path: z.boolean().optional(),
  // doctor params
  fix: z.boolean().optional(),
  // schema params
  schema: z.enum(["query", "entry", "worklist", "config"]).optional(),
};

export const AdminParamsSchema = z.object(AdminParamsShape);
export type AdminParams = z.infer<typeof AdminParamsSchema>;

/**
 * firewatch_pr - Edit PR fields, manage labels/reviewers/assignees
 * ~350 tokens
 */
export const PrParamsShape = {
  action: z.enum(["edit", "rm"]),
  repo: repoSlug.optional(),
  pr: prNumber,
  // edit params
  title: z.string().optional(),
  body: z.string().optional(),
  base: z.string().optional(),
  milestone: z.union([z.string(), z.boolean()]).optional(),
  draft: z.boolean().optional(),
  ready: z.boolean().optional(),
  // metadata params (used by both edit via add and rm)
  labels: stringList.optional(),
  label: z.string().optional(),
  reviewer: stringList.optional(),
  assignee: stringList.optional(),
};

export const PrParamsSchema = z.object(PrParamsShape);
export type PrParams = z.infer<typeof PrParamsSchema>;

/**
 * firewatch_review - Submit PR reviews
 * ~150 tokens
 */
export const ReviewParamsShape = {
  repo: repoSlug.optional(),
  pr: prNumber,
  review: z.enum(["approve", "request-changes", "comment"]),
  body: z.string().optional(),
};

export const ReviewParamsSchema = z.object(ReviewParamsShape);
export type ReviewParams = z.infer<typeof ReviewParamsSchema>;

/**
 * firewatch_add - Add comments and resolve threads
 * ~200 tokens
 */
export const AddParamsShape = {
  repo: repoSlug.optional(),
  pr: prNumber.optional(),
  body: z.string().optional(),
  /** Comment ID to reply to. Accepts short IDs (e.g., @a7f3c) or full GitHub IDs. */
  reply_to: z.string().optional(),
  resolve: z.boolean().optional(),
  /** Comment ID to close. Accepts short IDs (e.g., @a7f3c) or full GitHub IDs. */
  comment_id: z.string().optional(),
  /** Comment IDs to close. Accepts short IDs (e.g., @a7f3c) or full GitHub IDs. */
  comment_ids: z.array(z.string()).optional(),
  // metadata (labels/reviewers/assignees)
  labels: stringList.optional(),
  label: z.string().optional(),
  reviewer: stringList.optional(),
  assignee: stringList.optional(),
};

export const AddParamsSchema = z.object(AddParamsShape);
export type AddParams = z.infer<typeof AddParamsSchema>;

/**
 * Tool descriptions - kept concise for token efficiency.
 * Server instructions provide common context.
 */
export const TOOL_DESCRIPTIONS = {
  query:
    "Query cached PR activity. Filter by time (since), type (review/comment/commit), PR number, author, or state. Use summary=true for per-PR aggregation.",
  status:
    "Show firewatch status: auth, cache, repo detection. Use short=true for compact output.",
  admin:
    "Admin operations: config (view settings), doctor (diagnose issues), schema (output field docs), help.",
  pr: "Edit PR fields or remove metadata. Actions: edit (title/body/base/draft/ready/milestone), rm (labels/reviewers/assignees/milestone).",
  review: "Submit a PR review: approve, request-changes, or comment.",
  add: "Add comments to PRs. Use reply_to for thread replies (accepts short IDs like @a7f3c), resolve=true to close thread. Also supports adding labels/reviewers/assignees.",
  feedback:
    "Unified feedback operations. PR-level: {pr} lists needs-attention, {pr, all} lists all, {pr, body} adds comment, {pr, ack} bulk acks. Comment-level: {id} views, {id, body} replies, {id, resolve} resolves, {id, ack} acks.",
};

/**
 * firewatch_feedback - Unified feedback operations (fw fb parity)
 * ~250 tokens
 */
export const FeedbackParamsShape = {
  /** PR number for PR-level operations (list feedback, add comment, bulk ack) */
  pr: prNumber.optional(),
  /** Comment ID (short @a7f3c or full) for comment operations */
  id: z.string().optional(),
  /** Comment text for reply or new comment */
  body: z.string().optional(),
  /** Resolve thread (review_comment) or ack (issue_comment) */
  resolve: z.boolean().optional(),
  /** Acknowledge with thumbs-up reaction + local record */
  ack: z.boolean().optional(),
  /** Show all feedback including resolved/acked */
  all: z.boolean().optional(),
  /** Repository in owner/repo format */
  repo: repoSlug.optional(),
};

export const FeedbackParamsSchema = z.object(FeedbackParamsShape);
export type FeedbackParams = z.infer<typeof FeedbackParamsSchema>;

// Server instructions for future MCP SDK support:
// "GitHub PR activity tools. Outputs JSONL for jq. Cache auto-syncs. Use firewatch_admin action=schema for field reference."
