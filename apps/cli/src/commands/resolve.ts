import {
  GitHubClient,
  detectAuth,
  loadConfig,
  queryEntries,
} from "@outfitter/firewatch-core";
import { Command } from "commander";

import { parseRepoInput } from "../repo";
import { writeJsonLine } from "../utils/json";

interface ResolveCommandOptions {
  repo?: string;
  pr?: number;
}

interface ResolveTarget {
  repo: string;
  pr: number;
  commentId: string;
}

type LookupResult = { target: ResolveTarget } | { error: string };

async function lookupTarget(commentId: string): Promise<LookupResult> {
  const entries = await queryEntries({ filters: { id: commentId } });
  const entry = entries[0];
  if (!entry) {
    return {
      error: `Comment ${commentId} not found in cache. Run fw sync or pass --repo and --pr.`,
    };
  }

  if (entry.type !== "comment" || entry.subtype !== "review_comment") {
    return {
      error: `Comment ${commentId} is not a review comment thread entry.`,
    };
  }

  return { target: { repo: entry.repo, pr: entry.pr, commentId } };
}

async function collectTargets(
  commentIds: string[],
  options: ResolveCommandOptions
): Promise<{ targets: ResolveTarget[]; hadError: boolean }> {
  const targets: ResolveTarget[] = [];
  let hadError = false;

  if (options.repo && options.pr !== undefined) {
    for (const commentId of commentIds) {
      targets.push({ repo: options.repo, pr: options.pr, commentId });
    }
    return { targets, hadError };
  }

  for (const commentId of commentIds) {
    const result = await lookupTarget(commentId);
    if ("error" in result) {
      console.error(result.error);
      hadError = true;
      continue;
    }
    targets.push(result.target);
  }

  return { targets, hadError };
}

async function createClient(): Promise<GitHubClient> {
  const config = await loadConfig();
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
  grouped: Map<string, ResolveTarget[]>
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

      await writeJsonLine({
        ok: true,
        repo,
        pr,
        comment_id: target.commentId,
        thread_id: threadId,
      });
    }
  }

  return hadError;
}

export const resolveCommand = new Command("resolve")
  .description("Resolve review comment threads")
  .argument("<commentIds...>", "Review comment IDs to resolve")
  .option("--repo <name>", "Repository (owner/repo format)")
  .option("--pr <number>", "PR number", Number.parseInt)
  .option("--json", "Output JSON (default)")
  .action(async (commentIds: string[], options: ResolveCommandOptions) => {
    try {
      if (commentIds.length === 0) {
        console.error("No comment IDs provided.");
        process.exit(1);
      }

      if (
        (options.repo && options.pr === undefined) ||
        (!options.repo && options.pr !== undefined)
      ) {
        console.error("--repo and --pr must be provided together.");
        process.exit(1);
      }

      const { targets, hadError: lookupErrors } = await collectTargets(
        commentIds,
        options
      );

      if (targets.length === 0) {
        process.exit(1);
      }

      const client = await createClient();
      const grouped = groupTargets(targets);
      const resolveErrors = await resolveTargets(client, grouped);

      if (lookupErrors || resolveErrors) {
        process.exit(1);
      }
    } catch (error) {
      console.error(
        "Resolve failed:",
        error instanceof Error ? error.message : error
      );
      process.exit(1);
    }
  });
