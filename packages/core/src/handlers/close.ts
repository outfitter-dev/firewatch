/**
 * Handler for closing feedback: resolving review threads or closing PRs.
 *
 * Polymorphic: accepts a comment ID (resolves the thread) or a PR number
 * (closes the PR via GitHub API). Returns structured output for formatting.
 */

import { AuthError, NotFoundError, Result } from "@outfitter/contracts";

import { detectAuth } from "../auth";
import { queryEntries } from "../query";
import { formatDisplayId } from "../render/ids";
import {
  buildShortIdCache,
  classifyId,
  resolveShortId,
} from "../short-id";
import type { HandlerContext } from "./types";

// =============================================================================
// Types
// =============================================================================

/** Input parameters for the close handler. */
export interface CloseInput {
  /** ID to close — short ID, comment ID, or PR number */
  id: string;
  /** Repository (owner/repo) */
  repo: string;
  /** Comment body when closing (optional) */
  body?: string | undefined;
}

/** Structured output from the close handler. */
export interface CloseOutput {
  /** What was closed */
  type: "thread" | "pr";
  /** Whether it was successfully closed */
  ok: boolean;
  /** URL of the closed item */
  url?: string | undefined;
}

// =============================================================================
// Handler
// =============================================================================

/**
 * Close a review thread or PR.
 *
 * When the ID is a PR number, closes the PR via GitHub API.
 * When the ID is a comment ID (short or full), resolves the review thread
 * (or acks if it's an issue comment which cannot be resolved).
 *
 * @param input - Close input including ID and repo
 * @param ctx - Handler context with config, db, and logger
 * @returns Result containing CloseOutput on success
 */
export async function closeHandler(
  input: CloseInput,
  ctx: HandlerContext
): Promise<Result<CloseOutput, Error>> {
  const authResult = await detectAuth(ctx.config.github_token);
  if (authResult.isErr()) {
    return Result.err(
      new AuthError({ message: `Authentication required to close: ${authResult.error.message}` })
    );
  }

  const { GitHubClient } = await import("../github");
  const client = new GitHubClient(authResult.value.token);

  const repoParts = input.repo.split("/");
  const owner = repoParts[0] ?? "";
  const name = repoParts[1] ?? "";

  const idType = classifyId(input.id);

  // PR number: close the PR
  if (idType === "pr_number") {
    const prNum = Number.parseInt(input.id, 10);
    const prIdResult = await client.fetchPullRequestId(owner, name, prNum);
    if (prIdResult.isErr()) {
      return Result.err(
        new NotFoundError({
          message: `PR #${prNum} not found in ${input.repo}.`,
          resourceType: "pull_request",
          resourceId: String(prNum),
        })
      );
    }

    const closeResult = await client.closePullRequest(prIdResult.value);
    if (closeResult.isErr()) {
      return Result.err(closeResult.error);
    }

    ctx.logger.debug("PR closed", { pr: prNum, repo: input.repo });
    return Result.ok({ type: "pr", ok: true });
  }

  // Comment ID: resolve the review thread
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

  if (entry.subtype !== "review_comment") {
    // Issue comments cannot be resolved — acknowledge with reaction instead
    const reactionResult = await client.addReaction(commentId, "THUMBS_UP");
    if (reactionResult.isErr()) {
      ctx.logger.debug("Reaction already exists or failed", { commentId });
    }
    return Result.ok({ type: "thread", ok: true });
  }

  // Review comment: find and resolve the thread
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

  const resolveResult = await client.resolveReviewThread(threadId);
  if (resolveResult.isErr()) {
    return Result.err(resolveResult.error);
  }

  ctx.logger.debug("Thread resolved", { threadId, repo: input.repo });
  return Result.ok({ type: "thread", ok: true });
}
