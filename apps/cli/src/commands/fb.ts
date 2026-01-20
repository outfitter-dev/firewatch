import {
  GitHubClient,
  addAck,
  addAcks,
  buildShortIdCache,
  classifyId,
  detectAuth,
  formatShortId,
  generateShortId,
  getAckedIds,
  loadConfig,
  queryEntries,
  resolveShortId,
  type AckRecord,
  type FirewatchConfig,
} from "@outfitter/firewatch-core";
import { Command } from "commander";

import {
  identifyUnaddressedFeedback,
  type UnaddressedFeedback,
} from "../actionable";
import { parseRepoInput, resolveRepoOrThrow } from "../repo";
import { writeJsonLine } from "../utils/json";
import { shouldOutputJson } from "../utils/tty";

interface FbCommandOptions {
  repo?: string;
  todo?: boolean;
  all?: boolean;
  ack?: boolean;
  resolve?: boolean;
  json?: boolean;
}

interface FbContext {
  client: GitHubClient;
  config: FirewatchConfig;
  repo: string;
  owner: string;
  name: string;
  outputJson: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Output formatting
// ─────────────────────────────────────────────────────────────────────────────

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) {
    return str;
  }
  return `${str.slice(0, maxLen - 1)}…`;
}

function formatFeedbackItem(fb: UnaddressedFeedback, repo: string): string {
  const shortId = generateShortId(fb.comment_id, repo);
  const location = fb.file ? `${fb.file}:${fb.line ?? "?"}` : "(comment)";
  const bodyPreview = fb.body
    ? truncate(fb.body.replaceAll("\n", " "), 60)
    : "";
  return `[${formatShortId(shortId)}] @${fb.author} ${location}\n  "${bodyPreview}"`;
}

