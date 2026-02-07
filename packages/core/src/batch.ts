/**
 * Batch ID resolution and processing utilities.
 *
 * Consolidates common patterns for multi-ID operations:
 * - Query once, cache once, resolve all
 * - Parallel reaction adds
 * - Standardized ack record creation
 */

import type { AckRecord } from "./ack";
import type { GitHubClient } from "./github";
import { queryEntries } from "./query";
import type { FirewatchEntry, PrState } from "./schema";
import {
  buildShortIdCache,
  classifyId,
  formatShortId,
  generateShortId,
  resolveShortId,
} from "./short-id";

/**
 * Result of resolving a single ID in a batch operation.
 */
export interface BatchIdResolution {
  /** Original input ID */
  id: string;
  /** Type of resolution */
  type: "comment" | "pr" | "error";
  /** Resolved entry (for comments) */
  entry?: FirewatchEntry | undefined;
  /** Short ID display format (for comments) */
  shortId?: string | undefined;
  /** PR number (for PR type) */
  pr?: number | undefined;
  /** Error message (for error type) */
  error?: string | undefined;
}

/**
 * Result of a batch processing operation.
 */
export interface BatchProcessResult<T> {
  /** Successfully processed items */
  successful: { id: string; shortId: string; result: T }[];
  /** Failed items */
  failed: { id: string; error: string }[];
  /** Summary statistics */
  stats: { total: number; succeeded: number; failed: number };
}

/**
 * Options for batch ID resolution.
 */
export interface BatchResolveOptions {
  /** Entry type to filter by (default: "comment") */
  entryType?: "comment" | "all";
  /** Additional entry filters */
  filters?: {
    pr?: number | undefined;
    states?: PrState[] | undefined;
  };
}

/**
 * Resolve multiple IDs to their full context in a single operation.
 * Queries once, builds cache once, resolves all IDs.
 *
 * @param ids - Array of IDs to resolve (short IDs, full IDs, or PR numbers)
 * @param repo - Repository in owner/repo format
 * @param options - Resolution options
 * @returns Array of resolution results
 */
export async function resolveBatchIds(
  ids: string[],
  repo: string,
  options: BatchResolveOptions = {}
): Promise<BatchIdResolution[]> {
  const { entryType = "comment", filters = {} } = options;

  // Deduplicate IDs
  const uniqueIds = [...new Set(ids)];

  // Query entries once for all IDs
  const entries = await queryEntries({
    filters: {
      repo,
      ...(entryType !== "all" && { type: entryType }),
      ...(filters.pr !== undefined && { pr: filters.pr }),
      ...(filters.states && { states: filters.states }),
    },
  });

  // Build short ID cache once
  buildShortIdCache(entries);

  // Resolve each ID
  return uniqueIds.map((id) => resolveIdFromEntries(id, repo, entries));
}

/**
 * Resolve a single ID from a pre-loaded entry set.
 * Used internally by resolveBatchIds.
 */
function resolveIdFromEntries(
  id: string,
  repo: string,
  entries: FirewatchEntry[]
): BatchIdResolution {
  const idType = classifyId(id);

  // PR number - simple resolution
  if (idType === "pr_number") {
    const prNum = Number.parseInt(id, 10);
    if (Number.isNaN(prNum) || prNum <= 0) {
      return { id, type: "error", error: `Invalid PR number: ${id}` };
    }
    return { id, type: "pr", pr: prNum };
  }

  // Short ID - resolve via cache
  if (idType === "short_id") {
    const mapping = resolveShortId(id);
    if (!mapping) {
      return {
        id,
        type: "error",
        error: `Short ID ${formatShortId(id)} not found in cache`,
      };
    }

    const entry = entries.find((e) => e.id === mapping.fullId);
    if (!entry) {
      return {
        id,
        type: "error",
        error: `Entry for ${formatShortId(id)} not in cache`,
      };
    }

    return {
      id,
      type: "comment",
      entry,
      shortId: formatShortId(mapping.shortId),
    };
  }

  // Full ID - find directly in entries
  if (idType === "full_id") {
    const entry = entries.find((e) => e.id === id);
    if (!entry) {
      const shortDisplay = formatShortId(generateShortId(id, repo));
      return {
        id,
        type: "error",
        error: `Comment ${shortDisplay} not found in cache`,
      };
    }

    const shortId = formatShortId(generateShortId(entry.id, entry.repo));
    return {
      id,
      type: "comment",
      entry,
      shortId,
    };
  }

  return { id, type: "error", error: `Invalid ID format: ${id}` };
}

