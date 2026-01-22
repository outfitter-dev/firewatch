/**
 * Parity checking between GitHub API and Firewatch cache.
 *
 * Used to verify that Firewatch correctly captures unresolved review threads.
 */

/**
 * Thread data from GitHub GraphQL API.
 */
export interface GitHubThreadData {
  pr: number;
  threadId: string;
  commentId?: string;
}

/**
 * Result of comparing GitHub and Firewatch thread data.
 */
export interface ParityResult {
  repo: string;
  ghThreadCount: number;
  fwThreadCount: number;
  match: boolean;
  ghByPr: Map<number, GitHubThreadData[]>;
  fwByPr: Map<number, string[]>;
  missingInFw: GitHubThreadData[];
  extraInFw: string[];
}

/**
 * Compare GitHub and Firewatch thread data for parity.
 *
 * @param repo - Repository identifier (owner/name)
 * @param ghByPr - GitHub threads grouped by PR number
 * @param fwByPr - Firewatch comment IDs grouped by PR number
 * @returns Comparison result with match status and discrepancies
 */
export function compareThreads(
  repo: string,
  ghByPr: Map<number, GitHubThreadData[]>,
  fwByPr: Map<number, string[]>
): ParityResult {
  // Count totals
  let ghCount = 0;
  let fwCount = 0;

  for (const threads of ghByPr.values()) {
    ghCount += threads.length;
  }
  for (const ids of fwByPr.values()) {
    fwCount += ids.length;
  }

  // Find missing entries (in GH but not in FW)
  const missingInFw: GitHubThreadData[] = [];
  for (const [pr, threads] of ghByPr) {
    const fwIds = new Set(fwByPr.get(pr));
    for (const thread of threads) {
      // Check if comment ID exists in FW (comment IDs are what we store)
      if (thread.commentId && !fwIds.has(thread.commentId)) {
        missingInFw.push(thread);
      }
    }
  }

  // Find extra entries (in FW but not in GH)
  const extraInFw: string[] = [];
  const ghCommentIds = new Set<string>();
  for (const threads of ghByPr.values()) {
    for (const thread of threads) {
      if (thread.commentId) {
        ghCommentIds.add(thread.commentId);
      }
    }
  }
  for (const ids of fwByPr.values()) {
    for (const id of ids) {
      if (!ghCommentIds.has(id)) {
        extraInFw.push(id);
      }
    }
  }

  return {
    repo,
    ghThreadCount: ghCount,
    fwThreadCount: fwCount,
    match:
      ghCount === fwCount && missingInFw.length === 0 && extraInFw.length === 0,
    ghByPr,
    fwByPr,
    missingInFw,
    extraInFw,
  };
}

/**
 * Format parity result for human-readable output.
 */
export function formatParityResult(result: ParityResult): string {
  const lines: string[] = [
    `\n=== GitHub/Firewatch Parity Check: ${result.repo} ===\n`,
    `GitHub unresolved threads:    ${result.ghThreadCount}`,
    `Firewatch unresolved threads: ${result.fwThreadCount}`,
    `Status: ${result.match ? "✓ MATCH" : "✗ MISMATCH"}`,
  ];

  if (!result.match) {
    lines.push("\n--- Details ---\n");

    // Show by-PR breakdown
    lines.push("GitHub threads by PR:");
    for (const [pr, threads] of result.ghByPr) {
      lines.push(`  PR #${pr}: ${threads.length} unresolved`);
    }

    lines.push("\nFirewatch threads by PR:");
    for (const [pr, ids] of result.fwByPr) {
      lines.push(`  PR #${pr}: ${ids.length} unresolved`);
    }

    if (result.missingInFw.length > 0) {
      lines.push("\nMissing in Firewatch (present in GitHub):");
      for (const thread of result.missingInFw) {
        lines.push(
          `  PR #${thread.pr}: ${thread.commentId ?? thread.threadId}`
        );
      }
    }

    if (result.extraInFw.length > 0) {
      lines.push("\nExtra in Firewatch (not in GitHub):");
      for (const id of result.extraInFw) {
        lines.push(`  ${id}`);
      }
    }
  }

  return lines.join("\n");
}
