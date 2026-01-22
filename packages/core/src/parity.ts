/**
 * Parity checking between GitHub API and Firewatch cache.
 *
 * Supports comparison of:
 * - Review comments (code-level comments with resolution state)
 * - Issue comments (PR-level discussion comments)
 */

/** Types of comments that can be compared */
export type CommentType = "review_comment" | "issue_comment";

/** A comment from either GitHub or Firewatch */
export interface ParityComment {
  id: string;
  pr: number;
  type: CommentType;
  author: string;
  isResolved?: boolean; // Only meaningful for review_comment
}

/** Data grouped by comment type */
export interface ParityData {
  reviewComments: Map<string, ParityComment>;
  issueComments: Map<string, ParityComment>;
}

/** Filter options for parity comparison */
export interface ParityFilterOptions {
  type?: CommentType | "all";
  resolved?: boolean;
  unresolved?: boolean;
}

/** A single discrepancy between GitHub and Firewatch */
export interface ParityDiscrepancy {
  id: string;
  pr: number;
  type: CommentType;
  kind: "missing_in_fw" | "extra_in_fw" | "state_mismatch";
  ghResolved?: boolean;
  fwResolved?: boolean;
  author?: string;
}

/** Statistics for a comment type */
export interface CommentStats {
  gh_total: number;
  gh_resolved: number;
  gh_unresolved: number;
  fw_total: number;
  fw_resolved: number;
  fw_unresolved: number;
}

/** Statistics for issue comments (no resolution state) */
export interface IssueCommentStats {
  gh_total: number;
  fw_total: number;
}

/** Combined statistics for all comment types */
export interface ParityStats {
  review_comments: CommentStats;
  issue_comments: IssueCommentStats;
}

/** Result of comprehensive parity comparison */
export interface ParityResult {
  repo: string;
  filters: ParityFilterOptions;
  stats: ParityStats;
  match: boolean;
  discrepancies: ParityDiscrepancy[];
}

/**
 * Compute statistics from GitHub and Firewatch data.
 */
export function computeStats(gh: ParityData, fw: ParityData): ParityStats {
  const reviewStats: CommentStats = {
    gh_total: gh.reviewComments.size,
    gh_resolved: 0,
    gh_unresolved: 0,
    fw_total: fw.reviewComments.size,
    fw_resolved: 0,
    fw_unresolved: 0,
  };

  for (const comment of gh.reviewComments.values()) {
    if (comment.isResolved === true) {
      reviewStats.gh_resolved++;
    } else {
      reviewStats.gh_unresolved++;
    }
  }

  for (const comment of fw.reviewComments.values()) {
    if (comment.isResolved === true) {
      reviewStats.fw_resolved++;
    } else {
      reviewStats.fw_unresolved++;
    }
  }

  return {
    review_comments: reviewStats,
    issue_comments: {
      gh_total: gh.issueComments.size,
      fw_total: fw.issueComments.size,
    },
  };
}

/**
 * Apply filters to a map of comments.
 */
export function filterComments(
  comments: Map<string, ParityComment>,
  filters: ParityFilterOptions
): Map<string, ParityComment> {
  const result = new Map<string, ParityComment>();

  for (const [id, comment] of comments) {
    // Type filter
    if (filters.type && filters.type !== "all" && comment.type !== filters.type) {
      continue;
    }

    // Resolution filters (only apply to review comments)
    if (comment.type === "review_comment") {
      if (filters.resolved && comment.isResolved !== true) {
        continue;
      }
      if (filters.unresolved && comment.isResolved === true) {
        continue;
      }
    }

    result.set(id, comment);
  }

  return result;
}

/**
 * Compare GitHub and Firewatch data for parity with filtering.
 *
 * @param repo - Repository identifier (owner/name)
 * @param ghData - GitHub comment data
 * @param fwData - Firewatch comment data
 * @param filters - Optional filters to apply
 * @returns Comprehensive comparison result
 */
