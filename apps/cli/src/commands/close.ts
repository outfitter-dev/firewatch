import {
  GitHubClient,
  addAcks,
  buildAckRecords,
  buildShortIdCache,
  deduplicateByCommentId,
  detectAuth,
  detectRepo,
  formatDisplayId,
  generateShortId,
  getAckedIds,
  loadConfig,
  partitionResolutions,
  queryEntries,
  resolveBatchIds,
  type BatchIdResolution,
  type FirewatchConfig,
  type FirewatchEntry,
} from "@outfitter/firewatch-core";
import { Command, Option } from "commander";

import { identifyUnaddressedFeedback } from "../actionable";
import { applyCommonOptions } from "../query-helpers";
import { parseRepoInput, validateRepoFormat } from "../repo";
import { outputStructured } from "../utils/json";
import { shouldOutputJson } from "../utils/tty";

export interface CloseCommandOptions {
  repo?: string;
  all?: boolean;
  feedback?: boolean;
  yes?: boolean;
  jsonl?: boolean;
  json?: boolean;
  debug?: boolean;
  noColor?: boolean;
}

interface CloseContext {
  client: GitHubClient;
  config: FirewatchConfig;
  repo: string;
  owner: string;
  name: string;
  outputJson: boolean;
}

async function resolveRepo(repo?: string): Promise<string> {
  if (repo) {
    validateRepoFormat(repo);
    return repo;
  }

  const detected = await detectRepo();
  if (!detected.repo) {
    throw new Error("No repository detected. Use --repo owner/repo.");
  }

  return detected.repo;
}

async function createContext(options: CloseCommandOptions): Promise<CloseContext> {
  const config = await loadConfig();
  const repo = await resolveRepo(options.repo);
  const { owner, name } = parseRepoInput(repo);

  const auth = await detectAuth(config.github_token);
  if (auth.isErr()) {
    throw new Error(auth.error.message);
  }

  const client = new GitHubClient(auth.value.token);

  return {
    client,
    config,
    repo,
    owner,
    name,
    outputJson: shouldOutputJson(options, config.output?.default_format),
  };
}

interface CloseResult {
  shortId: string;
  ghId: string;
  pr: number;
  resolved: boolean;
  acked: boolean;
  error?: string;
}

