import {
  GitHubClient,
  addAck,
  addAcks,
  batchAddReactions,
  buildAckRecords,
  buildShortIdCache,
  classifyId,
  detectAuth,
  formatDisplayId,
  generateShortId,
  getAckedIds,
  getCurrentBranch,
  getStackProvider,
  loadConfig,
  parseSince,
  queryEntries,
  resolveBatchIds,
  resolveShortId,
  type AckRecord,
  type FirewatchConfig,
  type PrState,
  type StackDirection,
} from "@outfitter/firewatch-core";
import { Command, Option } from "commander";

import {
  identifyUnaddressedFeedback,
  type UnaddressedFeedback,
} from "../actionable";
import { SEPARATOR, truncate } from "../render";
import { parseRepoInput, resolveRepoOrThrow } from "../repo";
import { outputStructured } from "../utils/json";
import { resolveStates } from "../utils/states";
import { shouldOutputJson } from "../utils/tty";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface FeedbackContext {
  client: GitHubClient | null;
  config: FirewatchConfig;
  repo: string;
  owner: string;
  name: string;
  outputJson: boolean;
}

interface ListOptions {
  repo?: string;
  short?: boolean;
  long?: boolean;
  pr?: string;
  stack?: string | boolean;
  all?: boolean;
  jsonl?: boolean;
  json?: boolean;
  before?: string;
  since?: string;
  open?: boolean;
  closed?: boolean;
  state?: string;
}

interface ViewOptions {
  repo?: string;
  jsonl?: boolean;
  json?: boolean;
}

interface ReplyOptions {
  repo?: string;
  body?: string;
  resolve?: boolean;
  jsonl?: boolean;
  json?: boolean;
}

interface AckOptions {
  repo?: string;
  list?: boolean;
  clear?: boolean;
  before?: string;
  since?: string;
  open?: boolean;
  closed?: boolean;
  state?: string;
  jsonl?: boolean;
  json?: boolean;
}

