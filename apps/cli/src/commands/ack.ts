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
  type FirewatchEntry,
} from "@outfitter/firewatch-core";
import { Command } from "commander";

import { validateRepoFormat } from "../repo";
import { outputStructured } from "../utils/json";
import { shouldOutputJson } from "../utils/tty";

interface AckCommandOptions {
  repo?: string;
  list?: boolean;
  clear?: string;
  jsonl?: boolean;
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
  const actor = ack.acked_by ? ` @${ack.acked_by}` : "";
  const reaction = ack.reaction_added ? "reaction" : "local";
  return `${shortId} ${ack.repo}#${ack.pr} ${ack.acked_at} ${reaction}${actor}`;
}

export const ackCommand = new Command("ack")
  .description("Acknowledge feedback comments (local + optional reaction)")
  .argument("[id]", "Comment ID (short or full)")
  .option("--repo <name>", "Repository (owner/repo format)")
  .option("--list", "List acknowledged comments")
  .option("--clear <id>", "Remove acknowledgement for a comment")
  .option("--jsonl", "Force structured output")
  .option("--no-jsonl", "Force human-readable output")
  .action(async (id: string | undefined, options: AckCommandOptions) => {
    const config = await loadConfig();
    const outputJson = shouldOutputJson(options, config.output?.default_format);

    if (options.list) {
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
      return;
    }

    if (options.clear) {
      const repo = await resolveRepo(options.repo);
      const { entry, shortId } = await resolveCommentEntry(options.clear, repo);
      const removed = await removeAck(entry.id, repo);

      if (outputJson) {
        await outputStructured(
          {
            ok: true,
            repo,
            pr: entry.pr,
            id: shortId,
            gh_id: entry.id,
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
      return;
    }

    if (!id) {
      console.error("Provide a comment ID or use --list.");
      process.exit(1);
    }

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
  });
