/**
 * Top-level reply command for Firewatch CLI.
 *
 * Replaces `fw feedback reply` with direct `fw reply` access.
 */

import {
  type GitHubClient,
  buildShortIdCache,
  classifyId,
  formatDisplayId,
  generateShortId,
  loadConfig,
  queryEntries,
  resolveBatchIds,
  resolveShortId,
  type FirewatchConfig,
  type FirewatchEntry,
} from "@outfitter/firewatch-core";
import { Command, Option } from "commander";

import { createAuthenticatedClient } from "../auth-client";
import { applyCommonOptions } from "../query-helpers";
import { parseRepoInput, resolveRepoOrThrow } from "../repo";
import { outputStructured } from "../utils/json";
import { shouldOutputJson } from "../utils/tty";

export interface ReplyCommandOptions {
  repo?: string;
  body?: string;
  resolve?: boolean;
  jsonl?: boolean;
  json?: boolean;
  debug?: boolean;
  noColor?: boolean;
}

interface ReplyContext {
  client: GitHubClient;
  config: FirewatchConfig;
  repo: string;
  owner: string;
  name: string;
  outputJson: boolean;
}

async function createContext(
  options: ReplyCommandOptions
): Promise<ReplyContext> {
  const config = await loadConfig();
  const repo = await resolveRepoOrThrow(options.repo);
  const { owner, name } = parseRepoInput(repo);

  const { client } = await createAuthenticatedClient(config.github_token);

  return {
    client,
    config,
    repo,
    owner,
    name,
    outputJson: shouldOutputJson(options, config.output?.default_format),
  };
}

/**
 * Resolve a comment ID from cache or batch lookup.
 */
async function resolveCommentId(
  id: string,
  repo: string,
  entries: FirewatchEntry[]
): Promise<{ entry: FirewatchEntry; shortId: string } | null> {
  const idType = classifyId(id);

  if (idType === "pr_number") {
    return null; // PR numbers handled separately
  }

  let commentId = id;
  if (idType === "short_id") {
    const mapping = resolveShortId(id);
    if (mapping) {
      commentId = mapping.fullId;
    } else {
      // Try batch resolution
      const [resolution] = await resolveBatchIds([id], repo);
      if (!resolution || resolution.type === "error" || !resolution.entry) {
        return null;
      }
      commentId = resolution.entry.id;
    }
  }

  const entry = entries.find((e) => e.id === commentId);
  if (!entry) {
    return null;
  }

  const shortId = formatDisplayId(generateShortId(entry.id, repo));
  return { entry, shortId };
}

/**
 * Reply to a review thread comment.
 */
async function replyToReviewThread(
  ctx: ReplyContext,
  entry: FirewatchEntry,
  shortId: string,
  body: string,
  resolve: boolean
): Promise<void> {
  const threadMapResult = await ctx.client.fetchReviewThreadMap(
    ctx.owner,
    ctx.name,
    entry.pr
  );
  if (threadMapResult.isErr()) {
    throw threadMapResult.error;
  }
  const threadId = threadMapResult.value.get(entry.id);

  if (!threadId) {
    throw new Error(`No review thread found for comment ${shortId}`);
  }

  const replyResult = await ctx.client.addReviewThreadReply(threadId, body);
  if (replyResult.isErr()) {
    throw replyResult.error;
  }
  const reply = replyResult.value;

  if (resolve) {
    const resolveResult = await ctx.client.resolveReviewThread(threadId);
    if (resolveResult.isErr()) {
      throw resolveResult.error;
    }
  }

  const replyShortId = formatDisplayId(generateShortId(reply.id, ctx.repo));

  const payload = {
    ok: true,
    repo: ctx.repo,
    pr: entry.pr,
    id: replyShortId,
    gh_id: reply.id,
    reply_to: shortId,
    reply_to_gh_id: entry.id,
    ...(resolve && { resolved: true }),
    ...(reply.url && { url: reply.url }),
  };

  if (ctx.outputJson) {
    await outputStructured(payload, "jsonl");
  } else {
    const resolveMsg = resolve ? " and resolved thread" : "";
    console.log(`Replied to ${shortId}${resolveMsg}. ${replyShortId}`);
    if (reply.url) {
      console.log(reply.url);
    }
  }
}

