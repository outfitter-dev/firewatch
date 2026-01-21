import { z } from "zod";

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
 * Feedback identification configuration.
 */
export const FeedbackConfigSchema = z.object({
  /**
   * Treat issue comments as addressed if the logged-in user has committed
   * to the PR after the comment was posted. Default: false (conservative).
   */
  commit_implies_read: z.boolean().default(false),
});

export type FeedbackConfig = z.infer<typeof FeedbackConfigSchema>;

/**
 * Sync behavior configuration.
 */
export const SyncConfigSchema = z.object({
  /** Auto-sync before queries */
  auto_sync: z.boolean().default(true),
  /** Re-sync if cache older than this threshold (e.g., "5m", "1h") */
  stale_threshold: z.string().optional(),
});

export type SyncConfig = z.infer<typeof SyncConfigSchema>;

/**
 * Output defaults.
 */
export const OutputConfigSchema = z.object({
  /** Default output format for CLI (human or json) */
  default_format: z.enum(["human", "json"]).optional(),
});

export type OutputConfig = z.infer<typeof OutputConfigSchema>;

/**
 * Firewatch configuration schema.
 * Stored in ~/.config/firewatch/config.toml (user) and .firewatch.toml (project)
 */
export const FirewatchConfigSchema = z.object({
  /** List of repositories to sync (owner/repo format) */
  repos: z.array(z.string()).default([]),

  /** GitHub personal access token (optional if gh CLI is authenticated) */
  github_token: z.string().optional(),

  /** Maximum number of PRs to fetch per sync */
  max_prs_per_sync: z.number().int().positive().default(100),
  /** Sync defaults */
  sync: SyncConfigSchema.optional(),
  /** Filter configuration for excluding authors/bots */
  filters: FiltersConfigSchema.optional(),
  /** Output defaults */
  output: OutputConfigSchema.optional(),
  /** User-specific configuration */
  user: UserConfigSchema.optional(),
  /** Feedback identification configuration */
  feedback: FeedbackConfigSchema.optional(),
});

export type FirewatchConfig = z.infer<typeof FirewatchConfigSchema>;

/**
 * Default configuration values.
 */
export const DEFAULT_CONFIG: FirewatchConfig = {
  repos: [],
  max_prs_per_sync: 100,
};
