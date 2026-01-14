import type { FirewatchEntry } from "./schema/entry";

/**
 * Default patterns for detecting bot accounts.
 * These patterns match common GitHub bot naming conventions.
 */
export const DEFAULT_BOT_PATTERNS = [
  /\[bot\]$/i, // GitHub Apps (e.g., "dependabot[bot]")
  /^github-actions/i, // GitHub Actions
  /-bot$/i, // Generic bot suffix
];

/**
 * Known bot accounts that don't match patterns.
 * These are explicitly listed because they don't follow standard naming.
 */
export const DEFAULT_EXCLUDE_AUTHORS = [
  "coderabbitai",
  "greptile-apps",
  "chatgpt-codex-connector",
  "dependabot",
  "renovate",
  "codecov",
  "netlify",
  "vercel",
];

/**
 * Check if an author matches bot patterns.
 */
export function isBot(
  author: string,
  patterns: readonly RegExp[] = DEFAULT_BOT_PATTERNS
): boolean {
  return patterns.some((pattern) => pattern.test(author));
}

/**
 * Check if an author is in an exclusion list (case-insensitive).
 */
export function isExcludedAuthor(
  author: string,
  excludeList: readonly string[]
): boolean {
  const authorLower = author.toLowerCase();
  return excludeList.some((excluded) => excluded.toLowerCase() === authorLower);
}

/**
 * Check if an author should be excluded based on bot patterns and exclusion list.
 */
export function shouldExcludeAuthor(
  author: string,
  options: {
    excludeList?: readonly string[];
    botPatterns?: readonly RegExp[];
    excludeBots?: boolean;
  } = {}
): boolean {
  const {
    excludeList = [],
    botPatterns = DEFAULT_BOT_PATTERNS,
    excludeBots = false,
  } = options;

  // Check explicit exclusion list first
  if (isExcludedAuthor(author, excludeList)) {
    return true;
  }

  // Check bot patterns if enabled
  if (excludeBots && isBot(author, botPatterns)) {
    return true;
  }

  return false;
}

/**
 * Author statistics from entry analysis.
 */
export interface AuthorStats {
  /** Author username */
  author: string;
  /** Total entry count */
  count: number;
  /** Entry counts by type */
  types: Record<string, number>;
  /** Whether the author is detected as a bot */
  isBot: boolean;
}

/**
 * Build an author index with statistics from entries.
 * Useful for analyzing activity distribution and identifying bots.
 */
export function buildAuthorIndex(
  entries: readonly FirewatchEntry[],
  botPatterns: readonly RegExp[] = DEFAULT_BOT_PATTERNS
): Map<string, AuthorStats> {
  const index = new Map<string, AuthorStats>();

  for (const entry of entries) {
    const existing = index.get(entry.author);
    if (existing) {
      existing.count++;
      existing.types[entry.type] = (existing.types[entry.type] ?? 0) + 1;
    } else {
      index.set(entry.author, {
        author: entry.author,
        count: 1,
        types: { [entry.type]: 1 },
        isBot: isBot(entry.author, botPatterns),
      });
    }
  }

  return index;
}

/**
 * Get author statistics sorted by entry count (descending).
 */
export function getAuthorStatsSorted(
  index: Map<string, AuthorStats>
): AuthorStats[] {
  return [...index.values()].toSorted((a, b) => b.count - a.count);
}

/**
 * Options for author-based filtering.
 */
export interface AuthorFilterOptions {
  /** Authors to explicitly exclude (case-insensitive) */
  excludeAuthors?: readonly string[];
  /** Exclude entries from detected bots */
  excludeBots?: boolean;
  /** Custom bot patterns (defaults to DEFAULT_BOT_PATTERNS) */
  botPatterns?: readonly RegExp[];
  /** Only include entries from this author (takes precedence) */
  onlyAuthor?: string;
}

/**
 * Filter entries by author criteria.
 * Used for post-query filtering when advanced author logic is needed.
 */
export function filterByAuthor(
  entries: readonly FirewatchEntry[],
  options: AuthorFilterOptions
): FirewatchEntry[] {
  const {
    excludeAuthors = [],
    excludeBots = false,
    botPatterns = DEFAULT_BOT_PATTERNS,
    onlyAuthor,
  } = options;

  return entries.filter((entry) => {
    // onlyAuthor filter takes precedence
    if (onlyAuthor && entry.author.toLowerCase() !== onlyAuthor.toLowerCase()) {
      return false;
    }

    // Skip exclusion checks if onlyAuthor is set
    if (onlyAuthor) {
      return true;
    }

    // Check exclusion criteria
    return !shouldExcludeAuthor(entry.author, {
      excludeList: excludeAuthors,
      botPatterns,
      excludeBots,
    });
  });
}

/**
 * Merge default bot exclusions with custom list.
 * Deduplicates and returns lowercase entries.
 */
export function mergeExcludeAuthors(
  custom: readonly string[] = [],
  includeDefaults = true
): string[] {
  const base = includeDefaults ? DEFAULT_EXCLUDE_AUTHORS : [];
  const all = [...base, ...custom];
  const unique = new Set(all.map((a) => a.toLowerCase()));
  return [...unique];
}
