/**
 * Handler for acknowledging feedback comments.
 *
 * Acknowledges one or more comments locally and optionally adds a thumbs-up
 * reaction on GitHub. Supports undo via the undo flag.
 */

import { NotFoundError, Result } from "@outfitter/contracts";

import { detectAuth } from "../auth";
import { type AckRecord, addAcks, isAcked, removeAck } from "../ack";
import {
  batchAddReactions,
  deduplicateByCommentId,
  partitionResolutions,
  resolveBatchIds,
} from "../batch";
import { formatDisplayId } from "../render/ids";
import { classifyId, generateShortId } from "../short-id";
import type { HandlerContext } from "./types";

// =============================================================================
// Types
// =============================================================================

/** Input parameters for the ack handler. */
export interface AckInput {
  /** IDs to acknowledge — short IDs, comment IDs, or PR numbers */
  ids: string[];
  /** Repository (owner/repo) */
  repo: string;
  /** Add thumbs-up reaction on GitHub */
  react?: boolean | undefined;
  /** Undo a previous ack */
  undo?: boolean | undefined;
}

/** Per-ID result for ack operations. */
export interface AckItemResult {
  /** Short display ID */
  id: string;
  /** Whether this operation succeeded */
  ok: boolean;
  /** Error message if not ok */
  error?: string | undefined;
}

/** Structured output from the ack handler. */
export interface AckOutput {
  /** Number of entries acknowledged (or un-acknowledged) */
  acked: number;
  /** Number of reactions added */
  reactionsAdded: number;
  /** Individual results per ID */
  results: AckItemResult[];
}

// =============================================================================
// Handler
// =============================================================================

/**
 * Acknowledge feedback comments, optionally adding GitHub reactions.
 *
 * Resolves each ID from the cache, checks ack status, and records acks locally.
 * When react=true, attempts to add a thumbs-up reaction (requires auth).
 * When undo=true, removes existing acks instead.
 *
 * @param input - Ack input including IDs, repo, and options
 * @param ctx - Handler context with config, db, and logger
 * @returns Result containing AckOutput on success
 */
export async function ackHandler(
  input: AckInput,
  ctx: HandlerContext
): Promise<Result<AckOutput, Error>> {
  if (input.ids.length === 0) {
    return Result.err(
      new NotFoundError({
        message: "At least one ID is required.",
        resourceType: "comment",
        resourceId: "",
      })
    );
  }

  // Filter out PR numbers (not supported in ack)
  const commentIds = input.ids.filter((id) => classifyId(id) !== "pr_number");
  if (commentIds.length === 0) {
    return Result.err(
      new NotFoundError({
        message: "No comment IDs provided. Use PR numbers with a dedicated bulk ack command.",
        resourceType: "comment",
        resourceId: input.ids[0] ?? "",
      })
    );
  }

  // Resolve all comment IDs in a single batch
  const resolutions = await resolveBatchIds(commentIds, input.repo);
  const { comments, errors } = partitionResolutions(resolutions);
  const uniqueComments = deduplicateByCommentId(comments);

  const itemResults: AckItemResult[] = [];

  // Collect error results
  for (const e of errors) {
    itemResults.push({
      id: e.id,
      ok: false,
      error: e.error ?? "Unknown error",
    });
  }

  if (uniqueComments.length === 0) {
    return Result.ok({
      acked: 0,
      reactionsAdded: 0,
      results: itemResults,
    });
  }

  // Handle undo: remove acks
  if (input.undo) {
    let removed = 0;
    for (const comment of uniqueComments) {
      const count = await removeAck(comment.id, input.repo);
      const shortId = comment.shortId ?? formatDisplayId(generateShortId(comment.id, input.repo));
      if (count > 0) {
        removed++;
        itemResults.push({ id: shortId, ok: true });
      } else {
        itemResults.push({ id: shortId, ok: false, error: "Not previously acknowledged." });
      }
    }
    return Result.ok({ acked: removed, reactionsAdded: 0, results: itemResults });
  }

  // Setup GitHub client for reactions if requested
  let client = null;
  if (input.react) {
    const authResult = await detectAuth(ctx.config.github_token);
    if (authResult.isOk()) {
      const { GitHubClient } = await import("../github");
      client = new GitHubClient(authResult.value.token);
    } else {
      ctx.logger.debug("No auth for reactions; acknowledging locally only.");
    }
  }

  // Check which are already acked
  const ackChecks = await Promise.all(
    uniqueComments.map(async (r) => {
      const alreadyAcked = await isAcked(r.id, input.repo);
      return { ...r, alreadyAcked };
    })
  );

  const toAck = ackChecks.filter((r) => !r.alreadyAcked);
  const alreadyAcked = ackChecks.filter((r) => r.alreadyAcked);

  // Add reactions in parallel for newly acked items
  const reactionResults =
    client && toAck.length > 0
      ? await batchAddReactions(toAck.map((r) => r.id), client)
      : toAck.map((r) => ({ commentId: r.id, reactionAdded: false }));

  const reactionMap = new Map(reactionResults.map((r) => [r.commentId, r.reactionAdded]));

  // Build and store ack records
  const ackRecords: AckRecord[] = toAck.map((r) => ({
    repo: input.repo,
    pr: r.entry?.pr ?? 0,
    comment_id: r.id,
    acked_at: new Date().toISOString(),
    ...(ctx.config.user?.github_username && { acked_by: ctx.config.user.github_username }),
    reaction_added: reactionMap.get(r.id) ?? false,
  }));

  if (ackRecords.length > 0) {
    await addAcks(ackRecords);
  }

  const reactionsAdded = reactionResults.filter((r) => r.reactionAdded).length;

  // Build per-ID results
  for (const r of toAck) {
    const shortId = r.shortId ?? formatDisplayId(generateShortId(r.id, input.repo));
    itemResults.push({ id: shortId, ok: true });
  }
  for (const r of alreadyAcked) {
    const shortId = r.shortId ?? formatDisplayId(generateShortId(r.id, input.repo));
    itemResults.push({ id: shortId, ok: true });
  }

  return Result.ok({
    acked: toAck.length,
    reactionsAdded,
    results: itemResults,
  });
}