export function compareParityData(
  repo: string,
  ghData: ParityData,
  fwData: ParityData,
  filters: ParityFilterOptions = {}
): ParityResult {
  // Compute stats on unfiltered data
  const stats = computeStats(ghData, fwData);

  // Merge all comments for comparison, applying filters
  const ghAll = new Map<string, ParityComment>();
  const fwAll = new Map<string, ParityComment>();

  // Add review comments
  for (const [id, comment] of filterComments(ghData.reviewComments, filters)) {
    ghAll.set(id, comment);
  }
  for (const [id, comment] of filterComments(fwData.reviewComments, filters)) {
    fwAll.set(id, comment);
  }

  // Add issue comments (skip if filtering by resolution state, since they don't have it)
  const skipIssueComments =
    filters.resolved === true || filters.unresolved === true;

  if (!skipIssueComments) {
    for (const [id, comment] of filterComments(ghData.issueComments, filters)) {
      ghAll.set(id, comment);
    }
    for (const [id, comment] of filterComments(fwData.issueComments, filters)) {
      fwAll.set(id, comment);
    }
  }

  const discrepancies: ParityDiscrepancy[] = [];

  // Find missing in Firewatch (in GH but not in FW)
  for (const [id, ghComment] of ghAll) {
    const fwComment = fwAll.get(id);
    if (!fwComment) {
      discrepancies.push({
        id,
        pr: ghComment.pr,
        type: ghComment.type,
        kind: "missing_in_fw",
        ...(ghComment.isResolved !== undefined && { ghResolved: ghComment.isResolved }),
        author: ghComment.author,
      });
    } else if (
      ghComment.type === "review_comment" &&
      ghComment.isResolved !== fwComment.isResolved
    ) {
      // State mismatch
      discrepancies.push({
        id,
        pr: ghComment.pr,
        type: ghComment.type,
        kind: "state_mismatch",
        ...(ghComment.isResolved !== undefined && { ghResolved: ghComment.isResolved }),
        ...(fwComment.isResolved !== undefined && { fwResolved: fwComment.isResolved }),
        author: ghComment.author,
      });
    }
  }

  // Find extra in Firewatch (in FW but not in GH)
  for (const [id, fwComment] of fwAll) {
    if (!ghAll.has(id)) {
      discrepancies.push({
        id,
        pr: fwComment.pr,
        type: fwComment.type,
        kind: "extra_in_fw",
        ...(fwComment.isResolved !== undefined && { fwResolved: fwComment.isResolved }),
        author: fwComment.author,
      });
    }
  }

  // Sort discrepancies by PR number, then by kind
  discrepancies.sort((a, b) => {
    if (a.pr !== b.pr) {
      return a.pr - b.pr;
    }
    return a.kind.localeCompare(b.kind);
  });

  return {
    repo,
    filters,
    stats,
    match: discrepancies.length === 0,
    discrepancies,
  };
}

/**
 * Format resolved state for display.
 */
function formatResolvedState(resolved: boolean | undefined): string {
  if (resolved === undefined) {
    return "";
  }
  return resolved ? ", resolved" : ", unresolved";
}

/**
 * Format parity result for human-readable output.
 */
export function formatParityResult(result: ParityResult): string {
  const lines: string[] = [
    `\n=== GitHub/Firewatch Parity Check: ${result.repo} ===`,
  ];

  // Show active filters
  const activeFilters: string[] = [];
  if (result.filters.type && result.filters.type !== "all") {
    activeFilters.push(`type=${result.filters.type}`);
  }
  if (result.filters.resolved) {
    activeFilters.push("resolved");
  }
  if (result.filters.unresolved) {
    activeFilters.push("unresolved");
  }
  lines.push(
    `Filters: ${activeFilters.length > 0 ? activeFilters.join(", ") : "none"}\n`
  );

  // Statistics
  lines.push("--- Statistics ---");
  lines.push("Review Comments:");
  const rc = result.stats.review_comments;
  lines.push(
    `  GitHub:    ${rc.gh_total} total (${rc.gh_resolved} resolved, ${rc.gh_unresolved} unresolved)`
  );
  lines.push(
    `  Firewatch: ${rc.fw_total} total (${rc.fw_resolved} resolved, ${rc.fw_unresolved} unresolved)`
  );

  lines.push("\nIssue Comments:");
  const ic = result.stats.issue_comments;
  lines.push(`  GitHub:    ${ic.gh_total} total`);
  lines.push(`  Firewatch: ${ic.fw_total} total`);

  // Status
  lines.push(
    `\nStatus: ${result.match ? "✓ MATCH" : `✗ MISMATCH (${result.discrepancies.length} discrepancies)`}`
  );

  // Discrepancies
  if (!result.match) {
    lines.push("\n--- Discrepancies ---");

    const missing = result.discrepancies.filter((d) => d.kind === "missing_in_fw");
    const extra = result.discrepancies.filter((d) => d.kind === "extra_in_fw");
    const stateMismatch = result.discrepancies.filter(
      (d) => d.kind === "state_mismatch"
    );

    if (missing.length > 0) {
      lines.push("Missing in Firewatch:");
      for (const d of missing) {
        const resolved = formatResolvedState(d.ghResolved);
        lines.push(`  PR #${d.pr}: ${d.id} (${d.type}${resolved})`);
      }
    }

    if (extra.length > 0) {
      lines.push("\nExtra in Firewatch:");
      for (const d of extra) {
        const resolved = formatResolvedState(d.fwResolved);
        lines.push(`  PR #${d.pr}: ${d.id} (${d.type}${resolved})`);
      }
    }

    if (stateMismatch.length > 0) {
      lines.push("\nState Mismatch:");
      for (const d of stateMismatch) {
        const ghState = d.ghResolved ? "resolved" : "unresolved";
        const fwState = d.fwResolved ? "resolved" : "unresolved";
        lines.push(`  PR #${d.pr}: ${d.id} (gh: ${ghState}, fw: ${fwState})`);
      }
    }
  }

  return lines.join("\n");
}
