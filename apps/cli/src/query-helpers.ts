/**
 * Shared query helper functions for CLI commands.
 *
 * These functions handle parsing, resolution, caching, and sync logic
 * used by both the root command and pr list command.
 */
import {
  ENTRY_TYPES,
  GitHubClient,
  PATHS,
  detectAuth,
  getAllSyncMeta,
  getDatabase,
  getRepos,
  getSyncMeta,
  mergeExcludeAuthors,
  parseDurationMs,
  parseRepoCacheFilename,
  parseSince,
  syncRepo,
  type FirewatchConfig,
  type FirewatchEntry,
  type PrState,
  type SyncScope,
} from "@outfitter/firewatch-core";
import {
  getGraphiteStacks,
  graphitePlugin,
} from "@outfitter/firewatch-core/plugins";
import { InvalidArgumentError } from "commander";
import { existsSync, readdirSync } from "node:fs";
import ora from "ora";

import { validateRepoFormat } from "./repo";

// ============================================================================
// Types
// ============================================================================

/**
 * Common options shared by query commands (root and pr list).
 */
export interface QueryCommandOptions {
  pr?: string | boolean;
  repo?: string;
  all?: boolean;
  mine?: boolean;
  reviews?: boolean;
  open?: boolean;
  ready?: boolean;
  closed?: boolean;
  draft?: boolean;
  orphaned?: boolean;
  stale?: boolean;
  state?: string;
  type?: string;
  label?: string;
  author?: string;
  excludeAuthor?: string;
  noBots?: boolean;
  since?: string;
  before?: string;
  syncFull?: boolean;
  sync?: boolean;
  limit?: number;
  offset?: number;
  summary?: boolean;
  includeFrozen?: boolean;
  jsonl?: boolean;
  json?: boolean;
  debug?: boolean;
  noColor?: boolean;
}

/**
 * Resolved author filter configuration.
 */
export interface AuthorFilters {
  includeAuthors: string[];
  excludeAuthors?: string[];
  excludeBots?: boolean;
  botPatterns?: RegExp[];
}

// ============================================================================
// Constants
// ============================================================================

export const DEFAULT_STALE_THRESHOLD = "5m";

// ============================================================================
// Global Options
// ============================================================================

/**
 * Apply global options like debug and color settings.
 */
export function applyGlobalOptions(options: QueryCommandOptions): void {
  if (options.noColor) {
    process.env.NO_COLOR = "1";
  }
  if (options.debug) {
    process.env.FIREWATCH_DEBUG = "1";
  }
}

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate and parse a limit value.
 * @throws InvalidArgumentError if the value is not a valid non-negative integer.
 */
export function validateLimit(value: string): number {
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n) || n < 0) {
    throw new InvalidArgumentError("Limit must be a non-negative integer");
  }
  return n;
}

/**
 * Validate a repo slug format.
 * @throws InvalidArgumentError if the value is empty or not in owner/repo format.
 */
export function validateRepoSlug(value: string): string {
  if (!value || !value.includes("/")) {
    throw new InvalidArgumentError("Repo must be in owner/repo format");
  }
  return value;
}

// ============================================================================
// Parsing Functions
// ============================================================================

/**
 * Check if a string is a full repo format (owner/repo).
 */
export function isFullRepo(value: string): boolean {
  return /^[^/]+\/[^/]+$/.test(value);
}

/**
 * Parse a comma-separated list of strings.
 */
export function parseCsvList(value?: string): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Parse PR numbers from string or boolean value.
 * Returns empty array for boolean true or undefined.
 */
export function parsePrList(value: string | boolean | undefined): number[] {
  if (!value || value === true) {
    return [];
  }
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const parsed = Number.parseInt(part, 10);
      if (Number.isNaN(parsed)) {
        throw new TypeError(`Invalid PR number: ${part}`);
      }
      return parsed;
    });
}

/**
 * Parse and validate entry types from comma-separated string.
 */
export function parseTypes(value?: string): FirewatchEntry["type"][] {
  const types = parseCsvList(value).map((type) => type.toLowerCase());
  if (types.length === 0) {
    return [];
  }
  const invalid = types.filter((t) => !ENTRY_TYPES.includes(t as never));
  if (invalid.length > 0) {
    throw new Error(
      `Invalid type(s): ${invalid.join(", ")}. Valid types: ${ENTRY_TYPES.join(", ")}`
    );
  }
  return types as FirewatchEntry["type"][];
}

/**
 * Parse author filters, separating includes from excludes (prefixed with !).
 */
