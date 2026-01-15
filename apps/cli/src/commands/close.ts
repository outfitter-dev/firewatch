import {
  GitHubClient,
  detectAuth,
  loadConfig,
  queryEntries,
  type FirewatchConfig,
} from "@outfitter/firewatch-core";
import { Command } from "commander";

import { parseRepoInput } from "../repo";
import { writeJsonLine } from "../utils/json";
import { shouldOutputJson } from "../utils/tty";

interface CloseCommandOptions {
  repo?: string;
  json?: boolean;
  noJson?: boolean;
}

interface ResolveTarget {
  repo: string;
  pr: number;
  commentId: string;
}

type LookupResult = { target: ResolveTarget } | { error: string };

async function lookupTarget(
  commentId: string,
  repoFilter?: string
): Promise<LookupResult> {
  const entries = await queryEntries({
    filters: {
      id: commentId,
      ...(repoFilter && { repo: repoFilter }),
    },
  });
  const entry = entries[0];
  if (!entry) {
    return {
      error: `Comment ${commentId} not found in cache. Run fw --refresh or sync first.`,
    };
  }

  if (entry.type !== "comment" || entry.subtype !== "review_comment") {
    return {
      error: `Comment ${commentId} is not a review thread comment.`,
    };
  }

  return { target: { repo: entry.repo, pr: entry.pr, commentId } };
}

async function createClient(config: FirewatchConfig): Promise<GitHubClient> {
  const auth = await detectAuth(config.github_token);
  if (!auth.token) {
    throw new Error(auth.error);
  }
  return new GitHubClient(auth.token);
}

function groupTargets(targets: ResolveTarget[]): Map<string, ResolveTarget[]> {
  const grouped = new Map<string, ResolveTarget[]>();
  for (const target of targets) {
    const key = `${target.repo}#${target.pr}`;
    const group = grouped.get(key) ?? [];
    group.push(target);
    grouped.set(key, group);
  }
  return grouped;
}

async function resolveTargets(
  client: GitHubClient,
  grouped: Map<string, ResolveTarget[]>,
  outputJson: boolean
): Promise<boolean> {
  let hadError = false;

  for (const group of grouped.values()) {
    const { repo, pr } = group[0]!;
    const { owner, name } = parseRepoInput(repo);
    const threadMap = await client.fetchReviewThreadMap(owner, name, pr);
    const resolvedThreads = new Set<string>();

    for (const target of group) {
      const threadId = threadMap.get(target.commentId);
      if (!threadId) {
        console.error(
          `No review thread found for comment ${target.commentId} (repo ${repo} PR ${pr}).`
        );
        hadError = true;
        continue;
      }

      if (!resolvedThreads.has(threadId)) {
        await client.resolveReviewThread(threadId);
        resolvedThreads.add(threadId);
      }

      const payload = {
        ok: true,
        repo,
        pr,
        comment_id: target.commentId,
        thread_id: threadId,
      };

      if (outputJson) {
        await writeJsonLine(payload);
      } else {
        console.log(`Resolved ${target.commentId} on ${repo}#${pr}.`);
      }
    }
  }

  return hadError;
}

export const closeCommand = new Command("close")
  .description("Resolve review comment threads")
  .argument("<commentIds...>", "Review comment IDs to resolve")
  .option("--repo <name>", "Repository (owner/repo format)")
  .option("--json", "Force JSON output")
  .option("--no-json", "Force human-readable output")
  .action(async (commentIds: string[], options: CloseCommandOptions) => {
    try {
      if (commentIds.length === 0) {
        console.error("No comment IDs provided.");
        process.exit(1);
      }

      const config = await loadConfig();
      const outputJson = shouldOutputJson(options, config.output?.default_format);

      const targets: ResolveTarget[] = [];
      let hadLookupError = false;

      for (const commentId of commentIds) {
        const result = await lookupTarget(commentId, options.repo);
        if ("error" in result) {
          console.error(result.error);
          hadLookupError = true;
          continue;
        }
        targets.push(result.target);
      }

      if (targets.length === 0) {
        process.exit(1);
      }

      const client = await createClient(config);
      const grouped = groupTargets(targets);
      const resolveErrors = await resolveTargets(client, grouped, outputJson);

      if (hadLookupError || resolveErrors) {
        process.exit(1);
      }
    } catch (error) {
      console.error(
        "Close failed:",
        error instanceof Error ? error.message : error
      );
      process.exit(1);
    }
  });
