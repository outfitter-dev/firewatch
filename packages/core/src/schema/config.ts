import { z } from "zod";

import { PrStateSchema } from "./entry";

/**
 * Filter configuration for excluding authors/bots.
 */
export const FiltersConfigSchema = z.object({
  /** Authors to exclude from queries (case-insensitive) */
  exclude_authors: z.array(z.string()).default([]),
  /** Additional bot patterns as regex strings (applied on top of defaults) */
  bot_patterns: z.array(z.string()).default([]),
  /** Exclude bots by default in queries */
  exclude_bots: z.boolean().default(false),
});

export type FiltersConfig = z.infer<typeof FiltersConfigSchema>;

/**
 * User-specific configuration.
 */
export const UserConfigSchema = z.object({
  /** GitHub username for perspective filtering (e.g., "mentions me") */
  github_username: z.string().optional(),
});

export type UserConfig = z.infer<typeof UserConfigSchema>;

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

  /** Staleness threshold for auto-sync before lookout (e.g., "1h", "30m") */
  lookout_stale_after: z.string().optional(),

  /** Filter configuration for excluding authors/bots */
  filters: FiltersConfigSchema.optional(),

  /** User-specific configuration */
  user: UserConfigSchema.optional(),
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
