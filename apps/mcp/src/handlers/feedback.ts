import {
  DEFAULT_BOT_PATTERNS,
  DEFAULT_EXCLUDE_AUTHORS,
  addAck,
  addAcks,
  batchAddReactions,
  buildShortIdCache,
  formatShortId,
  generateShortId,
  getAckedIds,
  isCommentEntry,
  isReviewComment,
  queryEntries,
  shouldExcludeAuthor,
  type AckRecord,
  type FirewatchEntry,
} from "@outfitter/firewatch-core";

import {
  createFeedbackContext,
  type FeedbackContext,
} from "../context/feedback";
import type { FeedbackParams } from "../schemas";
import type { McpToolResult } from "../types";
import { jsonLines, textResult } from "../utils/formatting";
import { resolveCommentId } from "../utils/id-resolution";
import { requirePrNumber } from "../utils/parsing";

interface UnaddressedFeedback {
  repo: string;
  pr: number;
  pr_title: string;
  pr_branch: string;
  comment_id: string;
  author: string;
  body?: string | undefined;
  created_at: string;
  file?: string | undefined;
  line?: number | undefined;
  subtype?: string | undefined;
}

function isBot(author: string): boolean {
  return shouldExcludeAuthor(author, {
    excludeList: DEFAULT_EXCLUDE_AUTHORS,
    botPatterns: DEFAULT_BOT_PATTERNS,
    excludeBots: true,
  });
}

/**
 * Identify feedback that needs attention (unresolved review comments).
 * Filters to review_comment subtype only, excludes acked IDs.
 */
function identifyUnaddressedFeedback(
  entries: FirewatchEntry[],
  ackedIds: Set<string>
): UnaddressedFeedback[] {
  const commentEntries = entries.filter(isCommentEntry);

  // Build commit map for fallback heuristics
  const commitsByRepoPr = new Map<string, FirewatchEntry[]>();
  for (const entry of entries) {
    if (entry.type === "commit") {
      const key = `${entry.repo}:${entry.pr}`;
      const existing = commitsByRepoPr.get(key) ?? [];
      existing.push(entry);
      commitsByRepoPr.set(key, existing);
    }
  }

  const hasLaterCommit = (
    repo: string,
    pr: number,
    createdAt: string
  ): boolean => {
    const key = `${repo}:${pr}`;
    const prCommits = commitsByRepoPr.get(key) ?? [];
    const time = new Date(createdAt).getTime();
    return prCommits.some((c) => new Date(c.created_at).getTime() > time);
  };

  return commentEntries
    .filter((comment) => {
      // Exclude acknowledged comments
      if (ackedIds.has(comment.id)) {
        return false;
      }

      // Ignore bot-authored comments and self-comments from the PR author
      if (isBot(comment.author)) {
        return false;
      }
      if (comment.author.toLowerCase() === comment.pr_author.toLowerCase()) {
        return false;
      }

      // Thread resolution is authoritative for review comments
      if (isReviewComment(comment) && comment.thread_resolved !== undefined) {
        return !comment.thread_resolved;
      }

      // Treat thumbs-up from PR author as acknowledgement
      if (comment.reactions?.thumbs_up_by?.length) {
        const author = comment.pr_author.toLowerCase();
        const acked = comment.reactions.thumbs_up_by.some(
          (login) => login.toLowerCase() === author
        );
        if (acked) {
          return false;
        }
      }

      // Fallback heuristics
      if (comment.file_activity_after) {
        return !comment.file_activity_after.modified;
      }

      if (!("file" in comment) || !comment.file) {
        return !hasLaterCommit(comment.repo, comment.pr, comment.created_at);
      }

      return !hasLaterCommit(comment.repo, comment.pr, comment.created_at);
    })
    .map((e) => ({
      repo: e.repo,
      pr: e.pr,
      pr_title: e.pr_title,
      pr_branch: e.pr_branch,
      comment_id: e.id,
      author: e.author,
      ...(e.body && { body: e.body.slice(0, 200) }),
      created_at: e.created_at,
      ...("file" in e && e.file && { file: e.file }),
      ...("line" in e && e.line !== undefined && { line: e.line }),
      ...(e.subtype && { subtype: e.subtype }),
    }));
}

