/**
 * Handler for replying to a review thread comment.
 *
 * Resolves the target ID, finds the thread, posts a reply, and optionally
 * resolves the thread. Returns structured output for CLI/MCP formatting.
 */

import { AuthError, NotFoundError, Result } from "@outfitter/contracts";

import { detectAuth } from "../auth";
import { queryEntries } from "../query";
import { formatDisplayId } from "../render/ids";
import {
  buildShortIdCache,
  classifyId,
  generateShortId,
  resolveShortId,
} from "../short-id";
import type { HandlerContext } from "./types";

// =============================================================================
// Types
// =============================================================================

/** Input parameters for the reply handler. */
export interface ReplyInput {
  /** Thread ID to reply to — short ID (@abc), comment ID, or PR number */
  id: string;
  /** Reply body text */
  body: string;
  /** Repository (owner/repo) */
  repo: string;
  /** Optionally resolve the thread after replying */
  resolve?: boolean | undefined;
}

/** Structured output from the reply handler. */
export interface ReplyOutput {
  /** The created reply's node ID */
  id: string;
  /** URL to the reply */
  url?: string | undefined;
  /** Whether the thread was resolved */
  resolved?: boolean | undefined;
}

// =============================================================================
// Handler
// =============================================================================

/**
 * Reply to a review thread comment.
 *
 * Resolves the ID (short → full), locates the review thread, posts the reply,
 * and optionally resolves the thread. Returns a Result with reply metadata.
 *
 * @param input - Reply input including target ID, body, and repo
 * @param ctx - Handler context with config, db, and logger
 * @returns Result containing ReplyOutput on success
 */
export async function replyHandler(
  input: ReplyInput,
  ctx: HandlerContext
): Promise<Result<ReplyOutput, Error>> {
  const authResult = await detectAuth(ctx.config.github_token);
  if (authResult.isErr()) {
    return Result.err(
      new AuthError({ message: `Authentication required to reply: ${authResult.error.message}` })
    );
  }

  const { GitHubClient } = await import("../github");
  const client = new GitHubClient(authResult.value.token);

  const idType = classifyId(input.id);

  if (idType === "pr_number") {
    return Result.err(
      new NotFoundError({
        message: "Use commentHandler to comment on a PR by number. replyHandler expects a comment ID.",
        resourceType: "comment",
        resourceId: input.id,
      })
    );
  }

  // Load entries to resolve short ID
  const entries = await queryEntries({ filters: { repo: input.repo } });
  buildShortIdCache(entries);

  let commentId = input.id;
  if (idType === "short_id") {
    const mapping = resolveShortId(input.id);
    if (!mapping) {
      return Result.err(
        new NotFoundError({
          message: `Short ID ${formatDisplayId(input.id)} not found in cache.`,
          resourceType: "comment",
          resourceId: input.id,
        })
      );
    }
    commentId = mapping.fullId;
  }

  const entry = entries.find((e) => e.id === commentId);
  if (!entry) {
    return Result.err(
      new NotFoundError({
        message: `Comment ${input.id} not found in cache.`,
        resourceType: "comment",
        resourceId: input.id,
      })
    );
  }

  const repoParts = input.repo.split("/");
  const owner = repoParts[0] ?? "";
  const name = repoParts[1] ?? "";

  const threadMapResult = await client.fetchReviewThreadMap(owner, name, entry.pr);
  if (threadMapResult.isErr()) {
    return Result.err(threadMapResult.error);
  }

  const threadId = threadMapResult.value.get(commentId);
  if (!threadId) {
    return Result.err(
      new NotFoundError({
        message: `No review thread found for comment ${input.id}.`,
        resourceType: "thread",
        resourceId: commentId,
      })
    );
  }

  const replyResult = await client.addReviewThreadReply(threadId, input.body);
  if (replyResult.isErr()) {
    return Result.err(replyResult.error);
  }

  const reply = replyResult.value;

  const shortId = formatDisplayId(generateShortId(reply.id, input.repo));

  if (input.resolve) {
    const resolveResult = await client.resolveReviewThread(threadId);
    if (resolveResult.isErr()) {
      ctx.logger.warn("Failed to resolve thread after reply", {
        threadId,
        error: resolveResult.error.message,
      });
    }
  }

  return Result.ok({
    id: shortId,
    ...(reply.url && { url: reply.url }),
    ...(input.resolve && { resolved: true }),
  });
}
