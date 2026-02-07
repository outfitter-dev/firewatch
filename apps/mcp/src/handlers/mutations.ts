import {
  GitHubClient,
  detectAuth,
  loadConfig,
} from "@outfitter/firewatch-core";

import {
  createMutationContext,
  type MutationContext,
} from "../context/mutation";
import { resolveRepo } from "../context/repo";
import type { FirewatchParams, McpToolResult } from "../types";
import { textResult } from "../utils/formatting";
import { resolveCommentIdFromShortId } from "../utils/id-resolution";
import { hasEditFields, requirePrNumber, toStringList } from "../utils/parsing";

async function handleAddReview(
  ctx: MutationContext,
  pr: number,
  reviewType: "approve" | "request-changes" | "comment",
  body?: string
): Promise<McpToolResult> {
  const reviewResult = await ctx.client.addReview(
    ctx.owner,
    ctx.name,
    pr,
    reviewType,
    body
  );
  if (reviewResult.isErr()) {
    throw new Error(reviewResult.error.message);
  }
  const review = reviewResult.value;
  return textResult(
    JSON.stringify({
      ok: true,
      repo: ctx.repo,
      pr,
      review: reviewType,
      ...(review?.id && { review_id: review.id }),
      ...(review?.url && { url: review.url }),
    })
  );
}

async function handleAddMetadata(
  ctx: MutationContext,
  pr: number,
  labels: string[],
  reviewers: string[],
  assignees: string[]
): Promise<McpToolResult> {
  if (labels.length > 0) {
    await ctx.client.addLabels(ctx.owner, ctx.name, pr, labels);
  }
  if (reviewers.length > 0) {
    await ctx.client.requestReviewers(ctx.owner, ctx.name, pr, reviewers);
  }
  if (assignees.length > 0) {
    await ctx.client.addAssignees(ctx.owner, ctx.name, pr, assignees);
  }

  return textResult(
    JSON.stringify({
      ok: true,
      repo: ctx.repo,
      pr,
      ...(labels.length > 0 && { labels_added: labels }),
      ...(reviewers.length > 0 && { reviewers_added: reviewers }),
      ...(assignees.length > 0 && { assignees_added: assignees }),
    })
  );
}

async function handleAddReply(
  ctx: MutationContext,
  pr: number,
  replyTo: string,
  body: string,
  shouldResolve: boolean
): Promise<McpToolResult> {
  const replyToId = await resolveCommentIdFromShortId(replyTo, ctx.repo);
  const threadMapResult = await ctx.client.fetchReviewThreadMap(
    ctx.owner,
    ctx.name,
    pr
  );
  if (threadMapResult.isErr()) {
    throw new Error(threadMapResult.error.message);
  }
  const threadId = threadMapResult.value.get(replyToId);
  if (!threadId) {
    throw new Error(`No review thread found for comment ${replyTo}.`);
  }

  const replyResult = await ctx.client.addReviewThreadReply(threadId, body);
  if (replyResult.isErr()) {
    throw new Error(replyResult.error.message);
  }
  const reply = replyResult.value;
  if (shouldResolve) {
    const resolveResult = await ctx.client.resolveReviewThread(threadId);
    if (resolveResult.isErr()) {
      throw new Error(resolveResult.error.message);
    }
  }

  return textResult(
    JSON.stringify({
      ok: true,
      repo: ctx.repo,
      pr,
      comment_id: reply.id,
      reply_to: replyToId,
      ...(shouldResolve && { resolved: true }),
      ...(reply.url && { url: reply.url }),
    })
  );
}

async function handleAddComment(
  ctx: MutationContext,
  pr: number,
  body: string
): Promise<McpToolResult> {
  const prIdResult = await ctx.client.fetchPullRequestId(
    ctx.owner,
    ctx.name,
    pr
  );
  if (prIdResult.isErr()) {
    throw new Error(prIdResult.error.message);
  }
  const commentResult = await ctx.client.addIssueComment(
    prIdResult.value,
    body
  );
  if (commentResult.isErr()) {
    throw new Error(commentResult.error.message);
  }
  const comment = commentResult.value;

  return textResult(
    JSON.stringify({
      ok: true,
      repo: ctx.repo,
      pr,
      comment_id: comment.id,
      ...(comment.url && { url: comment.url }),
    })
  );
}

export async function handleAdd(
  params: FirewatchParams
): Promise<McpToolResult> {
  if (params.resolve && !params.reply_to) {
    throw new Error("resolve requires reply_to.");
  }

  const pr = requirePrNumber(params.pr, "add");
  const ctx = await createMutationContext(params.repo);

  const labels = toStringList(params.labels ?? params.label);
  const reviewers = toStringList(params.reviewer);
  const assignees = toStringList(params.assignee);
  const hasMetadata =
    labels.length > 0 || reviewers.length > 0 || assignees.length > 0;
  const hasReview = Boolean(params.review);

  if (hasReview && hasMetadata) {
    throw new Error(
      "Review actions cannot be combined with label/reviewer/assignee updates."
    );
  }

  if (!hasReview && !hasMetadata && !params.body) {
    throw new Error("add requires body.");
  }

  if (hasMetadata && params.body) {
    throw new Error("Remove body when adding labels/reviewers/assignees.");
  }

  if (hasReview) {
    return handleAddReview(ctx, pr, params.review!, params.body);
  }

  if (hasMetadata) {
    return handleAddMetadata(ctx, pr, labels, reviewers, assignees);
  }

  const body = params.body ?? "";

  if (params.reply_to) {
    return handleAddReply(
      ctx,
      pr,
      params.reply_to,
      body,
      Boolean(params.resolve)
    );
  }

  return handleAddComment(ctx, pr, body);
}