function formatFeedbackOutput(fb: UnaddressedFeedback, repo: string) {
  return {
    id: formatShortId(generateShortId(fb.comment_id, repo)),
    gh_id: fb.comment_id,
    repo: fb.repo,
    pr: fb.pr,
    pr_title: fb.pr_title,
    author: fb.author,
    ...(fb.body && { body: fb.body }),
    created_at: fb.created_at,
    ...(fb.file && { file: fb.file }),
    ...(fb.line !== undefined && { line: fb.line }),
  };
}

async function handleRepoFeedbackList(
  ctx: FeedbackContext
): Promise<McpToolResult> {
  const entries = await queryEntries({
    filters: { repo: ctx.repo, type: "comment" },
  });
  buildShortIdCache(entries);

  const ackedIds = await getAckedIds(ctx.repo);
  const feedbacks = identifyUnaddressedFeedback(entries, ackedIds);
  const filtered = feedbacks.filter((fb) => !isBot(fb.author));
  const output = filtered.map((fb) => formatFeedbackOutput(fb, ctx.repo));

  return textResult(jsonLines(output));
}

async function handlePrBulkAck(
  ctx: FeedbackContext,
  pr: number
): Promise<McpToolResult> {
  const entries = await queryEntries({ filters: { repo: ctx.repo, pr } });
  buildShortIdCache(entries);

  const ackedIds = await getAckedIds(ctx.repo);
  const feedbacks = identifyUnaddressedFeedback(entries, ackedIds);
  const prFeedbacks = feedbacks
    .filter((fb) => fb.pr === pr)
    .filter((fb) => !isBot(fb.author));

  if (prFeedbacks.length === 0) {
    return textResult(
      JSON.stringify({ ok: true, repo: ctx.repo, pr, acked_count: 0 })
    );
  }

  // Add reactions in parallel using batch utility
  const commentIds = prFeedbacks.map((fb) => fb.comment_id);
  const reactionResults = await batchAddReactions(commentIds, ctx.client);

  // Build reaction map for ack records
  const reactionMap = new Map(
    reactionResults.map((r) => [r.commentId, r.reactionAdded])
  );

  const now = new Date().toISOString();
  const ackRecords: AckRecord[] = prFeedbacks.map((fb) => ({
    repo: ctx.repo,
    pr,
    comment_id: fb.comment_id,
    acked_at: now,
    ...(ctx.config.user?.github_username && {
      acked_by: ctx.config.user.github_username,
    }),
    reaction_added: reactionMap.get(fb.comment_id) ?? false,
  }));
  await addAcks(ackRecords);

  const reactionsAdded = reactionResults.filter((r) => r.reactionAdded).length;

  return textResult(
    JSON.stringify({
      ok: true,
      repo: ctx.repo,
      pr,
      acked_count: prFeedbacks.length,
      reactions_added: reactionsAdded,
    })
  );
}

async function handlePrAddComment(
  ctx: FeedbackContext,
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
  const shortId = formatShortId(generateShortId(comment.id, ctx.repo));

  return textResult(
    JSON.stringify({
      ok: true,
      repo: ctx.repo,
      pr,
      id: shortId,
      gh_id: comment.id,
      ...(comment.url && { url: comment.url }),
    })
  );
}