export function parseAuthorFilters(value?: string): {
  include: string[];
  exclude: string[];
} {
  const items = parseCsvList(value);
  const include: string[] = [];
  const exclude: string[] = [];

  for (const item of items) {
    if (item.startsWith("!")) {
      const trimmed = item.slice(1).trim();
      if (trimmed) {
        exclude.push(trimmed);
      }
    } else {
      include.push(item);
    }
  }

  return { include, exclude };
}

// ============================================================================
// Resolution Functions
// ============================================================================

/**
 * Compile bot detection patterns from config.
 */
export function resolveBotPatterns(
  config: FirewatchConfig
): RegExp[] | undefined {
  const patterns = config.filters?.bot_patterns ?? [];
  if (patterns.length === 0) {
    return undefined;
  }
  const compiled: RegExp[] = [];
  for (const pattern of patterns) {
    try {
      compiled.push(new RegExp(pattern, "i"));
    } catch {
      // Ignore invalid regex patterns
    }
  }
  return compiled.length > 0 ? compiled : undefined;
}

/**
 * Resolve the effective since filter.
 * Priority: explicit option > orphaned default (7d) > undefined
 */
export function resolveSinceFilter(
  since: string | undefined,
  orphaned: boolean | undefined
): Date | undefined {
  const DEFAULT_ORPHANED_SINCE = "7d";
  if (since) {
    return parseSince(since);
  }
  if (orphaned) {
    return parseSince(DEFAULT_ORPHANED_SINCE);
  }
  return undefined;
}

/**
 * Resolve all author-related filters from options and config.
 */
export function resolveAuthorFilters(
  options: QueryCommandOptions,
  config: FirewatchConfig
): AuthorFilters {
  const { include, exclude } = parseAuthorFilters(options.author);
  const excludeBots = options.noBots || config.filters?.exclude_bots;
  const botPatterns = resolveBotPatterns(config);

  // Merge explicit --exclude-author with !name syntax exclusions
  const explicitExcludes = parseCsvList(options.excludeAuthor);
  const allExcludes = [...exclude, ...explicitExcludes];

  const configExclusions = config.filters?.exclude_authors ?? [];
  const mergedExclusions =
    excludeBots || allExcludes.length > 0 || configExclusions.length > 0
      ? mergeExcludeAuthors(
          [...configExclusions, ...allExcludes],
          excludeBots ?? false
        )
      : undefined;

  return {
    includeAuthors: include,
    ...(mergedExclusions && { excludeAuthors: mergedExclusions }),
    ...(excludeBots && { excludeBots }),
    ...(botPatterns && { botPatterns }),
  };
}

/**
 * Resolve repo filter from options and detected repo.
 */
export function resolveRepoFilter(
  options: QueryCommandOptions,
  detectedRepo: string | null
): string | undefined {
  if (options.repo) {
    validateRepoFormat(options.repo);
    return options.repo;
  }
  if (options.all) {
    return undefined;
  }
  return detectedRepo ?? undefined;
}

/**
 * Determine which repos to sync based on options and config.
 */
export function resolveReposToSync(
  options: QueryCommandOptions,
  config: FirewatchConfig,
  detectedRepo: string | null
): string[] {
  if (options.repo && isFullRepo(options.repo)) {
    return [options.repo];
  }

  if (options.all) {
    if (config.repos.length > 0) {
      return config.repos;
    }
    const cached = listCachedRepos();
    if (cached.length > 0) {
      return cached;
    }
  }

  if (detectedRepo) {
    return [detectedRepo];
  }

  return [];
}

function resolveSyncScopes(states?: PrState[]): SyncScope[] {
  if (!states || states.length === 0) {
    return ["open"];
  }

  const scopes = new Set<SyncScope>();
  for (const state of states) {
    if (state === "open" || state === "draft") {
      scopes.add("open");
    }
    if (state === "closed" || state === "merged") {
      scopes.add("closed");
    }
  }

  if (scopes.size === 0) {
    return ["open"];
  }

  const ordered: SyncScope[] = [];
  if (scopes.has("open")) {
    ordered.push("open");
  }
  if (scopes.has("closed")) {
    ordered.push("closed");
  }
  return ordered;
}

// ============================================================================
// Cache Utilities
// ============================================================================

/**
 * List all repos with cached data (from files and database).
 */
