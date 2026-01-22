import { createHash } from "node:crypto";

/**
 * Short ID configuration
 * 5 chars = 16^5 = 1,048,576 possibilities (vs 65,536 for 4 chars)
 */
const SHORT_ID_LENGTH = 5;

/**
 * Generate a deterministic 5-character short ID from a GitHub comment ID.
 * The hash includes the repo to avoid collisions across different repos.
 * Short IDs are prefixed with `@` when displayed (e.g., `@a7f3c`).
 *
 * @param commentId - Full GitHub comment ID (e.g., "IC_kwDOQ...")
 * @param repo - Repository in owner/repo format
 * @returns 5-character hex string (without `@` prefix)
 */
export function generateShortId(commentId: string, repo: string): string {
  return createHash("sha256")
    .update(`${repo}:${commentId}`)
    .digest("hex")
    .slice(0, SHORT_ID_LENGTH);
}

/**
 * Check if a string looks like a short ID (5-character hex string, optionally prefixed with `@`).
 */
export function isShortId(id: string): boolean {
  return /^@?[a-f0-9]{5}$/i.test(id);
}

/**
 * Strip the `@` prefix from a short ID if present.
 */
export function stripShortIdPrefix(id: string): string {
  return id.startsWith("@") ? id.slice(1) : id;
}

/**
 * Format a short ID with the `@` prefix for display.
 */
export function formatShortId(id: string): string {
  const stripped = stripShortIdPrefix(id);
  return `@${stripped}`;
}

/**
 * Check if a string looks like a full GitHub comment ID.
 * GitHub IDs typically start with prefixes like "IC_", "PRRC_", etc.
 */
export function isFullCommentId(id: string): boolean {
  // Full IDs are longer and start with uppercase prefix
  return /^[A-Z_]+[A-Za-z0-9_-]+$/.test(id) && id.length > 10;
}

/**
 * Check if a string looks like a PR number.
 */
export function isPrNumber(value: string): boolean {
  return /^\d+$/.test(value);
}

/**
 * Determines the type of ID provided.
 */
export type IdType = "pr_number" | "short_id" | "full_id" | "unknown";

export function classifyId(id: string): IdType {
  if (isPrNumber(id)) {
    return "pr_number";
  }
  if (isShortId(id)) {
    return "short_id";
  }
  if (isFullCommentId(id)) {
    return "full_id";
  }
  return "unknown";
}

/**
 * In-memory cache for short ID to full ID mapping.
 * Built from query results during the session.
 */
interface ShortIdMapping {
  shortId: string;
  fullId: string;
  repo: string;
  pr: number;
}

const shortIdCache = new Map<string, ShortIdMapping>();

/**
 * Register a short ID mapping in the cache.
 */
export function registerShortId(
  shortId: string,
  fullId: string,
  repo: string,
  pr: number
): void {
  shortIdCache.set(shortId, { shortId, fullId, repo, pr });
}

/**
 * Look up a full ID from a short ID.
 * Accepts short IDs with or without `@` prefix.
 * Returns null if not found in cache.
 */
export function resolveShortId(shortId: string): ShortIdMapping | null {
  const stripped = stripShortIdPrefix(shortId);
  return shortIdCache.get(stripped) ?? null;
}

/**
 * Clear the short ID cache.
 */
export function clearShortIdCache(): void {
  shortIdCache.clear();
}

/**
 * Get the current size of the short ID cache.
 */
export function getShortIdCacheSize(): number {
  return shortIdCache.size;
}

/**
 * Build short ID cache from entries.
 * Typically called after querying entries.
 */
export function buildShortIdCache(
  entries: { id: string; repo: string; pr: number }[]
): void {
  for (const entry of entries) {
    const shortId = generateShortId(entry.id, entry.repo);
    registerShortId(shortId, entry.id, entry.repo, entry.pr);
  }
}

/**
 * Result type for ID resolution that includes context.
 */
export interface ResolvedId {
  type: "pr" | "comment";
  pr?: number;
  commentId?: string;
  shortId?: string;
  repo?: string;
}

/**
 * Resolve an ID to its full context.
 * Handles PR numbers, short IDs, and full comment IDs.
 *
 * @param id - The ID to resolve (PR number, short ID, or full comment ID)
 * @returns Resolved ID with context, or null if unable to resolve
 */
export function resolveId(id: string): ResolvedId | null {
  const idType = classifyId(id);

  switch (idType) {
    case "pr_number": {
      const prNum = Number.parseInt(id, 10);
      if (Number.isNaN(prNum) || prNum <= 0) {
        return null;
      }
      return { type: "pr", pr: prNum };
    }

    case "short_id": {
      const mapping = resolveShortId(id);
      if (!mapping) {
        return null;
      }
      return {
        type: "comment",
        commentId: mapping.fullId,
        shortId: id,
        repo: mapping.repo,
        pr: mapping.pr,
      };
    }

    case "full_id":
      return {
        type: "comment",
        commentId: id,
      };

    default:
      return null;
  }
}