async function handlePrListFeedback(
  ctx: FeedbackContext,
  pr: number,
  showAll: boolean
): Promise<McpToolResult> {
  const entries = await queryEntries({ filters: { repo: ctx.repo, pr } });
  buildShortIdCache(entries);

  if (showAll) {
    const comments = entries.filter((e) => e.type === "comment");
    const output = comments.map((c) => ({
      id: formatShortId(generateShortId(c.id, ctx.repo)),
      gh_id: c.id,
      repo: c.repo,
      pr: c.pr,
      author: c.author,
      subtype: c.subtype,
      ...(c.body && { body: c.body.slice(0, 200) }),
      created_at: c.created_at,
      ...(c.file && { file: c.file }),
      ...(c.line !== undefined && { line: c.line }),
      ...(c.thread_resolved !== undefined && {
        thread_resolved: c.thread_resolved,
      }),
    }));
    return textResult(jsonLines(output));
  }

  const ackedIds = await getAckedIds(ctx.repo);
  const feedbacks = identifyUnaddressedFeedback(entries, ackedIds);
  const prFeedbacks = feedbacks
    .filter((fb) => fb.pr === pr)
    .filter((fb) => !isBot(fb.author));

  const output = prFeedbacks.map((fb) => formatFeedbackOutput(fb, ctx.repo));
  return textResult(jsonLines(output));
}

function handlePrFeedback(
  ctx: FeedbackContext,
  params: FeedbackParams
): Promise<McpToolResult> {
  const pr = requirePrNumber(params.pr, "feedback");

  if (params.ack) {
    return handlePrBulkAck(ctx, pr);
  }

  if (params.body) {
    return handlePrAddComment(ctx, pr, params.body);
  }

  return handlePrListFeedback(ctx, pr, Boolean(params.all));
}

async function ackWithReaction(
  ctx: FeedbackContext,
  commentId: string,
  pr: number
): Promise<{ reactionAdded: boolean }> {
  let reactionAdded = false;
  try {
    await ctx.client.addReaction(commentId, "THUMBS_UP");
    reactionAdded = true;
  } catch {
    // Continue with local ack
  }

  const ackRecord: AckRecord = {
    repo: ctx.repo,
    pr,
    comment_id: commentId,
    acked_at: new Date().toISOString(),
    ...(ctx.config.user?.github_username && {
      acked_by: ctx.config.user.github_username,
    }),
    reaction_added: reactionAdded,
  };
  await addAck(ackRecord);

  return { reactionAdded };
}

async function handleCommentAck(
  ctx: FeedbackContext,
  commentId: string,
  shortIdDisplay: string,
  entry: FirewatchEntry
): Promise<McpToolResult> {
  const { reactionAdded } = await ackWithReaction(ctx, commentId, entry.pr);

  return textResult(
    JSON.stringify({
      ok: true,
      repo: ctx.repo,
      pr: entry.pr,
      id: shortIdDisplay,
      gh_id: commentId,
      acked: true,
      reaction_added: reactionAdded,
    })
  );
}

async function handleCommentResolve(
  ctx: FeedbackContext,
  commentId: string,
  shortIdDisplay: string,
  entry: FirewatchEntry
): Promise<McpToolResult> {
  if (entry.subtype !== "review_comment") {
    const { reactionAdded } = await ackWithReaction(ctx, commentId, entry.pr);

    return textResult(
      JSON.stringify({
        ok: true,
        repo: ctx.repo,
        pr: entry.pr,
        id: shortIdDisplay,
        gh_id: commentId,
        acked: true,
        reaction_added: reactionAdded,
        note: "Issue comments cannot be resolved, acknowledged instead.",
      })
    );
  }

  const threadMapResult = await ctx.client.fetchReviewThreadMap(
    ctx.owner,
    ctx.name,
    entry.pr
  );
  if (threadMapResult.isErr()) {
    throw new Error(threadMapResult.error.message);
  }
  const threadId = threadMapResult.value.get(commentId);

  if (!threadId) {
    throw new Error(`No review thread found for comment ${shortIdDisplay}.`);
  }

  const resolveResult = await ctx.client.resolveReviewThread(threadId);
  if (resolveResult.isErr()) {
    throw new Error(resolveResult.error.message);
  }

  return textResult(
    JSON.stringify({
      ok: true,
      repo: ctx.repo,
      pr: entry.pr,
      id: shortIdDisplay,
      gh_id: commentId,
      thread_id: threadId,
      resolved: true,
    })
  );
}

