import { readdir } from "node:fs/promises";

import {
  PATHS,
  getRepoCachePath,
  parseRepoCacheFilename,
  readJsonl,
} from "./cache";
import type { FirewatchPlugin } from "./plugins/types";
import type { FirewatchEntry, PrState } from "./schema/entry";

/**
 * Query filters.
 */
export interface QueryFilters {
  /** Filter by entry ID */
  id?: string;

  /** Filter by repository (partial match) */
  repo?: string;

  /** Filter by PR number */
  pr?: number;

  /** Filter by author (exact match) */
  author?: string;

  /** Filter by entry type */
  type?: FirewatchEntry["type"];

  /** Filter by PR states (e.g., ["open", "draft"]) */
  states?: PrState[];

  /** Filter by PR label (partial match) */
  label?: string;

  /** Filter by entries since this date */
  since?: Date;

  /** Custom plugin filters */
  custom?: Record<string, string>;
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

/**
 * Get all cached repository names.
 */
async function getCachedRepos(): Promise<string[]> {
  try {
    const files = await readdir(PATHS.repos);
    return files
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => parseRepoCacheFilename(f.replace(".jsonl", "")));
  } catch {
    return [];
  }
}

/**
 * Apply filters to an entry.
 */
function matchesLabel(entry: FirewatchEntry, label?: string): boolean {
  if (!label) {
    return true;
  }
  const labelLower = label.toLowerCase();
  return (
    entry.pr_labels?.some((l) => l.toLowerCase().includes(labelLower)) ?? false
  );
}

function matchesStates(entry: FirewatchEntry, states?: PrState[]): boolean {
  if (!states || states.length === 0) {
    return true;
  }
  return states.includes(entry.pr_state);
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

function matchesFilters(
  entry: FirewatchEntry,
  filters: QueryFilters,
  plugins: FirewatchPlugin[]
): boolean {
  if (filters.repo && !entry.repo.includes(filters.repo)) {
    return false;
  }

  if (filters.id && entry.id !== filters.id) {
    return false;
  }

  if (filters.pr !== undefined && entry.pr !== filters.pr) {
    return false;
  }

  if (filters.author && entry.author !== filters.author) {
    return false;
  }

  if (filters.type && entry.type !== filters.type) {
    return false;
  }

  if (!matchesStates(entry, filters.states)) {
    return false;
  }

  if (!matchesLabel(entry, filters.label)) {
    return false;
  }

  if (filters.since && new Date(entry.created_at) < filters.since) {
    return false;
  }

  return matchesCustomFilters(entry, filters.custom, plugins);
}

/**
 * Query cached entries.
 */
export async function queryEntries(
  options: QueryOptions = {}
): Promise<FirewatchEntry[]> {
  const { filters = {}, plugins = [], limit, offset = 0 } = options;

  // Determine which repos to query
  let repos: string[];
  if (filters.repo) {
    const allRepos = await getCachedRepos();
    repos = allRepos.filter((r) => r.includes(filters.repo!));
  } else {
    repos = await getCachedRepos();
  }

  // Load and filter entries from all repos
  const allEntries: FirewatchEntry[] = [];

  for (const repo of repos) {
    const cachePath = getRepoCachePath(repo);
    const entries = await readJsonl<FirewatchEntry>(cachePath);

    for (const entry of entries) {
      if (matchesFilters(entry, filters, plugins)) {
        allEntries.push(entry);
      }
    }
  }

  // Sort by created_at descending
  allEntries.sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  // Apply offset and limit
  let result = allEntries.slice(offset);
  if (limit !== undefined) {
    result = result.slice(0, limit);
  }

  return result;
}

/**
 * Output entries as JSONL to stdout.
 */
export function outputJsonl(entries: FirewatchEntry[]): void {
  for (const entry of entries) {
    console.log(JSON.stringify(entry));
  }
}
