import { z } from "zod";

/**
 * Firewatch configuration schema.
 * Stored in ~/.config/firewatch/config.toml
 */
export const FirewatchConfigSchema = z.object({
  /** List of repositories to sync (owner/repo format) */
  repos: z.array(z.string()).default([]),

  /** GitHub personal access token (optional if gh CLI is authenticated) */
  github_token: z.string().optional(),

  /** Enable Graphite integration */
  graphite_enabled: z.boolean().default(false),

  /** Default time range for queries (e.g., "7d", "24h") */
  default_since: z.string().default("7d"),

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
  default_since: "7d",
  max_prs_per_sync: 100,
};