interface ResolveOptions {
  repo?: string;
  jsonl?: boolean;
  json?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Context
// ─────────────────────────────────────────────────────────────────────────────

function requireClient(ctx: FeedbackContext): GitHubClient {
  if (!ctx.client) {
    throw new Error(
      "This operation requires GitHub API access. Ensure you have a valid token."
    );
  }
  return ctx.client;
}

async function createContext(
  options: { repo?: string; jsonl?: boolean; json?: boolean },
  config?: FirewatchConfig
): Promise<FeedbackContext> {
  const loadedConfig = config ?? (await loadConfig());
  const repo = await resolveRepoOrThrow(options.repo);
  const { owner, name } = parseRepoInput(repo);

  const auth = await detectAuth(loadedConfig.github_token);
  const client = auth.token ? new GitHubClient(auth.token) : null;

  return {
    client,
    config: loadedConfig,
    repo,
    owner,
    name,
    outputJson: shouldOutputJson(options, loadedConfig.output?.default_format),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Output formatting
// ─────────────────────────────────────────────────────────────────────────────

function formatFeedbackItem(fb: UnaddressedFeedback, repo: string): string {
  const shortId = generateShortId(fb.comment_id, repo);
  const location = fb.file ? `${fb.file}:${fb.line ?? "?"}` : "(comment)";
  const bodyPreview = fb.body
    ? truncate(fb.body.replaceAll("\n", " "), 60)
    : "";
  return `${formatDisplayId(shortId)} @${fb.author} ${location}\n  "${bodyPreview}"`;
}

function printFeedbackSummary(
  pr: number,
  prTitle: string,
  feedbacks: UnaddressedFeedback[],
  repo: string
): void {
  console.error(`\nPR #${pr}: ${truncate(prTitle, 50)}`);
  console.error(SEPARATOR.tertiary.repeat(50));

  if (feedbacks.length === 0) {
    console.error("No unaddressed feedback.");
    return;
  }

  for (const fb of feedbacks) {
    console.log("");
    console.log(formatFeedbackItem(fb, repo));
  }

  console.error("");
  console.error(`${feedbacks.length} need attention`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Time filters
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// ID Resolution
// ─────────────────────────────────────────────────────────────────────────────

function resolveCommentId(
  id: string,
  _repo: string
): { commentId: string; shortId: string | null } | null {
  const idType = classifyId(id);

  if (idType === "short_id") {
    const mapping = resolveShortId(id);
    if (mapping) {
      return { commentId: mapping.fullId, shortId: id };
    }
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
  const [resolution] = await resolveBatchIds([shortId], repo);

  if (!resolution || resolution.type === "error") {
    return null;
  }

  if (resolution.type === "comment" && resolution.entry) {
    return { commentId: resolution.entry.id, shortId };
  }

  return null;
}

/**
 * Resolve multiple IDs to their full comment IDs.
 * Supports PR numbers, short IDs, and full IDs.
 */
async function resolveIds(
  ids: string[],
  repo: string
): Promise<{ commentId: string; shortId: string | null; pr?: number }[]> {
  const results: { commentId: string; shortId: string | null; pr?: number }[] =
    [];

  for (const id of ids) {
    const idType = classifyId(id);

    if (idType === "pr_number") {
      // PR number - we'll handle this differently in each command
      results.push({
        commentId: id,
        shortId: null,
        pr: Number.parseInt(id, 10),
      });
      continue;
    }

    let resolved = resolveCommentId(id, repo);
    if (!resolved && idType === "short_id") {
      resolved = await findCommentByShortId(id, repo);
    }

    if (resolved) {
      results.push(resolved);
    } else {
      console.error(`Warning: Could not resolve ID ${id}`);
    }
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// Stack handling
// ─────────────────────────────────────────────────────────────────────────────

function parseStackDirection(value: string | boolean): StackDirection {
  if (typeof value === "boolean" || value === "") {
    return "all";
  }
  const normalized = value.toLowerCase();
  if (normalized === "up" || normalized === "upstack") {
    return "up";
  }
  if (normalized === "down" || normalized === "downstack") {
    return "down";
  }
  return "all";
}

async function getStackFeedback(
  ctx: FeedbackContext,
  direction: StackDirection,
  _options: ListOptions
): Promise<void> {
  const provider = await getStackProvider();
  if (!provider) {
    console.error("No stack provider available. Is Graphite installed?");
    process.exit(1);
  }

  const branch = await getCurrentBranch();
  if (!branch) {
    console.error(
      "Not in a git repository or could not detect current branch."
    );
    process.exit(1);
  }

  const stackPRs = await provider.getStackPRs(branch, direction);

  if (!stackPRs) {
    console.error(`Branch '${branch}' is not part of a tracked stack.`);
    process.exit(1);
  }

  if (stackPRs.prs.length === 0) {
    if (ctx.outputJson) {
      await outputStructured([], "jsonl");
    } else {
      console.error("No PRs with open pull requests in this stack.");
    }
    return;
  }

  const entries = await queryEntries({
    filters: {
      repo: ctx.repo,
      type: "comment",
      pr: stackPRs.prs,
    },
  });

  buildShortIdCache(entries);

  const ackedIds = await getAckedIds(ctx.repo);
  const feedbacks = identifyUnaddressedFeedback(entries, {
    ackedIds,
    username: ctx.config.user?.github_username,
    commitImpliesRead: ctx.config.feedback?.commit_implies_read,
  });

  if (ctx.outputJson) {
    for (const fb of feedbacks) {
      const shortId = formatDisplayId(generateShortId(fb.comment_id, ctx.repo));
      const { comment_id: gh_id, ...rest } = fb;
      await outputStructured({ ...rest, id: shortId, gh_id }, "jsonl");
    }
    return;
  }

  if (feedbacks.length === 0) {
    const directionLabels: Record<StackDirection, string> = {
      all: "stack",
      down: "downstack",
      up: "upstack",
    };
    console.error(`No unaddressed feedback in ${directionLabels[direction]}.`);
    return;
  }

  const byPr = new Map<number, UnaddressedFeedback[]>();
  for (const fb of feedbacks) {
    const list = byPr.get(fb.pr) ?? [];
    list.push(fb);
    byPr.set(fb.pr, list);
  }

  for (const prNum of stackPRs.prs) {
    const prFeedbacks = byPr.get(prNum);
    if (!prFeedbacks || prFeedbacks.length === 0) {
      continue;
    }
    const title = prFeedbacks[0]?.pr_title ?? "";
    const isCurrent = prNum === stackPRs.currentPr;
    const marker = isCurrent ? " ← current" : "";
    printFeedbackSummary(prNum, `${title}${marker}`, prFeedbacks, ctx.repo);
  }

  console.log(`\nTotal: ${feedbacks.length} items across ${byPr.size} PRs`);
}

// ─────────────────────────────────────────────────────────────────────────────
// List subcommand
// ─────────────────────────────────────────────────────────────────────────────

async function handleList(options: ListOptions): Promise<void> {
  const ctx = await createContext(options);

  // Handle stack mode
  if (options.stack !== undefined) {
    const direction = parseStackDirection(options.stack);
    await getStackFeedback(ctx, direction, options);
    return;
  }

  // Handle PR-specific list
  if (options.pr) {
    const pr = Number.parseInt(options.pr, 10);
    if (Number.isNaN(pr)) {
      console.error(`Invalid PR number: ${options.pr}`);
      process.exit(1);
    }
    await handlePrList(ctx, pr, options);
    return;
  }

  // Default: list all unaddressed feedback
  const entries = await queryEntries({
    filters: {
      repo: ctx.repo,
      type: "comment",
    },
  });

  buildShortIdCache(entries);

  const ackedIds = await getAckedIds(ctx.repo);
  let feedbacks = identifyUnaddressedFeedback(entries, {
    ackedIds,
    username: ctx.config.user?.github_username,
    commitImpliesRead: ctx.config.feedback?.commit_implies_read,
  });

  // Apply time filters
  feedbacks = applyTimeFilters(feedbacks, {
    before: options.before,
    since: options.since,
  });

  if (ctx.outputJson) {
    for (const fb of feedbacks) {
      const shortId = formatDisplayId(generateShortId(fb.comment_id, ctx.repo));
      const { comment_id: gh_id, ...rest } = fb;
      await outputStructured({ ...rest, id: shortId, gh_id }, "jsonl");
    }
    return;
  }

  if (feedbacks.length === 0) {
    console.error("No unaddressed feedback across repository.");
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
  ctx: FeedbackContext,
  pr: number,
  options: ListOptions
): Promise<void> {
  const entries = await queryEntries({
    filters: {
      repo: ctx.repo,
      pr,
    },
  });

  buildShortIdCache(entries);

  if (options.all) {
    const comments = entries.filter((e) => e.type === "comment");
    if (ctx.outputJson) {
      for (const c of comments) {
        const shortId = formatDisplayId(generateShortId(c.id, ctx.repo));
        const { id: gh_id, ...rest } = c;
        await outputStructured({ ...rest, id: shortId, gh_id }, "jsonl");
      }
      return;
    }

    const prTitle = entries[0]?.pr_title ?? `PR #${pr}`;
    console.log(`\nPR #${pr}: ${truncate(prTitle, 50)}`);
    console.log(SEPARATOR.tertiary.repeat(50));

    for (const c of comments) {
      const shortId = generateShortId(c.id, ctx.repo);
      const location = c.file ? `${c.file}:${c.line ?? "?"}` : "(comment)";
      const resolved = c.thread_resolved ? " ✓" : "";
      console.log(
        `\n${formatDisplayId(shortId)} @${c.author} ${location}${resolved}`
      );
      if (c.body) {
        console.log(`  "${truncate(c.body.replaceAll("\n", " "), 60)}"`);
      }
    }

    console.log(`\n${comments.length} total comments`);
    return;
  }

  const ackedIds = await getAckedIds(ctx.repo);
  const feedbacks = identifyUnaddressedFeedback(entries, {
    ackedIds,
    username: ctx.config.user?.github_username,
    commitImpliesRead: ctx.config.feedback?.commit_implies_read,
  });
  const prFeedbacks = feedbacks.filter((fb) => fb.pr === pr);

  if (ctx.outputJson) {
    for (const fb of prFeedbacks) {
      const shortId = formatDisplayId(generateShortId(fb.comment_id, ctx.repo));
      const { comment_id: gh_id, ...rest } = fb;
      await outputStructured({ ...rest, id: shortId, gh_id }, "jsonl");
    }
    return;
  }

  const prTitle = entries[0]?.pr_title ?? `PR #${pr}`;
  printFeedbackSummary(pr, prTitle, prFeedbacks, ctx.repo);
}

// ─────────────────────────────────────────────────────────────────────────────
// View subcommand
// ─────────────────────────────────────────────────────────────────────────────

async function handleView(ids: string[], options: ViewOptions): Promise<void> {
  if (ids.length === 0) {
    console.error("No IDs provided. Usage: fw feedback view <id...>");
    process.exit(1);
  }

  const ctx = await createContext(options);

  // Pre-populate cache for short ID resolution
  const entries = await queryEntries({
    filters: { repo: ctx.repo },
  });
  buildShortIdCache(entries);

  for (const id of ids) {
    const resolved = await resolveIds([id], ctx.repo);
    const res = resolved[0];
    if (!res || res.pr !== undefined) {
      console.error(`Cannot view PR number directly. Use --pr with list.`);
      continue;
    }

    await viewComment(ctx, res.commentId, res.shortId);
  }
}

async function viewComment(
  ctx: FeedbackContext,
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
    console.error(`Comment [${shortId ?? commentId}] not found.`);
    return;
  }

  const sId = shortId ?? generateShortId(entry.id, ctx.repo);

  if (ctx.outputJson) {
    const { id: gh_id, ...rest } = entry;
    await outputStructured(
      { ...rest, id: formatDisplayId(sId), gh_id },
      "jsonl"
    );
    return;
  }

  const location = entry.file
    ? `${entry.file}:${entry.line ?? "?"}`
    : "(comment)";
  const resolved = entry.thread_resolved ? " (resolved)" : "";

  console.log(
    `\n${formatDisplayId(sId)} @${entry.author} ${location}${resolved}`
  );
  console.log(`PR #${entry.pr}: ${entry.pr_title}`);
  console.log(`Created: ${entry.created_at}`);
  if (entry.body) {
    console.log(`\n${entry.body}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Reply subcommand
// ─────────────────────────────────────────────────────────────────────────────

async function handleReply(
  ids: string[],
  bodyArg: string | undefined,
  options: ReplyOptions
): Promise<void> {
  const body = bodyArg ?? options.body;
  if (!body) {
    console.error("Reply body required. Use: fw feedback reply <id> <body>");
    process.exit(1);
  }

  if (ids.length === 0) {
    console.error("No IDs provided. Usage: fw feedback reply <id> <body>");
    process.exit(1);
  }

  const ctx = await createContext(options);

  // Pre-populate cache
  const entries = await queryEntries({
    filters: { repo: ctx.repo },
  });
  buildShortIdCache(entries);

  for (const id of ids) {
    const resolved = await resolveIds([id], ctx.repo);
    const res = resolved[0];
    if (!res) {
      continue;
    }

    if (res.pr === undefined) {
      await replyToComment(ctx, res.commentId, body, options);
    } else {
      // Reply to PR as a new comment
      await addPrComment(ctx, res.pr, body);
    }
  }
}

async function addPrComment(
  ctx: FeedbackContext,
  pr: number,
  body: string
): Promise<void> {
  const client = requireClient(ctx);
  const prId = await client.fetchPullRequestId(ctx.owner, ctx.name, pr);
  const comment = await client.addIssueComment(prId, body);

  const shortId = generateShortId(comment.id, ctx.repo);
  const payload = {
    ok: true,
    repo: ctx.repo,
    pr,
    id: formatDisplayId(shortId),
    gh_id: comment.id,
    ...(comment.url && { url: comment.url }),
  };

  if (ctx.outputJson) {
    await outputStructured(payload, "jsonl");
  } else {
    console.log(
      `Added comment to ${ctx.repo}#${pr}. ${formatDisplayId(shortId)}`
    );
    if (comment.url) {
      console.log(comment.url);
    }
  }
}

async function replyToComment(
  ctx: FeedbackContext,
  commentId: string,
  body: string,
  options: ReplyOptions
): Promise<void> {
  const entries = await queryEntries({
    filters: {
      repo: ctx.repo,
      id: commentId,
    },
  });

  const entry = entries[0];
  if (!entry) {
    console.error(`Comment ${commentId} not found.`);
    return;
  }

  if (entry.subtype === "review_comment") {
    const client = requireClient(ctx);
    const threadMap = await client.fetchReviewThreadMap(
      ctx.owner,
      ctx.name,
      entry.pr
    );
    const threadId = threadMap.get(commentId);

    if (!threadId) {
      console.error(`No review thread found for comment ${commentId}.`);
      return;
    }

    const reply = await client.addReviewThreadReply(threadId, body);

    if (options.resolve) {
      await client.resolveReviewThread(threadId);
    }

    const replyShortId = generateShortId(reply.id, ctx.repo);
    const replyToShortId = generateShortId(commentId, ctx.repo);
    const payload = {
      ok: true,
      repo: ctx.repo,
      pr: entry.pr,
      id: formatDisplayId(replyShortId),
      gh_id: reply.id,
      reply_to: formatDisplayId(replyToShortId),
      reply_to_gh_id: commentId,
      ...(options.resolve && { resolved: true }),
      ...(reply.url && { url: reply.url }),
    };

    if (ctx.outputJson) {
      await outputStructured(payload, "jsonl");
    } else {
      const resolveMsg = options.resolve ? " and resolved thread" : "";
      console.log(
        `Replied to ${formatDisplayId(replyToShortId)}${resolveMsg}. ${formatDisplayId(replyShortId)}`
      );
      if (reply.url) {
        console.log(reply.url);
      }
    }
    return;
  }

  // Issue comment - add a new comment
  const client = requireClient(ctx);
  const prId = await client.fetchPullRequestId(ctx.owner, ctx.name, entry.pr);
  const comment = await client.addIssueComment(prId, body);

  const newShortId = generateShortId(comment.id, ctx.repo);
  const replyToShortId = generateShortId(commentId, ctx.repo);
  const payload = {
    ok: true,
    repo: ctx.repo,
    pr: entry.pr,
    id: formatDisplayId(newShortId),
    gh_id: comment.id,
    in_reply_to: formatDisplayId(replyToShortId),
    in_reply_to_gh_id: commentId,
    ...(comment.url && { url: comment.url }),
  };

  if (ctx.outputJson) {
    await outputStructured(payload, "jsonl");
  } else {
    console.log(
      `Added comment to ${ctx.repo}#${entry.pr}. ${formatDisplayId(newShortId)}`
    );
    if (comment.url) {
      console.log(comment.url);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Ack subcommand
// ─────────────────────────────────────────────────────────────────────────────

async function handleAck(ids: string[], options: AckOptions): Promise<void> {
  const ctx = await createContext(options);

  // Pre-populate cache
  const entries = await queryEntries({
    filters: { repo: ctx.repo },
  });
  buildShortIdCache(entries);

  // No IDs means bulk ack across all unaddressed
  if (ids.length === 0) {
    await handleCrossPrBulkAck(ctx, options);
    return;
  }

  const resolved = await resolveIds(ids, ctx.repo);

  for (const res of resolved) {
    if (res.pr === undefined) {
      await ackComment(ctx, res.commentId, res.shortId);
    } else {
      // PR number - bulk ack all feedback on this PR
      await handlePrBulkAck(ctx, res.pr, options);
    }
  }
}

async function ackComment(
  ctx: FeedbackContext,
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
    console.error(`Comment ${formatDisplayId(sId)} not found.`);
    return;
  }

  let reactionAdded = false;
  try {
    const client = requireClient(ctx);
    await client.addReaction(commentId, "THUMBS_UP");
    reactionAdded = true;
  } catch {
    // Continue with local ack
  }

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
    id: formatDisplayId(sId),
    gh_id: commentId,
    acked: true,
    reaction_added: reactionAdded,
  };

  if (ctx.outputJson) {
    await outputStructured(payload, "jsonl");
  } else {
    const reactionMsg = reactionAdded ? " (👍 added)" : "";
    console.log(`Acknowledged ${formatDisplayId(sId)}${reactionMsg}.`);
  }
}

async function handlePrBulkAck(
  ctx: FeedbackContext,
  pr: number,
  options: AckOptions
): Promise<void> {
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
      console.error(`No unaddressed feedback on PR #${pr}.`);
    }
    return;
  }

  const commentIds = prFeedbacks.map((fb) => fb.comment_id);
  const reactionResults = await batchAddReactions(
    commentIds,
    requireClient(ctx)
  );

  const reactionMap = new Map(
    reactionResults.map((r) => [r.commentId, r.reactionAdded])
  );

  const entryMap = new Map(entries.map((e) => [e.id, e]));

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

async function handleCrossPrBulkAck(
  ctx: FeedbackContext,
  options: AckOptions
): Promise<void> {
  const states = resolveStates({
    ...(options.state && { state: options.state }),
    ...(options.open && { open: true }),
    ...(options.closed && { closed: true }),
  });

  const entries = await queryEntries({
    filters: {
      repo: ctx.repo,
      type: "comment",
      ...(states.length > 0 && { states }),
    },
  });

  buildShortIdCache(entries);

  const ackedIds = await getAckedIds(ctx.repo);
  const prStates = states.length > 0 ? new Set(states) : undefined;
  let feedbacks = identifyUnaddressedFeedback(entries, {
    ackedIds,
    username: ctx.config.user?.github_username,
    commitImpliesRead: ctx.config.feedback?.commit_implies_read,
    prStates,
  });

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
      console.error("No unaddressed feedback matching filters.");
    }
    return;
  }

  const byPr = new Map<number, UnaddressedFeedback[]>();
  for (const fb of feedbacks) {
    const list = byPr.get(fb.pr) ?? [];
    list.push(fb);
    byPr.set(fb.pr, list);
  }

  const commentIds = feedbacks.map((fb) => fb.comment_id);
  const reactionResults = await batchAddReactions(
    commentIds,
    requireClient(ctx)
  );

  const reactionMap = new Map(
    reactionResults.map((r) => [r.commentId, r.reactionAdded])
  );

  const entryMap = new Map(entries.map((e) => [e.id, e]));

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
// Resolve subcommand
// ─────────────────────────────────────────────────────────────────────────────

async function handleResolve(
  ids: string[],
  options: ResolveOptions
): Promise<void> {
  if (ids.length === 0) {
    console.error("No IDs provided. Usage: fw feedback resolve <ids...>");
    process.exit(1);
  }

  const ctx = await createContext(options);

  // Pre-populate cache
  const entries = await queryEntries({
    filters: { repo: ctx.repo },
  });
  buildShortIdCache(entries);

  const resolved = await resolveIds(ids, ctx.repo);

  for (const res of resolved) {
    if (res.pr !== undefined) {
      console.error(`Cannot resolve a PR directly. Provide comment IDs.`);
      continue;
    }
    await resolveComment(ctx, res.commentId, res.shortId);
  }
}

async function resolveComment(
  ctx: FeedbackContext,
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
    console.error(`Comment ${formatDisplayId(sId)} not found.`);
    return;
  }

  if (entry.subtype !== "review_comment") {
    console.error(
      `Comment ${formatDisplayId(sId)} is an issue comment. Use ack instead.`
    );
    return;
  }

  const client = requireClient(ctx);
  const threadMap = await client.fetchReviewThreadMap(
    ctx.owner,
    ctx.name,
    entry.pr
  );
  const threadId = threadMap.get(commentId);

  if (!threadId) {
    console.error(
      `No review thread found for comment ${formatDisplayId(sId)}.`
    );
    return;
  }

  await client.resolveReviewThread(threadId);

  const payload = {
    ok: true,
    repo: ctx.repo,
    pr: entry.pr,
    id: formatDisplayId(sId),
    gh_id: commentId,
    thread_id: threadId,
    resolved: true,
  };

  if (ctx.outputJson) {
    await outputStructured(payload, "jsonl");
  } else {
    console.log(`Resolved thread for ${formatDisplayId(sId)}.`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Command definitions
// ─────────────────────────────────────────────────────────────────────────────

const listCommand = new Command("list")
  .description("List feedback items (default when no subcommand)")
  .option("--repo <name>", "Repository (owner/repo format)")
  .option("--short", "Compact output (default)")
  .option("--long", "Detailed output")
  .option("--pr <number>", "Filter by PR number")
  .option("-s, --stack [direction]", "Filter to current stack (all, up, down)")
  .option("--all", "Show all feedback including resolved")
  .option("--before <date>", "Comments created before ISO date")
  .option("--since <duration>", "Comments within duration (e.g., 7d, 24h)")
  .option("--open", "Only open PRs")
  .option("--closed", "Only closed PRs")
  .option("--state <states>", "Explicit state filter (comma-separated)")
  .option("--jsonl", "Force structured output")
  .option("--no-jsonl", "Force human-readable output")
  .addOption(new Option("--json").hideHelp())
  .action(handleList);

const viewCommand = new Command("view")
  .description("View specific feedback item(s)")
  .argument("<ids...>", "Comment IDs (short or full)")
  .option("--repo <name>", "Repository (owner/repo format)")
  .option("--jsonl", "Force structured output")
  .option("--no-jsonl", "Force human-readable output")
  .addOption(new Option("--json").hideHelp())
  .action(handleView);

const replyCommand = new Command("reply")
  .description("Reply to a feedback item")
  .argument("<id>", "Comment ID (short or full) or PR number")
  .argument("[body]", "Reply text")
  .option("--repo <name>", "Repository (owner/repo format)")
  .option("-b, --body <text>", "Reply text (alternative to positional)")
  .option("--resolve", "Resolve the thread after replying")
  .option("--jsonl", "Force structured output")
  .option("--no-jsonl", "Force human-readable output")
  .addOption(new Option("--json").hideHelp())
  .action((id: string, body: string | undefined, options: ReplyOptions) =>
    handleReply([id], body, options)
  );

const ackCommand = new Command("ack")
  .description("Acknowledge feedback item(s)")
  .argument("[ids...]", "Comment IDs, PR numbers, or omit for bulk ack")
  .option("--repo <name>", "Repository (owner/repo format)")
  .option("--list", "List acknowledged items")
  .option("--clear", "Clear all acks")
  .option("--before <date>", "Comments created before ISO date")
  .option("--since <duration>", "Comments within duration (e.g., 7d, 24h)")
  .option("--open", "Only open PRs")
  .option("--closed", "Only closed PRs")
  .option("--state <states>", "Explicit state filter (comma-separated)")
  .option("--jsonl", "Force structured output")
  .option("--no-jsonl", "Force human-readable output")
  .addOption(new Option("--json").hideHelp())
  .action(handleAck);

const resolveCommand = new Command("resolve")
  .description("Resolve feedback thread(s)")
  .argument("<ids...>", "Comment IDs (short or full)")
  .option("--repo <name>", "Repository (owner/repo format)")
  .option("--jsonl", "Force structured output")
  .option("--no-jsonl", "Force human-readable output")
  .addOption(new Option("--json").hideHelp())
  .action(handleResolve);

// ─────────────────────────────────────────────────────────────────────────────
// Main command
// ─────────────────────────────────────────────────────────────────────────────

export const feedbackCommand = new Command("feedback")
  .alias("fb")
  .description("Manage PR feedback: list, view, reply, ack, resolve")
  .addCommand(listCommand)
  .addCommand(viewCommand)
  .addCommand(replyCommand)
  .addCommand(ackCommand)
  .addCommand(resolveCommand)
  .action(async (options: ListOptions) => {
    // Default action: run list
    await handleList(options);
  });

// Re-export the reply action for the top-level alias
export { handleReply as feedbackReplyAction };