async function handleCommentReply(
  ctx: FeedbackContext,
  params: FeedbackParams,
  commentId: string,
  shortIdDisplay: string,
  entry: FirewatchEntry
): Promise<McpToolResult> {
  const body = params.body!;

  if (entry.subtype === "review_comment") {
    const threadMapResult = await ctx.client.fetchReviewThreadMap(
      ctx.owner,
      ctx.name,
      entry.pr
    );
    if (threadMapResult.isErr()) {
      throw new Error(threadMapResult.error.message);
    }
    const threadId = threadMapResult.value.get(commentId);

    if (!threadId) {
      throw new Error(`No review thread found for comment ${shortIdDisplay}.`);
    }

    const replyResult = await ctx.client.addReviewThreadReply(threadId, body);
    if (replyResult.isErr()) {
      throw new Error(replyResult.error.message);
    }
    const reply = replyResult.value;

    if (params.resolve) {
      const resolveResult = await ctx.client.resolveReviewThread(threadId);
      if (resolveResult.isErr()) {
        throw new Error(resolveResult.error.message);
      }
    }

    const replyShortId = formatShortId(generateShortId(reply.id, ctx.repo));

    return textResult(
      JSON.stringify({
        ok: true,
        repo: ctx.repo,
        pr: entry.pr,
        id: replyShortId,
        gh_id: reply.id,
        reply_to: shortIdDisplay,
        reply_to_gh_id: commentId,
        ...(params.resolve && { resolved: true }),
        ...(reply.url && { url: reply.url }),
      })
    );
  }

  const prIdResult = await ctx.client.fetchPullRequestId(
    ctx.owner,
    ctx.name,
    entry.pr
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
  const newShortId = formatShortId(generateShortId(comment.id, ctx.repo));

  return textResult(
    JSON.stringify({
      ok: true,
      repo: ctx.repo,
      pr: entry.pr,
      id: newShortId,
      gh_id: comment.id,
      in_reply_to: shortIdDisplay,
      in_reply_to_gh_id: commentId,
      ...(comment.url && { url: comment.url }),
    })
  );
}

function viewComment(
  shortIdDisplay: string,
  entry: FirewatchEntry
): McpToolResult {
  return textResult(
    JSON.stringify({
      id: shortIdDisplay,
      gh_id: entry.id,
      repo: entry.repo,
      pr: entry.pr,
      pr_title: entry.pr_title,
      author: entry.author,
      subtype: entry.subtype,
      ...(entry.body && { body: entry.body }),
      created_at: entry.created_at,
      ...(entry.file && { file: entry.file }),
      ...(entry.line !== undefined && { line: entry.line }),
      ...(entry.thread_resolved !== undefined && {
        thread_resolved: entry.thread_resolved,
      }),
    })
  );
}

async function handleCommentFeedback(
  ctx: FeedbackContext,
  params: FeedbackParams
): Promise<McpToolResult> {
  const { commentId, shortIdDisplay } = await resolveCommentId(
    params.id!,
    ctx.repo
  );

  const entries = await queryEntries({
    filters: { repo: ctx.repo, id: commentId },
  });
  const entry = entries[0];

  if (!entry) {
    throw new Error(`Comment ${shortIdDisplay} not found.`);
  }

  if (params.ack && !params.body && !params.resolve) {
    return handleCommentAck(ctx, commentId, shortIdDisplay, entry);
  }

  if (params.resolve && !params.body) {
    return handleCommentResolve(ctx, commentId, shortIdDisplay, entry);
  }

  if (params.body) {
    return handleCommentReply(ctx, params, commentId, shortIdDisplay, entry);
  }

  return viewComment(shortIdDisplay, entry);
}

export async function handleFeedback(
  params: FeedbackParams
): Promise<McpToolResult> {
  const ctx = await createFeedbackContext(params);

  const hasPr = params.pr !== undefined;
  const hasId = params.id !== undefined;

  if (!hasPr && !hasId) {
    return handleRepoFeedbackList(ctx);
  }

  if (hasPr && !hasId) {
    return handlePrFeedback(ctx, params);
  }

  return handleCommentFeedback(ctx, params);
}
