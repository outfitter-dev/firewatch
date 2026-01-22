#!/usr/bin/env bun
/**
 * Verify parity between GitHub API and Firewatch for all comment types.
 *
 * This script compares comments from GitHub GraphQL API with the cached data
 * in Firewatch to detect sync discrepancies, including state mismatches.
 *
 * Usage:
 *   bun scripts/verify-gh-parity.ts [repo] [options]
 *
 * Options:
 *   --type <type>    Filter by type: review_comment, issue_comment, or all (default: all)
 *   --resolved       Only compare resolved review comments
 *   --unresolved     Only compare unresolved review comments
 *   --json           Output raw JSON instead of formatted text
 *
 * Examples:
 *   bun scripts/verify-gh-parity.ts outfitter-dev/firewatch
 *   bun scripts/verify-gh-parity.ts outfitter-dev/firewatch --type review_comment
 *   bun scripts/verify-gh-parity.ts outfitter-dev/firewatch --unresolved
 *   bun scripts/verify-gh-parity.ts outfitter-dev/firewatch --json
 */

import { $ } from "bun";

import {
  compareParityData,
  formatParityResult,
  type ParityComment,
  type ParityData,
  type ParityFilterOptions,
} from "../packages/core/src/parity";

interface CliOptions {
  repo: string;
  filters: ParityFilterOptions;
  json: boolean;
}

/**
 * Parse CLI arguments into options.
 */
function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    repo: "outfitter-dev/firewatch",
    filters: {},
    json: false,
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg === "--type" && i + 1 < args.length) {
      const typeArg = args[i + 1];
      if (
        typeArg === "review_comment" ||
        typeArg === "issue_comment" ||
        typeArg === "all"
      ) {
        options.filters.type = typeArg;
      } else {
        console.error(`Invalid type: ${typeArg}`);
        process.exit(2);
      }
      i += 2;
    } else if (arg === "--resolved") {
      options.filters.resolved = true;
      i++;
    } else if (arg === "--unresolved") {
      options.filters.unresolved = true;
      i++;
    } else if (arg === "--json") {
      options.json = true;
      i++;
    } else if (arg?.startsWith("-")) {
      console.error(`Unknown option: ${arg}`);
      process.exit(2);
    } else {
      options.repo = arg ?? options.repo;
      i++;
    }
  }

  // Validate conflicting options
  if (options.filters.resolved && options.filters.unresolved) {
    console.error("Cannot use both --resolved and --unresolved");
    process.exit(2);
  }

  return options;
}

/**
 * GraphQL response types
 */
interface GqlComment {
  id: string;
  author?: { login: string };
}

interface GqlReviewThread {
  id: string;
  isResolved: boolean;
  comments: {
    nodes: GqlComment[];
  };
}

interface GqlPullRequest {
  number: number;
  comments: {
    nodes: GqlComment[];
  };
  reviewThreads: {
    nodes: GqlReviewThread[];
  };
}

interface GqlResponse {
  data: {
    repository: {
      pullRequests: {
        nodes: GqlPullRequest[];
      };
    };
  };
}

/**
 * Fetch all comment data from GitHub GraphQL API.
 */
async function fetchGitHubData(repo: string): Promise<ParityData> {
  const [owner, name] = repo.split("/");

  const query = `
    query {
      repository(owner: "${owner}", name: "${name}") {
        pullRequests(first: 50, states: OPEN) {
          nodes {
            number
            comments(first: 100) {
              nodes {
                id
                author { login }
              }
            }
            reviewThreads(first: 100) {
              nodes {
                id
                isResolved
                comments(first: 50) {
                  nodes {
                    id
                    author { login }
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  const result = (await $`gh api graphql -f query=${query}`.json()) as GqlResponse;
  const prs = result.data?.repository?.pullRequests?.nodes ?? [];

  const data: ParityData = {
    reviewComments: new Map(),
    issueComments: new Map(),
  };

  for (const pr of prs) {
    // Process issue comments (PR-level discussion)
    for (const comment of pr.comments?.nodes ?? []) {
      const parityComment: ParityComment = {
        id: comment.id,
        pr: pr.number,
        type: "issue_comment",
        author: comment.author?.login ?? "unknown",
      };
      data.issueComments.set(comment.id, parityComment);
    }

    // Process review threads and their comments
    for (const thread of pr.reviewThreads?.nodes ?? []) {
      for (const comment of thread.comments?.nodes ?? []) {
        const parityComment: ParityComment = {
          id: comment.id,
          pr: pr.number,
          type: "review_comment",
          author: comment.author?.login ?? "unknown",
          isResolved: thread.isResolved,
        };
        data.reviewComments.set(comment.id, parityComment);
      }
    }
  }

  return data;
}

/**
 * Firewatch cache entry types
 */
interface FwEntry {
  id: string;
  pr: number;
  type: string;
  subtype?: string;
  author: string;
  thread_resolved?: boolean;
}

/**
 * Fetch all comment data from Firewatch cache.
 */
async function fetchFirewatchData(repo: string): Promise<ParityData> {
  // Query fw for all comments on open PRs (offline to use cached data)
  const result =
    await $`bun apps/cli/bin/fw.ts --type comment --open --offline --repo ${repo}`.text();

  const data: ParityData = {
    reviewComments: new Map(),
    issueComments: new Map(),
  };

  for (const line of result.split("\n").filter(Boolean)) {
    try {
      const entry = JSON.parse(line) as FwEntry;

      if (entry.subtype === "review_comment") {
        const parityComment: ParityComment = {
          id: entry.id,
          pr: entry.pr,
          type: "review_comment",
          author: entry.author,
          isResolved: entry.thread_resolved,
        };
        data.reviewComments.set(entry.id, parityComment);
      } else if (entry.subtype === "issue_comment") {
        const parityComment: ParityComment = {
          id: entry.id,
          pr: entry.pr,
          type: "issue_comment",
          author: entry.author,
        };
        data.issueComments.set(entry.id, parityComment);
      }
    } catch {
      // Skip non-JSON lines
    }
  }

  return data;
}

/**
 * Convert ParityResult to JSON-serializable format.
 */
function resultToJson(result: ReturnType<typeof compareParityData>) {
  return {
    repo: result.repo,
    filters: result.filters,
    stats: result.stats,
    match: result.match,
    discrepancies: result.discrepancies,
  };
}

// Main execution
async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (!options.json) {
    console.log(`Checking parity for ${options.repo}...`);
  }

  try {
    const [ghData, fwData] = await Promise.all([
      fetchGitHubData(options.repo),
      fetchFirewatchData(options.repo),
    ]);

    const result = compareParityData(
      options.repo,
      ghData,
      fwData,
      options.filters
    );

    if (options.json) {
      console.log(JSON.stringify(resultToJson(result), null, 2));
    } else {
      console.log(formatParityResult(result));
    }

    process.exit(result.match ? 0 : 1);
  } catch (error) {
    if (options.json) {
      console.log(
        JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        })
      );
    } else {
      console.error("Error:", error instanceof Error ? error.message : error);
    }
    process.exit(2);
  }
}

main();
