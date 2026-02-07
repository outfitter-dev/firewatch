import {
  classifyId,
  formatShortId,
  generateShortId,
  isShortId,
  resolveBatchIds,
  resolveShortId,
} from "@outfitter/firewatch-core";

import { resolveRepo } from "../context/repo";

/**
 * Resolve a short ID to a full GitHub comment ID.
 * Accepts short IDs with or without `@` prefix.
 * Returns the original ID if it's not a short ID or if resolution fails.
 */
export async function resolveCommentIdFromShortId(
  id: string,
  repo?: string
): Promise<string> {
  if (!isShortId(id)) {
    return id;
  }

  // First try the in-memory cache
  const cached = resolveShortId(id);
  if (cached) {
    return cached.fullId;
  }

  // If not in cache, use batch resolution (queries, builds cache, resolves)
  const repoFilter = repo ?? (await resolveRepo());
  if (!repoFilter) {
    throw new Error("Cannot resolve short ID without repo context.");
  }

  const [resolution] = await resolveBatchIds([id], repoFilter);

  if (resolution?.type === "comment" && resolution.entry) {
    return resolution.entry.id;
  }

  throw new Error(
    `Short ID ${formatShortId(id)} not found in cache. Run fw_query or fw_fb first.`
  );
}

export async function resolveCommentId(
  rawId: string,
  repo: string
): Promise<{ commentId: string; shortIdDisplay: string }> {
  const idType = classifyId(rawId);

  if (idType === "short_id") {
    // Use batch resolution (queries, builds cache, resolves)
    const [resolution] = await resolveBatchIds([rawId], repo);

    if (resolution?.type === "comment" && resolution.entry) {
      return {
        commentId: resolution.entry.id,
        shortIdDisplay: resolution.shortId ?? formatShortId(rawId),
      };
    }

    throw new Error(
      `Short ID ${formatShortId(rawId)} not found in cache. Run fw_query or fw_fb first.`
    );
  }

  if (idType === "full_id") {
    return {
      commentId: rawId,
      shortIdDisplay: formatShortId(generateShortId(rawId, repo)),
    };
  }

  throw new Error(`Invalid ID format: ${rawId}`);
}
