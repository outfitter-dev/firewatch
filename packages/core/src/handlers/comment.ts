/**
 * Handler for adding a PR-level comment.
 *
 * Resolves the PR node ID and posts a new issue comment on the PR.
 * Returns structured output for CLI/MCP formatting.
 */

import { AuthError, NotFoundError, Result } from "@outfitter/contracts";

import { detectAuth } from "../auth";
import type { HandlerContext } from "./types";

// =============================================================================
// Types
// =============================================================================

/** Input parameters for the comment handler. */
export interface CommentInput {
  /** PR number */
  pr: number;
  /** Comment body text */
  body: string;
  /** Repository (owner/repo) */
  repo: string;
}

/** Structured output from the comment handler. */
export interface CommentOutput {
  /** The created comment's node ID */
  id: string;
  /** URL to the comment */
  url?: string | undefined;
}

// =============================================================================
// Handler
// =============================================================================

/**
 * Add a PR-level comment.
 *
 * Resolves the PR node ID via GitHub API and posts a new issue comment.
 * Returns structured metadata about the created comment.
 *
 * @param input - Comment input including PR number, body, and repo
 * @param ctx - Handler context with config, db, and logger
 * @returns Result containing CommentOutput on success
 */
export async function commentHandler(
  input: CommentInput,
  ctx: HandlerContext
): Promise<Result<CommentOutput, Error>> {
  const authResult = await detectAuth(ctx.config.github_token);
  if (authResult.isErr()) {
    return Result.err(
      new AuthError({ message: `Authentication required to comment: ${authResult.error.message}` })
    );
  }

  const { GitHubClient } = await import("../github");
  const client = new GitHubClient(authResult.value.token);

  const repoParts = input.repo.split("/");
  const owner = repoParts[0] ?? "";
  const name = repoParts[1] ?? "";

  const prIdResult = await client.fetchPullRequestId(owner, name, input.pr);
  if (prIdResult.isErr()) {
    return Result.err(
      new NotFoundError({
        message: `PR #${input.pr} not found in ${input.repo}.`,
        resourceType: "pull_request",
        resourceId: String(input.pr),
      })
    );
  }

  const commentResult = await client.addIssueComment(prIdResult.value, input.body);
  if (commentResult.isErr()) {
    return Result.err(commentResult.error);
  }

  const comment = commentResult.value;

  ctx.logger.debug("Comment added", { pr: input.pr, repo: input.repo, id: comment.id });

  return Result.ok({
    id: comment.id,
    ...(comment.url && { url: comment.url }),
  });
}
