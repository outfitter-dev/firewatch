import {
  GitHubClient,
  addAck,
  addAcks,
  batchAddReactions,
  buildAckRecords,
  buildShortIdCache,
  classifyId,
  deduplicateByCommentId,
  detectAuth,
  detectRepo,
  formatShortId,
  generateShortId,
  isAcked,
  loadConfig,
  partitionResolutions,
  queryEntries,
  readAcks,
  removeAck,
  resolveBatchIds,
  resolveShortId,
  type AckRecord,
  type FirewatchConfig,
  type FirewatchEntry,
} from "@outfitter/firewatch-core";
import { Command, Option } from "commander";

import { validateRepoFormat } from "../repo";
import { outputStructured } from "../utils/json";
import { shouldOutputJson } from "../utils/tty";

interface AckCommandOptions {
  repo?: string;
  list?: boolean;
  clear?: string;
  jsonl?: boolean;
  json?: boolean;
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

/**
 * Resolve a comment ID from a pre-loaded entry set.
 * Used by batch operations to avoid N+1 queries.
 */
function resolveCommentFromEntries(
  id: string,
  repo: string,
  entries: FirewatchEntry[]
): { entry: FirewatchEntry; shortId: string } {
  const idType = classifyId(id);

  if (idType === "pr_number") {
    throw new Error("Expected comment ID, got PR number.");
  }

  let commentId = id;
  if (idType === "short_id") {
    const mapping = resolveShortId(id);
    if (!mapping) {
      throw new Error(`Short ID ${formatShortId(id)} not found in cache.`);
    }
    commentId = mapping.fullId;
  } else if (idType !== "full_id") {
    throw new Error(`Invalid ID format: ${id}`);
  }

  const entry = entries.find((candidate) => candidate.id === commentId);
  if (!entry) {
    throw new Error(
      `Comment ${formatShortId(generateShortId(commentId, repo))} not found.`
    );
  }

  const shortId = formatShortId(generateShortId(entry.id, entry.repo));
  return { entry, shortId };
}

async function resolveCommentEntry(
  id: string,
  repo: string
): Promise<{ entry: FirewatchEntry; shortId: string }> {
  const entries = await queryEntries({
    filters: {
      repo,
      type: "comment",
    },
  });

  buildShortIdCache(entries);

  return resolveCommentFromEntries(id, repo, entries);
}

function formatAckLine(ack: AckRecord): string {
  const shortId = formatShortId(generateShortId(ack.comment_id, ack.repo));
  const actor = ack.acked_by ? ` \`@${ack.acked_by}\`` : "";
  const reaction = ack.reaction_added ? "reaction" : "local";
  return `${shortId} ${ack.repo}#${ack.pr} ${ack.acked_at} ${reaction}${actor}`;
}

interface ResolvedComment {
  commentId: string;
  shortId: string;
  pr?: number;
}

/**
 * Resolve comment ID for clear operation.
 * Tries cache first, falls back to existing acks or raw full ID.
 */
async function resolveCommentForClear(
  inputId: string,
  repo: string
): Promise<ResolvedComment> {
  try {
    const resolved = await resolveCommentEntry(inputId, repo);
    return {
      commentId: resolved.entry.id,
      shortId: resolved.shortId,
      pr: resolved.entry.pr,
    };
  } catch {
    // Comment not in cache - check if it's a full ID or find in existing acks
    const idType = classifyId(inputId);

    if (idType === "full_id") {
      return {
        commentId: inputId,
        shortId: formatShortId(generateShortId(inputId, repo)),
      };
    }

    if (idType === "short_id") {
      const acks = await readAcks();
      const normalizedInput = inputId.replace(/^@/, "").toLowerCase();
      const matchingAck = acks.find((ack) => {
        const ackShortId = generateShortId(ack.comment_id, ack.repo);
        return (
          ack.repo === repo && ackShortId.toLowerCase() === normalizedInput
        );
      });

      if (!matchingAck) {
        throw new Error(
          `Short ID ${formatShortId(inputId)} not found in cache or acks.`
        );
      }

      return {
        commentId: matchingAck.comment_id,
        shortId: formatShortId(generateShortId(matchingAck.comment_id, repo)),
        pr: matchingAck.pr,
      };
    }

    throw new Error(`Invalid ID format: ${inputId}`);
  }
}

async function handleList(
  options: AckCommandOptions,
  outputJson: boolean
): Promise<void> {
  if (options.repo) {
    validateRepoFormat(options.repo);
  }
  const acks = await readAcks();
  const filtered = options.repo
    ? acks.filter((ack) => ack.repo === options.repo)
    : acks;

  if (outputJson) {
    for (const ack of filtered) {
      await outputStructured(
        {
          id: formatShortId(generateShortId(ack.comment_id, ack.repo)),
          gh_id: ack.comment_id,
          ...ack,
        },
        "jsonl"
      );
    }
    return;
  }

  if (filtered.length === 0) {
    console.log("No acknowledgements recorded.");
    return;
  }

  console.log(`Acknowledged comments (${filtered.length}):`);
  for (const ack of filtered) {
    console.log(formatAckLine(ack));
  }
}

async function handleClear(
  clearId: string,
  options: AckCommandOptions,
  outputJson: boolean
): Promise<void> {
  const repo = await resolveRepo(options.repo);
  const { commentId, shortId, pr } = await resolveCommentForClear(
    clearId,
    repo
  );
  const removed = await removeAck(commentId, repo);

  if (outputJson) {
    await outputStructured(
      {
        ok: true,
        repo,
        ...(pr !== undefined && { pr }),
        id: shortId,
        gh_id: commentId,
        removed,
      },
      "jsonl"
    );
    return;
  }

  if (removed === 0) {
    console.log(`No acknowledgement found for ${shortId}.`);
    return;
  }

  console.log(`Cleared acknowledgement for ${shortId}.`);
}

async function handleAck(
  id: string,
  options: AckCommandOptions,
  config: FirewatchConfig,
  outputJson: boolean
): Promise<void> {
  const repo = await resolveRepo(options.repo);
  const { entry, shortId } = await resolveCommentEntry(id, repo);
  const alreadyAcked = await isAcked(entry.id, repo);

  if (alreadyAcked) {
    if (outputJson) {
      await outputStructured(
        {
          ok: true,
          repo,
          pr: entry.pr,
          id: shortId,
          gh_id: entry.id,
          acked: true,
          already_acked: true,
        },
        "jsonl"
      );
    } else {
      console.log(`${shortId} already acknowledged.`);
    }
    return;
  }

  const auth = await detectAuth(config.github_token);
  const client = auth.token ? new GitHubClient(auth.token) : null;

  let reactionAdded = false;
  if (client) {
    try {
      await client.addReaction(entry.id, "THUMBS_UP");
      reactionAdded = true;
    } catch {
      // Continue with local ack even if reaction fails
    }
  }

  const ackRecord: AckRecord = {
    repo,
    pr: entry.pr,
    comment_id: entry.id,
    acked_at: new Date().toISOString(),
    ...(config.user?.github_username && {
      acked_by: config.user.github_username,
    }),
    reaction_added: reactionAdded,
  };
  await addAck(ackRecord);

  if (outputJson) {
    await outputStructured(
      {
        ok: true,
        repo,
        pr: entry.pr,
        id: shortId,
        gh_id: entry.id,
        acked: true,
        reaction_added: reactionAdded,
        ...(auth.token ? {} : { warning: auth.error }),
      },
      "jsonl"
    );
    return;
  }

  const reactionMsg = reactionAdded ? " (reaction added)" : "";
  if (!auth.token) {
    console.log(
      `Acknowledged ${shortId}${reactionMsg}. No GitHub token; stored locally only.`
    );
    return;
  }
  console.log(`Acknowledged ${shortId}${reactionMsg}.`);
}

interface MultiAckResult {
  shortId: string;
  ghId: string;
  pr: number;
  reactionAdded: boolean;
  alreadyAcked: boolean;
  error?: string;
}

interface IdResolutionError {
  id: string;
  type: string;
  error: string;
}

async function outputNoValidCommentsError(
  errors: IdResolutionError[],
  outputJson: boolean
): Promise<never> {
  if (outputJson) {
    for (const e of errors) {
      await outputStructured({ ok: false, id: e.id, error: e.error }, "jsonl");
    }
  } else {
    console.error("No valid comment IDs found:");
    for (const e of errors) {
      console.error(`  ${e.id}: ${e.error}`);
    }
  }
  process.exit(1);
}

async function handleMultiAck(
  ids: string[],
  options: AckCommandOptions,
  config: FirewatchConfig,
  outputJson: boolean
): Promise<void> {
  const repo = await resolveRepo(options.repo);

  // Resolve all IDs using batch utilities
  const resolutions = await resolveBatchIds(ids, repo);
  const { comments, errors } = partitionResolutions(resolutions);

  // Filter out PR numbers (not supported in ack)
  const prResolutions = resolutions.filter((r) => r.type === "pr");
  for (const pr of prResolutions) {
    errors.push({
      id: pr.id,
      type: "error",
      error: "Expected comment ID, got PR number.",
    });
  }

  if (comments.length === 0) {
    // Map to IdResolutionError format (ensure error is defined)
    const errorList = errors.map((e) => ({
      id: e.id,
      type: e.type,
      error: e.error ?? "Unknown error",
    }));
    await outputNoValidCommentsError(errorList, outputJson);
  }

  // Deduplicate by comment ID (different short IDs might resolve to same comment)
  const uniqueComments = deduplicateByCommentId(comments);

  // Check which are already acked
  const ackChecks = await Promise.all(
    uniqueComments.map(async (r) => {
      const entry = r.entry!;
      const alreadyAcked = await isAcked(entry.id, repo);
      return { ...r, alreadyAcked };
    })
  );

  const toAck = ackChecks.filter((r) => !r.alreadyAcked);
  const alreadyAcked = ackChecks.filter((r) => r.alreadyAcked);

  // Setup client for reactions
  const auth = await detectAuth(config.github_token);
  const client = auth.token ? new GitHubClient(auth.token) : null;

  // Add reactions in parallel using batch utility
  const reactionResults = client
    ? await batchAddReactions(
        toAck.map((r) => r.entry!.id),
        client
      )
    : toAck.map((r) => ({ commentId: r.entry!.id, reactionAdded: false }));

  // Map reaction results back to entries
  const reactionMap = new Map(
    reactionResults.map((r) => [r.commentId, r.reactionAdded])
  );

  const results: MultiAckResult[] = toAck.map((r) => ({
    shortId: r.shortId!,
    ghId: r.entry!.id,
    pr: r.entry!.pr,
    reactionAdded: reactionMap.get(r.entry!.id) ?? false,
    alreadyAcked: false,
  }));

  // Create ack records using batch utility
  if (results.length > 0) {
    const ackRecords = buildAckRecords(
      results.map((r) => ({
        entry: toAck.find((t) => t.entry!.id === r.ghId)!.entry!,
        reactionAdded: r.reactionAdded,
      })),
      { repo, username: config.user?.github_username }
    );
    await addAcks(ackRecords);
  }

  // Include already-acked in results for reporting
  const allResults: MultiAckResult[] = [
    ...results,
    ...alreadyAcked.map((r) => ({
      shortId: r.shortId!,
      ghId: r.entry!.id,
      pr: r.entry!.pr,
      reactionAdded: false,
      alreadyAcked: true,
    })),
  ];

  const reactionsAdded = results.filter((r) => r.reactionAdded).length;

  if (outputJson) {
    // Output one line per acked comment
    for (const r of allResults) {
      await outputStructured(
        {
          ok: true,
          repo,
          pr: r.pr,
          id: r.shortId,
          gh_id: r.ghId,
          acked: true,
          already_acked: r.alreadyAcked,
          reaction_added: r.reactionAdded,
        },
        "jsonl"
      );
    }
    // Output failures
    for (const e of errors) {
      await outputStructured({ ok: false, id: e.id, error: e.error }, "jsonl");
    }
    return;
  }

  // Human-readable summary
  const newlyAcked = results.length;
  const alreadyAckedCount = alreadyAcked.length;
  const totalProcessed = newlyAcked + alreadyAckedCount;

  if (totalProcessed === 0 && errors.length > 0) {
    console.error("Failed to acknowledge any comments:");
    for (const e of errors) {
      console.error(`  ${e.id}: ${e.error}`);
    }
    process.exit(1);
  }

  const parts: string[] = [];
  if (newlyAcked > 0) {
    const reactionPart =
      reactionsAdded > 0 ? ` (${reactionsAdded} reactions added)` : "";
    parts.push(`${newlyAcked} acknowledged${reactionPart}`);
  }
  if (alreadyAckedCount > 0) {
    parts.push(`${alreadyAckedCount} already acknowledged`);
  }

  console.log(`Acknowledged ${totalProcessed} comments: ${parts.join(", ")}.`);

  // Report failures at end
  if (errors.length > 0) {
    console.error(`\nFailed to resolve ${errors.length} IDs:`);
    for (const e of errors) {
      console.error(`  ${e.id}: ${e.error}`);
    }
  }
}

export const ackCommand = new Command("ack")
  .description("Acknowledge feedback comments (local + optional reaction)")
  .argument("[ids...]", "Comment IDs (short or full)")
  .option("--repo <name>", "Repository (owner/repo format)")
  .option("-l, --list", "List acknowledged comments")
  .option("-x, --clear <id>", "Remove acknowledgement for a comment")
  .option("-y, --yes", "Skip confirmation for bulk operations")
  .option("--jsonl", "Force structured output")
  .option("--no-jsonl", "Force human-readable output")
  .addOption(new Option("--json").hideHelp())
  .action(async (ids: string[], options: AckCommandOptions) => {
    const config = await loadConfig();
    const outputJson = shouldOutputJson(options, config.output?.default_format);

    if (options.list) {
      await handleList(options, outputJson);
      return;
    }

    if (options.clear) {
      await handleClear(options.clear, options, outputJson);
      return;
    }

    if (ids.length === 0) {
      console.error("Provide comment ID(s) or use --list.");
      process.exit(1);
    }

    // Single ID: keep existing behavior for backward compatibility
    if (ids.length === 1) {
      // Safe assertion: we've verified ids.length === 1
      await handleAck(ids[0]!, options, config, outputJson);
      return;
    }

    // Multiple IDs: use batch processing
    await handleMultiAck(ids, options, config, outputJson);
  });
