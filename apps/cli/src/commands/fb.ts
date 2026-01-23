import {
  GitHubClient,
  addAck,
  addAcks,
  batchAddReactions,
  buildAckRecords,
  buildShortIdCache,
  classifyId,
  detectAuth,
  formatShortId,
  generateShortId,
  getAckedIds,
  loadConfig,
  parseSince,
  queryEntries,
  resolveShortId,
  type AckRecord,
  type FirewatchConfig,
  type PrState,
} from "@outfitter/firewatch-core";
import { Command, Option } from "commander";

import {
  identifyUnaddressedFeedback,
  type UnaddressedFeedback,
} from "../actionable";
import { parseRepoInput, resolveRepoOrThrow } from "../repo";
import { outputStructured } from "../utils/json";
import { resolveStates } from "../utils/states";
import { shouldOutputJson } from "../utils/tty";

interface FbCommandOptions {
  repo?: string;
  todo?: boolean;
  all?: boolean;
  ack?: boolean;
  resolve?: boolean;
  body?: string;
  jsonl?: boolean;
  json?: boolean;
  offline?: boolean;
  // Filter options for bulk ack
  before?: string;
  since?: string;
  open?: boolean;
  closed?: boolean;
  state?: string;
}

interface FbContext {
  client: GitHubClient | null;
  config: FirewatchConfig;
  repo: string;
  owner: string;
  name: string;
  outputJson: boolean;
  offline: boolean;
}

/**
 * Ensures the context has an online client for write operations.
 * Throws if --offline flag was used.
 */