async function applyPrFieldEdits(
  ctx: MutationContext,
  pr: number,
  params: { title?: string; body?: string; base?: string }
): Promise<void> {
  if (params.title || params.body || params.base) {
    await ctx.client.editPullRequest(ctx.owner, ctx.name, pr, {
      ...(params.title && { title: params.title }),
      ...(params.body && { body: params.body }),
      ...(params.base && { base: params.base }),
    });
  }
}

async function applyDraftStatus(
  ctx: MutationContext,
  pr: number,
  draft: boolean | undefined,
  ready: boolean | undefined
): Promise<void> {
  if (!draft && !ready) {
    return;
  }

  const prIdResult = await ctx.client.fetchPullRequestId(
    ctx.owner,
    ctx.name,
    pr
  );
  if (prIdResult.isErr()) {
    throw new Error(prIdResult.error.message);
  }
  if (draft) {
    const draftResult = await ctx.client.convertPullRequestToDraft(prIdResult.value);
    if (draftResult.isErr()) {
      throw new Error(draftResult.error.message);
    }
  }
  if (ready) {
    const readyResult = await ctx.client.markPullRequestReady(prIdResult.value);
    if (readyResult.isErr()) {
      throw new Error(readyResult.error.message);
    }
  }
}

export async function handleEdit(
  params: FirewatchParams
): Promise<McpToolResult> {
  if (params.draft && params.ready) {
    throw new Error("edit cannot use draft and ready together.");
  }

  const pr = requirePrNumber(params.pr, "edit");

  const milestoneName =
    typeof params.milestone === "string" ? params.milestone : undefined;
  if (params.milestone && !milestoneName) {
    throw new Error("edit milestone requires a string name.");
  }

  if (!hasEditFields(params)) {
    throw new Error("edit requires at least one field.");
  }

  const ctx = await createMutationContext(params.repo);

  await applyPrFieldEdits(ctx, pr, {
    ...(params.title !== undefined && { title: params.title }),
    ...(params.body !== undefined && { body: params.body }),
    ...(params.base !== undefined && { base: params.base }),
  });

  if (milestoneName) {
    await ctx.client.setMilestone(ctx.owner, ctx.name, pr, milestoneName);
  }

  await applyDraftStatus(ctx, pr, params.draft, params.ready);

  return textResult(
    JSON.stringify({
      ok: true,
      repo: ctx.repo,
      pr,
      ...(params.title && { title: params.title }),
      ...(params.body && { body: params.body }),
      ...(params.base && { base: params.base }),
      ...(milestoneName && { milestone: milestoneName }),
      ...(params.draft && { draft: true }),
      ...(params.ready && { ready: true }),
    })
  );
}

export async function handleRm(
  params: FirewatchParams
): Promise<McpToolResult> {
  const labels = toStringList(params.labels ?? params.label);
  const reviewers = toStringList(params.reviewer);
  const assignees = toStringList(params.assignee);
  const clearMilestone =
    params.milestone === true || typeof params.milestone === "string";
  const hasWork =
    labels.length > 0 ||
    reviewers.length > 0 ||
    assignees.length > 0 ||
    clearMilestone;

  if (!hasWork) {
    throw new Error("rm requires label, reviewer, assignee, or milestone.");
  }

  const pr = requirePrNumber(params.pr, "rm");

  const repo = (await resolveRepo(params.repo)) ?? null;
  if (!repo) {
    throw new Error("No repository detected. Provide repo.");
  }

  const [owner, name] = repo.split("/");
  if (!owner || !name) {
    throw new Error(`Invalid repo format: ${repo}. Expected owner/repo.`);
  }

  const config = await loadConfig();
  const auth = await detectAuth(config.github_token);
  if (auth.isErr()) {
    throw new Error(auth.error.message);
  }

  const client = new GitHubClient(auth.value.token);

  if (labels.length > 0) {
    await client.removeLabels(owner, name, pr, labels);
  }
  if (reviewers.length > 0) {
    await client.removeReviewers(owner, name, pr, reviewers);
  }
  if (assignees.length > 0) {
    await client.removeAssignees(owner, name, pr, assignees);
  }
  if (clearMilestone) {
    await client.clearMilestone(owner, name, pr);
  }

  return textResult(
    JSON.stringify({
      ok: true,
      repo,
      pr,
      ...(labels.length > 0 && { labels_removed: labels }),
      ...(reviewers.length > 0 && { reviewers_removed: reviewers }),
      ...(assignees.length > 0 && { assignees_removed: assignees }),
      ...(clearMilestone && { milestone_cleared: true }),
    })
  );
}
