import { readdir } from "node:fs/promises";

import type { FirewatchPlugin } from "../plugins/types";
import type { FirewatchEntry } from "../schema/entry";
import { PATHS, getRepoCachePath, readJsonl } from "./cache";

/**
 * Query filters.
 */
export interface QueryFilters {
  /** Filter by repository (partial match) */
  repo?: string;

  /** Filter by PR number */
  pr?: number;

  /** Filter by author (exact match) */
  author?: string;

  /** Filter by entry type */
  type?: FirewatchEntry["type"];

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
 * Parse a duration string like "24h", "7d" into a Date.
 */
export function parseSince(since: string): Date {
  const match = since.match(/^(\d+)(h|d|w|m)$/);
  if (!match) {
    throw new Error(
      `Invalid duration format: ${since}. Use format like 24h, 7d, 2w, 1m`
    );
  }

  const value = Number.parseInt(match[1]!, 10);
  const unit = match[2];

  const now = new Date();
  switch (unit) {
    case "h":
      now.setHours(now.getHours() - value);
      break;
    case "d":
      now.setDate(now.getDate() - value);
      break;
    case "w":
      now.setDate(now.getDate() - value * 7);
      break;
    case "m":
      now.setMonth(now.getMonth() - value);
      break;
  }

  return now;
}

/**
 * Get all cached repository names.
 */
async function getCachedRepos(): Promise<string[]> {
  try {
    const files = await readdir(PATHS.repos);
    return files
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => f.replace(".jsonl", "").replace("-", "/"));
  } catch {
    return [];
  }
}

/**
 * Apply filters to an entry.
 */
function matchesFilters(
  entry: FirewatchEntry,
  filters: QueryFilters,
  plugins: FirewatchPlugin[]
): boolean {
  if (filters.repo && !entry.repo.includes(filters.repo)) {
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

  if (filters.since && new Date(entry.created_at) < filters.since) {
    return false;
  }

  // Apply custom plugin filters
  if (filters.custom) {
    for (const [key, value] of Object.entries(filters.custom)) {
      for (const plugin of plugins) {
        const pluginFilters = plugin.queryFilters?.();
        const filterFn = pluginFilters?.[key];
        if (filterFn && !filterFn(entry, value)) {
          return false;
        }
      }
    }
  }

  return true;
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
