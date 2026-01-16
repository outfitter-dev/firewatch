import { DEFAULT_BOT_PATTERNS, isBot, isExcludedAuthor } from "./authors";
import { getDatabase } from "./cache";
import type { FirewatchPlugin } from "./plugins/types";
import { queryEntries as queryEntriesDb } from "./repository";
import type { FirewatchEntry, PrState } from "./schema/entry";

/**
 * Query filters.
 */
export interface QueryFilters {
  /** Filter by entry ID */
  id?: string;

  /** Filter by repository (partial match) */
  repo?: string;

  /** Filter by repository (exact match) */
  exactRepo?: string;

  /** Filter by PR number */
  pr?: number;

  /** Filter by multiple PR numbers */
  prs?: number[];

  /** Filter by author (exact match) */
  author?: string;

  /** Filter by entry type(s) */
  type?: FirewatchEntry["type"] | FirewatchEntry["type"][];

  /** Filter by PR states (e.g., ["open", "draft"]) */
  states?: PrState[];

  /** Filter by PR label (partial match) */
  label?: string;

  /** Filter by entries since this date */
  since?: Date;

  /** Custom plugin filters */
  custom?: Record<string, string>;

  /** Authors to exclude (case-insensitive) */
  excludeAuthors?: string[];

  /** Exclude entries from detected bots */
  excludeBots?: boolean;

  /** Custom bot patterns as RegExp (defaults to DEFAULT_BOT_PATTERNS) */
  botPatterns?: RegExp[];

  /**
   * Filter for orphaned comments: unresolved review comments on merged/closed PRs.
   * When true, returns only review_comment entries where thread_resolved = false
   * and PR state is merged or closed.
   */
  orphaned?: boolean;
}

/**
 * Query options.
 */
export interface QueryOptions {
  /** Filters to apply */
  filters?: QueryFilters;

  /** Plugins for custom filters */
  plugins?: FirewatchPlugin[];

  /** Limit number of results */
  limit?: number;

  /** Skip first N results */
  offset?: number;
}

function matchesCustomFilters(
  entry: FirewatchEntry,
  custom: Record<string, string> | undefined,
  plugins: FirewatchPlugin[]
): boolean {
  if (!custom) {
    return true;
  }

  for (const [key, value] of Object.entries(custom)) {
    for (const plugin of plugins) {
      const pluginFilters = plugin.queryFilters?.();
      const filterFn = pluginFilters?.[key];
      if (filterFn && !filterFn(entry, value)) {
        return false;
      }
    }
  }

  return true;
}

function matchesAuthorExclusions(
  entry: FirewatchEntry,
  filters: QueryFilters
): boolean {
  // Check explicit exclusion list
  if (
    filters.excludeAuthors &&
    filters.excludeAuthors.length > 0 &&
    isExcludedAuthor(entry.author, filters.excludeAuthors)
  ) {
    return false;
  }

  // Check bot patterns
  if (filters.excludeBots) {
    const patterns = filters.botPatterns ?? DEFAULT_BOT_PATTERNS;
    if (isBot(entry.author, patterns)) {
      return false;
    }
  }

  return true;
}

/**
 * Build database filters from query filters, excluding post-query filters.
 * This extracts only the filters that can be applied at the SQLite level.
 */
function buildDbFilters(filters: QueryFilters): QueryFilters {
  // Use spread syntax to avoid passing undefined values (exactOptionalPropertyTypes)
  return {
    ...(filters.id !== undefined && { id: filters.id }),
    ...(filters.repo !== undefined && { repo: filters.repo }),
    ...(filters.exactRepo !== undefined && { exactRepo: filters.exactRepo }),
    ...(filters.pr !== undefined && { pr: filters.pr }),
    ...(filters.prs !== undefined && { prs: filters.prs }),
    ...(filters.author !== undefined && { author: filters.author }),
    ...(filters.type !== undefined && { type: filters.type }),
    ...(filters.states !== undefined && { states: filters.states }),
    ...(filters.label !== undefined && { label: filters.label }),
    ...(filters.since !== undefined && { since: filters.since }),
    ...(filters.orphaned !== undefined && { orphaned: filters.orphaned }),
  };
}

/**
 * Query cached entries from SQLite database.
 *
 * Returns entries with current PR state from the prs table, fixing Issue #37
 * (--open returning merged PRs). The pr_state is computed from current PR
 * metadata which is updated on every sync.
 */
export function queryEntries(
  options: QueryOptions = {}
): Promise<FirewatchEntry[]> {
  const { filters = {}, plugins = [], limit, offset = 0 } = options;

  const db = getDatabase();

  // Build filters for the database query
  // Note: excludeAuthors, excludeBots, and custom filters are applied post-query
  const dbFilters = buildDbFilters(filters);

  // Query from SQLite with JOINs - pr_state is computed from current PR metadata
  let entries = queryEntriesDb(db, dbFilters);

  // Apply post-query filters not supported by SQLite
  // These include author exclusions (bots, explicit list) and custom plugin filters
  if (filters.excludeAuthors?.length || filters.excludeBots || filters.custom) {
    entries = entries.filter((entry) => {
      // Check author exclusions
      if (!matchesAuthorExclusions(entry, filters)) {
        return false;
      }
      // Check custom plugin filters
      return matchesCustomFilters(entry, filters.custom, plugins);
    });
  }

  // Apply offset and limit
  let result = entries.slice(offset);
  if (limit !== undefined) {
    result = result.slice(0, limit);
  }

  return Promise.resolve(result);
}

/**
 * Output entries as JSONL to stdout.
 */
export function outputJsonl(entries: FirewatchEntry[]): void {
  for (const entry of entries) {
    console.log(JSON.stringify(entry));
  }
}
