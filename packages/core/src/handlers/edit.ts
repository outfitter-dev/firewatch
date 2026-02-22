/**
 * Handler for editing a pull request or comment.
 *
 * Polymorphic: edits PR metadata (title, body, base, labels, milestone)
 * when given a PR number, or edits a comment body when given a comment ID.
 */

import {
  AuthError,
  NotFoundError,
  Result,
  ValidationError,
} from "@outfitter/contracts";

import { detectAuth } from "../auth";
import type { GitHubClient } from "../github";
import { getEntry } from "../repository";
import { classifyId, normalizeShortId, resolveShortId } from "../short-id";
import type { HandlerContext } from "./types";

// =============================================================================
// Types
// =============================================================================

/** Input parameters for the edit handler. */
export interface EditInput {
  /** Target ID — PR number, short ID (@abc), or comment ID */
  id: string;
  /** Repository (owner/repo) */
  repo: string;
  /** New PR title (PR edit only) */
  title?: string | undefined;
  /** New PR/comment body */
  body?: string | undefined;
  /** New base branch (PR edit only) */
  base?: string | undefined;
  /** Labels to add (PR edit only) */
  addLabels?: string[] | undefined;
  /** Labels to remove (PR edit only) */
  removeLabels?: string[] | undefined;
  /** Milestone name (PR edit only) */
  milestone?: string | undefined;
}

/** Structured output from the edit handler. */
export interface EditOutput {
  /** What was edited */
  type: "pr" | "comment";
  /** Whether the edit succeeded */
  ok: boolean;
}

// =============================================================================
// Handler
// =============================================================================

/**
 * Edit a pull request or comment.
 *
 * When the ID resolves to a PR number, edits PR metadata via the REST API.
 * When the ID resolves to a comment, edits the comment body.
 *
 * @param input - Target ID, repo, and fields to update
 * @param ctx - Handler context with config, db, logger
 * @returns Result indicating what was edited
 */
export async function editHandler(
  input: EditInput,
  ctx: HandlerContext
): Promise<Result<EditOutput, Error>> {
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

  // Determine if this is a PR number or a comment ID
  const idType = classifyId(input.id);

  if (idType === "pr_number") {
    return editPr(client, owner, repo, Number(input.id), input);
  }

  // Resolve short ID to comment ID
  let commentId = input.id;
  if (idType === "short_id") {
    const normalized = normalizeShortId(input.id);
    const resolved = resolveShortId(normalized);
    if (!resolved) {
      return Result.err(
        new NotFoundError({
          message: `Could not resolve short ID: ${input.id}`,
          resourceType: "entry",
          resourceId: input.id,
        })
      );
    }
    commentId = resolved.fullId;
  }

  return editComment(client, owner, repo, commentId, input, ctx);
}

async function editPr(
  client: GitHubClient,
  owner: string,
  repo: string,
  prNumber: number,
  input: EditInput
): Promise<Result<EditOutput, Error>> {
  const updates: { title?: string; body?: string; base?: string } = {};
  if (input.title) {
    updates.title = input.title;
  }
  if (input.body) {
    updates.body = input.body;
  }
  if (input.base) {
    updates.base = input.base;
  }

  if (Object.keys(updates).length === 0 && !input.addLabels && !input.removeLabels && !input.milestone) {
    return Result.err(
      new ValidationError({ message: "No fields to update" })
    );
  }

  if (Object.keys(updates).length > 0) {
    const editResult = await client.editPullRequest(owner, repo, prNumber, updates);
    if (editResult.isErr()) {
      return Result.err(editResult.error);
    }
  }

  // Handle labels
  if (input.addLabels?.length) {
    const addResult = await client.addLabels(owner, repo, prNumber, input.addLabels);
    if (addResult.isErr()) {
      return Result.err(addResult.error);
    }
  }
  if (input.removeLabels?.length) {
    const rmResult = await client.removeLabels(owner, repo, prNumber, input.removeLabels);
    if (rmResult.isErr()) {
      return Result.err(rmResult.error);
    }
  }

  // Handle milestone
  if (input.milestone) {
    const msResult = await client.setMilestone(owner, repo, prNumber, input.milestone);
    if (msResult.isErr()) {
      return Result.err(msResult.error);
    }
  }

  return Result.ok({ type: "pr", ok: true });
}

async function editComment(
  client: GitHubClient,
  owner: string,
  repo: string,
  commentId: string,
  input: EditInput,
  ctx: HandlerContext
): Promise<Result<EditOutput, Error>> {
  if (!input.body) {
    return Result.err(
      new ValidationError({ message: "Comment edit requires a body" })
    );
  }

  // Look up the entry to find the numeric comment ID for the REST API
  const entry = getEntry(ctx.db, commentId, `${owner}/${repo}`);
  if (!entry) {
    return Result.err(
      new NotFoundError({
        message: `Entry not found: ${commentId}`,
        resourceType: "entry",
        resourceId: commentId,
      })
    );
  }

  // Issue comments use numeric IDs from the REST API
  // The entry.id is the GraphQL node ID; we need the REST numeric ID
  // For now, use the GraphQL mutation approach via editIssueComment
  // which accepts the REST numeric comment ID
  const numericId = extractNumericId(entry.id);
  if (!numericId) {
    return Result.err(
      new ValidationError({
        message: `Cannot determine numeric ID for comment: ${entry.id}`,
      })
    );
  }

  const editResult = await client.editIssueComment(
    owner,
    repo,
    numericId,
    input.body
  );
  if (editResult.isErr()) {
    return Result.err(editResult.error);
  }

  return Result.ok({ type: "comment", ok: true });
}

/** Extract numeric ID from various GitHub ID formats. */
function extractNumericId(id: string): number | null {
  // Try direct numeric
  const num = Number(id);
  if (!Number.isNaN(num) && num > 0) {
    return num;
  }
  // Try extracting trailing number from node ID patterns
  const match = id.match(/(\d+)$/);
  return match ? Number(match[1]) : null;
}
