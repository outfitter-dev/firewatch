import { z } from "zod";

import { GraphiteMetadataSchema } from "./entry";

/**
 * Lookout tracking metadata per repository.
 * Stored in ~/.cache/firewatch/lookout.jsonl
 */
export const LookoutMetadataSchema = z.object({
  repo: z.string(),
  last_lookout: z.string().datetime(),
});

export type LookoutMetadata = z.infer<typeof LookoutMetadataSchema>;

/**
 * An item requiring attention in the lookout summary.
 */
export const AttentionItemSchema = z.object({
  repo: z.string(),
  pr: z.number().int().positive(),
  pr_title: z.string(),
  pr_state: z.string(),
  pr_author: z.string(),
  last_activity_at: z.string().datetime(),
  reason: z.enum(["changes_requested", "no_reviews", "stale"]),
  graphite: GraphiteMetadataSchema.optional(),
});

export type AttentionItem = z.infer<typeof AttentionItemSchema>;

/**
 * Unaddressed feedback (review comments or issue comments from bots).
 */
export const UnaddressedFeedbackSchema = z.object({
  pr: z.number().int().positive(),
  pr_title: z.string(),
  comment_id: z.string(),
  author: z.string(),
  body: z.string().optional(),
  created_at: z.string().datetime(),
  file: z.string().optional(),
  line: z.number().int().positive().optional(),
  is_bot: z.boolean(),
});

export type UnaddressedFeedback = z.infer<typeof UnaddressedFeedbackSchema>;

/**
 * Lookout summary - aggregated view of PR activity needing attention.
 */
export const LookoutSummarySchema = z.object({
  repo: z.string(),
  period: z.object({
    since: z.string().datetime(),
    until: z.string().datetime(),
  }),
  counts: z.object({
    total_entries: z.number().int().nonnegative(),
    prs_active: z.number().int().nonnegative(),
    comments: z.number().int().nonnegative(),
    reviews: z.number().int().nonnegative(),
    commits: z.number().int().nonnegative(),
  }),
  attention: z.object({
    changes_requested: z.array(AttentionItemSchema),
    unreviewed: z.array(AttentionItemSchema),
    stale: z.array(AttentionItemSchema),
  }),
  unaddressed_feedback: z.array(UnaddressedFeedbackSchema),
  synced_at: z.string().datetime().optional(),
  first_run: z.boolean(),
});

export type LookoutSummary = z.infer<typeof LookoutSummarySchema>;