async function closeComment(
  ctx: CloseContext,
  commentId: string,
  shortId: string,
  pr: number,
  subtype: string | undefined
): Promise<CloseResult> {
  // For review comments, resolve the thread
  if (subtype === "review_comment") {
    try {
      const threadMap = await ctx.client.fetchReviewThreadMap(
        ctx.owner,
        ctx.name,
        pr
      );
      const threadId = threadMap.get(commentId);

      if (!threadId) {
        return {
          shortId,
          ghId: commentId,
          pr,
          resolved: false,
          acked: false,
          error: "No review thread found",
        };
      }

      await ctx.client.resolveReviewThread(threadId);
      return { shortId, ghId: commentId, pr, resolved: true, acked: false };
    } catch (error) {
      return {
        shortId,
        ghId: commentId,
        pr,
        resolved: false,
        acked: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // For issue comments, just ack (can't resolve issue comments)
  try {
    await ctx.client.addReaction(commentId, "THUMBS_UP");
    return { shortId, ghId: commentId, pr, resolved: false, acked: true };
  } catch {
    // Reaction may already exist - still count as acked
    return { shortId, ghId: commentId, pr, resolved: false, acked: true };
  }
}

async function closePR(ctx: CloseContext, prNum: number): Promise<void> {
  try {
    const prId = await ctx.client.fetchPullRequestId(ctx.owner, ctx.name, prNum);
    await ctx.client.closePullRequest(prId);

    if (ctx.outputJson) {
      await outputStructured(
        { ok: true, repo: ctx.repo, pr: prNum, closed: true },
        "jsonl"
      );
    } else {
      console.log(`Closed PR #${prNum}.`);
    }
  } catch (error) {
    if (ctx.outputJson) {
      await outputStructured(
        {
          ok: false,
          pr: prNum,
          error: error instanceof Error ? error.message : String(error),
        },
        "jsonl"
      );
    } else {
      console.error(
        `Failed to close PR #${prNum}: ${error instanceof Error ? error.message : error}`
      );
    }
  }
}

function buildSuccessItems(
  results: CloseResult[],
  entryMap: Map<string, FirewatchEntry>
): { entry: FirewatchEntry; reactionAdded: boolean }[] {
  return results
    .filter((r) => r.resolved || r.acked)
    .map((r) => {
      const entry = entryMap.get(r.ghId);
      if (!entry) {
        return null;
      }
      return { entry, reactionAdded: r.acked };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);
}

async function outputCommentResults(
  ctx: CloseContext,
  results: CloseResult[],
  errors: BatchIdResolution[]
): Promise<void> {
  if (ctx.outputJson) {
    for (const r of results) {
      await outputStructured(
        {
          ok: !r.error,
          repo: ctx.repo,
          pr: r.pr,
          id: r.shortId,
          gh_id: r.ghId,
          resolved: r.resolved,
          acked: r.acked,
          ...(r.error && { error: r.error }),
        },
        "jsonl"
      );
    }
    for (const e of errors) {
      await outputStructured({ ok: false, id: e.id, error: e.error }, "jsonl");
    }
    return;
  }

  // Human-readable output
  const resolved = results.filter((r) => r.resolved).length;
  const acked = results.filter((r) => r.acked && !r.resolved).length;
  const failed = results.filter((r) => r.error).length + errors.length;

  const parts: string[] = [];
  if (resolved > 0) {
    parts.push(`${resolved} resolved`);
  }
  if (acked > 0) {
    parts.push(`${acked} acknowledged`);
  }
  if (failed > 0) {
    parts.push(`${failed} failed`);
  }

  console.log(`Closed ${results.length} comments: ${parts.join(", ")}.`);

  for (const e of errors) {
    console.error(`  ${e.id}: ${e.error}`);
  }
}

async function handleCloseComments(
  ctx: CloseContext,
  ids: string[],
  options: { autoConfirm?: boolean; feedback?: boolean }
): Promise<void> {
  const { autoConfirm = false, feedback = false } = options;
  const resolutions = await resolveBatchIds(ids, ctx.repo);
  const { comments, prs, errors } = partitionResolutions(resolutions);

  // Handle PR numbers
  if (prs.length > 0) {
    for (const prRes of prs) {
      const prNum = prRes.pr!;

      if (feedback) {
        // --feedback flag: resolve all threads in the PR
        await handleClosePrFeedback(ctx, prNum, autoConfirm);
      } else {
        // Default: close the PR itself (requires confirmation)
        if (!autoConfirm && !ctx.outputJson) {
          console.error(`This will close PR #${prNum}.`);
          console.error("Use --yes to confirm, or --feedback to resolve threads instead.");
          continue;
        }
        await closePR(ctx, prNum);
      }
    }

    // If only PR numbers were provided, we're done
    if (comments.length === 0 && errors.length === 0) {
      return;
    }
  }

  // Handle comment IDs
  const uniqueComments = deduplicateByCommentId(comments);

  // Get entry details for subtype detection
  const entries = await queryEntries({
    filters: { repo: ctx.repo, type: "comment" },
  });
  const entryMap = new Map(entries.map((e) => [e.id, e]));

  const results: CloseResult[] = [];

  for (const comment of uniqueComments) {
    const entry = comment.entry ?? entryMap.get(comment.id);
    if (!entry) {
      results.push({
        shortId: comment.shortId ?? comment.id,
        ghId: comment.id,
        pr: 0,
        resolved: false,
        acked: false,
        error: "Entry not found",
      });
      continue;
    }

    const result = await closeComment(
      ctx,
      entry.id,
      comment.shortId ?? formatDisplayId(generateShortId(entry.id, ctx.repo)),
      entry.pr,
      entry.subtype
    );
    results.push(result);
  }

  // Create ack records for resolved/acked comments
  const successfulItems = buildSuccessItems(results, entryMap);

  if (successfulItems.length > 0) {
    const ackRecords = buildAckRecords(successfulItems, {
      repo: ctx.repo,
      username: ctx.config.user?.github_username,
    });
    await addAcks(ackRecords);
  }

  await outputCommentResults(ctx, results, errors);
}

async function handleCloseAll(
  ctx: CloseContext,
  autoConfirm: boolean
): Promise<void> {
  const entries = await queryEntries({
    filters: { repo: ctx.repo, type: "comment" },
  });

  buildShortIdCache(entries);

  const ackedIds = await getAckedIds(ctx.repo);
  const feedbacks = identifyUnaddressedFeedback(entries, {
    ackedIds,
    username: ctx.config.user?.github_username,
    commitImpliesRead: ctx.config.feedback?.commit_implies_read,
  });

  if (feedbacks.length === 0) {
    if (ctx.outputJson) {
      await outputStructured(
        { ok: true, repo: ctx.repo, closed_count: 0 },
        "jsonl"
      );
    } else {
      console.error("No unaddressed feedback to close.");
    }
    return;
  }

  if (!autoConfirm && !ctx.outputJson) {
    console.error(`Found ${feedbacks.length} unaddressed feedback items.`);
    console.error("Use --yes to confirm closing all.");
    return;
  }

  // Close all feedback
  const entryMap = new Map(entries.map((e) => [e.id, e]));
  const results: CloseResult[] = [];

  for (const fb of feedbacks) {
    const entry = entryMap.get(fb.comment_id);
    if (!entry) {
      continue;
    }

    const shortId = formatDisplayId(generateShortId(entry.id, ctx.repo));
    const result = await closeComment(
      ctx,
      entry.id,
      shortId,
      entry.pr,
      entry.subtype
    );
    results.push(result);
  }

  // Create ack records
  const successfulItems = buildSuccessItems(results, entryMap);

  if (successfulItems.length > 0) {
    const ackRecords = buildAckRecords(successfulItems, {
      repo: ctx.repo,
      username: ctx.config.user?.github_username,
    });
    await addAcks(ackRecords);
  }

  const resolved = results.filter((r) => r.resolved).length;
  const acked = results.filter((r) => r.acked && !r.resolved).length;

  if (ctx.outputJson) {
    await outputStructured(
      {
        ok: true,
        repo: ctx.repo,
        closed_count: results.length,
        resolved_count: resolved,
        acked_count: acked,
      },
      "jsonl"
    );
  } else {
    console.log(
      `Closed ${results.length} feedback items (${resolved} resolved, ${acked} acknowledged).`
    );
  }
}

/**
 * Resolve all unaddressed feedback threads in a specific PR.
 */
async function handleClosePrFeedback(
  ctx: CloseContext,
  prNum: number,
  autoConfirm: boolean
): Promise<void> {
  const entries = await queryEntries({
    filters: { repo: ctx.repo, pr: prNum, type: "comment" },
  });

  buildShortIdCache(entries);

  const ackedIds = await getAckedIds(ctx.repo);
  const feedbacks = identifyUnaddressedFeedback(entries, {
    ackedIds,
    username: ctx.config.user?.github_username,
    commitImpliesRead: ctx.config.feedback?.commit_implies_read,
  });

  if (feedbacks.length === 0) {
    if (ctx.outputJson) {
      await outputStructured(
        { ok: true, repo: ctx.repo, pr: prNum, closed_count: 0 },
        "jsonl"
      );
    } else {
      console.error(`No unaddressed feedback on PR #${prNum}.`);
    }
    return;
  }

  if (!autoConfirm && !ctx.outputJson) {
    console.error(`Found ${feedbacks.length} unaddressed feedback items on PR #${prNum}.`);
    console.error("Use --yes to confirm closing all.");
    return;
  }

  const entryMap = new Map(entries.map((e) => [e.id, e]));
  const results: CloseResult[] = [];

  for (const fb of feedbacks) {
    const entry = entryMap.get(fb.comment_id);
    if (!entry) {
      continue;
    }

    const shortId = formatDisplayId(generateShortId(entry.id, ctx.repo));
    const result = await closeComment(
      ctx,
      entry.id,
      shortId,
      entry.pr,
      entry.subtype
    );
    results.push(result);
  }

  // Create ack records
  const successfulItems = buildSuccessItems(results, entryMap);

  if (successfulItems.length > 0) {
    const ackRecords = buildAckRecords(successfulItems, {
      repo: ctx.repo,
      username: ctx.config.user?.github_username,
    });
    await addAcks(ackRecords);
  }

  const resolved = results.filter((r) => r.resolved).length;
  const acked = results.filter((r) => r.acked && !r.resolved).length;

  if (ctx.outputJson) {
    await outputStructured(
      {
        ok: true,
        repo: ctx.repo,
        pr: prNum,
        closed_count: results.length,
        resolved_count: resolved,
        acked_count: acked,
      },
      "jsonl"
    );
  } else {
    console.log(
      `Closed ${results.length} feedback items on PR #${prNum} (${resolved} resolved, ${acked} acknowledged).`
    );
  }
}

export async function closeAction(
  ids: string[],
  options: CloseCommandOptions
): Promise<void> {
  applyCommonOptions(options);
  try {
    const ctx = await createContext(options);

    if (options.all) {
      await handleCloseAll(ctx, options.yes ?? false);
      return;
    }

    if (ids.length === 0) {
      console.error("Provide comment/PR IDs or use --all.");
      process.exit(1);
    }

    await handleCloseComments(ctx, ids, {
      autoConfirm: options.yes ?? false,
      feedback: options.feedback ?? false,
    });
  } catch (error) {
    console.error(
      "Close operation failed:",
      error instanceof Error ? error.message : error
    );
    process.exit(1);
  }
}

export const closeCommand = new Command("close")
  .description("Close feedback: resolve review threads or close PRs")
  .argument("[ids...]", "Comment IDs (short @xxxxx or full) or PR numbers")
  .option("--repo <name>", "Repository (owner/repo format)")
  .option("-a, --all", "Close all unaddressed feedback")
  .option("-f, --feedback", "Resolve all feedback threads in specified PR(s)")
  .option("-y, --yes", "Auto-confirm bulk operations")
  .option("--jsonl", "Force structured output")
  .option("--no-jsonl", "Force human-readable output")
  .addOption(new Option("--json").hideHelp())
  .option("--debug", "Enable debug logging")
  .option("--no-color", "Disable color output")
  .action(closeAction);
