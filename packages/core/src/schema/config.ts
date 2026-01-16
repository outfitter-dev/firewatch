import { z } from "zod";

import { PrStateSchema } from "./entry";

/**
 * Firewatch configuration schema.
 * Stored in ~/.config/firewatch/config.toml (user) and .firewatch.toml (project)
 */
export const FirewatchConfigSchema = z.object({
  /** List of repositories to sync (owner/repo format) */
  repos: z.array(z.string()).default([]),

  /** GitHub personal access token (optional if gh CLI is authenticated) */
  github_token: z.string().optional(),

  /** Enable Graphite integration */
  graphite_enabled: z.boolean().default(false),

  /** Default to Graphite stack output */
  default_stack: z.boolean().default(false),

  /** Default time range for queries (e.g., "7d", "24h") */
  default_since: z.string().optional(),

  /** Default PR states for queries (e.g., ["open", "draft"]) */
  default_states: z.array(PrStateSchema).optional(),

  /** Maximum number of PRs to fetch per sync */
  max_prs_per_sync: z.number().int().positive().default(100),
});

export type FirewatchConfig = z.infer<typeof FirewatchConfigSchema>;

/**
 * Default configuration values.
 */
export const DEFAULT_CONFIG: FirewatchConfig = {
  repos: [],
  graphite_enabled: false,
  default_stack: false,
  max_prs_per_sync: 100,
};