function requireOnlineClient(ctx: FbContext): GitHubClient {
  if (ctx.offline || !ctx.client) {
    throw new Error(
      "This operation requires GitHub API access. Remove --offline flag to proceed."
    );
  }
  return ctx.client;
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
  const feedbacks = identifyUnaddressedFeedback(entries, {
    ackedIds,
    username: ctx.config.user?.github_username,
    commitImpliesRead: ctx.config.feedback?.commit_implies_read,
  });

  if (ctx.outputJson) {
    for (const fb of feedbacks) {
      const shortId = formatShortId(generateShortId(fb.comment_id, ctx.repo));
      const { comment_id: gh_id, ...rest } = fb;
      await outputStructured({ ...rest, id: shortId, gh_id }, "jsonl");
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
        await outputStructured({ ...rest, id: shortId, gh_id }, "jsonl");
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
  const feedbacks = identifyUnaddressedFeedback(entries, {
    ackedIds,
    username: ctx.config.user?.github_username,
    commitImpliesRead: ctx.config.feedback?.commit_implies_read,
  });
  const prFeedbacks = feedbacks.filter((fb) => fb.pr === pr);

  if (ctx.outputJson) {
    for (const fb of prFeedbacks) {
      const shortId = formatShortId(generateShortId(fb.comment_id, ctx.repo));
      const { comment_id: gh_id, ...rest } = fb;
      await outputStructured({ ...rest, id: shortId, gh_id }, "jsonl");
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
  const client = requireOnlineClient(ctx);
  const prId = await client.fetchPullRequestId(ctx.owner, ctx.name, pr);
  const comment = await client.addIssueComment(prId, body);

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
    await outputStructured(payload, "jsonl");
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
    await outputStructured({ ...rest, id: formatShortId(sId), gh_id }, "jsonl");
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
    const client = requireOnlineClient(ctx);
    // Get thread ID and reply to thread
    const threadMap = await client.fetchReviewThreadMap(
      ctx.owner,
      ctx.name,
      entry.pr
    );
    const threadId = threadMap.get(commentId);

    if (!threadId) {
      console.error(`No review thread found for comment ${commentId}.`);
      process.exit(1);
    }

    const reply = await client.addReviewThreadReply(threadId, body);

    if (options.resolve) {
      await client.resolveReviewThread(threadId);
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
      await outputStructured(payload, "jsonl");
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
  const client = requireOnlineClient(ctx);
  const prId = await client.fetchPullRequestId(
    ctx.owner,
    ctx.name,
    entry.pr
  );
  const comment = await client.addIssueComment(prId, body);

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
    await outputStructured(payload, "jsonl");
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

  const client = requireOnlineClient(ctx);
  const threadMap = await client.fetchReviewThreadMap(
    ctx.owner,
    ctx.name,
    entry.pr
  );
  const threadId = threadMap.get(commentId);

  if (!threadId) {
    console.error(`No review thread found for comment ${formatShortId(sId)}.`);
    process.exit(1);
  }

  await client.resolveReviewThread(threadId);

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
    await outputStructured(payload, "jsonl");
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
    const client = requireOnlineClient(ctx);
    await client.addReaction(commentId, "THUMBS_UP");
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
    ...(ctx.config.user?.github_username && {
      acked_by: ctx.config.user.github_username,
    }),
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
    await outputStructured(payload, "jsonl");
  } else {
    const reactionMsg = reactionAdded ? " (👍 added)" : "";
    console.log(`Acknowledged ${formatShortId(sId)}${reactionMsg}.`);
  }
}

async function handleBulkAck(
  ctx: FbContext,
  pr: number,
  options: FbCommandOptions
): Promise<void> {
  // Get all unaddressed feedback for this PR
  const entries = await queryEntries({
    filters: {
      repo: ctx.repo,
      pr,
    },
  });

  buildShortIdCache(entries);

  const ackedIds = await getAckedIds(ctx.repo);
  const feedbacks = identifyUnaddressedFeedback(entries, {
    ackedIds,
    username: ctx.config.user?.github_username,
    commitImpliesRead: ctx.config.feedback?.commit_implies_read,
  });

  // Apply time filters to feedback for this PR
  let prFeedbacks = feedbacks.filter((fb) => fb.pr === pr);
  prFeedbacks = applyTimeFilters(prFeedbacks, {
    before: options.before,
    since: options.since,
  });

  if (prFeedbacks.length === 0) {
    if (ctx.outputJson) {
      await outputStructured(
        { ok: true, repo: ctx.repo, pr, acked_count: 0 },
        "jsonl"
      );
    } else {
      console.log(`No unaddressed feedback on PR #${pr}.`);
    }
    return;
  }

  // Add reactions to all comments in parallel
  const commentIds = prFeedbacks.map((fb) => fb.comment_id);
  const reactionResults = ctx.client
    ? await batchAddReactions(commentIds, ctx.client)
    : commentIds.map((commentId) => ({ commentId, reactionAdded: false }));

  // Build reaction map for ack records
  const reactionMap = new Map(
    reactionResults.map((r) => [r.commentId, r.reactionAdded])
  );

  // Query entries to get FirewatchEntry objects for buildAckRecords
  const prEntries = await queryEntries({
    filters: { repo: ctx.repo, pr, type: "comment" },
  });
  const entryMap = new Map(prEntries.map((e) => [e.id, e]));

  // Build ack records using batch utility
  const items = prFeedbacks
    .map((fb) => {
      const entry = entryMap.get(fb.comment_id);
      if (!entry) {
        return null;
      }
      return {
        entry,
        reactionAdded: reactionMap.get(fb.comment_id) ?? false,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  const ackRecords = buildAckRecords(items, {
    repo: ctx.repo,
    username: ctx.config.user?.github_username,
  });
  await addAcks(ackRecords);

  const reactionsAdded = reactionResults.filter((r) => r.reactionAdded).length;

  const payload = {
    ok: true,
    repo: ctx.repo,
    pr,
    acked_count: prFeedbacks.length,
    reactions_added: reactionsAdded,
  };

  if (ctx.outputJson) {
    await outputStructured(payload, "jsonl");
  } else {
    const reactionMsg =
      reactionsAdded > 0 ? ` (${reactionsAdded} 👍 added)` : "";
    console.log(
      `Acknowledged ${prFeedbacks.length} feedback items on PR #${pr}${reactionMsg}.`
    );
  }
}

interface FilterOptions {
  before?: string | undefined;
  since?: string | undefined;
  states?: PrState[] | undefined;
}

function parseBeforeDate(before: string): Date {
  const date = new Date(before);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError(
      `Invalid date format: ${before}. Use ISO format (e.g., 2024-01-15)`
    );
  }
  return date;
}

function applyTimeFilters(
  feedbacks: UnaddressedFeedback[],
  filters: FilterOptions
): UnaddressedFeedback[] {
  let filtered = feedbacks;

  if (filters.before) {
    const beforeDate = parseBeforeDate(filters.before);
    filtered = filtered.filter((fb) => new Date(fb.created_at) < beforeDate);
  }

  if (filters.since) {
    const sinceDate = parseSince(filters.since);
    filtered = filtered.filter((fb) => new Date(fb.created_at) >= sinceDate);
  }

  return filtered;
}

async function handleCrossPrBulkAck(
  ctx: FbContext,
  options: FbCommandOptions
): Promise<void> {
  // Resolve state filters
  const states = resolveStates({
    ...(options.state && { state: options.state }),
    ...(options.open && { open: true }),
    ...(options.closed && { closed: true }),
  });

  // Query entries with state filters
  const entries = await queryEntries({
    filters: {
      repo: ctx.repo,
      type: "comment",
      ...(states.length > 0 && { states }),
    },
  });

  buildShortIdCache(entries);

  // Get unaddressed feedback
  const ackedIds = await getAckedIds(ctx.repo);
  // Convert states array to Set for prStates option (allow filtering on closed/merged PRs)
  const prStates = states.length > 0 ? new Set(states) : undefined;
  let feedbacks = identifyUnaddressedFeedback(entries, {
    ackedIds,
    username: ctx.config.user?.github_username,
    commitImpliesRead: ctx.config.feedback?.commit_implies_read,
    prStates,
  });

  // Apply time filters
  feedbacks = applyTimeFilters(feedbacks, {
    before: options.before,
    since: options.since,
  });

  if (feedbacks.length === 0) {
    if (ctx.outputJson) {
      await outputStructured(
        { ok: true, repo: ctx.repo, acked_count: 0, reactions_added: 0 },
        "jsonl"
      );
    } else {
      console.log("No unaddressed feedback matching filters.");
    }
    return;
  }

  // Group by PR for output reporting
  const byPr = new Map<number, UnaddressedFeedback[]>();
  for (const fb of feedbacks) {
    const list = byPr.get(fb.pr) ?? [];
    list.push(fb);
    byPr.set(fb.pr, list);
  }

  // Add reactions in parallel using batch utility
  const commentIds = feedbacks.map((fb) => fb.comment_id);
  const reactionResults = ctx.client
    ? await batchAddReactions(commentIds, ctx.client)
    : commentIds.map((commentId) => ({ commentId, reactionAdded: false }));

  // Build reaction map for ack records
  const reactionMap = new Map(
    reactionResults.map((r) => [r.commentId, r.reactionAdded])
  );

  // Build entry map from already-queried entries
  const entryMap = new Map(entries.map((e) => [e.id, e]));

  // Build ack records using batch utility
  const items = feedbacks
    .map((fb) => {
      const entry = entryMap.get(fb.comment_id);
      if (!entry) {
        return null;
      }
      return {
        entry,
        reactionAdded: reactionMap.get(fb.comment_id) ?? false,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  const ackRecords = buildAckRecords(items, {
    repo: ctx.repo,
    username: ctx.config.user?.github_username,
  });
  await addAcks(ackRecords);

  const reactionsAdded = reactionResults.filter((r) => r.reactionAdded).length;

  const payload = {
    ok: true,
    repo: ctx.repo,
    acked_count: feedbacks.length,
    reactions_added: reactionsAdded,
    prs: [...byPr.entries()].map(([pr, items]) => ({
      pr,
      count: items.length,
    })),
  };

  if (ctx.outputJson) {
    await outputStructured(payload, "jsonl");
  } else {
    console.log(
      `Acknowledged ${feedbacks.length} feedback items across ${byPr.size} PRs (${reactionsAdded} reactions added).`
    );
    for (const [pr, items] of byPr) {
      console.log(`  PR #${pr}: ${items.length} items`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main command
// ─────────────────────────────────────────────────────────────────────────────

async function createContext(options: FbCommandOptions): Promise<FbContext> {
  const config = await loadConfig();
  const repo = await resolveRepoOrThrow(options.repo);
  const { owner, name } = parseRepoInput(repo);
  const offline = options.offline ?? false;

  let client: GitHubClient | null = null;
  if (!offline) {
    const auth = await detectAuth(config.github_token);
    if (!auth.token) {
      throw new Error(auth.error);
    }
    client = new GitHubClient(auth.token);
  }

  return {
    client,
    config,
    repo,
    owner,
    name,
    outputJson: shouldOutputJson(options, config.output?.default_format),
    offline,
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
  .option("--repo <name>", "Repository (owner/repo format)")
  .option("-t, --todo", "Show only unaddressed feedback (default)")
  .option("--all", "Show all feedback including resolved")
  .option("-a, --ack", "Acknowledge feedback (👍 + local record)")
  .option("-r, --resolve", "Resolve the thread after replying")
  .option("-b, --body <text>", "Comment body for new comment or reply")
  .option("--jsonl", "Force structured output")
  .option("--no-jsonl", "Force human-readable output")
  .addOption(new Option("--json").hideHelp())
  .option("--offline", "Use cached data only (no GitHub API calls)")
  .option("--before <date>", "Comments created before ISO date")
  .option("--since <duration>", "Comments within duration (e.g., 7d, 24h)")
  .option("--open", "Only open PRs")
  .option("--closed", "Only closed PRs")
  .option("--state <states>", "Explicit state filter (comma-separated)")
  .action(async (id: string | undefined, options: FbCommandOptions) => {
    try {
      const ctx = await createContext(options);
      const body = options.body;

      // No ID: list all unaddressed feedback or bulk ack across PRs
      if (!id) {
        if (options.ack) {
          await handleCrossPrBulkAck(ctx, options);
          return;
        }
        await handleListAll(ctx, options);
        return;
      }

      const idType = classifyId(id);

      // PR number
      if (idType === "pr_number") {
        const pr = Number.parseInt(id, 10);

        if (options.ack) {
          requireOnlineClient(ctx);
          await handleBulkAck(ctx, pr, options);
          return;
        }

        if (body) {
          requireOnlineClient(ctx);
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
        requireOnlineClient(ctx);
        await handleAckComment(ctx, commentId, shortId);
        return;
      }

      // Resolve
      if (options.resolve && !body) {
        requireOnlineClient(ctx);
        await handleResolveComment(ctx, commentId, shortId);
        return;
      }

      // Reply
      if (body) {
        requireOnlineClient(ctx);
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
  });
