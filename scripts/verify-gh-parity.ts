#!/usr/bin/env bun
/**
 * Verify parity between GitHub API and Firewatch for unresolved review threads.
 *
 * This script compares unresolved thread counts from GitHub GraphQL API
 * with the cached data in Firewatch to detect sync discrepancies.
 *
 * Usage:
 *   bun scripts/verify-gh-parity.ts [repo]
 *
 * Example:
 *   bun scripts/verify-gh-parity.ts outfitter-dev/firewatch
 */

import { $ } from "bun";

import {
  compareThreads,
  formatParityResult,
  type GitHubThreadData,
} from "../packages/core/src/parity";

/**
 * Fetch unresolved thread data from GitHub GraphQL API.
 */
async function fetchGitHubThreads(
  repo: string
): Promise<Map<number, GitHubThreadData[]>> {
  const [owner, name] = repo.split("/");

  const query = `
    query {
      repository(owner: "${owner}", name: "${name}") {
        pullRequests(first: 50, states: OPEN) {
          nodes {
            number
            reviewThreads(first: 100) {
              nodes {
                id
                isResolved
                comments(first: 1) {
                  nodes {
                    id
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  const result = await $`gh api graphql -f query=${query}`.json();
  const prs = result.data?.repository?.pullRequests?.nodes ?? [];

  const byPr = new Map<number, GitHubThreadData[]>();

  for (const pr of prs) {
    const threads: GitHubThreadData[] = [];
    for (const thread of pr.reviewThreads?.nodes ?? []) {
      if (!thread.isResolved) {
        threads.push({
          pr: pr.number,
          threadId: thread.id,
          commentId: thread.comments?.nodes?.[0]?.id,
        });
      }
    }
    if (threads.length > 0) {
      byPr.set(pr.number, threads);
    }
  }

  return byPr;
}

/**
 * Fetch unresolved thread data from Firewatch cache.
 */
async function fetchFirewatchThreads(
  repo: string
): Promise<Map<number, string[]>> {
  // Query fw for review comments with thread_resolved=false on open PRs
  const result =
    await $`bun apps/cli/bin/fw.ts --type comment --open --offline --repo ${repo}`.text();

  const byPr = new Map<number, string[]>();

  for (const line of result.split("\n").filter(Boolean)) {
    try {
      const entry = JSON.parse(line);
      if (
        entry.subtype === "review_comment" &&
        entry.thread_resolved === false
      ) {
        const list = byPr.get(entry.pr) ?? [];
        list.push(entry.id);
        byPr.set(entry.pr, list);
      }
    } catch {
      // Skip non-JSON lines
    }
  }

  return byPr;
}

// Main execution
async function main() {
  const repo = process.argv[2] ?? "outfitter-dev/firewatch";

  console.log(`Checking parity for ${repo}...`);

  try {
    const [ghByPr, fwByPr] = await Promise.all([
      fetchGitHubThreads(repo),
      fetchFirewatchThreads(repo),
    ]);

    const result = compareThreads(repo, ghByPr, fwByPr);
    console.log(formatParityResult(result));

    process.exit(result.match ? 0 : 1);
  } catch (error) {
    console.error("Error:", error instanceof Error ? error.message : error);
    process.exit(2);
  }
}

main();
