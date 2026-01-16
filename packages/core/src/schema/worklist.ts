import { z } from "zod";

import { EntryTypeSchema, GraphiteMetadataSchema, PrStateSchema } from "./entry";

export const WorklistCountsSchema = z.object({
  comments: z.number().int().nonnegative(),
  reviews: z.number().int().nonnegative(),
  commits: z.number().int().nonnegative(),
  ci: z.number().int().nonnegative(),
  events: z.number().int().nonnegative(),
});

export const WorklistReviewStatesSchema = z.object({
  approved: z.number().int().nonnegative(),
  changes_requested: z.number().int().nonnegative(),
  commented: z.number().int().nonnegative(),
  dismissed: z.number().int().nonnegative(),
});

export const WorklistEntrySchema = z.object({
  repo: z.string(),
  pr: z.number().int().positive(),
  pr_title: z.string(),
  pr_state: PrStateSchema,
  pr_author: z.string(),
  pr_branch: z.string(),
  pr_labels: z.array(z.string()).optional(),
  last_activity_at: z.string().datetime(),
  latest_activity_type: EntryTypeSchema,
  latest_activity_author: z.string(),
  counts: WorklistCountsSchema,
  review_states: WorklistReviewStatesSchema.optional(),
  graphite: GraphiteMetadataSchema.optional(),
});

export type WorklistEntry = z.infer<typeof WorklistEntrySchema>;
export type WorklistCounts = z.infer<typeof WorklistCountsSchema>;
export type WorklistReviewStates = z.infer<typeof WorklistReviewStatesSchema>;