/**
 * Result of a single reaction add operation.
 */
export interface ReactionResult {
  /** Comment ID */
  commentId: string;
  /** Whether reaction was added */
  reactionAdded: boolean;
  /** Error message if failed */
  error?: string | undefined;
}

/**
 * Add reactions to multiple comments in parallel.
 *
 * @param commentIds - Array of comment IDs to react to
 * @param client - Authenticated GitHub client
 * @returns Array of reaction results
 */
export function batchAddReactions(
  commentIds: string[],
  client: GitHubClient
): Promise<ReactionResult[]> {
  return Promise.all(
    commentIds.map(async (commentId) => {
      const result = await client.addReaction(commentId, "THUMBS_UP");
      if (result.isErr()) {
        return {
          commentId,
          reactionAdded: false,
          error: result.error.message,
        };
      }
      return { commentId, reactionAdded: true };
    })
  );
}

/**
 * Options for building ack records.
 */
export interface BuildAckRecordsOptions {
  /** Repository in owner/repo format */
  repo: string;
  /** Username to record as acked_by */
  username?: string | undefined;
}

/**
 * Build standardized ack records from resolution results.
 *
 * @param items - Array of resolved comments with reaction results
 * @param options - Build options
 * @returns Array of ack records ready for storage
 */
export function buildAckRecords(
  items: {
    entry: FirewatchEntry;
    reactionAdded: boolean;
  }[],
  options: BuildAckRecordsOptions
): AckRecord[] {
  const { repo, username } = options;
  const now = new Date().toISOString();

  return items.map((item) => ({
    repo,
    pr: item.entry.pr,
    comment_id: item.entry.id,
    acked_at: now,
    ...(username && { acked_by: username }),
    reaction_added: item.reactionAdded,
  }));
}

/**
 * Format a comment ID as a short ID for display.
 * Convenience function combining generateShortId + formatShortId.
 *
 * @param commentId - Full GitHub comment ID
 * @param repo - Repository in owner/repo format
 * @returns Formatted short ID (e.g., \@abc12)
 */
export function formatCommentId(commentId: string, repo: string): string {
  return formatShortId(generateShortId(commentId, repo));
}

/**
 * Partition batch resolutions by type.
 */
export function partitionResolutions(resolutions: BatchIdResolution[]): {
  comments: BatchIdResolution[];
  prs: BatchIdResolution[];
  errors: BatchIdResolution[];
} {
  const comments: BatchIdResolution[] = [];
  const prs: BatchIdResolution[] = [];
  const errors: BatchIdResolution[] = [];

  for (const resolution of resolutions) {
    if (resolution.type === "comment") {
      comments.push(resolution);
    } else if (resolution.type === "pr") {
      prs.push(resolution);
    } else {
      errors.push(resolution);
    }
  }

  return { comments, prs, errors };
}

/**
 * Deduplicate resolutions by comment ID.
 * Different short IDs might resolve to the same comment.
 */
export function deduplicateByCommentId(
  resolutions: BatchIdResolution[]
): BatchIdResolution[] {
  const seen = new Set<string>();
  return resolutions.filter((r) => {
    if (!r.entry) {
      return true;
    }
    if (seen.has(r.entry.id)) {
      return false;
    }
    seen.add(r.entry.id);
    return true;
  });
}