/**
 * Add a PR-level comment (for issue comments or PR number replies).
 */
async function addPrComment(
  ctx: ReplyContext,
  pr: number,
  body: string,
  replyTo?: { shortId: string; ghId: string }
): Promise<void> {
  const prIdResult = await ctx.client.fetchPullRequestId(
    ctx.owner,
    ctx.name,
    pr
  );
  if (prIdResult.isErr()) {
    throw prIdResult.error;
  }
  const commentResult = await ctx.client.addIssueComment(
    prIdResult.value,
    body
  );
  if (commentResult.isErr()) {
    throw commentResult.error;
  }
  const comment = commentResult.value;

  const newShortId = formatDisplayId(generateShortId(comment.id, ctx.repo));

  const payload = {
    ok: true,
    repo: ctx.repo,
    pr,
    id: newShortId,
    gh_id: comment.id,
    ...(replyTo && {
      in_reply_to: replyTo.shortId,
      in_reply_to_gh_id: replyTo.ghId,
    }),
    ...(comment.url && { url: comment.url }),
  };

  if (ctx.outputJson) {
    await outputStructured(payload, "jsonl");
  } else {
    const msg = replyTo
      ? `Replied to ${replyTo.shortId}. ${newShortId}`
      : `Added comment to ${ctx.repo}#${pr}. ${newShortId}`;
    console.log(msg);
    if (comment.url) {
      console.log(comment.url);
    }
  }
}

/**
 * Handle the reply action.
 */
export async function replyAction(
  id: string,
  bodyArg: string | undefined,
  options: ReplyCommandOptions
): Promise<void> {
  applyCommonOptions(options);
  const body = bodyArg ?? options.body;
  if (!body) {
    console.error(
      "Reply body required. Use: fw reply <id> <body> or fw reply <id> --body <text>"
    );
    process.exit(1);
  }

  try {
    const ctx = await createContext(options);

    // Pre-populate cache for short ID resolution
    const entries = await queryEntries({
      filters: { repo: ctx.repo },
    });
    buildShortIdCache(entries);

    const idType = classifyId(id);

    // PR number: add a new comment to the PR
    if (idType === "pr_number") {
      const prNum = Number.parseInt(id, 10);
      if (Number.isNaN(prNum)) {
        console.error(`Invalid PR number: ${id}`);
        process.exit(1);
      }
      await addPrComment(ctx, prNum, body);
      return;
    }

    // Comment ID: reply to the specific comment
    const resolved = await resolveCommentId(id, ctx.repo, entries);
    if (!resolved) {
      console.error(`Comment ${id} not found.`);
      process.exit(1);
    }

    const { entry, shortId } = resolved;

    if (entry.subtype === "review_comment") {
      await replyToReviewThread(
        ctx,
        entry,
        shortId,
        body,
        options.resolve ?? false
      );
    } else {
      // Issue comment - add a new PR comment as "reply"
      await addPrComment(ctx, entry.pr, body, { shortId, ghId: entry.id });
    }
  } catch (error) {
    console.error(
      "Reply failed:",
      error instanceof Error ? error.message : error
    );
    process.exit(1);
  }
}

export const replyCommand = new Command("reply")
  .description("Reply to a feedback comment or PR")
  .argument("<id>", "Comment ID (short @xxxxx or full) or PR number")
  .argument("[body]", "Reply text")
  .option("--repo <name>", "Repository (owner/repo format)")
  .option("-b, --body <text>", "Reply text (alternative to positional)")
  .option("--resolve", "Resolve the thread after replying")
  .option("--jsonl", "Force structured output")
  .option("--no-jsonl", "Force human-readable output")
  .addOption(new Option("--json").hideHelp())
  .option("--debug", "Enable debug logging")
  .option("--no-color", "Disable color output")
  .action(replyAction);
