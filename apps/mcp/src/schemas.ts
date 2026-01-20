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
 * fw_query - Filter cached PR activity
 * ~300 tokens
 */
export const QueryParamsShape = {
  repo: repoSlug.optional(),
  pr: numberList.optional(),
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
 * fw_fb - Unified feedback operations (fw fb parity)
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

/**
 * fw_pr - PR mutations: edit fields, manage metadata, submit reviews
 * ~350 tokens
 */
export const PrParamsShape = {
  action: z.enum(["edit", "rm", "review"]),
  repo: repoSlug.optional(),
  pr: prNumber,
  // edit params
  title: z.string().optional(),
  body: z.string().optional(),
  base: z.string().optional(),
  milestone: z.union([z.string(), z.boolean()]).optional(),
  draft: z.boolean().optional(),
  ready: z.boolean().optional(),
  // metadata params (used by edit and rm)
  labels: stringList.optional(),
  label: z.string().optional(),
  reviewer: stringList.optional(),
  assignee: stringList.optional(),
  // review params (action=review)
  review: z.enum(["approve", "request-changes", "comment"]).optional(),
};

export const PrParamsSchema = z.object(PrParamsShape);
export type PrParams = z.infer<typeof PrParamsSchema>;

/**
 * fw_status - Show cache and auth status
 * ~100 tokens
 */
export const StatusParamsShape = {
  short: z.boolean().optional(),
  status_short: z.boolean().optional(), // Alias for short (consistency)
  /** Re-check auth and enable write tools if authenticated */
  recheck_auth: z.boolean().optional(),
};

export const StatusParamsSchema = z.object(StatusParamsShape);
export type StatusParams = z.infer<typeof StatusParamsSchema>;

/**
 * fw_doctor - Diagnose and fix issues
 * ~100 tokens
 */
export const DoctorParamsShape = {
  fix: z.boolean().optional(),
};

export const DoctorParamsSchema = z.object(DoctorParamsShape);
export type DoctorParams = z.infer<typeof DoctorParamsSchema>;

/**
 * fw_help - Usage documentation
 * ~100 tokens
 */
export const HelpParamsShape = {
  /** Show JSON schema for a specific type */
  schema: z.enum(["query", "entry", "worklist", "config"]).optional(),
  /** Show config value for key */
  config_key: z.string().optional(),
  /** Show config file path */
  config_path: z.boolean().optional(),
};

export const HelpParamsSchema = z.object(HelpParamsShape);
export type HelpParams = z.infer<typeof HelpParamsSchema>;

/**
 * Tool descriptions - kept concise for token efficiency.
 * Server instructions provide common context.
 */
export const TOOL_DESCRIPTIONS = {
  query:
    "Query cached PR activity. Filter by time (since), type (review/comment/commit), PR number, author, or state. Use summary=true for per-PR aggregation.",
  fb: "Unified feedback operations. PR-level: {pr} lists needs-attention, {pr, body} adds comment, {pr, ack} bulk acks. Comment-level: {id} views, {id, body} replies, {id, resolve} resolves, {id, ack} acks.",
  pr: "PR mutations. Actions: edit (title/body/base/draft/ready/milestone/labels/reviewers/assignees), rm (remove labels/reviewers/assignees/milestone), review (approve/request-changes/comment).",
  status:
    "Cache and auth status. Use short=true for compact output. Use recheck_auth=true to re-verify auth and enable write tools.",
  doctor: "Diagnose auth, cache, and repo issues. Use fix=true to auto-repair.",
  help: "Usage documentation. Use schema to show field definitions, config_key to show setting value, config_path for config file location.",
};