export function listCachedRepos(): string[] {
  const repos = new Set<string>();

  // From JSONL files
  if (existsSync(PATHS.repos)) {
    const files = readdirSync(PATHS.repos).filter((f) => f.endsWith(".jsonl"));
    for (const file of files) {
      const repo = parseRepoCacheFilename(file.replace(".jsonl", ""));
      if (repo) {
        repos.add(repo);
      }
    }
  }

  // From SQLite database
  const db = getDatabase();
  for (const repo of getRepos(db)) {
    repos.add(repo);
  }
  for (const meta of getAllSyncMeta(db)) {
    repos.add(meta.repo);
  }

  return [...repos].toSorted();
}

/**
 * Get sync metadata map for all repos.
 */
export function getSyncMetaMap(
  scope: SyncScope
): Map<string, { last_sync: string }> {
  const db = getDatabase();
  const allMeta = getAllSyncMeta(db).filter((meta) => meta.scope === scope);
  const map = new Map<string, { last_sync: string }>();
  for (const entry of allMeta) {
    map.set(entry.repo, { last_sync: entry.last_sync });
  }
  return map;
}

/**
 * Check if a repo has cached data.
 */
export function hasRepoCache(repo: string, scope: SyncScope): boolean {
  const db = getDatabase();
  const meta = getSyncMeta(db, repo, scope);
  return meta !== null;
}

/**
 * Check if cache is stale based on threshold duration.
 */
export function isStale(
  lastSync: string | undefined,
  threshold: string
): boolean {
  if (!lastSync) {
    return true;
  }

  let thresholdMs = 0;
  try {
    thresholdMs = parseDurationMs(threshold);
  } catch {
    thresholdMs = parseDurationMs(DEFAULT_STALE_THRESHOLD);
  }

  const last = new Date(lastSync).getTime();
  return Date.now() - last > thresholdMs;
}

/**
 * Ensure a single repo's cache is populated, syncing if needed.
 */
export async function ensureRepoCache(
  repo: string,
  config: FirewatchConfig,
  detectedRepo: string | null,
  scope: SyncScope,
  options: { full?: boolean } = {}
): Promise<{ synced: boolean }> {
  const auth = await detectAuth(config.github_token);
  if (!auth.token) {
    throw new Error(auth.error);
  }

  const client = new GitHubClient(auth.token);
  const useGraphite =
    detectedRepo === repo && (await getGraphiteStacks()) !== null;
  const plugins = useGraphite ? [graphitePlugin] : [];

  const spinner = ora({
    text: `Syncing ${repo} (${scope})...`,
    stream: process.stderr,
    isEnabled: process.stderr.isTTY,
  }).start();

  try {
    const result = await syncRepo(client, repo, {
      ...(options.full && { full: true }),
      scope,
      plugins,
    });
    spinner.succeed(`Synced ${repo} (${result.entriesAdded} entries)`);
  } catch (error) {
    spinner.fail(
      `Sync failed: ${error instanceof Error ? error.message : error}`
    );
    throw error;
  }

  return { synced: true };
}

/**
 * Ensure all repos in list have fresh caches, syncing as needed.
 *
 * Auto-sync is controlled by config.sync.auto_sync (default: true).
 * When enabled, repos are synced if cache is missing or stale.
 * Use `fw sync` for manual control over sync timing and options.
 */
export async function ensureFreshRepos(
  repos: string[],
  options: QueryCommandOptions,
  config: FirewatchConfig,
  detectedRepo: string | null,
  states?: PrState[]
): Promise<void> {
  if (repos.length === 0) {
    return;
  }

  const autoSync = config.sync?.auto_sync ?? true;
  if (options.sync === false) {
    return;
  }
  const forceFull = Boolean(options.syncFull);
  if (!autoSync && !forceFull) {
    return;
  }

  const scopes = resolveSyncScopes(states);
  const metaByScope = new Map<SyncScope, Map<string, { last_sync: string }>>();
  for (const scope of scopes) {
    metaByScope.set(scope, getSyncMetaMap(scope));
  }
  const threshold = config.sync?.stale_threshold ?? DEFAULT_STALE_THRESHOLD;

  for (const repo of repos) {
    if (!isFullRepo(repo)) {
      continue;
    }

    for (const scope of scopes) {
      const hasCache = hasRepoCache(repo, scope);
      const lastSync = metaByScope.get(scope)?.get(repo)?.last_sync;
      const needsSync = forceFull || !hasCache || isStale(lastSync, threshold);

      if (!needsSync) {
        continue;
      }

      await ensureRepoCache(repo, config, detectedRepo, scope, {
        ...(forceFull && { full: true }),
      });
    }
  }
}
