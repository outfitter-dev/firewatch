import {
  GitHubClient,
  detectAuth,
  loadConfig,
  queryEntries,
  type FirewatchConfig,
} from "@outfitter/firewatch-core";
import { Command } from "commander";

import { parseRepoInput } from "../repo";
import { outputStructured } from "../utils/json";
import { shouldOutputJson } from "../utils/tty";

interface CloseCommandOptions {
  repo?: string;
  jsonl?: boolean;
}

interface ResolveTarget {
  repo: string;
  pr: number;
  commentId: string;
}

interface CloseResult {
  ok: boolean;
  comment_id: string;
  repo?: string;
  pr?: number;
  thread_id?: string;
  error?: string;
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
  grouped: Map<string, ResolveTarget[]>
): Promise<CloseResult[]> {
  const results: CloseResult[] = [];

  for (const group of grouped.values()) {
    const { repo, pr } = group[0]!;
    const { owner, name } = parseRepoInput(repo);
    let threadMap: Map<string, string>;

    try {
      threadMap = await client.fetchReviewThreadMap(owner, name, pr);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const target of group) {
        results.push({
          ok: false,
          repo,
          pr,
          comment_id: target.commentId,
          error: message,
        });
      }
      continue;
    }

    const resolvedThreads = new Set<string>();
    const failedThreads = new Map<string, string>();

    for (const target of group) {
      const threadId = threadMap.get(target.commentId);
      if (!threadId) {
        results.push({
          ok: false,
          repo,
          pr,
          comment_id: target.commentId,
          error: `No review thread found for comment ${target.commentId}.`,
        });
        continue;
      }

      const failedReason = failedThreads.get(threadId);
      if (failedReason) {
        results.push({
          ok: false,
          repo,
          pr,
          comment_id: target.commentId,
          thread_id: threadId,
          error: failedReason,
        });
        continue;
      }

      if (!resolvedThreads.has(threadId)) {
        try {
          await client.resolveReviewThread(threadId);
          resolvedThreads.add(threadId);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          failedThreads.set(threadId, message);
          results.push({
            ok: false,
            repo,
            pr,
            comment_id: target.commentId,
            thread_id: threadId,
            error: message,
          });
          continue;
        }
      }

      results.push({
        ok: true,
        repo,
        pr,
        comment_id: target.commentId,
        thread_id: threadId,
      });
    }
  }

  return results;
}

function printDeprecationWarning(): void {
  console.error(
    "\u001B[33mWarning: 'fw close' is deprecated. Use instead:\u001B[0m"
  );
  console.error("  fw fb <comment-id> --resolve");
  console.error("");
}

export const closeCommand = new Command("close")
  .description("Resolve review comment threads (deprecated)")
  .argument("<commentIds...>", "Review comment IDs to resolve")
  .option("--repo <name>", "Repository (owner/repo format)")
  .option("--jsonl", "Force structured output")
  .option("--no-jsonl", "Force human-readable output")
  .action(async (commentIds: string[], options: CloseCommandOptions) => {
    printDeprecationWarning();
    try {
      if (commentIds.length === 0) {
        console.error("No comment IDs provided.");
        process.exit(1);
      }

      const config = await loadConfig();
      const outputJson = shouldOutputJson(
        options,
        config.output?.default_format
      );

      const targets: ResolveTarget[] = [];
      const results: CloseResult[] = [];

      for (const commentId of commentIds) {
        const result = await lookupTarget(commentId, options.repo);
        if ("error" in result) {
          results.push({
            ok: false,
            comment_id: commentId,
            error: result.error,
          });
          continue;
        }
        targets.push(result.target);
      }

      if (targets.length > 0) {
        const client = await createClient(config);
        const grouped = groupTargets(targets);
        const resolved = await resolveTargets(client, grouped);
        results.push(...resolved);
      }

      if (results.length > 0 && outputJson) {
        for (const result of results) {
          await outputStructured(result, "jsonl");
        }
      }

      if (!outputJson) {
        const successes = results.filter((result) => result.ok);
        const failures = results.filter((result) => !result.ok);

        if (successes.length > 0) {
          const suffix = successes.length === 1 ? "" : "s";
          console.log(`✓ Closed ${successes.length} thread${suffix}`);
          for (const success of successes) {
            const location =
              success.repo && success.pr
                ? ` (${success.repo}#${success.pr})`
                : "";
            console.log(`  ${success.comment_id}${location}`);
          }
        }

        if (failures.length > 0) {
          const suffix = failures.length === 1 ? "" : "s";
          console.log(`✗ Failed ${failures.length} thread${suffix}:`);
          for (const failure of failures) {
            const location =
              failure.repo && failure.pr
                ? ` (${failure.repo}#${failure.pr})`
                : "";
            const reason = failure.error ?? "Unknown error";
            console.log(`  ${failure.comment_id}${location}: ${reason}`);
          }
        }
      }

      const successCount = results.filter((result) => result.ok).length;
      const failureCount = results.length - successCount;

      if (failureCount === 0) {
        return;
      }

      if (successCount === 0) {
        process.exit(1);
      }

      process.exit(2);
    } catch (error) {
      console.error(
        "Close failed:",
        error instanceof Error ? error.message : error
      );
      process.exit(1);
    }
  });
