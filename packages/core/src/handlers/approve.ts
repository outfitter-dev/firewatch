/**
 * Handler for approving a pull request.
 *
 * Authenticates, submits an APPROVE review on the PR, and returns the
 * review metadata. Optionally includes a review comment body.
 */

import { AuthError, Result, ValidationError } from "@outfitter/contracts";

import { detectAuth } from "../auth";
import type { HandlerContext } from "./types";

// =============================================================================
// Types
// =============================================================================

/** Input parameters for the approve handler. */
export interface ApproveInput {
  /** PR number to approve */
  pr: number;
  /** Repository (owner/repo) */
  repo: string;
  /** Optional review comment body */
  body?: string | undefined;
}

/** Structured output from the approve handler. */
export interface ApproveOutput {
  /** Review node ID */
  id: string;
  /** URL to the review */
  url?: string | undefined;
}

// =============================================================================
// Handler
// =============================================================================

/**
 * Approve a pull request.
 *
 * Submits an APPROVE review via the GitHub REST API.
 *
 * @param input - PR number, repo, optional body
 * @param ctx - Handler context with config, db, logger
 * @returns Result with review ID and URL on success
 */
export async function approveHandler(
  input: ApproveInput,
  ctx: HandlerContext
): Promise<Result<ApproveOutput, Error>> {
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
    "approve",
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
