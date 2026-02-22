/**
 * Handler for requesting changes on a pull request.
 *
 * Authenticates, submits a REQUEST_CHANGES review on the PR, and returns
 * the review metadata.
 */

import { AuthError, Result, ValidationError } from "@outfitter/contracts";

import { detectAuth } from "../auth";
import type { HandlerContext } from "./types";

// =============================================================================
// Types
// =============================================================================

/** Input parameters for the reject handler. */
export interface RejectInput {
  /** PR number to request changes on */
  pr: number;
  /** Repository (owner/repo) */
  repo: string;
  /** Review comment body (required for REQUEST_CHANGES) */
  body: string;
}

/** Structured output from the reject handler. */
export interface RejectOutput {
  /** Review node ID */
  id: string;
  /** URL to the review */
  url?: string | undefined;
}

// =============================================================================
// Handler
// =============================================================================

/**
 * Request changes on a pull request.
 *
 * Submits a REQUEST_CHANGES review via the GitHub REST API. A body is
 * required by GitHub for change-request reviews.
 *
 * @param input - PR number, repo, body
 * @param ctx - Handler context with config, db, logger
 * @returns Result with review ID and URL on success
 */
export async function rejectHandler(
  input: RejectInput,
  ctx: HandlerContext
): Promise<Result<RejectOutput, Error>> {
  const authResult = await detectAuth(ctx.config.github_token);
  if (authResult.isErr()) {
    return Result.err(
      new AuthError({ message: authResult.error.message })
    );
  }

  const { GitHubClient } = await import("../github");
  const client = new GitHubClient(authResult.value.token);

  const parts = input.repo.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return Result.err(
      new ValidationError({ message: `Invalid repo format: ${input.repo}` })
    );
  }
  const [owner, repo] = parts;
  const reviewResult = await client.addReview(
    owner,
    repo,
    input.pr,
    "request-changes",
    input.body
  );

  if (reviewResult.isErr()) {
    return Result.err(reviewResult.error);
  }

  const review = reviewResult.value;
  if (!review) {
    return Result.ok({ id: "" });
  }

  return Result.ok({
    id: review.id,
    ...(review.url && { url: review.url }),
  });
}