function printFeedbackSummary(
  pr: number,
  prTitle: string,
  feedbacks: UnaddressedFeedback[],
  repo: string
): void {
  console.log(`\nPR #${pr}: ${truncate(prTitle, 50)}`);
  console.log("─".repeat(50));

  if (feedbacks.length === 0) {
    console.log("No unaddressed feedback.");
    return;
  }

  for (const fb of feedbacks) {
    console.log("");
    console.log(formatFeedbackItem(fb, repo));
  }

  console.log("");
  console.log(`${feedbacks.length} need attention`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Handlers
// ─────────────────────────────────────────────────────────────────────────────

async function handleListAll(
  ctx: FbContext,
  _options: FbCommandOptions
): Promise<void> {
  const entries = await queryEntries({
    filters: {
      repo: ctx.repo,
      type: "comment",
    },
  });

  buildShortIdCache(entries);

  // Load acked IDs to filter out acknowledged feedback
  const ackedIds = await getAckedIds(ctx.repo);
  const feedbacks = identifyUnaddressedFeedback(entries, { ackedIds });

  if (ctx.outputJson) {
    for (const fb of feedbacks) {
      const shortId = formatShortId(generateShortId(fb.comment_id, ctx.repo));
      const { comment_id: gh_id, ...rest } = fb;
      await writeJsonLine({ ...rest, id: shortId, gh_id });
    }
    return;
  }

  if (feedbacks.length === 0) {
    console.log("No unaddressed feedback across repository.");
    return;
  }

  // Group by PR
  const byPr = new Map<number, UnaddressedFeedback[]>();
  for (const fb of feedbacks) {
    const list = byPr.get(fb.pr) ?? [];
    list.push(fb);
    byPr.set(fb.pr, list);
  }

  for (const [pr, prFeedbacks] of byPr) {
    const title = prFeedbacks[0]?.pr_title ?? "";
    printFeedbackSummary(pr, title, prFeedbacks, ctx.repo);
  }
}

async function handlePrList(
  ctx: FbContext,
  pr: number,
  options: FbCommandOptions
): Promise<void> {
  const entries = await queryEntries({
    filters: {
      repo: ctx.repo,
      pr,
    },
  });

  buildShortIdCache(entries);

  if (options.all) {
    // Show all comments, not just unaddressed
    const comments = entries.filter((e) => e.type === "comment");
    if (ctx.outputJson) {
      for (const c of comments) {
        const shortId = formatShortId(generateShortId(c.id, ctx.repo));
        const { id: gh_id, ...rest } = c;
        await writeJsonLine({ ...rest, id: shortId, gh_id });
      }
      return;
    }

    const prTitle = entries[0]?.pr_title ?? `PR #${pr}`;
    console.log(`\nPR #${pr}: ${truncate(prTitle, 50)}`);
    console.log("─".repeat(50));

    for (const c of comments) {
      const shortId = generateShortId(c.id, ctx.repo);
      const location = c.file ? `${c.file}:${c.line ?? "?"}` : "(comment)";
      const resolved = c.thread_resolved ? " ✓" : "";
      console.log(
        `\n[${formatShortId(shortId)}] @${c.author} ${location}${resolved}`
      );
      if (c.body) {
        console.log(`  "${truncate(c.body.replaceAll("\n", " "), 60)}"`);
      }
    }

    console.log(`\n${comments.length} total comments`);
    return;
  }

  // Default: show unaddressed feedback only
  const ackedIds = await getAckedIds(ctx.repo);
  const feedbacks = identifyUnaddressedFeedback(entries, { ackedIds });
  const prFeedbacks = feedbacks.filter((fb) => fb.pr === pr);

  if (ctx.outputJson) {
    for (const fb of prFeedbacks) {
      const shortId = formatShortId(generateShortId(fb.comment_id, ctx.repo));
      const { comment_id: gh_id, ...rest } = fb;
      await writeJsonLine({ ...rest, id: shortId, gh_id });
    }
    return;
  }

  const prTitle = entries[0]?.pr_title ?? `PR #${pr}`;
  printFeedbackSummary(pr, prTitle, prFeedbacks, ctx.repo);
}

async function handlePrComment(
  ctx: FbContext,
  pr: number,
  body: string
): Promise<void> {
  const prId = await ctx.client.fetchPullRequestId(ctx.owner, ctx.name, pr);
  const comment = await ctx.client.addIssueComment(prId, body);

  const shortId = formatShortId(generateShortId(comment.id, ctx.repo));
  const payload = {
    ok: true,
    repo: ctx.repo,
    pr,
    id: shortId,
    gh_id: comment.id,
    ...(comment.url && { url: comment.url }),
  };

  if (ctx.outputJson) {
    await writeJsonLine(payload);
  } else {
    console.log(
      `Added comment to ${ctx.repo}#${pr}. [${formatShortId(shortId)}]`
    );
    if (comment.url) {
      console.log(comment.url);
    }
  }
}

async function handleViewComment(
  ctx: FbContext,
  commentId: string,
  shortId: string | null
): Promise<void> {
  const entries = await queryEntries({
    filters: {
      repo: ctx.repo,
      id: commentId,
    },
  });

  const entry = entries[0];
  if (!entry) {
    console.error(`Comment ${shortId ?? commentId} not found.`);
    process.exit(1);
  }

  const sId = shortId ?? generateShortId(entry.id, ctx.repo);

  if (ctx.outputJson) {
    const { id: gh_id, ...rest } = entry;
    await writeJsonLine({ ...rest, id: formatShortId(sId), gh_id });
    return;
  }

  const location = entry.file
    ? `${entry.file}:${entry.line ?? "?"}`
    : "(comment)";
  const resolved = entry.thread_resolved ? " (resolved)" : "";

  console.log(
    `\n[${formatShortId(sId)}] @${entry.author} ${location}${resolved}`
  );
  console.log(`PR #${entry.pr}: ${entry.pr_title}`);
  console.log(`Created: ${entry.created_at}`);
  if (entry.body) {
    console.log(`\n${entry.body}`);
  }
}

async function handleReplyToComment(
  ctx: FbContext,
  commentId: string,
  body: string,
  options: FbCommandOptions
): Promise<void> {
  // First, get the entry to determine the type
  const entries = await queryEntries({
    filters: {
      repo: ctx.repo,
      id: commentId,
    },
  });

  const entry = entries[0];
  if (!entry) {
    console.error(`Comment ${commentId} not found.`);
    process.exit(1);
  }

  // Check if this is a review comment (has a thread)
  if (entry.subtype === "review_comment") {
    // Get thread ID and reply to thread
    const threadMap = await ctx.client.fetchReviewThreadMap(
      ctx.owner,
      ctx.name,
      entry.pr
    );
    const threadId = threadMap.get(commentId);

    if (!threadId) {
      console.error(`No review thread found for comment ${commentId}.`);
      process.exit(1);
    }

    const reply = await ctx.client.addReviewThreadReply(threadId, body);

    if (options.resolve) {
      await ctx.client.resolveReviewThread(threadId);
    }

    const replyShortId = formatShortId(generateShortId(reply.id, ctx.repo));
    const replyToShortId = formatShortId(generateShortId(commentId, ctx.repo));
    const payload = {
      ok: true,
      repo: ctx.repo,
      pr: entry.pr,
      id: replyShortId,
      gh_id: reply.id,
      reply_to: replyToShortId,
      reply_to_gh_id: commentId,
      ...(options.resolve && { resolved: true }),
      ...(reply.url && { url: reply.url }),
    };

    if (ctx.outputJson) {
      await writeJsonLine(payload);
    } else {
      const resolveMsg = options.resolve ? " and resolved thread" : "";
      console.log(
        `Replied to ${replyToShortId}${resolveMsg}. [${replyShortId}]`
      );
      if (reply.url) {
        console.log(reply.url);
      }
    }
    return;
  }

  // Issue comment - add a new comment (can't thread on issue comments)
  const prId = await ctx.client.fetchPullRequestId(
    ctx.owner,
    ctx.name,
    entry.pr
  );
  const comment = await ctx.client.addIssueComment(prId, body);

  const newShortId = formatShortId(generateShortId(comment.id, ctx.repo));
  const replyToShortId = formatShortId(generateShortId(commentId, ctx.repo));
  const payload = {
    ok: true,
    repo: ctx.repo,
    pr: entry.pr,
    id: newShortId,
    gh_id: comment.id,
    in_reply_to: replyToShortId,
    in_reply_to_gh_id: commentId,
    ...(comment.url && { url: comment.url }),
  };

  if (ctx.outputJson) {
    await writeJsonLine(payload);
  } else {
    console.log(`Added comment to ${ctx.repo}#${entry.pr}. [${newShortId}]`);
    if (comment.url) {
      console.log(comment.url);
    }
  }
}

async function handleResolveComment(
  ctx: FbContext,
  commentId: string,
  shortId: string | null
): Promise<void> {
  const entries = await queryEntries({
    filters: {
      repo: ctx.repo,
      id: commentId,
    },
  });

  const entry = entries[0];
  const sId = shortId ?? generateShortId(commentId, ctx.repo);

  if (!entry) {
    console.error(`Comment ${formatShortId(sId)} not found.`);
    process.exit(1);
  }

  if (entry.subtype !== "review_comment") {
    console.error(
      `Comment ${formatShortId(sId)} is an issue comment. Use --ack instead.`
    );
    process.exit(1);
  }

  const threadMap = await ctx.client.fetchReviewThreadMap(
    ctx.owner,
    ctx.name,
    entry.pr
  );
  const threadId = threadMap.get(commentId);

  if (!threadId) {
    console.error(`No review thread found for comment ${formatShortId(sId)}.`);
    process.exit(1);
  }

  await ctx.client.resolveReviewThread(threadId);

  const payload = {
    ok: true,
    repo: ctx.repo,
    pr: entry.pr,
    id: formatShortId(sId),
    gh_id: commentId,
    thread_id: threadId,
    resolved: true,
  };

  if (ctx.outputJson) {
    await writeJsonLine(payload);
  } else {
    console.log(`Resolved thread for ${formatShortId(sId)}.`);
  }
}

async function handleAckComment(
  ctx: FbContext,
  commentId: string,
  shortId: string | null
): Promise<void> {
  // Get comment info from cache
  const entries = await queryEntries({
    filters: {
      repo: ctx.repo,
      id: commentId,
    },
  });

  const entry = entries[0];
  const sId = shortId ?? generateShortId(commentId, ctx.repo);

  if (!entry) {
    console.error(`Comment ${formatShortId(sId)} not found.`);
    process.exit(1);
  }

  // Add reaction to GitHub
  let reactionAdded = false;
  try {
    await ctx.client.addReaction(commentId, "THUMBS_UP");
    reactionAdded = true;
  } catch {
    // Reaction may already exist or fail for other reasons - continue with local ack
  }

  // Add local ack record
  const ackRecord: AckRecord = {
    repo: ctx.repo,
    pr: entry.pr,
    comment_id: commentId,
    acked_at: new Date().toISOString(),
    reaction_added: reactionAdded,
  };
  await addAck(ackRecord);

  const payload = {
    ok: true,
    repo: ctx.repo,
    pr: entry.pr,
    id: formatShortId(sId),
    gh_id: commentId,
    acked: true,
    reaction_added: reactionAdded,
  };

  if (ctx.outputJson) {
    await writeJsonLine(payload);
  } else {
    const reactionMsg = reactionAdded ? " (👍 added)" : "";
    console.log(`Acknowledged ${formatShortId(sId)}${reactionMsg}.`);
  }
}

async function handleBulkAck(ctx: FbContext, pr: number): Promise<void> {
  // Get all unaddressed feedback for this PR
  const entries = await queryEntries({
    filters: {
      repo: ctx.repo,
      pr,
    },
  });

  buildShortIdCache(entries);

  const ackedIds = await getAckedIds(ctx.repo);
  const feedbacks = identifyUnaddressedFeedback(entries, { ackedIds });
  const prFeedbacks = feedbacks.filter((fb) => fb.pr === pr);

  if (prFeedbacks.length === 0) {
    if (ctx.outputJson) {
      await writeJsonLine({ ok: true, repo: ctx.repo, pr, acked_count: 0 });
    } else {
      console.log(`No unaddressed feedback on PR #${pr}.`);
    }
    return;
  }

  // Add reactions to all comments
  const results: { commentId: string; reactionAdded: boolean }[] = [];
  for (const fb of prFeedbacks) {
    let reactionAdded = false;
    try {
      await ctx.client.addReaction(fb.comment_id, "THUMBS_UP");
      reactionAdded = true;
    } catch {
      // Continue with local ack even if reaction fails
    }
    results.push({ commentId: fb.comment_id, reactionAdded });
  }

  // Add local ack records
  const ackRecords: AckRecord[] = results.map((r) => ({
    repo: ctx.repo,
    pr,
    comment_id: r.commentId,
    acked_at: new Date().toISOString(),
    reaction_added: r.reactionAdded,
  }));
  await addAcks(ackRecords);

  const reactionsAdded = results.filter((r) => r.reactionAdded).length;

  const payload = {
    ok: true,
    repo: ctx.repo,
    pr,
    acked_count: prFeedbacks.length,
    reactions_added: reactionsAdded,
  };

  if (ctx.outputJson) {
    await writeJsonLine(payload);
  } else {
    const reactionMsg =
      reactionsAdded > 0 ? ` (${reactionsAdded} 👍 added)` : "";
    console.log(
      `Acknowledged ${prFeedbacks.length} feedback items on PR #${pr}${reactionMsg}.`
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main command
// ─────────────────────────────────────────────────────────────────────────────

async function createContext(options: FbCommandOptions): Promise<FbContext> {
  const config = await loadConfig();
  const repo = await resolveRepoOrThrow(options.repo);
  const { owner, name } = parseRepoInput(repo);

  const auth = await detectAuth(config.github_token);
  if (!auth.token) {
    throw new Error(auth.error);
  }

  return {
    client: new GitHubClient(auth.token),
    config,
    repo,
    owner,
    name,
    outputJson: shouldOutputJson(options, config.output?.default_format),
  };
}

function resolveCommentId(
  id: string,
  _repo: string
): { commentId: string; shortId: string | null } | null {
  const idType = classifyId(id);

  if (idType === "short_id") {
    // First, try to resolve from cache (if populated)
    const mapping = resolveShortId(id);
    if (mapping) {
      return { commentId: mapping.fullId, shortId: id };
    }
    // Cache not populated - we'll need to search for it
    return null;
  }

  if (idType === "full_id") {
    return { commentId: id, shortId: null };
  }

  return null;
}

async function findCommentByShortId(
  shortId: string,
  repo: string
): Promise<{ commentId: string; shortId: string } | null> {
  // Query all comments and build cache
  const entries = await queryEntries({
    filters: {
      repo,
      type: "comment",
    },
  });

  buildShortIdCache(entries);

  // Try to resolve again
  const mapping = resolveShortId(shortId);
  if (mapping) {
    return { commentId: mapping.fullId, shortId };
  }

  return null;
}

export const fbCommand = new Command("fb")
  .description("Feedback abstraction: list, view, reply, resolve")
  .argument("[id]", "PR number or comment ID (short or full)")
  .argument("[body]", "Comment body for new comment or reply")
  .option("--repo <name>", "Repository (owner/repo format)")
  .option("--todo", "Show only unaddressed feedback (default)")
  .option("--all", "Show all feedback including resolved")
  .option("--ack", "Acknowledge feedback (👍 + local record)")
  .option("--resolve", "Resolve the thread after replying")
  .option("--json", "Force JSON output")
  .option("--no-json", "Force human-readable output")
  .action(
    async (
      id: string | undefined,
      body: string | undefined,
      options: FbCommandOptions
    ) => {
      try {
        const ctx = await createContext(options);

        // No ID: list all unaddressed feedback
        if (!id) {
          await handleListAll(ctx, options);
          return;
        }

        const idType = classifyId(id);

        // PR number
        if (idType === "pr_number") {
          const pr = Number.parseInt(id, 10);

          if (options.ack) {
            await handleBulkAck(ctx, pr);
            return;
          }

          if (body) {
            await handlePrComment(ctx, pr, body);
            return;
          }

          await handlePrList(ctx, pr, options);
          return;
        }

        // Comment ID (short or full)
        let resolved = resolveCommentId(id, ctx.repo);

        // If short ID wasn't in cache, try to find it
        if (!resolved && idType === "short_id") {
          resolved = await findCommentByShortId(id, ctx.repo);
          if (!resolved) {
            console.error(
              `Short ID ${formatShortId(id)} not found in repository.`
            );
            process.exit(1);
          }
        }

        if (!resolved) {
          console.error(`Invalid ID format: ${id}`);
          process.exit(1);
        }

        const { commentId, shortId } = resolved;

        // Ack
        if (options.ack) {
          await handleAckComment(ctx, commentId, shortId);
          return;
        }

        // Resolve
        if (options.resolve && !body) {
          await handleResolveComment(ctx, commentId, shortId);
          return;
        }

        // Reply
        if (body) {
          await handleReplyToComment(ctx, commentId, body, options);
          return;
        }

        // View
        await handleViewComment(ctx, commentId, shortId);
      } catch (error) {
        console.error(
          "Feedback operation failed:",
          error instanceof Error ? error.message : error
        );
        process.exit(1);
      }
    }
  );
